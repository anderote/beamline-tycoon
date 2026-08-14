// test/test-staff-stations.js — the station index, seat matching, and slot
// reservations (src/game/staff/stations.js).
//
// Task 4 of the staff-professions-2 (nav-and-stations) plan. Builds small
// hand-made states (plain objects shaped like Game.state, not full Game
// instances) rather than routing everything through Game, matching
// test-staff-nav.js's pattern.

import {
  buildStationIndex, getStationIndex, reserveStation, releaseStation,
  releaseAllFor, findStation, sanitizeStationReservations,
} from '../src/game/staff/stations.js';
import { getNavGrid, findPath } from '../src/game/staff/nav.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

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
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

function bump(state) { state.navRevision = (state.navRevision | 0) + 1; }

function cellsInclude(cells, node) {
  return cells.some(c => c.col === node.col && c.row === node.row && c.subCol === node.subCol && c.subRow === node.subRow);
}

console.log('\n=== 1. operatorConsole yields one runBeam StationRef, outside the footprint ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const entry = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const nav = getNavGrid(state);
  const index = buildStationIndex(state);

  const refs = index.byJob.runBeam || [];
  assertOk(refs.length === 1, `exactly one runBeam StationRef (got ${refs.length})`);
  const ref = refs[0];
  assertOk(ref.key === `${entry.id}:0`, 'key is placeableId:slotIndex');
  assertOk(ref.defId === 'operatorConsole', 'defId matches');
  assertOk(!ref.seated, 'operatorConsole anchor with no chair resolves seated:false');
  assertOk(!cellsInclude(entry.cells, ref.node), "node lies outside the console's own footprint");
  assertOk(nav.passable.has(`${ref.node.col},${ref.node.row},${ref.node.subCol},${ref.node.subRow}`), 'node is on a passable subtile');
  // Hand-derived from the def-local anchor {subCol:1, subRow:-1, facing:'s'}
  // on a subW:3 x subL:2 footprint at dir:0 — see task-4-report.md.
  assertOk(ref.node.col === 2 && ref.node.row === 1 && ref.node.subCol === 1 && ref.node.subRow === 3,
    `node is the exact expected subtile (got ${JSON.stringify(ref.node)})`);
  assertOk(ref.facing === 's', `facing is 's' (got ${ref.facing})`);
}

console.log('\n=== 2. Rotated consoles (dir 1/2/3): anchors still outside the footprint, passable, and land exactly where rotation predicts ===\n');
{
  // Hand-derived per-dir expectations (see task-4-report.md for the
  // derivation): same origin (2,2,0,0) reused for all four dirs purely to
  // exercise the resolver's rotation math in isolation from in-game
  // placement centering, which is not this module's concern.
  const expected = {
    1: { node: { col: 2, row: 2, subCol: 2, subRow: 1 }, facing: 'w' },
    2: { node: { col: 2, row: 2, subCol: 1, subRow: 2 }, facing: 'n' },
    3: { node: { col: 1, row: 2, subCol: 3, subRow: 1 }, facing: 'e' },
  };
  for (const dir of [1, 2, 3]) {
    const state = makeState();
    floorRect(state, 0, 8, 0, 8);
    const entry = placeItem(state, 'operatorConsole', 2, 2, 0, 0, dir);
    const nav = getNavGrid(state);
    const index = buildStationIndex(state);
    const ref = (index.byJob.runBeam || [])[0];
    assertOk(!!ref, `dir ${dir}: a StationRef is produced`);
    if (!ref) continue;
    assertOk(!cellsInclude(entry.cells, ref.node), `dir ${dir}: node lies outside the footprint`);
    assertOk(nav.passable.has(`${ref.node.col},${ref.node.row},${ref.node.subCol},${ref.node.subRow}`), `dir ${dir}: node is passable`);
    const exp = expected[dir];
    assertOk(ref.node.col === exp.node.col && ref.node.row === exp.node.row
      && ref.node.subCol === exp.node.subCol && ref.node.subRow === exp.node.subRow,
      `dir ${dir}: node matches the hand-derived rotation (expected ${JSON.stringify(exp.node)}, got ${JSON.stringify(ref.node)})`);
    assertOk(ref.facing === exp.facing, `dir ${dir}: facing matches (expected ${exp.facing}, got ${ref.facing})`);
  }
}

console.log('\n=== 3. desk + officeChair seat matching ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const desk = placeItem(state, 'desk', 5, 5, 0, 0, 0);
  // Anchor resolves to {col:5,row:4,subCol:1,subRow:3}, facing 's' (same math
  // as scenario 1). A chair one tile south of that anchor, at the desk's own
  // tile (5,5) but outside the desk's own footprint (subRow 3, footprint
  // only covers subRow 0-1), facing 'n' (its unrotated default) points
  // exactly at the anchor tile (5,4).
  const chair = placeItem(state, 'officeChair', 5, 5, 1, 3, 0);

  let index = buildStationIndex(state);
  let ref = index.byJob.analyze?.[0];
  assertOk(!!ref, 'desk yields a StationRef under job analyze');
  assertOk(ref.seated === true, 'desk resolves seated:true with a facing chair on the adjacent tile');
  assertOk(ref.seatPlaceableId === chair.id, 'seatPlaceableId is the chair');
  assertOk(ref.node.col === chair.col && ref.node.row === chair.row
    && ref.node.subCol === chair.subCol && ref.node.subRow === chair.subRow,
    "seated ref's node is the chair's subtile, not the desk's anchor");
  assertOk(ref.facing === 'n', "seated ref's facing is the chair's resolved facing");

  const navSeated = getNavGrid(state);
  const from = { col: 5, row: 8, subCol: 0, subRow: 0 };
  assertOk(!!findPath(navSeated, from, ref.node), 'findPath to the chair succeeds — the chair-passability regression test');

  // Rotate the chair away (dir 2: seat.facing 'n' -> 's', which no longer
  // points at the anchor tile) — the desk should fall back to seated:false.
  chair.dir = 2;
  chair.cells = PLACEABLES.officeChair.footprintCells(chair.col, chair.row, chair.subCol, chair.subRow, chair.dir);
  bump(state);
  index = buildStationIndex(state);
  ref = index.byJob.analyze?.[0];
  assertOk(!!ref, 'desk still yields a StationRef after the chair rotates away');
  assertOk(ref.seated === false, 'desk falls back to seated:false once the chair no longer faces it');
  assertOk(ref.seatPlaceableId === null, 'seatPlaceableId is cleared');
  assertOk(ref.node.col === 5 && ref.node.row === 4 && ref.node.subCol === 1 && ref.node.subRow === 3,
    "seated:false ref's node targets the desk's own anchor instead");
  assertOk(ref.facing === 's', "seated:false ref's facing is the desk anchor's own facing");
}

console.log('\n=== 4. Chair subtiles are passable; desk subtiles are not ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const desk = placeItem(state, 'desk', 5, 5, 0, 0, 0);
  const chair = placeItem(state, 'officeChair', 5, 5, 1, 3, 0);
  const nav = getNavGrid(state);
  assertOk(nav.passable.has(`${chair.col},${chair.row},${chair.subCol},${chair.subRow}`), 'the chair subtile is passable');
  assertOk(!nav.passable.has(`${desk.col},${desk.row},${desk.subCol},${desk.subRow}`), "the desk's own subtile is not passable");
}

console.log('\n=== 5. diningTable (seated:required) with no chairs is absent; one chair makes one slot usable ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  const table = placeItem(state, 'diningTable', 8, 8, 0, 0, 0);

  let index = buildStationIndex(state);
  assertOk(!index.byJob.eat || index.byJob.eat.length === 0, 'diningTable with no chairs contributes zero StationRefs');
  assertOk(!index.byKey[`${table.id}:0`], 'no key for the table appears in the index at all');

  // anchors[1] = {subCol:1, subRow:-1, facing:'s'} resolves to tile (8,7) —
  // distinct from anchors 0/2/3's tiles, which (for this 2x2 table) land
  // back on the table's own tile (8,8) or its other neighbors, so a chair
  // matching this one anchor cannot accidentally double-match another slot.
  // A chair on the table's own tile (8,8), outside the table's footprint
  // (subCol/subRow 3), facing 'n' (unrotated default) points exactly at
  // anchor1's tile (8,7).
  const chair = placeItem(state, 'cafeteriaChair', 8, 8, 3, 3, 0);
  bump(state);
  index = buildStationIndex(state);
  const refs = index.byJob.eat || [];
  assertOk(refs.length === 1, `adding one matching chair yields exactly one usable slot (got ${refs.length})`);
  if (refs.length === 1) {
    assertOk(refs[0].key === `${table.id}:1`, 'the usable slot is anchors[1]');
    assertOk(refs[0].seated === true && refs[0].seatPlaceableId === chair.id, 'it resolves seated:true with the new chair');
  }
}

console.log('\n=== 6. getStationIndex memoises on navRevision ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const first = getStationIndex(state);
  const second = getStationIndex(state);
  assertOk(first === second, 'unchanged navRevision returns the identical index object');
  bump(state);
  const third = getStationIndex(state);
  assertOk(third !== first, 'a bumped navRevision produces a fresh index');
}

console.log('\n=== 7. reserveStation / releaseStation / releaseAllFor ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const a = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const b = placeItem(state, 'operatorConsole', 6, 6, 0, 0, 0);
  const keyA = `${a.id}:0`;
  const keyB = `${b.id}:0`;

  assertOk(reserveStation(state, keyA, 's1') === true, 'first reservation succeeds');
  assertOk(reserveStation(state, keyA, 's2') === false, 'a second staffer cannot reserve an already-held slot');
  assertOk(reserveStation(state, keyA, 's1') === true, 're-reserving your own slot succeeds');

  assertOk(releaseStation(state, keyA, 's2') === false, 'release by a non-holder returns false');
  assertOk(state.stationReservations[keyA] === 's1', 'a failed release by a non-holder leaves the holder intact');
  assertOk(releaseStation(state, keyA, 's1') === true, 'release by the actual holder succeeds');
  assertOk(state.stationReservations[keyA] === undefined, 'the slot is free after release');

  reserveStation(state, keyA, 's1');
  reserveStation(state, keyB, 's1');
  reserveStation(state, keyB, 's3'); // no-op: s1 still holds keyB
  releaseAllFor(state, 's1');
  assertOk(state.stationReservations[keyA] === undefined, 'releaseAllFor clears the first station held by the staffer');
  assertOk(state.stationReservations[keyB] === undefined, 'releaseAllFor clears the second station held by the staffer');
}

console.log('\n=== 8. findStation skips a reserved station and returns the next nearest ===\n');
{
  const state = makeState();
  floorRect(state, 0, 20, 0, 20);
  const near = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  const far = placeItem(state, 'operatorConsole', 15, 15, 0, 0, 0);
  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };

  let ref = findStation(state, { jobs: ['runBeam'], fromNode: from, staffId: 's1' });
  assertOk(!!ref && ref.placeableId === near.id, 'the nearest unreserved station is returned first');

  reserveStation(state, `${near.id}:0`, 's1');
  ref = findStation(state, { jobs: ['runBeam'], fromNode: from, staffId: 's2' });
  assertOk(!!ref && ref.placeableId === far.id, 'a station reserved by someone else is skipped for the next-nearest');

  ref = findStation(state, { jobs: ['runBeam'], fromNode: from, staffId: 's1' });
  assertOk(!!ref && ref.placeableId === near.id, "the holder's own findStation still finds their reserved station");
}

console.log('\n=== 9. findStation returns null when the only station is walled off, and finds it once a door opens ===\n');
{
  // Same sealed 2x3-chamber shape as test-staff-nav.js's wall/door scenario:
  // a console inside a room walled on every side but one interior wall,
  // reachable only through a door.
  const state = makeState();
  floorRect(state, 0, 4, 0, 2);
  const wall = (col, row, edge) => { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; };
  wall(0, 0, 'n'); wall(1, 0, 'n');
  wall(0, 2, 's'); wall(1, 2, 's');
  wall(0, 0, 'w'); wall(0, 1, 'w'); wall(0, 2, 'w');
  wall(1, 0, 'e'); wall(1, 1, 'e'); wall(1, 2, 'e'); // the bisecting wall

  placeItem(state, 'operatorConsole', 0, 1, 0, 0, 0);
  const from = { col: 4, row: 1, subCol: 3, subRow: 3 };

  let ref = findStation(state, { jobs: ['runBeam'], fromNode: from, staffId: 's1' });
  assertOk(ref === null, 'no door -> findStation returns null even though a matching station exists');

  state.doorOccupied['1,1,e'] = 'officeDoor';
  bump(state);
  ref = findStation(state, { jobs: ['runBeam'], fromNode: from, staffId: 's1' });
  assertOk(!!ref, 'a door in the bisecting wall makes the station findable');
}

console.log('\n=== 10. Loading a state drops reservations naming a demolished station or a fired staffer ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console1 = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  state.staffMembers = [{ id: 's1' }, { id: 's2' }];
  bump(state);
  const index = getStationIndex(state);
  const liveKey = Object.keys(index.byKey)[0];
  assertOk(!!liveKey, 'sanity: the live station has at least one key');

  state.stationReservations = {
    [liveKey]: 's1',                 // valid: live station, roster staffer
    'operatorConsole_demolished:0': 's1', // stale: no such station in the index
    [liveKey + '_bogus']: 's1',       // stale: key not in the index (variant)
  };
  // Fired staffer still holding a (separately) valid key.
  const secondConsole = placeItem(state, 'operatorConsole', 6, 6, 0, 0, 0);
  bump(state);
  const index2 = getStationIndex(state);
  const secondKey = Object.keys(index2.byKey).find(k => k.startsWith(secondConsole.id));
  state.stationReservations[secondKey] = 'firedGuy';
  state.staffMembers = [{ id: 's1' }]; // s2/firedGuy no longer on the roster

  sanitizeStationReservations(state);

  assertOk(state.stationReservations[liveKey] === 's1', 'a reservation naming a live station and a rostered staffer survives');
  assertOk(!('operatorConsole_demolished:0' in state.stationReservations), 'a reservation naming a demolished station is dropped');
  assertOk(!((liveKey + '_bogus') in state.stationReservations), 'a reservation with a key absent from the index is dropped');
  assertOk(!(secondKey in state.stationReservations), 'a reservation held by a staffer no longer on the roster is dropped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
