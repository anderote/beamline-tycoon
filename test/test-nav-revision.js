// test/test-nav-revision.js — isBlocked export and Game.state.navRevision.
//
// Task 1 of the staff-professions-2 nav-and-stations plan: exports
// isBlocked from src/networks/rooms.js unchanged (the one source of truth
// for what a wall means — nav.js in task 2 must reuse it rather than
// growing a second wall test), and adds a _markNavDirty()-bumped
// state.navRevision so the task-2 nav grid can tell when infraOccupied /
// wallOccupied / doorOccupied / placeables moved without a count-based
// signature (which misses a same-tick demolish-and-replace: the count is
// unchanged even though the topology moved).

import { isBlocked } from '../src/networks/rooms.js';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game talks to localStorage; back it with a Map for Node.
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

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  return g;
}

// Find a clear spot for a placeable of the given type on the starter map.
function placeSomewhere(g, type) {
  for (let row = 2; row < 60; row += 3) {
    for (let col = 2; col < 60; col += 3) {
      const id = g.placePlaceable({ type, col, row });
      if (id) return { id, col, row };
    }
  }
  return null;
}

console.log('\n=== 1. isBlocked is exported and behaves as before ===\n');
{
  const empty = { wallOccupied: {}, doorOccupied: {} };
  assertOk(typeof isBlocked === 'function', 'isBlocked is importable from src/networks/rooms.js');
  assertOk(isBlocked(0, 0, 'e', empty) === false, 'no wall on either key -> not blocked');

  const walled = { wallOccupied: { '0,0,e': 'officeWall' }, doorOccupied: {} };
  assertOk(isBlocked(0, 0, 'e', walled) === true, 'wall on the queried key blocks');

  const walledOpposite = { wallOccupied: { '1,0,w': 'officeWall' }, doorOccupied: {} };
  assertOk(isBlocked(0, 0, 'e', walledOpposite) === true,
    "wall stored on the neighbour's opposite edge key blocks too");

  const doored = { wallOccupied: { '0,0,e': 'officeWall' }, doorOccupied: { '0,0,e': 'officeDoor' } };
  assertOk(isBlocked(0, 0, 'e', doored) === false, 'a door on the same key opens the wall');

  const dooredOpposite = { wallOccupied: { '0,0,e': 'officeWall' }, doorOccupied: { '1,0,w': 'officeDoor' } };
  assertOk(isBlocked(0, 0, 'e', dooredOpposite) === false,
    "a door on the neighbour's opposite key opens it too");
}

console.log('\n=== 2. Fresh game starts at navRevision 0 ===\n');
{
  const g = makeGame(1);
  assertOk(g.state.navRevision === 0, `navRevision starts at 0 (got ${g.state.navRevision})`);
}

console.log('\n=== 3. Floor placement and removal each bump navRevision ===\n');
{
  const g = makeGame(2);
  const before = g.state.navRevision;
  const placed = g.placeInfraTile(5, 5, 'concrete');
  assertOk(placed, 'placed a concrete tile');
  assertOk(g.state.navRevision > before,
    `placing a floor tile bumped navRevision (${before} -> ${g.state.navRevision})`);

  const afterPlace = g.state.navRevision;
  const removed = g.removeInfraTile(5, 5);
  assertOk(removed, 'removed the tile');
  assertOk(g.state.navRevision > afterPlace,
    `removing a floor tile bumped navRevision again (${afterPlace} -> ${g.state.navRevision})`);
}

console.log('\n=== 4. Wall placement, then door placement, each bump navRevision ===\n');
{
  const g = makeGame(3);
  const before = g.state.navRevision;
  const wallOk = g.placeWall(5, 5, 'e', 'officeWall');
  assertOk(wallOk, 'placed a wall');
  assertOk(g.state.navRevision > before,
    `placing a wall bumped navRevision (${before} -> ${g.state.navRevision})`);

  const afterWall = g.state.navRevision;
  const doorOk = g.placeDoor(5, 5, 'e', 'officeDoor');
  assertOk(doorOk, 'placed a door on that wall');
  assertOk(g.state.navRevision > afterWall,
    `placing a door bumped navRevision again (${afterWall} -> ${g.state.navRevision})`);
}

console.log('\n=== 5. Placing a furnishing bumps navRevision ===\n');
{
  const g = makeGame(4);
  const before = g.state.navRevision;
  const placed = placeSomewhere(g, 'coffeeMachine');
  assertOk(placed, 'placed a coffee machine');
  assertOk(g.state.navRevision > before,
    `placing a furnishing bumped navRevision (${before} -> ${g.state.navRevision})`);
}

console.log('\n=== 6. Demolish-and-replace in the same tick bumps navRevision twice ===\n');
{
  // Regression guard for a count-based cache signature: removing a wall at
  // one tile and placing a different wall at another tile leaves the total
  // wall count unchanged even though the topology moved. navRevision must
  // register both mutations, not net them out to zero.
  const g = makeGame(5);
  const setupOk = g.placeWall(10, 10, 'n', 'officeWall');
  assertOk(setupOk, 'setup: placed a wall to demolish');

  const before = g.state.navRevision;
  const removed = g.removeWall(10, 10, 'n');
  assertOk(removed, 'demolished the wall');
  const afterRemove = g.state.navRevision;
  assertOk(afterRemove > before,
    `demolishing the wall bumped navRevision (${before} -> ${afterRemove})`);

  const placedAgain = g.placeWall(10, 11, 's', 'officeWall');
  assertOk(placedAgain, 'placed a different wall in the same tick (wall count is back to where it started)');
  assertOk(g.state.navRevision > afterRemove,
    `placing the replacement wall bumped navRevision a second time, ` +
    `not left unchanged by a count-based signature (${afterRemove} -> ${g.state.navRevision})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
