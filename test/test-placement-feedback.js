import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Three from 'three';

globalThis.THREE = Three;

const {
  PLACEMENT_GHOST_LIFT,
  PLACEMENT_IMPACT_PROGRESS,
  PlacementFeedbackSystem,
  placementDustScale,
  placementFeedbackIds,
  placementSettleOffset,
} = await import('../src/renderer3d/placement-feedback.js');

test('placement settle falls from the carried height, bounces, and finishes exactly at rest', () => {
  assert.equal(placementSettleOffset(0), PLACEMENT_GHOST_LIFT);
  assert.equal(placementSettleOffset(PLACEMENT_IMPACT_PROGRESS), 0);
  assert.ok(placementSettleOffset(0.7) > 0, 'the stomp has one small rebound');
  assert.equal(placementSettleOffset(1), 0);
  assert.equal(placementDustScale(0), 0);
  assert.ok(placementDustScale(0.5) > 0.9, 'dust is fullest around mid-life');
  assert.ok(placementDustScale(0.99) < 0.1, 'dust shrinks away instead of popping out');
});

test('coalesced group placement queues every surviving exact placeable id', () => {
  const changeSet = {
    placeables: new Map([
      ['a', { id: 'a', action: 'added' }],
      ['b', { id: 'b', action: 'updated' }],
      ['gone', { id: 'gone', action: 'removed' }],
    ]),
  };
  assert.deepEqual(placementFeedbackIds({ action: 'moved', changeSet }), ['a', 'b']);
  assert.deepEqual(placementFeedbackIds({ action: 'changed', changeSet }), [],
    'simulation-driven updates do not repeatedly stomp settled objects');
  assert.deepEqual(placementFeedbackIds({ action: 'placed', placeableId: 'solo' }), ['solo']);
});

test('placement feedback offsets only renderer geometry and emits bounded dust on impact', () => {
  const scene = new Three.Scene();
  const object = new Three.Group();
  object.position.set(4, 2, 7);
  object.matrixAutoUpdate = false;
  scene.add(object);
  const system = new PlacementFeedbackSystem(scene, {
    random: () => 0.5,
    resolveTarget: id => id === 'machine'
      ? { object, dustY: 1.25, footprintRadius: 1.5 }
      : { supported: false },
  });

  assert.equal(system.request('machine'), true);
  system.update(0);
  assert.equal(object.position.y, 2 + PLACEMENT_GHOST_LIFT,
    'the committed wrapper begins at the same lifted handoff height as its ghost');

  system.update(0.1);
  system.update(0.1);
  system.update(0.1);
  assert.ok(system.dustMesh.count >= 5, 'impact emits a small ring of dust puffs');
  assert.ok(system.dustMesh.count <= system.maxDustPuffs, 'dust stays inside its fixed pool');

  for (let i = 0; i < 5; i++) system.update(0.1);
  assert.equal(object.position.y, 2, 'settling restores the canonical authored pose exactly');
  assert.equal(system.active.size, 0);

  system.request('machine');
  system.update(0);
  system.dispose();
  assert.equal(object.position.y, 2, 'teardown also restores an interrupted landing');
});
