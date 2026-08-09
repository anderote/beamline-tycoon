// test/test-scenarios.js — scenario content regression net.
//
// Every scenario in src/data/scenarios.js must boot headless and come up
// GREEN under utility gating: apply the generated map, run the optional
// setup(game) hook, tick ~20 times, and assert zero hard infra blockers.
// Scenarios that ship a beamline must also be able to actually START the
// beam (toggleBeam → status 'running' → state.beamOn).
//
// This is the safety net for future content changes: new gating rules, new
// utility demands, or component removals that invalidate a scripted layout
// fail here instead of at scenario load in the browser.
//
// Also sweeps every tutorial step and objective condition against the ticked
// scenario states — conditions referencing removed systems or renamed state
// fields throw here instead of silently breaking the checklist UI.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { TUTORIAL_STEPS } from '../src/data/tutorial.js';
import { OBJECTIVES } from '../src/data/objectives.js';

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

function bootScenario(scenario) {
  const game = new Game(new BeamlineRegistry(), { seed: 1234 });
  const mapData = scenario.generator();
  game.applyScenario(mapData);
  if (scenario.setup) scenario.setup(game);
  game.recalcAllBeamlines();
  for (let i = 0; i < 20; i++) game.tick();
  return game;
}

const tickedGames = [];

for (const scenario of SCENARIOS) {
  if (!scenario.generator) continue; // sandbox = blank game
  console.log(`\n--- Scenario: ${scenario.id} ---`);

  const game = bootScenario(scenario);
  tickedGames.push(game);
  const state = game.state;

  const hard = (state.infraBlockers || []).filter(b => b.severity === 'hard');
  assert(hard.length === 0,
    `no hard infra blockers after 20 ticks (got ${JSON.stringify(hard.map(b => b.code))})`);
  assert(state.infraCanRun === true, 'infraCanRun true');
  assert((state.staffMembers || []).some(m => m.role === 'operator'),
    'operator pawn seeded');

  const junctions = state.placeables.filter(p => p.category === 'beamline');
  if (junctions.length > 0) {
    // Scenario ships a beamline — it must be startable.
    const sourceJ = junctions.find(p => COMPONENTS[p.type]?.isSource);
    assert(!!sourceJ, 'beamline has a source junction');
    const entry = game.registry.getAll().find(e => e.sourceId === sourceJ?.id);
    assert(!!entry, 'registry entry exists for the source');
    if (entry) {
      game.toggleBeam(entry.id);
      assert(entry.status === 'running', `beam starts (status=${entry.status})`);
      for (let i = 0; i < 5; i++) game.tick();
      assert(state.beamOn === true, 'state.beamOn true after ticking with beam running');
      assert(entry.status === 'running', 'beam stays running over 5 more ticks');
    }
  }
}

// --- smallBeamlineFacility specifics -------------------------------------
{
  console.log('\n--- smallBeamlineFacility: layout details ---');
  const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
  const game = bootScenario(scenario);
  const state = game.state;

  assert((state.beamPipes || []).length === 1, 'one beam pipe drawn');
  const placements = (state.beamPipes[0]?.placements || []).map(pl => pl.type).sort();
  assert(placements.length === 6,
    `six pipe placements (got ${placements.join(',')})`);
  assert(placements.filter(t => t === 'pillboxCavity').length === 3,
    'three pillbox cavities on the pipe');

  // Wiring: power + vacuum to both junctions, data to the cup, cooling to
  // the gun = 6 lines.
  assert((state.utilityLines?.size || 0) === 6,
    `six utility lines wired (got ${state.utilityLines?.size})`);

  // Prebuilt facility must not eat the starting budget (checked before any
  // ticks so the running economy doesn't muddy the number).
  const fresh = new Game(new BeamlineRegistry(), { seed: 7 });
  const funding0 = fresh.state.resources.funding;
  fresh.applyScenario(scenario.generator());
  scenario.setup(fresh);
  assert(fresh.state.resources.funding === funding0,
    `starting funding preserved by setup (${fresh.state.resources.funding} vs ${funding0})`);

  // Differentiated demands: power network must show real numbers, not the
  // old flat 50-per-sink placeholder.
  const powerFlows = state.utilityNetworkData?.get?.('powerCable');
  const flow = powerFlows && [...powerFlows.values()][0];
  assert(!!flow && flow.totalCapacity === 150,
    `padMount capacity 150 kW seen by solver (got ${flow?.totalCapacity})`);
  assert(!!flow && flow.totalDemand === 51,
    `source(50)+cup(1) demand = 51 kW (got ${flow?.totalDemand})`);
}

// --- tutorial + objective conditions run without throwing -----------------
{
  console.log('\n--- tutorial/objective condition sweep ---');
  // Sweep against every ticked scenario state AND a blank game (fresh-boot
  // shape), so conditions can't depend on fields only scenarios create.
  const blank = new Game(new BeamlineRegistry(), { seed: 99 });
  for (let i = 0; i < 3; i++) blank.tick();
  const states = [...tickedGames.map(g => g.state), blank.state];

  let stepThrew = null;
  for (const st of states) {
    for (const step of TUTORIAL_STEPS) {
      try { step.condition(st); }
      catch (e) { stepThrew = `${step.id}: ${e.message}`; }
    }
  }
  assert(!stepThrew, `tutorial conditions evaluate cleanly${stepThrew ? ` (${stepThrew})` : ''}`);

  let objThrew = null;
  for (const st of states) {
    for (const obj of OBJECTIVES) {
      try { obj.condition(st); }
      catch (e) { objThrew = `${obj.id}: ${e.message}`; }
    }
  }
  assert(!objThrew, `objective conditions evaluate cleanly${objThrew ? ` (${objThrew})` : ''}`);

  // No objective may reference a component type that no longer exists.
  const objectivesSrc = OBJECTIVES.map(o => o.condition.toString()).join('\n');
  const typeRefs = [...objectivesSrc.matchAll(/type === '([A-Za-z0-9]+)'/g)].map(m => m[1]);
  const missing = typeRefs.filter(t => !COMPONENTS[t]);
  assert(missing.length === 0,
    `objective component references all exist (missing: ${missing.join(',') || 'none'})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
