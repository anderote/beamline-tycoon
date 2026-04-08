// test/test-registry.js — Node.js tests for BeamlineRegistry

import { BeamlineRegistry, makeDefaultBeamState } from '../src/beamline/BeamlineRegistry.js';

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

console.log('\n=== BeamlineRegistry Tests ===\n');

// Test 1: Create a beamline
console.log('-- Create beamline --');
{
  const reg = new BeamlineRegistry();
  const entry = reg.createBeamline('synchrotron');
  assert(entry !== null, 'createBeamline returns an entry');
  assertEq(entry.id, 'bl-1', 'first beamline id is bl-1');
  assertEq(entry.name, 'Beamline-1', 'first beamline name is Beamline-1');
  assertEq(entry.status, 'stopped', 'initial status is stopped');
  assert(entry.beamline !== undefined, 'entry has a Beamline instance');
  assert(entry.beamState !== undefined, 'entry has a beamState');
  assertEq(entry.beamState.machineType, 'synchrotron', 'beamState machineType matches');
  assertEq(entry.beamState.beamEnergy, 0, 'beamState beamEnergy default is 0');
  assertEq(entry.beamState.beamQuality, 1, 'beamState beamQuality default is 1');
  assertEq(entry.beamState.uptimeFraction, 1, 'beamState uptimeFraction default is 1');
  assertEq(entry.beamState.physicsAlive, true, 'beamState physicsAlive default is true');
}

// Test 2: Multiple beamlines get unique IDs
console.log('\n-- Multiple beamlines --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  const e2 = reg.createBeamline('collider');
  const e3 = reg.createBeamline('synchrotron');
  assertEq(e1.id, 'bl-1', 'first id is bl-1');
  assertEq(e2.id, 'bl-2', 'second id is bl-2');
  assertEq(e3.id, 'bl-3', 'third id is bl-3');
  assertEq(e1.name, 'Beamline-1', 'first name');
  assertEq(e2.name, 'Beamline-2', 'second name');
  assertEq(e3.name, 'Beamline-3', 'third name');
  assertEq(e2.beamState.machineType, 'collider', 'second beamline machineType is collider');
}

// Test 3: Get by ID
console.log('\n-- Get by ID --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac');
  reg.createBeamline('collider');
  const entry = reg.get('bl-2');
  assert(entry !== undefined, 'get returns entry for bl-2');
  assertEq(entry.beamState.machineType, 'collider', 'retrieved entry has correct machineType');
  const missing = reg.get('bl-99');
  assertEq(missing, undefined, 'get returns undefined for missing id');
}

// Test 4: Shared occupancy — tiles tracked across beamlines
console.log('\n-- Shared occupancy --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac');
  reg.createBeamline('collider');

  const node1 = { id: 'n1', tiles: [{ col: 3, row: 4 }, { col: 3, row: 5 }] };
  const node2 = { id: 'n2', tiles: [{ col: 7, row: 8 }] };

  reg.occupyTiles('bl-1', node1);
  reg.occupyTiles('bl-2', node2);

  assert(reg.isTileOccupied(3, 4), 'tile (3,4) occupied by bl-1');
  assert(reg.isTileOccupied(3, 5), 'tile (3,5) occupied by bl-1');
  assert(reg.isTileOccupied(7, 8), 'tile (7,8) occupied by bl-2');
  assert(!reg.isTileOccupied(0, 0), 'tile (0,0) not occupied');
}

// Test 5: Remove beamline frees its tiles
console.log('\n-- Remove beamline --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac');
  reg.createBeamline('collider');

  const node1 = { id: 'n1', tiles: [{ col: 3, row: 4 }] };
  reg.occupyTiles('bl-1', node1);

  // Add a fake node to bl-1's beamline so removal can free tiles
  const entry = reg.get('bl-1');
  entry.beamline.nodes.push({ id: 'n1', tiles: [{ col: 3, row: 4 }] });

  reg.removeBeamline('bl-1');

  assertEq(reg.get('bl-1'), undefined, 'bl-1 removed from registry');
  assert(!reg.isTileOccupied(3, 4), 'tile (3,4) freed after removal');

  const all = reg.getAll();
  assertEq(all.length, 1, 'one beamline remaining');
  assertEq(all[0].id, 'bl-2', 'remaining beamline is bl-2');
}

// Test 6: Serialization round-trip
console.log('\n-- Serialization round-trip --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  const e2 = reg.createBeamline('collider');
  e1.status = 'running';
  e1.beamState.beamEnergy = 42;

  const node1 = { id: 'n1', tiles: [{ col: 1, row: 2 }] };
  reg.occupyTiles('bl-1', node1);

  const json = reg.toJSON();
  const reg2 = new BeamlineRegistry();
  reg2.fromJSON(json);

  assertEq(reg2.getAll().length, 2, 'deserialized has 2 beamlines');
  const restored = reg2.get('bl-1');
  assert(restored !== undefined, 'bl-1 exists after deserialization');
  assertEq(restored.status, 'running', 'status preserved');
  assertEq(restored.beamState.beamEnergy, 42, 'beamState preserved');
  assertEq(restored.beamState.machineType, 'linac', 'machineType preserved');
  assert(reg2.isTileOccupied(1, 2), 'shared occupancy restored');
}

// Test 7: getAllNodes aggregate
console.log('\n-- getAllNodes aggregate --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac');
  reg.createBeamline('collider');

  // Manually add nodes to each beamline's Beamline instance
  const e1 = reg.get('bl-1');
  const e2 = reg.get('bl-2');
  e1.beamline.nodes.push({ id: 1, type: 'source', tiles: [] });
  e1.beamline.nodes.push({ id: 2, type: 'drift', tiles: [] });
  e2.beamline.nodes.push({ id: 3, type: 'quadrupole', tiles: [] });

  const allNodes = reg.getAllNodes();
  assertEq(allNodes.length, 3, 'getAllNodes returns 3 total nodes');
}

// Test 8: getBeamlineForNode
console.log('\n-- getBeamlineForNode --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac');
  reg.createBeamline('collider');

  const e1 = reg.get('bl-1');
  const e2 = reg.get('bl-2');
  e1.beamline.nodes.push({ id: 10, type: 'source', tiles: [] });
  e2.beamline.nodes.push({ id: 20, type: 'drift', tiles: [] });

  const found1 = reg.getBeamlineForNode(10);
  assertEq(found1.id, 'bl-1', 'node 10 belongs to bl-1');
  const found2 = reg.getBeamlineForNode(20);
  assertEq(found2.id, 'bl-2', 'node 20 belongs to bl-2');
  const notFound = reg.getBeamlineForNode(999);
  assertEq(notFound, undefined, 'unknown nodeId returns undefined');
}

// Test 9: freeTiles
console.log('\n-- freeTiles --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac');

  const node = { id: 'n1', tiles: [{ col: 5, row: 6 }, { col: 5, row: 7 }] };
  reg.occupyTiles('bl-1', node);
  assert(reg.isTileOccupied(5, 6), 'tile occupied before free');
  reg.freeTiles(node);
  assert(!reg.isTileOccupied(5, 6), 'tile freed after freeTiles');
  assert(!reg.isTileOccupied(5, 7), 'second tile freed after freeTiles');
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
