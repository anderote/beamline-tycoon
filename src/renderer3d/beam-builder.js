// src/renderer3d/beam-builder.js — renders beam paths as glowing tube geometry
// THREE is loaded as a CDN global — do NOT import it

export class BeamBuilder {
  constructor() {
    this._meshes = [];
  }

  build(beamPathData, parentGroup) {
    this.dispose(parentGroup);

    if (!beamPathData || beamPathData.length === 0) return;

    for (const path of beamPathData) {
      const { nodePositions, dimmed } = path;
      if (!nodePositions || nodePositions.length < 2) continue;

      const coreMat = new THREE.MeshBasicMaterial({
        color: 0x44ff44,
        transparent: true,
        opacity: 0.7 * (dimmed ? 0.3 : 1.0),
      });

      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x44ff44,
        transparent: true,
        opacity: 0.2 * (dimmed ? 0.3 : 1.0),
      });

      for (let i = 0; i < nodePositions.length - 1; i++) {
        const nodeA = nodePositions[i];
        const nodeB = nodePositions[i + 1];

        const tileA = nodeA.tiles[Math.floor(nodeA.tiles.length / 2)];
        const tileB = nodeB.tiles[Math.floor(nodeB.tiles.length / 2)];

        if (!tileA || !tileB) continue;

        const x1 = tileA.col * 2 + 1;
        const y1 = 0.5;
        const z1 = tileA.row * 2 + 1;

        const x2 = tileB.col * 2 + 1;
        const y2 = 0.5;
        const z2 = tileB.row * 2 + 1;

        const dx = x2 - x1;
        const dz = z2 - z1;
        const distance = Math.sqrt(dx * dx + (y2 - y1) * (y2 - y1) + dz * dz);

        if (distance < 0.01) continue;

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const midZ = (z1 + z2) / 2;

        const rotY = -Math.atan2(dz, dx);

        // Core beam
        const coreGeo = new THREE.CylinderGeometry(0.05, 0.05, distance, 4);
        coreGeo.rotateZ(Math.PI / 2);
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.position.set(midX, midY, midZ);
        coreMesh.rotation.y = rotY;
        coreMesh.matrixAutoUpdate = false;
        coreMesh.updateMatrix();
        parentGroup.add(coreMesh);
        this._meshes.push(coreMesh);

        // Glow tube
        const glowGeo = new THREE.CylinderGeometry(0.15, 0.15, distance, 4);
        glowGeo.rotateZ(Math.PI / 2);
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.set(midX, midY, midZ);
        glowMesh.rotation.y = rotY;
        glowMesh.matrixAutoUpdate = false;
        glowMesh.updateMatrix();
        parentGroup.add(glowMesh);
        this._meshes.push(glowMesh);
      }
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
  }
}
