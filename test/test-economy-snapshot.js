// test/test-economy-snapshot.js — state.economySnapshot reports what the tick
// actually charged.
//
// The economy panel reads this snapshot and nothing else. The rule it exists
// to enforce: a display never recomputes an economy term. Recomputing at a
// second call site is the defect class closed in Phase 10 (aggregates.js) —
// it is how the HUD came to quote a user fee 50x off what was really paid.
//
// The load-bearing case here is the funding-delta one: over a tick, the
// recorded `net` must equal the movement in state.resources.funding that the
// tick's income and upkeep caused. Sum-to-total checks alone would pass
// happily while every term was quietly wrong; this one fails the moment a
// term is derived differently from the one that was billed.
//
// Deliberately outside the snapshot, because they are one-off reward events
// rather than per-tick flow: objective payouts and the $5k discovery windfall
// (the fixtures below neutralize both). Reservoir refills are also events,
// but they ARE reported — booked when charged, swept into the next tick.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import {
  computeTickIncome, computeTickIncomeBreakdown,
  computeBeamIncome, computeBeamIncomeBreakdown, dataFeeIncome,
} from '../src/game/economy.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Silence per-tick utility warnings from the scenario facility.
const realWarn = console.warn;
console.warn = (...args) => {
  const s = String(args[0] ?? '');
  if (s.startsWith('[utility]') || s.startsWith('[pipe-draw]')) return;
  realWarn(...args);
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Money is float-valued (beam quality, power draw), so compare within a cent.
const near = (a, b) => Math.abs(a - b) < 1e-6;

// One-off milestone grants would land in the funding delta without being tick
// flow, so mark every objective already complete.
function mkGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.completedObjectives = OBJECTIVES.map(o => o.id);
  return g;
}

function bootSmallFacility(seed) {
  const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
  const g = mkGame(seed);
  g.applyScenario(scenario.generator());
  scenario.setup(g);
  g.state.completedObjectives = OBJECTIVES.map(o => o.id);
  g.recalcAllBeamlines();
  // Let the simulation-owned staff walk reach the console before starting.
  for (let i = 0; i < 60 && !g.state.infraCanRun; i++) g.tick();
  for (const entry of g.registry.getAll()) {
    if (entry.status !== 'running') g.toggleBeam(entry.id);
  }
  return g;
}

/**
 * Funding movement over one tick with the non-flow event credits removed:
 * the $5k discovery windfall is a reward, not income (see _tickBeamline).
 * `from` lets the caller open the window before the tick, so an event cost
 * charged between ticks (a reservoir refill) is inside it.
 */
function tickDelta(g, from = null) {
  const f0 = from == null ? g.state.resources.funding : from;
  const disc0 = g.state.discoveries;
  g.tick();
  const windfalls = (g.state.discoveries - disc0) * 5000;
  return g.state.resources.funding - f0 - windfalls;
}

console.log('\n=== Economy snapshot ===\n');

// --- Wrappers return exactly the breakdown's total -------------------------
// Two entry points, one number. If these ever diverge the panel and the
// balance are quoting different economies.
{
  const g = mkGame(1);
  g.state.resources.reputation = 37;
  g.state.reputationTier = { fundingBonus: 0.15 };
  const b = computeTickIncomeBreakdown(g.state, 250);
  assert(computeTickIncome(g.state, 250) === b.total,
    'computeTickIncome is the breakdown total');
  assert(b.grant + b.reputation === b.total,
    'passive income terms sum to the total (residual carried by reputation)');
  assert(b.grant > 0 && b.reputation > 0, 'both passive terms are populated');

  const bs = { beamQuality: 0.8, dataRate: 12 };
  const bb = computeBeamIncomeBreakdown(bs, 6);
  assert(computeBeamIncome(bs, 6) === bb.total,
    'computeBeamIncome is the breakdown total');
  assert(bb.beam + bb.dataFees === bb.total, 'beam income terms sum to the total');
  assert(bb.dataFees === dataFeeIncome(12), 'data fees come from dataFeeIncome');
}

// --- Shape and sums, idle facility ----------------------------------------
{
  const g = mkGame(2);
  assert(g.state.economySnapshot === null, 'no snapshot before the first tick');
  g.tick();
  const { snapshot: s, history, historyCapacity } = g.getEconomySnapshot();

  assert(s !== null, 'tick() publishes a snapshot');
  assert(s.tick === g.state.tick, 'snapshot is stamped with its tick');
  assert(near(s.income.grant + s.income.reputation + s.income.beam + s.income.dataFees,
    s.income.total), 'income terms sum to income.total');
  assert(near(s.upkeep.staff + s.upkeep.power + s.upkeep.pumps + s.upkeep.refills,
    s.upkeep.total), 'upkeep terms sum to upkeep.total');
  assert(near(s.net, s.income.total - s.upkeep.total),
    'net === income.total - upkeep.total');
  assert(s.upkeep.staff > 0, 'the seeded operator is billed under staff');
  assert(s.contributingBeamlines === 0, 'idle facility contributes no beamlines');
  assert(history.length === 1 && near(history[0], s.net),
    'the tick pushed its net onto the history window');
  assert(historyCapacity === 300, 'history capacity is exposed to the reader');
}

// --- THE ONE: recorded net === actual funding movement --------------------
// Idle facility first: nothing but grant, reputation and upkeep moves money.
{
  const g = mkGame(3);
  g.tick();
  for (let i = 0; i < 5; i++) {
    const delta = tickDelta(g);
    assert(near(delta, g.state.economySnapshot.net),
      `idle tick ${i}: funding moved by exactly the recorded net`);
  }
}

// --- ...and with a beam running, where every term is non-zero -------------
{
  const g = bootSmallFacility(7);
  g.state.resources.funding = 1e9;   // keep refill/affordability paths quiet
  let sawBeam = false, sawFees = false;
  for (let i = 0; i < 8; i++) {
    const delta = tickDelta(g);
    const s = g.state.economySnapshot;
    assert(near(delta, s.net),
      `running beam, tick ${i}: funding moved by exactly the recorded net`);
    if (s.income.beam > 0) sawBeam = true;
    if (s.income.dataFees > 0) sawFees = true;
  }
  const s = g.state.economySnapshot;
  assert(sawBeam, 'a running beamline books beam income');
  assert(sawFees, 'a collecting detector books data fees');
  assert(s.contributingBeamlines > 0, 'contributing beamlines are counted');
  assert(s.income.total > 0 && s.upkeep.total > 0, 'both sides are populated');
  assert(near(s.income.grant + s.income.reputation + s.income.beam + s.income.dataFees,
    s.income.total), 'income terms still sum with a beam running');
  assert(near(s.upkeep.staff + s.upkeep.power + s.upkeep.pumps + s.upkeep.refills,
    s.upkeep.total), 'upkeep terms still sum with a beam running');

  // Cross-check against the billed (connectivity-derated) rate the beamlines
  // published — not against the raw physics dataRate, which is the number the
  // 50x-off HUD readout used.
  let expectedFees = 0;
  for (const entry of g.registry.getAll()) {
    if (entry.status !== 'running') continue;
    expectedFees += dataFeeIncome(entry.beamState.effectiveDataRate);
  }
  assert(near(s.income.dataFees, expectedFees),
    'data fees are billed on the derated rate, not the raw physics rate');
}

// --- A cut fiber earns no data fees ---------------------------------------
// The term split is what a re-derivation gets wrong: the funding delta above
// only pins the TOTAL, so it cannot see data fees credited on the raw physics
// rate instead of the connectivity-derated one. That is the original defect —
// full fees quoted for a beamline whose fiber had been cut — so pin it here.
{
  const g = bootSmallFacility(7);
  g.state.resources.funding = 1e9;
  // A few settling ticks let node qualities and physics catch up after the
  // already-seated operator starts the beam.
  for (let i = 0; i < 5; i++) g.tick();
  const rawRate = [...g.registry.getAll()]
    .filter(e => e.status === 'running')
    .reduce((s, e) => s + (e.beamState.dataRate || 0), 0);
  assert(rawRate > 0, 'the fixture has a detector producing data');
  assert(g.state.economySnapshot.income.dataFees > 0, 'connected fiber earns fees');

  // Cut every data link. The gate rewrites nodeQualities at the END of a
  // tick, after billing, so the next tick bills against this.
  for (const q of Object.values(g.state.nodeQualities || {})) q.dataQuality = 0;
  g.tick();
  const cut = g.state.economySnapshot;
  assert(cut.income.dataFees === 0, 'a cut fiber earns no data fees');
  assert(near(cut.income.total,
    cut.income.grant + cut.income.reputation + cut.income.beam),
    'income.total drops with the fees rather than quoting them anyway');
}

// --- Reservoir refills are booked as charged ------------------------------
{
  const g = mkGame(11);
  g.tick();
  const before = g.state.resources.funding;
  g.chargeReservoirRefill({ funding: 4200 });
  assert(g.state.resources.funding === before - 4200, 'the refill is charged');

  // Window opens BEFORE the refill: the cost belongs to the tick that reports
  // it, even though it was paid between ticks.
  const delta = tickDelta(g, before);
  const s = g.state.economySnapshot;
  assert(s.upkeep.refills === 4200, 'the refill is reported under upkeep.refills');
  assert(near(delta, s.net), 'refill included, funding still moved by the recorded net');

  const deltaNext = tickDelta(g);
  assert(g.state.economySnapshot.upkeep.refills === 0,
    'a refill is reported once, not every tick after');
  assert(near(deltaNext, g.state.economySnapshot.net),
    'the tick after a refill still matches its recorded net');
}

// --- History is capped ----------------------------------------------------
{
  const g = mkGame(13);
  let overflowed = false;
  for (let i = 0; i < 700; i++) {
    g.tick();
    if (g.state.economyHistory.length > 300) overflowed = true;
  }
  assert(!overflowed, 'history never exceeds capacity during a long run');
  assert(g.state.economyHistory.length === 300,
    'history holds exactly the capacity after 700 ticks');
  assert(near(g.state.economyHistory[299], g.state.economySnapshot.net),
    'the newest sample is the most recent net');
  assert(g.getEconomySnapshot().history !== g.state.economyHistory,
    'the read helper hands out a copy, not the live buffer');
}

// --- Derived: never serialized, never in an undo snapshot -----------------
{
  const g = mkGame(17);
  for (let i = 0; i < 3; i++) g.tick();

  const save = JSON.parse(g.serialize());
  assert(!('economySnapshot' in save.state), 'economySnapshot is not in a save payload');
  assert(!('economyHistory' in save.state), 'economyHistory is not in a save payload');

  const snap = JSON.parse(g._snapshot());
  assert(!('economySnapshot' in snap.state), 'economySnapshot is not in an undo snapshot');
  assert(!('economyHistory' in snap.state), 'economyHistory is not in an undo snapshot');

  // Undo must not rewind them either: like `tick`, they are sim progress.
  g.commitGesture({ mutate: () => { g.state.resources.funding -= 1000; } });
  for (let i = 0; i < 3; i++) g.tick();
  const lenBefore = g.state.economyHistory.length;
  g.undo();
  assert(g.state.economyHistory.length === lenBefore,
    'undo does not rewind the economy history');
  assert(g.state.economySnapshot !== null, 'undo does not clear the snapshot');
}

// --- Cleared on load ------------------------------------------------------
{
  const source = mkGame(19);
  source.tick();
  source.save();

  const target = mkGame(23);
  for (let i = 0; i < 4; i++) target.tick();
  assert(target.state.economyHistory.length === 4, 'target has its own history pre-load');

  assert(target.load() === true, 'save loaded');
  assert(target.state.economySnapshot === null, 'load clears the snapshot');
  assert(target.state.economyHistory.length === 0, 'load clears the history window');

  target.tick();
  assert(target.state.economyHistory.length === 1, 'the history rebuilds after load');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
