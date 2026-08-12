// src/ui/WikiWindow.js — the in-game manual ("Beamline Wiki").
//
// A single ContextWindow (id 'wiki') with a two-pane layout: a left nav
// listing WIKI_SECTIONS + a search box, and a right content pane that renders
// either an article or a component page. Because relatedArticles interlink the
// pages, the content pane keeps its own back/forward history.
//
// Content comes from src/data/wiki/index.js:
//   WIKI_SECTIONS        [{ id, title, entries: [{ id, title, kind }] }]
//   getArticle(id)       { id, title, section, quickTip, bodyHtml } | null
//   getComponentPage(id) { id, name, category, subsection, summary, stats,
//                          utilities, performance, curves, relatedArticles }
//   searchWiki(query)    [{ id, title, kind, snippet }]
//
// The import is dynamic and guarded: the window still opens (with an
// explanatory placeholder) if the content layer is missing or throws.

import { ContextWindow } from './ContextWindow.js';
import { renderComponentThumbnail } from '../renderer3d/component-builder.js';
import { COMPONENTS } from '../data/components.js';

const WIKI_WINDOW_ID = 'wiki';

// Entry kinds that resolve through getComponentPage rather than getArticle.
const COMPONENT_KINDS = new Set(['component', 'infrastructure']);

// --- content module loading -------------------------------------------------

const EMPTY_CONTENT = {
  WIKI_SECTIONS: [],
  getArticle: () => null,
  getComponentPage: () => null,
  searchWiki: () => [],
  __unavailable: true,
};

let _content = null;
let _contentPromise = null;

/** Resolve the wiki content module once; never rejects. */
function loadWikiContent() {
  if (_content) return Promise.resolve(_content);
  if (!_contentPromise) {
    _contentPromise = import('../data/wiki/index.js')
      .then((mod) => {
        _content = {
          WIKI_SECTIONS: Array.isArray(mod.WIKI_SECTIONS) ? mod.WIKI_SECTIONS : [],
          getArticle: typeof mod.getArticle === 'function' ? mod.getArticle : () => null,
          getComponentPage: typeof mod.getComponentPage === 'function' ? mod.getComponentPage : () => null,
          searchWiki: typeof mod.searchWiki === 'function' ? mod.searchWiki : () => [],
        };
        return _content;
      })
      .catch((err) => {
        console.warn('[WikiWindow] wiki content unavailable:', err?.message || err);
        _content = EMPTY_CONTENT;
        return _content;
      });
  }
  return _contentPromise;
}

// --- small helpers ----------------------------------------------------------

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

// Category / subsection ids arrive as camelCase keys ('labEquipment'); the
// kicker line reads better as words.
function prettyLabel(id) {
  if (!id) return '';
  const s = String(id).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Table cell that navigates to another manual page when clicked. */
function linkCell(text, wikiId) {
  return { __wikiLink: wikiId, text };
}

/**
 * Stringify a table cell. Utility port `params` arrive as raw objects
 * ({ pumpSpeed: 500 }), so flatten them to one "Label: value" line each.
 */
function formatCellValue(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(formatCellValue).join(', ') : '—';
  if (typeof v === 'object') {
    const bits = Object.entries(v).map(([k, val]) => `${prettyLabel(k)}: ${formatCellValue(val)}`);
    return bits.length ? bits.join('\n') : '—';
  }
  if (typeof v === 'number') return String(Number(v.toPrecision(6)));
  return String(v);
}

function hex(color) {
  return '#' + (color >>> 0).toString(16).padStart(6, '0');
}

// Same channel-multiply recipe as sprites._darken, kept local so the wiki has
// no dependency on a live renderer.
function darken(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Component preview: the same 3D thumbnail the build palette uses, falling
 * back to the isometric box swatch hud.js draws when there is no geometry.
 * (Mirrors hud.js:_createPaletteItem.)
 */
function buildComponentPreview(componentId, size = 96) {
  const wrap = el('div', 'wiki-preview');
  let thumbUrl = null;
  try {
    thumbUrl = renderComponentThumbnail(componentId, size);
  } catch (e) {
    thumbUrl = null;
  }
  if (thumbUrl) {
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.width = size;
    img.height = size;
    img.alt = '';
    img.style.objectFit = 'contain';
    wrap.appendChild(img);
    return wrap;
  }

  const comp = COMPONENTS[componentId];
  const color = comp?.spriteColor ?? 0x888888;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', '54');
  svg.setAttribute('viewBox', '0 0 48 40');
  svg.innerHTML =
    `<polygon points="24,4 44,14 24,24 4,14" fill="${hex(color)}"/>` +
    `<polygon points="4,14 24,24 24,36 4,26" fill="${hex(darken(color, 0.7))}"/>` +
    `<polygon points="44,14 24,24 24,36 44,26" fill="${hex(darken(color, 0.85))}"/>`;
  wrap.appendChild(svg);
  return wrap;
}

// --- inline SVG line charts -------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}

function fmtTick(v, span) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1).replace('e+', 'e');
  const decimals = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  return String(parseFloat(v.toFixed(decimals)));
}

/**
 * Render one { title, xLabel, yLabel, points, note } curve as a small inline
 * SVG line chart. No external chart library; tuned for the dark pixel UI.
 */
function buildCurveChart(curve) {
  const card = el('div', 'wiki-chart');
  if (curve?.title) card.appendChild(el('div', 'wiki-chart-title', curve.title));

  const pts = (Array.isArray(curve?.points) ? curve.points : [])
    .map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
    .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((a, b) => a[0] - b[0]);

  if (pts.length < 2) {
    card.appendChild(el('div', 'wiki-empty', 'No curve data.'));
    return card;
  }

  const W = 320, H = 190;
  const padL = 50, padR = 14, padT = 12, padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let xMin = Math.min(...pts.map((p) => p[0]));
  let xMax = Math.max(...pts.map((p) => p[0]));
  let yRawMin = Math.min(...pts.map((p) => p[1]));
  let yRawMax = Math.max(...pts.map((p) => p[1]));
  if (xMax - xMin === 0) { xMin -= 0.5; xMax += 0.5; }

  // Vacuum pressure and similar quantities span decades; a linear axis
  // flattens them into the baseline. Switch to log-y when the data warrants it.
  const logY = yRawMin > 0 && yRawMax / yRawMin >= 100;
  const fwd = logY ? Math.log10 : (v) => v;
  const inv = logY ? (v) => Math.pow(10, v) : (v) => v;

  let yMin = fwd(yRawMin);
  let yMax = fwd(yRawMax);
  if (yMax - yMin === 0) { yMin -= 0.5; yMax += 0.5; }
  // Breathe a little vertically so peaks don't sit on the frame.
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;
  // Never let the headroom push a non-negative quantity below zero — a
  // "-2.7e-8 mbar" tick reads as a data error.
  if (!logY && yRawMin >= 0 && yMin < 0) yMin = 0;

  const sx = (x) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y) => padT + plotH - ((fwd(y) - yMin) / (yMax - yMin)) * plotH;

  const svg = svgEl('svg', {
    width: '100%', viewBox: `0 0 ${W} ${H}`,
    class: 'wiki-chart-svg', role: 'img',
    'aria-label': curve?.title || 'curve',
  });

  svg.appendChild(svgEl('rect', {
    x: padL, y: padT, width: plotW, height: plotH,
    fill: 'rgba(12,12,26,0.75)', stroke: 'rgba(90,90,140,0.45)', 'stroke-width': 1,
  }));

  const TICKS = 4;
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;

  for (let i = 0; i <= TICKS; i++) {
    const f = i / TICKS;

    const gx = padL + f * plotW;
    svg.appendChild(svgEl('line', {
      x1: gx, y1: padT, x2: gx, y2: padT + plotH,
      stroke: 'rgba(90,90,140,0.18)', 'stroke-width': 1,
    }));
    const xt = svgEl('text', {
      x: gx, y: padT + plotH + 13, 'text-anchor': 'middle', class: 'wiki-chart-tick',
    });
    xt.textContent = fmtTick(xMin + f * xSpan, xSpan);
    svg.appendChild(xt);

    const gy = padT + plotH - f * plotH;
    svg.appendChild(svgEl('line', {
      x1: padL, y1: gy, x2: padL + plotW, y2: gy,
      stroke: 'rgba(90,90,140,0.18)', 'stroke-width': 1,
    }));
    const yt = svgEl('text', {
      x: padL - 6, y: gy + 3, 'text-anchor': 'end', class: 'wiki-chart-tick',
    });
    const yVal = inv(yMin + f * ySpan);
    yt.textContent = logY ? fmtTick(yVal, 0) : fmtTick(yVal, ySpan);
    svg.appendChild(yt);
  }

  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join(' ');
  svg.appendChild(svgEl('path', {
    d, fill: 'none', stroke: '#5fd0ff', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // Sample dots, thinned so a dense curve doesn't turn into a bead necklace.
  const step = Math.max(1, Math.ceil(pts.length / 14));
  for (let i = 0; i < pts.length; i += step) {
    svg.appendChild(svgEl('rect', {
      x: sx(pts[i][0]) - 1.5, y: sy(pts[i][1]) - 1.5, width: 3, height: 3, fill: '#bde9ff',
    }));
  }

  // Axis captions are HTML, not rotated SVG text: these labels are full
  // phrases and a rotated pixel font clips or overflows the plot height.
  if (curve?.yLabel) {
    card.appendChild(el('div', 'wiki-chart-axis-y',
      `↑ ${curve.yLabel}${logY ? '  (log scale)' : ''}`));
  }
  card.appendChild(svg);
  if (curve?.xLabel) card.appendChild(el('div', 'wiki-chart-axis-x', `→ ${curve.xLabel}`));
  if (curve?.note) card.appendChild(el('div', 'wiki-chart-note', curve.note));
  return card;
}

// --- the window -------------------------------------------------------------

export class WikiWindow {
  constructor({ raiseAboveTitle = false } = {}) {
    const existing = ContextWindow.getWindow(WIKI_WINDOW_ID);
    if (existing && existing.__wiki) {
      this.ctx = existing;
      return existing.__wiki;
    }

    this._history = [];
    this._histIndex = -1;
    this._searchTimer = null;
    this._raised = false;

    this.ctx = new ContextWindow({
      id: WIKI_WINDOW_ID,
      title: 'Operator Manual',
      icon: '📖',
      accentColor: '#4a3b63',
      onClose: () => this._onClose(),
    });
    this.ctx.__wiki = this;

    this._buildLayout();
    this._centerOnScreen();
    if (raiseAboveTitle) this._raiseAboveTitle();

    loadWikiContent().then(() => {
      this._renderNav();
      // Only take over the pane if nothing has been navigated to meanwhile.
      if (this._histIndex < 0) this._navigate({ kind: 'home' });
      else this._renderCurrent();
    });
  }

  // -- lifecycle ------------------------------------------------------------

  _onClose() {
    if (this._raised) {
      document.getElementById('context-windows-container')
        ?.classList.remove('wiki-above-title');
      this._raised = false;
    }
    if (this._searchTimer) clearTimeout(this._searchTimer);
  }

  close() { this.ctx?.close(); }

  focus() { this.ctx?.focus(); }

  /** The title screen sits at z-index 9500; lift the window container over it. */
  _raiseAboveTitle() {
    document.getElementById('context-windows-container')
      ?.classList.add('wiki-above-title');
    this._raised = true;
  }

  _centerOnScreen() {
    const w = this.ctx?._el;
    if (!w) return;
    const width = 800, height = 560;
    const left = Math.max(12, Math.round((window.innerWidth - width) / 2));
    const top = Math.max(12, Math.round((window.innerHeight - height) / 2));
    w.style.left = left + 'px';
    w.style.top = top + 'px';
  }

  // -- DOM ------------------------------------------------------------------

  _buildLayout() {
    const body = this.ctx?._body;
    if (!body) return;
    body.innerHTML = '';

    const root = el('div', 'wiki-root');

    // Left: search + section nav
    const nav = el('div', 'wiki-nav');
    const searchWrap = el('div', 'wiki-search-wrap');
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'wiki-search';
    search.placeholder = 'Search...';
    search.setAttribute('aria-label', 'Search the manual');
    search.addEventListener('input', () => {
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._runSearch(search.value), 120);
    });
    search.addEventListener('keydown', (e) => {
      // Keep Esc from unwinding the whole window while the player is typing.
      if (e.key === 'Escape' && search.value) {
        e.stopPropagation();
        search.value = '';
        this._runSearch('');
      }
    });
    searchWrap.appendChild(search);
    nav.appendChild(searchWrap);

    const navList = el('div', 'wiki-nav-list');
    nav.appendChild(navList);

    // Right: toolbar + page
    const content = el('div', 'wiki-content');
    const toolbar = el('div', 'wiki-toolbar');

    const backBtn = el('button', 'wiki-nav-btn', '◀');
    backBtn.title = 'Back';
    backBtn.addEventListener('click', () => this.back());

    const fwdBtn = el('button', 'wiki-nav-btn', '▶');
    fwdBtn.title = 'Forward';
    fwdBtn.addEventListener('click', () => this.forward());

    const homeBtn = el('button', 'wiki-nav-btn', '⌂');
    homeBtn.title = 'Contents';
    homeBtn.addEventListener('click', () => this._navigate({ kind: 'home' }));

    const crumb = el('div', 'wiki-crumb', '');

    toolbar.append(backBtn, fwdBtn, homeBtn, crumb);

    const page = el('div', 'wiki-page');
    // Interlinks embedded in bodyHtml: <a data-wiki="id"> or href="#wiki/id".
    page.addEventListener('click', (e) => {
      const link = e.target.closest?.('[data-wiki], a[href^="#wiki/"]');
      if (!link) return;
      e.preventDefault();
      const id = link.dataset?.wiki || link.getAttribute('href').slice('#wiki/'.length);
      if (id) this.openEntry(id);
    });

    content.append(toolbar, page);
    root.append(nav, content);
    body.appendChild(root);

    this._searchInput = search;
    this._navList = navList;
    this._page = page;
    this._crumb = crumb;
    this._backBtn = backBtn;
    this._fwdBtn = fwdBtn;
  }

  // -- navigation -----------------------------------------------------------

  get _current() {
    return this._histIndex >= 0 ? this._history[this._histIndex] : null;
  }

  _navigate(entry) {
    // Collapse a repeat of the same destination into a plain re-render.
    const cur = this._current;
    if (cur && cur.kind === entry.kind && cur.id === entry.id && cur.query === entry.query) {
      this._renderCurrent();
      return;
    }
    this._history = this._history.slice(0, this._histIndex + 1);
    this._history.push(entry);
    this._histIndex = this._history.length - 1;
    this._renderCurrent();
  }

  back() {
    if (this._histIndex <= 0) return;
    this._histIndex--;
    this._renderCurrent();
  }

  forward() {
    if (this._histIndex >= this._history.length - 1) return;
    this._histIndex++;
    this._renderCurrent();
  }

  /** Open an entry by id, resolving article vs component page automatically. */
  openEntry(id, kindHint) {
    if (!id) return;
    const c = _content || EMPTY_CONTENT;
    const isComp = kindHint
      ? COMPONENT_KINDS.has(kindHint)
      : !c.getArticle(id) && !!c.getComponentPage(id);
    this._navigate({ kind: isComp ? 'component' : 'article', id });
  }

  openArticle(id) { this._navigate({ kind: 'article', id }); }

  openComponent(id) { this._navigate({ kind: 'component', id }); }

  openSection(id) { this._navigate({ kind: 'section', id }); }

  // -- left nav -------------------------------------------------------------

  _renderNav() {
    const list = this._navList;
    if (!list) return;
    list.innerHTML = '';
    const c = _content || EMPTY_CONTENT;

    if (!c.WIKI_SECTIONS.length) {
      list.appendChild(el('div', 'wiki-empty', 'Manual contents are still being written.'));
      return;
    }

    for (const section of c.WIKI_SECTIONS) {
      const head = el('div', 'wiki-nav-section', section.title || section.id);
      head.addEventListener('click', () => this.openSection(section.id));
      list.appendChild(head);

      for (const entry of section.entries || []) {
        const row = el('div', 'wiki-nav-item', entry.title || entry.id);
        row.dataset.wikiId = entry.id;
        row.dataset.wikiKind = entry.kind || 'article';
        if (COMPONENT_KINDS.has(entry.kind)) row.classList.add('is-component');
        row.addEventListener('click', () => this.openEntry(entry.id, entry.kind));
        list.appendChild(row);
      }
    }
    this._syncNavHighlight();
  }

  _syncNavHighlight() {
    const cur = this._current;
    const id = cur && (cur.kind === 'article' || cur.kind === 'component') ? cur.id : null;
    this._navList?.querySelectorAll('.wiki-nav-item').forEach((row) => {
      row.classList.toggle('active', row.dataset.wikiId === id);
    });
  }

  _runSearch(query) {
    const q = (query || '').trim();
    if (!q) {
      this._renderNav();
      return;
    }
    const c = _content || EMPTY_CONTENT;
    let results = [];
    try {
      results = c.searchWiki(q) || [];
    } catch (e) {
      results = [];
    }

    const list = this._navList;
    if (!list) return;
    list.innerHTML = '';
    list.appendChild(el('div', 'wiki-nav-section', `${results.length} result${results.length === 1 ? '' : 's'}`));
    if (!results.length) {
      list.appendChild(el('div', 'wiki-empty', 'Nothing matched.'));
      return;
    }
    for (const r of results) {
      const row = el('div', 'wiki-nav-item wiki-result');
      row.dataset.wikiId = r.id;
      row.appendChild(el('div', 'wiki-result-title', r.title || r.id));
      if (r.snippet) row.appendChild(el('div', 'wiki-result-snippet', r.snippet));
      row.addEventListener('click', () => this.openEntry(r.id, r.kind));
      list.appendChild(row);
    }
  }

  // -- content pane ---------------------------------------------------------

  _renderCurrent() {
    const page = this._page;
    if (!page) return;
    page.innerHTML = '';
    page.scrollTop = 0;

    const entry = this._current;
    const c = _content || EMPTY_CONTENT;

    if (this._backBtn) this._backBtn.disabled = this._histIndex <= 0;
    if (this._fwdBtn) this._fwdBtn.disabled = this._histIndex >= this._history.length - 1;

    if (c.__unavailable || !c.WIKI_SECTIONS.length) {
      page.appendChild(this._renderUnavailable());
      this._setCrumb('Manual');
      return;
    }

    if (!entry || entry.kind === 'home') {
      page.appendChild(this._renderHome());
      this._setCrumb('Contents');
    } else if (entry.kind === 'section') {
      page.appendChild(this._renderSection(entry.id));
    } else if (entry.kind === 'component') {
      page.appendChild(this._renderComponentPage(entry.id));
    } else {
      page.appendChild(this._renderArticle(entry.id));
    }
    this._syncNavHighlight();
  }

  _setCrumb(text) {
    if (this._crumb) this._crumb.textContent = text || '';
  }

  _renderUnavailable() {
    const wrap = el('div', 'wiki-article');
    wrap.appendChild(el('h2', 'wiki-h1', 'Manual unavailable'));
    wrap.appendChild(el('p', 'wiki-p',
      'The manual pages have not been installed yet. Content lives in src/data/wiki/.'));
    return wrap;
  }

  _renderHome() {
    const c = _content || EMPTY_CONTENT;
    const wrap = el('div', 'wiki-article');
    wrap.appendChild(el('h2', 'wiki-h1', 'Operator Manual'));
    wrap.appendChild(el('p', 'wiki-p',
      'Reference for the machine you are building: the physics, the hardware, and the utilities that keep it alive.'));

    for (const section of c.WIKI_SECTIONS) {
      wrap.appendChild(el('div', 'wiki-h2', section.title || section.id));
      const grid = el('div', 'wiki-chip-grid');
      for (const entry of section.entries || []) {
        const chip = el('button', 'wiki-chip', entry.title || entry.id);
        if (COMPONENT_KINDS.has(entry.kind)) chip.classList.add('is-component');
        chip.addEventListener('click', () => this.openEntry(entry.id, entry.kind));
        grid.appendChild(chip);
      }
      if (!grid.children.length) grid.appendChild(el('div', 'wiki-empty', 'No entries yet.'));
      wrap.appendChild(grid);
    }
    return wrap;
  }

  _renderSection(sectionId) {
    const c = _content || EMPTY_CONTENT;
    const section = c.WIKI_SECTIONS.find((s) => s.id === sectionId);
    const wrap = el('div', 'wiki-article');
    if (!section) {
      wrap.appendChild(el('h2', 'wiki-h1', 'Section not found'));
      this._setCrumb('Contents');
      return wrap;
    }
    this._setCrumb(section.title || section.id);
    wrap.appendChild(el('h2', 'wiki-h1', section.title || section.id));
    const grid = el('div', 'wiki-chip-grid');
    for (const entry of section.entries || []) {
      const chip = el('button', 'wiki-chip', entry.title || entry.id);
      if (COMPONENT_KINDS.has(entry.kind)) chip.classList.add('is-component');
      chip.addEventListener('click', () => this.openEntry(entry.id, entry.kind));
      grid.appendChild(chip);
    }
    if (!grid.children.length) grid.appendChild(el('div', 'wiki-empty', 'No entries yet.'));
    wrap.appendChild(grid);
    return wrap;
  }

  _renderArticle(id) {
    const c = _content || EMPTY_CONTENT;
    let article = null;
    try { article = c.getArticle(id); } catch (e) { article = null; }

    if (!article) {
      // The id may actually be a component page (relatedArticles cross-links,
      // search results without a kind); try that before giving up.
      let page = null;
      try { page = c.getComponentPage(id); } catch (e) { page = null; }
      if (page) return this._renderComponentPage(id);
      const wrap = el('div', 'wiki-article');
      wrap.appendChild(el('h2', 'wiki-h1', 'Page not found'));
      wrap.appendChild(el('p', 'wiki-p', `No manual entry for "${id}".`));
      this._setCrumb('Not found');
      return wrap;
    }

    this._setCrumb(article.title || article.id);
    const wrap = el('div', 'wiki-article');
    if (article.section) wrap.appendChild(el('div', 'wiki-kicker', article.section));
    wrap.appendChild(el('h2', 'wiki-h1', article.title || article.id));

    if (article.quickTip) {
      const tip = el('div', 'wiki-tip');
      tip.appendChild(el('span', 'wiki-tip-label', 'TIP'));
      tip.appendChild(el('span', 'wiki-tip-text', article.quickTip));
      wrap.appendChild(tip);
    }

    if (article.bodyHtml) {
      const bodyEl = el('div', 'wiki-prose');
      bodyEl.innerHTML = article.bodyHtml;
      wrap.appendChild(bodyEl);
    }
    return wrap;
  }

  _renderComponentPage(id) {
    const c = _content || EMPTY_CONTENT;
    let p = null;
    try { p = c.getComponentPage(id); } catch (e) { p = null; }

    if (!p) {
      let article = null;
      try { article = c.getArticle(id); } catch (e) { article = null; }
      if (article) return this._renderArticle(id);
      const wrap = el('div', 'wiki-article');
      wrap.appendChild(el('h2', 'wiki-h1', 'Page not found'));
      wrap.appendChild(el('p', 'wiki-p', `No manual entry for "${id}".`));
      this._setCrumb('Not found');
      return wrap;
    }

    const name = p.name || COMPONENTS[id]?.name || id;
    this._setCrumb(name);

    const wrap = el('div', 'wiki-article');

    // Header: preview thumbnail beside identity
    const head = el('div', 'wiki-comp-head');
    head.appendChild(buildComponentPreview(p.id || id, 96));
    const ident = el('div', 'wiki-comp-ident');
    const catBits = [p.category, p.subsection].filter(Boolean).map(prettyLabel).join(' · ');
    if (catBits) ident.appendChild(el('div', 'wiki-kicker', catBits));
    ident.appendChild(el('h2', 'wiki-h1', name));
    if (p.summary) ident.appendChild(el('p', 'wiki-p', p.summary));
    head.appendChild(ident);
    wrap.appendChild(head);

    // Stats
    if (Array.isArray(p.stats) && p.stats.length) {
      wrap.appendChild(el('div', 'wiki-h2', 'Specifications'));
      const grid = el('div', 'wiki-stat-grid');
      for (const s of p.stats) {
        const cell = el('div', 'wiki-stat');
        cell.appendChild(el('div', 'wiki-stat-label', s.label ?? ''));
        const val = el('div', 'wiki-stat-value', String(s.value ?? '—'));
        if (s.unit) val.appendChild(el('span', 'wiki-stat-unit', ' ' + s.unit));
        cell.appendChild(val);
        grid.appendChild(cell);
      }
      wrap.appendChild(grid);
    }

    // Utilities
    if (Array.isArray(p.utilities) && p.utilities.length) {
      wrap.appendChild(el('div', 'wiki-h2', 'Utilities'));
      wrap.appendChild(this._buildTable(
        ['Utility', 'Role', 'Params', 'Effect'],
        p.utilities.map((u) => [
          // Rows may carry an `article` id (links.js); link the utility name
          // to it when present.
          u.article ? linkCell(prettyLabel(u.utility), u.article) : prettyLabel(u.utility),
          prettyLabel(u.role),
          u.params,
          u.effect,
        ]),
      ));
    }

    // Performance
    if (Array.isArray(p.performance) && p.performance.length) {
      wrap.appendChild(el('div', 'wiki-h2', 'Performance'));
      const list = el('div', 'wiki-perf-list');
      for (const row of p.performance) {
        const r = el('div', 'wiki-perf-row');
        r.appendChild(el('span', 'wiki-perf-label', row.label ?? ''));
        const v = el('span', 'wiki-perf-value', String(row.value ?? '—'));
        if (row.unit) v.appendChild(el('span', 'wiki-stat-unit', ' ' + row.unit));
        r.appendChild(v);
        if (row.note) r.appendChild(el('span', 'wiki-perf-note', row.note));
        list.appendChild(r);
      }
      wrap.appendChild(list);
    }

    // Curves
    if (Array.isArray(p.curves) && p.curves.length) {
      wrap.appendChild(el('div', 'wiki-h2', 'Response Curves'));
      const charts = el('div', 'wiki-chart-grid');
      for (const curve of p.curves) charts.appendChild(buildCurveChart(curve));
      wrap.appendChild(charts);
    }

    // Related
    if (Array.isArray(p.relatedArticles) && p.relatedArticles.length) {
      wrap.appendChild(el('div', 'wiki-h2', 'See Also'));
      const grid = el('div', 'wiki-chip-grid');
      for (const relId of p.relatedArticles) {
        let title = relId;
        try { title = c.getArticle(relId)?.title || c.getComponentPage(relId)?.name || relId; }
        catch (e) { title = relId; }
        const chip = el('button', 'wiki-chip', title);
        chip.addEventListener('click', () => this.openEntry(relId));
        grid.appendChild(chip);
      }
      wrap.appendChild(grid);
    }

    return wrap;
  }

  _buildTable(headers, rows) {
    const table = el('table', 'wiki-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of headers) hr.appendChild(el('th', null, h));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr');
        for (const cell of row) {
        if (cell && cell.__wikiLink) {
          const td = el('td');
          const link = el('span', 'wiki-cell-link', cell.text);
          link.addEventListener('click', () => this.openEntry(cell.__wikiLink));
          td.appendChild(link);
          tr.appendChild(td);
        } else {
          tr.appendChild(el('td', null, formatCellValue(cell)));
        }
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const scroll = el('div', 'wiki-table-wrap');
    scroll.appendChild(table);
    return scroll;
  }
}

// --- module-level entry point ----------------------------------------------

/**
 * Open (or focus) the manual. All three entry points — title screen, options
 * dialog, HUD help button — route through here.
 *
 * @param {object} [opts]
 * @param {string} [opts.articleId]       - Article to land on.
 * @param {string} [opts.componentId]     - Component page to land on.
 * @param {string} [opts.entryId]         - Entry of unknown kind to land on.
 * @param {boolean} [opts.raiseAboveTitle] - Lift over the title screen (z 9500).
 * @param {boolean} [opts.toggle]         - Close again if already open.
 * @returns {WikiWindow|null}
 */
export function openWikiWindow(opts = {}) {
  const { articleId, componentId, entryId, raiseAboveTitle = false, toggle = false } = opts;

  const existing = ContextWindow.getWindow(WIKI_WINDOW_ID)?.__wiki;
  if (existing) {
    if (toggle && !articleId && !componentId && !entryId) {
      existing.close();
      return null;
    }
    existing.focus();
  }

  const wiki = existing || new WikiWindow({ raiseAboveTitle });

  const target = componentId
    ? { kind: 'component', id: componentId }
    : articleId
      ? { kind: 'article', id: articleId }
      : entryId
        ? { kind: 'entry', id: entryId }
        : null;

  if (target) {
    // The content module may still be loading on a first open; queue behind it.
    loadWikiContent().then((c) => {
      // Contextual opens name a *game* id (the armed/hovered component), which
      // the manual may not cover — land on the contents page instead of a
      // "not found" stub.
      let covered = false;
      try { covered = !!(c.getComponentPage(target.id) || c.getArticle(target.id)); }
      catch (e) { covered = false; }
      if (!covered) return;
      if (target.kind === 'component') wiki.openComponent(target.id);
      else if (target.kind === 'article') wiki.openArticle(target.id);
      else wiki.openEntry(target.id);
    });
  }
  return wiki;
}

/** True when the manual window is currently open. */
export function isWikiOpen() {
  return !!ContextWindow.getWindow(WIKI_WINDOW_ID);
}
