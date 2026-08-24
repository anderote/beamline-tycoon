import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prewarmInteractionPipelines } from '../src/renderer3d/interaction-pipeline-warmup.js';

test('prewarms the direct render target on native WebGPU', async () => {
  const scene = { name: 'world' };
  const camera = { name: 'camera' };
  const calls = [];
  const renderer = {
    backend: {
      isWebGPUBackend: true,
      device: { queue: { async onSubmittedWorkDone() { calls.push(['drained']); } } },
    },
    async compileAsync(...args) { calls.push(['compile', ...args]); },
    render(...args) { calls.push(['render', ...args]); },
  };

  assert.equal(await prewarmInteractionPipelines(renderer, scene, camera), true);
  assert.deepEqual(calls, [
    ['compile', scene, camera],
    ['render', scene, camera],
    ['drained'],
  ]);
});

test('skips compatibility rendering and unsupported renderer versions', async () => {
  let compileCalls = 0;
  const fallback = {
    backend: { isWebGPUBackend: false },
    async compileAsync() { compileCalls += 1; },
    render() { compileCalls += 1; },
  };

  assert.equal(await prewarmInteractionPipelines(fallback, {}, {}), false);
  assert.equal(await prewarmInteractionPipelines({ backend: { isWebGPUBackend: true } }, {}, {}), false);
  assert.equal(compileCalls, 0);
});

test('a warmup failure does not block game boot', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const renderer = {
      backend: { isWebGPUBackend: true },
      async compileAsync() { throw new Error('device changed'); },
      render() {},
    };
    assert.equal(await prewarmInteractionPipelines(renderer, {}, {}), false);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('boot refreshes the loaded world and warms it after restoring the camera', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const restoredView = source.indexOf('if (restoredView)');
  const refresh = source.indexOf('renderer.refresh();', restoredView);
  const warmup = source.indexOf(
    'await prewarmInteractionPipelines(renderer.renderer, renderer.scene, renderer.camera);',
    refresh,
  );
  const restoredProbe = source.indexOf('if (restoredProbe)', warmup);

  assert.ok(restoredView >= 0 && restoredView < refresh,
    'the final world refresh follows restored camera configuration');
  assert.ok(refresh < warmup, 'the final world is rebuilt before pipeline compilation');
  assert.ok(warmup < restoredProbe, 'pipeline compilation finishes before later boot restoration');
});
