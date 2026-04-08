# Multi-Beamline & Context Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the game from a single-beamline to a multi-beamline facility manager with RCT2-style context windows and per-beamline edit mode.

**Architecture:** A new `BeamlineRegistry` manages multiple `Beamline` instances, each with independent beam state, physics, and economy. `Game.js` is refactored to iterate over all beamlines in its tick loop. Context windows are DOM-based draggable panels. Edit mode isolates interaction to one beamline at a time.

**Tech Stack:** Vanilla JS (ES modules), PixiJS (CDN global), Pyodide (beam physics), DOM for UI panels.

**Spec:** `docs/superpowers/specs/2026-04-07-multi-beamline-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/beamline/BeamlineRegistry.js` | Manages multiple Beamline instances, shared occupancy grid, beamline CRUD, serialization |
| `src/ui/ContextWindow.js` | Draggable window base class — create DOM, drag, tabs, z-order, close |
| `src/ui/BeamlineWindow.js` | Beamline-specific tab content: overview, stats, components, settings, finance, utilities |
| `src/ui/MachineWindow.js` | Machine-specific tab content: overview, upgrades, settings, finance |
| `test/test-registry.js` | Tests for BeamlineRegistry |

### Modified Files
| File | Changes |
|------|---------|
| `src/main.js` | Create registry instead of single Beamline, pass to Game |
| `src/game/Game.js` | Use registry, per-beamline tick/physics/state, edit mode, save v6, v5 migration |
| `src/game/economy.js` | Accept all beamline nodes as aggregated array |
| `src/input/InputHandler.js` | Edit mode gating, source creates new beamline, click-to-select |
| `src/renderer/beamline-renderer.js` | Per-beamline opacity, filtered build cursors |
| `src/renderer/hud.js` | Remove global beam button, selected beamline stats, beam summary |
| `src/renderer/overlays.js` | Wire context window open on component click |
| `index.html` | Remove `#btn-toggle-beam`, add `#context-windows-container`, beam summary indicator |
| `style.css` | Context window styles, edit mode dimming |

---

### Task 1: BeamlineRegistry — Core Data Model

**Files:**
- Create: `src/beamline/BeamlineRegistry.js`
- Create: `test/test-registry.js`

- [ ] **Step 1: Write the test file**

```js
// test/test-registry.js
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Beamline } from '../src/beamline/Beamline.js';
import { COMPONENTS } from '../src/data/components.js';
import { DIR } from '../src/data/directions.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}
function assertEq(a, b, msg) {
  if (a === b) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg} (expected ${b}, got ${a})`); }
}

console.log('\n=== BeamlineRegistry Tests ===\n');

// Test 1: Create a beamline
console.log('-- Create beamline --');
{
  const reg = new BeamlineRegistry();
  const entry = reg.createBeamline('linac');
  assert(entry !== null, 'createBeamline returns an entry');
  assertEq(entry.id, 'bl-1', 'first beamline id is bl-1');
  assertEq(entry.name, 'Beamline-1', 'auto-name is Beamline-1');
  assertEq(entry.status, 'stopped', 'starts stopped');
  assertEq(entry.beamState.machineType, 'linac', 'machine type is linac');
  assert(entry.beamline instanceof Beamline, 'has a Beamline instance');
}

// Test 2: Multiple beamlines
console.log('-- Multiple beamlines --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  const e2 = reg.createBeamline('photoinjector');
  assertEq(reg.getAll().length, 2, 'registry has 2 beamlines');
  assertEq(e2.name, 'Beamline-2', 'second is Beamline-2');
  assertEq(e2.beamState.machineType, 'photoinjector', 'second is photoinjector');
}

// Test 3: Get by ID
console.log('-- Get by ID --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  const found = reg.get('bl-1');
  assertEq(found.id, 'bl-1', 'get returns correct entry');
  assertEq(reg.get('bl-999'), undefined, 'get returns undefined for unknown id');
}

// Test 4: Shared occupancy
console.log('-- Shared occupancy --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  const e2 = reg.createBeamline('linac');
  // Place source on beamline 1
  const id1 = e1.beamline.placeSource(5, 5, DIR.NE);
  reg.occupyTiles(e1.id, e1.beamline.getAllNodes()[0]);
  // Try to place source on beamline 2 at same spot
  assert(reg.isTileOccupied(5, 5), 'tile 5,5 is occupied after placing on bl-1');
  assert(!reg.isTileOccupied(10, 10), 'tile 10,10 is free');
}

// Test 5: Remove beamline
console.log('-- Remove beamline --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  e1.beamline.placeSource(5, 5, DIR.NE);
  reg.occupyTiles(e1.id, e1.beamline.getAllNodes()[0]);
  reg.removeBeamline('bl-1');
  assertEq(reg.getAll().length, 0, 'registry is empty after remove');
  assert(!reg.isTileOccupied(5, 5), 'tiles freed after remove');
}

// Test 6: Serialization round-trip
console.log('-- Serialization --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  e1.name = 'My Linac';
  e1.status = 'running';
  e1.beamline.placeSource(5, 5, DIR.NE);
  reg.occupyTiles(e1.id, e1.beamline.getAllNodes()[0]);

  const json = reg.toJSON();
  const reg2 = new BeamlineRegistry();
  reg2.fromJSON(json);
  const restored = reg2.get('bl-1');
  assertEq(restored.name, 'My Linac', 'name survives round-trip');
  assertEq(restored.status, 'running', 'status survives round-trip');
  assertEq(restored.beamState.machineType, 'linac', 'machineType survives round-trip');
  assertEq(restored.beamline.getAllNodes().length, 1, 'beamline nodes survive round-trip');
  assert(reg2.isTileOccupied(5, 5), 'shared occupancy rebuilt on load');
}

// Test 7: getAllNodes aggregates across beamlines
console.log('-- getAllNodes aggregate --');
{
  const reg = new BeamlineRegistry();
  const e1 = reg.createBeamline('linac');
  const e2 = reg.createBeamline('linac');
  e1.beamline.placeSource(0, 0, DIR.NE);
  e2.beamline.placeSource(10, 10, DIR.NE);
  const all = reg.getAllNodes();
  assertEq(all.length, 2, 'getAllNodes returns nodes from all beamlines');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-vm-modules test/test-registry.js`
Expected: FAIL — `BeamlineRegistry` does not exist yet.

- [ ] **Step 3: Implement BeamlineRegistry**

```js
// src/beamline/BeamlineRegistry.js
import { Beamline } from './Beamline.js';

function makeDefaultBeamState(machineType) {
  return {
    beamEnergy: 0,
    beamCurrent: 0,
    beamQuality: 1,
    dataRate: 0,
    luminosity: 0,
    totalLength: 0,
    totalEnergyCost: 0,
    beamOnTicks: 0,
    continuousBeamTicks: 0,
    uptimeFraction: 1,
    totalBeamHours: 0,
    totalDataCollected: 0,
    physicsAlive: true,
    physicsEnvelope: null,
    discoveryChance: 0,
    photonRate: 0,
    collisionRate: 0,
    totalLossFraction: 0,
    componentHealth: {},
    felSaturated: false,
    machineType: machineType,
  };
}

export class BeamlineRegistry {
  constructor() {
    this.beamlines = new Map();
    this.sharedOccupied = {};  // "col,row" -> { beamlineId, nodeId }
    this.nextBeamlineId = 1;
  }

  createBeamline(machineType) {
    const id = `bl-${this.nextBeamlineId}`;
    const entry = {
      id,
      name: `Beamline-${this.nextBeamlineId}`,
      status: 'stopped',
      beamline: new Beamline(),
      beamState: makeDefaultBeamState(machineType),
    };
    this.nextBeamlineId++;
    this.beamlines.set(id, entry);
    return entry;
  }

  get(id) {
    return this.beamlines.get(id);
  }

  getAll() {
    return Array.from(this.beamlines.values());
  }

  /** Get all nodes across all beamlines, each annotated with beamlineId */
  getAllNodes() {
    const all = [];
    for (const entry of this.beamlines.values()) {
      for (const node of entry.beamline.getAllNodes()) {
        all.push(node);
      }
    }
    return all;
  }

  /** Find which beamline a node belongs to by nodeId */
  getBeamlineForNode(nodeId) {
    for (const entry of this.beamlines.values()) {
      if (entry.beamline.getAllNodes().some(n => n.id === nodeId)) {
        return entry;
      }
    }
    return null;
  }

  /** Register a node's tiles in the shared occupancy grid */
  occupyTiles(beamlineId, node) {
    const tiles = node.tiles || [{ col: node.col, row: node.row }];
    for (const t of tiles) {
      this.sharedOccupied[t.col + ',' + t.row] = { beamlineId, nodeId: node.id };
    }
  }

  /** Free a node's tiles from the shared occupancy grid */
  freeTiles(node) {
    const tiles = node.tiles || [{ col: node.col, row: node.row }];
    for (const t of tiles) {
      delete this.sharedOccupied[t.col + ',' + t.row];
    }
  }

  isTileOccupied(col, row) {
    return this.sharedOccupied[col + ',' + row] !== undefined;
  }

  removeBeamline(id) {
    const entry = this.beamlines.get(id);
    if (!entry) return false;
    // Free all tiles
    for (const node of entry.beamline.getAllNodes()) {
      this.freeTiles(node);
    }
    this.beamlines.delete(id);
    return true;
  }

  toJSON() {
    const entries = [];
    for (const entry of this.beamlines.values()) {
      entries.push({
        id: entry.id,
        name: entry.name,
        status: entry.status,
        beamState: JSON.parse(JSON.stringify(entry.beamState)),
        beamline: entry.beamline.toJSON(),
      });
    }
    return { entries, nextBeamlineId: this.nextBeamlineId };
  }

  fromJSON(data) {
    this.beamlines.clear();
    this.sharedOccupied = {};
    this.nextBeamlineId = data.nextBeamlineId;
    for (const item of data.entries) {
      const beamline = new Beamline();
      beamline.fromJSON(item.beamline);
      const entry = {
        id: item.id,
        name: item.name,
        status: item.status,
        beamline,
        beamState: item.beamState,
      };
      this.beamlines.set(item.id, entry);
      // Rebuild shared occupancy
      for (const node of beamline.getAllNodes()) {
        this.occupyTiles(item.id, node);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-vm-modules test/test-registry.js`
Expected: All 7 test groups PASS.

- [ ] **Step 5: Commit**

```bash
git add src/beamline/BeamlineRegistry.js test/test-registry.js
git commit -m "feat: add BeamlineRegistry for multi-beamline support"
```

---

### Task 2: Refactor Game.js — Registry Integration & Per-Beamline State

**Files:**
- Modify: `src/game/Game.js`
- Modify: `src/main.js`

This is the largest refactor. `Game` takes a `BeamlineRegistry` instead of a single `Beamline`. Per-beamline state fields move out of `Game.state` and into each beamline entry's `beamState`.

- [ ] **Step 1: Update `main.js` to create registry**

In `src/main.js`, replace the single `Beamline` construction with a `BeamlineRegistry`:

```js
// Replace:
//   import { Beamline } from './beamline/Beamline.js';
// With:
import { BeamlineRegistry } from './beamline/BeamlineRegistry.js';

// Replace:
//   const beamline = new Beamline();
//   const game = new Game(beamline);
// With:
const registry = new BeamlineRegistry();
const game = new Game(registry);
```

Keep the rest of `main.js` the same for now — later tasks will update the beam button and event wiring.

- [ ] **Step 2: Refactor Game constructor to accept registry**

In `src/game/Game.js`, change the constructor:

```js
// Replace:
//   constructor(beamline) {
//     this.beamline = beamline;
// With:
constructor(registry) {
  this.registry = registry;
  // For backwards compat during refactor, point this.beamline at first beamline if any
  this.beamline = null;
```

Add edit mode state to the constructor:

```js
    // Edit mode
    this.editingBeamlineId = null;
    this.selectedBeamlineId = null;
```

Remove these per-beamline fields from `this.state` (they now live in `entry.beamState`):

```
beamOn, beamEnergy, luminosity, beamQuality, beamCurrent, totalLossFraction,
discoveryChance, photonRate, collisionRate, physicsEnvelope, physicsAlive,
totalLength, totalEnergyCost, dataRate, totalBeamHours, continuousBeamTicks,
beamOnTicks, uptimeFraction, componentHealth, felSaturated, machineType,
totalDataCollected, avgPressure, finalNormEmittanceX, finalBunchLength
```

Keep `this.state.beamline` as a computed aggregate (all nodes across all beamlines) for network validation:

```js
    this.state.beamline = [];  // aggregate of all beamline nodes, recomputed on change
```

- [ ] **Step 3: Refactor `placeSource` to create a new beamline**

Replace the existing `placeSource` method:

```js
placeSource(col, row, dir, sourceType = 'source') {
  const template = COMPONENTS[sourceType];
  if (!template) return false;
  if (!this.isComponentUnlocked(template)) return false;
  if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }

  // Determine machine type from source type
  const SOURCE_TO_MACHINE = {
    source: 'linac',
    dcPhotoGun: 'photoinjector', ncRfGun: 'photoinjector', srfGun: 'photoinjector',
  };
  const machineType = SOURCE_TO_MACHINE[sourceType] || 'linac';

  // Create new beamline entry
  const entry = this.registry.createBeamline(machineType);

  // Check shared occupancy
  if (this.registry.isTileOccupied(col, row)) {
    this.log("Can't place there!", 'bad');
    this.registry.removeBeamline(entry.id);
    return false;
  }

  const nodeId = entry.beamline.placeSource(col, row, dir);
  if (nodeId == null) {
    this.log("Can't place there!", 'bad');
    this.registry.removeBeamline(entry.id);
    return false;
  }

  // Register tiles in shared grid
  const node = entry.beamline.getAllNodes().find(n => n.id === nodeId);
  this.registry.occupyTiles(entry.id, node);

  this.spend(template.cost);
  this.recalcBeamline(entry.id);
  this.log(`Built ${template.name} — started ${entry.name}`, 'good');

  // Auto-enter edit mode for new beamline
  this.editingBeamlineId = entry.id;
  this.selectedBeamlineId = entry.id;

  this.emit('beamlineChanged');
  return entry.id;
}
```

- [ ] **Step 4: Refactor `placeComponent` to work with edit mode**

```js
placeComponent(cursor, compType, bendDir) {
  if (!this.editingBeamlineId) {
    this.log('Select a beamline to edit first!', 'bad');
    return false;
  }
  const entry = this.registry.get(this.editingBeamlineId);
  if (!entry) return false;

  const template = COMPONENTS[compType];
  if (!template) return false;
  if (!this.isComponentUnlocked(template)) return false;
  if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }
  if (template.maxCount) {
    const count = entry.beamline.nodes.filter(n => n.type === compType).length;
    if (count >= template.maxCount) {
      this.log(`Max ${template.name} reached.`, 'bad'); return false;
    }
  }

  const nodeId = entry.beamline.placeAt(cursor, compType, bendDir);
  if (nodeId == null) { this.log("Can't place there!", 'bad'); return false; }

  // Register tiles in shared grid
  const node = entry.beamline.getAllNodes().find(n => n.id === nodeId);
  this.registry.occupyTiles(entry.id, node);

  this.spend(template.cost);
  this.recalcBeamline(entry.id);
  this.log(`Built ${template.name}`, 'good');
  this.emit('beamlineChanged');
  return true;
}
```

- [ ] **Step 5: Refactor `removeComponent` to work with registry**

```js
removeComponent(nodeId) {
  const entry = this.registry.getBeamlineForNode(nodeId);
  if (!entry) return false;
  // Only allow removal if editing this beamline (or no edit mode restriction for demolish)
  if (this.editingBeamlineId && this.editingBeamlineId !== entry.id) return false;

  const node = entry.beamline.nodes.find(n => n.id === nodeId);
  if (!node) return false;

  const template = COMPONENTS[node.type];

  // Free shared tiles before removal
  this.registry.freeTiles(node);

  const removed = entry.beamline.removeNode(nodeId);
  if (!removed) {
    // Re-occupy if removal failed
    this.registry.occupyTiles(entry.id, node);
    this.log('Can only remove end pieces!', 'bad');
    return false;
  }

  // 50% refund
  if (template) {
    for (const [r, a] of Object.entries(template.cost))
      this.state.resources[r] += Math.floor(a * 0.5);
  }

  // If beamline is now empty, remove it from registry
  if (entry.beamline.getAllNodes().length === 0) {
    this.registry.removeBeamline(entry.id);
    if (this.editingBeamlineId === entry.id) this.editingBeamlineId = null;
    if (this.selectedBeamlineId === entry.id) this.selectedBeamlineId = null;
    this.log(`${entry.name} demolished`, 'info');
  }

  this.recalcAllBeamlines();
  this.log(`Demolished ${template ? template.name : 'component'} (50% refund)`, 'info');
  this.emit('beamlineChanged');
  return true;
}
```

- [ ] **Step 6: Refactor `recalcBeamline` to be per-beamline**

```js
recalcBeamline(beamlineId) {
  const entry = this.registry.get(beamlineId);
  if (!entry) return;

  const ordered = entry.beamline.getOrderedComponents();

  // Calculate energy cost and total length
  let tLen = 0, tCost = 0, hasSrc = false;
  const ecm = this.getEffect('energyCostMult', 1);
  for (const node of ordered) {
    const t = COMPONENTS[node.type];
    if (!t) continue;
    tLen += t.length;
    tCost += t.energyCost * ecm;
    if (t.isSource) hasSrc = true;
  }
  entry.beamState.totalLength = tLen;
  entry.beamState.totalEnergyCost = Math.ceil(tCost);

  if (!hasSrc) {
    entry.beamState.beamEnergy = 0;
    entry.beamState.dataRate = 0;
    entry.beamState.beamQuality = 1;
    entry.beamState.luminosity = 0;
    entry.beamState.physicsEnvelope = null;
    this._updateAggregateBeamline();
    return;
  }

  // Build physics beamline
  const physicsBeamline = ordered.map(node => {
    const t = COMPONENTS[node.type];
    const effectiveStats = { ...(t.stats || {}) };
    if (node.computedStats) Object.assign(effectiveStats, node.computedStats);
    return { type: node.type, length: t.length, stats: effectiveStats, params: node.params || {} };
  });

  const researchEffects = {};
  for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance',
                      'vacuumQuality', 'beamStability', 'photonFluxMult', 'cryoEfficiencyMult',
                      'beamLifetimeMult', 'diagnosticPrecision']) {
    const v = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
    researchEffects[key] = v;
  }
  researchEffects.machineType = entry.beamState.machineType;

  this.runPhysicsForBeamline(entry, physicsBeamline, researchEffects);
  this._updateAggregateBeamline();
  this.validateInfrastructure();
}

recalcAllBeamlines() {
  for (const entry of this.registry.getAll()) {
    this.recalcBeamline(entry.id);
  }
}

/** Rebuild the aggregate beamline array used by network validation and economy */
_updateAggregateBeamline() {
  this.state.beamline = this.registry.getAllNodes();
}
```

- [ ] **Step 7: Refactor `runPhysics` to be per-beamline**

```js
runPhysicsForBeamline(entry, physicsBeamline, researchEffects) {
  if (!BeamPhysics.isReady()) {
    this._fallbackStatsForBeamline(entry, physicsBeamline);
    return;
  }

  const result = BeamPhysics.compute(physicsBeamline, researchEffects);
  if (!result) {
    this._fallbackStatsForBeamline(entry, physicsBeamline);
    return;
  }

  const bs = entry.beamState;
  bs.beamEnergy = result.beamEnergy;
  bs.dataRate = result.dataRate;
  bs.beamQuality = result.beamQuality;
  bs.luminosity = result.luminosity || 0;
  bs.physicsAlive = result.beamAlive;
  bs.beamCurrent = result.beamCurrent;
  bs.totalLossFraction = result.totalLossFraction;
  bs.discoveryChance = result.discoveryChance || 0;
  bs.photonRate = result.photonRate || 0;
  bs.collisionRate = result.collisionRate || 0;
  bs.physicsEnvelope = result.envelope || null;

  if (entry.status === 'running' && !result.beamAlive) {
    entry.status = 'faulted';
    this.log(`${entry.name} TRIPPED — too much loss!`, 'bad');
    this.emit('beamlineStatusChanged', entry.id);
  }
}

_fallbackStatsForBeamline(entry, physicsBeamline) {
  let eGain = 0, dRate = 0, bq = 1;
  for (const el of physicsBeamline) {
    const s = el.stats || {};
    if (s.energyGain) eGain += s.energyGain;
    if (s.dataRate) dRate += s.dataRate;
    if (s.beamQuality) bq += s.beamQuality;
  }
  const bs = entry.beamState;
  bs.beamEnergy = eGain;
  bs.dataRate = dRate * bq;
  bs.beamQuality = bq;
  bs.luminosity = 0;
  bs.physicsAlive = true;
  bs.beamCurrent = 0;
  bs.totalLossFraction = 0;
  bs.discoveryChance = 0;
  bs.photonRate = 0;
  bs.collisionRate = 0;
  bs.physicsEnvelope = null;
}
```

- [ ] **Step 8: Refactor tick loop for multi-beamline**

Replace the beam-related section of `tick()` (lines 1005–1087 currently) with:

```js
// Per-beamline tick
for (const entry of this.registry.getAll()) {
  if (entry.status === 'running') {
    this._tickBeamline(entry);
  }
}
```

Add the new `_tickBeamline` method:

```js
_tickBeamline(entry) {
  const bs = entry.beamState;
  bs.continuousBeamTicks++;
  bs.beamOnTicks++;

  // Data from detectors
  if (bs.dataRate > 0) {
    let connectedDataRate = bs.dataRate;
    if (this.state.networkData) {
      const dataConnected = new Set();
      for (const net of (this.state.networkData.dataFiber || [])) {
        const hasIoc = net.equipment.some(eq => eq.type === 'rackIoc');
        const reachesControlRoom = Networks.touchesControlRoom(this.state, net);
        if (hasIoc && reachesControlRoom) {
          for (const node of net.beamlineNodes) dataConnected.add(node.id);
        }
      }
      // Only count diagnostics on THIS beamline
      const blNodes = new Set(entry.beamline.getAllNodes().map(n => n.id));
      let totalDiagRate = 0, connDiagRate = 0;
      for (const node of entry.beamline.getOrderedComponents()) {
        const comp = COMPONENTS[node.type];
        if (comp && (comp.stats?.dataRate || 0) > 0) {
          totalDiagRate += comp.stats.dataRate;
          if (dataConnected.has(node.id)) connDiagRate += comp.stats.dataRate;
        }
      }
      if (totalDiagRate > 0) {
        connectedDataRate = bs.dataRate * (connDiagRate / totalDiagRate);
      }
    }
    const sciMult = 1 + this.state.staff.scientists * 0.1;
    const dataGain = connectedDataRate * sciMult;
    this.state.resources.data += dataGain;
    bs.totalDataCollected += dataGain;
  }

  // Photon data
  if (bs.photonRate > 0) {
    const photonData = bs.photonRate * 0.1 * bs.beamQuality;
    this.state.resources.data += photonData;
    bs.totalDataCollected += photonData;
  }

  // User beam hours from photon ports
  const photonPorts = entry.beamline.getOrderedComponents().filter(c => c.type === 'photonPort');
  if (photonPorts.length > 0 && bs.beamQuality > 0.5) {
    const beamHoursThisTick = photonPorts.length * (1 / 3600);
    bs.totalBeamHours += beamHoursThisTick;
    const userFees = photonPorts.length * 2 * bs.beamQuality;
    this.state.resources.funding += userFees;
    this.state.resources.reputation += photonPorts.length * 0.001;
  }

  // Discovery chance
  const dc = bs.discoveryChance || 0;
  if (dc > 0 && Math.random() < dc) {
    this.state.discoveries++;
    this.log(`*** DISCOVERY on ${entry.name}! ***`, 'reward');
    this.state.resources.reputation += 10;
    this.state.resources.funding += 5000;
  }

  // Reputation from beam quality
  if (this.state.tick % 60 === 0 && bs.beamQuality > 0.3) {
    this.state.resources.reputation += bs.beamQuality * 0.6;
  }

  // Component wear
  if (this.state.tick % 10 === 0) {
    this._applyWearForBeamline(entry);
  }

  // Per-beamline uptime
  if (this.state.tick > 0) {
    bs.uptimeFraction = bs.beamOnTicks / this.state.tick;
  }
}
```

- [ ] **Step 9: Refactor wear/repair to be per-beamline**

```js
_applyWearForBeamline(entry) {
  for (const node of entry.beamline.getOrderedComponents()) {
    const t = COMPONENTS[node.type];
    if (!t) continue;
    if (entry.beamState.componentHealth[node.id] === undefined) {
      entry.beamState.componentHealth[node.id] = 100;
    }
    const baseWear = 0.01 + (t.energyCost || 0) * 0.002;
    const hasMPS = (this.state.facilityEquipment || []).some(eq => eq.type === 'mps');
    const wearMult = hasMPS ? 1 : 2;
    entry.beamState.componentHealth[node.id] = Math.max(0,
      entry.beamState.componentHealth[node.id] - baseWear * wearMult);

    if (entry.beamState.componentHealth[node.id] < 20 && Math.random() < 0.05) {
      entry.beamState.componentHealth[node.id] = 0;
      this.log(`${t.name} FAILED on ${entry.name}! Repair needed.`, 'bad');
    }
  }
}

_autoRepair() {
  const repairRate = this.state.staff.technicians * 2;
  let remaining = repairRate;
  for (const entry of this.registry.getAll()) {
    for (const node of entry.beamline.getOrderedComponents()) {
      if (remaining <= 0) return;
      const health = entry.beamState.componentHealth[node.id];
      if (health !== undefined && health < 100) {
        const repair = Math.min(remaining, 100 - health);
        entry.beamState.componentHealth[node.id] += repair;
        remaining -= repair;
      }
    }
  }
}

getComponentHealth(id) {
  for (const entry of this.registry.getAll()) {
    if (entry.beamState.componentHealth[id] !== undefined) {
      return entry.beamState.componentHealth[id];
    }
  }
  return 100;
}
```

- [ ] **Step 10: Add per-beamline beam toggle**

```js
toggleBeam(beamlineId) {
  const entry = this.registry.get(beamlineId);
  if (!entry) return false;

  if (entry.status === 'running') {
    entry.status = 'stopped';
    entry.beamState.continuousBeamTicks = 0;
    this.log(`${entry.name} beam OFF`, 'info');
  } else {
    // Check if networks are OK for this beamline
    if (!this.state.infraCanRun) {
      this.log(`Can't start ${entry.name} — infrastructure issues`, 'bad');
      return false;
    }
    entry.status = 'running';
    this.log(`${entry.name} beam ON`, 'good');
  }
  this.emit('beamlineStatusChanged', entry.id);
  return true;
}
```

- [ ] **Step 11: Refactor `validateInfrastructure` for per-beamline faulting**

After the existing global validation, add per-beamline fault attribution:

```js
validateInfrastructure() {
  this._updateAggregateBeamline();
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

  // Per-beamline fault attribution
  if (!result.canRun) {
    for (const entry of this.registry.getAll()) {
      if (entry.status !== 'running') continue;
      const blNodeIds = new Set(entry.beamline.getAllNodes().map(n => n.id));
      const affected = result.blockers.some(b => b.nodeId && blNodeIds.has(b.nodeId));
      if (affected) {
        entry.status = 'faulted';
        const reason = result.blockers.find(b => b.nodeId && blNodeIds.has(b.nodeId))?.reason || 'Infrastructure failure';
        this.log(`${entry.name} TRIPPED: ${reason}`, 'bad');
        this.emit('beamlineStatusChanged', entry.id);
      }
    }
  }

  this.emit('infrastructureValidated');
}
```

- [ ] **Step 12: Refactor `checkInjectorLinks` for multi-beamline**

```js
checkInjectorLinks() {
  const allOccupied = this.registry.sharedOccupied;
  for (const machine of this.state.machines) {
    const def = MACHINES[machine.type];
    if (!def?.canLink) continue;
    machine.injectorQuality = null;

    for (let dx = -1; dx <= def.w && machine.injectorQuality == null; dx++) {
      for (let dy = -1; dy <= def.h && machine.injectorQuality == null; dy++) {
        if (dx >= 0 && dx < def.w && dy >= 0 && dy < def.h) continue;
        const key = (machine.col + dx) + ',' + (machine.row + dy);
        if (allOccupied[key] !== undefined) {
          // Find which beamline this node belongs to
          const blId = allOccupied[key].beamlineId;
          const entry = this.registry.get(blId);
          if (entry) {
            machine.injectorQuality = entry.beamState.beamQuality || 0;
          }
        }
      }
    }
  }
}
```

- [ ] **Step 13: Refactor save/load for v6**

```js
save() {
  const connObj = {};
  for (const [key, set] of this.state.connections) {
    connObj[key] = Array.from(set);
  }
  const saveState = { ...this.state, connections: connObj };
  localStorage.setItem('beamlineTycoon', JSON.stringify({
    version: 6,
    state: saveState,
    beamlines: this.registry.toJSON(),
  }));
}

load() {
  const raw = localStorage.getItem('beamlineTycoon');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);

    // v5 migration
    if (data.version === 5) {
      return this._migrateV5(data);
    }

    if (!data.version || data.version < 6) {
      localStorage.removeItem('beamlineTycoon');
      return false;
    }

    Object.assign(this.state, data.state);
    this.registry.fromJSON(data.beamlines);

    // Rebuild infraOccupied, zoneOccupied, machineGrid, connections (same as before)
    this.state.infraOccupied = {};
    if (this.state.infrastructure) {
      for (const tile of this.state.infrastructure)
        this.state.infraOccupied[tile.col + ',' + tile.row] = tile.type;
    } else { this.state.infrastructure = []; }

    this.state.zones = this.state.zones || [];
    this.state.zoneOccupied = {};
    for (const z of this.state.zones) {
      this.state.zoneOccupied[z.col + ',' + z.row] = z.type;
    }
    this.state.zoneConnectivity = {};
    this.recomputeZoneConnectivity();

    this.state.machineGrid = {};
    if (this.state.machines) {
      for (const m of this.state.machines) {
        const def = MACHINES[m.type];
        if (!def) continue;
        for (let dy = 0; dy < def.h; dy++)
          for (let dx = 0; dx < def.w; dx++)
            this.state.machineGrid[(m.col + dx) + ',' + (m.row + dy)] = m.id;
      }
    } else { this.state.machines = []; }

    if (this.state.connections && !(this.state.connections instanceof Map)) {
      const map = new Map();
      for (const [key, arr] of Object.entries(this.state.connections)) {
        map.set(key, new Set(arr));
      }
      this.state.connections = map;
    } else if (!this.state.connections) {
      this.state.connections = new Map();
    }

    if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
    if (!this.state.facilityGrid) this.state.facilityGrid = {};
    if (!this.state.facilityNextId) this.state.facilityNextId = 1;
    if (!this.state.zoneFurnishings) this.state.zoneFurnishings = [];
    if (!this.state.zoneFurnishingGrid) this.state.zoneFurnishingGrid = {};
    if (!this.state.zoneFurnishingNextId) this.state.zoneFurnishingNextId = 1;

    delete this.state.resources.energy;

    this._updateAggregateBeamline();
    this.recalcAllBeamlines();
    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

_migrateV5(data) {
  // Restore global state
  Object.assign(this.state, data.state);

  // Create single beamline from v5 data
  const wasBeamOn = this.state.beamOn;
  const entry = this.registry.createBeamline(this.state.machineType || 'linac');
  entry.name = 'Beamline-1';
  entry.status = wasBeamOn ? 'running' : 'stopped';

  // Move beam state fields
  const bs = entry.beamState;
  bs.beamEnergy = this.state.beamEnergy || 0;
  bs.beamCurrent = this.state.beamCurrent || 0;
  bs.beamQuality = this.state.beamQuality || 1;
  bs.dataRate = this.state.dataRate || 0;
  bs.luminosity = this.state.luminosity || 0;
  bs.totalLength = this.state.totalLength || 0;
  bs.totalEnergyCost = this.state.totalEnergyCost || 0;
  bs.beamOnTicks = this.state.beamOnTicks || 0;
  bs.continuousBeamTicks = this.state.continuousBeamTicks || 0;
  bs.uptimeFraction = this.state.uptimeFraction || 1;
  bs.totalBeamHours = this.state.totalBeamHours || 0;
  bs.totalDataCollected = this.state.totalDataCollected || 0;
  bs.physicsAlive = this.state.physicsAlive !== undefined ? this.state.physicsAlive : true;
  bs.physicsEnvelope = this.state.physicsEnvelope || null;
  bs.discoveryChance = this.state.discoveryChance || 0;
  bs.photonRate = this.state.photonRate || 0;
  bs.collisionRate = this.state.collisionRate || 0;
  bs.totalLossFraction = this.state.totalLossFraction || 0;
  bs.componentHealth = this.state.componentHealth || {};
  bs.felSaturated = this.state.felSaturated || false;
  bs.machineType = this.state.machineType || 'linac';

  // Restore beamline graph
  if (data.beamline) {
    entry.beamline.fromJSON(data.beamline);
    for (const node of entry.beamline.getAllNodes()) {
      this.registry.occupyTiles(entry.id, node);
    }
  }

  // Clean up old fields from state
  delete this.state.beamOn;
  delete this.state.beamEnergy;
  delete this.state.beamCurrent;
  delete this.state.beamQuality;
  delete this.state.totalLossFraction;
  delete this.state.discoveryChance;
  delete this.state.photonRate;
  delete this.state.collisionRate;
  delete this.state.physicsEnvelope;
  delete this.state.physicsAlive;

  // Rebuild other state (same as v6 load)
  this.state.infraOccupied = {};
  if (this.state.infrastructure) {
    for (const tile of this.state.infrastructure)
      this.state.infraOccupied[tile.col + ',' + tile.row] = tile.type;
  }
  this.state.zones = this.state.zones || [];
  this.state.zoneOccupied = {};
  for (const z of this.state.zones) {
    this.state.zoneOccupied[z.col + ',' + z.row] = z.type;
  }
  this.recomputeZoneConnectivity();

  this.state.machineGrid = {};
  if (this.state.machines) {
    for (const m of this.state.machines) {
      const def = MACHINES[m.type];
      if (!def) continue;
      for (let dy = 0; dy < def.h; dy++)
        for (let dx = 0; dx < def.w; dx++)
          this.state.machineGrid[(m.col + dx) + ',' + (m.row + dy)] = m.id;
    }
  }

  if (this.state.connections && !(this.state.connections instanceof Map)) {
    const map = new Map();
    for (const [key, arr] of Object.entries(this.state.connections)) {
      map.set(key, new Set(arr));
    }
    this.state.connections = map;
  } else if (!this.state.connections) {
    this.state.connections = new Map();
  }

  if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
  if (!this.state.facilityGrid) this.state.facilityGrid = {};
  if (!this.state.zoneFurnishings) this.state.zoneFurnishings = [];
  if (!this.state.zoneFurnishingGrid) this.state.zoneFurnishingGrid = {};
  delete this.state.resources.energy;

  this._updateAggregateBeamline();
  this.log('Migrated save from v5 to v6 (multi-beamline)', 'info');
  return true;
}
```

- [ ] **Step 14: Remove `setMachineType` global method**

Delete the `setMachineType()` method. Machine type is now set per-beamline at source placement and is immutable (determined by source type).

- [ ] **Step 15: Update `economy.js` for aggregated beamline**

In `src/game/economy.js`, the `computeSystemStats` function uses `state.beamline` which is now the aggregate array from all beamlines. No changes needed — it already works with any array of nodes. Verify by reading `state.beamline` references.

- [ ] **Step 16: Update `main.js` event wiring**

In `src/main.js`, update the physics init callback:

```js
// Replace:
//   game.recalcBeamline();
// With:
game.recalcAllBeamlines();
```

Remove the global beam button event listener (the button will be removed from HTML in a later task):

```js
// Remove:
// document.getElementById('btn-toggle-beam')...
// (This is wired in hud.js, not main.js — will be addressed in Task 5)
```

- [ ] **Step 17: Commit**

```bash
git add src/game/Game.js src/main.js src/game/economy.js
git commit -m "refactor: Game.js uses BeamlineRegistry for multi-beamline support"
```

---

### Task 3: Input Handler — Edit Mode & Source Placement

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Add edit mode state tracking**

In the `InputHandler` constructor, the `game` object already has `editingBeamlineId`. No new state needed in InputHandler itself.

- [ ] **Step 2: Modify `_handleClick` for beamline selection**

When clicking on the map in beamline mode, determine what was clicked:

```js
// In the click handler, after grid position is calculated:

// If clicking on a beamline component
const clickedNode = this._getNodeAtGrid(col, row);
if (clickedNode) {
  const entry = this.game.registry.getBeamlineForNode(clickedNode.id);
  if (entry) {
    // If in edit mode for a different beamline, ignore
    if (this.game.editingBeamlineId && this.game.editingBeamlineId !== entry.id) {
      return;
    }
    // Select this beamline
    this.game.selectedBeamlineId = entry.id;
    this.game.emit('beamlineSelected', entry.id);
    return;
  }
}

// If clicking empty space, deselect / exit edit mode
if (this.game.editingBeamlineId) {
  this.game.editingBeamlineId = null;
  this.game.emit('editModeChanged', null);
}
```

- [ ] **Step 3: Modify build cursor logic for edit mode**

When getting build cursors for component placement, only return cursors for the beamline being edited:

```js
// Replace calls to this.game.beamline.getBuildCursors() with:
_getActiveBuildCursors() {
  if (!this.game.editingBeamlineId) return [];
  const entry = this.game.registry.get(this.game.editingBeamlineId);
  if (!entry) return [];
  return entry.beamline.getBuildCursors();
}
```

- [ ] **Step 4: Modify source placement to create new beamlines**

Source placement should work even outside edit mode:

```js
// When placing a source:
// Instead of: this.game.placeSource(col, row, dir)
// Use: this.game.placeSource(col, row, dir, sourceType)
// The Game.placeSource method now creates a new beamline and enters edit mode
```

- [ ] **Step 5: Add Escape key to exit edit mode**

In the keyboard handler, add:

```js
case 'Escape':
  if (this.game.editingBeamlineId) {
    this.game.editingBeamlineId = null;
    this.game.emit('editModeChanged', null);
    return;
  }
  // ... existing escape handling
  break;
```

- [ ] **Step 6: Modify bulldozer to respect edit mode**

When in demolish/bulldozer mode and clicking a beamline component:

```js
// Only allow demolishing components on the active beamline
if (this.game.editingBeamlineId) {
  const entry = this.game.registry.getBeamlineForNode(nodeId);
  if (!entry || entry.id !== this.game.editingBeamlineId) {
    return; // Can't demolish components on other beamlines
  }
}
```

- [ ] **Step 7: Add `_getNodeAtGrid` helper**

```js
_getNodeAtGrid(col, row) {
  // Check shared occupied grid
  const occ = this.game.registry.sharedOccupied[col + ',' + row];
  if (!occ) return null;
  const entry = this.game.registry.get(occ.beamlineId);
  if (!entry) return null;
  return entry.beamline.getAllNodes().find(n => n.id === occ.nodeId) || null;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat: InputHandler supports edit mode and multi-beamline selection"
```

---

### Task 4: Renderer — Edit Mode Dimming & Per-Beamline Cursors

**Files:**
- Modify: `src/renderer/beamline-renderer.js`
- Modify: `src/renderer/Renderer.js`

- [ ] **Step 1: Add edit mode opacity to component rendering**

In `src/renderer/beamline-renderer.js`, in the `_renderComponents` method, after creating each sprite, set alpha based on edit mode:

```js
// After: this.componentLayer.addChild(sprite);
// Add:
if (this.game.editingBeamlineId) {
  const nodeEntry = this.game.registry.getBeamlineForNode(node.id);
  if (nodeEntry && nodeEntry.id !== this.game.editingBeamlineId) {
    sprite.alpha = 0.3;
  }
}
```

Apply the same to labels.

- [ ] **Step 2: Filter build cursors by editing beamline**

In `_renderBuildCursors` (in `beamline-renderer.js`), replace the call to `this.game.beamline.getBuildCursors()`:

```js
// Replace:
//   const cursors = this.game.beamline.getBuildCursors();
// With:
let cursors = [];
if (this.game.editingBeamlineId) {
  const entry = this.game.registry.get(this.game.editingBeamlineId);
  if (entry) cursors = entry.beamline.getBuildCursors();
}
```

- [ ] **Step 3: Dim beam particles for non-edited beamlines**

In the beam rendering method, apply the same alpha treatment — beams on non-edited beamlines render at 0.3 alpha when in edit mode.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/beamline-renderer.js src/renderer/Renderer.js
git commit -m "feat: renderer dims non-edited beamlines in edit mode"
```

---

### Task 5: HUD — Remove Global Beam Button, Beam Summary

**Files:**
- Modify: `index.html`
- Modify: `src/renderer/hud.js`
- Modify: `src/main.js`

- [ ] **Step 1: Update `index.html`**

Remove the global beam button and add a beam summary + context window container:

```html
<!-- Replace #btn-toggle-beam with beam summary -->
<!-- In #top-buttons: -->
<span id="beam-summary" class="beam-summary"></span>
<button id="btn-research" class="hud-btn">Research</button>
<button id="btn-goals" class="hud-btn">Goals</button>
<button id="btn-new-game" title="Start a new game">New Game</button>

<!-- Add context window container before </div> #game: -->
<div id="context-windows-container"></div>
```

- [ ] **Step 2: Update HUD beam button logic**

In `src/renderer/hud.js`, replace `_updateBeamButton` with `_updateBeamSummary`:

```js
Renderer.prototype._updateBeamSummary = function() {
  const el = document.getElementById('beam-summary');
  if (!el) return;
  const entries = this.game.registry.getAll();
  const running = entries.filter(e => e.status === 'running').length;
  const total = entries.length;
  if (total === 0) {
    el.textContent = 'No beamlines';
    el.className = 'beam-summary';
  } else {
    el.textContent = `${running}/${total} beamlines running`;
    el.className = running > 0 ? 'beam-summary active' : 'beam-summary';
  }
};
```

Update `_updateHUD` to call `_updateBeamSummary` instead of `_updateBeamButton`.

- [ ] **Step 3: Update beam stats panel for selected beamline**

In `_updateHUD`, show stats for the selected beamline (or summary if none selected):

```js
// Replace the beam stats section with:
const selectedId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
const selectedEntry = selectedId ? this.game.registry.get(selectedId) : null;

if (selectedEntry) {
  const bs = selectedEntry.beamState;
  if (bs.beamEnergy) {
    const e = formatEnergy(bs.beamEnergy);
    setEl('stat-beam-energy', e.val);
    setEl('stat-beam-energy-unit', e.unit);
  } else {
    setEl('stat-beam-energy', '0.0');
    setEl('stat-beam-energy-unit', 'GeV');
  }
  setEl('stat-beam-quality', bs.beamQuality ? bs.beamQuality.toFixed(2) : '--');
  setEl('stat-beam-current', bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--');
  setEl('stat-data-rate', bs.dataRate ? bs.dataRate.toFixed(1) : '0');
  setEl('stat-length', bs.totalLength || 0);
  setEl('stat-energy-cost', bs.totalEnergyCost || 0);
} else {
  // Summary mode
  let totalDataRate = 0, totalEnergyCost = 0;
  for (const e of this.game.registry.getAll()) {
    totalDataRate += e.beamState.dataRate || 0;
    totalEnergyCost += e.beamState.totalEnergyCost || 0;
  }
  setEl('stat-beam-energy', '--');
  setEl('stat-beam-energy-unit', '');
  setEl('stat-beam-quality', '--');
  setEl('stat-beam-current', '--');
  setEl('stat-data-rate', totalDataRate.toFixed(1));
  setEl('stat-length', '--');
  setEl('stat-energy-cost', totalEnergyCost);
}
```

- [ ] **Step 4: Remove beam button event listener from `main.js`**

In `src/main.js`, remove the `btn-toggle-beam` click listener if it exists. The beam toggle is now per-beamline via context windows.

- [ ] **Step 5: Commit**

```bash
git add index.html src/renderer/hud.js src/main.js
git commit -m "feat: replace global beam button with per-beamline summary"
```

---

### Task 6: Context Window — Base Class

**Files:**
- Create: `src/ui/ContextWindow.js`
- Modify: `style.css`

- [ ] **Step 1: Implement ContextWindow class**

```js
// src/ui/ContextWindow.js

export class ContextWindow {
  constructor({ id, title, icon, accentColor, tabs, onClose }) {
    this.id = id;
    this.title = title;
    this.icon = icon || '';
    this.accentColor = accentColor || '#2a4a7f';
    this.tabs = tabs;  // [{ key, label }]
    this.activeTab = tabs[0]?.key || '';
    this.onClose = onClose;
    this.el = null;
    this._dragState = null;
    this._tabContentRenderers = {};  // key -> (containerEl) => void
    this._statusText = '';
    this._statusColor = '#888';
    this._zIndex = ContextWindow._nextZ++;
    this._create();
  }

  static _nextZ = 1000;
  static _allWindows = new Map();

  static getWindow(id) {
    return ContextWindow._allWindows.get(id);
  }

  static closeAll() {
    for (const w of ContextWindow._allWindows.values()) w.close();
  }

  _create() {
    const el = document.createElement('div');
    el.className = 'ctx-window';
    el.style.zIndex = this._zIndex;
    el.dataset.windowId = this.id;

    el.innerHTML = `
      <div class="ctx-titlebar" style="background: linear-gradient(90deg, ${this.accentColor}, ${this._darken(this.accentColor)})">
        <span class="ctx-title">${this.icon} ${this.title}</span>
        <div class="ctx-title-right">
          <span class="ctx-status"></span>
          <span class="ctx-close">✕</span>
        </div>
      </div>
      <div class="ctx-tabs"></div>
      <div class="ctx-body"></div>
      <div class="ctx-actions"></div>
    `;

    // Tabs
    const tabBar = el.querySelector('.ctx-tabs');
    for (const tab of this.tabs) {
      const t = document.createElement('div');
      t.className = 'ctx-tab' + (tab.key === this.activeTab ? ' active' : '');
      t.dataset.tab = tab.key;
      t.textContent = tab.label;
      t.addEventListener('click', () => this.switchTab(tab.key));
      tabBar.appendChild(t);
    }

    // Close button
    el.querySelector('.ctx-close').addEventListener('click', () => this.close());

    // Drag
    const titlebar = el.querySelector('.ctx-titlebar');
    titlebar.addEventListener('mousedown', (e) => this._startDrag(e));

    // Focus on click
    el.addEventListener('mousedown', () => this.focus());

    // Position near center
    el.style.left = '200px';
    el.style.top = '100px';

    this.el = el;
    const container = document.getElementById('context-windows-container');
    if (container) container.appendChild(el);

    ContextWindow._allWindows.set(this.id, this);
    this.focus();
    this._renderActiveTab();
  }

  setStatus(text, color) {
    this._statusText = text;
    this._statusColor = color || '#888';
    const el = this.el?.querySelector('.ctx-status');
    if (el) {
      el.textContent = `● ${text}`;
      el.style.color = color;
    }
  }

  setTitle(title) {
    this.title = title;
    const el = this.el?.querySelector('.ctx-title');
    if (el) el.textContent = `${this.icon} ${title}`;
  }

  switchTab(key) {
    this.activeTab = key;
    const tabs = this.el.querySelectorAll('.ctx-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));
    this._renderActiveTab();
  }

  onTabRender(key, fn) {
    this._tabContentRenderers[key] = fn;
  }

  _renderActiveTab() {
    const body = this.el?.querySelector('.ctx-body');
    if (!body) return;
    body.innerHTML = '';
    const renderer = this._tabContentRenderers[this.activeTab];
    if (renderer) renderer(body);
  }

  setActions(actions) {
    const bar = this.el?.querySelector('.ctx-actions');
    if (!bar) return;
    bar.innerHTML = '';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'ctx-action-btn';
      btn.textContent = action.label;
      if (action.style) btn.style.cssText = action.style;
      btn.addEventListener('click', action.onClick);
      bar.appendChild(btn);
    }
  }

  update() {
    this._renderActiveTab();
  }

  focus() {
    this._zIndex = ContextWindow._nextZ++;
    if (this.el) this.el.style.zIndex = this._zIndex;
  }

  close() {
    if (this.el) this.el.remove();
    ContextWindow._allWindows.delete(this.id);
    if (this.onClose) this.onClose();
  }

  _startDrag(e) {
    e.preventDefault();
    this.focus();
    const rect = this.el.getBoundingClientRect();
    this._dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };

    const onMove = (e) => {
      if (!this._dragState) return;
      const dx = e.clientX - this._dragState.startX;
      const dy = e.clientY - this._dragState.startY;
      this.el.style.left = (this._dragState.origLeft + dx) + 'px';
      this.el.style.top = (this._dragState.origTop + dy) + 'px';
    };
    const onUp = () => {
      this._dragState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _darken(hex) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.floor(((num >> 16) & 0xff) * 0.7);
    const g = Math.floor(((num >> 8) & 0xff) * 0.7);
    const b = Math.floor((num & 0xff) * 0.7);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }
}
```

- [ ] **Step 2: Add context window CSS**

Append to `style.css`:

```css
/* === Context Windows === */
#context-windows-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 500;
}

.ctx-window {
  position: absolute;
  width: 340px;
  border: 2px solid #555;
  border-radius: 4px;
  background: #0d0d1a;
  font-family: monospace;
  font-size: 11px;
  color: #ccc;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

.ctx-titlebar {
  padding: 4px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #555;
  cursor: grab;
  user-select: none;
}

.ctx-title {
  color: #fff;
  font-weight: bold;
  font-size: 12px;
}

.ctx-title-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctx-status {
  font-size: 10px;
}

.ctx-close {
  color: #888;
  cursor: pointer;
  font-size: 14px;
}
.ctx-close:hover { color: #fff; }

.ctx-tabs {
  display: flex;
  border-bottom: 1px solid #444;
  background: #151530;
}

.ctx-tab {
  padding: 4px 10px;
  color: #777;
  font-size: 10px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.ctx-tab:hover { color: #aaa; }
.ctx-tab.active {
  color: #4af;
  border-bottom-color: #4af;
  background: #1a1a3a;
}

.ctx-body {
  padding: 6px 8px;
  max-height: 300px;
  overflow-y: auto;
}

.ctx-actions {
  padding: 4px 8px 6px;
  display: flex;
  gap: 4px;
}

.ctx-action-btn {
  flex: 1;
  text-align: center;
  padding: 4px 8px;
  border: none;
  border-radius: 2px;
  font-family: monospace;
  font-size: 10px;
  cursor: pointer;
  background: #336;
  color: #aaf;
}
.ctx-action-btn:hover { background: #447; }

/* Stats grid in context window */
.ctx-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}
.ctx-stat {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
}
.ctx-stat-label { color: #888; }
.ctx-stat-val { color: #4f4; }

/* Mini preview */
.ctx-preview {
  background: #0a0a15;
  height: 80px;
  margin-bottom: 6px;
  border: 1px solid #333;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.ctx-preview-toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  gap: 2px;
}

.ctx-preview-btn {
  background: #222;
  border: 1px solid #444;
  padding: 1px 4px;
  font-size: 8px;
  color: #888;
  cursor: pointer;
  font-family: monospace;
}
.ctx-preview-btn.active { color: #4af; background: #333; }

/* Schematic in preview */
.ctx-schematic {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 8px;
  flex-wrap: wrap;
  padding: 4px;
}
.ctx-schem-node {
  padding: 2px 6px;
  border-radius: 2px;
  white-space: nowrap;
}
.ctx-schem-arrow { color: #555; }

/* Beam summary in top bar */
.beam-summary {
  font-family: monospace;
  font-size: 11px;
  color: #888;
  padding: 4px 8px;
}
.beam-summary.active { color: #4f4; }
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/ContextWindow.js style.css
git commit -m "feat: add ContextWindow base class with drag, tabs, and styling"
```

---

### Task 7: Beamline Context Window — Tab Renderers

**Files:**
- Create: `src/ui/BeamlineWindow.js`
- Modify: `src/renderer/overlays.js`

- [ ] **Step 1: Implement BeamlineWindow**

```js
// src/ui/BeamlineWindow.js
import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { formatEnergy } from '../data/units.js';

const BEAMLINE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'stats', label: 'Stats' },
  { key: 'components', label: 'Components' },
  { key: 'settings', label: 'Settings' },
  { key: 'finance', label: 'Finance' },
  { key: 'utilities', label: 'Utilities' },
];

const STATUS_COLORS = {
  running: '#4f4',
  stopped: '#888',
  faulted: '#f44',
};

export class BeamlineWindow {
  constructor(game, beamlineId) {
    this.game = game;
    this.beamlineId = beamlineId;
    const entry = game.registry.get(beamlineId);
    if (!entry) return;

    // Don't create duplicate windows
    const existing = ContextWindow.getWindow('bl-' + beamlineId);
    if (existing) { existing.focus(); this.ctx = existing; return; }

    this.ctx = new ContextWindow({
      id: 'bl-' + beamlineId,
      title: entry.name,
      icon: '⚡',
      accentColor: '#2a4a7f',
      tabs: BEAMLINE_TABS,
      onClose: () => {
        if (game.selectedBeamlineId === beamlineId) {
          game.selectedBeamlineId = null;
        }
      },
    });

    this.ctx.onTabRender('overview', (el) => this._renderOverview(el));
    this.ctx.onTabRender('stats', (el) => this._renderStats(el));
    this.ctx.onTabRender('components', (el) => this._renderComponents(el));
    this.ctx.onTabRender('settings', (el) => this._renderSettings(el));
    this.ctx.onTabRender('finance', (el) => this._renderFinance(el));
    this.ctx.onTabRender('utilities', (el) => this._renderUtilities(el));

    this._updateStatus();
    this._updateActions();
    this.ctx.update();
  }

  _getEntry() {
    return this.game.registry.get(this.beamlineId);
  }

  _updateStatus() {
    const entry = this._getEntry();
    if (!entry) return;
    const status = entry.status.toUpperCase();
    this.ctx.setStatus(status, STATUS_COLORS[entry.status] || '#888');
  }

  _updateActions() {
    const entry = this._getEntry();
    if (!entry) return;
    const isRunning = entry.status === 'running';
    this.ctx.setActions([
      {
        label: isRunning ? 'Stop Beam' : 'Start Beam',
        style: isRunning ? 'background:#a33;color:#fff' : 'background:#3a3;color:#fff',
        onClick: () => {
          this.game.toggleBeam(this.beamlineId);
          this._updateStatus();
          this._updateActions();
          this.ctx.update();
        },
      },
      {
        label: this.game.editingBeamlineId === this.beamlineId ? 'Done' : 'Edit',
        style: 'background:#336;color:#aaf',
        onClick: () => {
          if (this.game.editingBeamlineId === this.beamlineId) {
            this.game.editingBeamlineId = null;
          } else {
            this.game.editingBeamlineId = this.beamlineId;
          }
          this.game.emit('editModeChanged', this.game.editingBeamlineId);
          this._updateActions();
        },
      },
      {
        label: 'Rename',
        style: 'background:#333;color:#f88',
        onClick: () => {
          const name = prompt('Rename beamline:', entry.name);
          if (name && name.trim()) {
            entry.name = name.trim();
            this.ctx.setTitle(entry.name);
          }
        },
      },
    ]);
  }

  _renderOverview(el) {
    const entry = this._getEntry();
    if (!entry) return;
    const bs = entry.beamState;

    // Schematic preview
    const nodes = entry.beamline.getOrderedComponents();
    let schematicHtml = '<div class="ctx-preview"><div class="ctx-schematic">';
    for (let i = 0; i < nodes.length; i++) {
      const comp = COMPONENTS[nodes[i].type];
      if (!comp) continue;
      const abbr = (comp.name || nodes[i].type).slice(0, 4).toUpperCase();
      const color = comp.isSource ? '#4a4' : comp.isEndpoint ? '#888' : '#44a';
      if (i > 0) schematicHtml += '<span class="ctx-schem-arrow">→</span>';
      schematicHtml += `<span class="ctx-schem-node" style="background:${color}">${abbr}</span>`;
    }
    schematicHtml += '</div></div>';

    // Quick stats
    const energy = bs.beamEnergy ? formatEnergy(bs.beamEnergy) : { val: '0', unit: 'GeV' };
    const statsHtml = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Energy</span><span class="ctx-stat-val">${energy.val} ${energy.unit}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Current</span><span class="ctx-stat-val">${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Quality</span><span class="ctx-stat-val" style="color:${bs.beamQuality > 0.7 ? '#4f4' : '#ff4'}">${bs.beamQuality ? bs.beamQuality.toFixed(2) : '--'}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Data</span><span class="ctx-stat-val" style="color:#4af">${bs.dataRate ? bs.dataRate.toFixed(1) : '0'}/s</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Uptime</span><span class="ctx-stat-val">${(bs.uptimeFraction * 100).toFixed(0)}%</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Type</span><span class="ctx-stat-val">${bs.machineType}</span></div>
      </div>
    `;

    el.innerHTML = schematicHtml + statsHtml;
  }

  _renderStats(el) {
    const entry = this._getEntry();
    if (!entry) return;
    const bs = entry.beamState;
    const energy = bs.beamEnergy ? formatEnergy(bs.beamEnergy) : { val: '0', unit: 'GeV' };

    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Energy</span><span class="ctx-stat-val">${energy.val} ${energy.unit}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Current</span><span class="ctx-stat-val">${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Quality</span><span class="ctx-stat-val">${bs.beamQuality ? bs.beamQuality.toFixed(2) : '--'}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Data Rate</span><span class="ctx-stat-val">${bs.dataRate ? bs.dataRate.toFixed(1) : '0'}/s</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Total Data</span><span class="ctx-stat-val">${Math.floor(bs.totalDataCollected)}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Uptime</span><span class="ctx-stat-val">${(bs.uptimeFraction * 100).toFixed(1)}%</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Beam Hours</span><span class="ctx-stat-val">${bs.totalBeamHours.toFixed(1)}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Photon Rate</span><span class="ctx-stat-val">${bs.photonRate ? bs.photonRate.toFixed(1) : '0'}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Discovery %</span><span class="ctx-stat-val">${bs.discoveryChance ? (bs.discoveryChance * 100).toFixed(2) : '0'}%</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Loss Frac</span><span class="ctx-stat-val">${bs.totalLossFraction ? bs.totalLossFraction.toFixed(3) : '0'}</span></div>
      </div>
    `;
  }

  _renderComponents(el) {
    const entry = this._getEntry();
    if (!entry) return;
    const nodes = entry.beamline.getOrderedComponents();

    let html = '<div style="max-height:200px;overflow-y:auto">';
    for (const node of nodes) {
      const comp = COMPONENTS[node.type];
      if (!comp) continue;
      const health = entry.beamState.componentHealth[node.id] ?? 100;
      const hColor = health > 60 ? '#4f4' : health > 25 ? '#ff4' : '#f44';
      html += `
        <div class="ctx-stat" style="padding:2px 0;border-bottom:1px solid #222">
          <span class="ctx-stat-label">${comp.name}</span>
          <span style="color:${hColor};font-size:10px">${Math.round(health)}%</span>
        </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  _renderSettings(el) {
    const entry = this._getEntry();
    if (!entry) return;
    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Machine Type</span><span class="ctx-stat-val">${entry.beamState.machineType}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Status</span><span class="ctx-stat-val">${entry.status}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Components</span><span class="ctx-stat-val">${entry.beamline.getAllNodes().length}</span></div>
      </div>
    `;
  }

  _renderFinance(el) {
    const entry = this._getEntry();
    if (!entry) return;
    const bs = entry.beamState;
    const nodes = entry.beamline.getOrderedComponents();

    let constructionCost = 0;
    for (const node of nodes) {
      const comp = COMPONENTS[node.type];
      if (comp) {
        constructionCost += comp.cost?.funding || 0;
      }
    }

    const photonPorts = nodes.filter(n => n.type === 'photonPort').length;
    const userFeeRate = photonPorts * 2 * (bs.beamQuality || 0);

    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Build Cost</span><span class="ctx-stat-val">$${constructionCost.toLocaleString()}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Energy Draw</span><span class="ctx-stat-val">${bs.totalEnergyCost} kW</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">User Fees</span><span class="ctx-stat-val" style="color:#4f4">+$${userFeeRate.toFixed(1)}/tick</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Data Rate</span><span class="ctx-stat-val" style="color:#4af">+${bs.dataRate ? bs.dataRate.toFixed(1) : '0'}/tick</span></div>
      </div>
    `;
  }

  _renderUtilities(el) {
    const entry = this._getEntry();
    if (!entry) return;
    const networkData = this.game.state.networkData;
    if (!networkData) {
      el.innerHTML = '<div style="color:#888">No network data</div>';
      return;
    }

    const blNodeIds = new Set(entry.beamline.getAllNodes().map(n => n.id));
    const types = ['powerCable', 'rfWaveguide', 'vacuumPipe', 'coolingWater', 'cryoTransfer', 'dataFiber'];
    const names = { powerCable: 'Power', rfWaveguide: 'RF', vacuumPipe: 'Vacuum', coolingWater: 'Cooling', cryoTransfer: 'Cryo', dataFiber: 'Data' };

    let html = '';
    for (const type of types) {
      const nets = networkData[type] || [];
      let connected = false;
      for (const net of nets) {
        if (net.beamlineNodes.some(n => blNodeIds.has(n.id))) {
          connected = true;
          break;
        }
      }
      const color = connected ? '#4f4' : '#f44';
      const status = connected ? 'Connected' : 'Not connected';
      html += `<div class="ctx-stat"><span class="ctx-stat-label">${names[type]}</span><span class="ctx-stat-val" style="color:${color}">${status}</span></div>`;
    }
    el.innerHTML = `<div class="ctx-stats-grid">${html}</div>`;
  }

  /** Call on each game tick to refresh the active tab */
  refresh() {
    this._updateStatus();
    this.ctx.update();
  }
}
```

- [ ] **Step 2: Wire context window opening in overlays.js**

In `src/renderer/overlays.js`, add a method to open a beamline window when a component is clicked:

```js
import { BeamlineWindow } from '../ui/BeamlineWindow.js';

// Add to existing component click handling:
Renderer.prototype._openBeamlineWindow = function(beamlineId) {
  if (!this._beamlineWindows) this._beamlineWindows = {};
  if (this._beamlineWindows[beamlineId]) {
    this._beamlineWindows[beamlineId].ctx.focus();
    return;
  }
  const bw = new BeamlineWindow(this.game, beamlineId);
  this._beamlineWindows[beamlineId] = bw;
  // Clean up reference on close
  const origClose = bw.ctx.onClose;
  bw.ctx.onClose = () => {
    delete this._beamlineWindows[beamlineId];
    if (origClose) origClose();
  };
};

Renderer.prototype._refreshContextWindows = function() {
  if (!this._beamlineWindows) return;
  for (const bw of Object.values(this._beamlineWindows)) {
    bw.refresh();
  }
};
```

Call `_refreshContextWindows()` from `_updateHUD()` so windows refresh each tick.

- [ ] **Step 3: Commit**

```bash
git add src/ui/BeamlineWindow.js src/renderer/overlays.js
git commit -m "feat: add BeamlineWindow with overview, stats, components, finance, utilities tabs"
```

---

### Task 8: Machine Context Window

**Files:**
- Create: `src/ui/MachineWindow.js`
- Modify: `src/renderer/overlays.js`

- [ ] **Step 1: Implement MachineWindow**

```js
// src/ui/MachineWindow.js
import { ContextWindow } from './ContextWindow.js';
import { MACHINES } from '../data/machines.js';

const MACHINE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'upgrades', label: 'Upgrades' },
  { key: 'settings', label: 'Settings' },
  { key: 'finance', label: 'Finance' },
];

export class MachineWindow {
  constructor(game, machineInstanceId) {
    this.game = game;
    this.machineId = machineInstanceId;
    const machine = game.state.machines.find(m => m.id === machineInstanceId);
    if (!machine) return;
    const def = MACHINES[machine.type];
    if (!def) return;

    const existing = ContextWindow.getWindow('mach-' + machineInstanceId);
    if (existing) { existing.focus(); this.ctx = existing; return; }

    this.ctx = new ContextWindow({
      id: 'mach-' + machineInstanceId,
      title: def.name,
      icon: def.icon || '',
      accentColor: '#5a3a1f',
      tabs: MACHINE_TABS,
      onClose: () => {},
    });

    this.ctx.onTabRender('overview', (el) => this._renderOverview(el));
    this.ctx.onTabRender('upgrades', (el) => this._renderUpgrades(el));
    this.ctx.onTabRender('settings', (el) => this._renderSettings(el));
    this.ctx.onTabRender('finance', (el) => this._renderFinance(el));

    this._updateStatus();
    this._updateActions();
    this.ctx.update();
  }

  _getMachine() {
    return this.game.state.machines.find(m => m.id === this.machineId);
  }

  _updateStatus() {
    const m = this._getMachine();
    if (!m) return;
    const status = m.active ? 'ACTIVE' : 'PAUSED';
    this.ctx.setStatus(status, m.active ? '#4f4' : '#888');
  }

  _updateActions() {
    const m = this._getMachine();
    if (!m) return;
    const def = MACHINES[m.type];
    this.ctx.setActions([
      {
        label: m.active ? 'Pause' : 'Resume',
        style: m.active ? 'background:#a33;color:#fff' : 'background:#3a3;color:#fff',
        onClick: () => {
          m.active = !m.active;
          this._updateStatus();
          this._updateActions();
          this.ctx.update();
          this.game.emit('machineChanged');
        },
      },
      {
        label: `Repair ($${this._repairCost()})`,
        style: 'background:#353;color:#afa',
        onClick: () => {
          this.game.repairMachine(this.machineId);
          this.ctx.update();
        },
      },
    ]);
  }

  _repairCost() {
    const m = this._getMachine();
    if (!m) return 0;
    const def = MACHINES[m.type];
    if (!def) return 0;
    return Math.ceil(def.cost.funding * 0.3 * (100 - m.health) / 100);
  }

  _renderOverview(el) {
    const m = this._getMachine();
    if (!m) return;
    const def = MACHINES[m.type];
    const perf = this.game.getMachinePerformance(m);

    el.innerHTML = `
      <div style="text-align:center;font-size:40px;padding:8px 0">${def.icon || '⚙'}</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Mode</span><span class="ctx-stat-val" style="color:#fa4">${m.operatingMode || 'default'}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Health</span><span class="ctx-stat-val" style="color:${m.health > 50 ? '#4f4' : '#f44'}">${Math.round(m.health)}%</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">$/tick</span><span class="ctx-stat-val" style="color:#4f4">+${(def.baseFunding * perf.fundingMult).toFixed(1)}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Data/tick</span><span class="ctx-stat-val" style="color:#4af">+${(def.baseData * perf.dataMult).toFixed(1)}</span></div>
      </div>
    `;
  }

  _renderUpgrades(el) {
    const m = this._getMachine();
    if (!m) return;
    const def = MACHINES[m.type];
    if (!def.upgrades) { el.innerHTML = '<div style="color:#888">No upgrades</div>'; return; }

    let html = '';
    for (const [key, upg] of Object.entries(def.upgrades)) {
      const currentLevel = m.upgrades[key] || 0;
      const current = upg.levels[currentLevel];
      const next = upg.levels[currentLevel + 1];
      html += `<div style="border-bottom:1px solid #222;padding:4px 0">`;
      html += `<div style="color:#aaa;font-size:10px">${upg.name}: <span style="color:#4af">${current.label}</span></div>`;
      if (next) {
        const costStr = next.cost ? Object.entries(next.cost).map(([r,a]) => `${a} ${r}`).join(', ') : 'Free';
        html += `<div style="font-size:9px;color:#777">Next: ${next.label} (${costStr})</div>`;
      } else {
        html += `<div style="font-size:9px;color:#555">MAX</div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
  }

  _renderSettings(el) {
    const m = this._getMachine();
    if (!m) return;
    const def = MACHINES[m.type];

    let html = '';
    if (def.operatingModes) {
      html += '<div style="margin-bottom:6px;color:#aaa;font-size:10px">Operating Mode:</div>';
      for (const mode of def.operatingModes) {
        const active = m.operatingMode === mode;
        html += `<div style="padding:2px 4px;margin:2px 0;background:${active ? '#336' : '#1a1a2e'};
          color:${active ? '#4af' : '#888'};font-size:10px;cursor:pointer;border-radius:2px"
          data-mode="${mode}">${mode}${active ? ' ✓' : ''}</div>`;
      }
    }
    el.innerHTML = html;

    // Bind mode clicks
    el.querySelectorAll('[data-mode]').forEach(modeEl => {
      modeEl.addEventListener('click', () => {
        this.game.setMachineMode(this.machineId, modeEl.dataset.mode);
        this.ctx.update();
        this._updateActions();
      });
    });
  }

  _renderFinance(el) {
    const m = this._getMachine();
    if (!m) return;
    const def = MACHINES[m.type];
    const perf = this.game.getMachinePerformance(m);

    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Build Cost</span><span class="ctx-stat-val">$${(def.cost.funding || 0).toLocaleString()}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Energy Draw</span><span class="ctx-stat-val">${def.energyCost} kW</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Funding/tick</span><span class="ctx-stat-val" style="color:#4f4">+$${(def.baseFunding * perf.fundingMult).toFixed(1)}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Data/tick</span><span class="ctx-stat-val" style="color:#4af">+${(def.baseData * perf.dataMult).toFixed(1)}</span></div>
      </div>
    `;
  }

  refresh() {
    this._updateStatus();
    this.ctx.update();
  }
}
```

- [ ] **Step 2: Wire machine window opening in overlays.js**

```js
import { MachineWindow } from '../ui/MachineWindow.js';

Renderer.prototype._openMachineWindow = function(machineInstanceId) {
  if (!this._machineWindows) this._machineWindows = {};
  if (this._machineWindows[machineInstanceId]) {
    this._machineWindows[machineInstanceId].ctx.focus();
    return;
  }
  const mw = new MachineWindow(this.game, machineInstanceId);
  this._machineWindows[machineInstanceId] = mw;
  const origClose = mw.ctx.onClose;
  mw.ctx.onClose = () => {
    delete this._machineWindows[machineInstanceId];
    if (origClose) origClose();
  };
};

// Update _refreshContextWindows to also refresh machine windows
const origRefresh = Renderer.prototype._refreshContextWindows;
Renderer.prototype._refreshContextWindows = function() {
  if (origRefresh) origRefresh.call(this);
  if (!this._machineWindows) return;
  for (const mw of Object.values(this._machineWindows)) {
    mw.refresh();
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/MachineWindow.js src/renderer/overlays.js
git commit -m "feat: add MachineWindow with overview, upgrades, settings, finance tabs"
```

---

### Task 9: Wire Click-to-Open Context Windows

**Files:**
- Modify: `src/input/InputHandler.js`
- Modify: `src/renderer/overlays.js`

- [ ] **Step 1: Open beamline window on component click**

In `InputHandler`, when a beamline component is clicked (not in build mode), open the context window:

```js
// In the click handler, when a node is clicked and we're not placing components:
if (clickedNode && !this.selectedTool) {
  const entry = this.game.registry.getBeamlineForNode(clickedNode.id);
  if (entry) {
    this.game.selectedBeamlineId = entry.id;
    this.renderer._openBeamlineWindow(entry.id);
    this.game.emit('beamlineSelected', entry.id);
  }
}
```

- [ ] **Step 2: Open machine window on machine click**

When clicking on a tile occupied by a machine:

```js
// After checking beamline nodes, check machines:
const machineId = this.game.state.machineGrid[col + ',' + row];
if (machineId && !this.selectedTool) {
  this.renderer._openMachineWindow(machineId);
}
```

- [ ] **Step 3: Double-click to enter edit mode**

Add double-click handler for beamline components:

```js
// In the canvas double-click handler:
const clickedNode = this._getNodeAtGrid(col, row);
if (clickedNode) {
  const entry = this.game.registry.getBeamlineForNode(clickedNode.id);
  if (entry) {
    this.game.editingBeamlineId = entry.id;
    this.game.selectedBeamlineId = entry.id;
    this.renderer._openBeamlineWindow(entry.id);
    this.game.emit('editModeChanged', entry.id);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/input/InputHandler.js src/renderer/overlays.js
git commit -m "feat: click beamline/machine to open context window, double-click for edit mode"
```

---

### Task 10: Integration Testing & Cleanup

**Files:**
- Modify: `test/test-beamline.js` (ensure existing tests still pass)
- Modify: `src/renderer/hud.js` (final cleanup)

- [ ] **Step 1: Run existing tests**

Run: `node --experimental-vm-modules test/test-beamline.js`
Expected: All existing tests PASS (Beamline class is unchanged).

Run: `node --experimental-vm-modules test/test-registry.js`
Expected: All registry tests PASS.

Run: `node --experimental-vm-modules test/test-networks.js`
Expected: All network tests PASS.

- [ ] **Step 2: Run the game in browser**

Run: `npx vite` (or however the dev server starts)

Verify:
1. Game loads (new game or migrated v5 save)
2. Placing a source creates a new beamline and enters edit mode
3. Build cursors appear only for the active beamline
4. Clicking away exits edit mode
5. Clicking a component opens the context window
6. Context window is draggable, tabs work
7. Start/Stop beam works per-beamline
8. Multiple beamlines can run independently
9. Standalone machines still work with their own context windows
10. Save/load round-trips correctly

- [ ] **Step 3: Fix any references to old `this.game.beamline` in renderer/hud**

Search all files for `this.game.beamline` and ensure they use the registry or aggregate:

```bash
grep -rn "this\.game\.beamline" src/ --include="*.js"
```

Replace direct beamline references:
- `this.game.beamline.getAllNodes()` → `this.game.registry.getAllNodes()`
- `this.game.beamline.getBuildCursors()` → use `_getActiveBuildCursors()` pattern
- `this.game.beamline.getNodeAt()` → use `this.game.registry.getBeamlineForNode()` or shared occupied grid

- [ ] **Step 4: Clean up `_updateHUD` references to old beam state**

Ensure `_updateHUD` in `hud.js` no longer references `this.game.state.beamOn`, `this.game.state.beamEnergy`, etc. — these are now per-beamline.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: clean up remaining single-beamline references across renderer and HUD"
```

- [ ] **Step 6: Final commit with all integration verified**

```bash
git add -A
git commit -m "feat: multi-beamline support with context windows and edit mode"
```
