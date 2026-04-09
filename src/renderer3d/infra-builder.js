// src/renderer3d/infra-builder.js
// Renders infrastructure floor tiles as InstancedMesh per type.
// THREE is a CDN global — do NOT import it.

import { INFRASTRUCTURE } from '../data/infrastructure.js';

export class InfraBuilder {
  constructor(textureManager) {
    this._textureManager = textureManager;
    /** @type {THREE.InstancedMesh[]} */
    this._meshes = [];
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) infrastructure floor tiles from infraData.
   * @param {Array<{ col: number, row: number, type: string, orientation: string, variant: number, tint: number|null }>} infraData
   * @param {THREE.Group} parentGroup
   */
  build(infraData, parentGroup) {
    if (!infraData || infraData.length === 0) {
      this._cleanup(parentGroup);
      this._cacheKey = '';
      return;
    }

    // Cache key: stringify the data to detect changes
    const newKey = JSON.stringify(infraData);
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    // Dispose old meshes before rebuilding
    this._cleanup(parentGroup);

    // Group tiles by type
    const byType = new Map();
    for (const tile of infraData) {
      if (!byType.has(tile.type)) byType.set(tile.type, []);
      byType.get(tile.type).push(tile);
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (const [type, tiles] of byType) {
      const infra = INFRASTRUCTURE[type];
      if (!infra) continue;

      // Geometry: PlaneGeometry(2, 2) rotated -PI/2 on X (flat at Y=0)
      const geo = new THREE.PlaneGeometry(2, 2);
      geo.rotateX(-Math.PI / 2);

      // Material: use tile texture if available, else fallback color
      const tileInfo = this._textureManager.getTileInfo(type);
      const matParams = {
        roughness: 0.9,
        metalness: 0.0,
      };
      if (tileInfo && tileInfo.texture) {
        matParams.map = tileInfo.texture;
      } else {
        matParams.color = infra.topColor ?? infra.color ?? 0x888888;
      }
      const mat = new THREE.MeshStandardMaterial(matParams);

      // InstancedMesh
      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;

      for (let i = 0; i < tiles.length; i++) {
        const { col, row, tint } = tiles[i];

        // Position: 0.001 Y offset to avoid z-fighting with terrain
        dummy.position.set(col * 2 + 1, 0.001, row * 2 + 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Per-instance color from tint, or white
        if (tint != null) {
          color.set(tint);
        } else {
          color.set(0xffffff);
        }
        mesh.setColorAt(i, color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      parentGroup.add(mesh);
      this._meshes.push(mesh);
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

  _cleanup(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
