// src/renderer3d/component-builder.js
// Builds Three.js meshes for beamline components from world snapshot data.
// THREE is a CDN global — do NOT import it.

import { COMPONENTS } from '../data/components.js';

const SUB_UNIT = 0.5; // 1 sub-unit = 0.5m in world space

export class ComponentBuilder {
  constructor() {
    // Map from component id -> THREE.Mesh
    this._meshMap = new Map();
  }

  /**
   * Create a Three.js mesh for a component definition.
   * @param {object} compDef - Entry from COMPONENTS
   * @returns {THREE.Mesh}
   */
  _createMesh(compDef) {
    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = (compDef.subH || 2) * SUB_UNIT;
    const l = (compDef.subL || 2) * SUB_UNIT;

    let geometry;
    if (compDef.geometryType === 'cylinder') {
      const radius = Math.min(w, h) / 2;
      geometry = new THREE.CylinderGeometry(radius, radius, l, 8);
      // Rotate so the cylinder's axis aligns along the beam direction (Z)
      geometry.rotateZ(Math.PI / 2);
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
    }

    const color = compDef.spriteColor !== undefined ? compDef.spriteColor : 0x888888;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  /**
   * Build or update meshes for all components in the snapshot.
   * Removes stale meshes for components no longer present.
   *
   * @param {Array} componentData - Array of component objects from WorldSnapshot
   * @param {THREE.Group} parentGroup - Scene group to add meshes to
   */
  build(componentData, parentGroup) {
    if (!componentData || !parentGroup) return;

    const seen = new Set();

    for (const comp of componentData) {
      const { id, type, col, row, direction, dimmed } = comp;
      seen.add(id);

      // Look up the component definition
      const compDef = COMPONENTS[type] || {};
      const subH = compDef.subH || 2;

      // Create mesh if not already in map
      if (!this._meshMap.has(id)) {
        const mesh = this._createMesh(compDef);
        mesh.matrixAutoUpdate = false;
        this._meshMap.set(id, mesh);
        parentGroup.add(mesh);
      }

      const mesh = this._meshMap.get(id);

      // Position: center of tile (col * 2 + 1, Y = half height, row * 2 + 1)
      // Each tile is 2 world units (since terrain uses col*2, row*2 grid spacing)
      const x = col * 2 + 1;
      const y = (subH * SUB_UNIT) / 2;
      const z = row * 2 + 1;
      mesh.position.set(x, y, z);

      // Rotation: direction 0=North, 1=East, 2=South, 3=West (counter-clockwise from Y axis)
      mesh.rotation.y = -(direction || 0) * (Math.PI / 2);

      // Dimming
      if (dimmed) {
        mesh.material.opacity = 0.3;
        mesh.material.transparent = true;
      } else {
        mesh.material.opacity = 1.0;
        mesh.material.transparent = false;
      }

      mesh.updateMatrix();
    }

    // Remove stale meshes
    for (const [id, mesh] of this._meshMap) {
      if (!seen.has(id)) {
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this._meshMap.delete(id);
      }
    }
  }

  /**
   * Dispose all meshes and clear the map.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const [, mesh] of this._meshMap) {
      if (parentGroup) parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshMap.clear();
  }
}
