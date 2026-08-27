import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LodPreparationScheduler } from '../src/renderer3d/lod-preparation-scheduler.js';

function idleScope() {
  let nextId = 1;
  const callbacks = new Map();
  const cancelled = [];
  return {
    callbacks,
    cancelled,
    requestIdleCallback(callback, options) {
      const id = nextId++;
      callbacks.set(id, { callback, options });
      return id;
    },
    cancelIdleCallback(id) {
      cancelled.push(id);
      callbacks.delete(id);
    },
    run(id) {
      const pending = callbacks.get(id);
      callbacks.delete(id);
      pending?.callback({ didTimeout: false, timeRemaining: () => 8 });
    },
  };
}

test('LOD preparation runs one builder in each idle slice', () => {
  const scope = idleScope();
  const scheduler = new LodPreparationScheduler({ scope, timeout: 700 });
  const calls = [];

  assert.equal(scheduler.schedule([
    { prepareFarPresentation: () => calls.push('equipment') },
    { prepareFarPresentation: () => calls.push('decorations') },
  ]), true);
  assert.equal(scope.callbacks.size, 1);
  assert.deepEqual([...scope.callbacks.values()][0].options, { timeout: 700 });

  scope.run(1);
  assert.deepEqual(calls, ['equipment']);
  assert.equal(scope.callbacks.size, 1);
  assert.equal(scheduler.pending, true);

  scope.run(2);
  assert.deepEqual(calls, ['equipment', 'decorations']);
  assert.equal(scheduler.pending, false);
});

test('LOD preparation cancels stale work when a new world is scheduled', () => {
  const scope = idleScope();
  const scheduler = new LodPreparationScheduler({ scope });
  const calls = [];

  scheduler.schedule([
    { prepareFarPresentation: () => calls.push('stale-1') },
    { prepareFarPresentation: () => calls.push('stale-2') },
  ]);
  scheduler.schedule([{ prepareFarPresentation: () => calls.push('current') }]);

  assert.deepEqual(scope.cancelled, [1]);
  scope.run(2);
  assert.deepEqual(calls, ['current']);
  assert.equal(scheduler.pending, false);
});

test('LOD preparation cancellation prevents the remaining queue from running', () => {
  const scope = idleScope();
  const scheduler = new LodPreparationScheduler({ scope });
  const calls = [];

  scheduler.schedule([
    { prepareFarPresentation: () => calls.push('first') },
    { prepareFarPresentation: () => calls.push('second') },
  ]);
  scope.run(1);
  scheduler.cancel();

  assert.deepEqual(scope.cancelled, [2]);
  assert.deepEqual(calls, ['first']);
  assert.equal(scheduler.pending, false);
});

test('LOD preparation uses a short timer when idle callbacks are unavailable', () => {
  let scheduled = null;
  const scope = {
    setTimeout(callback, delay) {
      scheduled = { callback, delay };
      return 41;
    },
    clearTimeout() {},
  };
  const scheduler = new LodPreparationScheduler({ scope, fallbackDelay: 24 });
  let calls = 0;

  scheduler.schedule([{ prepareFarPresentation: () => calls++ }]);
  assert.equal(scheduled.delay, 24);
  assert.equal(calls, 0);
  scheduled.callback();
  assert.equal(calls, 1);
});
