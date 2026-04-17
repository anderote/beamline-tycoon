# Natural Starter Map — Design

**Date:** 2026-04-16
**Status:** Approved (pending spec review)

## Summary

Replace the prebuilt Fermilab starter map with a purely natural landscape: clumps of trees aligned with the existing terrain-brightness blob field, plus an ambient wildflower scatter on the grass. Introduce a `flowerBedTile` floor type the player can paint for formal gardens. The goal is a more evocative blank-canvas feel at new-game start — the player begins on empty greenfield, not in someone else's facility.

## Motivation

Three problems with the current new-game experience:

1. **Trees are placed at hardcoded positions** (`map-generator.js` lines 724–759) that do not align with the visually obvious dark-soil patches produced by `state.terrainBlobs`. Visually jarring: trees sit on bright grass while dark patches sit empty.
2. **Grass has no fine-scale decoration.** The terrain is a single tinted InstancedMesh — no flowers, no variety at foot level.
3. **The Fermilab prebuilt facility** imposes a design on the player before they've chosen anything. The intent of the game is for the player to build their own facility from the ground up.

## Goals

- Trees visibly clump on darker soil; clumps fade out at blob edges.
- Species bias within a clump tracks local brightness (dark conifers on darkest cells, mixed broadleaves in the middle, birch/shrub on light fringes).
- Wildflowers scatter across grass as a cheap instanced-decal layer; density tied to brightness.
- New `flowerBedTile` exists as a paintable floor with a distinct "cultivated garden" look.
- `Game.newGame()` produces the natural starter map automatically — no scenario picking required.
- The Fermilab scenario is deleted entirely. `Sandbox` remains as a truly-empty dev option.

## Non-Goals

- Animating flowers (wind, bloom).
- Per-biome or seasonal palettes.
- Changing tree asset art (sprite swaps or new species).
- Revising the terrain blob generator itself — only its consumers.
- Auto-placing `flowerBedTile` on the starter map — purely player-painted.

## Architecture

Three independent sub-features sharing the existing `state.terrainBlobs` field.

```
Game.newGame()
  ├── generates terrainBlobs  (existing behavior, unchanged)
  └── calls generateStartingMap(terrainBlobs)
          └── returns { floors: [], zones: [], walls: [], doors: [],
                        placeables: [trees...], placeableNextId }
          └── Game applies the returned data to state

Renderer (rebuilt when terrain snapshot rebuilds):
  ├── TerrainBuilder       (existing — tinted grass InstancedMesh)
  ├── WildflowerBuilder    (new — dot-decal InstancedMesh)
  └── FloorBuilder         (existing — gains flowerBedTile branch)
```

Data flow for tree placement is now *seeded by the same blobs that drive the visible grass tinting*, so visual and logical soil agree.

## §1 Tree Clumps From Brightness Blobs

### Change surface

`generateStartingMap(terrainBlobs)` replaces the current hardcoded `clusters[]` array with a brightness-driven algorithm. The signature changes to take the blob list; caller (`Game.newGame()`) passes `state.terrainBlobs`.

### Algorithm

1. **Select cluster centers.** Filter blobs to those with `brightness ≤ −0.3`, sort most-negative first, take the top 8 (if fewer qualify, use what's available). Each selected blob becomes one tree cluster.
2. **Per-cluster radius.** `r = min(blob.sx, blob.sy) × 1.1`. Because the blob is rotated and anisotropic, sampling in the blob's rotated frame produces oblong clumps on oblong patches — matching the visible shape of the dark ground.
3. **Per-cluster count.** `count = clamp(round(blob.sx × blob.sy × 0.35), 8, 25)`. Larger blobs get denser clumps.
4. **Per-candidate placement.** For each of `count` attempts (with a 6× attempt cap for rejection):
   - Sample a point inside the blob using Gaussian falloff (averaged two uniform samples per axis, in the blob's rotated frame).
   - Call `sampleTerrainBrightness(col, row, terrainBlobs)` to get the *local* brightness — not the cluster center's.
   - Pick species via **local brightness bias**:
     - `b < −0.6` → 80% pick from `[pineTree, cedarTree]`, 20% from `[oakTree, mapleTree]`
     - `−0.6 ≤ b < −0.3` → 70% from `[oakTree, mapleTree, elmTree, willowTree]`, 30% from `[pineTree, cedarTree]`
     - `−0.3 ≤ b < 0.2` → 70% from `[oakTree, mapleTree, smallTree]`, 30% `[birchTree]`
     - `b ≥ 0.2` → in-cluster candidates here are rare (we're near the cluster edge); use `[birchTree, smallTree]`.
   - Check footprint via the existing per-cell occupancy helper; reject if overlapping another tree.
5. **Bright-patch scatter.** Separate pass: ~25 attempts to place `shrub` or `birchTree` at random world positions where `sampleTerrainBrightness(col, row) > +0.15`. Replaces the current position-based ring scatter.

### Helpers that stay

- The seeded PRNG (`rng()` closure) in `generateStartingMap`.
- `tryPlaceTree(type, col, row)` — but simplified: the `buffered` building mask is no longer needed (nothing to avoid). Only the `treeCells` self-overlap check remains.

### Helpers that go

All Fermilab building helpers (`building`, `pathBetween`, `fillFloor`, `fillZone`, `addWalls`, `addDoor`, `place`, `stack`, `computeCells`, `resetIds`) are removed from `map-generator.js`. A small internal `placeDecoration()` replaces the generic `place()` — it only needs to handle decoration-kind placeables since trees/shrubs are the only output.

### Starter clearing

A ~12×12 cell exclusion zone centered at `(0, 0)` suppresses tree placement so the player has an obvious origin point to start building. Implemented inside `tryPlaceTree()`: if `|col| ≤ 6 && |row| ≤ 6` → reject.

### World bounds

Sampling bounds for scatter and cluster rejection: `col ∈ [−60, +60]`, `row ∈ [−60, +60]`. Beyond that, the view is far enough from the play area that empty space is fine.

### Acceptance

- Open the game; verify clumps visibly align with darker soil patches.
- Zoom into a dark clump; verify conifers dominate the center, broadleaves toward the edge.
- Verify a clear ~12×12 unobstructed area at origin.
- Run multiple new-games; verify different blob layouts produce different tree layouts (not a fixed arrangement).

## §2 Wildflower Ambient Layer

### New module: `src/renderer3d/wildflower-builder.js`

Mirrors the shape of `terrain-builder.js`. Exports a class with `add(scene)`, `rebuild(snapshot)`, `dispose()` following the existing renderer-builder pattern.

### Placement

For each terrain cell in `snapshot.terrain` (already excludes infrastructure/zone cells):
- **Density:** `flowerDensity = clamp(0.15 + 0.55 × (brightness + 1) / 2, 0.05, 0.7)` — lighter grass gets more flowers; darker grass (tree territory) gets sparser scatter.
- **Count per cell:** `n = floor(hash01 × flowerDensity × 3)` using the cell's existing `hash` field. Yields 0–2 flowers per cell, occasionally 3 on brightest cells.
- **Sub-cell jitter:** for each flower, derive x/z offsets from separate bit slices of `hash` (reuses same hash; no new RNG state).

### Rendering

- One `InstancedMesh`.
- Geometry: `PlaneGeometry(0.2, 0.2)` rotated flat on XZ plane, raised `+0.01` in y to avoid z-fighting with grass.
- Material: `MeshBasicMaterial` (unlit — flowers don't need shading at this scale), `transparent: true`, with a shared radial-gradient "soft dot" alpha texture.
- Per-instance **color** sampled from a meadow palette, hash-indexed with bias toward white/yellow:
  - Palette: `['#ffe14d', '#f2f2f2', '#ffe14d', '#ff8fa3', '#c58df5', '#ffe14d', '#e84a4a', '#7db9ff']` (repeats yellow to weight it heavier).
- Per-instance **scale** jitter: `0.8 + hashBits × 0.5` → range [0.8, 1.3].
- Per-instance **rotation** around +y: `hashBits × 2π`.

### New texture

Add `gen_radialDot()` to `src/renderer3d/materials/decals.js` (existing module for procedural decals). Draws a 32×32 alpha-ramp radial gradient on a canvas, returns a `CanvasTexture`. Exported as `flower_dot_decal` (or similar name matching existing conventions in that file).

### Wiring

In `ThreeRenderer.js`, instantiate `WildflowerBuilder` alongside `TerrainBuilder`. Same rebuild/dispose lifecycle triggers (rebuilds when terrain snapshot changes — i.e., on infra/zone changes, same as grass).

### Performance budget

Worst case at full brightness: ~2 flowers/cell × 25k cells = 50k instances. Three.js `InstancedMesh` handles this with one draw call. Rebuild target: <5ms.

### Acceptance

- Flowers visible across all grass cells.
- Density visibly higher on lighter soil; noticeably sparser over dark patches (where trees are).
- No flowers on paths, building floors, or zone tiles.
- Flowers under trees are partially occluded by tree geometry — this is fine visually.
- Deterministic: same terrain blobs → same flower positions across refreshes.

## §3 Buildable Flower Bed Tile

### New FLOORS entry

In `src/data/structure.js`, add:

- `id: 'flowerBedTile'` — avoids name collision with the existing `flowerBed` decoration placeable.
- Display name: `"Flower Bed"`.
- `category: 'grounds'` so it appears in the paint tool's Grounds/outdoor group alongside `groomedGrass`.
- `groundsSurface: true`, `noBase: true` (paintable directly on grass).
- Cost: matches `groomedGrass` for v1.

### Rendering

Matches the existing 2-layer `groomedGrass` branch in `src/renderer3d/floor-builder.js` — likely no code change there if the branch is type-dispatched.

- Layer 1 (base): dark soil color `#3a2820`.
- Layer 2 (overlay): textured quad using a new procedural texture `tile_flower_bed`.

### New texture

Add `gen_flowerBed()` to `src/renderer3d/materials/tiled.js` (alongside existing `gen_*` helpers):
- 64×64 canvas.
- Fill dark brown base.
- Draw ~20 larger dots (~3px radius, ~1.5× wildflower size) in saturated colors from the same meadow palette, but distributed in rough rows to suggest intentional planting rather than random scatter.
- Add 6–8 short green leaf-strokes at random positions to hint at foliage.
- Export as `tile_flower_bed` CanvasTexture following the existing pattern (MeshStandardMaterial with `repeat` set to tile across cells).

### Paint / interaction

Uses existing paintable-floor flow. No new UI work. Player opens paint tool → Grounds tab → Flower Bed, clicks/drags on grass. Removing reverts to grass (existing behavior).

### Starter map usage

None. The starter map is natural-only. Player paints flower beds themselves.

### Acceptance

- Paint tool shows "Flower Bed" option in the Grounds group.
- Click-and-drag paints flower-bed cells; remove reverts to grass.
- Texture is clearly distinct from wildflowers — formal garden feel, not meadow.
- No visual glitches at flower-bed-to-grass boundaries.

## §4 Blank Starter Map Integration

### `Game.newGame()` changes

After the existing `state.terrainBlobs = this._generateTerrainBlobs(...)` line in `newGame()`, call `generateStartingMap(this.state.terrainBlobs)` and apply the returned data:
- `state.floors = map.floors` (empty array)
- `state.zones = map.zones` (empty array)
- `state.walls = map.walls` (empty array)
- `state.doors = map.doors` (empty array)
- `state.placeables = map.placeables` (tree decorations only)
- `state.placeableNextId = map.placeableNextId`

No changes to save format — all these arrays already exist in state. We're just populating `placeables` with decoration entries instead of leaving it empty.

### `src/data/scenarios.js` changes

- Delete the `facility-ready` scenario entry entirely.
- Keep `sandbox` as-is (generator: null = truly empty game, for dev / debug).

### Menu → Scenarios

The Scenarios menu option continues to work and now lists only `sandbox`. The "New Game" menu button is unchanged; it wipes localStorage and reloads, which triggers `Game.newGame()` → natural starter map. The behavior of picking Sandbox from the scenario picker is unchanged by this spec — whatever it does today continues to do (its generator is `null`, i.e. effectively a no-op beyond the picker's own state reset, if any).

### Acceptance

- Fresh load / "New Game" button → natural starter map (trees clumped on dark soil, wildflowers scattered, ~12×12 clearing at origin).
- Menu → Scenarios no longer lists Fermilab; only Sandbox appears.

## File Manifest

| File | Change |
|------|--------|
| `src/game/map-generator.js` | Gut the Fermilab body. Rewrite `generateStartingMap(terrainBlobs)` to produce natural features only. Delete all Fermilab helpers. ~500 lines → ~100 lines. |
| `src/game/Game.js` | `newGame()` calls `generateStartingMap(state.terrainBlobs)` and assigns results to state. |
| `src/data/scenarios.js` | Delete `facility-ready` entry. Keep `sandbox`. |
| `src/data/structure.js` | Add `flowerBedTile` FLOORS entry. |
| `src/renderer3d/materials/tiled.js` | Add `gen_flowerBed()` + register `tile_flower_bed` texture. |
| `src/renderer3d/materials/decals.js` | Add `gen_radialDot()` + export `flower_dot_decal` texture. |
| `src/renderer3d/wildflower-builder.js` | **NEW.** InstancedMesh builder following `terrain-builder.js` pattern. |
| `src/renderer3d/ThreeRenderer.js` | Instantiate `WildflowerBuilder`; hook into rebuild/dispose lifecycle. |
| `src/renderer3d/floor-builder.js` | Verify `flowerBedTile` routes through the same 2-layer branch as `groomedGrass` — add a branch if not. |

## Testing

### Unit tests

- `test/test-map-generator-trees.js` (NEW): Given a synthetic `terrainBlobs` with two dark blobs at known positions and one bright blob, assert:
  - ≥80% of placed trees fall within the dark blobs' radii.
  - Dark-blob cluster has a higher conifer fraction than bright-blob scatter.
  - No trees inside the `|col| ≤ 6 && |row| ≤ 6` clearing.
  - Deterministic output for a fixed `seed` and fixed `terrainBlobs`.

- `test/test-wildflower-builder.js` (NEW): Given a fabricated `terrain` array with known brightness values, assert:
  - Flower instance count roughly matches the density formula (within ±15%).
  - Every instance's world position falls within its source cell's bounds.
  - Deterministic for fixed hashes.

### Visual smoke

Open `index.html`, click New Game:
1. Clumps of trees visible on the darkest grass patches.
2. Conifers dominate the centers of dark clumps; birch/shrubs on bright fringes.
3. Wildflowers scattered across grass, denser on lighter areas.
4. Open area at origin suitable for starting construction.
5. Paint tool → Grounds → Flower Bed works; painted patches have distinct textured look.
6. Menu → Scenarios lists only "Sandbox" (no Fermilab).

## Out of Scope

- Flower animations (wind sway, bloom).
- Per-biome or seasonal flower palettes.
- Tree asset art changes.
- Tuning the underlying `_generateTerrainBlobs()` distribution.
- Removing or overhauling the Scenarios menu UI.
- Auto-placing flower beds on the starter map.

## Open Questions / Deferred

- **Tree removal UX.** A heavily-treed starter map implies the player will need to clear trees to build. Assumed to work via existing decoration-removal flows. If it doesn't — tracked as a separate issue, not addressed here.
- **World bounds.** `[−60, +60]` tree placement bounds are a guess; may need adjustment after visual review.
- **Density tuning.** All density coefficients (cluster count, flower density, shrub scatter) are starting values. Expected to iterate based on visual review.
