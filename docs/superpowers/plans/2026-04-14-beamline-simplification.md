# Beamline Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy Beamline node graph and dual architecture, eliminate splitter/multi-path code, simplify the path flattener. Pipe graph becomes the sole source of truth.

**Architecture:** Delete `Beamline.js` entirely. Slim `BeamlineRegistry.js` to a metadata-only store (entries hold `sourceId` instead of a `Beamline` instance). Migrate all Game.js and InputHandler.js code that reads Beamline nodes to use placeables/pipe-graph instead. Remove splitter component and all references.

**Tech Stack:** Vanilla JS (ES modules), Node.js test runner

**Spec:** `docs/superpowers/specs/2026-04-14-beamline-simplification-design.md`

---

### Task 1: Remove Splitter Component and References

Remove the splitter component definition and all rendering/physics references across the codebase. This is the cleanest standalone change — no behavioral impact since splitters were never fully functional.

**Files:**
- Modify: `src/data/beamline-components.raw.js:171-196`
- Modify: `src/data/utility-ports.js:24`
- Modify: `src/renderer3d/component-builder.js:49,985`
- Modify: `src/renderer3d/builders/optics-builder.js:136+`
- Modify: `src/renderer/overlays.js:920-943`

- [ ] **Step 1: Remove splitter from component definitions**

In `src/data/beamline-components.raw.js`, delete the entire `splitter: { ... }` entry (lines 171-196). It starts after the closing `},` of the previous component and ends with `requiredConnections: ['powerCable'],` followed by `}`.

- [ ] **Step 2: Remove splitter from utility ports**

In `src/data/utility-ports.js`, delete line 24:
```js
splitter: [{ type: 'powerCable', offset: 0.5 }],
```

- [ ] **Step 3: Remove splitter 3D builder**

In `src/renderer3d/component-builder.js`:
- Line 49: Remove `_buildSplitterRoles,` from the import list
- Line 985: Remove `ROLE_BUILDERS.splitter = _buildSplitterRoles;`

In `src/renderer3d/builders/optics-builder.js`:
- Delete the entire `_buildSplitterRoles` function (starts at line 136) and remove it from the file's export list.

- [ ] **Step 4: Remove splitter 2D overlay drawing**

In `src/renderer/overlays.js`, delete the `splitter(p, px, dot, W, H, cy, C)` function (lines 920-943). Also find and remove any reference to `splitter` in the component sprite dispatch object/switch in the same file (search for `'splitter':` or `splitter:` in the drawing dispatch).

- [ ] **Step 5: Remove any remaining isSplitter references**

Search for `isSplitter` and `splitter` across `src/` and remove any remaining references:
- `src/beamline/path-flattener.js:86` — the TODO comment mentioning splitters: `// TODO(splitter): when splitters arrive, use pathHint to pick branches.` — delete this line.
- Any other stray references found by grep.

- [ ] **Step 6: Verify the game loads**

Run: `npx vite build 2>&1 | tail -20`

Expected: Build succeeds with no "splitter" import/reference errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove splitter component and all references

Splitter was scaffolding for an unfinished multi-path feature.
Removes component definition, 3D builder, 2D overlay, utility ports."
```

---

### Task 2: Slim Down BeamlineRegistry to Metadata Store

Remove the `Beamline` class dependency from the registry. Entries become lightweight metadata objects with a `sourceId` field linking to the pipe graph.

**Files:**
- Delete: `src/beamline/Beamline.js`
- Modify: `src/beamline/BeamlineRegistry.js`
- Delete: `test/test-beamline.js`

- [ ] **Step 1: Rewrite BeamlineRegistry.js**

Replace the contents of `src/beamline/BeamlineRegistry.js` with:

```js
// === BEAMLINE REGISTRY ===
// Lightweight metadata store for beamline identity, status, and physics state.
// The pipe graph (state.beamPipes + state.placeables) is the source of truth
// for component ordering. This registry holds per-beamline metadata that
// doesn't belong on individual placeables: name, accent color, run status,
// and aggregated physics results (beamState).

import { canonicalAccentFor } from './accent-colors.js';

/**
 * Returns a default beam state object for a given machine type.
 * All physics/economy fields start at sensible defaults.
 */
export function makeDefaultBeamState(machineType) {
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
    this.beamlines = new Map();  // id -> { id, name, accentColor, status, sourceId, beamState }
    this.nextBeamlineId = 1;
  }

  /** Create a new beamline entry. */
  createBeamline(machineType, sourceId = null) {
    const id = `bl-${this.nextBeamlineId}`;
    const name = `Beamline-${this.nextBeamlineId}`;
    const accentColor = canonicalAccentFor(this.nextBeamlineId - 1);
    this.nextBeamlineId++;

    const entry = {
      id,
      name,
      accentColor,
      status: 'stopped',
      sourceId,
      beamState: makeDefaultBeamState(machineType),
    };

    this.beamlines.set(id, entry);
    return entry;
  }

  get(id) { return this.beamlines.get(id); }
  getAll() { return Array.from(this.beamlines.values()); }

  /** Find the registry entry whose sourceId matches. */
  getBySourceId(sourceId) {
    for (const entry of this.beamlines.values()) {
      if (entry.sourceId === sourceId) return entry;
    }
    return null;
  }

  removeBeamline(id) {
    return this.beamlines.delete(id);
  }

  toJSON() {
    const entries = [];
    for (const entry of this.beamlines.values()) {
      entries.push({
        id: entry.id,
        name: entry.name,
        accentColor: entry.accentColor,
        status: entry.status,
        sourceId: entry.sourceId,
        beamState: JSON.parse(JSON.stringify(entry.beamState)),
      });
    }
    return { entries, nextBeamlineId: this.nextBeamlineId };
  }

  fromJSON(data) {
    this.beamlines = new Map();
    this.nextBeamlineId = data.nextBeamlineId;

    for (const e of data.entries) {
      let accentColor = e.accentColor;
      if (accentColor == null) {
        const match = /^bl-(\d+)$/.exec(e.id);
        const ordinal = match ? parseInt(match[1], 10) - 1 : 0;
        accentColor = canonicalAccentFor(ordinal);
      }
      this.beamlines.set(e.id, {
        id: e.id,
        name: e.name,
        accentColor,
        status: e.status,
        sourceId: e.sourceId ?? null,
        beamState: e.beamState,
      });
    }
  }
}
```

- [ ] **Step 2: Delete Beamline.js**

Delete `src/beamline/Beamline.js`.

- [ ] **Step 3: Delete test-beamline.js**

Delete `test/test-beamline.js` — it tests the deleted Beamline class.

- [ ] **Step 4: Verify no dangling imports**

Run: `grep -rn "from.*Beamline\.js" src/ test/ --include="*.js"`

Expected: Only `BeamlineRegistry.js` references remain (and docs). Fix any stray imports of `Beamline.js`. The main offenders will be:
- `src/game/Game.js:12` — `import { Beamline } from '../beamline/Beamline.js';` — DELETE this line.
- `src/main.js` — if it imports Beamline directly, delete that import.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: slim BeamlineRegistry to metadata store, delete Beamline.js

Registry entries no longer hold a Beamline node graph instance.
They store sourceId (link to pipe graph) instead. Tile occupancy
tracking removed — handled by the unified placeable system."
```

---

### Task 3: Migrate Game.js — Remove Legacy Beamline Methods

Remove `placeSource`, `placeComponent`, `removeComponent`, `moveComponent` and update all their callers to use the placeable system. Update `_ensureBeamlineForSourcePlaceable` and `_removeBeamlineForSourcePlaceable` to work without Beamline nodes.

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Delete legacy placeSource method**

Delete `Game.placeSource()` (lines 338-394). This method built Beamline nodes — source placement now goes through `placeModule()`.

- [ ] **Step 2: Delete legacy placeComponent method**

Delete `Game.placeComponent()` (lines 396-443). Component placement now goes through `placeModule()` + `createBeamPipe()`.

- [ ] **Step 3: Delete legacy removeComponent method**

Delete `Game.removeComponent()` (lines 445-488). Component removal now goes through `removePlaceable()`.

- [ ] **Step 4: Delete legacy moveComponent method**

Delete `Game.moveComponent()` (lines 495-580+). Component movement uses placeable move.

- [ ] **Step 5: Simplify _ensureBeamlineForSourcePlaceable**

Replace the method at line 2384 with a version that creates a metadata-only entry:

```js
_ensureBeamlineForSourcePlaceable(instance) {
  if (!instance) return null;
  const comp = COMPONENTS[instance.type];
  if (!comp?.isSource) return null;
  if (instance.beamlineId && this.registry.get(instance.beamlineId)) {
    return instance.beamlineId;
  }
  let machineType = 'linac';
  if (instance.type === 'dcPhotoGun' || instance.type === 'ncRfGun' || instance.type === 'srfGun') {
    machineType = 'photoinjector';
  }
  const entry = this.registry.createBeamline(machineType, instance.id);
  instance.beamlineId = entry.id;
  return entry.id;
}
```

- [ ] **Step 6: Simplify _removeBeamlineForSourcePlaceable**

Replace the method at line 2443 with:

```js
_removeBeamlineForSourcePlaceable(instance) {
  if (!instance || !instance.beamlineId) return;
  this.registry.removeBeamline(instance.beamlineId);
  instance.beamlineId = null;
}
```

(This is basically unchanged, just confirming it doesn't reference `Beamline` nodes.)

- [ ] **Step 7: Update demolishTarget 'beamlineWhole' case**

Find the `case 'beamlineWhole':` block in `demolishTarget()` (~line 1836). It currently iterates `entry.beamline.nodes` to compute refund. Replace with a pipe-graph walk:

```js
case 'beamlineWhole': {
  if (!target.beamlineId) return false;
  const entry = this.registry.get(target.beamlineId);
  if (!entry) return false;
  // Sum 50% refund from all placeables on this beamline's pipe graph
  let refund = 0;
  const flat = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];
  const placeableIdsToRemove = [];
  for (const el of flat) {
    if (el.kind === 'module') {
      const def = COMPONENTS[el.type];
      refund += Math.floor((def?.cost?.funding || 0) * 0.5);
      placeableIdsToRemove.push(el.id);
    }
  }
  // Remove pipes connected to these placeables
  const pipeIdsToRemove = (this.state.beamPipes || [])
    .filter(p => placeableIdsToRemove.includes(p.fromId) || placeableIdsToRemove.includes(p.toId))
    .map(p => p.id);
  this.state.beamPipes = (this.state.beamPipes || []).filter(p => !pipeIdsToRemove.includes(p.id));
  // Remove the placeables
  for (const pid of placeableIdsToRemove) {
    this.removePlaceable(pid);
  }
  this.state.resources.funding += refund;
  if (this.editingBeamlineId === target.beamlineId) this.editingBeamlineId = null;
  if (this.selectedBeamlineId === target.beamlineId) this.selectedBeamlineId = null;
  this.registry.removeBeamline(target.beamlineId);
  this.log(`Demolished beamline (+$${refund.toLocaleString()})`, 'good');
  this.recalcAllBeamlines();
  this.computeSystemStats();
  this.emit('beamlineChanged');
  this.emit('placeableChanged');
  return true;
}
```

- [ ] **Step 8: Remove Beamline import from Game.js**

Delete line 12: `import { Beamline } from '../beamline/Beamline.js';`

- [ ] **Step 9: Verify build**

Run: `npx vite build 2>&1 | tail -20`

Expected: Build succeeds. There will be runtime errors from methods that still call the deleted methods — those are fixed in the next tasks.

- [ ] **Step 10: Commit**

```bash
git add src/game/Game.js
git commit -m "refactor: remove legacy Beamline methods from Game.js

Delete placeSource, placeComponent, removeComponent, moveComponent.
Simplify _ensureBeamlineForSourcePlaceable to metadata-only.
Update demolishTarget beamlineWhole to walk pipe graph."
```

---

### Task 4: Migrate Game.js — Physics and Beam Graph

Update `_recalcSingleBeamline`, `_deriveBeamGraph`, `_updateAggregateBeamline`, `_snapshotRegistry`, `_restoreRegistryFromSnap`, and save/load to work with the slimmed registry.

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Rewrite _recalcSingleBeamline to use flattenPath**

Replace the method at line 2563 with:

```js
_recalcSingleBeamline(entry) {
  const ordered = entry.sourceId
    ? flattenPath(this.state, entry.sourceId)
    : [];

  // Calculate energy cost and total length from templates
  let tLen = 0, tCost = 0, hasSrc = false;
  const ecm = this.getEffect('energyCostMult', 1);
  for (const el of ordered) {
    const t = COMPONENTS[el.type];
    if (!t) continue;
    tLen += (el.subL || (t.subL || 4)) * 0.5;
    tCost += (t.energyCost || 0) * ecm;
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
    return;
  }

  // Build ordered beamline for physics engine
  const physicsBeamline = ordered.map(el => {
    const t = COMPONENTS[el.type] || COMPONENTS.drift;
    const effectiveStats = { ...(t.stats || {}) };
    let computed = null;
    if (PARAM_DEFS[el.type] && el.params) {
      computed = computeStats(el.type, el.params);
    }
    if (computed) {
      Object.assign(effectiveStats, computed);
    }
    const phys = {
      type: el.type,
      subL: el.subL || (t.subL || 4),
      stats: effectiveStats,
      params: el.params || {},
    };
    if (computed?.extractionEnergy !== undefined) {
      phys.extractionEnergy = computed.extractionEnergy;
    } else if (t.extractionEnergy !== undefined) {
      phys.extractionEnergy = t.extractionEnergy;
    }
    // Infra quality from node qualities map
    const nq = this.state.nodeQualities?.[el.id];
    if (nq) phys.infraQuality = nq;
    return phys;
  });

  // Gather research effects for physics
  const researchEffects = {};
  for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance',
                      'vacuumQuality', 'beamStability', 'photonFluxMult', 'cryoEfficiencyMult',
                      'beamLifetimeMult', 'diagnosticPrecision']) {
    researchEffects[key] = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
  }
  researchEffects.machineType = entry.beamState.machineType;

  this.runPhysicsForBeamline(entry, physicsBeamline, researchEffects);
}
```

- [ ] **Step 2: Simplify _deriveBeamGraph — remove registry merge**

In `_deriveBeamGraph()` (line 2209), delete the legacy registry merge block (lines 2243-2258):

```js
// DELETE THIS BLOCK:
    // Keep legacy registry compatibility: merge in any designer-placed beamline
    // nodes that aren't already in placeables.
    if (this.registry) {
      for (const entry of this.registry.getAll()) {
        const ordered = entry.beamline.getOrderedComponents();
        ...
      }
    }
```

- [ ] **Step 3: Simplify _snapshotRegistry**

Replace `_snapshotRegistry()` (line 215) — it no longer needs to serialize Beamline nodes or sharedOccupied:

```js
_snapshotRegistry() {
  return this.registry.toJSON();
}
```

- [ ] **Step 4: Simplify _restoreRegistryFromSnap**

Replace `_restoreRegistryFromSnap()` (line 242):

```js
_restoreRegistryFromSnap(regSnap) {
  this.registry.fromJSON(regSnap);
}
```

- [ ] **Step 5: Update save/load**

The `save()` method at line 3637 already calls `this.registry.toJSON()` — this now returns the slimmed format. No change needed.

The `load()` method at line 3681 already calls `this.registry.fromJSON(data.beamlines)` — this now uses the slimmed format. Old saves with `beamline` node data in entries will be ignored by the new `fromJSON` (it reads `sourceId` which old saves don't have — defaults to `null`). We need to add migration: after loading, for any entry with `sourceId === null`, try to find the matching source placeable:

After line 3681, add:

```js
// Migrate old saves: entries without sourceId need one
for (const entry of this.registry.getAll()) {
  if (!entry.sourceId) {
    // Find source placeable that has this beamlineId
    const src = this.state.placeables?.find(p =>
      p.beamlineId === entry.id && COMPONENTS[p.type]?.isSource
    );
    if (src) entry.sourceId = src.id;
  }
}
```

- [ ] **Step 6: Verify build**

Run: `npx vite build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/game/Game.js
git commit -m "refactor: update Game.js physics and beam graph for slim registry

_recalcSingleBeamline uses flattenPath instead of Beamline.getOrderedComponents.
_deriveBeamGraph drops legacy registry merge. Save/load migrates old entries."
```

---

### Task 5: Migrate InputHandler.js — Remove Registry Node Lookups

Replace all InputHandler methods that look up Beamline nodes via the registry with placeable-based lookups.

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Rewrite _getNodeAtGrid**

Replace the method at line 407:

```js
_getNodeAtGrid(col, row) {
  // Find a beamline placeable whose cells cover this tile
  for (const p of this.game.state.placeables) {
    const def = COMPONENTS[p.type];
    if (!def || def.category !== 'beamline') continue;
    const cells = p.cells || [{ col: p.col, row: p.row }];
    if (cells.some(c => c.col === col && c.row === row)) {
      return p;
    }
  }
  return null;
}
```

Note: callers expect an object with at least `id`, `type`, `tiles`, `col`, `row`. A placeable has all of these (using `cells` instead of `tiles`, but the callers mostly just need `id`).

- [ ] **Step 2: Rewrite _getNodeAtScreenOrGrid**

Replace the method at line 420:

```js
_getNodeAtScreenOrGrid(screenX, screenY, col, row) {
  if (this.renderer.raycastScreen) {
    const hit = this.renderer.raycastScreen(screenX, screenY);
    if (hit) {
      const info = this.renderer.identifyHit(hit);
      if (info && info.group === 'component' && info.nodeId) {
        const p = this.game.state.placeables.find(pl => pl.id === info.nodeId);
        if (p) return p;
      }
    }
  }
  return this._getNodeAtGrid(col, row);
}
```

- [ ] **Step 3: Delete _getActiveBuildCursors**

Delete the `_getActiveBuildCursors()` method at line 437. Then search for all call sites of `_getActiveBuildCursors` in InputHandler.js and remove or comment out those references. These are legacy build-cursor rendering calls from before the pipe-centric system.

Run: `grep -n '_getActiveBuildCursors' src/input/InputHandler.js`

Delete or neutralize each call site found.

- [ ] **Step 4: Migrate removeComponent calls to removePlaceable**

Find all calls to `this.game.removeComponent(...)` in InputHandler.js (lines 1957, 2123, 2126, 2873) and replace with:

```js
this.game.removePlaceable(node.id);
```

Where `node` is the result of `_getNodeAtGrid` (now returns a placeable). The `removePlaceable` method handles refunds and cleanup.

- [ ] **Step 5: Migrate moveComponent call**

At line 3089, replace:
```js
return this.game.moveComponent(p.nodeId, col, row, this.placementDir);
```
with the placeable move equivalent. Check if `Game` has a `movePlaceable` method. If not, the move operation for beamline components may need to go through the existing placeable repositioning logic. Search for `movePlaceable` or the existing move path for placeables in Game.js and use that. If no equivalent exists, use:

```js
// Beamline component move — reposition the placeable
const placeable = this.game.getPlaceable(p.nodeId);
if (placeable) {
  this.game._pushUndo();
  placeable.col = col;
  placeable.row = row;
  placeable.dir = this.placementDir;
  this.game._rebuildPlaceableCells(placeable);
  this.game._deriveBeamGraph();
  this.game.emit('placeableChanged');
}
return !!placeable;
```

- [ ] **Step 6: Remove remaining registry references in InputHandler**

Search for `this.game.registry` in InputHandler.js and remove/replace each reference:
- `this.game.registry.getBeamlineForNode(...)` — replace with `this.game.registry.getBySourceId(...)` or just find the beamline entry by walking up from the placeable.
- `this.game.registry.sharedOccupied[...]` — delete (tile occupancy from placeables now).
- `this.game.registry.get(...)` — keep where looking up beamline metadata by ID.
- `this.game.registry.getAllNodes()` — replace with a placeable filter.

- [ ] **Step 7: Verify build**

Run: `npx vite build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor: migrate InputHandler from registry nodes to placeables

_getNodeAtGrid finds beamline placeables by cell.
removeComponent calls replaced with removePlaceable.
_getActiveBuildCursors deleted (legacy build cursor system)."
```

---

### Task 6: Update BeamlineDesigner — Remove Legacy Entry Point

Remove the legacy `open(beamlineId)` path, `_applyDraftToBeamline`, and update confirm/restore to only use pipe-graph paths.

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`
- Modify: `src/game/Game.js` (the `_openDesignerForBeamline` method)
- Modify: `src/main.js` (hash restore)

- [ ] **Step 1: Delete open(beamlineId) from BeamlineDesigner**

Delete the `open(beamlineId)` method (lines 398-476).

- [ ] **Step 2: Delete _applyDraftToBeamline**

Delete the `_applyDraftToBeamline(entry)` method (lines 1864-1881).

- [ ] **Step 3: Simplify confirm() — remove legacy path**

In `confirm()` (line 801), remove the legacy registry path (lines 813-853). The method should now only handle pipe-graph reconciliation and design mode:

```js
confirm() {
  if (!this.isOpen) return;
  if (this.mode === 'design') return; // designs are saved, not confirmed

  // Pipe-graph mode: route to reconciler
  if (this.editSourceId) {
    this._reconcileToPipeGraph();
    this._clearDraftState();
    this._cleanup();
    return;
  }
}
```

- [ ] **Step 4: Simplify restoreState() — remove legacy path**

In `restoreState()` (line 1903), remove the legacy `open(beamlineId)` path (lines 1906-1925). For edit-mode restoration, resolve to `openFromSource`:

```js
restoreState(state) {
  if (!state || !state.isOpen) return;

  if (state.mode === 'edit' && state.editSourceId) {
    this.openFromSource(state.editSourceId, state.editEndpointId);
    // Restore draft nodes from saved state
    if (state.draftNodes?.length) {
      this.draftNodes = state.draftNodes.map(n => ({
        id: n.id,
        type: n.type,
        col: 0, row: 0, dir: 0, entryDir: 0,
        parentId: null, bendDir: n.bendDir || null, tiles: [],
        params: n.params ? { ...n.params } : {},
        computedStats: null,
      }));
      this.selectedIndex = state.selectedIndex;
      this.viewX = state.viewX;
      this.viewZoom = state.viewZoom;
      this._updateTotalLength();
      this._recalcDraft();
      this._updateDraftBar();
      this._renderAll();
    }
  } else if (state.mode === 'design') {
    // ... keep existing design mode restore unchanged ...
  }
}
```

Also update `serializeState()` to include `editSourceId` and `editEndpointId` so the edit-mode path above works. Check if they're already serialized.

- [ ] **Step 5: Remove findReachableEndpoints import and usage**

In `BeamlineDesigner.js`, the import at line 8: `import { flattenPath, findReachableEndpoints } from '../beamline/path-flattener.js';` — remove `findReachableEndpoints` from the import.

In `openFromSource()` at line 503, replace the endpoint lookup:

```js
// Old:
const endpoints = findReachableEndpoints(this.game.state, sourceId);
this.availableEndpoints = endpoints;
if (!endpointId && endpoints.length > 0) {
  endpointId = endpoints[0].id;
}
this.editEndpointId = endpointId;

// New:
this.availableEndpoints = [];
this.editEndpointId = endpointId; // null is fine — flattenPath walks to the end
```

`flattenPath` already walks to the end without an explicit endpoint ID (it stops at the first endpoint component or when it runs out of pipes).

- [ ] **Step 6: Update _openDesignerForBeamline in Game.js**

Replace the method at line 2449:

```js
_openDesignerForBeamline(beamlineId) {
  if (!this._designer) return;
  const entry = this.registry.get(beamlineId);
  if (!entry || !entry.sourceId) return;
  this._designer.openFromSource(entry.sourceId);
}
```

- [ ] **Step 7: Update hash restore in main.js**

In `src/main.js`, find the hash-restore code at lines 274-277 that calls `designer.open(blId)`. Replace with:

```js
// Old: designer.open(blId);
// New: resolve beamlineId to sourceId and open from source
const entry = game.registry.get(`bl-${blId}`);
if (entry && entry.sourceId) {
  designer.openFromSource(entry.sourceId);
}
```

Also check for any other `designer.open(` calls in main.js and replace similarly.

- [ ] **Step 8: Verify build**

Run: `npx vite build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy designer entry point, pipe-graph only

Delete open(beamlineId), _applyDraftToBeamline. Designer now only
opens via openFromSource (edit mode) or openDesign (sandbox).
Remove findReachableEndpoints usage."
```

---

### Task 7: Simplify path-flattener.js

Remove cycle detection and `findReachableEndpoints`. The flattener becomes a clean linear walk.

**Files:**
- Modify: `src/beamline/path-flattener.js`

- [ ] **Step 1: Simplify flattenPath — remove visited set**

In `flattenPath()`, remove the `visited` set and the cycle guard. The function already has a clean linear walk — just remove these lines:

Line 51: `const visited = new Set();`
Line 56: `if (visited.has(currentId)) break; // cycle — bail (rings come later)`
Line 57: `visited.add(currentId);`
Line 83: `const edges = (outEdges[currentId] || []).filter(e => !visited.has(e.toId));` — simplify to `const edges = outEdges[currentId] || [];`

- [ ] **Step 2: Delete findReachableEndpoints**

Delete the entire `findReachableEndpoints()` function (lines 160-184).

- [ ] **Step 3: Clean up comments**

Update the module header comment (lines 1-20) to remove references to splitters and multi-path. The flattener is now documented as a linear walk for single-path beamlines.

- [ ] **Step 4: Run existing tests**

Run: `node test/test-pipe-geometry.js`

Expected: All tests pass. (pipe-geometry tests are independent of the flattener changes.)

Also check if there are flattener-specific tests:

Run: `grep -l "flattenPath\|path-flattener" test/`

Run any found tests.

- [ ] **Step 5: Commit**

```bash
git add src/beamline/path-flattener.js
git commit -m "refactor: simplify path-flattener to linear walk

Remove cycle detection (visited set), findReachableEndpoints.
Single-path beamlines don't need BFS or multi-endpoint selection."
```

---

### Task 8: Clean Up Remaining Registry References

Sweep remaining files for stale registry.sharedOccupied, getAllNodes, getBeamlineForNode, entry.beamline references and fix them.

**Files:**
- Modify: Various files in `src/`

- [ ] **Step 1: Find all remaining stale references**

Run:
```bash
grep -rn "entry\.beamline\.\|getAllNodes\|getBeamlineForNode\|sharedOccupied\|\.beamline\.nodes\|\.beamline\.getOrdered\|\.beamline\.placeSource\|\.beamline\.placeAt\|\.beamline\.remove" src/ --include="*.js"
```

For each hit, determine if it's in live code or just comments/docs, and fix accordingly.

- [ ] **Step 2: Fix BeamlineWindow references**

Check `src/ui/BeamlineWindow.js` for any `entry.beamline.getOrderedComponents()` calls. Replace with `flattenPath(game.state, entry.sourceId)`.

- [ ] **Step 3: Fix renderer references**

Check `src/renderer/overlays.js`, `src/renderer3d/ThreeRenderer.js`, `src/renderer3d/world-snapshot.js` for any registry node graph references. Fix any found.

- [ ] **Step 4: Fix any remaining Game.js references**

Search for `entry.beamline` in Game.js. Any remaining references (e.g., in tick logic, beam-on/off toggle, etc.) need to be rewritten to use `flattenPath(this.state, entry.sourceId)` or the pipe graph directly.

Also check for remaining `this.registry.isTileOccupied`, `this.registry.occupyTiles`, `this.registry.freeTiles` calls — delete them all.

- [ ] **Step 5: Verify build and test**

Run: `npx vite build 2>&1 | tail -20`

Expected: Clean build with no reference errors.

Run any existing test suite: `node test/test-pipe-geometry.js && node test/test-insert-and-split.js`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: clean up remaining legacy registry references

Replace entry.beamline usage with flattenPath across all files.
Remove sharedOccupied, getAllNodes, getBeamlineForNode references."
```

---

### Task 9: Smoke Test and Final Verification

Load the game in a browser, verify core flows work.

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `npx vite dev`

- [ ] **Step 2: Verify game loads**

Open browser, confirm game loads without console errors related to Beamline, registry, or splitter.

- [ ] **Step 3: Test beamline placement flow**

1. Place a source module on the map
2. Draw a beam pipe from the source
3. Place a component at the pipe endpoint
4. Verify the designer opens from the source (`openFromSource`)
5. Verify physics calculations run in the designer

- [ ] **Step 4: Test demolish flow**

1. Demolish a single beamline component (should use `removePlaceable`)
2. Demolish an entire beamline via BeamlineWindow (should walk pipe graph for refund)

- [ ] **Step 5: Test save/load**

1. Save the game
2. Reload the page
3. Verify beamlines restore correctly

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: smoke test fixes for beamline simplification"
```
