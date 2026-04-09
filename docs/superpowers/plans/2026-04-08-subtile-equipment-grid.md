# Sub-tile Equipment Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1:1 zone furnishing system with a 4x4 isometric sub-grid per tile, allowing multiple variably-sized equipment items per tile.

**Architecture:** Add `gridW`/`gridH`/`effects` to every ZONE_FURNISHINGS entry. Replace the flat `zoneFurnishingGrid["col,row"] = id` occupancy with a per-tile 4x4 subgrid array + furnishing list. Update placement logic in Game.js, rendering in infrastructure-renderer.js, sprite generation in sprites.js, input handling in InputHandler.js, HUD palette in hud.js, and the asset-gen pipeline in tools/asset-gen/server.cjs.

**Tech Stack:** Vanilla JS (ES modules), PIXI.js for rendering, Node.js for asset-gen server

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/data/infrastructure.js` | Modify | Add `gridW`, `gridH`, `effects`, `spriteKey` to all ZONE_FURNISHINGS entries |
| `src/renderer/grid.js` | Modify | Add `subGridToIso()` coordinate helper |
| `src/game/Game.js` | Modify | Replace `placeZoneFurnishing`/`removeZoneFurnishing` with sub-grid aware versions |
| `src/renderer/sprites.js` | Modify | Generate sub-tile-sized placeholder textures |
| `src/renderer/infrastructure-renderer.js` | Modify | Render furnishings at sub-grid positions, render sub-grid overlay |
| `src/input/InputHandler.js` | Modify | Sub-grid hover detection, rotation, placement preview |
| `src/renderer/hud.js` | Modify | Show grid size info in palette, remove zone-type filter restriction |
| `tools/asset-gen/server.cjs` | Modify | Parse `gridW`/`gridH` into catalog, compute sprite pixel dimensions |

---

### Task 1: Add sub-grid coordinate helper

**Files:**
- Modify: `src/renderer/grid.js`

- [ ] **Step 1: Add `subGridToIso` function**

Append to `src/renderer/grid.js`:

```js
/**
 * Convert sub-grid coordinates within a tile to isometric screen offset.
 * A tile's 4x4 sub-grid has cells of size TILE_W/4 x TILE_H/4.
 * Returns pixel offset from the tile's top vertex (gridToIso position).
 */
export function subGridToIso(subCol, subRow) {
  const subW = TILE_W / 4;
  const subH = TILE_H / 4;
  return {
    x: (subCol - subRow) * (subW / 2),
    y: (subCol + subRow) * (subH / 2),
  };
}

/**
 * Convert a screen offset (relative to tile top vertex) to sub-grid coordinates.
 * Returns fractional values — caller should Math.floor for cell index.
 */
export function isoToSubGrid(offsetX, offsetY) {
  const subW = TILE_W / 4;
  const subH = TILE_H / 4;
  return {
    subCol: (offsetX / (subW / 2) + offsetY / (subH / 2)) / 2,
    subRow: (offsetY / (subH / 2) - offsetX / (subW / 2)) / 2,
  };
}
```

- [ ] **Step 2: Verify it loads without errors**

Open the game in the browser and check the console for import errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/grid.js
git commit -m "feat: add sub-grid coordinate conversion helpers"
```

---

### Task 2: Add grid dimensions and effects to ZONE_FURNISHINGS

**Files:**
- Modify: `src/data/infrastructure.js`

- [ ] **Step 1: Add `gridW`, `gridH`, `effects`, and `spriteKey` to every ZONE_FURNISHINGS entry**

Update each entry in `ZONE_FURNISHINGS`. The `zoneType` field stays but its meaning changes to "preferred zone" (enforcement removed in Task 3). Below is the complete replacement for `ZONE_FURNISHINGS`:

```js
export const ZONE_FURNISHINGS = {
  // RF Lab furnishings
  rfWorkbench:      { id: 'rfWorkbench',      name: 'RF Workbench',       zoneType: 'rfLab',       cost: 50,   spriteColor: 0xbb9944, gridW: 2, gridH: 2, spriteKey: 'rfWorkbench',      effects: { zoneOutput: 0.03 } },
  oscilloscope:     { id: 'oscilloscope',      name: 'Oscilloscope',       zoneType: 'rfLab',       cost: 120,  spriteColor: 0x44aa44, gridW: 1, gridH: 1, spriteKey: 'oscilloscope',     effects: { zoneOutput: 0.05 } },
  signalGenerator:  { id: 'signalGenerator',   name: 'Signal Generator',   zoneType: 'rfLab',       cost: 200,  spriteColor: 0xcc6644, gridW: 2, gridH: 1, spriteKey: 'signalGenerator',  effects: { zoneOutput: 0.06 } },
  spectrumAnalyzer: { id: 'spectrumAnalyzer',  name: 'Spectrum Analyzer',  zoneType: 'rfLab',       cost: 350,  spriteColor: 0x4488cc, gridW: 2, gridH: 1, spriteKey: 'spectrumAnalyzer', effects: { zoneOutput: 0.08 } },
  networkAnalyzer:  { id: 'networkAnalyzer',   name: 'Network Analyzer',   zoneType: 'rfLab',       cost: 500,  spriteColor: 0x8844cc, gridW: 2, gridH: 2, spriteKey: 'networkAnalyzer',  effects: { zoneOutput: 0.10 } },

  // Cooling Lab furnishings
  coolantPump:      { id: 'coolantPump',       name: 'Coolant Pump',       zoneType: 'coolingLab',  cost: 80,   spriteColor: 0x33bbbb, gridW: 2, gridH: 2, spriteKey: 'coolantPump',      effects: { zoneOutput: 0.04 } },
  heatExchanger:    { id: 'heatExchanger',     name: 'Heat Exchanger',     zoneType: 'coolingLab',  cost: 150,  spriteColor: 0x4499aa, gridW: 2, gridH: 2, spriteKey: 'heatExchanger',    effects: { zoneOutput: 0.06 } },
  pipeRack:         { id: 'pipeRack',          name: 'Pipe Rack',          zoneType: 'coolingLab',  cost: 40,   spriteColor: 0x667788, gridW: 1, gridH: 2, spriteKey: 'pipeRack',         effects: { zoneOutput: 0.02 } },
  chillerUnit:      { id: 'chillerUnit',       name: 'Chiller Unit',       zoneType: 'coolingLab',  cost: 300,  spriteColor: 0x2288aa, gridW: 4, gridH: 4, spriteKey: 'chillerUnit',      effects: { zoneOutput: 0.12 } },
  flowMeter:        { id: 'flowMeter',         name: 'Flow Meter',         zoneType: 'coolingLab',  cost: 100,  spriteColor: 0x55cccc, gridW: 1, gridH: 1, spriteKey: 'flowMeter',        effects: { zoneOutput: 0.03 } },

  // Vacuum Lab furnishings
  testChamber:      { id: 'testChamber',       name: 'Test Chamber',       zoneType: 'vacuumLab',   cost: 200,  spriteColor: 0x8855bb, gridW: 4, gridH: 4, spriteKey: 'testChamber',      effects: { zoneOutput: 0.08 } },
  leakDetector:     { id: 'leakDetector',      name: 'Leak Detector',      zoneType: 'vacuumLab',   cost: 180,  spriteColor: 0x6644aa, gridW: 1, gridH: 2, spriteKey: 'leakDetector',     effects: { zoneOutput: 0.06 } },
  pumpCart:         { id: 'pumpCart',           name: 'Pump Cart',          zoneType: 'vacuumLab',   cost: 60,   spriteColor: 0x9966cc, gridW: 2, gridH: 1, spriteKey: 'pumpCart',         effects: { zoneOutput: 0.02 } },
  gasManifold:      { id: 'gasManifold',       name: 'Gas Manifold',       zoneType: 'vacuumLab',   cost: 120,  spriteColor: 0x7755aa, gridW: 2, gridH: 1, spriteKey: 'gasManifold',      effects: { zoneOutput: 0.04 } },
  rga:              { id: 'rga',               name: 'Residual Gas Analyzer', zoneType: 'vacuumLab', cost: 400,  spriteColor: 0xaa77dd, gridW: 2, gridH: 4, spriteKey: 'rga',              effects: { zoneOutput: 0.10 } },

  // Office Space furnishings
  desk:             { id: 'desk',              name: 'Desk',               zoneType: 'officeSpace', cost: 30,   spriteColor: 0x5577aa, gridW: 2, gridH: 2, spriteKey: 'desk',             effects: { morale: 1 } },
  filingCabinet:    { id: 'filingCabinet',     name: 'Filing Cabinet',     zoneType: 'officeSpace', cost: 20,   spriteColor: 0x667799, gridW: 1, gridH: 1, spriteKey: 'filingCabinet',    effects: {} },
  whiteboard:       { id: 'whiteboard',        name: 'Whiteboard',         zoneType: 'officeSpace', cost: 25,   spriteColor: 0xddddee, gridW: 2, gridH: 1, spriteKey: 'whiteboard',       effects: { research: 0.02 } },
  coffeeMachine:    { id: 'coffeeMachine',     name: 'Coffee Machine',     zoneType: 'officeSpace', cost: 15,   spriteColor: 0x664433, gridW: 1, gridH: 1, spriteKey: 'coffeeMachine',    effects: { morale: 2 } },

  // Control Room furnishings
  monitorBank:      { id: 'monitorBank',       name: 'Monitor Bank',       zoneType: 'controlRoom', cost: 150,  spriteColor: 0x44bb66, gridW: 2, gridH: 2, spriteKey: 'monitorBank',      effects: { zoneOutput: 0.06 } },
  serverRack:       { id: 'serverRack',        name: 'Server Rack',        zoneType: 'controlRoom', cost: 250,  spriteColor: 0x338855, gridW: 2, gridH: 4, spriteKey: 'serverRack',       effects: { zoneOutput: 0.08, research: 0.03 } },
  operatorConsole:  { id: 'operatorConsole',   name: 'Operator Console',   zoneType: 'controlRoom', cost: 200,  spriteColor: 0x55cc77, gridW: 2, gridH: 2, spriteKey: 'operatorConsole',  effects: { zoneOutput: 0.07 } },
  alarmPanel:       { id: 'alarmPanel',        name: 'Alarm Panel',        zoneType: 'controlRoom', cost: 100,  spriteColor: 0xcc5544, gridW: 1, gridH: 1, spriteKey: 'alarmPanel',       effects: { zoneOutput: 0.03 } },

  // Machine Shop furnishings
  lathe:            { id: 'lathe',             name: 'Lathe',              zoneType: 'machineShop', cost: 120,  spriteColor: 0x997755, gridW: 2, gridH: 2, spriteKey: 'lathe',            effects: { zoneOutput: 0.05 } },
  millingMachine:   { id: 'millingMachine',    name: 'Milling Machine',    zoneType: 'machineShop', cost: 180,  spriteColor: 0x887766, gridW: 2, gridH: 2, spriteKey: 'millingMachine',   effects: { zoneOutput: 0.06 } },
  drillPress:       { id: 'drillPress',        name: 'Drill Press',        zoneType: 'machineShop', cost: 80,   spriteColor: 0x776655, gridW: 1, gridH: 1, spriteKey: 'drillPress',       effects: { zoneOutput: 0.03 } },
  toolCabinet:      { id: 'toolCabinet',       name: 'Tool Cabinet',       zoneType: 'machineShop', cost: 40,   spriteColor: 0xaa8866, gridW: 2, gridH: 1, spriteKey: 'toolCabinet',      effects: { zoneOutput: 0.01 } },
  weldingStation:   { id: 'weldingStation',    name: 'Welding Station',    zoneType: 'machineShop', cost: 200,  spriteColor: 0xcc7744, gridW: 2, gridH: 2, spriteKey: 'weldingStation',   effects: { zoneOutput: 0.07 } },
  cncMill:          { id: 'cncMill',           name: 'CNC Mill',           zoneType: 'machineShop', cost: 350,  spriteColor: 0x998877, gridW: 4, gridH: 2, spriteKey: 'cncMill',          effects: { zoneOutput: 0.10 } },
  assemblyCrane:    { id: 'assemblyCrane',     name: 'Assembly Crane',     zoneType: 'machineShop', cost: 400,  spriteColor: 0xddaa44, gridW: 4, gridH: 2, spriteKey: 'assemblyCrane',    effects: { zoneOutput: 0.12 } },

  // Optics Lab furnishings
  opticalTable:     { id: 'opticalTable',      name: 'Optical Table',           zoneType: 'opticsLab', cost: 250,  spriteColor: 0x44aacc, gridW: 2, gridH: 2, spriteKey: 'opticalTable',     effects: { zoneOutput: 0.08 } },
  laserAlignment:   { id: 'laserAlignment',    name: 'Laser Alignment System',  zoneType: 'opticsLab', cost: 400,  spriteColor: 0xcc4444, gridW: 2, gridH: 2, spriteKey: 'laserAlignment',   effects: { zoneOutput: 0.10, beamPhysics: { emittanceReduction: 0.02 } } },
  mirrorMount:      { id: 'mirrorMount',       name: 'Mirror Mount Station',    zoneType: 'opticsLab', cost: 150,  spriteColor: 0xaaaacc, gridW: 1, gridH: 1, spriteKey: 'mirrorMount',      effects: { zoneOutput: 0.04 } },
  beamProfiler:     { id: 'beamProfiler',      name: 'Beam Profiler',           zoneType: 'opticsLab', cost: 300,  spriteColor: 0x44cc88, gridW: 2, gridH: 1, spriteKey: 'beamProfiler',     effects: { zoneOutput: 0.07, beamPhysics: { diagnosticAccuracy: 0.05 } } },
  interferometer:   { id: 'interferometer',     name: 'Interferometer',          zoneType: 'opticsLab', cost: 500,  spriteColor: 0x8844cc, gridW: 2, gridH: 2, spriteKey: 'interferometer',   effects: { zoneOutput: 0.12 } },

  // Diagnostics Lab furnishings
  scopeStation:     { id: 'scopeStation',      name: 'Scope Station',           zoneType: 'diagnosticsLab', cost: 100,  spriteColor: 0x44aa44, gridW: 1, gridH: 1, spriteKey: 'scopeStation',     effects: { zoneOutput: 0.03 } },
  wireScannerBench: { id: 'wireScannerBench',  name: 'Wire Scanner Bench',      zoneType: 'diagnosticsLab', cost: 200,  spriteColor: 0x888888, gridW: 2, gridH: 2, spriteKey: 'wireScannerBench', effects: { zoneOutput: 0.06 } },
  bpmTestFixture:   { id: 'bpmTestFixture',    name: 'BPM Test Fixture',        zoneType: 'diagnosticsLab', cost: 300,  spriteColor: 0xcccc44, gridW: 2, gridH: 1, spriteKey: 'bpmTestFixture',   effects: { zoneOutput: 0.08 } },
  daqRack:          { id: 'daqRack',           name: 'DAQ Rack',                zoneType: 'diagnosticsLab', cost: 250,  spriteColor: 0x44cc44, gridW: 2, gridH: 2, spriteKey: 'daqRack',          effects: { zoneOutput: 0.07, research: 0.02 } },
  serverCluster:    { id: 'serverCluster',     name: 'Server Cluster',          zoneType: 'diagnosticsLab', cost: 500,  spriteColor: 0x448844, gridW: 4, gridH: 2, spriteKey: 'serverCluster',    effects: { research: 0.08 } },

  // Cafeteria furnishings
  diningTable:      { id: 'diningTable',      name: 'Dining Table',       zoneType: 'cafeteria',   cost: 25,   spriteColor: 0xaa7744, gridW: 2, gridH: 2, spriteKey: 'diningTable',      effects: { morale: 2 } },
  servingCounter:   { id: 'servingCounter',    name: 'Serving Counter',    zoneType: 'cafeteria',   cost: 80,   spriteColor: 0x999999, gridW: 2, gridH: 2, spriteKey: 'servingCounter',   effects: { morale: 3 } },
  vendingMachine:   { id: 'vendingMachine',    name: 'Vending Machine',    zoneType: 'cafeteria',   cost: 40,   spriteColor: 0x4488aa, gridW: 2, gridH: 1, spriteKey: 'vendingMachine',   effects: { morale: 1 } },
  microwave:        { id: 'microwave',         name: 'Microwave Station',  zoneType: 'cafeteria',   cost: 20,   spriteColor: 0x666666, gridW: 1, gridH: 1, spriteKey: 'microwave',        effects: { morale: 1 } },
  waterCooler:      { id: 'waterCooler',       name: 'Water Cooler',       zoneType: 'cafeteria',   cost: 10,   spriteColor: 0x66aacc, gridW: 1, gridH: 1, spriteKey: 'waterCooler',      effects: { morale: 1 } },

  // Meeting Room furnishings
  conferenceTable:  { id: 'conferenceTable',   name: 'Conference Table',   zoneType: 'meetingRoom', cost: 60,   spriteColor: 0x775533, gridW: 2, gridH: 2, spriteKey: 'conferenceTable',  effects: { morale: 1, research: 0.02 } },
  projector:        { id: 'projector',          name: 'Projector',          zoneType: 'meetingRoom', cost: 120,  spriteColor: 0x444444, gridW: 2, gridH: 2, spriteKey: 'projector',        effects: { research: 0.04 } },
  phoneUnit:        { id: 'phoneUnit',          name: 'Conference Phone',   zoneType: 'meetingRoom', cost: 40,   spriteColor: 0x333333, gridW: 1, gridH: 1, spriteKey: 'phoneUnit',        effects: {} },
  whiteboardLarge:  { id: 'whiteboardLarge',    name: 'Large Whiteboard',   zoneType: 'meetingRoom', cost: 35,   spriteColor: 0xeeeeee, gridW: 2, gridH: 1, spriteKey: 'whiteboardLarge',  effects: { research: 0.03 } },

  // Maintenance furnishings
  toolChest:        { id: 'toolChest',         name: 'Tool Chest',         zoneType: 'maintenance', cost: 50,   spriteColor: 0xbb7744, gridW: 2, gridH: 2, spriteKey: 'toolChest',        effects: { zoneOutput: 0.03 } },
  partsShelf:       { id: 'partsShelf',        name: 'Parts Shelf',        zoneType: 'maintenance', cost: 35,   spriteColor: 0xaa6633, gridW: 2, gridH: 1, spriteKey: 'partsShelf',       effects: { zoneOutput: 0.02 } },
  workCart:         { id: 'workCart',           name: 'Work Cart',          zoneType: 'maintenance', cost: 25,   spriteColor: 0xcc8855, gridW: 1, gridH: 1, spriteKey: 'workCart',         effects: { zoneOutput: 0.01 } },
  craneHoist:       { id: 'craneHoist',        name: 'Crane Hoist',        zoneType: 'maintenance', cost: 300,  spriteColor: 0xddaa44, gridW: 4, gridH: 2, spriteKey: 'craneHoist',       effects: { zoneOutput: 0.10 } },
};
```

- [ ] **Step 2: Verify no import errors**

Open the game in the browser. The game should load normally — the new fields are additive and the old placement logic still reads `zoneType` and `cost`.

- [ ] **Step 3: Commit**

```bash
git add src/data/infrastructure.js
git commit -m "feat: add gridW, gridH, effects to all ZONE_FURNISHINGS"
```

---

### Task 3: Replace furnishing state and placement logic in Game.js

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Update initial state**

In the constructor, replace the furnishing state fields (around line 51-54):

```js
// Old:
zoneFurnishings: [],        // [{ id, type, col, row }]
zoneFurnishingGrid: {},     // "col,row" -> furnishing id
zoneFurnishingNextId: 1,
```

```js
// New:
zoneFurnishings: [],           // [{ id, type, col, row, subCol, subRow, rotated }]
zoneFurnishingSubgrids: {},    // "col,row" -> [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]
zoneFurnishingNextId: 1,
```

- [ ] **Step 2: Replace `placeZoneFurnishing` method**

Replace the `placeZoneFurnishing` method (around line 1133-1161) with:

```js
placeZoneFurnishing(col, row, furnType, subCol, subRow, rotated = false) {
  const furn = ZONE_FURNISHINGS[furnType];
  if (!furn) return false;
  if (!this.canAfford({ funding: furn.cost })) {
    this.log(`Can't afford ${furn.name}!`, 'bad');
    return false;
  }

  const key = col + ',' + row;
  // Must be on an infrastructure tile
  if (!this.state.infraOccupied[key]) {
    this.log('Must place on infrastructure!', 'bad');
    return false;
  }

  const gw = rotated ? furn.gridH : furn.gridW;
  const gh = rotated ? furn.gridW : furn.gridH;

  // Validate sub-grid bounds
  if (subCol < 0 || subRow < 0 || subCol + gw > 4 || subRow + gh > 4) {
    this.log('Doesn\'t fit here!', 'bad');
    return false;
  }

  // Ensure subgrid exists for this tile
  if (!this.state.zoneFurnishingSubgrids[key]) {
    this.state.zoneFurnishingSubgrids[key] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
  }
  const subgrid = this.state.zoneFurnishingSubgrids[key];

  // Check for collisions in the sub-grid
  for (let r = subRow; r < subRow + gh; r++) {
    for (let c = subCol; c < subCol + gw; c++) {
      if (subgrid[r][c] !== 0) {
        this.log('Space occupied!', 'bad');
        return false;
      }
    }
  }

  // Place it
  const id = 'zf_' + this.state.zoneFurnishingNextId++;
  this.spend({ funding: furn.cost });

  const entry = { id, type: furnType, col, row, subCol, subRow, rotated };
  this.state.zoneFurnishings.push(entry);

  // Mark sub-grid cells
  const furnIdx = this.state.zoneFurnishings.length; // nonzero index
  for (let r = subRow; r < subRow + gh; r++) {
    for (let c = subCol; c < subCol + gw; c++) {
      subgrid[r][c] = furnIdx;
    }
  }

  // Zone bonus logging
  const zoneType = this.state.zoneOccupied[key];
  if (zoneType === furn.zoneType) {
    this.log(`Built ${furn.name} (zone bonus active)`, 'good');
  } else {
    this.log(`Built ${furn.name}`, 'good');
  }

  this.computeSystemStats();
  this.emit('zonesChanged');
  return true;
}
```

- [ ] **Step 3: Replace `removeZoneFurnishing` method**

Replace the `removeZoneFurnishing` method (around line 1164-1182) with:

```js
removeZoneFurnishing(furnId) {
  const idx = this.state.zoneFurnishings.findIndex(e => e.id === furnId);
  if (idx === -1) return false;

  const entry = this.state.zoneFurnishings[idx];
  const furn = ZONE_FURNISHINGS[entry.type];

  // 50% refund
  if (furn) {
    this.state.resources.funding += Math.floor(furn.cost * 0.5);
  }

  // Clear sub-grid cells
  const key = entry.col + ',' + entry.row;
  const subgrid = this.state.zoneFurnishingSubgrids[key];
  if (subgrid) {
    const gw = entry.rotated ? furn.gridH : furn.gridW;
    const gh = entry.rotated ? furn.gridW : furn.gridH;
    for (let r = entry.subRow; r < entry.subRow + gh; r++) {
      for (let c = entry.subCol; c < entry.subCol + gw; c++) {
        if (r >= 0 && r < 4 && c >= 0 && c < 4) subgrid[r][c] = 0;
      }
    }
    // Clean up empty subgrids
    if (subgrid.every(row => row.every(cell => cell === 0))) {
      delete this.state.zoneFurnishingSubgrids[key];
    }
  }

  this.state.zoneFurnishings.splice(idx, 1);

  // Re-index subgrid references (since indices shifted after splice)
  this._reindexFurnishingSubgrids();

  this.log(`Removed ${furn ? furn.name : 'furnishing'} (50% refund)`, 'info');
  this.computeSystemStats();
  this.emit('zonesChanged');
  return true;
}

_reindexFurnishingSubgrids() {
  // Rebuild all subgrids from the furnishings array
  const subgrids = {};
  for (let i = 0; i < this.state.zoneFurnishings.length; i++) {
    const entry = this.state.zoneFurnishings[i];
    const furn = ZONE_FURNISHINGS[entry.type];
    if (!furn) continue;
    const key = entry.col + ',' + entry.row;
    if (!subgrids[key]) {
      subgrids[key] = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
    }
    const gw = entry.rotated ? furn.gridH : furn.gridW;
    const gh = entry.rotated ? furn.gridW : furn.gridH;
    const furnIdx = i + 1; // 1-based index
    for (let r = entry.subRow; r < entry.subRow + gh; r++) {
      for (let c = entry.subCol; c < entry.subCol + gw; c++) {
        if (r >= 0 && r < 4 && c >= 0 && c < 4) subgrids[key][r][c] = furnIdx;
      }
    }
  }
  this.state.zoneFurnishingSubgrids = subgrids;
}
```

- [ ] **Step 4: Update zone/infrastructure removal to clear furnishings**

Find the `removeZoneTile` method (around line 929). It already removes furnishings — update the part that references `zoneFurnishingGrid`:

```js
// Old (inside removeZoneTile):
const furnId = this.state.zoneFurnishingGrid[key];
if (furnId) {
  const fi = this.state.zoneFurnishings.findIndex(e => e.id === furnId);
```

Replace with:

```js
// New: remove ALL furnishings on this tile
const tileFurnishings = this.state.zoneFurnishings.filter(e => e.col === col && e.row === row);
for (const f of tileFurnishings) {
  const fDef = ZONE_FURNISHINGS[f.type];
  if (fDef) this.state.resources.funding += Math.floor(fDef.cost * 0.5);
}
this.state.zoneFurnishings = this.state.zoneFurnishings.filter(e => !(e.col === col && e.row === row));
delete this.state.zoneFurnishingSubgrids[key];
this._reindexFurnishingSubgrids();
```

Also find any reference to `this.state.zoneFurnishingGrid[key]` in the decoration placement guard (around line 1197) and replace it:

```js
// Old:
if (this.state.zoneFurnishingGrid[key]) return false;

// New:
if (this.state.zoneFurnishingSubgrids[key]) return false;
```

- [ ] **Step 5: Verify the game loads**

Open the game, confirm no console errors. Furnishing placement won't work yet via UI (that's Task 6) but the logic is in place.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: replace furnishing placement with 4x4 sub-grid system"
```

---

### Task 4: Generate sub-tile-sized placeholder sprites

**Files:**
- Modify: `src/renderer/sprites.js`

- [ ] **Step 1: Update furnishing sprite generation**

In `src/renderer/sprites.js`, replace the furnishing placeholder generation block (around line 168-176):

```js
// Old:
if (typeof ZONE_FURNISHINGS !== 'undefined') {
  for (const key of Object.keys(ZONE_FURNISHINGS)) {
    const furn = ZONE_FURNISHINGS[key];
    const color = furn.spriteColor || 0x888888;
    const gfx = this._drawIsoBox(TILE_W, TILE_H, color);
    this.textures[key] = app.renderer.generateTexture(gfx);
  }
}
```

```js
// New:
if (typeof ZONE_FURNISHINGS !== 'undefined') {
  for (const key of Object.keys(ZONE_FURNISHINGS)) {
    const furn = ZONE_FURNISHINGS[key];
    const color = furn.spriteColor || 0x888888;
    const gw = furn.gridW || 1;
    const gh = furn.gridH || 1;
    // Sub-cell size: TILE_W/4 per grid unit wide, TILE_H/4 per grid unit tall
    const boxW = (TILE_W / 4) * gw;
    const boxH = (TILE_H / 4) * gh;
    const gfx = this._drawIsoBox(boxW, boxH, color);
    this.textures[key] = app.renderer.generateTexture(gfx);
  }
}
```

- [ ] **Step 2: Verify sprites load at correct sizes**

Open the game. In the browser console, check that furnishing textures exist and are smaller than tile textures. No visual change yet since rendering is updated in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/sprites.js
git commit -m "feat: generate sub-tile-sized furnishing placeholder sprites"
```

---

### Task 5: Render furnishings at sub-grid positions

**Files:**
- Modify: `src/renderer/infrastructure-renderer.js`

- [ ] **Step 1: Update the import to include subGridToIso**

At the top of the file (line 10), update the grid import:

```js
// Old:
import { tileCenterIso } from './grid.js';

// New:
import { tileCenterIso, subGridToIso, gridToIso } from './grid.js';
```

- [ ] **Step 2: Replace the `_renderZoneFurnishings` method**

Replace the entire method (around line 842-868):

```js
Renderer.prototype._renderZoneFurnishings = function() {
  const furnishings = this.game.state.zoneFurnishings || [];
  for (const furn of furnishings) {
    const furnDef = ZONE_FURNISHINGS[furn.type];
    if (!furnDef) continue;
    const texture = this.sprites.getTexture(furn.type);
    if (!texture) continue;

    const gw = furn.rotated ? furnDef.gridH : furnDef.gridW;
    const gh = furn.rotated ? furnDef.gridW : furnDef.gridH;

    const sprite = new PIXI.Sprite(texture);
    // Anchor at bottom-center of the iso box for proper depth overlap
    sprite.anchor.set(0.5, 1.0);

    // Position: tile origin + sub-grid offset to the CENTER-BOTTOM of the item footprint
    const tilePos = gridToIso(furn.col, furn.row);
    const subOffset = subGridToIso(furn.subCol + gw / 2, furn.subRow + gh);
    sprite.x = tilePos.x + subOffset.x;
    sprite.y = tilePos.y + subOffset.y;

    // Depth: base tile depth + sub-row for within-tile ordering
    sprite.zIndex = (furn.col + furn.row) * 16 + (furn.subRow + gh);
    this.zoneLayer.addChild(sprite);
  }
};
```

- [ ] **Step 3: Add sub-grid overlay rendering method**

Add after `_renderZoneFurnishings`:

```js
Renderer.prototype._renderSubgridOverlay = function(col, row) {
  // Draw 4x4 iso sub-grid lines on the given tile
  const tilePos = gridToIso(col, row);
  const gfx = new PIXI.Graphics();
  gfx.setStrokeStyle({ width: 0.5, color: 0x4a9eff, alpha: 0.4 });

  // Draw lines along each iso axis
  for (let i = 0; i <= 4; i++) {
    // Lines parallel to NE-SW axis (varying subRow)
    const startNE = subGridToIso(0, i);
    const endNE = subGridToIso(4, i);
    gfx.moveTo(tilePos.x + startNE.x, tilePos.y + startNE.y);
    gfx.lineTo(tilePos.x + endNE.x, tilePos.y + endNE.y);
    gfx.stroke();

    // Lines parallel to NW-SE axis (varying subCol)
    const startNW = subGridToIso(i, 0);
    const endNW = subGridToIso(i, 4);
    gfx.moveTo(tilePos.x + startNW.x, tilePos.y + startNW.y);
    gfx.lineTo(tilePos.x + endNW.x, tilePos.y + endNW.y);
    gfx.stroke();
  }

  gfx.zIndex = (col + row) * 16 + 20; // Above furnishings
  this.zoneLayer.addChild(gfx);
};
```

- [ ] **Step 4: Add ghost preview rendering for furnishing placement**

Add after `_renderSubgridOverlay`:

```js
Renderer.prototype._renderFurnishingGhost = function(col, row, subCol, subRow, furnType, rotated) {
  const furnDef = ZONE_FURNISHINGS[furnType];
  if (!furnDef) return;

  const gw = rotated ? furnDef.gridH : furnDef.gridW;
  const gh = rotated ? furnDef.gridW : furnDef.gridH;

  // Check if placement is valid
  const key = col + ',' + row;
  const subgrid = this.game.state.zoneFurnishingSubgrids[key];
  let valid = subCol >= 0 && subRow >= 0 && subCol + gw <= 4 && subRow + gh <= 4;
  if (valid && subgrid) {
    for (let r = subRow; r < subRow + gh && valid; r++) {
      for (let c = subCol; c < subCol + gw && valid; c++) {
        if (subgrid[r][c] !== 0) valid = false;
      }
    }
  }

  const tilePos = gridToIso(col, row);
  const color = valid ? 0x44ff44 : 0xff4444;
  const gfx = new PIXI.Graphics();

  // Draw filled iso diamond for each cell in the footprint
  for (let r = subRow; r < subRow + gh; r++) {
    for (let c = subCol; c < subCol + gw; c++) {
      const top = subGridToIso(c, r);
      const right = subGridToIso(c + 1, r);
      const bottom = subGridToIso(c + 1, r + 1);
      const left = subGridToIso(c, r + 1);

      gfx.poly([
        tilePos.x + top.x, tilePos.y + top.y,
        tilePos.x + right.x, tilePos.y + right.y,
        tilePos.x + bottom.x, tilePos.y + bottom.y,
        tilePos.x + left.x, tilePos.y + left.y,
      ]);
      gfx.fill({ color, alpha: 0.3 });
      gfx.stroke({ width: 1, color, alpha: 0.6 });
    }
  }

  gfx.zIndex = (col + row) * 16 + 20;
  this.zoneLayer.addChild(gfx);
};
```

- [ ] **Step 5: Verify furnishings render (manually place via console)**

Open the game. Build some infrastructure + zone. In console:

```js
game.placeZoneFurnishing(5, 5, 'oscilloscope', 0, 0, false);
game.placeZoneFurnishing(5, 5, 'desk', 2, 2, false);
```

Verify two differently-sized items appear at different positions within the same tile.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/infrastructure-renderer.js
git commit -m "feat: render furnishings at sub-grid positions with overlay and ghost preview"
```

---

### Task 6: Update InputHandler for sub-grid placement

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Add sub-grid state and imports**

At the top of the file, update the grid import:

```js
// Old:
import { isoToGrid, isoToGridFloat } from '../renderer/grid.js';

// New:
import { isoToGrid, isoToGridFloat, gridToIso, isoToSubGrid } from '../renderer/grid.js';
```

Add new state fields in the constructor (after `selectedFurnishingTool` around line 34):

```js
this.selectedFurnishingTool = null; // zone furnishing type or null
this.furnishingRotated = false;     // rotation state for sub-tile placement
this.hoverSubCol = -1;              // sub-grid column under cursor
this.hoverSubRow = -1;              // sub-grid row under cursor
```

- [ ] **Step 2: Add sub-grid hover calculation**

Find the mouse move handling where `this.renderer.hoverCol` and `this.renderer.hoverRow` are set. Add sub-grid calculation after the main grid hover:

```js
// Sub-grid hover: calculate which sub-cell the cursor is over
if (this.selectedFurnishingTool && this.renderer.hoverCol !== undefined) {
  const tilePos = gridToIso(this.renderer.hoverCol, this.renderer.hoverRow);
  const offsetX = worldX - tilePos.x;
  const offsetY = worldY - tilePos.y;
  const sub = isoToSubGrid(offsetX, offsetY);
  const furnDef = ZONE_FURNISHINGS[this.selectedFurnishingTool];
  if (furnDef) {
    const gw = this.furnishingRotated ? furnDef.gridH : furnDef.gridW;
    const gh = this.furnishingRotated ? furnDef.gridW : furnDef.gridH;
    // Snap: place item so its top-left is at the hovered sub-cell, clamped to bounds
    this.hoverSubCol = Math.max(0, Math.min(4 - gw, Math.floor(sub.subCol)));
    this.hoverSubRow = Math.max(0, Math.min(4 - gh, Math.floor(sub.subRow)));
  }
}
```

Note: `worldX` and `worldY` refer to the world-space mouse coordinates used in the existing hover calculation. Check the existing mouse move handler to find the correct variable names — they may be named differently (e.g., `wx`, `wy`, or computed inline). Use the same values that feed into `isoToGrid` for the main grid hover.

- [ ] **Step 3: Update furnishing click handler**

Find where `this.selectedFurnishingTool` is checked for placement on click (around line 261-262):

```js
// Old:
} else if (this.selectedFurnishingTool) {
  this.game.placeZoneFurnishing(this.renderer.hoverCol, this.renderer.hoverRow, this.selectedFurnishingTool);
```

Replace with:

```js
} else if (this.selectedFurnishingTool) {
  this.game.placeZoneFurnishing(
    this.renderer.hoverCol, this.renderer.hoverRow,
    this.selectedFurnishingTool,
    this.hoverSubCol, this.hoverSubRow,
    this.furnishingRotated
  );
```

Do the same for the other placement call site (around line 989-991):

```js
// Old:
this.game.placeZoneFurnishing(col, row, this.selectedFurnishingTool);

// New:
this.game.placeZoneFurnishing(col, row, this.selectedFurnishingTool, this.hoverSubCol, this.hoverSubRow, this.furnishingRotated);
```

- [ ] **Step 4: Add rotation keybind**

Find the keydown handler. Add rotation toggle when R is pressed and a furnishing tool is selected:

```js
if (e.key === 'r' || e.key === 'R') {
  if (this.selectedFurnishingTool) {
    this.furnishingRotated = !this.furnishingRotated;
    return;
  }
}
```

- [ ] **Step 5: Update demolish furnishing handler**

Find the `demolishFurnishing` click handler (around line 754-758). Replace the old `zoneFurnishingGrid` lookup:

```js
// Old:
const fId = this.game.state.zoneFurnishingGrid[key];
if (fId) this.game.removeZoneFurnishing(fId);

// New: find furnishing at the clicked sub-cell
const subgrid = this.game.state.zoneFurnishingSubgrids[key];
if (subgrid) {
  const tilePos = gridToIso(col, row);
  const offsetX = worldX - tilePos.x;
  const offsetY = worldY - tilePos.y;
  const sub = isoToSubGrid(offsetX, offsetY);
  const sc = Math.floor(sub.subCol);
  const sr = Math.floor(sub.subRow);
  if (sc >= 0 && sc < 4 && sr >= 0 && sr < 4) {
    const furnIdx = subgrid[sr][sc];
    if (furnIdx > 0) {
      const entry = this.game.state.zoneFurnishings[furnIdx - 1];
      if (entry) this.game.removeZoneFurnishing(entry.id);
    }
  }
}
```

Apply the same pattern to all other `demolishFurnishing` / `zoneFurnishingGrid` references in InputHandler.js (around lines 895, 953, 1287). Search for `zoneFurnishingGrid` in the file and replace each instance with the sub-grid lookup pattern above.

- [ ] **Step 6: Wire up sub-grid overlay and ghost preview in the render loop**

Find where the renderer draws the placement preview / hover state for furnishings. This is typically in the render loop or a `_renderDragPreview`-style method. Add calls to show the sub-grid overlay and ghost:

```js
// When a furnishing tool is selected and hovering a valid tile:
if (this.selectedFurnishingTool && this.renderer.hoverCol !== undefined) {
  const col = this.renderer.hoverCol;
  const row = this.renderer.hoverRow;
  const key = col + ',' + row;
  if (this.game.state.infraOccupied[key]) {
    this.renderer._renderSubgridOverlay(col, row);
    this.renderer._renderFurnishingGhost(
      col, row, this.hoverSubCol, this.hoverSubRow,
      this.selectedFurnishingTool, this.furnishingRotated
    );
  }
}
```

Where exactly to put this depends on the existing render flow. Look for where `_renderDragPreview` or similar hover-state rendering is called and add this alongside it.

- [ ] **Step 7: Reset rotation state when changing tools**

Find the places where `this.selectedFurnishingTool = null` is set (around lines 1089, 1103, 1125, 1140). Add `this.furnishingRotated = false;` alongside each one.

- [ ] **Step 8: Test the full placement flow**

1. Open the game
2. Build concrete + lab flooring + zone
3. Select a furnishing from the palette
4. Hover over the zoned tile — verify sub-grid overlay appears
5. Move cursor within the tile — ghost preview should snap to sub-cells
6. Press R — ghost should rotate
7. Click — item should place
8. Place a second item on the same tile
9. Switch to demolish mode — click individual items to remove them

- [ ] **Step 9: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat: sub-grid aware furnishing placement, rotation, and demolish"
```

---

### Task 7: Update HUD palette to show grid size and remove zone restriction

**Files:**
- Modify: `src/renderer/hud.js`

- [ ] **Step 1: Show grid dimensions in furnishing palette items**

Find the furnishing palette rendering loop (around line 778). After the name element, add size info:

```js
const nameEl = document.createElement('div');
nameEl.className = 'palette-name';
const gw = furn.gridW || 1;
const gh = furn.gridH || 1;
const sizeLabel = gw === gh ? `${gw}x${gh}` : `${gw}x${gh}`;
nameEl.textContent = `${furn.name} (${sizeLabel})`;
item.appendChild(nameEl);
```

- [ ] **Step 2: Allow furnishing placement outside matching zones**

The palette currently filters furnishings by `zoneType` (line 762):

```js
// Old:
const furnEntries = Object.entries(ZONE_FURNISHINGS).filter(([, f]) => f.zoneType === zoneType);
```

Keep this filter for the zone-specific tab — it's a good UX to show relevant items first. But also ensure furnishings are accessible from all infrastructure categories. This is a UX decision that can be refined later; for now, keep the filtered list per zone tab as-is since the placement logic in Game.js no longer enforces the zone requirement.

- [ ] **Step 3: Verify palette shows size labels**

Open the game, navigate to a zone tab, verify furnishing entries show "(2x2)" etc. after the name.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hud.js
git commit -m "feat: show grid size in furnishing palette items"
```

---

### Task 8: Update asset-gen pipeline for sub-tile sprite dimensions

**Files:**
- Modify: `tools/asset-gen/server.cjs`

- [ ] **Step 1: Update the catalog builder to include grid dimensions**

In the `buildCatalog()` function (around line 84-92), update the furnishing regex and parsing:

```js
// Old:
const itemRe = /(\w+):\s*\{[^}]*name:\s*'([^']+)'[^}]*zoneType:\s*'([^']+)'/g;
let m;
while ((m = itemRe.exec(furnBlock)) !== null) {
  catalog.furniture[m[1]] = { id: m[1], name: m[2], zoneType: m[3] };
}

// New:
const itemRe = /(\w+):\s*\{[^}]*name:\s*'([^']+)'[^}]*zoneType:\s*'([^']+)'/g;
const gridWRe = /gridW:\s*(\d+)/;
const gridHRe = /gridH:\s*(\d+)/;
const spriteColorRe = /spriteColor:\s*(0x[0-9a-fA-F]+)/;
// Split furnishing block into per-item blocks
const itemBlocks = furnBlock.split(/\n  (\w+):\s*\{/);
for (let i = 1; i < itemBlocks.length; i += 2) {
  const itemId = itemBlocks[i];
  const block = itemBlocks[i + 1] || '';
  const name = (block.match(/name:\s*'([^']+)'/) || [])[1] || itemId;
  const zoneType = (block.match(/zoneType:\s*'([^']+)'/) || [])[1] || '';
  const gridW = parseInt((block.match(gridWRe) || [])[1]) || 1;
  const gridH = parseInt((block.match(gridHRe) || [])[1]) || 1;
  const spriteColor = (block.match(spriteColorRe) || [])[1] || '0x888888';
  // Compute sprite pixel dimensions
  const TILE_W = 64;
  const TILE_H = 32;
  const floorW = (TILE_W / 4) * gridW;
  const floorH = (TILE_H / 4) * gridH;
  const heightAllowance = 16; // pixels above floor for 3D object height
  catalog.furniture[itemId] = {
    id: itemId,
    name,
    zoneType,
    gridW,
    gridH,
    spriteColor,
    spritePixelW: Math.max(floorW, 16),
    spritePixelH: floorH + heightAllowance,
  };
}
```

- [ ] **Step 2: Add furnishings asset directory**

```bash
mkdir -p assets/furnishings
```

Update the directory constants at the top of server.cjs (around line 21):

```js
const FURNISHINGS_DIR = path.join(PROJECT, 'assets/furnishings');
```

Add to the directory creation loop (around line 23):

```js
for (const d of [COMPONENTS_DIR, TILES_DIR, DECORATIONS_DIR, FURNISHINGS_DIR]) {
```

- [ ] **Step 3: Verify the catalog endpoint returns grid dimensions**

Start the asset-gen server and hit the catalog endpoint:

```bash
cd tools/asset-gen && node server.cjs &
curl -s http://localhost:3333/api/catalog | python3 -m json.tool | grep -A6 '"oscilloscope"'
```

Expected output should include `gridW: 1`, `gridH: 1`, `spritePixelW: 16`, `spritePixelH: 24`.

- [ ] **Step 4: Commit**

```bash
git add tools/asset-gen/server.cjs
git commit -m "feat: asset-gen catalog includes sub-tile grid dimensions and sprite sizes"
```

---

### Task 9: Zone output and research effect calculations

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add zone bonus calculation method**

Add a method that computes per-zone bonuses from furnishings:

```js
computeZoneFurnishingBonuses() {
  // Returns { zoneOutput: { zoneType -> totalBonus }, research: { zoneType -> totalBonus } }
  const zoneOutput = {};
  const research = {};

  for (const furn of this.state.zoneFurnishings) {
    const furnDef = ZONE_FURNISHINGS[furn.type];
    if (!furnDef || !furnDef.effects) continue;

    const key = furn.col + ',' + furn.row;
    const tileZone = this.state.zoneOccupied[key];

    // zoneOutput only applies in the preferred zone
    if (furnDef.effects.zoneOutput && tileZone === furnDef.zoneType) {
      zoneOutput[tileZone] = (zoneOutput[tileZone] || 0) + furnDef.effects.zoneOutput;
    }

    // research applies in the preferred zone
    if (furnDef.effects.research && tileZone === furnDef.zoneType) {
      research[tileZone] = (research[tileZone] || 0) + furnDef.effects.research;
    }
  }

  return { zoneOutput, research };
}
```

- [ ] **Step 2: Integrate into tick or computeSystemStats**

In `computeSystemStats()` (or wherever zone effectiveness is calculated), call the new method and apply bonuses:

```js
const furnBonuses = this.computeZoneFurnishingBonuses();
this.state.zoneFurnishingBonuses = furnBonuses;
```

These bonuses are then available to any system that reads zone effectiveness (e.g., research speed multipliers, zone tier calculations).

- [ ] **Step 3: Verify bonuses are computed**

Open the game. Place furnishings in a matching zone. In console:

```js
game.computeZoneFurnishingBonuses()
// Should return { zoneOutput: { rfLab: 0.05 }, research: {} } for one oscilloscope in an RF Lab
```

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: compute zone output and research bonuses from furnishings"
```

---

### Task 10: Room-scoped morale and proximity-based beam physics effects

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Move `_detectRoom` from renderer to Game**

The `_detectRoom` method is currently on `Renderer.prototype` (infrastructure-renderer.js line 231). Copy the method into `Game.js` as a Game method so game logic can use it without a renderer dependency:

```js
_detectRoom(startCol, startRow) {
  const wallOcc = this.state.wallOccupied || {};
  const doorOcc = this.state.doorOccupied || {};
  const room = new Set();
  const queue = [`${startCol},${startRow}`];
  room.add(queue[0]);
  const MAX_TILES = 500;

  const edgeBlocked = (wallKey1, wallKey2, doorKey1, doorKey2) =>
    (wallOcc[wallKey1] || wallOcc[wallKey2]) && !doorOcc[doorKey1] && !doorOcc[doorKey2];

  while (queue.length > 0 && room.size < MAX_TILES) {
    const key = queue.shift();
    const [c, r] = key.split(',').map(Number);

    const eKey = `${c + 1},${r}`;
    if (!room.has(eKey) && !edgeBlocked(`${c},${r},e`, `${c+1},${r},w`, `${c},${r},e`, `${c+1},${r},w`)) {
      room.add(eKey); queue.push(eKey);
    }
    const wKey = `${c - 1},${r}`;
    if (!room.has(wKey) && !edgeBlocked(`${c-1},${r},e`, `${c},${r},w`, `${c-1},${r},e`, `${c},${r},w`)) {
      room.add(wKey); queue.push(wKey);
    }
    const sKey = `${c},${r + 1}`;
    if (!room.has(sKey) && !edgeBlocked(`${c},${r},s`, `${c},${r+1},n`, `${c},${r},s`, `${c},${r+1},n`)) {
      room.add(sKey); queue.push(sKey);
    }
    const nKey = `${c},${r - 1}`;
    if (!room.has(nKey) && !edgeBlocked(`${c},${r-1},s`, `${c},${r},n`, `${c},${r-1},s`, `${c},${r},n`)) {
      room.add(nKey); queue.push(nKey);
    }
  }
  return room;
}
```

- [ ] **Step 2: Add room-scoped morale calculation**

Add a method to compute per-room morale from furnishings:

```js
computeRoomMorale() {
  // Build a map of room -> total morale from furnishings
  const roomMorale = new Map(); // room key (sorted tile set) -> morale sum
  const tileToRoom = {};        // "col,row" -> room Set
  const processed = new Set();

  for (const furn of this.state.zoneFurnishings) {
    const furnDef = ZONE_FURNISHINGS[furn.type];
    if (!furnDef || !furnDef.effects || !furnDef.effects.morale) continue;

    const key = furn.col + ',' + furn.row;
    let room = tileToRoom[key];
    if (!room && !processed.has(key)) {
      room = this._detectRoom(furn.col, furn.row);
      for (const tileKey of room) {
        tileToRoom[tileKey] = room;
        processed.add(tileKey);
      }
    }
    if (!room) continue;

    // Use first tile as room identifier
    const roomKey = [...room].sort()[0];
    const current = roomMorale.get(roomKey) || 0;
    roomMorale.set(roomKey, current + furnDef.effects.morale);
  }

  return roomMorale;
}
```

- [ ] **Step 3: Integrate morale into the tick**

In the `tick()` method (around line 1660), update the morale calculation to include room-based furnishing morale:

```js
// After existing decoration morale:
this.state.moraleMultiplier = computeMoraleMultiplier(this.state.decorations);

// Add furnishing room morale
const roomMorale = this.computeRoomMorale();
let totalFurnishingMorale = 0;
for (const [, morale] of roomMorale) {
  totalFurnishingMorale += morale;
}
this.state.furnishingMorale = totalFurnishingMorale;
```

- [ ] **Step 4: Add beam physics proximity check**

Add a helper to find beamline segments in the same room as a furnishing:

```js
getBeamPhysicsEffects() {
  // Returns array of { beamlineId, effects } for furnishings with beamPhysics effects
  const results = [];
  const processed = new Set();

  for (const furn of this.state.zoneFurnishings) {
    const furnDef = ZONE_FURNISHINGS[furn.type];
    if (!furnDef || !furnDef.effects || !furnDef.effects.beamPhysics) continue;

    const key = furn.col + ',' + furn.row;
    const room = this._detectRoom(furn.col, furn.row);

    // Find beamline components in this room
    for (const entry of this.registry.getAll()) {
      for (const node of entry.nodes) {
        for (const tile of (node.tiles || [{ col: node.col, row: node.row }])) {
          const tileKey = tile.col + ',' + tile.row;
          if (room.has(tileKey)) {
            results.push({
              beamlineId: entry.id,
              effects: furnDef.effects.beamPhysics,
              furnishingId: furn.id,
            });
            break; // One match per furnishing is enough
          }
        }
      }
    }
  }

  return results;
}
```

- [ ] **Step 5: Verify morale calculation**

Open the game. Build a room with walls, place furnishings with morale effects inside. In console:

```js
game.computeRoomMorale()  // Should return a Map with morale values
```

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: room-scoped morale and proximity-based beam physics effects"
```

---

### Task 11: Integration test and cleanup

- [ ] **Step 1: Full manual integration test**

Test the following scenarios in the game:

1. **Place multiple items on one tile**: Select oscilloscope (1x1), place in corner of a tile. Select desk (2x2), place on same tile in a different area. Both should render at correct positions.

2. **Rotation**: Select a 2x1 item. Press R. Ghost preview should show 1x2. Place it. Remove it and verify refund.

3. **Overflow protection**: Try to place a 4x4 item on a tile that already has a 2x2 — should say "Space occupied!" if overlapping.

4. **Infrastructure removal cascade**: Place items on a tile. Demolish the infrastructure under it. All furnishings should be removed with refunds.

5. **Zone removal cascade**: Place items on a zoned tile. Remove the zone. Items should be removed.

6. **Demolish individual items**: Enter demolish mode. Click directly on an item within a tile — only that item should be removed, not all items on the tile.

7. **Asset-gen pipeline**: Start the asset-gen server, verify `/api/catalog` returns `gridW`, `gridH`, and `spritePixelW`/`spritePixelH` for all furnishing entries.

- [ ] **Step 2: Remove any dead code**

Search for remaining references to `zoneFurnishingGrid` across the codebase and remove them:

```bash
grep -rn "zoneFurnishingGrid" src/
```

Any remaining references should be updated to use `zoneFurnishingSubgrids`.

- [ ] **Step 3: Commit cleanup**

```bash
git add -A
git commit -m "chore: clean up old zoneFurnishingGrid references"
```
