// ContextWindow.js — Reusable draggable window base class

const registry = new Map(); // id -> ContextWindow instance
let zCounter = 600;

export class ContextWindow {
  /**
   * @param {object} opts
   * @param {string} opts.id            - Unique window identifier (prevents duplicates)
   * @param {string} opts.title         - Window title text
   * @param {string} [opts.icon]        - Icon character/emoji shown before title
   * @param {string} [opts.accentColor] - CSS color for title bar gradient accent
   * @param {Array}  [opts.tabs]        - Array of { key, label } tab descriptors
   * @param {Function} [opts.onClose]   - Callback invoked when window is closed
   */
  constructor({ id, title, icon = '', accentColor = '#226', tabs = [], onClose } = {}) {
    if (registry.has(id)) {
      // Bring existing window to front instead of creating a duplicate
      registry.get(id).focus();
      return registry.get(id);
    }

    this.id = id;
    this._title = title;
    this._icon = icon;
    this._accentColor = accentColor;
    this._tabs = tabs;
    this._onClose = onClose;
    this._activeTab = tabs.length > 0 ? tabs[0].key : null;
    this._tabRenderers = new Map(); // key -> fn(container)
    this._actions = [];

    this._build();
    registry.set(id, this);
  }

  // ---------------------------------------------------------------------------
  // Static API
  // ---------------------------------------------------------------------------

  /** Return the ContextWindow instance for the given id, or undefined. */
  static getWindow(id) {
    return registry.get(id);
  }

  /** Close all open context windows. */
  static closeAll() {
    for (const win of [...registry.values()]) {
      win.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Build DOM
  // ---------------------------------------------------------------------------

  _build() {
    const container = document.getElementById('context-windows-container');
    if (!container) {
      console.warn('ContextWindow: #context-windows-container not found in DOM');
      return;
    }

    const el = document.createElement('div');
    el.className = 'ctx-window';
    el.style.left = '200px';
    el.style.top = '100px';
    el.style.zIndex = ++zCounter;
    el.dataset.ctxId = this.id;

    // Title bar
    const titlebar = document.createElement('div');
    titlebar.className = 'ctx-titlebar';
    titlebar.style.background = this._gradientStyle();

    const titleSpan = document.createElement('span');
    titleSpan.className = 'ctx-title';
    titleSpan.textContent = (this._icon ? this._icon + ' ' : '') + this._title;

    const titleRight = document.createElement('div');
    titleRight.className = 'ctx-title-right';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'ctx-status';

    const closeBtn = document.createElement('span');
    closeBtn.className = 'ctx-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    titleRight.appendChild(statusSpan);
    titleRight.appendChild(closeBtn);
    titlebar.appendChild(titleSpan);
    titlebar.appendChild(titleRight);

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'ctx-tabs';
    if (this._tabs.length === 0) tabBar.style.display = 'none';
    this._tabs.forEach(({ key, label }) => {
      const tab = document.createElement('div');
      tab.className = 'ctx-tab' + (key === this._activeTab ? ' active' : '');
      tab.dataset.tab = key;
      tab.textContent = label;
      tab.addEventListener('click', () => this.switchTab(key));
      tabBar.appendChild(tab);
    });

    // Body
    const body = document.createElement('div');
    body.className = 'ctx-body';

    // Actions
    const actions = document.createElement('div');
    actions.className = 'ctx-actions';

    el.appendChild(titlebar);
    el.appendChild(tabBar);
    el.appendChild(body);
    el.appendChild(actions);
    container.appendChild(el);

    // Store refs
    this._el = el;
    this._titleSpan = titleSpan;
    this._statusSpan = statusSpan;
    this._tabBar = tabBar;
    this._body = body;
    this._actionsEl = actions;

    // Drag behaviour
    this._initDrag(titlebar);

    // Focus on click anywhere in window
    el.addEventListener('mousedown', () => this.focus(), true);

    // Initial render
    this._renderBody();
    this._renderActions();
  }

  _gradientStyle() {
    const accent = this._accentColor || '#226';
    return `linear-gradient(90deg, ${accent}cc 0%, #111122 100%)`;
  }

  // ---------------------------------------------------------------------------
  // Drag
  // ---------------------------------------------------------------------------

  _initDrag(handle) {
    let dragging = false;
    let startX, startY, origLeft, origTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('ctx-close')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseInt(this._el.style.left, 10) || 0;
      origTop = parseInt(this._el.style.top, 10) || 0;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this._el.style.left = (origLeft + e.clientX - startX) + 'px';
      this._el.style.top = (origTop + e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        handle.style.cursor = 'grab';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  _renderBody() {
    if (!this._body) return;
    this._body.innerHTML = '';
    if (this._activeTab && this._tabRenderers.has(this._activeTab)) {
      this._tabRenderers.get(this._activeTab)(this._body);
    }
  }

  _renderActions() {
    if (!this._actionsEl) return;
    this._actionsEl.innerHTML = '';
    this._actions.forEach(({ label, style, onClick }) => {
      const btn = document.createElement('button');
      btn.className = 'ctx-action-btn';
      btn.textContent = label;
      if (style) btn.setAttribute('style', style);
      btn.addEventListener('click', onClick);
      this._actionsEl.appendChild(btn);
    });
    this._actionsEl.style.display = this._actions.length === 0 ? 'none' : 'flex';
  }

  // ---------------------------------------------------------------------------
  // Instance API
  // ---------------------------------------------------------------------------

  /** Set the status indicator text and color. */
  setStatus(text, color = '#4af') {
    if (!this._statusSpan) return;
    this._statusSpan.textContent = text ? '● ' + text : '';
    this._statusSpan.style.color = color;
  }

  /** Update the window title. */
  setTitle(title) {
    this._title = title;
    if (this._titleSpan) {
      this._titleSpan.textContent = (this._icon ? this._icon + ' ' : '') + title;
    }
  }

  /** Switch to the tab with the given key. */
  switchTab(key) {
    if (!this._tabs.find(t => t.key === key)) return;
    this._activeTab = key;

    // Update tab classes
    this._tabBar.querySelectorAll('.ctx-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === key);
    });

    this._renderBody();
  }

  /**
   * Register a render function for a tab.
   * @param {string} key   - Tab key
   * @param {Function} fn  - fn(containerElement) — renders content into container
   */
  onTabRender(key, fn) {
    this._tabRenderers.set(key, fn);
    // Re-render if this is the active tab
    if (key === this._activeTab) this._renderBody();
  }

  /**
   * Set action buttons.
   * @param {Array} actions - Array of { label, style, onClick }
   */
  setActions(actions) {
    this._actions = actions || [];
    this._renderActions();
  }

  /** Re-render the active tab content. */
  update() {
    this._renderBody();
  }

  /** Bring this window to the front. */
  focus() {
    if (this._el) this._el.style.zIndex = ++zCounter;
  }

  /** Close and remove this window. */
  close() {
    if (this._onClose) {
      try { this._onClose(); } catch (e) { /* ignore */ }
    }
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    registry.delete(this.id);
  }
}
