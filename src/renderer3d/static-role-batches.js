// Instance opaque, shared component-role geometry while retaining original
// wrappers/hitboxes for selection and ownership. Glow and movable parts stay
// on their original meshes. Batches never own shared geometry or materials.
export class StaticRoleBatches {
  constructor() { this.meshes = []; this.sources = []; this.roots = new Map(); }
  clear() {
    for (const source of this.sources) {
      source.visible = true;
      delete source.userData.instancedRoleSource;
    }
    for (const mesh of this.meshes) {
      mesh.parent?.remove(mesh);
      mesh.dispose?.();
    }
    this.meshes = [];
    this.sources = [];
    this.roots.clear();
  }
  rebuild(roots) {
    this.clear();
    if (!THREE.InstancedMesh) return;
    const buckets = new Map();
    const parents = new Map();
    for (const root of roots) {
      const parent = root.parent;
      if (!parent) continue;
      if (!parents.has(parent)) {
        parent.updateWorldMatrix(true, true);
        parents.set(parent, parent.matrixWorld.clone().invert());
      }
      const inverse = parents.get(parent);
      root.traverse(mesh => {
        const material = mesh.material;
        if (!mesh.isMesh || !mesh.visible || !mesh.userData?.role
            || mesh.userData.role === 'glow' || mesh.userData.role === 'detail'
            || !mesh.userData.sharedGeometry || !material || Array.isArray(material)
            || material.transparent || material.opacity < 1 || !material.visible) return;
        const key = [parent.uuid, mesh.geometry.uuid, material.uuid, mesh.layers.mask,
          mesh.castShadow, mesh.receiveShadow, mesh.renderOrder].join('|');
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, bucket = { parent, entries: [] });
        bucket.entries.push({ mesh, root, matrix: inverse.clone().multiply(mesh.matrixWorld) });
      });
    }
    for (const { parent, entries } of buckets.values()) {
      if (entries.length < 2) continue;
      const first = entries[0].mesh;
      const batch = new THREE.InstancedMesh(first.geometry, first.material, entries.length);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder;
      batch.layers.mask = first.layers.mask;
      batch.userData.batchedComponents = true;
      batch.userData.componentIds = entries.map(entry => entry.root.userData.nodeId);
      entries.forEach((entry, index) => {
        batch.setMatrixAt(index, entry.matrix);
        entry.mesh.visible = false;
        entry.mesh.userData.instancedRoleSource = true;
        let tracking = this.roots.get(entry.root);
        if (!tracking) {
          entry.root.updateMatrix();
          this.roots.set(entry.root, tracking = { matrix: entry.root.matrix.clone(), entries: [] });
        }
        tracking.entries.push({ source: entry.mesh, batch, index, parent });
        this.sources.push(entry.mesh);
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      parent.add(batch);
      this.meshes.push(batch);
    }
  }
  /** Placement settles and physical incidents move canonical wrappers. */
  syncTransforms() {
    const changed = new Set();
    for (const [root, tracking] of this.roots) {
      root.updateMatrix();
      if (root.matrix.equals(tracking.matrix)) continue;
      tracking.matrix.copy(root.matrix);
      root.updateWorldMatrix(true, true);
      for (const { source, batch, index, parent } of tracking.entries) {
        const matrix = parent.matrixWorld.clone().invert().multiply(source.matrixWorld);
        batch.setMatrixAt(index, matrix);
        changed.add(batch);
      }
    }
    for (const batch of changed) {
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
    }
    return changed.size;
  }
  setVisible(visible) { for (const mesh of this.meshes) mesh.visible = visible; }
}
