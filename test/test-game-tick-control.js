// test/test-game-tick-control.js — pause/resume/setSpeed/stop side effects,
// timing-free. setInterval/clearInterval are replaced with pure fakes so
// "time passes" means manually firing the captured callback: pause must leave
// no live callback (funds frozen), resume restores one, setSpeed recreates
// the interval at TICK_MS/mult, and stop() clears the handle.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Autosave (tick % 30) writes through localStorage; back it with a Map.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Fake timers: nothing is ever scheduled for real. `timers` maps live handle
// ids to {fn, ms}; firing a tick = invoking the sole live callback by hand.
let nextHandle = 1;
const timers = new Map();
globalThis.setInterval = (fn, ms) => { const id = nextHandle++; timers.set(id, { fn, ms }); return id; };
globalThis.clearInterval = (id) => { timers.delete(id); };
const liveTimer = () => (timers.size === 1 ? [...timers.values()][0] : null);

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('\n=== Tick control (fake timers) ===\n');

const g = new Game(new BeamlineRegistry(), { seed: 42 });

// --- start() schedules one interval at TICK_MS ---
g.start();
assert(timers.size === 1, 'start() schedules exactly one interval');
assert(liveTimer().ms === g.TICK_MS, 'interval cadence is TICK_MS at 1x');

// Firing the interval callback runs a tick with side effects (staff wages).
const fundsBefore = g.state.resources.funding;
liveTimer().fn();
assert(g.state.tick === 1, 'interval callback advances the tick counter');
assert(g.state.resources.funding !== fundsBefore, 'tick has funds side effects (wage drain)');

// --- pause() removes the interval: no callback left to fire, funds frozen ---
g.pause();
assert(g.state.paused === true, 'pause() sets state.paused');
assert(g.tickInterval === null && timers.size === 0, 'pause() clears the interval — no live callback');
const frozenFunds = g.state.resources.funding;
const frozenTick = g.state.tick;
// With no live timer there is nothing to fire; any amount of wall-clock time
// passing changes nothing.
assert(g.state.resources.funding === frozenFunds && g.state.tick === frozenTick,
  'funds and tick unchanged while paused');

// --- resume() restores the interval and side effects ---
g.resume();
assert(g.state.paused === false, 'resume() clears state.paused');
assert(timers.size === 1 && liveTimer().ms === g.TICK_MS, 'resume() reschedules at the current cadence');
liveTimer().fn();
assert(g.state.tick === frozenTick + 1, 'ticks advance again after resume()');
assert(g.state.resources.funding !== frozenFunds, 'funds side effects restored after resume()');

// --- setSpeed recreates the interval at TICK_MS/mult ---
for (const mult of [2, 4, 1]) {
  g.setSpeed(mult);
  assert(g.state.speed === mult, `setSpeed(${mult}) sets state.speed`);
  assert(timers.size === 1, `setSpeed(${mult}) leaves exactly one live interval (old one cleared)`);
  assert(liveTimer().ms === g.TICK_MS / mult, `interval recreated at TICK_MS/${mult}`);
}
g.setSpeed(3);
assert(g.state.speed === 1 && liveTimer().ms === g.TICK_MS, 'invalid multiplier is rejected');

// setSpeed while paused must not resurrect the interval; resume picks it up.
g.pause();
g.setSpeed(4);
assert(timers.size === 0, 'setSpeed while paused keeps the sim frozen');
g.resume();
assert(liveTimer().ms === g.TICK_MS / 4, 'resume() uses the speed set while paused');

// --- stop() clears the handle ---
g.stop();
assert(g.tickInterval === null, 'stop() nulls the interval handle');
assert(timers.size === 0, 'stop() cancels the scheduled interval');

// --- autosave cadence: every 30 ticks, skipped while paused ---
// pause() clears the interval so tick() normally never fires paused; the
// paused guard covers direct drivers (headless env, demo remote-drive) that
// call tick() by hand. Manual save() stays available regardless.
console.log('\n=== Autosave cadence ===\n');
{
  const g2 = new Game(new BeamlineRegistry(), { seed: 7 });
  let saves = 0;
  g2.save = () => { saves++; };

  for (let i = 0; i < 29; i++) g2.tick();
  assert(saves === 0, 'no autosave before tick 30');
  g2.tick(); // tick 30
  assert(saves === 1, 'autosave fires at tick 30');
  for (let i = 0; i < 60; i++) g2.tick(); // through tick 90
  assert(saves === 3, `autosave every 30 ticks (got ${saves} by tick 90)`);

  g2.state.paused = true;
  for (let i = 0; i < 30; i++) g2.tick(); // through tick 120 (includes %30 boundary)
  assert(saves === 3, 'directly-driven ticks while paused never autosave');
  g2.state.paused = false;
  for (let i = 0; i < 30; i++) g2.tick(); // through tick 150
  assert(saves === 4, 'autosave resumes on the next %30 boundary after unpause');

  // Manual save path is independent of pause and cadence.
  g2.state.paused = true;
  store.delete('beamlineTycoon');
  Game.prototype.save.call(g2);
  assert(typeof store.get('beamlineTycoon') === 'string' && store.get('beamlineTycoon').length > 0,
    'manual save() writes localStorage even while paused');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
