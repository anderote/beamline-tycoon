// src/renderer3d/terrain-builder.js
// Renders default ground grass as a single InstancedMesh using the
// tile_grass material from MATERIALS. Per-instance brightness tint
// gives the patchy lawn look that the old 24-variant diamond approach
// produced. THREE is a CDN global — do NOT import it.

import { MATERIALS } from './materials/index.js';

export class TerrainBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    this._meshes = [];
    this._cacheKey = null;
  }

  build(terrainData, parentGroup) {
    const newKey = terrainData.length;
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    if (terrainData.length === 0) return;

    const grassMat = MATERIALS.tile_grass;
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    // Plain 0..1 UVs — each tile is exactly METERS_PER_TILE = 2m so
    // one full texture repetition fits per tile.

    const mat = new THREE.MeshStandardMaterial({
      map: grassMat?.map ?? null,
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.FrontSide,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, terrainData.length);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < terrainData.length; i++) {
      const { col, row, brightness } = terrainData[i];

      dummy.position.set(col * 2 + 1, 0, row * 2 + 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Per-instance brightness tint reproduces the patchy-lawn variation
      // that the old 24-variant approach used.
      const tintFactor = 0.88 + brightness * 0.12;
      const warmth = brightness * 0.05;
      const r = Math.max(0, Math.min(1, (0.94 + warmth) * tintFactor));
      const g = Math.max(0, Math.min(1, tintFactor));
      const b = Math.max(0, Math.min(1, (0.94 - warmth) * tintFactor));
      color.setRGB(r, g, b);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    parentGroup.add(mesh);
    this._meshes.push(mesh);

    this._cacheKey = newKey;
  }

  dispose(parentGroup) {
    this._cleanup(parentGroup);
    this._cacheKey = null;
  }

  _cleanup(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
