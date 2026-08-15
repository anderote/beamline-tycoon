// test/test-progression.js — Phase 12 progression invariants.
//
// This file pins fast, deterministic progression contracts without simulating
// a synthetic player or asserting a prescribed full-career path.
//
// The cost ladder, utility-line prices, and milestone rewards are checked as
// pure data because those are the knobs a tuner actually edits.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { RESEARCH } from '../src/data/research.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { COMPONENTS } from '../src/data/components.js';
import { SUB_PER_TILE_CONST } from '../src/utility/line-geometry.js';
import { _computeNodeDepth } from '../src/game/research.js';

const RESEARCH_IDS = Object.entries(RESEARCH)
  .filter(([, node]) => !node.hidden)
  .map(([id]) => id);
const NODE_TIER = Object.fromEntries(
  RESEARCH_IDS.map(id => [id, _computeNodeDepth(id)]),
);
const TIERS = [...new Set(Object.values(NODE_TIER))].sort((a, b) => a - b);

const REFERENCE_LINE_PARTS = [
  'source', 'faradayCup', 'buncher', 'pillboxCavity', 'pillboxCavity',
  'pillboxCavity', 'quadrupole', 'bpm', 'hvTransformer', 'switchgear',
  'lcwSkid', 'rackIoc', 'solidStateAmp', 'roughingPump', 'turboPump',
  'powerBus', 'vacuumManifold', 'vacuumManifold', 'waveguideManifold',
];
const referenceHardwareCost = REFERENCE_LINE_PARTS.reduce(
  (sum, id) => sum + (COMPONENTS[id]?.cost?.funding || 0),
  0,
);

const log = console.log.bind(console);
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; log('  PASS:', msg); }
  else { failed++; log('  FAIL:', msg); }
}

const money = (n) => '$' + Math.round(n).toLocaleString();
const costs = RESEARCH_IDS.map(id => RESEARCH[id].cost.funding || 0);
const treeTotal = costs.reduce((a, b) => a + b, 0);
const cheapest = Math.min(...costs);
const dearest = Math.max(...costs);

// The seed a new facility starts with, read rather than hardcoded — the number
// lives in Game's default state and this file must not pin a second copy.
const STARTING_FUNDS = new Game(new BeamlineRegistry(), { seed: 1 }).state.resources.funding;

// ---------------------------------------------------------------------------
// A: the cost ladder is laid across the target span.
// ---------------------------------------------------------------------------
log('\n--- A: research cost ladder ---');
{
  // Defect this pins: at $200k the cheapest nodes were pocket change against
  // the starting balance, so the bottom of every tree was bought on tick 1 and
  // early research was not a choice.
  //
  // The floor was 0.25 when seed capital was $2.5M. Seed doubled to $5M (so a
  // player can lay a first beamline AND wire it without going broke), which
  // moves the cheapest node to ~20% of the balance. That is still a real bite —
  // a fifth of everything you have, and competing with hardware you need — so
  // the invariant is recalibrated rather than abandoned. If early research
  // starts feeling automatic, the fix is raising research costs, not this line.
  assert(cheapest > 0.18 * STARTING_FUNDS,
    `cheapest node is a real bite out of seed capital (${money(cheapest)} vs ` +
    `${money(STARTING_FUNDS)} start = ${(100 * cheapest / STARTING_FUNDS).toFixed(0)}%)`);
  // ...but still reachable in the opening, not a first-hour wall.
  assert(cheapest < 0.75 * STARTING_FUNDS,
    `cheapest node is still an opening move (${(100 * cheapest / STARTING_FUNDS).toFixed(0)}% of seed)`);
  assert(treeTotal > 350e6 && treeTotal < 900e6,
    `tree total in band (${money(treeTotal)})`);
  // No single node may be a wall: at end-game income one node should never be
  // more ticks of saving than a whole tier.
  assert(dearest < 0.12 * treeTotal,
    `dearest node is a push, not a wall (${money(dearest)} = ` +
    `${(100 * dearest / treeTotal).toFixed(1)}% of the tree)`);
  assert(dearest / cheapest > 10 && dearest / cheapest < 100,
    `ladder spans a real range (${(dearest / cheapest).toFixed(0)}x cheapest to dearest)`);

  // Every tier must carry real weight — a tier that costs nothing is not a
  // tier. Tier here is prerequisite depth, the same measure the sim reports.
  for (const tier of TIERS) {
    const ids = RESEARCH_IDS.filter(id => NODE_TIER[id] === tier);
    const sum = ids.reduce((s, id) => s + (RESEARCH[id].cost.funding || 0), 0);
    assert(sum > 0.02 * treeTotal,
      `tier ${tier} (${ids.length} nodes) is ${(100 * sum / treeTotal).toFixed(1)}% of the tree`);
  }
}

// ---------------------------------------------------------------------------
// B: reputation is a pacing gate, not decoration and not a wall.
// ---------------------------------------------------------------------------
log('\n--- B: reputation gating ---');
{
  const gated = RESEARCH_IDS.filter(id => (RESEARCH[id].cost.reputation || 0) > 0);
  const reps = gated.map(id => RESEARCH[id].cost.reputation);
  assert(gated.length >= 15,
    `enough nodes carry a reputation gate to be a mechanism (${gated.length})`);
  // Reputation accrues at 0.6 x beam quality per running beamline every 60
  // ticks, so a facility ends a full playthrough in the low thousands. A
  // ceiling of 25 (the pre-Phase-12 value) was decoration.
  assert(Math.max(...reps) > 500,
    `top reputation gate is on the scale reputation actually reaches (${Math.max(...reps)})`);
  assert(Math.max(...reps) < 3500,
    `top reputation gate stays under what a playthrough accrues (${Math.max(...reps)})`);
  assert(Math.min(...reps) < 0.35 * Math.max(...reps),
    `gates form a curve, not one cliff (${Math.min(...reps)} .. ${Math.max(...reps)})`);
}

// ---------------------------------------------------------------------------
// C: utility lines cost something, and buses beat individual runs.
// ---------------------------------------------------------------------------
log('\n--- C: utility line pricing ---');
{
  const prices = Object.entries(UTILITY_TYPES).map(([t, d]) => [t, d.costPerSubUnit]);
  for (const [type, per] of prices) {
    assert(typeof per === 'number' && per > 0,
      `${type} declares a per-sub-unit price (${per})`);
  }
  const vals = prices.map(([, p]) => p).filter(p => p > 0);
  assert(Math.max(...vals) / Math.min(...vals) <= 25,
    `no utility is absurdly out of line with the others ` +
    `(${Math.min(...vals)} .. ${Math.max(...vals)} per sub-unit)`);

  // Wiring should enable layout decisions without competing with the machines
  // themselves for the construction budget.
  // Same bound at the dearest non-cryo rate, so a rate hike on one utility
  // cannot pass by just because the reference line uses little of it.
  const SUB = SUB_PER_TILE_CONST;
  const worstNonCryo = Math.max(...prices
    .filter(([t]) => t !== 'cryoTransfer').map(([, p]) => p));
  const wireWorstCase = 24 * 5 * SUB * worstNonCryo;   // ~24 stubs of ~5 tiles
  assert(wireWorstCase < 0.05 * referenceHardwareCost,
    `worst-case wiring stays below 5% of a beamline (${money(wireWorstCase)} vs ` +
    `${money(referenceHardwareCost)} of hardware)`);

  // Distribution gear is retained for its capacity/topology role, not as an
  // artificial workaround for expensive short utility runs.
  const BUSES = {
    powerCable: 'powerBus', vacuumPipe: 'vacuumManifold',
    rfWaveguide: 'waveguideManifold', coolingWater: 'coolingManifold',
    dataFiber: 'fiberBus',
  };
  for (const [utility, busType] of Object.entries(BUSES)) {
    const busCost = COMPONENTS[busType]?.cost?.funding || 0;
    assert(busCost > 0 && UTILITY_TYPES[utility].costPerSubUnit > 0,
      `${busType} and its ${utility} runs have positive construction costs`);
  }
}

// ---------------------------------------------------------------------------
// D: milestone rewards are tier keys, not flavour.
// ---------------------------------------------------------------------------
log('\n--- D: objective rewards ---');
{
  const byTier = {};
  for (const o of OBJECTIVES) {
    const t = o.tier;
    byTier[t] = byTier[t] || { funding: 0, reputation: 0, n: 0 };
    byTier[t].funding += o.reward.funding || 0;
    byTier[t].reputation += o.reward.reputation || 0;
    byTier[t].n++;
  }
  const tiers = Object.keys(byTier).map(Number).sort((a, b) => a - b);
  const objTotal = tiers.reduce((s, t) => s + byTier[t].funding, 0);

  // Tier 0 plus the starting balance must clear the price of the first real
  // expansion, or milestones are not what unlocks the next tier of spending.
  // Priced ALL IN — hardware, drift pipe and wiring — because that is what the
  // player is actually asked for at the till.
  const worstNonCryo = Math.max(...Object.entries(UTILITY_TYPES)
    .filter(([type]) => type !== 'cryoTransfer')
    .map(([, descriptor]) => descriptor.costPerSubUnit));
  const referenceWiringBudget = 24 * 5 * SUB_PER_TILE_CONST * worstNonCryo;
  const lineCost = referenceHardwareCost + referenceWiringBudget;
  assert(byTier[0].funding + STARTING_FUNDS >= lineCost,
    `tier 0 + seed buys the first extra beamline ` +
    `(${money(byTier[0].funding + STARTING_FUNDS)} vs ${money(lineCost)})`);
  for (let i = 1; i < tiers.length; i++) {
    const prev = byTier[tiers[i - 1]].funding;
    const cur = byTier[tiers[i]].funding;
    assert(cur >= 1.2 * prev,
      `tier ${tiers[i]} rewards outgrow tier ${tiers[i - 1]} ` +
      `(${money(prev)} -> ${money(cur)})`);
  }
  assert(objTotal > 0.08 * treeTotal && objTotal < 0.35 * treeTotal,
    `milestones fund a real slice of progression without replacing it ` +
    `(${money(objTotal)} = ${(100 * objTotal / treeTotal).toFixed(0)}% of the tree)`);
}

// ---------------------------------------------------------------------------
log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
