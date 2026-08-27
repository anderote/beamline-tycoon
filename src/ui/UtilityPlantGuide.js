import {
  PLANT_GUIDE_TYPES,
  plantGuideAnchorCandidates,
  plantGuideTypeForPlaceable,
  utilityPlantChecklist,
} from '../utility/plant-guide.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

/**
 * Non-blocking tutorial for the first cooling-water and cryogenic plant.
 * It owns only presentation/session state; every check is derived from the
 * published utility topology and solve result.
 */
export class UtilityPlantGuide {
  constructor(game) {
    this.game = game;
    this.guides = new Map();
    this.activeUtility = null;
    this.collapsed = false;
    this._lastCompleted = new Map();
    this._renderSignature = '';
    this._el = this._createElement();
    this._off = game.on((event, data) => this._onGameEvent(event, data));
  }

  _createElement() {
    const el = document.createElement('aside');
    el.id = 'utility-plant-guide';
    el.className = 'plant-guide hidden';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<button type="button" class="plant-guide-chip" data-plant-action="expand"></button>'
      + '<div class="plant-guide-panel"><header>'
      + '<strong class="plant-guide-title"></strong><span class="plant-guide-progress"></span>'
      + '<button type="button" class="plant-guide-close" data-plant-action="collapse" title="Collapse">−</button>'
      + '</header><nav class="plant-guide-tabs"></nav><div class="plant-guide-body"></div></div>';
    el.addEventListener('click', event => this._handleClick(event));
    document.body.appendChild(el);
    return el;
  }

  toJSON() {
    return {
      guides: Object.fromEntries(this.guides),
      activeUtility: this.activeUtility,
      collapsed: this.collapsed,
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    this.guides = new Map(Object.entries(data.guides || {})
      .filter(([utilityType, anchorId]) => PLANT_GUIDE_TYPES[utilityType] && anchorId));
    this.activeUtility = this.guides.has(data.activeUtility)
      ? data.activeUtility : this.guides.keys().next().value || null;
    this.collapsed = data.collapsed === true;
    this._repairGuides();
    this.render(true);
  }

  resetForNewSession() {
    this.guides.clear();
    this.activeUtility = null;
    this.collapsed = false;
    this._lastCompleted.clear();
    this._renderSignature = '';
    this.render(true);
  }

  _startFor(placeable) {
    const utilityType = plantGuideTypeForPlaceable(placeable);
    if (!utilityType || this.guides.has(utilityType)) return false;
    this.guides.set(utilityType, placeable.id);
    this.activeUtility = utilityType;
    this.collapsed = false;
    this._lastCompleted.set(utilityType, false);
    this.render(true);
    return true;
  }

  _repairGuides() {
    for (const [utilityType, anchorId] of [...this.guides]) {
      const candidates = plantGuideAnchorCandidates(this.game.state, utilityType);
      if (candidates.some(candidate => candidate.id === anchorId)) continue;
      if (candidates.length > 0) this.guides.set(utilityType, candidates[0].id);
      else {
        this.guides.delete(utilityType);
        this._lastCompleted.delete(utilityType);
      }
    }
    if (!this.guides.has(this.activeUtility)) {
      this.activeUtility = this.guides.keys().next().value || null;
    }
  }

  _onGameEvent(event, data) {
    if (event === 'placeableChanged' && data?.action === 'placed') {
      const placeable = (this.game.state.placeables || [])
        .find(candidate => candidate.id === data.placeableId);
      if (placeable && this._startFor(placeable)) return;
    }
    if (event === 'placeableChanged' || event === 'loaded' || event === 'restored') {
      this._repairGuides();
      this.render(true);
      return;
    }
    if (event === 'utilityLinesChanged' || event === 'tick') this.render();
  }

  _handleClick(event) {
    const button = event.target.closest('[data-plant-action]');
    if (!button) return;
    const action = button.dataset.plantAction;
    if (action === 'expand') this.collapsed = false;
    else if (action === 'collapse') this.collapsed = true;
    else if (action === 'switch' && this.guides.has(button.dataset.utility)) {
      this.activeUtility = button.dataset.utility;
      this.collapsed = false;
    }
    this.render(true);
  }

  render(force = false) {
    if (!this._el) return;
    this._repairGuides();
    const utilityType = this.activeUtility;
    const anchorId = utilityType ? this.guides.get(utilityType) : null;
    const checklist = utilityType && anchorId
      ? utilityPlantChecklist(this.game.state, utilityType, anchorId) : null;
    if (!checklist) {
      this._el.classList.add('hidden');
      this._renderSignature = '';
      return;
    }

    const signature = JSON.stringify({
      utilityType,
      collapsed: this.collapsed,
      guides: [...this.guides],
      rows: checklist.rows.map(row => [row.id, row.status, row.detail]),
    });
    if (!force && signature === this._renderSignature) return;
    this._renderSignature = signature;

    const wasCompleted = this._lastCompleted.get(utilityType) === true;
    this._lastCompleted.set(utilityType, checklist.completed);
    if (checklist.completed && !wasCompleted) {
      this._el.classList.add('just-completed');
      setTimeout(() => {
        this._el?.classList.remove('just-completed');
        this.collapsed = true;
        this.render(true);
      }, 1400);
    }

    this._el.classList.remove('hidden');
    this._el.classList.toggle('collapsed', this.collapsed);
    this._el.classList.toggle('complete', checklist.completed);
    this._el.style.setProperty('--plant-guide-accent', checklist.config.accent);

    const title = this._el.querySelector('.plant-guide-title');
    if (title) title.textContent = checklist.config.title;
    const progress = this._el.querySelector('.plant-guide-progress');
    if (progress) progress.textContent = `${checklist.completeCount}/${checklist.rows.length}`;
    const chip = this._el.querySelector('.plant-guide-chip');
    if (chip) {
      chip.textContent = `${checklist.config.shortTitle} ${checklist.completeCount}/${checklist.rows.length}`
        + (checklist.completed ? ' ✓' : '');
    }

    const tabs = this._el.querySelector('.plant-guide-tabs');
    if (tabs) {
      tabs.classList.toggle('hidden', this.guides.size < 2);
      tabs.innerHTML = [...this.guides.keys()].map(type => {
        const config = PLANT_GUIDE_TYPES[type];
        return `<button type="button" class="${type === utilityType ? 'active' : ''}" data-plant-action="switch" data-utility="${esc(type)}">${esc(config.shortTitle)}</button>`;
      }).join('');
    }

    const body = this._el.querySelector('.plant-guide-body');
    if (!body) return;
    const next = checklist.rows.find(row => !row.complete);
    let html = '<div class="plant-guide-list">';
    for (const row of checklist.rows) {
      const isNext = row === next;
      html += `<div class="plant-guide-row ${esc(row.status)}${isNext ? ' next' : ''}" title="${esc(row.detail)}">`
        + `<span class="plant-guide-mark">${row.complete ? '✓' : row.status === 'placed' ? '•' : '○'}</span>`
        + `<span><strong>${esc(row.label)}</strong>${isNext ? `<small>${esc(row.detail)}</small>` : ''}</span></div>`;
    }
    html += '</div>';
    body.innerHTML = html;
  }
}
