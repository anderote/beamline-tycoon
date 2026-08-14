// src/renderer3d/wall-builder.js
// Renders walls, doors and windows as 3D BoxGeometry slabs on tile edges.
// THREE is a CDN global — do NOT import it.
//
// Doors and windows are both *openings*: an edge that carries one is dropped
// from the main wall loop, and the opening's own pass rebuilds the wall
// around it (below / beside / above) via the shared _buildOpeningSurround.
// Doors call it with bottom 0 (nothing below a doorway); windows call it with
// bottom = sillHeight, which is the only reason the "below" band exists.

import { WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, WINDOW_WIDTH_FRAC } from '../data/structure.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';
import { contentKey } from './content-hash.js';

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
const LINTEL_HEIGHT = 0.15 * M;   // 15cm lintel

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
    // skip walls that coincide with one — the opening builder creates its own
    // below/side/above wall segments, and letting the main wall render on top
    // would both block the opening and double-render the segment (causing
    // z-fighting/shimmer in transparent mode).
    //
    // Doors are matched on the EXACT triple only, and that is safe:
    // Game.placeDoor/placeDoorPath gate on `state.wallOccupied[key]` with the
    // same exact key, so a door can only ever exist on an edge whose wall is
    // stored under the identical triple.
    //
    // Windows are NOT: Game.placeWindow accepts a wall found under either
    // representation (`wallOccupied[key] || wallOccupied[aliasKey]`) and then
    // stores the window under whichever triple the caller passed. A wall at
    // (5,3,'s') can therefore carry a window recorded at (5,4,'n'). Matching
    // only the exact key would leave that wall in the render list, so the
    // full-height slab would draw straight across the glass — and the
    // surround would be built with no wall def at all (default height and
    // thickness, untextured fallback material) coincident with it. So window
    // edges contribute BOTH representations. This cannot cause a false skip:
    // the two triples name the same physical edge, so at most one of them
    // holds a wall.
    const openingEdgeSet = new Set();
    for (const d of (doorData || [])) {
      openingEdgeSet.add(`${d.col},${d.row},${d.edge}`);
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
      const thickness = def
        ? Math.max(def.thickness * THICKNESS_SCALE, MIN_THICKNESS)
        : DEFAULT_WALL_THICKNESS;
      const color = def ? def.color : 0xcccccc;

      // Determine if this wall should be transparent
      const isCutawayWall = wallVisibility === 'cutaway' && cutawayRoom &&
        this._wallBordersRoom(col, row, edge, cutawayRoom);
      const wallTransparent = isTransparent || isCutawayWall;

      // Materials cache keyed by type+variant+cutaway so walls placed
      // with different variants (e.g. exterior wall cement vs brick)
      // render with their own textures.
      const matKey = `${type}:${variant}${isCutawayWall ? ':cutaway' : ''}`;
      if (!matCache[matKey]) {
        const textureName = def?.variantTextures?.[variant] ?? def?.texture;
        const baseMat = textureName ? MATERIALS[textureName] : null;
        // Alpha-cutout materials (chain-link, barbed wire): the PNG has
        // fully transparent holes, so use alphaTest to discard hole
        // pixels and render wire strands as opaque from both sides.
        const useAlpha = def?.hasAlpha === true;
        matCache[matKey] = new THREE.MeshStandardMaterial({
          map: baseMat ? baseMat.map : null,
          color: baseMat ? 0xffffff : color, // tint white if textured so map shows true colors
          roughness: 0.8,
          transparent: wallTransparent || useAlpha,
          alphaTest: useAlpha ? 0.5 : 0,
          opacity: wallTransparent ? 0.3 : 1.0,
          depthWrite: useAlpha ? true : !wallTransparent,
          side: useAlpha ? THREE.DoubleSide : THREE.FrontSide,
        });
      }

      const isNS = edge === 'n' || edge === 's';
      const length = (span || 1) * TILE_SIZE;
      const geo = isNS
        ? new THREE.BoxGeometry(length, height, thickness)
        : new THREE.BoxGeometry(thickness, height, length);
      if (isNS) {
        applyTiledBoxUVs(geo, length, height, thickness);
      } else {
        applyTiledBoxUVs(geo, thickness, height, length);
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

      const mesh = new THREE.Mesh(geo, matCache[matKey]);
      // Position at the center of the merged span. Y=0 since absolute Y is
      // now baked into geometry vertices.
      const pos = this._wallPosition(col, row, edge, height);
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
    const wallTypeByEdge = {};
    for (const w of (wallData || [])) {
      wallTypeByEdge[`${w.col},${w.row},${w.edge}`] = w.type;
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

    for (const d of (doorData || [])) {
      const { col, row, edge, type } = d;

      const isDoorCutaway = wallVisibility === 'cutaway' && cutawayRoom &&
        this._wallBordersRoom(col, row, edge, cutawayRoom);

      const isNS = edge === 'n' || edge === 's';
      const edgeCenter = this._edgeCenter(col, row, edge);

      // Door type properties
      const doorDef = type ? DOOR_TYPES[type] : null;
      const doorHeight = doorDef && doorDef.doorHeight
        ? doorDef.doorHeight * HEIGHT_SCALE
        : DOOR_HEIGHT;
      const isDouble = doorDef ? doorDef.doorWidth === 'double' : true;
      const doorOpeningWidth = isDouble ? TILE_SIZE : TILE_SIZE * 0.5;

      // Find the wall type on this edge to match height/thickness/color
      const wallType = wallTypeByEdge[`${col},${row},${edge}`];
      const wallDef = wallType ? WALL_TYPES[wallType] : null;
      const wallThickness = wallDef
        ? Math.max(wallDef.thickness * THICKNESS_SCALE, MIN_THICKNESS)
        : DEFAULT_WALL_THICKNESS;

      // Get or create wall material for wall segments around the door.
      this._ensureOpeningWallMaterial(wallType, wallDef, matCache, isTransparent);

      const postGeo = new THREE.BoxGeometry(POST_WIDTH, doorHeight, POST_WIDTH);

      // For single doors, opening is centered — posts at ±doorOpeningWidth/2
      const halfOpening = doorOpeningWidth / 2;

      // Post A
      const activeDoorMat = isDoorCutaway ? doorMatTransparent : doorMat;
      const postA = new THREE.Mesh(postGeo, activeDoorMat);
      postA.position.set(
        edgeCenter.x + (isNS ? -halfOpening : 0),
        doorHeight / 2,
        edgeCenter.z + (isNS ? 0 : -halfOpening)
      );
      postA.castShadow = !(isTransparent || isDoorCutaway);
      postA.matrixAutoUpdate = false;
      postA.updateMatrix();
      parentGroup.add(postA);
      this._meshes.push(postA);

      // Post B
      const postB = new THREE.Mesh(postGeo.clone(), activeDoorMat);
      postB.position.set(
        edgeCenter.x + (isNS ? halfOpening : 0),
        doorHeight / 2,
        edgeCenter.z + (isNS ? 0 : halfOpening)
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
        edgeCenter.x,
        doorHeight + LINTEL_HEIGHT / 2,
        edgeCenter.z
      );
      lintel.castShadow = !(isTransparent || isDoorCutaway);
      lintel.matrixAutoUpdate = false;
      lintel.updateMatrix();
      parentGroup.add(lintel);
      this._meshes.push(lintel);

      // Wall fill around the opening. A doorway starts at the floor, so the
      // "below" band is always zero-height here and emits nothing; the side
      // fills (sub-tile widths only) and the band above the lintel are
      // exactly what this pass used to inline.
      this._buildOpeningSurround({
        col, row, edge,
        openingWidth: doorOpeningWidth,
        openingBottom: 0,
        openingTop: doorHeight + LINTEL_HEIGHT,
        wallType, wallDef, matCache, isTransparent, parentGroup,
      });
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
   * rebuilds around itself. Matches the main wall loop — tint white if
   * textured so the map shows true colors, and disable depthWrite when
   * transparent for consistent sort. No-op when the edge carries no wall.
   */
  _ensureOpeningWallMaterial(wallType, wallDef, matCache, isTransparent) {
    if (!wallType || matCache[wallType]) return;
    const baseMat = wallDef && wallDef.texture ? MATERIALS[wallDef.texture] : null;
    const wallColor = wallDef ? wallDef.color : 0xcccccc;
    matCache[wallType] = new THREE.MeshStandardMaterial({
      map: baseMat ? baseMat.map : null,
      color: baseMat ? 0xffffff : wallColor,
      roughness: 0.8,
      transparent: isTransparent,
      opacity: isTransparent ? 0.3 : 1.0,
      depthWrite: !isTransparent,
    });
  }

  /**
   * Rebuild the wall around an opening on one edge: the fills BESIDE it
   * (sub-tile widths only), the band ABOVE it, and the band BELOW it. The
   * edge's own wall segment was dropped from the main loop, so this is the
   * only thing putting wall back.
   *
   * Doors call this with `openingBottom: 0` — the below band collapses to
   * zero height and emits nothing, which is why the door result is
   * unchanged by the extraction. Windows pass `openingBottom = sillHeight`.
   *
   * Geometry conventions kept from the original door code: side fills run
   * the FULL wall height (not just the opening's span) and the below/above
   * bands run the FULL tile width, so the two overlap at the corners of a
   * sub-tile opening. That overlap is pre-existing door behaviour.
   *
   * @param {object} o
   * @param {number} o.col
   * @param {number} o.row
   * @param {string} o.edge
   * @param {number} o.openingWidth  world units across the edge
   * @param {number} o.openingBottom world-Y of the opening's underside
   * @param {number} o.openingTop    world-Y of the opening's head
   * @param {string|undefined} o.wallType
   * @param {object|null} o.wallDef
   * @param {Record<string, THREE.Material>} o.matCache
   * @param {boolean} o.isTransparent
   * @param {THREE.Group} o.parentGroup
   */
  _buildOpeningSurround({
    col, row, edge, openingWidth, openingBottom, openingTop,
    wallType, wallDef, matCache, isTransparent, parentGroup,
  }) {
    const isNS = edge === 'n' || edge === 's';
    const edgeCenter = this._edgeCenter(col, row, edge);
    const halfTile = TILE_SIZE / 2;
    const wallHeight = wallDef ? wallDef.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT;
    const wallThickness = wallDef
      ? Math.max(wallDef.thickness * THICKNESS_SCALE, MIN_THICKNESS)
      : DEFAULT_WALL_THICKNESS;
    const wallColor = wallDef ? wallDef.color : 0xcccccc;

    // Resolved lazily so an opening that emits no fill never allocates the
    // untextured fallback material (which nothing would ever dispose).
    const fillMaterial = () =>
      matCache[wallType] || matCache['__default'] ||
      (matCache['__default'] = new THREE.MeshStandardMaterial({
        color: wallColor, roughness: 0.8,
        transparent: isTransparent, opacity: isTransparent ? 0.3 : 1.0,
        depthWrite: !isTransparent,
      }));

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
      mesh.position.set(edgeCenter.x, y0 + h / 2, edgeCenter.z);
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
          wallHeight / 2,
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
      const edgeCenter = this._edgeCenter(col, row, edge);

      // Alias fallback, for the same reason window edges contribute both
      // representations to openingEdgeSet: the wall this window is a hole in
      // may be stored under the OTHER name for this edge. Without the
      // fallback the surround would silently fall back to DEFAULT_WALL_HEIGHT
      // / DEFAULT_WALL_THICKNESS in the untextured grey material.
      const wallType = wallTypeByEdge[`${col},${row},${edge}`]
        ?? wallTypeByEdge[_edgeAliasKey(col, row, edge)];
      const wallDef = wallType ? WALL_TYPES[wallType] : null;
      const wallHeight = wallDef ? wallDef.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT;
      const wallThickness = wallDef
        ? Math.max(wallDef.thickness * THICKNESS_SCALE, MIN_THICKNESS)
        : DEFAULT_WALL_THICKNESS;
      this._ensureOpeningWallMaterial(wallType, wallDef, matCache, isTransparent);

      // Opening box. Game.placeWindow enforces the fit rule
      // (wallHeight >= sill + opening + 1), but clamp anyway so a window
      // left behind by a wall swap degrades instead of poking out the top.
      const openingBottom = def.sillHeight * HEIGHT_SCALE;
      const openingTop = Math.min(
        (def.sillHeight + def.openingHeight) * HEIGHT_SCALE,
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
          wallType, wallDef, matCache, isTransparent, parentGroup,
        });
        continue;
      }
      const openingWidth = TILE_SIZE * (WINDOW_WIDTH_FRAC[def.windowWidth] ?? 0.5);

      // Surround first, so the wall is behind the frame in the mesh list.
      this._buildOpeningSurround({
        col, row, edge, openingWidth, openingBottom, openingTop,
        wallType, wallDef, matCache, isTransparent, parentGroup,
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
          yCenter,
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

      // industrialSash: a 3x2 grid of panes — two vertical mullions, one
      // horizontal transom.
      if (def.id === 'industrialSash') {
        const mullionDepth = Math.max(frameDepth * 0.7, GLASS_THICKNESS * 2);
        for (const k of [-1, 1]) {
          addBar(k * openingWidth / 6, jambY, WINDOW_MULLION_W, jambH, mullionDepth);
        }
        addBar(0, jambY, openingWidth - 2 * frameW, WINDOW_MULLION_W, mullionDepth);
      }

      // --- Glass ---
      const glassMat = this._windowGlassMaterial(def, wnd.variant | 0, glassMatCache, ghosted);
      const glassW = Math.max(openingWidth - 2 * frameW, 0.01);
      const glassH = Math.max(openingHeight - 2 * frameW, 0.01);
      const glassGeo = isNS
        ? new THREE.BoxGeometry(glassW, glassH, GLASS_THICKNESS)
        : new THREE.BoxGeometry(GLASS_THICKNESS, glassH, glassW);
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(edgeCenter.x, jambY, edgeCenter.z);
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

    // Group walls by (edge, type, variant, and the axis-perpendicular
    // coordinate). Variant must be part of the key so walls of the same
    // type but different claddings (e.g. cement vs brick exterior) stay
    // separate — otherwise a merged span would pick a single texture for
    // the whole run.
    const groups = {};
    for (const w of wallData) {
      const isNS = w.edge === 'n' || w.edge === 's';
      const variant = w.variant ?? 0;
      const groupKey = `${w.edge},${w.type},${variant},${isNS ? w.row : w.col}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(w);
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
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      // Only dispose material if it's not shared (walls share one mat, doors share one mat)
      // Track uniqueness by checking reference — but since we create one mat per build,
      // we dispose after removing all meshes. Use a Set to avoid double-dispose.
    }
    // Collect unique materials and dispose once
    const mats = new Set(this._meshes.map(m => m.material));
    for (const mat of mats) mat.dispose();

    this._meshes = [];
    // Every glass material was attached to a mesh above, so it has already
    // been disposed — just drop the registry so the darkness ramp stops
    // walking dead materials.
    this._glassMaterials = [];
  }
}
