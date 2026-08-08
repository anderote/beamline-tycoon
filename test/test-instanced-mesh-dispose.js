// test/test-instanced-mesh-dispose.js — GPU-buffer teardown regressions for
// the renderer's InstancedMesh users.
//
// three keeps an InstancedMesh's per-instance attributes (instanceMatrix,
// instanceColor) on the MESH, not on its geometry, and frees their GL buffers
// only from InstancedMesh.dispose(). Disposing geometry + material alone
// leaks those buffers on every rebuild — and the grass/wildflower/zone meshes
// rebuild whenever a tile is placed. Each teardown site must call the mesh's
// own dispose() too.
//
// Uses hand-built stand-ins for THREE objects, so no WebGL or THREE global is
// needed.

import { GrassTuftBuilder } from '../src/renderer3d/grass-tuft-builder.js';
import { WildflowerBuilder } from '../src/renderer3d/wildflower-builder.js';

// ThreeRenderer itself can't be imported headlessly (its module graph needs
// the THREE global and a DOM), so its zone teardown goes through the shared
// helper below — that helper is what this suite pins.
import { disposeGroupChildren } from '../src/renderer3d/dispose-utils.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function fakeInstancedMesh() {
  return {
    isInstancedMesh: true,
    geometry: { disposed: false, dispose() { this.disposed = true; } },
    material: { disposed: false, dispose() { this.disposed = true; } },
    meshDisposed: false,
    dispose() { this.meshDisposed = true; },
  };
}
function fakeParent() {
  const p = { children: [], removed: [] };
  p.remove = (m) => { p.removed.push(m); };
  return p;
}

console.log('\n--- 1. GrassTuftBuilder._disposeMeshes ---');
{
  const b = new GrassTuftBuilder();
  const clump = fakeInstancedMesh(), tall = fakeInstancedMesh();
  b._parent = fakeParent();
  b._clumpMesh = clump;
  b._tallMesh = tall;
  b._disposeMeshes();
  assert(clump.geometry.disposed && tall.geometry.disposed, 'geometries disposed');
  assert(clump.material.disposed && tall.material.disposed, 'materials disposed');
  assert(clump.meshDisposed && tall.meshDisposed,
    'InstancedMesh.dispose() called (frees instanceMatrix/instanceColor)');
  assert(b._clumpMesh === null && b._tallMesh === null, 'mesh refs cleared');
}

console.log('\n--- 2. WildflowerBuilder._disposeMeshes ---');
{
  const b = new WildflowerBuilder();
  const stem = fakeInstancedMesh(), bloom = fakeInstancedMesh();
  b._parent = fakeParent();
  b._stemMesh = stem;
  b._bloomMesh = bloom;
  b._disposeMeshes();
  assert(stem.geometry.disposed && bloom.geometry.disposed, 'geometries disposed');
  assert(stem.meshDisposed && bloom.meshDisposed,
    'InstancedMesh.dispose() called (frees instanceMatrix/instanceColor)');
  assert(b._stemMesh === null && b._bloomMesh === null, 'mesh refs cleared');
}

console.log('\n--- 3. disposeGroupChildren (ThreeRenderer._refreshZones) ---');
{
  const meshes = [fakeInstancedMesh(), fakeInstancedMesh()];
  meshes[0].material.map = { disposed: false, dispose() { this.disposed = true; } };
  const zoneGroup = {
    children: meshes.slice(),
    remove(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
    },
  };
  disposeGroupChildren(zoneGroup);
  assert(zoneGroup.children.length === 0, 'zone group emptied');
  assert(meshes.every(m => m.geometry.disposed && m.material.disposed),
    'zone geometries + materials disposed');
  assert(meshes[0].material.map.disposed, 'material map disposed');
  assert(meshes.every(m => m.meshDisposed),
    'InstancedMesh.dispose() called on each zone mesh');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
