// test/test-beam-staffing-gate.js — the beam gate moves to seated operators
// (src/game/utility-gate.js: operatorCoverage, _unstaffedMessage, the
// beam_unstaffed blocker condition).
//
// Task 4 of the staff-professions-3 (jobs-and-gates) plan. The OLD gate
// asked "does ANY working operator exist anywhere in the facility" (plus a
// hidden mood==='stressed' && rng() < 0.3 coin flip). The new gate asks "is
// there an operator actually SEATED AT A CONSOLE, phase:'work' on a runBeam
// job, with enough combined coverage for how many beamlines this facility
// has" — deterministically, no rng anywhere.
//
// Scenarios (see task-4-brief.md's own list):
//   1. No operator at all -> blocked, message names hiring.
//   2. Operator hired, no Operator Console anywhere -> blocked, message
//      names the console.
//   3. Operator seated and working, one beamline -> not blocked.
//   4a. Two beamlines, one console fully staffed by a green operator ->
//      blocked, message points at building another CONSOLE, not hiring.
//   4b. Three beamlines, two consoles, one skilled operator (capacity 2 !=
//      headcount 1) -> blocked, message reports headcount and coverage as
//      two distinct numbers ("1 operator covers 2 of 3 beamlines"), and
//      points at hiring/promoting since a free console exists.
//   5. Two beamlines, one operator with skills.operating >= 4 (coverage 2)
//      -> not blocked.
//   6. Operator's runBeam job is still phase:'travel' -> blocked, message
//      says they're on the way (not an error).
//   7. Operator eating/resting (the modern equivalent of the deleted
//      onBreak status) -> blocked, message names the break.
//   8. A real Operator Console sealed in a walled room with no door,
//      operator's fromNode outside it -> blocked, message names
//      reachability.
//   9. Determinism: the same state run through the gate twice (or many
//      times) produces byte-identical blockers — no Math.random anywhere in
//      the staffing path.
//   10. A resting (stress-breakdown) operator contributes zero coverage,
//      same as eating/resting-on-a-job.
//   11. beamHours accrues once per in-game hour, deduped across multiple
//      run() calls on the same tick (repeated toggleBeam while paused).
//   12. beamHours does not accrue while blocked by an unrelated hard fault.
//   13. beamHours stays flat over 300 ticks when the facility is fully
//      staffed but the beam was never started (state.beamOn false) —
//      fix-round-2's own finding.

import { UtilityGate, operatorCoverage } from '../src/game/utility-gate.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixture plumbing — mirrors test-staff-stations.js / test-staff-nav.js's
// own hand-built-state pattern (plain objects shaped like Game.state, not a
// full Game instance).
// ---------------------------------------------------------------------------

function makeState(extra = {}) {
  return {
    tick: 0,
    infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeableIndex: {}, placeables: [], zoneOccupied: {},
    stationReservations: {}, staffMembers: [], navRevision: 0,
    beamPipes: [], utilityLines: new Map(),
    infraBlockers: [], infraCanRun: true,
    ...extra,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) state.infraOccupied[`${c},${r}`] = type;
  }
}

// Walls the full perimeter of tile rectangle [c0,c1]x[r0,r1] — no door, so
// nothing inside is reachable from outside it. Same edge convention
// test-staff-nav.js's own sealed-chamber scenario uses.
function wallPerimeter(state, c0, c1, r0, r1) {
  const wall = (col, row, edge) => { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; };
  for (let c = c0; c <= c1; c++) { wall(c, r0, 'n'); wall(c, r1, 's'); }
  for (let r = r0; r <= r1; r++) { wall(c0, r, 'w'); wall(c1, r, 'e'); }
}

let _nextId = 1;
function placeItem(state, type, col, row, subCol = 0, subRow = 0, dir = 0) {
  const def = PLACEABLES[type];
  const id = `${type}_${_nextId++}`;
  const cells = def.footprintCells(col, row, subCol, subRow, dir);
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

// A "beamline" for operatorCoverage's purposes: one source junction. Real
// component id ('source' — beamline-components.raw.js, isSource:true), but
// pushed as a bare record — no footprint/nav machinery needed since
// countBeamlines only reads `.type`.
function addBeamline(state, id) {
  state.placeables.push({ id, type: 'source', category: 'beamline' });
}

function makeOperator(overrides = {}) {
  return {
    id: overrides.id || 'op1',
    profession: 'operator',
    status: 'working',
    mood: 'content',
    skills: { operating: 0 },
    needs: { fatigue: 0.1, hunger: 0.1, morale: 0.6 },
    stats: {},
    job: null,
    ...overrides,
  };
}

const noopSolveRunner = { runSolve: () => ({ errors: [] }) };
const noopPorts = () => ({});

function makeGate(state) {
  return new UtilityGate({ state, solveRunner: noopSolveRunner, getPorts: noopPorts, rng: () => 0.99 });
}

function beamUnstaffed(state) {
  return (state.infraBlockers || []).find(b => b.code === 'beam_unstaffed');
}

// ==========================================================================
// 1. No operator at all.
// ==========================================================================
console.log('\n=== 1. No operator hired -> blocked, names hiring ===\n');
{
  const state = makeState();
  addBeamline(state, 'bl1');
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires with zero operators');
  assert(state.infraCanRun === false, 'infraCanRun false');
  assert(/hire/i.test(b?.message || ''), `message names hiring (got "${b?.message}")`);
}

// ==========================================================================
// 2. Operator hired, no console anywhere.
// ==========================================================================
console.log('\n=== 2. Operator hired but no console -> blocked, names the console ===\n');
{
  const state = makeState({ staffMembers: [makeOperator()] });
  addBeamline(state, 'bl1');
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires with no console built');
  assert(/console/i.test(b?.message || ''), `message names the console (got "${b?.message}")`);
}

// ==========================================================================
// 3. Operator seated and working, one beamline -> not blocked.
// ==========================================================================
console.log('\n=== 3. Operator seated + working, one beamline -> not blocked ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  assert(!beamUnstaffed(state), `no beam_unstaffed blocker (blockers: ${state.infraBlockers.map(b => b.code).join(',')})`);
  assert(state.infraCanRun === true, 'infraCanRun true');

  const cov = operatorCoverage(state);
  assert(cov.covered === true, 'operatorCoverage reports covered');
  assert(cov.capacity === 1, `a green operator's coverage is 1 (got ${cov.capacity})`);
}

// ==========================================================================
// 4a/4b. Two flavors of "seated but short": every console already full
// (build another one — hiring is wasted salary) vs. a free console sitting
// empty (hiring/promoting genuinely helps). Fix-round-1: the old single
// "capacity shortfall" branch conflated these, and separately reported
// CAPACITY (coverage) as if it were a headcount — "2 operators cover 3
// beamlines" printed even with exactly one operator on the roster (a
// skilled or tier-boosted one). 4b exercises exactly that: one operator,
// capacity 2, must read "1 operator covers 2 of 3 beamlines", not
// "2 operators cover...".
// ==========================================================================
console.log('\n=== 4a. Two beamlines, one console fully staffed by a green operator -> console-constrained ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  const op = makeOperator({
    skills: { operating: 0 },
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires: 1 unit of coverage against 2 beamlines');
  assert(/console/i.test(b?.message || ''), `message names the console, not hiring (got "${b?.message}")`);
  assert(!/hire another or promote/i.test(b?.message || ''),
    `message does NOT tell the player to hire (a wasted-salary answer here) (got "${b?.message}")`);
}

console.log('\n=== 4b. Three beamlines, two consoles, one skilled operator (capacity 2) -> headcount != coverage ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console1 = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'operatorConsole', 2, 6, 0, 0, 0); // a second, FREE console
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  addBeamline(state, 'bl3');
  const op = makeOperator({
    skills: { operating: 4 }, // coverage 2 — capacity != headcount (1)
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console1.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  const cov = operatorCoverage(state);
  assert(cov.capacity === 2, `1 + floor(4/4) = 2 (got ${cov.capacity})`);
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires: 2 units of coverage against 3 beamlines, a free console available');
  assert(/hire another or promote/i.test(b?.message || ''),
    `a free console exists — the answer IS hiring/promoting (got "${b?.message}")`);
  assert(/\b1\s+operator\b/i.test(b?.message || ''),
    `headcount is reported as 1 (one operator), not as the capacity number (got "${b?.message}")`);
  assert(/\b2\b/.test(b?.message || '') && /\b3\b/.test(b?.message || ''),
    `message names both the coverage (2) and beamline count (3) (got "${b?.message}")`);
}

console.log('\n=== 5. Two beamlines, one operator with operating>=4 -> not blocked ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  const op = makeOperator({
    skills: { operating: 4 },
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  const cov = operatorCoverage(state);
  assert(cov.capacity === 2, `1 + floor(4/4) = 2 (got ${cov.capacity})`);
  makeGate(state).run();
  assert(!beamUnstaffed(state), `no beam_unstaffed blocker (blockers: ${state.infraBlockers.map(b => b.code).join(',')})`);
  assert(state.infraCanRun === true, 'infraCanRun true');
}

// ==========================================================================
// 6. Operator's runBeam job is still phase:'travel'.
// ==========================================================================
console.log("\n=== 6. Operator in phase:'travel' -> blocked, says on the way ===\n");
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    fromNode: { col: 0, row: 0, subCol: 0, subRow: 0 },
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'travel', progress: 0,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires while still travelling');
  assert(/on (the |their )?way/i.test(b?.message || ''), `message says they're on the way (got "${b?.message}")`);
  assert(!/error/i.test(b?.message || ''), 'message does not read as an error');
}

// ==========================================================================
// 7. Operator eating/resting — the modern equivalent of the deleted onBreak
// status (task-4-brief.md's carry-forward item 1/2).
// ==========================================================================
console.log('\n=== 7. Operator eating/resting -> blocked, names the break ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    needs: { fatigue: 0.1, hunger: 0.9, morale: 0.5 },
    job: {
      jobType: 'eat', target: null, specialty: null,
      stationKey: 'cafeteria1:0', destNode: { col: 0, row: 0, subCol: 0, subRow: 0 },
      phase: 'work', progress: 10,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires while the only operator eats');
  assert(/eat|break|rest/i.test(b?.message || ''), `message names the break (got "${b?.message}")`);

  // An operator on an eat/rest job does NOT count as active coverage — this
  // is the deliberate behavior change from the old status==='working' check
  // (see task-4-brief.md's carry-forward item 2).
  const cov = operatorCoverage(state);
  assert(cov.capacity === 0, 'an eating operator contributes zero coverage');
}

// ==========================================================================
// 8. A real console, sealed in a walled room with no door.
// ==========================================================================
console.log('\n=== 8. Console walled off with no door -> blocked, names reachability ===\n');
{
  const state = makeState();
  // A 4x4 sealed chamber (cols 0-3, rows 0-3), no door anywhere on its
  // perimeter. Operator console anchored inside it; its work node
  // ({col:1,row:0,subCol:1,subRow:3} — hand-derived the same way
  // test-staff-stations.js's own scenario 1 derives it) lands inside the
  // chamber too.
  floorRect(state, 0, 8, 0, 8);
  wallPerimeter(state, 0, 3, 0, 3);
  placeItem(state, 'operatorConsole', 1, 1, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    fromNode: { col: 6, row: 1, subCol: 0, subRow: 0 }, // well outside the sealed chamber
    job: null,
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires: console exists but nothing can reach it');
  assert(/reach/i.test(b?.message || ''), `message names reachability (got "${b?.message}")`);
}

// ==========================================================================
// 9. Determinism — no Math.random anywhere in the staffing path.
// ==========================================================================
console.log('\n=== 9. Determinism: identical blockers on repeated runs ===\n');
{
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return originalRandom(); };
  try {
    const state = makeState({ staffMembers: [makeOperator()] });
    addBeamline(state, 'bl1');
    addBeamline(state, 'bl2');
    const gate = makeGate(state);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      gate.run();
      runs.push(JSON.stringify(state.infraBlockers.map(b => ({ code: b.code, message: b.message }))));
    }
    assert(runs.every(r => r === runs[0]), 'five runs of the same state produce byte-identical blockers');
    assert(calls === 0, `the staffing gate never calls Math.random (calls: ${calls})`);
  } finally {
    Math.random = originalRandom;
  }
}

// ==========================================================================
// 10. A stress-breakdown operator (status !== 'working') does not count as
// coverage — fix-round-1: operatorCoverage used to read only job.jobType/
// phase, so a `runBeam`/`work` job left dangling through a breakdown still
// scored full coverage while an eating/resting-on-a-JOB operator scored
// zero for the same "not actually at the console" fact.
// ==========================================================================
console.log("\n=== 10. Operator status:'resting' (stress breakdown) -> zero coverage ===\n");
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    status: 'resting',
    job: {
      // Stale job, left over from before the breakdown — nothing abandons
      // it on this path, which is exactly the inconsistency being pinned.
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  const cov = operatorCoverage(state);
  assert(cov.capacity === 0, `a resting operator contributes zero coverage despite job:runBeam/work (got ${cov.capacity})`);
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires while the only operator is resting off a breakdown');
  assert(/breakdown|resting|recover/i.test(b?.message || ''), `message names the breakdown (got "${b?.message}")`);
}

// ==========================================================================
// 11. beamHours accrues once per in-game hour, deduped even when run() is
// called more than once on the same tick (toggleBeam -> refreshInfra-
// structureGate -> run(), possibly several times while paused).
// ==========================================================================
console.log('\n=== 11. beamHours: deduped per tick, not per run() call ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  // Real Game.js sets state.beamOn from _updateAggregateBeamline
  // (entry.status==='running' && infraCanRun), computed earlier in
  // Game.tick() than this gate re-derives infraCanRun for the CURRENT tick
  // — see run()'s own comment on why accrual gates on it and why that's a
  // deliberate, pre-existing one-tick lag rather than fresh registry access
  // this headless gate doesn't have. Set directly here since nothing else
  // in this hand-built state computes it.
  state.beamOn = true;
  state.tick = 10; // a multiple of DAY_LENGTH_TICKS/24 (240/24 = 10) — an accrual tick
  const gate = makeGate(state);
  for (let i = 0; i < 10; i++) gate.run(); // simulates toggling off/on repeatedly while paused
  assert(op.stats.beamHours === 1,
    `ten run() calls on the SAME tick accrue exactly once (got ${op.stats.beamHours})`);

  state.tick = 20; // the next accrual tick
  gate.run();
  assert(op.stats.beamHours === 2, `a later accrual tick accrues again (got ${op.stats.beamHours})`);
}

// ==========================================================================
// 12. beamHours does not accrue while the beam is provably blocked by an
// UNRELATED hard fault (not staffing) — a seated operator sitting at a
// console with, say, the power cut is not "running the beam".
// ==========================================================================
console.log('\n=== 12. beamHours: no accrual while blocked by an unrelated fault ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  const faultySolveRunner = {
    runSolve: () => ({
      errors: [{ severity: 'hard', code: 'power_unconnected', message: 'unrelated fault', location: {} }],
    }),
  };
  const gate = new UtilityGate({ state, solveRunner: faultySolveRunner, getPorts: noopPorts });
  for (let t = 0; t <= 60; t += 10) { state.tick = t; gate.run(); }
  assert(state.infraCanRun === false, 'setup: the facility is genuinely blocked (unrelated fault)');
  assert((op.stats.beamHours || 0) === 0,
    `a seated operator banks zero beamHours while an unrelated fault blocks the facility (got ${op.stats.beamHours})`);
}

// ==========================================================================
// 13. beamHours stays flat over a real run when the facility is fully
// STAFFED (covered) but the beam was never started — fix-round-2's own
// finding: the accrual guard used to check infraCanRun only, and widening
// the runBeam cap to registered (not running) beamlines made "seated but
// never toggled on" reachable for the first time.
// ==========================================================================
console.log('\n=== 13. beamHours: flat over 300 ticks, staffed but beam never started ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  // state.beamOn deliberately left unset (falsy) — no entry is 'running',
  // matching a facility whose registered beamline was built but never
  // toggled on. Coverage is nonetheless full: the operator is seated,
  // phase:'work'.
  const gate = makeGate(state);
  for (let t = 0; t <= 300; t += 10) { state.tick = t; gate.run(); }
  const cov = operatorCoverage(state);
  assert(cov.covered === true, 'setup: the facility is fully covered (staffed)');
  assert(!beamUnstaffed(state), 'setup: no beam_unstaffed blocker — staffing is not the problem here');
  assert((op.stats.beamHours || 0) === 0,
    `beamHours stays at 0 over 300 ticks of a staffed-but-never-started facility (got ${op.stats.beamHours})`);
}

// ==========================================================================
// 14. Balance fix round 3/4: an operator carrying unservicedPenalty (jobRunner.
// js's deadlock-guard flag) contributes capacity 1 FLAT, never the skill-
// scaled 1 + floor(skill/4) + tierBonus a serviced operator of the same skill
// would be worth — and never 0 either (the deadlock guard's own guarantee,
// expressed one layer up through this gate). Nothing asserted this before
// round 4: reverting `if (m.unservicedPenalty) return sum + 1;` in
// operatorCoverage left this whole suite green.
// ==========================================================================
console.log('\n=== 14. Balance fix round 3/4: unservicedPenalty caps operator coverage at 1, never scaling with skill and never zeroing ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  addBeamline(state, 'bl3');
  // Max skill: 1 + floor(10/4) = 3, the exact number this test proves
  // unservicedPenalty overrides.
  const op = makeOperator({
    skills: { operating: 10 },
    unservicedPenalty: true,
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];

  let cov = operatorCoverage(state);
  assert(cov.capacity === 1, `unserviced max-skill operator contributes capacity 1, not 1+floor(10/4)=3 (got ${cov.capacity})`);
  makeGate(state).run();
  assert(!!beamUnstaffed(state), '3 beamlines against capacity 1 correctly blocks (proves the cap is really 1, not silently still 3)');

  // The floor: capacity is 1, never 0, for the SAME operator against a
  // single beamline — the deadlock guard's "never permanently unstaffed"
  // guarantee surviving through this gate.
  state.placeables = state.placeables.filter(p => p.category !== 'beamline');
  addBeamline(state, 'bl1');
  cov = operatorCoverage(state);
  assert(cov.capacity === 1, `still capacity 1 against one beamline (got ${cov.capacity})`);
  makeGate(state).run();
  assert(!beamUnstaffed(state), 'one beamline against capacity 1 is covered — an unserviced operator can still run a beamline solo');

  // And a SERVICED operator of the same skill is unaffected — this cap only
  // ever engages for the flag, never as a side effect of anything else.
  op.unservicedPenalty = false;
  cov = operatorCoverage(state);
  assert(cov.capacity === 3, `serviced, the same operator is worth the full 1+floor(10/4)=3 again (got ${cov.capacity})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
