// test/test-utility-supply-display.js
//
// Tests the pure helper in src/ui/utility-supply.js — the shared derivation
// of "draw" and "supply" stat rows used by hud.js, overlays.js, and
// EquipmentWindow.js. Exercised against real COMPONENTS entries (the same
// shape — { energyCost, ports } — every call site passes in) rather than the
// UI files themselves, which touch the DOM and aren't Node-testable.
//
// Covers:
//   1. Every source component in the named ladders (powerCable x6,
//      rfWaveguide x9, coolingWater x3, cryoTransfer x2, vacuumPipe x8) yields a correct
//      supply row.
//   2. A component with no source port yields no supply row.
//   3. A component that both draws and supplies yields both rows.
//   4. A zero-draw component (pure distribution gear) yields no draw row.
//   5. A non-zero draw always yields exactly one draw row.
//   6. A source port whose capacity is 0 (bakeoutSystem's marker port)
//      yields no supply row.

import { COMPONENTS } from '../src/data/components.js';
import { paletteUtilityMetrics, paletteUtilityTags, utilityStatRows } from '../src/ui/utility-supply.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function supplyRows(id) {
  return utilityStatRows(COMPONENTS[id]).filter(r => r.label === 'Supplies');
}
function drawRows(id) {
  return utilityStatRows(COMPONENTS[id]).filter(r => r.label === 'Energy Cost');
}

// ==========================================================================
// Test 1: all named source components report the right supply value + unit.
// ==========================================================================
console.log('\n--- Test 1: source components report correct supply ---');
{
  const POWER = {
    hvTransformer: 1200, switchgear: 400, mcc: 250,
    padMountTransformer: 150, ups: 100, powerPanel: 40,
  };
  for (const [id, cap] of Object.entries(POWER)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    assert(rows[0]?.value === `${cap} kW`, `${id}: supplies ${cap} kW (got "${rows[0]?.value}")`);
  }

  const COOLING = { lcwSkid: 100, chiller: 300, coolingTower: 800 };
  for (const [id, cap] of Object.entries(COOLING)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    assert(rows[0]?.value === `${cap} kW thermal`, `${id}: supplies ${cap} kW thermal (got "${rows[0]?.value}")`);
  }

  const CRYO = { coldBox4K: 500, coldBox2K: 800 };
  for (const [id, cap] of Object.entries(CRYO)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    assert(rows[0]?.value === `${cap} W`, `${id}: supplies ${cap} W (got "${rows[0]?.value}")`);
  }

  const VACUUM = {
    roughingPump: 15, roughingPumpCart: 60, turboPump: 300, vacuumCart: 330,
    tiSubPump: 400, negPump: 500, ionPump: 600,
    highCapacityVacuumStation: 3000,
  };
  for (const [id, speed] of Object.entries(VACUUM)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    assert(rows[0]?.value === `${speed} L/s`, `${id}: supplies ${speed} L/s (got "${rows[0]?.value}")`);
  }

  const RF = {
    magnetron: [5, 0.01], twt: [20, 0.05], solidStateAmp: [35, 1.0],
    pulsedKlystron: [50, 0.001], cwKlystron: [50, 1.0], iot: [80, 1.0],
    multibeamKlystron: [200, 0.005], highPowerSSA: [300, 1.0], gyrotron: [1000, 1.0],
  };
  const dutyPct = f => {
    const pct = Math.round(f * 1000) / 10;
    return Number.isInteger(pct) ? pct.toFixed(0) : String(pct);
  };
  for (const [id, [cap, duty]] of Object.entries(RF)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    const expected = `${cap} kW peak (${dutyPct(duty)}% duty)`;
    assert(rows[0]?.value === expected, `${id}: supplies "${expected}" (got "${rows[0]?.value}")`);
  }

  const totalSourceIds = [
    ...Object.keys(POWER), ...Object.keys(COOLING), ...Object.keys(CRYO),
    ...Object.keys(VACUUM), ...Object.keys(RF),
  ];
  assert(totalSourceIds.length === 28, `28 source components covered (got ${totalSourceIds.length})`);
}

// ==========================================================================
// Test 2: a component with no source port yields no supply row.
// ==========================================================================
console.log('\n--- Test 2: no source port -> no supply row ---');
{
  assert(supplyRows('dipole').length === 0, 'dipole (sink-only magnet) has no supply row');
  assert(supplyRows('detector').length === 0, 'detector (sink-only) has no supply row');
}

// ==========================================================================
// Test 3: a component that both draws and supplies yields both rows.
// ==========================================================================
console.log('\n--- Test 3: draw + supply coexist ---');
{
  const BOTH = { ups: [2, 100, 'kW'], chiller: [5, 300, 'kW thermal'], coolingTower: [4, 800, 'kW thermal'], mcc: [1, 250, 'kW'] };
  for (const [id, [draw, supply, unit]] of Object.entries(BOTH)) {
    const d = drawRows(id);
    const s = supplyRows(id);
    assert(d.length === 1 && d[0].value === `${draw} kW`, `${id}: draws ${draw} kW (got ${JSON.stringify(d)})`);
    assert(s.length === 1 && s[0].value === `${supply} ${unit}`, `${id}: supplies ${supply} ${unit} (got ${JSON.stringify(s)})`);
  }
}

// ==========================================================================
// Test 4: pure distribution gear (zero draw) yields no draw row.
// ==========================================================================
console.log('\n--- Test 4: zero draw -> no draw row ---');
{
  for (const id of ['hvTransformer', 'switchgear', 'padMountTransformer', 'powerPanel']) {
    assert(COMPONENTS[id].energyCost === 0, `${id}: fixture assumption — energyCost is 0`);
    assert(drawRows(id).length === 0, `${id}: no draw row when energyCost is 0`);
  }
}

// ==========================================================================
// Test 5: a non-zero draw always yields exactly one draw row.
// ==========================================================================
console.log('\n--- Test 5: non-zero draw -> exactly one draw row ---');
{
  for (const id of ['dipole', 'ups', 'chiller', 'hvTransformer']) {
    const expectRow = COMPONENTS[id].energyCost > 0;
    const rows = drawRows(id);
    assert(rows.length === (expectRow ? 1 : 0),
      `${id}: energyCost=${COMPONENTS[id].energyCost} -> ${expectRow ? 1 : 0} draw row(s) (got ${rows.length})`);
  }
}

// ==========================================================================
// Test 6: a zero-capacity source port yields no supply row.
// ==========================================================================
console.log('\n--- Test 6: zero-capacity source port -> no supply row ---');
{
  assert(COMPONENTS.bakeoutSystem.ports.vac_out.params.pumpSpeed === 0,
    'bakeoutSystem fixture assumption — pumpSpeed is 0');
  assert(supplyRows('bakeoutSystem').length === 0, 'bakeoutSystem (pumpSpeed:0 marker port) has no supply row');
}

// ======================================================================
// Test 7: placement-card metrics describe real port requirements/supply.
// ======================================================================
console.log('\n--- Test 7: palette metrics expose placement requirements ---');
{
  const sourceMetrics = paletteUtilityMetrics(COMPONENTS.source);
  assert(sourceMetrics.some(r => r.label === 'Power draw' && r.value === '50 kW'),
    'source: palette shows its 50 kW power draw');
  assert(sourceMetrics.some(r => r.label === 'Cooling draw' && r.value === '30 kW thermal'),
    'source: palette shows its 30 kW thermal cooling draw');

  const chillerMetrics = paletteUtilityMetrics(COMPONENTS.chiller);
  assert(chillerMetrics.some(r => r.label === 'Power draw' && r.value === '5 kW'),
    'chiller: palette shows its electrical draw');
  assert(chillerMetrics.some(r => r.label === 'Cooling capacity' && r.value === '300 kW thermal'),
    'chiller: palette shows its cooling capacity');

  const cryoMetrics = paletteUtilityMetrics(COMPONENTS.ellipticalSrfCavity);
  assert(cryoMetrics.some(r => r.label === 'Cryo draw'),
    'SRF cavity: palette shows its cryogenic draw');

  const fanCoilTags = paletteUtilityTags(COMPONENTS.fanCoilCooler);
  assert(fanCoilTags.some(tag => tag.text === 'P: -1 kW' && tag.direction === 'draw'),
    'fan coil: compact palette tag shows its power draw');
  assert(fanCoilTags.some(tag => tag.text === 'C: +20 kW' && tag.direction === 'supply'),
    'fan coil: compact palette tag shows its cooling output');
}

// ==========================================================================
console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s) failed`);
  process.exit(1);
}
