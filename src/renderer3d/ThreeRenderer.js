// src/renderer3d/ThreeRenderer.js — Three.js scaffold with isometric camera
// THREE is loaded as a CDN global — do NOT import it
//
// SNAPSHOT BOUNDARY: world data (terrain, floors, walls, zones, placeables,
// pipes, utility lines, ...) reaches this renderer ONLY through
// buildWorldSnapshot sections, cached on `this._snapshot` and refreshed
// per-section on game events via `_updateSnapshot`. Genuinely interactive
// per-frame state — hover, drag previews, armed tools — is read live from
// the input controllers/tools that own it; that is correct and expected.
// The few remaining live `game.state` reads (terrain-height sampling under
// the cursor, utility-line port/network resolution) must go through the
// single documented accessor `_liveState()` so the boundary stays greppable.

import { TextureManager } from './texture-manager.js';
import { TerrainBuilder } from './terrain-builder.js';
import { CliffBuilder } from './cliff-builder.js';
import { WildflowerBuilder } from './wildflower-builder.js';
import { GrassTuftBuilder } from './grass-tuft-builder.js';
import { FloorBuilder } from './floor-builder.js';
import { WallBuilder, HEIGHT_SCALE, LINTEL_HEIGHT, doorOpeningLayout, TILE_SIZE as WALL_TILE_SIZE } from './wall-builder.js';
import { ComponentBuilder, getAccentMaterial, isDetailedComponent, componentPose, getModelBounds, measureShellSurfaces, setGlowNightFactor } from './component-builder.js';
import { setModelBoundsProvider, setShellMeasureProvider } from '../utility/port-anchors.js';
import { BeamBuilder } from './beam-builder.js';
import { EquipmentBuilder } from './equipment-builder.js';
import { DecorationBuilder } from './decoration-builder.js';
import { UtilityLineBuilderV2 } from './utility-line-builder-v2.js';
import { tickFlow } from './utility-flow.js';
import { buildWorldSnapshot } from './world-snapshot.js';
import { disposeGroupChildren, disposeSceneObject } from './dispose-utils.js';
import { listUtilityEndpoints, makeUtilityEndpointIndex } from '../utility/utility-endpoints.js';
import { portWorldPosition } from '../utility/ports.js';
import { portAnchor3D } from '../utility/port-anchors.js';
import { buildPortFittings, portFittingSignature } from './builders/port-fitting-builder.js';
import { StaffPawns } from './StaffPawns.js';
import { sampleSurfaceYAt, getTileCornersY } from '../game/terrain.js';
import { PLACE_UNAFFORDABLE } from '../game/placement.js';
import { DAY_LENGTH_TICKS } from '../game/Game.js';
import { dayNightGrade, MOON_COLOR } from './day-night.js';
import {
  buildLightPools, buildLightHalos, applyPoolSuppression,
  emitterIntensityForDarkness, poolOpacityForDarkness, haloOpacityForDarkness,
  glassGlowForDarkness,
} from './lighting-builder.js';
import { OverlayShim } from './overlay-shim.js';
import { GlowPipeline } from './glow-pipeline.js';
import { LightRig } from './light-rig.js';
import { fixtureMountY } from './fixture-light-math.js';
import {
  MAX_FIXTURE_SHADOWS, normalizeLightingQuality, resolveLightingQuality,
} from './lighting-quality.js';
import { ShadowScheduler } from './shadow-scheduler.js';
import { VolumetricLightPool } from './volumetric-light-pool.js';
import { fixtureDynamicFactor } from './light-dynamics.js';
import { disposeLightCookies } from './light-cookie.js';
import { UIHost } from '../ui/UIHost.js';
// Side-effect imports: attach UI methods to UIHost.prototype.
// Must run before `new UIHost(...)` is ever evaluated.
import '../ui/hud.js';
import '../ui/overlays.js';
import { tileCenterIso, gridToIso } from '../renderer/grid.js';
import { WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, WINDOW_WIDTH_FRAC } from '../data/structure.js';
import { ZONES } from '../data/facility.js';
import { COMPONENTS } from '../data/components.js';
import { DIR, DIR_DELTA, turnLeft } from '../data/directions.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { portSide } from '../beamline/junctions.js';
import {
  PITCH_REST,
  PITCH_TOP,
  PITCH_MIN,
  PITCH_MAX,
  ORBIT_RADIUS,
  ORBIT_YAW_SENSITIVITY,
  ORBIT_PITCH_SENSITIVITY,
  clampPitch,
  snapYaw,
  cameraOffset,
  easeInOutQuad,
  pickSnapMode,
  targetPitchForMode,
  YAW_STEP,
  YAW_DIVISIONS,
} from './free-orbit-math.js';
import { ViewCube } from './view-cube.js';
import {
  DEFAULT_ZONE_LABEL_STYLE,
  zoneLabelStyleById,
  buildZoneFloorLabel,
  faceZoneLabels,
  resolveLabelOverlaps,
} from './zone-label.js';

// Closest the camera may get. Detail meshes (userData.lod === 'detail') switch
// on at zoom 2.0, so anything above that is inside the high-detail band.
const ZOOM_MAX = 14;

// Ghost tints. Amber is not a softer red: the placement still fails, but the
// fix is money rather than moving the cursor, so it must not be confusable
// with either the green "this will work" or the red "this never will".
const GHOST_TINT_OK = 0x44ff44;
const GHOST_TINT_BLOCKED = 0xff4444;
const GHOST_TINT_UNAFFORDABLE = 0xffb020;

/** Ghost color for a (valid, reason) pair. Reasons come from placement.js. */
function ghostTint(valid, reason) {
  if (valid) return GHOST_TINT_OK;
  return reason === PLACE_UNAFFORDABLE ? GHOST_TINT_UNAFFORDABLE : GHOST_TINT_BLOCKED;
}

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

/**
 * Split a straight pipe run into sub-runs that skip tiles occupied by
 * beamline modules.  Modules already render their own internal beam pipe
 * geometry, so the connecting beam pipe must stop at the module boundary
 * to avoid clipping with component flanges.
 *
 * Returns an array of { start, end } objects in the same direction as the
 * original run.  If no module tiles intersect the run, returns the
 * original run unchanged (single-element array).
 */
function splitRunExcludingModules(start, end, moduleTileSet) {
  const dc = end.col - start.col;
  const dr = end.row - start.row;
  const horiz = Math.abs(dc) >= Math.abs(dr);
  const startV = horiz ? start.col : start.row;
  const endV   = horiz ? end.col   : end.row;
  const cross  = horiz ? start.row : start.col;
  const dir = Math.sign(endV - startV);
  if (dir === 0) return [{ start, end }];

  const lo = Math.min(startV, endV);
  const hi = Math.max(startV, endV);
  const mkPt = v => horiz
    ? { col: v, row: cross }
    : { col: cross, row: v };

  // Find subtile positions along the run that are blocked by modules.
  // moduleTileSet stores keys at subtile precision: "col,row,subCol,subRow".
  // Iterate at 0.25 steps (one subtile) along the run.
  const STEP = 0.25;
  const blocked = [];
  for (let t = Math.ceil(lo / STEP - 0.01) * STEP; t <= hi + 0.01; t += STEP) {
    const v = t;
    const colF = horiz ? v : cross;
    const rowF = horiz ? cross : v;
    // Pipe coordinates are tile-center-aligned (col*2+1 in world space),
    // but module cells use tile-corner-aligned subtile indices. Shift by
    // +0.5 to convert pipe coords to the module subtile grid.
    const adjCol = colF + 0.5;
    const adjRow = rowF + 0.5;
    const tileCol = Math.floor(adjCol + 1e-6);
    const tileRow = Math.floor(adjRow + 1e-6);
    const subCol = Math.round((adjCol - tileCol) * 4);
    const subRow = Math.round((adjRow - tileRow) * 4);
    if (moduleTileSet.has(`${tileCol},${tileRow},${subCol},${subRow}`)) {
      blocked.push(v);
    }
  }
  if (blocked.length === 0) return [{ start, end }];
  blocked.sort((a, b) => dir * (a - b));

  // Merge adjacent blocked subtiles into contiguous blocked ranges,
  // then carve each range out of the run.
  const ranges = [];
  let rangeStart = blocked[0];
  let rangePrev = blocked[0];
  for (let i = 1; i < blocked.length; i++) {
    if (Math.abs(blocked[i] - rangePrev - STEP) < 0.01) {
      rangePrev = blocked[i];
    } else {
      ranges.push({ lo: rangeStart, hi: rangePrev });
      rangeStart = blocked[i];
      rangePrev = blocked[i];
    }
  }
  ranges.push({ lo: rangeStart, hi: rangePrev });

  const subRuns = [];
  let cursor = startV;

  for (const range of ranges) {
    const nearEdge = dir > 0 ? range.lo : range.hi + STEP;
    const farEdge  = dir > 0 ? range.hi + STEP : range.lo;
    if (dir * (nearEdge - cursor) > 0.01) {
      subRuns.push({ start: mkPt(cursor), end: mkPt(nearEdge) });
    }
    cursor = farEdge;
  }
  if (dir * (endV - cursor) > 0.01) {
    subRuns.push({ start: mkPt(cursor), end: mkPt(endV) });
  }

  return subRuns;
}

export class ThreeRenderer {
  constructor(game, spriteManager) {
    this.game = game;
    this.sprites = spriteManager;

    this._panX = 0;
    this._panY = 0;
    this.zoom = 1;

    // Two canonical view modes: dimetric ('iso') and near-top-down ('top').
    // Each mode has its own yaw index 0..3 — switching modes restores that
    // mode's last facing rather than syncing yaw across both.
    this.viewMode = 'iso';
    this._isoYawIdx = 0;
    this._topYawIdx = 0;

    // View rotation (RCT2-style Q/E 90° orbit). _viewRotationAngle is the
    // live, animated yaw — it's mode-independent (mode determines pitch only).
    this._viewRotationAngle = 0;
    this._viewRotFromAngle = 0;
    this._viewRotToAngle = 0;
    this._viewRotStartMs = 0;
    this._viewRotDurationMs = 400;
    this._viewRotating = false;

    // Free-orbit state (middle-mouse drag orbits yaw + pitch around the
    // pan center; release animates back to nearest iso *or* top-down view
    // depending on which preset pitch the player ended closer to).
    this._freeOrbiting = false;
    this._freeYaw = 0;
    this._freePitch = PITCH_REST;
    this._snapping = false;
    this._snapFromYaw = 0;
    this._snapToYaw = 0;
    this._snapFromPitch = PITCH_REST;
    this._snapToPitch = PITCH_REST;
    this._snapStartMs = 0;
    this._snapDurationMs = 400;
    // Mode the active snap animation will commit to on completion. Set by
    // endFreeOrbit() and setViewMode(); read by _tickFreeOrbitSnap().
    this._snapTargetMode = 'iso';

    this._frustumSize = 20;
    this._animFrameId = null;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;  // interactive canvas (overlay event-capture canvas)

    // Overlay-shim references — set during init(). `app` keeps its old
    // Pixi-era shape ({canvas, screen}) for InputHandler/main.js readers;
    // `world` is plain {x, y, scale, visible} save bookkeeping.
    this.app = null;
    this.world = null;

    // Scene groups
    this.terrainGroup = null;
    this.floorGroup = null;
    this.wallGroup = null;
    this.zoneGroup = null;
    this.connectionGroup = null;
    this.equipmentGroup = null;
    this.componentGroup = null;
    this.beamPipeGroup = null;
    this.decorationGroup = null;
    // Registry (not a scene Group — lighting fixtures render as children of
    // decorationGroup like any other decoration, so demolish/hover/move
    // raycasting keeps working unchanged) of the lighting fixtures built by
    // the last decorationBuilder.build() call: [{id, def, group}, ...].
    // Task 6 (fake light pools) and Task 9 (real point lights) read this
    // instead of re-scanning every decoration.
    this.lightingGroup = [];
    // Task 6 fake-lighting layer: one merged additive mesh for every ground
    // light pool (lightPoolGroup) plus one Sprite billboard per glowing
    // emitter (lightHaloGroup). Both are rebuilt only when lightingGroup
    // above is reassigned (applySnapshot / _refreshDecorations) — see
    // _rebuildLightPools. Per frame, only their material opacity moves (see
    // _updateLightingRamp), driven by this._darkness in lockstep with the
    // sun/ambient grade and fixture emissiveIntensity.
    this.lightPoolGroup = null;
    this.lightHaloGroup = null;
    this.previewGroup = null;

    // Design-placement ghost. Deliberately NOT in previewGroup: _clearPreview
    // wipes and disposes that group on every mousemove, and a whole beamline's
    // worth of component meshes cannot be rebuilt at pointer rate. This group
    // is rebuilt only when _designGhostSig changes (design + cursor tile +
    // rotation + validity) — see _updateDesignGhost.
    this.designGhostGroup = null;
    this._designGhostSig = null;
    // compType|tint -> a ghostified wrapper, kept OFF-scene and only ever
    // cloned into designGhostGroup. Clones share the prototype's geometry and
    // materials by reference, so a rebuild allocates no GPU resources at all
    // and the clear path has nothing to dispose. The prototypes themselves are
    // freed when the placer goes away (_disposeDesignGhostProtos).
    this._designGhostProtos = new Map();
    // Unit-length ghost pipe, scaled per run. One geometry for every design
    // ever previewed; see _designGhostPipeGeo.
    this._designGhostPipeGeo = null;
    this._designGhostPipeMats = new Map();

    this._boundOnResize = this._onResize.bind(this);

    this.textureManager = new TextureManager();
    this.terrainBuilder = new TerrainBuilder(this.textureManager);
    this.cliffBuilder = new CliffBuilder(this.textureManager);
    // Terrain mesh reference — populated by applySnapshot / _refreshTerrain
    // via terrainBuilder.getMesh(). Used by Task 4's _raycastGround against
    // the actual surface (rather than the y=0 plane fallback).
    this._terrainMesh = null;
    this.wildflowerBuilder = new WildflowerBuilder();
    this.grassTuftBuilder = new GrassTuftBuilder();
    this.floorBuilder = new FloorBuilder(this.textureManager);
    this.wallBuilder = new WallBuilder(this.textureManager);
    this.componentBuilder = new ComponentBuilder();
    // Port anchors need model heights and where the shell's surface actually
    // is, which only the meshes know. Injected rather than imported so
    // utility/port-anchors.js stays headless-safe.
    setModelBoundsProvider(getModelBounds);
    setShellMeasureProvider(measureShellSurfaces);
    this.pipeAttachmentBuilder = new ComponentBuilder();
    this.beamBuilder = new BeamBuilder();
    this.equipmentBuilder = new EquipmentBuilder();
    this.decorationBuilder = new DecorationBuilder();
    this.utilityLineBuilderV2 = new UtilityLineBuilderV2();
    // Separate group so preview polylines sit in front of committed meshes
    // and we can clear/rebuild them every frame independently.
    this.utilityLineGroup = null;
    this.utilityLinePreviewGroup = null;
    this.unwiredSinkGroup = null;
    this.portFittingGroup = null;
    this.wallVisibilityMode = 'transparent';
    this._snapshot = null;

    // Unwired-sink marker memo: keyed on the gate's blocker set, so a steady
    // world never pays for the endpoint-index walk the markers need.
    this._unwiredBlockerSig = null;

    // Camera focus animation (focusOnTile). Inert until a focus is requested;
    // cancelled by any manual pan/zoom.
    this._focusing = false;

    // Utility-port marker memo: markers rebuild only when a world event has
    // fired (_portMarkersDirty, set in the game event handler) or when the
    // interactive signature (armed type + hover/draw anchors) changes —
    // never unconditionally per rAF.
    this._portMarkersDirty = true;
    this._portMarkersSig = null;

    // Beam-pipe preview / hover-marker memo: both renderers tear down and
    // rebuild their whole geometry, so they run only when the signature of
    // what they read changes — not on every rAF while the tool sits idle.
    this._beamPipeSig = null;

    // Grid-overlay memo. updateHover and the ghost renderer each ask for the
    // overlay on the same mousemove; the built LineSegments are cached and
    // re-attached so the ~400-segment rebuild happens once per cursor tile.
    this._gridOverlaySig = null;
    this._gridOverlayLines = [];

    // Cost-label sprite material memo: text → { material, scaleX, scaleY }.
    // The beam-pipe drawing cost label re-renders per rAF while dragging;
    // caching per text value avoids a canvas draw + texture upload per frame.
    // Flushed wholesale past _LABEL_CACHE_MAX entries (safe: the only cached
    // consumer is the single preview cost sprite, cleared before each make).
    this._labelMatCache = new Map();

    this.overlay = new OverlayShim();

    // --- Compatibility properties (InputHandler, main.js, hud.js) ---
    this.buildMode = false;
    this._buildToolType = null;
    this.placementDir = 0;
    this.hoverCol = 0;
    this.hoverRow = 0;
    this.labelLevel = 0;
    this.zoneOverlayVisible = true;
    this.showZoneLabels = true;
    // Zone name paint (see zone-label.js). The style is swappable at runtime
    // so the variants can be compared in the real scene; the meshes list and
    // the camera-right signature drive the once-per-orbit direction flip.
    this.zoneLabelStyle = DEFAULT_ZONE_LABEL_STYLE;
    this._zoneLabelMeshes = [];
    this._zoneLabelFacingSig = null;
    this._zoneLabelFontRetry = false;
    this.activeMode = 'beamline';
    this.nodeSprites = {};

    // PixiJS layers — stubs for code that references them directly
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

    // Callback stubs. (Palette item selection no longer flows through
    // renderer callbacks — hud.js routes straight into
    // InputHandler.selectPaletteTool via each item's {kind, key} dataset.)
    this._onPaletteClick = null;
    this._onTabSelect = null;
    this.onProbeClick = null;

    // UI host: owns DOM-side UI (HUD, popups, tech tree, anchored windows).
    // Installs method forwards on `this` for every UI method so existing
    // `this.foo()` call sites keep working. Forwards dispatch to this.ui,
    // giving the UI layer a narrow, intentional view of renderer state via
    // UIHost's pass-through getters.
    this.ui = new UIHost(this);
    for (const name of UI_METHODS) {
      this[name] = (...args) => this.ui[name](...args);
    }
    // Data-property forward: InputHandler reads renderer._schematicDrawers
    // directly before dispatching a schematic draw.
    Object.defineProperty(this, '_schematicDrawers', {
      get: () => this.ui._schematicDrawers,
      configurable: true,
    });
  }

  async init() {
    const gameEl = document.getElementById('game');

    // Retro pixelation: render the scene at 1/N of the logical canvas
    // resolution, then CSS-upscale the canvas back to full size with
    // `image-rendering: pixelated`. This chunks every material (including
    // decal textures) uniformly without needing per-asset changes.
    // Increase for chunkier pixels; 1 disables the effect.
    this._pixelScale = 2;

    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x1a1a2e);

    const threeCanvas = this.renderer.domElement;
    threeCanvas.style.position = 'absolute';
    threeCanvas.style.top = '0';
    threeCanvas.style.left = '0';
    threeCanvas.style.zIndex = '10';
    threeCanvas.style.pointerEvents = 'none';
    threeCanvas.style.imageRendering = 'pixelated';
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
    this._ambientLight = new THREE.AmbientLight(0xfff5e6, 1.3);
    this.scene.add(this._ambientLight);

    this._sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this._sunLight.position.set(-30, 40, -30);
    this._sunLight.castShadow = true;
    this._sunLight.shadow.autoUpdate = false;
    this._sunLight.shadow.needsUpdate = false;
    this._sunLight.shadow.bias = -0.0005;
    this._sunLight.shadow.normalBias = 0.01;
    this._sunLight.shadow.camera.near = 0.5;
    this._sunLight.shadow.camera.far = 500;
    this._sunLight.shadow.camera.left = -60;
    this._sunLight.shadow.camera.right = 60;
    this._sunLight.shadow.camera.top = 60;
    this._sunLight.shadow.camera.bottom = -60;
    this.scene.add(this._sunLight);

    // Moon: a weak cool-blue stand-in for the sun at night (see
    // day-night.js). No shadow map — it exists so midnight geometry keeps
    // some directional form, not to cast crisp shadows.
    this._moonLight = new THREE.DirectionalLight(0xffffff, 0);
    this._moonLight.color.setRGB(MOON_COLOR[0], MOON_COLOR[1], MOON_COLOR[2]);
    this._moonLight.position.set(30, 40, 30);
    this._moonLight.castShadow = false;
    this.scene.add(this._moonLight);

    // Sun orbit is driven by game.state.timeOfDay (the sim clock — see
    // DAY_LENGTH_TICKS/isNightAt in game/Game.js), not a wall clock. These
    // two fields let the sun glide at frame rate between the sim's 1 Hz
    // ticks instead of jumping once per tick: _localTimeOfDay is a copy
    // advanced every frame and resynced from game.state.timeOfDay whenever
    // that authoritative value changes; see _updateSunCycle.
    this._localTimeOfDay = null;
    this._lastSyncedTimeOfDay = null;
    this._lastSunFrameTime = performance.now();
    this._lastAnimTime = performance.now();
    this._lastLodDetail = undefined; // force first LOD update

    // Selective bloom / glow post-processing. Reads the persisted toggle so
    // the setting survives a reload; defaults on. Constructed here (renderer
    // + scene + camera all exist by this point) — note _setSize() above at
    // :463 ran *before* this and guards its pipeline call for that reason.
    let glowStored;
    try { glowStored = localStorage.getItem('beamlineTycoon.glow'); } catch (_) { glowStored = null; }
    let qualityStored;
    try { qualityStored = localStorage.getItem('beamlineTycoon.lightingQuality'); } catch (_) { qualityStored = null; }
    this._lightingQualityRequested = normalizeLightingQuality(qualityStored);
    this._lightingQuality = resolveLightingQuality(this._lightingQualityRequested, {
      hardwareConcurrency: globalThis.navigator?.hardwareConcurrency,
      deviceMemory: globalThis.navigator?.deviceMemory,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
    });
    this._setShadowMapSize(this._sunLight.shadow, this._lightingQuality.sunShadowMapSize);
    this._sunShadowScheduler = new ShadowScheduler(1, {
      hz: this._lightingQuality.sunShadowHz,
      maxUpdatesPerFrame: 1,
    });
    // GlowPipeline reads the renderer's current size in its own constructor
    // (already correct — _setSize() ran above at :463, before this point),
    // so no separate setSize() call is needed here.
    this._glowPipeline = new GlowPipeline(this.renderer, this.scene, this.camera, {
      enabled: glowStored !== '0',
      quality: this._lightingQuality,
    });

    // Real lights: lamppost/wall-light shadows and explosion flashes. Shares
    // the same persisted glow toggle as GlowPipeline (see setGlowEnabled) —
    // "everything the glow feature added" is one on/off switch to the player,
    // not two. Pool sizes/shadow resolution are constructor options (see
    // light-rig.js) so a frame-budget complaint is a one-line dial, not a
    // rewrite.
    this._lightRig = new LightRig(this.scene, {
      enabled: glowStored !== '0',
      shadowSpotCount: MAX_FIXTURE_SHADOWS,
      activeShadowSpotCount: this._lightingQuality.fixtureShadowCount,
      pointCount: 8,
      shadowMapSize: this._lightingQuality.fixtureShadowMapSize,
      shadowHz: this._lightingQuality.fixtureShadowHz,
    });
    let volumeStored;
    try { volumeStored = localStorage.getItem('beamlineTycoon.volumetricLighting'); } catch (_) { volumeStored = null; }
    this._volumetricEnabled = volumeStored !== '0' && glowStored !== '0';
    this._volumePool = new VolumetricLightPool(this.scene, {
      maxCount: MAX_FIXTURE_SHADOWS,
      activeCount: this._lightingQuality.volumetricCount,
      enabled: this._volumetricEnabled,
    });
    this._lightFocus = new THREE.Vector3();

    // Scene groups
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    this.scene.add(this.terrainGroup);
    this.wildflowerBuilder.add(this.terrainGroup);
    this.grassTuftBuilder.add(this.terrainGroup);

    this.floorGroup = new THREE.Group();
    this.floorGroup.name = 'floors';
    this.scene.add(this.floorGroup);

    this.wallGroup = new THREE.Group();
    this.wallGroup.name = 'walls';
    this.scene.add(this.wallGroup);

    this.zoneGroup = new THREE.Group();
    this.zoneGroup.name = 'zones';
    this.scene.add(this.zoneGroup);

    this.connectionGroup = new THREE.Group();
    this.connectionGroup.name = 'connections';
    this.scene.add(this.connectionGroup);

    // Phase 4: new-system utility lines. Separate from connectionGroup (which
    // still holds the legacy rack-paint meshes) so we can rebuild them on
    // utilityLinesChanged without disturbing the older pipes.
    this.utilityLineGroup = new THREE.Group();
    this.utilityLineGroup.name = 'utilityLinesV2';
    this.scene.add(this.utilityLineGroup);
    this.utilityLinePreviewGroup = new THREE.Group();
    this.utilityLinePreviewGroup.name = 'utilityLinesV2Preview';
    this.utilityLinePreviewGroup.renderOrder = 998;
    this.scene.add(this.utilityLinePreviewGroup);

    // Unwired declared sinks — always-on markers, independent of the armed
    // tool, so a tripped beam is traceable to its offenders without hovering.
    this.unwiredSinkGroup = new THREE.Group();
    this.unwiredSinkGroup.name = 'unwiredSinkMarkers';
    this.unwiredSinkGroup.renderOrder = 1000;
    this.scene.add(this.unwiredSinkGroup);
    // Connector hardware on equipment. Ordinary scene geometry (depth-tested,
    // no renderOrder games) — these are part of the machines, not an overlay.
    this.portFittingGroup = new THREE.Group();
    this.portFittingGroup.name = 'utilityPortFittings';
    this.scene.add(this.portFittingGroup);

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

    // Task 6 fake-lighting layer — see the constructor field comment above
    // lightPoolGroup/lightHaloGroup. Separate from decorationGroup: neither
    // is a raycast target (no demolish/hover/move behavior), so they don't
    // belong in the group _updateLOD/hit-testing traverse.
    this.lightPoolGroup = new THREE.Group();
    this.lightPoolGroup.name = 'lightPools';
    this.scene.add(this.lightPoolGroup);

    this.lightHaloGroup = new THREE.Group();
    this.lightHaloGroup.name = 'lightHalos';
    this.scene.add(this.lightHaloGroup);

    // Preview group — semi-transparent geometry for placement/demolish feedback
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'preview';
    this.previewGroup.renderOrder = 999;
    this.scene.add(this.previewGroup);

    // Selection is deliberately separate from previewGroup. Placement and
    // hover feedback clear that group every mouse move; a clicked object must
    // remain legible as selected while its information window is open.
    this.selectionGroup = new THREE.Group();
    this.selectionGroup.name = 'selectionOutline';
    this.selectionGroup.renderOrder = 1000;
    this.scene.add(this.selectionGroup);

    // Design-placement ghost — see the constructor field comment. Added before
    // previewGroup's tile quads in draw order would be wrong (the quads are
    // depthTest:false floor markers meant to read *under* the machine), so it
    // goes after: same renderOrder, later in the scene, drawn on top.
    this.designGhostGroup = new THREE.Group();
    this.designGhostGroup.name = 'designGhost';
    this.designGhostGroup.renderOrder = 999;
    this.scene.add(this.designGhostGroup);

    // Grid overlay group — placement grid lines (separate from preview so _clearPreview doesn't wipe them)
    this.gridOverlayGroup = new THREE.Group();
    this.gridOverlayGroup.name = 'gridOverlay';
    this.gridOverlayGroup.renderOrder = 997;
    this.scene.add(this.gridOverlayGroup);

    // Staff pawns — little walking pixel-people for hired staff
    this.staffPawns = new StaffPawns(this.game, this.scene);

    window.addEventListener('resize', this._boundOnResize);

    // Game event listener — rebuilds relevant 3D sections and updates DOM HUD.
    // Wrapped in try/catch so rendering errors never crash game logic.
    this.game.on((event, data) => {
      try {
      // Any world event may have moved a port or claimed a utility line —
      // let _animate rebuild the armed-tool port markers on its next frame.
      this._portMarkersDirty = true;
      // Same idea for the light rig's candidate lists (placed fixtures,
      // glow-role meshes) — invalidate on every event rather than trying to
      // enumerate exactly which events could add/remove one; the actual
      // scene traversal is deferred to the rig's next update() call.
      if (this._lightRig) this._lightRig.markDirty();
      if (this._sunShadowScheduler) this._sunShadowScheduler.markAllDirty();
      switch (event) {
        case 'beamlineChanged':
          this.refresh(); // full 3D rebuild
          break;
        case 'loaded':
        case 'restored':   // undo/redo snapshot restore
          this.refresh(); // full 3D rebuild
          // Both overlays are snapshot renders baked at init() — before
          // game.load() runs — and are otherwise only redrawn on
          // 'researchChanged' / 'objectiveCompleted' or by their HUD buttons.
          // Opening them with the R / G hotkeys after a load therefore showed
          // the fresh-game tree (completed nodes rendered un-researched) and
          // stale objective progress.
          if (this._renderTechTree) this._renderTechTree();
          if (this._renderGoalsOverlay) this._renderGoalsOverlay();
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
        case 'windowsChanged':
          this._refreshWalls();
          break;
        case 'placeableChanged':
          this._refreshEquipment();
          this._refreshDecorations();
          this._refreshComponents();
          this._refreshUtilityLinesV2();
          // Geometry moved; the blocker set may be identical, so force.
          this._refreshUnwiredSinkMarkers(true);
          this._refreshPortFittings();
          break;
        case 'facilityChanged':
          this._refreshEquipment();
          this._refreshComponents();
          break;
        case 'connectionsChanged':
          this._refreshConnections();
          this._refreshComponents();
          break;
        case 'utilityLinesChanged':
          this._refreshUtilityLinesV2();
          this._refreshUnwiredSinkMarkers();
          break;
        // The gate reran (beam toggle while paused, or a beamline recalc), so
        // state.infraBlockers may have changed without a tick — and while
        // paused there is no tick to repaint the HUD side of it either.
        case 'infrastructureValidated':
          this._refreshUnwiredSinkMarkers();
          if (this._updateBeamSummary) this._updateBeamSummary();
          break;
        case 'beamToggled':
          this._refreshBeam();
          if (this._updateBeamSummary) this._updateBeamSummary();
          break;
        case 'tick':
          if (this._updateHUD) this._updateHUD();
          if (this._updateTreeProgress) this._updateTreeProgress();
          // Refresh utility line meshes so emissive glow reflects the
          // latest per-network error status. The builder's hash cache
          // short-circuits unchanged lines, so this is cheap in practice.
          this._refreshUtilityLinesV2();
          // Guarded on the blocker signature — a steady world costs one
          // string join over a handful of entries.
          this._refreshUnwiredSinkMarkers();
          break;
        case 'researchChanged':
          if (this._renderTechTree) this._renderTechTree();
          break;
        case 'objectiveCompleted':
          if (this._renderGoalsOverlay) this._renderGoalsOverlay();
          break;
        case 'staffChanged':
          if (this._renderStaffBar) this._renderStaffBar();
          if (this._refreshStaffWindows) this._refreshStaffWindows();
          if (this.staffPawns) this.staffPawns.sync();
          break;
      }
      } catch (e) { console.error(`[ThreeRenderer] event '${event}' handler error:`, e); }
    });

    // Initialize the event-capture overlay canvas
    this.overlay.init();

    // Wire app/world for compatibility with InputHandler and DOM HUD code.
    // The shim itself has the old app shape ({canvas, screen}).
    this.app = this.overlay;
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

    // Mount the live view-cube widget if its DOM host exists. (It's a
    // bottom-right HUD element wired into index.html.)
    const cubeHost = document.getElementById('view-cube-widget');
    if (cubeHost) {
      this._viewCube = new ViewCube(this, cubeHost);
    }

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
   * screenToWorld against a horizontal plane at `height` metres instead of the
   * ground. A tool that draws its geometry above the floor has to PICK at the
   * same height it draws at: under the iso camera, projecting the cursor onto
   * y=0 and then rendering the result at y=0.5 displaces the drawing 15-25 px
   * up-screen from the mouse at normal zoom, which reads as the tool refusing
   * to place where you clicked (utility lines, which live at PIPE_Y).
   *
   * Deliberately ignores `_terrainMesh` — the whole point is the flat plane the
   * tool works on, not the surface under it.
   */
  screenToWorldAtHeight(screenX, screenY, height) {
    if (!height) return this.screenToWorld(screenX, screenY);
    if (!this.camera || !this.renderer) return this.screenToWorld(screenX, screenY);
    const { raycaster } = this._screenRay(screenX, screenY);
    let plane = this._heightPlaneScratch;
    if (!plane) plane = this._heightPlaneScratch = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // Plane equation is normal·p + constant = 0, so y = height is constant = -height.
    plane.constant = -height;
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return this.screenToWorld(screenX, screenY);
    return gridToIso(hit.x / 2, hit.z / 2);
  }

  /**
   * Surface-aware variant of screenToWorld for placement preview. Raycasts
   * placeable meshes (equipment, decoration, component groups) alongside the
   * terrain and picks whichever hit is closest to the camera. This makes the
   * cursor snap to the subtile *under the mesh point* when hovering over a
   * bench or a stacked item, instead of snapping to the floor behind it —
   * downstream `findStackTarget` descent then targets the hit surface.
   *
   * Falls back to `screenToWorld` when no meshes are hit.
   */
  screenToPlacementWorld(screenX, screenY) {
    if (!this.camera || !this.renderer) return this.screenToWorld(screenX, screenY);
    const { raycaster, groundPlane } = this._screenRay(screenX, screenY);

    const hits = [];
    const groups = [this.equipmentGroup, this.decorationGroup, this.componentGroup];
    for (const g of groups) {
      if (!g) continue;
      // three.js tests object.visible, not material.visible, so the invisible
      // collision box ComponentBuilder._createObject adds at BEAM_HEIGHT is a
      // live raycast target. Snapping to it lifts stackable ghosts a metre
      // into the air next to any beamline module. (Same guard as
      // _outlineObject.)
      for (const h of raycaster.intersectObjects(g.children, true)) {
        const mat = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
        if (mat && mat.visible === false) continue;
        hits.push(h);
      }
    }
    if (this._terrainMesh) {
      hits.push(...raycaster.intersectObject(this._terrainMesh));
    }
    // Ground plane fallback (matches screenToWorld's sky-miss behavior).
    const planePoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, planePoint)) {
      hits.push({ point: planePoint, distance: raycaster.ray.origin.distanceTo(planePoint) });
    }

    if (!hits.length) return this.screenToWorld(screenX, screenY);
    hits.sort((a, b) => a.distance - b.distance);
    const p = hits[0].point;
    const fCol = p.x / 2;
    const fRow = p.z / 2;
    return gridToIso(fCol, fRow);
  }

  /**
   * Raycast from a screen position into the 3D scene.
   * Returns the first intersected mesh (skipping preview/terrain/grid),
   * or null if nothing is hit.
   */
  raycastScreen(screenX, screenY) {
    if (!this.renderer || !this.camera) return null;
    const { raycaster } = this._screenRay(screenX, screenY);
    // Decorations are demolishable/movable placeables, so they must be in the
    // target set — identifyHit already resolves decorationGroup, but without
    // this the decoration branch downstream is unreachable.
    const targets = [this.componentGroup, this.equipmentGroup, this.decorationGroup, this.connectionGroup, this.wallGroup, this.beamPipeGroup, this.pipeAttachmentGroup];
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
   * Raycast for new-system utility lines (Phase 4/5). Returns
   * { lineId, utilityType } from the closest hit, or null.
   * Each line Group has `userData.lineId` and `userData.utilityType` set by
   * utility-line-builder-v2's buildLineGroup.
   */
  raycastUtilityLine(screenX, screenY) {
    if (!this.renderer || !this.camera || !this.utilityLineGroup) return null;
    const { raycaster } = this._screenRay(screenX, screenY);
    const hits = raycaster.intersectObjects(this.utilityLineGroup.children, true);
    if (!hits || hits.length === 0) return null;
    // Find the closest hit and walk up to the group with lineId userData.
    hits.sort((a, b) => a.distance - b.distance);
    for (const h of hits) {
      let obj = h.object;
      while (obj) {
        if (obj.userData && obj.userData.lineId) {
          return { lineId: obj.userData.lineId, utilityType: obj.userData.utilityType };
        }
        if (obj.parent === this.utilityLineGroup) break;
        obj = obj.parent;
      }
    }
    return null;
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
        // Wrapper Groups carry their id in userData.nodeId (stamped by
        // ComponentBuilder.build) — no _meshMap scan needed.
        if (obj.userData.nodeId != null) {
          return { group: 'component', rootObj: obj, nodeId: obj.userData.nodeId };
        }
        return { group: 'component', rootObj: obj };
      }
      if (obj.parent === this.pipeAttachmentGroup) {
        // Attachment wrappers are built by the same ComponentBuilder, so the
        // attachment id rides on userData.nodeId; pipeId is stamped too.
        return {
          group: 'attachment',
          rootObj: obj,
          attachmentId: obj.userData.nodeId ?? null,
          pipeId: obj.userData.pipeId || null,
        };
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
   * Raycast a screen pixel to the terrain surface. Returns a THREE.Vector3 or
   * null. Falls back to the y=0 plane when the terrain mesh is absent (e.g.
   * pre-first-snapshot) or when the ray misses the mesh (e.g. aimed at sky).
   * Uses the current camera orientation, so it respects view rotation.
   */
  _raycastGround(screenX, screenY) {
    if (!this.camera || !this.renderer) return null;
    const { raycaster, groundPlane } = this._screenRay(screenX, screenY);
    if (this._terrainMesh) {
      const intersections = raycaster.intersectObject(this._terrainMesh);
      if (intersections.length > 0) return intersections[0].point;
    }
    // Result Vector3 stays freshly allocated — callers hold returned points
    // across subsequent raycasts (e.g. zoomAt's before/after pair).
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
  }

  /**
   * A 3D world point (metres) -> viewport pixels, in the same client
   * coordinate space as a MouseEvent's clientX/clientY.
   *
   * The inverse of `_raycastGround`, and the thing that lets input hit-test
   * against geometry that is NOT on the ground plane. A utility port lives on
   * the side of a machine a metre or two up (see port-anchors.js), so the only
   * honest way to ask "is the cursor on that port" is to project the port and
   * compare in pixels — the ground point under the cursor is a different place
   * entirely, and how different depends on camera height and zoom.
   *
   * The scratch vector is reused: this runs once per available port per
   * mousemove. Returns null before the camera exists.
   *
   * @returns {{x: number, y: number}|null} client pixels
   */
  worldToScreen(x, y, z) {
    if (!this.camera || !this.renderer) return null;
    const v = this._projScratch || (this._projScratch = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  /**
   * Aim the shared screen-ray scratch objects at a screen pixel and return
   * them. Raycaster/Vector2/Plane fire on every mousemove (placement
   * preview, hover picking, ground raycasts), so they are allocated once
   * per renderer and re-aimed per call instead of per event. The ground
   * plane is constant (y=0, +Y normal) and never mutated by intersectPlane.
   * Callers must consume the raycaster before the next _screenRay call.
   */
  _screenRay(screenX, screenY) {
    let s = this._rayScratch;
    if (!s) {
      s = this._rayScratch = {
        raycaster: new THREE.Raycaster(),
        ndc: new THREE.Vector2(),
        groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      };
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    s.ndc.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    s.raycaster.setFromCamera(s.ndc, this.camera);
    return s;
  }

  /**
   * Keep the overlay-shim world.x/y/scale in sync with the current pan/zoom.
   * These are legacy bookkeeping readers (save/load, some debug paths). They
   * use the rotation=0 iso formula regardless of current rotation, since
   * nothing is drawn through the overlay.
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
    this.world.scale = this.zoom;
    this._frustumSize = Math.SQRT2 * screenH / (32 * this.zoom);
    this._updateCameraFrustum();
  }

  zoomAt(screenX, screenY, delta) {
    // Manual input wins over an in-flight focus animation, which would
    // otherwise keep overwriting pan/zoom for the rest of its duration.
    this._focusing = false;
    // Remember which world point is under the cursor before the zoom.
    const before = this._raycastGround(screenX, screenY);
    this.zoom = Math.max(0.2, Math.min(ZOOM_MAX, this.zoom + delta));
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
    this._focusing = false;   // manual pan cancels a focus animation
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
    this._focusing = false;   // manual pan cancels a focus animation
    const a = this._effectiveYaw();
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
    this._focusing = false;   // manual pan cancels a focus animation
    this._panX = startPanX;
    this._panY = startPanY;
    this._updateCameraLookAt();
    this.panBy(dxTotal, dyTotal);
  }

  /**
   * Rotate the view by ±45° (RCT2-style, extended to 8 facings). Animates to
   * the new rest angle. Operates on the active mode's yaw index — iso and
   * top-down keep independent facings.
   */
  rotateView(delta) {
    if (this._viewRotating || this._snapping) return;
    const step = delta > 0 ? 1 : -1;
    const nextIdx = (((this._currentYawIdx() + step) % YAW_DIVISIONS) + YAW_DIVISIONS) % YAW_DIVISIONS;
    this._setCurrentYawIdx(nextIdx);
    this._viewRotFromAngle = this._viewRotationAngle;
    this._viewRotToAngle = this._viewRotFromAngle + step * YAW_STEP;
    this._viewRotStartMs = performance.now();
    this._viewRotating = true;
    if (this.world) this.world.visible = false;
  }

  _currentYawIdx() {
    return this.viewMode === 'top' ? this._topYawIdx : this._isoYawIdx;
  }

  _setCurrentYawIdx(i) {
    if (this.viewMode === 'top') this._topYawIdx = i;
    else this._isoYawIdx = i;
  }

  /**
   * Animated transition to a target view (mode + optional yaw index).
   * Reuses the free-orbit snap machinery. Ignored if a free-orbit drag
   * is active or any view animation is already in flight.
   */
  setViewMode(mode, yawIdx) {
    if (mode !== 'iso' && mode !== 'top') return;
    if (this._freeOrbiting || this._viewRotating || this._snapping) return;
    const fromYaw = this._viewRotationAngle;
    const fromPitch = this._effectivePitch();
    const toPitch = targetPitchForMode(mode);
    let toYaw = fromYaw;
    if (yawIdx !== undefined && yawIdx !== null) {
      // Shortest signed delta: choose the multiple of 2π so the animation
      // takes the short way around the yaw circle.
      const target = yawIdx * YAW_STEP;
      const k = Math.round((fromYaw - target) / (2 * Math.PI));
      toYaw = target + k * 2 * Math.PI;
    }
    if (
      Math.abs(toYaw - fromYaw) < 1e-9 &&
      Math.abs(toPitch - fromPitch) < 1e-9 &&
      this.viewMode === mode
    ) {
      return;
    }
    this._snapFromYaw = fromYaw;
    this._snapToYaw = toYaw;
    this._snapFromPitch = fromPitch;
    this._snapToPitch = toPitch;
    this._snapStartMs = performance.now();
    this._snapTargetMode = mode;
    this._snapping = true;
    // _effectiveYaw/_effectivePitch read _freeYaw/_freePitch while
    // _snapping is true, so seed them with the current orientation.
    this._freeYaw = fromYaw;
    this._freePitch = fromPitch;
    if (this.world) this.world.visible = false;
  }

  /**
   * Begin a free-orbit drag. Called on middle-mouse-down. Cancels any
   * in-flight Q/E rotation or release snap and seeds the free yaw/pitch
   * from the current effective orientation so there is no visible jump.
   */
  startFreeOrbit() {
    // Snapshot current orientation BEFORE flipping mode flags, so
    // _effectiveYaw returns the pre-transition value.
    const yaw = this._effectiveYaw();
    const pitch = this._effectivePitch();
    this._viewRotating = false;
    this._snapping = false;
    this._freeYaw = yaw;
    this._freePitch = pitch;
    this._freeOrbiting = true;
    // Match the behavior of rotateView: the PixiJS overlay is hidden
    // during any camera animation. Restored when _tickFreeOrbitSnap ends.
    if (this.world) this.world.visible = false;
  }

  /**
   * Apply a mouse-delta during a free-orbit drag. dxPx/dyPx are raw pixel
   * deltas since the last mousemove. Drag up tilts up toward top-down.
   */
  orbitBy(dxPx, dyPx) {
    if (!this._freeOrbiting) return;
    this._freeYaw += dxPx * ORBIT_YAW_SENSITIVITY;
    this._freePitch = clampPitch(this._freePitch - dyPx * ORBIT_PITCH_SENSITIVITY);
    this._updateCameraLookAt();
    this._syncOverlayFromPan();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
  }

  /**
   * End a free-orbit drag. Picks the closer preset (iso vs top-down) by
   * release pitch and kicks off a 400ms easeInOutQuad animation back to
   * that view. Yaw snaps to the nearest π/4 multiple. On completion,
   * viewMode and the destination mode's yaw index are updated so Q/E
   * continues from the snapped pose.
   */
  endFreeOrbit() {
    if (!this._freeOrbiting) return;
    this._freeOrbiting = false;
    const targetMode = pickSnapMode(this._freePitch);
    this._snapFromYaw = this._freeYaw;
    this._snapFromPitch = this._freePitch;
    this._snapToYaw = snapYaw(this._freeYaw, YAW_STEP);
    this._snapToPitch = targetPitchForMode(targetMode);
    this._snapStartMs = performance.now();
    this._snapTargetMode = targetMode;
    this._snapping = true;
  }

  _tickFreeOrbitSnap() {
    if (!this._snapping) return;
    const t = Math.min(1, (performance.now() - this._snapStartMs) / this._snapDurationMs);
    const k = easeInOutQuad(t);
    this._freeYaw = this._snapFromYaw + (this._snapToYaw - this._snapFromYaw) * k;
    this._freePitch = this._snapFromPitch + (this._snapToPitch - this._snapFromPitch) * k;
    this._updateCameraLookAt();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
    if (t >= 1) {
      // Commit the target mode and write the snapped yaw into that mode's index.
      this.viewMode = this._snapTargetMode;
      this._viewRotationAngle = this._snapToYaw;
      const idx = ((Math.round(this._snapToYaw / YAW_STEP) % YAW_DIVISIONS) + YAW_DIVISIONS) % YAW_DIVISIONS;
      this._setCurrentYawIdx(idx);
      this._freePitch = targetPitchForMode(this.viewMode);
      this._snapping = false;
      if (this.world) this.world.visible = true;
    }
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

  // --- State setters (InputHandler compatibility) ---

  updateHover(col, row) {
    this.hoverCol = col;
    this.hoverRow = row;
    const utilityToolActive = this._inputHandler?.utilityLineController?.utilityType;
    if (this.buildMode || utilityToolActive) {
      this._renderCursors();
    }
    // Cutaway detection is expensive — a walls/doors/occupancy snapshot
    // rebuild plus one flood fill per boundary wall, then a full region
    // sort for the builder's cache key — and updateHover runs on every raw
    // pointer event. Redo it only when the cursor enters a different tile.
    // (The HUD's wall-mode buttons null _cutawayHoverKey to force a
    // re-detection, and wall edits go through _refreshWalls directly.)
    if (this.wallVisibilityMode === 'cutaway') {
      const hoverKey = col + ',' + row;
      if (hoverKey !== this._cutawayHoverKey) {
        this._cutawayHoverKey = hoverKey;
        this._applyWallVisibility();
      }
    }
  }

  setBuildMode(active, toolType) {
    this.buildMode = active;
    this._buildToolType = toolType || null;
    this._renderCursors();
  }

  setProbeMode(active) {
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

  /**
   * Show/hide only the zone name paint, leaving the zone tile tint visible.
   * Cheap: flips `.visible` on the label meshes already in zoneGroup; no
   * rebuild needed. Keyed on userData.isZoneLabel rather than a type test —
   * the labels used to be the only Sprites in the group, but they are ground
   * quads now and would be indistinguishable from the tint tiles by type.
   */
  toggleZoneLabels() {
    this.showZoneLabels = !this.showZoneLabels;
    for (const mesh of this._zoneLabelMeshes) mesh.visible = this.showZoneLabels;
    return this.showZoneLabels;
  }

  /**
   * Live on/off switch for the bloom/glow post-processing pipeline — and,
   * since the player sees this as one "dynamic lighting" feature rather than
   * three separate ones, everything Task 5 added too: the light rig (fixture
   * shadows, ambient glow points, flashes) and the floor-glow strips painted
   * under utility runs. Forwards to GlowPipeline/LightRig and takes effect on
   * the very next frame; persistence is the caller's job (see OptionsDialog,
   * which owns 'beamlineTycoon.glow').
   */
  setGlowEnabled(enabled) {
    if (this._glowPipeline) this._glowPipeline.setEnabled(enabled);
    if (this._lightRig) this._lightRig.setEnabled(enabled);
    if (this._volumePool) this._volumePool.setEnabled(enabled && this._volumetricEnabled);
    this._applyGlowToggleToFloorStrips();
  }

  get glowEnabled() {
    return this._glowPipeline ? this._glowPipeline.enabled : true;
  }

  setVolumetricEnabled(enabled) {
    this._volumetricEnabled = !!enabled;
    if (this._volumePool) this._volumePool.setEnabled(this._volumetricEnabled && this.glowEnabled);
  }

  get volumetricEnabled() {
    return this._volumetricEnabled !== false;
  }

  setLightingQuality(value) {
    this._lightingQualityRequested = normalizeLightingQuality(value);
    this._lightingQuality = resolveLightingQuality(this._lightingQualityRequested, {
      hardwareConcurrency: globalThis.navigator?.hardwareConcurrency,
      deviceMemory: globalThis.navigator?.deviceMemory,
      maxTextureSize: this.renderer?.capabilities?.maxTextureSize,
    });
    if (this._lightRig) this._lightRig.setQuality(this._lightingQuality);
    if (this._volumePool) this._volumePool.setQuality(this._lightingQuality);
    if (this._sunShadowScheduler) {
      this._sunShadowScheduler.configure({ hz: this._lightingQuality.sunShadowHz, maxUpdatesPerFrame: 1 });
      this._sunShadowScheduler.markAllDirty();
    }
    if (this._sunLight) {
      this._setShadowMapSize(this._sunLight.shadow, this._lightingQuality.sunShadowMapSize);
    }
    if (this._glowPipeline?.setQuality) this._glowPipeline.setQuality(this._lightingQuality);
    return this._lightingQuality.name;
  }

  get lightingQuality() {
    return this._lightingQualityRequested || 'auto';
  }

  getLightingStats() {
    return {
      quality: this._lightingQuality?.name || 'unknown',
      requestedQuality: this.lightingQuality,
      sunShadowUpdate: !!this._sunLight?.shadow?.needsUpdate,
      ...(this._lightRig?.getStats() || {}),
      ...(this._volumePool?.getStats() || {}),
    };
  }

  _setShadowMapSize(shadow, mapSize) {
    if (!shadow) return;
    const size = Math.max(128, Math.floor(mapSize || 1024));
    if (shadow.mapSize.width === size && shadow.mapSize.height === size) return;
    shadow.mapSize.set ? shadow.mapSize.set(size, size) : Object.assign(shadow.mapSize, { width: size, height: size });
    if (shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
    shadow.needsUpdate = true;
  }

  /**
   * Hide/show floor-glow strips (floor-glow.js's buildFloorGlowStrip output,
   * tagged userData.isFloorGlowStrip) to match the current glow toggle.
   * Called from setGlowEnabled (toggle flips) and from
   * _refreshUtilityLinesV2 (a rebuilt line's fresh strip otherwise defaults
   * to visible regardless of the toggle already in effect).
   */
  _applyGlowToggleToFloorStrips() {
    if (!this.utilityLineGroup) return;
    const visible = this.glowEnabled;
    this.utilityLineGroup.traverse((obj) => {
      if (obj.userData && obj.userData.isFloorGlowStrip) obj.visible = visible;
    });
  }

  /**
   * Fire an impulse flash (explosion, fault spark, ...) without the caller
   * reaching into the light rig directly. Forwards to LightRig.flash, which
   * reuses a parked point-light slot — never allocates.
   */
  flashLight(position, colorHex, intensity, durationMs) {
    if (this._lightRig) this._lightRig.flash(position, colorHex, intensity, durationMs);
  }

  /** No-op. Dipole bend direction is baked into the placed geometry; nothing
   *  in the renderer reads it. Retained only because InputHandler calls it. */
  updateCursorBendDir() {}
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

    // Show grid lines around cursor when in any placement mode, including
    // utility-line drawing (subtile grid helps the player line up endpoints).
    const placer = this.game._designPlacer;
    const utilityToolActive = this._inputHandler?.utilityLineController?.utilityType;
    const inPlaceMode = this.buildMode || utilityToolActive
      || (placer && placer.active);
    if (inPlaceMode) {
      this._renderGridAroundCursor(this.hoverCol, this.hoverRow);
    }

    // Design placement runs first and unconditionally. It used to sit at the
    // bottom of this method, behind `if (!this.buildMode) return` — and
    // nothing in the design-placement flow arms a build tool (DesignPlacer is
    // started from the library / blueprint gallery, not the palette; only
    // beamline-tool.js ever sets buildMode), so the footprint preview was
    // unreachable in the one mode it exists for.
    this._renderDesignPlacerPreview(placer);

    if (!this.buildMode) return;

    // Get nodes for the currently edited beamline (from the cached world
    // snapshot — components carry beamlineId).
    let nodes = [];
    if (this.game.editingBeamlineId) {
      const entry = this.game.registry.get(this.game.editingBeamlineId);
      if (entry) nodes = (this._snapshot?.components || []).filter(c => c.beamlineId === this.game.editingBeamlineId);
    }

    if (nodes.length === 0) {
      const comp = this._buildToolType ? COMPONENTS[this._buildToolType] : null;
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

      // `isDrawn` is always false past the guard above, so there is no
      // drawn-connection branch here — beam pipes preview via
      // _renderBeamPipePreview / _renderPipeHoverMarker.
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

      // Check tile availability against the cached snapshot's components
      const available = !(this._snapshot?.components || []).some(c => c.category === 'beamline' && c.tiles?.some(t => t.col === this.hoverCol && t.row === this.hoverRow));
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
    }
  }

  /**
   * Ground markings for a design placement: the concrete that will be poured,
   * and — only when the placement is illegal — a red wash over the module
   * footprint. The green fill that used to cover every footprint tile is gone;
   * _updateDesignGhost now draws the actual machine there, and a 0.35-opacity
   * green quad under it just turned the whole beamline into pea soup. Red
   * survives because it is load-bearing: it is the at-a-glance "this spot will
   * not take", and it has to read even where the ghost is thin.
   *
   * These are cheap floor quads and are rebuilt on every pointer move with the
   * rest of previewGroup. The materials are hoisted out of the loops (rather
   * than going through _previewTileHighlight, which mints two per tile) because
   * a long blueprint is 40+ tiles and this runs at pointer rate.
   */
  _renderDesignPlacerPreview(placer) {
    if (!placer || !placer.active) {
      this._clearDesignGhost();
      return;
    }

    if (placer.foundationTiles.length > 0) {
      const fillMat = this._previewMat(0x999999, 0.25);
      const edgeMat = this._previewEdgeMat(0x999999);
      for (const ft of placer.foundationTiles) {
        this._addPreviewMesh(new THREE.Mesh(this._terrainTileQuad(ft.col, ft.row, 0.02), fillMat));
        this._addPreviewMesh(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(this._terrainTileBorderPoints(ft.col, ft.row, 0.04)),
          edgeMat,
        ));
      }
    }

    if (!placer.valid && placer.previewTiles.length > 0) {
      const fillMat = this._previewMat(GHOST_TINT_BLOCKED, 0.28);
      const edgeMat = this._previewEdgeMat(GHOST_TINT_BLOCKED);
      for (const pt of placer.previewTiles) {
        this._addPreviewMesh(new THREE.Mesh(this._terrainTileQuad(pt.col, pt.row, 0.02), fillMat));
        this._addPreviewMesh(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(this._terrainTileBorderPoints(pt.col, pt.row, 0.04)),
          edgeMat,
        ));
      }
    }

    this._updateDesignGhost(placer);
  }

  /**
   * Translucent 3D copy of the whole design at the transform it will actually
   * be built at — junctions at their anchors and junction rotations, on-pipe
   * hardware at the fractional pipe coordinates placementPose resolves, and a
   * thin ghost pipe joining the module faces so the run reads as one machine
   * instead of a scatter of boxes.
   *
   * REBUILD KEY. This is the expensive half of the preview and the pointer
   * fires it dozens of times a second, so it is gated on a signature over
   * everything that can move a mesh: which design, where its head sits, which
   * way it runs, and whether it is legal (validity is in there because it
   * picks the tint, which is baked into the prototype materials). Cursor
   * motion inside one tile, camera pan, zoom and every unrelated
   * _renderCursors call therefore cost one string compare.
   *
   * @param {import('../ui/DesignPlacer.js').DesignPlacer} placer
   */
  _updateDesignGhost(placer) {
    const modules = placer.previewModules || [];
    if (modules.length === 0) {
      this._clearDesignGhost();
      return;
    }

    const design = placer.design;
    const sig = [
      design?.id || design?.name || '?',
      placer.startCol, placer.startRow, placer.direction,
      // Inert today (DesignPlacer.reflect is a documented no-op until mirrored
      // dipole components exist), but it is one of the placer's two transform
      // knobs — leaving it out is a stale ghost waiting to happen.
      placer.reflected ? 1 : 0,
      placer.valid ? 1 : 0,
    ].join('|');
    if (sig === this._designGhostSig) return;
    this._designGhostSig = sig;
    // Detach only — every child is a clone whose geometry and materials belong
    // to a prototype that is still alive in _designGhostProtos. Disposing here
    // would free buffers the next rebuild (and every other clone) still points
    // at, which is exactly the class of bug _clearPreviewMeshes documents.
    this.designGhostGroup.clear();

    // TINT, AND WHY A LEGAL PLACEMENT HAS NONE. The single-component ghost
    // washes everything green because at that size the shape carries no
    // information — you are placing "a quadrupole", and green/red is the whole
    // message. A blueprint is the opposite: the point of showing the machine
    // is that the player recognises the machine, and a whole beamline flooded
    // green over green grass reads as a smear (it was tried; it is). So a legal
    // placement keeps every component's real materials and only goes
    // translucent, and red is reserved for the one state that must interrupt.
    const tint = placer.valid ? null : GHOST_TINT_BLOCKED;

    for (const m of modules) {
      const proto = this._designGhostProto(m.type, tint);
      if (!proto) continue;
      const inst = proto.clone();
      const compDef = COMPONENTS[m.type] || {};
      // On-pipe hardware carries fractional pipe coordinates and no sub-tile
      // origin — the same shape world-snapshot hands ComponentBuilder for a
      // committed attachment, so componentPose centres it identically.
      const isOnPipe = m.kind === 'onPipe';
      const pose = componentPose(
        compDef,
        {
          col: m.col, row: m.row,
          subCol: isOnPipe ? null : 0,
          subRow: isOnPipe ? null : 0,
          direction: m.dir,
        },
        isDetailedComponent(m.type, compDef),
      );
      inst.position.set(pose.x, pose.y, pose.z);
      inst.rotation.y = pose.rotY;
      // Identity for anything inspecting the ghost — notably the browser spec,
      // which asserts these poses against the meshes the click actually
      // produces. Nothing in the render path reads them.
      inst.userData.ghostKind = m.kind;
      inst.userData.ghostType = m.type;
      this.designGhostGroup.add(inst);
    }

    for (const p of placer.previewPipes || []) {
      const mesh = this._designGhostPipe(p.from, p.to, tint);
      if (!mesh) continue;
      mesh.userData.ghostKind = 'pipe';
      this.designGhostGroup.add(mesh);
    }
  }

  /**
   * A ghostified, off-scene wrapper for one component type at one tint, built
   * once and cloned thereafter.
   *
   * Geometry comes from ComponentBuilder._createObject — the same factory the
   * committed scene uses — so the ghost is the real model, not an approximation
   * that can drift from it. The material work happens here, once per
   * (type, tint) pair: cloning per mesh per rebuild would mint ~50 materials
   * every time the cursor crossed a tile boundary.
   *
   * `tint` null keeps the component's own colours (see _updateDesignGhost).
   */
  _designGhostProto(compType, tint) {
    const key = compType + '|' + (tint === null ? 'ok' : tint);
    const cached = this._designGhostProtos.get(key);
    if (cached) return cached;

    const compDef = COMPONENTS[compType];
    if (!compDef) return null;
    const obj = this.componentBuilder._createObject(compDef);
    if (!obj) return null;

    // Same ghostify contract as renderAttachmentGhost: per-face material
    // ARRAYS come back from component-builder's fallback path and Array has no
    // .clone(); depthTest goes off (not just depthWrite) so the ghost is not
    // z-fought by the terrain and floors it straddles; renderOrder must land on
    // each mesh because three.js does not inherit it from the wrapper Group.
    const ghostifyMat = (mat) => {
      const c = mat.clone();
      c.transparent = true;
      c.opacity = 0.45;
      c.depthWrite = false;
      c.depthTest = false;
      if (tint !== null && c.color) c.color.setHex(tint);
      return c;
    };
    const doomed = [];
    obj.traverse(child => {
      if (!child.isMesh) return;
      const first = Array.isArray(child.material) ? child.material[0] : child.material;
      // The invisible raycast hitbox _createObject bolts on. designGhostGroup
      // is not a raycast target, so it would only cost a clone per instance.
      if (first && first.visible === false) { doomed.push(child); return; }
      child.material = Array.isArray(child.material)
        ? child.material.map(ghostifyMat)
        : ghostifyMat(child.material);
      child.castShadow = false;
      child.receiveShadow = false;
      child.renderOrder = 999;
    });
    for (const d of doomed) {
      d.parent.remove(d);
      d.geometry.dispose();
      d.material.dispose();
    }

    this._designGhostProtos.set(key, obj);
    return obj;
  }

  /**
   * Ghost beam pipe between two module faces. `from`/`to` are the fractional
   * grid coordinates DesignPlacer publishes, matching _buildPipePath.
   *
   * One unit-length cylinder geometry serves every run ever drawn (scaled on
   * its axis) and one material per tint, so a rebuild allocates a Mesh and
   * nothing else. Marked sharedGeometry for the same reason role meshes are:
   * any generic teardown that walks this must not free it.
   */
  _designGhostPipe(from, to, tint) {
    const x1 = from.col * 2 + 1, z1 = from.row * 2 + 1;
    const x2 = to.col * 2 + 1, z2 = to.row * 2 + 1;
    const dx = x2 - x1, dz = z2 - z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.01) return null;

    if (!this._designGhostPipeGeo) {
      // Unit length along +X, matching _renderBeamPipePreview's rotateZ trick,
      // so scale.x is the run length in world units.
      const geo = new THREE.CylinderGeometry(0.06, 0.06, 1, 8);
      geo.rotateZ(Math.PI / 2);
      this._designGhostPipeGeo = geo;
    }
    let mat = this._designGhostPipeMats.get(tint);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        // Stainless blue-grey when legal — the same colour the committed pipe
        // and _renderBeamPipePreview use, so the ghost run reads as pipe.
        color: tint === null ? 0x99aabb : tint,
        transparent: true, opacity: 0.35,
        depthWrite: false, depthTest: false,
      });
      this._designGhostPipeMats.set(tint, mat);
    }

    const mesh = new THREE.Mesh(this._designGhostPipeGeo, mat);
    mesh.userData.sharedGeometry = true;
    // Beam axis height — the constant every component builder bakes in.
    mesh.position.set((x1 + x2) / 2, 1.0, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.scale.x = length;
    mesh.renderOrder = 999;
    return mesh;
  }

  /**
   * Drop the ghost and forget the signature so the next activation rebuilds.
   * Clones are detached, never disposed (see _updateDesignGhost); the shared
   * prototypes go too, because holding a full component model per type for a
   * placement the player has finished is a leak by any other name — and the
   * next placement rebuilds them in one frame.
   */
  _clearDesignGhost() {
    if (this._designGhostSig === null && !this.designGhostGroup?.children.length) return;
    this._designGhostSig = null;
    if (this.designGhostGroup) this.designGhostGroup.clear();
    this._disposeDesignGhostProtos();
  }

  _disposeDesignGhostProtos() {
    for (const proto of this._designGhostProtos.values()) {
      // Role-tagged meshes share merged template geometry with every committed
      // instance of the type — same rule as ComponentBuilder._disposeWrapper.
      // The ghost materials are ours (cloned in _designGhostProto), so those
      // always go.
      proto.traverse(child => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) if (m && typeof m.dispose === 'function') m.dispose();
        if (child.userData.role || child.userData.sharedGeometry) return;
        if (child.geometry) child.geometry.dispose();
      });
    }
    this._designGhostProtos.clear();
    for (const mat of this._designGhostPipeMats.values()) mat.dispose();
    this._designGhostPipeMats.clear();
    if (this._designGhostPipeGeo) {
      this._designGhostPipeGeo.dispose();
      this._designGhostPipeGeo = null;
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
  _renderProbeFlags() { /* future */ }

  // --- Preview / highlight methods ---

  /** Clear all preview geometry from the scene. */
  _clearPreview() {
    this._clearGridOverlay();
    this._clearPreviewMeshes();
  }

  /** Clear only the ghost/preview meshes; leaves the blue grid overlay intact. */
  _clearPreviewMeshes() {
    if (!this.previewGroup) return;
    // The beam-pipe preview and pipe hover marker live in previewGroup too but
    // track their meshes in side arrays. Drop those references here or
    // _clearBeamPipePreview / _clearPipeHoverMarker walk the entries we just
    // disposed and dispose them a second time.
    this._beamPipePreviewMeshes = null;
    this._pipeHoverMeshes = null;
    this._beamPipeSig = null;
    while (this.previewGroup.children.length > 0) {
      const child = this.previewGroup.children[0];
      this.previewGroup.remove(child);
      child.traverse(c => {
        // Ghosts come out of the same factories as committed objects, so
        // parts of them are module-level caches the real scene still points
        // at: ComponentBuilder's role-template geometry, the cached cost-label
        // material, and THREE.Sprite's library-wide geometry. Disposing those
        // here frees GPU buffers every placed instance is still using — and
        // this runs on every mousemove while a placement tool is armed.
        // (Ghost materials are per-ghost clones, so they stay disposable.)
        const shared = c.userData || {};
        if (shared.sharedLabelMaterial) return;
        if (c.geometry && !shared.sharedGeometry && !c.isSprite) c.geometry.dispose();
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
  _outlineObject(sourceObj, color = 0xff4444, targetGroup = this.previewGroup, linewidth = 1) {
    if (!sourceObj) return;
    // Depth-tested outline so back edges of the box are hidden behind the
    // front faces. Without this, every edge renders through the mesh and
    // the back-top edges look like a phantom duplicate floating above.
    const lineMat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.95, linewidth,
    });
    const wrapper = new THREE.Group();

    sourceObj.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      // Skip invisible hitbox meshes (used for raycasting only — see
      // ComponentBuilder._createObject which adds a larger Box hitbox).
      if (child.visible === false) return;
      const mat = Array.isArray(child.material) ? child.material[0] : child.material;
      if (mat && mat.visible === false) return;
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

    targetGroup.add(wrapper);
  }

  /** Keep a clicked object's white outline independent of transient hovers. */
  setSelectionOutline(sourceObj) {
    this.clearSelectionOutline();
    if (sourceObj) this._outlineObject(sourceObj, 0xffffff, this.selectionGroup, 3);
  }

  clearSelectionOutline() {
    while (this.selectionGroup?.children?.length) {
      const child = this.selectionGroup.children[0];
      this.selectionGroup.remove(child);
      child.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      });
    }
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
    const QUAD_OFFSET = 0.02;
    const EDGE_OFFSET = 0.04;
    const state = this._liveState();
    // Per-tile deformed quad so the fill drapes the slope instead of hovering
    // on a flat y=0.1 plane (matches renderDemolishPreview).
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        this._addPreviewMesh(new THREE.Mesh(this._terrainTileQuad(c, r, QUAD_OFFSET), mat));
      }
    }
    // Border around the full rectangle — sample every perimeter vertex so it
    // follows terrain across the multi-tile span.
    const edgeMat = this._previewEdgeMat(color);
    const surfY = (x, z) => sampleSurfaceYAt(state, x, z) + EDGE_OFFSET;
    const pts = [];
    const zN = minR * 2;
    for (let c = minC; c <= maxC + 1; c++) {
      const x = c * 2;
      pts.push(new THREE.Vector3(x, surfY(x, zN), zN));
    }
    const xE = (maxC + 1) * 2;
    for (let r = minR + 1; r <= maxR + 1; r++) {
      const z = r * 2;
      pts.push(new THREE.Vector3(xE, surfY(xE, z), z));
    }
    const zS = (maxR + 1) * 2;
    for (let c = maxC; c >= minC; c--) {
      const x = c * 2;
      pts.push(new THREE.Vector3(x, surfY(x, zS), zS));
    }
    const xW = minC * 2;
    for (let r = maxR; r >= minR; r--) {
      const z = r * 2;
      pts.push(new THREE.Vector3(xW, surfY(xW, z), z));
    }
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
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
    for (const tile of path) {
      this._addPreviewMesh(new THREE.Mesh(this._terrainTileQuad(tile.col, tile.row, 0.02), mat));
    }
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
    this.previewGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this._terrainTileBorderPoints(col, row, 0.04)),
      edgeMat
    ));
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
    const Y_OFFSET = 0.04;
    const ends = this._edgeEndpoints(col, row, edge, Y_OFFSET);
    this.previewGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([ends.p0, ends.p1]), edgeMat
    ));
  }

  /**
   * BufferGeometry for a tile-sized quad whose 4 corners track the tile's
   * terrain heights (so the quad drapes the slope).
   */
  _terrainTileQuad(col, row, yOffset = 0) {
    const c = getTileCornersY(this._liveState(), col, row);
    const x0 = col * 2, x1 = col * 2 + 2;
    const z0 = row * 2, z1 = row * 2 + 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, c.nw + yOffset, z0,
      x1, c.ne + yOffset, z0,
      x1, c.se + yOffset, z1,
      x0, c.sw + yOffset, z1,
    ], 3));
    geo.setIndex([0, 3, 1, 1, 3, 2]);
    geo.computeVertexNormals();
    return geo;
  }

  /** Closed-loop border points for a tile, sampled at corner heights. */
  _terrainTileBorderPoints(col, row, yOffset = 0) {
    const c = getTileCornersY(this._liveState(), col, row);
    const x0 = col * 2, x1 = col * 2 + 2;
    const z0 = row * 2, z1 = row * 2 + 2;
    return [
      new THREE.Vector3(x0, c.nw + yOffset, z0),
      new THREE.Vector3(x1, c.ne + yOffset, z0),
      new THREE.Vector3(x1, c.se + yOffset, z1),
      new THREE.Vector3(x0, c.sw + yOffset, z1),
      new THREE.Vector3(x0, c.nw + yOffset, z0),
    ];
  }

  /**
   * World-space endpoints (with terrain Y) for one wall edge of a tile.
   * Each edge runs between two adjacent tile corners.
   */
  _edgeEndpoints(col, row, edge, yOffset = 0) {
    const c = getTileCornersY(this._liveState(), col, row);
    const x0 = col * 2, x1 = col * 2 + 2;
    const z0 = row * 2, z1 = row * 2 + 2;
    let ax, ay, az, bx, by, bz;
    switch (edge) {
      case 'n': ax=x0; ay=c.nw; az=z0; bx=x1; by=c.ne; bz=z0; break;
      case 's': ax=x0; ay=c.sw; az=z1; bx=x1; by=c.se; bz=z1; break;
      case 'e': ax=x1; ay=c.ne; az=z0; bx=x1; by=c.se; bz=z1; break;
      case 'w': ax=x0; ay=c.nw; az=z0; bx=x0; by=c.sw; bz=z1; break;
      default:  ax=bx=col*2+1; ay=by=0; az=bz=row*2+1;
    }
    return {
      p0: new THREE.Vector3(ax, ay + yOffset, az),
      p1: new THREE.Vector3(bx, by + yOffset, bz),
    };
  }

  /**
   * Red-highlight every edge in a wall/door path. Used for shift-hover in
   * demolish mode to preview a whole connected segment before click.
   */
  renderDemolishPathPreview(path) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.95,
    });
    const quadMat = this._previewMat(0xff4444, 0.3);
    const LINE_OFFSET = 0.05;
    const QUAD_OFFSET = 0.03;
    const QUAD_HALF = 0.125; // 0.25 wide slab, half each side of the edge
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      const ends = this._edgeEndpoints(seg.col, seg.row, seg.edge, LINE_OFFSET);
      this.previewGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([ends.p0, ends.p1]), edgeMat
      ));
      // Sloped quad slab tracking the edge: 4 verts offset perpendicular
      // to the edge, all sampling the edge endpoint Y.
      const ax = ends.p0.x, ay = ends.p0.y - (LINE_OFFSET - QUAD_OFFSET), az = ends.p0.z;
      const bx = ends.p1.x, by = ends.p1.y - (LINE_OFFSET - QUAD_OFFSET), bz = ends.p1.z;
      const px = isNS ? 0 : QUAD_HALF;   // perpendicular offset (X for E/W edges)
      const pz = isNS ? QUAD_HALF : 0;   // perpendicular offset (Z for N/S edges)
      const qGeo = new THREE.BufferGeometry();
      qGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        ax - px, ay, az - pz,
        bx - px, by, bz - pz,
        bx + px, by, bz + pz,
        ax + px, ay, az + pz,
      ], 3));
      qGeo.setIndex([0, 1, 2, 0, 2, 3]);
      qGeo.computeVertexNormals();
      this._addPreviewMesh(new THREE.Mesh(qGeo, quadMat));
    }
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
    const QUAD_OFFSET = 0.02;
    const EDGE_OFFSET = 0.04;
    const state = this._liveState();
    // Per-tile deformed quad so the fill drapes the slope.
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        this.previewGroup.add(new THREE.Mesh(this._terrainTileQuad(c, r, QUAD_OFFSET), mat));
      }
    }
    // Red border around the drag rect — sample every vertex along the perimeter
    // so it follows terrain across the multi-tile span.
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.9,
    });
    const surfY = (x, z) => sampleSurfaceYAt(state, x, z) + EDGE_OFFSET;
    const pts = [];
    // North edge: walk west→east along z = minR*2.
    const zN = minR * 2;
    for (let c = minC; c <= maxC + 1; c++) {
      const x = c * 2;
      pts.push(new THREE.Vector3(x, surfY(x, zN), zN));
    }
    // East edge: walk north→south along x = (maxC+1)*2.
    const xE = (maxC + 1) * 2;
    for (let r = minR + 1; r <= maxR + 1; r++) {
      const z = r * 2;
      pts.push(new THREE.Vector3(xE, surfY(xE, z), z));
    }
    // South edge: walk east→west.
    const zS = (maxR + 1) * 2;
    for (let c = maxC; c >= minC; c--) {
      const x = c * 2;
      pts.push(new THREE.Vector3(x, surfY(x, zS), zS));
    }
    // West edge: walk south→north back to start.
    const xW = minC * 2;
    for (let r = maxR; r >= minR; r--) {
      const z = r * 2;
      pts.push(new THREE.Vector3(xW, surfY(xW, z), z));
    }
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
    const T = 0.08;          // wall thickness
    const HT = T / 2;
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      const ends = this._edgeEndpoints(seg.col, seg.row, seg.edge, 0);
      const ax = ends.p0.x, ay = ends.p0.y, az = ends.p0.z;
      const bx = ends.p1.x, by = ends.p1.y, bz = ends.p1.z;
      // Two thickness offsets perpendicular to the edge axis.
      const px = isNS ? 0 : HT;
      const pz = isNS ? HT : 0;
      // 8 vertices: 4 bottom (terrain-tracking parallelogram), 4 top (lifted by wallH).
      const verts = [
        ax - px, ay,         az - pz,    // 0 bot near-a
        bx - px, by,         bz - pz,    // 1 bot near-b
        bx + px, by,         bz + pz,    // 2 bot far-b
        ax + px, ay,         az + pz,    // 3 bot far-a
        ax - px, ay + wallH, az - pz,    // 4 top near-a
        bx - px, by + wallH, bz - pz,    // 5 top near-b
        bx + px, by + wallH, bz + pz,    // 6 top far-b
        ax + px, ay + wallH, az + pz,    // 7 top far-a
      ];
      const idx = [
        // bottom
        0, 1, 2,  0, 2, 3,
        // top
        4, 6, 5,  4, 7, 6,
        // sides
        0, 4, 5,  0, 5, 1,
        1, 5, 6,  1, 6, 2,
        2, 6, 7,  2, 7, 3,
        3, 7, 4,  3, 4, 0,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      this._addPreviewMesh(new THREE.Mesh(geo, mat));
    }
  }

  /**
   * Render door placement preview — semi-transparent door frames along the path.
   */
  renderDoorPreview(path, doorType) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const mat = this._previewMat(0x88ff88, 0.4);
    const doorDef = doorType ? DOOR_TYPES[doorType] : null;
    const isDouble = doorDef ? doorDef.doorWidth === 'double' : false;
    const nominalH = doorDef?.doorHeight
      ? doorDef.doorHeight * HEIGHT_SCALE
      : 0.6;
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      // Same opening the wall builder will cut: real height, real width,
      // real subtile offset — and the same clamp against the host wall so a
      // tall door previewed on a short wall doesn't promise a taller opening.
      const layout = doorOpeningLayout(seg.edge, seg.off, isDouble);
      const wallH = this._previewWallHeight(seg.col, seg.row, seg.edge, doorDef);
      const doorH = Math.max(0.1, Math.min(nominalH, wallH - LINTEL_HEIGHT));
      const geo = isNS
        ? new THREE.BoxGeometry(layout.openingWidth, doorH, 0.06)
        : new THREE.BoxGeometry(0.06, doorH, layout.openingWidth);
      const mesh = new THREE.Mesh(geo, mat);
      const pos = this._wallEdgePosition(seg.col, seg.row, seg.edge);
      const x = pos.x + (isNS ? layout.center : 0);
      const z = pos.z + (isNS ? 0 : layout.center);
      const ends = this._edgeEndpoints(seg.col, seg.row, seg.edge, 0);
      // Terrain Y under the opening centre (not the edge midpoint).
      const a = isNS ? ends.p0.x : ends.p0.z;
      const b = isNS ? ends.p1.x : ends.p1.z;
      const cur = isNS ? x : z;
      const t = Math.abs(b - a) > 1e-6 ? (cur - a) / (b - a) : 0.5;
      const baseY = ends.p0.y + (ends.p1.y - ends.p0.y) * t;
      mesh.position.set(x, baseY + doorH / 2, z);
      this._addPreviewMesh(mesh);
    }
  }

  /**
   * Height (world units) of the wall a previewed door would hang on. Falls
   * back to the door type's own declared wallHeight when no wall is there
   * yet — matching wall-builder's fallback.
   */
  _previewWallHeight(col, row, edge, doorDef) {
    const occupied = this._liveState()?.wallOccupied || {};
    const opposite = { n: 's', e: 'w', s: 'n', w: 'e' }[edge];
    const delta = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[edge];
    let wallType = occupied[`${col},${row},${edge}`];
    if (!wallType && delta) {
      wallType = occupied[`${col + delta[0]},${row + delta[1]},${opposite}`];
    }
    const def = wallType ? WALL_TYPES[wallType] : null;
    const data = def?.wallHeight ?? doorDef?.wallHeight ?? 14;
    return data * HEIGHT_SCALE;
  }

  /**
   * Render window placement preview — semi-transparent panes along the path,
   * lifted to the type's sill height so the ghost reads as a window and not
   * as a door. Mirrors renderDoorPreview; called by the WindowTool drag.
   *
   * Like the door tool, the ghost does NOT distinguish placeable edges from
   * unplaceable ones (design doc, "Fit rule") — it shows the run, and the
   * tool places what it can.
   *
   * @param {Array<{col:number,row:number,edge:string}>} path
   * @param {string} windowType  a WINDOW_TYPES key
   */
  renderWindowPreview(path, windowType) {
    this._clearPreview();
    if (!path || path.length === 0) return;
    const def = windowType ? WINDOW_TYPES[windowType] : null;
    const mat = this._previewMat(0x88ccff, 0.4);
    // Sizing constants come from wall-builder.js itself, so a retune there
    // moves the ghost with the geometry it is previewing.
    const sill = (def?.sillHeight ?? 5) * HEIGHT_SCALE;
    const openH = (def?.openingHeight ?? 6) * HEIGHT_SCALE;
    const width = WALL_TILE_SIZE * (WINDOW_WIDTH_FRAC[def?.windowWidth] ?? 0.5);
    for (const seg of path) {
      const isNS = seg.edge === 'n' || seg.edge === 's';
      const geo = isNS
        ? new THREE.BoxGeometry(width, openH, 0.06)
        : new THREE.BoxGeometry(0.06, openH, width);
      const mesh = new THREE.Mesh(geo, mat);
      const pos = this._wallEdgePosition(seg.col, seg.row, seg.edge);
      const ends = this._edgeEndpoints(seg.col, seg.row, seg.edge, 0);
      const midY = (ends.p0.y + ends.p1.y) / 2;
      mesh.position.set(pos.x, midY + sill + openH / 2, pos.z);
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
    const ends = this._edgeEndpoints(col, row, edge, 0);
    const midY = (ends.p0.y + ends.p1.y) / 2;
    // Cross marker at the edge midpoint, lifted above the surface.
    const size = 0.3;
    const y = midY + 0.10;
    const crossMat = this._previewEdgeMat(color);
    const h1 = [new THREE.Vector3(pos.x - size, y, pos.z), new THREE.Vector3(pos.x + size, y, pos.z)];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h1), crossMat));
    const h2 = [new THREE.Vector3(pos.x, y, pos.z - size), new THREE.Vector3(pos.x, y, pos.z + size)];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h2), crossMat));
    // Quad slab tracking the sloped edge.
    const isNS = edge === 'n' || edge === 's';
    const QUAD_OFFSET = 0.05;
    const QUAD_HALF = 0.15;
    const ax = ends.p0.x, ay = ends.p0.y + QUAD_OFFSET, az = ends.p0.z;
    const bx = ends.p1.x, by = ends.p1.y + QUAD_OFFSET, bz = ends.p1.z;
    const px = isNS ? 0 : QUAD_HALF;
    const pz = isNS ? QUAD_HALF : 0;
    const qGeo = new THREE.BufferGeometry();
    qGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      ax - px, ay, az - pz,
      bx - px, by, bz - pz,
      bx + px, by, bz + pz,
      ax + px, ay, az + pz,
    ], 3));
    qGeo.setIndex([0, 1, 2, 0, 2, 3]);
    qGeo.computeVertexNormals();
    this._addPreviewMesh(new THREE.Mesh(qGeo, this._previewMat(color, 0.25)));
  }

  /** Hover cursor for infrastructure placement — single tile highlight. */
  renderInfraHoverCursor(col, row, color) {
    this._clearPreview();
    this._renderGridAroundCursor(col, row);
    const tileColor = (typeof color === 'number') ? color : 0x44aaff;
    this._addPreviewMesh(new THREE.Mesh(
      this._terrainTileQuad(col, row, 0.02),
      this._previewMat(tileColor, 0.25)
    ));
    this._addPreviewMesh(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this._terrainTileBorderPoints(col, row, 0.04)),
      this._previewEdgeMat(tileColor)
    ));
  }

  /**
   * Unified ghost renderer for any placeable. Looks up the entry in
   * PLACEABLES, builds the same 3D mesh that the committed instance will
   * use via componentBuilder._createObject, tints it by validity, and
   * positions it on the subtile grid with 4-way rotation.
   *
   * Positioning math mirrors ComponentBuilder.build exactly so the ghost
   * and the committed mesh land in identical world positions.
   *
   * @param {{id:string,col:number,row:number,subCol:number,subRow:number,dir:number}} hover
   * @param {boolean} valid
   * @param {?string} reason  refusal reason from src/game/placement.js; only
   *   'unaffordable' changes the tint, everything else reads as blocked.
   */
  renderPlaceableGhost(hover, valid, reason = null) {
    try { return this._renderPlaceableGhostInner(hover, valid, reason); } catch(e) { console.error('[renderPlaceableGhost] CRASH:', e); }
  }
  /**
   * Render multiple placeable ghosts at once (used for shift+drag line
   * placement of decorations). Clears preview once, draws grid around the
   * last hover, then adds each ghost additively.
   * @param {Array<{hover:object, valid:boolean, reason?:string}>} list
   */
  renderPlaceableGhosts(list) {
    try {
      this._clearPreview();
      if (!list || list.length === 0) return;
      const last = list[list.length - 1].hover;
      this._renderGridAroundCursor(last.col, last.row);
      for (const item of list) {
        this._addPlaceableGhostMeshes(item.hover, item.valid, item.reason ?? null);
      }
    } catch (e) { console.error('[renderPlaceableGhosts] CRASH:', e); }
  }
  _renderPlaceableGhostInner(hover, valid, reason = null) {
    this._clearPreview();
    this._renderGridAroundCursor(hover.col, hover.row);
    this._addPlaceableGhostMeshes(hover, valid, reason);
  }
  _addPlaceableGhostMeshes(hover, valid, reason = null) {
    const placeable = PLACEABLES[hover.id];
    if (!placeable) return;

    // Decorations use their own builder (tree/shrub geometry) instead of
    // the component builder's generic fallback box.
    let obj;
    if (placeable.kind === 'decoration') {
      // Pass the hover cell so the ghost is seeded exactly like the placed
      // instance — without it the preview shows the seed-0 nominal form and
      // a different tree pops in on click.
      obj = this.decorationBuilder._createGhost(hover.id, placeable, hover.variant ?? 0, hover);
    }
    if (!obj) {
      obj = this.componentBuilder._createObject(placeable);
    }
    if (!obj) return;

    // Ghostify each mesh. Equipment boxes with per-face decals come back
    // with an ARRAY of 6 face materials (from component-builder's fallback
    // path), so we have to clone every entry — calling .clone() directly
    // on an Array throws and kills the preview entirely.
    const tintHex = ghostTint(valid, reason);
    const ghostifyMat = (mat) => {
      const c = mat.clone();
      c.transparent = true;
      c.opacity = 0.4;
      c.depthWrite = false;
      c.depthTest = false;
      if (c.color) c.color.setHex(tintHex);
      return c;
    };
    obj.traverse(child => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map(ghostifyMat);
        } else {
          child.material = ghostifyMat(child.material);
        }
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = 999;
      }
    });

    // obj.children.length is always > 0 because _createObject wraps every
    // visual in a Group with an invisible hitbox — so children-count cannot
    // be used to detect detailed geometry. Use the authoritative builder
    // registry check instead (same source of truth as ComponentBuilder.build
    // uses when positioning committed meshes).
    // Decoration geometry (trees, shrubs) already has its origin at the floor,
    // just like detailed beamline components — skip the h/2 vertical offset.
    const isDetailed = isDetailedComponent(hover.id, placeable)
      || placeable.kind === 'decoration';
    const SUB_UNIT = 0.5;
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
    const placeYOffset = (hover.placeY || 0) * SUB_UNIT;
    const vSubH = placeable.visualSubH ?? placeable.subH ?? 2;
    // Game._placePlaceableInner auto-flattens every footprint tile to zero
    // before committing, so the ghost previews the POST-flatten surface, not
    // the slope currently under the cursor. Draping the live terrain instead
    // made the ghost drop on click; showing the result is the WYSIWYG choice.
    // Stacked items ride placeY above that same zero.
    const surfaceY = 0;
    let y = (isDetailed ? placeYOffset : placeYOffset + (vSubH * SUB_UNIT) / 2) + surfaceY;
    if (placeable.light) y = fixtureMountY(placeable, placeYOffset + surfaceY);
    obj.position.set(px, y, pz);
    obj.rotation.y = -(hover.dir || 0) * (Math.PI / 2);
    obj.renderOrder = 999;
    this.previewGroup.add(obj);

    // Floor outline + fill on the post-flatten surface, so the footprint
    // marker and the ghost mesh sit on the same plane.
    const tileColor = ghostTint(valid, reason);
    const edgeMat = this._previewEdgeMat(tileColor);
    const fillMat = this._previewMat(tileColor, 0.15);
    const x0 = col * 2 + sc * SUB_UNIT;
    const x1 = x0 + footW;
    const z0 = row * 2 + sr * SUB_UNIT;
    const z1 = z0 + footH;
    const FILL_OFFSET = 0.10;
    const EDGE_OFFSET = 0.12;
    const footY = surfaceY + placeYOffset;
    const pts = [
      new THREE.Vector3(x0, footY + EDGE_OFFSET, z0),
      new THREE.Vector3(x1, footY + EDGE_OFFSET, z0),
      new THREE.Vector3(x1, footY + EDGE_OFFSET, z1),
      new THREE.Vector3(x0, footY + EDGE_OFFSET, z1),
      new THREE.Vector3(x0, footY + EDGE_OFFSET, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, footY + FILL_OFFSET, z0,
      x1, footY + FILL_OFFSET, z0,
      x1, footY + FILL_OFFSET, z1,
      x0, footY + FILL_OFFSET, z1,
    ], 3));
    fillGeo.setIndex([0, 3, 1, 1, 3, 2]);
    fillGeo.computeVertexNormals();
    this._addPreviewMesh(new THREE.Mesh(fillGeo, fillMat));

    // Direction arrow for source/endpoint modules — shows which way the
    // module connects to pipe (exit direction for sources, entry direction
    // for endpoints). Derive the vector from the port's rotated compass side
    // rather than DIR_DELTA; DIR_DELTA encodes the NE=0 isometric convention,
    // which is 180° off from a source's front-facing exit port.
    const compDef = COMPONENTS[hover.id];
    if (compDef && (compDef.isSource || compDef.isEndpoint)) {
      const dir = hover.dir || 0;
      const portName = compDef.isSource ? 'exit' : 'entry';
      const side = portSide({ type: hover.id, dir }, portName);
      const SIDE_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
      const [dx, dz] = SIDE_VEC[side] || [0, -1];
      // Perpendicular (rotated 90° CCW) for the chevron wings.
      const perpX = dz, perpZ = -dx;
      const arrowY = surfaceY + placeYOffset + EDGE_OFFSET + 0.03;
      const arrowMat = this._previewEdgeMat(0x88bbff);
      const arrowStart = new THREE.Vector3(px - dx * 0.4, arrowY, pz - dz * 0.4);
      const arrowEnd = new THREE.Vector3(px + dx * 0.6, arrowY, pz + dz * 0.6);
      this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowStart, arrowEnd]), arrowMat));
      const tipX = px + dx * 0.6, tipZ = pz + dz * 0.6;
      const chevLen = 0.3;
      const chevPts = [
        new THREE.Vector3(tipX - dx * chevLen + perpX * chevLen, arrowY, tipZ - dz * chevLen + perpZ * chevLen),
        new THREE.Vector3(tipX, arrowY, tipZ),
        new THREE.Vector3(tipX - dx * chevLen - perpX * chevLen, arrowY, tipZ - dz * chevLen - perpZ * chevLen),
      ];
      this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(chevPts), arrowMat));
    }
  }

  /**
   * Draw only the placement-grid overlay around the cursor tile — no ghost
   * mesh. Used when no pipe is under the cursor but a placement tool is
   * still active, so the user sees the same blue grid as for normal placeables.
   *
   * `hint === 'needs-pipe'` additionally paints the cursor tile red: without
   * it the grid alone reads as "this is a legal spot" and the pipe-only rule
   * only surfaced in the log after a wasted click.
   */
  renderPlacementGridOnly(col, row, hint = null) {
    this._clearPreviewMeshes();
    this._renderGridAroundCursor(col, row);
    if (hint !== 'needs-pipe') return;
    const state = this._liveState();
    const x0 = col * 2, x1 = x0 + 2;
    const z0 = row * 2, z1 = z0 + 2;
    const FILL_OFFSET = 0.10;
    const EDGE_OFFSET = 0.12;
    const yAt = (x, z) => sampleSurfaceYAt(state, x, z);
    const yNW = yAt(x0, z0), yNE = yAt(x1, z0), ySE = yAt(x1, z1), ySW = yAt(x0, z1);
    const edgeMat = this._previewEdgeMat(GHOST_TINT_BLOCKED);
    const fillMat = this._previewMat(GHOST_TINT_BLOCKED, 0.12);
    const pts = [
      new THREE.Vector3(x0, yNW + EDGE_OFFSET, z0),
      new THREE.Vector3(x1, yNE + EDGE_OFFSET, z0),
      new THREE.Vector3(x1, ySE + EDGE_OFFSET, z1),
      new THREE.Vector3(x0, ySW + EDGE_OFFSET, z1),
      new THREE.Vector3(x0, yNW + EDGE_OFFSET, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, yNW + FILL_OFFSET, z0,
      x1, yNE + FILL_OFFSET, z0,
      x1, ySE + FILL_OFFSET, z1,
      x0, ySW + FILL_OFFSET, z1,
    ], 3));
    fillGeo.setIndex([0, 3, 1, 1, 3, 2]);
    fillGeo.computeVertexNormals();
    this._addPreviewMesh(new THREE.Mesh(fillGeo, fillMat));
  }

  /**
   * Render a transparent ghost of an attachment component at a fractional
   * position along a beam pipe. `col`/`row` are world-centered fractional
   * coordinates (matching the world-snapshot convention for placed
   * attachments), not tile top-left + sub-tile offset.
   *
   * `reason` follows renderPlaceableGhost: 'unaffordable' tints amber.
   */
  renderAttachmentGhost(col, row, compType, direction, valid, reason = null) {
    this._clearPreviewMeshes();
    this._renderGridAroundCursor(Math.floor(col), Math.floor(row));
    const compDef = COMPONENTS[compType];
    if (!compDef) return;
    const obj = this.componentBuilder._createObject(compDef);
    if (!obj) return;
    // Same ghostify contract as _addPlaceableGhostMeshes: per-face material
    // ARRAYS come back from component-builder's fallback path, and Array has
    // no .clone(); depthTest goes off (not just depthWrite) or the ghost
    // z-fights the pipe it straddles; renderOrder must land on each mesh
    // because three.js does not inherit it from the wrapper Group.
    const tintHex = ghostTint(valid, reason);
    const ghostifyMat = (mat) => {
      const c = mat.clone();
      c.transparent = true;
      c.opacity = 0.4;
      c.depthWrite = false;
      c.depthTest = false;
      if (c.color) c.color.setHex(tintHex);
      return c;
    };
    obj.traverse(child => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map(ghostifyMat);
        } else {
          child.material = ghostifyMat(child.material);
        }
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = 999;
      }
    });
    // _createObject always wraps the visual in a Group with an invisible
    // hitbox, so a children-count test is always true. Use the same
    // authoritative check ComponentBuilder.build uses to position committed
    // attachment meshes, or the ghost sits a metre below the pipe.
    const isDetailed = isDetailedComponent(compType, compDef);
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
    const tileColor = ghostTint(valid, reason);
    const edgeMat = this._previewEdgeMat(tileColor);
    const fillMat = this._previewMat(tileColor, 0.15);
    const x0 = px - footW / 2;
    const x1 = px + footW / 2;
    const z0 = pz - footH / 2;
    const z1 = pz + footH / 2;
    // Drape the footprint marker on the terrain, like every other preview —
    // a fixed y=0.12 buries it under any raised ground beneath the pipe.
    const state = this._liveState();
    const FILL_OFFSET = 0.10;
    const EDGE_OFFSET = 0.12;
    const yAt = (x, z) => sampleSurfaceYAt(state, x, z);
    const yNW = yAt(x0, z0), yNE = yAt(x1, z0), ySE = yAt(x1, z1), ySW = yAt(x0, z1);
    const pts = [
      new THREE.Vector3(x0, yNW + EDGE_OFFSET, z0),
      new THREE.Vector3(x1, yNE + EDGE_OFFSET, z0),
      new THREE.Vector3(x1, ySE + EDGE_OFFSET, z1),
      new THREE.Vector3(x0, ySW + EDGE_OFFSET, z1),
      new THREE.Vector3(x0, yNW + EDGE_OFFSET, z0),
    ];
    this._addPreviewMesh(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, yNW + FILL_OFFSET, z0,
      x1, yNE + FILL_OFFSET, z0,
      x1, ySE + FILL_OFFSET, z1,
      x0, ySW + FILL_OFFSET, z1,
    ], 3));
    fillGeo.setIndex([0, 3, 1, 1, 3, 2]);
    fillGeo.computeVertexNormals();
    this._addPreviewMesh(new THREE.Mesh(fillGeo, fillMat));
  }

  /**
   * Detach the grid overlay. The built LineSegments are NOT disposed — they
   * stay in `_gridOverlayLines` so a re-render at the same cursor tile can
   * re-attach them (a single mousemove asks for the overlay twice: once from
   * updateHover, once from the ghost renderer). `_invalidateGridOverlay`
   * owns the actual teardown.
   */
  _clearGridOverlay() {
    if (!this.gridOverlayGroup) return;
    while (this.gridOverlayGroup.children.length > 0) {
      this.gridOverlayGroup.remove(this.gridOverlayGroup.children[0]);
    }
  }

  /** Dispose the cached overlay lines so the next render rebuilds them. */
  _invalidateGridOverlay() {
    for (const line of this._gridOverlayLines) {
      if (line.parent) line.parent.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    }
    this._gridOverlayLines = [];
    this._gridOverlaySig = null;
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

    // Geometry depends only on the cursor tile and the heightmap; terrain
    // rebuilds call _invalidateGridOverlay, so the tile key is enough.
    const sig = col + ',' + row;
    if (sig === this._gridOverlaySig && this._gridOverlayLines.length > 0) {
      for (const line of this._gridOverlayLines) this.gridOverlayGroup.add(line);
      return;
    }
    this._invalidateGridOverlay();
    this._gridOverlaySig = sig;

    const majorRadius = 3;   // tiles around cursor for major grid
    const subRadius = 1;     // tiles around cursor for sub-grid
    const Y_OFFSET = 0.04;

    const state = this._liveState();

    // Each tile is drawn as its own self-contained square (border + sub-grid),
    // so cliffs and mismatched corners between tiles don't produce ugly
    // chord lines spanning across the cliff.

    // --- Per-tile borders (bold) ---
    const majorVerts = [];
    for (let dr = -majorRadius; dr <= majorRadius; dr++) {
      for (let dc = -majorRadius; dc <= majorRadius; dc++) {
        const c = getTileCornersY(state, col + dc, row + dr);
        const x0 = (col + dc) * 2, x1 = x0 + 2;
        const z0 = (row + dr) * 2, z1 = z0 + 2;
        const yNW = c.nw + Y_OFFSET;
        const yNE = c.ne + Y_OFFSET;
        const ySE = c.se + Y_OFFSET;
        const ySW = c.sw + Y_OFFSET;
        // 4 closed-loop segments per tile (NW→NE→SE→SW→NW).
        majorVerts.push(x0, yNW, z0,  x1, yNE, z0);
        majorVerts.push(x1, yNE, z0,  x1, ySE, z1);
        majorVerts.push(x1, ySE, z1,  x0, ySW, z1);
        majorVerts.push(x0, ySW, z1,  x0, yNW, z0);
      }
    }
    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3));
    const majorMat = new THREE.LineBasicMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.45,
      depthTest: false, depthWrite: false,
    });
    const majorLines = new THREE.LineSegments(majorGeo, majorMat);
    majorLines.renderOrder = 997;
    this.gridOverlayGroup.add(majorLines);

    // --- Per-tile sub-grid interior (faint). Sample heights directly from
    // THIS tile's corners — never stepping into a neighbor — so cliffs
    // between tiles don't pull the sub-line endpoint to the wrong tile's
    // edge. Each sub-line is split at the SW→NE diagonal crossing so it
    // lies exactly on the triangulated mesh fold inside this tile.
    const subVerts = [];
    for (let dr = -subRadius; dr <= subRadius; dr++) {
      for (let dc = -subRadius; dc <= subRadius; dc++) {
        const c = col + dc, r = row + dr;
        const corners = getTileCornersY(state, c, r);
        const nw = corners.nw + Y_OFFSET;
        const ne = corners.ne + Y_OFFSET;
        const se = corners.se + Y_OFFSET;
        const sw = corners.sw + Y_OFFSET;
        const xa = c * 2, xb = c * 2 + 2;
        const za = r * 2, zb = r * 2 + 2;
        // East-west sub-lines (3 per tile, at v = 0.25, 0.5, 0.75).
        // West Y = (1-v)nw + v·sw   East Y = (1-v)ne + v·se
        // Diagonal SW→NE crosses v=v at u = 1-v; Y there = (1-v)ne + v·sw
        for (let sub = 1; sub <= 3; sub++) {
          const v = sub * 0.25;
          const z = r * 2 + sub * 0.5;
          const yW = (1 - v) * nw + v * sw;
          const yE = (1 - v) * ne + v * se;
          const xMid = c * 2 + 2 * (1 - v);
          const yMid = (1 - v) * ne + v * sw;
          subVerts.push(xa, yW, z,    xMid, yMid, z);
          subVerts.push(xMid, yMid, z, xb, yE, z);
        }
        // North-south sub-lines (3 per tile, at u = 0.25, 0.5, 0.75).
        // North Y = (1-u)nw + u·ne   South Y = (1-u)sw + u·se
        // Diagonal crosses u=u at v = 1-u; Y there = (1-u)sw + u·ne (same fold).
        for (let sub = 1; sub <= 3; sub++) {
          const u = sub * 0.25;
          const x = c * 2 + sub * 0.5;
          const yN = (1 - u) * nw + u * ne;
          const yS = (1 - u) * sw + u * se;
          const zMid = r * 2 + 2 * (1 - u);
          const yMid = (1 - u) * sw + u * ne;
          subVerts.push(x, yN, za,    x, yMid, zMid);
          subVerts.push(x, yMid, zMid, x, yS, zb);
        }
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

    this._gridOverlayLines = [majorLines, subLines];
  }

  /** Highlight a single tile with a coloured quad + wireframe border. */
  _previewTileHighlight(col, row, color, opacity) {
    this._addPreviewMesh(new THREE.Mesh(
      this._terrainTileQuad(col, row, 0.02),
      this._previewMat(color, opacity)
    ));
    this._addPreviewMesh(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this._terrainTileBorderPoints(col, row, 0.04)),
      this._previewEdgeMat(color)
    ));
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
    const s = this._pixelScale || 1;
    // Render at 1/s resolution, then let CSS stretch the canvas back to
    // full size. `updateStyle=false` prevents three from clobbering the
    // CSS width/height we set explicitly below.
    const rw = Math.max(1, Math.floor(w / s));
    const rh = Math.max(1, Math.floor(h / s));
    this.renderer.setSize(rw, rh, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    // First call happens during init(), before the glow pipeline (which
    // needs the scene/camera) is constructed — guard rather than reorder.
    if (this._glowPipeline) this._glowPipeline.setSize(rw, rh);
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

  /**
   * Yaw used for camera placement and screen-aligned panning. During a
   * free-orbit drag or its release snap, this is the free yaw; otherwise
   * it's the Q/E rotation angle.
   */
  _effectiveYaw() {
    return (this._freeOrbiting || this._snapping)
      ? this._freeYaw
      : this._viewRotationAngle;
  }

  _effectivePitch() {
    return (this._freeOrbiting || this._snapping)
      ? this._freePitch
      : targetPitchForMode(this.viewMode);
  }

  _updateCameraLookAt() {
    // Spherical orbit around (_panX, 0, _panY). cameraOffset(yaw=0, pitch=PITCH_REST)
    // reproduces the historical rest position exactly.
    const yaw = this._effectiveYaw();
    const pitch = this._effectivePitch();
    const off = cameraOffset(yaw, pitch);
    this.camera.position.set(this._panX + off.x, off.y, this._panY + off.z);
    this.camera.lookAt(this._panX, 0, this._panY);
  }

  _onResize() {
    this._setSize();
    this._updateCameraFrustum();
  }

  /**
   * Project context window tile anchors through the 3D camera so windows
   * track correctly at every view rotation — not just rotation 0.
   */
  _updateAnchoredWindows() {
    if (!this.camera) return;
    const gameEl = document.getElementById('game');
    const sw = gameEl.clientWidth;
    const sh = gameEl.clientHeight;
    const projectFn = (cam, wx, wy, wz, screenW, screenH) => {
      const vec = new THREE.Vector3(wx, wy, wz);
      vec.project(cam);
      return {
        x: (vec.x * 0.5 + 0.5) * screenW,
        y: (-vec.y * 0.5 + 0.5) * screenH,
      };
    };
    const updateWin = (w) => {
      const ctx = w.ctx || w;
      if (ctx.updateScreenFromCamera) {
        ctx.updateScreenFromCamera(this.camera, sw, sh, projectFn);
      }
    };
    // The window registries live on the UIHost — _openBeamlineWindow /
    // _openEquipmentWindow are UI_METHODS forwards, so their bodies run
    // with `this` = this.ui and populate the registries there.
    if (this.ui?._beamlineWindows) {
      for (const bw of Object.values(this.ui._beamlineWindows)) updateWin(bw);
    }
    if (this.ui?._equipmentWindows) {
      for (const ew of Object.values(this.ui._equipmentWindows)) updateWin(ew);
    }
  }

  _animate() {
    this._animFrameId = requestAnimationFrame(() => this._animate());
    try {
    this._tickViewRotation();
    this._tickFreeOrbitSnap();
    this._tickCameraFocus();
    this._updateZoneLabelFacing();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
    this._updateSunCycle();
    this._updateLightingRamp();
    this._updateLOD();
    // New-system utility-line preview + port-hover highlight + candidate
    // port indicators (visible whenever a utility-line tool is armed).
    const utilCtrl = this._inputHandler?.utilityLineController;
    if (utilCtrl && this.utilityLineBuilderV2 && this.utilityLinePreviewGroup) {
      this.utilityLineBuilderV2.setPreview(utilCtrl.preview, this.utilityLinePreviewGroup);
      this.utilityLineBuilderV2.setHoverPort(utilCtrl.hoverPort, this.utilityLinePreviewGroup);
      const activeType = utilCtrl.utilityType || null;
      if (activeType) {
        // Port markers depend on world data (placeables, utility lines) that
        // changes only on game events, plus the interactive hover/draw
        // anchors. Rebuild only when a world event fired (_portMarkersDirty)
        // or the interactive signature changed — not unconditionally per rAF.
        const hp = utilCtrl.hoverPort;
        const ds = utilCtrl.drawStart || null;
        const sig = activeType
          + '|' + (hp ? `${hp.placeableId}:${hp.portName}` : '')
          + '|' + (ds ? `${ds.placeableId}:${ds.portName}` : '');
        if (this._portMarkersDirty || sig !== this._portMarkersSig) {
          this._portMarkersDirty = false;
          this._portMarkersSig = sig;
          // Live read (documented accessor): port world positions and
          // claimed-port lookups resolve against live placeable shapes.
          const state = this._liveState();
          // Endpoints, not placeables: components carried on beam pipes
          // declare utility ports too (see utility/utility-endpoints.js).
          this.utilityLineBuilderV2.setAvailablePorts(
            activeType, state ? listUtilityEndpoints(state) : [], state?.utilityLines,
            hp, ds, this.utilityLinePreviewGroup,
          );
        }
      } else if (this._portMarkersSig !== null) {
        this._portMarkersSig = null;
        this.utilityLineBuilderV2.setAvailablePorts(null, null, null, null, null, this.utilityLinePreviewGroup);
      }
    }
    // Beam pipe preview + pre-click hover marker — read straight off the
    // beamline controller (single owner of pipe-draw render state). Both
    // renderers tear down and rebuild wholesale (the hover marker alone
    // rebuilds a 7x7 major + 3x3 sub grid, ~400 segments), so gate them on a
    // signature of everything they read instead of running per rAF while the
    // tool sits idle. `_beamPipeSig` is nulled by _clearPreviewMeshes and
    // _refreshBeamPipes, the two ways this geometry can go stale off-cursor.
    const blCtrl = this._inputHandler?.beamlineController;
    const drawing = !!(blCtrl && blCtrl.isActive() && blCtrl.drawPath.length >= 1);
    const hovering = !drawing && !!(blCtrl && blCtrl.hoverPoint);
    let blSig = null;
    if (drawing || hovering) {
      const path = drawing ? blCtrl.drawPath : [blCtrl.hoverPoint];
      const oe = blCtrl.hoverOpenEnd;
      blSig = (drawing ? blCtrl.drawMode : 'add')
        + '|' + path.map(p => p.col + ',' + p.row).join(';')
        + '|' + (drawing && blCtrl.drawCost ? blCtrl.drawCost.funding : '')
        + '|' + (oe ? oe.pipeId + ':' + oe.openEnd : '')
        + '|' + (hovering && blCtrl.hoverValidAnchor ? 1 : 0)
        + '|' + this._frustumSize;   // cost label counter-scales with zoom
    }
    if (blSig !== this._beamPipeSig) {
      this._beamPipeSig = blSig;
      if (drawing) {
        this._renderBeamPipePreview(blCtrl.drawPath, blCtrl.drawMode, blCtrl.drawCost);
      } else if (hovering) {
        this._renderBeamPipePreview([blCtrl.hoverPoint], 'add');
        this._renderPipeHoverMarker(blCtrl.hoverPoint);
      } else {
        this._clearBeamPipePreview();
        this._clearPipeHoverMarker();
      }
    }
    const _now = performance.now();
    const _dt = (_now - this._lastAnimTime) / 1000;
    this._lastAnimTime = _now;
    // Emissive-only breathe on existing marker materials — no rebuild.
    if (this.utilityLineBuilderV2) this.utilityLineBuilderV2.pulseUnwiredMarkers(_now);
    // One uniform write per flow-patched material — no rebuilds, no per-line
    // cost. See utility-flow.js.
    tickFlow(_dt);
    if (this.staffPawns) this.staffPawns.update(_dt);
    // Real lights: fixture spots/shadows, ambient glow points, flash decay.
    // See light-rig.js — nightFactor was computed this same frame by
    // _updateSunCycle() above.
    // `_darkness` is dayNightGrade's own scalar (0 = full day, 1 = deep
    // night), published by _updateSunCycle for exactly this kind of consumer.
    // The rig used to derive a second one from a raw cosine; two ramps for one
    // quantity drift apart the moment either is retuned, and the sky's is the
    // one with the smoothstepped twilight band.
    //
    // Note this is deliberately NOT the glow-role factor: real fixture lights
    // fade to zero at midday (a lit lamppost at noon reads as a bug), where
    // glow materials floor at 0.35 so a console screen stays legible.
    if (this._lightRig) {
      this._lightFocus.set(this._panX || 0, 0, this._panY || 0);
      this._lightRig.update(
        this.camera, this._darkness ?? 0, _dt, this._lightFocus,
        this._lightingEffectTimeMs ?? 0,
      );
      this._volumePool?.update(this._lightRig, this._darkness ?? 0, _dt);
    }
    this._glowPipeline.render();
    if (this._viewCube) this._viewCube.update();
    } catch (e) { console.error('[ThreeRenderer] animate error:', e); }
  }

  /**
   * Toggle visibility of detail meshes (userData.lod === 'detail') based on zoom.
   * Only runs when zoom level changes to avoid per-frame traversal cost.
   * Covers componentGroup and decorationGroup — lighting fixtures (Task 5)
   * live in the latter and tag their ornamental meshes the same way.
   */
  _updateLOD() {
    const showDetail = this.zoom >= 2.0;
    if (showDetail === this._lastLodDetail) return;
    this._lastLodDetail = showDetail;
    const groups = [this.componentGroup, this.decorationGroup];
    for (const g of groups) {
      if (!g) continue;
      g.traverse((child) => {
        if (child.isMesh && child.userData.lod === 'detail') {
          child.visible = showDetail;
        }
      });
    }
  }

  _updateSunCycle() {
    const now = performance.now();
    const dt = (now - this._lastSunFrameTime) / 1000; // seconds
    this._lastSunFrameTime = now;

    const game = this.game;
    const authoritative = game?.state?.timeOfDay;
    if (typeof authoritative !== 'number') return; // no game/state yet

    if (this._localTimeOfDay === null || authoritative !== this._lastSyncedTimeOfDay) {
      // First frame, or the sim just ticked (or was loaded/undone/redone) —
      // snap to the authoritative value rather than drift toward it, so a
      // save load or undo can never leave the sun stuck mid-glide.
      this._localTimeOfDay = authoritative;
      this._lastSyncedTimeOfDay = authoritative;
    } else if (!game.state.paused) {
      // Glide between ticks at the sim's own rate (scaled by game speed,
      // since a faster tick interval means timeOfDay advances faster in
      // real time too), so the sun moves smoothly at frame rate instead of
      // stepping once per 1 Hz sim tick.
      const speed = game.state.speed || 1;
      const perSecond = (speed * 1000) / (game.TICK_MS * DAY_LENGTH_TICKS);
      this._localTimeOfDay = (this._localTimeOfDay + dt * perSecond) % 1;
    }

    // timeOfDay: 0 = midnight, 0.5 = noon. Map to the sun's old angle
    // convention (angle=0 was noon, angle=π was midnight) so orbit radius,
    // elevation range and shadow-texel snapping below are unchanged.
    const sunAngle = (this._localTimeOfDay - 0.5) * 2 * Math.PI;

    // Sun orbits in a circle: radius 50, height varies with angle
    const R = 50;
    const x = Math.cos(sunAngle) * R;
    const z = Math.sin(sunAngle) * R;
    // Sun height: peaks at noon (angle=0), lowest at midnight (angle=π)
    // Range from 10 (low sun / long shadows) to 50 (high noon)
    const elevation = 30 + 20 * Math.cos(sunAngle);
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
    const texelsPerUnit = this._sunLight.shadow.mapSize.width / (shadowCam.right - shadowCam.left);
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

    // Moon: rises opposite the sun (highest at midnight, below the horizon
    // at noon — though its intensity is 0 by day regardless), following the
    // same pan-tracked target the sun uses. No shadow-texel snapping needed;
    // it never casts shadows.
    const moonAngle = sunAngle + Math.PI;
    const moonElevation = 30 + 20 * Math.cos(moonAngle);
    const mx = Math.cos(moonAngle) * R;
    const mz = Math.sin(moonAngle) * R;
    this._moonLight.position.set(mx + cx, moonElevation, mz + cz);
    this._moonLight.target.position.set(cx, 0, cz);
    this._moonLight.target.updateMatrixWorld();

    // Intensity and colour grading — see day-night.js. `darkness` (0 = full
    // day, 1 = deep night) is published on the renderer for later tasks
    // (fixture emissive, light pools, real point lights) to read so they
    // ramp in lockstep with the sky.
    const grade = dayNightGrade(this._localTimeOfDay);
    this._darkness = grade.darkness;
    this._lightingEffectTimeMs = this._localTimeOfDay * DAY_LENGTH_TICKS * 1000;

    this._sunLight.intensity = grade.sunIntensity;
    this._sunLight.color.setRGB(...grade.sunColor);

    this._sunLight.shadow.needsUpdate = false;
    const sunUpdates = this._sunShadowScheduler?.step({
      activeCount: 1,
      enabled: this.renderer.shadowMap.enabled && grade.sunIntensity > 0.02,
      dtMs: dt * 1000,
      assignmentKeys: ['sun'],
    }) || [];
    if (sunUpdates.length) this._sunLight.shadow.needsUpdate = true;

    this._ambientLight.intensity = grade.ambientIntensity;
    this._ambientLight.color.setRGB(...grade.ambientColor);

    this._moonLight.intensity = grade.moonIntensity;

    // Glow role (screens, indicator lamps): brighten as the sky darkens, but
    // never let them read as fully dark at noon — a lit console screen stays
    // legible (just washed out) in full daylight, matching how the sun itself
    // never fully goes to zero intensity above. Driven off dayNightGrade's
    // `darkness` so the glow ramps in lockstep with the sky grading rather
    // than off a second, independently-tuned curve.
    const GLOW_NIGHT_FACTOR_FLOOR = 0.35;
    setGlowNightFactor(GLOW_NIGHT_FACTOR_FLOOR + (1 - GLOW_NIGHT_FACTOR_FLOOR) * grade.darkness);
  }

  async loadAssets() {
    await this.textureManager.loadDecorationManifest();
  }

  /**
   * Rebuild only the named snapshot sections and merge them into the cached
   * `this._snapshot`, leaving every other section untouched. Returns the
   * merged snapshot. Partial refreshes (_refreshX) use this so reading one
   * section never pays for the full-map terrain walk.
   */
  _updateSnapshot(sections) {
    const partial = buildWorldSnapshot(this.game, { only: sections });
    if (!this._snapshot) this._snapshot = partial;
    else Object.assign(this._snapshot, partial);
    return this._snapshot;
  }

  /**
   * The single sanctioned live `game.state` access — see the SNAPSHOT
   * BOUNDARY note at the top of this file. Legitimate uses:
   *  - terrain corner/height sampling for cursor-anchored previews
   *    (arbitrary coordinates, queried per pointer move);
   *  - utility-line port/network resolution (portWorldPosition needs live
   *    placeable shapes, and the sim-published utilityNetworks /
   *    utilityNetworkData maps are read as-is — no discovery re-runs in the
   *    renderer; snapshotting these is future UtilityLineBuilderV2 work).
   * Everything else must read `this._snapshot`.
   */
  _liveState() { return this.game.state; }

  applySnapshot(snapshot) {
    this._snapshot = snapshot;
    this.terrainBuilder.build(snapshot.terrain, this.terrainGroup);
    this.cliffBuilder.build(snapshot.cliffs || [], this.terrainGroup);
    this._terrainMesh = this.terrainBuilder.getMesh();
    this.wildflowerBuilder.rebuild(snapshot);
    this.grassTuftBuilder.rebuild(snapshot);
    this.floorBuilder.build(snapshot.floors, this.floorGroup);
    let cutawayRoom = null;
    if (this.wallVisibilityMode === 'cutaway') {
      cutawayRoom = this._detectCutawayRegion(this.hoverCol, this.hoverRow);
    }
    this.wallBuilder.build(snapshot.walls, snapshot.doors, snapshot.windows, this.wallGroup, this.wallVisibilityMode, cutawayRoom);
    this.componentBuilder.build(snapshot.components, this.componentGroup);
    this.pipeAttachmentBuilder.build(snapshot.pipeAttachments || [], this.pipeAttachmentGroup);
    this.beamBuilder.build(snapshot.beamPaths, this.componentGroup);
    this.equipmentBuilder.build(snapshot.equipment, snapshot.furnishings, this.equipmentGroup);
    this.decorationBuilder.build(snapshot.decorations, this.decorationGroup);
    this.lightingGroup = this.decorationBuilder.getLightingFixtures();
    this._rebuildLightPools();
    // Feed the same registry to the real-light rig's fixture discovery — see
    // light-rig.js's setFixtureRegistry(); this is what replaced the dead
    // userData.lightFixture scene-traversal lookup.
    if (this._lightRig) this._lightRig.setFixtureRegistry(this.lightingGroup);
    this._refreshUtilityLinesV2();
    this._refreshUnwiredSinkMarkers(true);
    this._refreshPortFittings();
    this._refreshBeamPipes();
    this._refreshZones();
    this._invalidateGridOverlay();
  }

  refresh() {
    const snapshot = buildWorldSnapshot(this.game);
    this.applySnapshot(snapshot);
    if (this.staffPawns) this.staffPawns.sync();
  }

  _refreshTerrain() {
    // Tuft/wildflower builders read snapshot.terrain + snapshot.grassSurfaces.
    // Every builder below is content-hash cached, so calling this on events
    // that leave the terrain unchanged costs only the snapshot walk + hash.
    const snap = this._updateSnapshot(['terrain', 'cliffs', 'grassSurfaces']);
    this.terrainBuilder.build(snap.terrain, this.terrainGroup);
    this.cliffBuilder.build(snap.cliffs || [], this.terrainGroup);
    this._terrainMesh = this.terrainBuilder.getMesh();
    this.wildflowerBuilder.rebuild(snap);
    this.grassTuftBuilder.rebuild(snap);
    // Cached overlay lines bake the old heights (placement auto-flattens).
    this._invalidateGridOverlay();
  }

  _refreshInfra() {
    const snap = this._updateSnapshot(['floors']);
    this.floorBuilder.build(snap.floors, this.floorGroup);
  }

  _refreshZones() {
    if (!this.zoneGroup) return;
    // Zone tiles are InstancedMeshes — disposeGroupChildren also frees their
    // instanceMatrix/instanceColor buffers, which geometry.dispose() misses.
    disposeGroupChildren(this.zoneGroup);
    this._zoneLabelMeshes = [];

    const zones = this._updateSnapshot(['zones']).zones || [];
    if (zones.length === 0) return;

    const style = this.zoneLabelStyle || DEFAULT_ZONE_LABEL_STYLE;
    // The paint is drawn to a canvas with Press Start 2P; a webfont that has
    // not loaded yet silently measures and rasterises as the monospace
    // fallback. Rebuild once when the font arrives rather than shipping a
    // wrong-metric texture for the rest of the session.
    if (!this._zoneLabelFontRetry && document.fonts && !document.fonts.check(`16px 'Press Start 2P'`)) {
      this._zoneLabelFontRetry = true;
      document.fonts.ready.then(() => this._refreshZones()).catch(() => {});
    }
    const labels = [];

    const byType = new Map();
    for (const z of zones) {
      if (!byType.has(z.zoneType)) byType.set(z.zoneType, []);
      byType.get(z.zoneType).push(z);
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

      for (const cluster of this._clusterZoneTiles(tiles)) {
        const label = buildZoneFloorLabel({
          name: def.name,
          color: def.color,
          tiles: cluster,
          style,
          anisotropy: this.renderer?.capabilities?.getMaxAnisotropy?.() || 1,
        });
        if (label) labels.push(label);
      }
    }

    // Adjacent zones of different types cluster independently, so two
    // interlocking footprints can want the same patch of floor. Bigger room
    // wins; the loser is dropped rather than shrunk into a smudge.
    const keep = new Set(resolveLabelOverlaps(labels.map(m => m.userData.labelBox)));
    for (let i = 0; i < labels.length; i++) {
      if (!keep.has(i)) { disposeSceneObject(labels[i]); continue; }
      labels[i].visible = this.showZoneLabels !== false;
      this.zoneGroup.add(labels[i]);
      this._zoneLabelMeshes.push(labels[i]);
    }
    this._zoneLabelFacingSig = null;   // force a facing pass on the next frame

    this.zoneGroup.visible = this.zoneOverlayVisible !== false;
  }

  /**
   * Swap the zone-label variant at runtime (see ZONE_LABEL_STYLES). Used by
   * the comparison screenshots; the game itself just takes the default.
   * @returns {boolean} whether the id was known
   */
  setZoneLabelStyle(id) {
    const style = zoneLabelStyleById(id);
    if (!style) return false;
    this.zoneLabelStyle = style;
    this._refreshZones();
    this.refresh?.();
    return true;
  }

  /**
   * Turn the floor labels to whichever end of their own axis reads
   * left-to-right for the current camera (zone-label.js explains the scheme).
   * Only the SIGNS of the camera-right vector can change the answer, so the
   * pass is gated on those two bits: an orbiting camera touches the labels
   * twice per full turn, and an idle one costs two comparisons per frame.
   */
  _updateZoneLabelFacing() {
    if (this._zoneLabelMeshes.length === 0) return;
    const e = this.camera.matrixWorld.elements;
    const sig = (e[0] >= 0 ? 1 : 0) * 2 + (e[2] >= 0 ? 1 : 0);
    if (sig === this._zoneLabelFacingSig) return;
    this._zoneLabelFacingSig = sig;
    faceZoneLabels(this._zoneLabelMeshes, e[0], e[2], this.zoneLabelStyle);
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

  /**
   * Camera-facing text sprite. The only caller left is the beam-pipe drag
   * cost readout — zone names are floor paint now (zone-label.js), not
   * sprites, so the old isZone branch (white text, heavy black outline, dark
   * plate) is gone with them.
   */
  _makeLabelSprite(text) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Cost labels are re-made per rAF while dragging — reuse the cached
    // canvas texture/material for a given text value.
    const cached = this._labelMatCache.get(text);
    if (cached) {
      const sprite = new THREE.Sprite(cached.material);
      sprite.scale.set(cached.scaleX, cached.scaleY, 1);
      sprite.renderOrder = 10;
      sprite.userData.sharedLabelMaterial = true;
      return sprite;
    }
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
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
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
    const LABEL_CACHE_MAX = 128;
    if (this._labelMatCache.size >= LABEL_CACHE_MAX) {
      for (const entry of this._labelMatCache.values()) {
        if (entry.material.map) entry.material.map.dispose();
        entry.material.dispose();
      }
      this._labelMatCache.clear();
    }
    this._labelMatCache.set(text, {
      material: mat,
      scaleX: sprite.scale.x,
      scaleY: sprite.scale.y,
    });
    sprite.userData.sharedLabelMaterial = true;
    return sprite;
  }

  _refreshWalls() {
    const snap = this._updateSnapshot(['walls', 'doors', 'windows', 'wallOccupancy']);
    let cutawayRoom = null;
    if (this.wallVisibilityMode === 'cutaway') {
      cutawayRoom = this._detectCutawayRegion(this.hoverCol, this.hoverRow);
    }
    this.wallBuilder.build(snap.walls, snap.doors, snap.windows, this.wallGroup, this.wallVisibilityMode, cutawayRoom);
  }

  /**
   * Detect the room under the cursor plus all adjoining rooms for cutaway.
   * Only real walls (interior, shielding, exterior walls) form room boundaries —
   * fences and hedges do not create interior rooms.
   */
  _detectCutawayRegion(startCol, startRow) {
    const occ = this._snapshot?.wallOccupancy;
    const wallOcc = occ?.wallOccupied || {};
    const doorOcc = occ?.doorOccupied || {};
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
    const walls = this._snapshot?.walls || [];

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
    if (sub === 'fencing' || sub === 'hedges') return false;
    return true;
  }

  _refreshEquipment() {
    const snap = this._updateSnapshot(['equipment', 'furnishings']);
    this.equipmentBuilder.build(snap.equipment, snap.furnishings, this.equipmentGroup);
  }

  _refreshDecorations() {
    const snap = this._updateSnapshot(['decorations']);
    this.decorationBuilder.build(snap.decorations, this.decorationGroup);
    this.lightingGroup = this.decorationBuilder.getLightingFixtures();
    this._rebuildLightPools();
    // Feed the same registry to the real-light rig's fixture discovery — see
    // light-rig.js's setFixtureRegistry(); this is what replaced the dead
    // userData.lightFixture scene-traversal lookup.
    if (this._lightRig) this._lightRig.setFixtureRegistry(this.lightingGroup);
  }

  /**
   * Rebuild the merged light-pool mesh and halo sprites from the current
   * `this.lightingGroup` registry. Geometry only — this is NOT called per
   * frame; per-frame opacity/emissive ramping lives in _updateLightingRamp.
   * Triggers: every place that reassigns `this.lightingGroup`, i.e.
   * applySnapshot() (full load) and _refreshDecorations() (any
   * decoration-affecting game event) — never on a render tick, so placing
   * sixty lamps costs sixty rebuilds total, not sixty rebuilds per second.
   */
  _rebuildLightPools() {
    this._clearLightGroup(this.lightPoolGroup);
    this._clearLightGroup(this.lightHaloGroup);
    const fixtures = this.lightingGroup;
    if (!fixtures || !fixtures.length) return;
    const poolMesh = buildLightPools(fixtures);
    if (poolMesh) this.lightPoolGroup.add(poolMesh);
    const halos = buildLightHalos(fixtures);
    if (halos) this.lightHaloGroup.add(halos);
  }

  /**
   * Dispose geometry + material for every child of a light pool/halo group.
   * Deliberately NOT dispose-utils.js's disposeGroupChildren: that also frees
   * material.map, but every pool/halo material here shares ONE cached glow
   * texture (lighting-builder.js's _glowTexture) across every rebuild —
   * freeing it would blank every other lamp on the very next rebuild. Also
   * never dispose a Sprite's own .geometry: three.js's Sprite class shares a
   * single module-level plane geometry across every Sprite in the app (see
   * the existing precedent at this file's zone-label sprite handling), so
   * disposing it would break every sprite on screen, not just halos.
   */
  _clearLightGroup(group) {
    if (!group) return;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.isGroup) { this._clearLightGroup(child); continue; }
      if (!child.isSprite && child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  /**
   * Per-frame darkness ramp for the Task 6 fake-lighting layer: fixture
   * emissiveIntensity, pool mesh opacity, halo sprite opacity, and window
   * glass emissiveIntensity. All four read the SAME this._darkness (set by
   * _updateSunCycle from dayNightGrade()) so they move in lockstep — no
   * geometry work here, only scalar material properties, safe to run every
   * frame even at sixty lamps and a glazed facade.
   *
   * Also applies the light rig's pool SUPPRESSION: a fixture currently holding
   * one of the 4 real shadow spots must hide its own painted pool, or it reads
   * double-bright. The rig owns that decision (light-rig.js's
   * getFixtureSuppression); this is the only place it's consumed.
   *
   * FRAME ORDERING — deliberate, do not "fix": _animate() calls this BEFORE
   * _lightRig.update(), so the suppression weights applied here are one frame
   * stale. The rig's update needs the frame's `dt`, which is computed much
   * further down next to tickFlow/staffPawns; hoisting it would reshuffle
   * unrelated timing for a 16 ms lag against a 250 ms crossfade (~6%, invisible
   * on a fade that is itself an anti-strobe damper). If SPOT_CROSSFADE_MS is
   * ever shortened to the point where one frame is a meaningful fraction of
   * it, move the rig update above this call rather than compensating here.
   */
  _updateLightingRamp() {
    const darkness = this._darkness ?? 0;
    for (const fx of this.lightingGroup) {
      const mat = fx.group.userData.emitterMaterial;
      if (mat) {
        mat.emissiveIntensity = emitterIntensityForDarkness(darkness)
          * fixtureDynamicFactor(
            fx.def?.light?.dynamicProfile,
            fx.id,
            this._lightingEffectTimeMs ?? 0,
            darkness,
          );
      }
    }
    if (this.lightPoolGroup) {
      const suppression = this._lightRig ? this._lightRig.getFixtureSuppression() : null;
      for (const child of this.lightPoolGroup.children) {
        if (child.material) child.material.opacity = poolOpacityForDarkness(darkness);
        applyPoolSuppression(child, suppression);
      }
    }
    if (this.lightHaloGroup) {
      this.lightHaloGroup.traverse((child) => {
        if (child.isSprite) child.material.opacity = haloOpacityForDarkness(darkness);
      });
    }
    // Window panes come up warm from the outside as night falls. The builder
    // hands back one material per (window type, variant, ghosted) combination
    // — a facade of twenty identical windows is one write, not twenty — and
    // the array is empty until a window is actually placed.
    const glassMats = this.wallBuilder ? this.wallBuilder.glassMaterials() : null;
    if (glassMats && glassMats.length) {
      const glow = glassGlowForDarkness(darkness);
      for (const mat of glassMats) mat.emissiveIntensity = glow;
    }
  }

  _refreshConnections() {
    // Phase 6: rack + utility-pipe legacy builders removed. The new-system
    // UtilityLineBuilderV2 drives all utility-line rendering via
    // _refreshUtilityLinesV2, which is triggered directly on line changes.
  }

  /**
   * Rebuild new-system (Phase 4) utility lines from state.utilityLines.
   * Called on 'utilityLinesChanged' and 'placeableChanged' (the latter so
   * lines follow placeables that are moved).
   */
  _refreshUtilityLinesV2() {
    if (!this.utilityLineGroup || !this.utilityLineBuilderV2) return;
    const snap = this._updateSnapshot(['utilityLines']);
    // Live read (documented accessor): the builder pins line endpoints to
    // portWorldPosition of live placeables and joins the sim-published
    // utilityNetworks/utilityNetworkData maps for per-network error glow
    // (no discovery re-runs here) — neither is snapshotted yet (see
    // _liveState).
    const state = this._liveState();
    if (!state || !state.utilityLines) return;
    // Includes pipe placements, whose ports lines can now attach to.
    const placeablesById = makeUtilityEndpointIndex(state);
    this.utilityLineBuilderV2.build(snap.utilityLines, placeablesById, this.utilityLineGroup, {
      state,
    });
    // A rebuilt line's floor-glow strip (if any) starts visible regardless
    // of the current glow toggle — reapply it here rather than only on the
    // toggle's own flip.
    this._applyGlowToggleToFloorStrips();
  }

  /**
   * Rebuild the always-on markers over unwired declared sinks.
   *
   * Input is state.infraBlockers — the gate already did the topology work this
   * tick, so nothing is re-derived here. The blocker signature is a cheap
   * string over a handful of entries and guards the only expensive step (the
   * endpoint-index walk, which has to cover pipe placements). Callers on the
   * per-tick path pass no `force`; callers that moved geometry without
   * changing the blocker set (a placeable drag) pass force=true.
   */
  /**
   * Rebuild the connector fittings on equipment.
   *
   * Always on, unlike the port dots — a device's connectors are part of what it
   * IS, and a player deciding where to put a pump should be able to see which
   * face its vacuum port is on without arming a tool first.
   *
   * Signature-guarded on endpoint identity + pose, which is the only thing the
   * geometry depends on: wiring one up does not move its connector.
   */
  _refreshPortFittings() {
    if (!this.portFittingGroup) return;
    const state = this._liveState();
    // Endpoints, not placeables: most utility ports live on pipe placements.
    const endpoints = state ? listUtilityEndpoints(state) : [];
    const sig = portFittingSignature(endpoints);
    if (sig === this._portFittingSig) return;
    this._portFittingSig = sig;
    while (this.portFittingGroup.children.length > 0) {
      const child = this.portFittingGroup.children[0];
      this.portFittingGroup.remove(child);
      child.traverse?.(o => {
        // Fittings share one cached geometry per connector style across every
        // port in the facility, so disposing here would drop the buffers every
        // other fitting is still drawing and force a re-upload on the next
        // frame. Same contract as the `__shared` flag on the materials.
        if (o.geometry && !o.userData?.sharedGeometry) o.geometry.dispose();
        const m = o.material;
        if (m && !m.userData?.__shared && typeof m.dispose === 'function') m.dispose();
      });
    }
    if (!sig) return;
    const { group } = buildPortFittings(endpoints);
    while (group.children.length > 0) this.portFittingGroup.add(group.children[0]);
  }

  _refreshUnwiredSinkMarkers(force = false) {
    if (!this.unwiredSinkGroup || !this.utilityLineBuilderV2) return;
    const state = this._liveState();
    const blockers = (state && state.infraBlockers) || [];
    const unwired = blockers.filter(b => b && b.fromUnconnectedCheck && b.location?.placeableId);
    // The pin now hangs off the port's 3D anchor, so a device that moved (or
    // whose anchor resolved once the model bounds were measured) has to
    // rebuild — the blocker set alone no longer determines the geometry.
    const sig = unwired.map(b => `${b.location.placeableId}:${b.location.portName}`).join(';');
    if (!force && sig === this._unwiredBlockerSig) return;
    this._unwiredBlockerSig = sig;
    if (unwired.length === 0) {
      this.utilityLineBuilderV2.setUnwiredSinkMarkers([], this.unwiredSinkGroup);
      return;
    }
    // Endpoints, not placeables: every cavity/quad/BPM offender lives in
    // pipe.placements (see utility/utility-endpoints.js).
    const byId = makeUtilityEndpointIndex(state);
    const marks = [];
    for (const b of unwired) {
      const ep = byId.get(b.location.placeableId);
      if (!ep) continue;
      const def = COMPONENTS[ep.type];
      const anchor = portAnchor3D(ep, def, b.location.portName);
      if (!anchor) continue;
      const utilityType = def?.ports?.[b.location.portName]?.utility;
      if (!utilityType) continue;
      marks.push({
        id: ep.id, portName: b.location.portName, utilityType,
        x: anchor.x, y: anchor.y, z: anchor.z,
      });
    }
    this.utilityLineBuilderV2.setUnwiredSinkMarkers(marks, this.unwiredSinkGroup);
  }

  /**
   * Frame the camera on a world point (metres): pan to it and, if the view is
   * zoomed further out than `minZoom`, zoom in to it. Animated so the player
   * keeps their bearings; any manual pan/zoom cancels the animation
   * mid-flight. Drives the click-to-locate on HUD infrastructure blockers.
   */
  focusOnWorld(x, z, opts = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this._focusFromX = this._panX;
    this._focusFromY = this._panY;
    this._focusToX = x;
    this._focusToY = z;
    this._focusFromZoom = this.zoom;
    this._focusToZoom = Math.min(ZOOM_MAX, Math.max(this.zoom, opts.minZoom ?? 3));
    this._focusStartMs = performance.now();
    this._focusDurationMs = opts.durationMs ?? 450;
    this._focusing = true;
  }

  /** focusOnWorld on the centre of tile (col,row). 1 tile = 2 world metres. */
  focusOnTile(col, row, opts = {}) {
    this.focusOnWorld(col * 2 + 1, row * 2 + 1, opts);
  }

  _tickCameraFocus() {
    if (!this._focusing) return;
    const t = Math.min(1, (performance.now() - this._focusStartMs) / this._focusDurationMs);
    const k = easeInOutQuad(t);
    this._panX = this._focusFromX + (this._focusToX - this._focusFromX) * k;
    this._panY = this._focusFromY + (this._focusToY - this._focusFromY) * k;
    this.zoom = this._focusFromZoom + (this._focusToZoom - this._focusFromZoom) * k;
    this._updateCameraLookAt();
    // Rebuilds _frustumSize from the new zoom and re-syncs the overlay.
    this._syncOverlayFromPan();
    if (this._updateAnchoredWindows) this._updateAnchoredWindows();
    if (t >= 1) this._focusing = false;
  }

  _refreshBeamPipes() {
    // The hover stub reads pipe paths off the snapshot, so a pipe edit has to
    // re-arm the preview memo even when the cursor hasn't moved.
    this._beamPipeSig = null;
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

    const snap = this._updateSnapshot(['beamPipes', 'moduleSubTiles', 'pipeAttachments']);
    const pipes = snap.beamPipes || [];
    if (pipes.length === 0) {
      // Still rebuild attachments (they may have all been removed with pipes).
      this.pipeAttachmentBuilder.build(snap.pipeAttachments || [], this.pipeAttachmentGroup);
      return;
    }

    const PIPE_RADIUS = 0.06;
    const PIPE_Y = 1.0;
    const FLANGE_R = 0.12;
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
    // Warning-amber cap material for open (unconnected) pipe ends.
    const openCapMat = new THREE.MeshStandardMaterial({
      color: 0xffaa22, roughness: 0.4, metalness: 0.2,
      emissive: 0xcc6600, emissiveIntensity: 0.6,
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
    // Tiles occupied by beamline modules (subtile precision, from the
    // snapshot) — pipe runs are carved around them and flanges suppressed
    // where the pipe meets the module body.
    const moduleTiles = new Set(snap.moduleSubTiles || []);
    const isModuleAt = (col, row) => {
      // Pipe coordinates are tile-center-aligned (col*2+1 in world space),
      // but module cells use tile-corner-aligned subtile indices. Shift by
      // +0.5 to convert pipe coords to the module subtile grid.
      const adjCol = col + 0.5;
      const adjRow = row + 0.5;
      const tileCol = Math.floor(adjCol + 1e-6);
      const tileRow = Math.floor(adjRow + 1e-6);
      const subCol = Math.round((adjCol - tileCol) * 4);
      const subRow = Math.round((adjRow - tileRow) * 4);
      return moduleTiles.has(`${tileCol},${tileRow},${subCol},${subRow}`);
    };

    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length < 2) continue;

      const pipeWrapper = new THREE.Group();
      pipeWrapper.userData.pipeId = pipe.id;

      const runs = pipePathRuns(pipe.path);
      const runCount = runs.length;

      for (let r = 0; r < runCount; r++) {
        const origStart = runs[r].start;
        const origEnd   = runs[r].end;

        // Split the run into sub-segments that skip module tiles.
        // Modules already render their own internal pipe + flanges.
        const subRuns = splitRunExcludingModules(origStart, origEnd, moduleTiles);

        for (const sub of subRuns) {
          const { start, end } = sub;
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

          // Flange emission — only at original pipe start/end and corners,
          // never at module boundaries (the module has its own flanges).
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

          const isOrigStart = Math.abs(start.col - origStart.col) < 0.01
                           && Math.abs(start.row - origStart.row) < 0.01;
          const isOrigEnd   = Math.abs(end.col - origEnd.col) < 0.01
                           && Math.abs(end.row - origEnd.row) < 0.01;

          // Start flange: only on the first run's original start
          if (isOrigStart && r === 0) {
            const sharesEnd = (endpointCounts.get(endpointKey(start.col, start.row)) || 0) > 1;
            const onModule = isModuleAt(start.col, start.row);
            if (!sharesEnd && !onModule) addFlange(x1, z1);
          }
          // Corner flange at original run start (between previous run and this one)
          if (isOrigStart && r > 0) {
            addFlange(x1, z1);
          }
          // End flange: only on the last run's original end
          if (isOrigEnd && r === runCount - 1) {
            const sharesEnd = (endpointCounts.get(endpointKey(end.col, end.row)) || 0) > 1;
            const onModule = isModuleAt(end.col, end.row);
            if (!sharesEnd && !onModule) addFlange(x2, z2);
          }
          // Intermediate flanges every 2 world units, skipping module tiles
          const MAX_UNFLANGED = 2;
          if (length > MAX_UNFLANGED + 0.01) {
            const nInterior = Math.floor(length / MAX_UNFLANGED - 1e-3);
            for (let k = 1; k <= nInterior; k++) {
              const t = (k * MAX_UNFLANGED) / length;
              const fx = x1 + dx * t;
              const fz = z1 + dz * t;
              // Convert world position back to tile coords and skip if on a module
              const tileC = (fx - 1) / 2;
              const tileR = (fz - 1) / 2;
              if (!isModuleAt(tileC, tileR)) addFlange(fx, fz);
            }
          }

          // Support stands every ~2 world units, skipping module tiles
          const standH = PIPE_Y - PIPE_RADIUS;
          const standGeo = new THREE.BoxGeometry(STAND_W, standH, STAND_W);
          const standStep = 2;
          const nStands = Math.max(1, Math.round(length / standStep));
          for (let k = 0; k < nStands; k++) {
            const t = (k + 0.5) / nStands;
            const sx = x1 + dx * t;
            const sz = z1 + dz * t;
            const tileC = (sx - 1) / 2;
            const tileR = (sz - 1) / 2;
            if (isModuleAt(tileC, tileR)) continue;
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
      }

      // Open-end caps: render a warning-amber disc at any end where the
      // junction ref is null (pipe isn't connected to a junction on that side).
      // Each end's orientation is perpendicular to the pipe axis at that end.
      const addOpenCap = (tipCol, tipRow, prevCol, prevRow) => {
        const tx = tipCol * 2 + 1;
        const tz = tipRow * 2 + 1;
        const px = prevCol * 2 + 1;
        const pz = prevRow * 2 + 1;
        const dx = tx - px;
        const dz = tz - pz;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.01) return;
        const angle = -Math.atan2(dz, dx);
        // Thin cylinder oriented along the pipe axis — its circular faces
        // sit perpendicular to the pipe direction like a disc/cap.
        const capR = PIPE_RADIUS * 2.2;
        const capW = 0.04;
        const capGeo = new THREE.CylinderGeometry(capR, capR, capW, 12);
        capGeo.rotateZ(Math.PI / 2);
        const cap = new THREE.Mesh(capGeo, openCapMat);
        cap.position.set(tx, PIPE_Y, tz);
        cap.rotation.y = angle;
        cap.castShadow = true;
        cap.userData.tooltip = 'unconnected';
        cap.userData.pipeId = pipe.id;
        pipeWrapper.add(cap);
        this._beamPipeMeshes.push(cap);
      };

      if (pipe.path && pipe.path.length >= 2) {
        if (pipe.openStart) {
          const a = pipe.path[0];
          const b = pipe.path[1];
          // Tip is a; previous direction points from b toward a so the disc
          // orients perpendicular to the pipe's outgoing direction at the tip.
          addOpenCap(a.col, a.row, b.col, b.row);
        }
        if (pipe.openEnd) {
          const a = pipe.path[pipe.path.length - 1];
          const b = pipe.path[pipe.path.length - 2];
          addOpenCap(a.col, a.row, b.col, b.row);
        }
      }

      this.beamPipeGroup.add(pipeWrapper);
    }

    // Rebuild inline attachments — their positions depend on pipe paths.
    this.pipeAttachmentBuilder.build(snap.pipeAttachments || [], this.pipeAttachmentGroup);
  }

  renderBeamPipePreview(path, mode, cost) {
    this._renderBeamPipePreview(path, mode, cost);
  }

  _renderBeamPipePreview(path, mode, cost) {
    this._clearBeamPipePreview();
    if (!path || path.length < 1) return;

    const isRemove = mode === 'remove';
    const wireColor = isRemove ? 0xff4444 : 0x44ff44;

    const PIPE_RADIUS = 0.06;
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
      this.previewGroup.add(pipe);
      this._beamPipePreviewMeshes.push(pipe);
      const pipeWire = new THREE.Mesh(pipeGeo, wireframeMat);
      pipeWire.position.copy(pipe.position);
      pipeWire.rotation.copy(pipe.rotation);
      this.previewGroup.add(pipeWire);
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
        this.previewGroup.add(flange);
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
        this.previewGroup.add(stand);
        this._beamPipePreviewMeshes.push(stand);
      }
    };

    // Single-point hover: show a short stub ONLY when snapped to an existing
    // pipe's open end, aligned with that pipe's continuation direction so
    // the player sees "the new pipe will continue this way." In empty space
    // (no port / open end), no stub — the square footprint marker alone is
    // the pre-click cue. The old placementDir-driven stub rotated on R but
    // never actually controlled pipe direction (direction comes from the
    // snapped port at mouse-up), so it was just visual noise.
    if (path.length < 2) {
      const openEnd = this._inputHandler?.beamlineController?.hoverOpenEnd;
      if (openEnd) {
        // Pipe paths are world data — read the cached snapshot section.
        const pipe = (this._snapshot?.beamPipes || []).find(p => p && p.id === openEnd.pipeId);
        if (pipe && pipe.path && pipe.path.length >= 2) {
          const tipIdx = openEnd.openEnd === 'start' ? 0 : pipe.path.length - 1;
          const neighborIdx = openEnd.openEnd === 'start' ? 1 : pipe.path.length - 2;
          const tip = pipe.path[tipIdx];
          const neigh = pipe.path[neighborIdx];
          // Outward direction = tip − neigh (normalized to ±1 on one axis).
          const dc = tip.col - neigh.col;
          const dr = tip.row - neigh.row;
          const adc = Math.abs(dc), adr = Math.abs(dr);
          let ox = 0, oz = 0;
          if (adc >= adr && adc > 0.001) ox = Math.sign(dc);
          else if (adr > 0.001) oz = Math.sign(dr);
          if (ox !== 0 || oz !== 0) {
            const cx = tip.col * 2 + 1;
            const cz = tip.row * 2 + 1;
            addRun(cx, cz, cx + ox * 1.0, cz + oz * 1.0);
          }
        }
      }
      return;
    }
    const runs = pipePathRuns(path);
    for (const { start, end } of runs) {
      addRun(start.col * 2 + 1, start.row * 2 + 1, end.col * 2 + 1, end.row * 2 + 1);
    }

    // Cost label at the midpoint of the path. Skipped on remove-mode and
    // when the caller didn't pass a cost (e.g. hover-only single-point).
    if (!isRemove && cost && typeof cost.funding === 'number' && path.length >= 2) {
      const mid = path[Math.floor(path.length / 2)];
      const sprite = this._makeLabelSprite('$' + cost.funding.toLocaleString());
      sprite.position.set(mid.col * 2 + 1, PIPE_Y + 0.9, mid.row * 2 + 1);
      // Ortho camera zoom scales world-space sprites; counter-scale by the
      // current frustum-to-baseline ratio so the label stays at a constant
      // screen size (billboard/HUD feel) regardless of zoom.
      const BASELINE_FRUSTUM = 20;
      const k = this._frustumSize / BASELINE_FRUSTUM;
      sprite.scale.x *= k;
      sprite.scale.y *= k;
      this.previewGroup.add(sprite);
      this._beamPipePreviewMeshes.push(sprite);
    }
  }

  _clearBeamPipePreview() {
    if (this._beamPipePreviewMeshes) {
      for (const mesh of this._beamPipePreviewMeshes) {
        this.previewGroup.remove(mesh);
        // Cost-label sprites share a cached material/texture (and THREE.Sprite
        // geometry is shared library-wide) — remove only, never dispose.
        if (mesh.userData && mesh.userData.sharedLabelMaterial) continue;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (mesh.material.map) mesh.material.map.dispose();
          mesh.material.dispose();
        }
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
    this._clearPipeHoverMarker();
  }

  _renderPipeHoverMarker(pt) {
    this._clearPipeHoverMarker();
    // Beam pipe cross-section is 2×2 subtiles (1×1 world units).
    // Pipe coords are tile-center-aligned (col*2+1 in world space).
    // Snap the marker to the subtile grid so it aligns with placement cells.
    const FOOT = 1.0;           // 2 subtiles × 0.5 world units each
    const cx = pt.col * 2 + 1;
    const cz = pt.row * 2 + 1;
    const x0 = cx - FOOT / 2, x1 = cx + FOOT / 2;
    const z0 = cz - FOOT / 2, z1 = cz + FOOT / 2;
    const y = 0.12;
    // Golden/yellow tint when snapped to an existing pipe's open end, so the
    // player can see "you're anchored on a cap" before they click. Green only
    // where a click would actually start a draw (a junction port); everywhere
    // else the click is discarded, so paint the standard invalid red rather
    // than the valid-placement green this used to show unconditionally.
    const blCtrl = this._inputHandler?.beamlineController;
    const onOpenEnd = blCtrl?.hoverOpenEnd;
    const color = onOpenEnd ? 0xffcc33 : (blCtrl?.hoverValidAnchor ? 0x44ff44 : 0xff4444);
    const edgeMat = this._previewEdgeMat(color);
    const fillMat = this._previewMat(color, 0.15);
    const pts = [
      new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0),
      new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1),
      new THREE.Vector3(x0, y, z0),
    ];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat);
    line.renderOrder = 999;
    const fillGeo = new THREE.PlaneGeometry(FOOT, FOOT);
    fillGeo.rotateX(-Math.PI / 2);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.set(cx, 0.1, cz);
    fill.renderOrder = 999;
    this._pipeHoverMeshes = [line, fill];
    this.previewGroup.add(line);
    this.previewGroup.add(fill);
    // Show subtile grid around cursor
    const tileCol = Math.floor(pt.col + 0.5);
    const tileRow = Math.floor(pt.row + 0.5);
    this._renderGridAroundCursor(tileCol, tileRow);
  }

  _clearPipeHoverMarker() {
    if (this._pipeHoverMeshes) {
      for (const m of this._pipeHoverMeshes) {
        this.previewGroup.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      }
      this._pipeHoverMeshes = null;
    }
  }

  _refreshBeam() {
    const snap = this._updateSnapshot(['beamPaths']);
    this.beamBuilder.build(snap.beamPaths, this.componentGroup);
  }

  _refreshComponents() {
    try {
    const snap = this._updateSnapshot(['components', 'pipeAttachments']);
    this.componentBuilder.build(snap.components, this.componentGroup);
    this.pipeAttachmentBuilder.build(snap.pipeAttachments || [], this.pipeAttachmentGroup);
    } catch(e) { console.error('[_refreshComponents] CRASH:', e); }
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
    this._clearDesignGhost();
    if (this.utilityLineBuilderV2 && this.utilityLineGroup) {
      this.utilityLineBuilderV2.dispose(this.utilityLineGroup);
    }
    if (this.staffPawns) {
      this.staffPawns.dispose();
      this.staffPawns = null;
    }
    if (this._viewCube) {
      this._viewCube.dispose();
      this._viewCube = null;
    }
    if (this._glowPipeline) {
      this._glowPipeline.dispose();
      this._glowPipeline = null;
    }
    if (this._lightRig) {
      this._lightRig.dispose();
      this._lightRig = null;
    }
    if (this._volumePool) {
      this._volumePool.dispose();
      this._volumePool = null;
    }
    disposeLightCookies();
    this.renderer.dispose();
    const threeCanvas = this.renderer.domElement;
    if (threeCanvas.parentNode) threeCanvas.parentNode.removeChild(threeCanvas);
    this.overlay.dispose();
  }
}

// --- UI method forwards ---
// Names of methods UIHost exposes (attached in hud.js / overlays.js via
// side-effect imports at the top of this file). The ThreeRenderer
// constructor installs per-instance forwards so existing `this.foo()`
// call sites dispatch to `this.ui.foo()`.
//
// Declared at module scope so the constructor for-loop sees it. Changes
// here require matching methods on UIHost.prototype.
const UI_METHODS = [
  // hud.js
  '_updateHUD', '_updateBeamSummary', '_generateCategoryTabs',
  '_renderPalette', '_refreshPalette', 'updatePalette',
  '_bindHUDEvents',
  '_updateSystemStatsVisibility', '_updateSystemStatsContent',
  '_refreshSystemStatsValues',
  '_renderVacuumStats', '_renderRfPowerStats', '_renderCryoStats',
  '_renderCoolingStats', '_renderPowerStats', '_renderDataControlsStats', '_renderOpsStats',
  '_createPaletteItem', '_removeParamFlyout', '_showPalettePreview', '_hidePalettePreview',
  '_sstat', '_ssep', '_detailRow', '_fmtPressure', '_superscript', '_qualityColor', '_marginColor',
  '_renderStaffBar', '_openStaffInspector', '_openHiringDialog', '_refreshStaffWindows',
  // overlays.js
  'showPopup', 'showFacilityPopup', 'hidePopup',
  'drawSchematic',
  '_paramLabel', '_fmtParam', '_wirePopupSliders',
  '_buildTreeLayout', '_renderTechTree', '_bindTreeEvents', '_updateTreeProgress',
  '_showResearchPopover', '_scrollToCategory', '_applyTreeTransform',
  '_renderGoalsOverlay',
  '_openBeamlineWindow', '_openEquipmentWindow',
  '_refreshContextWindows',
];

// Catch drift between UI_METHODS and what hud.js/overlays.js actually
// attach: a stale name here would otherwise surface as a confusing
// runtime error at some distant call site.
for (const name of UI_METHODS) {
  if (typeof Object.getOwnPropertyDescriptor(UIHost.prototype, name)?.value !== 'function') {
    console.warn(`UI_METHODS lists '${name}' but UIHost.prototype has no such method`);
  }
}
