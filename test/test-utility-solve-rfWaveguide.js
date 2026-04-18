// test/test-utility-solve-rfWaveguide.js — tests for rfWaveguide.solve() v1.
//
// Physics: group sources and sinks by params.frequency. Each group independent.
// Sinks in groups with no source get quality 0 + soft rf_frequency_mismatch.
// Overloaded groups (demand > capacity) emit soft rf_overload.

import desc from '../src/utility/types/rfWaveguide.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'rfWaveguide',
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
console.log('\n--- Test 1: empty ---');
{
  const r = desc.solve(mkNetwork({}), {}, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(Object.keys(r.flowState.perSinkQuality).length === 0, 'perSinkQuality empty');
}

// ==========================================================================
// Test 2: matching frequencies, sink demand < capacity.
// ==========================================================================
console.log('\n--- Test 2: match 1.3 GHz, capacity 100 vs demand 40 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'rf', capacity: 100, params: { frequency: 1.3e9 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'rf', demand: 40,    params: { frequency: 1.3e9 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(r.flowState.totalCapacity === 100, 'totalCapacity 100');
  assert(r.flowState.totalDemand === 40, 'totalDemand 40');
}

// ==========================================================================
// Test 3: frequency mismatch.
// ==========================================================================
console.log('\n--- Test 3: source 1.3 GHz, sink 2.856 GHz ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'rf', capacity: 100, params: { frequency: 1.3e9 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'rf', demand: 40,    params: { frequency: 2.856e9 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].code === 'rf_frequency_mismatch', `code rf_frequency_mismatch (got ${r.errors[0].code})`);
  assert(r.errors[0].severity === 'soft', 'severity soft');
}

// ==========================================================================
// Test 4: one-freq overload.
// ==========================================================================
console.log('\n--- Test 4: 1.3 GHz source 50, sinks 30+40 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'rf', capacity: 50, params: { frequency: 1.3e9 } }],
    sinks: [
      { portKey: 'k1', placeableId: 'p2', portName: 'rf', demand: 30, params: { frequency: 1.3e9 } },
      { portKey: 'k2', placeableId: 'p3', portName: 'rf', demand: 40, params: { frequency: 1.3e9 } },
    ],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 50/70), `k1 quality ~50/70 (got ${r.flowState.perSinkQuality.k1})`);
  assert(approx(r.flowState.perSinkQuality.k2, 50/70), `k2 quality ~50/70 (got ${r.flowState.perSinkQuality.k2})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].code === 'rf_overload', `code rf_overload (got ${r.errors[0].code})`);
  assert(r.errors[0].severity === 'soft', 'severity soft');
}

// ==========================================================================
// Test 5: two independent frequency groups, each OK.
// ==========================================================================
console.log('\n--- Test 5: two freq groups, both OK ---');
{
  const net = mkNetwork({
    sources: [
      { portKey: 's1', placeableId: 'p1', portName: 'rf', capacity: 100, params: { frequency: 1.3e9 } },
      { portKey: 's2', placeableId: 'p3', portName: 'rf', capacity: 100, params: { frequency: 2.856e9 } },
    ],
    sinks: [
      { portKey: 'k1', placeableId: 'p2', portName: 'rf', demand: 40, params: { frequency: 1.3e9 } },
      { portKey: 'k2', placeableId: 'p4', portName: 'rf', demand: 50, params: { frequency: 2.856e9 } },
    ],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.flowState.perSinkQuality.k2 === 1, `k2 quality 1 (got ${r.flowState.perSinkQuality.k2})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(r.flowState.totalCapacity === 200, 'totalCapacity 200');
  assert(r.flowState.totalDemand === 90, 'totalDemand 90');
}

// ==========================================================================
// Test 6: purity.
// ==========================================================================
console.log('\n--- Test 6: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'rf', capacity: 100, params: { frequency: 1.3e9 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'rf', demand: 40,    params: { frequency: 1.3e9 } }],
  });
  const snap = JSON.stringify(net);
  const persistent = { x: 1 };
  const pSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === snap, 'network not mutated');
  assert(JSON.stringify(persistent) === pSnap, 'persistent not mutated');
  assert(r.nextPersistentState === persistent, 'nextPersistentState identity');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
