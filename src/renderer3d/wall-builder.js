// src/renderer3d/wall-builder.js
// Renders walls and doors as 3D BoxGeometry slabs on tile edges.
// THREE is a CDN global — do NOT import it.

const WALL_HEIGHT = 3.0;      // world units
const WALL_THICKNESS = 0.15;  // world units
const TILE_SIZE = 2;          // world units per tile
const DOOR_HEIGHT = 2.5;
const POST_WIDTH = 0.2;
const LINTEL_HEIGHT = 0.3;

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
   */
  build(wallData, doorData, parentGroup, wallVisibility) {
    if (wallVisibility === 'down') {
      this._cleanup(parentGroup);
      return;
    }

    const newKey = JSON.stringify({ wallData, doorData, wallVisibility });
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    const isTransparent = wallVisibility === 'transparent';

    // --- Walls ---
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.8,
      transparent: isTransparent,
      opacity: isTransparent ? 0.3 : 1.0,
    });

    for (const w of (wallData || [])) {
      const { col, row, edge } = w;
      const geo = this._wallGeometry(edge);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.copy(this._wallPosition(col, row, edge));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }

    // --- Doors ---
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
    });

    for (const d of (doorData || [])) {
      const { col, row, edge } = d;
      const isNS = edge === 'n' || edge === 's';

      // Determine the two post positions and lintel position/size
      const edgeCenter = this._edgeCenter(col, row, edge);

      // Posts sit at each end of the tile edge
      // For n/s edges: posts at X ends (col*2 and col*2+2), Z fixed
      // For e/w edges: posts at Z ends (row*2 and row*2+2), X fixed
      const halfTile = TILE_SIZE / 2;

      const postGeo = new THREE.BoxGeometry(POST_WIDTH, DOOR_HEIGHT, POST_WIDTH);
      const lintelGeo = isNS
        ? new THREE.BoxGeometry(TILE_SIZE, LINTEL_HEIGHT, WALL_THICKNESS)
        : new THREE.BoxGeometry(WALL_THICKNESS, LINTEL_HEIGHT, TILE_SIZE);

      // Post A
      const postA = new THREE.Mesh(postGeo, doorMat);
      postA.position.set(
        edgeCenter.x + (isNS ? -halfTile : 0),
        DOOR_HEIGHT / 2,
        edgeCenter.z + (isNS ? 0 : -halfTile)
      );
      postA.castShadow = true;
      postA.matrixAutoUpdate = false;
      postA.updateMatrix();
      parentGroup.add(postA);
      this._meshes.push(postA);

      // Post B
      const postB = new THREE.Mesh(postGeo.clone(), doorMat);
      postB.position.set(
        edgeCenter.x + (isNS ? halfTile : 0),
        DOOR_HEIGHT / 2,
        edgeCenter.z + (isNS ? 0 : halfTile)
      );
      postB.castShadow = true;
      postB.matrixAutoUpdate = false;
      postB.updateMatrix();
      parentGroup.add(postB);
      this._meshes.push(postB);

      // Lintel
      const lintel = new THREE.Mesh(lintelGeo, doorMat);
      lintel.position.set(
        edgeCenter.x,
        DOOR_HEIGHT + LINTEL_HEIGHT / 2,
        edgeCenter.z
      );
      lintel.castShadow = true;
      lintel.matrixAutoUpdate = false;
      lintel.updateMatrix();
      parentGroup.add(lintel);
      this._meshes.push(lintel);
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

  _wallGeometry(edge) {
    const isNS = edge === 'n' || edge === 's';
    return isNS
      ? new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, WALL_THICKNESS)
      : new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, TILE_SIZE);
  }

  /**
   * Returns the world-space center position of a wall on the given edge.
   * Tile occupies X: [col*2, col*2+2], Z: [row*2, row*2+2]
   * @param {number} col
   * @param {number} row
   * @param {string} edge  'n'|'s'|'e'|'w'
   * @returns {THREE.Vector3}
   */
  _wallPosition(col, row, edge) {
    const cx = col * TILE_SIZE + TILE_SIZE / 2; // tile X center
    const cz = row * TILE_SIZE + TILE_SIZE / 2; // tile Z center
    const half = TILE_SIZE / 2;

    switch (edge) {
      case 'n': return new THREE.Vector3(cx,            WALL_HEIGHT / 2, row * TILE_SIZE);
      case 's': return new THREE.Vector3(cx,            WALL_HEIGHT / 2, row * TILE_SIZE + TILE_SIZE);
      case 'e': return new THREE.Vector3(col * TILE_SIZE + TILE_SIZE, WALL_HEIGHT / 2, cz);
      case 'w': return new THREE.Vector3(col * TILE_SIZE,             WALL_HEIGHT / 2, cz);
      default:  return new THREE.Vector3(cx, WALL_HEIGHT / 2, cz);
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
