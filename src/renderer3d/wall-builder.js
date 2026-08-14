// src/renderer3d/wall-builder.js
// Renders walls and doors as 3D BoxGeometry slabs on tile edges.
// THREE is a CDN global — do NOT import it.

import { WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';
import { contentKey } from './content-hash.js';

const TILE_SIZE = 2;          // world units per tile (2m real)
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
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) walls and doors from data arrays.
   * @param {Array<{ col: number, row: number, edge: string, type: string }>} wallData
   * @param {Array<{ col: number, row: number, edge: string, type: string }>} doorData
   * @param {THREE.Group} parentGroup
   * @param {'up'|'transparent'|'cutaway'|'down'} wallVisibility
   * @param {Set<string>|null} cutawayRoom  Set of "col,row" strings for cutaway mode
   */
  build(wallData, doorData, parentGroup, wallVisibility, cutawayRoom = null) {
    if (wallVisibility === 'down') {
      this._cleanup(parentGroup);
      return;
    }

    const cutawayKey = cutawayRoom ? Array.from(cutawayRoom).sort().join(';') : '';
    const newKey = contentKey({ wallData, doorData, wallVisibility, cutawayKey });
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    const isTransparent = wallVisibility === 'transparent';

    // --- Walls (per-type height, thickness, color) ---
    // Cache materials by wall type to avoid duplicates
    const matCache = {};

    // Build a set of door edge keys so we can skip walls that coincide with
    // doors — the door builder creates its own side/above wall segments, and
    // letting the main wall render on top would both block the opening and
    // double-render the segment (causing z-fighting/shimmer in transparent mode).
    const doorEdgeSet = new Set();
    for (const d of (doorData || [])) {
      doorEdgeSet.add(`${d.col},${d.row},${d.edge}`);
    }
    const wallsWithoutDoors = (wallData || []).filter(
      w => !doorEdgeSet.has(`${w.col},${w.row},${w.edge}`)
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
    // Variant travels with the type so a door's side fills clad themselves
    // like the wall they interrupt (brick door reveals in a brick wall).
    const wallTypeByEdge = {};
    for (const w of (wallData || [])) {
      wallTypeByEdge[`${w.col},${w.row},${w.edge}`] = {
        type: w.type, variant: w.variant ?? 0,
      };
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

      const isDoorCutaway = wallVisibility === 'cutaway' && cutawayRoom &&
        this._wallBordersRoom(col, row, edge, cutawayRoom);

      const isNS = edge === 'n' || edge === 's';
      const edgeCenter = this._edgeCenter(col, row, edge);

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

      // Find the wall type on this edge to match height/thickness/color
      const wallEntry = wallTypeByEdge[`${col},${row},${edge}`];
      const wallType = wallEntry?.type;
      const wallVariant = wallEntry?.variant ?? 0;
      // Same key the wall loop uses, so a door's fills share the material of
      // the run they sit in instead of allocating a second, unclad copy.
      const wallMatKey = wallType ? `${wallType}:${wallVariant}` : null;
      const wallDef = wallType ? WALL_TYPES[wallType] : null;
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
      const wallThickness = wallDef
        ? Math.max(wallDef.thickness * THICKNESS_SCALE, MIN_THICKNESS)
        : DEFAULT_WALL_THICKNESS;
      const wallColor = wallDef ? wallDef.color : 0xcccccc;

      // Get or create wall material for wall segments around the door.
      // Match the main wall material — tint white if textured so the map shows
      // true colors, and disable depthWrite when transparent for consistent sort.
      if (wallMatKey && !matCache[wallMatKey]) {
        const textureName = wallDef?.variantTextures?.[wallVariant] ?? wallDef?.texture;
        const baseMat = textureName ? MATERIALS[textureName] : null;
        matCache[wallMatKey] = new THREE.MeshStandardMaterial({
          map: baseMat ? baseMat.map : null,
          color: baseMat ? 0xffffff : wallColor,
          roughness: 0.8,
          transparent: isTransparent,
          opacity: isTransparent ? 0.3 : 1.0,
          depthWrite: !isTransparent,
        });
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
        doorHeight / 2,
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
        doorHeight / 2,
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
        doorHeight + LINTEL_HEIGHT / 2,
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
        const sideMat = matCache[wallMatKey] || matCache['__default'] ||
          (matCache['__default'] = new THREE.MeshStandardMaterial({
            color: wallColor, roughness: 0.8,
            transparent: isTransparent, opacity: isTransparent ? 0.3 : 1.0,
            depthWrite: !isTransparent,
          }));
        const sideGeo = isNS
          ? new THREE.BoxGeometry(side.width, wallHeight, wallThickness)
          : new THREE.BoxGeometry(wallThickness, wallHeight, side.width);
        if (isNS) {
          applyTiledBoxUVs(sideGeo, side.width, wallHeight, wallThickness);
        } else {
          applyTiledBoxUVs(sideGeo, wallThickness, wallHeight, side.width);
        }

        const sideMesh = new THREE.Mesh(sideGeo, sideMat);
        sideMesh.position.set(
          edgeCenter.x + (isNS ? side.offset : 0),
          wallHeight / 2,
          edgeCenter.z + (isNS ? 0 : side.offset)
        );
        sideMesh.castShadow = !isTransparent;
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
        const aboveMat = matCache[wallMatKey] || matCache['__default'] ||
          (matCache['__default'] = new THREE.MeshStandardMaterial({
            color: wallColor, roughness: 0.8,
            transparent: isTransparent, opacity: isTransparent ? 0.3 : 1.0,
            depthWrite: !isTransparent,
          }));
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
          aboveDoorBottom + aboveDoorHeight / 2,
          edgeCenter.z + openZ
        );
        aboveMesh.castShadow = !isTransparent;
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
          panelH / 2,
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

    this._cacheKey = newKey;
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
  }
}
