# Unified Placeables — Design

**Date:** 2026-04-10
**Status:** Approved for planning

## Problem

Placement, preview, and deletion logic is duplicated across three divergent code paths:

1. **Beamline modules** (e.g. magnetron, RFQ-as-beamline): subtile snapping via `_computeModuleSubSnap`, geometry ghost via `renderComponentGhost`, commit via `Game.placePlaceable` writing to `subgridOccupied`. This is the "good" path.
2. **Zone furnishings** (e.g. oscilloscope): different snap (`isoToSubGrid`, clamps to tile bounds), different ghost (`renderFurnishingGhost`), different commit (`Game.placeZoneFurnishing`), different occupancy map (`infraOccupied`, tile-level only).
3. **Facility equipment**: tile-only placement, no subtile, bounding-box ghost (`renderEquipmentGhost`), `Game.placeFacilityEquipment`.

Consequences: rotation conventions disagree (`dir` vs `rotated`), collision rules disagree (subgrid vs tile), an RFQ behaves differently when placed as beamline vs equipment, adding a new placeable means picking a path and inheriting its quirks, and delete logic is scattered.

## Goal

A single placement pipeline used by every placeable object — magnetron, RFQ, oscilloscope, desk, etc. The only constraint on placement is footprint collision in subtile space. Beam pipes and pipe attachments keep their existing special paths; utility pipes are out of scope and will be handled separately.

## Non-goals

- Beam pipe drawing UX
- Pipe-attachment snapping
- Utility pipes
- HUD/menu redesign beyond what's needed to expose unified placement
- Economy/cost rebalancing
- Save migration (existing saves are discarded)

## Data model

### Registry

A single registry `PLACEABLES` aggregated from per-category files:

```
src/data/placeables/
  index.js                ← exports PLACEABLES (id → wrapped instance)
  beamline-modules.js     ← magnetron, RFQ, dipole, …
  furnishings.js          ← oscilloscope, desk, chair, …
  equipment.js            ← misc lab equipment
```

Each file exports an array of plain-object entries. `index.js` concatenates them into one keyed map and asserts no duplicate ids at load time. New categories = new file, no central edit.

### Entry shape

Every entry, regardless of kind, has the same shape:

```js
{
  id: 'magnetron',
  name: 'Magnetron',
  kind: 'beamline' | 'furnishing' | 'equipment',
  subW: 2, subH: 2,            // footprint in subtiles, dir=0 orientation
  cost, power, ...              // existing per-kind fields
  // beamline-only:
  beamIn:  { side: 'W', subRow: 1 },   // relative to dir=0
  beamOut: { side: 'E', subRow: 1 },
  // visuals:
  mesh: '…' | builderFn,
}
```

`subW`/`subH` are in **subtiles** (1 tile = 4×4 subtiles, 0.5 m each). `gridW`/`gridH` is deleted from the codebase. `placement: 'module'` is deleted.

`kind` exists because runtime behavior genuinely differs (beamline modules connect to the beam graph, consume power under beam, etc.) — but **placement code never branches on `kind`**.

### Class hierarchy

A small base class with per-kind subclasses for behavior:

```js
class Placeable {
  constructor(def) { Object.assign(this, def); }
  footprintCells(col, row, subCol, subRow, dir) { … }   // shared
  onPlaced(game) {}                                      // hook
  onRemoved(game) {}                                     // hook
}
class BeamlineModule extends Placeable {
  // beam graph hookup, power draw under beam
}
class Furnishing extends Placeable { … }
class Equipment extends Placeable { … }
```

The registry wraps each plain-object entry in the right subclass at load time based on `kind`. Adding an individual placeable = appending an object to a data file. Adding novel behavior = a new subclass (or sub-subclass).

## Placement pipeline

Lives in `src/game/placement.js` (new file).

### Coordinate model

A placement instance is `{id, col, row, subCol, subRow, dir}`:
- `(col, row)` — tile coordinates
- `(subCol, subRow) ∈ [0..3]` — origin subtile within the tile (footprint top-left when `dir=0`)
- `dir ∈ {0,1,2,3}` — N/E/S/W; rotation pivots around the footprint center

Subtile coordinates are global; the rotated footprint may overflow tile boundaries and that's fine.

### Single occupancy map

`Game.subgridOccupied` becomes the **only** occupancy map. `infraOccupied` and any tile-level equipment maps are deleted. Each occupied cell stores `{ placeableId, instanceId }` for O(1) "what's at this subtile" lookups (used by delete and hover-probe).

### Functions

- **`snapWorldToSubgrid(worldX, worldY) → {col, row, subCol, subRow}`** — replaces `_computeModuleSubSnap` and `isoToSubGrid`. Single rule: snap to nearest subtile center, no tile-bounds clamping.
- **`canPlace(registry, instance) → {ok, blockedCells?}`** — computes the rotated footprint cells, checks each against `subgridOccupied`. That's the entire rule. No floor check, no zone check, no kind branching.
- **`placePlaceable(game, instance) → instanceId`** — writes to `subgridOccupied`, appends to `Game.placedInstances` (a single flat list of all placed objects), calls `instance.onPlaced(game)`.
- **`removePlaceable(game, instanceId)`** — clears occupancy cells, calls `instance.onRemoved(game)`.
- **`removePlaceablesByKind(game, kind)`** — iterates `placedInstances`, removes matching ones. Enables "delete all furnishings."

### Rotation

`R` key cycles `placementDir = (dir + 1) % 4`. Same key for everything. Footprint cells are computed by rotating `(subW, subH)` and the `(subCol, subRow)` origin around the footprint center. For beamline entries, `beamIn`/`beamOut` sides are remapped by `dir` so beam topology rotates with the visual.

### What stays special

Beam pipes use their existing free-form drawing path. Pipe attachments use their existing pipe-snap path. Neither goes through `placement.js`. They DO write into `subgridOccupied` (with their own footprint rules) so the unified validator naturally prevents placing a magnetron through a pipe.

Utility pipes will be handled separately and are not part of this design.

## Input + preview

`InputHandler` collapses three preview branches into one.

### Hover state

`this.hoverPlaceable = { id, col, row, subCol, subRow, dir } | null` replaces `hoverCompSnap`, `hoverFurnishing*`, equipment hover state, and any related fields.

### Update path

When the player has any placeable selected (regardless of kind), each mouse-move runs:

```js
const snap = snapWorldToSubgrid(worldX, worldY);
this.hoverPlaceable = { id: this.selectedPlaceableId, ...snap, dir: this.placementDir };
```

No branching on kind.

### Ghost renderer

`ThreeRenderer.renderPlaceableGhost(instance, valid)` replaces `renderComponentGhost`, `renderFurnishingGhost`, and `renderEquipmentGhost`. It builds (or reuses) the same 3D mesh that the committed object will use, tinted green/red based on `canPlace`. The geometry-ghost path that magnetron currently uses becomes the only ghost path; bounding-box ghosts go away.

### Commit

Click → `placePlaceable(game, this.hoverPlaceable)` → if `ok`, an instance is created. Repeat-placement behavior matches current magnetron (hover stays armed for next click).

### Selection UI

The HUD/build menu reads from `PLACEABLES` and groups by `kind` for display, but selecting any item just sets `this.selectedPlaceableId`. No separate "beamline mode" / "furnishing mode" / "equipment mode" — one mode, one selected id.

### Delete tool

A single delete cursor hover-probes `subgridOccupied`, highlights the instance under the cursor (whatever its kind), removes on click. An optional kind filter in the HUD ("delete furnishings only") just filters which instances respond to hover. Per-kind bulk delete buttons call `removePlaceablesByKind`.

## Migration plan

Code-only migration; saves are discarded. Each step keeps the game runnable.

1. **Scaffolding (additive).** Create `src/data/placeables/{index.js, beamline-modules.js, furnishings.js, equipment.js}`, `src/game/Placeable.js`, `src/game/placement.js`. Nothing uses them yet.
2. **Port data.** Move entries from `src/data/components.js`, the `ZONE_FURNISHINGS` half of `src/data/infrastructure.js`, and the equipment bucket into the new files. Normalize: `gridW/gridH` → `subW/subH` (×4), drop `placement: 'module'`, default `dir: 0`, declare `beamIn/beamOut` for beamline entries.
3. **Switch renderer.** Add `renderPlaceableGhost`. Old ghost renderers stay alive temporarily.
4. **Switch InputHandler.** Replace the three preview/commit branches with the single `hoverPlaceable` path. Old `placeZoneFurnishing` / `placeFacilityEquipment` / legacy `placePlaceable` and old ghost renderers become unreachable.
5. **Switch Game.** Delete `placeZoneFurnishing`, `placeFacilityEquipment`, legacy `placePlaceable`. Wire the new `placement.js` functions. Delete `infraOccupied`. Add `placedInstances` flat list.
6. **Wire delete.** Replace scattered delete handlers with a single delete tool calling `removePlaceable`. Add per-kind filter in HUD.
7. **Delete dead code.** Remove `COMPONENTS`, `ZONE_FURNISHINGS`, the equipment bucket, the three old ghost renderers, `_computeModuleSubSnap`, `isoToSubGrid` (if unused elsewhere), `infraOccupied`. Grep for stragglers.
8. **Smoke test.** Place each kind, rotate each kind, delete each kind, verify cross-kind collision (magnetron blocks oscilloscope and vice versa), verify beam pipes still work and still block placement.

## Files touched

- **New:** `src/data/placeables/index.js`, `src/data/placeables/beamline-modules.js`, `src/data/placeables/furnishings.js`, `src/data/placeables/equipment.js`, `src/game/Placeable.js`, `src/game/placement.js`
- **Deleted:** `src/data/components.js` (or emptied), `ZONE_FURNISHINGS` export from `src/data/infrastructure.js`, the equipment bucket
- **Modified:** `src/game/Game.js` (occupancy maps, placement methods, delete methods), `src/input/InputHandler.js` (three preview branches → one), `src/renderer3d/ThreeRenderer.js` (three ghost renderers → one), `src/renderer/hud.js` (build menu reads from `PLACEABLES`, per-kind delete buttons)

## Open questions

None at design time. Any edge cases discovered during implementation get resolved in the implementation plan.
