// src/renderer3d/ThreeRenderer.js — Three.js scaffold with isometric camera
// THREE is loaded as a CDN global — do NOT import it

import { TextureManager } from './texture-manager.js';
import { TerrainBuilder } from './terrain-builder.js';
import { InfraBuilder } from './infra-builder.js';
import { WallBuilder } from './wall-builder.js';
import { ComponentBuilder, createBeamlineGhost, getAccentMaterial } from './component-builder.js';
import { BeamBuilder } from './beam-builder.js';
import { EquipmentBuilder } from './equipment-builder.js';
import { DecorationBuilder } from './decoration-builder.js';
import { ConnectionBuilder } from './connection-builder.js';
import { buildWorldSnapshot } from './world-snapshot.js';
import { Overlay } from './overlay.js';
import { Renderer as LegacyRenderer } from '../renderer/Renderer.js';
import { tileCenterIso, gridToIso } from '../renderer/grid.js';
import { WALL_TYPES, ZONES } from '../data/infrastructure.js';
import { COMPONENTS } from '../data/components.js';
import { ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { DIR, DIR_DELTA, turnLeft } from '../data/directions.js';
import { PLACEABLES } from '../data/placeables/index.js';

/**
 * Collapse a pipe path into "runs" — maximal sequences of collinear segments.
 * Returns an array of { start, end } in grid coords. A straight path yields
 * one run; an L-shape yields two.
 */
function pipePathRuns(path) {
  if (!path || path.length < 2) return [];
  const runs = [];
  let runStart = path[0];
  let prev = path[0];
  let prevDc = null, prevDr = null;
  const EPS = 1e-6;
  for (let i = 1; i < path.length; i++) {
    const curr = path[i];
    const dc = curr.col - prev.col;
    const dr = curr.row - prev.row;
    if (Math.abs(dc) < EPS && Math.abs(dr) < EPS) continue;
    const ndc = Math.sign(dc);
    const ndr = Math.sign(dr);
    if (prevDc === null) {
      prevDc = ndc; prevDr = ndr;
    } else if (ndc !== prevDc || ndr !== prevDr) {
      runs.push({ start: runStart, end: prev });
      runStart = prev;
      prevDc = ndc; prevDr = ndr;
    }
    prev = curr;
  }
  if (prevDc !== null) runs.push({ start: runStart, end: prev });
  return runs;
}

export class ThreeRenderer {
  constructor(game, spriteManager) {
    this.game = game;
    this.sprites = spriteManager;

    this._panX = 0;
    this._panY = 0;
    this.zoom = 1;

    // View rotation (RCT2-style Q/E 90° orbit). Angle is in radians around
    // the Y axis, camera orbits around (_panX, _panY) at the dimetric elevation.
    this._viewRotationIndex = 0;      // 0..3 (current snap target)
    this._viewRotationAngle = 0;      // current animated angle (rad)
    this._viewRotFromAngle = 0;
    this._viewRotToAngle = 0;
    this._viewRotStartMs = 0;
    this._viewRotDurationMs = 400;
    this._viewRotating = false;

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
    this.beamPipeGroup = null;
    this.decorationGroup = null;
    this.previewGroup = null;

    this._boundOnResize = this._onResize.bind(this);

    this.textureManager = new TextureManager();
    this.terrainBuilder = new TerrainBuilder(this.textureManager);
    this.infraBuilder = new InfraBuilder(this.textureManager);
    this.wallBuilder = new WallBuilder(this.textureManager);
    this.componentBuilder = new ComponentBuilder();
    this.pipeAttachmentBuilder = new ComponentBuilder();
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this._sunLight.shadow.mapSize.width = 4096;
    this._sunLight.shadow.mapSize.height = 4096;
    this._sunLight.shadow.bias = -0.0005;
    this._sunLight.shadow.normalBias = 0.01;
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
    this._lastLodDetail = undefined; // force first LOD update

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

    this.pipeAttachmentGroup = new THREE.Group();
    this.pipeAttachmentGroup.name = 'pipeAttachments';
    this.scene.add(this.pipeAttachmentGroup);

    this.beamPipeGroup = new THREE.Group();
    this.beamPipeGroup.name = 'beampipes';
    this.scene.add(this.beamPipeGroup);

    this.decorationGroup = new THREE.Group();
    this.decorationGroup.name = 'decorations';
    this.scene.add(this.decorationGroup);

    // Preview group — semi-transparent geometry for placement/demolish feedback
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'preview';
    this.previewGroup.renderOrder = 999;
    this.scene.add(this.previewGroup);

    // Grid overlay group — placement grid lines (separate from preview so _clearPreview doesn't wipe them)
    this.gridOverlayGroup = new THREE.Group();
    this.gridOverlayGroup.name = 'gridOverlay';
    this.gridOverlayGroup.renderOrder = 997;
    this.scene.add(this.gridOverlayGroup);

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
          this._refreshZones();
          if (this._refreshPalette) this._refreshPalette();
          break;
        case 'wallsChanged':
        case 'doorsChanged':
          this._refreshWalls();
          break;
        case 'placeableChanged':
          // Unified placeable system emits this on every place/remove.
          // Rebuild equipment (includes furnishings), decorations, and
          // components so any kind shows up immediately.
          this._refreshEquipment();
          this._refreshDecorations();
          this._refreshComponents();
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

    // Set initial camera pan target (matches the old "iso origin at
    // screen.width/2, screen.height/3" offset). Derive panX/panY from that
    // offset using the rotation=0 iso math, then apply.
    {
      const screenW = this.app.screen.width;
      const screenH = this.app.screen.height;
      const isoCenterY = (screenH / 2 - screenH / 3) / this.zoom;
      const col = (isoCenterY / 16) / 2;
      const row = col;
      this._panX = col * 2;
      this._panY = row * 2;
      this._syncOverlayFromPan();
      this._updateCameraLookAt();
    }

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
    // Raycast the ground plane through the current camera so this respects
    // view rotation. Returns iso-pixel coords (the downstream isoToGrid /
    // isoToSubGrid helpers expect base-iso coordinates, so we convert the
    // fractional grid position back through gridToIso).
    const hit = this._raycastGround(screenX, screenY);
    if (!hit) {
      // Fallback before the camera is ready.
      return {
        x: (screenX - (this.world?.x || 0)) / this.zoom,
        y: (screenY - (this.world?.y || 0)) / this.zoom,
      };
    }
    // Terrain tile (col, row) is placed at world (col*2, 0, row*2)..(+2, +2).
    const fCol = hit.x / 2;
    const fRow = hit.z / 2;
    return gridToIso(fCol, fRow);
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
    const targets = [this.componentGroup, this.equipmentGroup, this.connectionGroup, this.wallGroup, this.beamPipeGroup, this.pipeAttachmentGroup];
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
      if (obj.parent === this.pipeAttachmentGroup) {
        // Reverse-lookup the attachment id from the pipeAttachmentBuilder's
        // mesh map. pipeId is stored on userData by component-builder.
        let attachmentId = null;
        for (const [id, mesh] of this.pipeAttachmentBuilder._meshMap) {
          if (mesh === obj) { attachmentId = id; break; }
        }
        return { group: 'attachment', rootObj: obj, attachmentId, pipeId: obj.userData.pipeId || null };
      }
      if (obj.parent === this.equipmentGroup) {
        return { group: 'equipment', rootObj: obj };
      }
      if (obj.parent === this.decorationGroup) {
        return { group: 'decoration', rootObj: obj };
      }
      if (obj.parent === this.wallGroup) {
        return { group: 'wall', rootObj: obj };
      }
      if (obj.parent === this.connectionGroup) {
        return { group: 'connection', rootObj: obj };
      }
      if (obj.parent === this.beamPipeGroup) {
        return { group: 'beampipe', rootObj: obj, pipeId: obj.userData.pipeId || null };
      }
      obj = obj.parent;
    }
    return null;
  }

  // --- Camera controls (PixiJS-compatible, syncs to Three.js) ---

  /**
   * Raycast a screen pixel to the y=0 plane. Returns a THREE.Vector3 or null.
   * Uses the current camera orientation, so it respects view rotation.
   */
  _raycastGround(screenX, screenY) {
    if (!this.camera || !this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  /**
   * Keep the PixiJS world.x/y/scale in sync with the current pan/zoom. These
   * are legacy bookkeeping readers (save/load, some debug paths). They use
   * the rotation=0 iso formula regardless of current rotation, since nothing
   * is drawn through the overlay.
   */
  _syncOverlayFromPan() {
    if (!this.app || !this.world) return;
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    // Convert world XZ pan → grid → iso pixel coords via the base formula.
    const col = this._panX / 2;
    const row = this._panY / 2;
    const isoX = (col - row) * 32;
    const isoY = (col + row) * 16;
    this.world.x = screenW / 2 - this.zoom * isoX;
    this.world.y = screenH / 2 - this.zoom * isoY;
    this.world.scale.set(this.zoom);
    this._frustumSize = Math.SQRT2 * screenH / (32 * this.zoom);
    this._updateCameraFrustum();
  }

  zoomAt(screenX, screenY, delta) {
    // Remember which world point is under the cursor before the zoom.
    const before = this._raycastGround(screenX, screenY);
    this.zoom = Math.max(0.2, Math.min(8, this.zoom + delta));
    // Rebuild frustum from new zoom so the subsequent raycast uses the new view.
    const screenH = this.app.screen.height;
    this._frustumSize = Math.SQRT2 * screenH / (32 * this.zoom);
    this._updateCameraFrustum();
    // Find where the cursor now lands, and shift the pan so the original
    // world point ends up back under the cursor.
    if (before) {
      const after = this._raycastGround(screenX, screenY);
      if (after) {
        this._panX += (before.x - after.x);
        this._panY += (before.z - after.z);
      }
    }
    this._updateCameraLookAt();
    this._syncOverlayFromPan();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  /**
   * Pan the scene by (dxScreen, dyScreen) screen pixels. Works for any view
   * rotation because it derives the world XZ delta via raycasting.
   *
   * Convention: positive dxScreen means "content follows cursor to the right"
   * (natural mouse-drag semantics). WASD callers pass inverted deltas so that
   * D = camera moves right (content shifts left) feels correct.
   */
  panBy(dxScreen, dyScreen) {
    if (!this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const p0 = this._raycastGround(cx, cy);
    const p1 = this._raycastGround(cx + dxScreen, cy + dyScreen);
    if (!p0 || !p1) return;
    // p1 - p0 is the world delta that the offset cursor corresponds to.
    // Subtract so that dragging the cursor right shifts the lookAt LEFT,
    // making the scene follow the cursor (natural drag feel).
    this._panX -= (p1.x - p0.x);
    this._panY -= (p1.z - p0.z);
    this._updateCameraLookAt();
    this._syncOverlayFromPan();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  /**
   * Pan the camera by screen-aligned deltas expressed in world-pan units:
   *   dxRight > 0 moves the camera right (content shifts LEFT on screen)
   *   dyUp    > 0 moves the camera up/forward (content shifts DOWN on screen)
   * Computed directly from the current view rotation angle — no raycast, so
   * it isn't affected by stale camera.matrixWorld between frames.
   */
  panScreenAligned(dxRight, dyUp) {
    const a = this._viewRotationAngle;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    // Ground-projected camera axes for the dimetric rig (pre-normalized by √2):
    //   right   = Ry(a) · (1, 0, -1)/√2 → ((cos - sin), -(cos + sin))/√2
    //   forward = Ry(a) · (-1, 0, -1)/√2 → (-(cos + sin), (sin - cos))/√2
    const INV_SQRT2 = 1 / Math.SQRT2;
    const rx = (cosA - sinA) * INV_SQRT2;
    const rz = -(cosA + sinA) * INV_SQRT2;
    const fx = -(cosA + sinA) * INV_SQRT2;
    const fz = (sinA - cosA) * INV_SQRT2;
    this._panX += dxRight * rx + dyUp * fx;
    this._panY += dxRight * rz + dyUp * fz;
    this._updateCameraLookAt();
    this._syncOverlayFromPan();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  /**
   * Absolute drag pan: given the pan state at drag start and the cumulative
   * mouse pixel delta, restore-and-shift so repeated calls produce stable
   * behaviour independent of per-frame drift.
   */
  setPanFromDragDelta(startPanX, startPanY, dxTotal, dyTotal) {
    this._panX = startPanX;
    this._panY = startPanY;
    this._updateCameraLookAt();
    this.panBy(dxTotal, dyTotal);
  }

  /**
   * Rotate the view by ±90° (RCT2-style). Animates to the new rest angle.
   */
  rotateView(delta) {
    if (this._viewRotating) return;
    const step = delta > 0 ? 1 : -1;
    this._viewRotationIndex = (((this._viewRotationIndex + step) % 4) + 4) % 4;
    this._viewRotFromAngle = this._viewRotationAngle;
    this._viewRotToAngle = this._viewRotFromAngle + step * Math.PI / 2;
    this._viewRotStartMs = performance.now();
    this._viewRotating = true;
    // Hide the PixiJS overlay during the animation. Nothing is currently
    // drawn through it in the 3D renderer, but this keeps the door open.
    if (this.world) this.world.visible = false;
  }

  _tickViewRotation() {
    if (!this._viewRotating) return;
    const t = Math.min(1, (performance.now() - this._viewRotStartMs) / this._viewRotDurationMs);
    // easeInOutQuad
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    this._viewRotationAngle = this._viewRotFromAngle + (this._viewRotToAngle - this._viewRotFromAngle) * ease;
    this._updateCameraLookAt();
    if (t >= 1) {
      this._viewRotating = false;
      this._viewRotationAngle = this._viewRotToAngle;
      this._updateCameraLookAt();
      if (this.world) this.world.visible = true;
    }
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
    if (this.zoneGroup) this.zoneGroup.visible = this.zoneOverlayVisible;
    return this.zoneOverlayVisible;
  }

  updateCursorBendDir(dir) { this.cursorBendDir = dir; }
  updatePlacementDir(dir) { this.placementDir = dir; this._renderCursors(); }

  /**
   * Swap the accent material on every placed component belonging to the
   * given beamline. O(N) in placements on that beamline; O(1) new materials.
   *
   * @param {string} beamlineId
   * @param {number} colorHex  24-bit color integer
   */
  updateBeamlineAccent(beamlineId, colorHex) {
    if (!this.componentBuilder || !this.componentBuilder._meshMap) return;
    for (const wrapper of this.componentBuilder._meshMap.values()) {
      if (wrapper.userData.beamlineId !== beamlineId) continue;
      const compType = wrapper.userData.compType;
      if (!compType) continue;
      // Walk the wrapper (Group -> visual Group -> role meshes) and swap
      // the material on any mesh tagged with userData.role === 'accent'.
      wrapper.traverse((child) => {
        if (child.isMesh && child.userData.role === 'accent') {
          child.material = getAccentMaterial(compType, colorHex);
        }
      });
    }
  }

  // --- Render delegation methods (called by game events and legacy code) ---
  // These bridge calls from code that expects the old Renderer API.
  // Methods that do 2D PixiJS rendering are stubs for now (rendered by Three.js instead).

  _renderCursors() {
    this._clearPreview();

    // Show grid lines around cursor when in any placement mode
    const placer = this.game._designPlacer;
    const inPlaceMode = this.buildMode || this.bulldozerMode || (placer && placer.active);
    if (inPlaceMode) {
      this._renderGridAroundCursor(this.hoverCol, this.hoverRow);
    }

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
      const comp = this.selectedToolType ? COMPONENTS[this.selectedToolType] : null;
      const isDrawn = comp && comp.isDrawnConnection;
      // Beamline component placement is handled by the sub-tile ghost preview
      // drawn from InputHandler.mousemove. Skip the legacy integer-tile cursor
      // here so the two don't disagree on placement position.
      if (comp && comp.placement === 'module' && !isDrawn) return;
      if (isDrawn) return;
      const dir = this.placementDir || DIR.NE;
      const delta = DIR_DELTA[dir];
      const perpDelta = DIR_DELTA[turnLeft(dir)];

      // Center of hover tile in world coords
      const cx = this.hoverCol * 2 + 1;
      const cz = this.hoverRow * 2 + 1;

      // Direction vectors
      const dx = delta.dc, dz = delta.dr;
      const px = perpDelta.dc, pz = perpDelta.dr;

      if (!isDrawn) {
        // Draw hover cursor showing footprint of selected component using sub-unit dims
        const subL = comp ? (comp.subL || 4) : 4;
        const subW = comp ? (comp.subW || 4) : 4;

        // Dimensions in world units (1 tile = 2 world units = 4 sub-units, so 1 sub = 0.5 world)
        const wLen = subL * 0.5;   // length in world units
        const wWid = subW * 0.5;   // width in world units

        // Rectangle: centered on tile, extends wLen along dir, wWid perpendicular
        const x0 = cx - px * wWid / 2;
        const z0 = cz - pz * wWid / 2;
        const x1 = cx + px * wWid / 2;
        const z1 = cz + pz * wWid / 2;
        const x2 = cx + dx * wLen + px * wWid / 2;
        const z2 = cz + dz * wLen + pz * wWid / 2;
        const x3 = cx + dx * wLen - px * wWid / 2;
        const z3 = cz + dz * wLen - pz * wWid / 2;

        // Check tile availability
        const available = this.game.registry.sharedOccupied[this.hoverCol + ',' + this.hoverRow] === undefined;
        const color = available ? 0x4488ff : 0xff4444;

        // Draw filled preview quad
        const mat = this._previewMat(color, 0.35);
        const geo = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          x0, 0.1, z0,  x1, 0.1, z1,  x2, 0.1, z2,
          x0, 0.1, z0,  x2, 0.1, z2,  x3, 0.1, z3,
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        this._addPreviewMesh(new THREE.Mesh(geo, mat));

        // Wireframe border
        const edgeMat = this._previewEdgeMat(color);
        const pts = [
          new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z1),
          new THREE.Vector3(x2, 0.12, z2), new THREE.Vector3(x3, 0.12, z3),
          new THREE.Vector3(x0, 0.12, z0),
        ];
        this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));

        // Direction arrow on base tile (shows output direction)
        const arrowMat = this._previewEdgeMat(0x88bbff);
        const arrowStart = new THREE.Vector3(cx - dx * 0.4, 0.15, cz - dz * 0.4);
        const arrowEnd = new THREE.Vector3(cx + dx * 0.6, 0.15, cz + dz * 0.6);
        this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowStart, arrowEnd]), arrowMat));
        // Arrowhead chevron
        const tipX = cx + dx * 0.6, tipZ = cz + dz * 0.6;
        const chevLen = 0.3;
        const chevPts = [
          new THREE.Vector3(tipX - dx * chevLen + px * chevLen, 0.15, tipZ - dz * chevLen + pz * chevLen),
          new THREE.Vector3(tipX, 0.15, tipZ),
          new THREE.Vector3(tipX - dx * chevLen - px * chevLen, 0.15, tipZ - dz * chevLen - pz * chevLen),
        ];
        this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(chevPts), arrowMat));
      } else {
        // Drawn connection (beam pipe): bidirectional arrow only, no tile highlight
        const arrowMat = this._previewEdgeMat(0x88bbff);
        const halfLen = 0.6;
        const arrowStart = new THREE.Vector3(cx - dx * halfLen, 0.15, cz - dz * halfLen);
        const arrowEnd = new THREE.Vector3(cx + dx * halfLen, 0.15, cz + dz * halfLen);
        this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowStart, arrowEnd]), arrowMat));
        // Chevron on both ends
        const chevLen = 0.25;
        for (const sign of [1, -1]) {
          const tipX = cx + sign * dx * halfLen, tipZ = cz + sign * dz * halfLen;
          const chevPts = [
            new THREE.Vector3(tipX - sign * dx * chevLen + px * chevLen, 0.15, tipZ - sign * dz * chevLen + pz * chevLen),
            new THREE.Vector3(tipX, 0.15, tipZ),
            new THREE.Vector3(tipX - sign * dx * chevLen - px * chevLen, 0.15, tipZ - sign * dz * chevLen - pz * chevLen),
          ];
          this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(chevPts), arrowMat));
        }
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
  _renderZones() { this._refreshZones(); }
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
    this._clearGridOverlay();
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
    // Depth-tested outline so back edges of the box are hidden behind the
    // front faces. Without this, every edge renders through the mesh and
    // the back-top edges look like a phantom duplicate floating above.
    const lineMat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.95,
    });
    const wrapper = new THREE.Group();

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
    this._renderGridAroundCursor(col2, row2);
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
   * Demolish hover for a single tile-shaped object (floor, zone, utility).
   * Draws just the wireframe border at floor level — no filled plane — so
   * the highlight reads as "this tile" without a fill that smears past the
   * actual object footprint.
   */
  renderDemolishTileOutline(col, row) {
    this._clearPreview();
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.95,
    });
    const x0 = col * 2, x1 = col * 2 + 2;
    const z0 = row * 2, z1 = row * 2 + 2;
    const y = 0.05;
    const pts = [
      new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0),
      new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1),
      new THREE.Vector3(x0, y, z0),
    ];
    this.previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  /**
   * Demolish hover for a wall/door edge. Draws a thin red line along the
   * wall's footprint at floor level. Half-tile long, oriented with the edge.
   */
  renderDemolishEdgeOutline(col, row, edge) {
    this._clearPreview();
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.95,
    });
    const y = 0.05;
    const pos = this._wallEdgePosition(col, row, edge);
    const isNS = edge === 'n' || edge === 's';
    let p0, p1;
    if (isNS) {
      p0 = new THREE.Vector3(pos.x - 1, y, pos.z);
      p1 = new THREE.Vector3(pos.x + 1, y, pos.z);
    } else {
      p0 = new THREE.Vector3(pos.x, y, pos.z - 1);
      p1 = new THREE.Vector3(pos.x, y, pos.z + 1);
    }
    this.previewGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, p1]), edgeMat));
  }

  /**
   * Render demolish preview — red translucent rectangle over the drag area.
   * Used by drag-select multi-tile demolish; single-tile hover uses
   * renderDemolishTileOutline instead so it reads as a thin object outline.
   */
  renderDemolishPreview(col1, row1, col2, row2) {
    this._clearPreview();
    const minC = Math.min(col1, col2), maxC = Math.max(col1, col2);
    const minR = Math.min(row1, row2), maxR = Math.max(row1, row2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c * 2 + 1, 0.1, r * 2 + 1);
        this.previewGroup.add(mesh);
      }
    }
    // Red border
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.9,
    });
    const x0 = minC * 2, x1 = (maxC + 1) * 2;
    const z0 = minR * 2, z1 = (maxR + 1) * 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
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
    this._renderGridAroundCursor(col, row);
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
   * Unified ghost renderer for any placeable. Looks up the entry in
   * PLACEABLES, builds the same 3D mesh that the committed instance will
   * use via componentBuilder._createObject, tints it green (valid) or red
   * (invalid), and positions it on the subtile grid with 4-way rotation.
   *
   * Positioning math mirrors renderComponentGhost exactly so beamline
   * items land in identical world positions under the unified path.
   *
   * @param {{id:string,col:number,row:number,subCol:number,subRow:number,dir:number}} hover
   * @param {boolean} valid
   */
  renderPlaceableGhost(hover, valid) {
    this._clearPreview();
    this._renderGridAroundCursor(hover.col, hover.row);

    const placeable = PLACEABLES[hover.id];
    if (!placeable) return;

    // PLACEABLES entries are Placeable instances which structurally
    // extend the legacy def shape (Object.assign in the constructor
    // preserves all original fields), so _createObject works uniformly
    // across beamline / furnishing / equipment / decoration.
    const obj = this.componentBuilder._createObject(placeable);
    if (!obj) return;

    obj.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0.4;
        child.material.depthWrite = false;
        child.material.depthTest = false;
        if (child.material.color) {
          child.material.color.setHex(valid ? 0x44ff44 : 0xff4444);
        }
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = 999;
      }
    });

    const isDetailed = !!obj.children?.length;
    const SUB_UNIT = 0.5;
    // Mirror renderComponentGhost: prefer gridW/gridH (legacy) then subW/subL.
    // snapForPlaceable swaps w/h for dir 1/3, so the footprint outline and
    // mesh center must swap too or they diverge from the reserved subcells.
    const gwRaw = placeable.gridW || placeable.subW || 4;
    const ghRaw = placeable.gridH || placeable.subL || placeable.subH || 4;
    const swap = (hover.dir === 1 || hover.dir === 3);
    const gwSub = swap ? ghRaw : gwRaw;
    const ghSub = swap ? gwRaw : ghRaw;
    const sc = hover.subCol || 0;
    const sr = hover.subRow || 0;
    const footW = gwSub * SUB_UNIT;
    const footH = ghSub * SUB_UNIT;
    const col = hover.col;
    const row = hover.row;
    const px = col * 2 + sc * SUB_UNIT + footW / 2;
    const pz = row * 2 + sr * SUB_UNIT + footH / 2;
    const y = isDetailed ? 0 : ((placeable.subH || 2) * SUB_UNIT) / 2;
    obj.position.set(px, y, pz);
    obj.rotation.y = -(hover.dir || 0) * (Math.PI / 2);
    obj.renderOrder = 999;
    this.previewGroup.add(obj);

    // Floor outline at sub-tile footprint (matches renderComponentGhost).
    const tileColor = valid ? 0x44ff44 : 0xff4444;
    const edgeMat = this._previewEdgeMat(tileColor);
    const fillMat = this._previewMat(tileColor, 0.15);
    const x0 = col * 2 + sc * SUB_UNIT;
    const x1 = x0 + footW;
    const z0 = row * 2 + sr * SUB_UNIT;
    const z1 = z0 + footH;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    const fillGeo = new THREE.PlaneGeometry(footW, footH);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(px, 0.1, pz);
    this._addPreviewMesh(fill);
  }

  /**
   * Render a ghost (transparent) beamline component at a tile position.
   * Uses the real component geometry from the component builder.
   */
  renderComponentGhost(col, row, compType, direction, color, subCol, subRow) {
    this._clearPreview();
    this._renderGridAroundCursor(col, row);
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
        child.material.depthTest = false;
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = 999;
      }
    });
    const isDetailed = !!obj.children?.length; // groups are detailed, bare meshes are fallbacks
    const SUB_UNIT = 0.5;
    // Footprint in sub-units (gridW/gridH store sub-cell counts). snapForPlaceable
    // swaps w/h for dir 1/3 so outline + mesh center must swap to match.
    const gwRaw = compDef.gridW || compDef.subW || 4;
    const ghRaw = compDef.gridH || compDef.subL || 4;
    const swap = (direction === 1 || direction === 3);
    const gwSub = swap ? ghRaw : gwRaw;
    const ghSub = swap ? gwRaw : ghRaw;
    const sc = subCol || 0;
    const sr = subRow || 0;
    const footW = gwSub * SUB_UNIT; // world units
    const footH = ghSub * SUB_UNIT;
    const px = col * 2 + sc * SUB_UNIT + footW / 2;
    const pz = row * 2 + sr * SUB_UNIT + footH / 2;
    const y = isDetailed ? 0 : ((compDef.subH || 2) * SUB_UNIT) / 2;
    obj.position.set(px, y, pz);
    obj.rotation.y = -(direction || 0) * (Math.PI / 2);
    obj.renderOrder = 999;
    this.previewGroup.add(obj);
    // Floor outline at sub-tile footprint
    const tileColor = (typeof color === 'number') ? color : 0x88aaff;
    const edgeMat = this._previewEdgeMat(tileColor);
    const fillMat = this._previewMat(tileColor, 0.15);
    const x0 = col * 2 + sc * SUB_UNIT;
    const x1 = x0 + footW;
    const z0 = row * 2 + sr * SUB_UNIT;
    const z1 = z0 + footH;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    const fillGeo = new THREE.PlaneGeometry(footW, footH);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(px, 0.1, pz);
    this._addPreviewMesh(fill);

    // Direction arrow on base tile (shows output direction)
    const dir = direction || 0;
    const delta = DIR_DELTA[dir];
    const perpDelta = DIR_DELTA[turnLeft(dir)];
    const cx = px, cz = pz;
    const dx = delta.dc, dz = delta.dr;
    const perpX = perpDelta.dc, perpZ = perpDelta.dr;
    const arrowMat = this._previewEdgeMat(0x88bbff);
    const arrowStart = new THREE.Vector3(cx - dx * 0.4, 0.15, cz - dz * 0.4);
    const arrowEnd = new THREE.Vector3(cx + dx * 0.6, 0.15, cz + dz * 0.6);
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowStart, arrowEnd]), arrowMat));
    const tipX = cx + dx * 0.6, tipZ = cz + dz * 0.6;
    const chevLen = 0.3;
    const chevPts = [
      new THREE.Vector3(tipX - dx * chevLen + perpX * chevLen, 0.15, tipZ - dz * chevLen + perpZ * chevLen),
      new THREE.Vector3(tipX, 0.15, tipZ),
      new THREE.Vector3(tipX - dx * chevLen - perpX * chevLen, 0.15, tipZ - dz * chevLen - perpZ * chevLen),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(chevPts), arrowMat));
  }

  /**
   * Render a transparent ghost of an attachment component at a fractional
   * position along a beam pipe. Mirrors `renderComponentGhost` but treats
   * `col`/`row` as world-centered fractional coordinates (matching the
   * world-snapshot convention for placed attachments) rather than tile
   * top-left + sub-tile offset.
   */
  renderAttachmentGhost(col, row, compType, direction, valid) {
    this._clearPreview();
    const compDef = COMPONENTS[compType];
    if (!compDef) return;
    const obj = this.componentBuilder._createObject(compDef);
    if (!obj) return;
    obj.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0.4;
        child.material.depthWrite = false;
        if (child.material.color) {
          child.material.color.setHex(valid ? 0x44ff44 : 0xff4444);
        }
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    const isDetailed = !!obj.children?.length;
    const SUB_UNIT = 0.5;
    // Attachments use `col * 2 + 1` (fractional col is already the
    // world-centered tile coordinate from the pipe projection).
    const px = col * 2 + 1;
    const pz = row * 2 + 1;
    const y = isDetailed ? 0 : ((compDef.subH || 2) * SUB_UNIT) / 2;
    obj.position.set(px, y, pz);
    obj.rotation.y = -(direction || 0) * (Math.PI / 2);
    obj.renderOrder = 999;
    this.previewGroup.add(obj);

    // Footprint outline (same size as the component's sub-tile footprint,
    // centered on the projected point).
    const gwSub = compDef.gridW || compDef.subW || 4;
    const ghSub = compDef.gridH || compDef.subL || 4;
    const footW = gwSub * SUB_UNIT;
    const footH = ghSub * SUB_UNIT;
    const tileColor = valid ? 0x44ff44 : 0xff4444;
    const edgeMat = this._previewEdgeMat(tileColor);
    const fillMat = this._previewMat(tileColor, 0.15);
    const x0 = px - footW / 2;
    const x1 = px + footW / 2;
    const z0 = pz - footH / 2;
    const z1 = pz + footH / 2;
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    const fillGeo = new THREE.PlaneGeometry(footW, footH);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(px, 0.1, pz);
    this._addPreviewMesh(fill);
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
   * Render a ghost (transparent) equipment at a tile position.
   * Beamline components use actual 3D model with green wireframe edges.
   * Other components use a simple translucent box.
   */
  renderEquipmentGhost(col, row, compType, color) {
    this._clearPreview();
    this._renderGridAroundCursor(col, row);
    const compDef = COMPONENTS[compType];
    if (!compDef) return;

    const tileX = col * 2;
    const tileZ = row * 2;
    const tileColor = (typeof color === 'number') ? color : 0x88aaff;

    const isBeamline = compDef.category === 'source' || compDef.category === 'focusing'
      || compDef.category === 'acceleration' || compDef.category === 'diagnostics'
      || compDef.isDrawnConnection;

    if (isBeamline) {
      // Use actual 3D model ghost with green wireframe
      const ghost = createBeamlineGhost(compType);
      if (ghost) {
        ghost.position.set(tileX + 1, 0, tileZ + 1);
        ghost.rotation.y = -(this.placementDir || 0) * (Math.PI / 2);
        this._addPreviewMesh(ghost);
      }
    } else {
      // Non-beamline: simple translucent box
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
      mesh.position.set(tileX + 1, h / 2, tileZ + 1);
      this._addPreviewMesh(mesh);
    }

    // Floor outline
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
    this._renderGridAroundCursor(col, row);
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

  /** Clear grid overlay lines. */
  _clearGridOverlay() {
    if (!this.gridOverlayGroup) return;
    while (this.gridOverlayGroup.children.length > 0) {
      const child = this.gridOverlayGroup.children[0];
      this.gridOverlayGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  /**
   * Render major grid lines and sub-grid lines in an area around the cursor.
   * Major lines = tile boundaries (every 2 world units).
   * Sub-grid lines = quarter-tile divisions (every 0.5 world units).
   * Uses LineSegments for efficient batched rendering.
   * Renders into gridOverlayGroup (not previewGroup) so _clearPreview doesn't wipe them.
   */
  _renderGridAroundCursor(col, row) {
    this._clearGridOverlay();

    const majorRadius = 6;   // tiles around cursor for major grid
    const subRadius = 3;     // tiles around cursor for sub-grid
    const y = 0.06;          // slightly above ground plane

    // --- Major grid (tile boundaries) as a single LineSegments ---
    const majorVerts = [];
    const mMin = -majorRadius, mMax = majorRadius + 1;
    const mx0 = (col + mMin) * 2, mx1 = (col + mMax) * 2;
    const mz0 = (row + mMin) * 2, mz1 = (row + mMax) * 2;
    for (let dr = mMin; dr <= mMax; dr++) {
      const z = (row + dr) * 2;
      majorVerts.push(mx0, y, z, mx1, y, z);
    }
    for (let dc = mMin; dc <= mMax; dc++) {
      const x = (col + dc) * 2;
      majorVerts.push(x, y, mz0, x, y, mz1);
    }
    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3));
    const majorMat = new THREE.LineBasicMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.35,
      depthTest: false, depthWrite: false,
    });
    const majorLines = new THREE.LineSegments(majorGeo, majorMat);
    majorLines.renderOrder = 997;
    this.gridOverlayGroup.add(majorLines);

    // --- Sub-grid (4 divisions per tile) as a single LineSegments ---
    const subVerts = [];
    const sMin = col - subRadius, sMax = col + subRadius + 1;
    const srMin = row - subRadius, srMax = row + subRadius + 1;
    const sx0 = sMin * 2, sx1 = sMax * 2;
    const sz0 = srMin * 2, sz1 = srMax * 2;
    for (let r = srMin; r <= srMax; r++) {
      for (let sub = 1; sub <= 3; sub++) {
        const z = r * 2 + sub * 0.5;
        subVerts.push(sx0, y, z, sx1, y, z);
      }
    }
    for (let c = sMin; c <= sMax; c++) {
      for (let sub = 1; sub <= 3; sub++) {
        const x = c * 2 + sub * 0.5;
        subVerts.push(x, y, sz0, x, y, sz1);
      }
    }
    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute('position', new THREE.Float32BufferAttribute(subVerts, 3));
    const subMat = new THREE.LineBasicMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.15,
      depthTest: false, depthWrite: false,
    });
    const subLines = new THREE.LineSegments(subGeo, subMat);
    subLines.renderOrder = 997;
    this.gridOverlayGroup.add(subLines);
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
    // Orbit the dimetric camera around (_panX, _panY) by the current view rotation.
    // Y axis rotation of the default offset (CAM_D, 0, CAM_D).
    const CAM_D = 50;
    const CAM_H = CAM_D * Math.sqrt(6) / 3;
    const a = this._viewRotationAngle;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    // Ry(a) · (CAM_D, 0, CAM_D) → (D·cos + D·sin, 0, -D·sin + D·cos)
    const offX = CAM_D * cosA + CAM_D * sinA;
    const offZ = -CAM_D * sinA + CAM_D * cosA;
    this.camera.position.set(this._panX + offX, CAM_H, this._panY + offZ);
    this.camera.lookAt(this._panX, 0, this._panY);
  }

  _onResize() {
    this._setSize();
    this._updateCameraFrustum();
  }

  _animate() {
    this._animFrameId = requestAnimationFrame(() => this._animate());
    // Advance the Q/E rotation animation (orbits camera around pan target).
    this._tickViewRotation();
    // Keep anchored windows tracking during mouse-drag panning
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
    this._updateSunCycle();
    this._updateLOD();
    // Beam pipe drawing preview
    if (this._inputHandler && this._inputHandler.drawingBeamPipe && this._inputHandler.beamPipePath.length >= 1) {
      this._renderBeamPipePreview(this._inputHandler.beamPipePath, this._inputHandler.beamPipeDrawMode);
    } else if (
      this._inputHandler &&
      this._inputHandler.selectedTool &&
      COMPONENTS[this._inputHandler.selectedTool]?.isDrawnConnection &&
      this._inputHandler.hoverPipePoint
    ) {
      this._renderBeamPipePreview([this._inputHandler.hoverPipePoint], 'add');
    } else {
      this._clearBeamPipePreview();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Toggle visibility of detail meshes (userData.lod === 'detail') based on zoom.
   * Only runs when zoom level changes to avoid per-frame traversal cost.
   */
  _updateLOD() {
    const showDetail = this.zoom >= 2.0;
    if (showDetail === this._lastLodDetail) return;
    this._lastLodDetail = showDetail;
    this.componentGroup.traverse((child) => {
      if (child.isMesh && child.userData.lod === 'detail') {
        child.visible = showDetail;
      }
    });
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
    // Offset sun position and shadow target to follow the camera center
    // Snap target in light-space to texel grid to prevent shadow swimming
    const cx = this._panX || 0;
    const cz = this._panY || 0;
    this._sunLight.position.set(x + cx, elevation, z + cz);
    this._sunLight.target.position.set(cx, 0, cz);
    this._sunLight.target.updateMatrixWorld();
    this._sunLight.updateMatrixWorld();
    const shadowCam = this._sunLight.shadow.camera;
    shadowCam.updateMatrixWorld();
    const texelsPerUnit = 4096 / (shadowCam.right - shadowCam.left);
    const shadowMatrix = shadowCam.matrixWorldInverse;
    // Project target into light space, snap, project back
    const targetPos = this._sunLight.target.position.clone().applyMatrix4(shadowMatrix);
    targetPos.x = Math.round(targetPos.x * texelsPerUnit) / texelsPerUnit;
    targetPos.y = Math.round(targetPos.y * texelsPerUnit) / texelsPerUnit;
    const snapped = targetPos.applyMatrix4(shadowCam.matrixWorld);
    const dx = snapped.x - cx;
    const dz = snapped.z - cz;
    this._sunLight.position.set(x + snapped.x, elevation, z + snapped.z);
    this._sunLight.target.position.set(snapped.x, 0, snapped.z);
    this._sunLight.target.updateMatrixWorld();

    // Intensity: bright at noon, dim at night
    // cos goes from 1 (noon) to -1 (midnight)
    const sunFactor = Math.cos(this._sunAngle);
    const dayness = Math.max(0, sunFactor); // 0 at night, 1 at noon

    // Directional light: strong sunlight, gentle fade at night
    this._sunLight.intensity = 0.8 + 1.0 * dayness;

    // Ambient light: generous baseline so it never gets too dark
    this._ambientLight.intensity = 0.7 + 0.4 * dayness;

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
    this.pipeAttachmentBuilder.build(snapshot.pipeAttachments || [], this.pipeAttachmentGroup);
    this.beamBuilder.build(snapshot.beamPaths, this.componentGroup);
    this.equipmentBuilder.build(snapshot.equipment, snapshot.furnishings, this.equipmentGroup);
    this.decorationBuilder.build(snapshot.decorations, this.decorationGroup);
    this.connectionBuilder.build(snapshot.connections, this.connectionGroup);
    this._refreshBeamPipes();
    this._refreshZones();
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
  }

  _refreshZones() {
    if (!this.zoneGroup) return;
    while (this.zoneGroup.children.length > 0) {
      const child = this.zoneGroup.children[0];
      this.zoneGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    }

    const zones = this.game.state.zones || [];
    if (zones.length === 0) return;

    const byType = new Map();
    for (const z of zones) {
      if (!byType.has(z.type)) byType.set(z.type, []);
      byType.get(z.type).push(z);
    }

    for (const [type, tiles] of byType) {
      const def = ZONES[type];
      if (!def) continue;

      const quadGeo = new THREE.PlaneGeometry(2, 2);
      quadGeo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(def.color),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });

      const mesh = new THREE.InstancedMesh(quadGeo, mat, tiles.length);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 2;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        dummy.position.set(t.col * 2 + 1, 0.02, t.row * 2 + 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.zoneGroup.add(mesh);

      const clusters = this._clusterZoneTiles(tiles);
      for (const cluster of clusters) {
        let cx = 0, cz = 0;
        for (const t of cluster) { cx += t.col; cz += t.row; }
        cx = cx / cluster.length * 2 + 1;
        cz = cz / cluster.length * 2 + 1;
        const label = `${def.name} [${cluster.length}]`;
        const sprite = this._makeLabelSprite(label);
        sprite.position.set(cx, 0.4, cz);
        this.zoneGroup.add(sprite);
      }
    }

    this.zoneGroup.visible = this.zoneOverlayVisible !== false;
  }

  _clusterZoneTiles(tiles) {
    const keyOf = (c, r) => c + ',' + r;
    const remaining = new Map();
    for (const t of tiles) remaining.set(keyOf(t.col, t.row), t);
    const clusters = [];
    while (remaining.size > 0) {
      const first = remaining.values().next().value;
      remaining.delete(keyOf(first.col, first.row));
      const cluster = [first];
      const queue = [first];
      while (queue.length > 0) {
        const cur = queue.shift();
        const neighbors = [
          [cur.col + 1, cur.row], [cur.col - 1, cur.row],
          [cur.col, cur.row + 1], [cur.col, cur.row - 1],
        ];
        for (const [nc, nr] of neighbors) {
          const k = keyOf(nc, nr);
          if (remaining.has(k)) {
            const n = remaining.get(k);
            remaining.delete(k);
            cluster.push(n);
            queue.push(n);
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  _makeLabelSprite(text) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fontSize = 8;
    const font = `${fontSize}px 'Press Start 2P', monospace`;
    const measureCanvas = document.createElement('canvas');
    const mctx = measureCanvas.getContext('2d');
    mctx.font = font;
    const textW = mctx.measureText(text).width;
    const padX = 4;
    const padY = 4;
    const cssW = Math.ceil(textW + padX * 2);
    const cssH = Math.ceil(fontSize + padY * 2);

    const canvas = document.createElement('canvas');
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, cssW / 2, cssH / 2);
    ctx.fillText(text, cssW / 2, cssH / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const worldH = 0.42;
    sprite.scale.set(worldH * (cssW / cssH), worldH, 1);
    sprite.renderOrder = 10;
    return sprite;
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
    // Remove old beam pipe meshes from group
    if (this.beamPipeGroup) {
      while (this.beamPipeGroup.children.length > 0) {
        const child = this.beamPipeGroup.children[0];
        this.beamPipeGroup.remove(child);
        child.traverse(obj => {
          if (obj.isMesh) {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          }
        });
      }
    }
    this._beamPipeMeshes = [];

    const pipes = this.game.state.beamPipes || [];
    if (pipes.length === 0) return;

    const PIPE_RADIUS = 0.08;
    const PIPE_Y = 1.0;
    const FLANGE_R = 0.16;
    const FLANGE_W = 0.045;
    const STAND_W = 0.06;

    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x99aabb, roughness: 0.3, metalness: 0.5,
    });
    const flangeMat = new THREE.MeshStandardMaterial({
      color: 0xbbbbbb, roughness: 0.3, metalness: 0.6,
    });
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x555555, roughness: 0.7, metalness: 0.1,
    });

    // Collect all pipe endpoints so adjacent pipes can have shared flanges
    // suppressed, merging them visually into continuous runs.
    const endpointKey = (col, row) => `${Math.round(col * 4)},${Math.round(row * 4)}`;
    const endpointCounts = new Map();
    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length < 2) continue;
      const first = pipe.path[0];
      const last = pipe.path[pipe.path.length - 1];
      for (const p of [first, last]) {
        const k = endpointKey(p.col, p.row);
        endpointCounts.set(k, (endpointCounts.get(k) || 0) + 1);
      }
    }
    // Also mark any tile occupied by a beamline module as a "touched" endpoint
    // so we skip the flange where the pipe meets the module body.
    const moduleTiles = new Set();
    for (const p of (this.game.state.placeables || [])) {
      if (p.category !== 'beamline') continue;
      const def = COMPONENTS[p.type];
      if (!def || def.placement !== 'module' || def.isDrawnConnection) continue;
      for (const c of (p.cells || [{ col: p.col, row: p.row }])) {
        moduleTiles.add(`${c.col},${c.row}`);
      }
    }
    const isModuleAt = (col, row) => moduleTiles.has(`${Math.round(col)},${Math.round(row)}`);

    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length < 2) continue;

      const pipeWrapper = new THREE.Group();
      pipeWrapper.userData.pipeId = pipe.id;

      const runs = pipePathRuns(pipe.path);
      const runCount = runs.length;

      for (let r = 0; r < runCount; r++) {
        const { start, end } = runs[r];
        const x1 = start.col * 2 + 1;
        const z1 = start.row * 2 + 1;
        const x2 = end.col * 2 + 1;
        const z2 = end.row * 2 + 1;

        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.sqrt(dx * dx + dz * dz);
        if (length < 0.01) continue;

        const angle = -Math.atan2(dz, dx);
        const cx = (x1 + x2) / 2;
        const cz = (z1 + z2) / 2;

        const geo = new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, length, 8);
        geo.rotateZ(Math.PI / 2);

        const mesh = new THREE.Mesh(geo, pipeMat);
        mesh.position.set(cx, PIPE_Y, cz);
        mesh.rotation.y = angle;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        pipeWrapper.add(mesh);
        this._beamPipeMeshes.push(mesh);

        // Flange emission rules:
        //  - start flange only on the first run (at pipe's start)
        //  - end flange only on the last run (at pipe's end)
        //  - corners (between runs) always get a flange
        // Additionally suppress the start/end flange if another pipe shares
        // that endpoint or if it sits on a beamline module tile.
        const flangeGeo = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_W, 8);
        flangeGeo.rotateZ(Math.PI / 2);

        const addFlange = (fx, fz) => {
          const flange = new THREE.Mesh(flangeGeo, flangeMat);
          flange.position.set(fx, PIPE_Y, fz);
          flange.rotation.y = angle;
          flange.castShadow = true;
          pipeWrapper.add(flange);
          this._beamPipeMeshes.push(flange);
        };

        if (r === 0) {
          const sharesEnd = (endpointCounts.get(endpointKey(start.col, start.row)) || 0) > 1;
          const onModule = isModuleAt(start.col, start.row);
          if (!sharesEnd && !onModule) addFlange(x1, z1);
        } else {
          // corner flange — between previous run end and this run start (same point)
          addFlange(x1, z1);
        }
        if (r === runCount - 1) {
          const sharesEnd = (endpointCounts.get(endpointKey(end.col, end.row)) || 0) > 1;
          const onModule = isModuleAt(end.col, end.row);
          if (!sharesEnd && !onModule) addFlange(x2, z2);
        }
        // Intermediate flanges every 2 world units (1 tile = 2m) along the run
        const MAX_UNFLANGED = 2;
        if (length > MAX_UNFLANGED + 0.01) {
          const nInterior = Math.floor(length / MAX_UNFLANGED - 1e-3);
          for (let k = 1; k <= nInterior; k++) {
            const t = (k * MAX_UNFLANGED) / length;
            const fx = x1 + dx * t;
            const fz = z1 + dz * t;
            addFlange(fx, fz);
          }
        }

        // Support stands every ~2 world units along the run
        const standH = PIPE_Y - PIPE_RADIUS;
        const standGeo = new THREE.BoxGeometry(STAND_W, standH, STAND_W);
        const standStep = 2;
        const nStands = Math.max(1, Math.round(length / standStep));
        for (let k = 0; k < nStands; k++) {
          const t = (k + 0.5) / nStands;
          const sx = x1 + dx * t;
          const sz = z1 + dz * t;
          const stand = new THREE.Mesh(standGeo, standMat);
          stand.position.set(sx, standH / 2, sz);
          stand.castShadow = true;
          stand.receiveShadow = true;
          pipeWrapper.add(stand);
          this._beamPipeMeshes.push(stand);
        }

        // Invisible hitbox for easier click detection
        const hitGeo = new THREE.CylinderGeometry(0.4, 0.4, length, 6);
        hitGeo.rotateZ(Math.PI / 2);
        const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
        hitMesh.position.set(cx, PIPE_Y, cz);
        hitMesh.rotation.y = angle;
        pipeWrapper.add(hitMesh);
        this._beamPipeMeshes.push(hitMesh);
      }

      this.beamPipeGroup.add(pipeWrapper);
    }

    // Rebuild inline attachments — their positions depend on pipe paths.
    const snap = buildWorldSnapshot(this.game);
    this.pipeAttachmentBuilder.build(snap.pipeAttachments || [], this.pipeAttachmentGroup);
  }

  renderBeamPipePreview(path, mode) {
    this._renderBeamPipePreview(path, mode);
  }

  _renderBeamPipePreview(path, mode) {
    this._clearBeamPipePreview();
    if (!path || path.length < 1) return;

    const isRemove = mode === 'remove';
    const wireColor = isRemove ? 0xff4444 : 0x44ff44;

    const PIPE_RADIUS = 0.08;
    const PIPE_Y = 1.0;
    const STAND_W = 0.06;

    const pipeMat = new THREE.MeshStandardMaterial({
      color: isRemove ? 0xaa4444 : 0x99aabb, roughness: 0.3, metalness: 0.5,
      transparent: true, opacity: 0.3, depthWrite: false,
    });
    const wireframeMat = new THREE.MeshBasicMaterial({
      color: wireColor, wireframe: true,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    const flangeMat = new THREE.MeshStandardMaterial({
      color: isRemove ? 0xaa4444 : 0xbbbbbb, roughness: 0.3, metalness: 0.6,
      transparent: true, opacity: 0.3, depthWrite: false,
    });
    const standMat = new THREE.MeshStandardMaterial({
      color: isRemove ? 0x664444 : 0x555555, roughness: 0.7, metalness: 0.1,
      transparent: true, opacity: 0.2, depthWrite: false,
    });

    this._beamPipePreviewMeshes = [];

    // Helper to add a single collinear pipe run with flanges at each end.
    const addRun = (x1, z1, x2, z2) => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) return;

      const pipeGeo = new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, length, 8);
      pipeGeo.rotateZ(Math.PI / 2);
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.position.set((x1 + x2) / 2, PIPE_Y, (z1 + z2) / 2);
      pipe.rotation.y = -Math.atan2(dz, dx);
      this.scene.add(pipe);
      this._beamPipePreviewMeshes.push(pipe);
      const pipeWire = new THREE.Mesh(pipeGeo, wireframeMat);
      pipeWire.position.copy(pipe.position);
      pipeWire.rotation.copy(pipe.rotation);
      this.scene.add(pipeWire);
      this._beamPipePreviewMeshes.push(pipeWire);

      // CF flanges at each end + every 2m (1 tile) along the run
      const flangeGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.045, 8);
      flangeGeo.rotateZ(Math.PI / 2);
      const flangePositions = [[x1, z1], [x2, z2]];
      const MAX_UNFLANGED = 2;
      if (length > MAX_UNFLANGED + 0.01) {
        const nInterior = Math.floor(length / MAX_UNFLANGED - 1e-3);
        for (let k = 1; k <= nInterior; k++) {
          const t = (k * MAX_UNFLANGED) / length;
          flangePositions.push([x1 + dx * t, z1 + dz * t]);
        }
      }
      for (const [fx, fz] of flangePositions) {
        const flange = new THREE.Mesh(flangeGeo, flangeMat);
        flange.position.set(fx, PIPE_Y, fz);
        flange.rotation.y = -Math.atan2(dz, dx);
        this.scene.add(flange);
        this._beamPipePreviewMeshes.push(flange);
      }

      // Support stands every ~2 world units along the run
      const standH = PIPE_Y - PIPE_RADIUS;
      const standGeo = new THREE.BoxGeometry(STAND_W, standH, STAND_W);
      const nStands = Math.max(1, Math.round(length / 2));
      for (let k = 0; k < nStands; k++) {
        const t = (k + 0.5) / nStands;
        const sx = x1 + dx * t;
        const sz = z1 + dz * t;
        const stand = new THREE.Mesh(standGeo, standMat);
        stand.position.set(sx, standH / 2, sz);
        this.scene.add(stand);
        this._beamPipePreviewMeshes.push(stand);
      }
    };

    if (path.length === 1) {
      // Single click preview: show a half-tile (2 sub-unit) stub
      const cx = path[0].col * 2 + 1;
      const cz = path[0].row * 2 + 1;
      const dir = this.placementDir || 0;
      const delta = DIR_DELTA[dir];
      const dx = delta.dc, dz = delta.dr;
      addRun(cx - dx * 0.5, cz - dz * 0.5, cx + dx * 0.5, cz + dz * 0.5);
    } else {
      const runs = pipePathRuns(path);
      for (const { start, end } of runs) {
        addRun(start.col * 2 + 1, start.row * 2 + 1, end.col * 2 + 1, end.row * 2 + 1);
      }
    }
  }

  _clearBeamPipePreview() {
    if (this._beamPipePreviewMeshes) {
      for (const mesh of this._beamPipePreviewMeshes) {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
      }
      this._beamPipePreviewMeshes = null;
    }
    // Clean up old line preview if still around
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
    this.pipeAttachmentBuilder.build(snap.pipeAttachments || [], this.pipeAttachmentGroup);
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
