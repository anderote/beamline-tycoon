// Declarative, scalable presentation effects.
//
// Game/render builders publish descriptors; this system chooses how to draw
// them. Most emitters become instanced emissive geometry and may opt into
// cheap projected spill. A bounded list of moving proxies is offered to
// LightRig for optional real illumination. Producers never allocate THREE
// lights themselves.

import { BLOOM_LAYER, SOFT_GLOW_LAYER } from './glow-pipeline.js';
import {
  positiveModulo, prepareEffectPath, sampleEffectPath, surfaceGlowFactor,
  travellingPulseDistances,
} from './effect-math.js';

export const MAX_EFFECT_PULSES = 512;
const DEFAULT_PATH_PULSE_BUDGET = 384;
const DEFAULT_LIGHT_PROXY_BUDGET = 96;
const FLOOR_Y = 0.022;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function effectColor(value) {
  return value ?? 0xffffff;
}

function makePulseMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
  });
}

function makeSpillMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });
}

export class VisualEffectSystem {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.enabled = opts.enabled !== undefined ? !!opts.enabled : true;
    this._pulseBudget = Math.min(MAX_EFFECT_PULSES, Math.max(
      0, Math.floor(opts.pulseBudget ?? DEFAULT_PATH_PULSE_BUDGET),
    ));
    this._proxyBudget = Math.max(0, Math.floor(
      opts.lightProxyBudget ?? DEFAULT_LIGHT_PROXY_BUDGET,
    ));
    this._effects = new Map();
    this._surfaceEffects = new Map();
    this._bursts = [];
    this._flashHandler = null;
    this._time = 0;
    this._stats = {
      descriptors: 0, surfaceGlows: 0, pathPulses: 0, bursts: 0,
      lightCandidates: 0, droppedPulses: 0,
    };

    this.group = new THREE.Group();
    this.group.name = 'visualEffects';
    scene.add(this.group);

    this._pulseMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8), makePulseMaterial(), MAX_EFFECT_PULSES,
    );
    this._pulseMesh.name = 'effectPulseInstances';
    this._pulseMesh.count = 0;
    this._pulseMesh.frustumCulled = false;
    this._pulseMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
    this._pulseMesh.layers.enable(BLOOM_LAYER);
    this.group.add(this._pulseMesh);

    this._spillMesh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20), makeSpillMaterial(), MAX_EFFECT_PULSES,
    );
    this._spillMesh.name = 'effectGroundSpillInstances';
    this._spillMesh.count = 0;
    this._spillMesh.frustumCulled = false;
    this._spillMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
    this._spillMesh.layers.enable(SOFT_GLOW_LAYER);
    this.group.add(this._spillMesh);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._pulseQuat = new THREE.Quaternion();
    this._burstQuat = new THREE.Quaternion();
    this._pulseAxis = new THREE.Vector3(0, 0, 1);
    this._pulseTangent = new THREE.Vector3();
    this._tangentBefore = { x: 0, y: 0, z: 0 };
    this._tangentAfter = { x: 0, y: 0, z: 0 };
    this._floorQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -Math.PI / 2,
    );
    this._sample = { x: 0, y: 0, z: 0 };
    this._color = new THREE.Color();

    // Plain Object3Ds are cheap moving positions, not lights. LightRig may
    // assign its fixed physical-light pool to the most useful subset.
    this._lightProxies = [];
    for (let i = 0; i < this._proxyBudget; i++) {
      const proxy = new THREE.Object3D();
      proxy.visible = false;
      proxy.userData.effectLightEmitter = null;
      this._lightProxies.push(proxy);
    }
  }

  get lightEmitters() {
    return this._lightProxies;
  }

  setFlashHandler(handler) {
    this._flashHandler = typeof handler === 'function' ? handler : null;
  }

  /** Public one-shot entry point used by gameplay events. */
  flash(position, color, intensity, durationMs) {
    return this.emit({
      kind: 'flash', position, color, intensity, durationMs,
      radius: 0.2, groundRadius: 1.1,
    });
  }

  /**
   * Emit a transient visual packet. Game systems call this API and never need
   * to know whether it becomes bloom, projected spill, or a pooled real light.
   */
  emit(raw) {
    if (!this.enabled || !raw?.position) return null;
    if (raw.kind !== 'burst' && raw.kind !== 'flash') return null;
    const durationMs = Math.max(1, Number(raw.durationMs) || 450);
    const burst = {
      ...raw,
      position: {
        x: Number(raw.position.x) || 0,
        y: Number(raw.position.y) || 0,
        z: Number(raw.position.z) || 0,
      },
      duration: durationMs / 1000,
      age: 0,
    };
    this._bursts.push(burst);
    if (raw.physicalLight !== false && this._flashHandler) {
      this._flashHandler(
        burst.position, effectColor(raw.color), Number(raw.intensity) || 8, durationMs,
      );
    }
    return burst;
  }

  /** Replace one named producer scope atomically (e.g. all utility lines). */
  syncScope(scopeId, descriptors) {
    const prefix = `${scopeId}:`;
    for (const key of [...this._effects.keys()]) {
      if (key.startsWith(prefix)) this._effects.delete(key);
    }
    for (const raw of descriptors || []) {
      if (!raw?.id || raw.kind !== 'pathPulse') continue;
      const path = prepareEffectPath(raw.path);
      if (path.length <= 0) continue;
      const id = `${prefix}${raw.id}`;
      this._effects.set(id, { ...raw, id, path });
    }
    this._assignLightProxyRanges();
    this._stats.descriptors = this._effects.size;
  }

  _assignLightProxyRanges() {
    const requests = [];
    for (const effect of this._effects.values()) {
      const desired = effect.light === false
        ? 0 : Math.max(1, Math.ceil(effect.path.length / Math.max(0.05, effect.period || 1)) + 1);
      requests.push({ effect, desired, assigned: 0 });
    }

    // Share the bounded proxy pool in rounds. Every light-capable run gets one
    // moving candidate before any dense/long run gets its second. This keeps
    // early-created power cables from monopolizing the pool merely because
    // their pulse spacing is short; LightRig performs the camera ranking over
    // the resulting candidates each frame.
    let remaining = this._lightProxies.length;
    while (remaining > 0) {
      let progressed = false;
      for (const request of requests) {
        if (remaining <= 0) break;
        if (request.assigned >= request.desired) continue;
        request.assigned++;
        remaining--;
        progressed = true;
      }
      if (!progressed) break;
    }

    let cursor = 0;
    for (const request of requests) {
      request.effect.proxyStart = cursor;
      request.effect.proxyCount = request.assigned;
      request.effect.proxyCycleCount = request.desired;
      cursor += request.assigned;
    }
  }

  /** Discover declarative descriptors attached by scene builders. */
  syncFromGroup(scopeId, root) {
    const descriptors = [];
    root?.traverse?.((obj) => {
      const list = obj.userData?.visualEffects;
      if (Array.isArray(list)) descriptors.push(...list);
    });
    this.syncScope(scopeId, descriptors);
  }

  /**
   * Register emissive machine parts. Each placement gets a material clone so
   * its game state/profile can animate independently; shader programs remain
   * shared because the material structure is unchanged.
   */
  syncSurfaceGlows(scopeId, root) {
    const prefix = `${scopeId}:`;
    const seen = new Set();
    root?.traverse?.((mesh) => {
      if (!mesh?.isMesh || mesh.userData?.role !== 'glow') return;
      let wrapper = mesh.parent;
      while (wrapper && wrapper !== root && wrapper.userData?.nodeId == null) wrapper = wrapper.parent;
      const nodeId = wrapper?.userData?.nodeId ?? mesh.uuid;
      const key = `${prefix}${nodeId}:${mesh.uuid}`;
      seen.add(key);
      if (this._surfaceEffects.has(key)) return;
      const sourceMaterial = mesh.material;
      if (!sourceMaterial?.clone) return;
      const material = sourceMaterial.clone();
      mesh.material = material;
      this._surfaceEffects.set(key, {
        key, mesh, wrapper, material, sourceMaterial,
        profile: mesh.userData.effectProfile || 'steady',
      });
    });
    for (const [key, record] of this._surfaceEffects) {
      if (!key.startsWith(prefix) || seen.has(key)) continue;
      if (record.mesh.material === record.material) record.mesh.material = record.sourceMaterial;
      record.material.dispose?.();
      this._surfaceEffects.delete(key);
    }
    this._stats.surfaceGlows = this._surfaceEffects.size;
  }

  setEnabled(value) {
    this.enabled = !!value;
    this.group.visible = this.enabled;
    if (!this.enabled) this._parkAll();
  }

  setQuality(quality = {}) {
    this._pulseBudget = Math.min(MAX_EFFECT_PULSES, Math.max(
      0, Math.floor(quality.effectPulseCount ?? this._pulseBudget),
    ));
  }

  getStats() {
    return { ...this._stats, pulseBudget: this._pulseBudget, lightProxyBudget: this._proxyBudget };
  }

  update(dtSeconds, darkness = 0) {
    const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
    this._time += dt;
    if (!this.enabled) return;

    let instanceIndex = 0;
    let spillIndex = 0;
    let activeProxyCount = 0;
    let requested = 0;
    for (const proxy of this._lightProxies) {
      proxy.visible = false;
      proxy.userData.effectLightEmitter = null;
    }

    // One-shot gameplay feedback is short-lived and should remain visible even
    // when a large utility network is already consuming the pulse budget.
    const liveBursts = [];
    for (const burst of this._bursts) {
      burst.age += dt;
      const t = Math.min(1, burst.age / burst.duration);
      if (t >= 1) continue;
      requested++;
      if (instanceIndex < this._pulseBudget) {
        const writesSpill = burst.groundSpill !== false;
        this._writeBurstInstance(instanceIndex, writesSpill ? spillIndex : -1, burst, t);
        instanceIndex++;
        if (writesSpill) spillIndex++;
      }
      liveBursts.push(burst);
    }
    this._bursts = liveBursts;
    const burstInstanceCount = instanceIndex;

    for (const effect of this._effects.values()) {
      if (effect.enabled === false || effect.state === 'hard') continue;
      // Some effects need only their moving light proxy. Utility lines use
      // this to add bounded nearby illumination without drawing a travelling
      // shape over the animated colour already carried by the line material.
      if (effect.crest !== false) {
        const distances = travellingPulseDistances(
          effect.path.length, effect.period, effect.speed, this._time, effect.phase || 0,
        );
        for (const distance of distances) {
          requested++;
          const point = sampleEffectPath(effect.path, distance, this._sample);
          if (!point) continue;
          const strength = this._pathPulseStrength(effect);

          if (instanceIndex < this._pulseBudget) {
            const writesSpill = effect.groundSpill !== false;
            this._writePulseInstance(
              instanceIndex, writesSpill ? spillIndex : -1,
              point, effect, strength, distance,
            );
            instanceIndex++;
            if (writesSpill) spillIndex++;
          }
        }
      }
      activeProxyCount += this._updateEffectLightProxies(effect, darkness);
    }
    const pathPulseCount = instanceIndex - burstInstanceCount;

    this._pulseMesh.count = instanceIndex;
    this._spillMesh.count = spillIndex;
    this._pulseMesh.instanceMatrix.needsUpdate = true;
    this._spillMesh.instanceMatrix.needsUpdate = true;
    if (this._pulseMesh.instanceColor) this._pulseMesh.instanceColor.needsUpdate = true;
    if (this._spillMesh.instanceColor) this._spillMesh.instanceColor.needsUpdate = true;
    this._stats.pathPulses = pathPulseCount;
    this._stats.bursts = this._bursts.length;
    this._stats.lightCandidates = activeProxyCount;
    this._stats.droppedPulses = Math.max(0, requested - instanceIndex);
    this._updateSurfaceGlows();
  }

  _updateSurfaceGlows() {
    for (const record of this._surfaceEffects.values()) {
      const state = record.wrapper?.userData?.effectState || 'on';
      const base = Number(record.sourceMaterial.emissiveIntensity) || 1;
      record.material.emissiveIntensity = base * surfaceGlowFactor(
        record.profile, record.key, this._time, state,
      );
    }
  }

  _pathPulseStrength(effect) {
    if (effect.state !== 'soft') return 1;
    // Smooth, shallow modulation preserves the "strained network" read
    // without switching every pulse and its local light hard on/off.
    return 0.46 + 0.14 * (0.5 + 0.5 * Math.sin(this._time * 6));
  }

  _writePulseInstance(index, spillIndex, point, effect, strength, distance) {
    const radius = Math.max(0.025, Number(effect.radius) || 0.09) * strength;
    const sampleSpan = Math.min(0.12, Math.max(0.025, effect.path.length * 0.02));
    const before = sampleEffectPath(effect.path, distance - sampleSpan, this._tangentBefore);
    const after = sampleEffectPath(effect.path, distance + sampleSpan, this._tangentAfter);
    if (before && after) {
      this._pulseTangent.set(
        after.x - before.x,
        after.y - before.y,
        after.z - before.z,
      );
      if (this._pulseTangent.lengthSq() > 1e-8) {
        this._pulseTangent.normalize();
        this._pulseQuat.setFromUnitVectors(this._pulseAxis, this._pulseTangent);
      } else {
        this._pulseQuat.identity();
      }
    }
    this._position.set(point.x, point.y, point.z);
    // Producers can choose a silhouette without adding geometry or draw
    // calls: a short wide RF disc, a long water slug, a data pinprick, etc.
    // The legacy defaults remain a short luminous traveling streak.
    const radialScale = Math.max(0.1, Number(effect.radialScale) || 0.72);
    const lengthScale = Math.max(0.1, Number(effect.lengthScale) || 2.65);
    this._scale.set(radius * radialScale, radius * radialScale, radius * lengthScale);
    this._matrix.compose(this._position, this._pulseQuat, this._scale);
    this._pulseMesh.setMatrixAt(index, this._matrix);
    this._color.set(effectColor(effect.color)).multiplyScalar(Math.max(0.35, strength));
    this._pulseMesh.setColorAt(index, this._color);

    if (spillIndex < 0) return;
    const spillRadius = Math.max(radius * 2, Number(effect.groundRadius) || 0.48);
    this._position.set(point.x, effect.floorY ?? FLOOR_Y, point.z);
    this._scale.set(spillRadius, spillRadius, spillRadius);
    this._matrix.compose(this._position, this._floorQuat, this._scale);
    this._spillMesh.setMatrixAt(spillIndex, this._matrix);
    this._spillMesh.setColorAt(spillIndex, this._color);
  }

  _writeLightProxy(index, point, effect, strength, darkness) {
    const proxy = this._lightProxies[index];
    proxy.visible = true;
    proxy.position.set(point.x, Math.max(FLOOR_Y + 0.08, point.y), point.z);
    const light = effect.light || {};
    const dayFloor = clamp01(light.daylightFloor ?? 0.35);
    const darkScale = dayFloor + (1 - dayFloor) * clamp01(darkness);
    proxy.userData.effectLightEmitter = {
      color: effectColor(effect.color),
      intensity: (Number(light.intensity) || 0.55) * strength * darkScale,
      distance: Number(light.distance) || 3,
      preScaled: true,
    };
  }

  _writeBurstInstance(index, spillIndex, burst, t) {
    const fade = (1 - t) * (1 - t);
    const radius = Math.max(0.03, Number(burst.radius) || 0.16) * (0.65 + t * 1.8);
    this._position.set(burst.position.x, burst.position.y, burst.position.z);
    this._scale.set(radius, radius, radius);
    this._matrix.compose(this._position, this._burstQuat, this._scale);
    this._pulseMesh.setMatrixAt(index, this._matrix);
    this._color.set(effectColor(burst.color)).multiplyScalar(Math.max(0.2, fade));
    this._pulseMesh.setColorAt(index, this._color);

    if (spillIndex < 0) return;
    const spillRadius = Math.max(radius * 2, Number(burst.groundRadius) || 0.8) * (0.7 + t);
    this._position.set(burst.position.x, burst.floorY ?? FLOOR_Y, burst.position.z);
    this._scale.set(spillRadius, spillRadius, spillRadius);
    this._matrix.compose(this._position, this._floorQuat, this._scale);
    this._spillMesh.setMatrixAt(spillIndex, this._matrix);
    this._spillMesh.setColorAt(spillIndex, this._color);
  }

  _updateEffectLightProxies(effect, darkness) {
    const count = effect.proxyCount || 0;
    if (!count || effect.light === false) return 0;
    const period = Math.max(0.05, Number(effect.period) || 1);
    // One full train cycle includes an off-path interval. Stable proxy
    // identities cross the sink, park, and later re-enter at the source;
    // subsequent effects never shift indices when that happens.
    const cycleCount = Math.max(count, effect.proxyCycleCount || count);
    const cycleLength = cycleCount * period;
    const phaseDistance = this._time * (Number(effect.speed) || 0) + (effect.phase || 0);
    const strength = this._pathPulseStrength(effect);
    let active = 0;
    for (let i = 0; i < count; i++) {
      // When this effect received fewer proxies than its ideal pulse train,
      // sample evenly across that full train instead of bunching every proxy
      // near the source and shortening the cycle to the assigned count.
      const pulseIndex = Math.floor(i * cycleCount / count);
      const distance = positiveModulo(phaseDistance + pulseIndex * period, cycleLength);
      if (distance > effect.path.length) continue;
      const point = sampleEffectPath(effect.path, distance, this._sample);
      if (!point) continue;
      this._writeLightProxy(effect.proxyStart + i, point, effect, strength, darkness);
      active++;
    }
    return active;
  }

  _parkAll() {
    this._pulseMesh.count = 0;
    this._spillMesh.count = 0;
    this._bursts.length = 0;
    for (const proxy of this._lightProxies) {
      proxy.visible = false;
      proxy.userData.effectLightEmitter = null;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this._pulseMesh.geometry.dispose();
    this._pulseMesh.material.dispose();
    this._spillMesh.geometry.dispose();
    this._spillMesh.material.dispose();
    this._effects.clear();
    this._bursts.length = 0;
    for (const record of this._surfaceEffects.values()) {
      if (record.mesh.material === record.material) record.mesh.material = record.sourceMaterial;
      record.material.dispose?.();
    }
    this._surfaceEffects.clear();
    this._lightProxies.length = 0;
  }
}

export default VisualEffectSystem;
