// src/renderer3d/dispose-utils.js
//
// Shared GPU-resource teardown for scene objects the renderer rebuilds.
//
// Disposing geometry + material is not enough for an InstancedMesh: three
// keeps the per-instance attributes (instanceMatrix, instanceColor) on the
// MESH, and frees their GL buffers only from InstancedMesh.dispose(). Every
// rebuild of an instanced group (zone tiles, grass, wildflowers) would
// otherwise leak megabytes of VRAM per placement.

/**
 * Release the GPU resources owned by one scene object: its geometry, its
 * material (plus the material's map), and — for an InstancedMesh — the mesh
 * itself. Safe on plain Groups and on test stand-ins.
 */
export function disposeSceneObject(obj) {
  if (!obj) return;
  if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
  const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
  for (const mat of mats) {
    if (mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
    if (typeof mat.dispose === 'function') mat.dispose();
  }
  if (obj.isInstancedMesh && typeof obj.dispose === 'function') obj.dispose();
}

/**
 * Detach and dispose every child of `group` (leaving the group itself in the
 * scene, ready to be refilled).
 */
export function disposeGroupChildren(group) {
  if (!group || !group.children) return;
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeSceneObject(child);
  }
}
