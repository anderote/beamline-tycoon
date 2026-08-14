// test/test-door-edges.js — edge-key canonicalization + door subtile offsets.
//
// A tile edge has two equally valid occupancy keys ("5,5,n" and "5,4,s" name
// the same wall), and which one a wall is stored under depends on which tile
// the player hovered when they drew it. Every door lookup therefore has to
// resolve both spellings; checking only the handed-in key made doors refuse to
// place from one side of a wall. These tests pin that resolution plus the
// `off` (subtile opening offset) plumbing that rides along with it.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { DOOR_TYPES, WALL_TYPES } from '../src/data/structure.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { DoorTool } from '../src/input/structure-tools.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { gridToIso } from '../src/renderer/grid.js';
import {
  EDGES, edgeKey, parseEdgeKey, mirrorEdge, findEdgeKey, findWallKey,
  isMirroredKey, SUBTILES_PER_EDGE, doorSubWidth, defaultDoorOff,
  clampDoorOff, doorOffFromFrac, mirrorDoorOff,
} from '../src/game/edge-keys.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame() {
  const g = new Game(new BeamlineRegistry(), { seed: 11 });
  g.state.resources.funding = 100000;
  return g;
}

/** Count 'doorsChanged' emits while fn runs. */
function countDoorsChanged(game, fn) {
  let n = 0;
  const off = game.on((ev) => { if (ev === 'doorsChanged') n++; });
  try { fn(); } finally { off(); }
  return n;
}

const SINGLE = 'officeDoor';   // doorWidth: 'single' -> 2 subtiles
const DOUBLE = 'doubleDoor';   // doorWidth: 'double' -> 4 subtiles

console.log('\n=== edge-keys: mirroring ===\n');

assertOk(DOOR_TYPES[SINGLE].doorWidth === 'single', `${SINGLE} is a single-width door`);
assertOk(DOOR_TYPES[DOUBLE].doorWidth === 'double', `${DOUBLE} is a double-width door`);

{
  const cases = [
    ['n', 5, 4, 's'],
    ['s', 5, 6, 'n'],
    ['e', 6, 5, 'w'],
    ['w', 4, 5, 'e'],
  ];
  for (const [edge, mc, mr, me] of cases) {
    const m = mirrorEdge(5, 5, edge);
    assertOk(m.col === mc && m.row === mr && m.edge === me,
             `mirrorEdge(5,5,'${edge}') -> (${mc},${mr},'${me}')`);
    // Mirroring twice is the identity.
    const back = mirrorEdge(m.col, m.row, m.edge);
    assertOk(back.col === 5 && back.row === 5 && back.edge === edge,
             `mirrorEdge is an involution for '${edge}'`);
  }
  assertOk(mirrorEdge(1, 1, 'x') === null, 'mirrorEdge rejects an unknown edge name');
}

{
  assertOk(edgeKey(3, -2, 'w') === '3,-2,w', 'edgeKey formats "col,row,edge"');
  const p = parseEdgeKey('3,-2,w');
  assertOk(p.col === 3 && p.row === -2 && p.edge === 'w', 'parseEdgeKey inverts edgeKey');
  assertOk(parseEdgeKey('3,-2') === null, 'parseEdgeKey rejects a short key');
  assertOk(parseEdgeKey('3,-2,q') === null, 'parseEdgeKey rejects a bad edge name');
}

{
  // Wall recorded under the direct spelling.
  const occ = { '5,5,n': 'officeWall' };
  assertOk(findWallKey(occ, 5, 5, 'n') === '5,5,n', 'findWallKey finds the direct key');
  assertOk(findWallKey(occ, 5, 4, 's') === '5,5,n',
           'findWallKey finds the same wall from the neighbour tile');
  assertOk(findWallKey(occ, 5, 6, 'n') === null, 'findWallKey returns null with no wall');
  assertOk(findEdgeKey(null, 5, 5, 'n') === null, 'findEdgeKey tolerates a missing map');

  // Direct wins when both spellings are somehow occupied.
  const both = { '5,5,n': 'officeWall', '5,4,s': 'leadWall' };
  assertOk(findWallKey(both, 5, 4, 's') === '5,4,s',
           'findWallKey prefers the direct key when both sides are occupied');

  assertOk(isMirroredKey('5,5,n', 5, 4, 's') === true, 'isMirroredKey spots the far spelling');
  assertOk(isMirroredKey('5,5,n', 5, 5, 'n') === false, 'isMirroredKey clears the direct spelling');
  assertOk(isMirroredKey(null, 5, 5, 'n') === false, 'isMirroredKey is false for a null key');
}

console.log('\n=== edge-keys: off widths, defaults and clamping ===\n');

{
  assertOk(SUBTILES_PER_EDGE === 4, 'an edge is 4 subtiles');
  assertOk(doorSubWidth(DOOR_TYPES[SINGLE]) === 2, 'a single door spans 2 subtiles');
  assertOk(doorSubWidth(DOOR_TYPES[DOUBLE]) === 4, 'a double door spans 4 subtiles');
  assertOk(doorSubWidth(undefined) === 2, 'an unknown door def reads as single-width');

  assertOk(defaultDoorOff(DOOR_TYPES[SINGLE]) === 1,
           'single doors default to off=1 (the pre-off centered geometry)');
  assertOk(defaultDoorOff(DOOR_TYPES[DOUBLE]) === 0, 'double doors default to off=0');
}

{
  const s = DOOR_TYPES[SINGLE];
  const d = DOOR_TYPES[DOUBLE];
  // Single: legal range is [0, 4-2] = [0, 2].
  assertOk(clampDoorOff(s, 0) === 0, 'single clamp keeps off=0');
  assertOk(clampDoorOff(s, 2) === 2, 'single clamp keeps off=2 (upper bound)');
  assertOk(clampDoorOff(s, 3) === 2, 'single clamp pulls off=3 down to 2');
  assertOk(clampDoorOff(s, 99) === 2, 'single clamp pulls a huge off down to 2');
  assertOk(clampDoorOff(s, -4) === 0, 'single clamp pulls a negative off up to 0');
  assertOk(clampDoorOff(s, 1.4) === 1, 'clamp rounds a fractional off');
  assertOk(clampDoorOff(s, NaN) === 1, 'a non-finite off falls back to the single default');
  // Double: legal range is [0, 4-4] = [0, 0] — it always fills the edge.
  assertOk(clampDoorOff(d, 0) === 0, 'double clamp keeps off=0');
  assertOk(clampDoorOff(d, 1) === 0, 'double clamp forces off=1 back to 0');
  assertOk(clampDoorOff(d, 3) === 0, 'double clamp forces off=3 back to 0');
  assertOk(clampDoorOff(d, -2) === 0, 'double clamp forces a negative off back to 0');
}

console.log('\n=== edge-keys: quantizing the cursor fraction ===\n');

{
  const s = DOOR_TYPES[SINGLE];
  const d = DOOR_TYPES[DOUBLE];
  // off = clamp(floor(frac*4 - width/2 + 0.5), 0, 4-width)
  assertOk(doorOffFromFrac(0.5, s) === 1, 'a centered cursor gives the centered single (off=1)');
  assertOk(doorOffFromFrac(0.0, s) === 0, 'frac=0 pins the single to the first corner');
  assertOk(doorOffFromFrac(1.0, s) === 2, 'frac=1 pins the single to the far corner');
  assertOk(doorOffFromFrac(0.1, s) === 0, 'frac=0.1 clamps inside the tile');
  assertOk(doorOffFromFrac(0.3, s) === 0, 'frac=0.3 -> off=0');
  assertOk(doorOffFromFrac(0.7, s) === 2, 'frac=0.7 -> off=2');
  assertOk(doorOffFromFrac(undefined, s) === 1, 'a missing frac centers the single');

  // Every fraction must land in range, for both widths.
  let inRange = true;
  for (let i = 0; i <= 100; i++) {
    const f = i / 100;
    const os = doorOffFromFrac(f, s);
    const od = doorOffFromFrac(f, d);
    if (!Number.isInteger(os) || os < 0 || os > 2) inRange = false;
    if (od !== 0) inRange = false;
  }
  assertOk(inRange, 'every frac in [0,1] yields a single off in [0,2] and a double off of 0');
}

{
  const s = DOOR_TYPES[SINGLE];
  // The two spellings run in opposite directions, so the offsets a cursor
  // produces from either side must be mirror images of each other.
  let consistent = true;
  for (let i = 0; i <= 100; i++) {
    const f = i / 100;
    const near = doorOffFromFrac(f, s);
    const far = doorOffFromFrac(1 - f, s);
    if (mirrorDoorOff(near, s) !== far) consistent = false;
  }
  assertOk(consistent, 'mirrorDoorOff matches what the opposite tile\'s frac would produce');
  assertOk(mirrorDoorOff(mirrorDoorOff(1, s), s) === 1, 'mirrorDoorOff is an involution');
  assertOk(mirrorDoorOff(0, DOOR_TYPES[DOUBLE]) === 0, 'a double door mirrors to off=0');
}

console.log('\n=== placeDoor: resolving the wall from either side ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  // Placed from the FAR tile: the wall lives at "5,5,n", not "5,4,s".
  assertOk(g.placeDoor(5, 4, 's', DOUBLE) === true,
           'a door placed from the far side of the wall is accepted');
  assertOk(g.state.doorOccupied['5,5,n'] === DOUBLE,
           'the door is stored at the key the WALL uses, not the key it was asked for');
  assertOk(!g.state.doorOccupied['5,4,s'], 'nothing is stored under the far spelling');
  assertOk(g.state.doors.length === 1, 'exactly one door record exists');
  const rec = g.state.doors[0];
  assertOk(rec.col === 5 && rec.row === 5 && rec.edge === 'n',
           'the record carries the wall\'s col/row/edge');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  // Single door, asked for from the far tile at off=0. The far spelling runs
  // the other way, so it must be re-expressed as off = (4-2) - 0 = 2.
  assertOk(g.placeDoor(5, 4, 's', SINGLE, 0, 0) === true, 'single door placed from the far side');
  assertOk(g.state.doors[0].off === 2,
           'off is re-expressed into the wall\'s corner order (0 from the far side -> 2)');
}

{
  const g = makeGame();
  // No wall anywhere: the placement is refused AND says why.
  const before = g.state.log.length;
  assertOk(g.placeDoor(9, 9, 'n', SINGLE) === false, 'a door with no wall is refused');
  assertOk(g.state.log.length > before, 'the refusal is logged rather than silent');
  assertOk(/wall/i.test(g.state.log[0].msg) && g.state.log[0].type === 'bad',
           'the log line names the missing wall');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.state.resources.funding = 1;
  const before = g.state.log.length;
  assertOk(g.placeDoor(5, 5, 'n', SINGLE) === false, 'an unaffordable door is refused');
  assertOk(g.state.log.length > before && g.state.log[0].type === 'bad',
           'the unaffordable refusal is logged');
  assertOk(/funding/i.test(g.state.log[0].msg), 'the log line names the funding shortfall');
  assertOk(g.state.doors.length === 0, 'no record is written for a refused door');
}

{
  // Swapping to a door you cannot afford must not strand the old one: the
  // affordability check has to run BEFORE the old record is dropped.
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE);
  g.state.resources.funding = 1;
  assertOk(g.placeDoor(5, 5, 'n', DOUBLE) === false, 'the unaffordable swap is refused');
  assertOk(g.state.doorOccupied['5,5,n'] === SINGLE, 'the original door still occupies the edge');
  assertOk(g.state.doors.length === 1 && g.state.doors[0].type === SINGLE,
           'the original door record survives the refused swap');
}

console.log('\n=== placeDoor: doorsChanged emits ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  // Regression: the success path used to fall through to `return true`
  // without emitting, so a freshly placed door never reached the renderer
  // until some other event forced a rebuild.
  const n = countDoorsChanged(g, () => g.placeDoor(5, 5, 'n', SINGLE));
  assertOk(n === 1, 'placeDoor emits doorsChanged once on the success path');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE, 0, 0);
  const n = countDoorsChanged(g, () => g.placeDoor(5, 5, 'n', SINGLE, 0, 0));
  assertOk(n === 0, 'a no-op re-place emits nothing');
}

console.log('\n=== placeDoor: off updates in place ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE, 0, 0);
  assertOk(g.state.doors[0].off === 0, 'the door starts at off=0');
  const spent = g.state.resources.funding;

  const n = countDoorsChanged(g, () => {
    assertOk(g.placeDoor(5, 5, 'n', SINGLE, 0, 2) === true, 're-placing at a new off succeeds');
  });
  assertOk(g.state.doors.length === 1, 're-placing does not duplicate the record');
  assertOk(g.state.doors[0].off === 2, 'off is updated in place');
  assertOk(n === 1, 'the off update emits doorsChanged');
  assertOk(g.state.resources.funding === spent, 'an in-place off update is free');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE, 0, 1);
  // Same door nudged from the OTHER tile: off must land mirrored.
  assertOk(g.placeDoor(5, 4, 's', SINGLE, 0, 0) === true, 'the far-side nudge is accepted');
  assertOk(g.state.doors.length === 1, 'the far-side nudge updates rather than duplicates');
  assertOk(g.state.doors[0].off === 2, 'the far-side nudge mirrors into the wall\'s frame');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE, 0, 9);
  assertOk(g.state.doors[0].off === 2, 'an out-of-range off is clamped on the way in');
  g.placeDoor(5, 5, 'n', SINGLE, 0, -5);
  assertOk(g.state.doors[0].off === 0, 'a negative off is clamped on the way in');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', DOUBLE, 0, 2);
  assertOk(g.state.doors[0].off === 0, 'a double door is forced to off=0 whatever is asked for');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE);
  assertOk(g.state.doors[0].off === 1, 'omitting off gives the single default (centered)');
  const g2 = makeGame();
  g2.placeWall(5, 5, 'n', 'officeWall');
  g2.placeDoor(5, 5, 'n', DOUBLE);
  assertOk(g2.state.doors[0].off === 0, 'omitting off gives the double default');
}

console.log('\n=== placeDoorPath ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeWall(6, 5, 'n', 'officeWall');
  // Third segment has no wall — it is skipped, and the skip is reported once.
  const path = [
    { col: 5, row: 5, edge: 'n', off: 0 },
    { col: 6, row: 5, edge: 'n', off: 0 },
    { col: 7, row: 5, edge: 'n', off: 0 },
  ];
  const n = countDoorsChanged(g, () => {
    assertOk(g.placeDoorPath(path, SINGLE) === true, 'placeDoorPath places what it can');
  });
  assertOk(n === 1, 'placeDoorPath emits doorsChanged once for the whole run');
  assertOk(g.state.doors.length === 2, 'only the two walled segments got doors');
  assertOk(g.state.doors.every(d => d.off === 0), 'the per-point off is honored');
  const skips = g.state.log.filter(l => /Skipped 1 /.test(l.msg));
  assertOk(skips.length === 1, 'the wall-less segment is reported once, not per segment');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeWall(6, 5, 'n', 'officeWall');
  // Points without their own off fall back to the path-level argument.
  g.placeDoorPath([{ col: 5, row: 5, edge: 'n' }, { col: 6, row: 5, edge: 'n' }], SINGLE, 0, 2);
  assertOk(g.state.doors.length === 2 && g.state.doors.every(d => d.off === 2),
           'the path-level off is the fallback for points that carry none');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoorPath([{ col: 5, row: 5, edge: 'n', off: 0 }], SINGLE);
  // Re-running the same drag at a different off must move the opening.
  const n = countDoorsChanged(g, () => {
    assertOk(g.placeDoorPath([{ col: 5, row: 5, edge: 'n', off: 2 }], SINGLE) === true,
             'placeDoorPath reports a pure off update as a change');
  });
  assertOk(n === 1, 'the path off update emits doorsChanged');
  assertOk(g.state.doors.length === 1 && g.state.doors[0].off === 2,
           'placeDoorPath updates off in place');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeWall(6, 5, 'n', 'officeWall');
  g.state.resources.funding = DOOR_TYPES[SINGLE].cost; // enough for exactly one
  g.placeDoorPath([{ col: 5, row: 5, edge: 'n' }, { col: 6, row: 5, edge: 'n' }], SINGLE);
  assertOk(g.state.doors.length === 1, 'the run stops when the funding runs out');
  assertOk(g.state.log.some(l => /funding/i.test(l.msg) && l.type === 'bad'),
           'running out of funding mid-run is logged');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  // Whole path drawn from the far tiles.
  assertOk(g.placeDoorPath([{ col: 5, row: 4, edge: 's', off: 0 }], DOUBLE) === true,
           'placeDoorPath resolves the wall from the far side too');
  assertOk(g.state.doorOccupied['5,5,n'] === DOUBLE, 'the path door lands on the wall\'s key');
}

console.log('\n=== removeDoor / removeWall are mirror-aware ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', DOUBLE);
  assertOk(g.removeDoor(5, 4, 's') === true, 'a door is removable from the far side');
  assertOk(g.state.doors.length === 0 && !g.state.doorOccupied['5,5,n'],
           'both the record and the occupancy entry are gone');
  assertOk(g.removeDoor(5, 4, 's') === false, 'removing a door twice reports failure');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', DOUBLE);
  // Demolishing the wall from the far side must take the door with it,
  // otherwise the door hangs in mid-air on a wall that no longer exists.
  g.removeWall(5, 5, 'n');
  assertOk(g.state.doors.length === 0 && !g.state.doorOccupied['5,5,n'],
           'removeWall cleans up the orphaned door recorded on this edge');
}

{
  const g = makeGame();
  // Wall drawn from one tile, door hung from the other, wall demolished from
  // the door's tile: all three spellings must agree. removeWall resolves the
  // edge like every other wall mutator, so the far-side spelling demolishes
  // the wall that is actually there instead of reporting "nothing here".
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 4, 's', DOUBLE);
  assertOk(g.removeWall(5, 4, 's') === true, 'a wall is removable from the far side');
  assertOk(!g.state.wallOccupied['5,5,n'] && g.state.walls.length === 0,
           'the wall record and its occupancy entry are gone');
  assertOk(g.state.doors.length === 0 && !g.state.doorOccupied['5,5,n'],
           'removing the wall from the far side clears the far-hung door');
  assertOk(g.removeWall(5, 4, 's') === false, 'removing a wall twice reports failure');
}

console.log('\n=== placeWall / placeWallPath are mirror-aware ===\n');

{
  // The same physical edge drawn from both sides is ONE wall. Keying off the
  // raw "col,row,edge" stacked a second, separately-charged wall on the same
  // line — and since wall-builder matches doors to walls by exact key, the
  // twin rendered a solid slab straight across any doorway on that edge.
  const g = makeGame();
  const funding0 = g.state.resources.funding;
  assertOk(g.placeWall(5, 5, 's', 'officeWall') === true, 'the first wall is placed');
  assertOk(g.placeWall(5, 6, 'n', 'officeWall') === true, 'the mirrored spelling reports success');
  assertOk(g.state.walls.length === 1, 'the mirrored re-place does not stack a second wall');
  assertOk(Object.keys(g.state.wallOccupied).length === 1,
           'only one occupancy key names the edge');
  const cost = WALL_TYPES.officeWall.cost;
  assertOk(funding0 - g.state.resources.funding === cost,
           `the edge is charged once ($${cost}), not twice`);
}

{
  // A run redrawn from the far side updates the walls that are there.
  const g = makeGame();
  g.placeWallPath([0, 1, 2].map(col => ({ col, row: 5, edge: 's' })), 'officeWall');
  const funding0 = g.state.resources.funding;
  g.placeWallPath([0, 1, 2].map(col => ({ col, row: 6, edge: 'n' })), 'officeWall');
  assertOk(g.state.walls.length === 3, 'the mirrored run does not duplicate the walls');
  assertOk(g.state.resources.funding === funding0, 'and it is not charged again');
}

{
  // A different type on the mirrored spelling REPLACES the wall in place.
  const g = makeGame();
  g.placeWall(5, 5, 's', 'officeWall');
  g.placeWall(5, 6, 'n', 'structuralWall');
  assertOk(g.state.walls.length === 1, 'the replacement stays a single wall');
  assertOk(g.state.wallOccupied['5,5,s'] === 'structuralWall',
           'the new type is stored at the key the wall already used');
  assertOk(g.state.walls[0].col === 5 && g.state.walls[0].row === 5 && g.state.walls[0].edge === 's',
           'the record keeps the original spelling so door lookups still match');
}

{
  // A door hung on the edge survives its wall being re-clad from either side.
  const g = makeGame();
  g.placeWall(5, 5, 's', 'officeWall');
  g.placeDoor(5, 5, 's', SINGLE);
  g.placeWall(5, 6, 'n', 'structuralWall');
  assertOk(g.state.walls.length === 1 && g.state.doors.length === 1,
           're-cladding from the far side leaves one wall and keeps the door');
  const snap = buildWorldSnapshot(g, { only: ['walls', 'doors'] });
  assertOk(snap.walls.length === 1,
           'the snapshot has no twin wall to render across the opening');
}

{
  // An unaffordable replacement must leave the existing wall intact — the old
  // order deleted the record first and returned false with wallOccupied still
  // pointing at it.
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.state.resources.funding = 1;
  assertOk(g.placeWall(5, 5, 'n', 'structuralWall') === false, 'the swap is refused');
  assertOk(g.state.wallOccupied['5,5,n'] === 'officeWall' && g.state.walls.length === 1,
           'the original wall is still recorded');
}

console.log('\n=== removeWall refunds what the segment actually cost ===\n');

{
  const g = makeGame();
  const brick = WALL_TYPES.structuralWall.variantCosts[3];   // Red Brick
  g.placeWall(5, 5, 'n', 'structuralWall', 3);
  const before = g.state.resources.funding;
  g.removeWall(5, 5, 'n');
  assertOk(g.state.resources.funding - before === Math.floor(brick * 0.5),
           `a $${brick} brick wall refunds half of $${brick}, not half of the base type`);
}

console.log('\n=== off survives serialization ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE, 0, 2);
  localStorage.setItem('beamlineTycoon', g.serialize());
  const g2 = makeGame();
  g2.load();
  assertOk(g2.state.doors.length === 1 && g2.state.doors[0].off === 2,
           'off round-trips through save/load');
  assertOk(g2.state.doorOccupied['5,5,n'] === SINGLE,
           'doorOccupied rebuilds at the stored key after load');
}

console.log('\n=== room detection still sees doors through either spelling ===\n');

{
  // rooms.js was already doing the two-key check by hand; edge-keys.js has to
  // preserve that exactly.
  const state = {
    wallOccupied: { '5,5,n': 'officeWall' },
    doorOccupied: {},
  };
  // Import lazily so the module graph stays flat for the rest of the file.
  const { detectRooms } = await import('../src/networks/rooms.js');
  assertOk(typeof detectRooms === 'function', 'rooms.js still loads after the edge-keys extraction');
  // Both spellings resolve to the one wall.
  assertOk(findEdgeKey(state.wallOccupied, 5, 4, 's') === '5,5,n',
           'the wall behind a doorway resolves from the room side');
  state.doorOccupied['5,5,n'] = DOUBLE;
  assertOk(findEdgeKey(state.doorOccupied, 5, 4, 's') === '5,5,n',
           'the doorway resolves from the room side too');
}

assertOk(EDGES.length === 4 && EDGES.every(e => mirrorEdge(0, 0, e) !== null),
         'every listed edge mirrors');

console.log('\n=== InputHandler._getNearestWallEdge ===\n');

// Driven through the prototype with a stub `this` — the method only reaches
// renderer.screenToWorld and game.state.wallOccupied.
function nearestWallEdge(wallOccupied, colF, rowF) {
  const world = gridToIso(colF, rowF);
  const self = {
    renderer: { screenToWorld: () => world },
    game: { state: { wallOccupied } },
  };
  return InputHandler.prototype._getNearestWallEdge.call(self, 0, 0);
}

{
  // Cursor at fx=0.5, fy=0.4 inside tile (5,5). Raw distances: n 0.4,
  // e 0.5, w 0.5, s 0.6 — 'n' is nearest with no wall anywhere.
  const bare = nearestWallEdge({}, 5.5, 5.4);
  assertOk(bare.col === 5 && bare.row === 5 && bare.edge === 'n',
           'with no walls, the geometrically nearest edge wins');

  // Same cursor, wall on the SOUTH edge stored under the DIRECT key: the
  // -0.35 preference bias makes 's' (0.6 - 0.35 = 0.25) beat 'n' (0.4).
  const direct = nearestWallEdge({ '5,5,s': 'officeWall' }, 5.5, 5.4);
  assertOk(direct.edge === 's' && direct.col === 5 && direct.row === 5,
           'the wall-preference bias pulls the pick onto a directly-keyed wall');

  // Regression: the same wall recorded under the NEIGHBOUR's spelling
  // ("5,6,n" is the same edge as "5,5,s"). The bias used to miss entirely,
  // so doors drawn against a wall the neighbour tile owns felt unplaceable.
  const mirrored = nearestWallEdge({ '5,6,n': 'officeWall' }, 5.5, 5.4);
  assertOk(mirrored.edge === 's' && mirrored.col === 5 && mirrored.row === 5,
           'the bias also fires when the wall is recorded on the neighbour tile');
}

{
  // frac runs 0 -> 1 from the edge's FIRST-listed corner, in buildWalls'
  // corner order: n = NW->NE, e = NE->SE, s = SE->SW, w = SW->NW.
  // Local tile coords are u = col fraction, v = row fraction, (0,0) = NW.
  const n = nearestWallEdge({ '5,5,n': 'officeWall' }, 5.75, 5.5);
  assertOk(n.edge === 'n' && Math.abs(n.frac - 0.75) < 1e-9,
           "the 'n' edge's frac runs with the column fraction (NW->NE)");
  const s = nearestWallEdge({ '5,5,s': 'officeWall' }, 5.75, 5.5);
  assertOk(s.edge === 's' && Math.abs(s.frac - 0.25) < 1e-9,
           "the 's' edge's frac runs against the column fraction (SE->SW)");
  const e = nearestWallEdge({ '5,5,e': 'officeWall' }, 5.5, 5.75);
  assertOk(e.edge === 'e' && Math.abs(e.frac - 0.75) < 1e-9,
           "the 'e' edge's frac runs with the row fraction (NE->SE)");
  const w = nearestWallEdge({ '5,5,w': 'officeWall' }, 5.5, 5.75);
  assertOk(w.edge === 'w' && Math.abs(w.frac - 0.25) < 1e-9,
           "the 'w' edge's frac runs against the row fraction (SW->NW)");
}

console.log('\n=== DoorTool threads off from the cursor to the door record ===\n');

function doorToolCtx(game, wallOccupied) {
  const input = {
    _getNearestWallEdge: (x) => nearestWallEdge(wallOccupied, x, 5.4),
    _hideDragCostTooltip() {},
    _buildWallLine: (start, end) => InputHandler.prototype._buildWallLine(start, end),
  };
  const renderer = { renderDoorPreview() {}, clearDragPreview() {} };
  return { game, input, renderer };
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  const ctx = doorToolCtx(g, g.state.wallOccupied);
  const tool = new DoorTool(SINGLE, 0);
  // Press and release near the NE end of the tile's north edge (fx = 0.9).
  tool.onMouseDown({ button: 0, clientX: 5.9, clientY: 0 }, ctx);
  assertOk(tool._path.length === 1 && tool._path[0].off === 2,
           'mouse-down quantizes the cursor fraction into the path point');
  tool.onMouseUp({ button: 0, clientX: 5.9, clientY: 0 }, ctx);
  assertOk(g.state.doors.length === 1 && g.state.doors[0].off === 2,
           'the committed door carries the off the cursor selected');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  const ctx = doorToolCtx(g, g.state.wallOccupied);
  const tool = new DoorTool(SINGLE, 0);
  tool.onMouseDown({ button: 0, clientX: 5.1, clientY: 0 }, ctx);
  assertOk(tool._path[0].off === 0, 'a cursor near the NW end selects off=0');
  tool.onMouseUp({ button: 0, clientX: 5.1, clientY: 0 }, ctx);
  assertOk(g.state.doors[0].off === 0, 'the low off reaches the record');
}

{
  const g = makeGame();
  for (let c = 5; c <= 7; c++) g.placeWall(c, 5, 'n', 'officeWall');
  const ctx = doorToolCtx(g, g.state.wallOccupied);
  const tool = new DoorTool(SINGLE, 0);
  tool.onMouseDown({ button: 0, clientX: 5.1, clientY: 0 }, ctx);
  tool.onMouseMove({ clientX: 7.9, clientY: 0 }, ctx);
  assertOk(tool._path.length === 3, 'the drag spans three tiles');
  assertOk(tool._path.every(pt => pt.off === tool._path[0].off),
           'every segment of a drag shares one opening offset');
  tool.onMouseUp({ button: 0, clientX: 7.9, clientY: 0 }, ctx);
  assertOk(g.state.doors.length === 3, 'the whole drag committed');
  const offs = new Set(g.state.doors.map(d => d.off));
  assertOk(offs.size === 1, 'the committed run has a single consistent off');
}

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  const ctx = doorToolCtx(g, g.state.wallOccupied);
  const tool = new DoorTool(DOUBLE, 0);
  tool.onMouseDown({ button: 0, clientX: 5.9, clientY: 0 }, ctx);
  assertOk(tool._path[0].off === 0, 'a double door always quantizes to off=0');
  tool.onMouseUp({ button: 0, clientX: 5.9, clientY: 0 }, ctx);
  assertOk(g.state.doors[0].off === 0, 'the committed double door sits at off=0');
}

console.log('\n=== world-snapshot exposes off with the documented default ===\n');

{
  const g = makeGame();
  g.placeWall(5, 5, 'n', 'officeWall');
  g.placeWall(6, 5, 'n', 'officeWall');
  g.placeDoor(5, 5, 'n', SINGLE, 0, 2);
  g.placeDoor(6, 5, 'n', DOUBLE);
  // Pre-`off` records (old saves, scenario fixtures) must read as the
  // centered geometry they were originally drawn with.
  delete g.state.doors[0].off;
  const snap = buildWorldSnapshot(g);
  const byCol = Object.fromEntries(snap.doors.map(d => [d.col, d]));
  assertOk(byCol[5].off === 1, 'a door record with no off defaults to 1 for a single');
  assertOk(byCol[6].off === 0, 'a door record with no off defaults to 0 for a double');
  g.state.doors[0].off = 2;
  const snap2 = buildWorldSnapshot(g);
  assertOk(snap2.doors.find(d => d.col === 5).off === 2, 'a stored off passes through verbatim');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
