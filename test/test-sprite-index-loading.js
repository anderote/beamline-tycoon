import assert from 'node:assert/strict';
import { SpriteManager } from '../src/renderer/sprites.js';
const originalFetch = globalThis.fetch;
const requests = [];
const releases = [];
try {
  globalThis.fetch = url => {
    requests.push(url);
    return new Promise(resolve => releases.push(() => resolve({ ok: true, json: async () => ({}) })));
  };
  const manager = new SpriteManager();
  const pending = manager.loadIndexes();
  assert.equal(requests.length, 3, 'all indexes start without awaiting another fetch');
  releases.forEach(resolve => resolve());
  await pending;
} finally { globalThis.fetch = originalFetch; }
console.log('Sprite index concurrent loading passes');
