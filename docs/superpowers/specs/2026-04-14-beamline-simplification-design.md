# Beamline Simplification: Kill Dual Architecture

**Date:** 2026-04-14
**Goal:** Remove the legacy Beamline node graph, eliminate splitter/multi-path code, and simplify the path flattener. The pipe graph (`state.beamPipes` + `state.placeables`) becomes the sole source of truth. The BeamlineDesigner UI and features are preserved.

## What Gets Deleted

### `src/beamline/Beamline.js` — DELETE ENTIRELY
Parent-child node graph class. Redundant with the pipe graph. All 309 lines go.

### Splitter component and code — DELETE ALL REFERENCES
- `splitter` entry in `beamline-components.raw.js`
- `computeSplitter()` in `component-physics.js` (if it exists)
- `_buildSplitterRoles()` in `component-builder.js`
- `splitter()` drawing in `overlays.js`
- `isSplitter` checks in path-flattener, InputHandler, physics, anywhere else
- Splitter entry in `utility-ports.js` (if present)
- Splitter decal/asset generation references

## What Gets Simplified

### `src/beamline/BeamlineRegistry.js` — SLIM TO METADATA STORE

Entries lose their `Beamline` instance. New shape:
```js
{
  id,           // "bl-1", "bl-2", ...
  name,         // "Beamline-1"
  accentColor,  // canonical accent swatch
  status,       // 'stopped' | 'running' | ...
  sourceId,     // placeable ID of the source module (link to pipe graph)
  beamState,    // physics results (energy, current, quality, envelope, etc.)
}
```

Remove:
- `sharedOccupied` tile tracking — placeables handle collision
- All `Beamline` import and usage
- `occupyTiles()`, `freeTiles()`, `isTileOccupied()` — dead
- `getBeamlineForNode()` — no more nodes to search
- `getAllNodes()` — dead

Keep:
- `createBeamline(machineType)` — creates metadata entry (takes `sourceId` param now)
- `get(id)`, `getAll()` — lookup
- `removeBeamline(id)` — cleanup
- `makeDefaultBeamState()` — physics defaults
- `toJSON()` / `fromJSON()` — save/load (simplified)

Add:
- `getBySourceId(sourceId)` — find entry by source placeable ID

### `src/beamline/path-flattener.js` — SIMPLIFY

Remove:
- `visited` set and cycle detection — linear beamlines can't cycle
- `findReachableEndpoints()` — single path, one endpoint
- Splitter TODO comment and multi-edge filtering

Keep:
- `flattenPath()` with same signature and output format
- Attachment interleaving logic (unchanged)
- The linear walk is already the happy path; just strip the guards

### `src/game/Game.js` — REMOVE LEGACY BEAMLINE METHODS

**Delete these methods** (they operate on Beamline node graph, now dead):
- `placeSource()` — replaced by `placeModule()` for source placeables
- `placeComponent()` — replaced by `placeModule()` + `createBeamPipe()`
- `removeComponent()` — replaced by `removePlaceable()`
- `moveComponent()` — replaced by `movePlaceable()` (or rebuild as needed)

**Simplify these methods:**
- `_ensureBeamlineForSourcePlaceable()` — no more building fake Beamline nodes; just creates a metadata entry with `sourceId`
- `_removeBeamlineForSourcePlaceable()` — just removes the metadata entry
- `_deriveBeamGraph()` — remove legacy registry merge (lines 2243-2258); only `flattenPath()` on pipe graph
- `_openDesignerForBeamline()` — always `openFromSource()`, no fallback to legacy `open()`
- `recalcBeamline()` / `recalcAllBeamlines()` — iterate registry entries, use `sourceId` to call `flattenPath()` instead of `entry.beamline.getOrderedComponents()`
- `demolishTarget()` case `'beamlineWhole'` — iterate placeables on the beamline (walk pipe graph from source) instead of `entry.beamline.nodes`
- `_snapshotRegistry()` / `_restoreRegistryFromSnap()` — simplified (no Beamline serialization)
- Save/load (`save()` / `_loadGameState()`) — registry data is lighter

**Migrate callers of deleted methods:**
- All `removeComponent()` calls in InputHandler/Game → `removePlaceable()`
- All `moveComponent()` calls in InputHandler → equivalent placeable move
- `_getNodeAtGrid()` in InputHandler → find placeable by cell occupancy
- `_getNodeAtScreenOrGrid()` — same migration
- `_getActiveBuildCursors()` — DELETE (legacy build cursor system for Beamline graph; pipe-centric placement doesn't use it)

### `src/ui/BeamlineDesigner.js` — REMOVE LEGACY ENTRY POINT

Delete:
- `open(beamlineId)` method — legacy registry-backed entry point
- `_applyDraftToBeamline()` — legacy confirm path that writes back to Beamline nodes
- Legacy path in `restoreState()` that calls `open(beamlineId)`
- Legacy path in `confirm()` that calls `_applyDraftToBeamline()`

Keep (unchanged):
- `openFromSource(sourceId)` — pipe-graph edit mode
- `openDesign(design)` — sandbox design mode
- `_reconcileToPipeGraph()` — pipe-graph confirm
- All rendering, plots, keyboard nav, undo, drag-reorder, palette, physics

Update:
- `_openDesignerForBeamline()` call path — always resolves to `openFromSource()`
- `findReachableEndpoints()` usage — since we're removing it from path-flattener, the designer either inlines a simple walk or just picks the one endpoint

### `src/input/InputHandler.js` — MIGRATE REGISTRY USAGE

- `_getNodeAtGrid()` → find beamline placeable at tile via `state.placeables`
- `_getNodeAtScreenOrGrid()` → same, use placeable lookup
- `_getActiveBuildCursors()` → DELETE (unused in pipe-centric workflow)
- Demolish paths calling `removeComponent()` → call `removePlaceable()` or `demolishTarget()` with placeable target
- Move path calling `moveComponent()` → call placeable move equivalent

### `src/renderer/overlays.js` — REMOVE SPLITTER DRAWING

- Delete `splitter()` function
- Remove from component sprite dispatch

### `src/renderer3d/component-builder.js` — REMOVE SPLITTER 3D

- Delete `_buildSplitterRoles()` function
- Remove from builder dispatch

### `src/main.js` — UPDATE BOOTSTRAP

- `BeamlineRegistry` constructor no longer needs `Beamline` import
- Hash-restore code that calls `designer.open(blId)` → resolve to `openFromSource()`

## What Does NOT Change

- **BeamlineDesigner UI** — all rendering, plots, keyboard nav, undo, ghost quads, drag-reorder, palette
- **Pipe-geometry helpers** (`pipe-geometry.js`) — unchanged
- **Component physics** (`component-physics.js`) — unchanged minus splitter
- **Python beam physics** (`physics.js` / `beam_physics/`) — unchanged
- **BeamlineWindow** — unchanged (already reads from flattenPath)
- **Pipe graph state** (`state.beamPipes`, `state.placeables`) — unchanged
- **All placement logic** (`placeModule`, `createBeamPipe`, `addAttachmentToPipe`) — unchanged

## Migration for `findReachableEndpoints`

The designer uses `findReachableEndpoints()` to populate `availableEndpoints` and select a default endpoint. Since we're going single-path, replace with a simple linear walk in `openFromSource()`:

```js
// Walk pipe graph linearly to find the endpoint
const flat = flattenPath(this.game.state, sourceId);
const lastModule = flat.filter(e => e.kind === 'module').pop();
const endpointId = lastModule?.id ?? null;
```

## Save Compatibility

Old saves contain registry data with `Beamline` node arrays. The simplified `fromJSON()` should gracefully ignore the old `beamline` field on entries and reconstruct `sourceId` by matching entry nodes against placeables, or just drop old registry entries since the pipe graph is the source of truth.
