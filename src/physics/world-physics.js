import { Matrix4, Quaternion, Vector3 } from 'three';
import { geometryMassProperties } from './geometry-mass-properties.js';

const DEFAULT_FIXED_STEP = 1 / 60;
const DEFAULT_MAX_SUBSTEPS = 4;
const _worldPosition = new Vector3();
const _worldQuaternion = new Quaternion();
const _worldScale = new Vector3();
const _matrix = new Matrix4();
const _parentInverse = new Matrix4();
const _localMatrix = new Matrix4();
const _direction = new Vector3();
const _point = new Vector3();

function finiteVector(value, fallback = 0) {
  return {
    x: Number.isFinite(value?.x) ? value.x : fallback,
    y: Number.isFinite(value?.y) ? value.y : fallback,
    z: Number.isFinite(value?.z) ? value.z : fallback,
  };
}

function finiteRotation(value) {
  return {
    x: Number.isFinite(value?.x) ? value.x : 0,
    y: Number.isFinite(value?.y) ? value.y : 0,
    z: Number.isFinite(value?.z) ? value.z : 0,
    w: Number.isFinite(value?.w) ? value.w : 1,
  };
}

/** Rust/WASM rigid-body world kept behind a renderer-friendly Object3D seam. */
export class WorldPhysics {
  constructor(options = {}) {
    this.gravity = finiteVector(options.gravity || { x: 0, y: -9.81, z: 0 });
    this.fixedStep = Math.max(1 / 240, Number(options.fixedStep) || DEFAULT_FIXED_STEP);
    this.maxSubsteps = Math.max(1, Math.floor(options.maxSubsteps || DEFAULT_MAX_SUBSTEPS));
    this.rapier = options.rapier || null;
    this.world = null;
    this.ready = false;
    this.accumulator = 0;
    this.records = new Map();
    this.joints = new Set();
    this._nextId = 1;
    this._ground = null;
    this._terrain = null;
    this._terrainSource = null;
    this.stats = { steps: 0, droppedTime: 0, activeBodies: 0, sleepingBodies: 0 };
  }

  async init() {
    if (this.ready) return this;
    if (!this.rapier) {
      const module = await import('@dimforge/rapier3d-compat');
      this.rapier = module.default || module;
      await this.rapier.init();
    }
    this.world = new this.rapier.World(this.gravity);
    this.world.timestep = this.fixedStep;
    this.ready = true;
    return this;
  }

  addGround({ y = 0, halfWidth = 500, halfDepth = 500, thickness = 0.5 } = {}) {
    if (!this.ready) throw new Error('WorldPhysics.init() must complete before addGround()');
    if (this._ground) this.world.removeRigidBody(this._ground);
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, y - thickness / 2, 0),
    );
    const collider = this.rapier.ColliderDesc.cuboid(halfWidth, thickness / 2, halfDepth)
      .setFriction(0.8)
      .setRestitution(0.05);
    this.world.createCollider(collider, body);
    this._ground = body;
    return body;
  }

  /**
   * Replace the static terrain collider from a rendered BufferGeometry.
   * Vertices are baked into world space so the Rapier mesh follows the exact
   * same per-corner slopes that the player sees and raycasts against.
   */
  setTerrainMesh(mesh) {
    if (!this.ready) throw new Error('WorldPhysics.init() must complete before setTerrainMesh()');
    const geometry = mesh?.geometry;
    const position = geometry?.attributes?.position;
    if (this._terrainSource === geometry && this._terrain?.isValid?.()) return this._terrain;
    if (this._terrain?.isValid?.()) this.world.removeRigidBody(this._terrain);
    this._terrain = null;
    this._terrainSource = null;
    if (!position || position.count < 3) return null;
    this._terrainSource = geometry;
    mesh.updateWorldMatrix?.(true, false);
    const vertices = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      _point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertices[i * 3] = _point.x;
      vertices[i * 3 + 1] = _point.y;
      vertices[i * 3 + 2] = _point.z;
    }
    let indices;
    if (geometry.index) {
      indices = new Uint32Array(geometry.index.count);
      for (let i = 0; i < geometry.index.count; i++) indices[i] = geometry.index.getX(i);
    } else {
      indices = new Uint32Array(position.count);
      for (let i = 0; i < position.count; i++) indices[i] = i;
    }
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed());
    const collider = this.rapier.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.86)
      .setRestitution(0.04);
    this.world.createCollider(collider, body);
    this._terrain = body;
    return body;
  }

  registerObject(object, options = {}) {
    if (!this.ready || !object) return null;
    const id = String(options.id || `body-${this._nextId++}`);
    if (this.records.has(id)) this.unregisterObject(id);

    object.updateWorldMatrix?.(true, true);
    object.matrixWorld.decompose(_worldPosition, _worldQuaternion, _worldScale);
    const metrics = geometryMassProperties(object, options);
    const scaledSize = metrics.size.clone().multiply(new Vector3(
      Math.abs(_worldScale.x) || 1,
      Math.abs(_worldScale.y) || 1,
      Math.abs(_worldScale.z) || 1,
    ));
    const scaledCom = metrics.centerOfMass.clone().multiply(_worldScale);
    const scaledBoundsCenter = metrics.bounds.getCenter(new Vector3()).multiply(_worldScale);
    const volumeScale = Math.max(1e-9,
      Math.abs((_worldScale.x || 1) * (_worldScale.y || 1) * (_worldScale.z || 1)));
    const requestedMass = Number(options.massKg);
    const massKg = requestedMass > 0 ? requestedMass : metrics.massKg * volumeScale;
    const principalInertia = new Vector3(
      massKg * (scaledSize.y ** 2 + scaledSize.z ** 2) / 12,
      massKg * (scaledSize.x ** 2 + scaledSize.z ** 2) / 12,
      massKg * (scaledSize.x ** 2 + scaledSize.y ** 2) / 12,
    ).max(new Vector3(1e-5, 1e-5, 1e-5));
    const scaledMetrics = {
      ...metrics,
      volumeM3: metrics.volumeM3 * volumeScale,
      boundsVolumeM3: metrics.boundsVolumeM3 * volumeScale,
      densityKgM3: requestedMass > 0
        ? massKg / Math.max(1e-9, metrics.volumeM3 * volumeScale)
        : metrics.densityKgM3,
      massKg,
      centerOfMass: scaledCom.clone(),
      principalInertia,
      size: scaledSize.clone(),
    };
    const active = options.active === true;
    const bodyDesc = active
      ? this.rapier.RigidBodyDesc.dynamic()
      : this.rapier.RigidBodyDesc.fixed();
    bodyDesc
      .setTranslation(_worldPosition.x, _worldPosition.y, _worldPosition.z)
      .setRotation(finiteRotation(_worldQuaternion))
      .setLinearDamping(Number(options.linearDamping) || 0.35)
      .setAngularDamping(Number(options.angularDamping) || 0.45)
      .setAdditionalMassProperties(
        scaledMetrics.massKg,
        finiteVector(scaledCom),
        finiteVector(scaledMetrics.principalInertia),
        { x: 0, y: 0, z: 0, w: 1 },
      );
    if (options.ccd !== false) bodyDesc.setCcdEnabled?.(true);

    const body = this.world.createRigidBody(bodyDesc);
    body.userData = { id, kind: options.kind || 'object' };
    const half = scaledSize.multiplyScalar(0.5);
    const colliderDesc = this.rapier.ColliderDesc.cuboid(
      Math.max(0.02, half.x), Math.max(0.02, half.y), Math.max(0.02, half.z),
    )
      .setTranslation(scaledBoundsCenter.x, scaledBoundsCenter.y, scaledBoundsCenter.z)
      .setDensity(0)
      .setFriction(Number.isFinite(options.friction) ? options.friction : 0.7)
      .setRestitution(Number.isFinite(options.restitution) ? options.restitution : 0.12);
    const collider = this.world.createCollider(colliderDesc, body);
    // Rapier defers an active body's aggregate mass update until the next
    // world step when a collider is attached after body creation. Incidents
    // apply their impulses in this same call stack, so force that update now;
    // otherwise a newly-created debris or ragdoll body briefly reports zero
    // mass and can consume an impulse before its authored COM/inertia exist.
    if (active) body.recomputeMassPropertiesFromColliders();
    const record = {
      id, object, body, collider, metrics: scaledMetrics, active,
      kind: options.kind || 'object',
      destructible: options.destructible !== false,
      originalParent: object.parent,
    };
    this.records.set(id, record);
    return record;
  }

  unregisterObject(idOrRecord, { removeObject = false } = {}) {
    const record = typeof idOrRecord === 'string' ? this.records.get(idOrRecord) : idOrRecord;
    if (!record) return false;
    if (record.body?.isValid?.()) this.world.removeRigidBody(record.body);
    this.records.delete(record.id);
    this._pruneJoints();
    if (removeObject && record.object?.parent) record.object.parent.remove(record.object);
    return true;
  }

  activate(idOrRecord) {
    const record = typeof idOrRecord === 'string' ? this.records.get(idOrRecord) : idOrRecord;
    if (!record || record.active) return record || null;
    record.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
    // Rapier deliberately skips dynamic mass initialization while a body is
    // fixed. Recompute immediately after promotion so the authored uniform-
    // density mass/COM become effective before the first impulse lands.
    record.body.recomputeMassPropertiesFromColliders();
    record.body.wakeUp();
    record.active = true;
    return record;
  }

  createSphericalJoint(recordA, recordB, worldAnchor, contactsEnabled = false) {
    if (!recordA?.body || !recordB?.body) return null;
    const anchor = _point.set(worldAnchor.x, worldAnchor.y, worldAnchor.z);
    const localAnchor = (record) => {
      const translation = record.body.translation();
      const rotation = record.body.rotation();
      const inverse = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).invert();
      return anchor.clone().sub(new Vector3(translation.x, translation.y, translation.z)).applyQuaternion(inverse);
    };
    const a = localAnchor(recordA);
    const b = localAnchor(recordB);
    const data = this.rapier.JointData.spherical(finiteVector(a), finiteVector(b));
    const joint = this.world.createImpulseJoint(data, recordA.body, recordB.body, true);
    joint.setContactsEnabled?.(contactsEnabled);
    this.joints.add(joint);
    return joint;
  }

  explode(position, options = {}) {
    if (!this.ready) return [];
    const origin = _point.set(position?.x || 0, position?.y || 0, position?.z || 0);
    const radius = Math.max(0.1, Number(options.radius) || 7);
    const strength = Math.max(0, Number(options.strength) || 90);
    const upwardBias = Number.isFinite(options.upwardBias) ? options.upwardBias : 0.32;
    const impacted = [];

    for (const record of this.records.values()) {
      if (!record.destructible) continue;
      const bodyPos = record.body.worldCom?.() || record.body.translation();
      _direction.set(bodyPos.x, bodyPos.y, bodyPos.z).sub(origin);
      const distance = _direction.length();
      if (distance > radius) continue;
      if (distance < 0.05) _direction.set(0.2, 1, 0.1);
      _direction.y += upwardBias * radius;
      _direction.normalize();
      const falloff = Math.max(0, 1 - distance / radius) ** 2;
      const recordMass = Math.max(0.1, record.metrics?.massKg || record.body.mass?.() || 1);
      const impulse = strength * falloff * Math.cbrt(recordMass);
      this.activate(record);
      record.body.applyImpulse({
        x: _direction.x * impulse,
        y: _direction.y * impulse,
        z: _direction.z * impulse,
      }, true);
      const spin = impulse * 0.08;
      record.body.applyTorqueImpulse({
        x: _direction.z * spin,
        y: (record.id.length % 3 - 1) * spin,
        z: -_direction.x * spin,
      }, true);
      impacted.push({ record, distance, falloff, impulse });
    }
    return impacted;
  }

  captureSnapshot() {
    const bodies = new Map();
    for (const [id, record] of this.records) {
      bodies.set(id, {
        active: record.active,
        enabled: record.body.isEnabled(),
        translation: finiteVector(record.body.translation()),
        rotation: finiteRotation(record.body.rotation()),
        linvel: finiteVector(record.body.linvel()),
        angvel: finiteVector(record.body.angvel()),
        visible: record.object.visible,
      });
    }
    return { bodies };
  }

  restoreSnapshot(snapshot, { removeNewBodies = true } = {}) {
    if (!snapshot?.bodies) return false;
    if (removeNewBodies) {
      for (const [id, record] of [...this.records]) {
        if (!snapshot.bodies.has(id)) this.unregisterObject(record, { removeObject: true });
      }
    }
    for (const [id, state] of snapshot.bodies) {
      const record = this.records.get(id);
      if (!record) continue;
      record.body.setBodyType(
        state.active ? this.rapier.RigidBodyType.Dynamic : this.rapier.RigidBodyType.Fixed,
        true,
      );
      record.body.setEnabled(state.enabled !== false);
      if (state.active) record.body.recomputeMassPropertiesFromColliders();
      record.active = state.active;
      record.body.setTranslation(state.translation, true);
      record.body.setRotation(state.rotation, true);
      record.body.setLinvel(state.linvel, true);
      record.body.setAngvel(state.angvel, true);
      record.object.visible = state.visible;
      if (!state.active) record.body.sleep();
    }
    this._syncObjects();
    return true;
  }

  update(dtSeconds) {
    if (!this.ready) return 0;
    const dt = Math.max(0, Math.min(0.25, Number(dtSeconds) || 0));
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubsteps) {
      this.world.timestep = this.fixedStep;
      this.world.step();
      this.accumulator -= this.fixedStep;
      steps++;
      this.stats.steps++;
    }
    if (this.accumulator >= this.fixedStep) {
      this.stats.droppedTime += this.accumulator;
      this.accumulator = 0;
    }
    this._syncObjects();
    let activeBodies = 0;
    let sleepingBodies = 0;
    for (const record of this.records.values()) {
      if (!record.active) continue;
      activeBodies++;
      if (record.body.isSleeping()) sleepingBodies++;
    }
    this.stats.activeBodies = activeBodies;
    this.stats.sleepingBodies = sleepingBodies;
    return steps;
  }

  _syncObjects() {
    for (const record of this.records.values()) {
      if (!record.active || !record.object || !record.body.isValid()) continue;
      const translation = record.body.translation();
      const rotation = record.body.rotation();
      _matrix.compose(
        _worldPosition.set(translation.x, translation.y, translation.z),
        _worldQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w),
        record.object.getWorldScale?.(_worldScale) || record.object.scale,
      );
      const parent = record.object.parent;
      if (parent) {
        parent.updateWorldMatrix?.(true, false);
        _parentInverse.copy(parent.matrixWorld).invert();
        _localMatrix.multiplyMatrices(_parentInverse, _matrix);
      } else {
        _localMatrix.copy(_matrix);
      }
      _localMatrix.decompose(record.object.position, record.object.quaternion, record.object.scale);
      record.object.updateMatrix?.();
      record.object.updateMatrixWorld?.(true);
    }
  }

  _pruneJoints() {
    for (const joint of this.joints) {
      if (!joint?.isValid?.()) this.joints.delete(joint);
    }
  }

  getStats() {
    this._pruneJoints();
    let activeBodies = 0;
    let sleepingBodies = 0;
    for (const record of this.records.values()) {
      if (!record.active) continue;
      activeBodies++;
      if (record.body.isSleeping()) sleepingBodies++;
    }
    this.stats.activeBodies = activeBodies;
    this.stats.sleepingBodies = sleepingBodies;
    return {
      ready: this.ready,
      bodies: this.records.size,
      joints: this.joints.size,
      ...this.stats,
    };
  }

  dispose() {
    if (!this.world) return;
    this.records.clear();
    this.joints.clear();
    this.world.free();
    this.world = null;
    this.ready = false;
  }
}

export default WorldPhysics;
