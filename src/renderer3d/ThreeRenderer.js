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
    this.wallVisibilityMode = 'up';
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
    // Isometric view: position camera at equal X/Y/Z offset from origin
    // and lookAt the origin. This produces the standard isometric projection
    // where X and Z axes are equally foreshortened.
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xfff5e6, 0.4);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(-30, 40, -30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -60;
    dirLight.shadow.camera.right = 60;
    dirLight.shadow.camera.top = 60;
    dirLight.shadow.camera.bottom = -60;
    this.scene.add(dirLight);

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

    // Frustum size from zoom: when zoom=1 the old renderer showed ~20 frustum units
    this._frustumSize = 20 / this.zoom;
    this._updateCameraFrustum();
    this._updateCameraLookAt();
  }

  // --- State setters (InputHandler compatibility) ---

  updateHover(col, row) {
    this.hoverCol = col;
    this.hoverRow = row;
  }

  setBuildMode(active, toolType) {
    this.buildMode = active;
    this.selectedToolType = toolType || null;
    if (active) this.bulldozerMode = false;
  }

  setBulldozerMode(active) {
    this.bulldozerMode = active;
    if (active) { this.buildMode = false; this.selectedToolType = null; }
    this.canvas.style.cursor = active ? 'crosshair' : '';
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
  updatePlacementDir(dir) { this.placementDir = dir; }

  // --- Render delegation methods (called by game events and legacy code) ---
  // These bridge calls from code that expects the old Renderer API.
  // Methods that do 2D PixiJS rendering are stubs for now (rendered by Three.js instead).

  _renderCursors() { /* overlay cursor rendering — future */ }
  _renderComponents() { this._refreshComponents(); }
  _renderBeam() { this._refreshBeam(); }
  _renderInfrastructure() { this._refreshInfra(); }
  _renderZones() { /* zone overlays — future (3D handles terrain coloring) */ }
  _renderWalls() { this._refreshWalls(); }
  _renderDoors() { this._refreshWalls(); }
  _renderFacilityEquipment() { this._refreshEquipment(); }
  _renderConnections() { this._refreshConnections(); }
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
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
  }

  /** Shared material factories for previews. */
  _previewMat(color = 0x44aaff, opacity = 0.35) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: true, side: THREE.DoubleSide,
    });
  }
  _previewEdgeMat(color = 0x44aaff) {
    return new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.8 });
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
        mesh.position.set(c * 2 + 1, 0.02, r * 2 + 1);
        this.previewGroup.add(mesh);
      }
    }
    // Wireframe border around full rectangle
    const edgeMat = this._previewEdgeMat(color);
    const x0 = minC * 2, x1 = (maxC + 1) * 2;
    const z0 = minR * 2, z1 = (maxR + 1) * 2;
    const pts = [
      new THREE.Vector3(x0, 0.04, z0),
      new THREE.Vector3(x1, 0.04, z0),
      new THREE.Vector3(x1, 0.04, z1),
      new THREE.Vector3(x0, 0.04, z1),
      new THREE.Vector3(x0, 0.04, z0),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this.previewGroup.add(new THREE.Line(lineGeo, edgeMat));
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
      mesh.position.set(tile.col * 2 + 1, 0.02, tile.row * 2 + 1);
      this.previewGroup.add(mesh);
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
      0.03,
      tileZ + subRow * subSize + (h * subSize) / 2
    );
    this.previewGroup.add(mesh);
    // Wireframe outline
    const edgeMat = this._previewEdgeMat(0x88ccff);
    const x0 = tileX + subCol * subSize;
    const z0 = tileZ + subRow * subSize;
    const x1 = x0 + w * subSize;
    const z1 = z0 + h * subSize;
    const pts = [
      new THREE.Vector3(x0, 0.04, z0), new THREE.Vector3(x1, 0.04, z0),
      new THREE.Vector3(x1, 0.04, z1), new THREE.Vector3(x0, 0.04, z1),
      new THREE.Vector3(x0, 0.04, z0),
    ];
    this.previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
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
        mesh.position.set(c * 2 + 1, 0.02, r * 2 + 1);
        this.previewGroup.add(mesh);
      }
    }
    // Red border
    const edgeMat = this._previewEdgeMat(0xff4444);
    const x0 = minC * 2, x1 = (maxC + 1) * 2;
    const z0 = minR * 2, z1 = (maxR + 1) * 2;
    const pts = [
      new THREE.Vector3(x0, 0.04, z0), new THREE.Vector3(x1, 0.04, z0),
      new THREE.Vector3(x1, 0.04, z1), new THREE.Vector3(x0, 0.04, z1),
      new THREE.Vector3(x0, 0.04, z0),
    ];
    this.previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  /**
   * Render wall placement preview — semi-transparent wall slabs along the path.
   */
  renderWallPreview(path, wallType) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const mat = this._previewMat(0xffffff, 0.4);
    const wallH = 0.75; // half-height preview walls (world units)
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      const geo = isNS
        ? new THREE.BoxGeometry(2, wallH, 0.08)
        : new THREE.BoxGeometry(0.08, wallH, 2);
      const mesh = new THREE.Mesh(geo, mat);
      const pos = this._wallEdgePosition(seg.col, seg.row, seg.edge);
      mesh.position.set(pos.x, wallH / 2, pos.z);
      this.previewGroup.add(mesh);
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
      this.previewGroup.add(mesh);
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
    const y = 0.05;
    const crossMat = this._previewEdgeMat(color);
    // Horizontal bar
    const h1 = [new THREE.Vector3(pos.x - size, y, pos.z), new THREE.Vector3(pos.x + size, y, pos.z)];
    this.previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h1), crossMat));
    // Vertical bar
    const h2 = [new THREE.Vector3(pos.x, y, pos.z - size), new THREE.Vector3(pos.x, y, pos.z + size)];
    this.previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h2), crossMat));
    // Small filled quad on the edge
    const quadMat = this._previewMat(color, 0.25);
    const isNS = edge === 'n' || edge === 's';
    const quadGeo = isNS
      ? new THREE.PlaneGeometry(1.6, 0.3)
      : new THREE.PlaneGeometry(0.3, 1.6);
    quadGeo.rotateX(-Math.PI / 2);
    const quad = new THREE.Mesh(quadGeo, quadMat);
    quad.position.set(pos.x, 0.03, pos.z);
    this.previewGroup.add(quad);
  }

  /** Hover cursor for infrastructure placement — single tile highlight. */
  renderInfraHoverCursor(col, row, color) {
    this._clearPreview();
    const tileColor = (typeof color === 'number') ? color : 0x44aaff;
    const mat = this._previewMat(tileColor, 0.25);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(col * 2 + 1, 0.02, row * 2 + 1);
    this.previewGroup.add(mesh);
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
      0.03,
      tileZ + entry.subRow * subSize + (h * subSize) / 2
    );
    this.previewGroup.add(mesh);
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
    mesh.position.set(col * 2 + 1, 0.02, row * 2 + 1);
    this.previewGroup.add(mesh);
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

  // Wall/door visibility stubs
  _applyWallVisibility() { /* future */ }
  _applyDoorVisibility() { /* future */ }

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
    // Move both position and target by pan offset — maintains isometric angle
    this.camera.position.set(50 + this._panX, 50, 50 + this._panY);
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
    this.renderer.render(this.scene, this.camera);
  }

  async loadAssets() {
    await this.textureManager.loadTileManifest();
    await this.textureManager.loadDecorationManifest();
  }

  applySnapshot(snapshot) {
    this._snapshot = snapshot;
    this.terrainBuilder.build(snapshot.terrain, this.terrainGroup);
    this.infraBuilder.build(snapshot.infrastructure, this.infrastructureGroup);
    this.wallBuilder.build(snapshot.walls, snapshot.doors, this.wallGroup, this.wallVisibilityMode);
    this.componentBuilder.build(snapshot.components, this.componentGroup);
    this.beamBuilder.build(snapshot.beamPaths, this.componentGroup);
    this.equipmentBuilder.build(snapshot.equipment, snapshot.furnishings, this.equipmentGroup);
    this.decorationBuilder.build(snapshot.decorations, this.decorationGroup);
    this.connectionBuilder.build(snapshot.connections, this.connectionGroup);
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
    this.wallBuilder.build(snap.walls, snap.doors, this.wallGroup, this.wallVisibilityMode);
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
  '_openBeamlineWindow', '_openMachineWindow', '_refreshContextWindows',
  '_updateAnchoredWindows',
];

for (const method of domMethods) {
  if (LegacyRenderer.prototype[method] && !ThreeRenderer.prototype[method]) {
    ThreeRenderer.prototype[method] = LegacyRenderer.prototype[method];
  }
}
