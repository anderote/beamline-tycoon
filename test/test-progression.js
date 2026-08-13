// test/test-progression.js — Phase 12 progression invariants.
//
// The target this pins: a full playthrough to the top of the tech tree takes
// ~28,800 ticks (~8 h of active play at 1x; the 1x/2x/4x speed controls make
// wall-clock shorter). scripts/balance-playthrough.mjs is the tuning companion
// with the full tables; this file holds the handful of properties that must
// survive a knob change.
//
// Two kinds of check, deliberately separated:
//
//   STATIC (instant) — the cost ladder, the utility-line prices and the
//   milestone rewards, checked as pure data. These are the knobs a tuner
//   actually edits, so they get the tighter bounds.
//
//   SIMULATED (~30 s) — one scripted playthrough at the sim's default policy
//   (24 extra beamlines, seed 909). Bounds here are wide on purpose: run
//   length is a strong function of how much hardware the player chooses to
//   build (see the note on ECON.beamIncomePerNode), so this asserts the SHAPE
//   of the curve — spread of completions, no dead stretch, which resource is
//   binding — and only loosely the length.
//
// Measured when written (seed 909, 24 extra lines): 22,895 ticks = 0.79x
// target, longest gap with nothing completing 1,113 ticks (4.9% of the run),
// blocked 83% funding / 3.7% data / 0% reputation / 0% lab tier.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { RESEARCH } from '../src/data/research.js';
import { OBJECTIVES } from '../src/data/objectives.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { COMPONENTS } from '../src/data/components.js';
import { SUB_PER_TILE_CONST } from '../src/utility/line-geometry.js';
import {
  runPlaythrough, PLAYTHROUGH_TARGET_TICKS, RESEARCH_IDS, NODE_TIER, TIERS,
  beamlineRecipeCost, beamlineHardwareCost, beamlineWiringCost,
} from '../scripts/balance-playthrough.mjs';

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

  // Wiring a beamline must be a real budget line, never the dominant cost.
  // Measured off the sim's reference line rather than estimated, so the bound
  // moves when the recipe or a rate does.
  const wiring = beamlineWiringCost('cup');
  const hardware = beamlineHardwareCost('cup');
  assert(wiring > 0.05 * hardware,
    `wiring the reference line is a cost the player feels (${money(wiring)} = ` +
    `${(100 * wiring / hardware).toFixed(0)}% of ${money(hardware)} of hardware)`);
  assert(wiring < 0.4 * hardware,
    `…without dominating the hardware it connects (${money(wiring)})`);

  // Same bound at the dearest non-cryo rate, so a rate hike on one utility
  // cannot pass by just because the reference line uses little of it.
  const SUB = SUB_PER_TILE_CONST;
  const worstNonCryo = Math.max(...prices
    .filter(([t]) => t !== 'cryoTransfer').map(([, p]) => p));
  const wireWorstCase = 24 * 5 * SUB * worstNonCryo;   // ~24 stubs of ~5 tiles
  assert(wireWorstCase < 0.4 * hardware,
    `worst-case wiring stays a minority of a beamline (${money(wireWorstCase)} vs ` +
    `${money(hardware)} of hardware)`);

  // A distribution bus replaces (N-1) full source→sink runs (~10 tiles) with
  // (N-1) short stubs (~2 tiles). It must pay for itself well inside the
  // number of sinks it can actually serve.
  const BUSES = {
    powerCable: 'powerBus', vacuumPipe: 'vacuumManifold',
    rfWaveguide: 'waveguideManifold', coolingWater: 'coolingManifold',
    dataFiber: 'fiberBus',
  };
  for (const [utility, busType] of Object.entries(BUSES)) {
    const busCost = COMPONENTS[busType]?.cost?.funding || 0;
    const per = UTILITY_TYPES[utility].costPerSubUnit;
    const savedPerSink = 8 * SUB * per;      // 10-tile run replaced by a 2-tile stub
    const breakEven = 1 + busCost / savedPerSink;
    assert(busCost > 0 && breakEven <= 8,
      `${busType} beats individual ${utility} runs by ${breakEven.toFixed(1)} sinks`);
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
  const lineCost = beamlineRecipeCost('cup');
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
// E: one full playthrough. Shape first, length loosely.
// ---------------------------------------------------------------------------
log('\n--- E: full playthrough (seed 909, 24 extra lines) ---');
{
  const rec = runPlaythrough({ seed: 909, maxTicks: 80_000, sampleEvery: 100_000 });
  const T = rec.totalTicks;
  log(`  (ran ${T.toLocaleString()} ticks = ` +
    `${(T / PLAYTHROUGH_TARGET_TICKS).toFixed(2)}x target)`);

  assert(rec.finished, `every reachable node completes (${rec.remainingNodes.length} left)`);
  assert(!rec.ladderStalled, `facility expansion never stalls (${rec.ladderStalled || 'ok'})`);
  // Wide band: the sim's default policy is the maximal builder, and a player
  // who builds half as much takes roughly twice as long. This catches an order
  // -of-magnitude regression, not a tuning drift.
  assert(T > 0.5 * PLAYTHROUGH_TARGET_TICKS && T < 1.5 * PLAYTHROUGH_TARGET_TICKS,
    `playthrough length within 0.5x-1.5x of the ${PLAYTHROUGH_TARGET_TICKS.toLocaleString()}-tick target`);

  // No dead opening: the player must be able to finish something early.
  const firstAt = Math.min(...RESEARCH_IDS.map(id => rec.completedAt[id] ?? Infinity));
  assert(firstAt < 2500, `first node completes early (t=${firstAt})`);

  // No dead stretch: a long span where nothing lands is what this phase set out
  // to remove ($100M colliderTech used to buy a 2,666-tick silence).
  assert(rec.longestGap && rec.longestGap.ticks < 4000,
    `longest span with nothing completing under 4,000 ticks (${rec.longestGap?.ticks})`);
  assert(rec.longestGap.ticks < 0.2 * T,
    `...and under a fifth of the run (${(100 * rec.longestGap.ticks / T).toFixed(1)}%)`);

  // Completions spread across the run rather than bunching at one end.
  const doneBy = (frac) => RESEARCH_IDS
    .filter(id => (rec.completedAt[id] ?? Infinity) <= frac * T).length / RESEARCH_IDS.length;
  const q1 = doneBy(0.25), q2 = doneBy(0.5), q3 = doneBy(0.75);
  log(`  (nodes done at 25/50/75% of the run: ` +
    `${(100 * q1).toFixed(0)}% / ${(100 * q2).toFixed(0)}% / ${(100 * q3).toFixed(0)}%)`);
  assert(q1 >= 0.05 && q1 <= 0.45, `first quarter lands some of the tree (${(100 * q1).toFixed(0)}%)`);
  assert(q2 >= 0.20 && q2 <= 0.70, `half-way point is mid-tree (${(100 * q2).toFixed(0)}%)`);
  assert(q3 >= 0.50 && q3 <= 0.92, `three-quarter point leaves a real end-game (${(100 * q3).toFixed(0)}%)`);

  // The deepest tier must be the last thing standing — otherwise the tree has
  // no climax and the ladder is priced backwards.
  const deepest = TIERS[TIERS.length - 1];
  assert(rec.tierCompletedAt[deepest] > 0.75 * T,
    `deepest tier (${deepest}) closes the run (t=${rec.tierCompletedAt[deepest]} of ${T})`);
  const shallowest = TIERS[0];
  assert(rec.tierCompletedAt[shallowest] < 0.7 * T,
    `shallowest tier (${shallowest}) is done well before the end ` +
    `(t=${rec.tierCompletedAt[shallowest]} of ${T})`);

  // Which resource is binding. Funding is meant to be the pacing resource;
  // reputation and data are seasoning, and the lab ladder must never block.
  const b = rec.blockedTicks;
  log(`  (blocked: funding ${b.funding} / data ${b.data} / ` +
    `reputation ${b.reputation} / labTier ${b.labTier} of ${T} ticks)`);
  assert(b.funding > b.data && b.funding > b.reputation && b.funding > b.labTier,
    'funding is the binding constraint');
  assert(b.reputation < 0.25 * T,
    `reputation paces rather than walls (${(100 * b.reputation / T).toFixed(1)}% of ticks)`);
  assert(b.data < 0.25 * T,
    `data paces rather than walls (${(100 * b.data / T).toFixed(1)}% of ticks)`);
  assert(b.labTier === 0,
    `the lab ladder never blocks a run that builds labs (${b.labTier} ticks)`);
  assert(rec.beamOnTicks > 0.8 * T,
    `the beam is actually on for the run (${(100 * rec.beamOnTicks / T).toFixed(0)}%)`);
}

log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
