// src/renderer3d/decoration-builder.js
// Renders decorations (trees, shrubs, etc.) as 3D geometry.
// THREE is a CDN global — do NOT import it.

const SUB_UNIT = 0.5;

export class DecorationBuilder {
  constructor() {
    /** @type {THREE.Group[]} */
    this._groups = [];
  }

  // --- Private geometry helpers ---

  _createTree() {
    const group = new THREE.Group();

    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.75;
    trunk.castShadow = true;
    group.add(trunk);

    const canopyGeo = new THREE.SphereGeometry(0.7, 6, 4);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2d8b2d, roughness: 0.8 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 2.0;
    canopy.castShadow = true;
    group.add(canopy);

    return group;
  }

  _createShrub() {
    const group = new THREE.Group();

    const geo = new THREE.SphereGeometry(0.4, 6, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.4;
    mesh.castShadow = true;
    group.add(mesh);

    return group;
  }

  _createDefault() {
    const group = new THREE.Group();

    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.25;
    mesh.castShadow = true;
    group.add(mesh);

    return group;
  }

  /**
   * Build decoration groups from snapshot data.
   * @param {Array} decorationData - Array of decoration objects from WorldSnapshot
   * @param {THREE.Group} parentGroup
   */
  build(decorationData, parentGroup) {
    this.dispose(parentGroup);

    if (!decorationData) return;

    for (const dec of decorationData) {
      let group;

      if (dec.type === 'tree' || dec.tall === true) {
        group = this._createTree();
      } else if (dec.type === 'shrub') {
        group = this._createShrub();
      } else {
        group = this._createDefault();
      }

      const tileX = (dec.col ?? 0) * 2;
      const tileZ = (dec.row ?? 0) * 2;
      const subX = (dec.subCol ?? 2) * SUB_UNIT;
      const subZ = (dec.subRow ?? 2) * SUB_UNIT;
      group.position.set(tileX + subX, 0, tileZ + subZ);

      parentGroup.add(group);
      this._groups.push(group);
    }
  }

  /**
   * Remove all groups and dispose their geometry and materials.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const group of this._groups) {
      parentGroup.remove(group);
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._groups = [];
  }
}
