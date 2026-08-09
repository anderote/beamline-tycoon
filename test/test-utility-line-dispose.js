// test/test-utility-line-dispose.js — GPU-resource teardown regressions for
// src/renderer3d/utility-line-builder-v2.js.
//
//   1. _disposeObject must handle a THREE.Group: the draw preview rebuilds
//      every animation frame, and the old implementation only checked
//      obj.geometry/obj.material on the top-level object — a Group has
//      neither, so every child CylinderGeometry/SphereGeometry leaked once
//      per frame for the whole drag.
//   2. _disposeGroup must dispose per-build (non-cached) materials while
//      leaving cached/shared materials (tagged userData.__shared) alone —
//      it used to assume every material was cached and dispose none.
//
// Uses hand-built stand-ins for THREE objects (traverse/isMesh/dispose), so
// no WebGL or THREE global is needed.

import UtilityLineBuilderV2 from '../src/renderer3d/utility-line-builder-v2.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function fakeGeometry() {
  return { disposed: false, dispose() { this.disposed = true; } };
}
function fakeMaterial({ shared = false } = {}) {
  return {
    userData: shared ? { __shared: true } : {},
    disposed: false,
    dispose() { this.disposed = true; },
  };
}
function fakeMesh(geometry, material) {
  const mesh = { isMesh: true, geometry, material, children: [] };
  mesh.traverse = (fn) => { fn(mesh); };
  return mesh;
}
function fakeGroup(children) {
  const group = { isMesh: false, children };
  group.traverse = (fn) => {
    fn(group);
    for (const c of children) c.traverse(fn);
  };
  return group;
}

const builder = new UtilityLineBuilderV2();

console.log('\n--- 1. _disposeObject traverses Group children ---');
{
  const geos = [fakeGeometry(), fakeGeometry(), fakeGeometry()];
  const sharedMat = fakeMaterial({ shared: true });
  const group = fakeGroup(geos.map(g => fakeMesh(g, sharedMat)));
  builder._disposeObject(group);
  assert(geos.every(g => g.disposed),
    'all child geometries disposed when tearing down a preview Group');
  assert(!sharedMat.disposed,
    'shared preview material survives the teardown');
}

console.log('\n--- 2. _disposeGroup disposes per-build materials only ---');
{
  const sharedMat = fakeMaterial({ shared: true });   // line/jacket/marker caches
  const ownedMat = fakeMaterial({ shared: false });   // hypothetical per-build material
  const g1 = fakeGeometry(), g2 = fakeGeometry();
  const group = fakeGroup([fakeMesh(g1, sharedMat), fakeMesh(g2, ownedMat)]);
  builder._disposeGroup(group);
  assert(g1.disposed && g2.disposed, 'geometries disposed');
  assert(!sharedMat.disposed, 'cached/shared material NOT disposed');
  assert(ownedMat.disposed, 'per-build material disposed with its group');
}

console.log('\n--- 3. _disposeObject still handles a bare Mesh ---');
{
  const geo = fakeGeometry();
  const mat = fakeMaterial({ shared: false });
  builder._disposeObject(fakeMesh(geo, mat));
  assert(geo.disposed, 'mesh geometry disposed');
  assert(mat.disposed, 'mesh-owned material disposed');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
