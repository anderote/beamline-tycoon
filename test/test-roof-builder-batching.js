import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext: () => ({
        createRadialGradient() { return { addColorStop() {} }; },
        fillRect() {}, fillStyle: null,
      }),
    };
  },
};

const { RoofBuilder } = await import('../src/renderer3d/roof-builder.js');

test('large roof fields merge into a bounded pair of surface and edge draws', () => {
  const roofs = Array.from({ length: 400 }, (_, index) => ({
    type: 'roof',
    x: (index % 20) * 2,
    y: 3,
    z: Math.floor(index / 20) * 2,
    texture: '',
  }));
  const parent = new THREE.Group();
  const builder = new RoofBuilder();
  builder.build(roofs, parent);

  assert.equal(parent.children.length, 2,
    'one compatible roof field submits one surface draw and one edge draw');
  assert.deepEqual(new Set(parent.children.map(mesh => mesh.name)),
    new Set(['roof-batch-surface', 'roof-batch-side']));
  assert.ok(parent.children.every(mesh => mesh.userData.batchedRoofs
    && mesh.userData.roofTileCount === roofs.length));
  const triangles = parent.children.reduce((sum, mesh) =>
    sum + mesh.geometry.attributes.position.count / 3, 0);
  assert.equal(triangles, roofs.length * 12,
    'batching retains the complete slab geometry without per-tile objects');

  builder.build(roofs.slice(0, 20), parent);
  assert.equal(parent.children.length, 2, 'rebuild replaces rather than accumulates roof batches');
  builder.dispose(parent);
  assert.equal(parent.children.length, 0);
});
