// test/test-utility-solve-coolingWater.js — tests for coolingWater.solve() v1.
//
// Physics: totalCapacity = sum(source.params.capacity); totalDemand = sum(
// sink.params.heatLoad). Quality uniform = min(1, cap/demand). Persistent
// reservoir decrements by EVAP_PER_KW_PER_TICK * totalHeatKW. Hard cooling_dry
// error when reservoirVolumeL ≤ 0 with sinks present → quality 0.
// refillCost: WATER_COST_PER_L per missing litre, capped at RESERVOIR_MAX_L,
// returns null when ≥ full. Rates are Phase 7 balance knobs — assertions
// below derive from the exported constants instead of pinning numbers.

import desc, { EVAP_PER_KW_PER_TICK, RESERVOIR_MAX_L, WATER_COST_PER_L } from '../src/utility/types/coolingWater.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'coolingWater',
    lineIds: [],
    ports: [],
    sources: [],
    sinks: [],
    ...overrides,
  };
}

// ==========================================================================
// Test 1: empty network, reservoir full.
// ==========================================================================
console.log('\n--- Test 1: no sources, no sinks ---');
{
  const r = desc.solve(mkNetwork({}), { reservoirVolumeL: 500 }, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(r.nextPersistentState.reservoirVolumeL === 500, `reservoir unchanged (got ${r.nextPersistentState.reservoirVolumeL})`);
}

// ==========================================================================
// Test 2: capacity 100 kW, load 50 kW, reservoir 500 → util 0.5, evap 50*rate.
// ==========================================================================
console.log('\n--- Test 2: cap 100, load 50, reservoir 500 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cw', params: { capacity: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 50 } }],
  });
  const r = desc.solve(net, { reservoirVolumeL: 500 }, {});
  assert(approx(r.flowState.utilization, 0.5), `utilization 0.5 (got ${r.flowState.utilization})`);
  assert(r.flowState.perSinkQuality.k1 === 1, `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  const expected = 500 - 50 * EVAP_PER_KW_PER_TICK;
  assert(approx(r.nextPersistentState.reservoirVolumeL, expected), `reservoir ${expected} (got ${r.nextPersistentState.reservoirVolumeL})`);
}

// ==========================================================================
// Test 3: multiple ticks, reservoir monotonically decreases, never negative.
// ==========================================================================
console.log('\n--- Test 3: multiple ticks monotonic ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cw', params: { capacity: 1000 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 1000 } }],
  });
  let p = { reservoirVolumeL: 2 };
  const values = [p.reservoirVolumeL];
  for (let i = 0; i < 5; i++) {
    const r = desc.solve(net, p, {});
    p = r.nextPersistentState;
    values.push(p.reservoirVolumeL);
  }
  let mono = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) mono = false;
  }
  assert(mono, `monotonic decrease (values: ${values.map(v => v.toFixed(3)).join(',')})`);
  assert(values[values.length - 1] >= 0, `never negative (last=${values[values.length - 1]})`);
}

// ==========================================================================
// Test 4: reservoir at 0 with sinks → cooling_dry hard error, quality 0.
// ==========================================================================
console.log('\n--- Test 4: reservoir 0 with sinks ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cw', params: { capacity: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 50 } }],
  });
  const r = desc.solve(net, { reservoirVolumeL: 0 }, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'hard', `severity hard (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'cooling_dry', `code cooling_dry (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 5: refillCost null at full, full price at empty.
// ==========================================================================
console.log('\n--- Test 5: refillCost basics ---');
{
  assert(desc.refillCost({ reservoirVolumeL: RESERVOIR_MAX_L }) === null, 'full → null');
  const empty = desc.refillCost({ reservoirVolumeL: 0 });
  const full$ = Math.ceil(RESERVOIR_MAX_L * WATER_COST_PER_L);
  assert(empty && empty.funding === full$, `empty → $${full$} (got ${JSON.stringify(empty)})`);
}

// ==========================================================================
// Test 6: refillCost at reservoir 100 → price of the missing litres.
// ==========================================================================
console.log('\n--- Test 6: refillCost at 100L remaining ---');
{
  const r = desc.refillCost({ reservoirVolumeL: 100 });
  const want = Math.ceil((RESERVOIR_MAX_L - 100) * WATER_COST_PER_L);
  assert(r && r.funding === want, `100L → $${want} (got ${JSON.stringify(r)})`);
}

// ==========================================================================
// Test 7: purity — nextPersistentState is a new object (not same reference).
// ==========================================================================
console.log('\n--- Test 7: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'cw', params: { capacity: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 50 } }],
  });
  const netSnap = JSON.stringify(net);
  const persistent = { reservoirVolumeL: 300, extra: 'x' };
  const pSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === netSnap, 'network not mutated');
  assert(JSON.stringify(persistent) === pSnap, 'persistent not mutated');
  assert(r.nextPersistentState !== persistent, 'nextPersistentState is a new object');
  assert(r.nextPersistentState.extra === 'x', 'extra keys preserved');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
