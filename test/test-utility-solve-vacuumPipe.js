// test/test-utility-solve-vacuumPipe.js — tests for vacuumPipe.solve() v1.
//
// Physics: pressure = totalOutgas / totalPumpSpeed, mapped to quality on a log
// scale between 1e-8 (q=1) and 1e-4 (q=0). Hard vacuum_no_pump if sinks exist
// without a pump; soft vacuum_poor when pressure > 1e-5.

import desc from '../src/utility/types/vacuumPipe.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'vacuumPipe',
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
  const r = desc.solve(mkNetwork({}), {}, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(Object.keys(r.flowState.perSinkQuality).length === 0, 'perSinkQuality empty');
}

// ==========================================================================
// Test 2: pump 100 L/s, outgas 1e-8 → pressure 1e-10 ≤ 1e-8 → quality 1.
// ==========================================================================
console.log('\n--- Test 2: pump 100, outgas 1e-8 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-8 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 1), `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 3: pump 100, outgas 1e-6 → pressure 1e-8 = threshold → quality 1, no error.
// ==========================================================================
console.log('\n--- Test 3: pump 100, outgas 1e-6 → p=1e-8 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-6 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 1), `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 4: no pump, one sink → hard vacuum_no_pump.
// ==========================================================================
console.log('\n--- Test 4: no pump, one sink ---');
{
  const net = mkNetwork({
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'vac', params: { outgassing: 1e-6 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'hard', `severity hard (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'vacuum_no_pump', `code vacuum_no_pump (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 5: pump 1 L/s, outgas 1e-3 → pressure 1e-3 ≥ 1e-4 → quality 0 + soft vacuum_poor.
// ==========================================================================
console.log('\n--- Test 5: pump 1, outgas 1e-3 → p=1e-3 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 1 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-3 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'soft', `severity soft (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'vacuum_poor', `code vacuum_poor (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 6: purity + persistent pass-through.
// ==========================================================================
console.log('\n--- Test 6: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-7 } }],
  });
  const netSnap = JSON.stringify(net);
  const persistent = { foo: 1 };
  const persistSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === netSnap, 'network not mutated');
  assert(JSON.stringify(persistent) === persistSnap, 'persistent not mutated');
  assert(r.nextPersistentState === persistent, 'nextPersistentState identity');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
