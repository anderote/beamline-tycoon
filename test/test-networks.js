// Test: every component has requiredConnections, RF components have rfFrequency
const fs = require('fs');
const vm = require('vm');

const ctx = vm.createContext({ console, Math, Date, JSON, Array, Object, String });
vm.runInContext(fs.readFileSync('data.js', 'utf8'), ctx);

const testCode = `
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
  console.log('\\n=== TESTS FAILED ===');
  // exit with error
  throw new Error(failed + ' test(s) failed');
} else {
  console.log('\\n=== ALL TESTS PASSED ===');
}
`;

vm.runInContext(testCode, ctx);

// === Network Discovery Tests ===
const Networks = require('../networks.js');

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
// Make COMPONENTS available as a global so validation methods can access it
// COMPONENTS is declared with const in data.js, so it's script-scoped in vm, not on ctx directly
global.COMPONENTS = vm.runInContext('COMPONENTS', ctx);

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

console.log('Passed: ' + vPassed + '  Failed: ' + vFailed);
if (vFailed > 0) {
  console.log('\n=== VALIDATION TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL VALIDATION TESTS PASSED ===');
}
