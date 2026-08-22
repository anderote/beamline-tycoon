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
// when empty, so buildNavGrid never has to guess at a missing map. No
// mapHalfExtent by default — most scenarios below want the fallback
// content-bbox bounds so a tiny hand-built floor patch still has room to
// path across the surrounding "grass"; pass { mapHalfExtent } explicitly
// for scenarios that need the real Game.js bounds behaviour.
function makeState(extra = {}) {
  return {
    infraOccupied: {},
    wallOccupied: {},
    doorOccupied: {},
    subgridOccupied: {},
    placeableIndex: {},
    placeables: [],
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

console.log('\n=== 5. Floor-placed props block instead of being walked through ===\n');
{
  const state = makeState();
  floorRect(state, 0, 1, 0, 0);
  placeItem(state, 'coffeeMachine', 0, 0, 1, 1, 0);
  const nav = buildNavGrid(state);
  assertOk(!nav.passable.has('0,0,1,1'), 'the subtile under a floor-placed coffee machine is blocked');
  const path = findPath(nav, { col: 0, row: 0, subCol: 0, subRow: 0 }, { col: 1, row: 0, subCol: 3, subRow: 3 });
  assertOk(!!path, 'a path still exists across the tile the coffee machine sits on');
}

console.log('\n=== 5a. A single door opens only its authored half of the wall edge ===\n');
{
  const state = makeState({
    doors: [{ type: 'officeDoor', col: 0, row: 0, edge: 'e', off: 0 }],
  });
  state.wallOccupied['0,0,e'] = 'officeWall';
  state.doorOccupied['0,0,e'] = 'officeDoor';
  const nav = buildNavGrid(state);
  assertOk(!nav.edgeBlocked({ col: 0, row: 0, subCol: 3, subRow: 0 }, 'e'),
    'the first lane crosses through an off=0 single door');
  assertOk(!nav.edgeBlocked({ col: 0, row: 0, subCol: 3, subRow: 1 }, 'e'),
    'the second lane crosses through the same opening');
  assertOk(nav.edgeBlocked({ col: 0, row: 0, subCol: 3, subRow: 2 }, 'e'),
    'the third lane remains blocked by the solid wall beside the door');
  assertOk(nav.edgeBlocked({ col: 0, row: 0, subCol: 3, subRow: 3 }, 'e'),
    'the fourth lane remains blocked too');
  assertOk(!nav.edgeBlocked({ col: 1, row: 0, subCol: 0, subRow: 0 }, 'w'),
    'the mirrored approach sees the identical open lane');
}

console.log('\n=== 5b. Drawn beam pipe is a physical staff obstacle ===\n');
{
  const state = makeState({
    beamPipes: [{ id: 'bp_1', path: [{ col: 1, row: 1 }, { col: 3, row: 1 }] }],
  });
  floorRect(state, 0, 4, 0, 2);
  const nav = buildNavGrid(state);
  assertOk(!nav.passable.has('2,1,1,1') && !nav.passable.has('2,1,2,2'),
    'staff clearance cells around the pipe axis are blocked');
  const from = { col: 0, row: 1, subCol: 0, subRow: 2 };
  const to = { col: 4, row: 1, subCol: 3, subRow: 2 };
  const path = findPath(nav, from, to);
  assertOk(!!path, 'a route around the pipe still exists');
  assertOk(path.every(node => nav.passable.has(`${node.col},${node.row},${node.subCol},${node.subRow}`)),
    'the route never crosses the pipe clearance cells');
}

console.log('\n=== 6a. Detached floor patch is reachable across bare ground ===\n');
{
  // Two floor tiles with nothing but grass between them, and no floored
  // alternative route at all — the only way across is 16 grass subtiles.
  // Pinned to the exact optimal cost (48: 3 + 4 floor-leg subtiles at cost 1,
  // 16 grass subtiles at cost 2.5, 1 more floor subtile landing on the
  // patch) rather than a loose inequality, so a regression that silently
  // changes the cost model gets caught here.
  const state = makeState();
  floorRect(state, 0, 1, 0, 0);
  floorRect(state, 6, 6, 0, 0);
  const nav = buildNavGrid(state);

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const to = { col: 6, row: 0, subCol: 0, subRow: 0 };

  assertOk(isReachable(nav, from, to), 'the detached floor patch is reachable across bare ground');
  const path = findPath(nav, from, to);
  assertOk(!!path, 'findPath finds a route to the detached patch');
  const actualCost = pathCost(nav, path);
  assertOk(actualCost === 48, `the route costs exactly 48, all grass (got ${actualCost})`);
}

console.log('\n=== 6b. Floor is preferred over grass along a non-detouring route ===\n');
{
  // A floored L (rightward along row 0, then downward along col 6) is one
  // of many equally-short MONOTONIC routes from (0,0) to (6,4) — every
  // monotonic route covers the same 46 subtiles, so even a heavily-weighted
  // heuristic has no geometric reason to avoid it, and the true cost
  // difference (floor vs grass) is what decides.
  const state = makeState();
  floorRect(state, 0, 6, 0, 0); // rightward run
  floorRect(state, 6, 6, 0, 4); // downward run
  const nav = buildNavGrid(state);

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const to = { col: 6, row: 4, subCol: 3, subRow: 3 };
  const manhattanSubtiles = Math.abs((6 * 4 + 3) - (0 * 4 + 0)) + Math.abs((4 * 4 + 3) - (0 * 4 + 0));

  const path = findPath(nav, from, to);
  assertOk(!!path, 'a path along the floored L exists');
  const actualCost = pathCost(nav, path);
  // Equal to the Manhattan lower bound (every subtile at FLOOR_COST) only
  // if the entire route stayed on the floored L — the strongest possible
  // confirmation that floor was preferred over the surrounding grass.
  assertOk(actualCost === manhattanSubtiles,
    `the route costs exactly ${manhattanSubtiles} (Manhattan distance at floor cost), meaning it never left the floored L (got ${actualCost})`);
}

console.log('\n=== 6c. A detour is chosen over cutting across grass (pass 1: admissible A*) ===\n');
{
  // Restores the original detour scenario from before the two-pass fix.
  // Two floor blocks (cols 0-1 and col 6, row 0) separated by a 4-tile
  // grass gap, plus a floored corridor one row south (row 1, cols 1-6) —
  // reaching it from (0,0) requires stepping AWAY from the goal's row
  // first, a real geometric detour, not just a monotonic reroute. This is
  // exactly what a single fixed-weight heuristic (the round-1 fix) could
  // not find: admissible search over the whole map is too slow to be
  // usable, and any weight big enough to terminate on a 60-tile crossing
  // (w >= ~2) also makes ordinary short detours like this one invisible to
  // the search, so the pawn cuts across the lawn instead. nav.js's
  // search() runs a small, cheap, ADMISSIBLE pass first — this scenario is
  // well within its budget — so the true optimum (cost 32, all on floor
  // except the unavoidable 4-tile grass crossing) is what gets returned.
  const state = makeState();
  floorRect(state, 0, 1, 0, 0);
  floorRect(state, 6, 6, 0, 0);
  floorRect(state, 1, 6, 1, 1);
  const nav = buildNavGrid(state);

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const to = { col: 6, row: 0, subCol: 0, subRow: 0 };
  const path = findPath(nav, from, to);
  assertOk(!!path, 'a path exists');
  const actualCost = pathCost(nav, path);
  assertOk(actualCost === 32,
    `the path takes the floored detour (cost 32) rather than cutting across the 4-tile grass gap (cost 48) (got ${actualCost})`);
  const usedCorridor = path.some(n => n.row === 1);
  assertOk(usedCorridor, 'the path actually dips into the row-1 corridor rather than coincidentally costing the same');
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

  // Same check against mapHalfExtent-derived bounds (the primary path, not
  // the no-mapHalfExtent fallback the rest of this test file uses) — a goal
  // past the map's own edge must still be rejected, not just a goal past
  // wherever infraOccupied happens to have entries.
  const bounded = makeState({ mapHalfExtent: 10 });
  const navBounded = buildNavGrid(bounded);
  const insideOrigin = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const justOutside = { col: 11, row: 0, subCol: 0, subRow: 0 };
  assertOk(findPath(navBounded, insideOrigin, justOutside) === null,
    'a goal one tile past mapHalfExtent returns null');
}

console.log('\n=== 10. A corner-to-corner path on a default-sized map is reachable, not null ===\n');
{
  // The critical regression: DEFAULT_MAP_HALF_EXTENT = 30 in Game.js makes
  // this a 61x61 tile map, so a corner-to-corner walk is a routine 60-tile
  // diagonal, not a contrived edge case. A single-weight heuristic —
  // admissible (too slow, O(d^2)) or weighted by GRASS_COST exactly (still
  // O(d^2): every node on the direct route shares the goal's f-score, so
  // A* must drain the whole plateau) — returned null here. The two-pass
  // search's pass 2 (only reached once pass 1's small admissible budget
  // is exhausted) is what actually terminates at this scale.
  const state = makeState({ mapHalfExtent: 30 });
  const nav = buildNavGrid(state);
  const from = { col: -30, row: -30, subCol: 0, subRow: 0 };
  const to = { col: 30, row: 30, subCol: 3, subRow: 3 };
  const path = findPath(nav, from, to);
  assertOk(!!path, 'a corner-to-corner path on a default-sized (halfExtent 30) map returns a path, not null');
  assertOk(isReachable(nav, from, to), 'isReachable agrees');
}

console.log('\n=== 11. mapHalfExtent bounds cover the whole map, not just infraOccupied\'s content bbox ===\n');
{
  // Regression: bounds inflated from infraOccupied's bbox by a fixed margin
  // put real map tiles out of bounds whenever the built area was lopsided
  // (a starter map's floor footprint is rarely centered on the origin).
  // Reproduces the reported case at a smaller scale: mapHalfExtent 30, but
  // every floor tile sits in rows -29..18 — an old content-bbox+8 approach
  // would cap out around row 26, well short of the map's real edge at
  // row 30.
  const state = makeState({ mapHalfExtent: 30 });
  floorRect(state, -5, 5, -29, 18);
  const nav = buildNavGrid(state);
  assertOk(nav.bounds.maxRow === 30,
    `bounds derive from mapHalfExtent (30), not the lopsided content bbox (got maxRow=${nav.bounds.maxRow})`);

  const from = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const to = { col: 0, row: 20, subCol: 0, subRow: 0 }; // outside the content bbox, inside the map
  assertOk(findPath(nav, from, to) !== null,
    'a tile outside the content bbox but inside the map is still addressable');
}

console.log('\n=== 12. passable.has() rejects a malformed subCol/subRow ===\n');
{
  const state = makeState();
  floorRect(state, 0, 2, 0, 2);
  const nav = buildNavGrid(state);
  assertOk(nav.passable.has('0,0,0,0') === true, 'sanity: an ordinary in-range key is passable');
  assertOk(nav.passable.has('0,0,9,9') === false, 'subCol/subRow of 9 (out of [0,3]) is rejected');
  assertOk(nav.passable.has('0,0,4,0') === false, 'subCol of 4 (one past the valid range) is rejected');
  assertOk(nav.passable.has('0,0,-1,0') === false, 'a negative subCol is rejected');
  assertOk(nav.passable.has('0,0,0,-1') === false, 'a negative subRow is rejected');
}

console.log('\n=== 13. Component labelling cost is proportional to the BUILT region, not the whole map ===\n');
{
  // Regression for the exact blowup 899f6e31 removed from the sparse grid:
  // an earlier version of the connected-component labelling flood-filled
  // the WHOLE `bounds` rectangle, so a small built room on a max-size map
  // cost the same as a fully-built one (measured 184-240ms at
  // mapHalfExtent 120 even with only a 21x21 area actually built). The
  // labelling now only materializes the content bbox (+ a small margin);
  // everything else is one implicit OUTDOOR component.
  const state = makeState({ mapHalfExtent: 120 });
  // A tiny 3x3 floored room near the origin — the only "built" content
  // anywhere on an otherwise untouched 241x241-tile map.
  floorRect(state, 0, 2, 0, 2);
  const nav = getNavGrid(state);

  // Two points deep in untouched grass, far from the room AND far from
  // each other, on opposite corners of the map — must be trivially
  // reachable (grass is uniformly passable everywhere) without the
  // labelling having materialized anywhere near either of them.
  const from = { col: -100, row: -100, subCol: 0, subRow: 0 };
  const to = { col: 100, row: 100, subCol: 3, subRow: 3 };
  const t0 = performance.now();
  const reached = isReachable(nav, from, to);
  const elapsedMs = performance.now() - t0;
  assertOk(reached, 'two far-apart outdoor points on a huge map are reachable via the implicit OUTDOOR component');
  // Generous threshold (whole-map cost at this size was measured at
  // 184-240ms) — robust to CI noise while still catching a regression back
  // to map-proportional cost.
  assertOk(elapsedMs < 60, `labelling + lookup for a tiny built room on a halfExtent-120 map stays fast (got ${elapsedMs.toFixed(2)} ms)`);
}

console.log('\n=== 14. A wall built on bare ground (no floor anywhere) still separates two outdoor points ===\n');
{
  // The case the labelling must get right: walls/doors alone (not just
  // floors) have to feed the "built" content bbox, or a fence built on
  // untouched grass is invisible to the region computation and both sides
  // of it get treated as the same trivially-connected outdoors.
  const state = makeState({ mapHalfExtent: 60 });
  const wall = (col, row, edge) => { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; };
  // A 2x2 pen, walled solid on every outer edge, with ZERO floor tiles
  // anywhere in the whole state.
  wall(10, 10, 'n'); wall(11, 10, 'n');
  wall(10, 11, 's'); wall(11, 11, 's');
  wall(10, 10, 'w'); wall(10, 11, 'w');
  wall(11, 10, 'e'); wall(11, 11, 'e');

  const nav = getNavGrid(state);
  const inside = { col: 10, row: 10, subCol: 0, subRow: 0 };
  const outside = { col: 20, row: 20, subCol: 0, subRow: 0 }; // well clear of the pen, bare grass
  assertOk(!isReachable(nav, inside, outside),
    'a walled pen on bare ground is NOT trivially connected to the outdoors, despite having no floor anywhere');

  state.doorOccupied['10,10,n'] = 'officeDoor';
  state.navRevision++;
  const navOpen = getNavGrid(state);
  assertOk(isReachable(navOpen, inside, outside), 'a door in the pen wall reopens the connection');
}

console.log('\n=== 15. Meadow scattered across the WHOLE map does not defeat the built-region scoping ===\n');
{
  // The realistic-shaped case, not just an artificial empty-map one:
  // map-generator.js's placeMeadowGrass scatters groundsSurface floor
  // tiles across essentially the entire site at world generation, so a
  // real Game state's infraOccupied is NOT sparse even on turn 1 — only
  // excluding groundsSurface tiles from the content bbox (see
  // buildNavGrid's comment on the flooredTiles loop) keeps the labelling
  // region actually proportional to what the player built, rather than to
  // the meadow scatter that was always there.
  const half = 90;
  const state = makeState({ mapHalfExtent: half });
  for (let c = -half; c <= half; c++) {
    for (let r = -half; r <= half; r++) {
      state.infraOccupied[`${c},${r}`] = 'wildgrass'; // groundsSurface: true
    }
  }
  // One small REAL built area: a 10x10 concrete pad near the origin.
  for (let c = 0; c < 10; c++) {
    for (let r = 0; r < 10; r++) {
      state.infraOccupied[`${c},${r}`] = 'concrete';
    }
  }
  const nav = getNavGrid(state);
  const from = { col: -half, row: -half, subCol: 0, subRow: 0 };
  const to = { col: half, row: half, subCol: 3, subRow: 3 };
  const t0 = performance.now();
  const reached = isReachable(nav, from, to);
  const elapsedMs = performance.now() - t0;
  assertOk(reached, 'two far corners of an all-meadow map are reachable (uniformly passable ground either way)');
  assertOk(elapsedMs < 60,
    `labelling stays fast even with infraOccupied covering the whole map, because meadow tiles don't count as "built" (got ${elapsedMs.toFixed(2)} ms)`);
}

console.log('\n=== 16. Scattered decorations (trees) do not widen the labelled region, even at map generator density ===\n');
{
  // generateStartingMap/generateAnnulus scatter LONELY_TREE_DENSITY (0.007)
  // decoration placeables roughly uniformly across the whole site — every
  // seed checked puts a tree within a tile or two of every map edge, so a
  // real new game's decoration bbox is ~the entire map on turn one (the
  // same "world-gen scatters something map-wide" trap groundsSurface tiles
  // were). Decorations are therefore excluded from the content bbox (see
  // buildNavGrid's placeables loop) — they still block their own subtile
  // via blockedSubtiles/subgridOccupied exactly as before, they just don't
  // widen the labelled region. A single tree stranded far from the built
  // area must not drag the labelling out to cover it.
  const state = makeState({ mapHalfExtent: 60 });
  placeItem(state, 'shrub', 55, 55, 0, 0, 0); // decoration, far from the origin
  const nav = getNavGrid(state);
  const treeTile = { col: 55, row: 55, subCol: 0, subRow: 0 };
  assertOk(!nav.passable.has(`${treeTile.col},${treeTile.row},${treeTile.subCol},${treeTile.subRow}`),
    'the tree still blocks its own subtile');
  // Two points near the tree (but not on it) and far from it — both bare
  // grass, both outside the (tiny, empty-content-bbox-based) labelled
  // region — must resolve via the OUTDOOR component, not force a
  // region rebuild spanning out to the tree.
  const nearTree = { col: 55, row: 54, subCol: 0, subRow: 0 };
  const farAway = { col: -55, row: -55, subCol: 0, subRow: 0 };
  assertOk(isReachable(nav, nearTree, farAway), 'a lone scattered tree does not disconnect (or widen the region around) distant bare ground');
}

console.log('\n=== 17. KNOWN LIMITATION: a closed ring of decorations outside the built bbox encloses an unreachable pocket that isReachable reports as reachable ===\n');
{
  // Documented tradeoff, not a bug: decorations don't feed the content
  // bbox (see test 16 and buildNavGrid's comment), so a closed ring of
  // decorations sitting entirely OUTSIDE the built region is invisible to
  // the labelling — the pocket it encloses gets folded into the single
  // OUTDOOR component along with everything else outdoors, even though a
  // real pawn cannot physically walk into it.
  //
  // At LONELY_TREE_DENSITY = 0.007 with 1-subtile decorations, a closed
  // ring requires adjacent decorations forming a complete loop, which is
  // essentially impossible from map generation — but a player could
  // deliberately plant one (four shrubs around a single subtile, as below).
  // The failure this produces is bounded and safe, not silently wrong:
  // isReachable says yes (this test), but findPath still runs real A*
  // against blockedSubtiles/subgridOccupied and correctly returns null (also
  // this test) — a pawn sent to the pocket goes idle with "no path found"
  // rather than being told it walked there. Tolerated on that basis; see
  // the task-4 report's fix-round-3 section for the full ruling.
  const state = makeState({ mapHalfExtent: 60 });
  // Pocket at (50,50,0,0); one shrub (1x1, blocks — subH:2, not stackable,
  // no seat) on each of its four cardinal neighbor subtiles, sealing it.
  placeItem(state, 'shrub', 49, 50, 3, 0, 0); // west
  placeItem(state, 'shrub', 50, 49, 0, 3, 0); // north
  placeItem(state, 'shrub', 50, 50, 1, 0, 0); // east
  placeItem(state, 'shrub', 50, 50, 0, 1, 0); // south

  const nav = getNavGrid(state);
  const pocket = { col: 50, row: 50, subCol: 0, subRow: 0 };
  const outside = { col: 0, row: 0, subCol: 0, subRow: 0 };
  assertOk(nav.passable.has('50,50,0,0'), 'sanity: the pocket subtile itself is passable (nothing placed on it)');

  assertOk(isReachable(nav, outside, pocket),
    'KNOWN LIMITATION: isReachable incorrectly reports the sealed pocket as reachable, because the ring sits outside the labelled bbox');
  assertOk(findPath(nav, outside, pocket) === null,
    'the limitation is bounded: findPath still runs real A* and correctly finds no path into the sealed pocket');
}

console.log('\n=== 18. Internal stairs connect roof-supported upper floors ===\n');
{
  const state = makeState({ mapHalfExtent: 8 });
  for (let row = 0; row <= 1; row++) {
    state.infraOccupied[`0,${row}`] = 'hallway';
    state.infraOccupied[`1|0,${row}`] = 'hallway';
  }
  const def = PLACEABLES.internalStairs;
  const cells = def.footprintCells(0, 0, 0, 0, 0);
  const entry = {
    id: 'stairs_1', type: 'internalStairs', kind: 'infrastructure',
    category: 'infrastructure', col: 0, row: 0, subCol: 0, subRow: 0,
    dir: 0, cells,
  };
  state.placeableIndex[entry.id] = 0;
  state.placeables.push(entry);
  for (const cell of cells) {
    state.subgridOccupied[
      `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`
    ] = { id: entry.id, kind: entry.kind };
  }

  const nav = buildNavGrid(state);
  const lower = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const upper = { col: 0, row: 1, subCol: 3, subRow: 3, level: 1 };
  assertOk(subtileToWorld(upper).level === 1,
    'world-space spawn coordinates retain their storey identity');
  const path = findPath(nav, lower, upper);
  assertOk(!!path, 'a path reaches the second floor through the stair connector');
  assertOk(path?.some(node => node.level === 1), 'the route contains second-floor nodes');

  state.placeables = [];
  state.placeableIndex = {};
  state.subgridOccupied = {};
  const disconnected = buildNavGrid(state);
  assertOk(!isReachable(disconnected, lower, upper), 'upper floor is unreachable after stairs are removed');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
