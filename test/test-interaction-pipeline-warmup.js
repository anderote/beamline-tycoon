import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { precompileWorldPipelines } from '../src/renderer3d/interaction-pipeline-warmup.js';

test('mid-game world compilation does not submit a blocking render', async () => {
  const calls = [];
  const renderer = {
    backend: {
      isWebGPUBackend: true,
      device: { queue: { async onSubmittedWorkDone() { calls.push(['drained']); } } },
    },
    async compileAsync(...args) { calls.push(['compile', ...args]); },
    async renderAsync(...args) { calls.push(['renderAsync', ...args]); },
    render(...args) { calls.push(['render', ...args]); },
  };
  const scene = { name: 'expanded-world' };
  const camera = { name: 'camera' };

  assert.equal(await precompileWorldPipelines(renderer, scene, camera), true);
  assert.deepEqual(calls, [
    ['compile', scene, camera],
    ['renderAsync', scene, camera],
    ['drained'],
  ]);
});

test('later world growth reuses the warmed render context', async () => {
  const calls = [];
  const renderer = {
    backend: { isWebGPUBackend: true },
    async compileAsync() { calls.push('compile'); },
    async renderAsync() { calls.push('render'); },
  };
  assert.equal(await precompileWorldPipelines(renderer, {}, {}, {
    submit: false,
  }), true);
  assert.deepEqual(calls, ['compile']);
});

test('boot builds the final world before one ordinary prepared title frame', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const restoredView = source.indexOf('if (restoredView)');
  const refresh = source.indexOf('renderer.refresh();', restoredView);
  const preparedFrame = source.indexOf('renderer.renderPreparedWorldFrame()', refresh);
  const restoredProbe = source.indexOf('if (restoredProbe)', preparedFrame);

  assert.ok(restoredView >= 0 && restoredView < refresh,
    'the final world refresh follows restored camera configuration');
  assert.ok(refresh < preparedFrame && preparedFrame < restoredProbe,
    'one normal frame follows the final build without a second pipeline warmup');
  assert.doesNotMatch(source, /prewarmInteractionPipelines|createInteractionPipelineWarmup/,
    'startup never bulk-compiles the direct camera-motion pipeline family');
});
