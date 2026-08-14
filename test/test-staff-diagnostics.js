// test/test-staff-diagnostics.js — idle legibility (src/game/staff/
// staffDiagnostics.js). Task 8 of the staff-professions-3 (jobs-and-gates)
// plan, plus fix round 1 (a review found F1/F2/F4/F5 — see each section
// below for the specific scenario each fix addresses).
//
// Sections:
//   1-4. Original task-8 spec: grouping, worst-ranking, empty facility, no
//        identifier leaks.
//   2b.  Mutation guard for the rank-tracking line itself (a review found
//        `g.rank = r` — last-write-wins — leaves the ORIGINAL suite green
//        while flipping which reason leads the banner on a mixed roster).
//   2c.  F2: rank must key on whether the beam gate says the beam is
//        actually short, not on raw profession.
//   5-6b. The cross-profession-mismatch correction, run through the REAL
//        assignment pipeline, not hand-typed strings.
//   7.   The beam gate's ladder message used for a generic/mismatched idle
//        operator reason.
//   7b.  F1: that same gate message must NEVER replace a station-specific
//        rejection, reproduced through the real pipeline (sealed console).
//   8.   describeJob: job+phase / idle reason, station name.
//   9.   F10: a job whose station has been demolished degrades to a
//        complete sentence, no dangling preposition.
//   10.  F11: a needs-deadlock message reaching a truly idle member has its
//        self-contradictory "...while working" clause stripped.
//   11.  F5's sibling: the weaker "no spares" phrasing normalizes to the
//        one that names the fix.
//   12.  F12: the mismatch correction keeps the actionable half instead of
//        discarding it.
//   13.  F4: a fully-staffed beam that was never started — describeJob and
//        facilityProgressReport both name it.
//   14.  F5: facilityProgressReport's generic N-tick stall signal, covering
//        the case the idle-only report can't see by construction (an
//        engineer perpetually on labWork, which touches no stats key).
//   15.  F7: the unserviced-need penalty surfaced on a member who still
//        holds a job (describeJob, not facilityStaffingReport).

import { facilityStaffingReport, facilityProgressReport, describeJob } from '../src/game/staff/staffDiagnostics.js';
import { assignJobs } from '../src/game/staff/jobRunner.js';
import { UtilityGate } from '../src/game/utility-gate.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// No identifier-looking text: no camelCase (a lowercase letter immediately
// followed by an uppercase one — the exact shape a jobType/profession id
// leaking unformatted into player copy would take, e.g. "runBeam",
// "labWork") and no snake_case underscores (e.g. "beam_unstaffed", the
// blocker CODE as opposed to its message).
const IDENTIFIER_LEAK_RE = /[a-z][A-Z]|_/;

// ---------------------------------------------------------------------------
// Fixture plumbing — mirrors test-beam-staffing-gate.js / test-staff-
// stations.js's own hand-built-state pattern (plain objects shaped like
// Game.state, not a full Game instance).
// ---------------------------------------------------------------------------

function makeState(extra = {}) {
  return {
    tick: 0,
    infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeableIndex: {}, placeables: [], zoneOccupied: {},
    stationReservations: {}, staffMembers: [], navRevision: 0,
    beamPipes: [], utilityLines: new Map(),
    infraBlockers: [], infraCanRun: true,
    resources: { spares: 0 },
    completedResearch: [],
    ...extra,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) state.infraOccupied[`${c},${r}`] = type;
  }
}

// Walls the full perimeter of tile rectangle [c0,c1]x[r0,r1] — no door, so
// nothing inside is reachable from outside it. Same convention
// test-beam-staffing-gate.js's own sealed-chamber scenario (8) uses.
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

function addBeamline(state, id) {
  state.placeables.push({ id, type: 'source', category: 'beamline' });
}

function makeMember(overrides = {}) {
  return {
    id: overrides.id || `staff_${_nextId++}`,
    profession: 'admin',
    status: 'working',
    mood: 'content',
    skills: {},
    needs: { fatigue: 0.1, hunger: 0.1, morale: 0.6 },
    stats: {},
    job: null,
    idleReason: null,
    ...overrides,
  };
}

const noopSolveRunner = { runSolve: () => ({ errors: [] }) };
const noopPorts = () => ({});

// ==========================================================================
// 1. Twelve staff sharing one reason -> one byReason entry, count 12.
// ==========================================================================
console.log('\n=== 1. Twelve staff, one shared reason -> one byReason entry, count 12 ===\n');
{
  const state = makeState();
  state.staffMembers = Array.from({ length: 12 }, (_, i) =>
    makeMember({ id: `s${i}`, profession: 'admin', idleReason: 'Not currently working.' }));
  const report = facilityStaffingReport({ state });
  assert(report.idleCount === 12, `idleCount is 12 (got ${report.idleCount})`);
  assert(report.byReason.length === 1, `exactly one byReason entry (got ${report.byReason.length})`);
  assert(report.byReason[0].count === 12, `that entry's count is 12 (got ${report.byReason[0]?.count})`);
  assert(report.byReason[0].members.length === 12, 'that entry carries all 12 member refs');
  assert(report.worst === report.byReason[0], 'worst is the (only) entry');
}

// ==========================================================================
// 2. worst ranks beam > repair > everything else, regardless of count — WITH
//    a real beam_unstaffed condition present, so the operator's group
//    genuinely IS beam-blocking (see 2c below for the case where it isn't).
// ==========================================================================
console.log('\n=== 2. worst ranks beam > repair > everything else, regardless of count (beam genuinely short) ===\n');
{
  const state = makeState();
  state.infraBlockers = [{ code: 'beam_unstaffed', message: 'Operator is not at a console yet — beam tripped.' }];
  const members = [
    ...Array.from({ length: 5 }, (_, i) => makeMember({ id: `admin${i}`, profession: 'admin', idleReason: 'Not currently working.' })),
    ...Array.from({ length: 3 }, (_, i) => makeMember({ id: `tech${i}`, profession: 'technician', idleReason: 'No spares left to repair with; a machinist can make more.' })),
    makeMember({ id: 'op1', profession: 'operator', idleReason: 'No beamlines to operate yet.' }),
  ];
  state.staffMembers = members;
  const report = facilityStaffingReport({ state });
  assert(report.idleCount === 9, `idleCount is 9 (got ${report.idleCount})`);
  assert(report.byReason.length === 3, `three distinct reasons (got ${report.byReason.length})`);
  assert(report.worst.reason === 'No beamlines to operate yet.',
    `worst is the single operator's reason (beam genuinely short) over the 5-strong admin group (got "${report.worst?.reason}")`);
  assert(report.byReason[1].reason.includes('spares'),
    `second place is the repair-stalling reason (got "${report.byReason[1]?.reason}")`);
}

// ==========================================================================
// 2b. Mutation guard: a group's rank must be the MINIMUM across its
// members, not whichever member happens to be processed LAST. A same-text
// reason shared by an idle operator (processed first, rank 0 — the gate
// reports the beam genuinely short) and an idle admin (processed second,
// rank 2) must still rank 0 as a group — beating a 3-strong technician
// group (rank 1) for `worst`. `g.rank = r` (unconditional overwrite)
// instead of `if (r < g.rank) g.rank = r` flips this on exactly this
// fixture: admin, processed last, would stomp the operator's rank 0.
// ==========================================================================
console.log('\n=== 2b. Group rank is a running MINIMUM, not last-write — mutation guard ===\n');
{
  const state = makeState();
  state.infraBlockers = [{ code: 'beam_unstaffed', message: 'Operator is not at a console yet — beam tripped.' }];
  state.staffMembers = [
    makeMember({ id: 'op1', profession: 'operator', idleReason: 'Resting after a stress breakdown.' }), // processed first, rank 0
    makeMember({ id: 'admin1', profession: 'admin', idleReason: 'Resting after a stress breakdown.' }), // processed second, rank 2 — must not clobber
    ...Array.from({ length: 3 }, (_, i) => makeMember({ id: `t${i}`, profession: 'technician', idleReason: 'No spares left to repair with; a machinist can make more.' })),
  ];
  const report = facilityStaffingReport({ state });
  const restingGroup = report.byReason.find(g => g.reason === 'Resting after a stress breakdown.');
  assert(!!restingGroup && restingGroup.count === 2, 'setup: the shared-text group has both the operator and the admin');
  assert(report.worst.reason === 'Resting after a stress breakdown.',
    `the shared group wins on the operator's rank, not the 3-strong technician group (got "${report.worst?.reason}")`);
}

// ==========================================================================
// 2c. F2: an idle operator's reason ranks as beam-blocking ONLY when the
// beam gate has independently confirmed coverage is short (beamMsg
// non-null) — NOT merely because the member's profession is 'operator'. An
// operator idle because the facility has no beamline AT ALL is costing
// nothing; six technicians stalled on a real spares shortage are watching
// components decay toward failure and must lead instead.
// ==========================================================================
console.log('\n=== 2c. F2: rank keys on whether the beam is ACTUALLY blocked, not on raw profession ===\n');
{
  const state = makeState();
  state.infraBlockers = []; // no beamlines at all -> beam_unstaffed never fires
  state.staffMembers = [
    makeMember({ id: 'op1', profession: 'operator', idleReason: 'No beamlines to operate yet.' }),
    ...Array.from({ length: 6 }, (_, i) => makeMember({ id: `t${i}`, profession: 'technician', idleReason: 'No spares available to make the repair.' })),
  ];
  const report = facilityStaffingReport({ state });
  assert(report.worst.count === 6, `worst is the 6-strong technician group, not the 1 operator (got count ${report.worst?.count})`);
  assert(/spares/i.test(report.worst.reason), `worst names the spares shortage (got "${report.worst?.reason}")`);
}

// ==========================================================================
// 3. A fully employed facility -> idleCount 0, byReason [].
// ==========================================================================
console.log('\n=== 3. Fully employed facility -> idleCount 0, empty byReason ===\n');
{
  const state = makeState();
  state.staffMembers = [
    makeMember({ profession: 'operator', job: { jobType: 'runBeam', phase: 'work' } }),
    makeMember({ profession: 'technician', job: { jobType: 'repair', phase: 'work' } }),
  ];
  const report = facilityStaffingReport({ state });
  assert(report.idleCount === 0, `idleCount is 0 (got ${report.idleCount})`);
  assert(Array.isArray(report.byReason) && report.byReason.length === 0, 'byReason is empty');
  assert(report.worst === null, 'worst is null when nobody is idle');
}

// ==========================================================================
// 4. No identifier-looking text anywhere in a report — checked over the
// full realistic reason vocabulary (all 17 idleReason strings this plan's
// own review found), not a spot check.
// ==========================================================================
console.log('\n=== 4. No identifier-looking text in any reason, across every known idleReason string ===\n');
{
  const knownReasons = [
    'Not currently working.',
    'Resting after a stress breakdown.',
    'Could not find anywhere to stand for that job.',
    'Nothing to do right now.',
    'Every cafeteria is taken — build more.',
    'No reachable rest station — recovering slowly while working.',
    'No spares available to make the repair.',
    'Unreachable — no clear path to the component.',
    'Someone else is already repairing that component.',
    'Someone else is already commissioning that component.',
    'All 3 beamlines already have an operator.',
    'No beamlines to operate yet.',
    'No spares left to repair with; a machinist can make more.',
    'Run Beam needs an Operator, not a Technician.',
    'Repair needs a Technician, and this staffer isn\'t one.',
    'This staffer has no proficiency for this kind of work yet.',
    'That station is gone.',
  ];
  const state = makeState();
  state.staffMembers = knownReasons.map((r, i) => makeMember({ id: `s${i}`, profession: i % 2 ? 'operator' : 'admin', idleReason: r }));
  const report = facilityStaffingReport({ state });
  assert(report.byReason.length > 0, 'sanity: report is non-empty');
  for (const g of report.byReason) {
    assert(typeof g.reason === 'string' && g.reason.trim().length > 0, `reason is non-empty ("${g.reason}")`);
    assert(!IDENTIFIER_LEAK_RE.test(g.reason), `no identifier-looking text in "${g.reason}"`);
  }
}

// ==========================================================================
// 5. The cross-profession-mismatch correction, run through the REAL
// assignment pipeline (jobRunner.assignJobs + jobs.buildJobOffers) — an
// idle operator in a facility with no Operator Console anywhere, but with
// unrelated fabricate work available for a machinist to reject against.
// First assert the raw defect is genuinely reproduced, then (section 6)
// assert the report corrects it.
// ==========================================================================
console.log('\n=== 5. Real pipeline reproduces the cross-profession-mismatch defect on an idle operator ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'lathe', 2, 2, 0, 0, 0); // a free 'fabricate' station — no machinist on staff to take it
  const op = makeMember({ id: 'op1', profession: 'operator' });
  state.staffMembers = [op];
  assignJobs({ state, registry: { getAll: () => [] } });
  assert(op.job == null, 'setup: the operator is still idle (no console exists to seat them at)');
  assert(typeof op.idleReason === 'string' && / needs .+, (?:not .+\.|and this staffer isn't one\.)$/.test(op.idleReason),
    `setup: jobRunner really does hand back a cross-profession-mismatch sentence (got "${op.idleReason}")`);
}

console.log('\n=== 6. facilityStaffingReport corrects the same fixture to an honest, non-misleading reason ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'lathe', 2, 2, 0, 0, 0);
  const op = makeMember({ id: 'op1', profession: 'operator' });
  state.staffMembers = [op];
  assignJobs({ state, registry: { getAll: () => [] } });

  const report = facilityStaffingReport({ state });
  assert(report.idleCount === 1, 'the operator is reported idle');
  const reason = report.worst.reason;
  assert(!IDENTIFIER_LEAK_RE.test(reason), `corrected reason has no identifier leak ("${reason}")`);
  assert(!/needs a machinist, not/i.test(reason), `corrected reason no longer says "not an Operator" (got "${reason}")`);
  assert(/operator/i.test(reason), `corrected reason is actually about the operator's own work (got "${reason}")`);
}

console.log('\n=== 6b. An idle technician with nothing to repair gets a technician-scoped reason, not a bogus mismatch ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'lathe', 2, 2, 0, 0, 0);
  const tech = makeMember({ id: 'tech1', profession: 'technician' });
  state.staffMembers = [tech];
  assignJobs({ state, registry: { getAll: () => [] } });
  assert(tech.job == null, 'setup: the technician is idle (nothing registered to repair)');

  const report = facilityStaffingReport({ state });
  const reason = report.worst.reason;
  assert(!IDENTIFIER_LEAK_RE.test(reason), `no identifier leak ("${reason}")`);
  assert(!/needs a machinist, not/i.test(reason), `no longer says "not a Technician" (got "${reason}")`);
  assert(/technician/i.test(reason), `reason is actually about the technician's own work (got "${reason}")`);
}

// ==========================================================================
// 7. With a real beam_unstaffed blocker present AND the operator's own raw
// reason being the uninformative generic fallback, the correction prefers
// the gate's authoritative, richer ladder message.
// ==========================================================================
console.log('\n=== 7. Generic/mismatched idle-operator reason + real beam_unstaffed -> the gate\'s own message wins ===\n');
{
  const state = makeState();
  addBeamline(state, 'bl1'); // a beamline exists, so the gate cares about staffing at all
  const op = makeMember({ id: 'op1', profession: 'operator' });
  state.staffMembers = [op];
  // No console anywhere -> jobRunner leaves the operator idle with whatever
  // (possibly bogus/generic) reason it lands on; the gate independently
  // reports beam_unstaffed with its own console-naming message.
  assignJobs({ state, registry: { getAll: () => [] } });
  const gate = new UtilityGate({ state, solveRunner: noopSolveRunner, getPorts: noopPorts });
  gate.run();
  const blocker = state.infraBlockers.find(b => b.code === 'beam_unstaffed');
  assert(!!blocker, 'setup: the gate reports beam_unstaffed');

  const report = facilityStaffingReport({ state });
  assert(report.worst.reason === blocker.message,
    `the operator's grouped reason is exactly the gate's own ladder message (got "${report.worst.reason}" vs "${blocker.message}")`);
  assert(!IDENTIFIER_LEAK_RE.test(report.worst.reason), 'the gate message itself carries no identifier leak');
}

// ==========================================================================
// 7b. F1: the gate's coarse ladder message must NEVER replace a member's
// own STATION-SPECIFIC rejection, even while the gate independently agrees
// coverage is short. Reproduced end-to-end: two beamlines, console #1
// seated (reserved) and reachable, console #2 sealed in a walled room with
// no door — a second operator standing outside it gets rejected by the
// REAL eligibleFor for reachability, not for anything generic.
// ==========================================================================
console.log('\n=== 7b. F1: a station-specific rejection survives a real, independently-confirmed beam_unstaffed blocker ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 8);
  wallPerimeter(state, 8, 11, 0, 3); // seals console #2's room; no door anywhere on its perimeter
  const console1 = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const console2 = placeItem(state, 'operatorConsole', 9, 1, 0, 0, 0); // inside the sealed room
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');

  const op1 = makeMember({
    id: 'op1', name: 'Nadia Petrov', profession: 'operator', skills: { operating: 1 },
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: `${console1.id}:0`, destNode: null, phase: 'work', progress: 0 },
  });
  state.stationReservations[`${console1.id}:0`] = op1.id; // seated for real, not just cosmetically
  const op2 = makeMember({
    id: 'op2', name: 'Arjun Hassan', profession: 'operator', skills: { operating: 1 },
    fromNode: { col: 6, row: 1, subCol: 0, subRow: 0 }, // outside the sealed room
  });
  state.staffMembers = [op1, op2];

  assignJobs({ state, registry: { getAll: () => [] } }); // op1 already has a job (skipped); op2 gets a REAL rejection
  assert(op2.job == null, 'setup: op2 stayed idle — console #2 is sealed off, unreachable');
  assert(/reach/i.test(op2.idleReason || ''), `setup: op2's raw idleReason is the real station-specific reachability rejection (got "${op2.idleReason}")`);

  const gate = new UtilityGate({ state, solveRunner: noopSolveRunner, getPorts: noopPorts });
  gate.run();
  const blocker = state.infraBlockers.find(b => b.code === 'beam_unstaffed');
  assert(!!blocker, 'setup: the gate independently reports coverage short (1 of 2 beamlines)');

  const report = facilityStaffingReport({ state });
  const g = report.byReason.find(x => x.members.includes(op2));
  assert(!!g, 'op2 appears in the report');
  assert(g.reason === op2.idleReason,
    `F1: op2's own station-specific reason survives, is NOT replaced by the gate's coarser ladder message (got "${g.reason}")`);
  assert(g.reason !== blocker.message, `sanity: the surviving reason isn't accidentally identical to the gate message (gate said "${blocker.message}")`);
}

// ==========================================================================
// 8. describeJob: current job + phase, or the idle reason; the station name.
// ==========================================================================
console.log('\n=== 8. describeJob: job+phase / idle reason, and station name ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const game = { state };

  const seated = makeMember({
    profession: 'operator',
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: `${console_.id}:0`, destNode: null, phase: 'work', progress: 0 },
  });
  const traveling = makeMember({
    profession: 'technician',
    job: { jobType: 'repair', target: { beamlineId: 'bl1', nodeId: 'n1' }, specialty: null, stationKey: null, destNode: null, phase: 'travel', progress: 0 },
  });
  const idle = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });

  const dSeated = describeJob(seated, game);
  assert(dSeated.status.includes('Run Beam'), `seated status names the job (got "${dSeated.status}")`);
  assert(/working at/i.test(dSeated.status), `seated status names the phase (got "${dSeated.status}")`);
  assert(dSeated.station === 'Operator Console', `seated station resolves the placeable name (got "${dSeated.station}")`);

  const dTravel = describeJob(traveling, game);
  assert(dTravel.status.includes('Repair'), `travelling status names the job (got "${dTravel.status}")`);
  assert(/travelling to/i.test(dTravel.status), `travelling status names the phase (got "${dTravel.status}")`);
  assert(dTravel.station === 'the beamline', `target-addressed job reports a station-ish label (got "${dTravel.station}")`);

  const dIdle = describeJob(idle, game);
  assert(dIdle.status === 'Nothing to do right now.', `idle status is the idle reason (got "${dIdle.status}")`);
  assert(dIdle.station === null, 'idle member has no station');
}

// ==========================================================================
// 9. F10: a job whose station has been demolished (stale stationKey)
// degrades to a complete sentence — no dangling "working at" with nothing
// after it.
// ==========================================================================
console.log('\n=== 9. F10: a stale stationKey degrades gracefully, no dangling preposition ===\n');
{
  const state = makeState(); // no console placed at all -> the station index can never resolve this key
  const m = makeMember({
    profession: 'operator',
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: 'ghostConsole_1:0', destNode: null, phase: 'work', progress: 0 },
  });
  const d = describeJob(m, { state });
  assert(d.station === null, 'setup: the stale station resolves to no name');
  assert(d.status === 'Run Beam — working', `status reads as a complete sentence, no trailing "at" (got "${d.status}")`);
  assert(!/ at $/.test(d.status) && !d.status.endsWith(' at'), `no dangling preposition (got "${d.status}")`);
}

// ==========================================================================
// 10. F11: a needs-deadlock message reaching a TRULY idle member (job ==
// null) must not claim they're simultaneously "recovering ... while
// working" — self-contradictory once job really is null.
// ==========================================================================
console.log('\n=== 10. F11: the self-contradictory "recovering ... while working" clause is stripped for a truly idle member ===\n');
{
  const state = makeState();
  const m = makeMember({ profession: 'admin', job: null, idleReason: 'No reachable cafeteria — recovering slowly while working.' });
  state.staffMembers = [m];
  const report = facilityStaffingReport({ state });
  assert(report.worst.reason === 'No reachable cafeteria.',
    `the contradictory suffix is stripped, the underlying fact kept (got "${report.worst.reason}")`);
  assert(!/while working/i.test(report.worst.reason), 'no longer claims this idle member is working');
}

// ==========================================================================
// 11. F5's sibling: the weaker "no spares" phrasing (jobs.js's suppression
// channel, names no fix) normalizes to the one that names the fix
// (jobRunner.js's capShortageReason phrasing).
// ==========================================================================
console.log('\n=== 11. F5-sibling: the fix-nameless spares message normalizes to the one that names the fix ===\n');
{
  const state = makeState();
  const m = makeMember({ profession: 'technician', job: null, idleReason: 'No spares available to make the repair.' });
  state.staffMembers = [m];
  const report = facilityStaffingReport({ state });
  assert(report.worst.reason === 'No spares left to repair with; a machinist can make more.',
    `normalized to the fix-naming phrasing (got "${report.worst.reason}")`);
}

// ==========================================================================
// 12. F12: the mismatch correction keeps the actionable half — WHICH job
// type is waiting on WHICH profession — instead of collapsing to a flat,
// un-actionable "no work available".
// ==========================================================================
console.log('\n=== 12. F12: the mismatch correction keeps the actionable half ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'lathe', 2, 2, 0, 0, 0);
  const admin = makeMember({ id: 'admin1', profession: 'admin' });
  state.staffMembers = [admin];
  assignJobs({ state, registry: { getAll: () => [] } });
  assert(/fabrication needs a machinist, not/i.test(admin.idleReason || ''),
    `setup: raw defect reproduced (got "${admin.idleReason}")`);

  const report = facilityStaffingReport({ state });
  const reason = report.worst.reason;
  assert(reason.startsWith('No Admin work available right now — '),
    `keeps the "no work for this profession" half (got "${reason}")`);
  assert(/Fabrication needs a Machinist\.$/.test(reason),
    `keeps the actionable half — what's waiting, and on whom (got "${reason}")`);
}

// ==========================================================================
// 13. F4 (BLOCKING): a facility that is fully staffed — an operator seated
// and phase:'work', coverage satisfied — but where no registered beamline
// has ever actually been started. Both the inspector (describeJob) and the
// facility-wide signal (facilityProgressReport) must name it; neither may
// read as though the beam is simply running.
// ==========================================================================
console.log("\n=== 13. F4: a fully-staffed beam that was never started, on both surfaces ===\n");
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeMember({
    profession: 'operator',
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: `${console_.id}:0`, destNode: null, phase: 'work', progress: 0 },
  });
  state.staffMembers = [op];
  const game = { state, registry: { getAll: () => [{ id: 'bl1', status: 'stopped' }] } };

  const d = describeJob(op, game);
  assert(/press start/i.test(d.status), `inspector names the fix (got "${d.status}")`);
  assert(!/^Run Beam — working at Operator Console$/.test(d.status),
    `inspector no longer reads as an unqualified "working" (got "${d.status}")`);

  const progress = facilityProgressReport(game);
  assert(progress.stalled === true, 'facilityProgressReport flags the facility as stalled');
  assert(/press start/i.test(progress.reason || ''), `facilityProgressReport names the fix (got "${progress.reason}")`);
  assert(!IDENTIFIER_LEAK_RE.test(progress.reason || ''), 'no identifier leak in the stall reason');

  // Sanity: once the registry says 'running', F4's own check goes quiet
  // (the generic N-tick stall check in section 14 is a separate signal).
  const runningGame = { state, registry: { getAll: () => [{ id: 'bl1', status: 'running' }] } };
  const dRunning = describeJob(op, runningGame);
  assert(!/press start/i.test(dRunning.status), `once running, the "press Start" note is gone (got "${dRunning.status}")`);
}

// ==========================================================================
// 14. F5: facilityProgressReport's generic stall signal — the one that
// isn't keyed on idleness at all, covering a facility where an engineer is
// perpetually "busy" on labWork (which touches no StaffMember stats key —
// see STATS_KEYS, StaffMember.js — so this fixture is exactly the review's
// own "everyone is busy and nothing is progressing" example).
// ==========================================================================
console.log('\n=== 14. F5: the generic N-tick stall signal, keyed on progress not idleness ===\n');
{
  const state = makeState();
  const engineer = makeMember({ profession: 'engineer', job: { jobType: 'labWork', target: null, specialty: null, stationKey: 'x:0', destNode: null, phase: 'work', progress: 0 } });
  state.staffMembers = [engineer];

  state.tick = 0;
  let r = facilityProgressReport({ state });
  assert(r.stalled === false, `tick 0: not yet stalled (got ${JSON.stringify(r)})`);

  state.tick = 100;
  r = facilityProgressReport({ state });
  assert(r.stalled === false, 'tick 100: still under the window');

  state.tick = 250;
  r = facilityProgressReport({ state });
  assert(r.stalled === true, 'tick 250: past the window with a flat fingerprint (labWork touches no stats key) -> stalled');
  assert(/nothing has completed/i.test(r.reason || ''), `names the fact plainly (got "${r.reason}")`);
  assert(!IDENTIFIER_LEAK_RE.test(r.reason || ''), 'no identifier leak in the generic stall reason');

  // A real completion resets the clock...
  engineer.stats.commissions = 1;
  state.tick = 260;
  r = facilityProgressReport({ state });
  assert(r.stalled === false, 'a completion resets the stall clock');

  // ...and it stalls again after a full window with no FURTHER completions.
  state.tick = 260 + 250;
  r = facilityProgressReport({ state });
  assert(r.stalled === true, 'stalls again after another full window with no further completions');
}

console.log('\n=== 14b. facilityProgressReport prefers a live hard infra blocker over the generic fallback ===\n');
{
  const state = makeState();
  const engineer = makeMember({ profession: 'engineer', job: { jobType: 'labWork', target: null, specialty: null, stationKey: 'x:0', destNode: null, phase: 'work', progress: 0 } });
  state.staffMembers = [engineer];
  state.tick = 0;
  facilityProgressReport({ state }); // seed the cache
  state.tick = 300;
  state.infraBlockers = [{ code: 'power_unconnected', message: 'Test rig: an unrelated power fault', severity: 'hard' }];
  const r = facilityProgressReport({ state });
  assert(r.stalled === true, 'still stalled');
  assert(r.reason === 'Test rig: an unrelated power fault', `prefers the live blocker's own message over the generic fallback (got "${r.reason}")`);
}

// ==========================================================================
// 15. F7: the unserviced-need penalty (jobRunner.js's tryTakeNeedJob
// deadlock guard — StaffMember.efficiency()'s flat ×0.6) is invisible on
// BOTH surfaces today: facilityStaffingReport correctly excludes this
// member (job != null — see this file's own doc comment on why "idle" is
// job==null, not idleReason-is-set), but describeJob's whole job is "why
// is this person not producing", and it said nothing.
// ==========================================================================
console.log('\n=== 15. F7: an unserviced need surfaces on the inspector even though the member still holds a job ===\n');
{
  const state = makeState();
  const m = makeMember({
    profession: 'technician',
    job: { jobType: 'repair', target: { beamlineId: 'bl1', nodeId: 'n1' }, specialty: null, stationKey: null, destNode: null, phase: 'work', progress: 10 },
    idleReason: 'No reachable cafeteria — recovering slowly while working.',
    unservicedPenalty: true,
  });
  const d = describeJob(m, { state });
  assert(/reduced output/i.test(d.status), `describeJob surfaces the penalty (got "${d.status}")`);
  assert(d.status.includes('No reachable cafeteria'), `names the actual cause (got "${d.status}")`);

  // facilityStaffingReport, meanwhile, correctly does NOT count this
  // member as idle — they're still working, just at reduced output.
  state.staffMembers = [m];
  const report = facilityStaffingReport({ state });
  assert(report.idleCount === 0, 'facilityStaffingReport does not count a working-but-unserviced member as idle');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
