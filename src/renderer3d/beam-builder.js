// src/renderer3d/beam-builder.js — batched glowing beam paths.
// THREE is loaded as a CDN global — do NOT import it.

function routedPoints(path) {
  const authored = (path.worldPoints || []).map(point => ({
    x: point.col * 2 + 1, y: 1.0, z: point.row * 2 + 1,
  }));
  if (authored.length >= 2) return authored;
  return (path.nodePositions || []).map(node => {
    const tile = node.tiles?.[Math.floor(node.tiles.length / 2)];
    return tile ? { x: tile.col * 2 + 1, y: 1.0, z: tile.row * 2 + 1 } : null;
  }).filter(Boolean);
}

function bucketFor(map, key, defaults) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { ...defaults, entries: [] };
    map.set(key, bucket);
  }
  return bucket;
}

function segmentMatrix(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.01) return null;
  const position = new THREE.Vector3(
    (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2,
  );
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), -Math.atan2(dz, dx),
  );
  return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(length, 1, 1));
}

function makeInstancedMesh(name, geometry, material, entries, dynamic = false) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.userData.batchedBeamEffect = true;
  mesh.frustumCulled = false;
  if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < entries.length; i++) {
    mesh.setMatrixAt(i, entries[i].matrix || new THREE.Matrix4());
    if (entries[i].color != null) mesh.setColorAt(i, new THREE.Color(entries[i].color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

export class BeamBuilder {
  constructor() {
    this._meshes = [];
    this._packetRuns = [];
    this._showDetail = true;
  }

  build(beamPathData, parentGroup) {
    this.dispose(parentGroup);
    if (!beamPathData?.length) return;

    const segmentBuckets = new Map();
    const packetBuckets = new Map();
    for (const path of beamPathData) {
      const points = routedPoints(path);
      if (points.length < 2) continue;
      const opacityScale = path.dimmed ? 0.3 : 1;
      const mode = path.visualMode || 'continuous';
      const color = path.color ?? 0x44ff44;
      const coreOpacity = (mode === 'continuous' ? 0.78 : 0.16) * opacityScale;
      const glowOpacity = (mode === 'continuous' ? 0.22 : 0.07) * opacityScale;
      const core = bucketFor(segmentBuckets, `core:${coreOpacity}`, {
        role: 'core', radius: 0.05, opacity: coreOpacity,
      });
      const glow = bucketFor(segmentBuckets, `glow:${glowOpacity}`, {
        role: 'glow', radius: 0.15, opacity: glowOpacity,
      });
      for (let i = 0; i < points.length - 1; i++) {
        const matrix = segmentMatrix(points[i], points[i + 1]);
        if (!matrix) continue;
        core.entries.push({ matrix, color });
        glow.entries.push({ matrix, color });
      }

      if (mode !== 'bunched') continue;
      const run = this._makePacketRun(points);
      if (!run) continue;
      this._packetRuns.push(run);
      const packetCore = bucketFor(packetBuckets, `core:${opacityScale}`, {
        role: 'packet-core', radius: 0.052, segments: 8, rings: 6,
        opacity: 0.92 * opacityScale,
      });
      const packetHalo = bucketFor(packetBuckets, `halo:${opacityScale}`, {
        role: 'packet-halo', radius: 0.14, segments: 10, rings: 8,
        opacity: 0.18 * opacityScale,
      });
      for (const packet of run.packets) {
        packetCore.entries.push({ run, packet, color });
        packetHalo.entries.push({ run, packet, color });
      }
    }

    for (const bucket of segmentBuckets.values()) {
      if (!bucket.entries.length) continue;
      const geometry = new THREE.CylinderGeometry(bucket.radius, bucket.radius, 1, 4);
      geometry.rotateZ(Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: bucket.opacity, depthWrite: false,
      });
      const mesh = makeInstancedMesh(`beam-${bucket.role}`, geometry, material, bucket.entries);
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }

    for (const bucket of packetBuckets.values()) {
      if (!bucket.entries.length) continue;
      const geometry = new THREE.SphereGeometry(
        bucket.radius, bucket.segments, bucket.rings,
      );
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: bucket.opacity, depthWrite: false,
      });
      const entries = bucket.entries.map(({ run, packet, color }) => {
        const point = this._pointAt(run, packet.offset);
        return { matrix: new THREE.Matrix4().makeTranslation(point.x, point.y, point.z), color };
      });
      const mesh = makeInstancedMesh(`beam-${bucket.role}`, geometry, material, entries, true);
      bucket.entries.forEach(({ packet }, index) => {
        if (bucket.role === 'packet-core') {
          packet.coreMesh = mesh; packet.coreIndex = index;
        } else {
          packet.haloMesh = mesh; packet.haloIndex = index;
        }
      });
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }
    this.setDetailLevel(this._showDetail);
  }

  _makePacketRun(points) {
    const lengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      lengths.push(total);
    }
    if (total < 0.01) return null;
    const count = Math.max(2, Math.min(12, Math.ceil(total / 1.6)));
    return {
      points, lengths, total, phase: 0, speed: 3.4,
      packets: Array.from({ length: count }, (_, i) => ({ offset: (i / count) * total })),
    };
  }

  setDetailLevel(showDetail) {
    this._showDetail = !!showDetail;
    for (const mesh of this._meshes) {
      if (mesh.name === 'beam-glow' || mesh.name === 'beam-packet-halo') {
        mesh.visible = this._showDetail;
      }
    }
  }

  /** Advance all packet instances, updating one GPU buffer per shared style. */
  update(dtSeconds) {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const touched = new Set();
    const matrix = new THREE.Matrix4();
    for (const run of this._packetRuns) {
      run.phase = (run.phase + dtSeconds * run.speed) % run.total;
      for (const packet of run.packets) {
        const point = this._pointAt(run, (packet.offset + run.phase) % run.total);
        matrix.makeTranslation(point.x, point.y, point.z);
        if (packet.coreMesh) {
          packet.coreMesh.setMatrixAt(packet.coreIndex, matrix);
          touched.add(packet.coreMesh);
        }
        if (packet.haloMesh) {
          packet.haloMesh.setMatrixAt(packet.haloIndex, matrix);
          touched.add(packet.haloMesh);
        }
      }
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  _pointAt(run, distance) {
    let previousEnd = 0;
    for (let i = 0; i < run.lengths.length; i++) {
      const end = run.lengths[i];
      if (distance <= end || i === run.lengths.length - 1) {
        const a = run.points[i], b = run.points[i + 1];
        const t = (distance - previousEnd) / Math.max(1e-6, end - previousEnd);
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        };
      }
      previousEnd = end;
    }
    return run.points[run.points.length - 1];
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup?.remove(mesh);
      mesh.dispose?.();
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    this._meshes = [];
    this._packetRuns = [];
  }
}
