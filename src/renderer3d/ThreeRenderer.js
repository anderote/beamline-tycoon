// src/renderer3d/ThreeRenderer.js — Three.js scaffold with isometric camera
// THREE is loaded as a CDN global — do NOT import it

import { TextureManager } from './texture-manager.js';
import { TerrainBuilder } from './terrain-builder.js';
import { InfraBuilder } from './infra-builder.js';
import { WallBuilder } from './wall-builder.js';
import { ComponentBuilder } from './component-builder.js';
import { BeamBuilder } from './beam-builder.js';
import { EquipmentBuilder } from './equipment-builder.js';
import { DecorationBuilder } from './decoration-builder.js';
import { ConnectionBuilder } from './connection-builder.js';
import { buildWorldSnapshot } from './world-snapshot.js';
import { Overlay } from './overlay.js';
import { Renderer as LegacyRenderer } from '../renderer/Renderer.js';
import { tileCenterIso } from '../renderer/grid.js';
import { WALL_TYPES } from '../data/infrastructure.js';
import { COMPONENTS } from '../data/components.js';
import { ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { DIR, DIR_DELTA, turnLeft } from '../data/directions.js';

export class ThreeRenderer {
  constructor(game, spriteManager) {
    this.game = game;
    this.sprites = spriteManager;

    this._panX = 0;
    this._panY = 0;
    this.zoom = 1;

    this._frustumSize = 20;
    this._animFrameId = null;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;  // interactive canvas (overlay PixiJS canvas)

    // PixiJS overlay references — set during init()
    this.app = null;
    this.world = null;

    // Scene groups
    this.terrainGroup = null;
    this.infrastructureGroup = null;
    this.wallGroup = null;
    this.zoneGroup = null;
    this.connectionGroup = null;
    this.equipmentGroup = null;
    this.componentGroup = null;
    this.decorationGroup = null;
    this.previewGroup = null;

    this._boundOnResize = this._onResize.bind(this);

    this.textureManager = new TextureManager();
    this.terrainBuilder = new TerrainBuilder(this.textureManager);
    this.infraBuilder = new InfraBuilder(this.textureManager);
    this.wallBuilder = new WallBuilder(this.textureManager);
    this.componentBuilder = new ComponentBuilder();
    this.beamBuilder = new BeamBuilder();
    this.equipmentBuilder = new EquipmentBuilder();
    this.decorationBuilder = new DecorationBuilder();
    this.connectionBuilder = new ConnectionBuilder();
    this.wallVisibilityMode = 'transparent';
    this._snapshot = null;

    this.overlay = new Overlay();

    // --- Compatibility properties (InputHandler, main.js, hud.js) ---
    this.buildMode = false;
    this.bulldozerMode = false;
    this.probeMode = false;
    this.selectedToolType = null;
    this.placementDir = 0;
    this.cursorBendDir = 'right';
    this.hoverCol = 0;
    this.hoverRow = 0;
    this.labelLevel = 0;
    this.zoneOverlayVisible = true;
    this.activeMode = 'beamline';
    this.nodeSprites = {};
    this.beamTime = 0;

    // PixiJS layers — stubs for code that references them directly
    this.gridLayer = null;
    this.grassLayer = null;
    this.decorationLayer = null;
    this.infraSidesLayer = null;
    this.infraLayer = null;
    this.zoneLayer = null;
    this.wallLayer = null;
    this.doorLayer = null;
    this.dragPreviewLayer = { removeChildren() {} }; // safe stub for InputHandler calls
    this.facilityLayer = null;
    this.connectionLayer = null;
    this.beamLayer = null;
    this.componentLayer = null;
    this.labelLayer = null;
    this.cursorLayer = null;
    this.networkOverlayLayer = null;
    this.networkPanel = null;
    this.activeNetworkType = null;
    this.wallGraphics = {};
    this._cutawayRoom = null;
    this._cutawayHoverKey = null;
    this._transparentTiles = null;
    this._transparentHoverKey = null;

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

    // Callback stubs
    this._onToolSelect = null;
    this._onInfraSelect = null;
    this._onFacilitySelect = null;
    this._onConnSelect = null;
    this._onZoneSelect = null;
    this._onWallSelect = null;
    this._onDoorSelect = null;
    this._onFurnishingSelect = null;
    this._onDecorationSelect = null;
    this._onDemolishSelect = null;
    this._onPaletteClick = null;
    this._onTabSelect = null;
    this.onProbeClick = null;
  }

  async init() {
    const gameEl = document.getElementById('game');

    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(0x1a1a2e);

    const threeCanvas = this.renderer.domElement;
    threeCanvas.style.position = 'absolute';
    threeCanvas.style.top = '0';
    threeCanvas.style.left = '0';
    threeCanvas.style.zIndex = '10';
    threeCanvas.style.pointerEvents = 'none';
    gameEl.insertBefore(threeCanvas, gameEl.firstChild);

    this._setSize();

    // Scene
    this.scene = new THREE.Scene();

    // Isometric orthographic camera
    const aspect = gameEl.clientWidth / gameEl.clientHeight;
    const fs = this._frustumSize;
    this.camera = new THREE.OrthographicCamera(
      -fs * aspect / 2,
       fs * aspect / 2,
       fs / 2,
      -fs / 2,
      0.1,
      1000
    );
    // 2:1 dimetric camera — matches the PixiJS isometric tile formula
    // (col-row)*32, (col+row)*16 where tiles are 64×32 pixels.
    // For camera at (d, h, d): the screen X:Y ratio for a grid axis is
    // sqrt(2h² + 4d²) / (h·sqrt(2)). Setting this = 2 gives h = d·sqrt(6)/3.
    const CAM_D = 50;
    const CAM_H = CAM_D * Math.sqrt(6) / 3; // ≈ 40.82
    this.camera.position.set(CAM_D, CAM_H, CAM_D);
    this.camera.lookAt(0, 0, 0);

    // Lighting — dynamic day/night cycle
    this._ambientLight = new THREE.AmbientLight(0xfff5e6, 0.4);
    this.scene.add(this._ambientLight);

    this._sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this._sunLight.position.set(-30, 40, -30);
    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.width = 2048;
    this._sunLight.shadow.mapSize.height = 2048;
    this._sunLight.shadow.bias = -0.002;
    this._sunLight.shadow.normalBias = 0.05;
    this._sunLight.shadow.camera.near = 0.5;
    this._sunLight.shadow.camera.far = 500;
    this._sunLight.shadow.camera.left = -60;
    this._sunLight.shadow.camera.right = 60;
    this._sunLight.shadow.camera.top = 60;
    this._sunLight.shadow.camera.bottom = -60;
    this.scene.add(this._sunLight);

    // Sun orbit: full cycle in ~10 minutes of real time
    this._sunAngle = 0;
    this._sunCycleSpeed = (2 * Math.PI) / (60 * 60); // radians per second — full cycle in 1 hour
    this._lastSunTime = performance.now();

    // Scene groups
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    this.scene.add(this.terrainGroup);

    this.infrastructureGroup = new THREE.Group();
    this.infrastructureGroup.name = 'infrastructure';
    this.scene.add(this.infrastructureGroup);

    this.wallGroup = new THREE.Group();
    this.wallGroup.name = 'walls';
    this.scene.add(this.wallGroup);

    this.zoneGroup = new THREE.Group();
    this.zoneGroup.name = 'zones';
    this.scene.add(this.zoneGroup);

    this.connectionGroup = new THREE.Group();
    this.connectionGroup.name = 'connections';
    this.scene.add(this.connectionGroup);

    this.equipmentGroup = new THREE.Group();
    this.equipmentGroup.name = 'equipment';
    this.scene.add(this.equipmentGroup);

    this.componentGroup = new THREE.Group();
    this.componentGroup.name = 'components';
    this.scene.add(this.componentGroup);

    this.decorationGroup = new THREE.Group();
    this.decorationGroup.name = 'decorations';
    this.scene.add(this.decorationGroup);

    // Preview group — semi-transparent geometry for placement/demolish feedback
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'preview';
    this.previewGroup.renderOrder = 999;
    this.scene.add(this.previewGroup);

    window.addEventListener('resize', this._boundOnResize);

    // Game event listener — rebuilds relevant 3D sections and updates DOM HUD
    this.game.on((event, data) => {
      switch (event) {
        case 'beamlineChanged':
        case 'loaded':
          this.refresh(); // full 3D rebuild
          break;
        case 'infrastructureChanged':
          this._refreshTerrain();
          this._refreshInfra();
          break;
        case 'decorationsChanged':
          this._refreshTerrain();
          this._refreshDecorations();
          break;
        case 'zonesChanged':
          this._refreshTerrain();
          if (this._refreshPalette) this._refreshPalette();
          break;
        case 'wallsChanged':
        case 'doorsChanged':
          this._refreshWalls();
          break;
        case 'facilityChanged':
          this._refreshEquipment();
          this._refreshComponents(); // recheck connection warnings
          break;
        case 'connectionsChanged':
          this._refreshConnections();
          this._refreshComponents(); // recheck connection warnings
          break;
        case 'beamToggled':
          this._refreshBeam();
          if (this._updateBeamSummary) this._updateBeamSummary();
          break;
        case 'tick':
          if (this._updateHUD) this._updateHUD();
          if (this._updateTreeProgress) this._updateTreeProgress();
          break;
        case 'researchChanged':
          if (this._renderTechTree) this._renderTechTree();
          break;
        case 'objectiveCompleted':
          if (this._renderGoalsOverlay) this._renderGoalsOverlay();
          break;
      }
    });

    // Initialize PixiJS overlay
    await this.overlay.init();

    // Wire PixiJS app/world for compatibility with InputHandler and DOM HUD code
    this.app = this.overlay.app;
    this.world = this.overlay.world;
    this.canvas = this.app.canvas;

    // Make overlay canvas interactive (receives pointer events)
    this.canvas.style.pointerEvents = 'auto';

    // Set initial world position (same as old Renderer)
    this.world.x = this.app.screen.width / 2;
    this.world.y = this.app.screen.height / 3;

    // Generate placeholder sprites
    this.sprites.generatePlaceholders(this.app);

    // Ticker for animation (beam time)
    this.app.ticker.add((ticker) => {
      this.beamTime += ticker.deltaTime * 0.02;
    });

    // Load 3D assets
    await this.loadAssets();

    // Initial 3D refresh
    this.refresh();

    // Bind DOM HUD events (added by hud.js bridge)
    if (this._bindHUDEvents) this._bindHUDEvents();
    if (this._bindTreeEvents) this._bindTreeEvents();

    // Initial DOM renders (added by hud.js/overlays.js bridge)
    if (this._generateCategoryTabs) this._generateCategoryTabs();
    if (this._renderTechTree) this._renderTechTree();
    if (this._renderGoalsOverlay) this._renderGoalsOverlay();
    if (this._updateHUD) this._updateHUD();

    this._animate();
  }

  // --- Coordinate conversion (PixiJS-compatible) ---

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.world.x) / this.zoom,
      y: (screenY - this.world.y) / this.zoom,
    };
  }

  /**
   * Raycast from a screen position into the 3D scene.
   * Returns the first intersected mesh (skipping preview/terrain/grid),
   * or null if nothing is hit.
   */
  raycastScreen(screenX, screenY) {
    if (!this.renderer || !this.camera) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    // Only test component, equipment, and connection groups
    const targets = [this.componentGroup, this.equipmentGroup, this.connectionGroup, this.wallGroup];
    const all = [];
    for (const g of targets) {
      if (g) all.push(...raycaster.intersectObjects(g.children, true));
    }
    all.sort((a, b) => a.distance - b.distance);
    // When walls are not fully opaque, skip wall hits so objects behind them are selectable
    const wallsClickable = this.wallVisibilityMode === 'up';
    if (!wallsClickable) {
      const hit = all.find(h => !this._isInGroup(h.object, this.wallGroup));
      return hit || null;
    }
    return all.length > 0 ? all[0] : null;
  }

  /** Check if a mesh belongs to a given parent group */
  _isInGroup(obj, group) {
    while (obj) {
      if (obj === group) return true;
      obj = obj.parent;
    }
    return false;
  }

  /**
   * Given a hit mesh from raycast, walk up to find which top-level scene
   * group it belongs to and what the root object (component/equipment) is.
   * Returns { group: 'component'|'equipment'|'wall'|'connection', rootObj, nodeId? }
   */
  identifyHit(hit) {
    if (!hit || !hit.object) return null;
    let obj = hit.object;
    // Walk up parents to find the group
    while (obj.parent) {
      if (obj.parent === this.componentGroup) {
        // Find node ID from componentBuilder's mesh map
        for (const [id, mesh] of this.componentBuilder._meshMap) {
          if (mesh === obj) return { group: 'component', rootObj: obj, nodeId: id };
        }
        return { group: 'component', rootObj: obj };
      }
      if (obj.parent === this.equipmentGroup) {
        return { group: 'equipment', rootObj: obj };
      }
      if (obj.parent === this.wallGroup) {
        return { group: 'wall', rootObj: obj };
      }
      if (obj.parent === this.connectionGroup) {
        return { group: 'connection', rootObj: obj };
      }
      obj = obj.parent;
    }
    return null;
  }

  // --- Camera controls (PixiJS-compatible, syncs to Three.js) ---

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
    this._syncThreeCameraFromOverlay();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  panBy(dx, dy) {
    this.world.x -= dx;
    this.world.y -= dy;
    this._syncThreeCameraFromOverlay();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  /**
   * Sync the Three.js camera frustum and position from the PixiJS world container state.
   * This is the reverse of the old syncOverlay — the PixiJS container is the source of truth.
   */
  _syncThreeCameraFromOverlay() {
    // The PixiJS world container position and scale encode the camera state.
    // world.x, world.y = screen pixel offset of isometric origin
    // world.scale = zoom level (this.zoom)
    //
    // We need to compute what Three.js frustum and lookAt correspond to this.
    //
    // In the old PixiJS renderer:
    //   iso origin is at screen (world.x, world.y)
    //   zoom is world.scale.x
    //
    // For Three.js:
    //   frustumSize determines zoom: smaller frustum = more zoomed in
    //   camera.lookAt determines pan center in world XZ
    //
    // We'll derive the Three.js camera params from the PixiJS state.

    const screenW = this.app.screen.width || window.innerWidth;
    const screenH = this.app.screen.height || window.innerHeight;

    // Read zoom from the PixiJS world scale as the authoritative source
    // (main.js may set world.scale.set() directly during save/load restore)
    const zoom = this.world.scale?.x || this.zoom;
    this.zoom = zoom;

    // Where is the screen center in isometric coords?
    const centerIsoX = (screenW / 2 - this.world.x) / zoom;
    const centerIsoY = (screenH / 2 - this.world.y) / zoom;

    // Convert isometric coords to grid coords (floating point)
    // From grid.js: gridToIso: x = (col - row) * (TILE_W/2), y = (col + row) * (TILE_H/2)
    // Inverse: col = (x/(TILE_W/2) + y/(TILE_H/2)) / 2
    //          row = (y/(TILE_H/2) - x/(TILE_W/2)) / 2
    const TILE_W = 64, TILE_H = 32;
    const col = (centerIsoX / (TILE_W / 2) + centerIsoY / (TILE_H / 2)) / 2;
    const row = (centerIsoY / (TILE_H / 2) - centerIsoX / (TILE_W / 2)) / 2;

    // Three.js world: each grid tile = 2 world units (from terrain-builder convention)
    this._panX = col * 2;
    this._panY = row * 2;

    // Frustum size: derived so that the Three.js orthographic projection of a
    // tile at (col*2+1, 0, row*2+1) matches the PixiJS screen position
    // gridToIso(col, row) * zoom + worldOffset.
    // With the dimetric camera (d, d√6/3, d), the relationship is:
    //   frustumSize = √2 · screenH / (TILE_H · zoom)
    this._frustumSize = Math.SQRT2 * screenH / (TILE_H * zoom);
    this._updateCameraFrustum();
    this._updateCameraLookAt();
  }

  // --- State setters (InputHandler compatibility) ---

  updateHover(col, row) {
    this.hoverCol = col;
    this.hoverRow = row;
    if (this.bulldozerMode || this.buildMode) {
      this._renderCursors();
    }
    if (this.wallVisibilityMode === 'cutaway') {
      this._applyWallVisibility();
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
    if (active) { this.buildMode = false; this.selectedToolType = null; }
    this.canvas.style.cursor = active ? 'crosshair' : '';
    this._renderCursors();
  }

  setProbeMode(active) {
    this.probeMode = active;
    this.canvas.style.cursor = active ? 'crosshair' : '';
    const indicator = document.getElementById('probe-mode-indicator');
    if (indicator) indicator.classList.toggle('hidden', !active);
  }

  cycleLabelLevel() {
    const names = ['Everything', 'Furniture + Equipment + Beamline', 'Equipment + Beamline', 'Beamline', 'Nothing'];
    this.labelLevel = (this.labelLevel + 1) % 5;
    return names[this.labelLevel];
  }

  toggleZoneOverlay() {
    this.zoneOverlayVisible = !this.zoneOverlayVisible;
    return this.zoneOverlayVisible;
  }

  updateCursorBendDir(dir) { this.cursorBendDir = dir; }
  updatePlacementDir(dir) { this.placementDir = dir; this._renderCursors(); }

  // --- Render delegation methods (called by game events and legacy code) ---
  // These bridge calls from code that expects the old Renderer API.
  // Methods that do 2D PixiJS rendering are stubs for now (rendered by Three.js instead).

  _renderCursors() {
    this._clearPreview();

    // Bulldozer mode — red highlight on hover tile
    if (this.bulldozerMode) {
      const key = this.hoverCol + ',' + this.hoverRow;
      const hasTarget = this.game.registry.sharedOccupied[key] !== undefined ||
        this.game.state.infraOccupied[key] ||
        this.game.state.facilityGrid[key] ||
        this.game.state.machineGrid[key];
      const color = hasTarget ? 0xff4444 : 0xff6644;
      const opacity = hasTarget ? 0.5 : 0.2;
      this._previewTileHighlight(this.hoverCol, this.hoverRow, color, opacity);
      return;
    }

    if (!this.buildMode) return;

    // Get nodes for the currently edited beamline
    let nodes = [];
    if (this.game.editingBeamlineId) {
      const entry = this.game.registry.get(this.game.editingBeamlineId);
      if (entry) nodes = entry.beamline.getAllNodes();
    }

    if (nodes.length === 0) {
      // Draw hover cursor showing full footprint of selected component
      const comp = this.selectedToolType ? COMPONENTS[this.selectedToolType] : null;
      const trackLength = comp ? Math.ceil((comp.subL || 4) / 4) : 1;
      const trackWidth = comp ? Math.ceil((comp.subW || 2) / 4) : 1;
      const dir = this.placementDir || DIR.NE;
      const delta = DIR_DELTA[dir];
      const perpDelta = DIR_DELTA[turnLeft(dir)];
      const widthOffsets = [];
      for (let j = 0; j < trackWidth; j++) {
        widthOffsets.push(j - (trackWidth - 1) / 2);
      }
      const tiles = [];
      for (let i = 0; i < trackLength; i++) {
        for (const wOff of widthOffsets) {
          tiles.push({
            col: this.hoverCol + delta.dc * i + Math.round(perpDelta.dc * wOff),
            row: this.hoverRow + delta.dr * i + Math.round(perpDelta.dr * wOff),
          });
        }
      }
      // Check availability
      const available = tiles.every(t =>
        this.game.registry.sharedOccupied[t.col + ',' + t.row] === undefined
      );
      const color = available ? 0x4488ff : 0xff4444;
      for (const tile of tiles) {
        this._previewTileHighlight(tile.col, tile.row, color, 0.35);
      }
      // Direction arrow
      if (tiles.length > 0) {
        const last = tiles[tiles.length - 1];
        const arrowMat = this._previewEdgeMat(0x88bbff);
        const cx = last.col * 2 + 1;
        const cz = last.row * 2 + 1;
        const ax = cx + delta.dc * 0.8;
        const az = cz + delta.dr * 0.8;
        const pts = [new THREE.Vector3(cx, 0.15, cz), new THREE.Vector3(ax, 0.15, az)];
        this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arrowMat));
      }
      return;
    }

    // Draw cursors at build positions for the edited beamline
    let cursors = [];
    if (this.game.editingBeamlineId) {
      const entry = this.game.registry.get(this.game.editingBeamlineId);
      if (entry) cursors = entry.beamline.getBuildCursors();
    }
    for (const cursor of cursors) {
      const isHovered = cursor.col === this.hoverCol && cursor.row === this.hoverRow;
      const color = isHovered ? 0x44ff44 : 0x4488ff;
      const opacity = isHovered ? 0.5 : 0.3;
      this._previewTileHighlight(cursor.col, cursor.row, color, opacity);
      // Small direction arrow
      const delta = DIR_DELTA[cursor.dir] || { dc: 0, dr: 0 };
      const cx = cursor.col * 2 + 1;
      const cz = cursor.row * 2 + 1;
      const arrowMat = this._previewEdgeMat(color);
      const pts = [
        new THREE.Vector3(cx, 0.15, cz),
        new THREE.Vector3(cx + delta.dc * 0.7, 0.15, cz + delta.dr * 0.7),
      ];
      this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arrowMat));
    }

    // Design placer ghost preview
    const placer = this.game._designPlacer;
    if (placer && placer.active) {
      for (const ft of placer.foundationTiles) {
        this._previewTileHighlight(ft.col, ft.row, 0x999999, 0.25);
      }
      const tint = placer.valid ? 0x44ff44 : 0xff4444;
      const opacity = placer.valid ? 0.35 : 0.2;
      for (const pt of placer.previewTiles) {
        this._previewTileHighlight(pt.col, pt.row, tint, opacity);
      }
    }
  }
  _renderComponents() { this._refreshComponents(); }
  _renderBeam() { this._refreshBeam(); }
  _renderInfrastructure() { this._refreshInfra(); }
  _renderZones() { /* zone overlays — future (3D handles terrain coloring) */ }
  _renderWalls() { this._refreshWalls(); }
  _renderDoors() { this._refreshWalls(); }
  _renderFacilityEquipment() { this._refreshEquipment(); }
  _renderConnections() { this._refreshConnections(); this._refreshBeamPipes(); }
  _renderGrass() { this._refreshTerrain(); }
  _renderDecorations() { this._refreshDecorations(); }
  _renderZoneFurnishings() { this._refreshEquipment(); }
  _renderNetworkOverlay() { /* future */ }
  renderConnLinePreview() { /* future */ }
  _renderProbeFlags() { /* future */ }

  // --- Preview / highlight methods ---

  /** Clear all preview geometry from the scene. */
  _clearPreview() {
    if (!this.previewGroup) return;
    while (this.previewGroup.children.length > 0) {
      const child = this.previewGroup.children[0];
      this.previewGroup.remove(child);
      child.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }
  }

  /** Shared material factories for previews. */
  _previewMat(color = 0x44aaff, opacity = 0.35) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      depthTest: false, depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  _previewEdgeMat(color = 0x44aaff) {
    return new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false,
    });
  }

  /** Helper: sets renderOrder on a mesh so it draws on top. */
  _addPreviewMesh(mesh) {
    mesh.renderOrder = 999;
    this.previewGroup.add(mesh);
  }

  /**
   * Create a red wireframe outline around a source 3D object (Group or Mesh).
   * Traverses all child meshes and adds edge outlines to the preview group.
   */
  _outlineObject(sourceObj, color = 0xff4444) {
    if (!sourceObj) return;
    const lineMat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false,
    });
    // Wrap all outlines in a group at the source object's world position/rotation
    const wrapper = new THREE.Group();
    wrapper.renderOrder = 999;

    sourceObj.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const edges = new THREE.EdgesGeometry(child.geometry, 20);
      const line = new THREE.LineSegments(edges, lineMat);
      // Copy child's local transform relative to source
      child.updateWorldMatrix(true, false);
      sourceObj.updateWorldMatrix(true, false);
      // Get child's world matrix, then express relative to wrapper (which is at identity)
      line.matrixAutoUpdate = false;
      line.matrix.copy(child.matrixWorld);
      wrapper.add(line);
    });

    this.previewGroup.add(wrapper);
  }

  /**
   * Highlight a beamline component by its node ID with a red outline.
   */
  renderDemolishComponentOutline(nodeId) {
    this._clearPreview();
    const obj = this.componentBuilder._meshMap?.get(nodeId);
    if (obj) this._outlineObject(obj);
  }

  /**
   * Highlight equipment/furnishing at a given position by scanning the equipment group.
   * Finds meshes whose position matches the target tile.
   */
  renderDemolishMeshOutline(col, row) {
    this._clearPreview();
    const tx = col * 2 + 1;
    const tz = row * 2 + 1;
    // Scan equipment group for meshes near this tile
    this.equipmentGroup.children.forEach(child => {
      if (!child.isMesh) return;
      const p = child.position;
      // Check if mesh center is within this tile's bounds
      if (p.x > col * 2 && p.x < col * 2 + 2 && p.z > row * 2 && p.z < row * 2 + 2) {
        this._outlineObject(child);
      }
    });
  }

  /**
   * Highlight a furnishing by its sub-tile bounds with a red outline.
   */
  renderDemolishFurnishingOutline(entry) {
    this._clearPreview();
    if (!entry) return;
    const subSize = 2 / 4;
    const tileX = (entry.col ?? 0) * 2;
    const tileZ = (entry.row ?? 0) * 2;
    const sx = tileX + (entry.subCol || 0) * subSize;
    const sz = tileZ + (entry.subRow || 0) * subSize;
    // Find furnishing meshes near this sub-tile position
    this.equipmentGroup.children.forEach(child => {
      if (!child.isMesh) return;
      const p = child.position;
      if (Math.abs(p.x - (sx + subSize)) < subSize * 2 && Math.abs(p.z - (sz + subSize)) < subSize * 2) {
        this._outlineObject(child);
      }
    });
  }

  /**
   * Render a rectangular drag preview for infrastructure / zone placement.
   * Shows semi-transparent quads over each tile in the rectangle.
   */
  renderDragPreview(col1, row1, col2, row2, toolType, isZone) {
    this._clearPreview();
    const minC = Math.min(col1, col2), maxC = Math.max(col1, col2);
    const minR = Math.min(row1, row2), maxR = Math.max(row1, row2);
    const color = isZone ? 0x44cc88 : 0x44aaff;
    const mat = this._previewMat(color, 0.3);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c * 2 + 1, 0.1, r * 2 + 1);
        this._addPreviewMesh(mesh);
      }
    }
    // Wireframe border around full rectangle
    const edgeMat = this._previewEdgeMat(color);
    const x0 = minC * 2, x1 = (maxC + 1) * 2;
    const z0 = minR * 2, z1 = (maxR + 1) * 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this._addPreviewMesh(new THREE.Line(lineGeo, edgeMat));
  }

  clearDragPreview() { this._clearPreview(); }

  /**
   * Render a line-based infrastructure preview (paths, conduits).
   * Shows a coloured strip along the path tiles.
   */
  renderLinePreview(path, infraType) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const mat = this._previewMat(0x44aaff, 0.35);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    for (const tile of path) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(tile.col * 2 + 1, 0.1, tile.row * 2 + 1);
      this._addPreviewMesh(mesh);
    }
  }

  /**
   * Render a sub-tile placement preview for furnishings / decorations.
   * Shows a small highlighted quad within the tile's sub-grid.
   */
  _renderSubtilePreview(col, row, subCol, subRow, gridW, gridH, rotated) {
    this._clearPreview();
    const w = rotated ? gridH : gridW;
    const h = rotated ? gridW : gridH;
    // Each tile is 2 world units, sub-grid is 4x4 → each sub-cell is 0.5 units
    const subSize = 2 / 4; // 0.5
    const mat = this._previewMat(0x88ccff, 0.4);
    const geo = new THREE.PlaneGeometry(w * subSize, h * subSize);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    // Position: tile origin + sub-cell offset + half the preview size
    const tileX = col * 2;
    const tileZ = row * 2;
    mesh.position.set(
      tileX + subCol * subSize + (w * subSize) / 2,
      0.1,
      tileZ + subRow * subSize + (h * subSize) / 2
    );
    this._addPreviewMesh(mesh);
    // Wireframe outline
    const edgeMat = this._previewEdgeMat(0x88ccff);
    const x0 = tileX + subCol * subSize;
    const z0 = tileZ + subRow * subSize;
    const x1 = x0 + w * subSize;
    const z1 = z0 + h * subSize;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  /**
   * Render demolish preview — red translucent rectangle over the drag area.
   */
  renderDemolishPreview(col1, row1, col2, row2) {
    this._clearPreview();
    const minC = Math.min(col1, col2), maxC = Math.max(col1, col2);
    const minR = Math.min(row1, row2), maxR = Math.max(row1, row2);
    const mat = this._previewMat(0xff4444, 0.3);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c * 2 + 1, 0.1, r * 2 + 1);
        this._addPreviewMesh(mesh);
      }
    }
    // Red border
    const edgeMat = this._previewEdgeMat(0xff4444);
    const x0 = minC * 2, x1 = (maxC + 1) * 2;
    const z0 = minR * 2, z1 = (maxR + 1) * 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  /**
   * Render wall placement preview — semi-transparent wall slabs along the path.
   */
  renderWallPreview(path, wallType) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const mat = this._previewMat(0xffffff, 0.4);
    const wallH = 0.75;
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      const geo = isNS
        ? new THREE.BoxGeometry(2, wallH, 0.08)
        : new THREE.BoxGeometry(0.08, wallH, 2);
      const mesh = new THREE.Mesh(geo, mat);
      const pos = this._wallEdgePosition(seg.col, seg.row, seg.edge);
      mesh.position.set(pos.x, wallH / 2, pos.z);
      this._addPreviewMesh(mesh);
    }
  }

  /**
   * Render door placement preview — semi-transparent door frames along the path.
   */
  renderDoorPreview(path, doorType) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const mat = this._previewMat(0x88ff88, 0.4);
    const doorH = 0.6;
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      const geo = isNS
        ? new THREE.BoxGeometry(1.0, doorH, 0.06)
        : new THREE.BoxGeometry(0.06, doorH, 1.0);
      const mesh = new THREE.Mesh(geo, mat);
      const pos = this._wallEdgePosition(seg.col, seg.row, seg.edge);
      mesh.position.set(pos.x, doorH / 2, pos.z);
      this._addPreviewMesh(mesh);
    }
  }

  /**
   * Highlight a single wall edge — white cross / edge marker on hover.
   */
  renderWallEdgeHighlight(col, row, edge, color = 0xffffff) {
    this._clearPreview();
    if (col === undefined || row === undefined || !edge) return;
    const pos = this._wallEdgePosition(col, row, edge);
    // Cross marker at the edge midpoint
    const size = 0.3;
    const y = 0.15;
    const crossMat = this._previewEdgeMat(color);
    // Horizontal bar (X axis)
    const h1 = [new THREE.Vector3(pos.x - size, y, pos.z), new THREE.Vector3(pos.x + size, y, pos.z)];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h1), crossMat));
    // Vertical bar (Z axis)
    const h2 = [new THREE.Vector3(pos.x, y, pos.z - size), new THREE.Vector3(pos.x, y, pos.z + size)];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h2), crossMat));
    // Small filled quad on the edge
    const quadMat = this._previewMat(color, 0.25);
    const isNS = edge === 'n' || edge === 's';
    const quadGeo = isNS
      ? new THREE.PlaneGeometry(1.6, 0.3)
      : new THREE.PlaneGeometry(0.3, 1.6);
    quadGeo.rotateX(-Math.PI / 2);
    const quad = new THREE.Mesh(quadGeo, quadMat);
    quad.position.set(pos.x, 0.1, pos.z);
    this._addPreviewMesh(quad);
  }

  /** Hover cursor for infrastructure placement — single tile highlight. */
  renderInfraHoverCursor(col, row, color) {
    this._clearPreview();
    const tileColor = (typeof color === 'number') ? color : 0x44aaff;
    const mat = this._previewMat(tileColor, 0.25);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(col * 2 + 1, 0.1, row * 2 + 1);
    this._addPreviewMesh(mesh);
    // Solid color outline
    const edgeMat = this._previewEdgeMat(tileColor);
    const x0 = col * 2, x1 = col * 2 + 2;
    const z0 = row * 2, z1 = row * 2 + 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  /**
   * Render a ghost (transparent) beamline component at a tile position.
   * Uses the real component geometry from the component builder.
   */
  renderComponentGhost(col, row, compType, direction, color) {
    this._clearPreview();
    const compDef = COMPONENTS[compType];
    if (!compDef) return;
    // Build the real geometry via component builder
    const obj = this.componentBuilder._createObject(compDef);
    // Make all materials transparent
    obj.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0.4;
        child.material.depthWrite = false;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    const isDetailed = !!obj.children?.length; // groups are detailed, bare meshes are fallbacks
    const SUB_UNIT = 0.5;
    const y = isDetailed ? 0 : ((compDef.subH || 2) * SUB_UNIT) / 2;
    obj.position.set(col * 2 + 1, y, row * 2 + 1);
    obj.rotation.y = -(direction || 0) * (Math.PI / 2);
    obj.renderOrder = 999;
    this.previewGroup.add(obj);
    // Floor outline showing tile footprint
    const tileColor = (typeof color === 'number') ? color : 0x88aaff;
    const tiles = this._ghostComponentTiles(col, row, direction, compDef);
    const edgeMat = this._previewEdgeMat(tileColor);
    const fillMat = this._previewMat(tileColor, 0.15);
    for (const t of tiles) {
      const x0 = t.col * 2, x1 = t.col * 2 + 2;
      const z0 = t.row * 2, z1 = t.row * 2 + 2;
      const pts = [
        new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
        new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
        new THREE.Vector3(x0, 0.12, z0),
      ];
      this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
      const fillGeo = new THREE.PlaneGeometry(2, 2);
      fillGeo.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.position.set(t.col * 2 + 1, 0.1, t.row * 2 + 1);
      this._addPreviewMesh(fill);
    }
  }

  /** Calculate the tile footprint for a component ghost preview. */
  _ghostComponentTiles(col, row, dir, compDef) {
    // Replicate Beamline._calcTiles logic
    const DIR_DELTAS = [
      { dc: 0, dr: -1 }, // NE (0)
      { dc: 1, dr: 0 },  // SE (1)
      { dc: 0, dr: 1 },  // SW (2)
      { dc: -1, dr: 0 }, // NW (3)
    ];
    const PERP = [3, 0, 1, 2]; // turnLeft
    const delta = DIR_DELTAS[dir] || DIR_DELTAS[0];
    const perpDelta = DIR_DELTAS[PERP[dir] || 0];
    const tilesAlong = Math.ceil((compDef.subL || 4) / 4);
    const tilesAcross = Math.ceil((compDef.subW || 2) / 4);
    const widthOffsets = [];
    for (let j = 0; j < tilesAcross; j++) widthOffsets.push(j - (tilesAcross - 1) / 2);
    const tiles = [];
    for (let i = 0; i < tilesAlong; i++) {
      for (const wOff of widthOffsets) {
        tiles.push({
          col: col + delta.dc * i + perpDelta.dc * wOff,
          row: row + delta.dr * i + perpDelta.dr * wOff,
        });
      }
    }
    return tiles;
  }

  /**
   * Render a ghost (transparent) equipment box at a tile position.
   * Also draws a floor-tile outline in the given color.
   */
  renderEquipmentGhost(col, row, compType, color) {
    this._clearPreview();
    const compDef = COMPONENTS[compType];
    if (!compDef) return;
    const SUB_UNIT = 0.5;
    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = (compDef.subH || 2) * SUB_UNIT;
    const l = (compDef.subL || 2) * SUB_UNIT;
    const ghostMat = new THREE.MeshBasicMaterial({
      color: compDef.spriteColor || 0x888888,
      transparent: true, opacity: 0.4,
      depthTest: true, depthWrite: false,
    });
    const geo = new THREE.BoxGeometry(w, h, l);
    const mesh = new THREE.Mesh(geo, ghostMat);
    const tileX = col * 2;
    const tileZ = row * 2;
    mesh.position.set(tileX + 1, h / 2, tileZ + 1);
    this._addPreviewMesh(mesh);
    // Floor outline
    const tileColor = (typeof color === 'number') ? color : 0x88aaff;
    const edgeMat = this._previewEdgeMat(tileColor);
    const x0 = tileX, x1 = tileX + 2, z0 = tileZ, z1 = tileZ + 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    // Translucent fill
    const fillMat = this._previewMat(tileColor, 0.15);
    const fillGeo = new THREE.PlaneGeometry(2, 2);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(tileX + 1, 0.1, tileZ + 1);
    this._addPreviewMesh(fill);
  }

  /**
   * Render a ghost (transparent) furnishing box at a sub-tile position.
   * Also draws a sub-tile outline in the given color.
   */
  renderFurnishingGhost(col, row, subCol, subRow, furnType, rotated, color) {
    this._clearPreview();
    const furnDef = ZONE_FURNISHINGS[furnType];
    if (!furnDef) return;
    const SUB_UNIT = 0.5;
    const gw = rotated ? furnDef.gridH : furnDef.gridW;
    const gh = rotated ? furnDef.gridW : furnDef.gridH;
    const w = (furnDef.subW || gw) * SUB_UNIT;
    const h = (furnDef.subH || 1) * SUB_UNIT;
    const l = (furnDef.subL || gh) * SUB_UNIT;
    const ghostMat = new THREE.MeshBasicMaterial({
      color: furnDef.color || 0x666666,
      transparent: true, opacity: 0.4,
      depthTest: true, depthWrite: false,
    });
    const geo = new THREE.BoxGeometry(w, h, l);
    const mesh = new THREE.Mesh(geo, ghostMat);
    const tileX = col * 2;
    const tileZ = row * 2;
    const subSize = 2 / 4; // 0.5
    mesh.position.set(
      tileX + subCol * subSize + w / 2,
      h / 2,
      tileZ + subRow * subSize + l / 2
    );
    this._addPreviewMesh(mesh);
    // Sub-tile outline
    const tileColor = (typeof color === 'number') ? color : 0x88ccff;
    const edgeMat = this._previewEdgeMat(tileColor);
    const x0 = tileX + subCol * subSize;
    const z0 = tileZ + subRow * subSize;
    const x1 = x0 + gw * subSize;
    const z1 = z0 + gh * subSize;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    // Translucent fill
    const fillMat = this._previewMat(tileColor, 0.15);
    const fillGeo = new THREE.PlaneGeometry(gw * subSize, gh * subSize);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set((x0 + x1) / 2, 0.1, (z0 + z1) / 2);
    this._addPreviewMesh(fill);
  }

  /** Highlight a furnishing for demolish — red tinted box over its bounds. */
  _renderDemolishFurnishingHighlight(entry) {
    this._clearPreview();
    if (!entry) return;
    const subSize = 2 / 4;
    const w = (entry.rotated ? entry.gridH : entry.gridW) || 1;
    const h = (entry.rotated ? entry.gridW : entry.gridH) || 1;
    const mat = this._previewMat(0xff4444, 0.35);
    const geo = new THREE.PlaneGeometry(w * subSize, h * subSize);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    const tileX = entry.col * 2;
    const tileZ = entry.row * 2;
    mesh.position.set(
      tileX + entry.subCol * subSize + (w * subSize) / 2,
      0.1,
      tileZ + entry.subRow * subSize + (h * subSize) / 2
    );
    this._addPreviewMesh(mesh);
  }

  /** Highlight equipment for demolish — red box at equipment tile. */
  _renderDemolishEquipmentHighlight(equip) {
    this._clearPreview();
    if (!equip) return;
    const col = equip.col ?? 0;
    const row = equip.row ?? 0;
    const mat = this._previewMat(0xff4444, 0.35);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(col * 2 + 1, 0.1, row * 2 + 1);
    this._addPreviewMesh(mesh);
  }

  /** Highlight a single tile with a coloured quad + wireframe border. */
  _previewTileHighlight(col, row, color, opacity) {
    const mat = this._previewMat(color, opacity);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(col * 2 + 1, 0.1, row * 2 + 1);
    this._addPreviewMesh(mesh);
    // Wireframe border
    const edgeMat = this._previewEdgeMat(color);
    const x0 = col * 2, x1 = col * 2 + 2;
    const z0 = row * 2, z1 = row * 2 + 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  /** Returns world-space XZ position of a wall edge midpoint. */
  _wallEdgePosition(col, row, edge) {
    const cx = col * 2 + 1;
    const cz = row * 2 + 1;
    switch (edge) {
      case 'n': return { x: cx, z: row * 2 };
      case 's': return { x: cx, z: row * 2 + 2 };
      case 'e': return { x: col * 2 + 2, z: cz };
      case 'w': return { x: col * 2, z: cz };
      default:  return { x: cx, z: cz };
    }
  }

  showNetworkOverlay() { /* future */ }
  clearNetworkOverlay() { /* future */ }

  // Wall/door visibility — triggers a 3D wall rebuild with current mode
  _applyWallVisibility() {
    this._refreshWalls();
  }
  _applyDoorVisibility() {
    // Doors are rebuilt together with walls in _refreshWalls
  }

  _drawGrid() { /* future */ }

  // --- Helpers (copied from legacy Renderer) ---

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

  // --- Three.js internals ---

  _setSize() {
    const gameEl = document.getElementById('game');
    const w = gameEl.clientWidth;
    const h = gameEl.clientHeight;
    this.renderer.setSize(w, h);
  }

  _updateCameraFrustum() {
    const gameEl = document.getElementById('game');
    const aspect = gameEl.clientWidth / gameEl.clientHeight;
    const fs = this._frustumSize;
    this.camera.left   = -fs * aspect / 2;
    this.camera.right  =  fs * aspect / 2;
    this.camera.top    =  fs / 2;
    this.camera.bottom = -fs / 2;
    this.camera.updateProjectionMatrix();
  }

  _updateCameraLookAt() {
    // Move both position and target by pan offset — maintains dimetric angle
    const CAM_D = 50;
    const CAM_H = CAM_D * Math.sqrt(6) / 3;
    this.camera.position.set(CAM_D + this._panX, CAM_H, CAM_D + this._panY);
    this.camera.lookAt(this._panX, 0, this._panY);
  }

  _onResize() {
    this._setSize();
    this._updateCameraFrustum();
  }

  _animate() {
    this._animFrameId = requestAnimationFrame(() => this._animate());
    // Sync Three.js camera from PixiJS world container every frame
    // (InputHandler may directly set world.x/y without calling panBy)
    this._syncThreeCameraFromOverlay();
    // Keep anchored windows tracking during mouse-drag panning
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
    this._updateSunCycle();
    // Beam pipe drawing preview
    if (this._inputHandler && this._inputHandler.drawingBeamPipe && this._inputHandler.beamPipePath.length > 1) {
      this._renderBeamPipePreview(this._inputHandler.beamPipePath);
    } else {
      this._clearBeamPipePreview();
    }
    this.renderer.render(this.scene, this.camera);
  }

  _updateSunCycle() {
    const now = performance.now();
    const dt = (now - this._lastSunTime) / 1000; // seconds
    this._lastSunTime = now;
    this._sunAngle += this._sunCycleSpeed * dt;

    // Sun orbits in a circle: radius 50, height varies with angle
    const R = 50;
    const x = Math.cos(this._sunAngle) * R;
    const z = Math.sin(this._sunAngle) * R;
    // Sun height: peaks at noon (angle=0), lowest at midnight (angle=π)
    // Range from 10 (low sun / long shadows) to 50 (high noon)
    const elevation = 30 + 20 * Math.cos(this._sunAngle);
    this._sunLight.position.set(x, elevation, z);

    // Intensity: bright at noon, dim at night
    // cos goes from 1 (noon) to -1 (midnight)
    const sunFactor = Math.cos(this._sunAngle);
    const dayness = Math.max(0, sunFactor); // 0 at night, 1 at noon

    // Directional light: strong sunlight, gentle fade at night
    this._sunLight.intensity = 0.6 + 0.8 * dayness;

    // Ambient light: generous baseline so it never gets too dark
    this._ambientLight.intensity = 0.5 + 0.3 * dayness;

    // Color temperature shift: warm orange at sunrise/sunset, bright white at noon, soft blue at night
    if (dayness > 0.01) {
      const r = 1;
      const g = 0.9 + 0.1 * dayness;
      const b = 0.75 + 0.25 * dayness;
      this._sunLight.color.setRGB(r, g, b);
      this._ambientLight.color.setRGB(
        0.95 + 0.05 * dayness,
        0.9 + 0.1 * dayness,
        0.8 + 0.2 * dayness
      );
    } else {
      // Night: soft moonlit blue, not too dark
      this._sunLight.color.setRGB(0.5, 0.6, 0.8);
      this._ambientLight.color.setRGB(0.4, 0.45, 0.6);
    }
  }

  async loadAssets() {
    await this.textureManager.loadTileManifest();
    await this.textureManager.loadDecorationManifest();
  }

  applySnapshot(snapshot) {
    this._snapshot = snapshot;
    this.terrainBuilder.build(snapshot.terrain, this.terrainGroup);
    this.infraBuilder.build(snapshot.infrastructure, this.infrastructureGroup);
    let cutawayRoom = null;
    if (this.wallVisibilityMode === 'cutaway') {
      cutawayRoom = this._detectCutawayRegion(this.hoverCol, this.hoverRow);
    }
    this.wallBuilder.build(snapshot.walls, snapshot.doors, this.wallGroup, this.wallVisibilityMode, cutawayRoom);
    this.componentBuilder.build(snapshot.components, this.componentGroup);
    this.beamBuilder.build(snapshot.beamPaths, this.componentGroup);
    this.equipmentBuilder.build(snapshot.equipment, snapshot.furnishings, this.equipmentGroup);
    this.decorationBuilder.build(snapshot.decorations, this.decorationGroup);
    this.connectionBuilder.build(snapshot.connections, this.connectionGroup);
    this._refreshBeamPipes();
  }

  refresh() {
    const snapshot = buildWorldSnapshot(this.game);
    this.applySnapshot(snapshot);
  }

  _refreshTerrain() {
    const snap = buildWorldSnapshot(this.game);
    this.terrainBuilder.build(snap.terrain, this.terrainGroup);
  }

  _refreshInfra() {
    const snap = buildWorldSnapshot(this.game);
    this.infraBuilder.build(snap.infrastructure, this.infrastructureGroup);
    this._refreshGrid(snap);
  }

  _refreshWalls() {
    const snap = buildWorldSnapshot(this.game);
    let cutawayRoom = null;
    if (this.wallVisibilityMode === 'cutaway') {
      cutawayRoom = this._detectCutawayRegion(this.hoverCol, this.hoverRow);
    }
    this.wallBuilder.build(snap.walls, snap.doors, this.wallGroup, this.wallVisibilityMode, cutawayRoom);
  }

  /**
   * Detect the room under the cursor plus all adjoining rooms for cutaway.
   * Only real walls (interior, shielding, exterior walls) form room boundaries —
   * fences and hedges do not create interior rooms.
   */
  _detectCutawayRegion(startCol, startRow) {
    const wallOcc = this.game.state.wallOccupied || {};
    const doorOcc = this.game.state.doorOccupied || {};
    const MAX_TILES = 500;

    // Flood-fill a room, only treating solid walls (not fences/hedges) as boundaries
    const floodRoom = (sc, sr) => {
      const room = new Set();
      const queue = [`${sc},${sr}`];
      room.add(queue[0]);

      while (queue.length > 0 && room.size < MAX_TILES) {
        const key = queue.shift();
        const [c, r] = key.split(',').map(Number);

        const tryNeighbor = (nc, nr, edgeKeys) => {
          const nk = `${nc},${nr}`;
          if (room.has(nk)) return;
          // Check if any edge key has a room-forming wall (not a fence/hedge)
          const blocked = edgeKeys.some(ek => {
            const wType = wallOcc[ek];
            if (!wType) return false;
            if (doorOcc[ek]) return false; // doors don't block
            return this._isRoomWall(wType);
          });
          if (!blocked) {
            room.add(nk);
            queue.push(nk);
          }
        };

        tryNeighbor(c + 1, r, [`${c},${r},e`, `${c+1},${r},w`]);
        tryNeighbor(c - 1, r, [`${c-1},${r},e`, `${c},${r},w`]);
        tryNeighbor(c, r + 1, [`${c},${r},s`, `${c},${r+1},n`]);
        tryNeighbor(c, r - 1, [`${c},${r-1},s`, `${c},${r},n`]);
      }
      return room;
    };

    const primaryRoom = floodRoom(startCol, startRow);
    // If flood fill hit the cap, hover is outdoors — no cutaway
    if (primaryRoom.size >= MAX_TILES) return null;

    // Find adjoining rooms: for each wall on the room boundary,
    // check the tile on the other side; if it's not in the primary room,
    // flood-fill from there and merge if it's also an enclosed room
    const region = new Set(primaryRoom);
    const checkedNeighborRooms = new Set();
    const walls = this.game.state.walls || [];

    for (const w of walls) {
      const { col, row, edge, type } = w;
      if (!this._isRoomWall(type)) continue;

      // Does this wall border the primary room?
      let insideTile = null;
      let outsideTile = null;
      if (edge === 'e' || edge === 'w') {
        const neighbor = edge === 'e' ? `${col + 1},${row}` : `${col - 1},${row}`;
        const self = `${col},${row}`;
        if (primaryRoom.has(self) && !primaryRoom.has(neighbor)) {
          insideTile = self; outsideTile = neighbor;
        } else if (primaryRoom.has(neighbor) && !primaryRoom.has(self)) {
          insideTile = neighbor; outsideTile = self;
        }
      } else {
        const neighbor = edge === 's' ? `${col},${row + 1}` : `${col},${row - 1}`;
        const self = `${col},${row}`;
        if (primaryRoom.has(self) && !primaryRoom.has(neighbor)) {
          insideTile = self; outsideTile = neighbor;
        } else if (primaryRoom.has(neighbor) && !primaryRoom.has(self)) {
          insideTile = neighbor; outsideTile = self;
        }
      }

      if (!outsideTile || checkedNeighborRooms.has(outsideTile)) continue;
      checkedNeighborRooms.add(outsideTile);

      const [nc, nr] = outsideTile.split(',').map(Number);
      const adjRoom = floodRoom(nc, nr);
      // Only include enclosed rooms, not the outdoors
      if (adjRoom.size < MAX_TILES) {
        for (const t of adjRoom) region.add(t);
      }
    }

    return region;
  }

  /** Returns true if the wall type forms a real room boundary (not a fence/hedge). */
  _isRoomWall(wallType) {
    const def = WALL_TYPES[wallType];
    if (!def) return true; // unknown type — treat as solid
    const sub = def.subsection;
    // Fences and hedges don't form rooms
    if (sub === 'fencing' || sub === 'hedges') return false;
    // Exterior subsection includes both real walls and fences — filter by id
    if (sub === 'exterior' && wallType !== 'exteriorWall') return false;
    return true;
  }

  _refreshEquipment() {
    const snap = buildWorldSnapshot(this.game);
    this.equipmentBuilder.build(snap.equipment, snap.furnishings, this.equipmentGroup);
  }

  _refreshDecorations() {
    const snap = buildWorldSnapshot(this.game);
    this.decorationBuilder.build(snap.decorations, this.decorationGroup);
  }

  _refreshConnections() {
    const snap = buildWorldSnapshot(this.game);
    this.connectionBuilder.build(snap.connections, this.connectionGroup);
  }

  _refreshBeamPipes() {
    // Remove old beam pipe meshes
    if (this._beamPipeMeshes) {
      for (const mesh of this._beamPipeMeshes) {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    }
    this._beamPipeMeshes = [];

    const pipes = this.game.state.beamPipes || [];
    if (pipes.length === 0) return;

    const PIPE_RADIUS = 0.08;
    const PIPE_Y = 1.0;

    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x44cc44,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.8,
    });

    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length < 2) continue;

      for (let i = 0; i < pipe.path.length - 1; i++) {
        const a = pipe.path[i];
        const b = pipe.path[i + 1];

        const x1 = a.col * 2 + 1;
        const z1 = a.row * 2 + 1;
        const x2 = b.col * 2 + 1;
        const z2 = b.row * 2 + 1;

        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.01) continue;

        const geo = new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, length, 6);
        geo.rotateZ(Math.PI / 2);

        const mesh = new THREE.Mesh(geo, pipeMat.clone());
        mesh.position.set((x1 + x2) / 2, PIPE_Y, (z1 + z2) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        this.scene.add(mesh);
        this._beamPipeMeshes.push(mesh);
      }
    }
  }

  _renderBeamPipePreview(path) {
    this._clearBeamPipePreview();
    if (!path || path.length < 2) return;

    const points = path.map(p => new THREE.Vector3(p.col * 2 + 1, 1.0, p.row * 2 + 1));
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.5 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this._beamPipePreviewLine = line;
  }

  _clearBeamPipePreview() {
    if (this._beamPipePreviewLine) {
      this.scene.remove(this._beamPipePreviewLine);
      if (this._beamPipePreviewLine.geometry) this._beamPipePreviewLine.geometry.dispose();
      if (this._beamPipePreviewLine.material) this._beamPipePreviewLine.material.dispose();
      this._beamPipePreviewLine = null;
    }
  }

  _refreshBeam() {
    const snap = buildWorldSnapshot(this.game);
    this.beamBuilder.build(snap.beamPaths, this.componentGroup);
  }

  _refreshComponents() {
    const snap = buildWorldSnapshot(this.game);
    this.componentBuilder.build(snap.components, this.componentGroup);
  }

  screenToGrid(screenX, screenY) {
    const world = this.screenToWorld(screenX, screenY);
    return {
      col: Math.floor(world.x / 2),
      row: Math.floor(world.y / 2),
    };
  }

  dispose() {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    window.removeEventListener('resize', this._boundOnResize);
    this.renderer.dispose();
    const threeCanvas = this.renderer.domElement;
    if (threeCanvas.parentNode) threeCanvas.parentNode.removeChild(threeCanvas);
  }
}

// --- Bridge DOM-based UI methods from legacy Renderer prototype ---
// These are added by hud.js, overlays.js, designer-renderer.js via
// Renderer.prototype.methodName = function() {...}
// We copy them onto ThreeRenderer.prototype so they work on our instance.

const domMethods = [
  // hud.js
  '_updateHUD', '_updateBeamSummary', '_generateCategoryTabs',
  '_renderPalette', '_refreshPalette', 'updatePalette',
  '_renderMachineTypeSelector', '_bindHUDEvents',
  '_updateSystemStatsVisibility', '_updateSystemStatsContent',
  '_refreshSystemStatsValues',
  '_renderVacuumStats', '_renderRfPowerStats', '_renderCryoStats',
  '_renderCoolingStats', '_renderPowerStats', '_renderDataControlsStats', '_renderOpsStats',
  '_createPaletteItem', '_removeParamFlyout', '_showPalettePreview', '_hidePalettePreview',
  '_sstat', '_ssep', '_detailRow', '_fmtPressure', '_superscript', '_qualityColor', '_marginColor',
  // overlays.js
  'showPopup', 'showFacilityPopup', 'hidePopup',
  'drawSchematic', '_schematicDrawers',
  '_paramLabel', '_fmtParam', '_wirePopupSliders',
  '_buildTreeLayout', '_renderTechTree', '_bindTreeEvents', '_updateTreeProgress',
  '_showResearchPopover', '_scrollToCategory', '_applyTreeTransform',
  '_renderGoalsOverlay',
  '_openBeamlineWindow', '_openMachineWindow', '_openEquipmentWindow', '_refreshContextWindows',
  '_updateAnchoredWindows',
];

for (const method of domMethods) {
  if (LegacyRenderer.prototype[method] && !ThreeRenderer.prototype[method]) {
    ThreeRenderer.prototype[method] = LegacyRenderer.prototype[method];
  }
}
