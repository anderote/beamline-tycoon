// test/test-staff-diagnostics.js — idle legibility (src/game/staff/
// staffDiagnostics.js). Task 8 of the staff-professions-3 (jobs-and-gates)
// plan.
//
// Three things this suite has to prove, per the task brief:
//   1. facilityStaffingReport groups identical idleReason text (post
//      correction) into one { reason, count, members } entry, ranks groups
//      beam-blocked > repairs-stalled > everything else, and reports
//      idleCount === 0 / byReason === [] for a fully-employed facility.
//   2. Every reason string reaching this report is non-empty and contains
//      no identifier-looking text (no camelCase job ids) — asserted with a
//      regex over every reachable reason, not a spot check.
//   3. The cross-profession-mismatch correction (this module's header
//      comment) actually intercepts the REAL defect produced by the REAL
//      job-assignment pipeline (jobRunner.assignJobs + jobs.buildJobOffers)
//      — not a hand-typed string that merely happens to match this file's
//      own regex. Sections 5/6 below run that real pipeline and assert both
//      that the raw defect is genuinely reproduced (so the test isn't
//      passing for the wrong reason — see this plan's own hazard 2) and
//      that the report corrects it.

import { facilityStaffingReport, describeJob } from '../src/game/staff/staffDiagnostics.js';
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
    ...extra,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) state.infraOccupied[`${c},${r}`] = type;
  }
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
// 2. worst picks the beam-blocking reason over a lower-priority one, and
//    repairs-stalled over everything-else — regardless of headcount.
// ==========================================================================
console.log('\n=== 2. worst ranks beam > repair > everything else, regardless of count ===\n');
{
  const state = makeState();
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
    `worst is the single operator's beam-blocking reason, not the 5-strong admin group (got "${report.worst?.reason}")`);
  assert(report.byReason[1].reason.includes('spares'),
    `second place is the repair-stalling reason (got "${report.byReason[1]?.reason}")`);
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
//    full realistic reason vocabulary (all 17 idleReason strings this plan's
//    own review found), not a spot check.
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
//    assignment pipeline (jobRunner.assignJobs + jobs.buildJobOffers) — an
//    idle operator in a facility with no Operator Console anywhere, but
//    with unrelated fabricate work available for a machinist to reject
//    against (the pipeline's fallbackReason branch never fires without
//    SOME other-profession offer to trip over). First assert the raw
//    defect is genuinely reproduced (jobRunner really does hand this
//    operator a bogus cross-profession sentence) — proving section 6's
//    correction below isn't passing for the wrong reason — then assert the
//    report corrects it.
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
  assert(!/operator/i.test(op.idleReason) || /not an operator/i.test(op.idleReason),
    `sanity: the raw sentence is about SOME OTHER job needing a non-operator role (got "${op.idleReason}")`);
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
  assert(!/needs a machinist/i.test(reason) && !/needs an? \w+, not/i.test(reason),
    `corrected reason no longer blames a mismatched profession (got "${reason}")`);
  assert(/operator/i.test(reason), `corrected reason is actually about the operator's own work (got "${reason}")`);
}

// ==========================================================================
// 6b. Same shape of defect, different profession: an idle technician with
// nothing at all left to repair, but unrelated fabricate work on offer.
// Confirms the correction isn't operator-special-cased.
// ==========================================================================
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
  assert(!/needs a machinist/i.test(reason), `no longer blames Fabrication needing a Machinist (got "${reason}")`);
  assert(/technician/i.test(reason), `reason is actually about the technician's own work (got "${reason}")`);
}

// ==========================================================================
// 7. When the beam gate has ALSO independently found the facility
// staffing-blocked (state.infraBlockers carries a real 'beam_unstaffed'
// entry from a real UtilityGate.run()), the correction prefers that
// authoritative, richer ladder message over the generic fallback.
// ==========================================================================
console.log('\n=== 7. With a real beam_unstaffed blocker present, the idle operator\'s reason IS that blocker\'s own message ===\n');
{
  const state = makeState();
  addBeamline(state, 'bl1'); // a beamline exists, so the gate cares about staffing at all
  const op = makeMember({ id: 'op1', profession: 'operator' });
  state.staffMembers = [op];
  // No console anywhere -> jobRunner leaves the operator idle with whatever
  // (possibly bogus) reason it lands on; the gate independently reports
  // beam_unstaffed with its own console-naming message.
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
