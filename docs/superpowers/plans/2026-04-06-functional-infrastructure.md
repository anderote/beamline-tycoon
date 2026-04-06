# Functional Facility Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all facility infrastructure systems (power, vacuum, RF, cooling, cryo, controls, ops) into hard gates on beam operation, with per-network isolation and a network inspection UI.

**Architecture:** New `networks.js` module discovers and validates utility networks. `game.js` calls the validation engine on infrastructure changes and beam toggle, blocking beam when requirements aren't met. The existing `energy` resource is removed and replaced with kW supply/demand. Network inspection UI is a floating overlay triggered by clicking facility equipment.

**Tech Stack:** Vanilla JS (browser globals), PixiJS for rendering, existing test harness (Node.js, no framework)

---

### Task 1: Add `requiredConnections` and `rfFrequency` to all component definitions

**Files:**
- Modify: `data.js:147-1966` (COMPONENTS object — every component gets `requiredConnections` array, RF components get `rfFrequency`)

- [ ] **Step 1: Write the test**

Create `test/test-networks.js` with an initial test verifying every component with `energyCost > 0` has `requiredConnections` defined:

```js
// test/test-networks.js — Tests for utility network logic

// --- Stub globals from data.js ---
global.DIR = { NE: 0, SE: 1, SW: 2, NW: 3 };
global.DIR_DELTA = [
  { dc: 0, dr: -1 }, { dc: 1, dr: 0 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 },
];
global.turnLeft = function(dir) { return (dir + 3) % 4; };
global.turnRight = function(dir) { return (dir + 1) % 4; };
global.reverseDir = function(dir) { return (dir + 2) % 4; };
global.TILE_W = 64;
global.TILE_H = 32;
global.MODES = {};
global.CATEGORIES = {};
global.CONNECTION_TYPES = {};
global.INFRASTRUCTURE = {};
global.ZONES = {};
global.ZONE_TIER_THRESHOLDS = [];
global.RESEARCH = {};
global.OBJECTIVES = [];
global.PARAM_DEFS = {};
global.MACHINES = {};

// Load data.js (sets globals)
require('../data.js');

// --- Test harness ---
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function section(name) { console.log(`\n=== ${name} ===`); }

// --- Tests ---

section('requiredConnections defined');

for (const [id, comp] of Object.entries(COMPONENTS)) {
  assert(
    Array.isArray(comp.requiredConnections),
    `${id} has requiredConnections array`
  );
}

section('energyCost > 0 implies powerCable required');

for (const [id, comp] of Object.entries(COMPONENTS)) {
  if ((comp.energyCost || 0) > 0) {
    assert(
      comp.requiredConnections.includes('powerCable'),
      `${id} (energyCost=${comp.energyCost}) requires powerCable`
    );
  }
}

section('RF components have rfFrequency');

const rfCavityTypes = [
  'rfCavity', 'pillboxCavity', 'halfWaveCavity', 'rfq',
  'sBandStructure', 'cBandStructure', 'xBandStructure',
  'cryomodule', 'tesla9Cell', 'srf650Cavity',
  'ncRfGun', 'srfGun', 'buncher',
];
for (const id of rfCavityTypes) {
  if (!COMPONENTS[id]) continue;
  assert(
    COMPONENTS[id].rfFrequency !== undefined,
    `${id} has rfFrequency defined`
  );
}

const rfSourceTypes = [
  'magnetron', 'ssa', 'klystron', 'cwKlystron',
  'iot', 'multiBeamKlystron', 'highPowerSSA',
];
for (const id of rfSourceTypes) {
  if (!COMPONENTS[id]) continue;
  assert(
    COMPONENTS[id].rfFrequency !== undefined,
    `${id} has rfFrequency defined`
  );
}

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-networks.js`
Expected: FAIL — components don't have `requiredConnections` yet

- [ ] **Step 3: Add `requiredConnections` and `rfFrequency` to every component**

Add a `requiredConnections` array to every entry in `COMPONENTS` in `data.js`. Also add `rfFrequency` to all RF sources and cavities. Use these exact values from the spec:

**Beamline components:**
```
source:              requiredConnections: ['powerCable']
drift:               requiredConnections: []
beamPipe:            requiredConnections: []
dipole:              requiredConnections: ['powerCable', 'coolingWater']
quadrupole:          requiredConnections: ['powerCable', 'coolingWater']
sextupole:           requiredConnections: ['powerCable', 'coolingWater']
corrector:           requiredConnections: ['powerCable']
solenoid:            requiredConnections: ['powerCable', 'coolingWater']
rfCavity:            requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'], rfFrequency: 2856
pillboxCavity:       requiredConnections: ['powerCable', 'rfWaveguide'], rfFrequency: 200
halfWaveCavity:      requiredConnections: ['powerCable', 'rfWaveguide'], rfFrequency: 100
rfq:                 requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'], rfFrequency: 400
sBandStructure:      requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'], rfFrequency: 2856
cBandStructure:      requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'], rfFrequency: 5712
xBandStructure:      requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'], rfFrequency: 11424
cryomodule:          requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'], rfFrequency: 1300
tesla9Cell:          requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'], rfFrequency: 1300
srf650Cavity:        requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'], rfFrequency: 650
ncRfGun:             requiredConnections: ['powerCable', 'coolingWater', 'rfWaveguide'], rfFrequency: 2856
srfGun:              requiredConnections: ['powerCable', 'cryoTransfer', 'rfWaveguide'], rfFrequency: 1300
dcPhotocathodeGun:   requiredConnections: ['powerCable']
bpm:                 requiredConnections: ['powerCable', 'dataFiber']
emittanceScanner:    requiredConnections: ['powerCable', 'dataFiber']
wallCurrentMonitor:  requiredConnections: ['powerCable', 'dataFiber']
wireScanner:         requiredConnections: ['powerCable', 'dataFiber']
striplinePickup:     requiredConnections: ['powerCable', 'dataFiber']
cavityBpm:           requiredConnections: ['powerCable', 'dataFiber']
bunchLengthMonitor:  requiredConnections: ['powerCable', 'dataFiber']
energySpectrometer:  requiredConnections: ['powerCable', 'dataFiber']
blm:                 requiredConnections: ['powerCable', 'dataFiber']
collimator:          requiredConnections: ['coolingWater']
target:              requiredConnections: ['coolingWater']
beamStop:            requiredConnections: ['coolingWater']
scQuad:              requiredConnections: ['powerCable', 'cryoTransfer', 'coolingWater']
scDipole:            requiredConnections: ['powerCable', 'cryoTransfer', 'coolingWater']
undulator:           requiredConnections: ['powerCable']
wiggler:             requiredConnections: ['powerCable']
chicane:             requiredConnections: ['powerCable']
bunchCompressor:     requiredConnections: ['powerCable']
septum:              requiredConnections: ['powerCable']
kicker:              requiredConnections: ['powerCable']
photonPort:          requiredConnections: []
detector:            requiredConnections: ['powerCable', 'coolingWater', 'dataFiber']
positronTarget:      requiredConnections: ['powerCable', 'coolingWater']
splitter:            requiredConnections: ['powerCable']
buncher:             requiredConnections: ['powerCable', 'rfWaveguide'], rfFrequency: 2856
laserHeater:         requiredConnections: ['powerCable']
```

**RF sources (facility equipment):**
```
magnetron:           requiredConnections: ['powerCable'], rfFrequency: 2856
ssa:                 requiredConnections: ['powerCable'], rfFrequency: 'broadband'
klystron:            requiredConnections: ['powerCable'], rfFrequency: 2856
cwKlystron:          requiredConnections: ['powerCable'], rfFrequency: 1300
iot:                 requiredConnections: ['powerCable'], rfFrequency: 1300
multiBeamKlystron:   requiredConnections: ['powerCable'], rfFrequency: 11424
highPowerSSA:        requiredConnections: ['powerCable'], rfFrequency: 'broadband'
```

**Other facility equipment:**
```
modulator:           requiredConnections: ['powerCable']
circulator:          requiredConnections: []
highPowerCoupler:    requiredConnections: []
llrfController:      requiredConnections: ['powerCable', 'dataFiber']
roughingPump:        requiredConnections: ['powerCable']
turboPump:           requiredConnections: ['powerCable']
ionPump:             requiredConnections: ['powerCable']
negPump:             requiredConnections: []
tiSubPump:           requiredConnections: []
piraniGauge:         requiredConnections: []
coldCathodeGauge:    requiredConnections: ['powerCable']
baGauge:             requiredConnections: ['powerCable']
gateValve:           requiredConnections: []
bakeoutSystem:       requiredConnections: ['powerCable']
ln2Dewar:            requiredConnections: []
cryocooler:          requiredConnections: ['powerCable']
ln2Precooler:        requiredConnections: []
heCompressor:        requiredConnections: ['powerCable', 'coolingWater']
coldBox4K:           requiredConnections: ['powerCable']
coldBox2K:           requiredConnections: ['powerCable']
cryomoduleHousing:   requiredConnections: []
heRecovery:          requiredConnections: ['powerCable']
heatExchanger:       requiredConnections: []
waterLoad:           requiredConnections: []
lcwSkid:             requiredConnections: ['powerCable']
chiller:             requiredConnections: ['powerCable']
coolingTower:        requiredConnections: ['powerCable']
deionizer:           requiredConnections: ['powerCable']
emergencyCooling:    requiredConnections: ['powerCable']
rackIoc:             requiredConnections: ['powerCable']
ppsInterlock:        requiredConnections: ['powerCable']
mps:                 requiredConnections: ['powerCable', 'dataFiber']
areaMonitor:         requiredConnections: ['powerCable']
timingSystem:        requiredConnections: ['powerCable', 'dataFiber']
shielding:           requiredConnections: []
targetHandling:      requiredConnections: ['powerCable']
beamDump:            requiredConnections: ['coolingWater']
radWasteStorage:     requiredConnections: []
powerPanel:          requiredConnections: []
substation:          requiredConnections: []
laserSystem:         requiredConnections: ['powerCable']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-networks.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add data.js test/test-networks.js
git commit -m "feat: add requiredConnections and rfFrequency to all components"
```

---

### Task 2: Create network discovery module (`networks.js`)

**Files:**
- Create: `networks.js`
- Modify: `test/test-networks.js`

This module discovers connected clusters of connection tiles and identifies which facility equipment and beamline components belong to each network.

- [ ] **Step 1: Write the test**

Append to `test/test-networks.js`:

```js
// --- Load networks module ---
const Networks = require('../networks.js');

section('Network discovery');

// Build a mock game state for testing
function mockGameState() {
  return {
    connections: new Map(),
    facilityEquipment: [],
    facilityGrid: {},
    beamline: [],  // ordered beamline nodes (from game.state.beamline)
  };
}

// Helper: place connection tile
function placeConn(state, col, row, connType) {
  const key = col + ',' + row;
  if (!state.connections.has(key)) state.connections.set(key, new Set());
  state.connections.get(key).add(connType);
}

// Helper: place facility equipment
function placeEquip(state, id, type, col, row) {
  state.facilityEquipment.push({ id, type, col, row });
  state.facilityGrid[col + ',' + row] = id;
}

// Test: empty state returns no networks
{
  const state = mockGameState();
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 0, 'empty state: no power networks');
  assert(result.rfWaveguide.length === 0, 'empty state: no RF networks');
}

// Test: single power cable tile = one network with one tile
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 1, 'single tile: one power network');
  assert(result.powerCable[0].tiles.length === 1, 'single tile: network has 1 tile');
}

// Test: two adjacent power cables = one network
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 1, 'adjacent tiles: one power network');
  assert(result.powerCable[0].tiles.length === 2, 'adjacent tiles: network has 2 tiles');
}

// Test: two separated power cables = two networks
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 20, 20, 'powerCable');
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 2, 'separated tiles: two power networks');
}

// Test: facility equipment adjacent to network tile is included
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeEquip(state, 1, 'substation', 5, 4); // adjacent to (5,5)
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 1, 'equip: one power network');
  assert(result.powerCable[0].equipment.length === 1, 'equip: substation in network');
  assert(result.powerCable[0].equipment[0].type === 'substation', 'equip: correct type');
}

// Test: beamline node adjacent to network tile is included
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  // Simulate a beamline node with tiles
  state.beamline = [{ id: 1, type: 'quadrupole', col: 5, row: 4, tiles: [{ col: 5, row: 4 }] }];
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 1, 'beamline: one power network');
  assert(result.powerCable[0].beamlineNodes.length === 1, 'beamline: quad in network');
}

// Test: different connection types form independent networks
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 5, 'coolingWater'); // same tile, different type
  placeConn(state, 5, 6, 'powerCable');
  // coolingWater only on (5,5), power on both
  const result = Networks.discoverAll(state);
  assert(result.powerCable.length === 1, 'multi-type: one power network');
  assert(result.powerCable[0].tiles.length === 2, 'multi-type: power has 2 tiles');
  assert(result.coolingWater.length === 1, 'multi-type: one cooling network');
  assert(result.coolingWater[0].tiles.length === 1, 'multi-type: cooling has 1 tile');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-networks.js`
Expected: FAIL — `require('../networks.js')` fails, module doesn't exist

- [ ] **Step 3: Implement `networks.js`**

Create `networks.js`:

```js
// === UTILITY NETWORK DISCOVERY ===
// Discovers connected clusters of connection tiles and identifies
// which facility equipment and beamline components belong to each network.

const CONN_TYPES = ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber'];

const Networks = {
  // Discover all networks for all connection types.
  // state: { connections: Map<"col,row", Set<connType>>, facilityEquipment: [], facilityGrid: {}, beamline: [] }
  // Returns: { powerCable: [network, ...], rfWaveguide: [...], ... }
  // Each network: { tiles: [{col, row}], equipment: [{id, type, col, row}], beamlineNodes: [{id, type, ...}] }
  discoverAll(state) {
    const result = {};
    for (const connType of CONN_TYPES) {
      result[connType] = this._discoverType(state, connType);
    }
    return result;
  },

  _discoverType(state, connType) {
    // Collect all tiles that have this connection type
    const allTiles = new Set();
    for (const [key, types] of state.connections) {
      if (types.has(connType)) allTiles.add(key);
    }

    const visited = new Set();
    const networks = [];

    for (const startKey of allTiles) {
      if (visited.has(startKey)) continue;

      // Flood-fill from this tile
      const tiles = [];
      const queue = [startKey];
      visited.add(startKey);

      while (queue.length > 0) {
        const key = queue.shift();
        const [c, r] = key.split(',').map(Number);
        tiles.push({ col: c, row: r });

        // Check cardinal neighbors
        const neighbors = [
          `${c},${r - 1}`, `${c},${r + 1}`,
          `${c + 1},${r}`, `${c - 1},${r}`,
        ];
        for (const nKey of neighbors) {
          if (!visited.has(nKey) && allTiles.has(nKey)) {
            visited.add(nKey);
            queue.push(nKey);
          }
        }
      }

      // Find equipment and beamline nodes adjacent to this network's tiles
      const tileSet = new Set(tiles.map(t => t.col + ',' + t.row));
      const equipment = this._findAdjacentEquipment(state, tileSet);
      const beamlineNodes = this._findAdjacentBeamline(state, tileSet);

      networks.push({ tiles, equipment, beamlineNodes });
    }

    return networks;
  },

  _findAdjacentEquipment(state, tileSet) {
    const found = [];
    const foundIds = new Set();
    for (const equip of state.facilityEquipment) {
      if (foundIds.has(equip.id)) continue;
      // Check if any of the equipment's tiles are adjacent to any network tile
      const equipTiles = equip.tiles || [{ col: equip.col, row: equip.row }];
      for (const et of equipTiles) {
        const adjacent = [
          `${et.col},${et.row - 1}`, `${et.col},${et.row + 1}`,
          `${et.col + 1},${et.row}`, `${et.col - 1},${et.row}`,
        ];
        // Also check if the equipment tile itself is in the network
        if (tileSet.has(`${et.col},${et.row}`)) {
          foundIds.add(equip.id);
          found.push(equip);
          break;
        }
        for (const adj of adjacent) {
          if (tileSet.has(adj)) {
            foundIds.add(equip.id);
            found.push(equip);
            break;
          }
        }
        if (foundIds.has(equip.id)) break;
      }
    }
    return found;
  },

  _findAdjacentBeamline(state, tileSet) {
    const found = [];
    const foundIds = new Set();
    for (const node of state.beamline) {
      if (foundIds.has(node.id)) continue;
      const nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
      for (const nt of nodeTiles) {
        const adjacent = [
          `${nt.col},${nt.row - 1}`, `${nt.col},${nt.row + 1}`,
          `${nt.col + 1},${nt.row}`, `${nt.col - 1},${nt.row}`,
        ];
        if (tileSet.has(`${nt.col},${nt.row}`)) {
          foundIds.add(node.id);
          found.push(node);
          break;
        }
        for (const adj of adjacent) {
          if (tileSet.has(adj)) {
            foundIds.add(node.id);
            found.push(node);
            break;
          }
        }
        if (foundIds.has(node.id)) break;
      }
    }
    return found;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Networks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-networks.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add networks.js test/test-networks.js
git commit -m "feat: add network discovery module with flood-fill clustering"
```

---

### Task 3: Add network validation — power, cooling, cryo

**Files:**
- Modify: `networks.js`
- Modify: `test/test-networks.js`

Add per-network capacity validation for power, cooling, and cryo systems.

- [ ] **Step 1: Write the tests**

Append to `test/test-networks.js`:

```js
section('Power network validation');

// Test: substation provides capacity, quad draws from it
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeConn(state, 5, 6, 'powerCable');
  placeConn(state, 5, 7, 'powerCable');
  placeEquip(state, 1, 'substation', 5, 4);
  state.beamline = [{ id: 10, type: 'quadrupole', col: 5, row: 8, tiles: [{ col: 5, row: 8 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validatePowerNetwork(nets.powerCable[0]);
  assert(stats.capacity === 1500, 'power: substation provides 1500 kW');
  assert(stats.draw === 8, 'power: quad draws 8 kW');
  assert(stats.ok === true, 'power: supply >= demand');
}

// Test: no substation = zero capacity
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  state.beamline = [{ id: 10, type: 'quadrupole', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validatePowerNetwork(nets.powerCable[0]);
  assert(stats.capacity === 0, 'power: no substation = 0 capacity');
  assert(stats.ok === false, 'power: fails without substation');
}

section('Cooling network validation');

{
  const state = mockGameState();
  placeConn(state, 5, 5, 'coolingWater');
  placeConn(state, 5, 6, 'coolingWater');
  placeEquip(state, 1, 'chiller', 5, 4);
  state.beamline = [{ id: 10, type: 'dipole', col: 5, row: 7, tiles: [{ col: 5, row: 7 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateCoolingNetwork(nets.coolingWater[0]);
  assert(stats.capacity === 200, 'cooling: chiller provides 200 kW');
  assert(stats.heatLoad > 0, 'cooling: dipole generates heat');
  assert(stats.ok === true, 'cooling: supply >= demand');
}

section('Cryo network validation');

{
  const state = mockGameState();
  placeConn(state, 5, 5, 'cryoTransfer');
  placeConn(state, 5, 6, 'cryoTransfer');
  placeConn(state, 5, 7, 'cryoTransfer');
  placeEquip(state, 1, 'heCompressor', 5, 4);
  placeEquip(state, 2, 'coldBox4K', 4, 5); // adjacent to tile (5,5)? No — adjacent to (5,5) at (4,5)
  // Actually (4,5) needs to be adjacent to a tile in the network. Tile (5,5) is adjacent to (4,5). Good.
  state.beamline = [{ id: 10, type: 'cryomodule', col: 5, row: 8, tiles: [{ col: 5, row: 8 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateCryoNetwork(nets.cryoTransfer[0]);
  assert(stats.capacity === 500, 'cryo: 4K cold box provides 500W');
  assert(stats.heatLoad === 18, 'cryo: one SRF cavity = 18W');
  assert(stats.hasCompressor === true, 'cryo: compressor present');
  assert(stats.ok === true, 'cryo: supply >= demand');
}

// Test: cold box without compressor = zero capacity
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'cryoTransfer');
  placeEquip(state, 1, 'coldBox4K', 5, 4);
  // No compressor
  state.beamline = [{ id: 10, type: 'cryomodule', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateCryoNetwork(nets.cryoTransfer[0]);
  assert(stats.capacity === 0, 'cryo: cold box without compressor = 0');
  assert(stats.hasCompressor === false, 'cryo: no compressor');
  assert(stats.ok === false, 'cryo: fails without compressor');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-networks.js`
Expected: FAIL — `Networks.validatePowerNetwork` is not a function

- [ ] **Step 3: Implement validation functions**

Add to `networks.js` inside the `Networks` object, before the closing `};`:

```js
  // --- Power network validation ---
  // Returns { capacity, draw, ok, substations: [...], consumers: [...] }
  validatePowerNetwork(network) {
    let capacity = 0;
    const substations = [];
    for (const eq of network.equipment) {
      if (eq.type === 'substation') {
        capacity += 1500;
        substations.push(eq);
      }
    }

    let draw = 0;
    const consumers = [];
    // Facility equipment draw
    for (const eq of network.equipment) {
      const comp = COMPONENTS[eq.type];
      if (comp && (comp.energyCost || 0) > 0) {
        draw += comp.energyCost;
        consumers.push({ id: eq.id, type: eq.type, draw: comp.energyCost, source: 'facility' });
      }
    }
    // Beamline component draw
    for (const node of network.beamlineNodes) {
      const comp = COMPONENTS[node.type];
      if (comp && (comp.energyCost || 0) > 0) {
        draw += comp.energyCost;
        consumers.push({ id: node.id, type: node.type, draw: comp.energyCost, source: 'beamline' });
      }
    }

    return { capacity, draw, ok: capacity >= draw && capacity > 0, substations, consumers };
  },

  // --- Cooling network validation ---
  // Returns { capacity, heatLoad, margin, ok, plants: [...], consumers: [...] }
  validateCoolingNetwork(network) {
    const capacityMap = { lcwSkid: 100, chiller: 200, coolingTower: 500 };
    let capacity = 0;
    const plants = [];
    for (const eq of network.equipment) {
      if (capacityMap[eq.type] !== undefined) {
        capacity += capacityMap[eq.type];
        plants.push(eq);
      }
    }

    let heatLoad = 0;
    const consumers = [];
    // Beamline components with coolingWater requirement
    for (const node of network.beamlineNodes) {
      const comp = COMPONENTS[node.type];
      if (comp && comp.requiredConnections && comp.requiredConnections.includes('coolingWater')) {
        const heat = (comp.energyCost || 0) * 0.6;
        heatLoad += heat;
        consumers.push({ id: node.id, type: node.type, heat, source: 'beamline' });
      }
    }
    // Facility equipment with coolingWater requirement
    for (const eq of network.equipment) {
      const comp = COMPONENTS[eq.type];
      if (comp && comp.requiredConnections && comp.requiredConnections.includes('coolingWater')) {
        const heat = (comp.energyCost || 0) * 0.6;
        heatLoad += heat;
        consumers.push({ id: eq.id, type: eq.type, heat, source: 'facility' });
      }
    }

    const margin = capacity > 0 ? (capacity - heatLoad) / capacity * 100 : 0;
    return { capacity, heatLoad, margin, ok: capacity >= heatLoad && capacity > 0, plants, consumers };
  },

  // --- Cryo network validation ---
  // Returns { capacity, heatLoad, opTemp, hasCompressor, margin, ok, ... }
  validateCryoNetwork(network) {
    const hasCompressor = network.equipment.some(eq => eq.type === 'heCompressor');

    let capacity = 0;
    let opTemp = 0;
    const coldBoxCapacity = { coldBox4K: 500, coldBox2K: 200 };
    const coldBoxTemp = { coldBox4K: 4.5, coldBox2K: 2.0 };
    for (const eq of network.equipment) {
      if (coldBoxCapacity[eq.type] !== undefined) {
        if (hasCompressor) capacity += coldBoxCapacity[eq.type];
        opTemp = opTemp === 0 ? coldBoxTemp[eq.type] : Math.min(opTemp, coldBoxTemp[eq.type]);
      }
      if (eq.type === 'cryocooler') {
        capacity += 50;
        if (opTemp === 0) opTemp = 40;
      }
    }

    let heatLoad = 0;
    const consumers = [];
    // SRF beamline components
    const srfTypes = new Set(['cryomodule', 'tesla9Cell', 'srf650Cavity', 'srfGun', 'scQuad', 'scDipole']);
    for (const node of network.beamlineNodes) {
      if (srfTypes.has(node.type)) {
        heatLoad += 18; // 3W static + 15W dynamic
        consumers.push({ id: node.id, type: node.type, heat: 18 });
      }
    }
    // Cryomodule housings
    for (const eq of network.equipment) {
      if (eq.type === 'cryomoduleHousing') {
        heatLoad += 3; // 3W static
        consumers.push({ id: eq.id, type: eq.type, heat: 3 });
      }
    }

    const margin = capacity > 0 ? (capacity - heatLoad) / capacity * 100 : 0;
    return {
      capacity, heatLoad, opTemp, hasCompressor, margin,
      ok: capacity >= heatLoad && (heatLoad === 0 || capacity > 0),
      consumers,
    };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-networks.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add networks.js test/test-networks.js
git commit -m "feat: add power, cooling, and cryo network validation"
```

---

### Task 4: Add RF network validation

**Files:**
- Modify: `networks.js`
- Modify: `test/test-networks.js`

- [ ] **Step 1: Write the tests**

Append to `test/test-networks.js`:

```js
section('RF network validation');

// Test: klystron + matched cavity = ok
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 1, 'klystron', 5, 4); // rfFrequency: 2856
  state.beamline = [{ id: 10, type: 'rfCavity', col: 5, row: 7, tiles: [{ col: 5, row: 7 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateRfNetwork(nets.rfWaveguide[0]);
  assert(stats.frequencyMatch === true, 'rf: frequency matches (2856 MHz)');
  assert(stats.forwardPower > 0, 'rf: forward power available');
  assert(stats.ok === true, 'rf: network ok');
}

// Test: frequency mismatch
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 1, 'klystron', 5, 4); // rfFrequency: 2856
  state.beamline = [{ id: 10, type: 'cryomodule', col: 5, row: 7, tiles: [{ col: 5, row: 7 }] }]; // rfFrequency: 1300
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateRfNetwork(nets.rfWaveguide[0]);
  assert(stats.mismatches.length > 0, 'rf: frequency mismatch detected');
}

// Test: broadband SSA matches any cavity
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 1, 'ssa', 5, 4); // rfFrequency: 'broadband'
  state.beamline = [{ id: 10, type: 'cryomodule', col: 5, row: 7, tiles: [{ col: 5, row: 7 }] }]; // rfFrequency: 1300
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateRfNetwork(nets.rfWaveguide[0]);
  assert(stats.frequencyMatch === true, 'rf: broadband SSA matches any frequency');
  assert(stats.ok === true, 'rf: broadband network ok');
}

// Test: pulsed klystron without modulator = zero power
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeEquip(state, 1, 'klystron', 5, 4);
  // No modulator
  state.beamline = [{ id: 10, type: 'rfCavity', col: 5, row: 7, tiles: [{ col: 5, row: 7 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateRfNetwork(nets.rfWaveguide[0]);
  assert(stats.missingModulator === true, 'rf: pulsed klystron needs modulator');
  assert(stats.forwardPower === 0, 'rf: no power without modulator');
}

// Test: klystron + modulator = power available
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'rfWaveguide');
  placeConn(state, 5, 6, 'rfWaveguide');
  placeConn(state, 5, 7, 'rfWaveguide');
  placeEquip(state, 1, 'klystron', 5, 4);
  placeEquip(state, 2, 'modulator', 4, 5);
  state.beamline = [{ id: 10, type: 'rfCavity', col: 5, row: 8, tiles: [{ col: 5, row: 8 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateRfNetwork(nets.rfWaveguide[0]);
  assert(stats.missingModulator === false, 'rf: modulator present');
  assert(stats.forwardPower > 0, 'rf: power with modulator');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-networks.js`
Expected: FAIL — `Networks.validateRfNetwork` is not a function

- [ ] **Step 3: Implement RF validation**

Add to `networks.js` inside the `Networks` object:

```js
  // --- RF network validation ---
  // Returns { forwardPower, reflectedPower, frequency, frequencyMatch, missingModulator, hasCirculator, mismatches, ok, sources, cavities }
  validateRfNetwork(network) {
    const pulsedKlystronTypes = new Set(['klystron', 'multiBeamKlystron']);
    const hasModulator = network.equipment.some(eq => eq.type === 'modulator');
    const hasCirculator = network.equipment.some(eq => eq.type === 'circulator');

    // Gather RF sources with their frequencies and power
    const sources = [];
    for (const eq of network.equipment) {
      const comp = COMPONENTS[eq.type];
      if (!comp || !comp.rfFrequency) continue;
      // Skip non-source RF equipment (modulator, circulator, coupler, llrf)
      if (['modulator', 'circulator', 'highPowerCoupler', 'llrfController'].includes(eq.type)) continue;

      const isPulsed = pulsedKlystronTypes.has(eq.type);
      const needsModulator = isPulsed;
      const hasRequiredMod = !needsModulator || hasModulator;
      const power = hasRequiredMod
        ? ((comp.params && comp.params.peakPower) || (comp.params && comp.params.cwPower) || 0)
        : 0;

      sources.push({
        id: eq.id, type: eq.type,
        frequency: comp.rfFrequency,
        power,
        needsModulator,
        hasModulator: hasRequiredMod,
      });
    }

    // Gather RF cavities from beamline
    const cavities = [];
    for (const node of network.beamlineNodes) {
      const comp = COMPONENTS[node.type];
      if (!comp || !comp.rfFrequency) continue;
      // Cavity power demand: use energyCost as proxy (kW)
      const demand = comp.energyCost || 0;
      cavities.push({
        id: node.id, type: node.type,
        frequency: comp.rfFrequency,
        demand,
      });
    }

    // Check frequency matching
    const mismatches = [];
    for (const cav of cavities) {
      const hasMatchingSource = sources.some(src =>
        src.frequency === 'broadband' || src.frequency === cav.frequency
      );
      if (!hasMatchingSource && sources.length > 0) {
        mismatches.push({ cavity: cav.type, cavFreq: cav.frequency });
      }
    }

    // Compute power budget per frequency
    // Group cavities by frequency, match with sources
    const freqs = new Set(cavities.map(c => c.frequency));
    let totalForward = 0;
    let totalDemand = 0;
    let powerOk = true;

    for (const freq of freqs) {
      const freqCavities = cavities.filter(c => c.frequency === freq);
      const freqDemand = freqCavities.reduce((s, c) => s + c.demand, 0);
      // Matched sources: same frequency OR broadband
      const freqSources = sources.filter(s => s.frequency === 'broadband' || s.frequency === freq);
      const freqPower = freqSources.reduce((s, src) => s + src.power, 0);
      totalForward += freqPower;
      totalDemand += freqDemand;
      if (freqPower < freqDemand) powerOk = false;
    }

    const reflectedPower = totalForward * 0.02;
    const missingModulator = sources.some(s => s.needsModulator && !s.hasModulator);
    const frequencyMatch = mismatches.length === 0;

    return {
      forwardPower: totalForward,
      reflectedPower,
      totalDemand,
      frequencyMatch,
      missingModulator,
      hasCirculator,
      mismatches,
      ok: frequencyMatch && powerOk && !missingModulator && (cavities.length === 0 || sources.length > 0),
      sources,
      cavities,
    };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-networks.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add networks.js test/test-networks.js
git commit -m "feat: add RF network validation with frequency matching and power budget"
```

---

### Task 5: Add vacuum conductance calculation

**Files:**
- Modify: `networks.js`
- Modify: `test/test-networks.js`

- [ ] **Step 1: Write the tests**

Append to `test/test-networks.js`:

```js
section('Vacuum conductance');

// Test: pump directly adjacent to beamline (1 tile path) = high effective speed
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'vacuumPipe');
  placeEquip(state, 1, 'turboPump', 5, 4); // 300 L/s, adjacent to pipe at (5,5)
  state.beamline = [{ id: 10, type: 'drift', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateVacuumNetwork(nets.vacuumPipe[0], state.beamline);
  // S_eff = 1/(1/300 + 1/50) = 42.86 L/s for one tile
  assert(stats.effectivePumpSpeed > 40, 'vacuum: short path = good effective speed');
  assert(stats.effectivePumpSpeed < 50, 'vacuum: capped by pipe conductance');
  assert(stats.pressureQuality !== 'None', 'vacuum: has pressure quality');
}

// Test: pump through long pipe = reduced effective speed
{
  const state = mockGameState();
  for (let r = 0; r < 10; r++) placeConn(state, 5, r, 'vacuumPipe');
  placeEquip(state, 1, 'turboPump', 4, 0); // adjacent to pipe start
  state.beamline = [{ id: 10, type: 'drift', col: 5, row: 10, tiles: [{ col: 5, row: 10 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateVacuumNetwork(nets.vacuumPipe[0], state.beamline);
  // 10 tiles in series: C_path = 50/10 = 5 L/s. S_eff = 1/(1/300 + 1/5) = 4.92 L/s
  assert(stats.effectivePumpSpeed < 10, 'vacuum: long path = low effective speed');
}

// Test: two pumps in parallel = additive
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'vacuumPipe');
  placeEquip(state, 1, 'turboPump', 5, 4);
  placeEquip(state, 2, 'turboPump', 4, 5);
  state.beamline = [{ id: 10, type: 'drift', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateVacuumNetwork(nets.vacuumPipe[0], state.beamline);
  // Two paths of 1 tile each: each delivers ~42.86, total ~85.7
  assert(stats.effectivePumpSpeed > 70, 'vacuum: two pumps = more effective speed');
}

// Test: no pumps = None quality
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'vacuumPipe');
  state.beamline = [{ id: 10, type: 'drift', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const nets = Networks.discoverAll(state);
  const stats = Networks.validateVacuumNetwork(nets.vacuumPipe[0], state.beamline);
  assert(stats.effectivePumpSpeed === 0, 'vacuum: no pumps = 0 speed');
  assert(stats.pressureQuality === 'None', 'vacuum: no pumps = None quality');
  assert(stats.ok === false, 'vacuum: fails without pumps');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-networks.js`
Expected: FAIL — `Networks.validateVacuumNetwork` is not a function

- [ ] **Step 3: Implement vacuum validation**

Add to `networks.js`:

```js
  // Pipe conductance per tile (L/s)
  PIPE_CONDUCTANCE: 50,

  // Pump speeds by type (L/s)
  PUMP_SPEEDS: {
    roughingPump: 10,
    turboPump: 300,
    ionPump: 100,
    negPump: 200,
    tiSubPump: 500,
  },

  // Outgassing rate (mbar*L/s per liter of volume)
  OUTGASSING_RATE: 1e-9,

  // --- Vacuum network validation ---
  // network: a vacuumPipe network from discoverAll
  // allBeamline: full beamline array (for volume calculation)
  // Returns { effectivePumpSpeed, avgPressure, pressureQuality, ok, pumps }
  validateVacuumNetwork(network, allBeamline) {
    const tileSet = new Set(network.tiles.map(t => t.col + ',' + t.row));

    // Find pumps in this network
    const pumps = [];
    for (const eq of network.equipment) {
      if (this.PUMP_SPEEDS[eq.type] !== undefined) {
        pumps.push({ id: eq.id, type: eq.type, speed: this.PUMP_SPEEDS[eq.type], col: eq.col, row: eq.row });
      }
    }

    if (pumps.length === 0) {
      return { effectivePumpSpeed: 0, avgPressure: Infinity, pressureQuality: 'None', ok: false, pumps: [] };
    }

    // Find beamline connection points (beamline tiles adjacent to vacuum pipe tiles)
    const beamlineConnPoints = new Set();
    for (const node of network.beamlineNodes) {
      const nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
      for (const nt of nodeTiles) {
        const adj = [
          `${nt.col},${nt.row - 1}`, `${nt.col},${nt.row + 1}`,
          `${nt.col + 1},${nt.row}`, `${nt.col - 1},${nt.row}`,
        ];
        for (const a of adj) {
          if (tileSet.has(a)) { beamlineConnPoints.add(a); break; }
        }
      }
    }

    if (beamlineConnPoints.size === 0) {
      return { effectivePumpSpeed: 0, avgPressure: Infinity, pressureQuality: 'None', ok: false, pumps };
    }

    // For each pump, find shortest path through vacuum pipe to any beamline connection point
    // Then compute effective pumping speed through that path's conductance
    let totalEffectiveSpeed = 0;

    for (const pump of pumps) {
      // BFS from pump's adjacent tiles to beamline connection points
      const pumpAdj = [
        `${pump.col},${pump.row - 1}`, `${pump.col},${pump.row + 1}`,
        `${pump.col + 1},${pump.row}`, `${pump.col - 1},${pump.row}`,
      ].filter(k => tileSet.has(k));

      let shortestPath = Infinity;
      for (const startKey of pumpAdj) {
        const dist = this._bfsDistance(startKey, beamlineConnPoints, tileSet);
        if (dist < shortestPath) shortestPath = dist;
      }

      if (shortestPath === Infinity) continue;

      // Path length = number of tiles traversed (including start)
      const pathLength = shortestPath;
      // Series conductance through pathLength tiles
      const pathConductance = this.PIPE_CONDUCTANCE / Math.max(pathLength, 1);
      // Effective pump speed: 1/S_eff = 1/S_pump + 1/C_path
      const sEff = 1 / (1 / pump.speed + 1 / pathConductance);
      totalEffectiveSpeed += sEff;
    }

    // Compute pressure from beamline volume and outgassing
    const totalVolume = allBeamline.reduce((sum, node) => {
      const comp = COMPONENTS[node.type];
      return sum + (comp ? (comp.interiorVolume || 0) : 0);
    }, 0);

    const gasLoad = Math.max(totalVolume, 1) * this.OUTGASSING_RATE;
    const avgPressure = totalEffectiveSpeed > 0 ? gasLoad / totalEffectiveSpeed : Infinity;

    let pressureQuality;
    if (totalEffectiveSpeed === 0) pressureQuality = 'None';
    else if (avgPressure < 1e-9) pressureQuality = 'Excellent';
    else if (avgPressure < 1e-7) pressureQuality = 'Good';
    else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
    else pressureQuality = 'Poor';

    const ok = pressureQuality !== 'Poor' && pressureQuality !== 'None';

    return { effectivePumpSpeed: totalEffectiveSpeed, avgPressure, pressureQuality, ok, pumps };
  },

  // BFS shortest distance from startKey to any key in targetSet, through tileSet
  _bfsDistance(startKey, targetSet, tileSet) {
    if (targetSet.has(startKey)) return 1;
    const visited = new Set([startKey]);
    const queue = [{ key: startKey, dist: 1 }];

    while (queue.length > 0) {
      const { key, dist } = queue.shift();
      const [c, r] = key.split(',').map(Number);
      const neighbors = [
        `${c},${r - 1}`, `${c},${r + 1}`,
        `${c + 1},${r}`, `${c - 1},${r}`,
      ];
      for (const nKey of neighbors) {
        if (visited.has(nKey)) continue;
        visited.add(nKey);
        if (targetSet.has(nKey)) return dist + 1;
        if (tileSet.has(nKey)) {
          queue.push({ key: nKey, dist: dist + 1 });
        }
      }
    }
    return Infinity;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-networks.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add networks.js test/test-networks.js
git commit -m "feat: add vacuum conductance calculation with BFS shortest path"
```

---

### Task 6: Add full validation engine

**Files:**
- Modify: `networks.js`
- Modify: `test/test-networks.js`

The validation engine checks all systems and produces a blockers list.

- [ ] **Step 1: Write the tests**

Append to `test/test-networks.js`:

```js
section('Full validation engine');

// Test: minimal valid setup — source + substation + power cable + PPS + shielding
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeEquip(state, 1, 'substation', 5, 4);
  placeEquip(state, 2, 'ppsInterlock', 10, 10);
  placeEquip(state, 3, 'shielding', 12, 12);
  state.beamline = [{ id: 10, type: 'source', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const result = Networks.validate(state);
  assert(result.blockers.length === 0, 'valid setup: no blockers');
  assert(result.canRun === true, 'valid setup: can run beam');
}

// Test: missing PPS = blocker
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeEquip(state, 1, 'substation', 5, 4);
  placeEquip(state, 3, 'shielding', 12, 12);
  state.beamline = [{ id: 10, type: 'source', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  const result = Networks.validate(state);
  assert(result.blockers.some(b => b.type === 'global' && b.reason.includes('PPS')), 'missing PPS: blocker');
  assert(result.canRun === false, 'missing PPS: cannot run');
}

// Test: component missing required connection = blocker
{
  const state = mockGameState();
  placeEquip(state, 1, 'ppsInterlock', 10, 10);
  placeEquip(state, 2, 'shielding', 12, 12);
  // Quadrupole needs powerCable + coolingWater, we provide neither
  state.beamline = [
    { id: 10, type: 'source', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] },
    { id: 11, type: 'quadrupole', col: 5, row: 7, tiles: [{ col: 5, row: 7 }] },
  ];
  const result = Networks.validate(state);
  assert(result.blockers.some(b => b.nodeId === 11 && b.missing === 'powerCable'), 'quad missing power: blocker');
  assert(result.blockers.some(b => b.nodeId === 11 && b.missing === 'coolingWater'), 'quad missing cooling: blocker');
}

// Test: insufficient shielding = blocker
{
  const state = mockGameState();
  placeConn(state, 5, 5, 'powerCable');
  placeEquip(state, 1, 'substation', 5, 4);
  placeEquip(state, 2, 'ppsInterlock', 10, 10);
  // No shielding, but beamline has energyCost
  state.beamline = [{ id: 10, type: 'source', col: 5, row: 6, tiles: [{ col: 5, row: 6 }] }];
  // Source energyCost=5, needs ceil(5/50)=1 shielding
  const result = Networks.validate(state);
  assert(result.blockers.some(b => b.type === 'global' && b.reason.includes('shielding')), 'no shielding: blocker');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-networks.js`
Expected: FAIL — `Networks.validate` is not a function

- [ ] **Step 3: Implement validation engine**

Add to `networks.js`:

```js
  // --- Full validation ---
  // state: full game state (connections, facilityEquipment, facilityGrid, beamline)
  // Returns { canRun, blockers: [{ type, nodeId?, missing?, reason }], networks }
  validate(state) {
    const blockers = [];
    const allNetworks = this.discoverAll(state);

    // --- Per-component connection checks ---
    // Build lookup: for each connection type, which beamline node IDs are in some network?
    const connectedNodes = {};
    for (const connType of ['powerCable', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber']) {
      connectedNodes[connType] = new Set();
      for (const net of allNetworks[connType]) {
        for (const node of net.beamlineNodes) {
          connectedNodes[connType].add(node.id);
        }
      }
    }

    for (const node of state.beamline) {
      const comp = COMPONENTS[node.type];
      if (!comp || !comp.requiredConnections) continue;
      for (const req of comp.requiredConnections) {
        if (req === 'vacuumPipe') continue; // vacuum is global, not per-component
        if (!connectedNodes[req] || !connectedNodes[req].has(node.id)) {
          blockers.push({
            type: 'connection',
            nodeId: node.id,
            nodeType: node.type,
            missing: req,
            reason: `${comp.name || node.type} missing ${CONNECTION_TYPES[req]?.name || req} connection`,
          });
        }
      }
    }

    // --- Per-network capacity checks ---

    // Power
    for (const net of allNetworks.powerCable) {
      const stats = this.validatePowerNetwork(net);
      if (!stats.ok && stats.draw > 0) {
        blockers.push({
          type: 'power',
          reason: `Power network overloaded: ${stats.draw} kW draw, ${stats.capacity} kW capacity`,
          networkStats: stats,
        });
      }
    }

    // Cooling
    for (const net of allNetworks.coolingWater) {
      const stats = this.validateCoolingNetwork(net);
      if (!stats.ok && stats.heatLoad > 0) {
        blockers.push({
          type: 'cooling',
          reason: `Cooling network overloaded: ${stats.heatLoad.toFixed(1)} kW heat, ${stats.capacity} kW capacity`,
          networkStats: stats,
        });
      }
    }

    // Cryo
    for (const net of allNetworks.cryoTransfer) {
      const stats = this.validateCryoNetwork(net);
      if (!stats.ok && stats.heatLoad > 0) {
        const reason = !stats.hasCompressor
          ? 'Cryo network missing He compressor'
          : `Cryo network overloaded: ${stats.heatLoad} W heat, ${stats.capacity} W capacity`;
        blockers.push({ type: 'cryo', reason, networkStats: stats });
      }
    }

    // RF
    for (const net of allNetworks.rfWaveguide) {
      const stats = this.validateRfNetwork(net);
      if (!stats.ok && stats.cavities.length > 0) {
        let reason = 'RF network issue: ';
        if (stats.missingModulator) reason += 'pulsed klystron needs modulator; ';
        if (!stats.frequencyMatch) reason += `frequency mismatch (${stats.mismatches.map(m => m.cavity + '@' + m.cavFreq + 'MHz').join(', ')}); `;
        if (stats.forwardPower < stats.totalDemand) reason += `insufficient power (${stats.forwardPower} kW avail, ${stats.totalDemand} kW needed)`;
        blockers.push({ type: 'rf', reason: reason.trim(), networkStats: stats });
      }
    }

    // Vacuum (global across all vacuum networks)
    if (state.beamline.length > 0) {
      let totalEffective = 0;
      for (const net of allNetworks.vacuumPipe) {
        const stats = this.validateVacuumNetwork(net, state.beamline);
        totalEffective += stats.effectivePumpSpeed;
      }
      if (allNetworks.vacuumPipe.length === 0 || totalEffective === 0) {
        // Check if any beamline component actually needs vacuum (non-empty beamline)
        const hasActiveComponents = state.beamline.some(n => {
          const c = COMPONENTS[n.type];
          return c && !['photonPort'].includes(n.type);
        });
        if (hasActiveComponents) {
          blockers.push({ type: 'vacuum', reason: 'No vacuum system connected to beamline' });
        }
      } else {
        // Compute global pressure
        const totalVolume = state.beamline.reduce((sum, n) => {
          const c = COMPONENTS[n.type];
          return sum + (c ? (c.interiorVolume || 0) : 0);
        }, 0);
        const gasLoad = Math.max(totalVolume, 1) * this.OUTGASSING_RATE;
        const avgPressure = gasLoad / totalEffective;
        let quality;
        if (avgPressure < 1e-9) quality = 'Excellent';
        else if (avgPressure < 1e-7) quality = 'Good';
        else if (avgPressure < 1e-4) quality = 'Marginal';
        else quality = 'Poor';
        if (quality === 'Poor') {
          blockers.push({
            type: 'vacuum',
            reason: `Vacuum quality Poor (${avgPressure.toExponential(1)} mbar) — add more pumps or shorter pipe runs`,
          });
        }
      }
    }

    // --- Global checks ---

    // PPS interlock
    const hasPPS = state.facilityEquipment.some(eq => eq.type === 'ppsInterlock');
    if (!hasPPS && state.beamline.length > 0) {
      blockers.push({ type: 'global', reason: 'PPS interlock required to run beam' });
    }

    // Shielding
    const shieldingCount = state.facilityEquipment.filter(eq => eq.type === 'shielding').length;
    const totalEnergyCost = state.beamline.reduce((sum, n) => {
      const c = COMPONENTS[n.type];
      return sum + (c ? (c.energyCost || 0) : 0);
    }, 0);
    const shieldingRequired = Math.max(1, Math.ceil(totalEnergyCost / 50));
    if (shieldingCount < shieldingRequired && state.beamline.length > 0) {
      blockers.push({
        type: 'global',
        reason: `Insufficient shielding: ${shieldingCount}/${shieldingRequired} required`,
      });
    }

    return { canRun: blockers.length === 0, blockers, networks: allNetworks };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-networks.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add networks.js test/test-networks.js
git commit -m "feat: add full validation engine with blockers list"
```

---

### Task 7: Integrate validation into game engine, remove energy resource

**Files:**
- Modify: `game.js`
- Modify: `index.html` (add `<script src="networks.js">`)

This task wires the validation engine into the game loop: beam toggle checks blockers, infrastructure changes trigger re-validation, and the `energy` resource is replaced with kW power.

- [ ] **Step 1: Add `networks.js` script tag to `index.html`**

Find the script tag for `game.js` in `index.html` and add `networks.js` before it:

```html
<script src="networks.js"></script>
```

- [ ] **Step 2: Add validation state to game constructor**

In `game.js` constructor (`game.js:6`), add after `systemStats: null`:

```js
      infraBlockers: [],          // blockers from Networks.validate()
      infraCanRun: true,          // true if no blockers
```

- [ ] **Step 3: Add `validateInfrastructure()` method**

Add after `computeSystemStats()` method in `game.js`:

```js
  // === INFRASTRUCTURE VALIDATION ===

  validateInfrastructure() {
    if (typeof Networks === 'undefined') return; // not loaded yet

    const validationState = {
      connections: this.state.connections,
      facilityEquipment: this.state.facilityEquipment,
      facilityGrid: this.state.facilityGrid,
      beamline: this.state.beamline,
    };

    const result = Networks.validate(validationState);
    this.state.infraBlockers = result.blockers;
    this.state.infraCanRun = result.canRun;
    this.state.networkData = result.networks;

    // If beam is running and we now have blockers, shut it off
    if (this.state.beamOn && !result.canRun) {
      this.state.beamOn = false;
      this.state.continuousBeamTicks = 0;
      // Log the first blocker as reason
      const reason = result.blockers[0]?.reason || 'Infrastructure failure';
      this.log(`Beam TRIPPED: ${reason}`, 'bad');
      this.emit('beamToggled');
    }

    this.emit('infrastructureValidated');
  }
```

- [ ] **Step 4: Replace `toggleBeam()` to check infrastructure**

Replace the `toggleBeam()` method (`game.js:777-789`) with:

```js
  toggleBeam() {
    if (this.state.beamOn) {
      this.state.beamOn = false;
      this.state.continuousBeamTicks = 0;
      this.log('Beam OFF', 'info');
    } else {
      if (!this.beamline.nodes.some(n => COMPONENTS[n.type]?.isSource)) {
        this.log('Need a Source!', 'bad'); return;
      }
      // Run infrastructure validation
      this.validateInfrastructure();
      if (!this.state.infraCanRun) {
        const count = this.state.infraBlockers.length;
        this.log(`Cannot start beam: ${count} infrastructure issue${count > 1 ? 's' : ''}`, 'bad');
        for (const b of this.state.infraBlockers.slice(0, 3)) {
          this.log(`  - ${b.reason}`, 'bad');
        }
        if (count > 3) this.log(`  ... and ${count - 3} more`, 'bad');
        return;
      }
      this.state.beamOn = true;
      this.log('Beam ON!', 'good');
    }
    this.emit('beamToggled');
  }
```

- [ ] **Step 5: Remove the `energy` resource from the tick loop**

In `game.js` `tick()` method:

Replace the energy recharge block (`game.js:866-872`):
```js
    // Energy recharge (power capacity from substations)
    const substations = (this.state.facilityEquipment || []).filter(e => e.type === 'substation');
    this.state.maxElectricalPower = 500 + substations.length * 1500; // base 500 + 1500 per substation
    this.state.resources.energy = Math.min(
      this.state.resources.energy + 3,
      200 + this.state.resources.reputation * 20
    );
```

With:
```js
    // Power capacity from substations (computed by validateInfrastructure, not energy resource)
```

Replace the energy check in the beam-on block (`game.js:874-876`):
```js
      if (this.state.resources.energy >= this.state.totalEnergyCost) {
        this.state.resources.energy -= this.state.totalEnergyCost;
```

With:
```js
      if (this.state.infraCanRun) {
```

Remove the energy-exhaustion beam shutdown (`game.js:924-929`):
```js
      } else {
        this.state.beamOn = false;
        this.state.continuousBeamTicks = 0;
        this.log('Beam shut down: no energy!', 'bad');
        this.emit('beamToggled');
      }
```

Replace with:
```js
      }
```

- [ ] **Step 6: Hook validation into infrastructure change events**

Add `validateInfrastructure()` calls to:

In `placeInfraTile()` — after `this.emit('infrastructureChanged')` at the end:
```js
    this.validateInfrastructure();
```

In `placeInfraRect()` — after `this.emit('infrastructureChanged')`:
```js
    this.validateInfrastructure();
```

In `removeInfraTile()` — after `this.emit('infrastructureChanged')`:
```js
    this.validateInfrastructure();
```

In `placeConnection()` — after `this.emit('connectionsChanged')`:
```js
    this.validateInfrastructure();
```

In `removeConnection()` — after `this.emit('connectionsChanged')`:
```js
    this.validateInfrastructure();
```

After `placeFacilityEquipment()` and `removeFacilityEquipment()` — find where these methods emit events and add:
```js
    this.validateInfrastructure();
```

In `recalcBeamline()` — at the end:
```js
    this.validateInfrastructure();
```

- [ ] **Step 7: Remove energy from initial state**

In the constructor (`game.js:7`), change:
```js
      resources: { funding: 100000, energy: 100, reputation: 0, data: 0 },
```
To:
```js
      resources: { funding: 100000, reputation: 0, data: 0 },
```

Remove `electricalPower` and `maxElectricalPower` from state (`game.js:25-26`).

- [ ] **Step 8: Test manually in browser**

Open the game in a browser. Verify:
1. Beam cannot start without a PPS interlock and shielding
2. Placing a source + substation + power cable + PPS + shielding allows beam to start
3. Removing the substation while beam is running triggers shutdown
4. The game log shows specific blocker reasons

- [ ] **Step 9: Commit**

```bash
git add game.js index.html networks.js
git commit -m "feat: integrate infrastructure validation, remove energy resource"
```

---

### Task 8: Wire MPS wear penalty and diagnostics data gating

**Files:**
- Modify: `game.js`

- [ ] **Step 1: MPS wear penalty**

In `_applyWear()` (`game.js:1250`), after computing `baseWear`:

```js
      const baseWear = 0.01 + (t.energyCost || 0) * 0.002;
```

Add MPS check:
```js
      // MPS absence doubles wear rate
      const hasMPS = (this.state.facilityEquipment || []).some(eq => eq.type === 'mps');
      const wearMult = hasMPS ? 1 : 2;
      this.state.componentHealth[node.id] = Math.max(0, this.state.componentHealth[node.id] - baseWear * wearMult);
```

And remove the original line:
```js
      this.state.componentHealth[node.id] = Math.max(0, this.state.componentHealth[node.id] - baseWear);
```

- [ ] **Step 2: Diagnostics data gating**

In the tick loop's data calculation section (`game.js:880-886`), the data from detectors should be gated by data/fiber connection. Replace:

```js
        if (this.state.dataRate > 0) {
          const sciMult = 1 + this.state.staff.scientists * 0.1; // scientists boost data
          const dataGain = this.state.dataRate * sciMult;
          this.state.resources.data += dataGain;
          this.state.totalDataCollected += dataGain;
        }
```

With:

```js
        if (this.state.dataRate > 0) {
          // Only count data from diagnostics that have data/fiber connections
          let connectedDataRate = this.state.dataRate;
          if (typeof Networks !== 'undefined' && this.state.networkData) {
            const dataConnected = new Set();
            for (const net of (this.state.networkData.dataFiber || [])) {
              // Only count if network has a Rack/IOC
              const hasIoc = net.equipment.some(eq => eq.type === 'rackIoc');
              if (hasIoc) {
                for (const node of net.beamlineNodes) dataConnected.add(node.id);
              }
            }
            // Compute fraction of diagnostic data rate that's connected
            let totalDiagRate = 0, connDiagRate = 0;
            for (const node of this.state.beamline) {
              const comp = COMPONENTS[node.type];
              if (comp && (comp.stats?.dataRate || 0) > 0) {
                totalDiagRate += comp.stats.dataRate;
                if (dataConnected.has(node.id)) connDiagRate += comp.stats.dataRate;
              }
            }
            if (totalDiagRate > 0) {
              connectedDataRate = this.state.dataRate * (connDiagRate / totalDiagRate);
            }
          }
          const sciMult = 1 + this.state.staff.scientists * 0.1;
          const dataGain = connectedDataRate * sciMult;
          this.state.resources.data += dataGain;
          this.state.totalDataCollected += dataGain;
        }
```

- [ ] **Step 3: Test manually**

1. Place a BPM without data/fiber — verify it doesn't contribute data
2. Connect BPM via data/fiber to Rack/IOC — verify data now flows
3. Run without MPS — verify components degrade faster

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: gate diagnostic data by data/fiber connections, MPS wear penalty"
```

---

### Task 9: Update `computeSystemStats` to use network data

**Files:**
- Modify: `game.js`

The existing `computeSystemStats()` computes stats by counting equipment globally. Now it should use the per-network validation data from `Networks.validate()`.

- [ ] **Step 1: Replace `computeSystemStats()` to use network data**

Replace the entire `computeSystemStats()` method (`game.js:1003-1247`) with:

```js
  computeSystemStats() {
    if (typeof Networks === 'undefined' || !this.state.networkData) {
      // Fallback: keep old behavior if networks not loaded
      this.state.systemStats = null;
      return;
    }

    const nets = this.state.networkData;

    // === POWER ===
    const powerNetworks = (nets.powerCable || []).map(net => this.constructor._validatePower
      ? Networks.validatePowerNetwork(net) : Networks.validatePowerNetwork(net));
    const power = {
      networks: powerNetworks,
      totalCapacity: powerNetworks.reduce((s, n) => s + n.capacity, 0),
      totalDraw: powerNetworks.reduce((s, n) => s + n.draw, 0),
      networkCount: powerNetworks.length,
    };
    power.utilization = power.totalCapacity > 0 ? (power.totalDraw / power.totalCapacity * 100) : 0;

    // === VACUUM ===
    const vacuumNetworks = (nets.vacuumPipe || []).map(net =>
      Networks.validateVacuumNetwork(net, this.state.beamline));
    const totalEffective = vacuumNetworks.reduce((s, n) => s + n.effectivePumpSpeed, 0);
    const totalVolume = this.state.beamline.reduce((sum, n) => {
      const c = COMPONENTS[n.type];
      return sum + (c ? (c.interiorVolume || 0) : 0);
    }, 0);
    const gasLoad = Math.max(totalVolume, 1) * Networks.OUTGASSING_RATE;
    const avgPressure = totalEffective > 0 ? gasLoad / totalEffective : Infinity;
    let pressureQuality = 'None';
    if (totalEffective > 0) {
      if (avgPressure < 1e-9) pressureQuality = 'Excellent';
      else if (avgPressure < 1e-7) pressureQuality = 'Good';
      else if (avgPressure < 1e-4) pressureQuality = 'Marginal';
      else pressureQuality = 'Poor';
    }
    const vacuum = {
      effectivePumpSpeed: totalEffective,
      avgPressure,
      pressureQuality,
      beamlineVolume: totalVolume,
      networkCount: vacuumNetworks.length,
    };

    // === RF POWER ===
    const rfNetworks = (nets.rfWaveguide || []).map(net => Networks.validateRfNetwork(net));
    const rfPower = {
      networks: rfNetworks,
      totalForwardPower: rfNetworks.reduce((s, n) => s + n.forwardPower, 0),
      totalReflectedPower: rfNetworks.reduce((s, n) => s + n.reflectedPower, 0),
      networkCount: rfNetworks.length,
      hasFrequencyMismatch: rfNetworks.some(n => !n.frequencyMatch),
      missingModulators: rfNetworks.some(n => n.missingModulator),
    };

    // === COOLING ===
    const coolingNetworks = (nets.coolingWater || []).map(net => Networks.validateCoolingNetwork(net));
    const cooling = {
      networks: coolingNetworks,
      totalCapacity: coolingNetworks.reduce((s, n) => s + n.capacity, 0),
      totalHeatLoad: coolingNetworks.reduce((s, n) => s + n.heatLoad, 0),
      networkCount: coolingNetworks.length,
    };
    cooling.margin = cooling.totalCapacity > 0
      ? (cooling.totalCapacity - cooling.totalHeatLoad) / cooling.totalCapacity * 100 : 0;

    // === CRYO ===
    const cryoNetworks = (nets.cryoTransfer || []).map(net => Networks.validateCryoNetwork(net));
    const cryo = {
      networks: cryoNetworks,
      totalCapacity: cryoNetworks.reduce((s, n) => s + n.capacity, 0),
      totalHeatLoad: cryoNetworks.reduce((s, n) => s + n.heatLoad, 0),
      networkCount: cryoNetworks.length,
      opTemp: cryoNetworks.reduce((t, n) => n.opTemp > 0 ? (t === 0 ? n.opTemp : Math.min(t, n.opTemp)) : t, 0),
    };
    cryo.margin = cryo.totalCapacity > 0
      ? (cryo.totalCapacity - cryo.totalHeatLoad) / cryo.totalCapacity * 100 : 0;

    // === DATA & CONTROLS ===
    const equip = this.state.facilityEquipment || [];
    const dataControls = {
      iocs: equip.filter(e => e.type === 'rackIoc').length,
      interlocks: equip.filter(e => e.type === 'ppsInterlock').length,
      mps: equip.filter(e => e.type === 'mps').length,
      timingSystems: equip.filter(e => e.type === 'timingSystem').length,
      monitors: equip.filter(e => e.type === 'areaMonitor').length,
    };

    // === OPS ===
    const ops = {
      shielding: equip.filter(e => e.type === 'shielding').length,
      targetHandling: equip.filter(e => e.type === 'targetHandling').length,
      beamDumps: equip.filter(e => e.type === 'beamDump').length,
      radWasteStorage: equip.filter(e => e.type === 'radWasteStorage').length,
    };

    this.state.systemStats = { power, vacuum, rfPower, cooling, cryo, dataControls, ops };
    this.state.avgPressure = avgPressure;
  }
```

- [ ] **Step 2: Update any UI code that reads old systemStats format**

Search renderer.js and any UI code for references to the old `systemStats` shape (e.g., `systemStats.vacuum.pumpCount`, `systemStats.power.substations`). Update them to use the new shape. The system stats panel in the renderer likely reads these — update field names to match the new structure.

This may require reading the renderer's stats panel rendering code and adjusting property names. The key changes:
- `power.capacity` → `power.totalCapacity`
- `power.totalDraw` stays the same
- `vacuum.avgPressure` stays the same
- `vacuum.pressureQuality` stays the same
- `rfPower.totalFwdPower` → `rfPower.totalForwardPower`
- `cooling.coolingCapacity` → `cooling.totalCapacity`
- `cooling.heatLoad` → `cooling.totalHeatLoad`
- `cryo.coolingCapacity` → `cryo.totalCapacity`
- `cryo.heatLoad` → `cryo.totalHeatLoad`

- [ ] **Step 3: Test in browser**

Open the system stats panel. Verify all stats display correctly and update when infrastructure changes.

- [ ] **Step 4: Commit**

```bash
git add game.js renderer.js
git commit -m "feat: compute system stats from network validation data"
```

---

### Task 10: Network inspection UI overlay

**Files:**
- Modify: `renderer.js`
- Modify: `input.js`

- [ ] **Step 1: Add network overlay layer to renderer**

In the `Renderer` constructor, add after other layer declarations:

```js
    this.networkOverlayLayer = null;
    this.networkPanel = null;
    this.activeNetworkType = null;
    this.activeNetworkIndex = null;
```

In the `init()` or layer setup method, create the overlay layer:

```js
    this.networkOverlayLayer = new PIXI.Container();
    this.networkOverlayLayer.sortableChildren = true;
    this.networkOverlayLayer.zIndex = 5000;
    this.world.addChild(this.networkOverlayLayer);
```

- [ ] **Step 2: Add `showNetworkOverlay(equipId)` method**

Add to `Renderer`:

```js
  showNetworkOverlay(equipId) {
    this.clearNetworkOverlay();

    const equip = this.game.state.facilityEquipment.find(e => e.id === equipId);
    if (!equip) return;

    const connType = this.game._getEquipmentConnectionType(equip.type);
    if (!connType || !this.game.state.networkData) return;

    // Find which network this equipment belongs to
    const networks = this.game.state.networkData[connType] || [];
    let targetNet = null;
    let netIndex = -1;
    for (let i = 0; i < networks.length; i++) {
      if (networks[i].equipment.some(e => e.id === equipId)) {
        targetNet = networks[i];
        netIndex = i;
        break;
      }
    }
    if (!targetNet) return;

    this.activeNetworkType = connType;
    this.activeNetworkIndex = netIndex;

    const connColor = CONNECTION_TYPES[connType]?.color || 0xffffff;

    // Highlight network tiles
    for (const tile of targetNet.tiles) {
      const pos = tileCenterIso(tile.col, tile.row);
      const highlight = new PIXI.Graphics();
      highlight.rect(pos.x - TILE_W / 2, pos.y - TILE_H / 2, TILE_W, TILE_H);
      highlight.fill({ color: connColor, alpha: 0.3 });
      this.networkOverlayLayer.addChild(highlight);
    }

    // Highlight connected beamline components
    for (const node of targetNet.beamlineNodes) {
      for (const tile of (node.tiles || [{ col: node.col, row: node.row }])) {
        const pos = tileCenterIso(tile.col, tile.row);
        const highlight = new PIXI.Graphics();
        highlight.rect(pos.x - TILE_W / 2, pos.y - TILE_H / 2, TILE_W, TILE_H);
        highlight.fill({ color: 0xffff00, alpha: 0.2 });
        this.networkOverlayLayer.addChild(highlight);
      }
    }

    // Highlight connected equipment
    for (const eq of targetNet.equipment) {
      const pos = tileCenterIso(eq.col, eq.row);
      const highlight = new PIXI.Graphics();
      highlight.rect(pos.x - TILE_W / 2, pos.y - TILE_H / 2, TILE_W, TILE_H);
      highlight.fill({ color: connColor, alpha: 0.4 });
      this.networkOverlayLayer.addChild(highlight);
    }

    // Show stats panel
    this._showNetworkPanel(connType, targetNet);
  }

  clearNetworkOverlay() {
    if (this.networkOverlayLayer) this.networkOverlayLayer.removeChildren();
    if (this.networkPanel) {
      this.networkPanel.remove();
      this.networkPanel = null;
    }
    this.activeNetworkType = null;
    this.activeNetworkIndex = null;
  }

  _showNetworkPanel(connType, network) {
    // Remove existing panel
    if (this.networkPanel) this.networkPanel.remove();

    const panel = document.createElement('div');
    panel.id = 'network-panel';
    panel.style.cssText = `
      position: fixed; top: 80px; right: 16px; width: 280px;
      background: rgba(0,0,0,0.85); color: #eee; padding: 12px;
      border-radius: 6px; font-family: monospace; font-size: 12px;
      z-index: 10000; border: 1px solid rgba(255,255,255,0.2);
    `;

    const title = CONNECTION_TYPES[connType]?.name || connType;
    let html = `<div style="font-size:14px;font-weight:bold;margin-bottom:8px">${title} Network</div>`;

    if (connType === 'powerCable') {
      const stats = Networks.validatePowerNetwork(network);
      html += `<div>Capacity: ${stats.capacity} kW</div>`;
      html += `<div>Draw: ${stats.draw} kW</div>`;
      html += `<div>Utilization: ${stats.capacity > 0 ? (stats.draw / stats.capacity * 100).toFixed(0) : 0}%</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'OVERLOADED'}</div>`;
      html += `<div style="margin-top:6px;font-size:11px">Substations: ${stats.substations.length}</div>`;
      html += `<div style="font-size:11px">Consumers: ${stats.consumers.length}</div>`;
    } else if (connType === 'rfWaveguide') {
      const stats = Networks.validateRfNetwork(network);
      const freq = stats.sources.length > 0 ? stats.sources[0].frequency : '—';
      html += `<div>Frequency: ${freq === 'broadband' ? 'Broadband' : freq + ' MHz'}</div>`;
      html += `<div>Forward Power: ${stats.forwardPower} kW</div>`;
      html += `<div>Reflected Power: ${stats.reflectedPower.toFixed(1)} kW</div>`;
      html += `<div>Sources: ${stats.sources.length} | Cavities: ${stats.cavities.length}</div>`;
      if (stats.missingModulator) html += `<div style="color:#f44">Missing modulator!</div>`;
      if (!stats.frequencyMatch) html += `<div style="color:#f44">Frequency mismatch!</div>`;
      html += `<div>Circulator: ${stats.hasCirculator ? 'Yes' : 'No'}</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'ISSUES'}</div>`;
    } else if (connType === 'coolingWater') {
      const stats = Networks.validateCoolingNetwork(network);
      html += `<div>Capacity: ${stats.capacity} kW</div>`;
      html += `<div>Heat Load: ${stats.heatLoad.toFixed(1)} kW</div>`;
      html += `<div>Margin: ${stats.margin.toFixed(0)}%</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'OVERLOADED'}</div>`;
    } else if (connType === 'cryoTransfer') {
      const stats = Networks.validateCryoNetwork(network);
      html += `<div>Capacity: ${stats.capacity} W</div>`;
      html += `<div>Heat Load: ${stats.heatLoad} W</div>`;
      html += `<div>Op Temp: ${stats.opTemp > 0 ? stats.opTemp + ' K' : 'N/A'}</div>`;
      html += `<div>Compressor: ${stats.hasCompressor ? 'Yes' : 'No'}</div>`;
      html += `<div>Margin: ${stats.margin.toFixed(0)}%</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'ISSUES'}</div>`;
    } else if (connType === 'vacuumPipe') {
      const stats = Networks.validateVacuumNetwork(network, this.game.state.beamline);
      html += `<div>Eff. Pump Speed: ${stats.effectivePumpSpeed.toFixed(1)} L/s</div>`;
      html += `<div>Pressure: ${stats.avgPressure.toExponential(1)} mbar</div>`;
      html += `<div>Quality: ${stats.pressureQuality}</div>`;
      html += `<div>Pumps: ${stats.pumps.length}</div>`;
      html += `<div style="color:${stats.ok ? '#4c4' : '#f44'}">Status: ${stats.ok ? 'OK' : 'POOR'}</div>`;
    } else if (connType === 'dataFiber') {
      const hasIoc = network.equipment.some(eq => eq.type === 'rackIoc');
      html += `<div>Rack/IOC: ${hasIoc ? 'Connected' : 'None'}</div>`;
      html += `<div>Diagnostics: ${network.beamlineNodes.length}</div>`;
      html += `<div style="color:${hasIoc ? '#4c4' : '#f44'}">Status: ${hasIoc ? 'OK' : 'NO IOC'}</div>`;
    }

    html += `<div style="margin-top:8px;font-size:10px;color:#888">Click elsewhere or Esc to close</div>`;
    panel.innerHTML = html;
    document.body.appendChild(panel);
    this.networkPanel = panel;
  }
```

- [ ] **Step 3: Add click handler for facility equipment**

In `input.js`, find where facility equipment clicks are handled (likely in the click/pointerdown handler). Add logic: when clicking a facility equipment piece, call `renderer.showNetworkOverlay(equipId)`:

```js
// When clicking on a facility equipment tile:
const equipId = game.state.facilityGrid[col + ',' + row];
if (equipId && !placingMode) {
  renderer.showNetworkOverlay(equipId);
  return;
}
```

Add Escape key handler to close the overlay:

```js
// In the existing keydown handler, add:
if (e.key === 'Escape' && renderer.activeNetworkType) {
  renderer.clearNetworkOverlay();
  return;
}
```

Add click-on-empty-ground to close:

```js
// In the click handler, when clicking empty ground:
if (renderer.activeNetworkType) {
  renderer.clearNetworkOverlay();
}
```

- [ ] **Step 4: Test in browser**

1. Place a substation and some power cables
2. Click the substation — verify overlay appears with power network highlighted
3. Place a klystron connected by waveguide to a cavity — click klystron, verify RF network overlay
4. Press Escape — verify overlay closes
5. Click empty ground — verify overlay closes

- [ ] **Step 5: Commit**

```bash
git add renderer.js input.js
git commit -m "feat: add network inspection overlay with per-network stats panel"
```

---

### Task 11: Update UI to show blocker count on beam button

**Files:**
- Modify: `renderer.js` or `index.html` (wherever the beam toggle button is rendered)

- [ ] **Step 1: Find the beam toggle button**

Search for the beam toggle button in the UI code. It's likely in `renderer.js` or rendered via HTML.

- [ ] **Step 2: Add blocker indicator**

When `game.state.infraCanRun === false`, show the blocker count on or near the beam button:

```js
// In the UI update that runs on tick or state change:
const beamBtn = document.getElementById('beam-toggle'); // or however it's accessed
if (beamBtn) {
  if (!game.state.infraCanRun && game.state.infraBlockers.length > 0) {
    beamBtn.title = game.state.infraBlockers.map(b => b.reason).join('\n');
    // Add visual indicator
    beamBtn.style.opacity = '0.5';
  } else {
    beamBtn.title = '';
    beamBtn.style.opacity = '1';
  }
}
```

- [ ] **Step 3: Test in browser**

Verify the beam button shows a visual indicator when there are blockers and the tooltip lists the reasons.

- [ ] **Step 4: Commit**

```bash
git add renderer.js index.html
git commit -m "feat: show infrastructure blocker indicator on beam toggle button"
```

---

### Task 12: Update save/load for removed energy resource

**Files:**
- Modify: `game.js`

- [ ] **Step 1: Handle loading old saves that have `energy` resource**

In `load()` (`game.js:1564`), after restoring state, remove the energy resource if present:

```js
      // Migrate: remove deprecated energy resource
      delete this.state.resources.energy;
      delete this.state.electricalPower;
      delete this.state.maxElectricalPower;
```

Also ensure `infraBlockers` and `infraCanRun` are initialized:
```js
      this.state.infraBlockers = this.state.infraBlockers || [];
      this.state.infraCanRun = this.state.infraCanRun !== undefined ? this.state.infraCanRun : true;
```

Bump save version from 4 to 5:
```js
    localStorage.setItem('beamlineTycoon', JSON.stringify({
      version: 5,
```

Update version check:
```js
      if (!data.version || data.version < 4) {
```
Leave this as-is (version 4 saves are still loadable, we just migrate them).

- [ ] **Step 2: Re-validate after load**

At the end of `load()`, after `this.recalcBeamline()`:

```js
      this.validateInfrastructure();
```

- [ ] **Step 3: Test save/load**

1. Save game with infrastructure
2. Reload — verify state restores correctly
3. Verify infrastructure validation runs on load

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: migrate save format for removed energy resource, validate on load"
```

---

### Task 13: Clean up — remove old `_getRequiredConnections` from renderer, old energy UI references

**Files:**
- Modify: `renderer.js`
- Modify: `index.html` (if energy display exists)

- [ ] **Step 1: Update renderer's `_getRequiredConnections` to use component data**

Replace the renderer's `_getRequiredConnections` method (`renderer.js:248-258`) with:

```js
  _getRequiredConnections(comp) {
    return comp.requiredConnections || [];
  }
```

This uses the explicit `requiredConnections` arrays added in Task 1 instead of inferring from category.

- [ ] **Step 2: Remove energy display from UI**

Search `index.html` and `renderer.js` for any display of `resources.energy` or "Energy" in the HUD. Remove or replace with power capacity display showing total kW draw vs capacity from system stats.

- [ ] **Step 3: Test in browser**

1. Verify `!` warnings still appear on components missing connections
2. Verify no energy bar/counter in the UI
3. Verify power stats display correctly

- [ ] **Step 4: Commit**

```bash
git add renderer.js index.html
git commit -m "refactor: use requiredConnections from data, remove energy UI"
```
