import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createFarMergedMesh, mergedFarInstanceIndex } from '../src/renderer3d/far-mesh-merge.js';

globalThis.THREE = THREE;

for (const indexed of [true, false]) {
  test(`far merge preserves transformed attributes, bounds and picking (${indexed ? 'indexed' : 'non-indexed'})`, () => {
    const box = new THREE.BoxGeometry(2, 3, 4);
    box.computeTangents();
    const source = indexed ? box : box.toNonIndexed();
    const count = source.attributes.position.count;
    source.setAttribute('color', new THREE.Uint8BufferAttribute(
      Array.from({ length: count * 3 }, (_, i) => i % 256), 3, true,
    ));
    source.computeBoundingBox();
    source.computeBoundingSphere();
    const original = source.clone();
    const matrices = [
      new THREE.Matrix4().compose(new THREE.Vector3(8, 2, -4),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.8, -0.3)),
        new THREE.Vector3(2, 0.5, 3)),
      new THREE.Matrix4().makeTranslation(-7, 5, 9),
    ];
    const expected = matrices.map(matrix => source.clone().applyMatrix4(matrix));
    // Source ownership is part of the public contract; merging must neither
    // mutate nor dispose it. Cloning here would reintroduce per-instance copies.
    source.clone = () => { throw new Error('merge must not clone source geometry'); };
    source.addEventListener('dispose', () => { throw new Error('source disposed'); });
    const { mesh, instanceIds } = createFarMergedMesh(
      matrices.map(matrix => ({ geometry: source, matrix })), new THREE.MeshBasicMaterial(),
    );
    assert.deepEqual(instanceIds, [0, 1]);
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      assert.deepEqual(Array.from(attribute.array),
        expected.flatMap(geometry => Array.from(geometry.getAttribute(name).array)), name);
      assert.equal(attribute.normalized, source.getAttribute(name).normalized);
      assert.deepEqual(source.getAttribute(name).array, original.getAttribute(name).array);
    }
    assert.deepEqual(source.boundingBox, original.boundingBox);
    assert.deepEqual(source.boundingSphere, original.boundingSphere);
    assert.deepEqual(source.index?.array, original.index?.array);
    if (indexed) {
      assert.deepEqual(Array.from(mesh.geometry.index.array), [
        ...source.index.array, ...Array.from(source.index.array, value => value + count),
      ]);
    } else assert.equal(mesh.geometry.index, null);
    const bounds = expected.reduce((box, geometry) => box.union(geometry.boundingBox), new THREE.Box3());
    assert.deepEqual(mesh.geometry.boundingBox, bounds);
    const triangles = (source.index?.count ?? count) / 3;
    for (const faceIndex of [0, triangles - 1, triangles, triangles * 2 - 1]) {
      assert.equal(mergedFarInstanceIndex({ object: mesh, faceIndex }), Math.floor(faceIndex / triangles));
    }
    assert.equal(mergedFarInstanceIndex({ object: mesh, faceIndex: triangles * 2 }), null);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
}

test('far merge promotes large index buffers and handles empty input', () => {
  assert.equal(createFarMergedMesh([], null), null);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(33000 * 3), 3));
  geometry.setIndex([0, 1, 32999]);
  const { mesh } = createFarMergedMesh(Array.from({ length: 2 }, () => ({
    geometry, matrix: new THREE.Matrix4(),
  })), null);
  assert.ok(mesh.geometry.index.array instanceof Uint32Array);
  assert.deepEqual(Array.from(mesh.geometry.index.array), [0, 1, 32999, 33000, 33001, 65999]);
  mesh.geometry.dispose();
  geometry.dispose();
});
