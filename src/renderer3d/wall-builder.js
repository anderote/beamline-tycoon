// src/renderer3d/wall-builder.js
// Renders walls, doors and windows as 3D BoxGeometry slabs on tile edges.
// THREE is a CDN global — do NOT import it.
//
// Doors and windows are both *openings*: an edge that carries one is dropped
// from the main wall loop, and the opening's own pass rebuilds the wall
// around it (below / beside / above).
//
// The two passes rebuild it differently. Doors carry a subtile `off`, so the
// door pass sizes each side fill from doorOpeningLayout and follows the
// terrain per-fill. Windows are always centred on their edge, so they use the
// simpler shared _buildOpeningSurround — which is also the only caller that
// needs the "below" band (bottom = sillHeight; nothing sits below a doorway).

import {
  WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, WALL_PAINTS, WINDOW_WIDTH_FRAC, windowOpeningHeight,
} from '../data/structure.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';
import { contentKey } from './content-hash.js';
import { SOFT_GLOW_LAYER } from './glow-pipeline.js';

// Exported so callers that must size geometry to match what this builder
// emits (e.g. ThreeRenderer.renderWindowPreview's drag ghost) read the same
// numbers instead of restating them — a retune here must not silently drift
// the ghost away from the built result.
export const TILE_SIZE = 2;          // world units per tile (2m real)
const M = TILE_SIZE / 2;     // 1 world unit = 2m, so 1m = 0.5 world units
const DEFAULT_WALL_HEIGHT = 1.5 * M;  // 1.5m — one story
const DEFAULT_WALL_THICKNESS = 0.15 * M; // 15cm
export const HEIGHT_SCALE = DEFAULT_WALL_HEIGHT / 14;   // maps data wallHeight 14 → 1.5m
const THICKNESS_SCALE = DEFAULT_WALL_THICKNESS / 1.5; // maps data thickness 1.5 → 15cm
const MIN_THICKNESS = 0.05 * M;  // 5cm min for fences/cubicles
const DOOR_HEIGHT = 1.2 * M;     // 1.2m door
const POST_WIDTH = 0.1 * M;      // 10cm posts
export const LINTEL_HEIGHT = 0.15 * M;   // 15cm lintel
const PANEL_THICKNESS = 0.04 * M; // 4cm door panel
const PANEL_GAP = 0.02 * M;       // gap between panel and frame
const GHOST_OPACITY = 0.3;
const CUTOUT_ALPHA_TEST = 0.5;

/**
 * Build the material shared by ordinary wall slabs and the pieces rebuilt
 * around an opening. THREE applies alphaTest after multiplying texture alpha
 * by material opacity, so a ghosted cutout cannot keep the solid-mode 0.5
 * threshold: at opacity 0.3 even a fully opaque fence pixel would be dropped.
 */
function createWallMaterial(baseMat, color, ghost, cutout) {
  const opacity = ghost ? GHOST_OPACITY : 1;
  return new THREE.MeshStandardMaterial({
    map: baseMat ? baseMat.map : null,
    color,
    roughness: 0.8,
    transparent: ghost || cutout,
    alphaTest: cutout ? CUTOUT_ALPHA_TEST * opacity : 0,
    opacity,
    depthWrite: cutout ? true : !ghost,
    side: cutout ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// An edge is divided into 4 subtile slots; a door's `off` counts slots from
// the edge's FIRST-listed corner. Mirrors SUBTILES_PER_EDGE in game/edge-keys.js
// (duplicated rather than imported so the renderer stays free of game imports).
export const SUBTILES_PER_EDGE = 4;
export const SUBTILE_SIZE = TILE_SIZE / SUBTILES_PER_EDGE; // 0.5 world units

/**
 * Where a door opening sits along its edge, in world units.
 *
 * `off` is the integer subtile offset of the opening from the edge's
 * first-listed corner, using buildWalls' corner order:
 *   'n' = NW->NE   'e' = NE->SE   's' = SE->SW   'w' = SW->NW
 * So 'n'/'e' run in the +axis direction and 's'/'w' in the -axis direction
 * (axis = X for n/s edges, Z for e/w edges).
 *
 * Returned `center`/`leftCenter`/`rightCenter` are signed offsets from the
 * edge MIDPOINT along that world axis, ready to add to _edgeCenter's x or z.
 *
 * Single doors are 2 slots wide (off 0..2, default 1 — the centred geometry
 * every pre-`off` door was drawn with); doubles fill all 4 (off 0).
 *
 * @param {string} edge  'n'|'e'|'s'|'w'
 * @param {number|null|undefined} off
 * @param {boolean} isDouble
 */
export function doorOpeningLayout(edge, off, isDouble) {
  const openingWidth = isDouble ? TILE_SIZE : TILE_SIZE * 0.5;
  const maxOff = Math.round((TILE_SIZE - openingWidth) / SUBTILE_SIZE);
  const raw = Number.isFinite(off) ? Math.round(off) : (isDouble ? 0 : 1);
  const slot = Math.max(0, Math.min(maxOff, raw));

  const leftWidth = slot * SUBTILE_SIZE;
  const rightWidth = TILE_SIZE - leftWidth - openingWidth;
  const dir = (edge === 'n' || edge === 'e') ? 1 : -1;
  const half = TILE_SIZE / 2;
  // Distance measured from the first-listed corner -> signed offset from mid.
  const at = (d) => dir * (d - half);

  return {
    off: slot,
    openingWidth,
    leftWidth,
    rightWidth,
    dir,
    center: at(leftWidth + openingWidth / 2),
    leftCenter: at(leftWidth / 2),
    rightCenter: at(leftWidth + openingWidth + rightWidth / 2),
  };
}

/** Neighbour tile + mirrored edge name. Mirrors EDGE_DELTAS in game/edge-keys.js. */
const MIRROR_DELTAS = {
  n: { dc: 0, dr: -1, opposite: 's' },
  e: { dc: 1, dr: 0, opposite: 'w' },
  s: { dc: 0, dr: 1, opposite: 'n' },
  w: { dc: -1, dr: 0, opposite: 'e' },
};

/**
 * The other key naming the same physical edge ("5,5,s" -> "5,6,n"), or null
 * for an unknown edge name. Wall and door records are stored under whichever
 * spelling the player's cursor produced, so every edge-keyed lookup in here
 * has to accept both.
 */
function mirrorEdgeKey(col, row, edge) {
  const d = MIRROR_DELTAS[edge];
  if (!d) return null;
  return `${col + d.dc},${row + d.dr},${d.opposite}`;
}

/**
 * Base Y under a point on an edge, given the edge's endpoint heights.
 * `signedOffset` is the distance from the edge MIDPOINT along the varying
 * world axis (the same frame doorOpeningLayout returns), and `dir` is that
 * layout's axis direction: +1 when baseY.a sits at the low world coordinate
 * ('n'/'e'), -1 when it sits at the high one ('s'/'w').
 */
function baseYAtOffset(baseY, dir, signedOffset) {
  const a = baseY?.a || 0;
  const b = baseY?.b || 0;
  if (a === b) return a;
  const half = TILE_SIZE / 2;
  // Distance from the FIRST-listed corner, normalized to [0,1].
  const t = dir === 1 ? (signedOffset + half) / TILE_SIZE : (half - signedOffset) / TILE_SIZE;
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// --- Window frame proportions (world units; M = 1 world unit per 2m) ---
const WINDOW_FRAME_W = 0.06 * M;        // 6cm sill/head/jamb members
const WINDOW_FRAME_W_HEAVY = 0.11 * M;  // shielded types get a chunkier frame
const WINDOW_MULLION_W = 0.03 * M;      // industrialSash grid bars
// How far the frame stands proud of the wall it sits in (a multiplier on the
// wall's thickness) so the frame reads as a frame from either face.
const WINDOW_FRAME_DEPTH_SCALE = 1.25;
const GLASS_THICKNESS = 0.02 * M;
// Warm interior light seen through the pane after dark. Set once at build
// time; ThreeRenderer._updateLightingRamp only ever writes the scalar
// emissiveIntensity (see glassGlowForDarkness in lighting-builder.js).
const GLASS_EMISSIVE = 0xffd9a0;
// Frame texture used when a window def names one that isn't in MATERIALS.
const WINDOW_FRAME_FALLBACK_COLOR = 0xb0b0b0;
// The two shielded types draw a heavier frame (design doc, "Catalogue").
const HEAVY_FRAME_TYPES = new Set(['leadedObservation', 'hutchViewport']);

/**
 * The other name for the same physical tile edge. Every edge has exactly two
 * representations — (col,row,'n') is the same seam as (col,row-1,'s') — and
 * edge state may be stored under either. Mirrors Game._edgeAlias and
 * InputHandler._edgeAlias; keep the three in step. Exported so
 * test/test-window-alias-render.js can assert that agreement against the
 * real implementations rather than local copies of them.
 * @returns {string} the alias's "col,row,edge" key
 */
export function _edgeAliasKey(col, row, edge) {
  if (edge === 'n') return `${col},${row - 1},s`;
  if (edge === 's') return `${col},${row + 1},n`;
  if (edge === 'e') return `${col + 1},${row},w`;
  return `${col - 1},${row},e`;
}

// Stable integer hash of (col, row, edge) — used to pick a random but
// deterministic variant + UV offset per wall segment.
function _hashWallPos(col, row, edge) {
  const e = edge === 'n' ? 0 : edge === 'e' ? 1 : edge === 's' ? 2 : 3;
  let h = (col | 0) * 73856093 ^ (row | 0) * 19349663 ^ e * 83492791;
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

// Shift the U coordinate of every UV by a fractional offset so each wall
// segment using a repeating texture shows a different crop. V is left alone
// since hedge textures have a top-highlight band that should stay anchored.
function _offsetUVsU(geo, du) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, uv.getX(i) + du);
  }
  uv.needsUpdate = true;
}

export class WallBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
    /**
     * Every glass material created by the most recent build, deduped by
     * type+variant+transparency. ThreeRenderer._updateLightingRamp() walks
     * this each frame and writes emissiveIntensity — nothing else. Cleared
     * by _cleanup (the materials themselves are disposed there too, since
     * they are all attached to meshes in this._meshes).
     * @type {THREE.Material[]}
     */
    this._glassMaterials = [];
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) walls, doors and windows from data arrays.
   * @param {Array<{ col: number, row: number, edge: string, type: string }>} wallData
   * @param {Array<{ col: number, row: number, edge: string, type: string }>} doorData
   * @param {Array<{ col: number, row: number, edge: string, type: string, variant?: number }>} windowData
   * @param {THREE.Group} parentGroup
   * @param {'up'|'transparent'|'cutaway'|'down'} wallVisibility
   * @param {Set<string>|null} cutawayRoom  Set of "col,row" strings for cutaway mode
   */
  build(wallData, doorData, windowData, parentGroup, wallVisibility, cutawayRoom = null) {
    if (wallVisibility === 'down') {
      this._cleanup(parentGroup);
      return;
    }

    const cutawayKey = cutawayRoom ? Array.from(cutawayRoom).sort().join(';') : '';
    const newKey = contentKey({ wallData, doorData, windowData, wallVisibility, cutawayKey });
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    const isTransparent = wallVisibility === 'transparent';

    // --- Walls (per-type height, thickness, color) ---
    // Cache materials by wall type to avoid duplicates
    const matCache = {};

    // Build a set of OPENING edge keys (doors and windows alike) so we can
    // skip walls that coincide with one — the opening pass creates its own
    // below/side/above wall segments, and letting the main wall render on top
    // would both block the opening and double-render the segment (causing
    // z-fighting/shimmer in transparent mode).
    //
    // Both spellings of every edge go in. Game.placeDoor resolves the wall
    // under either representation (_resolveDoorSite -> findWallKey) and
    // Game.placeWindow does the same, so a wall at (5,3,'s') can carry an
    // opening recorded at (5,4,'n'). Matching only the exact key would leave
    // that wall in the render list, so a full-height slab would draw straight
    // across the opening — and the surround would be built with no wall def
    // at all (default height and thickness, untextured fallback material)
    // coincident with it. This cannot cause a false skip: the two triples
    // name the same physical edge, so at most one of them holds a wall.
    const openingEdgeSet = new Set();
    for (const d of (doorData || [])) {
      openingEdgeSet.add(`${d.col},${d.row},${d.edge}`);
      const m = mirrorEdgeKey(d.col, d.row, d.edge);
      if (m) openingEdgeSet.add(m);
    }
    for (const w of (windowData || [])) {
      openingEdgeSet.add(`${w.col},${w.row},${w.edge}`);
      openingEdgeSet.add(_edgeAliasKey(w.col, w.row, w.edge));
    }
    const wallsWithoutDoors = (wallData || []).filter(
      w => !openingEdgeSet.has(`${w.col},${w.row},${w.edge}`)
    );

    // When transparent, merge adjacent colinear walls of the same type into
    // single longer boxes to eliminate interior end-cap faces that compound
    // opacity and create dark seams. Merging must not span a door tile.
    const wallsToRender = this._mergeWalls(wallsWithoutDoors, wallVisibility, cutawayRoom);

    for (const w of wallsToRender) {
      const { col, row, edge, type, span } = w;
      const def = WALL_TYPES[type];
      // Defs marked randomizeVariant (e.g. hedges) pick a variant by
      // hashing their grid position so adjacent segments don't all look
      // identical — hash is deterministic so the look is stable across
      // rebuilds.
      let variant = w.variant ?? 0;
      if (def?.randomizeVariant && def?.variantTextures?.length > 1 && w.variant == null) {
        variant = _hashWallPos(col, row, edge) % def.variantTextures.length;
      }
      const height = def ? def.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT;
      const thickness = this._wallThickness(def);
      const color = def ? def.color : 0xcccccc;

      // Determine if this wall should be transparent. _mergeWalls resolved
      // this per source wall and only merged spans that agree, so trust its
      // answer — recomputing from the span's origin tile would paint a whole
      // run by whether its FIRST tile happened to border the room.
      const isCutawayWall = w.cutaway ?? (wallVisibility === 'cutaway' && !!cutawayRoom &&
        this._wallBordersRoom(col, row, edge, cutawayRoom));
      const wallTransparent = isTransparent || isCutawayWall;

      // Materials cache keyed by type+variant+cutaway so walls placed
      // with different variants (e.g. exterior wall cement vs brick)
      // render with their own textures.
      const matKey = `${type}:${variant}${isCutawayWall ? ':cutaway' : ''}`;
      const useAlpha = def?.hasAlpha === true;
      if (!matCache[matKey]) {
        const textureName = def?.variantTextures?.[variant] ?? def?.texture;
        const baseMat = textureName ? MATERIALS[textureName] : null;
        // Alpha-cutout materials (chain-link, barbed wire): the PNG has
        // fully transparent holes, so use alphaTest to discard hole
        // pixels and render wire strands as opaque from both sides. The
        // helper scales that threshold in transparent/cutaway wall views.
        matCache[matKey] = createWallMaterial(
          baseMat,
          baseMat ? 0xffffff : color, // white keeps a texture's authored colour
          wallTransparent,
          useAlpha,
        );
      }

      const isNS = edge === 'n' || edge === 's';
      const length = (span || 1) * TILE_SIZE;
      const geo = isNS
        ? new THREE.BoxGeometry(length, height, thickness)
        : new THREE.BoxGeometry(thickness, height, length);
      // Cutout fence textures contain a complete panel from ground rail to
      // post top. Repeat them along the run, but always show their full height.
      const uvOptions = { fullHeight: def?.hasAlpha === true };
      if (isNS) {
        applyTiledBoxUVs(geo, length, height, thickness, uvOptions);
      } else {
        applyTiledBoxUVs(geo, thickness, height, length, uvOptions);
      }
      // Randomize U offset for segments whose def opts in. This breaks
      // the obvious pattern repeat without cloning the material.
      if (def?.randomizeVariant) {
        const h = _hashWallPos(col, row, edge);
        const du = ((h >>> 8) & 0xff) / 256;
        _offsetUVsU(geo, du);
      }

      // Bake absolute world-Y into the geometry so the wall renders as a
      // parallelogram on slopes (constant height along its length, top edge
      // parallel to the sloped bottom). Mesh is then placed with y=0.
      //
      // Endpoint convention (from buildWalls in world-snapshot.js):
      //   'n': a=NW (low X), b=NE (high X)
      //   's': a=SE (high X), b=SW (low X)
      //   'e': a=NE (low Z), b=SE (high Z)
      //   'w': a=SW (high Z), b=NW (low Z)
      const baseY = w.baseY || { a: 0, b: 0 };
      // yLow = baseY at the vertex end with lower local coord along the wall's
      // long axis; yHigh = baseY at the end with higher local coord.
      let yLow, yHigh;
      if (edge === 'n' || edge === 'e') {
        yLow = baseY.a;
        yHigh = baseY.b;
      } else {
        // 's' and 'w' have reversed a/b relative to axis direction
        yLow = baseY.b;
        yHigh = baseY.a;
      }
      const posAttr = geo.attributes.position;
      const arr = posAttr.array;
      const halfLen = length / 2;
      const EPS = 1e-6;
      for (let vi = 0; vi < posAttr.count; vi++) {
        const ix = vi * 3;
        const vy = arr[ix + 1];
        // Interpolate baseY by the long-axis coord. For isNS the long axis is
        // X; else it's Z. along is in [-halfLen, +halfLen].
        const along = isNS ? arr[ix + 0] : arr[ix + 2];
        const t = halfLen > EPS ? (along + halfLen) / (2 * halfLen) : 0;
        const baseAt = yLow + (yHigh - yLow) * t;
        arr[ix + 1] = vy > 0 ? baseAt + height : baseAt;
      }
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
      // Bounding volumes auto-computed by BoxGeometry are stale after we
      // moved the top and bottom vertices; recompute so frustum culling
      // and raycasts are accurate.
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // BoxGeometry has one material group per face. The stored edge's
      // `inside` paint faces its own tile; `outside` faces the neighbouring
      // tile, letting the two rooms use independent finishes.
      const faceMaterial = (paintId) => {
        if (!paintId || !WALL_PAINTS[paintId]) return matCache[matKey];
        const paintKey = `${matKey}:paint:${paintId}`;
        if (!matCache[paintKey]) {
          const paintTextureName = def?.variantTextures?.[variant] ?? def?.texture;
          const paintBaseMat = paintTextureName ? MATERIALS[paintTextureName] : null;
          matCache[paintKey] = createWallMaterial(
            paintBaseMat,
            WALL_PAINTS[paintId].color,
            wallTransparent,
            useAlpha,
          );
        }
        return matCache[paintKey];
      };
      const insidePaint = w.facePaint?.inside;
      const outsidePaint = w.facePaint?.outside;
      let meshMaterial = matCache[matKey];
      if (insidePaint || outsidePaint) {
        const materials = Array(6).fill(matCache[matKey]);
        const insideFace = edge === 'n' ? 4 : edge === 's' ? 5 : edge === 'e' ? 1 : 0;
        const outsideFace = edge === 'n' ? 5 : edge === 's' ? 4 : edge === 'e' ? 0 : 1;
        materials[insideFace] = faceMaterial(insidePaint);
        materials[outsideFace] = faceMaterial(outsidePaint);
        meshMaterial = materials;
      }
      const mesh = new THREE.Mesh(geo, meshMaterial);
      // Position at the center of the merged span. Y=0 since absolute Y is
      // now baked into geometry vertices.
      const pos = this._wallPosition(col, row, edge, height);
      this._offsetWallPosition(pos, w, thickness);
      pos.y = 0;
      if (span && span > 1) {
        if (isNS) {
          pos.x += (span - 1) * TILE_SIZE / 2;
        } else {
          pos.z += (span - 1) * TILE_SIZE / 2;
        }
      }
      mesh.position.copy(pos);
      mesh.castShadow = !wallTransparent;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }

    // --- Doors ---
    // Build a lookup of wall types by edge key for matching doors to their walls
    // Variant travels with the type so a door's side fills clad themselves
    // like the wall they interrupt (brick door reveals in a brick wall).
    // Registered under both spellings of the edge so a door finds its wall
    // whichever side of the line that wall was drawn from.
    const wallTypeByEdge = {};
    for (const w of (wallData || [])) {
      // A surface layer must never become the structural wall used to size a
      // door/window surround. Copper rides on the wall; it does not replace it.
      if (w.overlay) continue;
      const entry = { type: w.type, variant: w.variant ?? 0, wall: w };
      wallTypeByEdge[`${w.col},${w.row},${w.edge}`] = entry;
      const m = mirrorEdgeKey(w.col, w.row, w.edge);
      if (m && !wallTypeByEdge[m]) wallTypeByEdge[m] = entry;
    }

    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      transparent: isTransparent,
      opacity: isTransparent ? 0.3 : 1.0,
      depthWrite: !isTransparent,
    });
    const doorMatTransparent = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    // One material per (door type, variant, ghost) so every leaf of the same
    // kind shares an instance instead of allocating per door.
    const panelMatCache = {};

    for (const d of (doorData || [])) {
      const { col, row, edge, type } = d;
      const variant = d.variant ?? 0;

      const isDoorCutaway = wallVisibility === 'cutaway' && !!cutawayRoom &&
        this._wallBordersRoom(col, row, edge, cutawayRoom);

      const isNS = edge === 'n' || edge === 's';
      const rawEdgeCenter = this._edgeCenter(col, row, edge);

      // Door type properties
      const doorDef = type ? DOOR_TYPES[type] : null;
      const isDouble = doorDef ? doorDef.doorWidth === 'double' : true;
      // Where the opening sits along the edge. `off` comes from the door
      // record; missing data falls back to the historic centred placement.
      const layout = doorOpeningLayout(edge, d.off, isDouble);
      const doorOpeningWidth = layout.openingWidth;
      // Signed offsets along the edge's varying world axis.
      const openX = isNS ? layout.center : 0;
      const openZ = isNS ? 0 : layout.center;

      // Ground under each part of the door. Walls bake their base Y into the
      // geometry; door parts are boxes placed at a y, so they take theirs
      // from the terrain height at their own point along the edge. Absent
      // baseY (older snapshots) reads as flat ground at 0.
      const baseAt = (signedOffset) => baseYAtOffset(d.baseY, layout.dir, signedOffset);
      const openingBaseY = baseAt(layout.center);

      // Find the wall type on this edge to match height/thickness/color
      const wallEntry = wallTypeByEdge[`${col},${row},${edge}`];
      const wallType = wallEntry?.type;
      const wallVariant = wallEntry?.variant ?? 0;
      // Same key the wall loop uses — cutaway suffix included, so a door's
      // fills share the material of the run they sit in instead of staying
      // opaque and plugging the hole the cutaway just opened.
      const wallMatKey = wallType
        ? `${wallType}:${wallVariant}${isDoorCutaway ? ':cutaway' : ''}`
        : null;
      const wallDef = wallType ? WALL_TYPES[wallType] : null;
      const wallColor = wallDef ? wallDef.color : 0xcccccc;
      const edgeCenter = this._offsetEdgeCenter(rawEdgeCenter, wallEntry?.wall);
      const wallHeight = wallDef
        ? wallDef.wallHeight * HEIGHT_SCALE
        : (doorDef?.wallHeight ? doorDef.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT);
      // The lintel sits on top of the opening, so the opening plus lintel can
      // never exceed the host wall — otherwise the frame pokes through the
      // roofline. Door data is authored to fit its intended wall, but any door
      // can be hung on any wall, so clamp against the wall actually there.
      const nominalDoorHeight = doorDef && doorDef.doorHeight
        ? doorDef.doorHeight * HEIGHT_SCALE
        : DOOR_HEIGHT;
      const doorHeight = Math.max(
        0.1,
        Math.min(nominalDoorHeight, wallHeight - LINTEL_HEIGHT)
      );
      const wallThickness = this._wallThickness(wallDef);

      // Get or create wall material for wall segments around the door.
      // Match the main wall material — tint white if textured so the map shows
      // true colors, and disable depthWrite when transparent for consistent sort.
      const fillTransparent = isTransparent || isDoorCutaway;
      if (wallMatKey && !matCache[wallMatKey]) {
        const textureName = wallDef?.variantTextures?.[wallVariant] ?? wallDef?.texture;
        const baseMat = textureName ? MATERIALS[textureName] : null;
        matCache[wallMatKey] = createWallMaterial(
          baseMat,
          baseMat ? 0xffffff : wallColor,
          fillTransparent,
          wallDef?.hasAlpha === true,
        );
      }

      const postGeo = new THREE.BoxGeometry(POST_WIDTH, doorHeight, POST_WIDTH);

      // Posts flank the opening — at its own centre ± half its width, not the
      // edge centre, so they follow the subtile offset.
      const halfOpening = doorOpeningWidth / 2;

      // Post A
      const activeDoorMat = isDoorCutaway ? doorMatTransparent : doorMat;
      const postA = new THREE.Mesh(postGeo, activeDoorMat);
      postA.position.set(
        edgeCenter.x + openX + (isNS ? -halfOpening : 0),
        baseAt(layout.center - halfOpening) + doorHeight / 2,
        edgeCenter.z + openZ + (isNS ? 0 : -halfOpening)
      );
      postA.castShadow = !(isTransparent || isDoorCutaway);
      postA.matrixAutoUpdate = false;
      postA.updateMatrix();
      parentGroup.add(postA);
      this._meshes.push(postA);

      // Post B
      const postB = new THREE.Mesh(postGeo.clone(), activeDoorMat);
      postB.position.set(
        edgeCenter.x + openX + (isNS ? halfOpening : 0),
        baseAt(layout.center + halfOpening) + doorHeight / 2,
        edgeCenter.z + openZ + (isNS ? 0 : halfOpening)
      );
      postB.castShadow = !(isTransparent || isDoorCutaway);
      postB.matrixAutoUpdate = false;
      postB.updateMatrix();
      parentGroup.add(postB);
      this._meshes.push(postB);

      // Lintel across the opening
      const lintelGeo = isNS
        ? new THREE.BoxGeometry(doorOpeningWidth, LINTEL_HEIGHT, wallThickness)
        : new THREE.BoxGeometry(wallThickness, LINTEL_HEIGHT, doorOpeningWidth);
      const lintel = new THREE.Mesh(lintelGeo, activeDoorMat);
      lintel.position.set(
        edgeCenter.x + openX,
        openingBaseY + doorHeight + LINTEL_HEIGHT / 2,
        edgeCenter.z + openZ
      );
      lintel.castShadow = !(isTransparent || isDoorCutaway);
      lintel.matrixAutoUpdate = false;
      lintel.updateMatrix();
      parentGroup.add(lintel);
      this._meshes.push(lintel);

      // Fill the wall on whichever sides of the opening still have room. With
      // a subtile offset the two sides are no longer symmetric: off=0 and
      // off=max leave a single fill, and doubles leave none at all.
      const SIDE_EPS = 0.001;
      const sideFills = [
        { width: layout.leftWidth, offset: layout.leftCenter },
        { width: layout.rightWidth, offset: layout.rightCenter },
      ].filter(s => s.width > SIDE_EPS);

      for (const side of sideFills) {
        const sideMat = matCache[wallMatKey] || this._defaultFillMat(matCache, wallColor, fillTransparent);
        const sideGeo = isNS
          ? new THREE.BoxGeometry(side.width, wallHeight, wallThickness)
          : new THREE.BoxGeometry(wallThickness, wallHeight, side.width);
        const uvOptions = { fullHeight: wallDef?.hasAlpha === true };
        if (isNS) {
          applyTiledBoxUVs(sideGeo, side.width, wallHeight, wallThickness, uvOptions);
        } else {
          applyTiledBoxUVs(sideGeo, wallThickness, wallHeight, side.width, uvOptions);
        }

        const sideMesh = new THREE.Mesh(sideGeo, sideMat);
        sideMesh.position.set(
          edgeCenter.x + (isNS ? side.offset : 0),
          baseAt(side.offset) + wallHeight / 2,
          edgeCenter.z + (isNS ? 0 : side.offset)
        );
        sideMesh.castShadow = !fillTransparent;
        sideMesh.receiveShadow = true;
        sideMesh.matrixAutoUpdate = false;
        sideMesh.updateMatrix();
        parentGroup.add(sideMesh);
        this._meshes.push(sideMesh);
      }

      // Wall segment above the door (from lintel top to wall top)
      const aboveDoorBottom = doorHeight + LINTEL_HEIGHT;
      const aboveDoorHeight = wallHeight - aboveDoorBottom;
      if (aboveDoorHeight > 0.001) {
        const aboveMat = matCache[wallMatKey] || this._defaultFillMat(matCache, wallColor, fillTransparent);
        // Spans only the opening: the side fills already run the full wall
        // height beside it, so a full-tile band here would double up (and
        // compound opacity in transparent mode). For doubles the opening is
        // the whole tile, so this is the same band as before.
        const aboveGeo = isNS
          ? new THREE.BoxGeometry(doorOpeningWidth, aboveDoorHeight, wallThickness)
          : new THREE.BoxGeometry(wallThickness, aboveDoorHeight, doorOpeningWidth);
        if (isNS) {
          applyTiledBoxUVs(aboveGeo, doorOpeningWidth, aboveDoorHeight, wallThickness);
        } else {
          applyTiledBoxUVs(aboveGeo, wallThickness, aboveDoorHeight, doorOpeningWidth);
        }
        const aboveMesh = new THREE.Mesh(aboveGeo, aboveMat);
        aboveMesh.position.set(
          edgeCenter.x + openX,
          openingBaseY + aboveDoorBottom + aboveDoorHeight / 2,
          edgeCenter.z + openZ
        );
        aboveMesh.castShadow = !fillTransparent;
        aboveMesh.receiveShadow = true;
        aboveMesh.matrixAutoUpdate = false;
        aboveMesh.updateMatrix();
        parentGroup.add(aboveMesh);
        this._meshes.push(aboveMesh);
      }

      // --- Door panel (the visible leaf) ---
      // Textured types get a leaf filling the opening. Types with no texture
      // are open passthroughs (hallwayDoor) and render as a bare frame.
      if (doorDef && doorDef.texture) {
        const ghost = isTransparent || isDoorCutaway;
        const matKey = `${type}:${variant}:${ghost ? 'ghost' : 'solid'}`;
        if (!panelMatCache[matKey]) {
          const baseMat = MATERIALS[doorDef.texture] || null;
          const tint = doorDef.variantTints?.[variant] ?? null;
          const opts = {
            map: baseMat ? baseMat.map : null,
            // Textured panels tint white so the map shows true colors; a
            // variant tint multiplies over it (that's what variantTints are).
            color: tint ?? (baseMat ? 0xffffff : (doorDef.color ?? 0x8b7355)),
            roughness: baseMat ? baseMat.roughness : 0.7,
            metalness: baseMat ? baseMat.metalness : 0.0,
            transparent: ghost,
            opacity: ghost ? 0.3 : 1.0,
            depthWrite: !ghost,
          };
          if (baseMat && baseMat.alphaTest > 0) {
            // Cutout textures (chain link, security gate) keep their holes.
            // alphaTest compares against opacity * map alpha, so the ghost
            // pass has to scale the threshold or the whole leaf is discarded.
            opts.alphaTest = ghost ? baseMat.alphaTest * opts.opacity : baseMat.alphaTest;
            opts.transparent = true;
            opts.side = THREE.DoubleSide;
          }
          panelMatCache[matKey] = new THREE.MeshStandardMaterial(opts);
        }

        const panelW = Math.max(0.01, doorOpeningWidth - PANEL_GAP * 2);
        const panelH = Math.max(0.01, doorHeight - PANEL_GAP);
        // One leaf across the whole opening — the door textures already depict
        // a complete door (both leaves for the doubles), so splitting a double
        // into two meshes would draw the artwork twice.
        const panelGeo = isNS
          ? new THREE.BoxGeometry(panelW, panelH, PANEL_THICKNESS)
          : new THREE.BoxGeometry(PANEL_THICKNESS, panelH, panelW);
        const panel = new THREE.Mesh(panelGeo, panelMatCache[matKey]);
        panel.position.set(
          edgeCenter.x + openX,
          openingBaseY + panelH / 2,
          edgeCenter.z + openZ
        );
        panel.castShadow = !ghost;
        panel.receiveShadow = true;
        panel.matrixAutoUpdate = false;
        panel.updateMatrix();
        parentGroup.add(panel);
        this._meshes.push(panel);
      }
    }

    // --- Windows ---
    this._buildWindows({
      windowData, wallTypeByEdge, matCache, isTransparent,
      wallVisibility, cutawayRoom, parentGroup,
    });

    this._cacheKey = newKey;
  }

  /**
   * Every glass material created by the last build. ThreeRenderer's per-frame
   * darkness ramp writes `emissiveIntensity` on each of these and nothing
   * else. Returns the live array — do not mutate it.
   * @returns {THREE.Material[]}
   */
  glassMaterials() {
    return this._glassMaterials;
  }

  // --- Openings (doors + windows) ---------------------------------------

  /**
   * Get or create the wall material used for the segments an opening
   * rebuilds around itself. Matches the main wall loop — same cache key
   * (`type:variant[:cutaway]`), the variant's own texture, tint white if
   * textured so the map shows true colors, and depthWrite off when
   * transparent for consistent sort. No-op when the edge carries no wall.
   *
   * @returns {string|null} the cache key, or null when there is no wall.
   */
  _ensureOpeningWallMaterial(wallType, wallDef, wallVariant, isCutaway, matCache, isTransparent) {
    if (!wallType) return null;
    // Same key the main wall loop uses, cutaway suffix included, so an
    // opening's fills share the material of the run they sit in instead of
    // staying opaque and plugging the hole the cutaway just opened.
    const key = `${wallType}:${wallVariant}${isCutaway ? ':cutaway' : ''}`;
    if (matCache[key]) return key;
    const ghost = isTransparent || isCutaway;
    const textureName = wallDef?.variantTextures?.[wallVariant] ?? wallDef?.texture;
    const baseMat = textureName ? MATERIALS[textureName] : null;
    const wallColor = wallDef ? wallDef.color : 0xcccccc;
    matCache[key] = createWallMaterial(
      baseMat,
      baseMat ? 0xffffff : wallColor,
      ghost,
      wallDef?.hasAlpha === true,
    );
    return key;
  }

  /**
   * Rebuild the wall around an opening on one edge: the fills BESIDE it
   * (sub-tile widths only), the band ABOVE it, and the band BELOW it. The
   * edge's own wall segment was dropped from the main loop, so this is the
   * only thing putting wall back.
   *
   * Windows only: the opening is centred on the edge, so the two side fills
   * are symmetric. Doors carry a subtile offset and build their own
   * asymmetric fills inline — see the door pass in build().
   *
   * Geometry conventions carried over from the door code this was extracted
   * from: side fills run the FULL wall height (not just the opening's span)
   * and the below/above bands run the FULL tile width, so the two overlap at
   * the corners of a sub-tile opening.
   *
   * @param {object} o
   * @param {number} o.col
   * @param {number} o.row
   * @param {string} o.edge
   * @param {number} o.openingWidth  world units across the edge
   * @param {number} o.openingBottom world-Y of the opening's underside
   * @param {number} o.openingTop    world-Y of the opening's head
   * @param {number} [o.base]        world-Y of the ground under this edge
   * @param {string|null} o.matKey   material cache key from
   *   _ensureOpeningWallMaterial, or null when the edge carries no wall
   * @param {object|null} o.wallDef
   * @param {Record<string, THREE.Material>} o.matCache
   * @param {boolean} o.isTransparent
   * @param {THREE.Group} o.parentGroup
   */
  _buildOpeningSurround({
    col, row, edge, openingWidth, openingBottom, openingTop, base = 0,
    matKey, wallDef, wallRecord, matCache, isTransparent, parentGroup,
  }) {
    const isNS = edge === 'n' || edge === 's';
    const edgeCenter = this._offsetEdgeCenter(this._edgeCenter(col, row, edge), wallRecord);
    const halfTile = TILE_SIZE / 2;
    const wallHeight = wallDef ? wallDef.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT;
    const wallThickness = this._wallThickness(wallDef);
    const wallColor = wallDef ? wallDef.color : 0xcccccc;

    // Resolved lazily so an opening that emits no fill never allocates the
    // untextured fallback material (which nothing would ever dispose).
    const fillMaterial = () =>
      matCache[matKey] || this._defaultFillMat(matCache, wallColor, isTransparent);

    // One full-tile-width horizontal band spanning [y0, y0 + h].
    const addBand = (y0, h) => {
      if (!(h > 0.001)) return;
      const geo = isNS
        ? new THREE.BoxGeometry(TILE_SIZE, h, wallThickness)
        : new THREE.BoxGeometry(wallThickness, h, TILE_SIZE);
      if (isNS) {
        applyTiledBoxUVs(geo, TILE_SIZE, h, wallThickness);
      } else {
        applyTiledBoxUVs(geo, wallThickness, h, TILE_SIZE);
      }
      const mesh = new THREE.Mesh(geo, fillMaterial());
      mesh.position.set(edgeCenter.x, base + y0 + h / 2, edgeCenter.z);
      mesh.castShadow = !isTransparent;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    };

    // 1. Fill beside the opening (sub-tile widths only). A full-tile opening
    //    gives sideWidth 0 and emits nothing — the old `if (!isDouble)` guard
    //    is subsumed by the width test.
    const sideWidth = (TILE_SIZE - openingWidth) / 2;
    if (sideWidth > 0.001) {
      const sideMat = fillMaterial();
      const sideGeo = isNS
        ? new THREE.BoxGeometry(sideWidth, wallHeight, wallThickness)
        : new THREE.BoxGeometry(wallThickness, wallHeight, sideWidth);
      if (isNS) {
        applyTiledBoxUVs(sideGeo, sideWidth, wallHeight, wallThickness);
      } else {
        applyTiledBoxUVs(sideGeo, wallThickness, wallHeight, sideWidth);
      }
      for (const [i, sign] of [[0, -1], [1, 1]]) {
        const side = new THREE.Mesh(i === 0 ? sideGeo : sideGeo.clone(), sideMat);
        const off = sign * (halfTile - sideWidth / 2);
        side.position.set(
          edgeCenter.x + (isNS ? off : 0),
          base + wallHeight / 2,
          edgeCenter.z + (isNS ? 0 : off)
        );
        side.castShadow = !isTransparent;
        side.receiveShadow = true;
        side.matrixAutoUpdate = false;
        side.updateMatrix();
        parentGroup.add(side);
        this._meshes.push(side);
      }
    }

    // 2. Fill above the opening (head to wall top).
    addBand(openingTop, wallHeight - openingTop);

    // 3. Fill below the opening (floor to sill). Zero-height for doors.
    addBand(0, openingBottom);
  }

  /**
   * Window pass — frame, glass and surround for every placed window.
   * A window is a hole in a wall: it never appears in doorOccupied and
   * nothing here answers "can something pass through this edge".
   */
  _buildWindows({
    windowData, wallTypeByEdge, matCache, isTransparent,
    wallVisibility, cutawayRoom, parentGroup,
  }) {
    if (!windowData || windowData.length === 0) return;

    // Frame + glass materials are deduped for the whole build; a facade of
    // twenty identical windows costs two materials, not forty.
    const frameMatCache = {};
    const glassMatCache = {};

    for (const wnd of windowData) {
      const { col, row, edge, type } = wnd;
      const def = type ? WINDOW_TYPES[type] : null;
      if (!def) continue;

      const isWindowCutaway = wallVisibility === 'cutaway' && cutawayRoom &&
        this._wallBordersRoom(col, row, edge, cutawayRoom);
      const ghosted = isTransparent || isWindowCutaway;

      const isNS = edge === 'n' || edge === 's';
      const rawEdgeCenter = this._edgeCenter(col, row, edge);

      // Alias fallback, for the same reason window edges contribute both
      // representations to openingEdgeSet: the wall this window is a hole in
      // may be stored under the OTHER name for this edge. Without the
      // fallback the surround would silently fall back to DEFAULT_WALL_HEIGHT
      // / DEFAULT_WALL_THICKNESS in the untextured grey material.
      const wallEntry = wallTypeByEdge[`${col},${row},${edge}`]
        ?? wallTypeByEdge[_edgeAliasKey(col, row, edge)];
      const wallType = wallEntry?.type;
      const wallVariant = wallEntry?.variant ?? 0;
      const wallDef = wallType ? WALL_TYPES[wallType] : null;
      const edgeCenter = this._offsetEdgeCenter(rawEdgeCenter, wallEntry?.wall);
      const wallHeight = wallDef ? wallDef.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT;
      const wallThickness = this._wallThickness(wallDef);
      const matKey = this._ensureOpeningWallMaterial(
        wallType, wallDef, wallVariant, isWindowCutaway, matCache, isTransparent
      );
      // Ground under the edge. Walls bake their base Y into the geometry;
      // window parts are boxes placed at a y, so they take theirs from the
      // terrain. The opening is centred, so the edge midpoint is the right
      // sample. Absent baseY (older snapshots) reads as flat ground at 0.
      const base = ((wnd.baseY?.a || 0) + (wnd.baseY?.b || 0)) / 2;

      // Opening box. Game.placeWindow enforces the fit rule
      // (wallHeight >= sill + opening + 1), but clamp anyway so a window
      // left behind by a wall swap degrades instead of poking out the top.
      const openingBottom = def.sillHeight * HEIGHT_SCALE;
      const wallHeightData = wallDef?.wallHeight ?? 14;
      const resolvedOpeningHeight = windowOpeningHeight(def, wallHeightData);
      const openingTop = Math.min(
        (def.sillHeight + resolvedOpeningHeight) * HEIGHT_SCALE,
        wallHeight
      );
      const openingHeight = openingTop - openingBottom;
      if (!(openingHeight > 0.001)) {
        // The sill sits at or above the top of the wall, so there is no
        // opening left to draw. The edge is already in openingEdgeSet under
        // both representations, so the main wall loop dropped this segment —
        // bailing out here would leave a hole with no wall AND no window.
        // Put a plain full-height, full-width band back instead: passing a
        // zero-height opening the width of the tile makes the surround emit
        // exactly one band from the floor to the wall top and no side fill.
        // Not reachable with today's catalogue (min wallHeight 8 vs max
        // sillHeight 7) but one short wall type away.
        this._buildOpeningSurround({
          col, row, edge,
          openingWidth: TILE_SIZE,
          openingBottom: 0,
          openingTop: 0,
          base, matKey, wallDef, wallRecord: wallEntry?.wall,
          matCache, isTransparent, parentGroup,
        });
        continue;
      }
      const openingWidth = TILE_SIZE * (WINDOW_WIDTH_FRAC[def.windowWidth] ?? 0.5);

      // Surround first, so the wall is behind the frame in the mesh list.
      this._buildOpeningSurround({
        col, row, edge, openingWidth, openingBottom, openingTop,
        base, matKey, wallDef, wallRecord: wallEntry?.wall,
        matCache, isTransparent, parentGroup,
      });

      // --- Frame ---
      const frameW = Math.min(
        HEAVY_FRAME_TYPES.has(def.id) ? WINDOW_FRAME_W_HEAVY : WINDOW_FRAME_W,
        openingHeight / 2.5,
        openingWidth / 2.5
      );
      const frameDepth = Math.max(wallThickness * WINDOW_FRAME_DEPTH_SCALE, frameW);
      const frameMat = this._windowFrameMaterial(def, frameMatCache, ghosted);

      // Local axes: `u` runs along the wall edge, `y` is up, `d` is the
      // wall's normal (thickness). addBar takes half-extents in (u, y).
      const addBar = (uCenter, yCenter, uLen, yLen, depth) => {
        if (!(uLen > 1e-4) || !(yLen > 1e-4)) return;
        const geo = isNS
          ? new THREE.BoxGeometry(uLen, yLen, depth)
          : new THREE.BoxGeometry(depth, yLen, uLen);
        const mesh = new THREE.Mesh(geo, frameMat);
        mesh.position.set(
          edgeCenter.x + (isNS ? uCenter : 0),
          base + yCenter,
          edgeCenter.z + (isNS ? 0 : uCenter)
        );
        mesh.castShadow = !ghosted;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parentGroup.add(mesh);
        this._meshes.push(mesh);
      };

      const halfOpening = openingWidth / 2;
      // Sill and head run the full opening width; jambs fill the gap between
      // them so the four members read as one closed frame.
      addBar(0, openingBottom + frameW / 2, openingWidth, frameW, frameDepth);
      addBar(0, openingTop - frameW / 2, openingWidth, frameW, frameDepth);
      const jambH = openingHeight - 2 * frameW;
      const jambY = openingBottom + openingHeight / 2;
      for (const sign of [-1, 1]) {
        addBar(sign * (halfOpening - frameW / 2), jambY, frameW, jambH, frameDepth);
      }

      // industrialSash: a 3x3 grid of tall factory panes — two vertical
      // mullions and two horizontal transoms.
      if (def.id === 'industrialSash') {
        const mullionDepth = Math.max(frameDepth * 0.7, GLASS_THICKNESS * 2);
        for (const k of [-1, 1]) {
          addBar(k * openingWidth / 6, jambY, WINDOW_MULLION_W, jambH, mullionDepth);
          addBar(0, jambY + k * openingHeight / 6,
            openingWidth - 2 * frameW, WINDOW_MULLION_W, mullionDepth);
        }
      }

      // --- Glass ---
      const glassMat = this._windowGlassMaterial(def, wnd.variant | 0, glassMatCache, ghosted);
      const glassW = Math.max(openingWidth - 2 * frameW, 0.01);
      const glassH = Math.max(openingHeight - 2 * frameW, 0.01);
      const glassGeo = isNS
        ? new THREE.BoxGeometry(glassW, glassH, GLASS_THICKNESS)
        : new THREE.BoxGeometry(GLASS_THICKNESS, glassH, glassW);
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.layers?.enable(SOFT_GLOW_LAYER);
      glass.userData ||= {};
      glass.userData.glowProfile = 'soft';
      glass.position.set(edgeCenter.x, base + jambY, edgeCenter.z);
      glass.castShadow = false;
      glass.receiveShadow = false;
      glass.renderOrder = 2;
      glass.matrixAutoUpdate = false;
      glass.updateMatrix();
      parentGroup.add(glass);
      this._meshes.push(glass);
    }
  }

  /** Frame material for a window def, deduped per texture + ghosted state. */
  _windowFrameMaterial(def, cache, ghosted) {
    const key = `${def.frameTexture || '__none'}:${ghosted ? 'g' : 'o'}`;
    if (cache[key]) return cache[key];
    const baseMat = def.frameTexture ? MATERIALS[def.frameTexture] : null;
    cache[key] = new THREE.MeshStandardMaterial({
      map: baseMat ? baseMat.map : null,
      color: baseMat ? 0xffffff : WINDOW_FRAME_FALLBACK_COLOR,
      roughness: 0.7,
      metalness: 0.15,
      transparent: ghosted,
      opacity: ghosted ? 0.3 : 1.0,
      depthWrite: !ghosted,
    });
    return cache[key];
  }

  /**
   * Glass material for a window def + variant. Registered on
   * `this._glassMaterials` so ThreeRenderer's darkness ramp can raise
   * `emissiveIntensity` at night; the warm emissive colour itself is set
   * once, here.
   */
  _windowGlassMaterial(def, variant, cache, ghosted) {
    const key = `${def.id}:${variant}:${ghosted ? 'g' : 'o'}`;
    if (cache[key]) return cache[key];
    const color = def.variantGlassColors?.[variant] ?? def.glassColor ?? 0xcfe8f5;
    const baseOpacity = def.variantGlassOpacities?.[variant] ?? def.glassOpacity ?? 0.2;
    // Ghosted modes want to see THROUGH the building; never let a frosted
    // pane read as more solid than the walls around it.
    const opacity = ghosted ? Math.min(baseOpacity, 0.3) : baseOpacity;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: GLASS_EMISSIVE,
      emissiveIntensity: 0, // ramped per frame from darkness; 0 = broad daylight
    });
    cache[key] = mat;
    this._glassMaterials.push(mat);
    return mat;
  }
  /**
   * Remove all meshes from group and dispose resources.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    this._cleanup(parentGroup);
    this._cacheKey = null;
  }

  // --- Private helpers ---

  /**
   * Untextured fallback material for a door's wall fills, used when the door
   * hangs on no known wall type. Cached per (color, ghost) inside the build's
   * material cache so the ghosted and solid variants can coexist.
   */
  _defaultFillMat(matCache, color, ghost) {
    const key = `__default:${color}:${ghost ? 'ghost' : 'solid'}`;
    if (!matCache[key]) {
      matCache[key] = new THREE.MeshStandardMaterial({
        color, roughness: 0.8,
        transparent: ghost, opacity: ghost ? 0.3 : 1.0,
        depthWrite: !ghost,
      });
    }
    return matCache[key];
  }

  _wallGeometry(edge, height = DEFAULT_WALL_HEIGHT, thickness = DEFAULT_WALL_THICKNESS) {
    const isNS = edge === 'n' || edge === 's';
    return isNS
      ? new THREE.BoxGeometry(TILE_SIZE, height, thickness)
      : new THREE.BoxGeometry(thickness, height, TILE_SIZE);
  }

  /**
   * Returns the world-space center position of a wall on the given edge.
   * Tile occupies X: [col*2, col*2+2], Z: [row*2, row*2+2]
   * @param {number} col
   * @param {number} row
   * @param {string} edge  'n'|'s'|'e'|'w'
   * @returns {THREE.Vector3}
   */
  _wallPosition(col, row, edge, height = DEFAULT_WALL_HEIGHT) {
    const cx = col * TILE_SIZE + TILE_SIZE / 2; // tile X center
    const cz = row * TILE_SIZE + TILE_SIZE / 2; // tile Z center

    switch (edge) {
      case 'n': return new THREE.Vector3(cx,                          height / 2, row * TILE_SIZE);
      case 's': return new THREE.Vector3(cx,                          height / 2, row * TILE_SIZE + TILE_SIZE);
      case 'e': return new THREE.Vector3(col * TILE_SIZE + TILE_SIZE, height / 2, cz);
      case 'w': return new THREE.Vector3(col * TILE_SIZE,             height / 2, cz);
      default:  return new THREE.Vector3(cx, height / 2, cz);
    }
  }

  _wallThickness(def) {
    if (def?.insetSubtiles) return SUBTILE_SIZE * def.insetSubtiles;
    return def
      ? Math.max(def.thickness * THICKNESS_SCALE, MIN_THICKNESS)
      : DEFAULT_WALL_THICKNESS;
  }

  _inward(edge) {
    if (edge === 'n') return { x: 0, z: 1 };
    if (edge === 's') return { x: 0, z: -1 };
    if (edge === 'e') return { x: -1, z: 0 };
    return { x: 1, z: 0 };
  }

  _offsetEdgeCenter(center, wall) {
    if (!wall || !WALL_TYPES[wall.type]?.insetSubtiles) return { ...center };
    const inward = this._inward(wall.edge);
    const amount = this._wallThickness(WALL_TYPES[wall.type]) / 2;
    return { x: center.x + inward.x * amount, z: center.z + inward.z * amount };
  }

  _offsetWallPosition(position, wall, thickness) {
    if (wall.overlay && wall.host) {
      const inward = this._inward(wall.edge);
      const edge = this._edgeCenter(wall.col, wall.row, wall.edge);
      const hostDef = WALL_TYPES[wall.host.type];
      const hostThickness = this._wallThickness(hostDef);
      const hostEdge = this._edgeCenter(wall.host.col, wall.host.row, wall.host.edge);
      const hostInward = this._inward(wall.host.edge);
      const hostInset = hostDef?.insetSubtiles ? hostThickness / 2 : 0;
      const hostX = hostEdge.x + hostInward.x * hostInset;
      const hostZ = hostEdge.z + hostInward.z * hostInset;
      const projectedHostCenter = (hostX - edge.x) * inward.x + (hostZ - edge.z) * inward.z;
      const amount = projectedHostCenter + hostThickness / 2 + thickness / 2;
      position.x += inward.x * amount;
      position.z += inward.z * amount;
      return;
    }
    const def = WALL_TYPES[wall.type];
    if (!def?.insetSubtiles) return;
    const inward = this._inward(wall.edge);
    position.x += inward.x * thickness / 2;
    position.z += inward.z * thickness / 2;
  }

  /**
   * Returns world-space center of a tile edge (at Y=0).
   */
  _edgeCenter(col, row, edge) {
    const cx = col * TILE_SIZE + TILE_SIZE / 2;
    const cz = row * TILE_SIZE + TILE_SIZE / 2;

    switch (edge) {
      case 'n': return { x: cx, z: row * TILE_SIZE };
      case 's': return { x: cx, z: row * TILE_SIZE + TILE_SIZE };
      case 'e': return { x: col * TILE_SIZE + TILE_SIZE, z: cz };
      case 'w': return { x: col * TILE_SIZE, z: cz };
      default:  return { x: cx, z: cz };
    }
  }

  _wallBordersRoom(col, row, edge, room) {
    // A wall borders a room if either of the tiles it separates is in the room
    if (edge === 'e' || edge === 'w') {
      const neighbor = edge === 'e' ? `${col + 1},${row}` : `${col - 1},${row}`;
      return room.has(`${col},${row}`) || room.has(neighbor);
    }
    // n or s
    const neighbor = edge === 's' ? `${col},${row + 1}` : `${col},${row - 1}`;
    return room.has(`${col},${row}`) || room.has(neighbor);
  }

  /**
   * Merge adjacent colinear walls of the same type into longer spans.
   * When transparent, this eliminates interior end-cap faces that compound
   * opacity. In opaque mode, walls are returned as-is (single-tile spans).
   *
   * Merge constraint (terrain slope): two colinear walls only merge when
   * the shared endpoint's Y is identical on both sides. Each wall's baseY
   * reads from its OWN tile's corners, so neighboring walls sharing a
   * world-space corner may disagree if the two tiles have different corner
   * heights. In that case we break the merge there — the segments render
   * as independent trapezoids.
   *
   * Endpoint convention (matches world-snapshot.buildWalls):
   *   'n': a=NW (low col end),  b=NE (high col end)
   *   's': a=SE (high col end), b=SW (low col end)
   *   'e': a=NE (low row end),  b=SE (high row end)
   *   'w': a=SW (high row end), b=NW (low row end)
   * After ascending sort by the varying axis, the "high-axis end" of the
   * earlier wall meets the "low-axis end" of the later wall.
   */
  _mergeWalls(wallData, wallVisibility, cutawayRoom) {
    const isTransparent = wallVisibility === 'transparent';
    const hasCutaway = wallVisibility === 'cutaway' && cutawayRoom;
    if (!isTransparent && !hasCutaway) {
      return wallData.map(w => ({ ...w, span: 1 }));
    }

    // Group walls by (edge, type, variant, face paint, cutaway, and the axis-perpendicular
    // coordinate). Variant must be part of the key so walls of the same
    // type but different claddings (e.g. cement vs brick exterior) stay
    // separate — otherwise a merged span would pick a single texture for
    // the whole run. Cutaway state likewise: a run that only partly borders
    // the opened room would otherwise be ghosted (or left solid) end to end
    // depending on which tile happened to sort first.
    const groups = {};
    for (const wall of wallData) {
      const isNS = wall.edge === 'n' || wall.edge === 's';
      const variant = wall.variant ?? 0;
      const cutaway = !!hasCutaway &&
        this._wallBordersRoom(wall.col, wall.row, wall.edge, cutawayRoom);
      const layerKey = wall.overlay
        ? `overlay:${wall.host?.col},${wall.host?.row},${wall.host?.edge}`
        : 'structural';
      const paintKey = `${wall.facePaint?.inside || ''}:${wall.facePaint?.outside || ''}`;
      const groupKey = `${wall.edge},${wall.type},${variant},${paintKey},${cutaway ? 1 : 0},${layerKey},${isNS ? wall.row : wall.col}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({ ...wall, cutaway });
    }

    const result = [];
    for (const key of Object.keys(groups)) {
      const walls = groups[key];
      const isNS = walls[0].edge === 'n' || walls[0].edge === 's';
      // Sort by the varying axis
      walls.sort((a, b) => isNS ? a.col - b.col : a.row - b.row);

      let spanStart = 0;
      for (let i = 1; i <= walls.length; i++) {
        const prev = walls[i - 1];
        const cur = walls[i];
        const consecutive = cur && (isNS
          ? cur.col === prev.col + 1
          : cur.row === prev.row + 1);
        // Shared-endpoint Y must match. For 'n' and 'e' edges, prev's b
        // (high-axis end) meets cur's a (low-axis end). For 's' and 'w'
        // edges, prev's a (high-axis end) meets cur's b (low-axis end).
        // The SLOPE must match too: build() lerps the merged span's base Y
        // linearly from first.a to last.b, so a run whose per-tile slope
        // varies (flat, one step up, flat — which the terrain invariant
        // permits) bakes interior base vertices that float above or bury
        // themselves in the ground. Error grows with run length: 6 flat + 6
        // rising tiles merge into one span with a full wall-height gap at the
        // slope break.
        let heightsMatch = false;
        if (consecutive) {
          const prevBY = prev.baseY || { a: 0, b: 0 };
          const curBY = cur.baseY || { a: 0, b: 0 };
          const edge = prev.edge;
          if (edge === 'n' || edge === 'e') {
            heightsMatch = prevBY.b === curBY.a
              && (prevBY.b - prevBY.a) === (curBY.b - curBY.a);
          } else {
            // 's' or 'w' — a/b are listed in descending-axis order, so the
            // rise along the ascending axis is a - b.
            heightsMatch = prevBY.a === curBY.b
              && (prevBY.a - prevBY.b) === (curBY.a - curBY.b);
          }
        }
        if (!consecutive || !heightsMatch) {
          // Emit merged span from spanStart to i-1. When merging N > 1
          // walls, the merged segment's endpoints read from the outermost
          // walls: the low-axis end from walls[spanStart], the high-axis
          // end from walls[i-1]. Synthesize a merged baseY accordingly.
          const origin = walls[spanStart];
          const last = walls[i - 1];
          const mergedBaseY = this._mergeBaseY(origin, last);
          result.push({ ...origin, span: i - spanStart, baseY: mergedBaseY });
          spanStart = i;
        }
      }
    }
    return result;
  }

  /**
   * Compute the merged span's baseY by combining the outermost walls'
   * endpoint Y values. The merged wall's a/b keep the same edge convention
   * as a single wall (a = first-listed corner, b = second-listed).
   * Endpoint convention:
   *   'n': a=NW (low col),  b=NE (high col)   — span a=first.a, b=last.b
   *   'e': a=NE (low row),  b=SE (high row)   — span a=first.a, b=last.b
   *   's': a=SE (high col), b=SW (low col)    — span a=last.a,  b=first.b
   *   'w': a=SW (high row), b=NW (low row)    — span a=last.a,  b=first.b
   */
  _mergeBaseY(first, last) {
    const f = first.baseY || { a: 0, b: 0 };
    const l = last.baseY || { a: 0, b: 0 };
    if (first === last) return { a: f.a, b: f.b };
    const edge = first.edge;
    if (edge === 'n' || edge === 'e') {
      return { a: f.a, b: l.b };
    }
    // 's' or 'w'
    return { a: l.a, b: f.b };
  }

  _cleanup(parentGroup) {
    const mats = new Set();
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      // Painted walls use BoxGeometry's six-material array so each room-facing
      // side can have its own finish. Ordinary walls and opening pieces still
      // carry one shared material. Flatten both shapes into the same identity
      // set: treating the painted array itself as a Material throws after the
      // scene has already detached every wall, leaving the facility wall-less.
      const meshMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of meshMats) if (mat) mats.add(mat);
    }
    // Walls, doors, and opening fills share materials within one build, so
    // dispose each unique instance exactly once.
    for (const mat of mats) mat.dispose();

    this._meshes = [];
    // Every glass material was attached to a mesh above, so it has already
    // been disposed — just drop the registry so the darkness ramp stops
    // walking dead materials.
    this._glassMaterials = [];
  }
}
