// ContextWindow.js — Reusable draggable window base class

import { makeDraggable } from './draggable.js';
import { pushEscHandler } from './esc-stack.js';

const registry = new Map(); // id -> ContextWindow instance
let zCounter = 600;
// One esc-stack slot shared by all context windows: claimed when the first
// window opens, released when the last closes. Esc closes the topmost
// (highest-z) window, so focus order — not open order — decides among them.
let escUnsub = null;

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

    // World-space anchor: if set, window tracks this position on the iso grid
    this._worldAnchor = null;   // { x, y } in world (PIXI) coordinates
    this._tileAnchor = null;    // { col, row, screenDx, screenDy } in tile coordinates
    this._dragOffset = { x: 0, y: 0 }; // user drag offset from anchor screen pos

    this._build();
    registry.set(id, this);
    if (!escUnsub) {
      escUnsub = pushEscHandler(() => ContextWindow.closeTopmost());
    }
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

  /** Close the topmost (highest z-index) window. Returns true if a window was closed. */
  static closeTopmost() {
    if (registry.size === 0) return false;
    let topWin = null;
    let topZ = -Infinity;
    for (const win of registry.values()) {
      const z = parseInt(win._el?.style.zIndex, 10) || 0;
      if (z > topZ) { topZ = z; topWin = win; }
    }
    if (topWin) { topWin.close(); return true; }
    return false;
  }

  /** Returns true if any context windows are open. */
  static get hasOpenWindows() {
    return registry.size > 0;
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
    this._disposeDrag = makeDraggable(this._el, handle, {
      exclude: '.ctx-close',
      grabCursor: true,
      onStart: () => ({
        origLeft: parseInt(this._el.style.left, 10) || 0,
        origTop: parseInt(this._el.style.top, 10) || 0,
        origOffsetX: this._dragOffset.x,
        origOffsetY: this._dragOffset.y,
      }),
      onMove: (e, dx, dy, s) => {
        if (this._worldAnchor) {
          // Update drag offset so the window stays put relative to its anchor
          this._dragOffset.x = s.origOffsetX + dx;
          this._dragOffset.y = s.origOffsetY + dy;
        } else {
          this._el.style.left = (s.origLeft + dx) + 'px';
          this._el.style.top = (s.origTop + dy) + 'px';
        }
      },
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

  /**
   * Anchor this window to a world-space position.
   * @param {number} wx - World X coordinate
   * @param {number} wy - World Y coordinate
   */
  setWorldAnchor(wx, wy) {
    this._worldAnchor = { x: wx, y: wy };
  }

  /**
   * Anchor this window to a tile-space position with screen-pixel offsets.
   * Used by the 3D renderer to project through the camera correctly at any rotation.
   * @param {number} col - Fractional tile column (e.g. col + 0.5 for tile center)
   * @param {number} row - Fractional tile row
   * @param {number} screenDx - Screen pixel X offset from projected point
   * @param {number} screenDy - Screen pixel Y offset from projected point
   */
  setTileAnchor(col, row, screenDx = 0, screenDy = 0) {
    this._tileAnchor = { col, row, screenDx, screenDy };
  }

  /**
   * Update screen position by projecting the tile anchor through a 3D camera.
   * @param {THREE.Camera} camera
   * @param {number} screenW
   * @param {number} screenH
   * @param {Function} projectFn - (camera, wx, wy, wz, sw, sh) => { x, y }
   */
  updateScreenFromCamera(camera, screenW, screenH, projectFn) {
    if (!this._tileAnchor || !this._el) return;
    const { col, row, screenDx, screenDy } = this._tileAnchor;
    // Tile coordinates to 3D world: tile (col, row) → world (col*2, 0, row*2)
    const screen = projectFn(camera, col * 2, 0, row * 2, screenW, screenH);
    const sx = screen.x + screenDx + this._dragOffset.x;
    const sy = screen.y + screenDy + this._dragOffset.y;
    this._el.style.left = sx + 'px';
    this._el.style.top = sy + 'px';
  }

  /**
   * Update the window's screen position from its world anchor.
   * Call each frame with the current camera transform.
   * @param {number} worldX - world container screen X (renderer.world.x)
   * @param {number} worldY - world container screen Y (renderer.world.y)
   * @param {number} zoom   - current zoom level
   */
  updateScreenPosition(worldX, worldY, zoom) {
    if (!this._worldAnchor || !this._el) return;
    const sx = this._worldAnchor.x * zoom + worldX + this._dragOffset.x;
    const sy = this._worldAnchor.y * zoom + worldY + this._dragOffset.y;
    this._el.style.left = sx + 'px';
    this._el.style.top = sy + 'px';
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
    if (this._disposeDrag) {
      this._disposeDrag();
      this._disposeDrag = null;
    }
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    registry.delete(this.id);
    if (registry.size === 0 && escUnsub) {
      escUnsub();
      escUnsub = null;
    }
  }
}
