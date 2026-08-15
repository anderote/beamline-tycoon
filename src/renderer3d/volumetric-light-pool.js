import { SOFT_GLOW_LAYER } from './glow-pipeline.js';
import { MAX_VOLUMETRIC_BEAMS } from './lighting-quality.js';
import { createVolumetricLightMaterial } from './volumetric-light-material.js';

const UP = { x: 0, y: 1, z: 0 };

export class VolumetricLightPool {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxCount = opts.maxCount ?? MAX_VOLUMETRIC_BEAMS;
    this.activeCount = Math.min(this.maxCount, opts.activeCount ?? 0);
    this.enabled = opts.enabled !== false;
    this.modern = opts.modern === true;
    this.group = new THREE.Group();
    this.group.name = 'volumetricLights';
    scene.add(this.group);
    this._geometry = new THREE.ConeGeometry(1, 1, 24, 1, true);
    this._slots = [];
    this._up = new THREE.Vector3(UP.x, UP.y, UP.z);
    this._direction = new THREE.Vector3();
    for (let i = 0; i < this.maxCount; i++) {
      const material = createVolumetricLightMaterial({ modern: this.modern });
      material.uniforms.uPhase.value = i * 1.618;
      const mesh = new THREE.Mesh(this._geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.layers.enable(SOFT_GLOW_LAYER);
      this.group.add(mesh);
      this._slots.push({ mesh, material, key: null, opacity: 0 });
    }
  }

  setQuality(quality = {}) {
    this.activeCount = Math.max(0, Math.min(this.maxCount, quality.volumetricCount ?? this.activeCount));
    for (let i = this.activeCount; i < this._slots.length; i++) this._park(this._slots[i]);
  }

  setEnabled(value) {
    this.enabled = !!value;
    if (!this.enabled) for (const slot of this._slots) this._park(slot);
  }

  update(lightRig, darkness, dt) {
    const candidates = this.enabled && this.activeCount > 0
      ? lightRig?.getVolumeCandidates(this.activeCount) || []
      : [];
    const step = Math.max(0, Number(dt) || 0) / 0.25;
    const time = lightRig?._clockMs || 0;
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      const candidate = i < this.activeCount ? candidates[i] : null;
      const activation = Math.max(0, Math.min(1, candidate?.activation ?? darkness));
      if (!candidate || candidate.volumeProfile === 'none' || activation <= 0.01) {
        slot.opacity = Math.max(0, slot.opacity - step);
        slot.material.uniforms.uOpacity.value = slot.opacity * 0.12;
        if (slot.opacity <= 0) this._park(slot);
        continue;
      }
      this._apply(slot, candidate, darkness, time);
      slot.opacity = Math.min(1, slot.opacity + step);
      slot.material.uniforms.uOpacity.value = slot.opacity * activation * candidate.weight * 0.12;
    }
  }

  _apply(slot, candidate, darkness, timeMs) {
    const { projection } = candidate;
    const dx = projection.emitter.x - projection.target.x;
    const dy = projection.emitter.y - projection.target.y;
    const dz = projection.emitter.z - projection.target.z;
    const length = Math.max(0.05, Math.hypot(dx, dy, dz));
    const radius = Math.max(0.08, Math.tan(projection.halfAngle) * length);
    slot.mesh.visible = true;
    slot.mesh.position.set(
      (projection.emitter.x + projection.target.x) / 2,
      (projection.emitter.y + projection.target.y) / 2,
      (projection.emitter.z + projection.target.z) / 2,
    );
    this._direction.set(dx, dy, dz).normalize();
    slot.mesh.quaternion.setFromUnitVectors(this._up, this._direction);
    slot.mesh.scale.set(radius, length, radius);
    slot.material.uniforms.uColor.value.set(candidate.color);
    slot.material.uniforms.uLength.value = 1;
    slot.material.uniforms.uRadius.value = 1;
    slot.material.uniforms.uTime.value = timeMs / 1000;
    slot.key = candidate.id;
  }

  _park(slot) {
    slot.mesh.visible = false;
    slot.opacity = 0;
    slot.key = null;
    slot.material.uniforms.uOpacity.value = 0;
  }

  getStats() {
    return {
      allocatedVolumes: this.maxCount,
      activeVolumeBudget: this.activeCount,
      visibleVolumes: this._slots.filter((slot) => slot.mesh.visible).length,
    };
  }

  dispose() {
    for (const slot of this._slots) slot.material.dispose();
    this._geometry.dispose();
    this.scene.remove(this.group);
    this._slots.length = 0;
  }
}
