# Surface Subtile Placement

## Overview

Extend the existing surface-stacking system so that items with `hasSurface: true` can host **multiple** children at different subtile positions on their top surface, rather than only one child per surface. The existing 4×4 subtile grid already defines item footprints; we extend it vertically so the top of a bench is itself a subtile grid on which smaller items can be arranged.

Recursive: a child with `hasSurface` can itself carry children. When a parent is removed, its children drop to whatever surface is beneath them (another surface item if present, otherwise the floor) rather than being cascade-deleted.

## Current State

The surface-stacking system (`docs/superpowers/specs/2026-04-11-surface-stacking-design.md`) already defines the fields (`placeY`, `stackParentId`, `stackChildren`) and the item flags (`hasSurface`, `stackable`). The intent — per that spec's "Edge Cases" — was to allow multiple siblings on one surface. In practice the code implements only linear chains:

- `src/game/stacking.js:17-26` `topmostInStack` always follows the *last* child. Placing on a bench that already has one item puts the new item on top of that item, not beside it on the bench.
- `src/game/stacking.js:32-61` `canStack` checks footprint containment against the topmost item only; it doesn't consider siblings.
- `src/game/stacking.js:68-100` `collapsePlan` assumes a linear shift-down (child moves down by parent's height); blocks deletion on height-cap violations.
- `src/input/InputHandler.js` (ghost pipeline) and `src/game/Game.js` (`placePlaceable`, `removePlaceable`) call these helpers.

## Goals

1. A surface accepts multiple children whose footprints are subsets of the parent's footprint and mutually disjoint.
2. Cursor targeting picks the **topmost** surface that fully contains the ghost's footprint and has no colliding sibling — i.e. the "highest surface at this subtile" rule.
3. Recursive: a stackable child with `hasSurface` can itself be targeted as a parent for further placement.
4. On removal, children drop to the nearest underlying surface (or floor) instead of cascade-delete or block-on-height-violation.
5. No new item content or item-data schema changes.
6. Save format already contains all needed fields; no migration.

## Non-Goals

- New tabletop-only item content.
- Animated drop or lift when re-parenting on demolish (instantaneous update).
- Nesting depth limit beyond the existing `MAX_STACK_HEIGHT = 8` subtiles.
- Generic "place anywhere" mode — placement remains snap-to-subtile.

## Design

### Data model

No schema changes. Fields already present on each placeable instance:

- `stackParentId: string | null`
- `stackChildren: string[]` — now used as a **set of siblings on one surface** rather than a single-successor pointer.
- `placeY: number` — subtile Y offset.
- `cells: Array<{col,row,subCol,subRow}>` — world subtile footprint.

Invariants (enforced on placement):

- For a non-ground item C with parent P: `C.cells ⊆ P.cells`.
- For any two siblings C1, C2 (both parented to P): `C1.cells ∩ C2.cells = ∅`.
- `C.placeY = P.placeY + (P.surfaceY ?? P.subH)`.
- `C.placeY + C.subH ≤ MAX_STACK_HEIGHT` (height cap; already enforced).

`subgridOccupied` continues to track ground-level items only. Multi-child occupancy on a surface is derived by scanning `parent.stackChildren` — approach C (no per-surface index).

### Placement target resolution

Replace the linear `topmostInStack` walk with a **cursor-anchored descent**. Given the ghost footprint cells `F` at the snapped cursor position:

1. Look up `subgridOccupied` at each cell in `F`:
   - If all cells are empty → target = ground (floor placement).
   - If some cells are occupied and some are empty → no valid target (mixed footprint).
   - If all cells occupied by the **same** ground item `G` → proceed to step 2.
   - If cells occupied by different ground items → no valid target.
2. Starting at `G`, descend into `stackChildren`: among the current node's children, find any child `K` such that `F ⊆ K.cells`. If found and `K` has `hasSurface || stackable`, recurse into `K`.
3. Stop descending when no child contains `F`. The last node reached is the **candidate parent** `P`.
4. Validate placement on `P`: `F ⊆ P.cells` (holds by construction after step 1/3 — for ground, `F` equals the cells; for a child `P`, `F ⊆ P.cells`); for each existing sibling `S ∈ P.stackChildren`, `F ∩ S.cells = ∅`; `P.placeY + P.surfaceY/subH + item.subH ≤ MAX_STACK_HEIGHT`.
5. If step 4 passes, target = `P` with `placeY = P.placeY + (P.surfaceY ?? P.subH)`.
6. If step 4 fails (e.g. sibling collision), no valid target — ghost shows invalid.

This resolution rule is deterministic and gives the intuitive behavior: cursor over empty bench → target bench; cursor over tray on bench → target tray; cursor over beaker on tray → no valid target (beaker isn't a surface) so invalid.

Tie-breaking if multiple siblings of the same parent contain `F`: by invariant they can't, since siblings are disjoint. So at most one child per level contains `F`.

### Placement commit

`placePlaceable` (in `src/game/Game.js`):
- If stack target, append the new item's id to `target.stackChildren`, set `item.stackParentId = target.id`, set `item.placeY` from the resolver, compute and store `item.cells`. Do **not** touch `subgridOccupied`.
- If ground, existing behavior: add to `subgridOccupied` for each cell.

### Removal and re-parenting

Replace `collapsePlan` with a re-parent walk. Given the item `I` being removed:

1. For each direct child `C ∈ I.stackChildren`:
   - Find `U`, the underlying surface at `C`'s footprint: `U = I.stackParentId ? getEntry(I.stackParentId) : null`. If `U` is `null`, `C` drops to ground.
   - If `U` is non-null: set `C.stackParentId = U.id`; add `C.id` to `U.stackChildren` (remove I.id from U.stackChildren first); `C.placeY = U.placeY + (U.surfaceY ?? U.subH)`.
   - If `U` is `null` (I was ground): set `C.stackParentId = null`; `C.placeY = 0`; add each cell of `C.cells` to `subgridOccupied` (pointing to `C.id`).
2. Recompute `placeY` for all descendants of `C` by walking the tree and setting each descendant's `placeY = parent.placeY + parent.surfaceY/subH`.
3. If `I` was ground, remove I's cells from `subgridOccupied`.
4. Remove `I` from its parent's `stackChildren` (if any). Delete `I` from `placeables` and `placeableIndex`.

Collision safety: when `U ≠ null`, the siblings of `I` on `U` occupy subtiles disjoint from `I`'s footprint (invariant), and `C`'s cells are a subset of `I`'s cells, so `C` cannot collide with I's siblings on `U`. When `U = null`, `I`'s cells were in `subgridOccupied` before removal (since I was ground); `C.cells ⊆ I.cells` so `C` fits on the same ground footprint once I is removed.

Height cap after re-parent: `C.placeY` drops by at least `I.subH` (from `U.surfaceY + I.subH + ...` down to `U.surfaceY`), so the existing height cap cannot be newly violated.

### Rendering

No changes required. `src/renderer3d/equipment-builder.js:120-200` already uses `item.placeY` for vertical offset. Ghost preview at `src/renderer3d/ThreeRenderer.js:1958-2019` already uses the computed `placeY`. After re-parenting, Game emits its existing "placeables changed" signal and the renderer rebuilds meshes at the new `placeY`.

### Ghost preview / input

`src/input/InputHandler.js` (snap + `findStackTarget` + hover-state): the updated `findStackTarget` returns `null` when sibling collision prevents placement; existing invalid-ghost visuals apply unchanged.

### Save / load

`state.placeables` already contains `stackParentId`, `stackChildren`, `placeY`, `cells`. Save-format version does not need to bump. Load-path rebuild (`src/game/Game.js:3099-3131`) iterates `placeables` and rebuilds `subgridOccupied` from ground-level entries; no changes.

Pre-release so, per project CLAUDE.md, existing saves may break if they somehow contain inconsistent state from the old linear-chain model — no migrator needed.

## Affected files

| File | Change |
|---|---|
| `src/game/stacking.js` | Rewrite `findStackTarget` to use cursor-anchored descent; add sibling-collision check in `canStack`; replace `collapsePlan` with `reparentOnRemove`. |
| `src/game/Game.js` | `removePlaceable`: call new re-parent logic instead of collapse-or-block; `placePlaceable`: unchanged beyond validation now going through updated helpers. |
| `src/input/InputHandler.js` | No functional change beyond consuming updated return values; verify hover feedback still correct. |
| `test/test-surface-subtile-placement.js` (new) | Unit tests for multi-child placement, recursive descent, re-parent on remove. |

## Acceptance criteria

- **T1 Multi-place on bench.** Place `rfWorkbench` (4×2). Place two 1×1 small items on different subtiles → both parented to the bench with same `placeY`. `bench.stackChildren.length == 2`.
- **T2 Collision on bench.** With one 1×1 on a bench subtile, attempt to place another item overlapping that subtile → placement rejected, ghost invalid.
- **T3 Recursive stack.** Place bench; place a tray (2×2, hasSurface) on bench; place a 1×1 item on tray → item's parent is tray, not bench. `bench.stackChildren = [tray]`, `tray.stackChildren = [item]`. `item.placeY == tray.placeY + tray.subH`.
- **T4 Remove mid-tree.** In scenario T3, remove tray → item re-parents to bench with `item.placeY == bench.placeY + bench.subH`; `bench.stackChildren = [item]`.
- **T5 Remove ground bench.** Place bench with 3 small items on different subtiles, remove bench → each small item re-parents to ground; their `cells` appear in `subgridOccupied`; each `placeY == 0`.
- **T6 Cursor targeting.** Hovering over a subtile occupied by a tray on a bench (inside tray's cells) with a 1×1 ghost that fits tray → ghost previews on tray surface. Hovering over a subtile on the bench but outside the tray → ghost previews on bench surface.
- **T7 Save/load round-trip.** Populate a bench + tray + 2 items, save, load → tree preserved, all `placeY` and `stackChildren` consistent, renders identically.
- **T8 Height cap.** Building a stack that would cause `placeY + subH > MAX_STACK_HEIGHT` on placement is rejected. Re-parenting on removal cannot violate the cap because it only decreases heights.
