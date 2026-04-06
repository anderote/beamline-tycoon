// === BEAMLINE TYCOON: PIXI.JS RENDERER ===

// Map HTML tab data-category values to COMPONENTS category field values
const CATEGORY_MAP = {
  'sources': 'source',
  'magnets': 'magnet',
  'rf-accel': 'rf',
  'diagnostics': 'diagnostic',
  'beam-optics': 'special',
};

class Renderer {
  constructor(game, spriteManager) {
    this.game = game;
    this.sprites = spriteManager;
    this.app = null;
    this.world = null;
    this.gridLayer = null;
    this.componentLayer = null;
    this.beamLayer = null;
    this.cursorLayer = null;
    this.zoom = 1;
    this.buildMode = false;
    this.hoverCol = 0;
    this.hoverRow = 0;
    this.nodeSprites = {};
    this.beamTime = 0;
    this.cursorBendDir = 'right';
    this._onToolSelect = null;  // callback set by main.js
  }

  async init() {
    // 1. Create PIXI application
    this.app = new PIXI.Application();
    await this.app.init({
      resizeTo: window,
      backgroundColor: 0x1a1a2e,
      antialias: false,
      resolution: 1,
    });

    // 2. Prepend canvas to #game div
    const gameDiv = document.getElementById('game');
    gameDiv.prepend(this.app.canvas);

    // 3. Create world container
    this.world = new PIXI.Container();
    this.world.x = this.app.screen.width / 2;
    this.world.y = this.app.screen.height / 3;
    this.app.stage.addChild(this.world);

    // 4. Create layers with z-ordering
    this.gridLayer = new PIXI.Container();
    this.gridLayer.zIndex = 0;
    this.world.addChild(this.gridLayer);

    this.beamLayer = new PIXI.Container();
    this.beamLayer.zIndex = 1;
    this.world.addChild(this.beamLayer);

    this.componentLayer = new PIXI.Container();
    this.componentLayer.zIndex = 2;
    this.componentLayer.sortableChildren = true;
    this.world.addChild(this.componentLayer);

    this.cursorLayer = new PIXI.Container();
    this.cursorLayer.zIndex = 3;
    this.world.addChild(this.cursorLayer);

    this.world.sortableChildren = true;

    // 5. Generate placeholder sprites
    this.sprites.generatePlaceholders(this.app);

    // 6. Draw isometric grid
    this._drawGrid();

    // 7. Ticker for animation
    this.app.ticker.add((ticker) => {
      this.beamTime += ticker.deltaTime * 0.02;
    });

    // 8. Listen to game events
    this.game.on((event, data) => {
      switch (event) {
        case 'beamlineChanged':
        case 'loaded':
          this._renderComponents();
          this._renderBeam();
          this._renderCursors();
          break;
        case 'beamToggled':
          this._renderBeam();
          this._updateBeamButton();
          break;
        case 'tick':
          this._updateHUD();
          break;
        case 'researchChanged':
          this._renderResearchOverlay();
          break;
        case 'objectiveCompleted':
          this._renderGoalsOverlay();
          break;
      }
    });

    // 9. Bind DOM HUD events
    this._bindHUDEvents();

    // 10. Initial renders
    this._renderPalette('sources');
    this._renderResearchOverlay();
    this._renderGoalsOverlay();
    this._updateHUD();
  }

  // --- Coordinate conversion ---

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.world.x) / this.zoom,
      y: (screenY - this.world.y) / this.zoom,
    };
  }

  // --- Camera controls ---

  zoomAt(screenX, screenY, delta) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(0.2, Math.min(3, this.zoom + delta));

    // Zoom toward cursor position
    const worldX = screenX - this.world.x;
    const worldY = screenY - this.world.y;
    const scale = this.zoom / oldZoom;
    this.world.x = screenX - worldX * scale;
    this.world.y = screenY - worldY * scale;

    this.world.scale.set(this.zoom);

    // Re-render components for LOD
    this._renderComponents();
  }

  panBy(dx, dy) {
    this.world.x -= dx;
    this.world.y -= dy;
  }

  // --- Grid rendering ---

  _drawGrid() {
    const g = new PIXI.Graphics();
    const range = 30;

    for (let i = -range; i <= range; i++) {
      // Column lines
      const start = gridToIso(i, -range);
      const end = gridToIso(i, range);
      g.moveTo(start.x, start.y);
      g.lineTo(end.x, end.y);
      g.stroke({ color: 0x000000, width: 1, alpha: 0.15 });

      // Row lines
      const rStart = gridToIso(-range, i);
      const rEnd = gridToIso(range, i);
      g.moveTo(rStart.x, rStart.y);
      g.lineTo(rEnd.x, rEnd.y);
      g.stroke({ color: 0x000000, width: 1, alpha: 0.15 });
    }

    this.gridLayer.addChild(g);
  }

  // --- Component rendering ---

  _renderComponents() {
    this.componentLayer.removeChildren();
    this.nodeSprites = {};

    const nodes = this.game.beamline.getAllNodes();
    for (const node of nodes) {
      const comp = COMPONENTS[node.type];
      if (!comp) continue;

      const spriteKey = comp.spriteKey || node.type;
      const texture = this.sprites.getTexture(spriteKey, this.zoom);
      if (!texture) continue;

      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.7);

      // Position at center tile
      const center = this._nodeCenter(node);
      sprite.x = center.x;
      sprite.y = center.y;

      // Depth sort
      sprite.zIndex = node.col + node.row;

      this.componentLayer.addChild(sprite);
      this.nodeSprites[node.id] = sprite;

      // Add label at mid/close zoom
      if (this.zoom >= 0.7) {
        const label = new PIXI.Text({
          text: comp.name,
          style: {
            fontFamily: 'monospace',
            fontSize: 10,
            fill: 0xffffff,
          },
        });
        label.anchor.set(0.5, 0);
        label.x = center.x;
        label.y = center.y + 8;
        label.zIndex = node.col + node.row + 0.1;
        this.componentLayer.addChild(label);
      }
    }
  }

  // --- Beam rendering ---

  _renderBeam() {
    this.beamLayer.removeChildren();

    if (!this.game.state.beamOn) return;

    const ordered = this.game.beamline.getOrderedComponents();
    if (ordered.length < 2) return;

    const g = new PIXI.Graphics();

    for (let i = 0; i < ordered.length - 1; i++) {
      const from = this._nodeCenter(ordered[i]);
      const to = this._nodeCenter(ordered[i + 1]);

      // Outer glow
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.stroke({ color: 0x00ff00, width: 3, alpha: 0.6 });

      // Bright core
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.stroke({ color: 0xaaffaa, width: 1.5, alpha: 0.9 });
    }

    this.beamLayer.addChild(g);
  }

  // --- Cursor rendering ---

  _renderCursors() {
    this.cursorLayer.removeChildren();

    if (!this.buildMode) return;

    const nodes = this.game.beamline.getAllNodes();

    if (nodes.length === 0) {
      // Draw hover cursor (diamond at hover position)
      this._drawDiamond(this.hoverCol, this.hoverRow, 0x4488ff, 0.6);
      return;
    }

    // Draw cursors at build positions
    const cursors = this.game.beamline.getBuildCursors();
    for (const cursor of cursors) {
      this._drawCursorMarker(cursor);
    }
  }

  _drawDiamond(col, row, color, alpha) {
    const g = new PIXI.Graphics();
    const pos = gridToIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    g.poly([
      pos.x, pos.y - hh,
      pos.x + hw, pos.y,
      pos.x, pos.y + hh,
      pos.x - hw, pos.y,
    ]);
    g.stroke({ color: color, width: 2, alpha: alpha });

    this.cursorLayer.addChild(g);
  }

  _drawCursorMarker(cursor) {
    const g = new PIXI.Graphics();
    const pos = gridToIso(cursor.col, cursor.row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Dashed diamond outline
    const points = [
      { x: pos.x, y: pos.y - hh },
      { x: pos.x + hw, y: pos.y },
      { x: pos.x, y: pos.y + hh },
      { x: pos.x - hw, y: pos.y },
    ];

    // Draw dashed edges
    for (let i = 0; i < 4; i++) {
      const from = points[i];
      const to = points[(i + 1) % 4];
      const segments = 4;
      for (let s = 0; s < segments; s += 2) {
        const t0 = s / segments;
        const t1 = (s + 1) / segments;
        const x0 = from.x + (to.x - from.x) * t0;
        const y0 = from.y + (to.y - from.y) * t0;
        const x1 = from.x + (to.x - from.x) * t1;
        const y1 = from.y + (to.y - from.y) * t1;
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke({ color: 0x4488ff, width: 1.5, alpha: 0.8 });
      }
    }

    // Plus sign in center
    const ps = 6;
    g.moveTo(pos.x - ps, pos.y);
    g.lineTo(pos.x + ps, pos.y);
    g.stroke({ color: 0x4488ff, width: 1.5, alpha: 0.8 });
    g.moveTo(pos.x, pos.y - ps);
    g.lineTo(pos.x, pos.y + ps);
    g.stroke({ color: 0x4488ff, width: 1.5, alpha: 0.8 });

    // Direction arrow
    const dirDelta = DIR_DELTA[cursor.dir];
    const arrowLen = 10;
    const ax = pos.x + dirDelta.dc * arrowLen;
    const ay = pos.y + dirDelta.dr * arrowLen;
    g.moveTo(pos.x, pos.y);
    g.lineTo(ax, ay);
    g.stroke({ color: 0x88bbff, width: 2, alpha: 0.9 });

    this.cursorLayer.addChild(g);
  }

  // --- Popup ---

  showPopup(node, screenX, screenY) {
    const popup = document.getElementById('component-popup');
    if (!popup) return;

    const comp = COMPONENTS[node.type];
    if (!comp) return;

    const title = popup.querySelector('.popup-title');
    if (title) title.textContent = comp.name;

    const stats = popup.querySelector('.popup-stats');
    if (stats) {
      const health = this.game.getComponentHealth(node.id);
      let html = `<div>Type: ${comp.name}</div>`;
      html += `<div>Direction: ${DIR_NAMES[node.dir] || '--'}</div>`;
      html += `<div>Energy Cost: ${comp.energyCost} E/s</div>`;
      html += `<div>Length: ${comp.length} m</div>`;
      html += `<div>Health: ${Math.round(health)}%</div>`;
      if (comp.stats) {
        for (const [k, v] of Object.entries(comp.stats)) {
          html += `<div>${k}: ${v}</div>`;
        }
      }
      stats.innerHTML = html;
    }

    const actions = popup.querySelector('.popup-actions');
    if (actions) {
      actions.innerHTML = '';
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove (50% refund)';
      removeBtn.className = 'popup-remove-btn';
      removeBtn.addEventListener('click', () => {
        this.game.removeComponent(node.id);
        this.hidePopup();
      });
      actions.appendChild(removeBtn);
    }

    // Position near click, clamped to viewport
    popup.style.left = Math.min(screenX + 10, window.innerWidth - 220) + 'px';
    popup.style.top = Math.min(screenY + 10, window.innerHeight - 200) + 'px';
    popup.classList.remove('hidden');

    // Close button
    const closeBtn = popup.querySelector('.popup-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.hidePopup();
    }
  }

  hidePopup() {
    const popup = document.getElementById('component-popup');
    if (popup) popup.classList.add('hidden');
  }

  // --- HUD updates ---

  _updateHUD() {
    const s = this.game.state;
    const res = s.resources;

    // Resources
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = this._fmt(val);
    };
    setEl('val-funding', Math.floor(res.funding));
    setEl('val-energy', Math.floor(res.energy));
    setEl('val-reputation', Math.floor(res.reputation));
    setEl('val-data', Math.floor(res.data));

    // Beam stats
    setEl('stat-beam-energy', s.beamEnergy ? s.beamEnergy.toFixed(2) : '0.0');
    setEl('stat-beam-quality', s.beamQuality ? s.beamQuality.toFixed(2) : '--');
    setEl('stat-beam-current', s.beamCurrent ? s.beamCurrent.toFixed(2) : '--');
    setEl('stat-data-rate', s.dataRate ? s.dataRate.toFixed(1) : '0');
    setEl('stat-length', s.totalLength || 0);
    setEl('stat-energy-cost', s.totalEnergyCost || 0);

    this._updateBeamButton();
  }

  _updateBeamButton() {
    const btn = document.getElementById('btn-toggle-beam');
    if (!btn) return;
    if (this.game.state.beamOn) {
      btn.textContent = 'Stop Beam';
      btn.classList.add('beam-on');
      btn.classList.remove('beam-off');
    } else {
      btn.textContent = 'Start Beam';
      btn.classList.remove('beam-on');
      btn.classList.add('beam-off');
    }
  }

  // --- Palette rendering ---

  _renderPalette(tabCategory) {
    const palette = document.getElementById('component-palette');
    if (!palette) return;
    palette.innerHTML = '';

    // Map tab category name to component category field
    const compCategory = CATEGORY_MAP[tabCategory] || tabCategory;

    for (const [key, comp] of Object.entries(COMPONENTS)) {
      if (comp.category !== compCategory) continue;

      const item = document.createElement('div');
      item.className = 'palette-item';

      const unlocked = this.game.isComponentUnlocked(comp);
      const affordable = this.game.canAfford(comp.cost);

      if (!unlocked) item.classList.add('locked');
      if (!affordable) item.classList.add('unaffordable');

      // Name
      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = comp.name;
      item.appendChild(nameEl);

      // Cost
      const costEl = document.createElement('div');
      costEl.className = 'palette-cost';
      const costs = Object.entries(comp.cost).map(([r, a]) => `${this._fmt(a)} ${r}`).join(', ');
      costEl.textContent = unlocked ? costs : 'Locked';
      item.appendChild(costEl);

      if (unlocked) {
        item.addEventListener('click', () => {
          if (this._onToolSelect) {
            this._onToolSelect(key);
          }
        });
      }

      palette.appendChild(item);
    }
  }

  updatePalette(category) {
    this._renderPalette(category);
  }

  // --- Research overlay ---

  _renderResearchOverlay() {
    const list = document.getElementById('research-list');
    if (!list) return;
    list.innerHTML = '';

    for (const [id, r] of Object.entries(RESEARCH)) {
      if (r.hidden) continue;

      const item = document.createElement('div');
      item.className = 'research-item';

      const completed = this.game.state.completedResearch.includes(id);
      const isActive = this.game.state.activeResearch === id;
      const available = this.game.isResearchAvailable(id);

      if (completed) {
        item.classList.add('completed');
      } else if (isActive) {
        item.classList.add('active');
      } else if (available) {
        item.classList.add('available');
      } else {
        item.classList.add('locked');
      }

      // Name and description
      const nameEl = document.createElement('div');
      nameEl.className = 'research-name';
      nameEl.textContent = r.name + (completed ? ' [DONE]' : '');
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'research-desc';
      descEl.textContent = r.desc;
      item.appendChild(descEl);

      // Cost info
      if (!completed) {
        const costEl = document.createElement('div');
        costEl.className = 'research-cost';
        const costs = Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ');
        costEl.textContent = `Cost: ${costs} | Duration: ${r.duration}s`;
        item.appendChild(costEl);
      }

      // Progress bar for active research
      if (isActive) {
        const progressContainer = document.createElement('div');
        progressContainer.className = 'research-progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'research-progress-fill';
        const pct = Math.min(100, (this.game.state.researchProgress / r.duration) * 100);
        progressFill.style.width = pct + '%';
        progressContainer.appendChild(progressFill);
        item.appendChild(progressContainer);
      }

      // Click to start
      if (available && !completed && !isActive) {
        item.addEventListener('click', () => {
          this.game.startResearch(id);
        });
        item.style.cursor = 'pointer';
      }

      list.appendChild(item);
    }
  }

  // --- Goals overlay ---

  _renderGoalsOverlay() {
    const list = document.getElementById('goals-list');
    if (!list) return;
    list.innerHTML = '';

    for (const obj of OBJECTIVES) {
      const item = document.createElement('div');
      item.className = 'goal-item';

      const completed = this.game.state.completedObjectives.includes(obj.id);
      if (completed) item.classList.add('completed');

      const nameEl = document.createElement('div');
      nameEl.className = 'goal-name';
      nameEl.textContent = obj.name + (completed ? ' [DONE]' : '');
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'goal-desc';
      descEl.textContent = obj.desc;
      item.appendChild(descEl);

      const rewardEl = document.createElement('div');
      rewardEl.className = 'goal-reward';
      const rewards = Object.entries(obj.reward).map(([k, v]) => `+${v} ${k}`).join(', ');
      rewardEl.textContent = `Reward: ${rewards}`;
      item.appendChild(rewardEl);

      list.appendChild(item);
    }
  }

  // --- HUD event bindings ---

  _bindHUDEvents() {
    // Category tab clicks
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const category = tab.dataset.category;
        this._renderPalette(category);
      });
    });

    // Beam toggle button
    const beamBtn = document.getElementById('btn-toggle-beam');
    if (beamBtn) {
      beamBtn.addEventListener('click', () => this.game.toggleBeam());
    }

    // Research button
    const resBtn = document.getElementById('btn-research');
    if (resBtn) {
      resBtn.addEventListener('click', () => {
        const overlay = document.getElementById('research-overlay');
        if (overlay) {
          overlay.classList.toggle('hidden');
          if (!overlay.classList.contains('hidden')) {
            this._renderResearchOverlay();
          }
        }
      });
    }

    // Goals button
    const goalsBtn = document.getElementById('btn-goals');
    if (goalsBtn) {
      goalsBtn.addEventListener('click', () => {
        const overlay = document.getElementById('goals-overlay');
        if (overlay) {
          overlay.classList.toggle('hidden');
          if (!overlay.classList.contains('hidden')) {
            this._renderGoalsOverlay();
          }
        }
      });
    }

    // Overlay close buttons
    document.querySelectorAll('.overlay-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlayId = btn.dataset.close;
        if (overlayId) {
          const overlay = document.getElementById(overlayId);
          if (overlay) overlay.classList.add('hidden');
        }
      });
    });
  }

  // --- State setters ---

  updateHover(col, row) {
    this.hoverCol = col;
    this.hoverRow = row;
    if (this.buildMode && this.game.beamline.getAllNodes().length === 0) {
      this._renderCursors();
    }
  }

  setBuildMode(active) {
    this.buildMode = active;
    this._renderCursors();
  }

  updateCursorBendDir(dir) {
    this.cursorBendDir = dir;
  }

  // --- Helpers ---

  _nodeCenter(node) {
    if (!node.tiles || node.tiles.length === 0) {
      return gridToIso(node.col, node.row);
    }
    const mid = Math.floor(node.tiles.length / 2);
    const tile = node.tiles[mid];
    return gridToIso(tile.col, tile.row);
  }

  _fmt(n) {
    if (n === undefined || n === null) return '0';
    if (typeof n !== 'number') return String(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toString();
  }
}
