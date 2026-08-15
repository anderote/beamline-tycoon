import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.THREE = THREE;

const { COMPONENTS } = await import('../src/data/components.js');
const {
  _buildRoughingPumpCartRoles,
  _buildTurboPumpCartRoles,
} = await import('../src/renderer3d/builders/vacuum-builder.js');

function boundsOf(buckets) {
  const bounds = new THREE.Box3();
  for (const parts of Object.values(buckets)) {
    for (const geometry of parts) {
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
    }
  }
  return bounds;
}

function disposeBuckets(buckets) {
  for (const parts of Object.values(buckets)) {
    for (const geometry of parts) geometry.dispose();
  }
}

function assertCompactEnvelope(name, bounds) {
  const eps = 1e-6;
  assert.ok(bounds.min.x >= -0.25 - eps && bounds.max.x <= 0.25 + eps,
    `${name} stays inside its 1-subtile X footprint (${bounds.min.x}..${bounds.max.x})`);
  assert.ok(bounds.min.z >= -0.5 - eps && bounds.max.z <= 0.5 + eps,
    `${name} stays inside its 2-subtile Z footprint (${bounds.min.z}..${bounds.max.z})`);
  assert.ok(bounds.min.y >= -eps && bounds.max.y <= 1.5 + eps,
    `${name} stays inside its 3-subtile height (${bounds.min.y}..${bounds.max.y})`);
}

test('roughing and turbo carts declare the same compact 2×1×3-subtile envelope', () => {
  for (const id of ['roughingPumpCart', 'turboPumpCart']) {
    const def = COMPONENTS[id];
    assert.equal(def.subL, 2, `${id} is two subtiles long`);
    assert.equal(def.subW, 1, `${id} is one subtile wide`);
    assert.equal(def.subH, 3, `${id} is three subtiles high`);
  }
});

test('compact cart meshes stay inside their authored placement footprints', () => {
  const rough = _buildRoughingPumpCartRoles();
  const turbo = _buildTurboPumpCartRoles();

  assertCompactEnvelope('roughing cart', boundsOf(rough));
  assertCompactEnvelope('turbo cart', boundsOf(turbo));
  assert.equal(rough.accent.length, 4, 'roughing cart visibly carries four pump housings');
  assert.equal(turbo.iron.length, 4, 'turbo cart visibly carries four motor stages');
  assert.equal(turbo.accent.length, 4, 'turbo cart gives each stage its own accent ring');

  disposeBuckets(rough);
  disposeBuckets(turbo);
});
