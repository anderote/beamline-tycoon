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

    // Material: use grass texture if available, else fallback color
    const grassTex = this._textureManager.get('assets/tiles/grass_tile_0.png');
    const matParams = {
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.FrontSide,
    };
    if (grassTex) {
      matParams.map = grassTex;
    } else {
      matParams.color = 0x338833;
    }
    const mat = new THREE.MeshStandardMaterial(matParams);

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
