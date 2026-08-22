// THREE is a CDN global — do NOT import it.
import { FLOORS } from '../data/structure.js';
import { contentKey } from './content-hash.js';
import { MATERIALS } from './materials/index.js';

export class RoofBuilder {
  constructor() { this._meshes = []; this._materials = []; this._cacheKey = null; }
  build(data, parent) {
    const roofs = data || [];
    const key = contentKey(roofs);
    if (key === this._cacheKey && this._meshes.length) return;
    this._cleanup(parent);
    const materialSets = new Map();
    for (const tile of roofs) {
      const def = FLOORS[tile.type] || FLOORS.roof;
      const thickness = 0.12;
      const textureName = tile.texture || '';
      let materials = materialSets.get(textureName);
      if (!materials) {
        const side = new THREE.MeshStandardMaterial({
          color: def.topColor ?? def.color ?? 0x5d6268,
          roughness: 0.9,
          metalness: 0.05,
        });
        const source = textureName ? MATERIALS[textureName] : null;
        const surface = new THREE.MeshStandardMaterial({
          map: source?.map ?? null,
          color: source ? 0xffffff : (def.topColor ?? def.color ?? 0x5d6268),
          roughness: source?.roughness ?? 0.9,
          metalness: source?.metalness ?? 0.05,
        });
        // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Both horizontal
        // faces carry the room treatment so it is legible in roof view and
        // from below; the slab edges retain the ordinary roof color.
        materials = [side, side, surface, surface, side, side];
        materialSets.set(textureName, materials);
        this._materials.push(side, surface);
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.04, thickness, 2.04), materials);
      mesh.position.set(tile.x, tile.y - thickness / 2, tile.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this._meshes.push(mesh);
    }
    this._cacheKey = key;
  }
  _cleanup(parent) {
    for (const mesh of this._meshes) {
      parent.remove(mesh);
      mesh.geometry?.dispose?.();
    }
    for (const material of this._materials) material.dispose?.();
    this._meshes = [];
    this._materials = [];
  }
  dispose(parent) {
    this._cleanup(parent);
    this._cacheKey = null;
  }
}
