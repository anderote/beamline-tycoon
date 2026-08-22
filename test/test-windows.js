// test/test-windows.js — WINDOW_TYPES catalogue invariants (Task 1: data
// only), plus (Task 2) sim-side state, placement/removal, the fit rule,
// door/window mutual exclusion, save round-trip, and the _detectRoom
// room-separation guarantee that is the entire reason windows have their
// own occupancy map. (Task 3) daylight's contribution to computeRoomMorale.

import {
  WINDOW_TYPES, WINDOW_WIDTH_FRAC, WALL_TYPES, variantCost, windowOpeningHeight,
} from '../src/data/structure.js';
import { demolishRefund } from '../src/input/demolishScopes.js';
import { MODES } from '../src/data/modes.js';
import { Game, DAYLIGHT_ROOM_CAP } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { ZONE_FURNISHINGS } from '../src/data/facility.js';
import {
  windowSubWidth, defaultWindowOff, clampWindowOff, windowOffFromFrac, mirrorWindowOff,
} from '../src/game/edge-keys.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game.save()/load() talk to localStorage; back it with a Map for Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Deep in unused grid territory so nothing the starter map generates
// (trees, starter walls/doors) collides with a hand-placed test wall.
function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  return g;
}

const windowSubsections = MODES.structure.categories.windows.subsections;

console.log('\n=== WINDOW_TYPES catalogue invariants ===\n');
for (const [id, w] of Object.entries(WINDOW_TYPES)) {
  assert(w.isWindow === true, `${id}: isWindow is true`);

  assert(Object.prototype.hasOwnProperty.call(windowSubsections, w.subsection),
    `${id}: subsection '${w.subsection}' is a key of MODES.structure.categories.windows.subsections`);

  assert(typeof w.daylight === 'number' && Number.isFinite(w.daylight) && w.daylight >= 0,
    `${id}: daylight is a finite number >= 0 (got ${w.daylight})`);

  assert(Object.prototype.hasOwnProperty.call(WINDOW_WIDTH_FRAC, w.windowWidth),
    `${id}: windowWidth '${w.windowWidth}' is a key of WINDOW_WIDTH_FRAC`);

  assert(w.sillHeight + w.openingHeight + 1 <= 14,
    `${id}: sillHeight (${w.sillHeight}) + openingHeight (${w.openingHeight}) + 1 fits a standard 14-high wall`);

  assert(windowOpeningHeight(w, w.previewWallHeight) >= w.openingHeight,
    `${id}: its representative wall never shrinks the minimum aperture`);

  if (w.variants) {
    const n = w.variants.length;
    for (const field of ['variantGlassColors', 'variantGlassOpacities', 'variantPreviewColors', 'variantCosts']) {
      assert(Array.isArray(w[field]) && w[field].length === n,
        `${id}: ${field} has the same length as variants (${n})`);
    }
  }
  if (w.mullions) {
    assert(Number.isInteger(w.mullions.vertical) && w.mullions.vertical >= 0,
      `${id}: vertical mullion count is a non-negative integer`);
    assert(Number.isInteger(w.mullions.horizontal) && w.mullions.horizontal >= 0,
      `${id}: horizontal mullion count is a non-negative integer`);
  }
}

console.log('\n=== human-scale and factory-scale window proportions ===\n');
{
  const partition = WINDOW_TYPES.glassPartition;
  const factory = WINDOW_TYPES.industrialSash;
  const observation = WINDOW_TYPES.leadedObservation;
  const viewport = WINDOW_TYPES.hutchViewport;

  assert(WINDOW_WIDTH_FRAC.single >= 0.7 && WINDOW_WIDTH_FRAC.narrow >= 0.6,
    'single and narrow apertures occupy most of a tile instead of reading as slits');
  assert(WINDOW_WIDTH_FRAC.half === 0.5,
    'compact window apertures occupy exactly half of a tile edge');
  assert(partition.sillHeight + windowOpeningHeight(partition, 24) > 19,
    'a glass partition in an interior wall rises above the 19-unit door/head line');
  assert(windowOpeningHeight(factory, 30) >= 24,
    'industrial sash expands into a tall factory aperture in a structural wall');
  assert(observation.sillHeight >= 5 && viewport.sillHeight >= 7,
    'shielded observation panes start at head level instead of the floor');
  assert(windowOpeningHeight(observation, 14) >= observation.openingHeight
      && windowOpeningHeight(viewport, 14) >= viewport.openingHeight,
    'both shielded observation panes retain their minimum aperture on 14-unit walls');
}

console.log('\n=== expanded catalogue, in three subsections ===\n');
{
  const ids = Object.keys(WINDOW_TYPES);
  assert(ids.length === 11, `WINDOW_TYPES has eleven entries (got ${ids.length})`);
  for (const id of [
    'casementWindow', 'serviceWindow', 'clerestoryWindow', 'conferenceWindow', 'ribbonWindow',
  ]) {
    assert(ids.includes(id), `${id} is included in the expanded catalogue`);
  }

  const bySubsection = {};
  for (const w of Object.values(WINDOW_TYPES)) {
    bySubsection[w.subsection] = (bySubsection[w.subsection] || 0) + 1;
  }
  assert(Object.keys(bySubsection).length === 3,
    `entries span three subsections (got ${Object.keys(bySubsection).join(', ')})`);
}

console.log('\n=== compact-window half-edge offset contract ===\n');
{
  const compact = WINDOW_TYPES.casementWindow;
  const broad = WINDOW_TYPES.officeWindow;
  assert(windowSubWidth(compact) === 2, 'a compact window spans two of four edge slots');
  assert(windowSubWidth(broad) === 4, 'existing continuous-width windows do not use edge offsets');
  assert(defaultWindowOff(compact) === 1,
    'an old compact-window record with no offset retains centered fallback geometry');
  assert(windowOffFromFrac(0.1, compact) === 0 && windowOffFromFrac(0.49, compact) === 0,
    'a cursor in the first half selects off=0');
  assert(windowOffFromFrac(0.5, compact) === 2 && windowOffFromFrac(0.9, compact) === 2,
    'a cursor in the second half selects off=2');
  assert(windowOffFromFrac(0.1, broad) === 0 && windowOffFromFrac(0.9, broad) === 0,
    'broader centered windows ignore cursor offsets');
  assert(clampWindowOff(compact, 99) === 2 && clampWindowOff(compact, -4) === 0,
    'compact-window offsets clamp inside the tile edge');
  assert(mirrorWindowOff(0, compact) === 2 && mirrorWindowOff(2, compact) === 0,
    'compact-window offsets mirror across the two spellings of one physical edge');
}

console.log('\n=== MODES.structure.categories.windows ===\n');
{
  const windows = MODES.structure.categories.windows;
  assert(!!windows, 'MODES.structure.categories.windows exists');
  assert(windows.name === 'Windows', `windows category name is 'Windows' (got ${windows.name})`);
  assert(typeof windows.color === 'string' && windows.color.length > 0, 'windows category has a color');

  const structureKeys = Object.keys(MODES.structure.categories);
  const doorsIdx = structureKeys.indexOf('doors');
  const windowsIdx = structureKeys.indexOf('windows');
  assert(doorsIdx !== -1 && windowsIdx === doorsIdx + 1,
    `windows is positioned immediately after doors (doors@${doorsIdx}, windows@${windowsIdx})`);
}

console.log('\n=== place/remove round-trip ===\n');
{
  const g = makeGame(1);
  assert(g.placeWall(10, 10, 'e', 'officeWall'), 'setup: officeWall placed at 10,10,e');
  assert(g.placeWindow(10, 10, 'e', 'officeWindow'), 'placeWindow succeeds on a walled edge');
  assert(g.state.windowOccupied['10,10,e'] === 'officeWindow', 'windowOccupied records the placed type');
  assert(g.state.windows.some(w => w.col === 10 && w.row === 10 && w.edge === 'e' && w.type === 'officeWindow'),
    'state.windows carries the placed entry');

  assert(g.removeWindow(10, 10, 'e'), 'removeWindow succeeds');
  assert(!g.state.windowOccupied['10,10,e'], 'windowOccupied cleared after removal');
  assert(!g.state.windows.some(w => w.col === 10 && w.row === 10 && w.edge === 'e'),
    'state.windows no longer carries the removed entry');
}

console.log('\n=== wall lookup accepts either edge alias ===\n');
{
  const g = makeGame(2);
  // Store the wall under the "w" representation of (50,50,'e'); placeWindow
  // is called with the "e" representation of that same physical edge.
  assert(g.placeWall(51, 50, 'w', 'officeWall'), 'setup: wall stored under the edge-alias representation');
  assert(g.placeWindow(50, 50, 'e', 'officeWindow'), 'placeWindow finds the wall under its edge alias');
  assert(g.state.windowOccupied['50,50,e'] === 'officeWindow',
    'window is stored under the representation placeWindow was called with');
}

console.log('\n=== compact windows place and move between tile halves ===\n');
{
  const g = makeGame(41);
  assert(g.placeWall(80, 10, 'n', 'officeWall'), 'setup: officeWall at 80,10,n');
  assert(g.placeWindow(80, 10, 'n', 'casementWindow', 0, 0),
    'a compact window places on the first tile half');
  assert(g.state.windows[0].off === 0, 'the first-half offset is stored on the window record');
  const fundingBeforeMove = g.state.resources.funding;
  assert(g.placeWindow(80, 10, 'n', 'casementWindow', 0, 2),
    'placing the same compact type on the second half moves it');
  assert(g.state.windows.length === 1 && g.state.windows[0].off === 2,
    'moving a compact window changes its offset without stacking another opening');
  assert(g.state.resources.funding === fundingBeforeMove,
    'moving a same-type compact window on its edge is free');

  assert(g.placeWindow(80, 9, 's', 'casementWindow', 0, 2),
    'the same compact window can be addressed from the opposite tile');
  assert(g.state.windows.length === 1 && g.state.windows[0].off === 0,
    'an aliased second-half request is mirrored into the stored edge order');

  const snap = buildWorldSnapshot(g);
  assert(snap.windows[0].off === 0, 'world snapshots expose a compact window offset');
  delete g.state.windows[0].off;
  assert(buildWorldSnapshot(g).windows[0].off === 1,
    'snapshots give records authored before window offsets the centered fallback');
}

console.log('\n=== fit rule ===\n');
{
  const g = makeGame(3);
  assert(g.placeWall(20, 20, 'e', 'officeWall'), 'setup: officeWall (wallHeight 14) at 20,20,e');
  assert(g.placeWindow(20, 20, 'e', 'officeWindow'),
    'sillHeight(5)+openingHeight(6)+1 = 12 fits officeWall(14): placement succeeds');

  assert(g.placeWall(21, 20, 'e', 'cubicleWall'), 'setup: cubicleWall (wallHeight 11.75) at 21,20,e');
  const fundingBefore = g.state.resources.funding;
  assert(!g.placeWindow(21, 20, 'e', 'officeWindow'),
    'sillHeight(5)+openingHeight(6)+1 = 12 does not fit cubicleWall(11.75): no-op');
  assert(g.state.resources.funding === fundingBefore, 'a fit-rule no-op charges no funding');
  assert(!g.state.windowOccupied['21,20,e'], 'a fit-rule no-op leaves windowOccupied untouched');
  assert(g.state.windows.every(w => !(w.col === 21 && w.row === 20 && w.edge === 'e')),
    'a fit-rule no-op leaves state.windows untouched');
}

console.log('\n=== placeWindowPath skips edges that fail the fit rule ===\n');
{
  const g = makeGame(4);
  assert(g.placeWall(60, 60, 'e', 'officeWall'), 'setup: officeWall at 60,60,e (fits)');
  assert(g.placeWall(61, 60, 'e', 'cubicleWall'), 'setup: cubicleWall at 61,60,e (too short)');
  assert(g.placeWall(62, 60, 'e', 'officeWall'), 'setup: officeWall at 62,60,e (fits)');
  const path = [
    { col: 60, row: 60, edge: 'e' },
    { col: 61, row: 60, edge: 'e' },
    { col: 62, row: 60, edge: 'e' },
  ];
  assert(g.placeWindowPath(path, 'officeWindow') === true,
    'placeWindowPath returns true when at least one edge in the path is placed');
  assert(g.state.windowOccupied['60,60,e'] === 'officeWindow', 'a fitting edge is placed');
  assert(!g.state.windowOccupied['61,60,e'], 'the edge failing the fit rule is skipped');
  assert(g.state.windowOccupied['62,60,e'] === 'officeWindow', 'the second fitting edge is placed');
}

console.log('\n=== door / window mutual exclusion ===\n');
{
  const g = makeGame(5);

  // A window placed on a door edge removes the door.
  assert(g.placeWall(30, 30, 'e', 'officeWall'), 'setup: wall at 30,30,e');
  assert(g.placeDoor(30, 30, 'e', 'officeDoor'), 'setup: officeDoor placed at 30,30,e');
  assert(g.placeWindow(30, 30, 'e', 'officeWindow'), 'placing a window on a door edge succeeds');
  assert(!g.state.doorOccupied['30,30,e'], 'the door is removed from doorOccupied');
  assert(g.state.doors.every(d => !(d.col === 30 && d.row === 30 && d.edge === 'e')),
    'the door is removed from state.doors');
  assert(g.state.windowOccupied['30,30,e'] === 'officeWindow', 'the window now occupies the edge');

  // A door placed on a window edge removes the window (mirror image).
  assert(g.placeWall(31, 30, 'e', 'officeWall'), 'setup: wall at 31,30,e');
  assert(g.placeWindow(31, 30, 'e', 'officeWindow'), 'setup: officeWindow placed at 31,30,e');
  assert(g.placeDoor(31, 30, 'e', 'officeDoor'), 'placing a door on a window edge succeeds');
  assert(!g.state.windowOccupied['31,30,e'], 'the window is removed from windowOccupied');
  assert(g.state.windows.every(w => !(w.col === 31 && w.row === 30 && w.edge === 'e')),
    'the window is removed from state.windows');
  assert(g.state.doorOccupied['31,30,e'] === 'officeDoor', 'the door now occupies the edge');
}

console.log('\n=== door / window mutual exclusion across edge aliases ===\n');
{
  const g = makeGame(9);

  // Window placed under the alias representation removes a door stored
  // under the canonical representation of the same physical edge.
  assert(g.placeWall(5, 5, 'e', 'officeWall'), 'setup: wall at 5,5,e');
  assert(g.placeDoor(5, 5, 'e', 'officeDoor'), 'setup: officeDoor placed at 5,5,e');
  assert(g.placeWindow(6, 5, 'w', 'officeWindow'), 'placing a window at the alias of a door edge succeeds');
  assert(!g.state.doorOccupied['5,5,e'], 'the door is removed from doorOccupied (alias-aware lookup)');
  assert(g.state.doors.every(d => !(d.col === 5 && d.row === 5 && d.edge === 'e')),
    'the door is removed from state.doors');
  assert(g.state.windowOccupied['6,5,w'] === 'officeWindow',
    'the window occupies the edge under the representation it was placed with');

  // Door placed under the canonical representation removes a window stored
  // under the alias representation of the same physical edge (mirror image).
  assert(g.placeWall(7, 5, 'e', 'officeWall'), 'setup: wall at 7,5,e');
  assert(g.placeWindow(8, 5, 'w', 'officeWindow'), 'setup: officeWindow placed at 8,5,w (alias of 7,5,e)');
  assert(g.placeDoor(7, 5, 'e', 'officeDoor'), 'placing a door at the canonical edge removes the aliased window');
  assert(!g.state.windowOccupied['8,5,w'], 'the window is removed from windowOccupied (alias-aware lookup)');
  assert(g.state.windows.every(w => !(w.col === 8 && w.row === 5 && w.edge === 'w')),
    'the window is removed from state.windows');
  assert(g.state.doorOccupied['7,5,e'] === 'officeDoor', 'the door now occupies the edge');
}

// Windows on one physical edge, counted under BOTH representations. The two
// triples name the same seam, so anything above 1 is two windows stacked in
// one hole: charged twice, rendered twice (z-fighting glass, doubled night
// glow), daylight counted twice, and only one of them removable by the
// window-only demolish branch.
function windowsOnEdge(g, col, row, edge) {
  const alias = g._edgeAlias(col, row, edge);
  const keys = new Set([`${col},${row},${edge}`, `${alias.col},${alias.row},${alias.edge}`]);
  return g.state.windows.filter(w => keys.has(`${w.col},${w.row},${w.edge}`));
}

console.log('\n=== window / window exclusion across edge aliases (single placement) ===\n');
{
  const g = makeGame(30);
  // InputHandler._getNearestWallEdge returns the hovered tile's own edge with
  // no canonicalization, so glazing a run from inside a room yields 'e' and
  // glazing the same run from outside yields 'w' on the neighbour tile.
  assert(g.placeWall(40, 5, 'e', 'officeWall'), 'setup: wall at 40,5,e');
  assert(g.placeWindow(40, 5, 'e', 'officeWindow'), 'setup: officeWindow at 40,5,e');

  const fundingBefore = g.state.resources.funding;
  assert(g.placeWindow(41, 5, 'w', 'officeWindow'),
    'glazing the same physical edge from the other side reports success');
  assert(windowsOnEdge(g, 40, 5, 'e').length === 1,
    `the edge still carries exactly one window (got ${windowsOnEdge(g, 40, 5, 'e').length})`);
  assert(g.state.resources.funding === fundingBefore,
    'the repeat pass is a no-op and charges nothing');
  assert(g.state.windowOccupied['40,5,e'] === 'officeWindow' && !g.state.windowOccupied['41,5,w'],
    'the window stays under the representation it was first placed with');

  // A DIFFERENT type at the alias replaces the existing window rather than
  // stacking a second one on the same edge.
  const beforeSwap = g.state.resources.funding;
  assert(g.placeWindow(41, 5, 'w', 'pictureWindow'), 'a different type at the alias is accepted');
  const after = windowsOnEdge(g, 40, 5, 'e');
  assert(after.length === 1 && after[0].type === 'pictureWindow',
    `the edge carries exactly one window, the new type (got ${after.length}: ${after.map(w => w.type).join(', ')})`);
  assert(!g.state.windowOccupied['40,5,e'] && g.state.windowOccupied['41,5,w'] === 'pictureWindow',
    'the old representation is cleared and the new one holds the replacement');
  assert(g.state.resources.funding === beforeSwap - 55,
    `the replacement is charged once at pictureWindow's cost (got ${beforeSwap - g.state.resources.funding})`);
}

console.log('\n=== placeWindowPath across an aliased window edge ===\n');
{
  const g = makeGame(31);
  // Three-edge wall run; the middle edge is already glazed under the OTHER
  // representation of the same seam.
  for (const col of [50, 51, 52]) {
    assert(g.placeWall(col, 7, 's', 'officeWall'), `setup: officeWall at ${col},7,s`);
  }
  assert(g.placeWindow(51, 8, 'n', 'officeWindow'),
    'setup: officeWindow at 51,8,n — the alias of the run\'s middle edge');

  const fundingBefore = g.state.resources.funding;
  const path = [
    { col: 50, row: 7, edge: 's' },
    { col: 51, row: 7, edge: 's' },
    { col: 52, row: 7, edge: 's' },
  ];
  assert(g.placeWindowPath(path, 'officeWindow'), 'dragging the run places the two unglazed edges');
  assert(windowsOnEdge(g, 51, 7, 's').length === 1,
    `the already-glazed middle edge still carries exactly one window ` +
    `(got ${windowsOnEdge(g, 51, 7, 's').length})`);
  assert(!g.state.windowOccupied['51,7,s'],
    'the drag did not add a second entry under the middle edge\'s other representation');
  assert(g.state.resources.funding === fundingBefore - 2 * 30,
    `only the two genuinely new edges are charged (got ${fundingBefore - g.state.resources.funding}, expected 60)`);

  // Dragging the same run a second time is a pure no-op.
  const beforeRepeat = g.state.resources.funding;
  g.placeWindowPath(path, 'officeWindow');
  assert(g.state.resources.funding === beforeRepeat, 'a second identical drag charges nothing');
  assert(windowsOnEdge(g, 50, 7, 's').length === 1 &&
         windowsOnEdge(g, 51, 7, 's').length === 1 &&
         windowsOnEdge(g, 52, 7, 's').length === 1,
    'every edge in the run still carries exactly one window after the repeat drag');
}

console.log('\n=== placeWindowPath across an aliased door edge ===\n');
{
  const g = makeGame(32);
  for (const col of [55, 56, 57]) {
    assert(g.placeWall(col, 7, 's', 'officeWall'), `setup: officeWall at ${col},7,s`);
  }
  assert(g.placeDoor(56, 7, 's', 'officeDoor'), 'setup: officeDoor at 56,7,s');

  // The drag arrives under the OTHER representation of the door's edge.
  const path = [
    { col: 55, row: 8, edge: 'n' },
    { col: 56, row: 8, edge: 'n' },
    { col: 57, row: 8, edge: 'n' },
  ];
  assert(g.placeWindowPath(path, 'officeWindow'), 'the drag places windows along the run');
  assert(!g.state.doorOccupied['56,7,s'],
    'the door on the aliased edge is removed (exactly one opening per edge)');
  assert(g.state.doors.every(d => !(d.col === 56 && d.row === 7 && d.edge === 's')),
    'the door is gone from state.doors');
  assert(windowsOnEdge(g, 56, 7, 's').length === 1,
    `the former door edge carries exactly one window (got ${windowsOnEdge(g, 56, 7, 's').length})`);
}

console.log('\n=== a shorter replacement wall evicts a window it cannot hold ===\n');
{
  const g = makeGame(33);
  assert(g.placeWall(60, 7, 'e', 'officeWall'), 'setup: officeWall (wallHeight 14) at 60,7,e');
  assert(g.placeWindow(60, 7, 'e', 'officeWindow'), 'setup: officeWindow (needs 12) on it');

  const before = g.state.resources.funding;
  assert(g.placeWall(60, 7, 'e', 'cubicleWall'), 'replacing with cubicleWall (wallHeight 11.75) succeeds');
  assert(!g.state.windowOccupied['60,7,e'],
    'the window the new wall cannot hold is removed from windowOccupied');
  assert(g.state.windows.every(w => !(w.col === 60 && w.row === 7 && w.edge === 'e')),
    'the window is removed from state.windows');
  assert(g.state.resources.funding === before - 8 + 15,
    `charged for the cubicleWall (8) and refunded half the window (15) ` +
    `(net ${g.state.resources.funding - before}, expected 7)`);

  // A replacement that still fits leaves the window alone.
  assert(g.placeWall(61, 7, 'e', 'officeWall'), 'setup: officeWall at 61,7,e');
  assert(g.placeWindow(61, 7, 'e', 'officeWindow'), 'setup: officeWindow on it');
  assert(g.placeWall(61, 7, 'e', 'cinderblockWall'),
    'replacing with cinderblockWall (wallHeight 14) succeeds');
  assert(g.state.windowOccupied['61,7,e'] === 'officeWindow',
    'a replacement wall the window still fits leaves it in place');
}

console.log('\n=== a shorter replacement wall evicts an aliased window too ===\n');
{
  const g = makeGame(34);
  assert(g.placeWall(65, 7, 'e', 'officeWall'), 'setup: officeWall at 65,7,e');
  assert(g.placeWindow(66, 7, 'w', 'officeWindow'),
    'setup: window stored under 66,7,w — the alias of the wall\'s edge');
  assert(g.placeWall(65, 7, 'e', 'cubicleWall'), 'replacing the wall with cubicleWall succeeds');
  assert(!g.state.windowOccupied['66,7,w'],
    'the aliased window that no longer fits is removed (both representations are checked)');

  // placeWallPath enforces the same rule.
  assert(g.placeWall(67, 7, 'e', 'officeWall'), 'setup: officeWall at 67,7,e');
  assert(g.placeWindow(67, 7, 'e', 'officeWindow'), 'setup: officeWindow on it');
  assert(g.placeWallPath([{ col: 67, row: 7, edge: 'e' }], 'cubicleWall'),
    'placeWallPath replaces the wall with cubicleWall');
  assert(!g.state.windowOccupied['67,7,e'],
    'placeWallPath evicts the window the shorter wall cannot hold');
}

console.log('\n=== variant costs are charged and refunded, not just declared ===\n');
{
  const g = makeGame(35);
  assert(WINDOW_TYPES.pictureWindow.variantCosts[2] === 70 && WINDOW_TYPES.pictureWindow.cost === 55,
    'setup assumption: Mirrored pictureWindow declares 70 against a base cost of 55');

  assert(g.placeWall(70, 7, 'e', 'officeWall'), 'setup: officeWall at 70,7,e');
  const before = g.state.resources.funding;
  assert(g.placeWindow(70, 7, 'e', 'pictureWindow', 2), 'Mirrored pictureWindow placed');
  assert(before - g.state.resources.funding === 70,
    `charged variantCosts[2] = 70, not the base 55 (got ${before - g.state.resources.funding})`);

  const afterPlace = g.state.resources.funding;
  assert(g.removeWindow(70, 7, 'e'), 'removeWindow succeeds');
  assert(g.state.resources.funding - afterPlace === 35,
    `refunded half of what was actually paid (35), not half the base cost (27) ` +
    `(got ${g.state.resources.funding - afterPlace})`);

  // placeWindowPath charges the same variant cost.
  assert(g.placeWall(71, 7, 'e', 'officeWall'), 'setup: officeWall at 71,7,e');
  const beforePath = g.state.resources.funding;
  assert(g.placeWindowPath([{ col: 71, row: 7, edge: 'e' }], 'pictureWindow', 2),
    'placeWindowPath places a Mirrored pictureWindow');
  assert(beforePath - g.state.resources.funding === 70,
    `placeWindowPath charges variantCosts[2] too (got ${beforePath - g.state.resources.funding})`);
}

console.log('\n=== variantCost: the one rule the charge, the refund and the display all use ===\n');
{
  // The display sites (hud.js palette + hover card, InputHandler's keyboard
  // preview card, and the demolish tooltip via demolishRefund) all price a
  // def through variantCost, so what is advertised is what is charged.
  assert(variantCost(WINDOW_TYPES.pictureWindow, 2) === 70,
    `variantCost prices a Mirrored pictureWindow at its variant cost, 70 (got ${variantCost(WINDOW_TYPES.pictureWindow, 2)})`);
  assert(variantCost(WINDOW_TYPES.pictureWindow, 0) === 55,
    'variant 0 is the base cost');
  assert(variantCost(WINDOW_TYPES.hutchViewport, 1) === WINDOW_TYPES.hutchViewport.cost,
    'a def with no variantCosts falls back to the flat cost for any variant');
  assert(variantCost(null, 0) === 0, 'a missing def prices at 0');
  assert(variantCost({ cost: { funding: 42 } }, 0) === 42,
    'an object-shaped cost (components) resolves to its funding field');
  assert(variantCost(WALL_TYPES.structuralWall, 3) === 35,
    `walls go through the same rule — Reinforced structuralWall is 35 (got ${variantCost(WALL_TYPES.structuralWall, 3)})`);

  // demolishRefund is what the demolish tooltip previews.
  assert(demolishRefund(WINDOW_TYPES.pictureWindow, 2) === 35,
    `demolishRefund previews half the variant cost (35), not half the base (27) (got ${demolishRefund(WINDOW_TYPES.pictureWindow, 2)})`);
  assert(demolishRefund(WALL_TYPES.structuralWall, 3) === 17,
    `demolishRefund on a Reinforced structuralWall previews 17 (got ${demolishRefund(WALL_TYPES.structuralWall, 3)})`);
  assert(demolishRefund(WALL_TYPES.officeWall) === Math.floor(WALL_TYPES.officeWall.cost * 0.5),
    'a def with no variantCosts is unchanged by the variant-aware signature');
}

console.log('\n=== the previewed refund is the refund actually paid ===\n');
{
  const g = makeGame(36);
  // Window: placed and demolished at a non-default variant.
  assert(g.placeWall(75, 7, 'e', 'officeWall'), 'setup: officeWall at 75,7,e');
  assert(g.placeWindow(75, 7, 'e', 'pictureWindow', 2), 'setup: Mirrored pictureWindow on it');
  let before = g.state.resources.funding;
  assert(g.removeWindow(75, 7, 'e'), 'removeWindow succeeds');
  assert(g.state.resources.funding - before === demolishRefund(WINDOW_TYPES.pictureWindow, 2),
    `the window refund matches what demolishRefund previewed (${demolishRefund(WINDOW_TYPES.pictureWindow, 2)}, ` +
    `got ${g.state.resources.funding - before})`);

  // Wall: same guarantee, and the reason removeWall's refund had to become
  // variant-aware alongside the tooltip.
  assert(g.placeWall(76, 7, 'e', 'structuralWall', 3), 'setup: Reinforced structuralWall at 76,7,e');
  before = g.state.resources.funding;
  assert(g.removeWall(76, 7, 'e'), 'removeWall succeeds');
  assert(g.state.resources.funding - before === demolishRefund(WALL_TYPES.structuralWall, 3),
    `the wall refund matches what demolishRefund previewed (${demolishRefund(WALL_TYPES.structuralWall, 3)}, ` +
    `got ${g.state.resources.funding - before})`);

  // And the charge it mirrors.
  before = g.state.resources.funding;
  assert(g.placeWall(77, 7, 'e', 'structuralWall', 3), 'placing a Reinforced structuralWall');
  assert(before - g.state.resources.funding === variantCost(WALL_TYPES.structuralWall, 3),
    `placeWall charges the variant cost the palette now displays (got ${before - g.state.resources.funding})`);
}

console.log('\n=== removeWall clears an orphaned window ===\n');
{
  const g = makeGame(10);
  assert(g.placeWall(15, 15, 'e', 'officeWall'), 'setup: wall at 15,15,e');
  assert(g.placeWindow(15, 15, 'e', 'officeWindow'), 'setup: window placed on the wall');
  assert(g.removeWall(15, 15, 'e'), 'removeWall succeeds');
  assert(!g.state.windowOccupied['15,15,e'], 'the orphaned window is cleared from windowOccupied');
  assert(g.state.windows.every(w => !(w.col === 15 && w.row === 15 && w.edge === 'e')),
    'the orphaned window is removed from state.windows');
}

console.log('\n=== removeWall clears an orphaned window stored under the edge alias ===\n');
{
  // placeWindow deliberately accepts a wall found under either edge
  // representation (unlike placeDoor, which requires an exact match), so a
  // window's own storage key can legitimately differ from the wall's. This
  // reproduces that mismatch and confirms removeWall's window cascade
  // clears it — not just the exact-key case the earlier test covers.
  const g = makeGame(13);
  assert(g.placeWall(35, 35, 'w', 'officeWall'), 'setup: wall stored under the "35,35,w" representation');
  assert(g.placeWindow(34, 35, 'e', 'officeWindow'),
    'setup: window placed under "34,35,e", the alias of the wall\'s edge, and accepted via the alias-aware wall check');
  assert(g.state.windowOccupied['34,35,e'] === 'officeWindow', 'setup: window recorded under its own (alias) key');
  assert(!g.state.wallOccupied['34,35,e'], 'setup sanity: no wall is stored under the window\'s own key');

  const fundingBefore = g.state.resources.funding;
  assert(g.removeWall(35, 35, 'w'), 'removeWall succeeds, called at the wall\'s own (non-alias) key');
  assert(!g.state.windowOccupied['34,35,e'],
    'the aliased window is cleared from windowOccupied (not left dangling with no backing wall)');
  assert(g.state.windows.every(w => !(w.col === 34 && w.row === 35 && w.edge === 'e')),
    'the aliased window is removed from state.windows');

  const wallRefund = Math.floor(15 * 0.5);      // officeWall.cost = 15
  const windowRefund = Math.floor(30 * 0.5);    // officeWindow.cost = 30
  assert(g.state.resources.funding === fundingBefore + wallRefund + windowRefund,
    `funding is credited for both the wall (+${wallRefund}) and the aliased window (+${windowRefund}) ` +
    `(got +${g.state.resources.funding - fundingBefore})`);
}

console.log('\n=== replacing a window type with insufficient funds is a clean no-op ===\n');
{
  const g = makeGame(11);
  assert(g.placeWall(16, 16, 'e', 'officeWall'), 'setup: wall at 16,16,e (fits both officeWindow and pictureWindow)');
  assert(g.placeWindow(16, 16, 'e', 'officeWindow'), 'setup: officeWindow placed at 16,16,e');
  g.state.resources.funding = 0;
  assert(!g.placeWindow(16, 16, 'e', 'pictureWindow'), 'replacing with pictureWindow fails when funding is insufficient');
  assert(g.state.windowOccupied['16,16,e'] === 'officeWindow',
    'windowOccupied still names the original type after the failed replace');
  const entries = g.state.windows.filter(w => w.col === 16 && w.row === 16 && w.edge === 'e');
  assert(entries.length === 1 && entries[0].type === 'officeWindow',
    'state.windows still holds exactly the original entry, not a dangling gap');
}

console.log('\n=== replacing a door type with insufficient funds is a clean no-op (placeDoor, same guarantee as placeWindow above) ===\n');
{
  const g = makeGame(12);
  assert(g.placeWall(17, 16, 'e', 'officeWall'), 'setup: wall at 17,16,e');
  assert(g.placeDoor(17, 16, 'e', 'officeDoor'), 'setup: officeDoor placed at 17,16,e');
  g.state.resources.funding = 0;
  assert(!g.placeDoor(17, 16, 'e', 'securityDoor'), 'replacing with securityDoor fails when funding is insufficient');
  assert(g.state.doorOccupied['17,16,e'] === 'officeDoor',
    'doorOccupied still names the original type after the failed replace');
  const entries = g.state.doors.filter(d => d.col === 17 && d.row === 16 && d.edge === 'e');
  assert(entries.length === 1 && entries[0].type === 'officeDoor',
    'state.doors still holds exactly the original entry, not a dangling gap');
}

console.log('\n=== windowOccupied rebuilt after a save round-trip ===\n');
{
  const g = makeGame(6);
  assert(g.placeWall(40, 40, 'e', 'officeWall'), 'setup: wall at 40,40,e');
  assert(g.placeWindow(40, 40, 'e', 'officeWindow', 1), 'setup: window placed with variant 1');
  assert(g.placeWall(41, 40, 'e', 'officeWall'), 'setup: second wall at 41,40,e');
  assert(g.placeWindow(41, 40, 'e', 'casementWindow', 2, 2),
    'setup: compact window placed with variant 2 at off=2');
  g.save();

  const gB = makeGame(7); // different seed: load must fully replace starter state
  assert(gB.load(), 'load() succeeds on the saved payload');
  assert(gB.state.windowOccupied['40,40,e'] === 'officeWindow',
    'windowOccupied is rebuilt from windows after load()');
  const loaded = gB.state.windows.find(w => w.col === 40 && w.row === 40 && w.edge === 'e');
  assert(!!loaded && loaded.variant === 1, 'the loaded window entry keeps its variant');
  const compact = gB.state.windows.find(w => w.col === 41 && w.row === 40 && w.edge === 'e');
  assert(!!compact && compact.variant === 2 && compact.off === 2,
    'the loaded compact window keeps its variant and half-edge offset');
}

console.log('\n=== rooms stay separate across a window, merge across a door ===\n');
{
  const g = makeGame(8);
  // Fully enclose a 2-tile box, leaving only the (100,100)|(101,100) shared
  // edge unaccounted for below — _detectRoom has no bounds otherwise, so an
  // open field would just flow around a single wall segment instead of
  // being blocked by it.
  for (const [col, row, edge] of [
    [100, 100, 'n'], [100, 100, 's'], [100, 100, 'w'],
    [101, 100, 'n'], [101, 100, 's'], [101, 100, 'e'],
  ]) {
    assert(g.placeWall(col, row, edge, 'officeWall'), `setup: box wall at ${col},${row},${edge}`);
  }
  assert(g.placeWall(100, 100, 'e', 'officeWall'), 'setup: wall between (100,100) and (101,100)');
  const baseline = g._detectRoom(100, 100);
  assert(!baseline.has('101,100'), 'baseline: a plain wall keeps the two tiles apart');

  // A door on that edge merges the rooms.
  assert(g.placeDoor(100, 100, 'e', 'officeDoor'), 'setup: door placed on the wall');
  const withDoor = g._detectRoom(100, 100);
  assert(withDoor.has('101,100'), 'a door on the edge merges the two tiles into one room');

  // Replacing the door with a window must keep the rooms separate — this is
  // the entire reason windows get their own occupancy map instead of riding
  // along in doorOccupied.
  assert(g.placeWindow(100, 100, 'e', 'officeWindow'), 'window replaces the door on the same edge');
  assert(!g.state.doorOccupied['100,100,e'], 'the door is gone (mutual exclusion)');
  const withWindow = g._detectRoom(100, 100);
  assert(!withWindow.has('101,100'),
    'a window on the edge does NOT merge the two tiles — _detectRoom never reads windowOccupied');
}

console.log('\n=== daylight: two officeWindows on an enclosed room ===\n');
{
  const g = makeGame(20);
  // Fully enclose a single tile.
  for (const edge of ['n', 's', 'e', 'w']) {
    assert(g.placeWall(200, 200, edge, 'officeWall'), `setup: officeWall at 200,200,${edge}`);
  }
  assert(g.placeWindow(200, 200, 'n', 'officeWindow'), 'setup: officeWindow at 200,200,n');
  assert(g.placeWindow(200, 200, 's', 'officeWindow'), 'setup: officeWindow at 200,200,s');

  const room = g._detectRoom(200, 200);
  const roomKey = [...room].sort()[0];
  const morale = g.computeRoomMorale();
  assert(Math.abs((morale.get(roomKey) || 0) - 0.8) < 1e-9,
    `room gains 0.4 + 0.4 = 0.8 daylight from the two officeWindows (got ${morale.get(roomKey)})`);
}

console.log('\n=== daylight: ten pictureWindows saturate at DAYLIGHT_ROOM_CAP, furnishing morale still adds on top ===\n');
{
  const g = makeGame(21);
  // A 1x5 corridor, fully enclosed, giving 10 distinct n/s edges to glaze.
  for (let col = 210; col <= 214; col++) {
    assert(g.placeWall(col, 200, 'n', 'officeWall'), `setup: officeWall at ${col},200,n`);
    assert(g.placeWall(col, 200, 's', 'officeWall'), `setup: officeWall at ${col},200,s`);
  }
  assert(g.placeWall(210, 200, 'w', 'officeWall'), 'setup: officeWall at 210,200,w (west end cap)');
  assert(g.placeWall(214, 200, 'e', 'officeWall'), 'setup: officeWall at 214,200,e (east end cap)');

  for (let col = 210; col <= 214; col++) {
    assert(g.placeWindow(col, 200, 'n', 'pictureWindow'), `setup: pictureWindow at ${col},200,n`);
    assert(g.placeWindow(col, 200, 's', 'pictureWindow'), `setup: pictureWindow at ${col},200,s`);
  }

  const room = g._detectRoom(210, 200);
  assert(room.size === 5, `corridor room is exactly the 5 enclosed tiles (got ${room.size})`);
  const roomKey = [...room].sort()[0];

  const daylightOnly = g.computeRoomMorale();
  assert(daylightOnly.get(roomKey) === DAYLIGHT_ROOM_CAP,
    `10 pictureWindows (10 x 0.8 = 8.0) saturate at DAYLIGHT_ROOM_CAP = ${DAYLIGHT_ROOM_CAP} (got ${daylightOnly.get(roomKey)})`);

  // Furnishing morale in the same room adds on top of the capped daylight.
  g.state.zoneItems.push({ id: 'daylight-test-coffee', type: 'coffeeMachine', col: 212, row: 200 });
  assert(ZONE_FURNISHINGS.coffeeMachine.effects.morale === 2,
    'setup assumption: coffeeMachine effects.morale is 2 (fixture may need updating if this drifts)');
  const withFurnishing = g.computeRoomMorale();
  const expected = DAYLIGHT_ROOM_CAP + ZONE_FURNISHINGS.coffeeMachine.effects.morale;
  assert(Math.abs((withFurnishing.get(roomKey) || 0) - expected) < 1e-9,
    `capped daylight (${DAYLIGHT_ROOM_CAP}) + uncapped furnishing morale (2) = ${expected} (got ${withFurnishing.get(roomKey)})`);
}

console.log('\n=== daylight: a window on an unenclosed exterior wall adds nothing ===\n');
{
  const g = makeGame(22);
  assert(g.placeWall(220, 200, 'e', 'officeWall'), 'setup: a single wall segment, nothing enclosed either side');
  assert(g.placeWindow(220, 200, 'e', 'pictureWindow'), 'setup: pictureWindow on that wall');

  const sideA = g._detectRoom(220, 200);
  const sideB = g._detectRoom(221, 200);
  assert(sideA.size >= 500 && sideB.size >= 500,
    `both sides of the window are unenclosed and hit the flood-fill cap (got ${sideA.size}, ${sideB.size})`);

  const morale = g.computeRoomMorale();
  assert(morale.size === 0,
    `an outdoor window contributes no daylight and no other morale source exists (map has ${morale.size} entries)`);
}

console.log('\n=== daylight: a glassPartition between two enclosed rooms credits both ===\n');
{
  const g = makeGame(23);
  // Two 1-tile rooms sharing an edge, each otherwise fully enclosed —
  // the same box-enclosure pattern the "rooms stay separate" test above uses.
  for (const [col, row, edge] of [
    [230, 200, 'n'], [230, 200, 's'], [230, 200, 'w'],
    [231, 200, 'n'], [231, 200, 's'], [231, 200, 'e'],
  ]) {
    assert(g.placeWall(col, row, edge, 'officeWall'), `setup: box wall at ${col},${row},${edge}`);
  }
  assert(g.placeWall(230, 200, 'e', 'officeWall'), 'setup: shared wall between the two rooms');
  assert(g.placeWindow(230, 200, 'e', 'glassPartition'), 'setup: glassPartition on the shared wall');

  const roomA = g._detectRoom(230, 200);
  const roomB = g._detectRoom(231, 200);
  assert(!roomA.has('231,200') && !roomB.has('230,200'), 'setup: the two rooms stay separate (window, not door)');

  const roomKeyA = [...roomA].sort()[0];
  const roomKeyB = [...roomB].sort()[0];
  const morale = g.computeRoomMorale();
  assert(morale.get(roomKeyA) === WINDOW_TYPES.glassPartition.daylight,
    `room A gains the glassPartition's daylight (${WINDOW_TYPES.glassPartition.daylight}), got ${morale.get(roomKeyA)}`);
  assert(morale.get(roomKeyB) === WINDOW_TYPES.glassPartition.daylight,
    `room B gains the glassPartition's daylight too — borrowed light on both sides (got ${morale.get(roomKeyB)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
