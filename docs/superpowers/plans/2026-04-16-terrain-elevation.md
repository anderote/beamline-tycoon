# Terrain Elevation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-corner terrain heights (RCT2-style) as pure plumbing — data model, placement auto-flatten, sloped rendering, and terrain raycasting — so varied elevation can exist and be interacted with correctly without disrupting current gameplay.

**Architecture:** Sparse `Map<"col,row", Int8Array(4)>` storing 4 corner heights per non-flat tile; absent keys mean flat (all-zeros). Each Placeable kind auto-flattens its footprint on placement; floors and walls (which live in separate state arrays) stay at their natural corner heights and render sloped. A single merged BufferGeometry each for terrain, floors, and cliff faces; trapezoidal wall geometry. Raycasting replaces the flat y=0 plane with the terrain mesh. One small procedural hill in an empty corner of the starter map provides the only visible terrain feature.

**Tech Stack:** JavaScript (ES modules), Three.js (CDN global `THREE`), Node's built-in test runner (existing custom `assert` harness with pass/fail counters — see `test/test-insert-and-split.js`).

**Spec:** [`docs/superpowers/specs/2026-04-16-terrain-elevation-design.md`](../specs/2026-04-16-terrain-elevation-design.md). All design decisions are there; this plan is the execution sequence.

---

## File Structure

**New files**
- `src/game/terrain.js` — heightmap accessors, invariant enforcement, serialize/deserialize helpers.
- `src/renderer3d/cliff-builder.js` — merged BufferGeometry for vertical dirt-brown faces between tiles with mismatched shared-edge corners.
- `test/test-terrain-heightmap.js` — unit tests for `terrain.js` (accessors, invariant cascade, sparsity, serialization round-trip).
- `test/test-terrain-placement.js` — integration test that `placePlaceable` flattens footprint corners.

**Modified**
- `src/game/Game.js` — state init (add `cornerHeights: new Map()` and `cornerHeightsRevision: 0`), save JSON (serialize), load JSON (deserialize + old-save fallback), `_placePlaceableInner` (auto-flatten hook), starter-map invocation (receive `cornerHeights`).
- `src/game/map-generator.js` — new `addStarterHill(cornerHeights, floors, walls, placeables)` helper; call it at end of `generateStartingMap`; include `cornerHeights` in returned object.
- `src/renderer3d/world-snapshot.js` — extend `buildTerrain`, `buildFloors`, `buildWalls` to attach corner heights per entry; add `buildCliffs(game)` producing cliff-face data.
- `src/renderer3d/terrain-builder.js` — replace `InstancedMesh` of flat planes with a single merged `BufferGeometry` honoring per-corner Y; preserve brightness-tint via per-vertex color.
- `src/renderer3d/floor-builder.js` — replace `InstancedMesh` of flat planes with merged `BufferGeometry`, one merge per floor-type bucket.
- `src/renderer3d/wall-builder.js` — wall meshes become trapezoids (variable base Y, constant top Y).
- `src/renderer3d/ThreeRenderer.js` — instantiate + invoke `CliffBuilder`; replace `_raycastGround`'s hardcoded `y=0` plane with an intersection against the terrain mesh.

Each task below corresponds to **one logical commit**. Commits are grouped at logical boundaries per the project's `CLAUDE.md` — not one per step.

---

## Task 1: Heightmap data model + state wiring

**Files**
- Create: `src/game/terrain.js`
- Create: `test/test-terrain-heightmap.js`
- Modify: `src/game/Game.js` — state init (lines 42–99); serialize block (~line 3402); deserialize block (~line 3426 and backward-compat around line 3490).

**Design**

`src/game/terrain.js` exports:
- Constants: `HEIGHT_STEP_METERS = 0.5`; `HEIGHT_MIN = -2`; `HEIGHT_MAX = 8`; corner indices `NW=0, NE=1, SE=2, SW=3`.
- `getTileCorners(state, col, row) → {nw, ne, se, sw}` — absent key returns all zeros (no allocation).
- `getTileCornersY(state, col, row) → {nw, ne, se, sw}` — same but multiplied by `HEIGHT_STEP_METERS`.
- `getCornerHeight(state, col, row, cornerIdx) → int`.
- `setCornerHeight(state, col, row, cornerIdx, value)` — writes into the map entry (creates entry if needed), clamps `value` into `[HEIGHT_MIN, HEIGHT_MAX]`, then enforces the **per-tile invariant** `max − min ≤ 1` by clamping the three other corners of the same tile toward `value`, bumps `state.cornerHeightsRevision`. If all 4 corners end up at 0, deletes the map entry (sparsity).
- `setTileCorners(state, col, row, {nw, ne, se, sw})` — same but bulk; validates invariant after setting; bumps revision; removes entry if all zero.
- `isTileFlat(state, col, row) → bool` — true when entry absent, or all 4 corners equal.
- `serializeCornerHeights(map) → Array<[col, row, nw, ne, se, sw]>` — only non-zero entries (by invariant, every entry is non-zero because of the sparsity deletion, so this is just `Array.from`).
- `deserializeCornerHeights(array) → Map` — inverse.

Invariant cascade policy (clamping): for a tile after a write, find `min` and `max` of the 4 corners. While `max − min > 1`, clamp whichever corner is furthest from `value` by one step toward `value`. Terminates because each clamp strictly reduces `max − min`.

`src/game/Game.js` changes:
- In state init block (lines 42–99), add `cornerHeights: new Map()` and `cornerHeightsRevision: 0` alongside `floors: []`, `walls: []`, etc.
- In serialize block (around `JSON.stringify` at ~line 3402–3407): before stringify, replace `this.state.cornerHeights` in the save object with `serializeCornerHeights(this.state.cornerHeights)`. Do NOT serialize `cornerHeightsRevision` (transient).
- In deserialize block (around `Object.assign(this.state, data.state)` at ~line 3426): after assign, replace `this.state.cornerHeights` with `deserializeCornerHeights(this.state.cornerHeights || [])`; set `this.state.cornerHeightsRevision = 0`. This handles both new and old saves (old saves have no `cornerHeights` → empty array → empty map).

**Steps**

- [ ] **Step 1: Write failing unit tests** in `test/test-terrain-heightmap.js`. Follow the `test-insert-and-split.js` pattern (custom `assert(cond, msg)` incrementing pass/fail counters). Cover: all-zeros default; `setCornerHeight` writes + bumps revision; invariant cascade produces a valid tile; all-zeros `setTileCorners` removes the entry; serialize + deserialize round-trip on a map with 3 non-trivial tiles; `getTileCornersY` multiplies by 0.5.

- [ ] **Step 2: Run tests to confirm they fail.** Command: `node test/test-terrain-heightmap.js`. Expected output: all assertions fail with `terrain.js` import error.

- [ ] **Step 3: Implement `src/game/terrain.js`** per the "Design" section above. Keep it single-file, no classes — just exported functions.

- [ ] **Step 4: Wire state + serialization into `Game.js`** per the "Design" section above.

- [ ] **Step 5: Run unit tests + any other existing tests** to catch regressions. Commands:
  - `node test/test-terrain-heightmap.js` — PASS.
  - `node test/test-insert-and-split.js`, `node test/test-place-all-components.js`, `node test/test-networks.js` — PASS (sanity check that state-init / serialize changes didn't break anything).

- [ ] **Step 6: Commit.**
  ```
  git add src/game/terrain.js test/test-terrain-heightmap.js src/game/Game.js
  git commit -m "feat: per-corner terrain heightmap data model"
  ```

**Acceptance criteria**
- `terrain.js` exports the listed API.
- Fresh game has empty `cornerHeights` map + revision 0.
- Save/load round-trip preserves arbitrary heightmaps.
- Old saves (no `cornerHeights` field) load as all-flat.
- All new + existing tests pass.

---

## Task 2: Auto-flatten on Placeable placement

**Files**
- Create: `test/test-terrain-placement.js`
- Modify: `src/game/Game.js` — `_placePlaceableInner` (line 1292+); insert flatten logic **after** all validation checks but **before** the push at line 1406.

**Design**

In `_placePlaceableInner`:
1. After the wall-intersection check (line ~1361) passes and before pushing to `placeables` (line ~1406), gather the unique `(col, row)` tile pairs from the footprint cells (the `cells` variable is already computed).
2. For each unique tile, call `setTileCorners(state, col, row, {nw: 0, ne: 0, se: 0, sw: 0})`.
3. Proceed with the existing push + `placeableIndex` + `subgridOccupied` + `onPlaced` flow unchanged.

Because floors and walls are **not** Placeables (they're written through `placeFloor` / `placeWall` in Game.js, which don't reach `_placePlaceableInner`), no skip logic is required — the hook only ever runs for structural items.

**Steps**

- [ ] **Step 1: Write failing integration tests** in `test/test-terrain-placement.js`:
  - Set up a game, seed `cornerHeights` with a tile at `(5, 5)` having `{nw: 2, ne: 1, se: 1, sw: 0}`.
  - Call `placePlaceable` for a 1×1 Placeable at `(5, 5)`.
  - Assert `getTileCorners(state, 5, 5)` returns all zeros.
  - Assert a neighboring seeded tile at `(6, 5)` is untouched.
  - Second test: 2×2 footprint flattens all 4 tiles.
  - Third test: a failed placement (e.g., collision) leaves heightmap untouched.

- [ ] **Step 2: Run tests to confirm they fail.** Expected: last assertion (heights still non-zero) fails because auto-flatten isn't wired yet.

- [ ] **Step 3: Implement the hook** in `_placePlaceableInner` per the Design section. Import the needed functions from `../terrain.js` at the top of `Game.js` (`setTileCorners`).

- [ ] **Step 4: Run tests to confirm they pass.**

- [ ] **Step 5: Run existing placement tests** (`test-insert-and-split.js`, `test-place-all-components.js`) to confirm no regressions.

- [ ] **Step 6: Commit.**
  ```
  git add test/test-terrain-placement.js src/game/Game.js
  git commit -m "feat: auto-flatten terrain under placed equipment"
  ```

**Acceptance criteria**
- Placing any Placeable over non-flat terrain flattens all its footprint tiles to 0.
- Failed placements don't mutate the heightmap.
- Neighbors outside the footprint are untouched.
- All existing tests still pass.

---

## Task 3: Terrain rendering with corner heights + cliff faces

**Files**
- Modify: `src/renderer3d/world-snapshot.js` (`buildTerrain`; add new `buildCliffs`).
- Modify: `src/renderer3d/terrain-builder.js` — full rewrite.
- Create: `src/renderer3d/cliff-builder.js`.
- Modify: `src/renderer3d/ThreeRenderer.js` — construct `CliffBuilder` alongside `TerrainBuilder`, invoke it on snapshot update.

**Design**

`world-snapshot.js`:
- `buildTerrain(game)` — existing function emits one entry per rendered grass tile. Extend each entry with `cornersY: {nw, ne, se, sw}` from `getTileCornersY(game.state, col, row)`.
- New `buildCliffs(game)` — for each tile in the rendered range, inspect its east and south neighbors (skip if neighbor outside range). For each inter-tile edge, read the two corners of this tile on that edge and the two matching corners of the neighbor. If any endpoint pair differs in Y, emit `{col, row, edge: 'e'|'s', selfY: [a, b], neighborY: [c, d]}`.
- Add `cliffs: buildCliffs(game)` to the returned snapshot object.

`terrain-builder.js`:
- Drop `InstancedMesh`. Build **one merged `BufferGeometry`** — two triangles per tile — with per-vertex position `(col*2, cornersY.nw, row*2)` etc., per-vertex color computed from `brightness` (same tint formula as today), UVs `{(0,0), (1,0), (1,1), (0,1)}` per tile.
- Single `MeshStandardMaterial` (grass map, white tint color, per-vertex colors enabled via `vertexColors: true`).
- Cache key: `terrainData.length + ':' + cornersHash`. Cheapest cornersHash: `terrainData.map(t => t.cornersY.nw + t.cornersY.ne + t.cornersY.se + t.cornersY.sw).join(',')` (ugly but works); better is a `cornerHeightsRevision` that world-snapshot includes at snapshot root — prefer that if you thread it through.
- Expose `getMesh() → THREE.Mesh` so `ThreeRenderer._raycastGround` can raycast against it in Task 4.

`cliff-builder.js`:
- Module analogous to `terrain-builder.js`: `class CliffBuilder { constructor(textureManager); build(cliffData, parentGroup); dispose(parentGroup); }`.
- For each cliff entry, emit a vertical quad. Orientation depends on `edge`:
  - `edge: 'e'`: quad spans from `(col+1)*2, selfY, row*2` corner to `(col+1)*2, selfY, (row+1)*2` on the self side, and `(col+1)*2, neighborY, row*2` to `(col+1)*2, neighborY, (row+1)*2` on the neighbor side. Upper edge = max of selfY/neighborY pair; lower edge = min. Use two triangles.
  - `edge: 's'`: analogous, along the south edge (`row+1`).
- If `selfY[0] ≥ neighborY[0]` but `selfY[1] < neighborY[1]` (sign flip along the edge — rare), split into two sub-quads meeting at the crossing point. Compute crossing by linear interpolation.
- Single merged `BufferGeometry`, one `MeshStandardMaterial` with `color: 0x6b4a2e`, `roughness: 1.0`, `metalness: 0.0`, no texture map.
- Cache by `cliffData.length + ':' + cornersHash` (or revision counter).

`ThreeRenderer.js`:
- Add a `_cliffBuilder = new CliffBuilder(this._textureManager)` field (alongside existing builders).
- In the scene-update path where builders are invoked, add `this._cliffBuilder.build(snapshot.cliffs, this._groundGroup)` (same group as terrain).
- Store a reference to the terrain mesh via `this._terrainMesh = this._terrainBuilder.getMesh()` so Task 4 can raycast against it.

**Steps**

- [ ] **Step 1: Extend `world-snapshot.js`** — update `buildTerrain` to include `cornersY` per tile; add `buildCliffs(game)`; include `cliffs` in the snapshot object.

- [ ] **Step 2: Rewrite `terrain-builder.js`** with merged BufferGeometry. Preserve existing brightness-tint behavior via per-vertex colors.

- [ ] **Step 3: Create `src/renderer3d/cliff-builder.js`** following the existing builder patterns (constructor takes textureManager; `build` and `dispose` methods; internal cache key).

- [ ] **Step 4: Wire `CliffBuilder` into `ThreeRenderer.js`** — instantiate, invoke on snapshot update, dispose alongside other builders.

- [ ] **Step 5: Verify flat-world regression.** Run `npm start` (or however the dev server starts — check `package.json`). Load a fresh game. Confirm the world still looks identical to before (no visible change, no errors in console).

- [ ] **Step 6: Verify varied-world manually.** Open browser devtools on a loaded game, call (from the console):
  ```js
  const game = window.__gameInstance; // or whatever exposure exists
  const { setTileCorners } = await import('./src/game/terrain.js');
  setTileCorners(game.state, 0, 0, {nw: 3, ne: 2, se: 1, sw: 0});
  game.requestRender();  // or the equivalent — whatever triggers a snapshot rebuild
  ```
  Confirm: tile at (0,0) renders with visible slope; cliff faces appear on at least one edge where the neighbor is at 0. (If there's no exposed game instance, temporarily add `window.__gameInstance = this` in the Game constructor for testing; remove before commit.)

- [ ] **Step 7: Run existing tests** for regressions. `node test/test-terrain-heightmap.js`, `node test/test-terrain-placement.js`, plus existing placement/network tests.

- [ ] **Step 8: Commit.**
  ```
  git add src/renderer3d/world-snapshot.js src/renderer3d/terrain-builder.js src/renderer3d/cliff-builder.js src/renderer3d/ThreeRenderer.js
  git commit -m "feat: render per-corner terrain heights and dirt cliff faces"
  ```

**Acceptance criteria**
- Flat world renders identically to before (no visual regression).
- Setting non-zero corner heights on a tile via devtools produces a visibly sloped tile.
- Cliff faces appear between tiles with mismatched shared-edge heights, colored dirt brown.
- No console errors.

---

## Task 4: Terrain-mesh raycasting

**Files**
- Modify: `src/renderer3d/ThreeRenderer.js` — `_raycastGround` (lines 629–639).

**Design**

Replace the hardcoded `new THREE.Plane(new THREE.Vector3(0,1,0), 0)` intersection with `raycaster.intersectObject(this._terrainMesh)`. If the array is non-empty, return `intersections[0].point`. If empty (camera aimed at sky or terrain mesh not yet built), fall back to the existing y=0 plane intersection so cursor behavior doesn't regress during startup or edge cases.

Return shape stays `THREE.Vector3 | null` so no caller needs updating.

**Steps**

- [ ] **Step 1: Edit `_raycastGround`** per the Design section. Keep the y=0 plane as a fallback.

- [ ] **Step 2: Manual verification.** Load a game with a hill (use the devtools approach from Task 3 Step 6, or wait until Task 5 lands the starter hill and re-verify then). Hover over raised terrain; confirm the hover / highlight tile matches the tile under the cursor on the slope, not a phantom tile offset by the flat projection.

- [ ] **Step 3: Commit.**
  ```
  git add src/renderer3d/ThreeRenderer.js
  git commit -m "feat: raycast hover against terrain surface"
  ```

**Acceptance criteria**
- Hovering elevated terrain selects the tile under the cursor, not a projected flat tile.
- Hovering flat terrain works identically to before.
- No console errors when terrain mesh is momentarily absent.

---

## Task 5: Sloped floor rendering

**Files**
- Modify: `src/renderer3d/world-snapshot.js` — `buildFloors`.
- Modify: `src/renderer3d/floor-builder.js` — full rewrite.

**Design**

`buildFloors(game)`: extend each floor entry with `cornersY` from `getTileCornersY`.

`floor-builder.js`:
- Replace `InstancedMesh` with per-floor-type merged `BufferGeometry`. Preserve existing grouping by `(type, variant, orientation, tint)` so per-type materials still drive separate draw calls.
- For each group: build two triangles per tile, positions derived from `cornersY`, UVs unchanged.
- Retain per-tile cache key (JSON.stringify remains fine; cornersY is in the data).

**Steps**

- [ ] **Step 1: Extend `buildFloors`** to include `cornersY`.

- [ ] **Step 2: Rewrite `floor-builder.js`** with merged BufferGeometry per floor-type bucket.

- [ ] **Step 3: Visual verification.** Load a game, use devtools to raise a tile's corner heights, place a floor on that tile (via the normal UI — floors don't auto-flatten per Task 2's rule). Confirm the floor follows the slope.

- [ ] **Step 4: Regression check.** Fresh flat game looks identical to before.

- [ ] **Step 5: Commit.**
  ```
  git add src/renderer3d/world-snapshot.js src/renderer3d/floor-builder.js
  git commit -m "feat: sloped floor rendering"
  ```

**Acceptance criteria**
- Flat floor tiles render identically to before.
- Floor placed on a sloped tile adopts the tile's corner heights.
- No console errors.

---

## Task 6: Trapezoidal wall rendering

**Files**
- Modify: `src/renderer3d/world-snapshot.js` — `buildWalls`.
- Modify: `src/renderer3d/wall-builder.js`.

**Design**

`buildWalls(game)`: for each wall `{col, row, edge, type, variant}`, attach `baseY: {a, b}` — the two corner Y values at the wall's endpoints, read from this tile's own corners (not the neighbor's):
- `edge: 'n'`: endpoints are NW (corner index 0) and NE (1).
- `edge: 'e'`: NE (1) and SE (2).
- `edge: 's'`: SE (2) and SW (3).
- `edge: 'w'`: SW (3) and NW (0).

`wall-builder.js`:
- The existing box-geometry walls become trapezoids. Per wall, build a custom `BufferGeometry` (or mutate box geometry vertices) so that:
  - Bottom-front-left and bottom-back-left Y = `baseY.a`.
  - Bottom-front-right and bottom-back-right Y = `baseY.b`.
  - Top edges stay at `max(baseY.a, baseY.b) + wall_height` (constant top Y keeps rooflines level).
- Retain the wall merging logic (colinear collapse) where feasible — walls in the same colinear run with identical `baseY` at shared endpoints can still merge. Walls with differing endpoint heights stay separate.
- Materials / textures unchanged.

**Steps**

- [ ] **Step 1: Extend `buildWalls`** with `baseY` per wall.

- [ ] **Step 2: Update `wall-builder.js`** geometry to produce trapezoidal walls. Adjust the merging logic to preserve height continuity (only merge walls whose shared endpoint has the same Y).

- [ ] **Step 3: Visual verification.** With a hill tile via devtools, place a wall on the edge of the hill. Confirm the wall's base slants with the terrain and its top stays horizontal. Verify walls on flat terrain render identically to before.

- [ ] **Step 4: Regression check** for wall-merge behavior on long flat wall runs.

- [ ] **Step 5: Commit.**
  ```
  git add src/renderer3d/world-snapshot.js src/renderer3d/wall-builder.js
  git commit -m "feat: trapezoidal walls follow terrain slope"
  ```

**Acceptance criteria**
- Flat wall runs render and merge identically to before.
- Walls spanning sloped corners have a slanted base and horizontal top.
- No console errors.

---

## Task 7: Procedural starter hill

**Files**
- Modify: `src/game/map-generator.js` — add `addStarterHill(cornerHeights, floors, walls, placeables)` helper; call it at end of `generateStartingMap`; include `cornerHeights` in the returned object.
- Modify: `src/game/Game.js` — read `cornerHeights` from `generateStartingMap`'s return value into `state.cornerHeights`.

**Design**

`addStarterHill(cornerHeights, floors, walls, placeables)`:
1. Identify an unbuilt region in the starter map. Simplest approach: build a `Set<"col,row">` of occupied tiles from `floors`, `walls`, and `placeables` (each Placeable's `cells` list); then scan map quadrants for a 6×6-tile block with zero overlap.
2. Centered on that block, apply a radial falloff: for tile at offset `(dx, dy)` from center, `rawHeight = max(0, round(peak * (1 - distance / radius)))` where `peak = 3` (1.5 m) and `radius = 3` tiles.
3. For each tile in the block, determine the 4 corner heights by sampling the falloff at each corner's **world position** (use the function value at each corner; since the 4 corners are ≤ 1 tile apart, neighboring corners on one tile will differ by ≤ 1 step almost always — where the invariant fails, clamp via the normal `setTileCorners` cascade).
4. Call `setTileCorners(stubState, col, row, {nw, ne, se, sw})` for each tile — but since the generator doesn't have a live game state, operate directly on the `cornerHeights` Map being built, calling the same helper functions from `terrain.js`. Alternative: build a tiny "state-like" object `{cornerHeights, cornerHeightsRevision: 0}` and pass it to the same `setTileCorners` helper. Pick whichever is cleaner given actual file shape.
5. Confirm no existing placeable footprint overlaps the hill. If overlap exists (shouldn't, given step 1), skip that tile.

`generateStartingMap` returns an object including `cornerHeights: Map<string, Int8Array(4)>`. `Game.js` reads it alongside `starter.floors` etc.

**Steps**

- [ ] **Step 1: Implement `addStarterHill`** in `map-generator.js`. Use `terrain.js` helpers.

- [ ] **Step 2: Update `generateStartingMap`** return value to include `cornerHeights`; invoke `addStarterHill` before the return.

- [ ] **Step 3: Update `Game.js`** to read `starter.cornerHeights` into `this.state.cornerHeights` (right alongside `this.state.floors = starter.floors`, etc.).

- [ ] **Step 4: Visual verification.** Start a fresh game. Confirm: rolling hill visible in one corner of the starter map; at least one edge of the hill shows a cliff face; placing a machine on the hill flattens it and creates a cliff at the machine's footprint boundary; hover + click picks correctly on the slopes (Task 4 raycasting).

- [ ] **Step 5: Existing-save regression.** Load an existing save (or any non-fresh game). Confirm no hill appears on that save (it was generated flat; the new starter hill only applies to freshly generated maps).

- [ ] **Step 6: Commit.**
  ```
  git add src/game/map-generator.js src/game/Game.js
  git commit -m "feat: procedural starter hill in empty map corner"
  ```

**Acceptance criteria**
- Fresh games have a visible hill in an unbuilt corner of the starter map.
- Cliff face appears on the hill where the slope drops off.
- Clicking / hovering the hill picks the correct tile.
- Placing a machine on the hill flattens the footprint.
- Existing saves unchanged.
- All tests still pass.

---

## Self-review checklist (reviewer verifies before claiming done)

- [ ] **Spec coverage:** Every item in the spec's "Goals" list maps to a task: data model (T1), auto-flatten (T2), sloped floors (T5), trapezoidal walls (T6), cliff faces (T3), raycasting (T4), starter hill (T7). ✓
- [ ] **Non-goals respected:** No terraforming UI, no multi-story, no sloped pipes, no beamline modules above z=0, no map-generator rewrite beyond the hill addition, no cliff texture asset.
- [ ] **No placeholders** in code or commits.
- [ ] **Type consistency:** `cornerHeights` is always `Map<string, Int8Array(4)>`. `cornersY` (in snapshot data) is always `{nw, ne, se, sw}` floats in meters. `cornerIdx` constants NW=0/NE=1/SE=2/SW=3 are defined in one place.
- [ ] **Save/load invariants:** Old saves → empty map; new saves round-trip; revision counter reset on load.
- [ ] **Regression bar:** A fresh game on flat terrain renders, places, and plays identically to pre-change main, with no console errors.
