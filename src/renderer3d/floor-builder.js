// src/renderer3d/floor-builder.js
// Renders floor tiles as InstancedMesh per type. Each zone
// type may declare a `texture` field referencing a material in MATERIALS;
// floors use those materials directly with plain 0..1 UVs (each tile is
// exactly METERS_PER_TILE = 2m on a side, so one full repetition fits).
// The bgMesh provides solid-color fallback for tiles without a texture.
//
// THREE is a CDN global — do NOT import it.

import { FLOORS } from '../data/structure.js';
import { MATERIALS } from './materials/index.js';

export class FloorBuilder {
  constructor(textureManager) {
    // textureManager is retained for the constructor signature but no
    // longer used by the floor renderer — floors use MATERIALS directly.
    this._textureManager = textureManager;
    /** @type {THREE.InstancedMesh[]} */
    this._meshes = [];
    this._cacheKey = null;
  }

  /**
   * Build (or rebuild) floor tiles from floorData.
   * @param {Array<{ col: number, row: number, type: string, orientation: string, variant: number, tint: number|null }>} floorData
   * @param {THREE.Group} parentGroup
   */
  build(floorData, parentGroup) {
    if (!floorData || floorData.length === 0) {
      this._cleanup(parentGroup);
      this._cacheKey = '';
      return;
    }

    const newKey = JSON.stringify(floorData);
    if (newKey === this._cacheKey && this._meshes.length > 0) return;

    this._cleanup(parentGroup);

    // Group tiles by type+variant so each group can resolve its own
    // texture (via variantTextures) and tint (via variantTints).
    const byGroup = new Map();
    for (const tile of floorData) {
      const variant = tile.variant ?? 0;
      const groupKey = tile.type + ':' + variant;
      let group = byGroup.get(groupKey);
      if (!group) {
        group = { type: tile.type, variant, tiles: [] };
        byGroup.set(groupKey, group);
      }
      group.tiles.push(tile);
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (const group of byGroup.values()) {
      const { type, variant, tiles } = group;
      const def = FLOORS[type];
      if (!def) continue;

      const baseColor = def.topColor ?? def.color ?? 0x888888;
      const textureName = def.variantTextures?.[variant] ?? def.texture;
      const matFromCatalog = textureName ? MATERIALS[textureName] : null;
      const variantTint = def.variantTints?.[variant] ?? null;

      // 1) Solid background plane — fills the full square so any transparency
      //    in the textured plane shows the zone's solid color underneath.
      const bgGeo = new THREE.PlaneGeometry(2, 2);
      bgGeo.rotateX(-Math.PI / 2);
      const bgMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.9,
        metalness: 0.0,
      });
      const bgMesh = new THREE.InstancedMesh(bgGeo, bgMat, tiles.length);
      bgMesh.receiveShadow = true;
      bgMesh.castShadow = false;
      bgMesh.matrixAutoUpdate = false;

      for (let i = 0; i < tiles.length; i++) {
        dummy.position.set(tiles[i].col * 2 + 1, 0.001, tiles[i].row * 2 + 1);
        dummy.updateMatrix();
        bgMesh.setMatrixAt(i, dummy.matrix);
      }
      bgMesh.instanceMatrix.needsUpdate = true;
      parentGroup.add(bgMesh);
      this._meshes.push(bgMesh);

      // 2) Textured overlay plane (if a material is mapped for this type) —
      //    plain 0..1 UVs since each tile is exactly METERS_PER_TILE = 2m.
      if (matFromCatalog) {
        const texGeo = new THREE.PlaneGeometry(2, 2);
        texGeo.rotateX(-Math.PI / 2);
        // PlaneGeometry default UVs are already 0..1; one full texture
        // repetition fits exactly one tile. No remap needed.

        // Per-instance tint requires a fresh material that mirrors the
        // catalog one's map but allows InstancedMesh setColorAt to take effect.
        const texMat = new THREE.MeshStandardMaterial({
          map: matFromCatalog.map,
          color: 0xffffff,
          roughness: matFromCatalog.roughness,
          metalness: matFromCatalog.metalness,
        });

        const texMesh = new THREE.InstancedMesh(texGeo, texMat, tiles.length);
        texMesh.receiveShadow = true;
        texMesh.castShadow = false;
        texMesh.matrixAutoUpdate = false;

        for (let i = 0; i < tiles.length; i++) {
          const { col, row, tint, orientation } = tiles[i];
          dummy.position.set(col * 2 + 1, 0.002, row * 2 + 1); // slightly above bg
          // Orientable tiles (hardwood, groomed grass, brick paving) rotate
          // the texture 90° by spinning the instance around Y — the quad is
          // a 2×2 square centered at origin, so its footprint is unchanged
          // but the UV-carrying vertices land in a rotated position.
          dummy.rotation.set(0, orientation ? Math.PI / 2 : 0, 0);
          dummy.updateMatrix();
          dummy.rotation.set(0, 0, 0);
          texMesh.setMatrixAt(i, dummy.matrix);

          // Per-tile tint takes priority, then variant tint, then white.
          if (tint != null) {
            color.set(tint);
          } else if (variantTint != null) {
            color.set(variantTint);
          } else {
            color.set(0xffffff);
          }
          texMesh.setColorAt(i, color);
        }

        texMesh.instanceMatrix.needsUpdate = true;
        if (texMesh.instanceColor) texMesh.instanceColor.needsUpdate = true;

        parentGroup.add(texMesh);
        this._meshes.push(texMesh);
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

  _cleanup(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      // bgMat and per-zone-type texMat are constructed per-build and
      // owned by the mesh — dispose them. (They're not in MATERIALS;
      // they're cloned wrappers with the catalog map.)
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
