// test/test-time-of-day.js — one clock, not two.
//
// Before this, "it is night" was two disagreeing facts: the renderer orbited
// a sun on a wall-clock (performance.now(), full cycle in 1 real hour) while
// the sim derived isNight from `tick % 240` (240 ticks = 4 min at 1x). This
// pins the replacement: state.timeOfDay is the single authoritative clock,
// isNightAt is a pure function of it, and the sim's day/night phase relative
// to tick count is exactly what it was before the refactor — that phase
// match is the one thing a future change to this file must not break.

import { Game, DAY_LENGTH_TICKS, isNightAt } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function mkGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

// ---------------------------------------------------------------------------
console.log('\n=== A fresh game has a valid clock ===\n');
{
  const game = mkGame(1);
  assert(typeof game.state.timeOfDay === 'number', 'timeOfDay is a number');
  assert(game.state.timeOfDay >= 0 && game.state.timeOfDay < 1,
    `timeOfDay starts in [0, 1) (got ${game.state.timeOfDay})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== timeOfDay advances and wraps over one full day ===\n');
{
  const game = mkGame(2);
  const start = game.state.timeOfDay;
  let sawWrap = false;
  for (let t = 0; t < DAY_LENGTH_TICKS; t++) {
    const before = game.state.timeOfDay;
    game.tick();
    assert(game.state.timeOfDay >= 0 && game.state.timeOfDay < 1,
      `timeOfDay stays in [0, 1) at tick ${t + 1} (got ${game.state.timeOfDay})`);
    if (game.state.timeOfDay < before) sawWrap = true;
  }
  assert(sawWrap, 'timeOfDay wraps past 1 back to 0 somewhere in one full day');
  const drift = Math.abs(game.state.timeOfDay - start);
  assert(drift < 1e-9,
    `after DAY_LENGTH_TICKS (${DAY_LENGTH_TICKS}) ticks, timeOfDay returns to its start (start=${start}, end=${game.state.timeOfDay})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== isNightAt flips exactly at the quarter-day boundaries ===\n');
{
  assert(isNightAt(0.0) === true, 'midnight (0.0) is night');
  assert(isNightAt(0.5) === false, 'noon (0.5) is day');
  assert(isNightAt(0.2499999) === true, 'just before 0.25 is still night');
  assert(isNightAt(0.25) === false, 'exactly 0.25 flips to day');
  assert(isNightAt(0.7499999) === false, 'just before 0.75 is still day');
  assert(isNightAt(0.75) === true, 'exactly 0.75 flips to night');
  assert(isNightAt(0.999) === true, 'just before midnight wraps is night');
}

// ---------------------------------------------------------------------------
console.log('\n=== isNightAt(timeOfDay) reproduces the old tick%240 phase exactly ===\n');
{
  // The sim used to derive isNight as `(tick % 240) >= 120` directly off the
  // tick counter. timeOfDay now drives it instead, but staff-needs pacing
  // must not shift by a single tick: for every tick from a fresh game,
  // isNightAt(state.timeOfDay) has to agree with the old formula bit for
  // bit, tick for tick, across more than one full day.
  const game = mkGame(3);
  let mismatches = 0;
  for (let t = 1; t <= DAY_LENGTH_TICKS * 2; t++) {
    game.tick();
    const oldIsNight = (t % 240) >= 120;
    const newIsNight = isNightAt(game.state.timeOfDay);
    if (oldIsNight !== newIsNight) mismatches++;
  }
  assert(mismatches === 0,
    `isNightAt(timeOfDay) matches (tick % 240) >= 120 for every tick across two full days (${mismatches} mismatches)`);
}

// ---------------------------------------------------------------------------
console.log('\n=== serialize()/load() round-trips timeOfDay exactly ===\n');
{
  const game = mkGame(4);
  for (let t = 0; t < 37; t++) game.tick(); // land on a non-trivial value
  const saved = game.state.timeOfDay;

  game.save();
  const loaded = mkGame(4);
  const ok = loaded.load();
  assert(ok, 'load() reads back the save just written');
  assert(loaded.state.timeOfDay === saved,
    `timeOfDay round-trips exactly through serialize/load (saved=${saved}, loaded=${loaded.state.timeOfDay})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
