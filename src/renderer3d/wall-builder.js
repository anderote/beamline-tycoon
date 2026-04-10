// src/renderer3d/wall-builder.js
// Renders walls and doors as 3D BoxGeometry slabs on tile edges.
// THREE is a CDN global — do NOT import it.

import { WALL_TYPES, DOOR_TYPES } from '../data/infrastructure.js';

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

    // When transparent, merge adjacent colinear walls of the same type into
    // single longer boxes to eliminate interior end-cap faces that compound
    // opacity and create dark seams.
    const wallsToRender = this._mergeWalls(wallData || [], wallVisibility, cutawayRoom);

    for (const w of wallsToRender) {
      const { col, row, edge, type, span } = w;
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

      // In cutaway mode, walls need per-wall materials (some opaque, some transparent)
      const matKey = isCutawayWall ? `${type}_cutaway` : type;
      if (!matCache[matKey]) {
        matCache[matKey] = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.8,
          transparent: wallTransparent,
          opacity: wallTransparent ? 0.3 : 1.0,
          depthWrite: !wallTransparent,
        });
      }

      const isNS = edge === 'n' || edge === 's';
      const length = (span || 1) * TILE_SIZE;
      const geo = isNS
        ? new THREE.BoxGeometry(length, height, thickness)
        : new THREE.BoxGeometry(thickness, height, length);
      const mesh = new THREE.Mesh(geo, matCache[matKey]);
      // Position at the center of the merged span
      const pos = this._wallPosition(col, row, edge, height);
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
    });
    const doorMatTransparent = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      transparent: true,
      opacity: 0.3,
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

      // Get or create wall material for wall segments around the door
      if (wallType && !matCache[wallType]) {
        matCache[wallType] = new THREE.MeshStandardMaterial({
          color: wallColor,
          roughness: 0.8,
          transparent: isTransparent,
          opacity: isTransparent ? 0.3 : 1.0,
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
            }));
          const sideGeo = isNS
            ? new THREE.BoxGeometry(sideWidth, wallHeight, wallThickness)
            : new THREE.BoxGeometry(wallThickness, wallHeight, sideWidth);

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
          }));
        const aboveGeo = isNS
          ? new THREE.BoxGeometry(TILE_SIZE, aboveDoorHeight, wallThickness)
          : new THREE.BoxGeometry(wallThickness, aboveDoorHeight, TILE_SIZE);
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
   */
  _mergeWalls(wallData, wallVisibility, cutawayRoom) {
    const isTransparent = wallVisibility === 'transparent';
    const hasCutaway = wallVisibility === 'cutaway' && cutawayRoom;
    if (!isTransparent && !hasCutaway) {
      return wallData.map(w => ({ ...w, span: 1 }));
    }

    // Group walls by (edge, type, and the axis-perpendicular coordinate)
    // N/S walls run along X, grouped by row; E/W walls run along Z, grouped by col
    const groups = {};
    for (const w of wallData) {
      const isNS = w.edge === 'n' || w.edge === 's';
      const groupKey = `${w.edge},${w.type},${isNS ? w.row : w.col}`;
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
        if (!consecutive) {
          // Emit merged span from spanStart to i-1
          const origin = walls[spanStart];
          result.push({ ...origin, span: i - spanStart });
          spanStart = i;
        }
      }
    }
    return result;
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
