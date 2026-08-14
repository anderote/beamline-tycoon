// test/test-staff-nav.js — subtile nav grid + A* (src/game/staff/nav.js).
//
// Task 2 of the staff-professions-2 (nav-and-stations) plan. Nothing consumes
// this yet; it's the foundation a later task drives pawns with. Builds small
// hand-made states (plain objects shaped like Game.state, not full Game
// instances) rather than routing everything through Game.

import {
  buildNavGrid, getNavGrid, findPath, isReachable,
  worldToSubtile, subtileToWorld,
} from '../src/game/staff/nav.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// A minimal Game.state stand-in. Every field nav.js reads is present, even
// when empty, so buildNavGrid never has to guess at a missing map.
function makeState() {
  return {
    infraOccupied: {},
    wallOccupied: {},
    doorOccupied: {},
    subgridOccupied: {},
    placeableIndex: {},
    placeables: [],
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

// Place a real placeable (by catalogue id) into subgridOccupied/placeables,
// exactly like Game._placePlaceableInner does, so nav.js's def resolution
// through placeableIndex -> PLACEABLES[entry.type] is exercised for real.
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

// Sum of nav.cost for every node ENTERED along a path (excludes the start,
// which is where the pawn already stands).
function pathCost(nav, path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += nav.cost.get(`${path[i].col},${path[i].row},${path[i].subCol},${path[i].subRow}`);
  }
  return total;
}

console.log('\n=== 1. Straight-line path across an open floor ===\n');
{
  const state = makeState();
  floorRect(state, 0, 4, 0, 0);
  const nav = buildNavGrid(state);
  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const to = { col: 4, row: 0, subCol: 3, subRow: 0 };
  const path = findPath(nav, from, to);
  assertOk(!!path, 'path found across 5 open floor tiles');
  // absCol 0 -> 19 (4*4+3): 20 nodes inclusive.
  assertOk(path.length === 20, `path has the expected length (got ${path && path.length})`);
  assertOk(path[0].col === 0 && path[0].subCol === 0, 'path starts at the origin');
  const last = path[path.length - 1];
  assertOk(last.col === 4 && last.subCol === 3, 'path ends at the goal');
}

console.log('\n=== 2/3. Wall bisecting a sealed room, then a door reopening it ===\n');
{
  // A 2x3-tile chamber (cols 0-1, rows 0-2) walled on its north, south and
  // west sides plus the interior wall bisecting it from a 3x3-tile room
  // (cols 0-4, rows 0-2) — otherwise a single interior wall does nothing:
  // with no perimeter, a pawn just detours around it through the grass
  // margin the bounds inflate adds. Sealing the chamber on the other three
  // sides matches how real facility rooms are walled and is what actually
  // makes "the far side" unreachable.
  const state = makeState();
  floorRect(state, 0, 4, 0, 2);
  const wall = (col, row, edge) => { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; };
  wall(0, 0, 'n'); wall(1, 0, 'n');
  wall(0, 2, 's'); wall(1, 2, 's');
  wall(0, 0, 'w'); wall(0, 1, 'w'); wall(0, 2, 'w');
  wall(1, 0, 'e'); wall(1, 1, 'e'); wall(1, 2, 'e'); // the bisecting wall

  const from = { col: 0, row: 1, subCol: 0, subRow: 0 };
  const to = { col: 4, row: 1, subCol: 3, subRow: 3 };

  const navSealed = buildNavGrid(state);
  assertOk(findPath(navSealed, from, to) === null, 'no door -> findPath returns null');
  assertOk(isReachable(navSealed, from, to) === false, 'no door -> isReachable is false');

  state.doorOccupied['1,1,e'] = 'officeDoor';
  state.navRevision++;
  const navOpen = buildNavGrid(state);
  const path = findPath(navOpen, from, to);
  assertOk(!!path, 'a door in the bisecting wall makes the far side reachable');
  assertOk(isReachable(navOpen, from, to) === true, 'isReachable agrees');
  const crossesAtDoor = path.some(n => n.col === 1 && n.row === 1 && n.subCol === 3)
    && path.some(n => n.col === 2 && n.row === 1 && n.subCol === 0);
  assertOk(crossesAtDoor, "the path crosses through the door's tile pair (the only opening)");
}

console.log('\n=== 4. Routes around a blocking 3x2 placeable ===\n');
{
  const state = makeState();
  floorRect(state, 0, 4, 0, 2);
  // desk: subW 3 x subL 2, anchored at tile (2,1) subCol0/subRow0 -> blocks
  // subtiles (2,1,{0,1,2},{0,1}), leaving subCol3 and subRow{2,3} open in
  // that tile.
  placeItem(state, 'desk', 2, 1, 0, 0, 0);
  const nav = buildNavGrid(state);

  const blocked = ['2,1,0,0', '2,1,1,0', '2,1,2,0', '2,1,0,1', '2,1,1,1', '2,1,2,1'];
  for (const key of blocked) {
    assertOk(!nav.passable.has(key), `desk cell ${key} is not passable`);
  }

  // Straight line from (1,1,3,0) to (3,1,0,0) would cross directly through
  // the desk's blocked row (subRow 0) if it ignored occupancy.
  const from = { col: 1, row: 1, subCol: 3, subRow: 0 };
  const to = { col: 3, row: 1, subCol: 0, subRow: 0 };
  const path = findPath(nav, from, to);
  assertOk(!!path, 'a path around the desk exists');
  const wentThroughDesk = path.some(n => blocked.includes(`${n.col},${n.row},${n.subCol},${n.subRow}`));
  assertOk(!wentThroughDesk, 'the path detours around the desk rather than crossing it');
}

console.log('\n=== 5. A stackable desktop item does not block ===\n');
{
  const state = makeState();
  floorRect(state, 0, 1, 0, 0);
  placeItem(state, 'coffeeMachine', 0, 0, 1, 1, 0);
  const nav = buildNavGrid(state);
  assertOk(nav.passable.has('0,0,1,1'), 'the subtile under a stackable coffee machine stays passable');
  const path = findPath(nav, { col: 0, row: 0, subCol: 0, subRow: 0 }, { col: 1, row: 0, subCol: 3, subRow: 3 });
  assertOk(!!path, 'a path still exists across the tile the coffee machine sits on');
}

console.log('\n=== 6. Detached floor patch across grass; floor is preferred over grass ===\n');
{
  const state = makeState();
  // Two floor blocks separated by a 4-tile-wide grass gap (cols 2-5), plus a
  // floored detour one row south (row 1, cols 1-6) connecting them. The
  // direct route crosses 16 grass subtiles (cost 2.5 each); the floored
  // detour is longer in step count but every step costs 1.
  floorRect(state, 0, 1, 0, 0);
  floorRect(state, 6, 6, 0, 0);
  floorRect(state, 1, 6, 1, 1);
  const nav = buildNavGrid(state);

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const to = { col: 6, row: 0, subCol: 0, subRow: 0 };

  assertOk(isReachable(nav, from, to), 'the detached floor patch is reachable across bare ground');
  const path = findPath(nav, from, to);
  assertOk(!!path, 'findPath finds a route to the detached patch');
  const actualCost = pathCost(nav, path);

  // The forced-grass baseline: straight across row 0 (both endpoints share
  // subRow 0), ignoring the floored detour entirely.
  const forced = [];
  for (let absCol = 0; absCol <= 6 * 4; absCol++) {
    forced.push({ col: Math.floor(absCol / 4), row: 0, subCol: absCol % 4, subRow: 0 });
  }
  const forcedCost = pathCost(nav, forced);

  assertOk(actualCost < forcedCost,
    `the chosen route (cost ${actualCost}) beats the forced-grass route (cost ${forcedCost})`);
}

console.log('\n=== 7. worldToSubtile / subtileToWorld round-trip ===\n');
{
  const nodes = [
    { col: 0, row: 0, subCol: 0, subRow: 0 },
    { col: 3, row: 2, subCol: 3, subRow: 1 },
    { col: -4, row: 6, subCol: 2, subRow: 3 },
    { col: 8, row: -5, subCol: 1, subRow: 0 },
    { col: -2, row: -2, subCol: 0, subRow: 2 },
  ];
  for (const n of nodes) {
    const world = subtileToWorld(n);
    const back = worldToSubtile(world.x, world.z);
    assertOk(back.col === n.col && back.row === n.row && back.subCol === n.subCol && back.subRow === n.subRow,
      `round-trips (${n.col},${n.row},${n.subCol},${n.subRow}) via world (${world.x},${world.z})`);
  }
}

console.log('\n=== 8. getNavGrid memoises on navRevision ===\n');
{
  const state = makeState();
  floorRect(state, 0, 2, 0, 0);
  const first = getNavGrid(state);
  const second = getNavGrid(state);
  assertOk(first === second, 'second call with unchanged navRevision returns the identical object');

  state.navRevision++;
  const third = getNavGrid(state);
  assertOk(third !== first, 'a bumped navRevision produces a fresh grid');
}

console.log('\n=== 9. A goal outside bounds returns null rather than hanging ===\n');
{
  const state = makeState();
  floorRect(state, 0, 2, 0, 0);
  const nav = buildNavGrid(state);
  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const farGoal = { col: 10000, row: 10000, subCol: 0, subRow: 0 };
  assertOk(findPath(nav, from, farGoal) === null, 'findPath returns null for a goal outside bounds');
  assertOk(isReachable(nav, from, farGoal) === false, 'isReachable agrees');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
