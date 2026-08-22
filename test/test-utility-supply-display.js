// test/test-utility-supply-display.js
//
// Tests the pure helper in src/ui/utility-supply.js — the shared derivation
// of "draw" and "supply" stat rows used by hud.js, overlays.js, and
// EquipmentWindow.js. Exercised against real COMPONENTS entries (the same
// shape — { energyCost, ports } — every call site passes in) rather than the
// UI files themselves, which touch the DOM and aren't Node-testable.
//
// Covers:
//   1. Every source component in the named ladders (powerCable,
//      rfWaveguide x9, coolingWater x3, cryoTransfer x2, vacuumPipe x9) yields a correct
//      supply row.
//   2. A component with no source port yields no supply row.
//   3. A component that both draws and supplies yields both rows.
//   4. A zero-draw component (pure distribution gear) yields no draw row.
//   5. A non-zero draw always yields exactly one draw row.
//   6. A source port whose capacity is 0 (bakeoutSystem's marker port)
//      yields no supply row.

import { readFileSync } from 'node:fs';
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
    gridServicePoint: 3000, hvTransformer: 1500,
    switchgear: 1200, compactHvDistributor: 600, mcc: 250,
    padMountTransformer: 150, ups: 100, powerPanel: 40,
  };
  for (const [id, cap] of Object.entries(POWER)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    assert(rows[0]?.value === `${cap} kW`, `${id}: supplies ${cap} kW (got "${rows[0]?.value}")`);
  }

  const COOLING = { lcwSkid: 25, chiller: 300, coolingTower: 800 };
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
    roughingPump: 15, roughingPumpCart: 60, turboPump: 300, turboPumpCart: 1200,
    vacuumCart: 330,
    tiSubPump: 400, negPump: 500, ionPump: 600,
    highCapacityVacuumStation: 3000,
  };
  for (const [id, speed] of Object.entries(VACUUM)) {
    const rows = supplyRows(id);
    assert(rows.length === 1, `${id}: exactly one supply row`);
    assert(rows[0]?.value === `${speed} L/s`, `${id}: supplies ${speed} L/s (got "${rows[0]?.value}")`);
  }

  const RF = {
    magnetron: [5, 0.01], widebandDriverAmp: [5, 1.0], lowBandBuncherAmp: [10, 1.0], twt: [20, 0.05], solidStateAmp: [35, 1.0],
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
  assert(totalSourceIds.length === 33, `33 source components covered (got ${totalSourceIds.length})`);
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
  const BOTH = { ups: [2, 100, 'kW'], chiller: [60, 300, 'kW thermal'], coolingTower: [20, 800, 'kW thermal'], mcc: [1, 250, 'kW'] };
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
  for (const id of ['hvTransformer', 'compactHvDistributor', 'switchgear', 'padMountTransformer', 'powerPanel']) {
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
  assert(chillerMetrics.some(r => r.label === 'Power draw' && r.value === '60 kW'),
    'chiller: palette shows its electrical draw');
  assert(chillerMetrics.some(r => r.label === 'Cooling capacity' && r.value === '300 kW thermal'),
    'chiller: palette shows its cooling capacity');

  const cryoMetrics = paletteUtilityMetrics(COMPONENTS.ellipticalSrfCavity);
  assert(cryoMetrics.some(r => r.label === 'Cryo draw'),
    'SRF cavity: palette shows its cryogenic draw');

  const fanCoilTags = paletteUtilityTags(COMPONENTS.fanCoilCooler);
  assert(!fanCoilTags.some(tag => tag.key === 'power' && tag.direction === 'draw'),
    'passive fan coil has no invented power draw');
  assert(fanCoilTags.some(tag => tag.text === 'C: +50 kW' && tag.direction === 'supply'),
    'fan coil: compact palette tag shows its cooling output');

  const towerMetrics = paletteUtilityMetrics(COMPONENTS.coolingTower);
  assert(towerMetrics.some(r => r.label === 'Water header capacity' && r.value === '800 kW thermal'),
    'equal hot and room-temperature ratings describe one 800 kW converter, not 1.6 MW');

  const compactHvMetrics = paletteUtilityMetrics(COMPONENTS.compactHvDistributor);
  assert(compactHvMetrics.some(r => r.label === 'Power draw' && r.value === '600 kW'),
    'compact HV distributor: palette shows its 600 kW incoming feeder rating');
  assert(compactHvMetrics.some(r => r.label === 'Power capacity' && r.value === '600 kW'),
    'compact HV distributor: palette shows two outputs totaling 600 kW');

  const hvDistributorMetrics = paletteUtilityMetrics(COMPONENTS.switchgear);
  assert(hvDistributorMetrics.some(r => r.label === 'Power draw' && r.value === '1,200 kW'),
    'HV Distributor Box: palette shows its 1,200 kW incoming feeder rating');
  assert(hvDistributorMetrics.some(r => r.label === 'Power capacity' && r.value === '1,200 kW'),
    'HV Distributor Box: palette shows four outputs totaling 1,200 kW');
}

// ======================================================================
// Test 8: water flow and storage stay separate in every component display.
// ======================================================================
console.log('\n--- Test 8: water inventory metrics stay separate ---');
{
  const rowsFor = id => utilityStatRows(COMPONENTS[id]);
  const makeUp = rowsFor('waterTank');
  const main = rowsFor('facilityWaterSupply');
  const bulk = rowsFor('bulkWaterTank');

  assert(makeUp.some(r => r.label === 'Water supply' && r.value === '1 L/tick')
      && makeUp.some(r => r.label === 'Water storage' && r.value === '500 L'),
    'make-up tank displays both its flow rate and capacity');
  assert(main.some(r => r.label === 'Water supply' && r.value === '20 L/tick')
      && !main.some(r => r.label === 'Water storage'),
    'water replenishment plant displays high flow and no invented storage');
  assert(bulk.some(r => r.label === 'Water storage' && r.value === '5000 L')
      && !bulk.some(r => r.label === 'Water supply'),
    'bulk tanks display storage and no invented generation');
  assert(supplyRows('waterTank').length === 0
      && supplyRows('facilityWaterSupply').length === 0
      && supplyRows('bulkWaterTank').length === 0,
    'water inventory roles are not mislabeled as thermal cooling supply');

  const makeUpMetrics = paletteUtilityMetrics(COMPONENTS.waterTank);
  assert(makeUpMetrics.some(r => r.label === 'Water supply' && r.value === '1 L/tick')
      && makeUpMetrics.some(r => r.label === 'Water storage' && r.value === '500 L'),
    'placement card exposes both make-up tank capabilities');
}

// ==========================================================================
// Test 9: RF card metadata cannot occupy the utility-tag rows.
// ==========================================================================
console.log('\n--- Test 9: RF palette badge layout ---');
{
  const rfComponents = Object.values(COMPONENTS)
    .filter(comp => comp.rfBand || comp.rfBands || comp.betaAcceptance);
  const maxUtilityRows = Math.max(...rfComponents.map(comp => paletteUtilityTags(comp).length));
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  assert(maxUtilityRows === 2,
    'RF palette hardware uses at most the two reserved utility rows');
  assert(/\.palette-item \.palette-utility-tags \+ \.palette-rf-band\s*\{[^}]*top:\s*32px/s.test(css),
    'RF metadata starts below utility rows instead of overlapping their text');
}

// ==========================================================================
console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s) failed`);
  process.exit(1);
}
