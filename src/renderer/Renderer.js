// === BEAMLINE TYCOON: PIXI.JS RENDERER (Core) ===
// Note: PIXI is a CDN global — not imported.

import { TILE_W, TILE_H } from '../data/directions.js';
import { MODES } from '../data/modes.js';
import { gridToIso, tileCenterIso } from './grid.js';

// --- Utility functions (exported for use by extension modules) ---

export function _darkenPort(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

export function getModeForCategory(catKey) {
  for (const [modeKey, mode] of Object.entries(MODES)) {
    if (mode.categories[catKey]) return modeKey;
  }
  return null;
}

export function isFacilityCategory(catKey) {
  return getModeForCategory(catKey) === 'facility';
}

export const _PX_FONT = {
  A:[0x4,0xa,0xe,0xa,0xa],B:[0xc,0xa,0xc,0xa,0xc],C:[0x6,0x8,0x8,0x8,0x6],
  D:[0xc,0xa,0xa,0xa,0xc],E:[0xe,0x8,0xc,0x8,0xe],F:[0xe,0x8,0xc,0x8,0x8],
  G:[0x6,0x8,0xa,0xa,0x6],H:[0xa,0xa,0xe,0xa,0xa],I:[0xe,0x4,0x4,0x4,0xe],
  L:[0x8,0x8,0x8,0x8,0xe],M:[0xa,0xe,0xe,0xa,0xa],N:[0xa,0xe,0xe,0xe,0xa],
  O:[0x4,0xa,0xa,0xa,0x4],P:[0xc,0xa,0xc,0x8,0x8],Q:[0x4,0xa,0xa,0xe,0x6],
  R:[0xc,0xa,0xc,0xa,0xa],S:[0x6,0x8,0x4,0x2,0xc],T:[0xe,0x4,0x4,0x4,0x4],
  U:[0xa,0xa,0xa,0xa,0x4],V:[0xa,0xa,0xa,0xa,0x4],W:[0xa,0xa,0xe,0xe,0xa],
  X:[0xa,0xa,0x4,0xa,0xa],Y:[0xa,0xa,0x4,0x4,0x4],Z:[0xe,0x2,0x4,0x8,0xe],
  ' ':[0,0,0,0,0],
};

export function _pxText(ctx, x, y, str, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < str.length; i++) {
    const glyph = _PX_FONT[str[i]] || _PX_FONT[' '];
    for (let row = 0; row < 5; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 4; col++) {
        if (bits & (1 << (3 - col))) {
          ctx.fillRect(x + i * 4 + col, y + row, 1, 1);
        }
      }
    }
  }
}

// --- Renderer class ---

export class Renderer {
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
    this.placementDir = 0;       // DIR.NE — rotated with F key
    this.bulldozerMode = false;
    this.infraLayer = null;
    this.wallLayer = null;
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

    this.grassLayer = new PIXI.Container();
    this.grassLayer.zIndex = -0.5;
    this.world.addChild(this.grassLayer);

    this.decorationLayer = new PIXI.Container();
    this.decorationLayer.zIndex = 1.8;
    this.decorationLayer.sortableChildren = true;
    this.world.addChild(this.decorationLayer);

    this.infraSidesLayer = new PIXI.Container();
    this.infraSidesLayer.zIndex = -0.1;
    this.world.addChild(this.infraSidesLayer);

    this.infraLayer = new PIXI.Container();
    this.infraLayer.zIndex = 0.5;
    this.infraLayer.sortableChildren = true;
    this.world.addChild(this.infraLayer);

    this.zoneLayer = new PIXI.Container();
    this.zoneLayer.zIndex = 0.55;
    this.zoneLayer.sortableChildren = true;
    this.world.addChild(this.zoneLayer);

    this.wallLayer = new PIXI.Container();
    this.wallLayer.zIndex = 0.57;
    this.wallLayer.sortableChildren = true;
    this.world.addChild(this.wallLayer);

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

    // Enable viewport culling on dynamic layers
    this.componentLayer.cullable = true;
    this.facilityLayer.cullable = true;
    this.decorationLayer.cullable = true;
    this.connectionLayer.cullable = true;
    this.labelLayer.cullable = true;

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
          this._renderGrass();
          this._renderDecorations();
          this._renderComponents();
          this._renderBeam();
          this._renderCursors();
          this._renderInfrastructure();
          this._renderZones();
          this._renderWalls();
          this._renderFacilityEquipment();
          this._renderConnections();
          break;
        case 'infrastructureChanged':
          this._renderGrass();
          this._renderInfrastructure();
          break;
        case 'decorationsChanged':
          this._renderGrass();
          this._renderDecorations();
          break;
        case 'zonesChanged':
          this._renderGrass();
          this._renderZones();
          this._refreshPalette();
          break;
        case 'wallsChanged':
          this._renderWalls();
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
          this._updateBeamSummary();
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
    this._renderGrass();
    this._renderDecorations();
    this._renderInfrastructure();
    this._renderWalls();
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
    this.zoom = Math.max(0.2, Math.min(5, this.zoom + delta));

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
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });

      // Row lines
      const rStart = gridToIso(-range, i);
      const rEnd = gridToIso(range, i);
      g.moveTo(rStart.x, rStart.y);
      g.lineTo(rEnd.x, rEnd.y);
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
    }

    this.gridLayer.addChild(g);
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

  updatePlacementDir(dir) {
    this.placementDir = dir;
    this._renderCursors();
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

// NOTE: Prototype extensions (beamline-renderer, infrastructure-renderer, hud, overlays)
// are imported from main.js to avoid circular import TDZ issues.
