// test/test-registry.js — Node.js tests for BeamlineRegistry (slim metadata store)

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
  const entry = reg.createBeamline('synchrotron', 'src-1');
  assert(entry !== null, 'createBeamline returns an entry');
  assertEq(entry.id, 'bl-1', 'first beamline id is bl-1');
  assertEq(entry.name, 'Beamline-1', 'first beamline name is Beamline-1');
  assertEq(entry.status, 'stopped', 'initial status is stopped');
  assertEq(entry.sourceId, 'src-1', 'sourceId matches');
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
  const e1 = reg.createBeamline('linac', 'src-1');
  const e2 = reg.createBeamline('collider', 'src-2');
  const e3 = reg.createBeamline('synchrotron', 'src-3');
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
  reg.createBeamline('linac', 'src-1');
  reg.createBeamline('collider', 'src-2');
  const entry = reg.get('bl-2');
  assert(entry !== undefined, 'get returns entry for bl-2');
  assertEq(entry.beamState.machineType, 'collider', 'retrieved entry has correct machineType');
  const missing = reg.get('bl-99');
  assertEq(missing, undefined, 'get returns undefined for missing id');
}

// Test 4: Get by sourceId
console.log('\n-- Get by sourceId --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac', 'src-1');
  reg.createBeamline('collider', 'src-2');
  const entry = reg.getBySourceId('src-2');
  assert(entry !== undefined, 'getBySourceId returns entry for src-2');
  assertEq(entry.id, 'bl-2', 'found correct entry');
  const missing = reg.getBySourceId('src-99');
  assertEq(missing, null, 'getBySourceId returns null for unknown source');
}

// Test 5: Remove beamline
console.log('\n-- Remove beamline --');
{
  const reg = new BeamlineRegistry();
  reg.createBeamline('linac', 'src-1');
  reg.createBeamline('collider', 'src-2');

  reg.removeBeamline('bl-1');

  assertEq(reg.get('bl-1'), undefined, 'bl-1 removed from registry');
  const all = reg.getAll();
  assertEq(all.length, 1, 'one beamline remaining');
  assertEq(all[0].id, 'bl-2', 'remaining beamline is bl-2');
}

// Test 6: Serialization round-trip
console.log('\n-- Serialization round-trip --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac', 'src-1');
  const e2 = reg.createBeamline('collider', 'src-2');
  e1.status = 'running';
  e1.beamState.beamEnergy = 42;

  const json = reg.toJSON();
  const reg2 = new BeamlineRegistry();
  reg2.fromJSON(json);

  assertEq(reg2.getAll().length, 2, 'deserialized has 2 beamlines');
  const restored = reg2.get('bl-1');
  assert(restored !== undefined, 'bl-1 exists after deserialization');
  assertEq(restored.status, 'running', 'status preserved');
  assertEq(restored.sourceId, 'src-1', 'sourceId preserved');
  assertEq(restored.beamState.beamEnergy, 42, 'beamState preserved');
  assertEq(restored.beamState.machineType, 'linac', 'machineType preserved');
  assertEq(reg2.nextBeamlineId, 3, 'nextBeamlineId preserved');
}

// Test 7: makeDefaultBeamState
console.log('\n-- makeDefaultBeamState --');
{
  const bs = makeDefaultBeamState('fel');
  assertEq(bs.machineType, 'fel', 'machineType set');
  assertEq(bs.beamEnergy, 0, 'beamEnergy default');
  assertEq(bs.beamQuality, 1, 'beamQuality default');
  assertEq(bs.felSaturated, false, 'felSaturated default');
  assert(bs.componentHealth !== undefined, 'componentHealth initialized');
}

// Test 8: createBeamline with null sourceId
console.log('\n-- Null sourceId --');
{
  const reg = new BeamlineRegistry();
  const entry = reg.createBeamline('linac');
  assertEq(entry.sourceId, null, 'sourceId defaults to null');
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
