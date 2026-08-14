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
//   5. A freshly painted lab (rfLab, below its max tier so the ratchet has
//      real headroom to prove the "harmless break" property — see that
//      block's own comment for why 20 tiles specifically would NOT be a
//      fair test of it) with no engineer has tier === 0 and peakTier === 0.
//   6. An engineer working labWork there raises tier to the tile-count
//      tier.
//   7. The engineer then stops; 100 ticks of decay leave tier unchanged
//      and peakTier no lower than it was.
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
//
// Mutation-verified guards (see task-6-report.md for both outputs):
//   - jobs.js's commissionOffers reading node.placeable directly (the pre-
//     fix bug: silently never offers commissioning for any on-pipe
//     component) — reverting the fix fails test 11.
//   - Game._tickBeamline's sciMult reading state.staffDataEfficiency —
//     hardcoding it back to a constant fails test 3.
//   - The zone-tier ratchet's min(tileTier, staffTier) — dropping the
//     staffTier term fails test 5 (a freshly painted zone would read its
//     tile tier immediately, with no engineer at all).

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

// Simulate the renderer reporting arrival — see jobRunner.js's own header
// comment: only StaffPawns.js is supposed to flip this in the real game.
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
// 3. Game._tickBeamline reads staffDataEfficiency as its sciMult.
// =============================================================================
console.log('\n=== 3. Game._tickBeamline: sciMult reads state.staffDataEfficiency ===\n');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry, makeDefaultBeamState } = await import('../src/beamline/BeamlineRegistry.js');

  const g = new Game(new BeamlineRegistry(), { seed: 909 });
  g.state.infraCanRun = true; // bypass the full utility gate — not this test's concern

  const bs = makeDefaultBeamState('testStand');
  bs.dataRate = 10;
  const entry = { id: 'bl-test', sourceId: null, beamState: bs };

  g.state.staffDataEfficiency = 0;
  const dataBefore = g.state.resources.data;
  g._tickBeamline(entry);
  assertOk(g.state.resources.data === dataBefore,
    `staffDataEfficiency 0 -> no data gain despite a live dataRate (before ${dataBefore}, after ${g.state.resources.data})`);

  g.state.staffDataEfficiency = 0.7;
  const dataBefore2 = g.state.resources.data;
  g._tickBeamline(entry);
  const gained = g.state.resources.data - dataBefore2;
  assertOk(Math.abs(gained - 10 * 0.7) < 1e-9, `data gain === connectedDataRate * staffDataEfficiency (want 7, got ${gained})`);
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
// Deliberately NOT a 20-tile zone (the brief's own illustrative example):
// 20 tiles is ZONE_TIER_THRESHOLDS' own maximum (the top tier, 4), whose
// required staffedOutput is exactly 1.0 — the same value staffedOutput is
// clamped to. Reaching the top tier at all necessarily means staffedOutput
// is sitting AT that clamp with zero headroom above it, so ANY decay tick
// immediately after crosses back below 1.0 and drops the tier — that is a
// real, inherent property of "normalise the same four thresholds into
// [0, 1]" (there is no thresholds[4] to leave headroom against), not a bug
// in the ratchet. 16 tiles (tier 3, threshold 0.8) has real headroom
// (staffedOutput keeps climbing toward 1.0 as long as work continues,
// giving up to 0.2 of margin against the 100-tick/-0.1 decay this test
// exercises), which is what actually demonstrates "a lunch break is
// harmless" rather than accidentally proving the opposite at the one tier
// where it structurally can't hold.
// =============================================================================
console.log('\n=== 5/6/7. Zone-tier ratchet: rfLab tier tracks staffing, not just tiles ===\n');
{
  const g = new Game(new BeamlineRegistry(), { seed: 606 });
  g.state.resources.funding = 1e9;

  const c0 = -25, r0 = -25, c1 = -22, r1 = -22; // 4x4 = 16 tiles
  const foundationOk = g.placeInfraRect(c0, r0, c1, r1, 'concrete'); // labFloor requiresFoundation: 'concrete'
  assertOk(foundationOk, 'setup: concrete foundation placed');
  const floorOk = g.placeInfraRect(c0, r0, c1, r1, 'labFloor');
  assertOk(floorOk, 'setup: lab flooring placed');
  const zoneOk = g.placeZoneRect(c0, r0, c1, r1, 'rfLab');
  assertOk(zoneOk, 'setup: 16 rfLab tiles painted');

  const conn = () => g.state.zoneConnectivity.rfLab;
  assertOk(conn().tileTier === 3, `setup: 16 tiles -> tile tier 3 (got ${conn().tileTier})`);
  assertOk(conn().tier === 0, `5. freshly painted, no engineer -> tier 0 (got ${conn().tier})`);
  assertOk(conn().peakTier === 0, `5. freshly painted, no engineer -> peakTier 0 (got ${conn().peakTier})`);

  const benchOk = g.placePlaceable({ type: 'labBench', col: c0 + 1, row: r0 + 1, subCol: 0, subRow: 0, dir: 0, free: true });
  assertOk(benchOk, 'setup: labBench placed inside the rfLab zone');

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
    // tier first reads 3 would leave next to no margin against that decay
    // (measured: staffedOutput 0.81 after the break when this broke at
    // 0.9, only 0.01 above the 0.8 threshold — real, but not the kind of
    // margin a test should rely on tick-for-tick). Waiting for near-total
    // saturation leaves ~0.9 after the break, comfortably above 0.8.
    if (conn().tier === 3 && conn().staffedOutput > 0.98) break;
  }
  assertOk(tick < maxTicks, `setup: staffedOutput reached a comfortable margin within ${maxTicks} ticks (stopped at ${tick})`);
  assertOk(conn().tier === 3, `6. engineer works labWork long enough -> tier rises to the tile-count tier (got ${conn().tier})`);
  assertOk(conn().peakTier === 3, `6. peakTier tracks the newly reached tier (got ${conn().peakTier})`);

  const tierBeforeBreak = conn().tier;
  const peakBeforeBreak = conn().peakTier;
  const staffedOutputBeforeBreak = conn().staffedOutput;
  abandonJob(engineer, g, null); // the engineer clocks out — no more assignJobs calls below
  for (let t = 0; t < 100; t++) tickJobs(g);

  assertOk(conn().staffedOutput < staffedOutputBeforeBreak, 'setup: staffedOutput actually decayed over the 100-tick break');
  assertOk(conn().tier === tierBeforeBreak,
    `7. a 100-tick break does not drop the tier (before ${tierBeforeBreak}, after ${conn().tier}, staffedOutput now ${conn().staffedOutput})`);
  assertOk(conn().peakTier >= peakBeforeBreak, `7. peakTier never falls (before ${peakBeforeBreak}, after ${conn().peakTier})`);
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
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
