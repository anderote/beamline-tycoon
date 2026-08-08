// test/test-tick-loop.js — tick-loop control: start/pause/resume/setSpeed/stop.
// Pause must actually stop the interval (frozen sim), speed recreates the
// interval at TICK_MS/mult, and paused/speed round-trip through serialize().

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame() {
  const g = new Game(new BeamlineRegistry(), { seed: 42 });
  g.state.resources.funding = 1e9;
  return g;
}

// Capture the delay Game passes to setInterval (timing-free speed check).
let lastIntervalMs = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { lastIntervalMs = ms; return realSetInterval(fn, ms); };

console.log('\n=== Tick-loop control ===\n');

// --- Defaults + start/pause/resume ---
{
  const g = makeGame();
  assert(g.state.paused === false, 'fresh game is not paused');
  assert(g.state.speed === 1, 'fresh game speed is 1');
  assert(g.tickInterval === null, 'no interval before start()');

  const events = [];
  g.on((e) => events.push(e));

  g.start();
  assert(g.tickInterval !== null, 'start() creates the interval');
  assert(lastIntervalMs === g.TICK_MS, 'interval runs at TICK_MS at 1x');

  g.pause();
  assert(g.state.paused === true, 'pause() sets state.paused');
  assert(g.tickInterval === null, 'pause() clears the interval (sim frozen)');
  assert(events.includes('speedChanged'), 'pause() emits speedChanged');

  g.pause();
  assert(events.filter(e => e === 'speedChanged').length === 1, 'pause() while paused is a no-op');

  g.resume();
  assert(g.state.paused === false, 'resume() clears state.paused');
  assert(g.tickInterval !== null, 'resume() recreates the interval');

  g.stop();
  assert(g.tickInterval === null, 'stop() clears the interval');

  // stop() allows a later restart
  g.start();
  assert(g.tickInterval !== null, 'start() after stop() restarts the loop');
  g.stop();
}

// --- setSpeed ---
{
  const g = makeGame();
  const events = [];
  g.on((e) => events.push(e));
  g.start();

  g.setSpeed(2);
  assert(g.state.speed === 2, 'setSpeed(2) sets state.speed');
  assert(lastIntervalMs === g.TICK_MS / 2, 'interval recreated at TICK_MS/2');
  assert(events.includes('speedChanged'), 'setSpeed emits speedChanged');

  g.setSpeed(4);
  assert(lastIntervalMs === g.TICK_MS / 4, 'interval recreated at TICK_MS/4');

  const n = events.filter(e => e === 'speedChanged').length;
  g.setSpeed(4);
  assert(events.filter(e => e === 'speedChanged').length === n, 'same speed is a no-op');
  g.setSpeed(3);
  assert(g.state.speed === 4, 'invalid multiplier is rejected');

  // Speed change while paused must not resurrect the interval
  g.pause();
  g.setSpeed(1);
  assert(g.tickInterval === null, 'setSpeed while paused keeps the sim frozen');
  g.resume();
  assert(lastIntervalMs === g.TICK_MS, 'resume() uses the speed set while paused');
  g.stop();
}

// --- start() honors pre-set pause (loaded-save case) ---
{
  const g = makeGame();
  g.state.paused = true;
  g.start();
  assert(g.tickInterval === null, 'start() with paused state does not tick');
  g.resume();
  assert(g.tickInterval !== null, 'resume() after paused start begins ticking');
  g.stop();
}

// --- paused/speed serialize round-trip ---
{
  const g = makeGame();
  g.start();
  g.setSpeed(4);
  g.pause();
  const data = JSON.parse(g.serialize());
  assert(data.state.paused === true, 'serialize() persists paused');
  assert(data.state.speed === 4, 'serialize() persists speed');
  g.stop();
}

// --- Pause actually freezes tick() in real time ---
{
  const g = makeGame();
  g.TICK_MS = 5;
  g.save = () => {}; // autosave at tick%30 hits localStorage, absent in Node
  g.start();
  await new Promise(r => setTimeout(r, 60));
  assert(g.state.tick > 0, 'sim ticks while running');
  g.pause();
  const frozen = g.state.tick;
  await new Promise(r => setTimeout(r, 40));
  assert(g.state.tick === frozen, 'no ticks accumulate while paused');
  g.stop();
}

globalThis.setInterval = realSetInterval;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
