// src/renderer3d/wall-builder.js
// Renders walls and doors as 3D BoxGeometry slabs on tile edges.
// THREE is a CDN global — do NOT import it.

import { WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';

const TILE_SIZE = 2;          // world units per tile (2m real)
const M = TILE_SIZE / 2;     // 1 world unit = 2m, so 1m = 0.5 world units
const DEFAULT_WALL_HEIGHT = 1.5 * M;  // 1.5m — one story
const DEFAULT_WALL_THICKNESS = 0.15 * M; // 15cm
const HEIGHT_SCALE = DEFAULT_WALL_HEIGHT / 14;   // maps data wallHeight 14 → 1.5m
const THICKNESS_SCALE = DEFAULT_WALL_THICKNESS / 1.5; // maps data thickness 1.5 → 15cm
const MIN_THICKNESS = 0.05 * M;  // 5cm min for fences/cubicles
const DOOR_HEIGHT = 1.2 * M;     // 1.2m door
const POST_WIDTH = 0.1 * M;      // 10cm posts
const LINTEL_HEIGHT = 0.15 * M;   // 15cm lintel

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
    const newKey = JSON.stringify({ wallData, doorData, wallVisibility, cutawayKey });
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
      const variant = w.variant ?? 0;
      const def = WALL_TYPES[type];
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

      // --- Trapezoidal base: deform box vertices so bottom follows terrain ---
      // The box is centered at the origin in its geometry space — vertices at
      // y=-H/2 are the bottom, y=+H/2 are the top. We convert those to
      // absolute world-Y values so the bottom slopes with terrain corners and
      // the top stays horizontal at max(baseY.a, baseY.b) + wallHeight. The
      // mesh is then placed with y=0 (absolute Y is baked into the geometry).
      //
      // Endpoint convention (from buildWalls in world-snapshot.js):
      //   'n': a=NW (low X), b=NE (high X)
      //   's': a=SE (high X), b=SW (low X)
      //   'e': a=NE (low Z), b=SE (high Z)
      //   'w': a=SW (high Z), b=NW (low Z)
      const baseY = w.baseY || { a: 0, b: 0 };
      const topY = Math.max(baseY.a, baseY.b) + height;
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
        if (vy > 0) {
          // Top vertex — flat at topY.
          arr[ix + 1] = topY;
        } else {
          // Bottom vertex — interpolate between yLow and yHigh by the
          // long-axis coord. For isNS the long axis is X; else it's Z.
          const along = isNS ? arr[ix + 0] : arr[ix + 2];
          // along is in [-halfLen, +halfLen]
          const t = halfLen > EPS ? (along + halfLen) / (2 * halfLen) : 0;
          arr[ix + 1] = yLow + (yHigh - yLow) * t;
        }
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
      const halfTile = TILE_SIZE / 2;

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
      const wallHeight = wallDef ? wallDef.wallHeight * HEIGHT_SCALE : DEFAULT_WALL_HEIGHT;
      const wallThickness = wallDef
        ? Math.max(wallDef.thickness * THICKNESS_SCALE, MIN_THICKNESS)
        : DEFAULT_WALL_THICKNESS;
      const wallColor = wallDef ? wallDef.color : 0xcccccc;

      // Get or create wall material for wall segments around the door.
      // Match the main wall material — tint white if textured so the map shows
      // true colors, and disable depthWrite when transparent for consistent sort.
      if (wallType && !matCache[wallType]) {
        const baseMat = wallDef && wallDef.texture ? MATERIALS[wallDef.texture] : null;
        matCache[wallType] = new THREE.MeshStandardMaterial({
          map: baseMat ? baseMat.map : null,
          color: baseMat ? 0xffffff : wallColor,
          roughness: 0.8,
          transparent: isTransparent,
          opacity: isTransparent ? 0.3 : 1.0,
          depthWrite: !isTransparent,
        });
      }

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

      // For single doors, fill wall on both sides of the opening
      if (!isDouble) {
        const sideWidth = (TILE_SIZE - doorOpeningWidth) / 2;
        if (sideWidth > 0.001) {
          const sideMat = matCache[wallType] || matCache['__default'] ||
            (matCache['__default'] = new THREE.MeshStandardMaterial({
              color: wallColor, roughness: 0.8,
              transparent: isTransparent, opacity: isTransparent ? 0.3 : 1.0,
              depthWrite: !isTransparent,
            }));
          const sideGeo = isNS
            ? new THREE.BoxGeometry(sideWidth, wallHeight, wallThickness)
            : new THREE.BoxGeometry(wallThickness, wallHeight, sideWidth);
          if (isNS) {
            applyTiledBoxUVs(sideGeo, sideWidth, wallHeight, wallThickness);
          } else {
            applyTiledBoxUVs(sideGeo, wallThickness, wallHeight, sideWidth);
          }

          // Side A (negative direction)
          const sideA = new THREE.Mesh(sideGeo, sideMat);
          sideA.position.set(
            edgeCenter.x + (isNS ? (-halfTile + sideWidth / 2) : 0),
            wallHeight / 2,
            edgeCenter.z + (isNS ? 0 : (-halfTile + sideWidth / 2))
          );
          sideA.castShadow = !isTransparent;
          sideA.receiveShadow = true;
          sideA.matrixAutoUpdate = false;
          sideA.updateMatrix();
          parentGroup.add(sideA);
          this._meshes.push(sideA);

          // Side B (positive direction)
          const sideB = new THREE.Mesh(sideGeo.clone(), sideMat);
          sideB.position.set(
            edgeCenter.x + (isNS ? (halfTile - sideWidth / 2) : 0),
            wallHeight / 2,
            edgeCenter.z + (isNS ? 0 : (halfTile - sideWidth / 2))
          );
          sideB.castShadow = !isTransparent;
          sideB.receiveShadow = true;
          sideB.matrixAutoUpdate = false;
          sideB.updateMatrix();
          parentGroup.add(sideB);
          this._meshes.push(sideB);
        }
      }

      // Wall segment above the door (from lintel top to wall top)
      const aboveDoorBottom = doorHeight + LINTEL_HEIGHT;
      const aboveDoorHeight = wallHeight - aboveDoorBottom;
      if (aboveDoorHeight > 0.001) {
        const aboveMat = matCache[wallType] || matCache['__default'] ||
          (matCache['__default'] = new THREE.MeshStandardMaterial({
            color: wallColor, roughness: 0.8,
            transparent: isTransparent, opacity: isTransparent ? 0.3 : 1.0,
            depthWrite: !isTransparent,
          }));
        const aboveGeo = isNS
          ? new THREE.BoxGeometry(TILE_SIZE, aboveDoorHeight, wallThickness)
          : new THREE.BoxGeometry(wallThickness, aboveDoorHeight, TILE_SIZE);
        if (isNS) {
          applyTiledBoxUVs(aboveGeo, TILE_SIZE, aboveDoorHeight, wallThickness);
        } else {
          applyTiledBoxUVs(aboveGeo, wallThickness, aboveDoorHeight, TILE_SIZE);
        }
        const aboveMesh = new THREE.Mesh(aboveGeo, aboveMat);
        aboveMesh.position.set(
          edgeCenter.x,
          aboveDoorBottom + aboveDoorHeight / 2,
          edgeCenter.z
        );
        aboveMesh.castShadow = !isTransparent;
        aboveMesh.receiveShadow = true;
        aboveMesh.matrixAutoUpdate = false;
        aboveMesh.updateMatrix();
        parentGroup.add(aboveMesh);
        this._meshes.push(aboveMesh);
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
        let heightsMatch = false;
        if (consecutive) {
          const prevBY = prev.baseY || { a: 0, b: 0 };
          const curBY = cur.baseY || { a: 0, b: 0 };
          const edge = prev.edge;
          if (edge === 'n' || edge === 'e') {
            heightsMatch = prevBY.b === curBY.a;
          } else {
            // 's' or 'w'
            heightsMatch = prevBY.a === curBY.b;
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
