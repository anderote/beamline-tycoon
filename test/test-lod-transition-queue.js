import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LodTransitionQueue } from '../src/renderer3d/lod-transition-queue.js';

const step = (id, calls) => ({ id, apply: () => calls.push(id) });

test('LOD transitions expose one family per admitted frame', () => {
  const calls = [];
  const queue = new LodTransitionQueue();
  queue.schedule(true, [step('components', calls), step('equipment', calls)]);

  assert.equal(queue.pendingCount, 2);
  assert.equal(queue.advance(), 'components');
  assert.deepEqual(calls, ['components']);
  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.advance(), 'equipment');
  assert.equal(queue.advance(), null);
});

test('reversing a transition replaces stale pending families', () => {
  const calls = [];
  const queue = new LodTransitionQueue();
  queue.schedule(true, [step('near-components', calls), step('near-equipment', calls)]);
  queue.advance();
  queue.schedule(false, [step('far-components', calls), step('far-equipment', calls)]);

  assert.equal(queue.target, false);
  assert.deepEqual(queue.flush(), ['far-components', 'far-equipment']);
  assert.deepEqual(calls, ['near-components', 'far-components', 'far-equipment']);
});

test('flush completes a prepared transition before interactive rendering', () => {
  const calls = [];
  const queue = new LodTransitionQueue();
  queue.schedule(false, [step('one', calls), step('two', calls), step('three', calls)]);

  assert.deepEqual(queue.flush(), ['one', 'two', 'three']);
  assert.equal(queue.pendingCount, 0);
  assert.deepEqual(calls, ['one', 'two', 'three']);
});

test('independent utility work is coalesced behind an active world transition', () => {
  const calls = [];
  const queue = new LodTransitionQueue();
  queue.replaceGroup('world', [step('components', calls), step('equipment', calls)]);
  queue.replaceGroup('utilities', [step('old-utility-a', calls), step('old-utility-b', calls)]);
  queue.replaceGroup('utilities', [step('utilities', calls)]);

  assert.deepEqual(queue.flush(), ['components', 'equipment', 'utilities']);
  assert.deepEqual(calls, ['components', 'equipment', 'utilities']);
});
