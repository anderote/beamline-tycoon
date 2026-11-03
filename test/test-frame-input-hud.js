import assert from 'node:assert/strict';
import { panFrameScale } from '../src/input/pan-timing.js';
import { UIHost } from '../src/ui/UIHost.js';
for (const hz of [30, 60, 120, 144]) {
  const distance = hz * panFrameScale(1000 / hz);
  assert.ok(Math.abs(distance - 60) < 1e-9, `same distance at ${hz}Hz`);
}
assert.equal(panFrameScale(1000), 3, 'stalls do not teleport the camera');
assert.equal(panFrameScale(-5), 0);
const original = globalThis.requestAnimationFrame;
const callbacks = [];
globalThis.requestAnimationFrame = callback => callbacks.push(callback);
try {
  const renderer = { game: { state: { resources: { funding: 1 } } } };
  const ui = new UIHost(renderer);
  const observed = [];
  ui._updateHUD = () => observed.push(ui.game.state.resources.funding);
  ui.requestHUDUpdate();
  renderer.game.state.resources.funding = 2;
  ui.requestHUDUpdate();
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.deepEqual(observed, [2], 'one paint reads latest published state');
  ui.requestHUDUpdate(); callbacks.shift()();
  assert.deepEqual(observed, [2, 2], 'later updates remain live');
} finally { globalThis.requestAnimationFrame = original; }
console.log('Refresh-independent camera movement and coalesced HUD pass');
