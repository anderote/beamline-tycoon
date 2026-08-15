import { Box3, Quaternion, Vector3 } from 'three/webgpu';

const _position = new Vector3();
const _rotation = new Quaternion();
const _scale = new Vector3();

function visibleLeafMeshes(root) {
  const meshes = [];
  root?.traverse?.((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.length && materials.every((material) => material?.visible === false)) return;
    const bounds = new Box3().setFromObject(object);
    const size = bounds.getSize(new Vector3());
    if (size.x * size.y * size.z < 1e-5) return;
    meshes.push({ object, volume: Math.max(1e-5, size.x * size.y * size.z) });
  });
  return meshes;
}

function cloneLeafInWorld(source, scene) {
  source.updateWorldMatrix?.(true, false);
  const clone = source.clone(false);
  source.matrixWorld.decompose(_position, _rotation, _scale);
  clone.position.copy(_position);
  clone.quaternion.copy(_rotation);
  clone.scale.copy(_scale);
  clone.matrixAutoUpdate = true;
  clone.castShadow = true;
  clone.receiveShadow = true;
  scene.add(clone);
  clone.updateMatrixWorld(true);
  return clone;
}

/** Breaks multipart authored models into independently simulated mesh debris. */
export class DebrisSystem {
  constructor(physics, scene, options = {}) {
    this.physics = physics;
    this.scene = scene;
    this.maxFragments = Math.max(8, Math.floor(options.maxFragments || 96));
    this.maxFragmentsPerObject = Math.max(2, Math.floor(options.maxFragmentsPerObject || 12));
    this.fractures = new Map();
  }

  fractureNear(position, radius = 7) {
    const origin = new Vector3(position?.x || 0, position?.y || 0, position?.z || 0);
    const fractured = [];
    let available = this.maxFragments - this.getStats().fragments;
    for (const record of [...this.physics.records.values()]) {
      if (available < 2 || record.active || !record.destructible || this.fractures.has(record.id)) continue;
      if (!['equipment', 'beamline', 'decoration', 'furnishing'].includes(record.kind)) continue;
      const com = record.body.worldCom?.() || record.body.translation();
      if (origin.distanceTo(new Vector3(com.x, com.y, com.z)) > radius) continue;
      const leaves = visibleLeafMeshes(record.object)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, Math.min(available, this.maxFragmentsPerObject));
      if (leaves.length < 2) continue;
      const totalVolume = leaves.reduce((sum, leaf) => sum + leaf.volume, 0);
      const fragments = [];
      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        const object = cloneLeafInWorld(leaf.object, this.scene);
        object.name = `debris:${record.id}:${i}`;
        const fragment = this.physics.registerObject(object, {
          id: `debris:${record.id}:${i}`,
          kind: 'debris',
          active: true,
          massKg: Math.max(0.05, record.metrics.massKg * leaf.volume / totalVolume),
          friction: 0.72,
          restitution: 0.16,
          linearDamping: 0.22,
          angularDamping: 0.28,
        });
        fragments.push(fragment);
      }
      record.object.visible = false;
      record.body.setEnabled(false);
      record.destructible = false;
      this.fractures.set(record.id, { source: record, fragments });
      fractured.push(record.id);
      available -= fragments.length;
    }
    return fractured;
  }

  restore(id) {
    const fracture = this.fractures.get(id);
    if (!fracture) return false;
    for (const fragment of fracture.fragments) {
      this.physics.unregisterObject(fragment, { removeObject: true });
    }
    fracture.source.object.visible = true;
    fracture.source.body.setEnabled(true);
    fracture.source.destructible = true;
    this.fractures.delete(id);
    return true;
  }

  restoreAll() {
    for (const id of [...this.fractures.keys()]) this.restore(id);
  }

  getStats() {
    let fragments = 0;
    for (const fracture of this.fractures.values()) fragments += fracture.fragments.length;
    return { fracturedObjects: this.fractures.size, fragments, fragmentBudget: this.maxFragments };
  }

  dispose() {
    this.restoreAll();
  }
}

export default DebrisSystem;
