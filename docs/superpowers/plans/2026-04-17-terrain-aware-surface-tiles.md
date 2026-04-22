# Terrain-Aware Surface Tiles & Walls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sub-cell surface elements (wildflowers, grass tufts, multi-instance decorations) sit on actual terrain heights, change walls to constant-height parallelograms on slopes, and pin concrete pad to a flat slab at `y=0`.

**Architecture:** One new pure utility (`sampleCornersAt`) shared by every consumer that needs a sub-cell terrain Y. Builders that previously hardcoded `y=0` switch to per-instance bilinear sampling of the tile's 4 corners. Wall geometry's top vertices switch from flat (`max(a,b)+H`) to per-end (`a+H`, `b+H`). Concrete pad's `cornersY` is overridden to all-zeros at the snapshot boundary.

**Tech Stack:** Vanilla ES modules, three.js (CDN global), `node:test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-17-terrain-aware-surface-tiles-design.md`

**Commit grouping (per project CLAUDE.md):** Group commits at logical boundaries, not per task.
- Tasks 1 → one commit (utility + tests)
- Tasks 2 + 3 → one commit (flowers + grass — same kind of change)
- Task 4 → one commit (sub-cell decorations)
- Task 5 → one commit (walls)
- Task 6 → one commit (concrete pad)

---

## File Structure

| File | Role |
|---|---|
| `src/game/terrain.js` | Add `sampleCornersAt(corners, u, v)` pure helper. Existing accessors (`getTileCorners`, `getTileCornersY`, etc.) untouched. |
| `test/test-terrain-sample.js` | New. Unit tests for `sampleCornersAt`. |
| `src/renderer3d/wildflower-builder.js` | Replace `minCornerY` param with `corners`; sample per-instance Y. Builder writes `f.y` into the dummy matrix. |
| `test/test-wildflower-builder.js` | Update existing tests to new signature; add a sloped-tile y-sampling test. |
| `src/renderer3d/grass-tuft-builder.js` | Add `corners` arg to `computeGrassTuftsForCell` (and to the tall-blade compute fn); per-instance Y in both `_buildClumpMesh` and `_buildTallMesh`. |
| `src/renderer3d/world-snapshot.js` | (a) `buildDecorations`: per-instance `y` via `sampleCornersAt(corners, u, v)`. (b) `buildFloors`: override `cornersY` to all-zeros when `tile.type === 'concrete'`. (c) Ensure `grassSurfaces` entries carry `cornersY` if they don't already (verify before changing). |
| `src/renderer3d/wall-builder.js` | Top vertices use per-end `baseY.{a,b} + height` instead of `max(a,b) + height`. |

---

## Task 1: `sampleCornersAt` utility + tests

**Files:**
- Modify: `src/game/terrain.js`
- Create: `test/test-terrain-sample.js`

**Design:**

Pure function. Bilinear interpolation over the 4 tile corners (in world meters). Convention: `u=0,v=0` is NW; `u=1,v=0` is NE; `u=1,v=1` is SE; `u=0,v=1` is SW. Matches `(col,row)` axes (u increases east with col, v increases south with row).

Signature:

```js
export function sampleCornersAt(corners, u, v) { ... }
```

Where `corners` is `{ nw, ne, se, sw }` in world meters (the shape returned by `getTileCornersY`).

Formula:
```
(1-u)(1-v)·nw + u(1-v)·ne + uv·se + (1-u)v·sw
```

No clamping of `u` / `v` — caller's responsibility (and in practice every caller has `u,v ∈ [0,1]` by construction).

- [ ] **Step 1.1 — Write the failing tests**

Create `test/test-terrain-sample.js` with `node:test` suite covering:
1. **Flat tile:** all 4 corners equal → returns that value for any `u, v` (test 5 sample points).
2. **Corner exactness:** `sampleCornersAt({nw:1, ne:2, se:3, sw:4}, 0, 0) === 1`; `(1, 0) === 2`; `(1, 1) === 3`; `(0, 1) === 4`.
3. **Edge midpoints:** for the same corners, `(0.5, 0) === 1.5` (NW↔NE midpoint), `(0.5, 1) === 3.5` (SW↔SE), `(0, 0.5) === 2.5` (NW↔SW), `(1, 0.5) === 2.5` (NE↔SE). *Note: NW↔SW = (1+4)/2 = 2.5; NE↔SE = (2+3)/2 = 2.5.*
4. **Center:** `(0.5, 0.5)` for `{1,2,3,4}` → `(1+2+3+4)/4 === 2.5`.
5. **1-step slope (realistic case):** `{nw:0, ne:0, se:0.5, sw:0.5}` → `(0.5, 0.5)` returns `0.25`.
6. **Sub-cell off-corner:** `{nw:0, ne:1, se:1, sw:0}` (saddle along east edge) → `(0.25, 0.25)` returns `0.1875` (verify by hand: `0.75·0.75·0 + 0.25·0.75·1 + 0.25·0.25·1 + 0.75·0.25·0 = 0.1875`).

- [ ] **Step 1.2 — Run, expect failure**

Command: `node --test test/test-terrain-sample.js`

Expected: `cannot find export 'sampleCornersAt'` or similar.

- [ ] **Step 1.3 — Implement**

Add `sampleCornersAt` to `src/game/terrain.js` (place near the other accessors, e.g. after `getTileCornersY`). Keep it as a one-liner-ish pure function, no validation.

- [ ] **Step 1.4 — Run, expect pass**

Command: `node --test test/test-terrain-sample.js`. Expected: all tests pass.

- [ ] **Step 1.5 — Commit (logical boundary: utility added)**

```
git add src/game/terrain.js test/test-terrain-sample.js
git commit -m "feat(terrain): add sampleCornersAt bilinear interp helper"
```

---

## Task 2: Wildflowers — per-instance terrain Y

**Files:**
- Modify: `src/renderer3d/wildflower-builder.js`
- Modify: `test/test-wildflower-builder.js`

**Design:**

Change `computeFlowerInstancesForCell(col, row, hash, brightness, minCornerY=0)` to `computeFlowerInstancesForCell(col, row, hash, brightness, corners=null)`. Internally: compute `minCornerY` as `Math.min(corners.nw, corners.ne, corners.se, corners.sw)` for the existing density/palette branches; new behavior is to set each instance's `y` via `sampleCornersAt(corners, u, v)`.

Sub-cell coordinates from instance position:
- The function emits `x = col + offX`, `z = row + offZ` with `offX, offZ ∈ [-0.4, 0.4]`.
- Map to `u, v ∈ [0, 1]`: `u = offX + 0.5`, `v = offZ + 0.5` (so u increases with col axis, v with row axis — matches `sampleCornersAt`'s convention).

When `corners == null` (back-compat for any callers that don't pass corners): treat as flat zero — `minCornerY = 0`, all instance `y = 0`.

Builder change in `WildflowerBuilder.rebuild`: instead of locally computing `minY` and passing it to the function, pass `cell.cornersY` directly. In the per-instance loop, replace `dummy.position.set(f.x * 2 + 1, 0, f.z * 2 + 1)` with `dummy.position.set(f.x * 2 + 1, f.y, f.z * 2 + 1)`.

**Why divide-by-2 doesn't apply to Y:** XZ scale is "tile units → world units = ×2" because tile width = 2 world units. Y values from `cornersY` are already in world meters (`step × 0.5`). No scaling needed.

- [ ] **Step 2.1 — Update existing tests for new signature**

In `test/test-wildflower-builder.js`, replace each `computeFlowerInstancesForCell(..., -0.3, 0)` style call (5th arg = minCornerY scalar) with the new shape, passing a `corners` object. Three flat values to use:
- Flat tile: `{nw:0, ne:0, se:0, sw:0}` (replaces previous `0`)
- Hollow: `{nw:-1.2, ne:-1.2, se:-1.2, sw:-1.2}` (replaces `-1.2`)
- Hilltop: `{nw:1.5, ne:1.5, se:1.5, sw:1.5}` (replaces `+1.5`); also `2.0` → all-2.0
- Brightness `+0.8` etc. unchanged.

Update the bounds-check test ("instances fall within their source cell bounds") to also assert `f.y === 0` (since the corners are flat zero in that test).

- [ ] **Step 2.2 — Add a new test for sloped Y sampling**

```js
test('sloped tile produces per-instance terrain Y', () => {
  const corners = { nw: 0, ne: 0, se: 0.5, sw: 0.5 }; // south side raised 1 step
  const cell = computeFlowerInstancesForCell(10, 20, 0xfeed, 0.8, corners);
  assert.ok(cell.length > 0);
  for (const f of cell) {
    const offX = f.x - 10;
    const offZ = f.z - 20;
    const u = offX + 0.5;
    const v = offZ + 0.5;
    // Expected Y: south half raised → y = 0 * (1-v) + 0.5 * v = 0.5 * v
    const expected = 0.5 * v;
    assert.ok(Math.abs(f.y - expected) < 1e-6,
      `flower y=${f.y} expected≈${expected} (offZ=${offZ}, v=${v})`);
  }
});
```

- [ ] **Step 2.3 — Run, expect failure**

Command: `node --test test/test-wildflower-builder.js`. Expected: tests fail (signature/return-shape mismatch).

- [ ] **Step 2.4 — Implement signature change + per-instance Y**

In `src/renderer3d/wildflower-builder.js`:
1. Update `computeFlowerInstancesForCell` signature: replace 5th arg `minCornerY` with `corners`. Default `corners = null`.
2. At top of body: `const c = corners || { nw: 0, ne: 0, se: 0, sw: 0 }; const minCornerY = Math.min(c.nw, c.ne, c.se, c.sw);`. Existing density/palette branches use `minCornerY` unchanged.
3. In the instance loop, after computing `offX, offZ`: `const u = offX + 0.5; const v = offZ + 0.5; const y = sampleCornersAt(c, u, v);`. Set `y` in the pushed instance.
4. Add `import { sampleCornersAt } from '../game/terrain.js';` at top.
5. In `WildflowerBuilder.rebuild`: replace `const minY = c ? Math.min(...) : 0;` and the call passing `minY` with passing `cell.cornersY` (or `null` if absent) directly.
6. In `dummy.position.set(...)` line: change middle arg from `0` to `f.y`.

- [ ] **Step 2.5 — Run, expect pass**

Command: `node --test test/test-wildflower-builder.js`. Expected: all tests pass.

---

## Task 3: Grass tufts — per-instance terrain Y

**Files:**
- Modify: `src/renderer3d/grass-tuft-builder.js`

**Design:**

Same pattern as Task 2, applied to `computeGrassTuftsForCell` (clump path) and the tall-blade compute function. Both currently emit `t.x = col + offX`, `t.z = row + offZ`, `t.y = 0`. After:

- Add a trailing `corners = null` param to each compute fn.
- For each instance: compute `u = offX + 0.5`, `v = offZ + 0.5`, set `t.y = sampleCornersAt(c, u, v)` where `c = corners || { nw:0,ne:0,se:0,sw:0 }`.
- Note the existing clamp: blades' `offX, offZ` are clamped to `[-0.48, 0.48]`. After the clamp, derive `u, v` from those clamped values (so they remain in `[0.02, 0.98]`).
- Import `sampleCornersAt` from `../game/terrain.js`.

Builder changes in `_buildClumpMesh`:
- For the `terrain` loop (line ~259): pass `cell.cornersY` to `computeGrassTuftsForCell`. (`terrain` entries already carry `cornersY` — verified.)
- For the `clumpCells` loop (line ~265): same — pass `cell.cornersY`. **Requires** adding `cornersY` to `buildGrassSurfaces` in `world-snapshot.js` (line ~131; confirmed missing today).
- In `_writeInstance` (line ~282), change `dummy.position.set(t.x * 2 + 1, 0, t.z * 2 + 1)` → `dummy.position.set(t.x * 2 + 1, t.y, t.z * 2 + 1)`.

Builder changes in `_buildTallMesh` (line ~294):
- Pass `cell.cornersY` to `computeTallGrassBladesForCell`.
- At line ~329, change `dummy.position.set(b.x * 2 + 1, 0, b.z * 2 + 1)` → `dummy.position.set(b.x * 2 + 1, b.y, b.z * 2 + 1)`.

- [ ] **Step 3.1 — Add cornersY to grassSurfaces snapshot**

In `src/renderer3d/world-snapshot.js`, `buildGrassSurfaces` (line ~126), add `cornersY: getTileCornersY(game.state, tile.col, tile.row)` to the pushed object.

- [ ] **Step 3.2 — Update `computeGrassTuftsForCell` signature** (line ~60)

Add trailing `corners = null` param. At top of body, resolve `const c = corners || { nw:0,ne:0,se:0,sw:0 };`. For each blade, after the clamp on `offX`/`offZ`, compute `const u = offX + 0.5; const v = offZ + 0.5; const y = sampleCornersAt(c, u, v);` and set `y` in the pushed object (replacing the current `y: 0`).

- [ ] **Step 3.3 — Update `computeTallGrassBladesForCell` signature** (line ~110)

Same pattern as 3.2. Add `corners = null` arg, derive per-instance `y`, replace `y: 0` in the pushed blade objects with the computed value.

- [ ] **Step 3.4 — Update `_buildClumpMesh` and `_buildTallMesh`**

In `_buildClumpMesh`: pass `cell.cornersY` as the 5th arg to `computeGrassTuftsForCell` (terrain loop) and as the 6th arg (after `mul`) to the clumpCells call. In `_writeInstance`, use `t.y`. In `_buildTallMesh`, pass `cell.cornersY` to `computeTallGrassBladesForCell` and use `b.y` in `dummy.position.set`.

Add `import { sampleCornersAt } from '../game/terrain.js';` at top of `grass-tuft-builder.js`.

- [ ] **Step 3.5 — Manual smoke check (no unit tests exist yet for grass)**

Run the dev server (whatever the project uses — likely `index.html` opened directly, or a static-server command from `package.json`). Visually verify on a sloped tile that grass tufts and tall blades sit on the surface, no floating/clipping.

If you can't run the browser, at minimum confirm the file still parses by running existing tests: `node --test test/`.

- [ ] **Step 3.6 — Commit Tasks 2 + 3 together (logical boundary: per-instance Y for sub-cell vegetation)**

```
git add src/renderer3d/wildflower-builder.js test/test-wildflower-builder.js \
        src/renderer3d/grass-tuft-builder.js src/renderer3d/world-snapshot.js
git commit -m "feat(renderer3d): wildflowers and grass tufts sample terrain Y per instance"
```

---

## Task 4: Sub-cell decorations — per-instance terrain Y

**Files:**
- Modify: `src/renderer3d/world-snapshot.js`

**Design:**

`buildDecorations` (line ~266) currently computes `y = Math.min(c.nw, c.ne, c.se, c.sw)` once per tile. Change: each decoration gets its own `y` from `sampleCornersAt(c, u, v)` where `(u, v)` is normalized from `(d.subCol, d.subRow)`.

**Sub-cell normalization.** A tile is divided into sub-cells. Decorations have `subCol`, `subRow` (or null if centered). Read `DECORATIONS_RAW` to find the sub-grid resolution if it isn't already obvious from existing code in `decoration-builder.js`. Most likely 4×4 (`subW: 4`, `subL: 4` are seen in the current code). The decoration occupies a footprint of `subW × subL` sub-cells starting at `(subCol, subRow)` — sample at the **center of that footprint**:

```js
const subRes = 4; // tile divided into subRes×subRes sub-cells (verify: search DECORATION_SUB_RES or similar in decoration-builder.js / structure.js)
const u = (d.subCol != null)
  ? ((d.subCol + raw.subW / 2) / subRes)
  : 0.5;
const v = (d.subRow != null)
  ? ((d.subRow + raw.subL / 2) / subRes)
  : 0.5;
const y = sampleCornersAt(c, u, v);
```

If `subRes` is something other than 4, fix accordingly. Confirm by reading `decoration-builder.js` for how it converts `(subCol, subRow, subW, subL)` to in-tile world XZ — the same scaling applies here.

**Fallback:** If `corners` is available but `subCol/subRow` are null and `subW/subL` are also missing, sample at `(0.5, 0.5)`.

- [ ] **Step 4.1 — Confirm sub-cell resolution**

Read `src/renderer3d/decoration-builder.js` around the placement code (search for `subCol` / `subW` usage). Identify the constant or formula that converts `(subCol, subW)` to in-tile XZ (in tile units or world units). Pin down `subRes` (the divisions per tile) from that — confirm it matches the formula above.

- [ ] **Step 4.2 — Update `buildDecorations`**

In `src/renderer3d/world-snapshot.js`:
1. Add `import { sampleCornersAt } from '../game/terrain.js';` at top if not already present (it should be; `getTileCornersY` is imported from there already).
2. Replace `const y = Math.min(c.nw, c.ne, c.se, c.sw);` with the `(u, v)` derivation above and `const y = sampleCornersAt(c, u, v);`.
3. Output shape unchanged — just `y` differs per instance.

- [ ] **Step 4.3 — Smoke check**

Place multiple trees on a sloped tile (or one of the existing decoration types in your starter map). Confirm in browser that downhill instances sit lower than uphill instances.

- [ ] **Step 4.4 — Commit (logical boundary: sub-cell decoration Y)**

```
git add src/renderer3d/world-snapshot.js
git commit -m "feat(renderer3d): sub-cell decorations sample terrain Y per instance"
```

---

## Task 5: Walls — parallelogram top

**Files:**
- Modify: `src/renderer3d/wall-builder.js`

**Design:**

Wall geometry deformation lives at lines ~155–199. Currently:
- `topY = max(baseY.a, baseY.b) + height` — flat top at the higher end's elevation
- Bottom interpolates trapezoidally between `yLow` and `yHigh`

Change: top vertex Y also interpolates between `yLow + height` and `yHigh + height`, by the same long-axis parameter `t`. Result: top edge parallel to bottom edge; constant wall height along its length.

Mechanically:
- Remove `const topY = Math.max(baseY.a, baseY.b) + height;`.
- In the per-vertex loop, the `if (vy > 0)` branch becomes:
  ```js
  // Top vertex — interpolate same as bottom, plus wall height.
  const along = isNS ? arr[ix + 0] : arr[ix + 2];
  const t = halfLen > EPS ? (along + halfLen) / (2 * halfLen) : 0;
  arr[ix + 1] = (yLow + (yHigh - yLow) * t) + height;
  ```
- Bottom branch unchanged.

**Wall merging:** The merge logic (mentioned in initial exploration around lines 511–575) only merges adjacent walls when shared corner heights match. With parallelogram tops, adjacent matched-height walls still produce continuous top + bottom edges (they share the same `baseY` at the seam, so both top and bottom are continuous). Mismatched heights still don't merge. **No change to merge logic needed** — verify by re-reading the merge code briefly to confirm it doesn't depend on the old `topY = max(...)` invariant.

**Door posts** (lines ~302–317): Out of scope per spec. Leave untouched. They may visually misalign on tilted walls; that's a follow-up.

- [ ] **Step 5.1 — Re-read wall merge code**

Read `src/renderer3d/wall-builder.js` around lines 511–575. Confirm the merge logic only checks corner-height equality at shared endpoints — not the old flat-top invariant. If it does depend on flat tops, design a fix; if not (expected case), proceed.

- [ ] **Step 5.2 — Apply geometry change**

Edit the per-vertex deformation loop in `wall-builder.js` (lines ~184–198) per the design above. Remove the now-unused `topY` local.

- [ ] **Step 5.3 — Run existing tests**

Command: `node --test test/`. Expected: all pass (no wall-builder unit tests should break; the change is geometry-only).

- [ ] **Step 5.4 — Smoke check**

Place a wall (any type — solid wall, hedge, picket fence) on a 1-step slope. Visual: wall has constant height along its length, top edge follows bottom slope. Place a multi-segment wall along several adjacent tiles with mixed flat/sloped corners — verify it looks coherent (matched-height segments merge; mismatched stay separate, same as before).

- [ ] **Step 5.5 — Commit (logical boundary: wall geometry change)**

```
git add src/renderer3d/wall-builder.js
git commit -m "feat(renderer3d): walls render as parallelograms on slopes (constant height)"
```

---

## Task 6: Concrete pad — flat slab at y=0

**Files:**
- Modify: `src/renderer3d/world-snapshot.js`

**Design:**

In `buildFloors` (line ~158), when `tile.type === 'concrete'`, override `cornersY` to all-zeros so the floor mesh renders flat at world Y=0 regardless of underlying terrain.

```js
const isConcrete = tile.type === 'concrete';
const cornersY = isConcrete
  ? { nw: 0, ne: 0, se: 0, sw: 0 }
  : getTileCornersY(game.state, tile.col, tile.row);
```

No other changes. Floor builder consumes this `cornersY` as-is.

**Visual side-effect:** A concrete pad placed on a sloped tile will visually clip through the terrain. That is the intended "building at y=0" behavior per spec, deferred for later.

- [ ] **Step 6.1 — Apply override**

Edit `buildFloors` in `src/renderer3d/world-snapshot.js`. Replace the inline `cornersY:` line with the conditional above.

- [ ] **Step 6.2 — Smoke check**

Place a concrete pad on a sloped tile. Confirm it renders as a horizontal slab at y=0 (clipping into terrain on the high corner is expected and fine).

- [ ] **Step 6.3 — Confirm no regression on other floor types**

Place grass / brick / dirt / cobblestone / path on a sloped tile. Confirm they still deform to corner heights as before.

- [ ] **Step 6.4 — Commit (logical boundary: concrete pad behavior change)**

```
git add src/renderer3d/world-snapshot.js
git commit -m "feat(renderer3d): pin concrete pad floor to flat slab at y=0"
```

---

## Acceptance — final manual verification

After all tasks complete, with the dev server running:

- [ ] Wildflowers on a 1-step sloped grass tile sit on the surface (no floating, no clipping).
- [ ] Grass tufts (clumps + tall blades) on a sloped wildgrass/tallgrass tile sit on the surface.
- [ ] A tile with multiple trees on a slope shows downhill trees lower than uphill ones.
- [ ] A wall placed across a 1-step slope has constant visual height; top + bottom edges parallel and both sloped.
- [ ] Adjacent walls with matching corner heights still merge; mismatched ones stay separate (no regression).
- [ ] A concrete pad on sloped terrain renders as a flat horizontal slab at y=0.
- [ ] Other floor types (grass, brick, cobblestone, dirt, path) still deform to terrain.
- [ ] No console errors. Existing tests still pass: `node --test test/`.
