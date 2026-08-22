import assert from 'node:assert/strict';
import * as ThreeNamespace from 'three';

globalThis.THREE = ThreeNamespace;
const { BeamBuilder } = await import('../src/renderer3d/beam-builder.js');

function matrixPosition(mesh, index) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

const parent = new THREE.Group();
const builder = new BeamBuilder();
builder.build([{
  worldPoints: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  nodePositions: [{}, {}],
  visualMode: 'continuous',
  visualProfile: [
    { u: 0, beta: 0.05, speed: 1.5, bunch: 0 },
    { u: 1, beta: 0.95, speed: 3.9, bunch: 0 },
  ],
  color: 0x44ffcc,
}], parent);

assert.deepEqual(parent.children.map(child => child.name).sort(), [
  'beam-core', 'beam-dc-pixel', 'beam-glow',
]);

const flowCore = parent.children.find(child => child.name === 'beam-dc-pixel');
const slowBefore = matrixPosition(flowCore, 0);
const fastBefore = matrixPosition(flowCore, 3);
builder.update(0.1);
const slowAfter = matrixPosition(flowCore, 0);
const fastAfter = matrixPosition(flowCore, 3);
assert.ok(fastAfter.distanceTo(fastBefore) > slowAfter.distanceTo(slowBefore),
  'downstream instances advance faster when their local beta is higher');

builder.dispose(parent);
assert.equal(parent.children.length, 0, 'dispose removes every batched beam mesh');

const mixedParent = new THREE.Group();
builder.build([{
  worldPoints: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  nodePositions: [{}, {}],
  visualMode: 'bunched',
  visualProfile: [
    { u: 0, beta: 0.2, speed: 2.2, bunch: 0 },
    { u: 0.45, beta: 0.4, speed: 2.8, bunch: 0 },
    { u: 0.55, beta: 0.5, speed: 3.1, bunch: 1 },
    { u: 1, beta: 0.9, speed: 3.8, bunch: 1 },
  ],
  color: 0xffaa44,
}], mixedParent);

assert.deepEqual(mixedParent.children.map(child => child.name).sort(), [
  'beam-bunch-pixel', 'beam-core', 'beam-dc-pixel', 'beam-glow',
]);
builder.dispose(mixedParent);

console.log('beam builder tests passed');
