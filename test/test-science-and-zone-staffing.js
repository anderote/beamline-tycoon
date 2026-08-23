// test/test-science-and-zone-staffing.js — data, analysis, the zone-tier
// ratchet, and commissioning (Task 6 of the staff-professions-3
// (jobs-and-gates) plan: the fourth and final hard labour gate — data —
// plus zone tier and commissioning).
//
// Two fixture styles, matching test-repair-and-fabrication.js's own split:
//
//   Section A — hand-built state + a fake `game` ({ state, registry:
//   { getAll() } }), real StaffMember instances, real PLACEABLES station
//   defs. Enough surface for jobRunner.js's assignJobs/tickJobs and the
//   REAL jobEffects/analyze.js + jobEffects/commission.js completion
//   handlers (imported for real — last registration wins, nothing here
//   re-stubs them) to run against.
//
//   Section B — a real Game instance (src/game/Game.js) for the three
//   things Section A's lightweight state cannot exercise honestly: the
//   zone-tier ratchet (Game.recomputeZoneConnectivity, a real method on a
//   real class), the two real placement choke points that stamp
//   needsCommissioning/specialty onto a new component
//   (Game._placePlaceableInner via beamline.placeJunction, and
//   BeamlineSystem.placeOnPipe), and Game._tickBeamline's own sciMult line.
//
// Test list (mirrors task-6-brief.md's own):
//   1. No scientist working takeData -> state.staffDataEfficiency stays 0
//      (jobRunner.js's own aggregate — the "no scientist -> no data, full
//      stop" gate's actual source).
//   2. A scientist working takeData -> state.staffDataEfficiency equals
//      their own efficiency() value.
//   3. Game._tickBeamline: staffDataEfficiency 0 -> no data gain even with
//      a live detector rate; a nonzero value -> data gain scales by it
//      exactly.
//   4. analyze converts data into research progress and reputation,
//      incrementing member.stats.analyses — scaled by the analyst's own
//      efficiency, capped by the data actually on hand.
//   5. A freshly painted 20-tile rfLab (the brief's own literal example —
//      real headroom at tier 4 since fix round 1's STAFFED_OUTPUT_HEADROOM
//      fix, see that constant's own comment in facility.js) with no
//      engineer has tier === 0 and peakTier === 0.
//   6. An engineer working labWork there raises tier to the tile-count
//      tier.
//   7. The engineer then stops; 100 ticks of decay leave tier unchanged
//      and peakTier no lower than it was — including AT tier 4 itself,
//      the one tier that had zero headroom before fix round 1.
//   8. A newly placed component (both a junction/module, via
//      beamline.placeJunction, and an on-pipe placement, via
//      beamline.placeOnPipe) carries needsCommissioning: true and a
//      specialty matching its category.
//   9. An uncommissioned component's numeric stats are derated to exactly
//      0.7x by physics-payload.js's buildPhysicsElements; a commissioned
//      one is untouched.
//   10. A matching-specialty engineer completing commission clears the
//      flag and increments member.stats.commissions; a mismatched one
//      still can, in exactly 2x the ticks (CROSS_SPECIALTY_EFFICIENCY).
//   11. The real job board (buildJobOffers) actually offers commission for
//      a real, connected on-pipe component — not just that placeOnPipe
//      stamps the flag (test 8b).
//   12. Two engineers are never double-assigned to the same commission
//      target (the repair-only claimed-targets guard, generalized).
//   13. GATE vs RATE (coordinator review, fix round 1): getLabResearchTier
//      reads peakTier, not the live tier, so a research node in a
//      staffed-up lab's category stays startable through a staffing lull
//      that collapses the live tier to 0 — asserted on both the numeric
//      tier value (13a) AND a real research node's actual startability via
//      getResearchSpeedMultiplier (13b), the exact check startResearch
//      itself makes.
//   14. machineShop/maintenance are excluded from the staffing ratchet —
//      neither has an engineering specialty, so staffing them never
//      reliably clears even tier 1; their own tier tracks tiles alone,
//      immediately, same as before this task.
//   15. staffedOutput resets to 0 whenever a zone's tileCount changes — the
//      "stage a cheap small lab, then paint/rebuild it bigger" exploit.
//      peakTier (durable) is unaffected.
//   16. peakTier/staffedOutput persistence across undo and save/load is
//      covered in test-game-undo.js and test-game-serialize.js, not here.
//   17. Completing commission actually re-solves the beamline — the derate
//      is not a no-op in play.
//   18. Photon data is gated by the same "no scientist -> no data" check
//      as detector data.
//   19. takeData's facility-wide total no longer scales with beamline
//      count (dividing state.staffDataEfficiency by the running-beamline
//      count in Game._tickBeamline).
//
// Mutation-verified guards (see task-6-report.md and
// task-6-fix-round-1-report.md for all outputs):
//   - jobs.js's commissionOffers reading node.placeable directly (the pre-
//     fix bug: silently never offers commissioning for any on-pipe
//     component) — reverting the fix fails test 11.
//   - Game._tickBeamline's sciMult reading state.staffDataEfficiency —
//     hardcoding it back to a constant fails test 3.
//   - The zone-tier ratchet's min(tileTier, staffTier) — dropping the
//     staffTier term fails test 5 (a freshly painted zone would read its
//     tile tier immediately, with no engineer at all).
//   - jobRunner.js's claimedTargetsByType, narrowed back to 'repair' only —
//     fails test 12 (two engineers claim the same commission target).
//   - research.js's getLabResearchTier reading peakTier — reverted to the
//     live tier — fails test 13.
//   - facility.js's LABWORK_CAPABLE_ZONES, re-including machineShop — fails
//     test 14.
//   - Game.recomputeZoneConnectivity's resize-reset guard, disabled — fails
//     all of test 15.
//   - Game.js's _applyState no longer wiping zoneConnectivity — reverted —
//     fails test-game-undo.js/test-game-serialize.js.
//   - jobEffects/commission.js's recalcBeamline call, disabled — fails
//     test 17.
//   - Game._tickBeamline's photon-data sciMult gate, dropped — fails test 18.
//   - Game._tickBeamline's runningBeamlineCount division, dropped — fails
//     test 19 at exactly the pre-fix quadratic value.
//   - facility.js's STAFFED_OUTPUT_HEADROOM, set back to 1.0 — fails test 7
//     (tier 4 drops after a single 100-tick break).

import { StaffMember } from '../src/game/staff/StaffMember.js';
import { assignJobs, tickJobs, abandonJob } from '../src/game/staff/jobRunner.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { COMPONENTS } from '../src/data/components.js';
import { seedComponentParams } from '../src/beamline/component-params.js';
import { buildPhysicsElements } from '../src/beamline/physics-payload.js';

// Registers the real completion effects (side effect of import — mirrors
// test-repair-and-fabrication.js's own explicit-and-redundant import of
// its two effect modules, even though jobRunner.js already imports every
// jobEffects/*.js module itself).
import '../src/game/staff/jobEffects/analyze.js';
import '../src/game/staff/jobEffects/commission.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function publishPoweredDataGateway(game, placeableId, dataPort = 'data_out') {
  const dataEntry = { placeableId, portName: dataPort, role: 'source' };
  const powerEntry = { placeableId, portName: 'pwr_in', role: 'sink' };
  const powerNet = { id: `power-${placeableId}`, ports: [powerEntry], sinks: [powerEntry] };
  game.state.utilityNetworks = new Map([
    ['dataFiber', [{
      id: `data-${placeableId}`, ports: [dataEntry], sources: [dataEntry], sinks: [],
    }]],
    ['powerCable', [powerNet]],
  ]);
  game.state.utilityNetworkData = new Map([['powerCable', new Map([[
    powerNet.id,
    { perSinkQuality: { [`${placeableId}:pwr_in`]: 1 } },
  ]])]]);
}

// =============================================================================
// Section A fixtures — duplicated from test-repair-and-fabrication.js /
// test-job-runner.js's own convention (see that file's header on why these
// are duplicated per-file rather than shared).
// =============================================================================

function makeState(overrides = {}) {
  return {
    infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeableIndex: {}, placeables: [], zoneOccupied: {}, stationReservations: {},
    staffMembers: [], resources: { funding: 0, reputation: 0, data: 0, spares: 5 },
    zoneConnectivity: {}, navRevision: 0, tick: 0,
    ...overrides,
  };
}

let _nextId = 1;
function placeItem(state, type, col, row, subCol = 0, subRow = 0, dir = 0) {
  const def = PLACEABLES[type];
  const id = `${type}_${_nextId++}`;
  const cells = def.footprintCells(col, row, subCol, subRow, dir);
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells, params: {} };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }

function makeGame(state, beamlines = []) {
  return { state, registry: { getAll: () => beamlines }, sandboxMode: false, logs: [], log(msg, type) { this.logs.push({ msg, type }); } };
}

const FLAT_SKILLS = { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 };
function makeMember(profession, id, opts = {}) {
  return new StaffMember({
    id, profession, traits: [], skills: { ...FLAT_SKILLS, ...(opts.skills || {}) },
    specialty: opts.specialty ?? null, rng: () => 0.5,
  });
}

// Force the arrival boundary; this suite focuses on science/zone output while
// movement ownership has dedicated integration coverage.
function arrive(member) { if (member.job) member.job.phase = 'work'; }

function runUntilComplete(game, member, maxTicks = 500) {
  for (let t = 0; t < maxTicks; t++) {
    tickJobs(game);
    if (member.job === null) return t;
  }
  return -1;
}

// =============================================================================
// 1 & 2. takeData -> state.staffDataEfficiency (Game._tickBeamline's own
//        science multiplier reads this directly — see test 3 below).
// =============================================================================
console.log('\n=== 1. No scientist working takeData -> staffDataEfficiency stays 0 ===\n');
{
  const state = makeState();
  placeItem(state, 'opticalTable', 5, 5, 0, 0, 0); // real def: station.jobs = ['labWork', 'takeData']
  bump(state);
  const game = makeGame(state);

  for (let t = 0; t < 20; t++) tickJobs(game);
  assertOk(state.staffDataEfficiency === 0, `no scientist ever assigned -> 0 (got ${state.staffDataEfficiency})`);
}

console.log('\n=== 2. A scientist working takeData -> staffDataEfficiency scales by their efficiency ===\n');
{
  const state = makeState();
  placeItem(state, 'opticalTable', 5, 5, 0, 0, 0);
  bump(state);
  const game = makeGame(state);

  const scientist = makeMember('scientist', 's1');
  state.staffMembers = [scientist];

  assignJobs(game);
  assertOk(scientist.job?.jobType === 'takeData', `scientist assigned takeData (got ${scientist.job?.jobType})`);
  arrive(scientist);
  tickJobs(game);

  const expected = scientist.efficiency(0, scientist.job?.specialty ?? null);
  assertOk(expected > 0, 'setup: a plain scientist has nonzero efficiency');
  assertOk(Math.abs(state.staffDataEfficiency - expected) < 1e-9,
    `staffDataEfficiency === scientist.efficiency() (want ${expected}, got ${state.staffDataEfficiency})`);

  // Idle again (job abandoned) -> the aggregate drops back to 0. Confirms
  // this is a live per-tick read, not something that latches once set.
  abandonJob(scientist, game, null);
  tickJobs(game);
  assertOk(state.staffDataEfficiency === 0, 'stopping work drops the aggregate back to 0 the same tick');
}

// =============================================================================
// 3. Game data pipeline requires both working scientist and compute hardware.
// =============================================================================
console.log('\n=== 3. Game data pipeline: scientist + hardware gate research data ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry, makeDefaultBeamState } = await import('../src/beamline/BeamlineRegistry.js');

  const g = new Game(new BeamlineRegistry(), { seed: 909 });
  g.state.infraCanRun = true; // bypass the full utility gate — not this test's concern
  g._beamlineReadiness = () => ({ canRun: true });

  const bs = makeDefaultBeamState('testStand');
  bs.dataRate = 10;
  const entry = { id: 'bl-test', sourceId: null, beamState: bs };
  g.registry.beamlines.set(entry.id, entry);
  g.state.placeables.push({ id: 'data-test', type: 'serverCluster' });
  publishPoweredDataGateway(g, 'data-test');

  g.state.staffDataEfficiency = 0;
  const dataBefore = g.state.resources.data;
  g._tickBeamline(entry);
  g._tickDataSystems();
  assertOk(g.state.resources.data === dataBefore,
    `staffDataEfficiency 0 -> no data gain despite a live dataRate (before ${dataBefore}, after ${g.state.resources.data})`);

  bs.rawDataStored = 0; // isolate the next tick from the buffered first one
  g.state.staffDataEfficiency = 0.7;
  const dataBefore2 = g.state.resources.data;
  g._tickBeamline(entry);
  g._tickDataSystems();
  const gained = g.state.resources.data - dataBefore2;
  assertOk(gained > 0 && gained <= 10,
    `working scientist plus installed compute processes the live stream (got ${gained})`);
}

// =============================================================================
// 4. analyze converts data into research progress and reputation.
// =============================================================================
console.log('\n=== 4. analyze converts data into research progress + reputation ===\n');
{
  const state = makeState({ resources: { funding: 0, reputation: 1, data: 50, spares: 5 } });
  state.activeResearch = 'someResearchId';
  state.researchProgress = 0;
  placeItem(state, 'desk', 5, 5, 0, 0, 0); // real def: station.jobs = ['analyze', 'paperwork']
  bump(state);
  const game = makeGame(state);

  const scientist = makeMember('scientist', 's1');
  state.staffMembers = [scientist];

  assignJobs(game);
  assertOk(scientist.job?.jobType === 'analyze', `scientist assigned analyze at the desk (got ${scientist.job?.jobType})`);
  arrive(scientist);

  const efficiency = scientist.efficiency(0, scientist.job?.specialty ?? null);
  const expectedConsumed = Math.min(50, 20 * efficiency); // DATA_PER_ANALYSIS = 20

  const completedAt = runUntilComplete(game, scientist);
  assertOk(completedAt >= 0, `analyze job completed (at tick ${completedAt})`);
  assertOk(Math.abs(state.resources.data - (50 - expectedConsumed)) < 1e-9,
    `data consumed matches DATA_PER_ANALYSIS * efficiency, capped by what's on hand (want ${50 - expectedConsumed}, got ${state.resources.data})`);
  assertOk(Math.abs(state.researchProgress - expectedConsumed) < 1e-9,
    `researchProgress += consumed data (1:1) while research is active (want ${expectedConsumed}, got ${state.researchProgress})`);
  assertOk(Math.abs(state.resources.reputation - (1 + expectedConsumed * 0.02)) < 1e-9,
    `reputation += consumed data * 0.02 (want ${1 + expectedConsumed * 0.02}, got ${state.resources.reputation})`);
  assertOk(scientist.stats.analyses === 1, `stats.analyses incremented (got ${scientist.stats.analyses})`);
}
{
  // No data on hand at all: the job still completes, but converts nothing
  // and does not credit stats.analyses — mirrors repair.js's own "nothing
  // to consume, don't silently credit it" ruling for its zero-spares race.
  const state = makeState({ resources: { funding: 0, reputation: 0, data: 0, spares: 5 } });
  placeItem(state, 'desk', 5, 5, 0, 0, 0);
  bump(state);
  const game = makeGame(state);
  const scientist = makeMember('scientist', 's1');
  state.staffMembers = [scientist];
  assignJobs(game);
  arrive(scientist);
  const completedAt = runUntilComplete(game, scientist);
  assertOk(completedAt >= 0, 'setup: analyze job with zero data still completes');
  assertOk(state.resources.reputation === 0 && scientist.stats.analyses === 0,
    `zero data on hand -> nothing converted, no stats credit (reputation ${state.resources.reputation}, analyses ${scientist.stats.analyses})`);
}

// =============================================================================
// Section B — real Game instance.
// =============================================================================
const { Game } = await import('../src/game/Game.js');
const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');

// =============================================================================
// 5, 6, 7. The zone-tier ratchet.
//
// The brief's own literal example: 20 tiles, ZONE_TIER_THRESHOLDS' own
// maximum (tier 4). Fix round 1 (coordinator review) gave tier 4 real
// headroom — zoneTierFromStaffedOutput now normalises against
// ZONE_TIER_THRESHOLDS[3] * 1.25, not the bare threshold, so tier 4 needs
// staffedOutput >= 0.8 rather than >= 1.0 (staffedOutput's own clamp
// ceiling). Before that fix this file tested 16 tiles instead, specifically
// to dodge the zero-headroom bug at the literal top tier — the coordinator
// correctly called that out as papering over the bug rather than fixing it.
// =============================================================================
console.log('\n=== 5/6/7. Zone-tier ratchet: rfLab tier tracks staffing, not just tiles ===\n');
{
  const g = new Game(new BeamlineRegistry(), { seed: 606 });
  g.state.resources.funding = 1e9;

  const c0 = -25, r0 = -29, c1 = -22, r1 = -25; // 4x5 = 20 tiles
  const foundationOk = g.placeInfraRect(c0, r0, c1, r1, 'concrete'); // labFloor requiresFoundation: 'concrete'
  assertOk(foundationOk, 'setup: concrete foundation placed');
  const floorOk = g.placeInfraRect(c0, r0, c1, r1, 'labFloor');
  assertOk(floorOk, 'setup: lab flooring placed');
  const zoneOk = g.placeZoneRect(c0, r0, c1, r1, 'rfLab');
  assertOk(zoneOk, 'setup: 20 rfLab tiles painted');

  const conn = () => g.state.zoneConnectivity.rfLab;
  assertOk(conn().tileTier === 4, `setup: 20 tiles -> tile tier 4 (got ${conn().tileTier})`);
  assertOk(conn().tier === 0, `5. freshly painted, no engineer -> tier 0 (got ${conn().tier})`);
  assertOk(conn().peakTier === 0, `5. freshly painted, no engineer -> peakTier 0 (got ${conn().peakTier})`);

  // Set up test 13's research node NOW, while tier is genuinely 0 — the
  // "classify every reader as a rate or a gate" assertion the coordinator's
  // review asked for needs a node that is ACTUALLY gated at tier 0 to mean
  // anything (RESEARCH_SPEED_TABLE.early/mid have no null row at all, so a
  // shallow node would trivially "pass" this check for the wrong reason —
  // see getResearchSpeedMultiplier's own row selection).
  const { getLabResearchTier, getResearchSpeedMultiplier, _computeNodeDepth } = await import('../src/game/research.js');
  const { RESEARCH } = await import('../src/data/research.js');
  const rfNodes = Object.values(RESEARCH).filter(r => r.category === 'rf' && !r.hidden);
  const deepestRf = rfNodes.reduce((a, b) => (_computeNodeDepth(b.id) > _computeNodeDepth(a.id) ? b : a));
  assertOk(_computeNodeDepth(deepestRf.id) >= 5, `setup: found a real depth->=5 'rf' node (${deepestRf.id}, depth ${_computeNodeDepth(deepestRf.id)}) — RESEARCH_SPEED_TABLE.late/final block tier 0`);
  assertOk(getResearchSpeedMultiplier(deepestRf.id, g.state) === null, `setup: that node is genuinely gated at tier 0 (got ${getResearchSpeedMultiplier(deepestRf.id, g.state)})`);

  const benchOk = g.placePlaceable({ type: 'labBench', col: c0 + 1, row: r0 + 1, subCol: 0, subRow: 0, dir: 0, free: true });
  assertOk(benchOk, 'setup: labBench placed inside the rfLab zone');
  // Two more, well clear of the zone and never staffed — _getFurnishingTier
  // (research.js) counts by the ITEM's own declared zoneTypes, not by
  // where it's physically standing, so these only need to exist somewhere
  // on the map. Purely to clear FURNISHING_TIER_THRESHOLDS' own tier-2 bar
  // (3 items): getLabResearchTier is min(peakTier, furnTier), and test 13
  // below needs furnTier >= 2 to prove the peak-tier property on a FINAL
  // research node too (isFinal ? 2 : 1 — startResearch's own minTier), not
  // just an ordinary deep one.
  assertOk(g.placePlaceable({ type: 'labBench', col: c0 + 10, row: r0 + 1, subCol: 0, subRow: 0, dir: 0, free: true }), 'setup: 2nd labBench placed (furnTier only)');
  assertOk(g.placePlaceable({ type: 'labBench', col: c0 + 16, row: r0 + 1, subCol: 0, subRow: 0, dir: 0, free: true }), 'setup: 3rd labBench placed (furnTier only)');

  const engineer = new StaffMember({
    id: 'eng1', profession: 'engineer', specialty: 'rf', traits: [],
    skills: { ...FLAT_SKILLS, technical: 10 }, rng: () => 0.5,
  });
  engineer.assignment.zoneId = 'rfLab';
  g.state.staffMembers.push(engineer);

  assignJobs(g);
  assertOk(engineer.job?.jobType === 'labWork', `engineer assigned labWork at the bench (got ${engineer.job?.jobType})`);
  arrive(engineer);

  let tick = 0;
  const maxTicks = 500;
  for (; tick < maxTicks; tick++) {
    tickJobs(g);
    // Re-assign in case labWork's own workTicks (120) completed mid-run —
    // matches the real game's own assignJobs/tickJobs cadence.
    if (!engineer.job) { assignJobs(g); if (engineer.job) arrive(engineer); }
    // 0.98, not merely "past the 0.8 crossing threshold" — the 100-tick
    // break below only costs 0.1 of staffedOutput, so stopping the moment
    // tier first reads 4 would leave next to no margin against that decay.
    // Waiting for near-total saturation leaves ~0.9 after the break,
    // comfortably above the 0.8 threshold fix round 1's headroom fix gives
    // tier 4 (see this block's own header — before that fix there was NO
    // way to get margin at tier 4 at all, by construction).
    if (conn().tier === 4 && conn().staffedOutput > 0.98) break;
  }
  assertOk(tick < maxTicks, `setup: staffedOutput reached a comfortable margin within ${maxTicks} ticks (stopped at ${tick})`);
  assertOk(conn().tier === 4, `6. engineer works labWork long enough -> tier rises to the tile-count tier (got ${conn().tier})`);
  assertOk(conn().peakTier === 4, `6. peakTier tracks the newly reached tier (got ${conn().peakTier})`);

  const tierBeforeBreak = conn().tier;
  const peakBeforeBreak = conn().peakTier;
  const staffedOutputBeforeBreak = conn().staffedOutput;
  abandonJob(engineer, g, null); // the engineer clocks out — no more assignJobs calls below
  for (let t = 0; t < 100; t++) tickJobs(g);

  assertOk(conn().staffedOutput < staffedOutputBeforeBreak, 'setup: staffedOutput actually decayed over the 100-tick break');
  assertOk(conn().tier === tierBeforeBreak,
    `7. a 100-tick break does not drop the tier — at TIER 4 itself, the one the pre-fix normalisation gave zero headroom (before ${tierBeforeBreak}, after ${conn().tier}, staffedOutput now ${conn().staffedOutput})`);
  assertOk(conn().peakTier >= peakBeforeBreak, `7. peakTier never falls (before ${peakBeforeBreak}, after ${conn().peakTier})`);

  // 13. research.js's getLabResearchTier reads peakTier, not the live
  // (decaying) tier — see that function's own comment for the real bug
  // this closes: reading the live tier there let an engineer being pulled
  // onto commission work for a stretch retroactively wall off research
  // nodes in a lab a player had already staffed up, or block a node from
  // ever starting at all. This is the "classify every reader as a rate or
  // a gate" assertion the coordinator's review asked for: not just that
  // the numeric tier value survives a lull (already covered above), but
  // that deepestRf (set up above, while tier was still genuinely 0 and
  // confirmed actually gated then) is STILL STARTABLE
  // (getResearchSpeedMultiplier !== null, the exact value startResearch
  // itself checks) after one.
  const researchTierAtPeak = getLabResearchTier('rfLab', g.state);
  const speedAtPeak = getResearchSpeedMultiplier(deepestRf.id, g.state);
  assertOk(researchTierAtPeak > 0, `setup: getLabResearchTier('rfLab') is nonzero right after reaching peak (got ${researchTierAtPeak})`);
  assertOk(speedAtPeak !== null, `setup: the deep rf node is startable right after reaching peak tier (got ${speedAtPeak})`);
  for (let t = 0; t < 1000; t++) tickJobs(g);
  assertOk(conn().tier === 0, `setup: 1000 ticks of decay actually drops the LIVE tier to 0 (got ${conn().tier})`);
  assertOk(conn().peakTier === peakBeforeBreak, `setup: peakTier is still untouched by the long decay (got ${conn().peakTier})`);
  assertOk(getLabResearchTier('rfLab', g.state) === researchTierAtPeak,
    `13a. getLabResearchTier stays at the peak-tier value even though the live zone tier dropped to 0 (want ${researchTierAtPeak}, got ${getLabResearchTier('rfLab', g.state)})`);
  assertOk(getResearchSpeedMultiplier(deepestRf.id, g.state) === speedAtPeak,
    `13b. GATE property: the deep rf node is still startable after the live tier collapsed to 0 (want ${speedAtPeak}, got ${getResearchSpeedMultiplier(deepestRf.id, g.state)})`);
}

// =============================================================================
// 8. Commissioning flags a newly placed component — both real placement
//    choke points (Game._placePlaceableInner via beamline.placeJunction,
//    BeamlineSystem.placeOnPipe).
// =============================================================================
console.log('\n=== 8. New placements start needsCommissioning, with the right specialty ===\n');
{
  const g = new Game(new BeamlineRegistry(), { seed: 707 });
  g.state.resources.funding = 1e9;
  g.state.resources.spares = 1e6;

  // 8a. A junction/module component (role: 'junction') — Game._placePlaceableInner.
  let sourceId = null;
  for (let row = -25; row < 25 && !sourceId; row += 4) {
    for (let col = -25; col < 25 && !sourceId; col += 4) {
      sourceId = g.beamline.placeJunction({ type: 'source', col, row, subCol: 0, subRow: 0, dir: 0, free: true });
    }
  }
  assertOk(!!sourceId, 'setup: source junction placed');
  const sourcePlaceable = g.state.placeables[g.state.placeableIndex[sourceId]];
  assertOk(sourcePlaceable.needsCommissioning === true, `8a. junction starts needsCommissioning (got ${sourcePlaceable.needsCommissioning})`);
  // 'source' has category 'source', which has no engineering-specialty
  // counterpart (only 'rf'/'diagnostic' do — see commissioningSpecialtyFor's
  // own comment) — an independent expectation, not a tautological re-call
  // of the function under test.
  assertOk(sourcePlaceable.specialty === null, `8a. category 'source' has no specialty match -> null (got ${sourcePlaceable.specialty})`);

  // 8b. An on-pipe placement (role: 'placement') — BeamlineSystem.placeOnPipe.
  // findSlot only ever reads pipe.subL/pipe.placements (verified directly in
  // pipe-placements.js) — a hand-built pipe record exercises the real
  // placeOnPipe method without needing real pipe-drawing geometry, which
  // this test has no other use for.
  g.state.beamPipes.push({ id: 'bp_test', subL: 8, placements: [] });
  const rfCavityId = g.beamline.placeOnPipe('bp_test', { type: 'rfCavity', position: 0, mode: 'snap', free: true });
  assertOk(!!rfCavityId, 'setup: rfCavity placed on the pipe');
  const pipe = g.state.beamPipes.find(p => p.id === 'bp_test');
  const rfCavity = pipe.placements.find(p => p.id === rfCavityId);
  assertOk(rfCavity?.needsCommissioning === true, `8b. on-pipe placement starts needsCommissioning (got ${rfCavity?.needsCommissioning})`);
  assertOk(rfCavity?.specialty === 'rf', `8b. rfCavity (category 'rf') commissions with specialty 'rf' (got ${rfCavity?.specialty})`);
}

// =============================================================================
// 9. Uncommissioned components are derated to 0.7x by buildPhysicsElements.
// =============================================================================
console.log('\n=== 9. Uncommissioned components run at 0.7x rated stats ===\n');
{
  const params = seedComponentParams('rfCavity', {});
  const baseNode = { kind: 'placement', id: 'pl_1', type: 'rfCavity', params, beamStart: 0, subL: COMPONENTS.rfCavity.subL || 6, pipeId: 'bp_1', position: 0 };

  const committed = buildPhysicsElements([{ ...baseNode, needsCommissioning: false }], {})[0];
  const uncommissioned = buildPhysicsElements([{ ...baseNode, needsCommissioning: true }], {})[0];

  const numericKeys = Object.keys(committed.stats).filter(k => typeof committed.stats[k] === 'number');
  assertOk(numericKeys.length > 0, 'setup: rfCavity produced at least one numeric stat to derate');
  for (const key of numericKeys) {
    assertOk(Math.abs(uncommissioned.stats[key] - committed.stats[key] * 0.7) < 1e-6,
      `${key}: uncommissioned === commissioned * 0.7 (commissioned ${committed.stats[key]}, uncommissioned ${uncommissioned.stats[key]})`);
  }
}

// =============================================================================
// 10. commission clears the flag; a mismatched specialty still works, at
//     half rate (exactly 2x the ticks, via CROSS_SPECIALTY_EFFICIENCY).
// =============================================================================
console.log('\n=== 10. commission clears needsCommissioning; mismatched specialty at half rate ===\n');
function runCommission(specialty) {
  const state = makeState();
  bump(state);
  const game = makeGame(state);
  const target = { id: 'pl_target', type: 'rfCavity', needsCommissioning: true, specialty: 'rf', subL: 6, position: 0 };
  // jobStillValid (jobRunner.js) resolves a target-addressed job's live
  // footprint every tick via footprintCellsForPlacement -> placementPose,
  // which needs a real `.path` (>= 2 points) or it reads as "nothing to
  // walk to" and abandons the job before any progress accrues — a real
  // pipe's path, unlike findSlot's own subL/placements-only contract (see
  // test 8b's comment), so this fixture needs one even though placeOnPipe
  // itself does not.
  state.beamPipes = [{ id: 'bp_1', subL: 8, path: [{ col: 0, row: 0 }, { col: 2, row: 0 }], placements: [target] }];
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  game.registry.getAll = () => [beamline];

  const engineer = new StaffMember({ id: 'e1', profession: 'engineer', specialty, traits: [], skills: FLAT_SKILLS, rng: () => 0.5 });
  state.staffMembers = [engineer];

  // No station-addressed commission offer exists (repair/commission are
  // target-addressed — see jobs.js's own header); buildJobOffers needs a
  // real registered beamline whose flattened path reaches this node, which
  // this hand-built fixture does not attempt to reproduce (see jobs.js's
  // beamlineComponentNodes/flattenPath). Assigning the job directly instead
  // exercises exactly the piece this test cares about — tickJobs' progress
  // accrual and jobEffects/commission.js's completion effect — the same
  // narrower-fixture tradeoff test-target-job-destination.js makes for its
  // own progress-accrual tests.
  engineer.job = {
    jobType: 'commission', target: { beamlineId: 'bl-1', nodeId: 'pl_target' },
    specialty: 'rf', stationKey: null, destNode: null, phase: 'work', progress: 0,
  };

  const completedAt = runUntilComplete(game, engineer);
  return { completedAt, target, engineer };
}

{
  const { completedAt, target, engineer } = runCommission('rf'); // matching
  assertOk(completedAt >= 0, `matching-specialty commission completed (at tick ${completedAt})`);
  assertOk(target.needsCommissioning === false, `10a. matching engineer clears needsCommissioning (got ${target.needsCommissioning})`);
  assertOk(engineer.stats.commissions === 1, `10a. stats.commissions incremented (got ${engineer.stats.commissions})`);

  const { completedAt: mismatchedAt } = runCommission('vacuum'); // mismatched
  assertOk(mismatchedAt >= 0, `mismatched-specialty commission still completed (at tick ${mismatchedAt})`);
  assertOk(Math.abs(mismatchedAt - 2 * completedAt) <= 1,
    `10b. mismatched specialty takes ~2x the ticks (matching ${completedAt}, mismatched ${mismatchedAt})`);
}

// =============================================================================
// 11. The real job board actually offers commission for an on-pipe
//     component — test 8b only proved placeOnPipe STAMPS the flag; this is
//     the "second unguarded route" jobs.js's commissionOffers itself used
//     to miss (see that function's own comment): reading node.placeable
//     directly resolves to undefined for a 'placement'-kind flattened node,
//     so the on-pipe half of the catalogue could carry needsCommissioning
//     forever and never actually be offered to anyone. Real source +
//     detector + drawn pipe + on-pipe placement, mirroring
//     test-repair-and-fabrication.js's own on-pipe-repair end-to-end test.
// =============================================================================
console.log('\n=== 11. buildJobOffers offers commission for a real on-pipe component ===\n');
{
  const { buildJobOffers } = await import('../src/game/staff/jobs.js');

  const g = new Game(new BeamlineRegistry(), { seed: 105 });
  g.state.resources.funding = 1e9;
  g.state.resources.spares = 1e9;

  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 20, dir: 3, free: true, silent: true });
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 20, dir: 3, free: true, silent: true });
  assertOk(!!src && !!det, 'setup: source and detector placed');
  const pipeId = g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 20 }, { col: 6, row: 20 }],
  );
  assertOk(!!pipeId, 'setup: pipe drawn between them');
  const rfCavityId = g.beamline.placeOnPipe(pipeId, { type: 'rfCavity', position: 0.5, mode: 'snap', free: true });
  assertOk(!!rfCavityId, 'setup: rfCavity mounted on the pipe');

  const { offers } = buildJobOffers(g);
  const offer = offers.find(o => o.jobType === 'commission' && o.target?.nodeId === rfCavityId);
  assertOk(!!offer, `a commission offer was generated for the on-pipe rfCavity (got ${offers.filter(o => o.jobType === 'commission').length} commission offers total)`);
  assertOk(offer?.specialty === 'rf', `the offer carries the rfCavity's own specialty (got ${offer?.specialty})`);
}

// =============================================================================
// 12. Two engineers are never double-assigned to the same commission
//     target. jobRunner.js's own claimed-targets guard (pickBestOffer/
//     assignJobs) only ever covered 'repair' — the exact class of bug task
//     5's fix round 1 closed for repair (repairOffers' offer object is
//     reused, unmutated, across every member's pickBestOffer call this
//     pass, so a second engineer processed after the first already took it
//     still saw it as eligible) applied equally to 'commission' the moment
//     needsCommissioning became reachable at all — which, before this task,
//     it never was. Real source + pipe + on-pipe rfCavity, two engineers.
// =============================================================================
console.log('\n=== 12. Two engineers are never double-assigned to the same commission target ===\n');
{
  const g = new Game(new BeamlineRegistry(), { seed: 106 });
  g.state.resources.funding = 1e9;
  g.state.resources.spares = 1e9;

  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 24, dir: 3, free: true, silent: true });
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 24, dir: 3, free: true, silent: true });
  assertOk(!!src && !!det, 'setup: source and detector placed');
  const pipeId = g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 24 }, { col: 6, row: 24 }],
  );
  assertOk(!!pipeId, 'setup: pipe drawn between them');
  const rfCavityId = g.beamline.placeOnPipe(pipeId, { type: 'rfCavity', position: 0.5, mode: 'snap', free: true });
  assertOk(!!rfCavityId, 'setup: rfCavity mounted on the pipe');
  // The source/detector junctions started needsCommissioning too (every
  // beamline component does — see Game._placePlaceableInner). Clear those
  // so the rfCavity is the ONLY commission target in play; otherwise the
  // "other" engineer below would legitimately pick up a real, DIFFERENT
  // commission job (the source or detector) and this test would not be
  // isolating the double-assignment guard it's actually about.
  g.state.placeables[g.state.placeableIndex[src]].needsCommissioning = false;
  g.state.placeables[g.state.placeableIndex[det]].needsCommissioning = false;

  const eng1 = new StaffMember({ id: 'ceng1', profession: 'engineer', specialty: 'rf', traits: [], skills: FLAT_SKILLS, rng: () => 0.5 });
  const eng2 = new StaffMember({ id: 'ceng2', profession: 'engineer', specialty: 'rf', traits: [], skills: FLAT_SKILLS, rng: () => 0.5 });
  g.state.staffMembers.push(eng1, eng2);

  assignJobs(g);
  const assignedToTarget = [eng1, eng2].filter(e => e.job?.jobType === 'commission' && e.job.target?.nodeId === rfCavityId);
  assertOk(assignedToTarget.length === 1,
    `exactly one engineer assigned to the commission target (got ${assignedToTarget.length}: ${[eng1, eng2].map(e => e.job?.jobType || 'idle').join(', ')})`);
  const other = eng1.job?.target?.nodeId === rfCavityId ? eng2 : eng1;
  assertOk(other.job === null, `the other engineer got no job at all — nothing else to commission here (got ${other.job?.jobType})`);
  assertOk(other.idleReason === 'Someone else is already commissioning that component.',
    `its idle reason names the conflict (got "${other.idleReason}")`);
}

// =============================================================================
// 14. machineShop/maintenance are excluded from the staffing ratchet — see
//     LABWORK_CAPABLE_ZONES' own comment (facility.js) for the real bug
//     this closes: deriving the set from "can a labWork bench be placed
//     here" swept both in even though neither has an engineering specialty,
//     which pinned machineShop's staffedOutput at ~0.18 forever and
//     permanently blocked 12 machineTypes-category research nodes (81% of
//     an 80,000-tick playthrough blocked on lab tier).
// =============================================================================
console.log('\n=== 14. machineShop/maintenance are excluded from the staffing ratchet ===\n');
{
  const { LABWORK_CAPABLE_ZONES } = await import('../src/data/facility.js');
  assertOk(!LABWORK_CAPABLE_ZONES.has('machineShop'), 'machineShop excluded (no engineering specialty)');
  assertOk(!LABWORK_CAPABLE_ZONES.has('maintenance'), 'maintenance excluded (no engineering specialty)');
  assertOk(['rfLab', 'vacuumLab', 'coolingLab', 'diagnosticsLab'].every(z => LABWORK_CAPABLE_ZONES.has(z)),
    'the four labs with a real engineering specialty are still included');

  // Live: a machineShop zone's tier tracks TILES ALONE, immediately, with
  // zero staff ever assigned — the same "not staffing-gated at all"
  // behaviour cafeteria/officeSpace/meetingRoom already had.
  const g = new Game(new BeamlineRegistry(), { seed: 808 });
  g.state.resources.funding = 1e9;
  const c0 = -25, r0 = -29, c1 = -22, r1 = -25; // 4x5 = 20 tiles
  assertOk(g.placeInfraRect(c0, r0, c1, r1, 'concrete'), 'setup: concrete foundation placed');
  assertOk(g.placeInfraRect(c0, r0, c1, r1, 'labFloor'), 'setup: lab flooring placed');
  assertOk(g.placeZoneRect(c0, r0, c1, r1, 'machineShop'), 'setup: 20 machineShop tiles painted');
  const conn = g.state.zoneConnectivity.machineShop;
  assertOk(conn.tileTier === 4, `setup: 20 tiles -> tile tier 4 (got ${conn.tileTier})`);
  assertOk(conn.tier === 4, `14. machineShop tier matches tile tier immediately, no staffing needed (got ${conn.tier})`);
}

// =============================================================================
// 15. staffedOutput resets on zone resize — "stage a cheap 4-tile lab to
//     saturation, then paint it out to 20 tiles" used to read as an instant
//     tier 4 at the new, much larger footprint, and demolishing + repainting
//     elsewhere carried the same value forward too. See
//     Game.recomputeZoneConnectivity's own comment on the fix.
// =============================================================================
console.log('\n=== 15. staffedOutput resets on zone resize (labour gate no longer payable once) ===\n');
{
  const g = new Game(new BeamlineRegistry(), { seed: 909 });
  g.state.resources.funding = 1e9;

  const smallC0 = -25, smallR0 = -29, smallC1 = -24, smallR1 = -28; // 2x2 = 4 tiles
  assertOk(g.placeInfraRect(smallC0, smallR0, smallC1, smallR1, 'concrete'), 'setup: foundation placed');
  assertOk(g.placeInfraRect(smallC0, smallR0, smallC1, smallR1, 'labFloor'), 'setup: lab flooring placed');
  assertOk(g.placeZoneRect(smallC0, smallR0, smallC1, smallR1, 'vacuumLab'), 'setup: 4 vacuumLab tiles painted');
  assertOk(g.state.zoneConnectivity.vacuumLab.tileTier === 1, 'setup: 4 tiles -> tile tier 1');

  // Stage it to full saturation directly — this test is about the RESIZE
  // guard specifically; tests 5-7 already cover the real per-tick ramp.
  g.state.zoneConnectivity.vacuumLab.staffedOutput = 1.0;
  g.state.zoneConnectivity.vacuumLab.peakTier = 1;
  g.recomputeZoneConnectivity();
  assertOk(g.state.zoneConnectivity.vacuumLab.tier === 1, `setup: tier === tile tier at the small size (got ${g.state.zoneConnectivity.vacuumLab.tier})`);

  // Paint the SAME zone type out to 20 tiles (tile tier 4), covering the
  // original 4-tile footprint. Measured exploit before this fix: staffedOutput
  // carried straight over unchanged, reading tier 4 the instant tileTier
  // caught up.
  const bigC0 = -25, bigR0 = -29, bigC1 = -22, bigR1 = -25; // 4x5 = 20 tiles
  assertOk(g.placeInfraRect(bigC0, bigR0, bigC1, bigR1, 'concrete'), 'setup: foundation extended');
  assertOk(g.placeInfraRect(bigC0, bigR0, bigC1, bigR1, 'labFloor'), 'setup: lab flooring extended');
  assertOk(g.placeZoneRect(bigC0, bigR0, bigC1, bigR1, 'vacuumLab'), 'setup: painted out to 20 tiles');
  const conn = g.state.zoneConnectivity.vacuumLab;
  assertOk(conn.tileTier === 4, `setup: now 20 tiles -> tile tier 4 (got ${conn.tileTier})`);
  assertOk(conn.staffedOutput === 0, `15a. staffedOutput reset to 0 on resize, not carried over (got ${conn.staffedOutput})`);
  assertOk(conn.tier === 0, `15a. tier reads 0 at the new size — not an instant tier 4 from the old small zone's staffing (got ${conn.tier})`);
  assertOk(conn.peakTier === 1, "setup: peakTier (durable) still reflects the small zone's own achievement — not reset");

  // Demolish entirely, then repaint the same size elsewhere.
  g.state.zoneConnectivity.vacuumLab.staffedOutput = 1.0; // simulate having fully re-staffed the big zone for real
  g.recomputeZoneConnectivity();
  assertOk(g.state.zoneConnectivity.vacuumLab.tier === 4, 'setup: re-staffed the big zone to tier 4');
  assertOk(g.removeZoneRect(bigC0, bigR0, bigC1, bigR1), 'setup: zone demolished entirely');
  assertOk(g.state.zoneConnectivity.vacuumLab.staffedOutput === 0, `15b. demolition (tileCount -> 0) also resets staffedOutput (got ${g.state.zoneConnectivity.vacuumLab.staffedOutput})`);

  const elC0 = 10, elR0 = 10, elC1 = 13, elR1 = 14; // 4x5 = 20 tiles, a different location
  assertOk(g.placeInfraRect(elC0, elR0, elC1, elR1, 'concrete'), 'setup: foundation placed elsewhere');
  assertOk(g.placeInfraRect(elC0, elR0, elC1, elR1, 'labFloor'), 'setup: lab flooring placed elsewhere');
  assertOk(g.placeZoneRect(elC0, elR0, elC1, elR1, 'vacuumLab'), 'setup: repainted 20 tiles elsewhere');
  assertOk(g.state.zoneConnectivity.vacuumLab.staffedOutput === 0,
    `15c. repainting elsewhere still reads staffedOutput 0 — the "demolish and relocate" exploit is closed (got ${g.state.zoneConnectivity.vacuumLab.staffedOutput})`);
  assertOk(g.state.zoneConnectivity.vacuumLab.peakTier === 4, 'setup: peakTier (durable) survives the demolition/relocation too');
}

// =============================================================================
// 16. peakTier/staffedOutput persistence across undo and save/load is
//     covered end to end in test-game-undo.js ("zoneConnectivity's
//     staffedOutput/peakTier...") and test-game-serialize.js
//     ("zoneConnectivity persistence"), not duplicated here — that is the
//     more natural home for it (those files already own the undo/save
//     round-trip contract this task's own fix now has to honour) and the
//     coordinator's review asked for both to be run directly.
// =============================================================================

// =============================================================================
// 17. Completing commission actually re-solves the beamline — the derate
//     was previously a no-op in play: physics-payload.js's
//     COMMISSIONING_DERATE only applies inside buildPhysicsElements, which
//     only ever runs from Game.recalcBeamline/recalcAllBeamlines, and
//     nothing on the commission completion path called either. Measured
//     live: zero recalcs from the effect, zero across 20 plain ticks
//     afterward — entry.beamState (what income/data/objectives bill from)
//     kept the derated numbers until the player happened to edit the
//     beamline for an unrelated reason.
// =============================================================================
console.log('\n=== 17. Completing commission re-solves the beamline (not a no-op in play) ===\n');
{
  const { onJobComplete } = await import('../src/game/staff/jobRunner.js');

  const g = new Game(new BeamlineRegistry(), { seed: 1212 });
  g.state.resources.funding = 1e9;
  g.state.resources.spares = 1e9;

  const src = g.beamline.placeJunction({ type: 'source', col: -6, row: 28, dir: 3, free: true, silent: true });
  // detector's own stats.dataRate (module/junction role, so it's the
  // commission target directly — no on-pipe placement needed) is read by
  // _fallbackStatsForBeamline's `dRate += s.dataRate` UNSCALED by
  // infraQuality's gainScale, unlike energyGain — this beamline has no
  // power/rf/cooling/vacuum wiring at all (not this test's concern), which
  // would otherwise floor a gainScale-gated stat to 0 regardless of
  // commissioning and make the derate invisible for the wrong reason.
  const det = g.beamline.placeJunction({ type: 'detector', col: 6, row: 28, dir: 3, free: true, silent: true });
  assertOk(!!src && !!det, 'setup: source and detector placed');
  const pipeId = g.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: det, portName: 'entry' },
    [{ col: -6, row: 28 }, { col: 6, row: 28 }],
  );
  assertOk(!!pipeId, 'setup: pipe drawn');

  const entry = g.registry.getAll().find(e => e.sourceId === src);
  assertOk(!!entry, 'setup: placing a source registered a beamline entry');

  g.recalcAllBeamlines(); // baseline recalc, matching what a real build already triggers
  const dataRateDerated = entry.beamState.dataRate;
  assertOk(dataRateDerated > 0, `setup: dataRate is nonzero while derated (got ${dataRateDerated})`);

  const engineer = new StaffMember({ id: 'crecalc1', profession: 'engineer', specialty: null, traits: [], skills: FLAT_SKILLS, rng: () => 0.5 });
  const job = { jobType: 'commission', target: { beamlineId: entry.id, nodeId: det }, specialty: null };
  onJobComplete(g, engineer, job);

  const detPlaceable = g.state.placeables[g.state.placeableIndex[det]];
  assertOk(detPlaceable.needsCommissioning === false, 'setup: needsCommissioning cleared');

  // No manual recalc call here — if the effect itself didn't trigger one,
  // dataRate would still read the derated value from before commission.
  const dataRateAfter = entry.beamState.dataRate;
  assertOk(dataRateAfter > dataRateDerated,
    `17a. commission completion re-solved the beamline on its own — dataRate rose from the derated value with no manual recalc call (derated ${dataRateDerated}, after ${dataRateAfter})`);
  assertOk(Math.abs(dataRateAfter - dataRateDerated / 0.7) < 1e-6,
    `17b. and by exactly the 1/0.7 factor the derate removed (want ${dataRateDerated / 0.7}, got ${dataRateAfter})`);
}

// =============================================================================
// 18. Photon data is gated by the same "no scientist -> no data" check as
//     detector data. Before this fix: bs.photonRate * 0.1 * bs.beamQuality
//     was added to resources.data with no scientist check at all — measured
//     live with zero working scientists, the detector half correctly paid
//     0 but this half still paid 4.50/tick.
// =============================================================================
console.log('\n=== 18. Photon data is gated by the same scientist check as detector data ===\n');
{
  const { makeDefaultBeamState } = await import('../src/beamline/BeamlineRegistry.js');
  const g = new Game(new BeamlineRegistry(), { seed: 1313 });
  g.state.infraCanRun = true;
  g._beamlineReadiness = () => ({ canRun: true });

  const bs = makeDefaultBeamState('lightSource');
  bs.dataRate = 0; // isolate the photon route from the detector route
  bs.photonRate = 45;
  bs.beamQuality = 1;
  const entry = { id: 'bl-photon', sourceId: null, beamState: bs };
  g.registry.beamlines.set(entry.id, entry);
  g.state.placeables.push({ id: 'data-photon', type: 'serverCluster' });
  publishPoweredDataGateway(g, 'data-photon');

  g.state.staffDataEfficiency = 0;
  const dataBefore = g.state.resources.data;
  g._tickBeamline(entry);
  g._tickDataSystems();
  assertOk(g.state.resources.data === dataBefore,
    `18a. no working scientist -> photon data gain is 0 too (before ${dataBefore}, after ${g.state.resources.data})`);

  bs.rawDataStored = 0;
  g.state.staffDataEfficiency = 1;
  const dataBefore2 = g.state.resources.data;
  g._tickBeamline(entry);
  g._tickDataSystems();
  const gained = g.state.resources.data - dataBefore2;
  assertOk(gained > 0, `18b. a working scientist DOES unlock photon data (gained ${gained})`);
}

// =============================================================================
// 19. takeData's facility-wide total no longer scales with beamline count.
//     Before this fix: state.staffDataEfficiency (a facility-wide total) was
//     applied UNDIVIDED to every running beamline — measured live, two
//     beamlines each independently credited the full 10.00/tick a single
//     scientist's efficiency implied (20 total from one scientist), scaling
//     linearly with line count (1/2/4/8 lines -> 10/20/40/80 from the same
//     one scientist).
// =============================================================================
console.log('\n=== 19. takeData total is independent of beamline count (fix round 1) ===\n');
{
  const { makeDefaultBeamState } = await import('../src/beamline/BeamlineRegistry.js');
  const g = new Game(new BeamlineRegistry(), { seed: 1414 });
  g.state.infraCanRun = true;
  g._beamlineReadiness = () => ({ canRun: true });

  const bs1 = makeDefaultBeamState('testStand'); bs1.dataRate = 10;
  const bs2 = makeDefaultBeamState('testStand'); bs2.dataRate = 10;
  const entry1 = { id: 'bl-q1', sourceId: null, beamState: bs1, status: 'running' };
  const entry2 = { id: 'bl-q2', sourceId: null, beamState: bs2, status: 'running' };
  g.registry.getAll = () => [entry1, entry2]; // both registered AND running
  g.state.placeables.push({ id: 'data-shared', type: 'serverRack' });
  publishPoweredDataGateway(g, 'data-shared');

  g.state.staffDataEfficiency = 1.0; // one scientist, efficiency 1.0
  const before = g.state.resources.data;
  g._tickBeamline(entry1);
  g._tickBeamline(entry2);
  g._tickDataSystems();
  const totalGain = g.state.resources.data - before;
  assertOk(Math.abs(totalGain - 6) < 1e-9,
    `19. two streams share one server rack's 6/t balanced compute budget (got ${totalGain})`);
}

// =============================================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
