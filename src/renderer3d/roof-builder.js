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
    const buckets = new Map();
    for (const tile of roofs) {
      const def = FLOORS[tile.type] || FLOORS.roof;
      const textureName = tile.texture || '';
      const color = def.topColor ?? def.color ?? 0x5d6268;
      const key = `${textureName}|${color}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { textureName, color, tiles: [] };
        buckets.set(key, bucket);
      }
      bucket.tiles.push(tile);
    }

    // A roof tile used to be one six-material BoxGeometry: 393 Minor Lab
    // tiles could therefore submit thousands of draws in roof overview.
    // Bake every compatible slab into two meshes instead — all horizontal
    // faces and all edge faces — while keeping per-tile UVs and thickness.
    const thickness = 0.12;
    for (const bucket of buckets.values()) {
      const surfaceData = { positions: [], normals: [], uvs: [] };
      const sideData = { positions: [], normals: [], uvs: [] };
      for (const tile of bucket.tiles) {
        const indexedBox = new THREE.BoxGeometry(2.04, thickness, 2.04);
        const box = indexedBox.toNonIndexed();
        indexedBox.dispose();
        box.translate(tile.x, tile.y - thickness / 2, tile.z);
        const positions = box.attributes.position;
        const normals = box.attributes.normal;
        const uvs = box.attributes.uv;
        for (let index = 0; index < positions.count; index += 3) {
          const target = Math.abs(normals.getY(index)) > 0.5 ? surfaceData : sideData;
          for (let vertex = index; vertex < index + 3; vertex++) {
            target.positions.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
            target.normals.push(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
            target.uvs.push(uvs.getX(vertex), uvs.getY(vertex));
          }
        }
        box.dispose();
      }

      const source = bucket.textureName ? MATERIALS[bucket.textureName] : null;
      const materials = {
        surface: new THREE.MeshStandardMaterial({
          map: source?.map ?? null,
          color: source ? 0xffffff : bucket.color,
          roughness: source?.roughness ?? 0.9,
          metalness: source?.metalness ?? 0.05,
        }),
        side: new THREE.MeshStandardMaterial({
          color: bucket.color,
          roughness: 0.9,
          metalness: 0.05,
        }),
      };
      this._materials.push(materials.surface, materials.side);
      for (const [role, attributes] of Object.entries({
        surface: surfaceData,
        side: sideData,
      })) {
        if (attributes.positions.length === 0) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(attributes.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(attributes.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(attributes.uvs, 2));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, materials[role]);
        mesh.name = `roof-batch-${role}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.batchedRoofs = true;
        mesh.userData.roofTileCount = bucket.tiles.length;
        parent.add(mesh);
        this._meshes.push(mesh);
      }
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
