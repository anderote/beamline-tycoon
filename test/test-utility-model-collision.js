// Contract test for the renderer-owned half of utility/equipment collision.
// The routing layer supplies a component-local 3D utility envelope; this layer
// must consult real model triangles rather than treating model bounds as solid.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE_REAL from 'three';

class FakeTextureLoader {
  load() { return new THREE_REAL.Texture(); }
}

globalThis.THREE = { ...THREE_REAL, TextureLoader: FakeTextureLoader };
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return { addColorStop() {} }; },
          fillRect() {},
          fillStyle: null,
        };
      },
    };
  },
};

const {
  getModelBounds,
  utilityEnvelopeIntersectsModel,
} = await import('../src/renderer3d/component-builder.js');

test('utility collision uses component triangles inside the footprint broad phase', () => {
  const bounds = getModelBounds('quadrupole');
  assert.ok(bounds && bounds.minY < 1 && bounds.maxY > 1,
    'fixture model spans the beam axis');

  assert.equal(utilityEnvelopeIntersectsModel('quadrupole', {
    minX: -0.15, maxX: 0.15,
    minY: 0.9, maxY: 1.1,
    minZ: -0.15, maxZ: 0.15,
  }), true, 'an envelope through the magnet beam-axis body intersects');

  assert.equal(utilityEnvelopeIntersectsModel('quadrupole', {
    minX: bounds.minX, maxX: bounds.maxX,
    minY: bounds.maxY + 0.25, maxY: bounds.maxY + 0.35,
    minZ: bounds.minZ, maxZ: bounds.maxZ,
  }), false, 'matching the full X/Z footprint does not block at a clear height');
});
