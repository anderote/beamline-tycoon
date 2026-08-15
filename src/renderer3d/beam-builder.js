// src/renderer3d/beam-builder.js — renders beam paths as glowing tube geometry
// THREE is loaded as a CDN global — do NOT import it

export class BeamBuilder {
  constructor() {
    this._meshes = [];
    this._packetRuns = [];
  }

  build(beamPathData, parentGroup) {
    this.dispose(parentGroup);

    if (!beamPathData || beamPathData.length === 0) return;

    for (const path of beamPathData) {
      const { nodePositions, worldPoints, dimmed, visualMode = 'continuous', color = 0x44ff44 } = path;
      if (!nodePositions || nodePositions.length < 2) continue;

      const routedPoints = (worldPoints || []).map(point => ({
        x: point.col * 2 + 1, y: 1.0, z: point.row * 2 + 1,
      }));
      const points = routedPoints.length >= 2 ? routedPoints : nodePositions.map(node => {
        const tile = node.tiles?.[Math.floor(node.tiles.length / 2)];
        return tile ? { x: tile.col * 2 + 1, y: 1.0, z: tile.row * 2 + 1 } : null;
      }).filter(Boolean);
      if (points.length < 2) continue;
      const opacity = dimmed ? 0.3 : 1.0;

      const coreMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: (visualMode === 'continuous' ? 0.78 : 0.16) * opacity,
        depthWrite: false,
      });

      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: (visualMode === 'continuous' ? 0.22 : 0.07) * opacity,
        depthWrite: false,
      });

      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const x1 = a.x, y1 = a.y, z1 = a.z;
        const x2 = b.x, y2 = b.y, z2 = b.z;

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

      if (visualMode === 'bunched') this._buildPackets(points, color, opacity, parentGroup);
    }
  }

  _buildPackets(points, color, opacity, parentGroup) {
    const lengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      lengths.push(total);
    }
    if (total < 0.01) return;

    const spacing = 1.6; // world metres: readable packet spacing, not RF scale
    const count = Math.max(2, Math.min(12, Math.ceil(total / spacing)));
    const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 * opacity, depthWrite: false });
    const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 * opacity, depthWrite: false });
    const packets = [];
    for (let i = 0; i < count; i++) {
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), haloMat);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), coreMat);
      parentGroup.add(halo, core);
      this._meshes.push(halo, core);
      packets.push({ core, halo, offset: (i / count) * total });
    }
    this._packetRuns.push({ points, lengths, total, packets, phase: 0, speed: 3.4 });
  }

  /** Advance the human-readable packet train; continuous beams need no tick. */
  update(dtSeconds) {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    for (const run of this._packetRuns) {
      run.phase = (run.phase + dtSeconds * run.speed) % run.total;
      for (const packet of run.packets) {
        const p = this._pointAt(run, (packet.offset + run.phase) % run.total);
        packet.core.position.set(p.x, p.y, p.z);
        packet.halo.position.set(p.x, p.y, p.z);
      }
    }
  }

  _pointAt(run, distance) {
    let prevEnd = 0;
    for (let i = 0; i < run.lengths.length; i++) {
      const end = run.lengths[i];
      if (distance <= end || i === run.lengths.length - 1) {
        const a = run.points[i], b = run.points[i + 1];
        const t = (distance - prevEnd) / Math.max(1e-6, end - prevEnd);
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        };
      }
      prevEnd = end;
    }
    return run.points[run.points.length - 1];
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
    this._packetRuns = [];
  }
}
