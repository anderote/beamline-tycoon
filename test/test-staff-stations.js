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

// Shared by scenarios 3 and 4: the desk anchor resolves to
// {col:5,row:4,subCol:1,subRow:3}, facing 's' (same math as scenario 1's
// operatorConsole). A chair must sit at the ONE subtile that is (a)
// cardinally adjacent to the anchor's subtile and (b) resolves to the SAME
// facing as the anchor ('s') — i.e. the subtile immediately behind the
// anchor, continuing the same line the anchor already looks along (desk ->
// anchor -> chair, all facing south). That pins the chair to
// {col:5,row:4,subCol:1,subRow:2}, one subtile further north than the
// anchor, dir:2 (seat.facing 'n' rotates to 's'). A chair anywhere else —
// including the desk's own tile on the FAR side of the desk from the
// anchor, which used to satisfy a tile-granularity "faces the anchor's
// tile" check by matching straight through the desk itself — must NOT
// match.
const DESK_ANCHOR = { col: 5, row: 4, subCol: 1, subRow: 3 };
const MATCHING_CHAIR_POS = { col: 5, row: 4, subCol: 1, subRow: 2, dir: 2 };

console.log('\n=== 3. desk + officeChair seat matching ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const desk = placeItem(state, 'desk', 5, 5, 0, 0, 0);
  const chair = placeItem(state, 'officeChair', MATCHING_CHAIR_POS.col, MATCHING_CHAIR_POS.row,
    MATCHING_CHAIR_POS.subCol, MATCHING_CHAIR_POS.subRow, MATCHING_CHAIR_POS.dir);

  let index = buildStationIndex(state);
  let ref = index.byJob.analyze?.[0];
  assertOk(!!ref, 'desk yields a StationRef under job analyze');
  assertOk(ref.seated === true, 'desk resolves seated:true with a facing chair at the correct adjacent subtile');
  assertOk(ref.seatPlaceableId === chair.id, 'seatPlaceableId is the chair');
  assertOk(ref.node.col === chair.col && ref.node.row === chair.row
    && ref.node.subCol === chair.subCol && ref.node.subRow === chair.subRow,
    "seated ref's node is the chair's subtile, not the desk's anchor");
  assertOk(ref.facing === 's', "seated ref's facing is the chair's resolved facing");
  assertOk(Object.isFrozen(ref), 'the returned StationRef is frozen — callers must not stamp state on it');

  const navSeated = getNavGrid(state);
  const from = { col: 5, row: 8, subCol: 0, subRow: 0 };
  assertOk(!!findPath(navSeated, from, ref.node), 'findPath to the chair succeeds — the chair-passability regression test');

  // Rotate the chair to face 'n' instead of 's' — it no longer agrees with
  // the anchor's own facing, so it must stop matching even though it is
  // still sitting at the one geometrically-adjacent subtile.
  chair.dir = 0;
  chair.cells = PLACEABLES.officeChair.footprintCells(chair.col, chair.row, chair.subCol, chair.subRow, chair.dir);
  bump(state);
  index = buildStationIndex(state);
  ref = index.byJob.analyze?.[0];
  assertOk(!!ref, 'desk still yields a StationRef after the chair rotates away');
  assertOk(ref.seated === false, 'desk falls back to seated:false once the chair no longer agrees in facing');
  assertOk(ref.seatPlaceableId === null, 'seatPlaceableId is cleared');
  assertOk(ref.node.col === DESK_ANCHOR.col && ref.node.row === DESK_ANCHOR.row
    && ref.node.subCol === DESK_ANCHOR.subCol && ref.node.subRow === DESK_ANCHOR.subRow,
    "seated:false ref's node targets the desk's own anchor instead");
  assertOk(ref.facing === 's', "seated:false ref's facing is the desk anchor's own facing");
}

console.log('\n=== 3b. A chair on the desk\'s FAR side (matching only "through" the furniture) does not match ===\n');
{
  // Regression for the tile-granularity bug: a chair south of the desk,
  // outside the desk's own footprint, whose facing 'n' resolved-tile-level
  // math used to satisfy "chair tile + facing delta == anchor tile" even
  // though the desk itself sits physically between the chair and the
  // anchor. Subtile-adjacency + facing-agreement must reject this.
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  placeItem(state, 'desk', 5, 5, 0, 0, 0);
  placeItem(state, 'officeChair', 5, 5, 1, 3, 0); // south of the desk, facing 'n' (default)

  const index = buildStationIndex(state);
  const ref = index.byJob.analyze?.[0];
  assertOk(!!ref, 'desk still yields a StationRef');
  assertOk(ref.seated === false, "a chair on the desk's far side does not match through the furniture");
}

console.log('\n=== 4. Chair subtiles are passable; desk subtiles are not ===\n');
{
  const state = makeState();
  floorRect(state, 0, 10, 0, 10);
  const desk = placeItem(state, 'desk', 5, 5, 0, 0, 0);
  const chair = placeItem(state, 'officeChair', MATCHING_CHAIR_POS.col, MATCHING_CHAIR_POS.row,
    MATCHING_CHAIR_POS.subCol, MATCHING_CHAIR_POS.subRow, MATCHING_CHAIR_POS.dir);
  const nav = getNavGrid(state);
  assertOk(nav.passable.has(`${chair.col},${chair.row},${chair.subCol},${chair.subRow}`), 'the chair subtile is passable');
  assertOk(!nav.passable.has(`${desk.col},${desk.row},${desk.subCol},${desk.subRow}`), "the desk's own subtile is not passable");
}

console.log('\n=== 5. diningTable (seated:required): absent with no chairs, one slot with one chair, four DISTINCT slots with four chairs ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  const table = placeItem(state, 'diningTable', 8, 8, 0, 0, 0);

  let index = buildStationIndex(state);
  assertOk(!index.byJob.eat || index.byJob.eat.length === 0, 'diningTable with no chairs contributes zero StationRefs');
  assertOk(!index.byKey[`${table.id}:0`], 'no key for the table appears in the index at all');

  // One chair placed at exactly the subtile anchors[0] requires (same
  // "one subtile behind the anchor, same facing" rule as scenario 3) —
  // {subCol:0,subRow:2,facing:'n'} pins the chair to (8,8,0,3), dir:0
  // (default facing 'n' already agrees).
  const chair0 = placeItem(state, 'cafeteriaChair', 8, 8, 0, 3, 0);
  bump(state);
  index = buildStationIndex(state);
  let refs = index.byJob.eat || [];
  assertOk(refs.length === 1, `adding one matching chair yields exactly one usable slot (got ${refs.length})`);
  if (refs.length === 1) {
    assertOk(refs[0].key === `${table.id}:0`, 'the usable slot is anchors[0]');
    assertOk(refs[0].seated === true && refs[0].seatPlaceableId === chair0.id, 'it resolves seated:true with the new chair');
  }

  // Add the other three anchors' matching chairs — each independently
  // computed the same way (Critical-1 regression: previously ALL FOUR
  // slots would resolve to the SAME first-found chair and the SAME node).
  const chair1 = placeItem(state, 'cafeteriaChair', 8, 7, 1, 2, 2);  // anchors[1]: {1,-1,'s'}
  const chair2 = placeItem(state, 'cafeteriaChair', 7, 8, 2, 0, 1);  // anchors[2]: {-1,0,'e'}
  const chair3 = placeItem(state, 'cafeteriaChair', 8, 8, 3, 1, 3);  // anchors[3]: {2,1,'w'}
  bump(state);
  index = buildStationIndex(state);
  refs = index.byJob.eat || [];
  assertOk(refs.length === 4, `all four anchors are now seated (got ${refs.length})`);

  const seatIds = new Set(refs.map(r => r.seatPlaceableId));
  const nodeKeys = new Set(refs.map(r => `${r.node.col},${r.node.row},${r.node.subCol},${r.node.subRow}`));
  assertOk(seatIds.size === 4, `all four slots hold DISTINCT chairs (got ${seatIds.size} distinct ids)`);
  assertOk(nodeKeys.size === 4, `all four slots target DISTINCT nodes (got ${nodeKeys.size} distinct nodes)`);
  assertOk(refs.every(r => r.seated === true), 'every slot resolved seated:true');
  assertOk([chair0.id, chair1.id, chair2.id, chair3.id].every(id => seatIds.has(id)),
    'each of the four placed chairs was actually claimed by some slot');
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
    [liveKey]: 's1',                      // valid: live station, roster staffer
    'operatorConsole_demolished:0': 's1', // stale: no such station was ever in the index
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
  assertOk(!(secondKey in state.stationReservations), 'a reservation held by a staffer no longer on the roster is dropped');
}

console.log('\n=== 11. getStationIndex prunes a reservation mid-session when its (required) chair is demolished — not just at load ===\n');
{
  // Distinct from scenario 10: no sanitizeStationReservations/load call at
  // all here — a plain getStationIndex() rebuild (the same one findStation
  // and every other caller triggers) must itself drop a reservation whose
  // key stopped resolving, so a demolished-then-replaced chair can never
  // resurrect a stale claim from a job that ended long ago.
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const table = placeItem(state, 'diningTable', 2, 2, 0, 0, 0);
  const chair = placeItem(state, 'cafeteriaChair', 2, 2, 0, 3, 0); // anchors[0], as in scenario 5
  state.staffMembers = [{ id: 's1' }];
  bump(state);

  const index = getStationIndex(state);
  const key = Object.keys(index.byKey).find(k => k.startsWith(table.id));
  assertOk(!!key, 'sanity: the seated slot is in the index before demolition');
  reserveStation(state, key, 's1');
  assertOk(state.stationReservations[key] === 's1', 'sanity: the reservation is recorded');

  // Demolish the chair: splice it out of placeables/placeableIndex exactly
  // like Game.removePlaceable would, then bump navRevision as every
  // structural mutation does.
  const chairIdx = state.placeables.findIndex(p => p.id === chair.id);
  state.placeables.splice(chairIdx, 1);
  state.placeableIndex = {};
  state.placeables.forEach((p, i) => { state.placeableIndex[p.id] = i; });
  bump(state);

  // No sanitizeStationReservations call — just the ordinary memoised lookup.
  const rebuilt = getStationIndex(state);
  assertOk(!rebuilt.byKey[key], 'the slot dropped out of the index once its required chair was demolished');
  assertOk(!(key in state.stationReservations), 'and getStationIndex itself already pruned the now-dead reservation');
}

console.log('\n=== 12. findStation guards a missing fromNode instead of throwing ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  let threw = false;
  let result;
  try {
    result = findStation(state, { jobs: ['runBeam'], staffId: 's1' }); // fromNode omitted
  } catch (e) {
    threw = true;
  }
  assertOk(!threw, 'findStation does not throw when fromNode is omitted');
  assertOk(result === null, 'findStation returns null for a missing fromNode');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
