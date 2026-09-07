import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { utilityFittingBatchGeometry } from '../src/renderer3d/utility-fitting-occlusion.js';
import { UtilityLineBuilderV2 } from '../src/renderer3d/utility-line-builder-v2.js';

globalThis.THREE = THREE;

for (const [name, ringRadius, tubeRadius, radial, tubular, sleeveRadius, halfLength, offset] of [
  ['water collar', 0.065 * 1.56, 0.065 * 0.16, 7, 18, 0.065 * 1.72, 0.065 * 1.05 / 2, 0],
  ['vacuum rim', 0.04 * 1.46, 0.009, 6, 16, 0.04 * 1.58, 0.045 / 2, 0],
  ['cryo bellows', 0.096 * 1.055, 0.0063, 6, 16, 0.096 * 1.08, 0.099, 0.05544],
  ['cryo collar', 0.096 * 1.06, 0.0096, 7, 18, 0.096 * 1.08, 0.099, -0.08118],
]) {
  test(`${name}: removing buried faces preserves the exterior surface`, () => {
    const material = new THREE.MeshStandardMaterial();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringRadius, tubeRadius, radial, tubular), material);
    ring.userData.utilitySleeveOccluder = { radius: sleeveRadius, halfLength, centerZ: -offset };
    const originalIndices = ring.geometry.index.array.slice();
    const optimized = utilityFittingBatchGeometry(ring);
    assert.notEqual(optimized, ring.geometry);
    assert.ok(optimized.index.count < ring.geometry.index.count);
    assert.deepEqual(ring.geometry.index.array, originalIndices, 'source remains complete for focus views');
    for (const name of Object.keys(ring.geometry.attributes)) {
      assert.equal(optimized.getAttribute(name), ring.geometry.getAttribute(name),
        'visible positions, normals and UVs remain exact');
    }
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(sleeveRadius, sleeveRadius, halfLength * 2, 12), material);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = -offset;
    sleeve.updateMatrixWorld(true);
    const trimmedRing = new THREE.Mesh(optimized, material);
    const ray = new THREE.Raycaster();
    // Compare first surface intersections from varied exterior viewpoints,
    // including sleeve end faces and off-centre glancing rays.
    for (let i = 0; i < 600; i++) {
      const z = 1 - 2 * (i + 0.5) / 600;
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const direction = new THREE.Vector3(Math.sqrt(1-z*z)*Math.cos(angle), Math.sqrt(1-z*z)*Math.sin(angle), z);
      const target = new THREE.Vector3(Math.sin(i) * ringRadius * 0.8, Math.cos(i*0.7) * ringRadius * 0.8, Math.sin(i*0.3) * tubeRadius);
      const origin = direction.multiplyScalar(1).add(target);
      ray.set(origin, target.clone().sub(origin).normalize());
      const before = ray.intersectObjects([ring, sleeve], false)[0];
      const after = ray.intersectObjects([trimmedRing, sleeve], false)[0];
      assert.equal(!!after, !!before);
      if (before) assert.ok(Math.abs(after.distance - before.distance) < 1e-7);
    }
    material.transparent = true;
    assert.equal(utilityFittingBatchGeometry(ring), ring.geometry, 'transparent fittings retain interior faces');
    optimized.dispose(); ring.geometry.dispose(); sleeve.geometry.dispose(); material.dispose();
  });
}

test('utility batching reduces fitting triangles and restores complete sources during focus', () => {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE.Group();
  const lines = new Map(['waterSupplyPipe', 'vacuumPipe', 'cryoTransfer'].map((utilityType, i) => [utilityType, {
    id: utilityType, utilityType, start: null, end: null,
    path: [{ col: 0, row: i * 3 }, { col: 4, row: i * 3 }],
  }]));
  builder.build(lines, new Map(), parent);
  builder.setDetailLevel(true);
  const sources = [], batches = [];
  parent.traverse(object => {
    if (object.userData.utilityNearMergedSource) sources.push(object);
    if (object.userData.isUtilityNearDetailBatch) batches.push(object);
  });
  const triangles = objects => objects.reduce((sum, object) => sum + (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3, 0);
  assert.ok(triangles(batches) < triangles(sources));
  const rings = sources.filter(object => object.userData.utilitySleeveOccluder);
  assert.ok(rings.length > 0);
  for (const ring of rings) {
    const p = ring.geometry.parameters;
    assert.equal(ring.geometry.index.count, p.radialSegments * p.tubularSegments * 6);
  }
  builder.setFocus(['waterSupplyPipe']);
  assert.ok(batches.every(batch => !batch.visible));
  assert.ok(rings.every(ring => ring.visible));
  builder.setFocus(null);
  assert.ok(batches.every(batch => batch.visible));
  assert.ok(rings.every(ring => !ring.visible));
  builder.dispose(parent);
});
