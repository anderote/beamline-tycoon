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
  reserveStation, releaseAllFor, sanitizeStationReservations, getStationIndex,
} from '../src/game/staff/stations.js';
import { getNavGrid, findPath } from '../src/game/staff/nav.js';
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

function wall(state, col, row, edge) { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; }

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

// A registered beamline's registry entry (the `{ id, sourceId, status,
// beamState }` shape most scenarios below build by hand) needs a matching
// isSource PLACEABLE for jobRunner's runBeam cap to count it: fix-round-2
// made that cap call utility-gate.js's exported countBeamlines(state)
// directly (one implementation shared with operatorCoverage, instead of two
// that happened to agree — see jobRunner.js's own comment on beamlineCount),
// which counts isSource placeables, not registry entries. A bare record is
// enough — countBeamlines only reads `.type`, so this doesn't need the full
// footprint/nav machinery placeDamagedBeamline's real 'source' module gets.
let _srcPlaceableNextId = 1;
function addSourcePlaceable(state) {
  state.placeables.push({ id: `srcplaceable_${_srcPlaceableNextId++}`, type: 'source', category: 'beamline' });
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
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addSourcePlaceable(state); // matches the registry entry below — see that helper's own comment
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
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
  addSourcePlaceable(state);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
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
console.log('\n=== 3b. C1: an ordinary build action (closing a door) that seals off a station mid-travel abandons the job and releases the reservation — "path lost", the fourth abandon trigger ===\n');
{
  // Sealed-chamber geometry, same technique test-job-board.js's own
  // sealChamber uses: two columns (0-1) walled on every side except a door
  // at (1,1,'e'); cols 2-4 are open floor OUTSIDE the chamber. The dining
  // table lives INSIDE the chamber; the operator starts outside it, able to
  // reach the table only through the door — until the player deletes the
  // door (an ordinary build action, not a demolition of the table itself).
  const state = makeState();
  floorRect(state, 0, 4, 0, 2);
  wall(state, 0, 0, 'n'); wall(state, 1, 0, 'n');
  wall(state, 0, 2, 's'); wall(state, 1, 2, 's');
  wall(state, 0, 0, 'w'); wall(state, 0, 1, 'w'); wall(state, 0, 2, 'w');
  wall(state, 1, 0, 'e'); wall(state, 1, 1, 'e'); wall(state, 1, 2, 'e'); // the bisecting wall
  state.doorOccupied['1,1,e'] = 'officeDoor'; // starts OPEN

  const table = placeItem(state, 'diningTable', 0, 1, 0, 0, 0);
  placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
  bump(state);
  const game = makeGame(state, []);

  const operator = makeMember('operator', 'op1');
  operator.fromNode = { col: 4, row: 1, subCol: 3, subRow: 3 };
  operator.needs.hunger = 0.85;
  state.staffMembers = [operator];

  assignJobs(game); // door open: the eat job should land
  assertOk(operator.job?.jobType === 'eat', `setup: hungry operator was assigned eat at the only dining seat (got ${operator.job?.jobType})`);
  assertOk(operator.job?.phase === 'travel', 'setup: still travelling, has not arrived yet');
  const key = operator.job.stationKey;
  assertOk(state.stationReservations[key] === operator.id, 'setup: the dining seat is reserved');

  // The player walls the cafeteria in (deletes the door). The station
  // placeable itself is untouched — jobStillValid (existence) would say
  // this job is perfectly fine.
  delete state.doorOccupied['1,1,e'];
  bump(state);

  tickJobs(game);

  assertOk(operator.job === null, 'the job is abandoned once the route disappears, even though the station itself still exists');
  assertOk(!state.stationReservations[key],
    'the reservation is released — otherwise every OTHER hungry staffer would be silently downgraded to the slow fallback forever, exactly the leak this exists to prevent');
  assertOk(/path/i.test(operator.idleReason || ''), `idleReason names the lost path (got "${operator.idleReason}")`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 3c. Travel-tick budget backstop: a job stuck in phase travel is eventually abandoned even when nothing else catches it ===\n');
{
  // repair is target-addressed (no stationKey), so the live isReachable
  // re-check (3b, above) never applies to it — currentStationNode returns
  // null for any job without a stationKey. No member.fromNode is set
  // either, so computeTravelBudget also can't compute a real path length —
  // both together exercise the worst-case-map-distance fallback budget
  // (worstCaseMapSubtiles), at the default mapHalfExtent (30) and default
  // speed (1), which fix-round-2 replaced the old flat MAX_TRAVEL_TICKS=300
  // with: (61*8) subtiles * (0.5/0.9)*1 ticks/subtile * 2 safety = 543
  // ticks. This is the catch-all for "a reason nobody anticipated", not the
  // reachability path (3b) or the speed/map-scaling behavior (3d, below).
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 40);
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  assignJobs(game);
  assertOk(technician.job?.jobType === 'repair', 'setup: technician assigned repair');
  assertOk(technician.job?.phase === 'travel', 'setup: never arrives in this test (no arrive() call)');

  let abandonedAtTick = -1;
  for (let t = 0; t < 600 && abandonedAtTick < 0; t++) {
    tickJobs(game);
    if (technician.job === null) abandonedAtTick = t;
  }
  assertOk(abandonedAtTick >= 0, `the stuck travel job was eventually abandoned (at tick ${abandonedAtTick})`);
  assertOk(abandonedAtTick === 543, `the backstop fires at exactly the computed worst-case-map budget (fired at tick ${abandonedAtTick}, expected 543)`);
  assertOk(!!technician.idleReason, 'idleReason explains why (non-empty)');
}

// ---------------------------------------------------------------------------
console.log('\n=== 3d. fix-round-2: the travel budget is distance- and speed-invariant — a genuinely long walk completes at 1x/2x/4x instead of looping forever ===\n');
{
  // The bug this pins: MAX_TRAVEL_TICKS used to count raw sim ticks, which
  // fire MORE often per real second at higher state.speed (Game.js:
  // tickInterval = TICK_MS / speed), while a pawn's own walk speed is real
  // wall-clock-driven and untouched by state.speed. A fixed tick budget
  // therefore covered FEWER real seconds — and fewer walkable subtiles —
  // the faster the game ran: generous at 1x, already firing at 2x, firing
  // badly at 4x. Abandoning mid-walk released the reservation; the very
  // next assignJobs reassigned the SAME job; the member never arrived —
  // an infinite loop, not just a stuck pawn.
  //
  // Reproduces the reviewer's own numbers: a large map (mapHalfExtent 60,
  // double the default) and a genuinely long corner-to-corner path (~974
  // subtiles, computed for real via findPath since both endpoints are
  // reachable open floor), run at each of the three valid speeds. No
  // renderer exists in this headless test to actually walk the pawn over
  // real wall-clock time, so "survives the walk" is verified analytically:
  // tick exactly as many sim ticks as the real walk would take at this
  // speed (requiredTravelTicks, below — the same conversion jobRunner.js's
  // own ticksPerSubtile uses) and assert the job is neither abandoned nor
  // reset partway through. Then simulate arrival and confirm it completes
  // normally, so this isn't just "delays the same failure past this test's
  // patience".
  function buildLongWalk(speed) {
    const state = makeState();
    state.mapHalfExtent = 60;
    floorRect(state, -60, 60, -60, 60);
    placeItem(state, 'diningTable', 58, 58, 0, 0, 0);
    const table = state.placeables[state.placeables.length - 1];
    placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
    bump(state);
    state.speed = speed;
    const game = makeGame(state, []);

    const operator = makeMember('operator', `op_${speed}x`);
    operator.fromNode = { col: -60, row: -60, subCol: 0, subRow: 0 };
    operator.needs.hunger = 0.85;
    state.staffMembers = [operator];
    return { game, operator };
  }

  // Same conversion jobRunner.js's own (unexported) ticksPerSubtile uses —
  // duplicated here (not imported: it's not exported, on purpose, same as
  // every other internal helper in that file) to compute, independently,
  // how many sim ticks the ACTUAL real-world walk requires at each speed.
  // This is what a correct budget must be AT LEAST as big as; it's also
  // exactly the number the old flat MAX_TRAVEL_TICKS=300 fell short of at
  // 2x/4x.
  const SUB_UNIT_TEST = 0.5;
  const SLOWEST_PAWN_SPEED_TEST = 0.9;
  function requiredTravelTicks(pathSubtiles, speed) {
    return Math.ceil(pathSubtiles * (SUB_UNIT_TEST / SLOWEST_PAWN_SPEED_TEST) * speed);
  }

  for (const speed of [1, 2, 4]) {
    const { game, operator } = buildLongWalk(speed);
    assignJobs(game);
    assertOk(operator.job?.jobType === 'eat', `${speed}x: setup: assigned eat at the far dining seat (got ${operator.job?.jobType})`);
    assertOk(operator.job.travelBudgetTicks == null, `${speed}x: setup: no budget computed yet (lazy, first tickJobs call)`);

    const targetNode = getStationIndex(game.state).byKey[operator.job.stationKey].node;
    const path = findPath(getNavGrid(game.state), operator.fromNode, targetNode);
    assertOk(!!path, `${speed}x: setup: sanity — a real path exists between the corners`);
    assertOk(path.length > 900, `${speed}x: setup: sanity — this really is a long walk (${path.length} subtiles)`);
    const required = requiredTravelTicks(path.length, speed);

    // Tick exactly the number of sim ticks the real walk requires at this
    // speed. The job must not have been abandoned by then — that's the bug:
    // at 2x/4x, the old flat 300-tick budget fired WELL before `required`,
    // releasing the reservation and getting the identical job reassigned
    // next pass, forever, without ever completing the walk.
    for (let t = 0; t < required; t++) tickJobs(game);
    assertOk(operator.job?.jobType === 'eat',
      `${speed}x: the job survives the full ${required}-tick real-world walk duration without being abandoned (job is now ${JSON.stringify(operator.job)})`);
    assertOk(operator.job.phase === 'travel', `${speed}x: still travelling (never reassigned/reset) through the whole required duration`);
    assertOk(operator.job.travelBudgetTicks >= required,
      `${speed}x: the computed budget (${operator.job.travelBudgetTicks}) comfortably covers the required duration (${required})`);

    // Arrival (renderer-reported, same stand-in as every other scenario)
    // now completes the job normally — proves the fix doesn't just delay
    // the same failure, the job actually finishes.
    arrive(operator);
    let completedAtTick = -1;
    for (let t = 0; t < 200 && completedAtTick < 0; t++) {
      tickJobs(game);
      if (operator.job === null) completedAtTick = t;
    }
    assertOk(completedAtTick >= 0, `${speed}x: after arrival, the eat job completes normally (at tick ${completedAtTick})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 3e. fix-round-3: a mid-journey 1x -> 4x speed change does not abandon the job ===\n');
{
  // TRAVEL_BUDGET_SAFETY (2x) covers a speed increase up to double whatever
  // the budget was last computed at — but a 1x -> 4x jump (VALID_SPEEDS is
  // [1, 2, 4]) is exactly the uncovered case, and speeding the game up
  // mid-walk is a completely ordinary player action, not an edge case.
  //
  // Same long-walk world as 3d (950-subtile path). Simulated as: walk the
  // FIRST HALF of the path's worth of real time at 1x (requiredTravelTicks
  // for half the path, at speed 1), switch state.speed to 4, then walk the
  // SECOND HALF's worth of real time at 4x (requiredTravelTicks for the
  // other half, at speed 4). That total tick count is what a real pawn
  // actually walking the full path with that mid-journey speed change would
  // produce.
  //
  // Under the pre-fix code (a single budget computed once at 1x and never
  // revisited): budget stays fixed at the 1x figure (1056, from 3d) for the
  // WHOLE journey. The total ticks this scenario ticks through (264 + 1056
  // = 1320) exceeds that fixed 1056 partway into the 4x half, so the job
  // gets abandoned with "Gave up trying to get there." well before the walk
  // is actually done — reproducing the reviewer's report exactly. This test
  // fails against that code and passes against the fix (recompute whenever
  // the CURRENT speed exceeds the speed the cached budget was computed at).
  const state = makeState();
  state.mapHalfExtent = 60;
  floorRect(state, -60, 60, -60, 60);
  placeItem(state, 'diningTable', 58, 58, 0, 0, 0);
  const table = state.placeables[state.placeables.length - 1];
  placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
  bump(state);
  state.speed = 1;
  const game = makeGame(state, []);

  const operator = makeMember('operator', 'op_switch');
  operator.fromNode = { col: -60, row: -60, subCol: 0, subRow: 0 };
  operator.needs.hunger = 0.85;
  state.staffMembers = [operator];

  assignJobs(game);
  assertOk(operator.job?.jobType === 'eat', `setup: assigned eat at the far dining seat (got ${operator.job?.jobType})`);

  const targetNode = getStationIndex(state).byKey[operator.job.stationKey].node;
  const path = findPath(getNavGrid(state), operator.fromNode, targetNode);
  assertOk(path.length > 900, `setup: sanity — this really is a long walk (${path.length} subtiles)`);

  const SUB_UNIT_TEST = 0.5;
  const SLOWEST_PAWN_SPEED_TEST = 0.9;
  function requiredTravelTicks(pathSubtiles, speed) {
    return Math.ceil(pathSubtiles * (SUB_UNIT_TEST / SLOWEST_PAWN_SPEED_TEST) * speed);
  }
  const halfPath = path.length / 2;
  const ticksBeforeSwitch = requiredTravelTicks(halfPath, 1);
  const ticksAfterSwitch = requiredTravelTicks(halfPath, 4);

  for (let t = 0; t < ticksBeforeSwitch; t++) tickJobs(game);
  assertOk(operator.job?.jobType === 'eat', `still travelling at 1x after ${ticksBeforeSwitch} ticks (first half)`);
  assertOk(operator.job.travelBudgetSpeed === 1, 'the cached budget was computed at speed 1');
  const budgetAt1x = operator.job.travelBudgetTicks;

  state.speed = 4;
  for (let t = 0; t < ticksAfterSwitch; t++) tickJobs(game);

  assertOk(operator.job?.jobType === 'eat',
    `the job survives the full mid-journey 1x->4x switch instead of being abandoned (job is now ${JSON.stringify(operator.job)})`);
  assertOk(operator.job.phase === 'travel', 'still travelling (never reassigned/reset) through the whole switch');
  assertOk(operator.job.travelBudgetSpeed === 4, 'the budget was recomputed at the new speed (4)');
  assertOk(operator.job.travelBudgetTicks > budgetAt1x,
    `the recomputed budget (${operator.job.travelBudgetTicks}) is larger than the stale 1x one (${budgetAt1x})`);
  assertOk(!!operator.job.stationKey && state.stationReservations[operator.job.stationKey] === operator.id,
    'the reservation was never dropped and reacquired — this was never actually abandoned, not even briefly');

  // And it still completes normally afterward.
  arrive(operator);
  let completedAtTick = -1;
  for (let t = 0; t < 200 && completedAtTick < 0; t++) {
    tickJobs(game);
    if (operator.job === null) completedAtTick = t;
  }
  assertOk(completedAtTick >= 0, `after arrival, the eat job completes normally (at tick ${completedAtTick})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Firing a staffer mid-job releases the reservation (via releaseAllFor, same as Game.js) ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addSourcePlaceable(state);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
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
console.log('\n=== 5b. I2: eating does not leave fatigue climbing/pegged unaddressed for the whole meal ===\n');
{
  // handleNeeds returns early once hunger lands the 'eat' job — a member
  // can hold only one job — but an EARLIER version of this file skipped the
  // fatigue branch ENTIRELY in that case, so fatigue (also over threshold
  // here) got zero attention for the whole ~80-tick meal: tickStaffMember's
  // own 'working' branch (status stays 'working' throughout an eat job)
  // kept incrementing it, unchecked, straight to 1.0. utility-gate.js
  // rejects any operator above fatigue 0.85 for beam staffing purposes, so
  // an operator eating tripped the beam on a near-50% duty cycle.
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  const table = placeItem(state, 'diningTable', 4, 4, 0, 0, 0);
  placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
  bump(state);
  const game = makeGame(state, []);

  const operator = makeMember('operator', 'op1');
  operator.fromNode = { col: 8, row: 8, subCol: 0, subRow: 0 };
  operator.needs.hunger = 0.85;
  operator.needs.fatigue = 0.85; // ALSO over threshold — no rest station exists anywhere in this world
  state.staffMembers = [operator];
  // Captured BEFORE the first assignJobs call: that call's own handleNeeds
  // pass already applies one round of the fatigue trickle, so capturing
  // afterward risks comparing against a value the oscillating trickle can
  // legitimately land back on by coincidence (0.85 -0.05 = 0.80 exactly).
  const fatigueAtStart = operator.needs.fatigue;

  assignJobs(game);
  assertOk(operator.job?.jobType === 'eat', `setup: hunger wins the one job slot (got ${operator.job?.jobType})`);
  arrive(operator);

  for (let t = 0; t < 60; t++) {
    tickStaffMember(operator, { isNight: false, cafeteriaTier: 0, zoneTier: 0, rng: () => 0.5 });
    assignJobs(game);
    tickJobs(game);
  }

  assertOk(operator.job?.jobType === 'eat', "still mid-meal after 60 ticks (eat's own workTicks/efficiency is 80)");
  assertOk(operator.needs.fatigue < fatigueAtStart,
    `fatigue actually decreased during the meal instead of climbing (started ${fatigueAtStart.toFixed(3)}, now ${operator.needs.fatigue.toFixed(3)})`);
  assertOk(operator.needs.fatigue < 0.85,
    `fatigue never reached utility-gate's 0.85 operator-rejection threshold during the meal (got ${operator.needs.fatigue.toFixed(3)})`);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. Deadlock guard: no cafeteria anywhere -> a hungry operator keeps working THE SAME JOB, recovers slowly, never goes permanently jobless (500 ticks) ===\n");
{
  // member.fromNode is populated (unlike an earlier version of this test) so
  // tryTakeNeedJob's findStation call runs the REAL board search and comes
  // back null because there is genuinely no 'eat' station in the index —
  // not because fromNode was missing and findStation short-circuited before
  // ever searching. Those are different code paths; only the first one is
  // "no cafeteria anywhere" the way this scenario is named.
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addSourcePlaceable(state);
  bump(state);
  // Deliberately no diningTable/toolChest/workCart anywhere in this facility.
  const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
  const game = makeGame(state, [beamline]);

  const operator = makeMember('operator', 'op1');
  operator.fromNode = { col: 0, row: 0, subCol: 0, subRow: 0 }; // open floor, well clear of the console footprint
  state.staffMembers = [operator];

  assignJobs(game);
  assertOk(operator.job?.jobType === 'runBeam', 'setup: operator starts on runBeam');
  arrive(operator); // simulate arrival exactly ONCE — a correct implementation
  // never needs to re-report it, since the SAME job object persists; see the
  // job-identity assertion below for why this matters.
  const jobAtStart = operator.job;
  const stationKeyAtStart = operator.job.stationKey;

  let sawMissingCafeteriaReason = false;
  let everJobless = false;
  let everLeftWorkPhase = false;
  for (let t = 0; t < 500; t++) {
    simTick(game, operator);
    if (operator.job === null) everJobless = true;
    if (operator.job && operator.job.phase !== 'work') everLeftWorkPhase = true;
    if (/cafeteria/i.test(operator.idleReason || '')) sawMissingCafeteriaReason = true;
  }

  assertOk(!everJobless, 'the operator was never left with job === null at any point in 500 ticks');
  assertOk(!everLeftWorkPhase, "the operator never dropped out of phase 'work' (a re-abandon-and-reassign loop would reset it to 'travel' and nothing here re-reports arrival)");
  assertOk(operator.job === jobAtStart,
    'the SAME job object instance persisted the whole run — a naive "abandon whenever the eat/rest station search fails" implementation would replace it every tick instead of leaving it alone');
  assertOk(operator.job?.jobType === 'runBeam', `still doing runBeam after 500 ticks (got ${operator.job?.jobType})`);
  assertOk(operator.job?.phase === 'work', 'still in phase work after 500 ticks');
  assertOk(operator.job?.stationKey === stationKeyAtStart, 'still holding the SAME console the whole run');
  assertOk(operator.job?.progress > 100,
    `job.progress accumulated substantially (${operator.job?.progress?.toFixed(1)}) — would stay near 0 if the job kept getting reset`);
  assertOk(sawMissingCafeteriaReason, 'idleReason named the missing cafeteria at some point');
  assertOk(operator.needs.hunger < 0.95, `hunger recovers instead of pegging at 1 (got ${operator.needs.hunger.toFixed(3)})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 6b. A cafeteria has real mechanical value: an operator who CAN reach one recovers from hunger far faster than one who cannot ===\n');
{
  // Restores the property the old status='onBreak' regression test used to
  // pin (test-review-regressions.js's deleted fastBack < slowBack
  // assertion) against the NEW job-based mechanism: with a real 'eat' job,
  // hunger resets to 0 on completion (a bounded ~80-tick round trip at this
  // test's efficiency); without one, it only ever gets the deadlock guard's
  // flat trickle and never gets anywhere near 0.
  function buildWorld(withCafeteria) {
    const state = makeState();
    floorRect(state, 0, 12, 0, 12);
    placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
    if (withCafeteria) {
      const table = placeItem(state, 'diningTable', 8, 8, 0, 0, 0);
      placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3, 0);
    }
    addSourcePlaceable(state);
    bump(state);
    const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
    const game = makeGame(state, [beamline]);
    const operator = makeMember('operator', withCafeteria ? 'opWith' : 'opWithout');
    operator.fromNode = { col: 0, row: 0, subCol: 0, subRow: 0 };
    operator.needs.hunger = 0.85;
    state.staffMembers = [operator];
    assignJobs(game);
    arrive(operator);
    return { game, operator };
  }

  // A dedicated tick helper for THIS scenario only: it auto-reports arrival
  // for whatever job is currently assigned. That's deliberately NOT shared
  // with scenario 6/6a above — always-arriving would mask a re-abandon-and-
  // reassign loop there (arrival would paper over the phase reset every
  // tick). Here the point is purely "does a completed eat job beat the
  // trickle", so instant arrival is a fair stand-in for the renderer.
  function simTickWithArrival(game, member) {
    simTick(game, member);
    if (member.job && member.job.phase === 'travel') arrive(member);
  }

  const withCafeteria = buildWorld(true);
  const withoutCafeteria = buildWorld(false);

  let ticksToRecoverWith = -1;
  for (let t = 0; t < 300 && ticksToRecoverWith < 0; t++) {
    simTickWithArrival(withCafeteria.game, withCafeteria.operator);
    if (withCafeteria.operator.needs.hunger < 0.3) ticksToRecoverWith = t;
  }
  let ticksToRecoverWithout = -1;
  for (let t = 0; t < 300 && ticksToRecoverWithout < 0; t++) {
    simTickWithArrival(withoutCafeteria.game, withoutCafeteria.operator);
    if (withoutCafeteria.operator.needs.hunger < 0.3) ticksToRecoverWithout = t;
  }

  assertOk(ticksToRecoverWith >= 0, `with a cafeteria, hunger drops below 0.3 within 300 ticks (at tick ${ticksToRecoverWith})`);
  assertOk(ticksToRecoverWithout < 0, 'without a cafeteria, hunger NEVER drops below 0.3 within 300 ticks — the deadlock guard trickle only keeps it bounded, it does not substitute for an actual meal');
  assertOk(withoutCafeteria.operator.needs.hunger > 0.5,
    `without a cafeteria, hunger stays stuck oscillating well above the with-cafeteria member's low (got ${withoutCafeteria.operator.needs.hunger.toFixed(3)})`);
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
  addSourcePlaceable(state);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
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
console.log("\n=== 9. runBeam cap: at most (registered) beamlineCount operators hold runBeam at once, even with more free consoles AND a higher-priority repair offer present ===\n");
{
  // Deliberately NOT fixture-lucky: a damaged component (repair, priority
  // ~90-140) sorts ABOVE runBeam's (80) in the offer list. An operator is
  // never eligible for repair (wrong profession) — if the surplus
  // operator's "best rejection" naively took the first non-null reason in
  // priority order, it would report repair's "needs a Technician" message
  // instead of the actually-relevant beamline shortage. See pickBestOffer's
  // professionOk-relevance split.
  //
  // beamlineCount counts isSource PLACEABLES (utility-gate.js's shared
  // countBeamlines, staff-professions-3 fix-round-2 — see jobRunner.js's
  // own comment on that function), not registry entries directly, and not
  // only running ones: operatorCoverage requires coverage for every
  // isSource placeable regardless of run status, so the cap has to match or
  // a stopped/damaged line can shrink it out from under an already-seated
  // operator. This fixture places TWO isSource 'source' modules — one via
  // placeDamagedBeamline (bl-2, damaged-but-registered), one added directly
  // for bl-1 (running) — against THREE free consoles, so the cap (2) is
  // still the real constraint, not console count.
  const state = makeState();
  floorRect(state, 0, 20, 0, 10);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'monitorBank', 6, 2, 0, 0, 0);
  placeItem(state, 'operatorConsole', 10, 8, 0, 0, 0);
  const damaged = placeDamagedBeamline(state, 'bl-2', 12, 4, 40);
  addSourcePlaceable(state); // matches bl-1 (running), below
  bump(state);
  const running = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
  const game = makeGame(state, [running, damaged]); // TWO registered beamlines, three free consoles

  const opA = makeMember('operator', 'opA');
  const opB = makeMember('operator', 'opB');
  const opC = makeMember('operator', 'opC');
  state.staffMembers = [opA, opB, opC];

  assignJobs(game);
  const runBeamHolders = state.staffMembers.filter(m => m.job?.jobType === 'runBeam');
  assertOk(runBeamHolders.length === 2, `exactly 2 operators hold runBeam with 2 registered beamlines (got ${runBeamHolders.length})`);
  const surplus = state.staffMembers.find(m => m.job?.jobType !== 'runBeam');
  assertOk(!!surplus, 'sanity: one operator was left without runBeam');
  assertOk(surplus.job === null, 'the surplus operator was not assigned anything else instead (certainly not repair)');
  assertOk(/beamline/i.test(surplus.idleReason || ''),
    `the surplus operator's idleReason names the beamline shortage, not repair/consoles (got "${surplus.idleReason}")`);
  assertOk(!/technician/i.test(surplus.idleReason || ''),
    `the surplus operator's idleReason is not a misdirected repair-profession rejection (got "${surplus.idleReason}")`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. repair cap: at most state.resources.spares technicians hold repair at once, even with more damaged components AND a free console/running beamline present ===\n');
{
  // Also not fixture-lucky: a free console + running beamline (runBeam,
  // priority 80, below repair's own ~90-140) sits in the same world. A
  // technician is never eligible for runBeam (wrong profession), so this
  // proves the spares-cap message isn't an artifact of repair being the
  // only job type around.
  const state = makeState();
  floorRect(state, 0, 30, 0, 10);
  placeItem(state, 'operatorConsole', 26, 2, 0, 0, 0);
  const bl1 = placeDamagedBeamline(state, 'bl-1', 4, 4, 40);
  const bl2 = placeDamagedBeamline(state, 'bl-2', 12, 4, 40);
  const bl3 = placeDamagedBeamline(state, 'bl-3', 20, 4, 40);
  bump(state);
  state.resources.spares = 1;
  const running = { id: 'bl-4', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
  const game = makeGame(state, [bl1, bl2, bl3, running]);

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
    assertOk(!/operator/i.test(m.idleReason || ''), `${m.id}'s idleReason is not a misdirected runBeam-profession rejection (got "${m.idleReason}")`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 10b. fix-round-2: with spares === 0, the board suppresses repair entirely — the idle technician gets the SUPPRESSION reason, not a generic "nothing to do" ===\n');
{
  // spares === 0 makes jobs.js's repairOffers suppress EVERY repair offer
  // (see its own reason: 'No spares available to make the repair.') —
  // there is no offer left for pickBestOffer to even look at, let alone
  // reject, so before this fix a technician here got "Nothing to do right
  // now.", the same message an actually-idle-with-nothing-broken technician
  // would see. That's the difference between the player knowing to build a
  // machine shop and the player thinking the game (or the technician) is
  // broken.
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const beamline = placeDamagedBeamline(state, 'bl-1', 5, 5, 40);
  state.resources.spares = 0;
  const game = makeGame(state, [beamline]);

  const technician = makeMember('technician', 't1');
  state.staffMembers = [technician];

  assignJobs(game);
  assertOk(technician.job === null, 'setup: no spares — the technician gets no job');
  assertOk(/spares/i.test(technician.idleReason || ''),
    `idleReason surfaces the board's suppression reason, naming spares (got "${technician.idleReason}")`);
  assertOk(technician.idleReason !== 'Nothing to do right now.',
    `idleReason is NOT the generic fallback (got "${technician.idleReason}")`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 11. abandonJob is the single choke point: releases the station, clears job, sets idleReason ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addSourcePlaceable(state);
  bump(state);
  const beamline = { id: 'bl-1', sourceId: null, status: 'running', beamState: { componentHealth: {} } };
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
