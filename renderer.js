// === BEAMLINE TYCOON: PIXI.JS RENDERER ===

// Darken a hex color by a factor (0–1)
function _darkenPort(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

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
    this.networkOverlayLayer = null;
    this.networkPanel = null;
    this.activeNetworkType = null;

    // Tech tree pan/zoom state
    this._treePanX = 0;
    this._treePanY = 0;
    this._treeZoom = 1;
    this._treeDragging = false;
    this._treeDragStartX = 0;
    this._treeDragStartY = 0;
    this._treeLayout = null;
    this._treeCanvasWidth = 0;
    this._treeCanvasHeight = 0;
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

    this.infraSidesLayer = new PIXI.Container();
    this.infraSidesLayer.zIndex = -0.1;
    this.world.addChild(this.infraSidesLayer);

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

    this.labelLayer = new PIXI.Container();
    this.labelLayer.zIndex = 4;
    this.world.addChild(this.labelLayer);

    this.cursorLayer = new PIXI.Container();
    this.cursorLayer.zIndex = 3;
    this.world.addChild(this.cursorLayer);

    this.networkOverlayLayer = new PIXI.Container();
    this.networkOverlayLayer.sortableChildren = true;
    this.networkOverlayLayer.zIndex = 5000;
    this.world.addChild(this.networkOverlayLayer);

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
          this._renderComponents(); // recheck connection warnings
          break;
        case 'connectionsChanged':
          this._renderConnections();
          this._renderComponents(); // recheck connection warnings
          break;
        case 'beamToggled':
          this._renderBeam();
          this._updateBeamButton();
          break;
        case 'tick':
          this._updateHUD();
          this._updateTreeProgress();
          break;
        case 'researchChanged':
          this._renderTechTree();
          break;
        case 'objectiveCompleted':
          this._renderGoalsOverlay();
          break;
      }
    });

    // 9. Bind DOM HUD events
    this._bindHUDEvents();
    this._bindTreeEvents();

    // 10. Initial renders
    this._generateCategoryTabs();
    this._renderTechTree();
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

  // Determine which connection types a beamline component requires
  _getRequiredConnections(comp) {
    const required = [];
    for (const [connType, connDef] of Object.entries(CONNECTION_TYPES)) {
      const vt = connDef.validTargets;
      if (vt === 'any') continue;
      const catMatch = vt.categoryMatch && vt.categoryMatch.includes(comp.category);
      const idMatch = vt.idMatch && vt.idMatch.includes(comp.id);
      if (catMatch || idMatch) required.push(connType);
    }
    return required;
  }

  _renderComponents() {
    this.componentLayer.removeChildren();
    this.labelLayer.removeChildren();
    this.nodeSprites = {};

    const nodes = this.game.beamline.getAllNodes();

    // Auto-name: count instances of each component type in placement order
    const typeCounts = {};
    const typeTotals = {};
    for (const node of nodes) typeTotals[node.type] = (typeTotals[node.type] || 0) + 1;

    const nodeNames = {};
    for (const node of nodes) {
      const comp = COMPONENTS[node.type];
      if (!comp) continue;
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
      nodeNames[node.id] = typeTotals[node.type] > 1
        ? `${comp.name} #${typeCounts[node.type]}`
        : comp.name;
    }

    const warnings = [];

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
      const displayName = nodeNames[node.id] || comp.name;

      // Add label at mid/close zoom (at center tile)
      if (this.zoom >= 0.7) {
        const label = new PIXI.Text({
          text: displayName,
          style: {
            fontFamily: 'monospace',
            fontSize: 10,
            fill: 0xffffff,
          },
        });
        const firstTile = tiles[0];
        const topLeft = tileCenterIso(firstTile.col, firstTile.row);
        label.anchor.set(0, 1);
        label.x = topLeft.x;
        label.y = topLeft.y - 12;
        this.labelLayer.addChild(label);
      }

      // Check for missing utility connections
      const required = this._getRequiredConnections(comp);
      const missing = [];
      for (const connType of required) {
        if (!this.game.hasValidConnection(node, connType)) {
          missing.push(connType);
        }
      }

      // Warning indicator for missing connections
      if (missing.length > 0) {
        const warn = new PIXI.Text({
          text: '!',
          style: { fontFamily: 'monospace', fontSize: 14, fill: 0xff4444, fontWeight: 'bold' },
        });
        warn.anchor.set(0.5, 1);
        warn.x = center.x + 10;
        warn.y = center.y - 10;
        warn.zIndex = 9999;
        this.labelLayer.addChild(warn);

        for (const connType of missing) {
          warnings.push({ name: displayName, connType });
        }
      }

      // Port dots for required connections (perpendicular to beam, one per side)
      if (this.zoom >= 0.7 && required.length > 0) {
        const PORT_RADIUS = 1.5;
        const CONN_ORDER = ['vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'powerCable', 'dataFiber'];
        const PORT_GAP = 6;
        const TOTAL_SLOTS = CONN_ORDER.length;
        const startOff = -(TOTAL_SLOTS - 1) * PORT_GAP / 2;

        const INV_SQRT5 = 1 / Math.sqrt(5);
        const NS_PX = INV_SQRT5, NS_PY = 2 * INV_SQRT5;
        const EW_PX = -INV_SQRT5, EW_PY = 2 * INV_SQRT5;

        const beamDir = node.entryDir != null ? node.entryDir : (node.dir != null ? node.dir : 0);
        const leftDir = turnLeft(beamDir);
        const rightDir = turnRight(beamDir);
        const leftDelta = DIR_DELTA[leftDir];
        const rightDelta = DIR_DELTA[rightDir];

        // Use center tile for port placement
        const midIdx = Math.floor(tiles.length / 2);
        const portTile = tiles[midIdx];

        // Edge midpoints in perpendicular directions
        const leftMid = tileCenterIso(
          portTile.col + leftDelta.dc * 0.5,
          portTile.row + leftDelta.dr * 0.5
        );
        const rightMid = tileCenterIso(
          portTile.col + rightDelta.dc * 0.5,
          portTile.row + rightDelta.dr * 0.5
        );

        // Perp offset direction depends on grid axis of each side
        const leftPerp = leftDelta.dc !== 0
          ? { px: EW_PX, py: EW_PY }
          : { px: NS_PX, py: NS_PY };
        const rightPerp = rightDelta.dc !== 0
          ? { px: EW_PX, py: EW_PY }
          : { px: NS_PX, py: NS_PY };

        const missingSet = new Set(missing);
        const portG = new PIXI.Graphics();

        for (const connType of required) {
          const slotIdx = CONN_ORDER.indexOf(connType);
          if (slotIdx < 0) continue;
          const conn = CONNECTION_TYPES[connType];
          if (!conn) continue;

          const off = startOff + slotIdx * PORT_GAP;
          const connected = !missingSet.has(connType);
          const color = connected ? conn.color : _darkenPort(conn.color, 0.5);
          const alpha = connected ? 0.9 : 0.6;

          // Left side port
          portG.circle(
            leftMid.x + leftPerp.px * off,
            leftMid.y + leftPerp.py * off,
            PORT_RADIUS
          );
          portG.fill({ color, alpha });

          // Right side port
          portG.circle(
            rightMid.x + rightPerp.px * off,
            rightMid.y + rightPerp.py * off,
            PORT_RADIUS
          );
          portG.fill({ color, alpha });
        }

        portG.zIndex = 9998;
        this.componentLayer.addChild(portG);
      }
    }

    this._updateWarningsPanel(warnings);
  }

  _updateWarningsPanel(warnings) {
    const panel = document.getElementById('beamline-warnings');
    if (!panel) return;
    if (warnings.length === 0) { panel.innerHTML = ''; return; }

    // Group by connection type
    const byType = {};
    for (const w of warnings) {
      if (!byType[w.connType]) byType[w.connType] = [];
      byType[w.connType].push(w.name);
    }

    const lines = [];
    for (const [connType, names] of Object.entries(byType)) {
      const connName = CONNECTION_TYPES[connType]?.name || connType;
      const nameStr = names.length <= 3
        ? names.join(', ')
        : names.slice(0, 3).join(', ') + ` +${names.length - 3} more`;
      lines.push(`<div class="bl-warn">No ${connName}: <span class="warn-name">${nameStr}</span></div>`);
    }
    panel.innerHTML = lines.join('');
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

      // Parameter dropdowns (if component has paramOptions)
      if (comp.paramOptions) {
        if (!node.params) node.params = {};
        html += '<div class="popup-sliders">';
        html += '<div class="popup-section-label">Configuration</div>';
        for (const [key, options] of Object.entries(comp.paramOptions)) {
          const current = node.params[key] ?? comp.params?.[key] ?? options[0];
          html += `<div class="param-slider-row">`;
          html += `<span class="param-label">${this._paramLabel(key)}</span>`;
          html += `<select data-param-option="${key}" class="param-select">`;
          for (const opt of options) {
            const sel = opt === current ? ' selected' : '';
            html += `<option value="${opt}"${sel}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`;
          }
          html += `</select>`;
          html += `</div>`;
        }
        html += '</div>';
      }

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

      // Wire up dropdown events
      body.querySelectorAll('select[data-param-option]').forEach(sel => {
        sel.addEventListener('change', () => {
          const key = sel.dataset.paramOption;
          if (!node.params) node.params = {};
          node.params[key] = sel.value;
          this.game.recalcBeamline();
        });
      });

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

  showNetworkOverlay(equipId) {
    this.clearNetworkOverlay();

    const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
    if (!equip) return;

    // Get the connection type this equipment produces/provides
    const connType = this.game._getEquipmentConnectionType(equip.type);
    if (!connType || !this.game.state.networkData) return;

    // Find which network this equipment belongs to
    const networks = this.game.state.networkData[connType] || [];
    let targetNet = null;
    for (const net of networks) {
      if (net.equipment.some(e => e.id === equipId)) {
        targetNet = net;
        break;
      }
    }
    if (!targetNet) return;

    this.activeNetworkType = connType;
    const connColor = CONNECTION_TYPES[connType]?.color || 0xffffff;

    // Highlight network tiles with semi-transparent overlay
    for (const tile of targetNet.tiles) {
      const pos = tileCenterIso(tile.col, tile.row);
      const highlight = new PIXI.Graphics();
      highlight.rect(pos.x - TILE_W / 2, pos.y - TILE_H / 2, TILE_W, TILE_H);
      highlight.fill({ color: connColor, alpha: 0.3 });
      this.networkOverlayLayer.addChild(highlight);
    }

    // Highlight connected beamline components in yellow
    for (const node of targetNet.beamlineNodes) {
      const tiles = node.tiles || [{ col: node.col, row: node.row }];
      for (const tile of tiles) {
        const pos = tileCenterIso(tile.col, tile.row);
        const highlight = new PIXI.Graphics();
        highlight.rect(pos.x - TILE_W / 2, pos.y - TILE_H / 2, TILE_W, TILE_H);
        highlight.fill({ color: 0xffff00, alpha: 0.2 });
        this.networkOverlayLayer.addChild(highlight);
      }
    }

    // Highlight connected equipment with stronger overlay
    for (const eq of targetNet.equipment) {
      const pos = tileCenterIso(eq.col, eq.row);
      const highlight = new PIXI.Graphics();
      highlight.rect(pos.x - TILE_W / 2, pos.y - TILE_H / 2, TILE_W, TILE_H);
      highlight.fill({ color: connColor, alpha: 0.4 });
      this.networkOverlayLayer.addChild(highlight);
    }

    // Show stats panel
    this._showNetworkPanel(connType, targetNet);
  }

  clearNetworkOverlay() {
    if (this.networkOverlayLayer) this.networkOverlayLayer.removeChildren();
    if (this.networkPanel) {
      this.networkPanel.remove();
      this.networkPanel = null;
    }
    this.activeNetworkType = null;
  }

  _showNetworkPanel(connType, network) {
    if (this.networkPanel) this.networkPanel.remove();

    const panel = document.createElement('div');
    panel.id = 'network-panel';
    panel.style.cssText = 'position:fixed;top:80px;right:16px;width:280px;background:rgba(0,0,0,0.85);color:#eee;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;z-index:10000;border:1px solid rgba(255,255,255,0.2);';

    const title = CONNECTION_TYPES[connType]?.name || connType;
    let html = `<div style="font-size:14px;font-weight:bold;margin-bottom:8px">${title} Network</div>`;

    if (connType === 'powerCable' && typeof Networks !== 'undefined') {
      const stats = Networks.validatePowerNetwork(network);
      const util = stats.capacity > 0 ? (stats.draw / stats.capacity * 100).toFixed(0) : 0;
      const color = stats.ok ? '#4c4' : '#f44';
      html += `<div>Capacity: ${stats.capacity} kW</div>`;
      html += `<div>Draw: ${stats.draw} kW</div>`;
      html += `<div>Utilization: ${util}%</div>`;
      html += `<div style="color:${color}">Status: ${stats.ok ? 'OK' : 'OVERLOADED'}</div>`;
      html += `<div style="margin-top:6px;font-size:11px">Substations: ${stats.substations.length}</div>`;
      html += `<div style="font-size:11px">Consumers: ${stats.consumers.length}</div>`;
    } else if (connType === 'rfWaveguide' && typeof Networks !== 'undefined') {
      const stats = Networks.validateRfNetwork(network);
      const freq = stats.sources.length > 0 ? stats.sources[0].frequency : '—';
      html += `<div>Frequency: ${freq === 'broadband' ? 'Broadband' : freq + ' MHz'}</div>`;
      html += `<div>Forward Power: ${stats.forwardPower} kW</div>`;
      html += `<div>Reflected: ${stats.reflectedPower.toFixed(1)} kW</div>`;
      html += `<div>Sources: ${stats.sources.length} | Cavities: ${stats.cavities.length}</div>`;
      if (stats.missingModulator) html += `<div style="color:#f44">Missing modulator!</div>`;
      if (!stats.frequencyMatch) html += `<div style="color:#f44">Frequency mismatch!</div>`;
      html += `<div>Circulator: ${stats.hasCirculator ? 'Yes' : 'No'}</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'ISSUES'}</div>`;
    } else if (connType === 'coolingWater' && typeof Networks !== 'undefined') {
      const stats = Networks.validateCoolingNetwork(network);
      html += `<div>Capacity: ${stats.capacity} kW</div>`;
      html += `<div>Heat Load: ${stats.heatLoad.toFixed(1)} kW</div>`;
      html += `<div>Margin: ${stats.margin.toFixed(0)}%</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'OVERLOADED'}</div>`;
    } else if (connType === 'cryoTransfer' && typeof Networks !== 'undefined') {
      const stats = Networks.validateCryoNetwork(network);
      html += `<div>Capacity: ${stats.capacity} W</div>`;
      html += `<div>Heat Load: ${stats.heatLoad} W</div>`;
      html += `<div>Op Temp: ${stats.opTemp > 0 ? stats.opTemp + ' K' : 'N/A'}</div>`;
      html += `<div>Compressor: ${stats.hasCompressor ? 'Yes' : 'No'}</div>`;
      html += `<div>Margin: ${stats.margin.toFixed(0)}%</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'ISSUES'}</div>`;
    } else if (connType === 'vacuumPipe' && typeof Networks !== 'undefined') {
      const stats = Networks.validateVacuumNetwork(network, this.game.state.beamline);
      html += `<div>Eff. Pump Speed: ${stats.effectivePumpSpeed.toFixed(1)} L/s</div>`;
      html += `<div>Pressure: ${stats.avgPressure === Infinity ? '—' : stats.avgPressure.toExponential(1)} mbar</div>`;
      html += `<div>Quality: ${stats.pressureQuality}</div>`;
      html += `<div>Pumps: ${stats.pumps.length}</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'POOR'}</div>`;
    } else if (connType === 'dataFiber') {
      const hasIoc = network.equipment.some(eq => eq.type === 'rackIoc');
      html += `<div>Rack/IOC: ${hasIoc ? 'Connected' : 'None'}</div>`;
      html += `<div>Diagnostics: ${network.beamlineNodes.length}</div>`;
      html += `<div style="color:${hasIoc ? '#4c4' : '#f44'}">Status: ${hasIoc ? 'OK' : 'NO IOC'}</div>`;
    }

    html += `<div style="margin-top:8px;font-size:10px;color:#888">Click elsewhere or Esc to close</div>`;
    panel.innerHTML = html;
    document.body.appendChild(panel);
    this.networkPanel = panel;
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
    this.infraSidesLayer.removeChildren();
    const tiles = this.game.state.infrastructure || [];
    // Build a lookup set for occupied positions
    const occupied = new Set();
    for (const tile of tiles) occupied.add(`${tile.col},${tile.row}`);
    // Sort by isometric depth so front tiles overlap back tiles
    const sorted = [...tiles].sort((a, b) => (a.col + a.row) - (b.col + b.row));
    for (const tile of sorted) {
      const infra = INFRASTRUCTURE[tile.type];
      if (!infra) continue;
      const hasRight = occupied.has(`${tile.col + 1},${tile.row}`);
      const hasBelow = occupied.has(`${tile.col},${tile.row + 1}`);
      this._drawInfraTile(tile.col, tile.row, infra, hasRight, hasBelow);
    }
  }

  _drawInfraTile(col, row, infra, hasRight, hasBelow) {
    const pos = tileCenterIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const depth = 6;

    // Side faces — drawn below the grid layer so grid lines appear on top
    if (!hasRight || !hasBelow) {
      const sides = new PIXI.Graphics();
      if (!hasRight) {
        sides.poly([pos.x, pos.y + hh, pos.x + hw, pos.y, pos.x + hw, pos.y + depth, pos.x, pos.y + hh + depth]);
        sides.fill({ color: infra.color });
      }
      if (!hasBelow) {
        sides.poly([pos.x - hw, pos.y, pos.x, pos.y + hh, pos.x, pos.y + hh + depth, pos.x - hw, pos.y + depth]);
        sides.fill({ color: infra.color });
      }
      this.infraSidesLayer.addChild(sides);
    }

    // Top face — use sprite if available, otherwise colored polygon
    const texture = this.sprites.getTileTexture(infra.id);
    if (texture) {
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.5);
      sprite.x = pos.x;
      sprite.y = pos.y;
      // Scale proportionally so the sprite's width matches the tile diamond width
      const scale = TILE_W / texture.width;
      sprite.scale.set(scale, scale);
      this.infraLayer.addChild(sprite);
    } else {
      const top = new PIXI.Graphics();
      top.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
      top.fill({ color: infra.topColor });
      this.infraLayer.addChild(top);
    }
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
    const pos = tileCenterIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // Draw the zone's required floor type as the base (into infraLayer so it's beneath everything)
    const floorId = zone.requiredFloor;
    const floorTexture = floorId ? this.sprites.getTileTexture(floorId) : null;
    if (floorTexture) {
      const fs = new PIXI.Sprite(floorTexture);
      fs.anchor.set(0.5, 0.5);
      fs.x = pos.x;
      fs.y = pos.y;
      const fScale = TILE_W / floorTexture.width;
      fs.scale.set(fScale, fScale);
      this.infraLayer.addChild(fs);
    } else if (floorId) {
      const floorInfo = INFRASTRUCTURE[floorId];
      if (floorInfo) {
        const g = new PIXI.Graphics();
        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: floorInfo.topColor });
        this.infraLayer.addChild(g);
      }
    }

    // Sparse furniture: deterministic hash to place zone sprite on ~1 in 4 tiles
    const hash = ((col * 7 + row * 13 + col * row * 3) & 0xffff) % 3;
    if (hash === 0) {
      const texture = this.sprites.getTileTexture(zone.id);
      if (texture) {
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = pos.x;
        sprite.y = pos.y;
        const scale = TILE_W / texture.width;
        sprite.scale.set(scale, scale);
        sprite.alpha = active ? 0.9 : 0.7;
        this.zoneLayer.addChild(sprite);
      }
    }

    // Tint overlay to show zone boundary
    const g = new PIXI.Graphics();
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: zone.color, alpha: active ? 0.15 : 0.07 });
    this.zoneLayer.addChild(g);
  }

  _drawZoneLabels(zones, connectivity) {
    // Build a lookup of tile positions by type
    const tilesByType = {};
    for (const z of zones) {
      if (!tilesByType[z.type]) tilesByType[z.type] = [];
      tilesByType[z.type].push(z);
    }

    for (const [type, tiles] of Object.entries(tilesByType)) {
      const zone = ZONES[type];
      if (!zone) continue;
      const conn = connectivity[type];
      const totalCount = conn ? conn.tileCount : tiles.length;

      // Flood-fill to find contiguous groups
      const tileSet = new Set(tiles.map(t => t.col + ',' + t.row));
      const visited = new Set();
      const groups = [];

      for (const t of tiles) {
        const key = t.col + ',' + t.row;
        if (visited.has(key)) continue;

        // BFS to find contiguous group
        const group = [];
        const queue = [key];
        visited.add(key);
        while (queue.length > 0) {
          const cur = queue.shift();
          group.push(cur);
          const [cc, cr] = cur.split(',').map(Number);
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nk = (cc + dc) + ',' + (cr + dr);
            if (tileSet.has(nk) && !visited.has(nk)) {
              visited.add(nk);
              queue.push(nk);
            }
          }
        }
        groups.push(group);
      }

      // Draw a label at the center of each contiguous group
      for (const group of groups) {
        let avgCol = 0, avgRow = 0;
        for (const key of group) {
          const [c, r] = key.split(',').map(Number);
          avgCol += c;
          avgRow += r;
        }
        avgCol /= group.length;
        avgRow /= group.length;

        const labelText = groups.length > 1
          ? `${zone.name} (${group.length}/${totalCount})`
          : `${zone.name} (${totalCount})`;

        const pos = tileCenterIso(avgCol, avgRow);
        const label = new PIXI.Text({
          text: labelText,
          style: { fontFamily: 'monospace', fontSize: 10, fill: 0xffffff, align: 'center' },
        });
        label.anchor.set(0.5, 0.5);
        label.x = pos.x;
        label.y = pos.y;
        label.alpha = conn?.active ? 0.9 : 0.4;
        this.zoneLayer.addChild(label);
      }
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
      this.labelLayer.addChild(label);
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

        const needsOutline = connType === 'dataFiber';

        if (count === 0) {
          const ox = off * NS_PX, oy = off * NS_PY;
          if (needsOutline) {
            g.circle(center.x + ox, center.y + oy, LINE_WIDTH + 2);
            g.fill({ color: 0x000000, alpha: 0.9 });
          }
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
          if (needsOutline) {
            for (let i = 0; i < 4; i++) {
              if (!neighbors[i]) continue;
              const px = perps[i].px * off;
              const py = perps[i].py * off;
              g.moveTo(cx, cy);
              g.lineTo(mids[i].x + px, mids[i].y + py);
              g.stroke({ color: 0x000000, width: LINE_WIDTH + 2, alpha: 0.9 });
            }
          }
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

  renderDragPreview(startCol, startRow, endCol, endRow, type, isZone = false) {
    this.dragPreviewLayer.removeChildren();
    if (startCol == null || endCol == null) return;

    let previewColor, cost;
    if (isZone) {
      const zone = ZONES[type];
      if (!zone) return;
      previewColor = zone.color;
      cost = 0; // zones are free to assign
    } else {
      const infra = INFRASTRUCTURE[type];
      if (!infra) return;
      previewColor = infra.topColor;
      cost = infra.cost;
    }

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const tileCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
    const totalCost = tileCount * cost;
    const canAfford = cost === 0 || this.game.state.resources.funding >= totalCost;

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const g = new PIXI.Graphics();
        const pos = tileCenterIso(c, r);
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;

        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: canAfford ? previewColor : 0xcc3333, alpha: isZone ? 0.4 : 0.5 });
        g.stroke({ color: canAfford ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });

        this.dragPreviewLayer.addChild(g);
      }
    }

    // Cost label at center of preview
    const centerCol = (minCol + maxCol) / 2;
    const centerRow = (minRow + maxRow) / 2;
    const centerPos = tileCenterIso(centerCol, centerRow);
    const labelText = cost > 0 ? `$${totalCost} (${tileCount} tiles)` : `${tileCount} tiles`;
    const label = new PIXI.Text({
      text: labelText,
      style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
    });
    label.anchor.set(0.5, 0.5);
    label.x = centerPos.x;
    label.y = centerPos.y - 12;
    this.dragPreviewLayer.addChild(label);
  }

  renderLinePreview(path, infraType) {
    this.dragPreviewLayer.removeChildren();
    if (!path || path.length === 0) return;

    const infra = INFRASTRUCTURE[infraType];
    if (!infra) return;
    const cost = infra.cost;
    const totalCost = path.length * cost;
    const canAfford = this.game.state.resources.funding >= totalCost;
    const previewColor = infra.topColor;

    for (const pt of path) {
      const g = new PIXI.Graphics();
      const pos = tileCenterIso(pt.col, pt.row);
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;
      g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
      g.fill({ color: canAfford ? previewColor : 0xcc3333, alpha: 0.5 });
      g.stroke({ color: canAfford ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });
      this.dragPreviewLayer.addChild(g);
    }

    // Cost label at last tile
    const last = path[path.length - 1];
    const centerPos = tileCenterIso(last.col, last.row);
    const label = new PIXI.Text({
      text: `$${totalCost} (${path.length} tiles)`,
      style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
    });
    label.anchor.set(0.5, 0.5);
    label.x = centerPos.x;
    label.y = centerPos.y - 12;
    this.dragPreviewLayer.addChild(label);
  }

  renderDemolishPreview(startCol, startRow, endCol, endRow) {
    this.dragPreviewLayer.removeChildren();
    if (startCol == null || endCol == null) return;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        const hasContent = this.game.state.infraOccupied[key] || this.game.state.zoneOccupied[key];
        const g = new PIXI.Graphics();
        const pos = tileCenterIso(c, r);
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;

        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: 0xff0000, alpha: hasContent ? 0.3 : 0.1 });
        g.stroke({ color: 0xff4444, width: 1, alpha: 0.6 });

        this.dragPreviewLayer.addChild(g);
      }
    }
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
      const catDef = MODES.structure.categories.flooring;
      const subsections = catDef.subsections;
      const subKeys = Object.keys(subsections);
      let renderedSections = 0;
      for (const subKey of subKeys) {
        const subDef = subsections[subKey];
        const subItems = flooringKeys.filter(k => INFRASTRUCTURE[k]?.subsection === subKey);
        if (subItems.length === 0) continue;

        if (renderedSections > 0) {
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

        for (const key of subItems) {
          const infra = INFRASTRUCTURE[key];
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

          itemsContainer.appendChild(item);
        }

        section.appendChild(itemsContainer);
        palette.appendChild(section);
        renderedSections++;
      }
      return;
    }

    // Structure mode — Zones tab: show zone types
    if (compCategory === 'zones') {
      const catDef = MODES.structure.categories.zones;
      const subsections = catDef.subsections;
      const subKeys = Object.keys(subsections);
      const zoneEntries = Object.entries(ZONES);
      let renderedSections = 0;
      for (const subKey of subKeys) {
        const subDef = subsections[subKey];
        const subItems = zoneEntries.filter(([, z]) => z.subsection === subKey);
        if (subItems.length === 0) continue;

        if (renderedSections > 0) {
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

        for (const [key, zone] of subItems) {
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

          itemsContainer.appendChild(item);
        }

        section.appendChild(itemsContainer);
        palette.appendChild(section);
        renderedSections++;
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
      descEl.textContent = 'Click or drag area to remove flooring & zones';
      item.appendChild(descEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(0);
        if (this._onDemolishSelect) this._onDemolishSelect();
      });

      palette.appendChild(item);
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
      let renderedSections = 0;
      subKeys.forEach((subKey, subIdx) => {
        const subDef = subsections[subKey];
        const subComps = catComps.filter(({ comp }) => {
          if (comp.subsection) return comp.subsection === subKey;
          return subIdx === 0; // default to first subsection
        });
        if (subComps.length === 0) return;

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'palette-subsection-items';

        for (const { key, comp } of subComps) {
          const item = this._createPaletteItem(key, comp, paletteIdx);
          if (!item) continue;
          paletteIdx++;
          itemsContainer.appendChild(item);
        }

        // Skip empty subsections (all items locked)
        if (itemsContainer.children.length === 0) return;

        // Divider between rendered subsections
        if (renderedSections > 0) {
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

        section.appendChild(itemsContainer);
        palette.appendChild(section);
        renderedSections++;
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

    const isFacility = isFacilityCategory(comp.category);

    // Zone-tier check for facility items
    let zoneBlocked = false;
    if (isFacility && this.game.getZoneTierForCategory) {
      const zoneTier = this.game.getZoneTierForCategory(comp.category);
      const compTier = comp.zoneTier || 1;
      zoneBlocked = zoneTier < compTier;
    }

    const item = document.createElement('div');
    item.className = 'palette-item';
    item.dataset.paletteIndex = idx;

    const affordable = this.game.canAfford(comp.cost);
    if (!affordable) item.classList.add('unaffordable');
    if (zoneBlocked) item.classList.add('zone-blocked');

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'palette-name';
    nameEl.textContent = comp.name;
    item.appendChild(nameEl);

    // Cost
    const costEl = document.createElement('div');
    costEl.className = 'palette-cost';
    const costs = Object.entries(comp.cost).map(([r, a]) => `${this._fmt(a)} ${r}`).join(', ');
    if (zoneBlocked) {
      const neededTiles = ZONE_TIER_THRESHOLDS[( comp.zoneTier || 1) - 1];
      let zoneName = '';
      for (const z of Object.values(ZONES)) {
        const gates = Array.isArray(z.gatesCategory) ? z.gatesCategory : [z.gatesCategory];
        if (gates.includes(comp.category)) { zoneName = z.name; break; }
      }
      costEl.textContent = `Needs ${neededTiles} ${zoneName} tiles`;
    } else {
      costEl.textContent = costs;
    }
    item.appendChild(costEl);

    // Hover preview
    item.addEventListener('mouseenter', () => {
      this._showPalettePreview(comp);
    });
    item.addEventListener('mouseleave', () => {
      this._hidePalettePreview();
    });

    if (!zoneBlocked) {
      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (isFacility) {
          if (this._onFacilitySelect) this._onFacilitySelect(key);
        } else {
          if (this._onToolSelect) this._onToolSelect(key);
        }
      });
    }

    return item;
  }

  _showPalettePreview(comp) {
    const preview = document.getElementById('component-preview');
    if (!preview) return;

    const nameEl = document.getElementById('preview-name');
    if (nameEl) nameEl.textContent = comp.name;

    const descEl = document.getElementById('preview-desc');
    if (descEl) descEl.textContent = comp.desc || '';

    const statsEl = document.getElementById('preview-stats');
    if (statsEl) {
      const costs = Object.entries(comp.cost).map(([r, a]) => `${this._fmt(a)} ${r}`).join(', ');
      const statRow = (label, val) =>
        `<div class="prev-stat-row"><span>${label}</span><span class="prev-stat-val">${val}</span></div>`;

      let html = '';
      html += statRow('Cost', costs);
      html += statRow('Energy Cost', `${comp.energyCost} E/s`);
      html += statRow('Length', `${comp.length} m`);
      if (comp.stats) {
        for (const [k, v] of Object.entries(comp.stats)) {
          const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
          html += statRow(label, v);
        }
      }
      statsEl.innerHTML = html;
    }

    preview.classList.remove('hidden');

    // Position to the right of the component-popup if visible, otherwise at its default CSS position
    const mainPopup = document.getElementById('component-popup');
    const mainVisible = mainPopup && !mainPopup.classList.contains('hidden');
    if (mainVisible) {
      const mainRect = mainPopup.getBoundingClientRect();
      preview.style.left = (mainRect.right + 8) + 'px';
      preview.style.bottom = '';
      preview.style.top = mainRect.top + 'px';
    } else {
      // Use default CSS positioning (lower-left)
      preview.style.left = '';
      preview.style.top = '';
      preview.style.bottom = '';
    }
  }

  _hidePalettePreview() {
    const preview = document.getElementById('component-preview');
    if (preview) preview.classList.add('hidden');
  }

  updatePalette(category) {
    this._renderPalette(category);
  }

  // --- Tech Tree ---

  _buildTreeLayout() {
    const NODE_W = 200;
    const NODE_H = 70;
    const H_GAP = 50;
    const V_GAP = 50;
    const COL_GAP = 70;
    const HEADER_H = 35;

    const categories = Object.keys(RESEARCH_CATEGORIES);
    const layout = {};
    let colX = 40;

    for (const cat of categories) {
      const items = Object.entries(RESEARCH).filter(
        ([, r]) => r.category === cat && !r.hidden
      );
      if (items.length === 0) continue;

      // Build adjacency: parent -> children
      const children = {};
      const roots = [];
      for (const [id] of items) {
        children[id] = [];
      }
      for (const [id, r] of items) {
        const reqs = r.requires
          ? (Array.isArray(r.requires) ? r.requires : [r.requires])
          : [];
        const inCatReqs = reqs.filter(req => RESEARCH[req]?.category === cat);
        if (inCatReqs.length === 0) {
          roots.push(id);
        }
        for (const req of inCatReqs) {
          if (children[req]) children[req].push(id);
        }
      }

      // BFS to assign depth
      const depth = {};
      const queue = [...roots];
      for (const r of roots) depth[r] = 0;
      while (queue.length > 0) {
        const id = queue.shift();
        for (const child of (children[id] || [])) {
          const d = depth[id] + 1;
          if (depth[child] === undefined || d > depth[child]) {
            depth[child] = d;
            queue.push(child);
          }
        }
      }

      // Group by depth
      const byDepth = {};
      let maxDepth = 0;
      for (const [id] of items) {
        const d = depth[id] ?? 0;
        if (!byDepth[d]) byDepth[d] = [];
        byDepth[d].push(id);
        if (d > maxDepth) maxDepth = d;
      }

      // Determine column width based on max items at any depth
      let maxBreadth = 1;
      for (const ids of Object.values(byDepth)) {
        if (ids.length > maxBreadth) maxBreadth = ids.length;
      }
      const colWidth = maxBreadth * (NODE_W + H_GAP) - H_GAP;

      // Assign positions
      for (let d = 0; d <= maxDepth; d++) {
        const ids = byDepth[d] || [];
        const totalW = ids.length * NODE_W + (ids.length - 1) * H_GAP;
        const startX = colX + (colWidth - totalW) / 2;
        for (let i = 0; i < ids.length; i++) {
          layout[ids[i]] = {
            x: startX + i * (NODE_W + H_GAP),
            y: HEADER_H + d * (NODE_H + V_GAP),
            col: cat,
          };
        }
      }

      layout['__header_' + cat] = {
        x: colX + colWidth / 2 - NODE_W / 2,
        y: 0,
        col: cat,
        isHeader: true,
        colWidth,
      };

      colX += colWidth + COL_GAP;
    }

    this._treeLayout = layout;
    this._treeCanvasWidth = colX;
    const maxY = Math.max(...Object.values(layout).filter(l => !l.isHeader).map(l => l.y));
    this._treeCanvasHeight = Math.max(maxY + NODE_H + 80, 400);
  }

  _renderTechTree() {
    const canvas = document.getElementById('tt-canvas');
    const svg = document.getElementById('tt-connectors');
    const tabsEl = document.getElementById('tt-category-tabs');
    const activeEl = document.getElementById('tt-active-research');
    if (!canvas || !svg || !tabsEl) return;

    if (!this._treeLayout) this._buildTreeLayout();
    const layout = this._treeLayout;

    const NODE_W = 200;
    const NODE_H = 70;

    canvas.style.width = this._treeCanvasWidth + 'px';
    canvas.style.height = this._treeCanvasHeight + 'px';
    svg.setAttribute('width', this._treeCanvasWidth);
    svg.setAttribute('height', this._treeCanvasHeight);
    svg.innerHTML = '';
    canvas.innerHTML = '';

    // Category tabs
    tabsEl.innerHTML = '';
    for (const [catId, cat] of Object.entries(RESEARCH_CATEGORIES)) {
      const tab = document.createElement('div');
      tab.className = 'tt-cat-tab';
      tab.textContent = cat.name;
      tab.style.setProperty('--cat-color', cat.color);
      tab.dataset.category = catId;
      tab.addEventListener('click', () => {
        this._scrollToCategory(catId);
        tabsEl.querySelectorAll('.tt-cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
      tabsEl.appendChild(tab);
    }

    // Active research indicator
    if (this.game.state.activeResearch) {
      const r = RESEARCH[this.game.state.activeResearch];
      const pct = Math.min(100, Math.round((this.game.state.researchProgress / r.duration) * 100));
      activeEl.textContent = `Researching: ${r.name} (${pct}%)`;
    } else {
      activeEl.textContent = '';
    }

    // Draw connector lines (SVG)
    for (const [id, r] of Object.entries(RESEARCH)) {
      if (r.hidden || !r.category || !layout[id]) continue;
      const reqs = r.requires ? (Array.isArray(r.requires) ? r.requires : [r.requires]) : [];
      for (const reqId of reqs) {
        const parentPos = layout[reqId];
        const childPos = layout[id];
        if (!parentPos || !childPos) continue;

        const x1 = parentPos.x + NODE_W / 2;
        const y1 = parentPos.y + NODE_H;
        const x2 = childPos.x + NODE_W / 2;
        const y2 = childPos.y;
        const midY = (y1 + y2) / 2;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`);

        const completed = this.game.state.completedResearch.includes(id);
        const parentDone = this.game.state.completedResearch.includes(reqId);
        const available = this.game.isResearchAvailable(id);

        let cls = 'tt-connector ';
        if (completed) cls += 'completed';
        else if (available || parentDone) cls += 'available';
        else cls += 'locked';
        path.setAttribute('class', cls);

        svg.appendChild(path);
      }
    }

    // Draw column headers
    for (const [catId, cat] of Object.entries(RESEARCH_CATEGORIES)) {
      const hKey = '__header_' + catId;
      if (!layout[hKey]) continue;
      const h = document.createElement('div');
      h.className = 'tt-column-header';
      h.style.left = layout[hKey].x + 'px';
      h.style.top = '0px';
      h.style.color = cat.color;
      h.textContent = cat.name;
      h.dataset.category = catId;
      canvas.appendChild(h);
    }

    // Draw nodes
    for (const [id, r] of Object.entries(RESEARCH)) {
      if (r.hidden || !r.category || !layout[id]) continue;

      const pos = layout[id];
      const completed = this.game.state.completedResearch.includes(id);
      const isActive = this.game.state.activeResearch === id;
      const available = this.game.isResearchAvailable(id);

      const node = document.createElement('div');
      node.className = 'tt-node';
      node.style.left = pos.x + 'px';
      node.style.top = pos.y + 'px';
      node.dataset.researchId = id;

      if (completed) node.classList.add('completed');
      else if (isActive) node.classList.add('researching');
      else if (available) node.classList.add('available');
      else node.classList.add('locked');

      // Name
      const name = document.createElement('div');
      name.className = 'tt-node-name';
      name.textContent = r.name;
      if (completed) {
        const check = document.createElement('span');
        check.className = 'tt-check';
        check.textContent = '\u2713';
        name.appendChild(check);
      }
      node.appendChild(name);

      // Type indicator (unlock vs boost)
      const typeEl = document.createElement('div');
      typeEl.className = 'tt-node-type';
      if (r.unlocks || r.unlocksMachines) {
        typeEl.classList.add('unlock');
        const names = [];
        if (r.unlocks) {
          for (const c of r.unlocks) {
            if (COMPONENTS[c]) names.push(COMPONENTS[c].name);
          }
        }
        if (r.unlocksMachines && typeof MACHINES !== 'undefined') {
          for (const m of r.unlocksMachines) {
            if (MACHINES[m]) names.push(MACHINES[m].name);
          }
        }
        if (names.length > 0) {
          typeEl.textContent = '\u25B8 ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '...' : '');
        }
      } else if (r.effect) {
        typeEl.classList.add('boost');
        const effects = Object.entries(r.effect).map(([k, v]) => {
          if (k.endsWith('Mult')) return `${Math.round((1 - v) * 100)}% ${k.replace('Mult', '')} saving`;
          return `+${v} ${k}`;
        });
        typeEl.textContent = '\u2191 ' + effects.join(', ');
      }
      node.appendChild(typeEl);

      // Progress bar for active research
      if (isActive) {
        const prog = document.createElement('div');
        prog.className = 'tt-node-progress';
        const bar = document.createElement('div');
        bar.className = 'bar';
        const pct = Math.min(100, (this.game.state.researchProgress / r.duration) * 100);
        bar.style.width = pct + '%';
        prog.appendChild(bar);
        node.appendChild(prog);
      }

      // Click handler for available nodes
      if (available && !completed && !isActive) {
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          this._showResearchPopover(id, node);
        });
      }

      canvas.appendChild(node);
    }
  }

  _showResearchPopover(id, nodeEl) {
    const r = RESEARCH[id];
    const popover = document.getElementById('tt-popover');
    if (!popover) return;

    const costs = Object.entries(r.cost).map(([k, v]) => {
      if (k === 'funding') return `$${v}`;
      if (k === 'reputation') return `${v} rep (threshold)`;
      return `${v} ${k}`;
    }).join(', ');

    let unlocksText = '';
    if (r.unlocks) {
      const names = r.unlocks.map(c => COMPONENTS[c]?.name).filter(Boolean);
      if (names.length) unlocksText = 'Unlocks: ' + names.join(', ');
    }
    if (r.unlocksMachines && typeof MACHINES !== 'undefined') {
      const names = r.unlocksMachines.map(m => MACHINES[m]?.name).filter(Boolean);
      if (names.length) unlocksText += (unlocksText ? '\n' : '') + 'Unlocks: ' + names.join(', ');
    }
    if (r.effect) {
      const effects = Object.entries(r.effect).map(([k, v]) => {
        if (k.endsWith('Mult')) return `${Math.round((1 - v) * 100)}% ${k.replace('Mult', '')} saving`;
        return `+${v} ${k}`;
      });
      unlocksText += (unlocksText ? '\n' : '') + 'Effect: ' + effects.join(', ');
    }

    popover.innerHTML = `
      <div class="tt-popover-name">${r.name}</div>
      <div class="tt-popover-desc">${r.desc}</div>
      ${unlocksText ? `<div class="tt-popover-unlocks">${unlocksText}</div>` : ''}
      <div class="tt-popover-cost">Cost: ${costs} | ${r.duration}s</div>
      <div class="tt-popover-buttons">
        <button class="tt-btn-research" id="tt-btn-start">Research</button>
        <button class="tt-btn-cancel" id="tt-btn-close">Cancel</button>
      </div>
    `;

    // Position popover near the node
    const rect = nodeEl.getBoundingClientRect();
    popover.style.left = (rect.right + 8) + 'px';
    popover.style.top = rect.top + 'px';

    popover.classList.remove('hidden');
    const popRect = popover.getBoundingClientRect();
    if (popRect.right > window.innerWidth) {
      popover.style.left = (rect.left - popRect.width - 8) + 'px';
    }
    if (popRect.bottom > window.innerHeight) {
      popover.style.top = (window.innerHeight - popRect.height - 8) + 'px';
    }

    document.getElementById('tt-btn-start').addEventListener('click', () => {
      this.game.startResearch(id);
      popover.classList.add('hidden');
    });
    document.getElementById('tt-btn-close').addEventListener('click', () => {
      popover.classList.add('hidden');
    });
  }

  _scrollToCategory(catId) {
    const hKey = '__header_' + catId;
    const pos = this._treeLayout?.[hKey];
    if (!pos) return;

    const wrapper = document.getElementById('tt-canvas-wrapper');
    if (!wrapper) return;

    const wrapperW = wrapper.clientWidth;
    const targetX = pos.x + 100 - wrapperW / 2;

    this._treePanX = -targetX * this._treeZoom;
    this._treePanY = 0;
    this._applyTreeTransform();
  }

  _applyTreeTransform() {
    const canvas = document.getElementById('tt-canvas');
    const svg = document.getElementById('tt-connectors');
    if (!canvas || !svg) return;
    const tx = `translate(${this._treePanX}px, ${this._treePanY}px) scale(${this._treeZoom})`;
    canvas.style.transform = tx;
    svg.style.transform = tx;
  }

  _updateTreeProgress() {
    const overlay = document.getElementById('research-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (!this.game.state.activeResearch) return;

    const r = RESEARCH[this.game.state.activeResearch];
    if (!r) return;
    const pct = Math.min(100, (this.game.state.researchProgress / r.duration) * 100);

    const node = document.querySelector(`.tt-node[data-research-id="${this.game.state.activeResearch}"]`);
    if (node) {
      const bar = node.querySelector('.tt-node-progress .bar');
      if (bar) bar.style.width = pct + '%';
    }

    const activeEl = document.getElementById('tt-active-research');
    if (activeEl) {
      activeEl.textContent = `Researching: ${r.name} (${Math.round(pct)}%)`;
    }
  }

  _bindTreeEvents() {
    const wrapper = document.getElementById('tt-canvas-wrapper');
    if (!wrapper) return;

    wrapper.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tt-node') || e.target.closest('.tt-popover')) return;
      this._treeDragging = true;
      this._treeDragStartX = e.clientX - this._treePanX;
      this._treeDragStartY = e.clientY - this._treePanY;
      const popover = document.getElementById('tt-popover');
      if (popover) popover.classList.add('hidden');
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._treeDragging) return;
      this._treePanX = e.clientX - this._treeDragStartX;
      this._treePanY = e.clientY - this._treeDragStartY;
      this._applyTreeTransform();
    });

    window.addEventListener('mouseup', () => {
      this._treeDragging = false;
    });

    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSpeed = 0.001;
      const oldZoom = this._treeZoom;
      this._treeZoom = Math.max(0.4, Math.min(1.8, this._treeZoom - e.deltaY * zoomSpeed));

      const rect = wrapper.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const scale = this._treeZoom / oldZoom;
      this._treePanX = cx - scale * (cx - this._treePanX);
      this._treePanY = cy - scale * (cy - this._treePanY);

      this._applyTreeTransform();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('research-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
          overlay.classList.add('hidden');
          e.stopPropagation();
        }
      }
    });
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

    // Research button — opens tech tree
    const resBtn = document.getElementById('btn-research');
    if (resBtn) {
      resBtn.addEventListener('click', () => {
        const overlay = document.getElementById('research-overlay');
        if (overlay) {
          overlay.classList.toggle('hidden');
          if (!overlay.classList.contains('hidden')) {
            this._treeLayout = null; // force relayout
            this._renderTechTree();
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

  setProbeMode(active) {
    this.probeMode = active;
    this.app.canvas.style.cursor = active ? 'crosshair' : '';
    const indicator = document.getElementById('probe-mode-indicator');
    if (indicator) {
      indicator.classList.toggle('hidden', !active);
    }
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
      rfPower:      { key: 'rfPower',      name: 'RF POWER' },
      cooling:      { key: 'cooling',      name: 'COOLING' },
      dataControls: { key: 'dataControls', name: 'DATA/CTRL' },
      power:        { key: 'power',        name: 'POWER' },
      ops:          { key: 'ops',          name: 'OPS' },
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
      case 'cooling': {
        this._renderCoolingStats(data, summary, detail);
        const cryoData = stats.cryo;
        if (cryoData) this._renderCryoStats(cryoData, summary, detail, true);
        break;
      }
      case 'power':
        this._renderPowerStats(data, summary, detail);
        break;
      case 'dataControls':
        this._renderDataControlsStats(data, summary, detail);
        break;
      case 'ops':
        this._renderOpsStats(data, summary, detail);
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

  _renderCryoStats(d, summary, detail, append = false) {
    const mc = d.coolingCapacity > 0 ? this._marginColor(d.margin) : '';
    const cryoSummary = [
      this._sstat('Cryo Cap', this._fmt(d.coolingCapacity), 'W'),
      this._ssep(),
      this._sstat('Cryo Load', this._fmt(d.heatLoad), 'W'),
      this._ssep(),
      this._sstat('Temp', d.opTemp > 0 ? d.opTemp.toFixed(1) : '--', 'K'),
      this._ssep(),
      this._sstat('Cryo Margin', d.coolingCapacity > 0 ? d.margin.toFixed(0) : '--', '%', mc),
    ].join('');

    const dd = d.detail;
    const cryoDetail = `<div class="sstat-detail-grid" style="margin-top:6px;border-top:1px solid #333;padding-top:4px;">
      <div style="grid-column:1/-1;color:#4aa;font-size:10px;margin-bottom:2px;">CRYOGENICS</div>
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

    if (append) {
      summary.innerHTML += cryoSummary;
      detail.innerHTML += cryoDetail;
    } else {
      summary.innerHTML = cryoSummary;
      detail.innerHTML = cryoDetail;
    }
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

  _renderOpsStats(d, summary, detail) {
    summary.innerHTML = [
      this._sstat('Shielding', d.shielding, ''),
      this._ssep(),
      this._sstat('Beam Dumps', d.beamDumps, ''),
      this._ssep(),
      this._sstat('Tgt Handling', d.targetHandling, ''),
      this._ssep(),
      this._sstat('Rad Waste', d.radWasteStorage, ''),
      this._ssep(),
      this._sstat('Draw', d.energyDraw.toFixed(1), 'kW'),
    ].join('');

    const dd = d.detail;
    detail.innerHTML = `<div class="sstat-detail-grid">
      ${this._detailRow('Shielding Blocks', dd.shielding)}
      ${this._detailRow('Beam Dumps', dd.beamDumps)}
      ${this._detailRow('Target Handling', dd.targetHandling)}
      ${this._detailRow('Rad Waste Storage', dd.radWasteStorage)}
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
