// THREE is a CDN global — do NOT import it.
import { FLOORS } from '../data/structure.js';
import { contentKey } from './content-hash.js';

export class RoofBuilder {
  constructor() { this._meshes = []; this._cacheKey = null; }
  build(data, parent) {
    const roofs = data || [];
    const key = contentKey(roofs);
    if (key === this._cacheKey && this._meshes.length) return;
    this._cleanup(parent);
    for (const tile of roofs) {
      const def = FLOORS[tile.type] || FLOORS.roof;
      const thickness = 0.12;
      const material = new THREE.MeshStandardMaterial({ color: def.topColor ?? def.color ?? 0x5d6268, roughness: 0.9, metalness: 0.05 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.04, thickness, 2.04), material);
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
      mesh.material?.dispose?.();
    }
    this._meshes = [];
  }
}
