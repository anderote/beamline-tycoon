// src/renderer3d/equipment-builder.js
// Renders equipment and zone furnishings as 3D boxes with per-face
// textured materials. Each box uses a 6-entry material array (one per
// face) so a face can independently use a tiled MATERIAL or a DECAL.
// THREE is a CDN global — do NOT import it.

import { PLACEABLES } from '../data/placeables/index.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';

const SUB_UNIT = 0.5;

// Cache per (compType + faceKey + base + override) -> material so identical
// face configs share. Module-level cache lives across rebuilds and instances.
const _equipMatCache = new Map();

function _faceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  // Decals: handled in Task 9 — for now, fall through to base material.
  // The cache key still records the override so a future Task 9 swap is clean.
  const cacheKey = `${compType}|${faceKey}|${baseName}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _equipMatCache.get(cacheKey);
  if (m) return m;
  let map = null;
  let color = fallbackColor;
  if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.7,
    metalness: 0.2,
  });
  _equipMatCache.set(cacheKey, m);
  return m;
}

export class EquipmentBuilder {
  constructor() {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
  }

  /**
   * Build equipment and furnishing meshes from snapshot data.
   * @param {Array} equipmentData
   * @param {Array} furnishingData
   * @param {THREE.Group} parentGroup
   */
  build(equipmentData, furnishingData, parentGroup) {
    this.dispose(parentGroup);

    const FACE_KEYS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

    const placeOne = (item, isFurnishing) => {
      const compDef = PLACEABLES[item.type];
      if (!compDef && !isFurnishing) return;

      const w = (compDef?.subW || (isFurnishing ? 1 : 2)) * SUB_UNIT;
      const h = (compDef?.subH || (isFurnishing ? 1 : 2)) * SUB_UNIT;
      const l = (compDef?.subL || compDef?.subH || (isFurnishing ? 1 : 2)) * SUB_UNIT;

      const geo = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geo, w, h, l);

      const fallbackColor = compDef?.spriteColor || compDef?.color || 0x888888;
      const baseName = compDef?.baseMaterial || null;
      const faces = compDef?.faces || {};

      const matArray = FACE_KEYS.map(key =>
        _faceMaterial(item.type, key, baseName, faces[key], fallbackColor)
      );

      const mesh = new THREE.Mesh(geo, matArray);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;

      const tileX = (item.col ?? 0) * 2;
      const tileZ = (item.row ?? 0) * 2;
      const subX = (item.subCol || 0) * SUB_UNIT;
      const subZ = (item.subRow || 0) * SUB_UNIT;
      mesh.position.set(tileX + subX + w / 2, h / 2, tileZ + subZ + l / 2);
      mesh.updateMatrix();

      parentGroup.add(mesh);
      this._meshes.push(mesh);
    };

    if (equipmentData) for (const eq of equipmentData) placeOne(eq, false);
    if (furnishingData) for (const furn of furnishingData) placeOne(furn, true);
  }

  /**
   * Remove all meshes from group and dispose geometries. Materials live in
   * _equipMatCache and are shared across instances and rebuilds — DO NOT
   * dispose them here.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this._meshes = [];
  }
}
