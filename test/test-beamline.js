// test/test-beamline.js — Node.js tests for Beamline directed graph

import { Beamline } from '../src/beamline/Beamline.js';
import { COMPONENTS } from '../src/data/components.js';
import { DIR } from '../src/data/directions.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

// Make globals available for modules that reference them internally
globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// --- Test harness ---
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg} (expected ${expected}, got ${actual})`);
  }
}

// --- Tests ---

console.log('\n=== Beamline Directed Graph Tests ===\n');

// Test 1: Place source
console.log('-- Place source --');
{
  const bl = new Beamline();
  const id = bl.placeSource(5, 5, DIR.NE);
  assert(id !== null, 'placeSource returns a nodeId');
  const node = bl.getAllNodes()[0];
  assertEq(node.type, 'source', 'node type is source');
  assertEq(node.col, 5, 'node col is 5');
  assertEq(node.row, 5, 'node row is 5');
  assertEq(node.dir, DIR.NE, 'node dir is NE');
  assertEq(node.tiles.length, 2, 'source has 2 tiles (trackLength=2)');
  // Tiles: (5,5) and (5,4) for NE (cardinal: dc=0, dr=-1)
  assertEq(node.tiles[0].col, 5, 'first tile col');
  assertEq(node.tiles[0].row, 5, 'first tile row');
  assertEq(node.tiles[1].col, 5, 'second tile col');
  assertEq(node.tiles[1].row, 4, 'second tile row');
}

// Test 2: Build cursor after source
console.log('\n-- Build cursor after source --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  assertEq(cursors.length, 1, 'one build cursor after source');
  // After source: last tile is (5,4), next NE step is (5,3)
  assertEq(cursors[0].col, 5, 'cursor col is 5');
  assertEq(cursors[0].row, 3, 'cursor row is 3');
  assertEq(cursors[0].dir, DIR.NE, 'cursor dir is NE');
}

// Test 3: Place drift after source, cursor advances
console.log('\n-- Place drift after source --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  const driftId = bl.placeAt(cursors[0], 'drift');
  assert(driftId !== null, 'drift placed successfully');
  const newCursors = bl.getBuildCursors();
  assertEq(newCursors.length, 1, 'one cursor after drift');
  // drift trackLength=1, placed at (5,3), next NE is (5,2)
  assertEq(newCursors[0].col, 5, 'cursor col after drift');
  assertEq(newCursors[0].row, 2, 'cursor row after drift');
}

// Test 4: Dipole right — NE -> SE direction change
console.log('\n-- Dipole right: NE -> SE --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  const dipId = bl.placeAt(cursors[0], 'dipole', 'right');
  assert(dipId !== null, 'dipole placed');
  const node = bl.getAllNodes().find(n => n.id === dipId);
  assertEq(node.dir, DIR.SE, 'dipole exit dir is SE (turned right from NE)');
  const newCursors = bl.getBuildCursors();
  assertEq(newCursors[0].dir, DIR.SE, 'cursor dir is SE after right dipole');
}

// Test 5: Dipole left — NE -> NW direction change
console.log('\n-- Dipole left: NE -> NW --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  const dipId = bl.placeAt(cursors[0], 'dipole', 'left');
  assert(dipId !== null, 'dipole placed');
  const node = bl.getAllNodes().find(n => n.id === dipId);
  assertEq(node.dir, DIR.NW, 'dipole exit dir is NW (turned left from NE)');
}

// Test 6: Splitter creates two build cursors
console.log('\n-- Splitter creates two cursors --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  const splId = bl.placeAt(cursors[0], 'splitter');
  assert(splId !== null, 'splitter placed');
  const newCursors = bl.getBuildCursors();
  assertEq(newCursors.length, 2, 'splitter gives two cursors');
  // One straight (NE), one branched (turnLeft = NW)
  const dirs = newCursors.map(c => c.dir).sort();
  assert(dirs.includes(DIR.NE), 'one cursor continues NE (straight)');
  assert(dirs.includes(DIR.NW), 'one cursor goes NW (branched/turnLeft)');
}

// Test 7: getOrderedComponents returns nodes in order
console.log('\n-- getOrderedComponents ordering --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c1 = bl.getBuildCursors();
  bl.placeAt(c1[0], 'drift');
  const c2 = bl.getBuildCursors();
  bl.placeAt(c2[0], 'quadrupole');
  const ordered = bl.getOrderedComponents();
  assertEq(ordered.length, 3, 'three components ordered');
  assertEq(ordered[0].type, 'source', 'first is source');
  assertEq(ordered[1].type, 'drift', 'second is drift');
  assertEq(ordered[2].type, 'quadrupole', 'third is quadrupole');
}

// Test 8: Occupied tiles tracked
console.log('\n-- Occupied tiles --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  assert(bl.isTileOccupied(5, 5), 'tile (5,5) occupied');
  assert(bl.isTileOccupied(5, 4), 'tile (5,4) occupied');
  assert(!bl.isTileOccupied(5, 3), 'tile (5,3) not occupied');
  const node = bl.getNodeAt(5, 5);
  assertEq(node.type, 'source', 'getNodeAt returns correct node');
}

// Test 9: Remove last node works
console.log('\n-- Remove leaf node --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c = bl.getBuildCursors();
  const driftId = bl.placeAt(c[0], 'drift');
  assertEq(bl.getAllNodes().length, 2, 'two nodes before remove');
  const ok = bl.removeNode(driftId);
  assert(ok, 'removeNode returns true for leaf');
  assertEq(bl.getAllNodes().length, 1, 'one node after remove');
  assert(!bl.isTileOccupied(5, 3), 'drift tile freed');
}

// Test 10: Cannot place on occupied tile
console.log('\n-- Cannot place on occupied tile --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  // Try to place another source at the same position
  const id2 = bl.placeSource(5, 5, DIR.SE);
  assertEq(id2, null, 'cannot place on occupied tile');
}

// Test 11: Cannot remove non-leaf node
console.log('\n-- Cannot remove non-leaf --');
{
  const bl = new Beamline();
  const srcId = bl.placeSource(5, 5, DIR.NE);
  const c = bl.getBuildCursors();
  bl.placeAt(c[0], 'drift');
  const ok = bl.removeNode(srcId);
  assert(!ok, 'removeNode returns false for non-leaf');
  assertEq(bl.getAllNodes().length, 2, 'nodes unchanged after failed remove');
}

// Test 12: Endpoint has no build cursor
console.log('\n-- Endpoint has no build cursor --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c = bl.getBuildCursors();
  bl.placeAt(c[0], 'faradayCup');
  const newCursors = bl.getBuildCursors();
  assertEq(newCursors.length, 0, 'faradayCup (endpoint) produces no cursor');
}

// Test 13: toJSON / fromJSON round-trip
console.log('\n-- Serialization round-trip --');
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c = bl.getBuildCursors();
  bl.placeAt(c[0], 'drift');
  const json = bl.toJSON();
  const bl2 = new Beamline();
  bl2.fromJSON(json);
  assertEq(bl2.getAllNodes().length, 2, 'deserialized has 2 nodes');
  assert(bl2.isTileOccupied(5, 5), 'deserialized occupied map correct');
  assertEq(bl2.getBuildCursors().length, 1, 'deserialized cursors work');
}

console.log('\n-- Param initialization on placement --');
{
  const bl = new Beamline();
  const id = bl.placeSource(5, 5, DIR.NE);
  const node = bl.nodes.find(n => n.id === id);
  assert(node.params !== undefined, 'placed source has params');
  assert(node.params.extractionVoltage === 50, 'extractionVoltage initialized to default');
  assert(node.params.cathodeTemperature === 1200, 'cathodeTemperature initialized to default');
  assert(node.params.beamCurrent === undefined, 'derived param beamCurrent not in params');
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
