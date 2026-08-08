// test/test-economy-balance.js — coarse economy-balance invariants.
//
// Phase 7 pinned three targets via headless simulation (see
// scripts/balance-sim.mjs for the tuning companion with full tables):
//
//   A) A fresh sandbox doing nothing survives >300 ticks — the base grant
//      nearly covers the seeded operator, so idling bleeds slowly, not
//      fatally.
//   B) The smallBeamlineFacility scenario is clearly net-positive once its
//      beam runs, without upkeep dominating — and its cooling loop actually
//      drains the reservoir (refills are a real recurring cost).
//   C) A late-game-ish build (second bigger beamline + detector + chiller
//      loop + full staff roster) pays a meaningful fraction of gross income
//      back out as upkeep: between 20% and 70% (tuned to ~43%).
//
// Bounds are deliberately loose: this test flags economy regressions (a knob
// change or new cost stream that breaks a whole phase of the game), it does
// not pin exact numbers.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { wireUtility } from '../src/data/scenarios/scenario-wiring.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { createStaffMember } from '../src/game/staff/staffSystem.js';
import { computeTickUpkeep } from '../src/game/economy.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Silence per-tick utility warnings and pipe-draw debug noise.
const realWarn = console.warn;
console.warn = (...args) => {
  const s = String(args[0] ?? '');
  if (s.startsWith('[utility]') || s.startsWith('[pipe-draw]')) return;
  realWarn(...args);
};
const realLog = console.log.bind(console);

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; realLog('  PASS:', msg); }
  else { failed++; realLog('  FAIL:', msg); }
}

function mkGame(seed) {
  return new Game(new BeamlineRegistry(), { seed });
}

function bootSmallFacility(seed) {
  const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
  const game = mkGame(seed);
  game.applyScenario(scenario.generator());
  scenario.setup(game);
  // One-time milestone grants would drown the per-tick economy under test.
  game.state.completedObjectives = OBJECTIVES.map(o => o.id);
  game.recalcAllBeamlines();
  return game;
}

function startAllBeams(game) {
  game.tick();
  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running') game.toggleBeam(entry.id);
  }
}

// Auto-refill low reservoirs (emulates the UtilityInspector button); returns $.
function autoRefill(game) {
  const state = game.state;
  let spent = 0;
  if (!state.utilityNetworks) return 0;
  const low = {
    coolingWater: (p) => (p?.reservoirVolumeL ?? Infinity) < 100,
    cryoTransfer: (p) => (p?.lheVolumeL ?? Infinity) < 60,
  };
  for (const [utilityType, networks] of state.utilityNetworks) {
    const desc = UTILITY_TYPES[utilityType];
    const trigger = low[utilityType];
    if (!desc || !trigger || typeof desc.refillCost !== 'function') continue;
    for (const net of networks) {
      const persistent = state.utilityNetworkState.get(net.id);
      if (!persistent || !trigger(persistent)) continue;
      const cost = desc.refillCost(persistent);
      if (!cost || !cost.funding || state.resources.funding < cost.funding) continue;
      state.resources.funding -= cost.funding;
      spent += cost.funding;
      state.utilityNetworkState.set(net.id, { ...persistent, ...desc.persistentStateDefaults });
    }
  }
  return spent;
}

// Tick n times, refilling reservoirs; return {dFunds, upkeep, refills, gross}.
function measure(game, ticks) {
  const state = game.state;
  const funds0 = state.resources.funding;
  let upkeep = 0, refills = 0;
  for (let t = 0; t < ticks; t++) {
    game.tick();
    upkeep += computeTickUpkeep(state).total;
    refills += autoRefill(game);
  }
  const dFunds = state.resources.funding - funds0;
  const totalUpkeep = upkeep + refills;
  return { dFunds, upkeep: totalUpkeep, refills, gross: dFunds + totalUpkeep };
}

// --- A: fresh sandbox idles without going broke ---------------------------
{
  realLog('\n--- A: fresh sandbox, idle 400 ticks ---');
  const game = mkGame(101);
  for (let t = 0; t < 400; t++) game.tick();
  assert(game.state.resources.funding > 0,
    `funds positive after 400 idle ticks ($${Math.round(game.state.resources.funding)})`);
  // Slow bleed at worst: never lose more than 0.1% of the bankroll per tick.
  assert(game.state.resources.funding > 2500000 - 400 * 2500,
    'idle burn rate is a slow bleed, not a death spiral');
}

// --- B: starter scenario is net-positive with a live reservoir ------------
{
  realLog('\n--- B: smallBeamlineFacility, beam running 800 ticks ---');
  const game = bootSmallFacility(202);
  startAllBeams(game);
  const warmup = measure(game, 100); // rampup excluded from the net check
  const m = measure(game, 700);
  assert(m.dFunds > 0, `net income positive after rampup (${(m.dFunds / 700).toFixed(1)}/t)`);
  assert(m.dFunds / 700 < 20000, 'net income is not explosive (<20k/tick)');
  const frac = m.upkeep / m.gross;
  assert(m.gross > 0 && frac > 0.02 && frac < 0.5,
    `starter upkeep fraction sane (${(100 * frac).toFixed(1)}% of gross)`);
  // The scenario's cooling loop must actually consume water: reservoir below
  // max after running (or a refill already happened).
  const cooling = game.state.utilityNetworks?.get('coolingWater') || [];
  assert(cooling.length >= 1, 'scenario has a coolingWater network');
  let reservoirLive = (warmup.refills + m.refills) > 0;
  for (const net of cooling) {
    const p = game.state.utilityNetworkState.get(net.id);
    if (p && p.reservoirVolumeL < 499) reservoirLive = true;
  }
  assert(reservoirLive, 'cooling reservoir drains while the beam runs (refills are a real cost)');
}

// --- C: late-game build pays meaningful upkeep ----------------------------
{
  realLog('\n--- C: late-game-ish build, 800 ticks ---');
  const game = bootSmallFacility(303);
  const state = game.state;

  const src2 = game.beamline.placeJunction({ type: 'source', col: -6, row: 10, dir: 3, free: true, silent: true });
  const det = game.beamline.placeJunction({ type: 'detector', col: 6, row: 10, dir: 3, free: true, silent: true });
  assert(!!src2 && !!det, 'second beamline junctions placed');
  const pipe = game.beamline.drawPipe(
    { junctionId: src2, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 10 }, { col: 6, row: 10 }],
  );
  assert(!!pipe, 'second beam pipe drawn');
  if (pipe) {
    for (const [type, position] of [
      ['buncher', 0.06], ['rfCavity', 0.18], ['rfCavity', 0.30], ['rfCavity', 0.42],
      ['quadrupole', 0.54], ['rfCavity', 0.64], ['quadrupole', 0.76], ['bpm', 0.88],
    ]) game.beamline.placeOnPipe(pipe, { type, position, mode: 'snap' });
  }
  const place = (type, col, row) => game.placePlaceable({ type, col, row, free: true, silent: true });
  const sw = place('switchgear', -5, 8);
  const tp = place('turboPump', 3, 8);
  const ioc2 = place('rackIoc', 1, 8);
  const ch = place('chiller', 5, 8);
  assert(!!sw && !!tp && !!ioc2 && !!ch, 'support infra placed');
  wireUtility(game, 'powerCable', { id: sw, port: 'pwr_out' }, { id: src2, port: 'pwr_in' });
  wireUtility(game, 'powerCable', { id: sw, port: 'pwr_out' }, { id: det, port: 'pwr_in' });
  wireUtility(game, 'vacuumPipe', { id: tp, port: 'vac_out' }, { id: src2, port: 'vac_in' });
  wireUtility(game, 'vacuumPipe', { id: tp, port: 'vac_out' }, { id: det, port: 'vac_in' });
  wireUtility(game, 'dataFiber', { id: ioc2, port: 'data_out' }, { id: det, port: 'data_in' });
  wireUtility(game, 'coolingWater', { id: ch, port: 'cool_out' }, { id: det, port: 'cool_in' });

  for (const role of ['operator', 'technician', 'technician', 'scientist', 'engineer']) {
    const m = createStaffMember(role, `staff_${state.staffNextId++}`, state.tick, game.rng);
    if (role === 'operator') { m.assignment.zoneId = 'controlRoom'; m.needs.fatigue = 0.5; }
    state.staffMembers.push(m);
  }
  game._syncStaffCounts();

  const decTypes = ['oakTree', 'flowerBed', 'parkBench', 'lamppost', 'shrub'];
  for (let i = 0; i < 35; i++) {
    state.placeables.push({
      id: `dec_sim_${i}`, type: decTypes[i % decTypes.length],
      col: -10 + (i % 12), row: 13 + Math.floor(i / 12),
      subCol: 1, subRow: 1, dir: 0, kind: 'decoration',
    });
  }
  state.resources.funding = 1500000;
  state.resources.reputation = 30;

  game.recalcAllBeamlines();
  startAllBeams(game);
  measure(game, 100); // rampup
  assert(state.infraCanRun === true,
    `late-game build runs clean (blockers: ${(state.infraBlockers || []).map(b => b.code).join(',') || 'none'})`);
  const m = measure(game, 700);
  assert(m.gross > 0, 'late-game gross income positive');
  const frac = m.upkeep / m.gross;
  assert(frac > 0.2 && frac < 0.7,
    `late-game upkeep fraction 20-70% of gross (got ${(100 * frac).toFixed(1)}%)`);
  assert(m.dFunds > 0, `late-game still net-positive (${(m.dFunds / 700).toFixed(1)}/t)`);
  assert(m.refills > 0, `reservoir refills occurred ($${m.refills})`);
}

realLog(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
