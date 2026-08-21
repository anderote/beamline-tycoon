// test/test-pawn-job-integration.js — pawn motion is a pure function of
// member.job (src/renderer3d/StaffPawns.js's _syncJob, staff-professions-3
// Task 3).
//
// Task 3 deleted the throwaway "no job system yet" driver
// (test-pawn-pathing.js used to cover its stand-down behavior in a scenario
// 9, now gone) and replaced it with _syncJob: a member with `job === null`
// ambles exactly as before; `phase: 'travel'` walks the pawn to
// `job.destNode` with no branching on jobType and no external call needed —
// assignJobs/jobRunner resolves the destination once at assignment time
// (a StationRef's own node for a station job, or — this fix round — the
// nearest reachable approach node outside a target job's real footprint,
// via jobs.js's approachCandidates) and the renderer just walks there;
// `phase: 'work'` holds the station's pose (or a plain working pose, for a
// target job with no StationRef to snap onto). Arrival and fromNode are now
// simulation-owned; these tests explicitly prove rendering never authors
// either field while still animating the visual pawn correctly.
//
// Same idiom as test-pawn-pathing.js: a minimal THREE stub (records
// geometry/hierarchy, tracks position/rotation as plain numbers, does NOT
// apply rotations) and hand-built states shaped like Game.state. Every
// assertion here is against the pawn record's own plain x/z/mode/
// stationKey/path fields or the member's own job/fromNode fields — never
// against mesh world transforms the stub can't compute.

import { StaffPawns, staffVisualLevel } from '../src/renderer3d/StaffPawns.js';
import { subtileToWorld } from '../src/game/staff/nav.js';
import { advanceStaffTravel } from '../src/game/staff/staffMovement.js';
import { getStationIndex, reserveStation } from '../src/game/staff/stations.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// --- Minimal THREE stub (same as test-pawn-pathing.js) ---------------------

class Vec3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { return this.set(s, s, s); }
}

class Obj3D {
  constructor() {
    this.position = new Vec3();
    this.rotation = new Vec3();
    this.scale = new Vec3().setScalar(1);
    this.children = [];
    this.parent = null;
    this.userData = {};
  }
  add(child) { child.parent = this; this.children.push(child); return this; }
  remove(child) {
    this.children = this.children.filter(c => c !== child);
    if (child.parent === this) child.parent = null;
    return this;
  }
}

class Group extends Obj3D {}

class Mesh extends Obj3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.isMesh = true;
    this.castShadow = false;
    this.receiveShadow = false;
  }
}

class BoxGeometry {
  constructor(w, h, d) { this.kind = 'box'; this.w = w; this.h = h; this.d = d; this.oy = 0; }
  translate(x, y) { this.oy += y; return this; }
  dispose() {}
}

class CylinderGeometry {
  constructor(rTop, rBot, h, segs) {
    this.kind = 'cyl';
    this.rTop = rTop; this.rBot = rBot; this.h = h; this.segs = segs;
    this.w = Math.max(rTop, rBot) * 2; this.d = this.w; this.oy = 0;
  }
  translate(x, y) { this.oy += y; return this; }
  dispose() {}
}

class MeshStandardMaterial {
  constructor(opts) { Object.assign(this, opts); }
  dispose() {}
}

class Color {
  constructor(css) {
    const hex = String(css).replace('#', '');
    this.r = parseInt(hex.slice(0, 2), 16) / 255;
    this.g = parseInt(hex.slice(2, 4), 16) / 255;
    this.b = parseInt(hex.slice(4, 6), 16) / 255;
  }
  getHSL(out) {
    const max = Math.max(this.r, this.g, this.b), min = Math.min(this.r, this.g, this.b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === this.r) h = (this.g - this.b) / d + (this.g < this.b ? 6 : 0);
      else if (max === this.g) h = (this.b - this.r) / d + 2;
      else h = (this.r - this.g) / d + 4;
      h /= 6;
    }
    out.h = h; out.s = s; out.l = l;
    return out;
  }
  setHSL(h, s, l) {
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) { this.r = this.g = this.b = l; return this; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    this.r = hue(p, q, h + 1 / 3);
    this.g = hue(p, q, h);
    this.b = hue(p, q, h - 1 / 3);
    return this;
  }
  getHexString() {
    const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return c(this.r) + c(this.g) + c(this.b);
  }
}

global.THREE = { Group, Mesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial, Color };

// --- State / world helpers (same idiom as test-pawn-pathing.js) ------------

function makeState(extra = {}) {
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
    cornerHeights: new Map(),
    navRevision: 0,
    ...extra,
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
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }

function makePawns(state) {
  const scene = { add() {} };
  const game = { state };
  return new StaffPawns(game, scene);
}

function sameNode(a, b) {
  return !!a && !!b && a.col === b.col && a.row === b.row
    && a.subCol === b.subCol && a.subRow === b.subRow;
}

console.log('\n=== 0. Pausing freezes pawn travel and its simulation-facing state ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const consoleEntry = placeItem(state, 'operatorConsole', 8, 8, 0, 0, 0);
  const member = { id: 'paused-staff', profession: 'operator', job: null };
  state.staffMembers = [member];
  bump(state);

  const ref = getStationIndex(state).byJob.runBeam[0];
  assertOk(reserveStation(state, ref.key, member.id), 'sanity: the queued station is reserved');
  member.job = { jobType: 'runBeam', target: null, specialty: null, stationKey: ref.key, destNode: ref.node, phase: 'travel', progress: 0 };

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get(member.id);
  const start = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  pawn.x = start.x; pawn.z = start.z;
  state.paused = true;

  pawns.update(1);
  assertOk(pawn.mode === 'idle' && pawn.path === null, 'a paused pawn does not begin its queued journey');
  assertOk(member.job.phase === 'travel', 'a paused pawn cannot visually arrive');
  assertOk(member.fromNode === undefined, 'the renderer does not author simulation position while paused');
  assertOk(pawn.x === start.x && pawn.z === start.z, 'a paused pawn stays at its current position');
  void consoleEntry;
}

console.log('\n=== 1. A travel job with a resolvable station walks the pawn there on its own, ending the path on the station anchor ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const consoleEntry = placeItem(state, 'operatorConsole', 8, 8, 0, 0, 0);
  const member = { id: 's1', profession: 'operator', job: null };
  state.staffMembers = [member];
  bump(state);

  const index = getStationIndex(state);
  const ref = (index.byJob.runBeam || [])[0];
  assertOk(!!ref, 'sanity: the console yields a runBeam station');
  assertOk(reserveStation(state, ref.key, 's1'), 'sanity: reservation succeeds (jobRunner would have done this at assignment time)');

  member.job = { jobType: 'runBeam', target: null, specialty: null, stationKey: ref.key, destNode: ref.node, phase: 'travel', progress: 0 };

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  // No sendToStation call from the test — the job alone must start the walk.
  pawns.update(0.02);
  assertOk(pawn.mode === 'pathWalk', 'the pawn starts walking on its own, driven purely by member.job');
  assertOk(pawn.stationKey === ref.key, 'the pawn tracks the job\'s own station key');
  assertOk(!!pawn.path && pawn.path.length > 0, 'a path was computed');
  const lastNode = pawn.path[pawn.path.length - 1];
  assertOk(sameNode(lastNode, ref.node), "the path ends exactly on the station's anchor node");

  console.log('\n=== 2. Rendering movement does not mutate simulation position ===\n');
  pawns.update(0.02);
  assertOk(member.fromNode === undefined,
    'member.fromNode remains untouched after the visual pawn moves');

  console.log('\n=== 3. Visual arrival holds the station pose without flipping simulation phase ===\n');
  let steps = 0;
  while (pawn.mode !== 'working' && steps < 4000) { pawns.update(0.02); steps++; }
  assertOk(pawn.mode === 'working', `the visual pawn arrived after ${steps} steps`);
  assertOk(member.job.phase === 'travel', 'visual arrival leaves job.phase owned by the simulation');
  assertOk(pawn.mode === 'working', 'the pawn itself is in working mode');
  assertOk(pawn.pendingStation?.key === ref.key, 'the pawn is holding the job\'s own station');
  assertOk(state.stationReservations[ref.key] === 's1', 'the reservation made at assignment time is still held — this file never released it');
  assertOk(pawn.pose === 'benchWork',
    'a console without a matching chair uses the standing work pose');

  member.job.phase = 'work';
  pawns.update(0.02);
  assertOk(pawn.mode === 'working', 'the published work phase keeps the pawn working');

  const worldAtAnchor = subtileToWorld(ref.node);
  const dist = Math.hypot(pawn.x - worldAtAnchor.x, pawn.z - worldAtAnchor.z);
  assertOk(dist < 1e-6, 'the pawn is standing exactly at the station anchor');

  console.log('\n=== 4. Clearing the job (as jobRunner.abandonJob would on completion) returns the pawn to ambling ===\n');
  // jobRunner.abandonJob releases the reservation itself before nulling
  // member.job — mirror that here rather than leaving a stale reservation
  // this file has no business touching.
  delete state.stationReservations[ref.key];
  member.job = null;

  steps = 0;
  while (pawn.mode === 'working' && steps < 10) { pawns.update(0.02); steps++; }
  assertOk(pawn.mode !== 'working', 'the pawn leaves working mode as soon as member.job clears');
  assertOk(pawn.stationKey === null, 'pawn.stationKey is cleared');
  assertOk(pawn.pendingStation === null, 'pawn.pendingStation is cleared');

  steps = 0;
  while (pawn.mode === 'idle' && steps < 4000) { pawns.update(0.02); steps++; }
  assertOk(pawn.mode === 'pathWalk', `with no job, the pawn resumes ambient wandering on its own (after ${steps} idle steps)`);
  void consoleEntry;
}

console.log('\n=== 5. Reassigning to a different station mid-walk reroutes the pawn without any external call ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  placeItem(state, 'operatorConsole', 10, 10, 0, 0, 0);
  const member = { id: 's1', profession: 'operator', job: null };
  state.staffMembers = [member];
  bump(state);

  const index = getStationIndex(state);
  const refs = index.byJob.runBeam || [];
  assertOk(refs.length === 2, 'sanity: two runBeam stations exist');
  const [refA, refB] = refs;
  reserveStation(state, refA.key, 's1');

  member.job = { jobType: 'runBeam', target: null, specialty: null, stationKey: refA.key, destNode: refA.node, phase: 'travel', progress: 0 };

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 6, row: 0, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  pawns.update(0.02);
  assertOk(pawn.stationKey === refA.key, 'sanity: the pawn is walking toward station A');

  // A needs-preemption style reassignment: the runner releases A and
  // reserves B, handing the member an entirely new job object, all before
  // the renderer ever sees an intermediate null.
  delete state.stationReservations[refA.key];
  reserveStation(state, refB.key, 's1');
  member.job = { jobType: 'runBeam', target: null, specialty: null, stationKey: refB.key, destNode: refB.node, phase: 'travel', progress: 0 };

  pawns.update(0.02);
  assertOk(pawn.stationKey === refB.key, 'the pawn switches to station B on the very next frame, with no sendToStation call from the test');

  let steps = 0;
  while (pawn.mode !== 'working' && steps < 4000) { pawns.update(0.02); steps++; }
  assertOk(pawn.mode === 'working', 'the pawn visually reaches the NEW station');
  assertOk(member.job.phase === 'travel', 'rerouted visual arrival still leaves simulation phase untouched');
  assertOk(pawn.pendingStation?.key === refB.key, 'the pawn is holding station B, not the one it was first sent toward');
}

console.log('\n=== 6. A target-addressed job (repair/commission — no StationRef, just a bare destNode) walks and arrives exactly like a station job ===\n');
{
  // repair/commission jobs carry `target: {beamlineId, nodeId}` and no
  // `stationKey` (see jobs.js's header) — jobRunner.js (this round's fix)
  // now resolves a plain destNode for these too, via jobs.js's
  // approachCandidates, and hands it to this file the exact same way a
  // station job's StationRef.node always was. This file must not care:
  // no pendingStation to snap onto, no facing to adopt, just walk to
  // destNode — see test-target-job-destination.js for
  // the real end-to-end version driven by jobRunner.assignJobs itself
  // rather than a hand-built job object.
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const destNode = { col: 6, row: 6, subCol: 0, subRow: 0 };
  const member = {
    id: 's1', profession: 'technician',
    job: { jobType: 'repair', target: { beamlineId: 'bl1', nodeId: 'mod1' }, specialty: null, stationKey: null, destNode, phase: 'travel', progress: 0 },
  };
  state.staffMembers = [member];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  pawns.update(0.02);
  assertOk(pawn.mode === 'pathWalk', 'the pawn starts walking toward the target job\'s destNode on its own');
  assertOk(pawn.pendingStation === null, 'no StationRef exists for a target job — pendingStation stays null throughout');

  let steps = 0;
  while (pawn.mode !== 'working' && steps < 4000) { pawns.update(0.02); steps++; }
  assertOk(member.job.phase === 'travel', `visual arrival leaves job.phase at travel (after ${steps} steps)`);
  assertOk(pawn.mode === 'working', 'the pawn is working');
  const worldAtDest = subtileToWorld(destNode);
  const dist = Math.hypot(pawn.x - worldAtDest.x, pawn.z - worldAtDest.z);
  assertOk(dist < 1e-6, 'the pawn is standing exactly at the resolved destNode');
}

console.log('\n=== 7. A job with no destNode at all (defensive floor — jobRunner should never hand one out) holds the pawn in place ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const member = {
    id: 's1', profession: 'technician',
    job: { jobType: 'repair', target: { beamlineId: 'bl1', nodeId: 'mod1' }, specialty: null, stationKey: null, destNode: null, phase: 'travel', progress: 0 },
  };
  state.staffMembers = [member];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 3, row: 3, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;
  const startX = pawn.x, startZ = pawn.z;

  for (let i = 0; i < 500; i++) pawns.update(0.02);

  assertOk(pawn.mode === 'idle', 'the pawn never starts an ambient wander while it still holds a job, even one with no destNode');
  assertOk(pawn.x === startX && pawn.z === startZ, 'the pawn never moves from where it started');
  assertOk(member.job != null && member.job.phase === 'travel',
    'member.job is left completely untouched');
}

console.log('\n=== 8. A station-addressed job whose declared station no longer resolves does not trust the cached destNode ===\n');
{
  // Regression guard: naively walking to job.destNode with no liveness
  // check at all would send the pawn onto a demolished station's now-empty
  // (ordinarily passable) subtile — the exact "work thin air" failure
  // _stationStillLive exists to prevent for the raw sendToStation seam.
  // job.destNode is a cache from assignment time; when job.stationKey no
  // longer resolves in the LIVE index, that cache must not be trusted,
  // station job or not.
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const staleDestNode = { col: 4, row: 4, subCol: 0, subRow: 0 }; // wherever the (now-gone) station used to be
  const member = {
    id: 's1', profession: 'operator',
    job: { jobType: 'runBeam', target: null, specialty: null, stationKey: 'demolished_console:0', destNode: staleDestNode, phase: 'travel', progress: 0 },
  };
  state.staffMembers = [member];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;
  const startX = pawn.x, startZ = pawn.z;

  for (let i = 0; i < 500; i++) pawns.update(0.02);

  assertOk(pawn.mode === 'idle', 'the pawn never walks toward a destNode whose station key does not resolve in the live index');
  assertOk(pawn.x === startX && pawn.z === startZ, 'the pawn never moves toward the stale destNode');
}

console.log('\n=== 9. A SECOND job at the SAME destination (the ordinary "job completes, gets re-offered the same station" case) still walks and arrives ===\n');
{
  // The bug this pins: the attempt throttle (pawn.jobAttemptDest/
  // jobAttemptRevision — see _syncJob's 'travel' branch) means "I already
  // tried THIS JOB'S destination and nothing in the world changed since" —
  // but it used to survive the job that set it. A member re-assigned a
  // brand new job whose destNode happens to equal the PREVIOUS job's exact
  // node — the routine case of the same desk/console/bench being offered
  // again in a facility where nothing was built in between, so navRevision
  // hasn't moved either — read as "already attempted, nothing to do" on
  // sight: _beginPathWalk never ran, job.phase never reached 'work', and
  // jobRunner's own travel-budget backstop abandoned the untouched job
  // forever, over and over. This is precisely how a staffer that
  // completes exactly one job and then loops "Gave up trying to get
  // there." forever slipped past every other scenario in this file: every
  // one of them either never completes a job at all, or reassigns to a
  // DIFFERENT destination (see scenario 5) — none of them re-offer the
  // IDENTICAL destination after a null gap, which is the one shape that
  // trips the stale cache.
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  placeItem(state, 'operatorConsole', 8, 8, 0, 0, 0);
  const member = { id: 's1', profession: 'operator', job: null };
  state.staffMembers = [member];
  bump(state);

  const index = getStationIndex(state);
  const ref = (index.byJob.runBeam || [])[0];
  assertOk(!!ref, 'sanity: the console yields a runBeam station');
  assertOk(reserveStation(state, ref.key, 's1'), 'sanity: reservation succeeds');

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  // Job A: walk to the console and arrive, exactly like scenario 1.
  member.job = { jobType: 'runBeam', target: null, specialty: null, stationKey: ref.key, destNode: ref.node, phase: 'travel', progress: 0 };
  let steps = 0;
  while (pawn.mode !== 'working' && steps < 4000) { pawns.update(0.02); steps++; }
  assertOk(pawn.mode === 'working' && member.job.phase === 'travel',
    `setup: job A visually arrives without mutating its phase (after ${steps} steps)`);
  member.job.phase = 'work';

  // Job A "completes": jobRunner.abandonJob releases the reservation and
  // nulls member.job — mirror that, then give the renderer exactly one
  // frame to process the null (this is where the throttle must reset).
  delete state.stationReservations[ref.key];
  member.job = null;
  pawns.update(0.02);
  assertOk(pawn.mode !== 'working', 'sanity: the pawn left working mode once job A cleared');

  // Job B: the SAME station, SAME destNode, and — critically — navRevision
  // has not moved (nothing was built or demolished between the two jobs,
  // the ordinary steady-state case). This is the exact shape that trips
  // the stale (destNode, revision) cache if it wasn't reset above.
  assertOk(reserveStation(state, ref.key, 's1'), 'sanity: the same station is reserved again for job B');
  member.job = { jobType: 'runBeam', target: null, specialty: null, stationKey: ref.key, destNode: ref.node, phase: 'travel', progress: 0 };

  steps = 0;
  while (pawn.mode === 'idle' && steps < 50) { pawns.update(0.02); steps++; }
  // The pawn never left the console between job A and job B (it was
  // standing exactly on the anchor when job A cleared), so job B's
  // "walk" is a zero-length path that resolves to 'working' within the
  // very same frame _syncJob starts it — 'pathWalk' would only be
  // observable here if the pawn had wandered off in between. Either
  // outcome proves it wasn't silently throttled; 'idle' is the one that
  // means the bug is back.
  assertOk(pawn.mode === 'pathWalk' || pawn.mode === 'working',
    `job B actually starts (or, being already there, instantly completes) instead of being silently throttled (mode is "${pawn.mode}" after ${steps} steps)`);

  steps = 0;
  while (pawn.mode !== 'working' && steps < 4000) { pawns.update(0.02); steps++; }
  assertOk(pawn.mode === 'working' && member.job.phase === 'travel',
    `job B visually arrives without mutating the new job — the staffer does a SECOND job (after ${steps} steps)`);
}

console.log('\n=== 10. Real staff interpolate simulation-published route nodes without renderer A* ===\n');
{
  const state = makeState({ speed: 1, tick: 0 });
  floorRect(state, 0, 8, 0, 8);
  const startNode = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const destNode = { col: 7, row: 7, subCol: 3, subRow: 3 };
  const member = {
    id: 'sim-published', profession: 'technician', fromNode: { ...startNode },
    job: {
      jobType: 'repair', target: null, specialty: null, stationKey: null,
      destNode, phase: 'travel', progress: 0,
    },
    _staffMotion: null,
    _staffPresentation: null,
  };
  state.staffMembers = [member];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get(member.id);
  pawns.update(0.02);
  assertOk(pawn.mode === 'travelWait', 'before the first sim step, presentation waits in place');
  assertOk(pawn.path === null, 'a simulation-positioned job never creates a renderer A* path');

  let simTicks = 0;
  while (member.job.phase === 'travel' && simTicks < 100) {
    state.tick++;
    const travel = advanceStaffTravel(state, member, destNode, 'job');
    if (travel.arrived) member.job.phase = 'work';
    for (let frame = 0; frame < 100; frame++) pawns.update(0.02);
    assertOk(pawn.path === null, `tick ${state.tick}: renderer path stays null`);
    simTicks++;
  }

  for (let frame = 0; frame < 200 && pawn.mode !== 'working'; frame++) pawns.update(0.02);
  const dest = subtileToWorld(destNode);
  assertOk(member.job.phase === 'work', 'only the simulation flips the job to work');
  assertOk(member._staffPresentation?.sequence > 0, 'simulation published movement snapshots');
  assertOk(pawn.mode === 'working', 'the visual pawn catches the published destination');
  assertOk(Math.hypot(pawn.x - dest.x, pawn.z - dest.z) < 1e-6,
    'presentation lands exactly on the authoritative destination');
}

console.log('\n=== 11. Staff visual levels respond to focus distance and zoom ===\n');
{
  const pawn = { x: 0, z: 0 };
  assertOk(staffVisualLevel(pawn, { x: 0, z: 0, zoom: 1 }) === 'near',
    'a centered pawn at normal zoom uses full detail');
  assertOk(staffVisualLevel({ x: 24, z: 0 }, { x: 0, z: 0, zoom: 1 }) === 'mid',
    'a farther pawn uses throttled articulated detail');
  assertOk(staffVisualLevel({ x: 50, z: 0 }, { x: 0, z: 0, zoom: 1 }) === 'far',
    'a distant pawn uses the one-mesh silhouette');
  assertOk(staffVisualLevel(pawn, { x: 0, z: 0, zoom: 0.3 }) === 'far',
    'a fully zoomed-out view simplifies the whole roster');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
