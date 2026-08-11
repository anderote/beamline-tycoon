// test/test-infra-quality-propagation.js — the gate's qualities must reach physics.
//
// The physics pass stamps each element's fail-closed `infraQuality` from
// state.nodeQualities (Game._recalcSingleBeamline). Only UtilityGate writes
// that map, and it runs LAST in tick() — so on the boot/load path the pass
// read an empty map, floored every declared sink to 0 and latched there for
// the session: a fully wired facility reported zero blockers and healthy
// solved qualities while its beam produced beamEnergy 0 and beamQuality 0.51.
// The fail-closed floor is correct; reading it before the first solve was not.
//
//   1. Boot a wired scenario: the beam produces energy, and re-running the
//      recalc changes nothing (the first pass was already correct).
//   2. Same after serialize -> load.
//   3. Cutting power still fails closed, and the beam follows within a tick.
//   4. Re-wiring revives the beam within a tick, with no build mutation.
//   5. Steady state does not re-run the physics pass every tick.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { SCENARIOS } from '../src/data/scenarios.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// The gate console.warns its blocker set whenever the count changes; that is
// expected output here (tests 3 and 4 cut utilities on purpose).
const realWarn = console.warn;
console.warn = (...args) => {
  if (String(args[0] ?? '').startsWith('[utility]')) return;
  realWarn(...args);
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');

function boot(seed = 1) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.applyScenario(scenario.generator());
  if (scenario.setup) scenario.setup(game);
  game.recalcAllBeamlines();
  return game;
}
const sourceEntry = (game) => game.registry.getAll().find(e => e.sourceId);
const powerLines = (game) => [...game.state.utilityLines.entries()]
  .filter(([, l]) => l.utilityType === 'powerCable');

console.log('\n--- 1. boot path: a wired facility produces beam ---');
{
  const game = boot();
  const entry = sourceEntry(game);
  game.toggleBeam(entry.id);
  for (let i = 0; i < 100; i++) game.tick();
  assert(entry.beamState.beamEnergy > 0,
    `beamEnergy > 0 after 100 ticks (${entry.beamState.beamEnergy})`);
  assert(entry.beamState.beamQuality > 0.9,
    `beamQuality tracks the solved vacuum (${entry.beamState.beamQuality})`);
  const before = entry.beamState.beamEnergy;
  game.recalcAllBeamlines();
  assert(entry.beamState.beamEnergy === before,
    'an extra recalc after the gate has run changes nothing');
}

console.log('\n--- 2. save/load path ---');
{
  const game = boot();
  const entry = sourceEntry(game);
  game.toggleBeam(entry.id);
  for (let i = 0; i < 10; i++) game.tick();
  const blob = game.serialize();

  const loaded = new Game(new BeamlineRegistry(), { seed: 1 });
  loaded.load(blob);
  for (let i = 0; i < 50; i++) loaded.tick();
  const restored = sourceEntry(loaded);
  assert(!!restored, 'registry entry restored from the save');
  assert(restored && restored.beamState.beamEnergy > 0,
    `beamEnergy > 0 after load (${restored && restored.beamState.beamEnergy})`);
}

console.log('\n--- 3. cutting power still fails closed ---');
{
  const game = boot();
  const entry = sourceEntry(game);
  game.toggleBeam(entry.id);
  for (let i = 0; i < 5; i++) game.tick();
  assert(entry.beamState.beamEnergy > 0, 'healthy beam before the cut');

  const ids = powerLines(game).map(([id]) => id);
  assert(ids.length > 0, `scenario ships powerCable lines (${ids.length})`);
  for (const id of ids) game.utilityLineSystem.removeLine(id);
  game.tick();

  assert(Object.values(game.state.nodeQualities).some(q => q.powerQuality === 0),
    'gate floors powerQuality to 0');
  assert(entry.beamState.beamEnergy === 0,
    `beam output follows within one tick (${entry.beamState.beamEnergy})`);
  assert((game.state.infraBlockers || []).some(b => b.code === 'power_unconnected'),
    'power_unconnected blocker raised');
}

console.log('\n--- 4. re-wiring revives the beam without a build mutation ---');
{
  const game = boot();
  const entry = sourceEntry(game);
  game.toggleBeam(entry.id);
  game.tick();
  const saved = powerLines(game);
  for (const [id] of saved) game.utilityLineSystem.removeLine(id);
  game.tick();
  assert(entry.beamState.beamEnergy === 0, 'dead while unwired');

  for (const [id, line] of saved) game.state.utilityLines.set(id, line);
  game.emit('utilityLinesChanged', { utilityType: 'powerCable' });
  game.tick();
  assert(entry.beamState.beamEnergy > 0,
    `beam back one tick after re-wiring (${entry.beamState.beamEnergy})`);
}

console.log('\n--- 5. steady state does not re-run physics every tick ---');
{
  const game = boot();
  const entry = sourceEntry(game);
  game.toggleBeam(entry.id);
  for (let i = 0; i < 200; i++) game.tick();  // let the vacuum finish pumping down
  let recalcs = 0;
  const real = game.recalcAllBeamlines.bind(game);
  game.recalcAllBeamlines = (...args) => { recalcs++; return real(...args); };
  for (let i = 0; i < 100; i++) game.tick();
  assert(recalcs <= 5, `at most 5 full recalcs over 100 settled ticks (got ${recalcs})`);
  assert(entry.beamState.beamEnergy > 0, 'beam still alive at the end');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
