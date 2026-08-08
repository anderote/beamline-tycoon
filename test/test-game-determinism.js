// test/test-game-determinism.js — same-seed sim reproducibility.
// Two Games built with the same seed and ticked in lockstep must serialize()
// to byte-identical payloads (all sim randomness flows through game.rng); a
// third Game on a different seed must diverge. Runs headless: Pyodide physics
// is unavailable in Node, so the fallback stats path is what gets exercised —
// determinism must hold there too.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Autosave (tick % 10) writes through localStorage; back it with a Map.
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

function makeGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

// Report the first diverging serialized field so a failure names its source
// instead of just dumping two megabyte strings.
function firstDivergence(a, b) {
  const sa = JSON.parse(a).state, sb = JSON.parse(b).state;
  for (const key of Object.keys(sa)) {
    if (JSON.stringify(sa[key]) !== JSON.stringify(sb[key])) return key;
  }
  return '(aux/beamlines)';
}

console.log('\n=== Sim determinism ===\n');

const g1 = makeGame(1234);
const g2 = makeGame(1234);

assert(g1.serialize() === g2.serialize(), 'same-seed games serialize identically at tick 0');

// Drive tick() directly — no intervals, no wall clock.
for (let i = 0; i < 100; i++) { g1.tick(); g2.tick(); }

const p1 = g1.serialize();
const p2 = g2.serialize();
if (p1 === p2) {
  assert(true, 'same-seed games serialize identically after 100 ticks');
} else {
  assert(false, `same-seed games diverged after 100 ticks (first differing field: ${firstDivergence(p1, p2)})`);
}

const g3 = makeGame(9999);
for (let i = 0; i < 100; i++) g3.tick();
assert(g3.serialize() !== p1, 'different-seed game serializes differently');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
