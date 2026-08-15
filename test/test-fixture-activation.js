import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureActivationFactor } from '../src/renderer3d/fixture-activation.js';

test('outdoor practicals follow twilight while zoned fixtures remain useful by day', () => {
  const ground = { mount: 'ground' };
  const wall = { mount: 'wall' };
  assert.equal(fixtureActivationFactor(ground, 0), 0);
  assert.equal(fixtureActivationFactor(ground, 0.45), 0.45);
  assert.equal(fixtureActivationFactor(wall, 0, { indoors: true }), 0.82);
  assert.equal(fixtureActivationFactor(ground, 1, { indoors: true }), 1);
});

test('overhead fixtures keep a conservative construction floor without a room zone', () => {
  const overhead = { mount: 'overhead' };
  assert.equal(fixtureActivationFactor(overhead, 0), 0.28);
  assert.equal(fixtureActivationFactor(overhead, 0.7), 0.7);
  assert.equal(fixtureActivationFactor(overhead, NaN), 0.28);
});
