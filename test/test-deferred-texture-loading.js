import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextureManager } from '../src/renderer3d/texture-manager.js';

test('deferred decoration textures use bounded parallel loading', async () => {
  const originalFetch = globalThis.fetch;
  const originalThree = globalThis.THREE;
  let active = 0;
  let peak = 0;
  let completed = 0;
  const releases = [];

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
        `texture-${index}`,
        { file: `texture-${index}.png` },
      ]));
    },
  });
  globalThis.THREE = {
    NearestFilter: 'nearest',
    SRGBColorSpace: 'srgb',
    TextureLoader: class {
      loadAsync() {
        active++;
        peak = Math.max(peak, active);
        return new Promise(resolve => releases.push(() => {
          active--;
          completed++;
          resolve({});
        }));
      }
    },
  };

  try {
    const manager = new TextureManager();
    const loading = manager.loadDecorationManifest();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(peak, 6, 'the initial pool fills without launching every decode');
    while (completed < 12) {
      const batch = releases.splice(0);
      assert.ok(batch.length > 0, 'each completed pool batch schedules the next one');
      batch.forEach(release => release());
      await new Promise(resolve => setImmediate(resolve));
    }
    await loading;
    assert.equal(active, 0);
    assert.equal(completed, 12);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.THREE = originalThree;
  }
});
