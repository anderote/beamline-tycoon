import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDeferredPhysicsStart,
  PHYSICS_IDLE_TIMEOUT_MS,
  PHYSICS_PLAYABLE_RUNWAY_MS,
} from '../src/beamline/deferred-physics-start.js';

function harness() {
  const timers = new Map();
  const idles = new Map();
  let nextId = 1;
  return {
    timers,
    idles,
    options: {
      setTimer(callback, delay) {
        const id = nextId++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimer(id) { timers.delete(id); },
      requestIdle(callback, options) {
        const id = nextId++;
        idles.set(id, { callback, options });
        return id;
      },
      cancelIdle(id) { idles.delete(id); },
    },
  };
}

test('hosted physics waits for a playable runway and an idle slice', () => {
  const fake = harness();
  let starts = 0;
  const deferred = createDeferredPhysicsStart(() => { starts++; }, fake.options);

  assert.equal(deferred.schedule(), true);
  assert.equal(deferred.schedule(), false, 'scheduling is idempotent');
  assert.equal(starts, 0);
  assert.equal([...fake.timers.values()][0].delay, PHYSICS_PLAYABLE_RUNWAY_MS);

  [...fake.timers.values()][0].callback();
  assert.equal(starts, 0, 'the runway hands off to browser idle instead of starting directly');
  assert.equal([...fake.idles.values()][0].options.timeout, PHYSICS_IDLE_TIMEOUT_MS);

  [...fake.idles.values()][0].callback();
  assert.equal(starts, 1);
  assert.equal(deferred.started, true);
  assert.equal(deferred.runNow(), false, 'an on-demand join cannot start a second worker');
});

test('an explicit physics consumer can start during the runway', () => {
  const fake = harness();
  let starts = 0;
  const deferred = createDeferredPhysicsStart(() => { starts++; }, fake.options);
  deferred.schedule();

  assert.equal(deferred.runNow(), true);
  assert.equal(starts, 1);
  assert.equal(fake.timers.size, 0, 'the delayed warmup is cancelled');
  assert.equal(deferred.schedule(), false);
});

test('fallback browsers start after the runway without requestIdleCallback', () => {
  const fake = harness();
  let starts = 0;
  const deferred = createDeferredPhysicsStart(() => { starts++; }, {
    ...fake.options,
    requestIdle: null,
  });
  deferred.schedule();
  [...fake.timers.values()][0].callback();
  assert.equal(starts, 1);
});
