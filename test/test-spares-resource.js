// test/test-spares-resource.js — the `spares` resource: starting value and
// save/load round-trip, mirroring the funding/reputation/data pattern.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game.save()/load() talk to localStorage; back it with a Map for Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

console.log('\n=== Fresh facility starts with 50 spares ===\n');

const g = makeGame(1);
assertOk(g.state.resources.spares === 50, `fresh game starts with 50 spares (got ${g.state.resources.spares})`);

console.log('\n=== spares round-trips through serialize/deserialize ===\n');

g.state.resources.spares = 37;
const payload = g.serialize();
localStorage.setItem('beamlineTycoon', payload);

const g2 = makeGame(2);
assertOk(g2.load(), 'load() succeeds');
assertOk(g2.state.resources.spares === 37, `loaded game restores modified spares value (got ${g2.state.resources.spares})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
