// Test: every component has requiredConnections, RF components have rfFrequency
import { COMPONENTS } from '../src/data/components.js';
import { Networks } from '../src/networks/networks.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); failed++; }
  else { passed++; }
}

const keys = Object.keys(COMPONENTS);
console.log('=== Network Property Tests ===');
console.log('Testing ' + keys.length + ' components...');

// 1. Every component has a requiredConnections array
keys.forEach(k => {
  const c = COMPONENTS[k];
  assert(
    Array.isArray(c.requiredConnections),
    k + ' missing requiredConnections array'
  );
});

// 2. Every component with energyCost > 0 has powerCable
// Exceptions: passive components whose energy cost is indirect/negligible
const noPowerExceptions = ['tiSubPump', 'ln2Precooler', 'cryomoduleHousing', 'collimator'];
keys.forEach(k => {
  const c = COMPONENTS[k];
  if (c.energyCost > 0 && noPowerExceptions.indexOf(k) === -1) {
    assert(
      Array.isArray(c.requiredConnections) && c.requiredConnections.indexOf('powerCable') !== -1,
      k + ' has energyCost=' + c.energyCost + ' but no powerCable in requiredConnections'
    );
  }
});

// 3. All RF cavity types have rfFrequency
const rfCavityKeys = keys.filter(k => {
  const c = COMPONENTS[k];
  return (c.category === 'rf' ||
    (Array.isArray(c.requiredConnections) && c.requiredConnections.indexOf('rfWaveguide') !== -1 && c.category !== 'rfPower'));
});
rfCavityKeys.forEach(k => {
  const c = COMPONENTS[k];
  assert(
    c.rfFrequency !== undefined,
    k + ' is an RF cavity/structure but missing rfFrequency'
  );
});

// 4. All RF source types have rfFrequency
const rfSourceKeys = keys.filter(k => {
  const c = COMPONENTS[k];
  return c.category === 'rfPower' && c.subsection === 'sources';
});
rfSourceKeys.forEach(k => {
  const c = COMPONENTS[k];
  assert(
    c.rfFrequency !== undefined,
    k + ' is an RF source but missing rfFrequency'
  );
});

console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed > 0) {
  throw new Error(failed + ' test(s) failed');
}

// === Network Discovery Tests ===

function mockGameState() {
  return {
    connections: new Map(),
    facilityEquipment: [],
    facilityGrid: {},
    beamline: [],
  };
}

function placeConn(state, col, row, connType) {
  const key = col + ',' + row;
  if (!state.connections.has(key)) state.connections.set(key, new Set());
  state.connections.get(key).add(connType);
}

function placeEquip(state, id, type, col, row) {
  state.facilityEquipment.push({ id, type, col, row });
  state.facilityGrid[col + ',' + row] = id;
}

let nPassed = 0;
let nFailed = 0;
function nassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); nFailed++; }
  else { nPassed++; }
}

console.log('\n=== Network Discovery Tests ===');

// 1. Empty state returns no networks for any type
{
  const state = mockGameState();
  const result = Networks.discoverAll(state);
  ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber'].forEach(t => {
    nassert(Array.isArray(result[t]) && result[t].length === 0,
      'empty state should have no networks for ' + t);
  });
}

// 2. Single connection tile = one network with one tile
{
  const state = mockGameState();
  placeConn(state, 3, 4, 'powerCable');
  const result = Networks.discoverAll(state);
  nassert(result.powerCable.length === 1, 'single tile should yield 1 network');
  nassert(result.powerCable[0].tiles.length === 1, 'network should have 1 tile');
  nassert(result.powerCable[0].tiles[0].col === 3 && result.powerCable[0].tiles[0].row === 4,
    'tile coords should match');
}

// 3. Two adjacent tiles (same type) = one network with 2 tiles
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'vacuumPipe');
  placeConn(state, 5, 6, 'vacuumPipe');
  const result = Networks.discoverAll(state);
  nassert(result.vacuumPipe.length === 1, 'two adjacent tiles should form 1 network');
  nassert(result.vacuumPipe[0].tiles.length === 2, 'network should have 2 tiles');
}

// 4. Two separated tiles = two separate networks
{
  const state = mockGameState();
  placeConn(state, 0, 0, 'rfWaveguide');
  placeConn(state, 10, 10, 'rfWaveguide');
  const result = Networks.discoverAll(state);
  nassert(result.rfWaveguide.length === 2, 'two separated tiles should form 2 networks');
}

// 5. Facility equipment adjacent to network tile is included
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeEquip(state, 'eq1', 'generator', 5, 4); // one row above
  const result = Networks.discoverAll(state);
  nassert(result.powerCable[0].equipment.length === 1,
    'adjacent equipment should be found');
  nassert(result.powerCable[0].equipment[0].id === 'eq1',
    'equipment id should match');
}

// 6. Beamline node adjacent to network tile is included
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'coolingWater');
  state.beamline.push({ id: 'bl1', type: 'rfCavity', col: 6, row: 5, tiles: [{ col: 6, row: 5 }] });
  const result = Networks.discoverAll(state);
  nassert(result.coolingWater[0].beamlineNodes.length === 1,
    'adjacent beamline node should be found');
  nassert(result.coolingWater[0].beamlineNodes[0].id === 'bl1',
    'beamline node id should match');
}

// 7. Different connection types on same tile form independent networks
{
  const state = mockGameState();
  placeConn(state, 3, 3, 'powerCable');
  placeConn(state, 3, 3, 'dataFiber');
  const result = Networks.discoverAll(state);
  nassert(result.powerCable.length === 1, 'powerCable should have 1 network');
  nassert(result.dataFiber.length === 1, 'dataFiber should have 1 network');
  nassert(result.vacuumPipe.length === 0, 'vacuumPipe should have 0 networks');
}

// 8. Equipment tile overlapping a connection tile counts as adjacent
{
  const state = mockGameState();
  placeConn(state, 7, 7, 'cryoTransfer');
  placeEquip(state, 'eq2', 'cryoCooler', 7, 7); // same tile
  const result = Networks.discoverAll(state);
  nassert(result.cryoTransfer[0].equipment.length === 1,
    'overlapping equipment should be found');
}

console.log('Passed: ' + nPassed + '  Failed: ' + nFailed);
if (nFailed > 0) {
  console.log('\n=== NETWORK DISCOVERY TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL NETWORK DISCOVERY TESTS PASSED ===');
}

// === Network Validation Tests ===

let vPassed = 0;
let vFailed = 0;
function vassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); vFailed++; }
  else { vPassed++; }
}

function placeBeamlineNode(state, id, type, col, row) {
  state.beamline.push({ id: id, type: type, col: col, row: row, tiles: [{ col: col, row: row }] });
}

// --- Power Validation Tests ---
console.log('\n=== Power Validation Tests ===');

// 1. Substation provides 1500 kW, quad draws from it, ok=true
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  placeBeamlineNode(state, 'q1', 'quadrupole', 5, 7);
  const nets = Networks.discoverAll(state);
  const pNet = nets.powerCable[0];
  const result = Networks.validatePowerNetwork(pNet);
  vassert(result.capacity === 1500, 'substation should provide 1500 kW, got ' + result.capacity);
  vassert(result.draw === 6, 'quad should draw 6 kW, got ' + result.draw);
  vassert(result.ok === true, 'power should be ok');
  vassert(result.substations.length === 1, 'should have 1 substation');
  vassert(result.consumers.length === 1, 'should have 1 consumer');
  vassert(result.consumers[0].source === 'beamline', 'consumer source should be beamline');
}

// 2. No substation = zero capacity, ok=false
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeBeamlineNode(state, 'q1', 'quadrupole', 5, 6);
  const nets = Networks.discoverAll(state);
  const pNet = nets.powerCable[0];
  const result = Networks.validatePowerNetwork(pNet);
  vassert(result.capacity === 0, 'no substation = 0 capacity');
  vassert(result.ok === false, 'no substation should fail');
}

// 3. Facility equipment draw also counted
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  placeEquip(state, 'ch1', 'chiller', 5, 7);
  const nets = Networks.discoverAll(state);
  const pNet = nets.powerCable[0];
  const result = Networks.validatePowerNetwork(pNet);
  vassert(result.capacity === 1500, 'substation capacity correct');
  vassert(result.draw === 5, 'chiller draws 5 kW, got ' + result.draw);
  vassert(result.consumers.length === 1, 'should have 1 facility consumer');
  vassert(result.consumers[0].source === 'facility', 'consumer source should be facility');
  vassert(result.ok === true, 'power should be ok with chiller');
}

// --- Cooling Validation Tests ---
console.log('\n=== Cooling Validation Tests ===');

// 1. Chiller provides 200 kW, dipole generates heat, ok=true
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'coolingWater');
  placeConn(state, 5, 6, 'coolingWater');
  placeEquip(state, 'ch1', 'chiller', 5, 4);
  placeBeamlineNode(state, 'd1', 'dipole', 5, 7);
  const nets = Networks.discoverAll(state);
  const cNet = nets.coolingWater[0];
  const result = Networks.validateCoolingNetwork(cNet);
  vassert(result.capacity === 200, 'chiller should provide 200 kW, got ' + result.capacity);
  // dipole energyCost=8, heat = 8*0.6 = 4.8
  vassert(Math.abs(result.heatLoad - 4.8) < 0.01, 'dipole heat should be 4.8, got ' + result.heatLoad);
  vassert(result.ok === true, 'cooling should be ok');
  vassert(result.plants.length === 1, 'should have 1 cooling plant');
  vassert(result.consumers.length === 1, 'should have 1 consumer');
}

// 2. No cooling plant = zero capacity
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'coolingWater');
  placeBeamlineNode(state, 'd1', 'dipole', 5, 6);
  const nets = Networks.discoverAll(state);
  const cNet = nets.coolingWater[0];
  const result = Networks.validateCoolingNetwork(cNet);
  vassert(result.capacity === 0, 'no cooling plant = 0 capacity');
  vassert(result.ok === false, 'no cooling plant should fail');
}

// --- Cryo Validation Tests ---
console.log('\n=== Cryo Validation Tests ===');

// 1. Compressor + 4K cold box = 500W capacity, cryomodule = 18W heat, ok=true
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'cryoTransfer');
  placeConn(state, 5, 6, 'cryoTransfer');
  placeConn(state, 5, 7, 'cryoTransfer');
  placeEquip(state, 'comp1', 'heCompressor', 5, 4);
  placeEquip(state, 'cb1', 'coldBox4K', 5, 8);
  placeBeamlineNode(state, 'cm1', 'cryomodule', 6, 5);
  const nets = Networks.discoverAll(state);
  const crNet = nets.cryoTransfer[0];
  const result = Networks.validateCryoNetwork(crNet);
  vassert(result.hasCompressor === true, 'should detect compressor');
  vassert(result.capacity === 500, '4K cold box with compressor = 500W, got ' + result.capacity);
  vassert(result.heatLoad === 18, 'cryomodule = 18W heat, got ' + result.heatLoad);
  vassert(result.opTemp === 4.5, 'opTemp should be 4.5K, got ' + result.opTemp);
  vassert(result.ok === true, 'cryo should be ok');
}

// 2. Cold box without compressor = 0 capacity, ok=false
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'cryoTransfer');
  placeConn(state, 5, 6, 'cryoTransfer');
  placeEquip(state, 'cb1', 'coldBox4K', 5, 4);
  placeBeamlineNode(state, 'cm1', 'cryomodule', 5, 7);
  const nets = Networks.discoverAll(state);
  const crNet = nets.cryoTransfer[0];
  const result = Networks.validateCryoNetwork(crNet);
  vassert(result.hasCompressor === false, 'no compressor');
  vassert(result.capacity === 0, 'cold box without compressor = 0 capacity, got ' + result.capacity);
  vassert(result.ok === false, 'should fail without compressor');
  vassert(result.opTemp === 4.5, 'opTemp still set from cold box, got ' + result.opTemp);
}

// 3. Cryocooler works without compressor (50W)
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'cryoTransfer');
  placeEquip(state, 'cc1', 'cryocooler', 5, 4);
  const nets = Networks.discoverAll(state);
  const crNet = nets.cryoTransfer[0];
  const result = Networks.validateCryoNetwork(crNet);
  vassert(result.hasCompressor === false, 'no compressor needed for cryocooler');
  vassert(result.capacity === 50, 'cryocooler = 50W, got ' + result.capacity);
  vassert(result.opTemp === 40, 'cryocooler opTemp = 40K, got ' + result.opTemp);
  vassert(result.ok === true, 'cryocooler with no heat load should be ok');
}

// --- RF Validation Tests ---
console.log('\n=== RF Validation Tests ===');

// 1. Klystron (2856 MHz) + rfCavity (2856 MHz) with modulator = ok
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeConn(state, 5, 7, 'rfWaveguide');
  placeEquip(state, 'k1', 'pulsedKlystron', 5, 4);
  placeEquip(state, 'mod1', 'modulator', 5, 8);
  placeBeamlineNode(state, 'cav1', 'rfCavity', 6, 6);
  const nets = Networks.discoverAll(state);
  const rfNet = nets.rfWaveguide[0];
  const result = Networks.validateRfNetwork(rfNet);
  vassert(result.ok === true, 'RF1: klystron + rfCavity + modulator should be ok, got ok=' + result.ok);
  vassert(result.sources.length === 1, 'RF1: should have 1 source, got ' + result.sources.length);
  vassert(result.cavities.length === 1, 'RF1: should have 1 cavity, got ' + result.cavities.length);
  vassert(result.frequencyMatch === true, 'RF1: frequency should match');
  vassert(result.missingModulator === false, 'RF1: modulator present');
  vassert(result.sources[0].power === 50, 'RF1: klystron power should be 50, got ' + result.sources[0].power);
}

// 2. Klystron (2856 MHz) + cryomodule (1300 MHz) = frequency mismatch
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeConn(state, 5, 7, 'rfWaveguide');
  placeEquip(state, 'k1', 'pulsedKlystron', 5, 4);
  placeEquip(state, 'mod1', 'modulator', 5, 8);
  placeBeamlineNode(state, 'cm1', 'cryomodule', 6, 6);
  const nets = Networks.discoverAll(state);
  const rfNet = nets.rfWaveguide[0];
  const result = Networks.validateRfNetwork(rfNet);
  vassert(result.frequencyMatch === false, 'RF2: 2856 klystron + 1300 cryomodule should mismatch');
  vassert(result.mismatches.length === 1, 'RF2: should have 1 mismatch, got ' + result.mismatches.length);
  vassert(result.ok === false, 'RF2: should not be ok');
}

// 3. Broadband SSA + any cavity = ok (broadband matches anything)
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 'ssa1', 'solidStateAmp', 5, 4);
  placeBeamlineNode(state, 'cav1', 'cryomodule', 6, 5);
  const nets = Networks.discoverAll(state);
  const rfNet = nets.rfWaveguide[0];
  const result = Networks.validateRfNetwork(rfNet);
  vassert(result.frequencyMatch === true, 'RF3: broadband should match any cavity');
  vassert(result.mismatches.length === 0, 'RF3: no mismatches');
  vassert(result.missingModulator === false, 'RF3: SSA not pulsed, no modulator needed');
}

// 4. Pulsed klystron without modulator = zero power, missingModulator=true
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 'k1', 'pulsedKlystron', 5, 4);
  placeBeamlineNode(state, 'cav1', 'rfCavity', 6, 5);
  const nets = Networks.discoverAll(state);
  const rfNet = nets.rfWaveguide[0];
  const result = Networks.validateRfNetwork(rfNet);
  vassert(result.missingModulator === true, 'RF4: should flag missing modulator');
  vassert(result.sources[0].power === 0, 'RF4: pulsed klystron without modulator should have 0 power, got ' + result.sources[0].power);
  vassert(result.ok === false, 'RF4: should not be ok without modulator');
}

// 5. Klystron + modulator = power available, missingModulator=false
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 'k1', 'pulsedKlystron', 5, 4);
  placeEquip(state, 'mod1', 'modulator', 5, 7);
  const nets = Networks.discoverAll(state);
  const rfNet = nets.rfWaveguide[0];
  const result = Networks.validateRfNetwork(rfNet);
  vassert(result.missingModulator === false, 'RF5: modulator present');
  vassert(result.sources[0].power === 50, 'RF5: klystron with modulator should have 50 MW power, got ' + result.sources[0].power);
}

// --- Vacuum Validation Tests ---
console.log('\n=== Vacuum Validation Tests ===');

// 1. Short path: pump adjacent to 1 pipe tile, beamline adjacent to same tile
{
  const state = mockGameState();
  // One vacuum pipe tile at (5,5)
  placeConn(state, 5, 5, 'vacuumPipe');
  // Turbo pump adjacent at (5,4)
  placeEquip(state, 'tp1', 'turboPump', 5, 4);
  // Beamline node (drift) adjacent at (5,6)
  state.beamline.push({ id: 'bl1', type: 'drift', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] });
  const nets = Networks.discoverAll(state);
  const vNet = nets.vacuumPipe[0];
  const result = Networks.validateVacuumNetwork(vNet, state.beamline);
  // S_eff = 1/(1/300 + 1/50) = 1/(0.00333 + 0.02) = 1/0.02333 ≈ 42.86
  vassert(result.effectivePumpSpeed > 40 && result.effectivePumpSpeed < 50,
    'VAC1: short path S_eff should be 40-50, got ' + result.effectivePumpSpeed);
  vassert(result.ok === true, 'VAC1: should be ok');
  vassert(result.pumps.length === 1, 'VAC1: should have 1 pump');
}

// 2. Long path: pump connected through 10 tiles of pipe to beamline
{
  const state = mockGameState();
  // 10 vacuum pipe tiles in a line from (0,5) to (9,5)
  for (let c = 0; c < 10; c++) {
    placeConn(state, c, 5, 'vacuumPipe');
  }
  // Turbo pump adjacent to first tile at (-1,5)
  placeEquip(state, 'tp1', 'turboPump', -1, 5);
  // Beamline node adjacent to last tile at (10,5)
  state.beamline.push({ id: 'bl1', type: 'drift', col: 10, row: 5, tiles: [{ col: 10, row: 5 }] });
  const nets = Networks.discoverAll(state);
  const vNet = nets.vacuumPipe[0];
  const result = Networks.validateVacuumNetwork(vNet, state.beamline);
  // C_path = 50/10 = 5, S_eff = 1/(1/300 + 1/5) = 1/(0.00333+0.2) ≈ 4.92
  vassert(result.effectivePumpSpeed < 10,
    'VAC2: long path S_eff should be < 10, got ' + result.effectivePumpSpeed);
  vassert(result.pumps[0].pathLength === 10,
    'VAC2: path length should be 10, got ' + result.pumps[0].pathLength);
}

// 3. Two pumps parallel: two turbo pumps each adjacent to a pipe tile that's adjacent to beamline
{
  const state = mockGameState();
  // Three pipe tiles in a line
  placeConn(state, 5, 5, 'vacuumPipe');
  placeConn(state, 6, 5, 'vacuumPipe');
  placeConn(state, 7, 5, 'vacuumPipe');
  // Two turbo pumps, each adjacent to an end tile
  placeEquip(state, 'tp1', 'turboPump', 5, 4);
  placeEquip(state, 'tp2', 'turboPump', 7, 4);
  // Beamline node adjacent to all three pipe tiles (directly below the line)
  // Node at row 6, with tiles spanning cols 5-7 so each pipe tile is a beamline connection
  state.beamline.push({ id: 'bl1', type: 'drift', col: 5, row: 6,
    tiles: [{ col: 5, row: 6 }, { col: 6, row: 6 }, { col: 7, row: 6 }] });
  const nets = Networks.discoverAll(state);
  const vNet = nets.vacuumPipe[0];
  const result = Networks.validateVacuumNetwork(vNet, state.beamline);
  // Each pump: path length 1 (adjacent tile IS a beamline connection point)
  // S_eff each ≈ 42.86, total ≈ 85.7
  vassert(result.effectivePumpSpeed > 70,
    'VAC3: two parallel pumps should give > 70 L/s, got ' + result.effectivePumpSpeed);
  vassert(result.pumps.length === 2, 'VAC3: should have 2 pumps');
}

// 4. No pumps: pipe tiles with no pumps
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'vacuumPipe');
  state.beamline.push({ id: 'bl1', type: 'drift', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] });
  const nets = Networks.discoverAll(state);
  const vNet = nets.vacuumPipe[0];
  const result = Networks.validateVacuumNetwork(vNet, state.beamline);
  vassert(result.effectivePumpSpeed === 0, 'VAC4: no pumps = 0 speed');
  vassert(result.pressureQuality === 'None', 'VAC4: quality should be None, got ' + result.pressureQuality);
  vassert(result.ok === false, 'VAC4: should not be ok');
}

console.log('Passed: ' + vPassed + '  Failed: ' + vFailed);
if (vFailed > 0) {
  console.log('\n=== VALIDATION TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL VALIDATION TESTS PASSED ===');
}

// === Full Validation Engine Tests ===
let fPassed = 0;
let fFailed = 0;
function fassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); fFailed++; }
  else { fPassed++; }
}

console.log('\n=== Full Validation Engine Tests ===');

// 1. Minimal valid setup: source + substation (power cable connected) + PPS + shielding → no blockers
{
  const state = mockGameState();
  // Power cable from substation to source
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  // Vacuum system: pipe + pump connected to beamline
  placeConn(state, 5, 8, 'vacuumPipe');
  placeEquip(state, 'tp1', 'turboPump', 5, 9);
  // Source on beamline at (5,7), adjacent to power cable at (5,6) and vacuum pipe at (5,8)
  placeBeamlineNode(state, 's1', 'source', 5, 7);
  // PPS interlock
  placeEquip(state, 'pps1', 'ppsInterlock', 10, 10);
  // Shielding (need at least 1 since source energyCost=5, ceil(5/50)=1)
  placeEquip(state, 'sh1', 'shielding', 12, 12);

  const result = Networks.validate(state);
  fassert(result.canRun === true, 'VALID1: minimal valid setup should canRun=true, blockers=' + JSON.stringify(result.blockers));
  fassert(result.blockers.length === 0, 'VALID1: should have 0 blockers, got ' + result.blockers.length);
  fassert(result.networks !== undefined, 'VALID1: should return networks');
}

// 2. Missing PPS: same but no PPS interlock → blocker with reason containing "PPS"
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  placeConn(state, 5, 8, 'vacuumPipe');
  placeEquip(state, 'tp1', 'turboPump', 5, 9);
  placeBeamlineNode(state, 's1', 'source', 5, 7);
  // Shielding but no PPS
  placeEquip(state, 'sh1', 'shielding', 12, 12);

  const result = Networks.validate(state);
  fassert(result.canRun === false, 'VALID2: missing PPS should canRun=false');
  const ppsBlocker = result.blockers.find(b => b.reason.indexOf('PPS') !== -1);
  fassert(ppsBlocker !== undefined, 'VALID2: should have blocker mentioning PPS');
}

// 3. Missing connection: quadrupole without power cable or cooling water → blockers for both
{
  const state = mockGameState();
  // Quad on beamline but no connections at all
  placeBeamlineNode(state, 'q1', 'quadrupole', 5, 5);
  // PPS and shielding present
  placeEquip(state, 'pps1', 'ppsInterlock', 10, 10);
  placeEquip(state, 'sh1', 'shielding', 12, 12);

  const result = Networks.validate(state);
  fassert(result.canRun === false, 'VALID3: missing connections should canRun=false');
  const powerBlocker = result.blockers.find(b => b.type === 'connection' && b.missing === 'powerCable' && b.nodeId === 'q1');
  const coolBlocker = result.blockers.find(b => b.type === 'connection' && b.missing === 'coolingWater' && b.nodeId === 'q1');
  fassert(powerBlocker !== undefined, 'VALID3: should have powerCable blocker for quad');
  fassert(coolBlocker !== undefined, 'VALID3: should have coolingWater blocker for quad');
}

// 4. Insufficient shielding: source with energyCost=5, needs ceil(5/50)=1 shielding, have 0
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  placeConn(state, 5, 8, 'vacuumPipe');
  placeEquip(state, 'tp1', 'turboPump', 5, 9);
  placeBeamlineNode(state, 's1', 'source', 5, 7);
  placeEquip(state, 'pps1', 'ppsInterlock', 10, 10);
  // No shielding

  const result = Networks.validate(state);
  fassert(result.canRun === false, 'VALID4: no shielding should canRun=false');
  const shieldBlocker = result.blockers.find(b => b.type === 'shielding');
  fassert(shieldBlocker !== undefined, 'VALID4: should have shielding blocker');
  fassert(shieldBlocker && shieldBlocker.reason.indexOf('need 1') !== -1,
    'VALID4: shielding blocker should say need 1, got: ' + (shieldBlocker && shieldBlocker.reason));
}

console.log('Passed: ' + fPassed + '  Failed: ' + fFailed);
if (fFailed > 0) {
  console.log('\n=== FULL VALIDATION TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL FULL VALIDATION TESTS PASSED ===');
}

// === Network Quality Tests ===
let qPassed = 0;
let qFailed = 0;
function qassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); qFailed++; }
  else { qPassed++; }
}

console.log('\n=== Network Quality Tests ===');

// 1. Power network with no draw → quality 1.0
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  const nets = Networks.discoverAll(state);
  const pNet = nets.powerCable[0];
  const result = Networks.validatePowerNetwork(pNet);
  qassert(result.quality === 1.0, 'Q1: power with no draw should have quality 1.0, got ' + result.quality);
}

// 2. Power network with no capacity (no substation) → quality 0
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeBeamlineNode(state, 'q1', 'quadrupole', 5, 6);
  const nets = Networks.discoverAll(state);
  const pNet = nets.powerCable[0];
  const result = Networks.validatePowerNetwork(pNet);
  qassert(result.quality === 0, 'Q2: power with no capacity should have quality 0, got ' + result.quality);
}

// 3. computeNetworkQuality with lab bonus: capacity=0, demand=100, lab bonus 0.15 → quality 0.15
{
  var q = Networks.computeNetworkQuality(0, 100, [{ bonus: 0.15 }]);
  qassert(Math.abs(q - 0.15) < 0.001, 'Q3: capacity=0, demand=100, bonus=0.15 should give 0.15, got ' + q);
}

// 4. computeNetworkQuality capped at 1.0 when ratio + bonus > 1.0
{
  var q = Networks.computeNetworkQuality(100, 100, [{ bonus: 0.3 }]);
  qassert(q === 1.0, 'Q4: ratio 1.0 + bonus 0.3 should cap at 1.0, got ' + q);
}

// 5. Vacuum quality maps: verify validateVacuumNetwork returns numeric quality
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'vacuumPipe');
  placeEquip(state, 'tp1', 'turboPump', 5, 4);
  state.beamline.push({ id: 'bl1', type: 'drift', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] });
  const nets = Networks.discoverAll(state);
  const vNet = nets.vacuumPipe[0];
  const result = Networks.validateVacuumNetwork(vNet, state.beamline);
  qassert(typeof result.quality === 'number', 'Q5: vacuum quality should be a number, got ' + typeof result.quality);
  qassert(result.quality > 0 && result.quality <= 1.0, 'Q5: vacuum quality should be between 0 and 1, got ' + result.quality);
}

// 6. Cryo quenched field: true when ratio < 0.5 with heat load
{
  const state = mockGameState();
  // Long cryo transfer line so all cryomodules are adjacent
  for (let r = 3; r <= 10; r++) {
    placeConn(state, 5, r, 'cryoTransfer');
  }
  // Cryocooler provides 50W capacity
  placeEquip(state, 'cc1', 'cryocooler', 5, 2);
  // Add many cryomodules to exceed capacity (each 18W, need > 100W total for ratio < 0.5)
  placeBeamlineNode(state, 'cm1', 'cryomodule', 6, 3);
  placeBeamlineNode(state, 'cm2', 'cryomodule', 6, 4);
  placeBeamlineNode(state, 'cm3', 'cryomodule', 6, 5);
  placeBeamlineNode(state, 'cm4', 'cryomodule', 6, 6);
  placeBeamlineNode(state, 'cm5', 'cryomodule', 6, 7);
  placeBeamlineNode(state, 'cm6', 'cryomodule', 6, 8);
  const nets = Networks.discoverAll(state);
  const crNet = nets.cryoTransfer[0];
  const result = Networks.validateCryoNetwork(crNet);
  // 6 cryomodules * 18W = 108W heat, 50W capacity, ratio = 50/108 ≈ 0.463
  qassert(result.quenched === true, 'Q6: cryo should be quenched when ratio < 0.5, ratio=' + result.quality + ' quenched=' + result.quenched);
  qassert(result.quality < 0.5, 'Q6: quality should be < 0.5, got ' + result.quality);
}

console.log('Passed: ' + qPassed + '  Failed: ' + qFailed);
if (qFailed > 0) {
  console.log('\n=== NETWORK QUALITY TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL NETWORK QUALITY TESTS PASSED ===');
}

// === Per-Node Quality Tests ===
let nqPassed = 0;
let nqFailed = 0;
function nqassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); nqFailed++; }
  else { nqPassed++; }
}

console.log('\n=== Per-Node Quality Tests ===');

// 1. Node on power network with substation → powerQuality = 1.0
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 'sub1', 'substation', 5, 4);
  placeBeamlineNode(state, 'q1', 'quadrupole', 5, 7);
  const nets = Networks.discoverAll(state);
  const labBonuses = { powerCable: [], rfWaveguide: [], coolingWater: [], vacuumPipe: [], cryoTransfer: [], dataFiber: [] };
  const qualities = Networks.computeNodeQualities(nets, labBonuses, state.beamline);
  nqassert(qualities['q1'] !== undefined, 'NQ1: node q1 should be in qualities');
  nqassert(qualities['q1'].powerQuality === 1.0, 'NQ1: powerQuality should be 1.0, got ' + (qualities['q1'] && qualities['q1'].powerQuality));
}

// 2. Node not on any network → all defaults (1.0, no quench)
{
  const state = mockGameState();
  placeBeamlineNode(state, 'lonely1', 'drift', 50, 50);
  const nets = Networks.discoverAll(state);
  const labBonuses = { powerCable: [], rfWaveguide: [], coolingWater: [], vacuumPipe: [], cryoTransfer: [], dataFiber: [] };
  const qualities = Networks.computeNodeQualities(nets, labBonuses, state.beamline);
  nqassert(qualities['lonely1'] !== undefined, 'NQ2: lonely node should be in qualities');
  var q = qualities['lonely1'];
  nqassert(q.powerQuality === 1.0, 'NQ2: powerQuality default 1.0, got ' + q.powerQuality);
  nqassert(q.rfQuality === 1.0, 'NQ2: rfQuality default 1.0, got ' + q.rfQuality);
  nqassert(q.coolingQuality === 1.0, 'NQ2: coolingQuality default 1.0, got ' + q.coolingQuality);
  nqassert(q.vacuumQuality === 1.0, 'NQ2: vacuumQuality default 1.0, got ' + q.vacuumQuality);
  nqassert(q.cryoQuality === 1.0, 'NQ2: cryoQuality default 1.0, got ' + q.cryoQuality);
  nqassert(q.cryoQuenched === false, 'NQ2: cryoQuenched default false, got ' + q.cryoQuenched);
  nqassert(q.dataQuality === 1.0, 'NQ2: dataQuality default 1.0, got ' + q.dataQuality);
}

// 3. Verify return structure has all expected fields for every node
{
  const state = mockGameState();
  placeBeamlineNode(state, 'n1', 'source', 5, 5);
  placeBeamlineNode(state, 'n2', 'quadrupole', 6, 5);
  const nets = Networks.discoverAll(state);
  const labBonuses = { powerCable: [], rfWaveguide: [], coolingWater: [], vacuumPipe: [], cryoTransfer: [], dataFiber: [] };
  const qualities = Networks.computeNodeQualities(nets, labBonuses, state.beamline);
  var expectedFields = ['powerQuality', 'rfQuality', 'coolingQuality', 'vacuumQuality', 'cryoQuality', 'cryoQuenched', 'dataQuality'];
  for (var ni = 0; ni < state.beamline.length; ni++) {
    var nodeId = state.beamline[ni].id;
    for (var fi = 0; fi < expectedFields.length; fi++) {
      nqassert(qualities[nodeId][expectedFields[fi]] !== undefined,
        'NQ3: node ' + nodeId + ' should have field ' + expectedFields[fi]);
    }
  }
}

// 4. Cryo quench: node on quenched cryo network → cryoQuality = 0, cryoQuenched = true
{
  const state = mockGameState();
  for (var r = 3; r <= 10; r++) {
    placeConn(state, 5, r, 'cryoTransfer');
  }
  placeEquip(state, 'cc1', 'cryocooler', 5, 2);
  placeBeamlineNode(state, 'cm1', 'cryomodule', 6, 3);
  placeBeamlineNode(state, 'cm2', 'cryomodule', 6, 4);
  placeBeamlineNode(state, 'cm3', 'cryomodule', 6, 5);
  placeBeamlineNode(state, 'cm4', 'cryomodule', 6, 6);
  placeBeamlineNode(state, 'cm5', 'cryomodule', 6, 7);
  placeBeamlineNode(state, 'cm6', 'cryomodule', 6, 8);
  const nets = Networks.discoverAll(state);
  const labBonuses = { powerCable: [], rfWaveguide: [], coolingWater: [], vacuumPipe: [], cryoTransfer: [], dataFiber: [] };
  const qualities = Networks.computeNodeQualities(nets, labBonuses, state.beamline);
  nqassert(qualities['cm1'].cryoQuenched === true, 'NQ4: cryoQuenched should be true, got ' + qualities['cm1'].cryoQuenched);
  nqassert(qualities['cm1'].cryoQuality === 0, 'NQ4: cryoQuality should be 0, got ' + qualities['cm1'].cryoQuality);
}

// 5. Data fiber: base quality 1.0 (no capacity/demand concept)
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'dataFiber');
  placeBeamlineNode(state, 'df1', 'bpm', 5, 6);
  const nets = Networks.discoverAll(state);
  const labBonuses = { powerCable: [], rfWaveguide: [], coolingWater: [], vacuumPipe: [], cryoTransfer: [], dataFiber: [] };
  const qualities = Networks.computeNodeQualities(nets, labBonuses, state.beamline);
  nqassert(qualities['df1'].dataQuality === 1.0, 'NQ5: dataQuality should be 1.0, got ' + qualities['df1'].dataQuality);
}

console.log('Passed: ' + nqPassed + '  Failed: ' + nqFailed);
if (nqFailed > 0) {
  console.log('\n=== PER-NODE QUALITY TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL PER-NODE QUALITY TESTS PASSED ===');
}
