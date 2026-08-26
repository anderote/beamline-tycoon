import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Game } from '../src/game/Game.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('loaded events identify startup restores so the final world builds once', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const seed = new Game(new BeamlineRegistry());
    storage.setItem('beamlineTycoon', seed.serialize());

    const startup = new Game(new BeamlineRegistry());
    let startupPayload = null;
    startup.on((event, data) => {
      if (event === 'loaded') startupPayload = data;
    });
    assert.equal(startup.load(), true);
    assert.deepEqual(startupPayload, { duringStartup: true });

    const runtime = new Game(new BeamlineRegistry());
    runtime.start();
    runtime.pause();
    assert.equal(runtime.tickInterval, null,
      'a paused runtime has no timer but is still past startup');
    let runtimePayload = null;
    runtime.on((event, data) => {
      if (event === 'loaded') runtimePayload = data;
    });
    assert.equal(runtime.load(), true);
    assert.deepEqual(runtimePayload, { duringStartup: false });
    runtime.stop();
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test('the renderer defers only startup loads, never runtime load or undo', () => {
  const source = readFileSync(
    new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url),
    'utf8',
  );
  const loadedCase = source.indexOf("case 'loaded':");
  const restoredCase = source.indexOf("case 'restored':", loadedCase);
  const loadedBody = source.slice(loadedCase, restoredCase);

  assert.match(loadedBody, /if \(data\?\.duringStartup\)/);
  assert.match(loadedBody, /this\.refresh\(\)/,
    'runtime loads retain their immediate full refresh');
  assert.match(source.slice(restoredCase, restoredCase + 400), /this\.refresh\(\)/,
    'undo and redo restores retain their immediate full refresh');
});
