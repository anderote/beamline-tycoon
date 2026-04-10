# Unified Placement System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the three separate placement systems (beamline components, facility equipment, zone furnishings) into one unified sub-grid placement model with consistent data formats, shared occupancy tracking, and unified UX. Convert beam pipe (drift) from a placed component into a drawn connection between components.

**Architecture:** Three phases executed sequentially:
1. Data format standardization (cost, energyCost, gridW/gridH)
2. Unified placement core (single `placeables` array, single `subgridOccupied` map, unified place/remove)
3. Beam pipe drawing system (drift as drawn connection, beam graph derivation from connectivity)

Each phase produces working software — old callers are updated to use new APIs before old code is removed.

**Tech Stack:** Vanilla JS (ES modules), PIXI.js (2D renderer), Three.js (3D renderer)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/data/infrastructure.js` | Modify | Standardize ZONE_FURNISHINGS costs to `{ funding: X }`, add `energyCost` to all entries |
| `src/data/components.js` | Modify | Add `gridW`/`gridH` to all beamline and facility components; mark drift as `isDrawnConnection: true` |
| `src/game/Game.js` | Modify | Replace three placement systems with unified `placeables`/`subgridOccupied`; add beam pipe drawing; update save/load migration |
| `src/beamline/Beamline.js` | Modify | Remove parent-child placement; add `deriveBeamGraph()` from pipe connectivity; keep physics ordering |
| `src/beamline/BeamlineRegistry.js` | Modify | Update `occupyTiles`/`isTileOccupied` to use unified subgrid |
| `src/networks/networks.js` | Modify | Update `_findAdjacentEquipment`/`_findAdjacentBeamline` to query unified placeables |
| `src/game/economy.js` | Modify | Query unified placeables instead of `facilityEquipment` |
| `src/game/research.js` | Modify | Query unified placeables instead of `facilityEquipment` |
| `src/input/InputHandler.js` | Modify | Unified placement input for all categories; beam pipe drawing mode |
| `src/renderer/sprites.js` | Modify | Unified sprite rendering from placeables array |
| `src/renderer/overlays.js` | Modify | Unified selection/delete highlight for all categories |
| `src/renderer3d/world-snapshot.js` | Modify | Read from unified placeables instead of separate arrays |
| `src/renderer3d/ThreeRenderer.js` | Modify | Update references from old arrays to placeables |
| `src/ui/EquipmentWindow.js` | Modify | Extend to handle all placeable categories (unified PlaceableWindow) |

---

## Phase 1: Data Format Standardization

### Task 1: Standardize ZONE_FURNISHINGS Cost Format and Add energyCost

**Files:**
- Modify: `src/data/infrastructure.js:532-607`

- [ ] **Step 1: Change all ZONE_FURNISHINGS costs to object format**

In `src/data/infrastructure.js`, change every `cost: N` to `cost: { funding: N }` in the ZONE_FURNISHINGS object. There are ~50 entries. Example transformation:

```js
// Before:
rfWorkbench: { id: 'rfWorkbench', name: 'RF Workbench', zoneType: 'rfLab', cost: 50, ... },

// After:
rfWorkbench: { id: 'rfWorkbench', name: 'RF Workbench', zoneType: 'rfLab', cost: { funding: 50 }, ... },
```

Apply this to every entry in ZONE_FURNISHINGS.

- [ ] **Step 2: Add energyCost to all ZONE_FURNISHINGS entries**

Add an `energyCost` field (in kW) to every entry. Use these values:

**Passive (energyCost: 0):** `filingCabinet`, `whiteboard`, `whiteboardLarge`, `diningTable`, `conferenceTable`, `phoneUnit`, `partsShelf`, `toolChest`, `workCart`, `toolCabinet`, `pipeRack`

**Small electronics (0.1-0.5 kW):** `coffeeMachine: 0.2`, `microwave: 0.3`, `waterCooler: 0.1`, `vendingMachine: 0.3`, `alarmPanel: 0.1`, `mirrorMount: 0.1`, `flowMeter: 0.1`, `scopeStation: 0.2`, `projector: 0.3`

**Medium equipment (0.5-2 kW):** `oscilloscope: 0.5`, `signalGenerator: 0.8`, `spectrumAnalyzer: 1.0`, `networkAnalyzer: 1.2`, `leakDetector: 0.8`, `beamProfiler: 1.0`, `interferometer: 1.5`, `drillPress: 1.5`, `operatorConsole: 0.5`, `monitorBank: 0.8`, `desk: 0.2` (monitor/computer), `gasManifold: 0.5`, `bpmTestFixture: 1.0`, `daqRack: 1.5`

**Large equipment (2-5 kW):** `serverRack: 3.0`, `serverCluster: 5.0`, `coolantPump: 2.0`, `heatExchanger: 3.0`, `testChamber: 4.0`, `pumpCart: 2.0`, `rga: 2.5`, `rfWorkbench: 1.5`, `opticalTable: 0.5`, `laserAlignment: 2.0`, `wireScannerBench: 1.5`, `cncMill: 4.0`

**Heavy machinery (5-15 kW):** `lathe: 5.0`, `millingMachine: 7.0`, `weldingStation: 8.0`, `chillerUnit: 10.0`, `craneHoist: 12.0`, `assemblyCrane: 12.0`, `servingCounter: 5.0` (commercial kitchen equipment)

Example entry after both changes:

```js
oscilloscope: { id: 'oscilloscope', name: 'Oscilloscope', zoneType: 'rfLab', cost: { funding: 120 }, energyCost: 0.5, spriteColor: 0x44aa44, gridW: 1, gridH: 1, subH: 1, spriteKey: 'oscilloscope', effects: { zoneOutput: 0.05 } },
```

- [ ] **Step 3: Update furnishing cost consumers in Game.js**

In `src/game/Game.js`, the `placeZoneFurnishing` method currently wraps the cost:
```js
// Line ~1200 — currently:
if (!this.canAfford({ funding: furn.cost })) {
// Change to:
if (!this.canAfford(furn.cost)) {
```

And `removeZoneFurnishing` currently does:
```js
// Line ~1279 — currently:
this.state.resources.funding += Math.floor(furn.cost * 0.5);
// Change to:
for (const [r, a] of Object.entries(furn.cost))
  this.state.resources[r] += Math.floor(a * 0.5);
```

- [ ] **Step 4: Verify the game loads and furnishings can be placed/removed**

Run the game in browser, place a furnishing, verify cost deducted correctly, remove it, verify 50% refund works.

- [ ] **Step 5: Commit**

```bash
git add src/data/infrastructure.js src/game/Game.js
git commit -m "feat: standardize ZONE_FURNISHINGS cost format and add energyCost"
```

---

### Task 2: Add gridW/gridH to Beamline Components

**Files:**
- Modify: `src/data/components.js`

- [ ] **Step 1: Add gridW and gridH to all beamline components**

Every component in `COMPONENTS` that is a beamline component (has `subL`/`subW`) needs `gridW` and `gridH` derived from its sub-unit dimensions. The sub-grid cell size equals one sub-unit, so `gridW = subW` and `gridH = subL` (width is perpendicular to beam, height is along beam — in the sub-grid, W maps to subW and H maps to subL).

For each component, add `gridW` and `gridH` after the `subH` field. Examples:

```js
// source: subL: 4, subW: 4 → gridW: 4, gridH: 4
source: {
  ...
  subL: 4, subW: 4, subH: 4,
  gridW: 4, gridH: 4,
  ...
},

// quadrupole: subL: 2, subW: 2 → gridW: 2, gridH: 2
quadrupole: {
  ...
  subL: 2, subW: 2, subH: 3,
  gridW: 2, gridH: 2,
  ...
},

// drift: subL: 4, subW: 2 → gridW: 2, gridH: 4
drift: {
  ...
  subL: 4, subW: 2, subH: 2,
  gridW: 2, gridH: 4,
  ...
},
```

Apply to all ~109 components. Facility equipment components (category: rf, vacuum, cooling, power) already have these or need them added using the same formula.

- [ ] **Step 2: Mark drift as a drawn connection type**

Add `isDrawnConnection: true` to the drift component definition:

```js
drift: {
  id: 'drift',
  name: 'Beam Pipe',
  ...
  isDrawnConnection: true,
  ...
},
```

This flag will be used later (Phase 3) to distinguish drift from other beamline components in the placement UI. For now it's just a data marker.

- [ ] **Step 3: Commit**

```bash
git add src/data/components.js
git commit -m "feat: add gridW/gridH to all components, mark drift as drawn connection"
```

---

## Phase 2: Unified Placement System

### Task 3: Create Unified Placement State in Game.js

**Files:**
- Modify: `src/game/Game.js:28-81` (state initialization)

- [ ] **Step 1: Add unified placement state fields**

In the `Game` constructor's `this.state` object, add the new unified fields alongside the existing ones (don't remove old fields yet — we'll migrate callers first):

```js
// Add after the existing zoneFurnishingNextId line (~line 55):

// Unified placement system
placeables: [],              // [{ id, type, category, col, row, subCol, subRow, rotated, dir, params }]
placeableIndex: {},           // id -> index in placeables array
subgridOccupied: {},          // "col,row,subCol,subRow" -> { id, category }
placeableNextId: 1,
// Beam pipe connections (drawn between beamline component ports)
beamPipes: [],                // [{ id, fromId, toId, path: [{col,row,subCol,subRow}], subL }]
beamPipeNextId: 1,
```

- [ ] **Step 2: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: add unified placeables state fields to Game"
```

---

### Task 4: Implement Unified Place/Remove Methods in Game.js

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add the unified placePlaceable method**

Add after the existing `removeZoneFurnishing` method (after ~line 1308):

```js
// === UNIFIED PLACEMENT ===

/**
 * Place any item (beamline component, facility equipment, or zone furnishing)
 * on the unified sub-grid.
 * @param {Object} opts - { type, category, col, row, subCol, subRow, rotated, dir, params }
 * @returns {string|false} The placeable id, or false on failure
 */
placePlaceable(opts) {
  const { type, category, col, row, subCol, subRow, rotated, dir, params } = opts;

  // Look up definition
  let def;
  if (category === 'furnishing') {
    def = ZONE_FURNISHINGS[type];
  } else {
    def = COMPONENTS[type];
  }
  if (!def) return false;

  // Unlock check (beamline and equipment)
  if (category !== 'furnishing' && !this.isComponentUnlocked(def)) return false;

  // Afford check
  if (!this.canAfford(def.cost)) {
    this.log(`Can't afford ${def.name}!`, 'bad');
    return false;
  }

  // Compute effective grid dimensions
  const gw = rotated ? (def.gridH || def.subW || 1) : (def.gridW || def.subW || 1);
  const gh = rotated ? (def.gridW || def.subL || 1) : (def.gridH || def.subL || 1);

  // Validate sub-grid bounds (must fit within the 4x4 tile grid)
  // Items can span multiple tiles, so check each cell individually
  const cells = [];
  for (let dr = 0; dr < gh; dr++) {
    for (let dc = 0; dc < gw; dc++) {
      const sc = subCol + dc;
      const sr = subRow + dr;
      // Convert to absolute tile + subtile
      const absCol = col + Math.floor(sc / 4);
      const absRow = row + Math.floor(sr / 4);
      const absSC = sc % 4;
      const absSR = sr % 4;
      cells.push({ col: absCol, row: absRow, subCol: absSC, subRow: absSR });
    }
  }

  // Floor check — all cells must be on infrastructure
  for (const cell of cells) {
    const tileKey = cell.col + ',' + cell.row;
    if (!this.state.infraOccupied[tileKey]) {
      this.log('Must place on flooring!', 'bad');
      return false;
    }
  }

  // Collision check — no cell can be occupied
  for (const cell of cells) {
    const cellKey = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
    if (this.state.subgridOccupied[cellKey]) {
      this.log('Space occupied!', 'bad');
      return false;
    }
  }

  // Zone tier gating (equipment only)
  if (category === 'equipment' && def.zoneTier != null) {
    const zoneTier = this.getZoneTierForCategory(def.category);
    if (zoneTier < def.zoneTier) {
      this.log(`Need more zone area for ${def.name}!`, 'bad');
      return false;
    }
  }

  // Max count check (beamline only)
  if (category === 'beamline' && def.maxCount) {
    const count = this.state.placeables.filter(
      p => p.category === 'beamline' && p.type === type
    ).length;
    if (count >= def.maxCount) {
      this.log(`Max ${def.name} reached.`, 'bad');
      return false;
    }
  }

  // Assign ID
  const prefix = category === 'beamline' ? 'bl_' : category === 'equipment' ? 'eq_' : 'fn_';
  const id = prefix + this.state.placeableNextId++;

  // Deduct cost
  this.spend(def.cost);

  // Create entry
  const entry = {
    id,
    type,
    category,
    col,
    row,
    subCol,
    subRow,
    rotated: rotated || false,
    dir: dir || null,
    params: null,
    cells,  // cached cell positions for fast removal
  };

  // Initialize params for beamline components
  if (category === 'beamline') {
    entry.params = {};
    if (PARAM_DEFS[type]) {
      for (const [k, pdef] of Object.entries(PARAM_DEFS[type])) {
        if (!pdef.derived) entry.params[k] = pdef.default;
      }
    }
    if (def.params) {
      for (const [k, v] of Object.entries(def.params)) {
        if (!(k in entry.params)) entry.params[k] = v;
      }
    }
    // Apply param overrides
    if (params) Object.assign(entry.params, params);
  }

  // Store
  this.state.placeables.push(entry);
  this.state.placeableIndex[id] = this.state.placeables.length - 1;

  // Occupy sub-grid cells
  for (const cell of cells) {
    const cellKey = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
    this.state.subgridOccupied[cellKey] = { id, category };
  }

  // Logging
  const zoneType = this.state.zoneOccupied[col + ',' + row];
  if (category === 'furnishing' && def.zoneType && zoneType === def.zoneType) {
    this.log(`Built ${def.name} (zone bonus active)`, 'good');
  } else {
    this.log(`Built ${def.name}`, 'good');
  }

  this.computeSystemStats();
  this.emit('placeableChanged');
  return id;
}

/**
 * Remove a placeable by ID. Refunds 50% of cost.
 * @param {string} placeableId
 * @returns {boolean}
 */
removePlaceable(placeableId) {
  const idx = this.state.placeableIndex[placeableId];
  if (idx === undefined) return false;

  const entry = this.state.placeables[idx];
  if (!entry) return false;

  // Look up definition for refund
  let def;
  if (entry.category === 'furnishing') {
    def = ZONE_FURNISHINGS[entry.type];
  } else {
    def = COMPONENTS[entry.type];
  }

  // 50% refund
  if (def && def.cost) {
    for (const [r, a] of Object.entries(def.cost)) {
      this.state.resources[r] += Math.floor(a * 0.5);
    }
  }

  // Free sub-grid cells
  for (const cell of entry.cells) {
    const cellKey = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
    delete this.state.subgridOccupied[cellKey];
  }

  // Remove beam pipes connected to this placeable (beamline only)
  if (entry.category === 'beamline') {
    this.state.beamPipes = this.state.beamPipes.filter(
      p => p.fromId !== placeableId && p.toId !== placeableId
    );
  }

  // Remove from array
  this.state.placeables.splice(idx, 1);

  // Rebuild index
  this._rebuildPlaceableIndex();

  this.log(`Removed ${def ? def.name : 'item'} (50% refund)`, 'info');
  this.computeSystemStats();
  this.emit('placeableChanged');
  return true;
}

/**
 * Rebuild the placeableIndex after array mutation.
 */
_rebuildPlaceableIndex() {
  this.state.placeableIndex = {};
  for (let i = 0; i < this.state.placeables.length; i++) {
    this.state.placeableIndex[this.state.placeables[i].id] = i;
  }
}

/**
 * Get a placeable by ID.
 */
getPlaceable(id) {
  const idx = this.state.placeableIndex[id];
  return idx !== undefined ? this.state.placeables[idx] : null;
}

/**
 * Get all placeables of a given category.
 */
getPlaceablesByCategory(category) {
  return this.state.placeables.filter(p => p.category === category);
}

/**
 * Find which placeable occupies a given sub-grid cell.
 */
getPlaceableAtSubgrid(col, row, subCol, subRow) {
  const key = col + ',' + row + ',' + subCol + ',' + subRow;
  const occ = this.state.subgridOccupied[key];
  if (!occ) return null;
  return this.getPlaceable(occ.id);
}
```

- [ ] **Step 2: Verify the new methods compile — open the game in browser, check console for errors**

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: implement unified placePlaceable/removePlaceable methods"
```

---

### Task 5: Migrate Facility Equipment to Unified System

**Files:**
- Modify: `src/game/Game.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Update placeFacilityEquipment to delegate to placePlaceable**

Replace the body of `placeFacilityEquipment` in Game.js (~line 1122) with a delegation:

```js
placeFacilityEquipment(col, row, compType) {
  return this.placePlaceable({
    type: compType,
    category: 'equipment',
    col,
    row,
    subCol: 0,   // equipment defaults to top-left of tile
    subRow: 0,
    rotated: false,
  });
}
```

- [ ] **Step 2: Update removeFacilityEquipment to delegate to removePlaceable**

Replace the body of `removeFacilityEquipment` in Game.js (~line 1172):

```js
removeFacilityEquipment(equipId) {
  return this.removePlaceable(equipId);
}
```

- [ ] **Step 3: Update economy.js to query unified placeables**

In `src/game/economy.js`, line 5:

```js
// Before:
const equip = state.facilityEquipment || [];
// After:
const equip = (state.placeables || []).filter(p => p.category === 'equipment');
```

- [ ] **Step 4: Update research.js to query unified placeables**

Search `src/game/research.js` for references to `facilityEquipment` and update each to query `state.placeables.filter(p => p.category === 'equipment')`.

- [ ] **Step 5: Update networks.js _findAdjacentEquipment**

In `src/networks/networks.js`, update `_findAdjacentEquipment` (~line 79) to query unified placeables:

```js
_findAdjacentEquipment(state, tileSet) {
  var found = [];
  var equip = (state.placeables || []).filter(function(p) { return p.category === 'equipment'; });
  for (var i = 0; i < equip.length; i++) {
    var eq = equip[i];
    // Equipment occupies a tile at (eq.col, eq.row)
    var tc = eq.col;
    var tr = eq.row;
    var adjacent = false;
    // Check overlap
    if (tileSet.has(tc + ',' + tr)) {
      adjacent = true;
    }
    // Check cardinal neighbors
    if (!adjacent) {
      for (var d = 0; d < CARDINAL.length; d++) {
        if (tileSet.has((tc + CARDINAL[d][0]) + ',' + (tr + CARDINAL[d][1]))) {
          adjacent = true;
          break;
        }
      }
    }
    if (adjacent) {
      found.push({ id: eq.id, type: eq.type, col: eq.col, row: eq.row });
    }
  }
  return found;
},
```

- [ ] **Step 6: Update networks.js _findAdjacentBeamline**

In `src/networks/networks.js`, update `_findAdjacentBeamline` (~line 111) similarly:

```js
_findAdjacentBeamline(state, tileSet) {
  var found = [];
  var beamNodes = state.beamline || [];
  for (var i = 0; i < beamNodes.length; i++) {
    var node = beamNodes[i];
    var nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
    var adjacent = false;
    for (var t = 0; t < nodeTiles.length && !adjacent; t++) {
      var tc = nodeTiles[t].col;
      var tr = nodeTiles[t].row;
      if (tileSet.has(tc + ',' + tr)) {
        adjacent = true;
        break;
      }
      for (var d = 0; d < CARDINAL.length; d++) {
        if (tileSet.has((tc + CARDINAL[d][0]) + ',' + (tr + CARDINAL[d][1]))) {
          adjacent = true;
          break;
        }
      }
    }
    if (adjacent) {
      found.push(node);
    }
  }
  return found;
},
```

Note: beamline nodes still come from `state.beamline` (the aggregate array maintained by `_updateAggregateBeamline`). This will be updated in Phase 3 when beamline components move fully to placeables.

- [ ] **Step 7: Update world-snapshot.js**

In `src/renderer3d/world-snapshot.js`, find references to `state.facilityEquipment` and update to `(state.placeables || []).filter(p => p.category === 'equipment')`.

- [ ] **Step 8: Verify facility equipment placement and removal still works in game**

Open game, place facility equipment, verify it appears. Remove it, verify refund. Check network validators still function (place a substation + power cable + beamline component, verify power network detects them).

- [ ] **Step 9: Commit**

```bash
git add src/game/Game.js src/game/economy.js src/game/research.js src/networks/networks.js src/renderer3d/world-snapshot.js
git commit -m "feat: migrate facility equipment to unified placement system"
```

---

### Task 6: Migrate Zone Furnishings to Unified System

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Update placeZoneFurnishing to delegate to placePlaceable**

Replace the body of `placeZoneFurnishing` in Game.js (~line 1197):

```js
placeZoneFurnishing(col, row, furnType, subCol, subRow, rotated = false) {
  return this.placePlaceable({
    type: furnType,
    category: 'furnishing',
    col,
    row,
    subCol,
    subRow,
    rotated,
  });
}
```

- [ ] **Step 2: Update removeZoneFurnishing to delegate to removePlaceable**

Replace the body of `removeZoneFurnishing` in Game.js (~line 1270):

```js
removeZoneFurnishing(furnId) {
  return this.removePlaceable(furnId);
}
```

- [ ] **Step 3: Update the old subgrid compatibility layer**

The old `zoneFurnishingSubgrids` is used by renderers and input handlers for hit-testing. Add a compatibility method that derives the old subgrid format from the unified placeables on demand:

```js
/**
 * Build legacy subgrid view from unified placeables (for renderer compatibility).
 * Returns { "col,row": [[0,0,0,0],...] } where nonzero = furnishing index+1.
 */
_getLegacyFurnishingSubgrids() {
  const subgrids = {};
  const furnishings = this.state.placeables.filter(p => p.category === 'furnishing');
  for (let i = 0; i < furnishings.length; i++) {
    const entry = furnishings[i];
    const def = ZONE_FURNISHINGS[entry.type];
    if (!def) continue;
    const key = entry.col + ',' + entry.row;
    if (!subgrids[key]) {
      subgrids[key] = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    }
    const gw = entry.rotated ? (def.gridH || 1) : (def.gridW || 1);
    const gh = entry.rotated ? (def.gridW || 1) : (def.gridH || 1);
    const furnIdx = i + 1;
    for (let r = entry.subRow; r < entry.subRow + gh && r < 4; r++) {
      for (let c = entry.subCol; c < entry.subCol + gw && c < 4; c++) {
        subgrids[key][r][c] = furnIdx;
      }
    }
  }
  return subgrids;
}
```

In `computeSystemStats` and anywhere `this.state.zoneFurnishingSubgrids` is read by external code, ensure it stays in sync by updating it at the end of `placePlaceable` and `removePlaceable`:

```js
// At end of placePlaceable and removePlaceable, after emit('placeableChanged'):
this.state.zoneFurnishings = this.state.placeables.filter(p => p.category === 'furnishing');
this.state.zoneFurnishingSubgrids = this._getLegacyFurnishingSubgrids();
this.state.facilityEquipment = this.state.placeables.filter(p => p.category === 'equipment');
this.state.facilityGrid = {};
for (const eq of this.state.facilityEquipment) {
  this.state.facilityGrid[eq.col + ',' + eq.row] = eq.id;
}
```

This keeps legacy code working while we migrate callers.

- [ ] **Step 4: Remove _reindexFurnishingSubgrids method**

The old `_reindexFurnishingSubgrids` method is no longer needed since the compatibility layer rebuilds from placeables. Remove it.

- [ ] **Step 5: Verify furnishing placement and removal still works**

Open game, place a zone furnishing on a sub-grid, verify it appears correctly. Remove it, verify refund. Verify zone bonus logging works.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: migrate zone furnishings to unified placement system"
```

---

### Task 7: Update Save/Load with Migration

**Files:**
- Modify: `src/game/Game.js` (save/load methods)

- [ ] **Step 1: Find the save method and add placeables to serialization**

Search Game.js for the method that serializes state (look for `toJSON`, `save`, or `getSnapshot`). Add `placeables`, `placeableIndex`, `subgridOccupied`, `placeableNextId`, `beamPipes`, and `beamPipeNextId` to the serialized output.

- [ ] **Step 2: Add migration in the load/restore method**

In the load method (look for `fromJSON`, `load`, or `restoreSnapshot`), add migration logic that runs when loading old saves that don't have `placeables`:

```js
// Migration: old format -> unified placeables
if (!snap.placeables) {
  snap.placeables = [];
  snap.placeableNextId = 1;
  snap.subgridOccupied = {};
  snap.placeableIndex = {};
  snap.beamPipes = [];
  snap.beamPipeNextId = 1;

  // Migrate facility equipment
  if (snap.facilityEquipment) {
    for (const eq of snap.facilityEquipment) {
      const id = 'eq_' + snap.placeableNextId++;
      const def = COMPONENTS[eq.type];
      const gw = def ? (def.gridW || def.subW || 4) : 4;
      const gh = def ? (def.gridH || def.subL || 4) : 4;
      const entry = {
        id, type: eq.type, category: 'equipment',
        col: eq.col, row: eq.row, subCol: 0, subRow: 0,
        rotated: false, dir: null, params: null,
        cells: [],
      };
      // Compute cells
      for (let dr = 0; dr < gh; dr++) {
        for (let dc = 0; dc < gw; dc++) {
          const sc = dc; const sr = dr;
          const absCol = eq.col + Math.floor(sc / 4);
          const absRow = eq.row + Math.floor(sr / 4);
          entry.cells.push({ col: absCol, row: absRow, subCol: sc % 4, subRow: sr % 4 });
        }
      }
      snap.placeables.push(entry);
      snap.placeableIndex[id] = snap.placeables.length - 1;
      for (const cell of entry.cells) {
        snap.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'equipment' };
      }
    }
  }

  // Migrate zone furnishings
  if (snap.zoneFurnishings) {
    for (const zf of snap.zoneFurnishings) {
      const id = 'fn_' + snap.placeableNextId++;
      const def = ZONE_FURNISHINGS[zf.type];
      const gw = zf.rotated ? (def ? def.gridH : 1) : (def ? def.gridW : 1);
      const gh = zf.rotated ? (def ? def.gridW : 1) : (def ? def.gridH : 1);
      const entry = {
        id, type: zf.type, category: 'furnishing',
        col: zf.col, row: zf.row, subCol: zf.subCol || 0, subRow: zf.subRow || 0,
        rotated: zf.rotated || false, dir: null, params: null,
        cells: [],
      };
      for (let dr = 0; dr < gh; dr++) {
        for (let dc = 0; dc < gw; dc++) {
          const sc = (zf.subCol || 0) + dc;
          const sr = (zf.subRow || 0) + dr;
          const absCol = zf.col + Math.floor(sc / 4);
          const absRow = zf.row + Math.floor(sr / 4);
          entry.cells.push({ col: absCol, row: absRow, subCol: sc % 4, subRow: sr % 4 });
        }
      }
      snap.placeables.push(entry);
      snap.placeableIndex[id] = snap.placeables.length - 1;
      for (const cell of entry.cells) {
        snap.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'furnishing' };
      }
    }
  }
}
```

- [ ] **Step 3: Verify save/load works — save game, reload, verify all equipment and furnishings are intact**

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: add unified placeables to save/load with migration from old format"
```

---

### Task 8: Unified Selection and Delete Highlighting

**Files:**
- Modify: `src/renderer/overlays.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Read overlays.js to understand current highlight rendering**

Read `src/renderer/overlays.js` fully to understand how selection and delete highlights are drawn for each category.

- [ ] **Step 2: Add unified highlight function for placeables**

Add a function that highlights any placeable's occupied sub-grid cells. The function takes a placeable entry and a color, and draws colored diamonds over each cell:

```js
/**
 * Draw a highlight over all sub-grid cells occupied by a placeable.
 * @param {CanvasRenderingContext2D|PIXI.Graphics} gfx - rendering context
 * @param {Object} placeable - entry from state.placeables
 * @param {number} color - highlight color (e.g. 0xff4444 for delete, 0x44ff44 for select)
 * @param {number} alpha - transparency (0-1)
 */
function highlightPlaceable(gfx, placeable, color, alpha, camera) {
  for (const cell of placeable.cells) {
    // Convert cell to screen position using sub-grid iso math
    const tilePos = gridToIso(cell.col, cell.row, camera);
    const subOffset = subGridToIso(cell.subCol, cell.subRow);
    // Draw a small iso diamond at this sub-cell
    drawSubgridDiamond(gfx, tilePos.x + subOffset.x, tilePos.y + subOffset.y, color, alpha);
  }
}
```

Adapt this to match the existing rendering approach in overlays.js (PIXI.Graphics vs Canvas, coordinate system, etc.).

- [ ] **Step 3: Update InputHandler delete mode to use unified highlighting**

In InputHandler.js, find the demolish/delete hover logic. Currently there are separate paths for beamline nodes, facility equipment, and furnishings. Add a unified path:

When in demolish mode and hovering a tile, check `state.subgridOccupied` for the hovered sub-grid cell. If occupied, highlight the entire placeable using the new `highlightPlaceable` function with red color.

- [ ] **Step 4: Update InputHandler click-to-select to use unified path**

When the player clicks on any placeable (any category), set a `selectedPlaceableId` on the game/input state. The existing `selectedBeamlineId` can remain as an alias for now.

- [ ] **Step 5: Verify — enter demolish mode, hover over equipment and furnishings, verify red highlight appears on all occupied cells. Click to select items from different categories.**

- [ ] **Step 6: Commit**

```bash
git add src/renderer/overlays.js src/input/InputHandler.js
git commit -m "feat: unified selection and delete highlighting for all placeables"
```

---

## Phase 3: Beam Pipe Drawing

### Task 9: Beam Pipe Drawing Input

**Files:**
- Modify: `src/input/InputHandler.js`
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add beam pipe drawing state to InputHandler**

Add state fields to the InputHandler constructor:

```js
this.drawingBeamPipe = false;
this.beamPipeStartId = null;     // placeable id of the source component
this.beamPipeStartPort = null;   // 'entry' or 'exit'
this.beamPipePath = [];          // [{col, row, subCol, subRow}, ...]
```

- [ ] **Step 2: Implement port detection**

Add a method to detect when the mouse is near a beamline component's port:

```js
/**
 * Check if a screen position is near a beamline component's entry or exit port.
 * Returns { placeableId, port: 'entry'|'exit' } or null.
 */
_detectBeamPort(col, row, subCol, subRow) {
  // Check all beamline placeables
  const beamItems = this.game.state.placeables.filter(p => p.category === 'beamline');
  for (const item of beamItems) {
    const def = COMPONENTS[item.type];
    if (!def || def.isDrawnConnection) continue;

    // Compute port positions based on item direction and dimensions
    const gw = item.rotated ? (def.gridH || def.subW) : (def.gridW || def.subW);
    const gh = item.rotated ? (def.gridW || def.subL) : (def.gridH || def.subL);

    // Entry port: center of the entry face
    // Exit port: center of the exit face
    // Port positions depend on dir (NE, SE, SW, NW)
    const ports = this._computePorts(item, def, gw, gh);

    for (const port of ports) {
      const dx = Math.abs((col * 4 + subCol) - (port.col * 4 + port.subCol));
      const dy = Math.abs((row * 4 + subRow) - (port.row * 4 + port.subRow));
      if (dx <= 1 && dy <= 1) {
        return { placeableId: item.id, port: port.type };
      }
    }
  }
  return null;
}

_computePorts(item, def, gw, gh) {
  const DIR_TO_DELTA = { NE: { dc: 0, dr: -1 }, SE: { dc: 1, dr: 0 }, SW: { dc: 0, dr: 1 }, NW: { dc: -1, dr: 0 } };
  const dir = item.dir || 'NE';
  const delta = DIR_TO_DELTA[dir];

  // Entry is at the back face (opposite of dir), exit at the front face (dir side)
  // Center of entry face:
  const centerSC = item.subCol + Math.floor(gw / 2);
  const centerSR = item.subRow + Math.floor(gh / 2);

  return [
    {
      type: 'entry',
      col: item.col + Math.floor((item.subCol) / 4),
      row: item.row + Math.floor((item.subRow) / 4),
      subCol: item.subCol,
      subRow: centerSR,
    },
    {
      type: 'exit',
      col: item.col + Math.floor((item.subCol + gw - 1) / 4),
      row: item.row + Math.floor((item.subRow + gh - 1) / 4),
      subCol: item.subCol + gw - 1,
      subRow: centerSR,
    },
  ];
}
```

- [ ] **Step 3: Handle beam pipe tool selection**

When the player selects "Beam Pipe" from the palette (the drift component with `isDrawnConnection: true`), set a `beamPipeMode` flag instead of `selectedTool`:

```js
// In the tool selection handler:
if (def.isDrawnConnection) {
  this.beamPipeMode = true;
  this.selectedTool = null;
} else {
  this.beamPipeMode = false;
  // ... normal tool selection
}
```

- [ ] **Step 4: Handle mouse down to start beam pipe drawing**

In the mousedown handler, when `beamPipeMode` is true:

```js
if (this.beamPipeMode) {
  const port = this._detectBeamPort(col, row, subCol, subRow);
  if (port) {
    this.drawingBeamPipe = true;
    this.beamPipeStartId = port.placeableId;
    this.beamPipeStartPort = port.port;
    this.beamPipePath = [{ col, row, subCol, subRow }];
  }
}
```

- [ ] **Step 5: Handle mouse move to extend beam pipe path**

During mousemove while `drawingBeamPipe` is true, extend the path. Constrain to straight lines (horizontal or vertical in grid space):

```js
if (this.drawingBeamPipe) {
  // Add current position to path if it's a straight extension
  const last = this.beamPipePath[this.beamPipePath.length - 1];
  const current = { col, row, subCol, subRow };
  // Only allow straight lines in one axis
  // ... compute path cells between last and current along dominant axis
  this.beamPipePath = this._computeStraightPath(this.beamPipePath[0], current);
}
```

- [ ] **Step 6: Handle mouse up to complete beam pipe**

On mouseup while `drawingBeamPipe` is true:

```js
if (this.drawingBeamPipe) {
  const endPort = this._detectBeamPort(col, row, subCol, subRow);
  if (endPort && endPort.placeableId !== this.beamPipeStartId) {
    // Create beam pipe connection
    this.game.createBeamPipe(
      this.beamPipeStartId,
      endPort.placeableId,
      this.beamPipePath
    );
  }
  this.drawingBeamPipe = false;
  this.beamPipePath = [];
}
```

- [ ] **Step 7: Add createBeamPipe method to Game.js**

```js
/**
 * Create a beam pipe connection between two beamline components.
 * The pipe creates a drift section with length derived from the path.
 */
createBeamPipe(fromId, toId, path) {
  // Validate both are beamline placeables
  const from = this.getPlaceable(fromId);
  const to = this.getPlaceable(toId);
  if (!from || !to) return false;
  if (from.category !== 'beamline' || to.category !== 'beamline') return false;

  // Check for existing pipe between these two
  const existing = this.state.beamPipes.find(
    p => (p.fromId === fromId && p.toId === toId) || (p.fromId === toId && p.toId === fromId)
  );
  if (existing) {
    this.log('Already connected!', 'bad');
    return false;
  }

  // Compute drift length from path (each sub-grid cell = 0.5m)
  const subL = path.length;
  const driftCost = COMPONENTS.drift.cost;
  const totalCost = { funding: Math.floor((driftCost.funding / 4) * subL) }; // scale cost by length

  if (!this.canAfford(totalCost)) {
    this.log("Can't afford beam pipe!", 'bad');
    return false;
  }

  // Check path cells aren't occupied (except at the endpoints)
  for (let i = 1; i < path.length - 1; i++) {
    const cell = path[i];
    const key = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
    if (this.state.subgridOccupied[key]) {
      this.log('Path blocked!', 'bad');
      return false;
    }
  }

  this.spend(totalCost);

  const id = 'bp_' + this.state.beamPipeNextId++;
  const pipe = {
    id,
    fromId,
    toId,
    path: path.map(p => ({ ...p })),
    subL,
  };

  this.state.beamPipes.push(pipe);

  // Occupy path cells (except endpoints which are component ports)
  for (let i = 1; i < path.length - 1; i++) {
    const cell = path[i];
    const key = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
    this.state.subgridOccupied[key] = { id, category: 'beamPipe' };
  }

  this.log(`Connected ${COMPONENTS[from.type]?.name || 'component'} to ${COMPONENTS[to.type]?.name || 'component'}`, 'good');
  this._deriveBeamGraph();
  this.emit('beamlineChanged');
  return true;
}

/**
 * Remove a beam pipe by ID.
 */
removeBeamPipe(pipeId) {
  const idx = this.state.beamPipes.findIndex(p => p.id === pipeId);
  if (idx === -1) return false;

  const pipe = this.state.beamPipes[idx];

  // Free path cells
  for (let i = 1; i < pipe.path.length - 1; i++) {
    const cell = pipe.path[i];
    const key = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
    delete this.state.subgridOccupied[key];
  }

  // 50% refund based on length
  const driftCost = COMPONENTS.drift.cost;
  const refund = Math.floor((driftCost.funding / 4) * pipe.subL * 0.5);
  this.state.resources.funding += refund;

  this.state.beamPipes.splice(idx, 1);
  this.log('Removed beam pipe (50% refund)', 'info');
  this._deriveBeamGraph();
  this.emit('beamlineChanged');
  return true;
}
```

- [ ] **Step 8: Verify — select beam pipe tool, click on a component port, drag to another, release. Verify pipe appears and cost is deducted.**

- [ ] **Step 9: Commit**

```bash
git add src/input/InputHandler.js src/game/Game.js
git commit -m "feat: beam pipe drawing between component ports"
```

---

### Task 10: Beam Graph Derivation from Pipe Connectivity

**Files:**
- Modify: `src/game/Game.js`
- Modify: `src/beamline/Beamline.js`

- [ ] **Step 1: Implement _deriveBeamGraph in Game.js**

This method builds the beam ordering that physics needs by traversing from sources through pipe connections:

```js
/**
 * Derive the beam graph from pipe connectivity.
 * Builds ordered component lists per source, with drift lengths from pipes.
 * Updates state.beamline (the aggregate array used by physics).
 */
_deriveBeamGraph() {
  const beamItems = this.state.placeables.filter(p => p.category === 'beamline');
  const sources = beamItems.filter(p => {
    const def = COMPONENTS[p.type];
    return def && def.isSource;
  });

  // Build adjacency from beam pipes
  // Each pipe connects fromId <-> toId
  const adj = {};  // placeableId -> [{ neighborId, pipeId, subL }]
  for (const pipe of this.state.beamPipes) {
    if (!adj[pipe.fromId]) adj[pipe.fromId] = [];
    if (!adj[pipe.toId]) adj[pipe.toId] = [];
    adj[pipe.fromId].push({ neighborId: pipe.toId, pipeId: pipe.id, subL: pipe.subL });
    adj[pipe.toId].push({ neighborId: pipe.fromId, pipeId: pipe.id, subL: pipe.subL });
  }

  // BFS from each source to build ordered lists
  const allOrdered = [];
  const visited = new Set();

  for (const source of sources) {
    const queue = [source];
    visited.add(source.id);
    let beamStart = 0;

    while (queue.length > 0) {
      const item = queue.shift();
      const def = COMPONENTS[item.type];

      // Create a beam node entry compatible with existing physics
      const node = {
        id: item.id,
        type: item.type,
        col: item.col,
        row: item.row,
        dir: item.dir,
        params: item.params,
        tiles: item.cells.map(c => ({ col: c.col, row: c.row })),
        beamStart,
        subL: def ? (def.subL || 4) : 4,
      };
      allOrdered.push(node);

      // Advance beam position
      beamStart += (def ? (def.subL || 4) : 4) * 0.5;

      // Follow pipes to neighbors
      const neighbors = adj[item.id] || [];
      for (const edge of neighbors) {
        if (visited.has(edge.neighborId)) continue;
        visited.add(edge.neighborId);

        // The pipe itself is a drift section
        const driftNode = {
          id: edge.pipeId,
          type: 'drift',
          col: item.col,
          row: item.row,
          dir: item.dir,
          params: {},
          tiles: [],
          beamStart,
          subL: edge.subL,
        };
        allOrdered.push(driftNode);
        beamStart += edge.subL * 0.5;

        // Queue the neighbor component
        const neighbor = this.getPlaceable(edge.neighborId);
        if (neighbor) queue.push(neighbor);
      }
    }
  }

  // Update aggregate beamline state
  this.state.beamline = allOrdered;

  // Recalculate physics for each beamline entry
  for (const [, entry] of this.registry.beamlines) {
    this.recalcBeamline(entry.id);
  }
}
```

- [ ] **Step 2: Update Beamline.js getOrderedComponents to use derived graph**

Modify `getOrderedComponents()` to return the pre-computed ordered array from `_deriveBeamGraph` instead of doing its own BFS:

```js
getOrderedComponents() {
  // If derived graph is available (from Game._deriveBeamGraph), use it
  if (this._derivedOrder) return this._derivedOrder;

  // Fallback: legacy BFS from parent-child links
  const ordered = [];
  const visited = new Set();
  const sources = this.nodes.filter(n => COMPONENTS[n.type]?.isSource);
  const queue = [...sources];
  for (const s of queue) visited.add(s.id);
  while (queue.length > 0) {
    const node = queue.shift();
    ordered.push(node);
    const children = this.nodes.filter(n => n.parentId === node.id);
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        queue.push(child);
      }
    }
  }
  return ordered;
}
```

- [ ] **Step 3: Call _deriveBeamGraph after any placement change**

At the end of `placePlaceable` (when category is 'beamline') and `removePlaceable` (when category is 'beamline'), call `this._deriveBeamGraph()`.

- [ ] **Step 4: Verify — place two beamline components, draw beam pipe between them. Check that physics simulation sees the correct component ordering and drift lengths.**

Open browser console, inspect `game.state.beamline` after connecting two components with a pipe. Verify the array contains source → drift → component with correct `beamStart` values.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/beamline/Beamline.js
git commit -m "feat: derive beam graph from pipe connectivity"
```

---

### Task 11: Beamline Component Free Placement

**Files:**
- Modify: `src/input/InputHandler.js`
- Modify: `src/game/Game.js`

- [ ] **Step 1: Allow beamline component placement without a parent**

Currently in InputHandler.js (~line 565-582), beamline placement requires either placing a source (if no nodes exist) or placing at a build cursor (requires parent). Change this so all beamline components can be placed freely on the grid:

```js
// Replace the beamline placement block in the space key handler:
if (this.selectedTool) {
  const comp = COMPONENTS[this.selectedTool];
  if (comp && comp.isDrawnConnection) {
    // Beam pipe mode — handled separately
  } else if (comp) {
    this.game._pushUndo();
    this.game.placePlaceable({
      type: this.selectedTool,
      category: 'beamline',
      col: this.renderer.hoverCol,
      row: this.renderer.hoverRow,
      subCol: this.hoverSubCol || 0,
      subRow: this.hoverSubRow || 0,
      rotated: false,
      dir: this.placementDir,
      params: this.selectedParamOverrides,
    });
  }
}
```

- [ ] **Step 2: Remove the build cursor requirement for non-source placement**

The old `placeComponent` method in Game.js requires a cursor with a `parentId`. Keep this method for backwards compatibility but mark it as legacy. New placements go through `placePlaceable` which has no parent requirement.

- [ ] **Step 3: Show disconnected components as dimmed**

In the renderer, beamline components that are not part of any derived beam graph (not reachable from a source via pipes) should render with reduced alpha (0.5) and a "disconnected" icon. Check if the component's id appears in `state.beamline` (the derived ordered array):

```js
// In the sprite rendering loop:
const isConnected = state.beamline.some(n => n.id === placeable.id);
sprite.alpha = isConnected ? 1.0 : 0.5;
```

- [ ] **Step 4: Verify — place a quadrupole by itself on concrete, verify it appears dimmed. Connect it to a source with beam pipe, verify it becomes full brightness.**

- [ ] **Step 5: Commit**

```bash
git add src/input/InputHandler.js src/game/Game.js src/renderer/sprites.js
git commit -m "feat: allow free placement of beamline components, dim disconnected ones"
```

---

### Task 12: Beam Pipe Rendering

**Files:**
- Modify: `src/renderer/sprites.js` or `src/renderer/overlays.js`

- [ ] **Step 1: Render beam pipes as lines between components**

Add beam pipe rendering that draws a line along each pipe's path cells:

```js
/**
 * Render all beam pipes as colored lines through their path cells.
 */
function renderBeamPipes(gfx, state, camera) {
  const PIPE_COLOR = 0x44cc44;
  const PIPE_WIDTH = 2;

  for (const pipe of state.beamPipes) {
    if (pipe.path.length < 2) continue;

    gfx.lineStyle(PIPE_WIDTH, PIPE_COLOR, 0.8);

    for (let i = 0; i < pipe.path.length; i++) {
      const cell = pipe.path[i];
      const tilePos = gridToIso(cell.col, cell.row, camera);
      const subOffset = subGridToIso(cell.subCol + 0.5, cell.subRow + 0.5);
      const sx = tilePos.x + subOffset.x;
      const sy = tilePos.y + subOffset.y;

      if (i === 0) {
        gfx.moveTo(sx, sy);
      } else {
        gfx.lineTo(sx, sy);
      }
    }
  }
}
```

Call this from the main render loop, after rendering components but before overlays.

- [ ] **Step 2: Render port indicators on beamline components**

When in beam pipe mode, show small circles at each component's entry/exit ports:

```js
function renderBeamPorts(gfx, state, camera) {
  const beamItems = (state.placeables || []).filter(p => p.category === 'beamline');
  for (const item of beamItems) {
    const def = COMPONENTS[item.type];
    if (!def || def.isDrawnConnection) continue;

    const ports = computePorts(item, def);
    for (const port of ports) {
      const tilePos = gridToIso(port.col, port.row, camera);
      const subOffset = subGridToIso(port.subCol + 0.5, port.subRow + 0.5);
      // Draw small circle
      gfx.beginFill(0x44ff44, 0.6);
      gfx.drawCircle(tilePos.x + subOffset.x, tilePos.y + subOffset.y, 3);
      gfx.endFill();
    }
  }
}
```

- [ ] **Step 3: Render beam pipe preview during drawing**

While `drawingBeamPipe` is true, render the in-progress path as a translucent green line:

```js
if (inputHandler.drawingBeamPipe && inputHandler.beamPipePath.length > 0) {
  gfx.lineStyle(2, 0x44ff44, 0.4);
  for (let i = 0; i < inputHandler.beamPipePath.length; i++) {
    const cell = inputHandler.beamPipePath[i];
    const tilePos = gridToIso(cell.col, cell.row, camera);
    const subOffset = subGridToIso(cell.subCol + 0.5, cell.subRow + 0.5);
    const sx = tilePos.x + subOffset.x;
    const sy = tilePos.y + subOffset.y;
    if (i === 0) gfx.moveTo(sx, sy);
    else gfx.lineTo(sx, sy);
  }
}
```

- [ ] **Step 4: Verify — select beam pipe tool, see green port indicators on components. Draw pipe, see preview. Complete pipe, see solid line.**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/sprites.js src/renderer/overlays.js
git commit -m "feat: render beam pipes, ports, and drawing preview"
```

---

### Task 13: Clean Up Legacy Code

**Files:**
- Modify: `src/game/Game.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Remove old facilityEquipment-specific state from constructor**

In Game.js constructor, remove these lines (the compatibility layer keeps them populated, but they're no longer the source of truth):

```js
// Remove from state init:
// facilityEquipment: [],
// facilityGrid: {},
// facilityNextId: 1,
// zoneFurnishings: [],
// zoneFurnishingSubgrids: {},
// zoneFurnishingNextId: 1,
```

Keep the fields populated by the compatibility layer in `placePlaceable`/`removePlaceable` so existing renderers don't break.

- [ ] **Step 2: Remove old placeFacilityEquipment and removeFacilityEquipment method bodies**

These are now one-line delegations to `placePlaceable`/`removePlaceable`. Keep the wrapper methods for API compatibility but add a `// Legacy wrapper — delegates to placePlaceable` comment.

- [ ] **Step 3: Remove old placeZoneFurnishing and removeZoneFurnishing method bodies**

Same as step 2 — they're one-line delegations now. Keep wrappers, add legacy comment.

- [ ] **Step 4: Remove selectedFacilityTool / selectedFurnishingTool distinction in InputHandler**

Merge `selectedFacilityTool` and `selectedFurnishingTool` into a single `selectedPlaceableTool` with a `selectedPlaceableCategory`. Update all references:

In the space key handler:
```js
} else if (this.selectedPlaceableTool) {
  const category = this.selectedPlaceableCategory;
  this.game.placePlaceable({
    type: this.selectedPlaceableTool,
    category,
    col: this.renderer.hoverCol,
    row: this.renderer.hoverRow,
    subCol: this.hoverSubCol || 0,
    subRow: this.hoverSubRow || 0,
    rotated: this.furnishingRotated,
  });
}
```

Update tool selection methods (`selectFurnishingTool`, `selectFacilityTool`) to set these unified fields.

- [ ] **Step 5: Verify full game loop — place beamline components, equipment, furnishings. Draw beam pipes. Delete items. Save and reload. Verify everything works.**

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js src/input/InputHandler.js
git commit -m "refactor: clean up legacy placement code, unify tool selection"
```

---

## Summary

After all 13 tasks:
- All placeables use one sub-grid occupancy system
- Costs are consistently `{ funding: X }` everywhere
- All furnishings have `energyCost` and draw from power networks
- Beamline components can be placed freely and connected later with drawn beam pipe
- Beam graph is derived from pipe connectivity
- Selection, delete, and highlighting work the same for all item categories
- Old save formats migrate automatically
