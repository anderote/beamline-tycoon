// src/renderer3d/equipment-builder.js
// Renders equipment and zone furnishings as 3D boxes.
// THREE is a CDN global — do NOT import it.

import { PLACEABLES } from '../data/placeables/index.js';

const SUB_UNIT = 0.5;

export class EquipmentBuilder {
  constructor() {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
  }

  /**
   * Build equipment and furnishing meshes from snapshot data.
   * @param {Array} equipmentData - Array of equipment objects from WorldSnapshot
   * @param {Array} furnishingData - Array of furnishing objects from WorldSnapshot
   * @param {THREE.Group} parentGroup
   */
  build(equipmentData, furnishingData, parentGroup) {
    this.dispose(parentGroup);

    if (equipmentData) {
      for (const eq of equipmentData) {
        const compDef = PLACEABLES[eq.type];
        if (!compDef) continue;

        const w = (compDef.subW || 2) * SUB_UNIT;
        const h = (compDef.subH || 2) * SUB_UNIT;
        const l = (compDef.subL || compDef.subH || 2) * SUB_UNIT;

        const geo = new THREE.BoxGeometry(w, h, l);
        const mat = new THREE.MeshStandardMaterial({
          color: compDef.spriteColor || compDef.color || 0x888888,
          roughness: 0.7,
          metalness: 0.1,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;

        const tileX = (eq.col ?? 0) * 2;
        const tileZ = (eq.row ?? 0) * 2;
        const subX = (eq.subCol || 0) * SUB_UNIT;
        const subZ = (eq.subRow || 0) * SUB_UNIT;
        mesh.position.set(tileX + subX + w / 2, h / 2, tileZ + subZ + l / 2);
        mesh.updateMatrix();

        parentGroup.add(mesh);
        this._meshes.push(mesh);
      }
    }

    if (furnishingData) {
      for (const furn of furnishingData) {
        const furnDef = PLACEABLES[furn.type];

        const w = (furnDef?.subW || 1) * SUB_UNIT;
        const h = (furnDef?.subH || 1) * SUB_UNIT;
        const l = (furnDef?.subL || furnDef?.subH || 1) * SUB_UNIT;

        const geo = new THREE.BoxGeometry(w, h, l);
        const mat = new THREE.MeshStandardMaterial({
          color: furnDef?.color || 0x666666,
          roughness: 0.8,
          metalness: 0.0,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;

        const tileX = (furn.col ?? 0) * 2;
        const tileZ = (furn.row ?? 0) * 2;
        const subX = (furn.subCol || 0) * SUB_UNIT;
        const subZ = (furn.subRow || 0) * SUB_UNIT;
        mesh.position.set(tileX + subX + w / 2, h / 2, tileZ + subZ + l / 2);
        mesh.updateMatrix();

        parentGroup.add(mesh);
        this._meshes.push(mesh);
      }
    }
  }

  /**
   * Remove all meshes from group and dispose resources.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
