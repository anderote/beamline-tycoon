import assert from 'node:assert/strict';

import { releaseGraphicsForReload } from '../src/renderer3d/reload-graphics-release.js';

const webgpuCalls = [];
assert.equal(releaseGraphicsForReload({
  setAnimationLoop: value => webgpuCalls.push(['animation', value]),
  backend: {
    isWebGPUBackend: true,
    device: { destroy: () => webgpuCalls.push(['device', 'destroy']) },
  },
  getContext: () => ({
    getExtension: () => ({ loseContext: () => webgpuCalls.push(['context', 'lose']) }),
  }),
}), 'webgpu');
assert.deepEqual(webgpuCalls, [
  ['animation', null],
  ['device', 'destroy'],
], 'native WebGPU destroys its device without touching a fallback context');

const webglCalls = [];
assert.equal(releaseGraphicsForReload({
  setAnimationLoop: value => webglCalls.push(['animation', value]),
  backend: { isWebGPUBackend: false },
  getContext: () => ({
    getExtension: name => {
      assert.equal(name, 'WEBGL_lose_context');
      return { loseContext: () => webglCalls.push(['context', 'lose']) };
    },
  }),
}), 'webgl2');
assert.deepEqual(webglCalls, [
  ['animation', null],
  ['context', 'lose'],
]);

assert.equal(releaseGraphicsForReload({ setAnimationLoop() {}, backend: {} }), null,
  'missing optional release APIs remain a safe no-op');

console.log('Reload graphics release: all assertions passed');
