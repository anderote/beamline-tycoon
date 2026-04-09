// src/renderer3d/connection-builder.js
// Renders per-tile connection markers (pipes, cables) as small 3D pips.
// THREE is a CDN global — do NOT import it.

const CONN_COLORS = {
  powerCable:   0xffcc00,
  coolingWater: 0x4488ff,
  cryogenics:   0x88ddff,
  vacuum:       0x888888,
  rfWaveguide:  0xff8844,
  dataFiber:    0x44ff88,
};

const CONN_RADIUS = 0.04;
const CONN_Y = 0.15;

export class ConnectionBuilder {
  constructor() {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
  }

  /**
   * Build connection marker meshes from snapshot data.
   * @param {Array<{ col: number, row: number, type: string }>} connectionData
   * @param {THREE.Group} parentGroup
   */
  build(connectionData, parentGroup) {
    this.dispose(parentGroup);

    if (!connectionData) return;

    for (const conn of connectionData) {
      const color = CONN_COLORS[conn.type] ?? 0x888888;

      const geo = new THREE.CylinderGeometry(CONN_RADIUS, CONN_RADIUS, 0.3, 4);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        metalness: 0.3,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.position.set(conn.col * 2 + 1, CONN_Y, conn.row * 2 + 1);
      mesh.updateMatrix();

      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }
  }

  /**
   * Remove all meshes and dispose resources.
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
