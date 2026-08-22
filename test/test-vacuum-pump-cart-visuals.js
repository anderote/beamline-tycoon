import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.THREE = THREE;

const { COMPONENTS } = await import('../src/data/components.js');
const {
  _buildRoughingPumpCartRoles,
  _buildTurboPumpCartRoles,
  _buildVacuumCartRoles,
  _buildHighCapacityVacuumStationRoles,
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

function assertAuthoredEnvelope(name, bounds, def) {
  const eps = 1e-6;
  const halfW = def.subW * 0.25;
  const halfL = def.subL * 0.25;
  const height = def.subH * 0.5;
  assert.ok(bounds.min.x >= -halfW - eps && bounds.max.x <= halfW + eps,
    `${name} stays inside its ${def.subW}-subtile width`);
  assert.ok(bounds.min.z >= -halfL - eps && bounds.max.z <= halfL + eps,
    `${name} stays inside its ${def.subL}-subtile length`);
  assert.ok(bounds.min.y >= -eps && bounds.max.y <= height + eps,
    `${name} stays inside its ${def.subH}-subtile height`);
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

test('integrated mobile vacuum cart uses the smaller 1.5 × 2 metre footprint', () => {
  const def = COMPONENTS.vacuumCart;
  assert.equal(def.subW, 3, 'cart is three subtiles wide');
  assert.equal(def.subL, 4, 'cart is four subtiles long');
  assert.equal(def.gridW, 3, 'placement grid matches visual width');
  assert.equal(def.gridH, 4, 'placement grid matches visual length');

  const cart = _buildVacuumCartRoles();
  const bounds = boundsOf(cart);
  assertAuthoredEnvelope('mobile vacuum cart', bounds, def);
  assert.ok(Math.abs(bounds.max.x - 0.70) < 1e-6,
    'visible outlet reaches the authored right-side vacuum fitting');
  assert.ok(cart.iron.length >= 4,
    'two dry-pump motors, turbo motor, and isolation valve remain visible');
  assert.ok(cart.pipe.length >= 6,
    'roughing header, turbo body, foreline, and outlet are modeled');
  assert.ok(cart.glow.length >= 4,
    'controller display and individual status lamps are modeled');
  disposeBuckets(cart);
});

test('high-capacity station is a detailed staged pumping skid within its footprint', () => {
  const def = COMPONENTS.highCapacityVacuumStation;
  const station = _buildHighCapacityVacuumStationRoles();
  const bounds = boundsOf(station);
  assertAuthoredEnvelope('high-capacity vacuum station', bounds, def);
  assert.ok(Math.abs(bounds.max.x - def.subW * 0.25) < 1e-6,
    'engineered outlet reaches the right edge of the station footprint');
  assert.ok(station.pipe.length >= 18,
    'high-vacuum header and backing forelines are separately modeled');
  assert.ok(station.stand.length >= 19,
    'open skid frame, pump pads, feet, and service guard are modeled');
  assert.ok(station.iron.length >= 30,
    'twin turbo stacks, flange bolts, valves, Roots ends, and motors are visible');
  assert.ok(station.glow.length >= 5,
    'PLC display, status lamps, and warning beacon are modeled');
  disposeBuckets(station);
});
