// test/test-utility-solve-dataFiber.js — tests for dataFiber.solve() v1.
//
// Physics: binary — any source in the network → every sink is connected
// (quality 1); otherwise sinks are disconnected (quality 0 + soft
// data_disconnected error).

import desc from '../src/utility/types/dataFiber.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'dataFiber',
    lineIds: [],
    ports: [],
    sources: [],
    sinks: [],
    ...overrides,
  };
}

// ==========================================================================
// Test 1: empty.
// ==========================================================================
console.log('\n--- Test 1: empty network ---');
{
  const r = desc.solve(mkNetwork({}), {}, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(Object.keys(r.flowState.perSinkQuality).length === 0, 'perSinkQuality empty');
}

// ==========================================================================
// Test 2: source + sink → quality 1.
// ==========================================================================
console.log('\n--- Test 2: source + sink ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'out' }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'in' }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 3: no source, one sink → data_disconnected.
// ==========================================================================
console.log('\n--- Test 3: no source, one sink ---');
{
  const net = mkNetwork({
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'in' }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'soft', `severity soft (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'data_disconnected', `code data_disconnected (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 4: source + pass-through + sink (all in one network) → quality 1.
//
// Pass-through ports aren't sources or sinks by role; from solve()'s POV the
// network just has a source and a sink. That's the discovery layer's job.
// ==========================================================================
console.log('\n--- Test 4: source + pass-through + sink ---');
{
  const net = mkNetwork({
    ports: [
      { placeableId: 'p1', portName: 'out', role: 'source' },
      { placeableId: 'p3', portName: 'in',  role: 'passthrough' },
      { placeableId: 'p3', portName: 'out', role: 'passthrough' },
      { placeableId: 'p2', portName: 'in',  role: 'sink' },
    ],
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'out' }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'in' }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 5: purity.
// ==========================================================================
console.log('\n--- Test 5: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'out' }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'in' }],
  });
  const snap = JSON.stringify(net);
  const persistent = { foo: 1 };
  const pSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === snap, 'network not mutated');
  assert(JSON.stringify(persistent) === pSnap, 'persistent not mutated');
  assert(r.nextPersistentState === persistent, 'nextPersistentState identity');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
