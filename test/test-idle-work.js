import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleBrowserIdle } from '../src/game/idle-work.js';

test('browser idle work prefers requestIdleCallback with a timeout', () => {
  let scheduled = null;
  const scope = {
    requestIdleCallback(callback, options) {
      scheduled = { callback, options };
      return 17;
    },
  };
  let calls = 0;
  assert.equal(scheduleBrowserIdle(() => calls++, { scope, timeout: 900 }), 17);
  assert.equal(calls, 0);
  assert.deepEqual(scheduled.options, { timeout: 900 });
  scheduled.callback();
  assert.equal(calls, 1);
});

test('browser fallback defers with setTimeout while headless scope stays synchronous', () => {
  let deferred = null;
  const browser = { setTimeout: (callback, delay) => { deferred = { callback, delay }; return 8; } };
  browser.window = browser;
  let browserCalls = 0;
  assert.equal(scheduleBrowserIdle(() => browserCalls++, { scope: browser }), 8);
  assert.equal(browserCalls, 0);
  assert.equal(deferred.delay, 0);
  deferred.callback();
  assert.equal(browserCalls, 1);

  let headlessCalls = 0;
  scheduleBrowserIdle(() => headlessCalls++, { scope: {} });
  assert.equal(headlessCalls, 1);
});
