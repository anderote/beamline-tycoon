// test/test-job-runner.js — job assignment and the work state machine
// (src/game/staff/jobRunner.js). Task 2 of the staff-professions-3
// (jobs-and-gates) plan.
//
// Same lightweight-fixture style as test-job-board.js/test-staff-stations.js:
// hand-built states shaped like Game.state, plus a fake `game`
// ({ state, registry: { getAll() } }) — no real Game instance. Helpers below
// duplicate a few of test-job-board.js's (placeItem/floorRect/bump/makeGame/
// placeSourceBeamline) rather than importing them, since jobs.js and
// test-job-board.js are off-limits to this task (another agent owns them).
//
// Real StaffMember instances are used throughout (not plain object
// literals) — this task needs .efficiency()/.needs/.status/.job, which
// eligibleFor's own fixtures don't exercise. Every member gets the same
// flat skills object so efficiency() is a known, deterministic constant:
// primary skill 5, zoneTier 0 -> efficiency = (5/5) * 0.5 * 1 = 0.5/tick.

import { StaffMember } from '../src/game/staff/StaffMember.js';
import { tickStaffMember } from '../src/game/staff/staffSystem.js';
import { JOB_TYPES } from '../src/game/staff/jobs.js';
import {
  assignJobs, tickJobs, abandonJob, registerJobEffect,
} from '../src/game/staff/jobRunner.js';
import {
  reserveStation, releaseAllFor, sanitizeStationReservations,
} from '../src/game/staff/stations.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// --- Fixture helpers (see header comment) -----------------------------

function makeState() {
  return {
    infraOccupied: {},
    wallOccupied: {},
    doorOccupied: {},
    subgridOccupied: {},
    placeableIndex: {},
    placeables: [],
    zoneOccupied: {},
    stationReservations: {},
    staffMembers: [],
    resources: { funding: 0, reputation: 0, data: 0, spares: 5 },
    zoneConnectivity: {},
    navRevision: 0,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      state.infraOccupied[`${c},${r}`] = type;
    }
  }
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

// Mirrors what Game.js's demolish path does to the pieces jobRunner reads:
// drop the placeable, its subgrid claims, and bump navRevision so
// getStationIndex rebuilds without it.
function demolish(state, id) {
  const idx = state.placeableIndex[id];
  const entry = state.placeables[idx];
  state.placeables.splice(idx, 1);
  // Re-index everything (cheap for a handful of fixture placeables) rather
  // than patching indices >= idx — simplest correct thing here.
  state.placeableIndex = {};
  state.placeables.forEach((p, i) => { state.placeableIndex[p.id] = i; });
  for (const key of Object.keys(state.subgridOccupied)) {
    if (state.subgridOccupied[key].id === id) delete state.subgridOccupied[key];
  }
  bump(state);
  return entry;
}

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }

function makeGame(state, beamlines = []) {
  return { state, registry: { getAll: () => beamlines } };
}

// A real 4x4-subtile 'source' module, registered as its own beamline with a
// seeded componentHealth for that one node — same convention as
// test-job-board.js's placeSourceBeamline.
function placeDamagedBeamline(state, beamlineId, col, row, health) {
  const src = placeItem(state, 'source', col, row, 0, 0, 0);
  bump(state);
  return { id: beamlineId, sourceId: src.id, beamState: { componentHealth: { [src.id]: health } } };
}

const FLAT_SKILLS = { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 };

function makeMember(profession, id) {
  return new StaffMember({
    id, profession, traits: [], skills: { ...FLAT_SKILLS }, rng: () => 0.5,
  });
}

// Simulate the renderer reporting arrival (see jobRunner.js's header
// comment: only the renderer is supposed to flip this in the real game;
// this test stands in for it).
function arrive(member) { if (member.job) member.job.phase = 'work'; }

// One "Game.tick()"-shaped step for the deadlock-guard scenario: needs
// first (staffSystem.tickStaffMember), then the runner — the same order
// Game.js now wires at its needs loop.
function simTick(game, member) {
  tickStaffMember(member, { isNight: false, cafeteriaTier: 0, zoneTier: 0, rng: () => 0.5 });
  assignJobs(game);
  tickJobs(game);
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. Idle operator -> assigned runBeam, holds the reservation, reaches phase: work on arrival ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  state.staffMembers = [operator];

  assignJobs(game);
  assertOk(operator.job !== null, 'operator was assigned a job');
  assertOk(operator.job?.jobType === 'runBeam', `job type is runBeam (got ${operator.job?.jobType})`);
  assertOk(operator.job?.phase === 'travel', "a freshly-assigned job starts in phase 'travel'");
  assertOk(typeof operator.job?.stationKey === 'string', 'the job carries the console\'s stationKey');
  assertOk(state.stationReservations[operator.job.stationKey] === operator.id,
    'the console is reserved for this operator');
  assertOk(operator.idleReason === null, 'idleReason is cleared on assignment');

  arrive(operator);
  assertOk(operator.job.phase === 'work', "arrival (renderer-reported) flips phase to 'work'");

  const before = operator.job.progress;
  tickJobs(game);
  assertOk(operator.job.progress > before, 'work phase accrues progress (efficiency=0.5/tick)');
  assertOk(operator.job.jobType === 'runBeam', 'runBeam is open-ended (workTicks: null) — still assigned after ticking');
  assertOk(state.stationReservations[operator.job.stationKey] === operator.id,
    'the reservation is still held while the job continues');
  void console_;
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Finite job (repair) completes after workTicks/efficiency ticks, firing onJobComplete exactly once ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 40);
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  let completions = 0;
  let lastJob = null;
  registerJobEffect('repair', (g, m, job) => { completions++; lastJob = job; });

  assignJobs(game);
  assertOk(technician.job?.jobType === 'repair', `technician was assigned repair (got ${technician.job?.jobType})`);
  arrive(technician);

  const efficiency = technician.efficiency(0, technician.job.specialty);
  const workTicks = JOB_TYPES.repair.workTicks;
  const expectedTicks = Math.ceil(workTicks / efficiency);

  let completedAtTick = -1;
  for (let t = 0; t < expectedTicks + 5 && completedAtTick < 0; t++) {
    tickJobs(game);
    if (technician.job === null) completedAtTick = t;
  }
  assertOk(completedAtTick >= 0, `the repair job completed within ${expectedTicks + 5} ticks (at tick ${completedAtTick})`);
  assertOk(completions === 1, `onJobComplete fired for 'repair' exactly once (got ${completions})`);
  assertOk(lastJob?.jobType === 'repair', 'the completion handler received the repair job');
  assertOk(technician.job === null, 'the job is cleared on completion');
  assertOk(technician.idleReason === null, 'completion clears idleReason to null (not an interruption reason)');

  // Ticking further does not fire the handler again.
  for (let t = 0; t < 10; t++) tickJobs(game);
  assertOk(completions === 1, 'ticking a jobless member does not re-fire the completion handler');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Demolishing the station mid-job abandons it and releases the reservation ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  state.staffMembers = [operator];
  assignJobs(game);
  const key = operator.job.stationKey;
  assertOk(state.stationReservations[key] === operator.id, 'setup: console reserved');
  arrive(operator);

  demolish(state, console_.id);
  tickJobs(game);

  assertOk(operator.job === null, 'the job is abandoned once its station is demolished');
  assertOk(!state.stationReservations[key], 'the reservation is released');
  assertOk(!!operator.idleReason, 'idleReason explains why (non-empty)');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Firing a staffer mid-job releases the reservation (via releaseAllFor, same as Game.js) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  state.staffMembers = [operator];
  assignJobs(game);
  const key = operator.job.stationKey;
  assertOk(state.stationReservations[key] === operator.id, 'setup: console reserved');

  // Game.fireStaffMember splices the roster and calls releaseAllFor — this
  // task must not duplicate that call (see task-2-brief.md), just coexist
  // with it: the member's own job object is simply discarded along with
  // the member (no live object left to clear).
  state.staffMembers = state.staffMembers.filter(m => m.id !== operator.id);
  releaseAllFor(state, operator.id);

  assertOk(!state.stationReservations[key], 'the reservation is released once the staffer is fired');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. A member crossing the hunger threshold abandons work and takes eat ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  placeItem(state, 'labBench', 5, 5, 0, 0, 0);
  state.zoneOccupied['5,5'] = 'rfLab';
  const table = placeItem(state, 'diningTable', 8, 8, 0, 0, 0);
  placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
  bump(state);
  const game = makeGame(state, []);

  const engineer = makeMember('engineer', 'e1');
  engineer.specialty = 'rf';
  engineer.fromNode = { col: 5, row: 6, subCol: 0, subRow: 0 }; // open floor just south of the bench's own footprint
  state.staffMembers = [engineer];

  assignJobs(game);
  assertOk(engineer.job?.jobType === 'labWork', `setup: engineer starts on labWork (got ${engineer.job?.jobType})`);
  const oldKey = engineer.job.stationKey;
  arrive(engineer);

  engineer.needs.hunger = 0.85;
  engineer.fromNode = { col: 5, row: 6, subCol: 0, subRow: 0 }; // open floor just south of the bench's own footprint
  assignJobs(game);

  assertOk(engineer.job?.jobType === 'eat', `crossing the hunger threshold switches the member to 'eat' (got ${engineer.job?.jobType})`);
  assertOk(!state.stationReservations[oldKey], 'the abandoned labWork station is released');
  assertOk(state.stationReservations[engineer.job.stationKey] === engineer.id, 'the eat station is now reserved for this member');
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Deadlock guard: no cafeteria anywhere -> a hungry operator keeps working, recovers slowly, never goes permanently jobless (500 ticks) ===\n");
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  // Deliberately no diningTable/toolChest/workCart anywhere in this facility.
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  state.staffMembers = [operator];

  assignJobs(game);
  assertOk(operator.job?.jobType === 'runBeam', 'setup: operator starts on runBeam');
  arrive(operator);

  let sawMissingCafeteriaReason = false;
  let everJobless = false;
  for (let t = 0; t < 500; t++) {
    simTick(game, operator);
    if (operator.job === null) everJobless = true;
    if (/cafeteria/i.test(operator.idleReason || '')) sawMissingCafeteriaReason = true;
    if (operator.job) arrive(operator); // stay in 'work' phase in this headless sim
  }

  assertOk(!everJobless, 'the operator was never left with job === null at any point in 500 ticks');
  assertOk(operator.job?.jobType === 'runBeam', `still doing runBeam after 500 ticks (got ${operator.job?.jobType})`);
  assertOk(operator.job?.phase === 'work', 'still in phase work after 500 ticks');
  assertOk(sawMissingCafeteriaReason, 'idleReason named the missing cafeteria at some point');
  assertOk(operator.needs.hunger < 0.95, `hunger recovers instead of pegging at 1 (got ${operator.needs.hunger.toFixed(3)})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. Every member without a job has a non-empty idleReason ===\n');
{
  const state = makeState();
  floorRect(state, 0, 4, 0, 4);
  const game = makeGame(state, []);

  const admin = makeMember('admin', 'a1'); // nothing to do: empty world, no offers
  const resting = makeMember('technician', 'r1');
  resting.status = 'resting';
  state.staffMembers = [admin, resting];

  assignJobs(game);
  for (const m of state.staffMembers) {
    if (m.job == null) {
      assertOk(!!m.idleReason, `${m.id} has no job but a non-empty idleReason (got ${JSON.stringify(m.idleReason)})`);
    }
  }
  assertOk(admin.job === null && !!admin.idleReason, 'admin with nothing to do gets an idleReason');
  assertOk(resting.job === null && !!resting.idleReason, 'a resting (breakdown) member also gets an idleReason, not left blank');
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. serialize() -> deserialize() round-trips job; a reservation whose holder no longer exists is dropped on load ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  state.staffMembers = [operator];
  assignJobs(game);
  arrive(operator);
  tickJobs(game);

  const round = StaffMember.fromJSON(operator.toJSON());
  assertOk(round.job !== null, 'job survives toJSON/fromJSON');
  assertOk(round.job.jobType === operator.job.jobType, 'jobType round-trips');
  assertOk(round.job.phase === operator.job.phase, 'phase round-trips');
  assertOk(round.job.stationKey === operator.job.stationKey, 'stationKey round-trips');
  assertOk(round.job.progress === operator.job.progress, 'progress round-trips');
  assertOk(round.idleReason === operator.idleReason, 'idleReason round-trips');

  // "a reservation whose holder no longer exists is dropped on load":
  // simulate a save where the reserving staffer was removed from the
  // roster before/without releasing their slot (a corrupt or hand-edited
  // save) — sanitizeStationReservations (stations.js), called from Game's
  // own load path, is what load-time correctness relies on.
  const key = operator.job.stationKey;
  assertOk(!!state.stationReservations[key], 'setup: the reservation exists pre-load');
  state.staffMembers = []; // the holder "no longer exists"
  sanitizeStationReservations(state);
  assertOk(!state.stationReservations[key], 'the orphaned reservation is dropped on load');
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. runBeam cap: at most beamlineCount operators hold runBeam at once, even with more free consoles ===\n");
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 4);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'monitorBank', 6, 2, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]); // ONE beamline, two free consoles

  const opA = makeMember('operator', 'opA');
  const opB = makeMember('operator', 'opB');
  state.staffMembers = [opA, opB];

  assignJobs(game);
  const runBeamHolders = state.staffMembers.filter(m => m.job?.jobType === 'runBeam');
  assertOk(runBeamHolders.length === 1, `exactly 1 operator holds runBeam with 1 beamline (got ${runBeamHolders.length})`);
  const surplus = state.staffMembers.find(m => m.job?.jobType !== 'runBeam');
  assertOk(!!surplus, 'sanity: one operator was left without runBeam');
  assertOk(surplus.job === null, 'the surplus operator was not assigned anything else instead');
  assertOk(/beamline/i.test(surplus.idleReason || ''), `the surplus operator's idleReason names the beamline shortage, not consoles (got "${surplus.idleReason}")`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. repair cap: at most state.resources.spares technicians hold repair at once, even with more damaged components ===\n');
{
  const state = makeState();
  floorRect(state, 0, 30, 0, 10);
  const bl1 = placeDamagedBeamline(state, 'bl-1', 4, 4, 40);
  const bl2 = placeDamagedBeamline(state, 'bl-2', 12, 4, 40);
  const bl3 = placeDamagedBeamline(state, 'bl-3', 20, 4, 40);
  state.resources.spares = 1;
  const game = makeGame(state, [bl1, bl2, bl3]);

  const t1 = makeMember('technician', 't1');
  const t2 = makeMember('technician', 't2');
  const t3 = makeMember('technician', 't3');
  state.staffMembers = [t1, t2, t3];

  assignJobs(game);
  const repairHolders = state.staffMembers.filter(m => m.job?.jobType === 'repair');
  assertOk(repairHolders.length === 1, `exactly 1 technician holds repair with 1 spare (got ${repairHolders.length})`);
  const idleTechs = state.staffMembers.filter(m => m.job === null);
  assertOk(idleTechs.length === 2, `the other 2 technicians are left without a job (got ${idleTechs.length})`);
  for (const m of idleTechs) {
    assertOk(/spares/i.test(m.idleReason || ''), `${m.id}'s idleReason names the spares shortage (got "${m.idleReason}")`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 11. abandonJob is the single choke point: releases the station, clears job, sets idleReason ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  state.staffMembers = [operator];
  assignJobs(game);
  const key = operator.job.stationKey;

  abandonJob(operator, game, 'test abandonment');
  assertOk(operator.job === null, 'job is cleared');
  assertOk(operator.idleReason === 'test abandonment', 'idleReason is set to the given reason');
  assertOk(!state.stationReservations[key], 'the station reservation is released');

  // Calling it again (no job held) must not throw.
  let threw = false;
  try { abandonJob(operator, game, 'again'); } catch (e) { threw = true; }
  assertOk(!threw, 'abandoning a member with no job does not throw');
  assertOk(operator.idleReason === 'again', 'idleReason still updates even with no job to release');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
