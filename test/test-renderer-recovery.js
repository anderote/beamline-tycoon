import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachRendererLossHandler } from '../src/renderer3d/renderer-recovery.js';

test('renderer loss handler preserves Three bookkeeping and fires once per loss', () => {
  const calls = [];
  const renderer = { onDeviceLost(info) { calls.push(['three', this === renderer, info.api]); } };
  const detach = attachRendererLossHandler(renderer, (info) => calls.push(['app', info.reason]));
  renderer.onDeviceLost({ api: 'WebGPU', reason: 'unknown' });
  assert.deepEqual(calls, [['three', true, 'WebGPU'], ['app', 'unknown']]);
  detach();
  renderer.onDeviceLost({ api: 'WebGL', reason: 'context-lost' });
  assert.equal(calls.length, 3, 'detach restores the original callback');
  assert.deepEqual(calls[2], ['three', true, 'WebGL']);
});
