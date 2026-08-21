import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as ThreeModule from 'three';
import { usesFloorOccupancy } from '../src/game/placement.js';
import { LIGHTING_DEFS } from '../src/data/placeables/lighting.js';
import { MODES } from '../src/data/modes.js';
import { groupDecorationPaletteEntries } from '../src/ui/palette-collection.js';
import { fixtureActivationFactor } from '../src/renderer3d/fixture-activation.js';
import { fixtureLightProjection } from '../src/renderer3d/fixture-light-math.js';
import {
  buildLightFixture,
  hasLightFixtureBuilder,
} from '../src/renderer3d/lighting-builder.js';

globalThis.THREE = ThreeModule;

const byId = Object.fromEntries(LIGHTING_DEFS.map(def => [def.id, def]));
const NEW_FIXTURES = [
  'floorLamp', 'arcFloorLamp', 'torchiere',
  'bankerLamp', 'magnifierTaskLamp',
  'recessedDownlight', 'ceilingBatten', 'emergencyCeilingLight',
  'pictureLight', 'klaxonStrobe', 'rotatingBeacon', 'signalTower', 'exitLight',
];

test('expanded lighting fixtures all have dedicated renderable geometry', () => {
  for (const id of NEW_FIXTURES) {
    const def = byId[id];
    assert.ok(def, `${id} is registered`);
    assert.equal(hasLightFixtureBuilder(id), true, `${id} has a dedicated builder`);
    const group = buildLightFixture(def, { dir: 0 });
    assert.ok(group.children.length > 1, `${id} has a composed silhouette`);
    assert.ok(group.userData.emitterMaterial, `${id} exposes its emitter material`);
  }
});

test('floor lamps occupy floor cells without leaking into Grounds lighting', () => {
  for (const id of ['floorLamp', 'arcFloorLamp', 'torchiere']) {
    const def = byId[id];
    assert.equal(def.mount, 'ground');
    assert.equal(usesFloorOccupancy(def), true);
    assert.equal(def.category, 'structureLights');
    assert.equal(def.subsection, 'floorLamps');
  }
});

test('decoration palette grouping preserves the authored lighting sections', () => {
  const structureDefs = LIGHTING_DEFS
    .filter(def => def.category === 'structureLights')
    .map(def => [def.id, def]);
  const subsections = MODES.structure.categories.structureLights.subsections;
  const groups = groupDecorationPaletteEntries(structureDefs, subsections);
  assert.deepEqual(groups.map(group => group.key), [
    'floorLamps', 'deskTask', 'ceilingLights', 'wallLights', 'utilityWarning',
  ]);
  assert.equal(groups.flatMap(group => group.entries).length, structureDefs.length);
  assert.ok(groups.find(group => group.key === 'utilityWarning')
    .entries.some(([id]) => id === 'klaxonStrobe'));
});

test('arc lamp emitter follows its visible shade through rotation', () => {
  const def = byId.arcFloorLamp;
  const east = fixtureLightProjection(def, { origin: { x: 5, y: 0, z: 7 }, yaw: 0 });
  const south = fixtureLightProjection(def, { origin: { x: 5, y: 0, z: 7 }, yaw: -Math.PI / 2 });
  assert.ok(east.emitter.x > 5 && Math.abs(east.emitter.z - 7) < 1e-9);
  assert.ok(south.emitter.z > 7 && Math.abs(south.emitter.x - 5) < 1e-9);
});

test('warning and wayfinding lights remain visible in daytime', () => {
  for (const id of ['klaxonStrobe', 'rotatingBeacon', 'signalTower', 'exitLight']) {
    const def = byId[id];
    assert.ok(fixtureActivationFactor(def, 0) >= def.light.dayFloor);
    assert.ok(fixtureActivationFactor(def, 0) > 0, `${id} has a daytime activation floor`);
  }
});
