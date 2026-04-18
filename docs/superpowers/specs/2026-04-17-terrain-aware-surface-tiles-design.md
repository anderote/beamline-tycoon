# Terrain-Aware Surface Tiles & Walls — Design

## Summary

Make sub-cell-positioned surface elements (wildflowers, grass tufts, multi-instance
decorations) sample terrain corner heights at their actual sub-cell location instead
of using `y=0` or a single tile-wide minimum corner. Change walls to render as
parallelograms (top edge follows bottom slope) instead of trapezoids (flat top).
Pin concrete pad to a flat slab at `y=0` regardless of underlying terrain — it's
treated as a building, not a terrain-conforming surface.

## Background — what already works

- **Floor tiles** (grass, brick, cobblestone, dirt, path, concrete): `floor-builder`
  consumes `cornersY` per tile and deforms the two-triangle quad to match. Working.
- **Walls + fences** (shared `wall-builder`): bottom edge already follows terrain
  trapezoidally; tile-edge walls with mismatched corner heights stay unmerged.
- **Trees (single-instance per tile)**: `world-snapshot.buildDecorations` samples
  `min(corners)` and passes it as `y`. Working for simple cases.

## Goals

- **Wildflowers & grass tufts** sit on the actual terrain at their sub-cell positions.
- **Sub-cell decoration instances** (multiple trees in one tile) each sample their
  own height instead of all sharing the tile's `min(corners)`.
- **Walls** become parallelograms — top vertices ride at `baseY + wallHeight` of
  each end's corner, so wall height stays constant along its length on slopes.
- **Concrete pad** renders as a flat slab at `y=0` regardless of terrain beneath.

## Non-goals

- No tilt/orientation change for flowers, grass, or trees — they stay strictly
  vertical. Only translation in Y.
- No changes to terrain heights themselves, raycasting, or placement validation.
- No changes to door/doorway geometry on tilted walls. Doors keep current behavior;
  if they look odd on sloped walls, that's a follow-up.
- No changes to endpoints, beamline equipment, pipes, or junctions (already pinned
  at fixed Y because they require flat tiles).
- No save-format migration. (Project is pre-release; existing saves break is fine.)

## Design

### 1. Shared height-sampling utility

Add to `src/game/terrain.js`:

```
sampleCornersAt(corners, u, v) → number
```

- `corners`: `{ nw, ne, se, sw }` in world meters (output of `getTileCornersY`).
- `u, v`: sub-cell coords in `[0, 1]`. `u=0,v=0` is NW corner; `u=1,v=1` is SE.
- Returns the bilinear interpolation:
  `(1-u)(1-v)·nw + u(1-v)·ne + uv·se + (1-u)v·sw`.
- Pure function. No state, no side effects.

**Why bilinear, not triangulated:** The floor mesh splits each tile into two
triangles along an unspecified diagonal; matching it would require knowing the
diagonal orientation everywhere. Worst-case offset between bilinear and triangulated
on a max 1-step (0.5 m) slope is ~6 cm at tile mid-edge — imperceptible at game
scale. Bilinear is simpler, locally correct at the corners, and good enough.

### 2. Wildflowers & grass tufts — sample per instance

**`src/renderer3d/wildflower-builder.js`**

Today: `computeFlowerInstancesForCell(col, row, minCornerY, ...)` receives a single
scalar `minCornerY` used for density/palette; instance positions are written with
hardcoded `y: 0`.

Change:

- Replace the `minCornerY` parameter with `corners` (`{ nw, ne, se, sw }`).
- Density / palette logic continues to use `Math.min(corners.nw, corners.ne, corners.se, corners.sw)` (no behavioral change there).
- For each instance, derive its sub-cell coordinates `u, v ∈ [0, 1]` from the
  instance's stored position (using whatever scaling the existing
  `dummy.position.set(...)` call uses to map sub-cell coords → world XZ within
  the tile), and set `y = sampleCornersAt(corners, u, v)`.
- The `dummy.position.set(...)` call uses the per-instance `y` instead of `0`.

**`src/renderer3d/grass-tuft-builder.js`**

Same change: pass `corners` instead of `minCornerY`; sample per instance for both
the clump mesh (`grass-tuft-builder.js:228`) and tall-blade mesh (`:273`).

**`src/renderer3d/world-snapshot.js`** — update the call sites that feed these two
builders to pass full `corners` instead of just `minCornerY`.

### 3. Sub-cell decoration height — resample per instance

**`src/renderer3d/world-snapshot.js`** — `buildDecorations`

Today (~line 274): one `getTileCornersY` call per tile, then `y = min(corners)`,
then every sub-cell instance in the tile gets that same `y`.

Change:

- Keep the single `getTileCornersY` call per tile (cache `corners`).
- For each decoration instance with a sub-cell offset, normalize that offset to
  `u, v ∈ [0, 1]` (matching the scaling already used for sub-cell placement) and
  compute `y = sampleCornersAt(corners, u, v)` per instance.
- Decorations with no sub-cell offset (legacy / centered) sample at `(0.5, 0.5)`,
  giving the bilinear midpoint of the four corners — typically slightly above
  `min(corners)`, which is acceptable for a centered placement.
- The output shape (array of `{ col, row, type, y, subCol, subRow }`) is unchanged;
  only the `y` value differs per instance.

`decoration-builder.js` requires no change — it already consumes `dec.y`.

### 4. Walls — parallelogram top

**`src/renderer3d/wall-builder.js`** (lines ~155–199, the wall geometry generation)

Today: bottom vertices use `baseY.a` / `baseY.b`; top vertices use
`max(baseY.a, baseY.b) + wallHeight` (flat top, trapezoidal silhouette).

Change: top vertices use `baseY.a + wallHeight` and `baseY.b + wallHeight`
respectively. Wall becomes a parallelogram in side view; height stays constant
along its length.

Applies to all wall types using the shared geometry path (solid walls and all fence
variants in `GROUNDS_WALLS`). Wall-merge logic stays untouched: walls at edges
with matching corner heights still merge into longer runs; mismatched heights still
keep them separate.

Door posts (`wall-builder.js:302–317`): out of scope. Keep current behavior. If
visual artifacts appear on sloped walls with doors, address as a follow-up.

### 5. Concrete pad — flat slab at y=0

**`src/renderer3d/world-snapshot.js`** — `buildFloors` (~line 158)

Where it currently does:
```
cornersY: getTileCornersY(game.state, tile.col, tile.row),
```

Change: when `tile.type === 'concrete'`, override to
`{ nw: 0, ne: 0, se: 0, sw: 0 }`. All other floor types keep terrain-conforming
behavior.

This will visually clip through any underlying sloped terrain — that's the
intended "building at y=0" behavior for now. Forcing terrain to flatten when a
concrete pad is placed, or rejecting placement on slopes, is a follow-up decision.

## Files touched

| File | Change |
|---|---|
| `src/game/terrain.js` | Add `sampleCornersAt(corners, u, v)` export. |
| `src/renderer3d/wildflower-builder.js` | Replace `minCornerY` param with `corners`; sample per instance. |
| `src/renderer3d/grass-tuft-builder.js` | Same as wildflower — both clump and tall-blade meshes. |
| `src/renderer3d/world-snapshot.js` | Pass `corners` to flower/grass builders; resample per sub-cell decoration; override `cornersY` for concrete pad. |
| `src/renderer3d/wall-builder.js` | Top vertices use `baseY.{a,b} + wallHeight` (parallelogram instead of flat top). |

## Acceptance criteria

- On a 1-step sloped tile with wildflowers, every flower's base touches the
  terrain mesh — no floating, no clipping below the surface.
- Same for grass tufts (clumps and tall blades).
- Multiple trees (sub-cell decorations) on one sloped tile each sit at their own
  local terrain height; downhill trees lower than uphill trees in the same tile.
- A wall placed on a 1-step slope has constant visual height along its length;
  bottom and top edges are parallel and both follow the slope.
- A concrete pad placed on sloped terrain renders as a horizontal flat slab at
  `y=0` (clipping the underlying slope is expected).
- All other floor types (grass, brick, cobblestone, dirt, path) continue to deform
  to their corner heights as before — no regression.
- No changes to placement validation, raycasting, or game state.
