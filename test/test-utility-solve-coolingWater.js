// test/test-utility-solve-coolingWater.js — tests for coolingWater.solve() v1.
//
// Process capacity, heat rejection, water supply rate, and water storage are
// independent. Persistent inventory is bounded by connected tank capacity;
// evaporation drains it and authored make-up flow replenishes it.

import desc, {
  EVAP_PER_KW_PER_TICK, WATER_COST_PER_L, boundCoolingWaterPersistentState,
} from '../src/utility/types/coolingWater.js';

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

function integratedSource(overrides = {}) {
  return {
    portKey: 's1', placeableId: 'p1', portName: 'cw',
    params: {
      capacity: 100,
      heatRejectionCapacity: 100,
      storageCapacityL: 500,
      supplyRateLPerTick: 0,
      ...overrides,
    },
  };
}

// ==========================================================================
// Test 1: empty network, reservoir full.
// ==========================================================================
console.log('\n--- Test 1: no sources, no sinks ---');
{
  const r = desc.solve(mkNetwork({}), { reservoirVolumeL: 500 }, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(r.nextPersistentState.reservoirVolumeL === 0, `no tank means no inventory (got ${r.nextPersistentState.reservoirVolumeL})`);
}

// ==========================================================================
// Test 2: capacity 100 kW, load 50 kW, reservoir 500 → util 0.5, evap 50*rate.
// ==========================================================================
console.log('\n--- Test 2: cap 100, load 50, reservoir 500 ---');
{
  const net = mkNetwork({
    sources: [integratedSource()],
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
    sources: [integratedSource({ capacity: 1000, heatRejectionCapacity: 1000 })],
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
    sources: [integratedSource()],
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
  assert(desc.refillCost({ reservoirVolumeL: 500, reservoirCapacityL: 500 }) === null, 'full → null');
  const empty = desc.refillCost({ reservoirVolumeL: 0, reservoirCapacityL: 500 });
  const full$ = Math.ceil(500 * WATER_COST_PER_L);
  assert(empty && empty.funding === full$, `empty → $${full$} (got ${JSON.stringify(empty)})`);
}

// ==========================================================================
// Test 6: refillCost at reservoir 100 → price of the missing litres.
// ==========================================================================
console.log('\n--- Test 6: refillCost at 100L remaining ---');
{
  const r = desc.refillCost({ reservoirVolumeL: 100, reservoirCapacityL: 500 });
  const want = Math.ceil((500 - 100) * WATER_COST_PER_L);
  assert(r && r.funding === want, `100L → $${want} (got ${JSON.stringify(r)})`);
}

// ==========================================================================
// Test 7: purity — nextPersistentState is a new object (not same reference).
// ==========================================================================
console.log('\n--- Test 7: purity ---');
{
  const net = mkNetwork({
    sources: [integratedSource()],
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
// Test 8: make-up flow offsets evaporation up to its authored rate.
// ==========================================================================
console.log('\n--- Test 8: make-up flow replenishes storage ---');
{
  const net = mkNetwork({
    sources: [integratedSource({ supplyRateLPerTick: 1 })],
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 50 } }],
  });
  const r = desc.solve(net, { reservoirVolumeL: 250 }, {});
  assert(approx(r.flowState.evaporationL, 1), `50 kW evaporates 1 L (got ${r.flowState.evaporationL})`);
  assert(approx(r.flowState.suppliedWaterL, 1), `source supplies 1 L (got ${r.flowState.suppliedWaterL})`);
  assert(approx(r.nextPersistentState.reservoirVolumeL, 250),
    `matched supply holds inventory at 250 L (got ${r.nextPersistentState.reservoirVolumeL})`);
}

// ==========================================================================
// Test 9: a high-flow source has no implied storage capacity.
// ==========================================================================
console.log('\n--- Test 9: source without storage cannot complete plant ---');
{
  const net = mkNetwork({
    sources: [integratedSource({ storageCapacityL: 0, supplyRateLPerTick: 20 })],
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 50 } }],
  });
  const r = desc.solve(net, { reservoirVolumeL: 500 }, {});
  assert(r.flowState.storageCapacityL === 0, 'water source contributes zero storage');
  assert(r.flowState.totalCapacity === 0, 'plant stays offline without a tank');
  assert(r.errors.some(error => error.code === 'cooling_plant_offline'),
    'missing storage is reported at the plant contract');
}

// ==========================================================================
// Test 10: passive storage contributes no water generation.
// ==========================================================================
console.log('\n--- Test 10: passive tank drains without a source ---');
{
  const net = mkNetwork({
    sources: [integratedSource({ storageCapacityL: 5000, supplyRateLPerTick: 0 })],
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 100 } }],
  });
  const r = desc.solve(net, { reservoirVolumeL: 1000 }, {});
  assert(r.flowState.supplyRateLPerTick === 0, 'tank contributes zero supply rate');
  assert(approx(r.nextPersistentState.reservoirVolumeL, 998),
    `tank loses evaporation instead of generating water (got ${r.nextPersistentState.reservoirVolumeL})`);
}

// ==========================================================================
// Test 11: a large source and passive tank compose into a sustainable loop.
// ==========================================================================
console.log('\n--- Test 11: large source fills passive storage ---');
{
  const net = mkNetwork({
    sources: [
      integratedSource({ storageCapacityL: 0, supplyRateLPerTick: 0 }),
      { portKey: 'main:out', placeableId: 'main', portName: 'out',
        params: { capacity: 0, supplyRateLPerTick: 20, storageCapacityL: 0 } },
      { portKey: 'tank:out', placeableId: 'tank', portName: 'out',
        params: { capacity: 0, supplyRateLPerTick: 0, storageCapacityL: 5000 } },
    ],
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'cw', params: { heatLoad: 1000 } }],
  });
  const r = desc.solve(net, { reservoirVolumeL: 1000 }, {});
  assert(r.flowState.storageCapacityL === 5000, 'storage comes only from the tank');
  assert(r.flowState.supplyRateLPerTick === 20, 'flow comes only from the main');
  assert(approx(r.nextPersistentState.reservoirVolumeL, 1000),
    '20 L/tick supply replaces the 1 MW evaporation loss');
}

// ==========================================================================
// Test 12: new and migrated state are bounded by authored storage.
// ==========================================================================
console.log('\n--- Test 12: dynamic inventory bounds ---');
{
  const network = mkNetwork({ sources: [integratedSource({ storageCapacityL: 750 })] });
  const fresh = boundCoolingWaterPersistentState(desc.persistentStateDefaults, network);
  const overfull = boundCoolingWaterPersistentState({ reservoirVolumeL: 900 }, network);
  assert(fresh.reservoirVolumeL === 750 && fresh.reservoirCapacityL === 750,
    'a new network commissions at its authored capacity');
  assert(overfull.reservoirVolumeL === 750,
    'migrated contents clamp to the connected tanks instead of a global constant');
  const refilled = desc.refilledPersistentState({ reservoirVolumeL: 12, reservoirCapacityL: 750 });
  assert(refilled.reservoirVolumeL === 750, 'manual refill targets dynamic storage capacity');
}

// ==========================================================================
// Test 13: make-up flow fills available storage but never overfills it.
// ==========================================================================
console.log('\n--- Test 13: source fills only to tank capacity ---');
{
  const net = mkNetwork({
    sources: [integratedSource({ supplyRateLPerTick: 1 })],
    sinks: [],
  });
  const almostFull = desc.solve(net, { reservoirVolumeL: 499.5 }, {});
  assert(almostFull.flowState.suppliedWaterL === 0.5,
    `only the missing half-litre is accepted (got ${almostFull.flowState.suppliedWaterL})`);
  assert(almostFull.nextPersistentState.reservoirVolumeL === 500,
    'make-up flow fills the tank exactly to its authored capacity');
  const full = desc.solve(net, almostFull.nextPersistentState, {});
  assert(full.flowState.suppliedWaterL === 0
      && full.nextPersistentState.reservoirVolumeL === 500,
    'a full tank rejects additional supply instead of overfilling');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
