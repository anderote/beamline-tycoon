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
