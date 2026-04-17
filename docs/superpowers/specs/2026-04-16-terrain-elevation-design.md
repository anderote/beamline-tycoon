# Terrain Elevation — Phase 1 Design

## Summary

Add RCT2-style per-corner terrain heights to the world grid. Phase 1 delivers the
**foundation only**: data model, placement integration, 3D rendering, and raycasting
— enough that varied terrain *can* exist and be interacted with correctly, without
disrupting current gameplay. A small procedural hill in one corner of the starter
map provides a concrete test case.

Phase 2 (not designed here) will layer multi-story construction on top.

## Goals

- Tiles carry **per-corner heights** (4 corners per tile) so outdoor terrain can
  render as organic hills, valleys, and cliffs.
- **Beamlines, pipes, machines, equipment stay at z=0** always. Placing any of
  these auto-flattens the tile corners to 0. This keeps Phase 1 purely aesthetic
  — no gameplay system needs to understand elevation.
- **Floors** render sloped when placed on a tile with varying corners.
- **Walls** render with a trapezoidal base that follows the terrain at each end;
  the top stays horizontal.
- **Cliff faces** appear between adjacent tiles whose shared-edge corners differ.
  Rendered as solid dirt brown for Phase 1 (no texture asset yet).
- **Raycasting** hits the actual terrain mesh, not a flat `y=0` plane.
- **A small starter hill** lives in one corner of the map to prove the system works.

## Non-goals (deferred to later phases)

- Multi-story buildings, stairs, elevators.
- Beamline modules, pipes, or equipment at non-zero elevation.
- Sloped beam pipes.
- A player-facing terraforming tool / UI.
- Rewriting the starter map generator. The existing hand-crafted Fermilab-style
  campus stays intact.
- Dedicated cliff texture asset. (Flat brown color only for Phase 1.)
- Per-vertex brightness noise adapted to slope lighting (keep current flat tint).
- NPC / pathfinding over slopes.

## Data model

### Heightmap grid — per-tile corner ownership

Each tile owns its own 4 corner heights (RCT2 model, not a shared
vertex-grid heightmap). This is **required** so that cliffs along shared
tile edges are possible: a cliff is simply two adjacent tiles whose
corners on their shared edge differ.

- **Shape:** 4 corner values per tile. For a grid of `cols × rows` tiles,
  storage is `cols × rows × 4`.
- **Units:** integer steps. Each step = **0.5 m** in world space (= 1/4 tile,
  matching the RCT2 quarter-tile height unit and the existing sub-tile
  granularity of 0.25 m).
- **Range:** `−2 … +8` steps (−1 m to +4 m). Sufficient for hills/cliffs
  without ballooning the geometry budget; easily widened later.
- **Storage:** `state.cornerHeights` as a flat `Int8Array` of length
  `cols * rows * 4`, indexed
  `(row * cols + col) * 4 + cornerIdx` where `cornerIdx` ∈ `{0: NW, 1: NE, 2: SE, 3: SW}`.

### Tile accessors (new module, `src/game/terrain.js`)

- `getCornerHeight(state, col, row, cornerIdx) → int` — raw step value.
- `setCornerHeight(state, col, row, cornerIdx, value)` — writes and enforces
  the per-tile invariant by cascading the other 3 corners of the same tile
  if needed.
- `getTileCorners(state, col, row) → { nw, ne, se, sw }` — returns 4 integer
  step values.
- `getTileCornersY(state, col, row) → { nw, ne, se, sw }` — same but in world
  meters (`step × 0.5`). Renderers consume this.
- `isTileFlat(state, col, row) → bool` — true if all 4 corners equal.
- `setTileCorners(state, col, row, {nw, ne, se, sw})` — bulk set all 4
  corners of one tile; validates the invariant at the end.

### Invariants

- **Within a tile:** `max(corners) − min(corners) ≤ 1 step`. Keeps quads
  non-self-intersecting.
- **Between tiles:** no constraint. Cliffs are first-class and arise when
  one tile's corners on a shared edge don't match the neighbor's corners on
  that same edge.
- Mutations via `setCornerHeight` preserve the within-tile invariant by
  **cascading within the same tile**: if setting one corner breaks the
  invariant, the other 3 corners of that tile are clamped toward the new
  value until the invariant holds. No cross-tile cascade — each tile is
  self-contained.

### Serialization

- Save JSON includes a new field: `cornerHeights: <flat array of int8>`
  (or a base64-encoded compact form — decide at plan stage).
- **Old saves** (no `cornerHeights` field) → initialize to all zeros on load.
  The game then behaves identically to today (fully flat world).

## Placement integration (auto-flatten)

### `placePlaceable` hook

Before inserting a structural placeable (any placeable except floors and walls),
**flatten the footprint**:

1. Compute the set of tile (col, row) pairs the footprint touches.
2. For each such tile, set all 4 of its corners to height 0 via
   `setTileCorners`. Neighbors are untouched — cliff faces will appear
   automatically between the flattened footprint and any adjacent raised
   terrain (which is the intended look).
3. Proceed with normal placement.

### Category rules

| Placeable kind        | Auto-flatten? | Rendering under it           |
|-----------------------|---------------|------------------------------|
| Machine / equipment   | Yes, to 0     | Always sits on flat ground   |
| Beamline module       | Yes, to 0     | Always sits on flat ground   |
| Pipe / utility        | Yes, to 0     | Always at y=0                |
| **Floor**             | **No**        | Sloped to match tile corners |
| **Wall**              | **No**        | Trapezoidal, base follows    |

Floors and walls skip the hook. The exact signal (existing category /
`kind` field vs. a new per-placeable `skipAutoFlatten` flag) is resolved
at plan stage after reading `Placeable.js`.

### `canPlace` behavior

Unchanged for Phase 1. A structural placeable on a hill is valid — it just
excavates the hill as a side effect. No new rejection conditions.

## Rendering

All 3D rendering lives under `src/renderer3d/`. Each builder below rebuilds
from the same `cornerHeights` source of truth, pulled into a renderer-side
snapshot in `world-snapshot.js`.

### `terrain-builder.js` — merged BufferGeometry

- Replace the current flat InstancedMesh with a single **merged
  BufferGeometry**:
  - Two triangles per tile.
  - Vertex Y values read from `getTileCornersY`.
  - Per-vertex color carrying the existing brightness-tint value (keeps
    patchy-lawn appearance).
- Rebuild triggered when the heightmap hash changes (cache key = hash of
  `cornerHeights`). In Phase 1 this only happens on map load and the one
  starter hill generation, so rebuilds are rare.
- UV handling: retain the current 0..1 per-tile UV mapping. Slope distortion
  of the grass texture is acceptable at the shallow slopes we allow (≤ 1
  step per tile).

### New `cliff-builder.js` — vertical dirt faces

- For each inter-tile edge (east and south of every tile, to avoid
  double-counting), read the two corners from the current tile that lie on
  that edge, and the matching two corners from the neighbor on the far
  side. Where the pair of Y values differs, emit a vertical quad (two
  triangles) connecting the current-tile edge to the neighbor edge.
- The quad covers the **Y-gap** between the two tiles' edges, using the
  higher side's corners on top and the lower side's corners on bottom.
  Walk along the edge in sub-segments if the gap changes sign along the
  edge (rare but possible when both sides slope in opposite directions).
- Material: single `MeshStandardMaterial` with color `#6b4a2e`,
  `roughness: 1.0`, `metalness: 0.0`. No texture map in Phase 1.
- Packed into one merged BufferGeometry for the whole map (one draw
  call). Rebuilt on heightmap change.

### `floor-builder.js` — per-tile sloped quads

- Replace the current flat InstancedMesh approach with per-tile quads in a
  merged BufferGeometry, keyed by floor type so each type still has its own
  draw call + material.
- Each quad's 4 corners read Y from `getTileCornersY` for the tile it
  occupies.
- Preserves existing per-floor variant/tint/orientation semantics — only the
  Y-positions of the 4 corners change.

### `wall-builder.js` — trapezoidal walls

- A wall sits along one edge of a tile (N/E/S/W). The two endpoints of the
  wall are two tile corners.
- New geometry shape: **trapezoid** (viewed from the side) — base Y at each
  end reads from the corner height at that endpoint; top Y stays at
  `base_of_higher_end + wall_height`.
- If both ends are at the same height, the result is identical to today's
  rectangular wall.
- Wall textures / materials unchanged; only vertex positions move.

### `ThreeRenderer.js` — raycast against terrain

- Replace `_raycastGround`'s hardcoded `new THREE.Plane(up, 0)` with a
  raycast against the terrain BufferGeometry (`THREE.Raycaster.intersectObject`).
- The hit point's X/Z → `(col, row)` via existing `isoToGridFloat`. Hit Y is
  informational (may be used for hover tooltips later).
- Fallback: if the raycast misses the terrain (camera aimed at sky), preserve
  current behavior so hover state doesn't flicker — fall back to the y=0
  plane raycast.

### `world-snapshot.js`

- Add `cornerHeights` (or a reference to it) to the snapshot object so all
  renderer builders receive the same heightmap reading.

## Starter hill

- **One-time addition** to `map-generator.js` at the end of
  `generateStartingMap`: raise a small cluster of corners in a grass-only
  corner of the map (the plan step will identify which corner has no
  floors/walls/structures).
- Shape: radial falloff, peak ≈ 3 steps (1.5 m), footprint ~6 × 6 tiles.
- No collision with existing placeables — verified by checking
  `floors`/`walls`/`placeables` before committing the heights.
- Uses the same `setCornerHeight` accessor, so invariant cascade is
  exercised in real data.
- Purpose: provides a visible slope + cliff face for manual verification.
  Once Phase 2 adds richer terrain generation this can be removed.

## Save/load compatibility

- New saves include `cornerHeights`.
- Old saves: load code detects missing `cornerHeights`, initializes to
  all zeros. Game plays identically to pre-terrain version.
- Forward compatibility: the field is additive; old builds loading new
  saves would just ignore it (they render flat).

## Testing

### Unit (new `test/test-terrain-heightmap.js`)

- `setCornerHeight` enforces the within-tile invariant by cascading the
  three other corners of the same tile. Given a tile with all corners at
  0, raising the NW corner to 2 should clamp it to 1 (or raise the other
  corners toward 1) so `max − min ≤ 1`. Exact cascade policy decided at
  plan time, but tests assert the invariant holds post-mutation.
- `setTileCorners` rejects (or clamps) input that violates the invariant.
- `getTileCorners` and `getTileCornersY` return expected values for a
  hand-constructed heightmap.
- Round-trip serialize / deserialize preserves `cornerHeights`.
- Loading a save without `cornerHeights` yields an all-zero heightmap.

### Integration (new `test/test-terrain-placement.js`)

- Place a structural placeable on a hill → assert that the affected tile's
  4 corners are all 0 afterward. (Neighboring tiles untouched; cliff face
  will render between them, verified visually.)
- Place a floor on a hill → assert corner heights unchanged, floor is in
  state with matching tile coords.
- Place a wall spanning two corners at different heights → assert wall is
  stored with correct endpoint metadata (geometry is verified by renderer,
  not by this test).

### Manual / visual

- Load a fresh game. Confirm the starter hill renders in the designated
  corner with: grass sloping up, a cliff face on at least one edge, and
  any floors/walls placed on it (manually, for spot-checking) adapting
  correctly.
- Click on the hill slope. Confirm the tile hovered is the expected
  (col, row) based on hit-point projection, not a phantom y=0 tile.
- Place a machine on the hill. Confirm the hill under it flattens to 0
  and the machine sits at y=0, with cliff faces appearing where the
  flattened tile meets still-raised neighbors.

## Files touched (planning reference)

**Modified**
- `src/game/Game.js` — `cornerHeights` in state, serialization in/out.
- `src/game/placement.js` — auto-flatten hook in `placePlaceable`.
- `src/game/Placeable.js` — expose a `skipAutoFlatten` signal for floors/walls
  (if not already derivable from category).
- `src/game/map-generator.js` — add one `addStarterHill` call at the end of
  `generateStartingMap`.
- `src/renderer3d/terrain-builder.js` — merged BufferGeometry honoring corners.
- `src/renderer3d/floor-builder.js` — per-tile sloped quads.
- `src/renderer3d/wall-builder.js` — trapezoidal walls.
- `src/renderer3d/ThreeRenderer.js` — terrain-mesh raycasting.
- `src/renderer3d/world-snapshot.js` — include heightmap in snapshot.

**New**
- `src/game/terrain.js` — heightmap accessors + invariant logic.
- `src/renderer3d/cliff-builder.js` — vertical dirt-face geometry.
- `test/test-terrain-heightmap.js` — unit tests.
- `test/test-terrain-placement.js` — integration tests.

## Resolved decisions

- **Cliff geometry grouping:** single merged BufferGeometry for all cliff
  faces on the map. Rebuilds are rare in Phase 1 (map load + starter hill
  only), so one draw call beats incremental complexity.
- **Heightmap cache key:** a monotonic `cornerHeightsRevision` counter on
  state, incremented by every `setCornerHeight` / `setTileCorners` /
  auto-flatten pass. Renderer builders compare revision to last-seen and
  rebuild on mismatch. Simpler than hashing.
- **Wall endpoints:** a wall along edge `X` of tile `(c, r)` reads its
  two endpoint Y values from that tile's own corners on edge `X`
  (e.g. east wall → NE corner, SE corner). The adjacent tile's corners are
  irrelevant to the wall — a cliff face (from `cliff-builder.js`) handles
  any gap between the wall's base and the far tile.

## Open implementation questions (resolve at plan stage)

1. **Starter-hill location and shape.** Which map corner is unbuilt enough
   for a 6 × 6-tile hill, and what peak height and falloff curve looks
   good. Plan step will inspect the map and pick.
2. **Distinguishing floors/walls from structural placeables** for the
   auto-flatten hook. Reuse an existing category / `kind` field on
   placeables if one exists, otherwise add a `skipAutoFlatten: true`
   attribute to the floor and wall placeable definitions. Plan step to
   read `Placeable.js` and pick.
3. **Serialization wire format** for `cornerHeights`. Raw int8 array
   (readable JSON), base64 of the `Int8Array` buffer (compact), or
   run-length-encoded (compact *and* mostly-zero-friendly for the
   starter map). Plan step picks based on save-file size vs. debuggability
   tradeoff.
