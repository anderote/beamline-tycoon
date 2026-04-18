// test/test-utility-solve-powerCable.js — tests for powerCable.solve() v1.
//
// Physics: totalCapacity = sum(source.capacity); totalDemand = sum(sink.demand).
// - demand ≤ capacity  → perSinkQuality 1, no errors.
// - demand > capacity  → perSinkQuality = capacity/demand (uniform), soft
//                        power_overload, utilization clamped to 1.
// - capacity == 0 && demand > 0 → perSinkQuality 0, soft power_starved,
//                                 utilization 1.
// - capacity == 0 && demand == 0 → no errors, utilization 0.
// solve() is pure: must not mutate network or persistent.

import desc from '../src/utility/types/powerCable.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'powerCable',
    lineIds: [],
    ports: [],
    sources: [],
    sinks: [],
    ...overrides,
  };
}

// ==========================================================================
// Test 1: empty network.
// ==========================================================================
console.log('\n--- Test 1: no sources, no sinks ---');
{
  const net = mkNetwork({});
  const r = desc.solve(net, {}, {});
  assert(r.flowState.totalCapacity === 0, `totalCapacity 0 (got ${r.flowState.totalCapacity})`);
  assert(r.flowState.totalDemand === 0, `totalDemand 0 (got ${r.flowState.totalDemand})`);
  assert(r.flowState.utilization === 0, `utilization 0 (got ${r.flowState.utilization})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(Object.keys(r.flowState.perSinkQuality).length === 0, 'perSinkQuality empty');
}

// ==========================================================================
// Test 2: source 100, sink 40 → quality 1.
// ==========================================================================
console.log('\n--- Test 2: source 100, sink 40 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'out', capacity: 100 }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'in',  demand: 40 }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.totalCapacity === 100, 'totalCapacity 100');
  assert(r.flowState.totalDemand === 40, 'totalDemand 40');
  assert(approx(r.flowState.utilization, 0.4), `utilization 0.4 (got ${r.flowState.utilization})`);
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 3: source 100, sinks 60+80 = 140 → overload.
// ==========================================================================
console.log('\n--- Test 3: overload ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'out', capacity: 100 }],
    sinks: [
      { portKey: 'k1', placeableId: 'p2', portName: 'in', demand: 60 },
      { portKey: 'k2', placeableId: 'p3', portName: 'in', demand: 80 },
    ],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.totalCapacity === 100, 'totalCapacity 100');
  assert(r.flowState.totalDemand === 140, 'totalDemand 140');
  assert(r.flowState.utilization === 1, `utilization clamped 1 (got ${r.flowState.utilization})`);
  assert(approx(r.flowState.perSinkQuality.k1, 100/140), `k1 quality ~100/140`);
  assert(approx(r.flowState.perSinkQuality.k2, 100/140), `k2 quality ~100/140`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'soft', 'error soft');
  assert(r.errors[0].code === 'power_overload', `code power_overload (got ${r.errors[0].code})`);
  assert(r.flowState.errors.length === 1, 'flowState.errors has the error');
}

// ==========================================================================
// Test 4: no source, one sink → starved.
// ==========================================================================
console.log('\n--- Test 4: no source, sink demand 10 ---');
{
  const net = mkNetwork({
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'in', demand: 10 }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.utilization === 1, `utilization 1 (got ${r.flowState.utilization})`);
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'soft', 'error soft');
  assert(r.errors[0].code === 'power_starved', `code power_starved (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 5: nextPersistentState returned as-is.
// ==========================================================================
console.log('\n--- Test 5: persistent pass-through ---');
{
  const net = mkNetwork({});
  const persistent = { foo: 1 };
  const r = desc.solve(net, persistent, {});
  assert(r.nextPersistentState === persistent, 'nextPersistentState identity');
}

// ==========================================================================
// Test 6: purity — no mutation of network or persistent.
// ==========================================================================
console.log('\n--- Test 6: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'out', capacity: 100 }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'in',  demand: 40 }],
  });
  const snapshot = JSON.stringify(net);
  const persistent = { a: 1, b: { c: 2 } };
  const persistSnap = JSON.stringify(persistent);
  desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === snapshot, 'network not mutated');
  assert(JSON.stringify(persistent) === persistSnap, 'persistent not mutated');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
