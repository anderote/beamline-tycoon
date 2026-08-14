// test/test-pawn-pathing.js — pawns follow nav paths and occupy stations
// (src/renderer3d/StaffPawns.js).
//
// Task 6 of the staff-professions-2 (nav-and-stations) plan: the payoff of
// the whole plan — pawns path through doorways to a station, reserve a slot,
// walk there, and sit down. Exercises StaffPawns headlessly against a
// minimal THREE stub (same idiom as test-staff-builder.js) and hand-built
// states shaped like Game.state (same idiom as test-staff-nav.js /
// test-staff-stations.js), asserting on the pawn's own x/z/heading/pose
// fields — plain numbers/strings the stub doesn't need to get rotation math
// right to observe.
//
// Scenarios 6 and 7 are fix-round-1 additions:
//   6. the seated hip's world Y (pawn.figure.group.position.y is a plain
//      number too — it's the OUTERMOST group's own translation, not a child
//      transform composed through rotation, so the stub's "doesn't apply
//      rotations to positions" limitation doesn't apply to it) must land at
//      the CHAIR's own seat height, not at 2x the rig's baked-in hip height.
//   7. demolishing a station mid-walk, leaving its subtile ordinarily
//      passable, must not let the pawn arrive and "work" the empty tile.

import { StaffPawns } from '../src/renderer3d/StaffPawns.js';
import { getNavGrid, subtileToWorld } from '../src/game/staff/nav.js';
import { getStationIndex, reserveStation } from '../src/game/staff/stations.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { staffStyleHipHeight, DEFAULT_STAFF_STYLE } from '../src/renderer3d/builders/staff-builder.js';

// 1 subtile = 0.5 world units — same convention seat.seatY (subtiles) is
// authored in and StaffPawns.js's _seatedYOffset converts through.
const SUB_UNIT = 0.5;

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// --- Minimal THREE stub ------------------------------------------------
// Enough for buildStaffFigure/applyPose to run: records geometry and
// hierarchy, and tracks position/rotation as plain numbers. Does NOT apply
// rotations to positions (same limitation test-staff-builder.js's stub has),
// so this file never asserts on mesh world placement — only on the pawn
// record's own x/z/heading/pose fields.

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

// --- State / world helpers (same idiom as test-staff-stations.js) ---------

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

// A sealed 2x3-tile chamber (cols 0-1, rows 0-2) inside a 3x3-tile room
// (cols 0-4, rows 0-2), walled on every side except the interior wall
// bisecting it — same shape test-staff-nav.js and test-staff-stations.js
// both use for their wall/door scenarios. Reachable only through a door at
// (1,1,'e').
function sealedChamber(state) {
  floorRect(state, 0, 4, 0, 2);
  const wall = (col, row, edge) => { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; };
  wall(0, 0, 'n'); wall(1, 0, 'n');
  wall(0, 2, 's'); wall(1, 2, 's');
  wall(0, 0, 'w'); wall(0, 1, 'w'); wall(0, 2, 'w');
  wall(1, 0, 'e'); wall(1, 1, 'e'); wall(1, 2, 'e'); // the bisecting wall
}

function makePawns(state) {
  const scene = { add() {} };
  const game = { state };
  return new StaffPawns(game, scene);
}

console.log('\n=== 1. setDestination paths through a doorway, not through the wall ===\n');
{
  const state = makeState();
  sealedChamber(state);
  state.doorOccupied['1,1,e'] = 'officeDoor';
  state.staffMembers = [{ id: 's1', profession: 'operator' }];

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  assertOk(!!pawn, 'sync spawns a pawn for the staff member');

  // Force a known start point inside the sealed chamber.
  const startNode = { col: 0, row: 1, subCol: 0, subRow: 0 };
  const startWorld = subtileToWorld(startNode);
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  const dest = { col: 4, row: 1, subCol: 3, subRow: 3 };
  pawns.setDestination('s1', dest);

  assertOk(!!pawn.path, 'setDestination produces a path');
  const nav = getNavGrid(state);
  const allPassable = pawn.path.every(n =>
    nav.passable.has(`${n.col},${n.row},${n.subCol},${n.subRow}`));
  assertOk(allPassable, 'every node on the path is passable');
  const last = pawn.path[pawn.path.length - 1];
  assertOk(
    last.col === dest.col && last.row === dest.row
      && last.subCol === dest.subCol && last.subRow === dest.subRow,
    'path ends on the requested destination',
  );
  const crossesAtDoor = pawn.path.some(n => n.col === 1 && n.row === 1 && n.subCol === 3);
  assertOk(crossesAtDoor, 'the path crosses the bisecting wall at the door subtile, not through it');

  console.log('\n=== 2. Advancing by many small dt steps lands the pawn within a subtile of the destination ===\n');
  for (let i = 0; i < 4000 && pawn.mode !== 'idle'; i++) pawns.update(0.02);
  const destWorld = subtileToWorld(dest);
  const distToDest = Math.hypot(pawn.x - destWorld.x, pawn.z - destWorld.z);
  assertOk(pawn.mode === 'idle', 'the pawn actually finished the walk (did not stall)');
  assertOk(distToDest < 0.5, `pawn lands within a subtile of the destination (dist ${distToDest.toFixed(3)})`);
  assertOk(pawn.pathIndex === pawn.path.length - 1, 'pathIndex is left at the end of the path');
}

console.log('\n=== 3. Resealing the route mid-walk releases the station reservation and clears the path ===\n');
{
  const state = makeState();
  sealedChamber(state);
  state.doorOccupied['1,1,e'] = 'officeDoor';
  placeItem(state, 'operatorConsole', 0, 1, 0, 0, 0); // inside the chamber
  state.staffMembers = [{ id: 's1', profession: 'operator' }];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');

  // Start OUTSIDE the chamber; the console is only reachable through the door.
  const startNode = { col: 4, row: 1, subCol: 3, subRow: 3 };
  const startWorld = subtileToWorld(startNode);
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  const index = getStationIndex(state);
  const ref = (index.byJob.runBeam || [])[0];
  assertOk(!!ref, 'sanity: the console yields a runBeam station');
  assertOk(reserveStation(state, ref.key, 's1'), 'sanity: reservation succeeds');

  pawns.sendToStation('s1', ref);
  assertOk(pawn.mode === 'pathWalk' && pawn.stationKey === ref.key,
    'pawn starts walking the path toward the station, holding the reservation');

  // One small step — nowhere near the door yet.
  pawns.update(0.02);
  assertOk(pawn.mode === 'pathWalk', 'sanity: still en route');

  // Wall the door back up mid-walk — an in-game demolish/rebuild — and bump
  // navRevision exactly like every structural edit does.
  delete state.doorOccupied['1,1,e'];
  state.wallOccupied['1,1,e'] = 'officeWall';
  bump(state);

  pawns.update(0.02);
  assertOk(state.stationReservations[ref.key] === undefined,
    'the reservation is released once the route is severed');
  assertOk(pawn.stationKey === null, 'pawn.stationKey is cleared');
  assertOk(pawn.path === null, 'pawn.path is cleared');
  assertOk(pawn.mode === 'idle', 'pawn falls back to idle rather than freezing mid-stride');
}

console.log('\n=== 4. Arrival pose matches the station: sit when seated, benchWork otherwise ===\n');
{
  // Real stations, not a fabricated ref — sendToStation now requires the
  // ref's key to actually resolve in the live index (fix-round-1, finding
  // 2), so a station that was never really placed can never be "arrived at".
  function arrivePose(withChair) {
    const state = makeState();
    floorRect(state, 0, 10, 0, 10);
    placeItem(state, 'desk', 5, 5, 0, 0, 0);
    if (withChair) {
      // Same adjacency test-staff-stations.js scenario 3 pins: one subtile
      // behind the desk's anchor, facing agreeing with it.
      placeItem(state, 'officeChair', 5, 4, 1, 2, 2);
    }
    state.staffMembers = [{ id: 's1', profession: 'operator' }];
    bump(state);

    const pawns = makePawns(state);
    pawns.sync();
    const pawn = pawns._pawns.get('s1');
    const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
    pawn.x = startWorld.x; pawn.z = startWorld.z;

    const index = getStationIndex(state);
    const ref = index.byJob.analyze?.[0];
    assertOk(!!ref && ref.seated === withChair,
      `sanity: desk resolves seated:${withChair} (${withChair ? 'with' : 'without'} a matching chair)`);

    pawns.sendToStation('s1', ref);
    for (let i = 0; i < 4000 && pawn.mode !== 'working'; i++) pawns.update(0.02);
    assertOk(pawn.mode === 'working', `sanity: pawn reached the ${withChair ? 'seated' : 'unseated'} station`);
    return pawn.pose;
  }

  assertOk(arrivePose(true) === 'sit', 'seated:true station -> pose sit');
  assertOk(arrivePose(false) === 'benchWork', 'seated:false station -> pose benchWork');
}

console.log('\n=== 5. Every reservation is released on destroy — via _destroyPawn and via sync() removal ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  state.staffMembers = [{ id: 's1', profession: 'operator' }, { id: 's2', profession: 'operator' }];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();

  const index = getStationIndex(state);
  const ref = (index.byJob.runBeam || [])[0];

  reserveStation(state, ref.key, 's1');
  const pawn1 = pawns._pawns.get('s1');
  pawn1.stationKey = ref.key; // simulate the pawn holding the reservation it made

  pawns._destroyPawn(pawn1);
  assertOk(state.stationReservations[ref.key] === undefined, '_destroyPawn releases every reservation the pawn held');

  reserveStation(state, ref.key, 's2');
  const pawn2 = pawns._pawns.get('s2');
  pawn2.stationKey = ref.key;
  state.staffMembers = state.staffMembers.filter(m => m.id !== 's2');
  pawns.sync();
  assertOk(state.stationReservations[ref.key] === undefined,
    'sync() dropping a staffer from the roster releases their reservation too, not just an explicit destroy');
}

console.log("\n=== 6. Seated hip lands at the chair's own seat height, not at 2x the rig's baked-in hip height ===\n");
{
  // Same desk anchor / chair adjacency test-staff-stations.js's scenario 3
  // uses: the desk's anchor resolves to {col:5,row:4,subCol:1,subRow:3},
  // facing 's', and the ONE subtile that matches it (adjacent + facing
  // agreement) is {col:5,row:4,subCol:1,subRow:2}, dir:2. Any seat-carrying
  // chair placed there matches — stations.js's findMatchingChair doesn't
  // care which chair "belongs" with a desk, only that it carries `seat`.
  const CHAIR_POS = { col: 5, row: 4, subCol: 1, subRow: 2, dir: 2 };

  function seatedHipWorldY(chairType) {
    const state = makeState();
    floorRect(state, 0, 10, 0, 10);
    placeItem(state, 'desk', 5, 5, 0, 0, 0);
    const chair = placeItem(state, chairType, CHAIR_POS.col, CHAIR_POS.row, CHAIR_POS.subCol, CHAIR_POS.subRow, CHAIR_POS.dir);
    state.staffMembers = [{ id: 's1', profession: 'operator' }];
    bump(state);

    const pawns = makePawns(state);
    pawns.sync();
    const pawn = pawns._pawns.get('s1');
    const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
    pawn.x = startWorld.x; pawn.z = startWorld.z;

    const index = getStationIndex(state);
    const ref = index.byJob.analyze?.[0];
    assertOk(!!ref && ref.seated === true && ref.seatPlaceableId === chair.id,
      `sanity: ${chairType} resolves as a real seated station (not a fabricated ref)`);

    pawns.sendToStation('s1', ref);
    for (let i = 0; i < 4000 && pawn.mode !== 'working'; i++) pawns.update(0.02);
    assertOk(pawn.mode === 'working', `sanity: pawn reached the ${chairType} station`);

    // pawn.figure.group.position.y is the OUTERMOST group's own translation
    // — set directly by _placeFigure, not a child transform the THREE stub
    // would need to compose a rotation through — so it's exact, no THREE
    // rotation math required to read it back.
    const groupY = pawn.figure.group.position.y;
    const hipY = staffStyleHipHeight(DEFAULT_STAFF_STYLE);
    return { groupY, hipWorldY: groupY + hipY, hipY, seatY: PLACEABLES[chairType].seat.seatY };
  }

  for (const chairType of ['officeChair', 'operatorChair']) {
    const { hipWorldY, hipY, seatY } = seatedHipWorldY(chairType);
    const seatWorldY = seatY * SUB_UNIT;
    // The rig can't sit a pawn BELOW its own natural hip height (see
    // _seatedYOffset's clamp) — officeChair's seat (0.4) is actually a hair
    // under this style's hip height (~0.406), so the target is whichever is
    // taller, same as the implementation's own Math.max.
    const target = Math.max(seatWorldY, hipY);
    const diff = Math.abs(hipWorldY - target);
    assertOk(diff < 0.01,
      `${chairType}: seated hip world Y (${hipWorldY.toFixed(4)}) matches its seat height (target ${target.toFixed(4)}, diff ${diff.toFixed(4)})`);

    // The bug fix-round-1 caught: yOffset === hipY unconditionally put the
    // hip at group.y(=hipY) + hipY(local, baked into the rig) = 2x hip
    // height, nowhere near the actual chair seat.
    const oldBuggyHipWorldY = hipY + hipY;
    assertOk(Math.abs(oldBuggyHipWorldY - seatWorldY) > 0.3,
      `sanity: ${chairType}'s old hipY-only offset (${oldBuggyHipWorldY.toFixed(4)}) really was far off the seat (${seatWorldY}) — this assertion is what fails against the pre-fix code`);
  }
}

console.log('\n=== 7. Demolishing the target station mid-walk (its subtile stays ordinarily passable) drops the pawn to idle, never "working" thin air ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const consoleEntry = placeItem(state, 'operatorConsole', 8, 8, 0, 0, 0);
  state.staffMembers = [{ id: 's1', profession: 'operator' }];
  bump(state);

  const pawns = makePawns(state);
  pawns.sync();
  const pawn = pawns._pawns.get('s1');
  const startWorld = subtileToWorld({ col: 0, row: 0, subCol: 0, subRow: 0 });
  pawn.x = startWorld.x; pawn.z = startWorld.z;

  const index = getStationIndex(state);
  const ref = (index.byJob.runBeam || [])[0];
  assertOk(!!ref, 'sanity: the console yields a runBeam station');
  assertOk(reserveStation(state, ref.key, 's1'), 'sanity: reservation succeeds');
  pawns.sendToStation('s1', ref);
  assertOk(pawn.mode === 'pathWalk', 'sanity: pawn starts walking toward the console');

  // Advance partway — nowhere near arrival yet.
  for (let i = 0; i < 5; i++) pawns.update(0.02);
  assertOk(pawn.mode === 'pathWalk', 'sanity: still en route');

  // Demolish the console: splice it out of placeables/placeableIndex/
  // subgridOccupied exactly like Game.removePlaceable would (mirrors
  // test-staff-stations.js's scenario 11), then bump navRevision like every
  // structural edit does. The vacated subtile is now ordinary passable
  // floor — nothing left to block a route to it — which is exactly the case
  // a plain route re-check can't catch on its own.
  const idx = state.placeables.findIndex(p => p.id === consoleEntry.id);
  state.placeables.splice(idx, 1);
  state.placeableIndex = {};
  state.placeables.forEach((p, i) => { state.placeableIndex[p.id] = i; });
  for (const key of Object.keys(state.subgridOccupied)) {
    if (state.subgridOccupied[key].id === consoleEntry.id) delete state.subgridOccupied[key];
  }
  bump(state);

  let everWorked = false;
  for (let i = 0; i < 4000 && pawn.mode === 'pathWalk'; i++) {
    pawns.update(0.02);
    if (pawn.mode === 'working') { everWorked = true; break; }
  }
  assertOk(!everWorked, 'the pawn never enters "working" at the demolished station');
  assertOk(pawn.mode === 'idle', 'the pawn falls back to idle instead of stalling in pathWalk or working');
  assertOk(pawn.stationKey === null, 'pawn.stationKey is cleared');
  assertOk(pawn.pendingStation === null, 'pawn.pendingStation is cleared');
  assertOk(state.stationReservations[ref.key] === undefined, 'the reservation is released');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
