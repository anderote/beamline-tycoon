// test/test-utility-solve-cryoTransfer.js — tests for cryoTransfer.solve() v1.
//
// Analogous to coolingWater but in watts: source coldCapacityW vs sink
// srfHeatW. Persistent lheVolumeL decrements by
// BOILOFF_PER_W_PER_TICK × totalHeatW. Hard cryo_quench when
// lheVolumeL < QUENCH_THRESHOLD_L = 20; quality collapses to 0.
// refillCost: $50/L up to 500L.

import desc from '../src/utility/types/cryoTransfer.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'cryoTransfer',
    lineIds: [],
    ports: [],
    sources: [],
    sinks: [],
    ...overrides,
  };
}

// ==========================================================================
// Test 1: no sinks, full reservoir → no errors, no boiloff.
// ==========================================================================
console.log('\n--- Test 1: no sinks, full reservoir ---');
{
  const r = desc.solve(mkNetwork({}), { lheVolumeL: 500 }, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(r.nextPersistentState.lheVolumeL === 500, `lhe unchanged (got ${r.nextPersistentState.lheVolumeL})`);
}

// ==========================================================================
// Test 2: sink 18W, source 100W, reservoir 500 → quality 1, drop 0.009L.
// ==========================================================================
console.log('\n--- Test 2: sink 18W, source 100W ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cryo', params: { coldCapacityW: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cryo', params: { srfHeatW: 18 } }],
  });
  const r = desc.solve(net, { lheVolumeL: 500 }, {});
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(approx(r.nextPersistentState.lheVolumeL, 500 - 0.009),
    `lhe 499.991 (got ${r.nextPersistentState.lheVolumeL})`);
}

// ==========================================================================
// Test 3: reservoir at 19 with sinks → cryo_quench hard error, quality 0.
// ==========================================================================
console.log('\n--- Test 3: reservoir 19 with sinks → quench ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cryo', params: { coldCapacityW: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cryo', params: { srfHeatW: 18 } }],
  });
  const r = desc.solve(net, { lheVolumeL: 19 }, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'hard', `severity hard (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'cryo_quench', `code cryo_quench (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 4: refillCost at $50/L, null when full, 500*50=25000 when empty.
// ==========================================================================
console.log('\n--- Test 4: refillCost basics ---');
{
  assert(desc.refillCost({ lheVolumeL: 500 }) === null, 'full → null');
  const empty = desc.refillCost({ lheVolumeL: 0 });
  assert(empty && empty.funding === 25000, `empty → $25000 (got ${JSON.stringify(empty)})`);
  const partial = desc.refillCost({ lheVolumeL: 400 });
  assert(partial && partial.funding === 5000, `400L → $5000 (got ${JSON.stringify(partial)})`);
}

// ==========================================================================
// Test 5: multiple ticks monotonic, never negative.
// ==========================================================================
console.log('\n--- Test 5: multiple ticks monotonic ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cryo', params: { coldCapacityW: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cryo', params: { srfHeatW: 18 } }],
  });
  let p = { lheVolumeL: 21 };
  const values = [p.lheVolumeL];
  for (let i = 0; i < 5; i++) {
    const r = desc.solve(net, p, {});
    p = r.nextPersistentState;
    values.push(p.lheVolumeL);
  }
  let mono = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) mono = false;
  }
  assert(mono, `monotonic (values: ${values.map(v => v.toFixed(5)).join(',')})`);
  assert(values[values.length - 1] >= 0, `never negative`);
}

// ==========================================================================
// Test 6: purity.
// ==========================================================================
console.log('\n--- Test 6: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cryo', params: { coldCapacityW: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cryo', params: { srfHeatW: 18 } }],
  });
  const netSnap = JSON.stringify(net);
  const persistent = { lheVolumeL: 300 };
  const pSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === netSnap, 'network not mutated');
  assert(JSON.stringify(persistent) === pSnap, 'persistent not mutated');
  assert(r.nextPersistentState !== persistent, 'nextPersistentState is a new object');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
