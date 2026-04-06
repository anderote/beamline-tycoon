// === BEAMLINE TYCOON: PIXI.JS RENDERER ===

// Determine which mode a category belongs to
function getModeForCategory(catKey) {
  for (const [modeKey, mode] of Object.entries(MODES)) {
    if (mode.categories[catKey]) return modeKey;
  }
  return null;
}

// Check if a category is a facility category (equipment placed on grid, not beamline)
function isFacilityCategory(catKey) {
  return getModeForCategory(catKey) === 'facility';
}

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
    this._onInfraSelect = null; // callback for infrastructure tool selection
    this.activeMode = 'beamline';
    this._onFacilitySelect = null;
    this._onConnSelect = null;
    this.selectedToolType = null; // current component type for preview
    this.bulldozerMode = false;
    this.infraLayer = null;
    this.dragPreviewLayer = null;
    this.facilityLayer = null;
    this.connectionLayer = null;
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

    this.infraLayer = new PIXI.Container();
    this.infraLayer.zIndex = 0.5;
    this.world.addChild(this.infraLayer);

    this.zoneLayer = new PIXI.Container();
    this.zoneLayer.zIndex = 0.55;
    this.world.addChild(this.zoneLayer);

    this.dragPreviewLayer = new PIXI.Container();
    this.dragPreviewLayer.zIndex = 0.6;
    this.world.addChild(this.dragPreviewLayer);

    this.facilityLayer = new PIXI.Container();
    this.facilityLayer.zIndex = 1.5;
    this.facilityLayer.sortableChildren = true;
    this.world.addChild(this.facilityLayer);

    this.connectionLayer = new PIXI.Container();
    this.connectionLayer.zIndex = 0.7;
    this.world.addChild(this.connectionLayer);

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
          this._renderInfrastructure();
          this._renderZones();
          this._renderPlots();
          this._renderFacilityEquipment();
          this._renderConnections();
          break;
        case 'infrastructureChanged':
          this._renderInfrastructure();
          break;
        case 'zonesChanged':
          this._renderZones();
          break;
        case 'facilityChanged':
          this._renderFacilityEquipment();
          break;
        case 'connectionsChanged':
          this._renderConnections();
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
    this._generateCategoryTabs();
    this._renderResearchOverlay();
    this._renderGoalsOverlay();
    this._renderInfrastructure();
    this._renderFacilityEquipment();
    this._renderConnections();
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
      g.stroke({ color: 0x4444aa, width: 1, alpha: 0.2 });

      // Row lines
      const rStart = gridToIso(-range, i);
      const rEnd = gridToIso(range, i);
      g.moveTo(rStart.x, rStart.y);
      g.lineTo(rEnd.x, rEnd.y);
      g.stroke({ color: 0x4444aa, width: 1, alpha: 0.2 });
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
      const texture = this.sprites.getTexture(spriteKey);
      if (!texture) continue;

      // Draw one sprite per occupied tile
      const tiles = node.tiles || [{ col: node.col, row: node.row }];
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.7);
        const pos = tileCenterIso(tile.col, tile.row);
        sprite.x = pos.x;
        sprite.y = pos.y;
        sprite.zIndex = tile.col + tile.row;
        this.componentLayer.addChild(sprite);
        if (i === 0) this.nodeSprites[node.id] = sprite;
      }

      const center = this._nodeCenter(node);

      // Add label at mid/close zoom (at center tile)
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

      // Check for missing utility connections
      node._missingConn = null;
      if (comp.category === 'rf') {
        if (!this.game.hasValidConnection(node, 'rfWaveguide')) {
          node._missingConn = 'rfWaveguide';
        }
      }

      // Warning indicator for missing connections
      if (node._missingConn) {
        const warn = new PIXI.Text({
          text: '!',
          style: { fontFamily: 'monospace', fontSize: 14, fill: 0xff4444, fontWeight: 'bold' },
        });
        warn.anchor.set(0.5, 1);
        warn.x = center.x + 10;
        warn.y = center.y - 10;
        warn.zIndex = node.col + node.row + 0.2;
        this.componentLayer.addChild(warn);
      }
    }
  }

  // --- Beam rendering ---

  _renderBeam() {
    this.beamLayer.removeChildren();

    if (!this.game.state.beamOn) return;

    const nodes = this.game.beamline.getAllNodes();
    if (nodes.length < 2) return;

    const g = new PIXI.Graphics();
    const nodeById = {};
    for (const n of nodes) nodeById[n.id] = n;

    // Draw beam along parent-child edges
    for (const node of nodes) {
      if (node.parentId == null) continue;
      const parent = nodeById[node.parentId];
      if (!parent) continue;

      const from = this._nodeCenter(parent);
      const to = this._nodeCenter(node);

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

    if (this.bulldozerMode) {
      // Show red X at hover position
      this._drawBulldozerCursor(this.hoverCol, this.hoverRow);
      return;
    }

    if (!this.buildMode) return;

    const nodes = this.game.beamline.getAllNodes();

    if (nodes.length === 0) {
      // Draw hover cursor showing full footprint of selected tool
      const comp = this.selectedToolType ? COMPONENTS[this.selectedToolType] : null;
      const trackLength = comp ? (comp.trackLength || 1) : 1;
      const trackWidth = comp ? (comp.trackWidth || 1) : 1;
      const dir = DIR.NE;
      const delta = DIR_DELTA[dir];
      const perpDelta = DIR_DELTA[turnLeft(dir)];
      const widthOffsets = [];
      for (let j = 0; j < trackWidth; j++) {
        widthOffsets.push(j - (trackWidth - 1) / 2);
      }
      for (let i = 0; i < trackLength; i++) {
        for (const wOff of widthOffsets) {
          this._drawDiamond(
            this.hoverCol + delta.dc * i + perpDelta.dc * wOff,
            this.hoverRow + delta.dr * i + perpDelta.dr * wOff,
            0x4488ff, 0.6
          );
        }
      }
      return;
    }

    // Draw cursors at build positions, highlight the one under the mouse
    const cursors = this.game.beamline.getBuildCursors();
    for (const cursor of cursors) {
      const isHovered = cursor.col === this.hoverCol && cursor.row === this.hoverRow;
      this._drawCursorMarker(cursor, isHovered);
    }
  }

  _drawDiamond(col, row, color, alpha) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(col, row);
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

  _drawBulldozerCursor(col, row) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Check if there's something to demolish here
    const key = col + ',' + row;
    const node = this.game.beamline.getNodeAt(col, row);
    const hasInfra = this.game.state.infraOccupied[key];
    const hasFacility = this.game.state.facilityGrid[key];
    const hasMachine = this.game.state.machineGrid[key];
    const hasTarget = node || hasInfra || hasFacility || hasMachine;
    const color = hasTarget ? 0xff4444 : 0xff6644;
    const alpha = hasTarget ? 0.8 : 0.3;

    // Diamond outline
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: 0xff0000, alpha: hasTarget ? 0.15 : 0.05 });
    g.stroke({ color: color, width: 2, alpha: alpha });

    // X mark
    const xs = 8;
    g.moveTo(pos.x - xs, pos.y - xs * 0.5);
    g.lineTo(pos.x + xs, pos.y + xs * 0.5);
    g.stroke({ color: color, width: 2.5, alpha: alpha });
    g.moveTo(pos.x + xs, pos.y - xs * 0.5);
    g.lineTo(pos.x - xs, pos.y + xs * 0.5);
    g.stroke({ color: color, width: 2.5, alpha: alpha });

    // Label
    const label = new PIXI.Text({
      text: 'DEMOLISH',
      style: { fontFamily: 'monospace', fontSize: 8, fill: 0xff4444 },
    });
    label.anchor.set(0.5, 0);
    label.x = pos.x;
    label.y = pos.y + hh + 2;
    label.alpha = 0.7;
    this.cursorLayer.addChild(label);

    this.cursorLayer.addChild(g);
  }

  _drawCursorMarker(cursor, isHovered) {
    const g = new PIXI.Graphics();
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Dim non-hovered cursors so the active one stands out
    const baseAlpha = isHovered ? 1.0 : 0.3;

    // Compute preview tiles based on the selected tool (including width)
    const comp = this.selectedToolType ? COMPONENTS[this.selectedToolType] : null;
    const trackLength = comp ? (comp.trackLength || 1) : 1;
    const trackWidth = comp ? (comp.trackWidth || 1) : 1;

    // Calculate exit direction (dipoles bend)
    let exitDir = cursor.dir;
    if (comp && comp.isDipole && this.cursorBendDir) {
      exitDir = this.cursorBendDir === 'left' ? turnLeft(cursor.dir) : turnRight(cursor.dir);
    }

    const delta = DIR_DELTA[exitDir];
    const perpDir = turnLeft(exitDir);
    const perpDelta = DIR_DELTA[perpDir];

    // Width offsets centered on beam
    const widthOffsets = [];
    for (let j = 0; j < trackWidth; j++) {
      widthOffsets.push(j - (trackWidth - 1) / 2);
    }

    const tiles = [];
    for (let i = 0; i < trackLength; i++) {
      for (const wOff of widthOffsets) {
        tiles.push({
          col: cursor.col + delta.dc * i + perpDelta.dc * wOff,
          row: cursor.row + delta.dr * i + perpDelta.dr * wOff,
        });
      }
    }

    // Check if tiles are available (use exact fractional key check)
    const available = tiles.every(t =>
      this.game.beamline.occupied[t.col + ',' + t.row] === undefined
    );
    const color = available ? 0x4488ff : 0xff4444;

    // Draw each tile as a filled diamond
    for (const tile of tiles) {
      const pos = tileCenterIso(tile.col, tile.row);
      g.poly([
        pos.x, pos.y - hh,
        pos.x + hw, pos.y,
        pos.x, pos.y + hh,
        pos.x - hw, pos.y,
      ]);
      g.fill({ color: color, alpha: 0.15 * baseAlpha });
      g.stroke({ color: color, width: 1.5, alpha: 0.6 * baseAlpha });
    }

    // Draw dashed outline on the first tile
    const pos = tileCenterIso(cursor.col, cursor.row);
    const points = [
      { x: pos.x, y: pos.y - hh },
      { x: pos.x + hw, y: pos.y },
      { x: pos.x, y: pos.y + hh },
      { x: pos.x - hw, y: pos.y },
    ];
    for (let i = 0; i < 4; i++) {
      const from = points[i];
      const to = points[(i + 1) % 4];
      const segments = 4;
      for (let s = 0; s < segments; s += 2) {
        const t0 = s / segments;
        const t1 = (s + 1) / segments;
        g.moveTo(from.x + (to.x - from.x) * t0, from.y + (to.y - from.y) * t0);
        g.lineTo(from.x + (to.x - from.x) * t1, from.y + (to.y - from.y) * t1);
        g.stroke({ color: color, width: 1.5, alpha: 0.8 * baseAlpha });
      }
    }

    // Plus sign in center of first tile
    const ps = 6;
    g.moveTo(pos.x - ps, pos.y);
    g.lineTo(pos.x + ps, pos.y);
    g.stroke({ color: color, width: 1.5, alpha: 0.8 * baseAlpha });
    g.moveTo(pos.x, pos.y - ps);
    g.lineTo(pos.x, pos.y + ps);
    g.stroke({ color: color, width: 1.5, alpha: 0.8 * baseAlpha });

    // Direction arrow showing exit direction
    const isoDir = gridToIso(delta.dc, delta.dr);
    const lastTile = tiles[tiles.length - 1];
    const lastPos = tileCenterIso(lastTile.col, lastTile.row);
    const arrowScale = 0.35;
    const ax = lastPos.x + isoDir.x * arrowScale;
    const ay = lastPos.y + isoDir.y * arrowScale;
    g.moveTo(lastPos.x, lastPos.y);
    g.lineTo(ax, ay);
    g.stroke({ color: 0x88bbff, width: 2, alpha: 0.9 * baseAlpha });

    // Component name label (only on hovered cursor)
    if (comp && isHovered) {
      const midTile = tiles[Math.floor(tiles.length / 2)];
      const midPos = tileCenterIso(midTile.col, midTile.row);
      const label = new PIXI.Text({
        text: comp.name,
        style: { fontFamily: 'monospace', fontSize: 9, fill: color },
      });
      label.anchor.set(0.5, 0);
      label.x = midPos.x;
      label.y = midPos.y + hh + 2;
      this.cursorLayer.addChild(label);
    }

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

    const body = popup.querySelector('.popup-body');
    if (body) {
      const health = this.game.getComponentHealth(node.id);
      const healthColor = health > 60 ? '#44dd66' : health > 25 ? '#ddaa22' : '#ff4444';
      const healthClass = health < 40 ? ' low' : '';

      const row = (label, val, unit) =>
        `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${val}</span>${unit ? `<span class="stat-unit">${unit}</span>` : ''}</div>`;

      let html = '';

      // Description
      if (comp.desc) {
        html += `<div class="popup-desc">${comp.desc}</div>`;
      }

      // Fixed stats
      html += '<div class="popup-stats">';
      html += '<div class="popup-section-label">Info</div>';
      html += row('Direction', DIR_NAMES[node.dir] || '--', '');
      html += row('Energy Cost', comp.energyCost, 'E/s');
      html += row('Length', comp.length, 'm');
      html += '</div>';

      // Parameter sliders (if this component type has paramDefs)
      const paramDefs = typeof PARAM_DEFS !== 'undefined' ? PARAM_DEFS[node.type] : null;
      if (paramDefs) {
        // Initialize node.params if missing (backwards compat with old saves)
        if (!node.params) {
          node.params = {};
          for (const [k, def] of Object.entries(paramDefs)) {
            if (!def.derived) node.params[k] = def.default;
          }
        }

        html += '<div class="popup-sliders">';
        html += '<div class="popup-section-label">Parameters</div>';

        // Adjustable sliders
        for (const [key, def] of Object.entries(paramDefs)) {
          if (def.derived) continue;
          const val = node.params[key] ?? def.default;
          html += `<div class="param-slider-row">`;
          html += `<span class="param-label">${this._paramLabel(key)}</span>`;
          html += `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param="${key}">`;
          if (def.labels) {
            html += `<span class="param-value" data-param-display="${key}">${def.labels[Math.round(val)] || val}</span>`;
          } else {
            html += `<span class="param-value" data-param-display="${key}">${this._fmtParam(val)}</span>`;
          }
          html += `<span class="param-unit">${def.unit}</span>`;
          html += `</div>`;
        }

        // Derived readouts
        const derivedKeys = Object.entries(paramDefs).filter(([_, def]) => def.derived);
        if (derivedKeys.length > 0) {
          html += '<div class="popup-section-label" style="margin-top:6px">Output</div>';
          const computed = typeof computeStats !== 'undefined' ? computeStats(node.type, node.params) : null;
          for (const [key, def] of derivedKeys) {
            const val = computed ? computed[key] : (node.params[key] ?? def.default);
            html += `<div class="param-derived-row">`;
            html += `<span class="param-label">${this._paramLabel(key)}</span>`;
            html += `<span class="param-value" data-derived-display="${key}">${this._fmtParam(val)}</span>`;
            html += `<span class="param-unit">${def.unit}</span>`;
            html += `</div>`;
          }
        }

        html += '</div>';
      }

      // Health with bar
      html += `<div class="stat-row health-row${healthClass}"><span class="stat-label">Health</span><span class="stat-value">${Math.round(health)}%</span></div>`;
      html += `<div class="popup-health-bar"><div class="popup-health-fill" style="width:${health}%;background:${healthColor}"></div></div>`;

      // Actions
      const refund = Object.entries(comp.cost).map(([r, a]) => `${Math.floor(a * 0.5)} ${r}`).join(', ');
      html += '<div class="popup-actions">';
      html += `<button class="btn-danger" id="popup-remove-btn">Recycle (${refund})</button>`;
      html += '<button class="popup-probe-btn" id="popup-probe-btn">Probe</button>';
      html += '</div>';

      body.innerHTML = html;

      // Wire up slider events
      if (paramDefs) {
        this._wirePopupSliders(node, paramDefs, body);
      }

      document.getElementById('popup-remove-btn')?.addEventListener('click', () => {
        this.game.removeComponent(node.id);
        this.hidePopup();
      });

      document.getElementById('popup-probe-btn')?.addEventListener('click', () => {
        this.hidePopup();
        if (this.onProbeClick) this.onProbeClick(node);
      });
    }

    // Position near click, clamped to viewport
    popup.style.left = Math.min(screenX + 14, window.innerWidth - 340) + 'px';
    popup.style.top = Math.min(screenY + 14, window.innerHeight - 400) + 'px';
    popup.classList.remove('hidden');

    const closeBtn = popup.querySelector('.popup-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.hidePopup();
    }
  }

  _paramLabel(key) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  _fmtParam(val) {
    if (val === undefined || val === null) return '--';
    if (Math.abs(val) >= 100) return val.toFixed(0);
    if (Math.abs(val) >= 1) return val.toFixed(2);
    if (Math.abs(val) >= 0.01) return val.toFixed(3);
    return val.toExponential(2);
  }

  _wirePopupSliders(node, paramDefs, body) {
    let debounceTimer = null;

    const sliders = body.querySelectorAll('input[type="range"][data-param]');
    sliders.forEach(slider => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.param;
        const def = paramDefs[key];
        const val = parseFloat(slider.value);
        node.params[key] = val;

        // Update displayed value
        const display = body.querySelector(`[data-param-display="${key}"]`);
        if (display) {
          if (def.labels) {
            display.textContent = def.labels[Math.round(val)] || val;
          } else {
            display.textContent = this._fmtParam(val);
          }
        }

        // Debounced recalc
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // Recompute derived values
          if (typeof computeStats !== 'undefined') {
            const computed = computeStats(node.type, node.params);
            if (computed) {
              for (const [dKey, dDef] of Object.entries(paramDefs)) {
                if (!dDef.derived) continue;
                const dDisplay = body.querySelector(`[data-derived-display="${dKey}"]`);
                if (dDisplay && computed[dKey] !== undefined) {
                  dDisplay.textContent = this._fmtParam(computed[dKey]);
                  // Flash animation
                  const row = dDisplay.closest('.param-derived-row');
                  if (row) {
                    row.classList.add('flash');
                    setTimeout(() => row.classList.remove('flash'), 300);
                  }
                }
              }

              // Update node's computed stats for game engine
              if (!node.computedStats) node.computedStats = {};
              for (const [sk, sv] of Object.entries(computed)) {
                node.computedStats[sk] = sv;
              }
            }
          }

          // Trigger full beamline recalc
          this.game.recalcBeamline();
          this.game.emit('beamlineChanged');
        }, 50);
      });
    });
  }

  showFacilityPopup(equip, comp, screenX, screenY) {
    const popup = document.getElementById('component-popup');
    if (!popup) return;

    const title = popup.querySelector('.popup-title');
    if (title) title.textContent = comp.name;

    const body = popup.querySelector('.popup-body');
    if (body) {
      let html = `<div class="popup-stats">`;
      html += `<div>Type: ${comp.name}</div>`;
      html += `<div>Category: ${comp.category}</div>`;
      html += `<div>Energy Cost: ${comp.energyCost} E/s</div>`;
      html += `</div>`;
      html += `<div class="popup-actions"><button class="btn-danger" id="popup-remove-facility-btn">Remove (50% refund)</button></div>`;
      body.innerHTML = html;

      document.getElementById('popup-remove-facility-btn')?.addEventListener('click', () => {
        this.game.removeFacilityEquipment(equip.id);
        this.hidePopup();
      });
    }

    popup.style.left = Math.min(screenX + 10, window.innerWidth - 220) + 'px';
    popup.style.top = Math.min(screenY + 10, window.innerHeight - 200) + 'px';
    popup.classList.remove('hidden');

    const closeBtn = popup.querySelector('.popup-close');
    if (closeBtn) closeBtn.onclick = () => this.hidePopup();
  }

  hidePopup() {
    const popup = document.getElementById('component-popup');
    if (popup) popup.classList.add('hidden');
  }

  // --- Probe pin flags ---

  _renderProbeFlags(pins) {
    if (this._flagLayer) this._flagLayer.removeChildren();
    else {
      this._flagLayer = new PIXI.Container();
      this.app.stage.addChild(this._flagLayer);
    }
    if (!pins || pins.length === 0) return;

    const ordered = this.game.state.beamline;
    for (const pin of pins) {
      const node = ordered.find(n => n.id === pin.nodeId);
      if (!node) continue;
      const pos = tileCenterIso(node.col, node.row);

      const g = new PIXI.Graphics();
      // Flag pole
      g.moveTo(pos.x + 8, pos.y - 20);
      g.lineTo(pos.x + 8, pos.y - 4);
      g.stroke({ color: 0xaaaaaa, width: 1 });
      // Flag body
      const flagColor = parseInt(pin.color.replace('#', ''), 16);
      g.poly([
        pos.x + 8, pos.y - 20,
        pos.x + 20, pos.y - 16,
        pos.x + 8, pos.y - 12,
      ]);
      g.fill({ color: flagColor, alpha: 0.9 });

      this._flagLayer.addChild(g);
    }
  }

  // --- Infrastructure rendering ---

  _renderInfrastructure() {
    this.infraLayer.removeChildren();
    const tiles = this.game.state.infrastructure || [];
    for (const tile of tiles) {
      const infra = INFRASTRUCTURE[tile.type];
      if (!infra) continue;
      this._drawInfraTile(tile.col, tile.row, infra);
    }
  }

  _drawInfraTile(col, row, infra) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const depth = 4;

    // Top face
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: infra.topColor });

    // Left face
    g.poly([pos.x - hw, pos.y, pos.x, pos.y + hh, pos.x, pos.y + hh + depth, pos.x - hw, pos.y + depth]);
    g.fill({ color: infra.color });

    // Right face
    g.poly([pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x, pos.y + hh + depth, pos.x + hw, pos.y + depth]);
    g.fill({ color: infra.color });

    this.infraLayer.addChild(g);
  }

  // --- Zone rendering ---

  _renderZones() {
    this.zoneLayer.removeChildren();
    const zones = this.game.state.zones || [];
    const connectivity = this.game.state.zoneConnectivity || {};

    for (const tile of zones) {
      const zone = ZONES[tile.type];
      if (!zone) continue;
      const conn = connectivity[tile.type];
      const active = conn ? conn.active : false;
      this._drawZoneTile(tile.col, tile.row, zone, active);
    }

    // Draw zone labels for each zone type
    this._drawZoneLabels(zones, connectivity);
  }

  _drawZoneTile(col, row, zone, active) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    const alpha = active ? 0.4 : 0.15;

    // Top face overlay
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: zone.color, alpha });

    this.zoneLayer.addChild(g);
  }

  _drawZoneLabels(zones, connectivity) {
    // Group zone tiles by type and find center of each group
    const groups = {};
    for (const z of zones) {
      if (!groups[z.type]) groups[z.type] = [];
      groups[z.type].push(z);
    }

    for (const [type, tiles] of Object.entries(groups)) {
      const zone = ZONES[type];
      if (!zone) continue;
      const conn = connectivity[type];
      const count = conn ? conn.tileCount : tiles.length;

      // Find average position
      let avgCol = 0, avgRow = 0;
      for (const t of tiles) { avgCol += t.col; avgRow += t.row; }
      avgCol /= tiles.length;
      avgRow /= tiles.length;

      const pos = tileCenterIso(avgCol, avgRow);
      const label = new PIXI.Text({
        text: `${zone.name} (${count})`,
        style: { fontFamily: 'monospace', fontSize: 10, fill: 0xffffff, align: 'center' },
      });
      label.anchor.set(0.5, 0.5);
      label.x = pos.x;
      label.y = pos.y;
      label.alpha = conn?.active ? 0.9 : 0.4;
      this.zoneLayer.addChild(label);
    }
  }

  // --- Facility equipment rendering ---

  _renderFacilityEquipment() {
    this.facilityLayer.removeChildren();
    const equipment = this.game.state.facilityEquipment || [];
    for (const equip of equipment) {
      const comp = COMPONENTS[equip.type];
      if (!comp) continue;
      const spriteKey = comp.spriteKey || equip.type;
      const texture = this.sprites.getTexture(spriteKey);
      if (!texture) continue;

      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.7);
      const pos = tileCenterIso(equip.col, equip.row);
      sprite.x = pos.x;
      sprite.y = pos.y;
      sprite.zIndex = equip.col + equip.row;
      this.facilityLayer.addChild(sprite);

      // Label
      const label = new PIXI.Text({
        text: comp.name,
        style: { fontFamily: 'monospace', fontSize: 9, fill: 0xcccccc },
      });
      label.anchor.set(0.5, 0);
      label.x = pos.x;
      label.y = pos.y + 8;
      label.zIndex = equip.col + equip.row + 0.1;
      this.facilityLayer.addChild(label);
    }
  }

  // --- Connection rendering ---

  _renderConnections() {
    this.connectionLayer.removeChildren();
    const connections = this.game.state.connections;
    if (!connections || connections.size === 0) return;

    // Fixed draw order — each type always gets the same global offset index
    const CONN_ORDER = ['vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'powerCable', 'dataFiber'];
    const LINE_WIDTH = 2;
    const LINE_GAP = 6; // wider gap to prevent overlap

    // Global offset: each type always at the same position regardless of which
    // other types are present on this tile. Center the full set of 6 slots.
    const TOTAL_SLOTS = CONN_ORDER.length;
    const startOffset = -(TOTAL_SLOTS - 1) * LINE_GAP / 2;

    // Perpendicular offset directions for each axis.
    // E/W segments run along (16,8) — perp is (-1,2)/√5
    // N/S segments run along (16,-8) — perp is (1,2)/√5
    // Their intersection offset is (0, √5/2) per unit off.
    const INV_SQRT5 = 1 / Math.sqrt(5);
    const HALF_SQRT5 = Math.sqrt(5) / 2;
    const EW_PX = -INV_SQRT5, EW_PY = 2 * INV_SQRT5;
    const NS_PX =  INV_SQRT5, NS_PY = 2 * INV_SQRT5;

    for (let slotIdx = 0; slotIdx < CONN_ORDER.length; slotIdx++) {
      const connType = CONN_ORDER[slotIdx];
      const conn = CONNECTION_TYPES[connType];
      if (!conn) continue;

      const off = startOffset + slotIdx * LINE_GAP;

      const g = new PIXI.Graphics();

      for (const [key, typeSet] of connections) {
        if (!typeSet.has(connType)) continue;

        const [colStr, rowStr] = key.split(',');
        const col = parseInt(colStr);
        const row = parseInt(rowStr);

        const center = tileCenterIso(col, row);

        // Check 4 neighbors for same connection type
        const hasN = this._hasConnection(col, row - 1, connType);
        const hasS = this._hasConnection(col, row + 1, connType);
        const hasE = this._hasConnection(col + 1, row, connType);
        const hasW = this._hasConnection(col - 1, row, connType);

        const neighbors = [hasN, hasE, hasS, hasW];
        const count = neighbors.filter(Boolean).length;

        // Edge midpoints (unoffset)
        const midN = tileCenterIso(col, row - 0.5);
        const midS = tileCenterIso(col, row + 0.5);
        const midE = tileCenterIso(col + 0.5, row);
        const midW = tileCenterIso(col - 0.5, row);

        // Per-direction perpendicular offsets: N/S use NS perp, E/W use EW perp
        const perps = [
          { px: NS_PX, py: NS_PY },  // N
          { px: EW_PX, py: EW_PY },  // E
          { px: NS_PX, py: NS_PY },  // S
          { px: EW_PX, py: EW_PY },  // W
        ];
        const mids = [midN, midE, midS, midW];

        if (count === 0) {
          const ox = off * NS_PX, oy = off * NS_PY;
          g.circle(center.x + ox, center.y + oy, LINE_WIDTH + 1);
          g.fill({ color: conn.color, alpha: 0.8 });
        } else {
          const hasNS = hasN || hasS;
          const hasEW = hasE || hasW;

          // Center point depends on connectivity:
          // Straight runs use axis-specific perpendicular offset.
          // Corners/junctions use the geometric intersection of
          // the two offset lines: (0, off * √5/2).
          let cx, cy;
          if (hasNS && hasEW) {
            cx = center.x;
            cy = center.y + off * HALF_SQRT5;
          } else if (hasNS) {
            cx = center.x + NS_PX * off;
            cy = center.y + NS_PY * off;
          } else {
            cx = center.x + EW_PX * off;
            cy = center.y + EW_PY * off;
          }

          // Draw half-segments from center to each offset edge midpoint
          for (let i = 0; i < 4; i++) {
            if (!neighbors[i]) continue;
            const px = perps[i].px * off;
            const py = perps[i].py * off;
            g.moveTo(cx, cy);
            g.lineTo(mids[i].x + px, mids[i].y + py);
            g.stroke({ color: conn.color, width: LINE_WIDTH, alpha: 0.9 });
          }
        }
      }

      this.connectionLayer.addChild(g);
    }
  }

  _hasConnection(col, row, connType) {
    const key = col + ',' + row;
    const set = this.game.state.connections.get(key);
    return set ? set.has(connType) : false;
  }

  renderDragPreview(startCol, startRow, endCol, endRow, infraType) {
    this.dragPreviewLayer.removeChildren();
    if (startCol == null || endCol == null) return;

    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const tileCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
    const totalCost = tileCount * infra.cost;
    const canAfford = this.game.state.resources.funding >= totalCost;

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const g = new PIXI.Graphics();
        const pos = tileCenterIso(c, r);
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;

        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: canAfford ? infra.topColor : 0xcc3333, alpha: 0.5 });
        g.stroke({ color: canAfford ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });

        this.dragPreviewLayer.addChild(g);
      }
    }

    // Cost label at center of preview
    const centerCol = (minCol + maxCol) / 2;
    const centerRow = (minRow + maxRow) / 2;
    const centerPos = tileCenterIso(centerCol, centerRow);
    const label = new PIXI.Text({
      text: `$${totalCost} (${tileCount} tiles)`,
      style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
    });
    label.anchor.set(0.5, 0.5);
    label.x = centerPos.x;
    label.y = centerPos.y - 12;
    this.dragPreviewLayer.addChild(label);
  }

  clearDragPreview() {
    this.dragPreviewLayer.removeChildren();
  }

  // --- HUD updates ---

  _updateHUD() {
    const s = this.game.state;
    const res = s.resources;

    // Resources
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = typeof val === 'string' ? val : this._fmt(val);
    };
    setEl('val-funding', Math.floor(res.funding));
    setEl('val-energy', Math.floor(res.energy));
    setEl('val-reputation', Math.floor(res.reputation));
    setEl('val-data', Math.floor(res.data));

    // Beam stats (top-left panel)
    setEl('stat-beam-energy', s.beamEnergy ? s.beamEnergy.toFixed(2) : '0.0');
    setEl('stat-beam-quality', s.beamQuality ? s.beamQuality.toFixed(2) : '--');
    setEl('stat-beam-current', s.beamCurrent ? s.beamCurrent.toFixed(2) : '--');
    setEl('stat-data-rate', s.dataRate ? s.dataRate.toFixed(1) : '0');
    setEl('stat-length', s.totalLength || 0);
    setEl('stat-energy-cost', s.totalEnergyCost || 0);

    this._updateBeamButton();

    // Refresh system stats if panel is visible
    this._refreshSystemStatsValues();

    // Refresh plots if panel is open
    const plotsPanel = document.getElementById('beam-plots');
    if (plotsPanel && !plotsPanel.classList.contains('collapsed')) {
      this._renderPlots();
    }
  }

  _updateBeamButton() {
    const btn = document.getElementById('btn-toggle-beam');
    if (!btn) return;
    if (this.game.state.beamOn) {
      btn.textContent = 'Stop Beam';
      btn.classList.add('running');
    } else {
      btn.textContent = 'Start Beam';
      btn.classList.remove('running');
    }
  }

  // --- Palette rendering ---

  _generateCategoryTabs() {
    const tabsContainer = document.getElementById('category-tabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    const mode = MODES[this.activeMode];
    if (!mode || mode.disabled) return;

    const catKeys = Object.keys(mode.categories);
    catKeys.forEach((key, idx) => {
      const cat = mode.categories[key];
      const btn = document.createElement('button');
      btn.className = 'cat-tab' + (idx === 0 ? ' active' : '');
      btn.dataset.category = key;
      btn.textContent = cat.name;
      btn.addEventListener('click', () => {
        tabsContainer.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this._renderPalette(key);
        this._updateSystemStatsContent(key);
        if (this._onTabSelect) this._onTabSelect(key);
      });
      tabsContainer.appendChild(btn);
    });

    // Generate connection tool buttons (always visible)
    const connContainer = document.getElementById('connection-tools');
    if (connContainer && connContainer.children.length === 0) {
      for (const [key, conn] of Object.entries(CONNECTION_TYPES)) {
        const btn = document.createElement('button');
        btn.className = 'conn-btn';
        btn.dataset.connType = key;
        btn.textContent = conn.name;
        const hex = '#' + conn.color.toString(16).padStart(6, '0');
        btn.style.color = hex;
        btn.style.borderColor = hex;
        btn.addEventListener('click', () => {
          connContainer.querySelectorAll('.conn-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (this._onConnSelect) this._onConnSelect(key);
        });
        connContainer.appendChild(btn);
      }
    }

    // Render palette for first category in mode
    if (catKeys.length > 0) {
      this._renderPalette(catKeys[0]);
      this._updateSystemStatsContent(catKeys[0]);
    }
  }

  _renderPalette(tabCategory) {
    const palette = document.getElementById('component-palette');
    if (!palette) return;
    palette.innerHTML = '';

    const compCategory = tabCategory;

    let paletteIdx = 0;

    // Infrastructure tab uses INFRASTRUCTURE items instead of COMPONENTS
    if (compCategory === 'infrastructure') {
      for (const [key, infra] of Object.entries(INFRASTRUCTURE)) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= infra.cost;
        if (!affordable) item.classList.add('unaffordable');

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = infra.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `$${infra.cost}/tile`;
        item.appendChild(costEl);

        const descEl = document.createElement('div');
        descEl.className = 'palette-name';
        descEl.textContent = infra.isDragPlacement ? '(drag)' : '(click)';
        item.appendChild(descEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onInfraSelect) this._onInfraSelect(key);
        });

        palette.appendChild(item);
      }
      return;
    }

    // Structure mode — Flooring tab: show flooring INFRASTRUCTURE items
    if (compCategory === 'flooring') {
      const flooringKeys = ['labFloor', 'officeFloor', 'concrete', 'hallway'];
      for (const key of flooringKeys) {
        const infra = INFRASTRUCTURE[key];
        if (!infra) continue;
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= infra.cost;
        if (!affordable) item.classList.add('unaffordable');

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = infra.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `$${infra.cost}/tile`;
        item.appendChild(costEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onInfraSelect) this._onInfraSelect(key);
        });

        palette.appendChild(item);
      }
      return;
    }

    // Structure mode — Zones tab: show zone types
    if (compCategory === 'zones') {
      for (const [key, zone] of Object.entries(ZONES)) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const hex = '#' + zone.color.toString(16).padStart(6, '0');
        item.style.borderLeft = `4px solid ${hex}`;

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = zone.name;
        item.appendChild(nameEl);

        const descEl = document.createElement('div');
        descEl.className = 'palette-cost';
        descEl.textContent = `Requires: ${INFRASTRUCTURE[zone.requiredFloor]?.name || zone.requiredFloor}`;
        item.appendChild(descEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onZoneSelect) this._onZoneSelect(key);
        });

        palette.appendChild(item);
      }
      return;
    }

    // Structure mode — Demolish tab: show demolish tool
    if (compCategory === 'demolish') {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = 0;
      paletteIdx++;

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = 'Demolish Tool';
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'palette-cost';
      descEl.textContent = 'Click/drag to remove flooring & zones';
      item.appendChild(descEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(0);
        if (this._onDemolishSelect) this._onDemolishSelect();
      });

      palette.appendChild(item);
      return;
    }

    // Facility mode — show components from facility categories
    if (isFacilityCategory(compCategory)) {
      for (const [key, comp] of Object.entries(COMPONENTS)) {
        if (comp.category !== compCategory) continue;

        const unlocked = this.game.isComponentUnlocked(comp);
        if (!unlocked) continue;

        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.canAfford(comp.cost);
        if (!affordable) item.classList.add('unaffordable');

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = comp.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        const costs = Object.entries(comp.cost).map(([r, a]) => `${this._fmt(a)} ${r}`).join(', ');
        costEl.textContent = costs;
        item.appendChild(costEl);

        item.appendChild(this._createPaletteTooltip(comp, costs));

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onFacilitySelect) this._onFacilitySelect(key);
        });

        palette.appendChild(item);
      }
      return;
    }

    // Get subsection definitions from category
    const mode = MODES[this.activeMode];
    const catDef = mode?.categories?.[compCategory];
    const subsections = catDef?.subsections;

    // Collect components for this category
    const catComps = [];
    for (const [key, comp] of Object.entries(COMPONENTS)) {
      if (comp.category !== compCategory) continue;
      catComps.push({ key, comp });
    }

    if (subsections && Object.keys(subsections).length > 0) {
      // Render with subsection grouping
      const subKeys = Object.keys(subsections);
      subKeys.forEach((subKey, subIdx) => {
        const subDef = subsections[subKey];
        const subComps = catComps.filter(({ comp }) => {
          if (comp.subsection) return comp.subsection === subKey;
          return subIdx === 0; // default to first subsection
        });
        if (subComps.length === 0) return;

        // Divider between subsections (not before first)
        if (subIdx > 0) {
          const divider = document.createElement('div');
          divider.className = 'palette-subsection-divider';
          palette.appendChild(divider);
        }

        const section = document.createElement('div');
        section.className = 'palette-subsection';

        const label = document.createElement('div');
        label.className = 'palette-subsection-label';
        label.textContent = subDef.name;
        section.appendChild(label);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'palette-subsection-items';

        for (const { key, comp } of subComps) {
          const item = this._createPaletteItem(key, comp, paletteIdx);
          if (!item) continue;
          paletteIdx++;
          itemsContainer.appendChild(item);
        }

        section.appendChild(itemsContainer);
        palette.appendChild(section);
      });
    } else {
      // No subsections — flat rendering
      for (const { key, comp } of catComps) {
        const item = this._createPaletteItem(key, comp, paletteIdx);
        if (!item) continue;
        paletteIdx++;
        palette.appendChild(item);
      }
    }
  }

  _createPaletteItem(key, comp, idx) {
    const unlocked = this.game.isComponentUnlocked(comp);
    if (!unlocked) return null;

    const item = document.createElement('div');
    item.className = 'palette-item';
    item.dataset.paletteIndex = idx;

    const affordable = this.game.canAfford(comp.cost);
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
    costEl.textContent = costs;
    item.appendChild(costEl);

    item.appendChild(this._createPaletteTooltip(comp, costs));

    item.addEventListener('click', () => {
      if (this._onPaletteClick) this._onPaletteClick(idx);
      if (this._onToolSelect) this._onToolSelect(key);
    });

    return item;
  }

  _createPaletteTooltip(comp, costs) {
    const tooltip = document.createElement('div');
    tooltip.className = 'palette-tooltip';

    const ttName = document.createElement('div');
    ttName.className = 'tt-name';
    ttName.textContent = comp.name;
    tooltip.appendChild(ttName);

    const ttDesc = document.createElement('div');
    ttDesc.className = 'tt-desc';
    ttDesc.textContent = comp.desc || '';
    tooltip.appendChild(ttDesc);

    const ttStats = document.createElement('div');
    ttStats.className = 'tt-stats';

    const statEntries = [
      ['Cost', costs],
      ['Energy Cost', `${comp.energyCost} E/s`],
      ['Length', `${comp.length} m`],
    ];
    if (comp.stats) {
      for (const [k, v] of Object.entries(comp.stats)) {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        statEntries.push([label, v]);
      }
    }
    for (const [label, val] of statEntries) {
      const row = document.createElement('div');
      row.className = 'tt-stat-row';
      row.innerHTML = `<span>${label}</span><span class="tt-stat-val">${val}</span>`;
      ttStats.appendChild(row);
    }
    tooltip.appendChild(ttStats);
    return tooltip;
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

      const completed = this.game.state.completedResearch.includes(id);
      const isActive = this.game.state.activeResearch === id;
      const available = this.game.isResearchAvailable(id);

      // Hide locked research items
      if (!completed && !isActive && !available) continue;

      const item = document.createElement('div');
      item.className = 'research-item';

      if (completed) {
        item.classList.add('completed');
      } else if (isActive) {
        item.classList.add('researching');
      } else if (available) {
        item.classList.add('available');
      }

      // Name and description
      const nameEl = document.createElement('div');
      nameEl.className = 'res-name';
      nameEl.textContent = r.name + (completed ? ' [DONE]' : '');
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'res-desc';
      descEl.textContent = r.desc;
      item.appendChild(descEl);

      // Cost info
      if (!completed) {
        const costEl = document.createElement('div');
        costEl.className = 'res-cost';
        const costs = Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ');
        costEl.textContent = `Cost: ${costs} | Duration: ${r.duration}s`;
        item.appendChild(costEl);
      }

      // Progress bar for active research
      if (isActive) {
        const progressContainer = document.createElement('div');
        progressContainer.className = 'res-progress';
        const progressFill = document.createElement('div');
        progressFill.className = 'bar';
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
      item.className = 'objective-item';

      const completed = this.game.state.completedObjectives.includes(obj.id);
      if (completed) item.classList.add('completed');

      const nameEl = document.createElement('div');
      nameEl.className = 'obj-name';
      nameEl.textContent = obj.name + (completed ? ' [DONE]' : '');
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'obj-desc';
      descEl.textContent = obj.desc;
      item.appendChild(descEl);

      const rewardEl = document.createElement('div');
      rewardEl.className = 'obj-reward';
      const rewards = Object.entries(obj.reward).map(([k, v]) => `+${v} ${k}`).join(', ');
      rewardEl.textContent = `Reward: ${rewards}`;
      item.appendChild(rewardEl);

      list.appendChild(item);
    }
  }

  // --- Beam diagnostics plots ---

  _renderPlots() {
    const envelope = this.game.state.physicsEnvelope;
    if (!envelope || envelope.length === 0) {
      this._drawEmptyPlot('plot-envelope', 'No beam data');
      this._drawEmptyPlot('plot-energy', 'No beam data');
      this._drawEmptyPlot('plot-current', 'No beam data');
      return;
    }

    // Envelope plot: sigma_x and sigma_y vs element index
    this._drawLinePlot('plot-envelope', envelope, [
      { key: 'sigma_x', color: '#44aaff', label: 'sigma_x' },
      { key: 'sigma_y', color: '#ff6644', label: 'sigma_y' },
    ], { yLabel: 'mm', autoScale: true });

    // Energy plot: energy vs element index
    this._drawLinePlot('plot-energy', envelope, [
      { key: 'energy', color: '#44dd66', label: 'Energy' },
    ], { yLabel: 'GeV', autoScale: true });

    // Current plot: current vs element index
    this._drawLinePlot('plot-current', envelope, [
      { key: 'current', color: '#ddaa44', label: 'Current' },
    ], { yLabel: 'mA', autoScale: true });
  }

  _drawEmptyPlot(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(message, w / 2, h / 2);
  }

  _drawLinePlot(canvasId, data, series, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const pad = { top: 18, right: 14, bottom: 24, left: 52 };
    const pw = w - pad.left - pad.right;
    const ph = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
    ctx.fillRect(0, 0, w, h);

    if (data.length < 2) return;

    // Compute y-range across all series
    let yMin = Infinity, yMax = -Infinity;
    for (const s of series) {
      for (const d of data) {
        const v = d[s.key];
        if (v != null && isFinite(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin) || yMin === yMax) { yMin = 0; yMax = 1; }
    const yPad = (yMax - yMin) * 0.1 || 0.1;
    yMin -= yPad;
    yMax += yPad;
    if (yMin < 0 && data.every(d => series.every(s => (d[s.key] || 0) >= 0))) yMin = 0;

    const n = data.length;

    // Grid lines
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.3)';
    ctx.lineWidth = 0.5;
    const nGridY = 4;
    for (let i = 0; i <= nGridY; i++) {
      const y = pad.top + ph - (i / nGridY) * ph;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + pw, y);
      ctx.stroke();

      // Y-axis labels
      const val = yMin + (i / nGridY) * (yMax - yMin);
      ctx.fillStyle = 'rgba(120, 120, 160, 0.7)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toPrecision(3), pad.left - 4, y + 4);
    }

    // Axes
    ctx.strokeStyle = 'rgba(80, 80, 130, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + ph);
    ctx.lineTo(pad.left + pw, pad.top + ph);
    ctx.stroke();

    // Draw each series
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = data[i][s.key];
        if (v == null || !isFinite(v)) continue;
        const x = pad.left + (i / (n - 1)) * pw;
        const y = pad.top + ph - ((v - yMin) / (yMax - yMin)) * ph;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Legend
    ctx.font = '10px monospace';
    let lx = pad.left + 6;
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, pad.top - 12, 10, 8);
      ctx.fillStyle = 'rgba(180, 180, 220, 0.8)';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 14, pad.top - 5);
      lx += ctx.measureText(s.label).width + 30;
    }

    // X-axis label
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('element index', pad.left + pw / 2, h - 5);

    // Y-axis label
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(10, pad.top + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }
  }

  // --- HUD event bindings ---

  _bindHUDEvents() {
    // Mode switcher
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (MODES[mode]?.disabled) return;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeMode = mode;
        this._generateCategoryTabs();
        this._updateSystemStatsVisibility();
      });
    });

    // Category tab clicks
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const category = tab.dataset.category;
        this._renderPalette(category);
        if (this._onTabSelect) this._onTabSelect(category);
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

    // System stats panel toggle
    const sysStatsPanel = document.getElementById('system-stats-panel');
    const sysStatsHeader = document.getElementById('system-stats-header');
    const sysStatsToggle = document.getElementById('system-stats-toggle');
    if (sysStatsPanel && sysStatsHeader && sysStatsToggle) {
      sysStatsHeader.addEventListener('click', () => {
        sysStatsPanel.classList.toggle('expanded');
        sysStatsToggle.textContent = sysStatsPanel.classList.contains('expanded') ? '-' : '+';
      });
    }

    // Beam plots toggle
    const plotsPanel = document.getElementById('beam-plots');
    const plotsToggle = document.getElementById('beam-plots-toggle');
    const plotsHeader = document.getElementById('beam-plots-header');
    if (plotsPanel && plotsToggle && plotsHeader) {
      plotsHeader.addEventListener('click', () => {
        plotsPanel.classList.toggle('collapsed');
        plotsToggle.textContent = plotsPanel.classList.contains('collapsed') ? '+' : '-';
        if (!plotsPanel.classList.contains('collapsed')) {
          this._renderPlots();
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
    if (this.bulldozerMode || this.buildMode) {
      this._renderCursors();
    }
  }

  setBuildMode(active, toolType) {
    this.buildMode = active;
    this.selectedToolType = toolType || null;
    if (active) this.bulldozerMode = false;
    this._renderCursors();
  }

  setBulldozerMode(active) {
    this.bulldozerMode = active;
    if (active) {
      this.buildMode = false;
      this.selectedToolType = null;
    }
    this._renderCursors();
    this.app.canvas.style.cursor = active ? 'crosshair' : '';
  }

  updateCursorBendDir(dir) {
    this.cursorBendDir = dir;
  }

  // --- System Stats Panel ---

  _updateSystemStatsVisibility() {
    const panel = document.getElementById('system-stats-panel');
    if (!panel) return;
    if (this.activeMode === 'facility') {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  _updateSystemStatsContent(category) {
    this._activeStatsCategory = category;
    const panel = document.getElementById('system-stats-panel');
    if (!panel || panel.classList.contains('hidden')) return;

    // Map category key to system stats key and display name
    const catMap = {
      vacuum:       { key: 'vacuum',       name: 'VACUUM' },
      cryo:         { key: 'cryo',         name: 'CRYO' },
      rfPower:      { key: 'rfPower',      name: 'RF POWER' },
      cooling:      { key: 'cooling',      name: 'COOLING' },
      power:        { key: 'power',        name: 'POWER' },
      dataControls: { key: 'dataControls', name: 'DATA/CTRL' },
      safety:       { key: 'dataControls', name: 'SAFETY' },
    };

    const mapped = catMap[category];
    if (!mapped) return;

    const title = document.getElementById('system-stats-title');
    if (title) {
      title.textContent = mapped.name;
      // Set color from category
      const cat = MODES.facility?.categories[category];
      if (cat) title.style.color = cat.color;
    }

    this._activeStatsKey = mapped.key;
    this._refreshSystemStatsValues();
  }

  _refreshSystemStatsValues() {
    const panel = document.getElementById('system-stats-panel');
    if (!panel || panel.classList.contains('hidden')) return;

    const stats = this.game.state.systemStats;
    if (!stats) return;

    const key = this._activeStatsKey;
    if (!key || !stats[key]) return;

    const data = stats[key];
    const summary = document.getElementById('system-stats-summary');
    const detail = document.getElementById('system-stats-detail');
    if (!summary || !detail) return;

    // Build summary and detail based on which system
    switch (key) {
      case 'vacuum':
        this._renderVacuumStats(data, summary, detail);
        break;
      case 'rfPower':
        this._renderRfPowerStats(data, summary, detail);
        break;
      case 'cryo':
        this._renderCryoStats(data, summary, detail);
        break;
      case 'cooling':
        this._renderCoolingStats(data, summary, detail);
        break;
      case 'power':
        this._renderPowerStats(data, summary, detail);
        break;
      case 'dataControls':
        this._renderDataControlsStats(data, summary, detail);
        break;
    }
  }

  _sstat(label, value, unit, quality) {
    const cls = quality ? ` ${quality}` : '';
    return `<span class="sstat"><span class="sstat-label">${label}</span><span class="sstat-val${cls}">${value}</span><span class="sstat-unit">${unit}</span></span>`;
  }

  _ssep() { return '<span class="sstat-sep">|</span>'; }

  _detailRow(label, value, unit) {
    return `<div class="sstat-detail-row"><span class="sstat-detail-label">${label}</span><span class="sstat-detail-val">${value}</span><span class="sstat-detail-unit">${unit || ''}</span></div>`;
  }

  _fmtPressure(p) {
    if (p >= 1) return p.toFixed(0);
    const exp = Math.floor(Math.log10(p));
    const mantissa = p / Math.pow(10, exp);
    return `${mantissa.toFixed(1)}×10${this._superscript(exp)}`;
  }

  _superscript(n) {
    const sup = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
    return String(n).split('').map(c => sup[c] || c).join('');
  }

  _qualityColor(q) {
    if (q === 'Excellent' || q === 'Good') return 'good';
    if (q === 'Marginal') return 'warn';
    if (q === 'Poor') return 'bad';
    return '';
  }

  _marginColor(m) {
    if (m > 30) return 'good';
    if (m > 10) return 'warn';
    return 'bad';
  }

  _renderVacuumStats(d, summary, detail) {
    const pq = this._qualityColor(d.pressureQuality);
    summary.innerHTML = [
      this._sstat('Pressure', this._fmtPressure(d.avgPressure), 'mbar', pq),
      this._ssep(),
      this._sstat('Pump Spd', this._fmt(d.totalPumpSpeed), 'L/s'),
      this._ssep(),
      this._sstat('Volume', this._fmt(d.beamlineVolume), 'L'),
      this._ssep(),
      this._sstat('Pumps', d.pumpCount, ''),
      this._ssep(),
      this._sstat('Gauges', d.gaugeCount, ''),
      this._ssep(),
      this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
      this._ssep(),
      this._sstat('Quality', d.pressureQuality, '', pq),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('Roughing Pumps', dd.roughingPumps)}
      ${this._detailRow('Turbo Pumps', dd.turboPumps)}
      ${this._detailRow('Ion Pumps', dd.ionPumps)}
      ${this._detailRow('NEG Pumps', dd.negPumps)}
      ${this._detailRow('Ti-Sub Pumps', dd.tiSubPumps)}
      ${this._detailRow('Gate Valves', dd.gateValves)}
      ${this._detailRow('Pirani Gauges', dd.piraniGauges)}
      ${this._detailRow('CC Gauges', dd.ccGauges)}
      ${this._detailRow('BA Gauges', dd.baGauges)}
      ${this._detailRow('Bakeout Systems', dd.bakeoutSystems)}
    </div>`;
  }

  _renderRfPowerStats(d, summary, detail) {
    summary.innerHTML = [
      this._sstat('Fwd', this._fmt(d.totalFwdPower), 'kW'),
      this._ssep(),
      this._sstat('Refl', this._fmt(d.totalReflPower), 'kW'),
      this._ssep(),
      this._sstat('Wall', this._fmt(d.wallPower), 'kW'),
      this._ssep(),
      this._sstat('VSWR', d.vswr, ''),
      this._ssep(),
      this._sstat('Sources', d.sourceCount, ''),
      this._ssep(),
      this._sstat('Eff', d.avgEfficiency.toFixed(0), '%'),
      this._ssep(),
      this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('Klystrons', dd.klystrons)}
      ${this._detailRow('SSAs', dd.ssas)}
      ${this._detailRow('IOTs', dd.iots)}
      ${this._detailRow('Magnetrons', dd.magnetrons)}
      ${this._detailRow('Modulators', dd.modulators)}
      ${this._detailRow('Circulators', dd.circulators)}
      ${this._detailRow('Waveguides', dd.waveguides)}
      ${this._detailRow('LLRF Controllers', dd.llrfControllers)}
      ${this._detailRow('Master Oscillators', dd.masterOscillators)}
      ${this._detailRow('Vector Modulators', dd.vectorModulators)}
    </div>`;
  }

  _renderCryoStats(d, summary, detail) {
    const mc = d.coolingCapacity > 0 ? this._marginColor(d.margin) : '';
    summary.innerHTML = [
      this._sstat('Capacity', this._fmt(d.coolingCapacity), 'W'),
      this._ssep(),
      this._sstat('Load', this._fmt(d.heatLoad), 'W'),
      this._ssep(),
      this._sstat('Temp', d.opTemp > 0 ? d.opTemp.toFixed(1) : '--', 'K'),
      this._ssep(),
      this._sstat('Wall Pwr', d.wallPower.toFixed(1), 'kW'),
      this._ssep(),
      this._sstat('Margin', d.coolingCapacity > 0 ? d.margin.toFixed(0) : '--', '%', mc),
      this._ssep(),
      this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('He Compressors', dd.compressors)}
      ${this._detailRow('Cold Box 4K', dd.coldBox4K)}
      ${this._detailRow('Sub-Cooling 2K', dd.subCooling2K)}
      ${this._detailRow('Cryo Housings', dd.cryoHousings)}
      ${this._detailRow('LN2 Pre-coolers', dd.ln2Precoolers)}
      ${this._detailRow('He Recovery', dd.heRecovery > 0 ? 'Yes' : 'No')}
      ${this._detailRow('Cryocoolers', dd.cryocoolers)}
      ${this._detailRow('Static Load', dd.staticLoad.toFixed(1), 'W')}
      ${this._detailRow('Dynamic Load', dd.dynamicLoad.toFixed(1), 'W')}
    </div>`;
  }

  _renderCoolingStats(d, summary, detail) {
    const mc = d.coolingCapacity > 0 ? this._marginColor(d.margin) : '';
    summary.innerHTML = [
      this._sstat('Capacity', this._fmt(d.coolingCapacity), 'kW'),
      this._ssep(),
      this._sstat('Load', d.heatLoad.toFixed(1), 'kW'),
      this._ssep(),
      this._sstat('Flow', this._fmt(Math.round(d.flowRate)), 'L/min'),
      this._ssep(),
      this._sstat('Margin', d.coolingCapacity > 0 ? d.margin.toFixed(0) : '--', '%', mc),
      this._ssep(),
      this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('LCW Skids', dd.lcwSkids)}
      ${this._detailRow('Chillers', dd.chillers)}
      ${this._detailRow('Cooling Towers', dd.coolingTowers)}
      ${this._detailRow('Heat Exchangers', dd.heatExchangers)}
      ${this._detailRow('Water Loads', dd.waterLoads)}
      ${this._detailRow('Deionizer', dd.deionizers > 0 ? 'Yes' : 'No')}
      ${this._detailRow('Emergency Cooling', dd.emergencyCooling > 0 ? 'Yes' : 'No')}
    </div>`;
  }

  _renderPowerStats(d, summary, detail) {
    const uc = d.utilization > 90 ? 'bad' : (d.utilization > 70 ? 'warn' : 'good');
    summary.innerHTML = [
      this._sstat('Capacity', this._fmt(d.capacity), 'kW'),
      this._ssep(),
      this._sstat('Draw', d.totalDraw.toFixed(1), 'kW'),
      this._ssep(),
      this._sstat('Util', d.utilization.toFixed(0), '%', uc),
      this._ssep(),
      this._sstat('Substations', d.substations, ''),
      this._ssep(),
      this._sstat('Panels', d.panels, ''),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('Beamline Draw', dd.beamlineDraw.toFixed(1), 'kW')}
      ${this._detailRow('Vacuum Draw', dd.vacuumDraw.toFixed(1), 'kW')}
      ${this._detailRow('RF Draw', dd.rfDraw.toFixed(1), 'kW')}
      ${this._detailRow('Cryo Draw', dd.cryoDraw.toFixed(1), 'kW')}
      ${this._detailRow('Cooling Draw', dd.coolingDraw.toFixed(1), 'kW')}
    </div>`;
  }

  _renderDataControlsStats(d, summary, detail) {
    const mpsColor = d.mpsStatus === 'Active' ? 'good' : '';
    summary.innerHTML = [
      this._sstat('IOCs', d.iocs, ''),
      this._ssep(),
      this._sstat('Interlocks', d.interlocks, ''),
      this._ssep(),
      this._sstat('Monitors', d.monitors, ''),
      this._ssep(),
      this._sstat('Timing', d.timingSystems, ''),
      this._ssep(),
      this._sstat('MPS', d.mpsStatus, '', mpsColor),
      this._ssep(),
      this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('Rack/IOCs', dd.rackIocs)}
      ${this._detailRow('PPS Interlocks', dd.ppsInterlocks)}
      ${this._detailRow('Rad Monitors', dd.radiationMonitors)}
      ${this._detailRow('Timing Systems', dd.timingSystems)}
      ${this._detailRow('MPS Units', dd.mps)}
      ${this._detailRow('Laser Systems', dd.laserSystems)}
    </div>`;
  }

  // --- Helpers ---

  _nodeCenter(node) {
    if (!node.tiles || node.tiles.length === 0) {
      return tileCenterIso(node.col, node.row);
    }
    const mid = Math.floor(node.tiles.length / 2);
    const tile = node.tiles[mid];
    return tileCenterIso(tile.col, tile.row);
  }

  _fmt(n) {
    if (n === undefined || n === null) return '0';
    if (typeof n !== 'number') return String(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toString();
  }
}
