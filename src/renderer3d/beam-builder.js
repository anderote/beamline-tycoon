// src/renderer3d/beam-builder.js — batched glowing beam paths.
// THREE is loaded as a CDN global — do NOT import it.

import { sampleBeamVisualProfile } from './beam-visual-mode.js';
import { BLOOM_LAYER } from './glow-pipeline.js';

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
    this._motionAxis = new THREE.Vector3(0, 1, 0);
    this._motionPosition = new THREE.Vector3();
    this._motionRotation = new THREE.Quaternion();
    this._motionScale = new THREE.Vector3();
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
      const profile = path.visualProfile || [];
      const hasContinuous = profile.length
        ? profile.some(sample => sample.bunch < 0.99)
        : mode === 'continuous';
      const hasBunched = profile.length
        ? profile.some(sample => sample.bunch > 0.01)
        : mode === 'bunched';
      const mixed = hasContinuous && hasBunched;
      const coreOpacity = (mixed ? 0.30 : hasContinuous ? 0.64 : 0.16) * opacityScale;
      const glowOpacity = (mixed ? 0.10 : hasContinuous ? 0.18 : 0.05) * opacityScale;
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

      const run = this._makePacketRun(points, profile, mode);
      if (!run) continue;
      this._packetRuns.push(run);

      const movingStyles = [];
      if (hasBunched) {
        movingStyles.push(
          { role: 'bunch-pixel', packetKind: 'bunch', radius: 0.052,
            xScale: 1, opacity: 0.96 * opacityScale },
        );
      }
      if (hasContinuous) {
        // Closely spaced pixels slide over the unbroken low-opacity core. The
        // core keeps DC delivery visually steady while the pixels communicate
        // direction and the beta-derived speed.
        movingStyles.push(
          { role: 'dc-pixel', packetKind: 'dc', radius: 0.036,
            xScale: 1, opacity: 0.74 * opacityScale },
        );
      }
      for (const style of movingStyles) {
        const bucket = bucketFor(packetBuckets, `${style.role}:${opacityScale}`, style);
        for (const packet of run.packets) {
          if (packet.kind === style.packetKind) bucket.entries.push({ run, packet, color });
        }
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
      const size = bucket.radius * 2;
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: bucket.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const entries = bucket.entries.map(({ run, packet, color }) => {
        const point = this._pointAt(run, packet.distance);
        const motion = this._motionAt(run, packet.distance);
        const matrix = this._motionMatrix(
          point, motion, bucket.role, bucket.xScale, new THREE.Matrix4(),
        );
        return { matrix, color };
      });
      const mesh = makeInstancedMesh(`beam-${bucket.role}`, geometry, material, entries, true);
      mesh.layers.enable(BLOOM_LAYER);
      bucket.entries.forEach(({ packet }, index) => {
        packet.instances[bucket.role] = { mesh, index, xScale: bucket.xScale };
      });
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }
    this.setDetailLevel(this._showDetail);
  }

  _makePacketRun(points, profile, fallbackMode) {
    const lengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      lengths.push(total);
    }
    if (total < 0.01) return null;
    const dcCount = Math.max(8, Math.min(56, Math.ceil(total / 0.34)));
    const bunchCount = Math.max(2, Math.min(14, Math.ceil(total / 1.65)));
    const packets = [];
    for (let i = 0; i < dcCount; i++) {
      packets.push({
        kind: 'dc', distance: (i / dcCount) * total, instances: {},
      });
    }
    // Four adjacent pixels read as one compact bunch; the large empty gap to
    // the next group makes RF capture immediately legible at world scale.
    for (let group = 0; group < bunchCount; group++) {
      const center = (group / bunchCount) * total;
      for (let pixel = 0; pixel < 4; pixel++) {
        packets.push({
          kind: 'bunch',
          distance: (center + (pixel - 1.5) * 0.075 + total) % total,
          instances: {},
        });
      }
    }
    return {
      points, lengths, total, profile, fallbackMode,
      packets,
    };
  }

  setDetailLevel(showDetail) {
    this._showDetail = !!showDetail;
    for (const mesh of this._meshes) {
      if (mesh.name.includes('glow')) {
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
      for (const packet of run.packets) {
        const motion = this._motionAt(run, packet.distance);
        packet.distance = (packet.distance + dtSeconds * motion.speed) % run.total;
        const nextPoint = this._pointAt(run, packet.distance);
        const nextMotion = this._motionAt(run, packet.distance);
        for (const [role, instance] of Object.entries(packet.instances)) {
          this._motionMatrix(nextPoint, nextMotion, role, instance.xScale, matrix);
          instance.mesh.setMatrixAt(instance.index, matrix);
          touched.add(instance.mesh);
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
          rotationY: -Math.atan2(b.z - a.z, b.x - a.x),
        };
      }
      previousEnd = end;
    }
    return run.points[run.points.length - 1];
  }

  _motionAt(run, distance) {
    const normalized = run.total > 0 ? distance / run.total : 0;
    return sampleBeamVisualProfile(run.profile, normalized, run.fallbackMode);
  }

  _motionMatrix(point, motion, role, xScale, matrix) {
    const visibility = role.startsWith('bunch-') ? motion.bunch : 1 - motion.bunch;
    // Scaling to almost zero gives a soft geometry crossfade between the
    // continuous crest and packet train without per-instance materials.
    const visibleScale = Math.max(0.0001, visibility);
    this._motionPosition.set(point.x, point.y, point.z);
    this._motionRotation.setFromAxisAngle(this._motionAxis, point.rotationY || 0);
    this._motionScale.set(xScale * visibleScale, visibleScale, visibleScale);
    return matrix.compose(this._motionPosition, this._motionRotation, this._motionScale);
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
