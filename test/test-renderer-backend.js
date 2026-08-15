import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RENDERER_RECOVERY_MODE_STORAGE_KEY,
  RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY,
  createRendererRecovery,
  requestedRendererMode,
} from '../src/renderer3d/renderer-backend.js';

const locationWith = (search = '') => ({ search });
const storageWith = (value = null) => ({ getItem: () => value });
const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test('renderer query explicitly selects native/default or forced WebGL 2 paths', () => {
  assert.equal(requestedRendererMode(locationWith('?renderer=modern'), storageWith('legacy')), 'modern');
  assert.equal(requestedRendererMode(locationWith('?renderer=webgpu'), storageWith('legacy')), 'modern');
  assert.equal(requestedRendererMode(locationWith('?renderer=legacy'), storageWith(null)), 'legacy');
  assert.equal(requestedRendererMode(locationWith('?renderer=webgl'), storageWith(null)), 'legacy');
});

test('stored rollback preference applies only without an explicit renderer query', () => {
  assert.equal(requestedRendererMode(locationWith(''), storageWith('legacy')), 'legacy');
  assert.equal(requestedRendererMode(locationWith(''), storageWith('webgl')), 'legacy');
  assert.equal(requestedRendererMode(locationWith(''), storageWith('modern')), 'modern');
  assert.equal(requestedRendererMode(locationWith('?unrelated=1'), storageWith(null)), 'modern');
});

test('session recovery pins the tab to WebGL without overriding an explicit query', () => {
  const recovery = storageWith('legacy');
  assert.equal(requestedRendererMode(locationWith(''), storageWith(null), recovery), 'legacy');
  assert.equal(requestedRendererMode(locationWith('?renderer=modern'), storageWith(null), recovery), 'modern');
});

test('device loss saves, selects WebGL recovery, and reloads once', () => {
  const session = memoryStorage();
  let saves = 0;
  let reloads = 0;
  const recover = createRendererRecovery({
    sessionStorage: session,
    location: { reload: () => { reloads++; } },
    save: () => { saves++; },
    now: () => 100_000,
    defer: (callback) => callback(),
  });

  assert.deepEqual(recover({ api: 'WebGPU' }), { reloaded: true, reason: 'device-lost' });
  assert.equal(saves, 1);
  assert.equal(reloads, 1);
  assert.equal(session.getItem(RENDERER_RECOVERY_MODE_STORAGE_KEY), 'legacy');
  assert.equal(session.getItem(RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY), '100000');
  assert.deepEqual(recover({ api: 'WebGPU' }), { reloaded: false, reason: 'already-handled' });
  assert.equal(reloads, 1);
});

test('repeated device loss inside the cooldown does not reload-loop', () => {
  const session = memoryStorage({
    [RENDERER_RECOVERY_RELOAD_AT_STORAGE_KEY]: '95000',
  });
  let suppressed = null;
  let reloads = 0;
  const recover = createRendererRecovery({
    sessionStorage: session,
    location: { reload: () => { reloads++; } },
    now: () => 100_000,
    defer: (callback) => callback(),
    onReloadSuppressed: (info) => { suppressed = info; },
  });

  const info = { api: 'WebGL' };
  assert.deepEqual(recover(info), { reloaded: false, reason: 'cooldown' });
  assert.equal(reloads, 0);
  assert.equal(suppressed, info);
});
