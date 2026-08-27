// src/renderer3d/beam-builder.js — batched glowing beam paths.
// THREE is loaded as a CDN global — do NOT import it.

import { sampleBeamVisualProfile } from './beam-visual-mode.js';
import { BLOOM_LAYER } from './glow-pipeline.js';
import { particleEffectProfile } from './particle-effect-tuning.js';
import { cyclotronParticlePathPoint } from './cyclotron-presentation.js';

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

function hashUnit(value) {
  const text = String(value ?? 'beam');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function paletteColor(palette, seed) {
  return palette[Math.floor(hashUnit(seed) * palette.length) % palette.length];
}

export class BeamBuilder {
  constructor() {
    this._meshes = [];
    this._packetRuns = [];
    this._specialParticles = [];
    this._time = 0;
    this._showDetail = true;
    this._motionAxis = new THREE.Vector3(0, 1, 0);
    this._motionPosition = new THREE.Vector3();
    this._motionRotation = new THREE.Quaternion();
    this._motionScale = new THREE.Vector3();
    this._specialDirection = new THREE.Vector3();
    this._specialXAxis = new THREE.Vector3(1, 0, 0);
    this._cyclotronPathOptions = {};
    this._cyclotronPathPoint = {};
  }

  build(beamPathData, parentGroup) {
    this.dispose(parentGroup);
    if (!beamPathData?.length) return;

    this._tuning = particleEffectProfile('beamline');
    this._targetTuning = particleEffectProfile('targetRadiation');
    this._synchrotronTuning = particleEffectProfile('synchrotronRadiation');
    this._sourceTuning = particleEffectProfile('sourceFlow');
    this._cyclotronTuning = particleEffectProfile('cyclotron');

    const segmentBuckets = new Map();
    const packetBuckets = new Map();
    const specialBuckets = new Map();
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
      const coreScale = this._tuning.coreOpacity / 0.64;
      const coreOpacity = Math.min(1,
        (mixed ? 0.30 : hasContinuous ? 0.64 : 0.16) * coreScale * opacityScale);
      const glowOpacity = Math.min(1,
        (mixed ? 0.10 : hasContinuous ? 0.18 : 0.05) * coreScale * opacityScale);
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
      this._addRadiationParticles(
        run, path.radiationEvents || [], specialBuckets, opacityScale,
      );
      this._addSourceParticles(run, path.sourceEffect, specialBuckets, opacityScale);

      const movingStyles = [];
      if (hasBunched) {
        movingStyles.push(
          { role: 'bunch-pixel', packetKind: 'bunch', radius: this._tuning.size * 1.45,
            xScale: 1, opacity: Math.min(1, this._tuning.pixelOpacity * 1.22) * opacityScale },
        );
      }
      if (hasContinuous) {
        // Closely spaced pixels slide over the unbroken low-opacity core. The
        // core keeps DC delivery visually steady while the pixels communicate
        // direction and the beta-derived speed.
        movingStyles.push(
          { role: 'dc-pixel', packetKind: 'dc', radius: this._tuning.size,
            xScale: 1, opacity: this._tuning.pixelOpacity * opacityScale },
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
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const entries = bucket.entries.map(({ run, packet, color }) => {
        const point = this._pointAt(run, packet.distance);
        const motion = this._motionAt(run, packet.distance);
        const matrix = this._motionMatrix(
          point, motion, bucket.role, bucket.xScale, new THREE.Matrix4(), packet.phase,
        );
        return { matrix, color };
      });
      const mesh = makeInstancedMesh(`beam-${bucket.role}`, geometry, material, entries, true);
      mesh.layers.enable(BLOOM_LAYER);
      // Beam pixels are an intentional x-ray overlay: beamline hardware does
      // not hide the contents of its own vacuum aperture.
      mesh.renderOrder = 40;
      bucket.entries.forEach(({ packet }, index) => {
        packet.instances[bucket.role] = { mesh, index, xScale: bucket.xScale };
      });
      parentGroup.add(mesh);
      this._meshes.push(mesh);
    }

    for (const bucket of specialBuckets.values()) {
      if (!bucket.entries.length) continue;
      const geometry = new THREE.BoxGeometry(
        bucket.elongated ? 1 : bucket.size,
        bucket.size,
        bucket.size,
      );
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: bucket.opacity,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const entries = bucket.entries.map(({ particle, color }) => ({
        matrix: this._specialMatrix(particle, new THREE.Matrix4()), color,
      }));
      const mesh = makeInstancedMesh(`beam-${bucket.role}`, geometry, material, entries, true);
      mesh.layers.enable(BLOOM_LAYER);
      mesh.renderOrder = 41;
      bucket.entries.forEach(({ particle }, index) => {
        particle.instance = { mesh, index };
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
    const density = this._tuning?.density || 1;
    const dcCount = Math.max(2, Math.min(168, Math.ceil(total / 0.34 * density)));
    const bunchCount = Math.max(1, Math.min(42, Math.ceil(total / 1.65 * density)));
    const packets = [];
    for (let i = 0; i < dcCount; i++) {
      packets.push({
        kind: 'dc', distance: (i / dcCount) * total, phase: i / dcCount, instances: {},
      });
    }
    // Adjacent pixels read as one compact bunch; the large empty gap to
    // the next group makes RF capture immediately legible at world scale.
    for (let group = 0; group < bunchCount; group++) {
      const center = (group / bunchCount) * total;
      const bunchSize = this._tuning?.bunchSize || 4;
      for (let pixel = 0; pixel < bunchSize; pixel++) {
        packets.push({
          kind: 'bunch',
          distance: (center + (pixel - (bunchSize - 1) / 2) * 0.075 + total) % total,
          phase: group / bunchCount + pixel * 0.015,
          instances: {},
        });
      }
    }
    return {
      points, lengths, total, profile, fallbackMode,
      packets,
    };
  }

  _addRadiationParticles(run, events, buckets, opacityScale) {
    for (const event of events || []) {
      const origin = this._pointAt(run, Math.max(0, Math.min(1, event.u || 0)) * run.total);
      const tangentX = origin.tangentX || 1;
      const tangentZ = origin.tangentZ || 0;
      const sideX = -tangentZ;
      const sideZ = tangentX;
      const strength = Math.max(0.05, Math.min(1, Number(event.strength) || 0.55));
      if (event.kind === 'impact') {
        const tuning = this._targetTuning;
        const count = Math.max(6, Math.min(72,
          Math.round((16 + 28 * strength) * tuning.density)));
        const bucket = bucketFor(buckets, `secondary-radiation:${opacityScale}`, {
          role: 'secondary-radiation', size: tuning.size,
          opacity: tuning.brightness * opacityScale, elongated: false,
        });
        const colors = event.endpointType === 'target'
          ? [0xffffff, 0xffe36a, 0x70edff, 0xb77aff]
          : [0xffffff, 0x74eaff, 0x8c9dff, 0xffbd55];
        for (let i = 0; i < count; i++) {
          const seed = `${event.elementId}:impact:${i}`;
          const angle = i * 2.399963 + hashUnit(seed) * 0.5;
          const spread = tuning.spread * (0.32 + hashUnit(`${seed}:spread`) * 0.68);
          const backward = -0.12 - hashUnit(`${seed}:back`) * 0.52;
          const dx = tangentX * backward + sideX * Math.cos(angle) * spread;
          const dy = Math.sin(angle) * spread * 0.62
            + (hashUnit(`${seed}:up`) - 0.35) * 0.42;
          const dz = tangentZ * backward + sideZ * Math.cos(angle) * spread;
          const invLength = 1 / Math.max(1e-6, Math.hypot(dx, dy, dz));
          const particle = {
            kind: 'impact', origin, direction: {
              x: dx * invLength, y: dy * invLength, z: dz * invLength,
            },
            phase: i / count,
            speed: (1.2 + 2.7 * strength) * tuning.speed
              * (0.72 + hashUnit(`${seed}:speed`) * 0.56),
            lifetime: tuning.lifetime * (0.6 + hashUnit(`${seed}:life`) * 0.4),
            strength,
          };
          this._specialParticles.push(particle);
          bucket.entries.push({ particle, color: paletteColor(colors, seed) });
        }
      } else if (event.kind === 'synchrotron') {
        const tuning = this._synchrotronTuning;
        const count = Math.max(3, Math.min(36,
          Math.round((4 + 15 * strength) * tuning.density)));
        const bucket = bucketFor(buckets, `synchrotron-streak:${opacityScale}`, {
          role: 'synchrotron-streak', size: tuning.size,
          opacity: tuning.brightness * opacityScale, elongated: true,
        });
        const colors = [0xffffff, 0x78edff, 0x8fa0ff, 0xc47cff];
        for (let i = 0; i < count; i++) {
          const seed = `${event.elementId}:synch:${i}`;
          const lateral = (hashUnit(`${seed}:side`) - 0.5) * tuning.spread;
          const vertical = (hashUnit(`${seed}:up`) - 0.5) * tuning.spread * 0.55;
          const dx = tangentX + sideX * lateral;
          const dy = vertical;
          const dz = tangentZ + sideZ * lateral;
          const invLength = 1 / Math.max(1e-6, Math.hypot(dx, dy, dz));
          const particle = {
            kind: 'synchrotron', origin, direction: {
              x: dx * invLength, y: dy * invLength, z: dz * invLength,
            },
            phase: i / count,
            speed: (3 + 2.8 * (event.beta || 0.66)) * tuning.speed,
            lifetime: tuning.lifetime * (0.72 + hashUnit(`${seed}:life`) * 0.28),
            streakLength: tuning.streakLength,
            strength,
          };
          this._specialParticles.push(particle);
          bucket.entries.push({ particle, color: paletteColor(colors, seed) });
        }
      }
    }
  }

  _addSourceParticles(run, effect, buckets, opacityScale) {
    if (!effect) return;
    const cyclotron = effect.kind === 'cyclotronSpiral';
    const tuning = cyclotron ? this._cyclotronTuning : this._sourceTuning;
    const countBase = cyclotron ? 38 : 30;
    const count = Math.max(8, Math.min(96, Math.round(countBase * tuning.density)));
    const role = cyclotron ? 'cyclotron-flow' : 'ecr-plasma-flow';
    const bucket = bucketFor(buckets, `${role}:${opacityScale}`, {
      role, size: tuning.size, opacity: tuning.brightness * opacityScale, elongated: false,
    });
    const exit = this._pointAt(run, 0);
    const tangentX = exit.tangentX || 1;
    const tangentZ = exit.tangentZ || 0;
    const centre = {
      x: exit.x - tangentX * effect.sourceLength * 0.5,
      y: exit.y,
      z: exit.z - tangentZ * effect.sourceLength * 0.5,
    };
    const colors = cyclotron
      ? [0xffffff, 0x69edff, 0x6fa2ff]
      : [0xffffff, 0xc05cff, 0x6d8cff, 0x58ecff];
    for (let i = 0; i < count; i++) {
      const seed = `${effect.elementId}:source:${i}`;
      const particle = {
        kind: effect.kind,
        phase: i / count + hashUnit(seed) * 0.02,
        exit,
        centre,
        tangentX,
        tangentZ,
        radius: effect.radius,
        sourceLength: effect.sourceLength,
        orbitExitSide: effect.orbitExitSide,
        orbitExitForward: effect.orbitExitForward,
        channelJoinForward: effect.channelJoinForward,
        exitForward: effect.exitForward,
        speed: tuning.speed * (0.82 + hashUnit(`${seed}:speed`) * 0.36),
        slosh: tuning.slosh,
        turns: cyclotron ? tuning.turns : null,
        orbitScale: cyclotron ? tuning.orbitScale : 1,
        extraction: cyclotron ? tuning.extraction : null,
      };
      this._specialParticles.push(particle);
      bucket.entries.push({ particle, color: paletteColor(colors, seed) });
    }
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
    this._time += Math.min(dtSeconds, 0.1);
    const touched = new Set();
    const matrix = new THREE.Matrix4();
    for (const run of this._packetRuns) {
      for (const packet of run.packets) {
        const motion = this._motionAt(run, packet.distance);
        const liquidSpeed = 1 + 0.08 * (this._tuning?.slosh || 0)
          * Math.sin(this._time * 2.7 + packet.phase * Math.PI * 2);
        packet.distance = (packet.distance + dtSeconds * motion.speed * liquidSpeed) % run.total;
        const nextPoint = this._pointAt(run, packet.distance);
        const nextMotion = this._motionAt(run, packet.distance);
        for (const [role, instance] of Object.entries(packet.instances)) {
          this._motionMatrix(
            nextPoint, nextMotion, role, instance.xScale, matrix, packet.phase,
          );
          instance.mesh.setMatrixAt(instance.index, matrix);
          touched.add(instance.mesh);
        }
      }
    }
    for (const particle of this._specialParticles) {
      if (!particle.instance) continue;
      this._specialMatrix(particle, matrix);
      particle.instance.mesh.setMatrixAt(particle.instance.index, matrix);
      touched.add(particle.instance.mesh);
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
          tangentX: (b.x - a.x) / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z)),
          tangentZ: (b.z - a.z) / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z)),
        };
      }
      previousEnd = end;
    }
    return run.points[run.points.length - 1];
  }

  _motionAt(run, distance) {
    const normalized = run.total > 0 ? distance / run.total : 0;
    const motion = sampleBeamVisualProfile(run.profile, normalized, run.fallbackMode);
    return { ...motion, speed: motion.speed * (this._tuning?.speed || 1) };
  }

  _motionMatrix(point, motion, role, xScale, matrix, phase = 0) {
    const visibility = role.startsWith('bunch-') ? motion.bunch : 1 - motion.bunch;
    // Scaling to almost zero gives a soft geometry crossfade between the
    // continuous crest and packet train without per-instance materials.
    const visibleScale = Math.max(0.0001, visibility);
    const slosh = this._tuning?.slosh || 0;
    const wave = Math.sin(this._time * 3.1 + phase * Math.PI * 2);
    const cross = wave * 0.024 * slosh;
    this._motionPosition.set(
      point.x - (point.tangentZ || 0) * cross,
      point.y + Math.sin(this._time * 2.2 + phase * 11.7) * 0.014 * slosh,
      point.z + (point.tangentX || 1) * cross,
    );
    this._motionRotation.setFromAxisAngle(this._motionAxis, point.rotationY || 0);
    this._motionScale.set(xScale * visibleScale, visibleScale, visibleScale);
    return matrix.compose(this._motionPosition, this._motionRotation, this._motionScale);
  }

  _specialMatrix(particle, matrix) {
    const cycle = particle.kind === 'impact' || particle.kind === 'synchrotron'
      ? this._time / Math.max(0.05, particle.lifetime)
      : this._time * 0.24 * particle.speed;
    const progress = ((cycle + particle.phase) % 1 + 1) % 1;
    let x, y, z, scale = 1;
    if (particle.kind === 'impact' || particle.kind === 'synchrotron') {
      const distance = progress * particle.speed * particle.lifetime;
      x = particle.origin.x + particle.direction.x * distance;
      y = particle.origin.y + particle.direction.y * distance;
      z = particle.origin.z + particle.direction.z * distance;
      scale = Math.max(0.02, (1 - progress) * (0.55 + particle.strength * 0.65));
      this._motionPosition.set(x, y, z);
      if (particle.kind === 'synchrotron') {
        this._specialDirection.set(
          particle.direction.x, particle.direction.y, particle.direction.z,
        );
        this._motionRotation.setFromUnitVectors(this._specialXAxis, this._specialDirection);
        this._motionScale.set(
          particle.streakLength * (0.65 + particle.strength) * scale,
          scale,
          scale,
        );
      } else {
        this._motionRotation.identity();
        this._motionScale.setScalar(scale);
      }
      return matrix.compose(this._motionPosition, this._motionRotation, this._motionScale);
    }

    const sideX = -particle.tangentZ;
    const sideZ = particle.tangentX;
    if (particle.kind === 'cyclotronSpiral') {
      const pathOptions = this._cyclotronPathOptions;
      pathOptions.progress = progress;
      pathOptions.orbitEnd = particle.extraction;
      pathOptions.turns = particle.turns;
      pathOptions.orbitScale = particle.orbitScale;
      pathOptions.angularWobble = Math.sin(this._time * 1.9 + particle.phase * 17)
        * 0.08 * particle.slosh;
      const point = cyclotronParticlePathPoint(
        particle, pathOptions, this._cyclotronPathPoint,
      );
      const angle = point.angle;
      x = particle.centre.x + sideX * point.side + particle.tangentX * point.forward;
      z = particle.centre.z + sideZ * point.side + particle.tangentZ * point.forward;
      y = particle.centre.y
        + Math.sin(angle * 0.5 + this._time * 2) * 0.035 * particle.slosh
          * point.verticalWobbleScale;
      scale = 0.68 + 0.32 * Math.sin(progress * Math.PI);
    } else {
      const angle = progress * Math.PI * 12 + this._time * 2.4
        + particle.phase * Math.PI * 2;
      const radius = particle.radius * Math.pow(1 - progress, 0.68)
        * (0.78 + 0.22 * Math.sin(this._time * 2.1 + particle.phase * 19) * particle.slosh);
      const axial = (-0.25 + progress * 0.75) * particle.sourceLength;
      x = particle.centre.x + particle.tangentX * axial + sideX * Math.cos(angle) * radius;
      z = particle.centre.z + particle.tangentZ * axial + sideZ * Math.cos(angle) * radius;
      y = particle.centre.y + Math.sin(angle) * radius * 0.72;
      scale = 0.72 + 0.28 * Math.sin(progress * Math.PI);
    }
    this._motionPosition.set(x, y, z);
    this._motionRotation.identity();
    this._motionScale.setScalar(scale);
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
    this._specialParticles = [];
  }
}
