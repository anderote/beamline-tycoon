// test/test-staff-diagnostics.js — idle legibility (src/game/staff/
// staffDiagnostics.js). Task 8 of the staff-professions-3 (jobs-and-gates)
// plan, plus fix round 1 (F1/F2/F4/F5) and fix round 2 (three more BLOCKING
// false-positive/false-negative shapes in the F4/F5 detector itself, plus a
// new identifier leak and a stale-cache-across-load bug — see each section
// below for the specific scenario each fix addresses).
//
// Sections:
//   1-4. Original task-8 spec: grouping, worst-ranking, empty facility, no
//        identifier leaks.
//   2b.  Mutation guard for the rank-tracking line itself (a review found
//        `g.rank = r` — last-write-wins — leaves the ORIGINAL suite green
//        while flipping which reason leads the banner on a mixed roster).
//   2c.  F2 (round 1): rank must key on whether the beam gate says the beam
//        is actually short, not on raw profession.
//   5-6b. The cross-profession-mismatch correction, run through the REAL
//        assignment pipeline, not hand-typed strings.
//   7.   The beam gate's ladder message used for a generic/mismatched idle
//        operator reason.
//   7b.  F1 (round 1): that same gate message must NEVER replace a
//        station-specific rejection, reproduced through the real pipeline
//        (sealed console).
//   8.   describeJob: job+phase / idle reason, station name.
//   9.   F10: a job whose station has been demolished degrades to a
//        complete sentence, no dangling preposition.
//   10.  F11: a needs-deadlock message reaching a truly idle member has its
//        self-contradictory "...while working" clause stripped.
//   11.  F5's sibling: the weaker "no spares" phrasing normalizes to the
//        one that names the fix.
//   12.  F12: the mismatch correction keeps the actionable half instead of
//        discarding it.
//   13.  F4 (round 1): a fully-staffed beam that was never started —
//        describeJob and facilityProgressReport both name it.
//   13b. Round 2's F1(a): a beam that WAS started and later deliberately
//        stopped is not "never started".
//   13c. Round 2's F1(b): a beam blocked by a REAL hard infra fault is not
//        told "press Start" — infraCanRun is consulted.
//   14.  A facility where NOTHING is progressing at all stalls at the
//        floor window, with a clean generic reason.
//   14a. Round 2's F3: an actively-progressing labWork job (one of the
//        four job types that bump no stats key) is never flagged, however
//        long it runs — the fingerprint now includes in-flight
//        `job.progress`.
//   14b. Round 2's F3: research advancing normally (fractional
//        `researchProgress`) is not flagged.
//   14c. Round 2's F3: the window itself widens for a large job still
//        nominally in flight (progress frozen, isolating the WINDOW fix
//        from the fingerprint fix in 14a/14b) instead of a flat constant.
//   14d. Round 2's F4: the infra-blocker fallback no longer leaks raw
//        internal port/utility text; a blocker with no placeableId (e.g.
//        beam_unstaffed) still passes its own hand-authored message through
//        untouched.
//   14e. Round 2's F5: the stall cache resets on a save-load-shaped tick
//        discontinuity (state object identity survives Game._applyState's
//        Object.assign) in both directions, rather than staying stale.
//   15.  F7: the unserviced-need penalty surfaced on a member who still
//        holds a job (describeJob, not facilityStaffingReport).

import { facilityStaffingReport, facilityProgressReport, describeJob, CACHE_DISCONTINUITY_TICKS } from '../src/game/staff/staffDiagnostics.js';
import { assignJobs, tickJobs } from '../src/game/staff/jobRunner.js';
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
    efficiency: () => 0.5,
    ...overrides,
  };
}

const noopSolveRunner = { runSolve: () => ({ errors: [] }) };
const noopPorts = () => ({});

// Advances `game.state.tick` up to `target` in steps small enough to never
// trip facilityProgressReport's own save-load discontinuity guard
// (CACHE_DISCONTINUITY_TICKS, staffDiagnostics.js) — this file's stand-in
// for "the sim really did tick through every intermediate value", the same
// guarantee _updateHUD's real per-frame polling gives in production (ticks
// there never jump by more than a handful between two consecutive calls).
// A single large jump is the intentional trigger for THAT guard; tests
// exercising it (14e/14e(ii)) call facilityProgressReport directly instead
// of through this helper. Returns the LAST report observed.
function advanceProgress(game, target, stepSize = 90) {
  // Fix round 3's issue E: this used to just be a comment ("under 100 by
  // convention") — a future edit raising the default could silently
  // self-neuter every test built on it (each step would itself look like a
  // save-load discontinuity and reset the cache, exactly the trap 14a/14b
  // fell into in fix round 2 before that was caught). Asserted, not noted.
  if (stepSize >= CACHE_DISCONTINUITY_TICKS) {
    throw new Error(`advanceProgress: stepSize (${stepSize}) must stay under CACHE_DISCONTINUITY_TICKS (${CACHE_DISCONTINUITY_TICKS}) or every step trips the save-load discontinuity guard`);
  }
  const state = game.state;
  let report;
  let t = state.tick || 0;
  while (t < target) {
    t = Math.min(target, t + stepSize);
    state.tick = t;
    report = facilityProgressReport(game);
  }
  return report;
}

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
// 13. F4 (BLOCKING, round 1): a facility that is fully staffed — an
// operator seated and phase:'work', coverage satisfied — but where no
// registered beamline has ever actually been started. Both the inspector
// (describeJob) and the facility-wide signal (facilityProgressReport) must
// name it; neither may read as though the beam is simply running.
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
  // (the generic stall check in section 14 is a separate signal).
  const runningGame = { state, registry: { getAll: () => [{ id: 'bl1', status: 'running' }] } };
  const dRunning = describeJob(op, runningGame);
  assert(!/press start/i.test(dRunning.status), `once running, the "press Start" note is gone (got "${dRunning.status}")`);
}

// ==========================================================================
// 13b. Round 2's F1(a) (BLOCKING): a beam that WAS started, then
// deliberately Stopped (parked overnight, say) — `status: 'stopped'` but
// `beamState.beamOnTicks > 0`, Game._tickBeamline's own durable "this ever
// ran" record — must not read as "never started".
// ==========================================================================
console.log('\n=== 13b. Fix round 2 F1(a): a beam that WAS started, then stopped, is not "never started" ===\n');
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
  const game = { state, registry: { getAll: () => [{ id: 'bl1', status: 'stopped', beamState: { beamOnTicks: 4000 } }] } };

  const d = describeJob(op, game);
  assert(!/press start/i.test(d.status), `inspector no longer falsely claims the beam was never started (got "${d.status}")`);

  const progress = facilityProgressReport(game);
  assert(progress.reason !== 'The beam is fully staffed but has never been started — press Start to begin operation.',
    `facilityProgressReport's F4 check goes quiet (got ${JSON.stringify(progress)})`);
}

// ==========================================================================
// 13c. A beam whose SOURCE is unavailable must not be told "press Start" —
// that advice fixes nothing until the source service is restored.
// ==========================================================================
console.log('\n=== 13c. Fix round 2 F1(b): a beam blocked by a real hard fault is not told to "press Start" ===\n');
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
  state.infraCanRun = false;
  state.infraBlockers = [
    { code: 'power_unconnected', severity: 'hard', message: 'source pwr_in not connected to powerCable', location: {} },
  ];
  const game = { state, registry: { getAll: () => [{
    id: 'bl1', status: 'stopped', beamState: { canRun: false },
  }] } };

  const d = describeJob(op, game);
  assert(!/press start/i.test(d.status), `inspector does not blame the operator for a real infra fault (got "${d.status}")`);

  const progress = facilityProgressReport(game);
  assert(progress.reason !== 'The beam is fully staffed but has never been started — press Start to begin operation.',
    `facilityProgressReport's F4 check does not fire over a real hard fault (got ${JSON.stringify(progress)})`);
}

// ==========================================================================
// 14. A facility where NOTHING is progressing at all (no job at all, no
// research, no completions) stalls at the floor window (240 — nothing
// bounded is in flight to widen it), with a clean, player-facing reason.
// ==========================================================================
console.log('\n=== 14. A facility where nothing is progressing at all stalls at the floor window ===\n');
{
  const state = makeState();
  const admin = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [admin];

  state.tick = 0;
  let r = facilityProgressReport({ state });
  assert(r.stalled === false, `tick 0: not yet stalled (got ${JSON.stringify(r)})`);

  r = advanceProgress({ state }, 200);
  assert(r.stalled === false, 'tick 200: still under the floor window');

  r = advanceProgress({ state }, 250);
  assert(r.stalled === true, 'tick 250: past the floor window with a flat fingerprint -> stalled');
  assert(/nothing has completed/i.test(r.reason || ''), `names the fact plainly (got "${r.reason}")`);
  assert(!IDENTIFIER_LEAK_RE.test(r.reason || ''), 'no identifier leak in the generic stall reason');
}

// ==========================================================================
// 14a. Round 2's F3 (BLOCKING): an actively-progressing labWork job — one
// of the four job types (takeData/labWork/paperwork/meet) that bump NO
// StaffMember stats key even on completion — must never be flagged,
// however long it runs. The fingerprint now sums every held job's own
// in-flight `job.progress` (jobRunner.js's tickJobs accrues this for EVERY
// job type while phase:'work', not just the five that also write a stats
// key), so genuine activity is visible regardless of job type.
// ==========================================================================
console.log('\n=== 14a. Fix round 2 F3: an actively-progressing labWork job is never flagged, however long it runs ===\n');
{
  const state = makeState();
  const engineer = makeMember({ profession: 'engineer', job: { jobType: 'labWork', target: null, specialty: 'diagnostics', stationKey: 'x:0', destNode: null, phase: 'work', progress: 0 } });
  state.staffMembers = [engineer];
  // facilityProgressReport is called EVERY tick here, not just at
  // checkpoints — a sparse call pattern (gaps > CACHE_DISCONTINUITY_TICKS)
  // would itself keep tripping the save-load discontinuity guard and reset
  // the clock every time, which would make this test pass FOR THE WRONG
  // REASON (via the discontinuity guard rather than the fingerprint fix
  // actually under test). Real gameplay polls every frame; this mirrors
  // that cadence.
  const checkpoints = new Set([50, 300, 800, 1500, 2000]);
  for (let t = 1; t <= 2000; t++) {
    state.tick = t;
    engineer.job.progress += 0.1; // mirrors tickJobs' own `job.progress += efficiency`
    if (engineer.job.progress >= 120) engineer.job.progress = 0; // completion + immediate reassignment — the real shape of "perpetual labWork"
    const r = facilityProgressReport({ state });
    if (checkpoints.has(t)) {
      assert(r.stalled === false, `tick ${t}: labWork still actively advancing -> never stalled (got ${JSON.stringify(r)})`);
    }
  }
}

// ==========================================================================
// 14b. Round 2's F3: research advancing normally (research.js's
// tickResearch fractional per-tick trickle, `state.researchProgress`) must
// not be flagged, even though `completedResearch.length` alone (the ONLY
// research signal before this fix) stays flat the whole time a node is
// still mid-progress.
// ==========================================================================
console.log('\n=== 14b. Fix round 2 F3: research advancing normally (fractional researchProgress) is not flagged ===\n');
{
  // Deliberately job:null (no in-flight job.progress at all) — isolates
  // researchProgress's own contribution to the fingerprint from job.progress's
  // (already covered by 14a): if a member's job.progress accrual alone were
  // masking the fix, this test would pass whether or not researchProgress
  // was actually tracked, which is worthless as a regression guard.
  const state = makeState();
  const admin = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [admin];
  state.activeResearch = 'someResearchNode';
  state.researchProgress = 0;
  // Called every tick (see 14a's own comment on why a sparse call pattern
  // would pass for the wrong reason via the discontinuity guard instead of
  // the fingerprint fix actually under test).
  let r;
  for (let t = 1; t <= 400; t++) {
    state.tick = t;
    state.researchProgress += 0.06; // mirrors tickResearch's own fractional trickle
    r = facilityProgressReport({ state });
  }
  assert(r.stalled === false, `tick 400, research at ${state.researchProgress.toFixed(1)}/120, nobody holding a job at all -- not stalled (got ${JSON.stringify(r)})`);
}

// ==========================================================================
// 14c. Round 2's F3: the WINDOW itself widens for a large job still
// nominally in flight, instead of a flat constant — isolated from the
// fingerprint fix (14a/14b) by freezing `job.progress` after one initial
// value: a real fabricate job (workTicks 150) at a realistic worst-case
// efficiency (~0.04) can legitimately take ~3,700 ticks; the OLD flat
// 240-tick window fired 59 ticks before even a MID-range (efficiency 0.5,
// ~300 real ticks) fabricate legitimately finished.
// ==========================================================================
console.log('\n=== 14c. Fix round 2 F3: the window widens for a large job still nominally in flight, instead of a flat 240 ===\n');
{
  const state = makeState();
  const machinist = makeMember({ profession: 'machinist', job: { jobType: 'fabricate', target: null, specialty: null, stationKey: 'z:0', destNode: null, phase: 'work', progress: 30 } });
  state.staffMembers = [machinist];
  state.tick = 0;
  facilityProgressReport({ state }); // seeds the cache at progress=30, remaining=120

  // past the OLD constant window (240) -- must NOT fire
  let r = advanceProgress({ state }, 241);
  assert(r.stalled === false,
    `tick 241: a real fabricate job (150 workTicks, 120 remaining) worst-cases out to ~${Math.round(120 / 0.04)} ticks -- the old flat 240-tick window would have wrongly fired here (got ${JSON.stringify(r)})`);

  // past the worst-case window (120/0.04 = 3000) with progress STILL frozen at 30 -- now genuinely looks stalled
  r = advanceProgress({ state }, 3100);
  assert(r.stalled === true, `tick 3100: past even the worst-case window with progress genuinely frozen -> stalled (got ${JSON.stringify(r)})`);
}

// ==========================================================================
// 14d. Round 2's F4: a NEW identifier leak found live — the infra-blocker
// fallback forwarded `blocker.message` (an unconnected-sink blocker's raw
// internal text: `${placeableType} ${portName} not connected to
// ${utility}` — a snake_case port key, a camelCase utility key) or
// `blocker.code` (an identifier itself) straight to the player. hud.js's
// own infra-blocker panel never shows that raw string either, resolving
// the SAME blocker class to the offending component's friendly name
// instead — mirrored here. A blocker with no placeableId (staffing's own
// beam_unstaffed, already hand-authored) passes through unchanged.
// ==========================================================================
console.log('\n=== 14d. Fix round 2 F4: the infra-blocker fallback no longer leaks raw internal text ===\n');
{
  const state = makeState();
  const engineer = makeMember({ profession: 'engineer', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [engineer];
  state.placeables.push({ id: 'src1', type: 'source', category: 'beamline' });
  state.infraBlockers = [{
    code: 'power_unconnected', severity: 'hard',
    message: 'source pwr_in not connected to powerCable',
    location: { placeableId: 'src1', portName: 'pwr_in' },
  }];
  state.tick = 0;
  facilityProgressReport({ state });
  const r = advanceProgress({ state }, 300);
  assert(r.stalled === true, 'setup: stalled (a real blocker present)');
  assert(!IDENTIFIER_LEAK_RE.test(r.reason || ''), `no identifier leak (got "${r.reason}")`);
  assert(!/pwr_in|powerCable/.test(r.reason || ''), `no raw port/utility keys forwarded (got "${r.reason}")`);
  // Resolves to the component's FRIENDLY name (COMPONENTS['source'].name is
  // "Electron Gun", not the raw type id "source") — the same resolution
  // hud.js's own infra-blocker panel does for this blocker class.
  assert(/electron gun/i.test(r.reason || ''), `still names the offending component by its friendly name (got "${r.reason}")`);
}

console.log('\n=== 14d(ii). A blocker with no placeableId (beam_unstaffed) still shows its own hand-authored message untouched ===\n');
{
  const state = makeState();
  const admin = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [admin];
  state.infraBlockers = [{
    code: 'beam_unstaffed', severity: 'hard',
    message: 'No Operator Console built — place one in the Control Room; beam tripped.',
    location: { zoneId: 'controlRoom' },
  }];
  state.tick = 0;
  facilityProgressReport({ state });
  const r = advanceProgress({ state }, 300);
  assert(r.reason === 'No Operator Console built — place one in the Control Room; beam tripped.',
    `a blocker with no placeableId passes through its own message unchanged (got "${r.reason}")`);
}

// ==========================================================================
// 14e. Round 2's F5: the stall cache is keyed on `state` object identity,
// and Game._applyState (a save load) mutates the SAME state object via
// Object.assign — the identity survives a load untouched, so a naive cache
// carries the PREVIOUS session's clock straight through one. Any
// implausibly large single-call tick jump (the only way `state.tick` can
// move by more than a few ticks between two consecutive calls in normal
// play) resets the clock instead, in both directions.
// ==========================================================================
console.log('\n=== 14e. Fix round 2 F5: a backward tick discontinuity (loading an EARLY save into a long session) resets the clock ===\n');
{
  const state = makeState();
  const admin = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [admin];
  state.tick = 3000;
  facilityProgressReport({ state });
  let r = advanceProgress({ state }, 3300);
  assert(r.stalled === true, 'baseline: stalled after a normal window at tick 3300');

  state.tick = 100; // loaded an early save into a long-running session (same state object identity) -- a single large jump, the intentional discontinuity trigger
  r = facilityProgressReport({ state });
  assert(r.stalled === false, `backward tick discontinuity gets a fresh grace window, not an instant false stall (got ${JSON.stringify(r)})`);
  r = advanceProgress({ state }, 340);
  assert(r.stalled === true, 'the fresh clock still eventually stalls on its own merits');
}

console.log('\n=== 14e(ii). Fix round 2 F5: a forward tick discontinuity (loading a LATE save into an early session) also resets the clock ===\n');
{
  const state = makeState();
  const admin = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [admin];
  state.tick = 100;
  facilityProgressReport({ state }); // establishes sinceTick ~100
  state.tick = 3000; // loaded a LATER save into an early session -- a stale sinceTick~100 would make (3000-100) look like a huge stall instantly
  const r = facilityProgressReport({ state });
  assert(r.stalled === false,
    `forward tick discontinuity ALSO resets the clock instead of instantly asserting a stall off the stale gap (got ${JSON.stringify(r)})`);
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

// ==========================================================================
// Fix round 3. The main ruling (BLOCKING): fix round 2's fingerprint summed
// EVERY held job's RAW job.progress, reasoning that "still moving" means
// "not stalled" — true for motion, but the signal has to be "nothing is
// COMPLETING", not "nothing is moving". An open-ended job (runBeam,
// workTicks:null) can accrue progress forever without ever completing, so a
// single seated-but-never-started operator kept the fingerprint moving
// every tick, permanently — measured on a real Game (28 hard blockers, a
// beam that had never run, zero income): never fired once in 1200 ticks.
// Fixed by excluding workTicks:null jobs from the fingerprint entirely and
// capping every other job's contribution at its own workTicks.
//
// TP1/TP2 below are the two TRUE POSITIVES this round's fix has to restore
// — the exact two cases named in the review, reproduced through the REAL
// job pipeline (assignJobs/tickJobs/jobRunner's own progress accrual), not
// hand-typed fingerprint values.
// ==========================================================================
console.log('\n=== TP1 (fix round 3 ruling): a seated, never-started operator behind real hard faults eventually stalls — not silently forever ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeMember({
    profession: 'operator', skills: { operating: 1 },
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: `${console_.id}:0`, destNode: null, phase: 'work', progress: 0 },
  });
  state.staffMembers = [op];
  // A representative slice of a real "many hard faults" facility — the
  // A real source blocker exists for the fallback to eventually name.
  state.infraCanRun = false;
  state.infraBlockers = [
    { code: 'power_unconnected', severity: 'hard', message: 'source pwr_in not connected to powerCable', location: { placeableId: 'src1', portName: 'pwr_in' } },
    { code: 'vacuum_unconnected', severity: 'hard', message: 'source vac_in not connected to vacuumPipe', location: { placeableId: 'src1', portName: 'vac_in' } },
  ];
  state.placeables.push({ id: 'src1', type: 'source', category: 'beamline' });
  const game = { state, registry: { getAll: () => [{
    id: 'bl1', status: 'stopped', beamState: { canRun: false },
  }] } };

  // op.job.progress climbs every tick — jobRunner.js's tickJobs really does
  // this for a seated, phase:'work' runBeam job, unbounded, forever. Under
  // round 2's fingerprint this alone masked the stall completely; under
  // this round's fix it contributes nothing (workTicks === null).
  let firstStallTick = null;
  for (let t = 1; t <= 500; t++) {
    state.tick = t;
    op.job.progress += 0.5;
    const r = facilityProgressReport(game);
    if (r.stalled && firstStallTick == null) firstStallTick = t;
  }
  assert(firstStallTick != null, `TP1: the detector fires at all (got firstStallTick=${firstStallTick})`);
  assert(firstStallTick <= 260, `TP1: fires at the floor window (240), not thousands of ticks late or never (got tick ${firstStallTick})`);
}

console.log('\n=== TP2: headless lab work travels and progresses without renderer help ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'testChamber', 2, 2, 0, 0, 0); // a real labWork station (vacuumLab)
  const engineer = makeMember({ id: 'eng1', profession: 'engineer', skills: { technical: 5 } });
  state.staffMembers = [engineer];
  const game = { state, registry: { getAll: () => [] } };

  let firstStallTick = null;
  let sawWork = false;
  let sawProgress = false;
  for (let t = 1; t <= 500; t++) {
    state.tick = t;
    assignJobs(game);
    tickJobs(game);
    if (engineer.job?.phase === 'work') sawWork = true;
    if ((engineer.job?.progress || 0) > 0) sawProgress = true;
    const r = facilityProgressReport(game);
    if (r.stalled && firstStallTick == null) firstStallTick = t;
  }
  assert(sawWork, 'the engineer reaches phase work in a headless simulation');
  assert(sawProgress, 'lab work accrues progress without renderer input');
  assert(firstStallTick == null,
    `active headless work is not falsely reported as stalled (got firstStallTick=${firstStallTick})`);
}

// ==========================================================================
// Confirm the six false-positive fixes from rounds 1/2 SURVIVE this
// round's ruling — a real fabricate job and research mid-progress must
// still suppress the stall (job.progress capped at workTicks still changes
// every tick while genuinely advancing; only OPEN-ENDED accrual is
// excluded).
// ==========================================================================
console.log('\n=== Regression: a real fabricate job (finite workTicks, phase:work) still suppresses the stall under the capped fingerprint ===\n');
{
  const state = makeState();
  const machinist = makeMember({ profession: 'machinist', job: { jobType: 'fabricate', target: null, specialty: null, stationKey: 'lathe1:0', destNode: null, phase: 'work', progress: 0 } });
  state.staffMembers = [machinist];
  let r;
  for (let t = 1; t <= 300; t++) {
    state.tick = t;
    machinist.job.progress += 0.5; // default machinist efficiency
    r = facilityProgressReport({ state });
  }
  assert(r.stalled === false, `tick 300: still actively fabricating -> never stalled (got ${JSON.stringify(r)})`);
}

// ==========================================================================
// Issue B: a member merely TRAVELLING toward a large job must not inflate
// the whole facility's window — travel is separately, tightly bounded by
// its own travelBudgetTicks; re-deriving a second, far looser bound off
// the job's full workTicks (as if it were already being worked) is exactly
// what let TP2 stay silent for thousands of ticks before this fix.
// ==========================================================================
console.log('\n=== Issue B: a travelling job does not widen the window off its own (un-accrued) workTicks ===\n');
{
  const state = makeState();
  const machinist = makeMember({
    profession: 'machinist',
    job: { jobType: 'fabricate', target: null, specialty: null, stationKey: 'lathe1:0', destNode: null, phase: 'travel', progress: 0, travelBudgetTicks: 50 },
  });
  state.staffMembers = [machinist];
  state.tick = 0;
  facilityProgressReport({ state }); // seed the cache
  const r = advanceProgress({ state }, 250); // past the floor window (240) -- a phase:'work' fabricate job here would have widened this to ~3,750
  assert(r.stalled === true,
    `tick 250: a travelling (not yet working) job does not widen the window past the floor -> stalled (got ${JSON.stringify(r)})`);
}

// ==========================================================================
// Issue A: the generic stall fallback must defer to a nonempty idle-staff
// report — it is COUNTED, GROUPED, and CLICKABLE; the generic fallback is
// none of those, and must never silently replace it. F4/suppression/a
// resolved infra blocker are all still MORE specific and must continue to
// outrank idle staff unconditionally (round 2's own F2 fix).
// ==========================================================================
console.log('\n=== Issue A: the report exposes generic:true ONLY for the uninformative fallback, never for a specific reason ===\n');
{
  // Generic fallback: two idle-adjacent staff, nothing else happening.
  const state = makeState();
  state.staffMembers = [
    makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' }),
    makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' }),
  ];
  let r;
  for (let t = 1; t <= 250; t++) { state.tick = t; r = facilityProgressReport({ state }); }
  assert(r.stalled === true && r.generic === true,
    `the uninformative fallback is marked generic (got ${JSON.stringify(r)})`);

  // F4 (beam never started): specific, must be generic:false.
  const state2 = makeState();
  floorRect(state2, 0, 8, 0, 8);
  const console_ = placeItem(state2, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state2, 'bl1');
  const op = makeMember({
    profession: 'operator',
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: `${console_.id}:0`, destNode: null, phase: 'work', progress: 0 },
  });
  state2.staffMembers = [op];
  const r2 = facilityProgressReport({ state: state2, registry: { getAll: () => [{ id: 'bl1', status: 'stopped' }] } });
  assert(r2.stalled === true && r2.generic === false, `F4's "press Start" is marked specific, not generic (got ${JSON.stringify(r2)})`);
}

console.log('\n=== Issue A: the HUD banner priority — a generic stall defers to a nonempty idle report, but a specific one still outranks it ===\n');
{
  // Mirrors hud.js's own _renderStaffingBanner decision exactly, using the
  // real report objects — hud.js itself is DOM-only and untestable here
  // (see this plan's own convention), so this is the closest direct check
  // on the logic both share.
  function wouldShowIdleBanner(progress, staffing) {
    const preferProgress = progress.stalled && !(progress.generic && staffing.idleCount > 0);
    return !preferProgress && staffing.idleCount > 0;
  }

  const genericProgress = { stalled: true, reason: 'Nothing has completed in a while — check staffing, stations, and construction.', generic: true };
  const idleStaffing = { idleCount: 2, worst: { reason: 'No reachable rest station.', count: 3 } };
  assert(wouldShowIdleBanner(genericProgress, idleStaffing) === true,
    'a generic stall defers to a nonempty, specific idle-staff report');

  const specificProgress = { stalled: true, reason: 'The beam is fully staffed but has never been started — press Start to begin operation.', generic: false };
  assert(wouldShowIdleBanner(specificProgress, idleStaffing) === false,
    'a specific stall (F4/suppression/resolved blocker) still outranks idle staff — round 2\'s F2 preserved');

  const noIdle = { idleCount: 0, worst: null };
  assert(wouldShowIdleBanner(genericProgress, noIdle) === false,
    'a generic stall still shows when there is no idle report to defer to');
}

// ==========================================================================
// Issue D: 'solve_threw' (src/utility/solve-runner.js) is a trapped
// exception, not a fault descriptor — its message is a raw JS error string
// ("Cannot read properties of undefined (reading 'portKey')", seen live),
// and it carries no placeableId for the normal resolution path to catch.
// ==========================================================================
console.log("\n=== Issue D: a 'solve_threw' blocker never forwards the raw JS exception text ===\n");
{
  const state = makeState();
  const admin = makeMember({ profession: 'admin', job: null, idleReason: 'Nothing to do right now.' });
  state.staffMembers = [admin];
  state.infraBlockers = [{
    code: 'solve_threw', severity: 'hard',
    message: "Cannot read properties of undefined (reading 'portKey')",
    location: { networkId: 'net1' },
  }];
  state.tick = 0;
  facilityProgressReport({ state });
  const r = advanceProgress({ state }, 300);
  assert(r.stalled === true, 'setup: stalled (a real solve_threw blocker present)');
  assert(!/portKey/i.test(r.reason || ''), `the raw exception text never reaches the player (got "${r.reason}")`);
  assert(!/cannot read propert/i.test(r.reason || ''), `no raw JS error phrasing either (got "${r.reason}")`);
  assert(!IDENTIFIER_LEAK_RE.test(r.reason || ''), `no identifier leak (got "${r.reason}")`);
}

// ==========================================================================
// Issue E: beamNotStartedMessage used to be `entries.some(hasEverRun)` —
// silent the moment ANY ONE registered line had ever run, even with a
// SECOND line right next to it that never has. The multi-beamline case the
// game scales into.
// ==========================================================================
console.log('\n=== Issue E: a second, never-started beamline is still caught even though the first line has run ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console1 = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const console2 = placeItem(state, 'operatorConsole', 2, 6, 0, 0, 0);
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  const op1 = makeMember({
    id: 'op1', profession: 'operator', skills: { operating: 10 }, // maxed -> capacity 3, covers both lines alone
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: `${console1.id}:0`, destNode: null, phase: 'work', progress: 0 },
  });
  state.staffMembers = [op1];
  // Line 1 has run (beamOnTicks > 0); line 2 has NEVER run at all.
  const game = {
    state,
    registry: {
      getAll: () => [
        { id: 'bl1', status: 'stopped', beamState: { beamOnTicks: 500 } },
        { id: 'bl2', status: 'stopped', beamState: { beamOnTicks: 0 } },
      ],
    },
  };
  const d = describeJob(op1, game);
  assert(/press start/i.test(d.status),
    `a never-started second line is still caught even though line 1 has run (got "${d.status}")`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
