// src/renderer3d/terrain-builder.js
// Renders grass tiles as a single InstancedMesh.
// THREE is a CDN global — do NOT import it.

export class TerrainBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._mesh = null;
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) the terrain InstancedMesh from terrain data.
   * @param {Array<{ col: number, row: number, hash: number, brightness: number }>} terrainData
   * @param {THREE.Group} parentGroup
   */
  build(terrainData, parentGroup) {
    // Cache check: skip rebuild if data length hasn't changed
    const newKey = terrainData.length;
    if (newKey === this._cacheKey && this._mesh) return;

    // Clean up old mesh
    this._cleanup(parentGroup);

    // Geometry: PlaneGeometry(2, 2) rotated -PI/2 on X to face up on XZ plane
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);

    // Remap UVs: the tile textures are isometric diamond images.
    // Rotate UV coords 45° so the diamond texture aligns with the square plane.
    // After rotateX(-PI/2), vertices are:
    //   0: (-1,0,-1) top-of-diamond    → UV (0.5, 1.0)
    //   1: ( 1,0,-1) right-of-diamond  → UV (1.0, 0.5)
    //   2: (-1,0, 1) left-of-diamond   → UV (0.0, 0.5)
    //   3: ( 1,0, 1) bottom-of-diamond → UV (0.5, 0.0)
    // Push UVs inward toward center to scale texture UP ~3%, closing gaps.
    const S = 0.03;
    const uvs = geo.attributes.uv;
    uvs.setXY(0, 0.5, 1.0 - S);
    uvs.setXY(1, 1.0 - S, 0.5);
    uvs.setXY(2, 0.0 + S, 0.5);
    uvs.setXY(3, 0.5, 0.0 + S);
    uvs.needsUpdate = true;

    // Material: use grass texture if available, else fallback color
    const grassTex = this._textureManager.get('assets/tiles/grass_tile_0.png');
    const mat = new THREE.MeshStandardMaterial({
      map: grassTex || undefined,
      color: grassTex ? 0xffffff : 0x338833,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.FrontSide,
    });

    // InstancedMesh
    const mesh = new THREE.InstancedMesh(geo, mat, terrainData.length);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < terrainData.length; i++) {
      const { col, row, brightness } = terrainData[i];

      // Position: center of tile at Y=0
      dummy.position.set(col * 2 + 1, 0, row * 2 + 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Per-instance color tint based on brightness
      const tintFactor = 0.88 + brightness * 0.12;
      const warmth = brightness * 0.05;
      const r = Math.max(0, Math.min(1, (0.94 + warmth) * tintFactor));
      const g = Math.max(0, Math.min(1, tintFactor));
      const b = Math.max(0, Math.min(1, (0.94 - warmth) * tintFactor));
      color.setRGB(r, g, b);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    parentGroup.add(mesh);
    this._mesh = mesh;
    this._cacheKey = newKey;
  }

  /**
   * Remove mesh from group and dispose resources.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    this._cleanup(parentGroup);
    this._cacheKey = null;
  }

  _cleanup(parentGroup) {
    if (this._mesh) {
      parentGroup.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
  }
}
