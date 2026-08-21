// test/test-target-job-destination.js — end-to-end coverage for
// target-addressed jobs (repair/commission — no StationRef) getting a real,
// walkable destination.
//
// Fix round on staff-professions-3 Task 3: repair/commission jobs used to
// have NO resolvable destination at all — StaffPawns.js had nothing to walk
// to, so a technician assigned repair held position forever until
// jobRunner's own travel-budget backstop abandoned the job with "Gave up
// trying to get there.", only for assignJobs to immediately re-offer the
// identical job next pass. Real repairs could never complete.
//
// The fix: jobRunner.js resolves a concrete destNode at ASSIGNMENT time —
// jobs.js's own (now-exported) wall-aware approachCandidates perimeter walk
// for a target job, the StationRef's own node for a station job — and
// jobRunner advances to job.destNode uniformly, while StaffPawns presents
// the published state. This file drives the REAL assignJobs/tickJobs and a
// REAL StaffPawns instance together (not hand-built job objects —
// see test-pawn-job-integration.js for that, StaffPawns-only version) to
// prove the whole path actually closes:
//   1. a damaged component with a boxed-in origin corner but an otherwise
//      open perimeter is still assigned to a technician, who walks to a
//      real approach node outside the footprint (not the blocked corner),
//      reaches phase 'work' in simulation, and accrues progress.
//   2. a component whose ENTIRE perimeter is walled off produces NO
//      assignment at all, with a reason — never a job that gets taken and
//      then stalls (the exact failure this whole fix round exists to close).
//
// Fixture idiom matches test-job-runner.js (hand-built states/fake game,
// real StaffMember instances) plus test-pawn-pathing.js's THREE stub, both
// combined since this is the one place both halves of the seam are
// exercised together.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StaffMember } from '../src/game/staff/StaffMember.js';
import { assignJobs, tickJobs, registerJobEffect } from '../src/game/staff/jobRunner.js';
import { approachCandidates, footprintCellsOf } from '../src/game/staff/jobs.js';
import { getNavGrid, isReachable, subtileToWorld } from '../src/game/staff/nav.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { StaffPawns } from '../src/renderer3d/StaffPawns.js';

// --- Minimal THREE stub (same idiom as test-pawn-pathing.js) ---------------

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

// --- Fixture helpers (same idiom as test-job-runner.js) ---------------------

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

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }
function wall(state, col, row, edge) { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; }

function makeGame(state, beamlines = []) {
  return { state, registry: { getAll: () => beamlines } };
}

// A real 4x4-subtile electron-gun module ('source'), registered as its own
// beamline with seeded componentHealth for that one node — same convention
// test-job-runner.js's placeDamagedBeamline uses. `dir`/wall placement is
// the caller's own concern (see the two scenarios below).
function placeDamagedModule(state, beamlineId, col, row, health) {
  const mod = placeItem(state, 'source', col, row, 0, 0, 0);
  return { mod, beamline: { id: beamlineId, sourceId: mod.id, beamState: { componentHealth: { [mod.id]: health } } } };
}

const FLAT_SKILLS = { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 };

function makeTechnician(id) {
  return new StaffMember({ id, profession: 'technician', traits: [], skills: { ...FLAT_SKILLS }, rng: () => 0.5 });
}

function makePawns(state) {
  const scene = { add() {} };
  const game = { state };
  return new StaffPawns(game, scene);
}

// ---------------------------------------------------------------------------
test('a damaged module with a boxed-in origin corner but an open perimeter is assigned, walked to, and worked', () => {
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);

  // 'source' is a 4x4-subtile module — exactly one whole tile (5,5). Wall
  // off the north and west edges (the two sides touching the module's own
  // ORIGIN subtile, col:5,row:5,subCol:0,subRow:0) while leaving south and
  // east open: a naive "probe only the origin corner's neighbors" approach
  // check (the bug Task 1's own fix round found and closed in jobs.js's
  // approachCandidates) would conclude this module is unreachable outright.
  // The real perimeter walk must not: south/east are real, walkable
  // approach nodes.
  const { mod, beamline } = placeDamagedModule(state, 'bl-1', 5, 5, 40);
  wall(state, 5, 5, 'n');
  wall(state, 5, 5, 'w');
  bump(state);

  const game = makeGame(state, [beamline]);
  const technician = makeTechnician('t1');
  // Reachable only via the open south/east sides.
  technician.fromNode = { col: 8, row: 8, subCol: 0, subRow: 0 };
  state.staffMembers = [technician];

  assignJobs(game);
  assert.equal(technician.job?.jobType, 'repair', `technician was assigned repair (got ${technician.job?.jobType})`);
  assert.equal(technician.job?.phase, 'travel', "a freshly-assigned job starts in phase 'travel'");
  assert.ok(technician.job?.destNode, 'the job carries a resolved destNode');

  // The destNode must be a real approach candidate (outside the footprint,
  // wall-aware) — not fabricated, not the module's own (blocked) origin
  // subtile — and reachable from the technician's own position.
  const nav = getNavGrid(state);
  const cells = footprintCellsOf(mod);
  const candidates = approachCandidates(nav, state, cells);
  const destNode = technician.job.destNode;
  assert.ok(candidates.some(n => n.col === destNode.col && n.row === destNode.row
    && n.subCol === destNode.subCol && n.subRow === destNode.subRow),
    'destNode is one of the real wall-aware approach candidates outside the footprint');
  assert.ok(isReachable(nav, technician.fromNode, destNode), 'destNode is actually reachable from the technician');
  // Sanity: the blocked corner itself never resolves as the destination —
  // confirms this isn't the pre-fix "probe the origin corner" behavior.
  assert.notEqual(`${destNode.col},${destNode.row}`, '5,5', 'destNode is not inside the module\'s own blocked tile');

  // Advance the real simulation and let the renderer present its state.
  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('t1');
  const startWorld = subtileToWorld(technician.fromNode);
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  let steps = 0;
  while (technician.job.phase !== 'work' && steps < 200) {
    tickJobs(game);
    pawns.update(0.02);
    steps++;
  }
  pawns.update(0.02);
  assert.equal(technician.job.phase, 'work', `simulation reached phase 'work' after ${steps} ticks`);
  assert.equal(pawn.mode, 'working', 'the pawn is in working mode');
  const worldAtDest = subtileToWorld(destNode);
  const dist = Math.hypot(pawn.x - worldAtDest.x, pawn.z - worldAtDest.z);
  assert.ok(dist < 1e-6, 'the pawn is standing exactly at the resolved destNode');

  // Progress actually accrues once jobRunner starts ticking work — this is
  // the concrete proof repair can now complete at all, not just "arrive".
  let completions = 0;
  registerJobEffect('repair', () => { completions++; });
  const before = technician.job.progress;
  for (let t = 0; t < 5; t++) tickJobs(game);
  assert.ok(technician.job.progress > before, 'work phase accrues progress toward completion');

  const workTicksNeeded = Math.ceil(100 / technician.efficiency(0, null)); // generous upper bound
  let completedAtTick = -1;
  for (let t = 0; t < workTicksNeeded + 20 && completedAtTick < 0; t++) {
    tickJobs(game);
    if (technician.job === null) completedAtTick = t;
  }
  assert.ok(completedAtTick >= 0, `the repair job actually completes (at tick ${completedAtTick})`);
  assert.equal(completions, 1, 'the repair completion effect fired exactly once');
});

// ---------------------------------------------------------------------------
test('a module walled off on every side produces no assignment at all, with a reason — never a job that stalls', () => {
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);

  const { mod, beamline } = placeDamagedModule(state, 'bl-1', 5, 5, 40);
  wall(state, 5, 5, 'n');
  wall(state, 5, 5, 'e');
  wall(state, 5, 5, 's');
  wall(state, 5, 5, 'w');
  bump(state);
  void mod;

  const game = makeGame(state, [beamline]);
  const technician = makeTechnician('t1');
  technician.fromNode = { col: 8, row: 8, subCol: 0, subRow: 0 };
  state.staffMembers = [technician];

  assignJobs(game);
  assert.equal(technician.job, null, 'no job is assigned — the sealed component was never offered at all');
  assert.ok(technician.idleReason, 'idleReason explains why');
  assert.match(technician.idleReason, /unreachable|no clear path/i,
    `idleReason names the reachability problem (got "${technician.idleReason}")`);

  // The negative case this whole fix round exists to prevent: re-running
  // assignJobs (simulating further ticks) must not somehow start assigning
  // and abandoning this job in a loop — it should just keep reporting the
  // same "nothing to do" state, tick after tick.
  for (let t = 0; t < 20; t++) {
    assignJobs(game);
    tickJobs(game);
  }
  assert.equal(technician.job, null, 'still no job after repeated ticks — no assign/abandon loop');
});
