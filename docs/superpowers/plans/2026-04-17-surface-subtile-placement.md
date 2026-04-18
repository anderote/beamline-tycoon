# Surface Subtile Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multiple items on bench-like surfaces via subtile positions, with recursive stacking and drop-to-underlying-surface on removal.

**Architecture:** The existing `stackParentId`/`stackChildren`/`placeY`/`cells` fields already support multi-child surfaces. The implementation changes `findStackTarget` from a last-child linear walk to a cursor-anchored descent; adds sibling-collision validation in `canStack`; drops the height-cap early-return in `collapsePlan` and `removePlaceable`; and leaves rendering, save/load, and data schemas unchanged.

**Tech Stack:** Vanilla JS modules (no build-tool test runner); Node-runnable tests in `test/*.js`.

**Design doc:** `docs/superpowers/specs/2026-04-17-surface-subtile-placement-design.md`

---

## File Structure

| File | Role | Change type |
|---|---|---|
| `src/game/stacking.js` | Pure stacking logic | Modify: add sibling check; rewrite target resolution; soften collapsePlan |
| `src/game/Game.js` | Placeable CRUD | Modify: remove height-cap early-return in `removePlaceable` |
| `test/test-surface-subtile-placement.js` | Unit tests | Create |

No changes to `InputHandler.js`, renderers, or data files: they consume `findStackTarget`'s existing return shape and read `placeY` from entries.

---

## Task 1: Sibling-collision check in canStack

**Files:**
- Modify: `src/game/stacking.js` (`canStack` at lines 32-61)

**What:** `canStack` currently checks containment and height. Add a third check: for the target's existing `stackChildren`, none of their `cells` may intersect the new stackable's footprint cells. This is the single-most-important change — it's what makes multiple siblings disjoint.

**Signature change:** `canStack(stackableDef, targetEntry, targetDef, col, row, subCol, subRow, dir, getEntry)` — a new trailing `getEntry(id)` parameter so canStack can look up sibling entries to read their `cells`.

- [ ] **Step 1: Write the failing test** in `test/test-surface-subtile-placement.js` for the sibling-overlap case (see Task 4 for the full test file). Specifically, add a unit test that constructs a mock target with `stackChildren: ['A']` where entry A has `cells: [{col:0,row:0,subCol:0,subRow:0}]`, then calls `canStack` with a footprint that overlaps that cell. Expect `{ ok: false, reason: /collision|occupied/ }`.

- [ ] **Step 2: Run tests; confirm the new test fails** (old canStack returns ok because it has no sibling awareness).

- [ ] **Step 3: Implement** the sibling check. Before the existing containment loop returns ok, iterate `targetEntry.stackChildren`; for each child id resolve `child = getEntry(id)`; build a set of child cell keys; if any stackable footprint cell appears in any sibling's cell set → return `{ ok: false, placeY: 0, reason: 'Surface subtile occupied' }`. Use the same `cellKey` helper already in the file.

- [ ] **Step 4: Pass new canStack arg through callers.** Update the single internal caller inside `findStackTarget` (line 125) to pass `getEntry` through. Grep the repo for any other `canStack(` usage and update signatures.

- [ ] **Step 5: Re-run tests; new test passes, old tests still pass.**

- [ ] **Step 6: Commit.**

**Acceptance:** sibling-overlap unit test green.

---

## Task 2: Cursor-anchored descent in findStackTarget

**Files:**
- Modify: `src/game/stacking.js` (`findStackTarget` at lines 107-129; can also remove now-unused `topmostInStack` if no other consumers)

**What:** Replace the linear `topmostInStack` walk with a descent that picks the topmost item whose `cells` contain the full stackable footprint. This is the "highest surface at cursor" rule.

**New algorithm** (per spec §Placement target resolution):

1. Look up each cell of the stackable's footprint in `subgridOccupied`.
   - All empty → return `null` (no stack target; caller will fall through to ground validation).
   - Mixed empty/occupied OR occupied by different ground items → return `null`.
   - All occupied by the same ground item `G` → proceed to step 2.
2. Let `current = G`. Loop:
   - For each child id in `current.stackChildren`, get the child entry; build its cell-key set; if the stackable footprint is a subset of the child's cells, set `current = child` and continue the loop. (By invariant only one child per level can contain the footprint; break after the first match.)
   - If no child contains the footprint, break the loop.
3. Validate on `current`: look up `currentDef = getDef(current.type)`; call `canStack(stackableDef, current, currentDef, col, row, subCol, subRow, dir, getEntry)`; if `!ok` → return `null`; else return `{ targetEntry: current, placeY: result.placeY }`.

- [ ] **Step 1: Write tests** covering (a) descent into tray-on-bench when cursor is inside tray; (b) stop-at-bench when cursor is inside bench but outside tray; (c) reject when sibling would partially overlap; (d) reject when footprint straddles two ground items. Add these to `test/test-surface-subtile-placement.js`.

- [ ] **Step 2: Run tests; expect failures** (current impl goes to last child, not containing-child).

- [ ] **Step 3: Rewrite findStackTarget** to the algorithm above. Keep `cellKey` helper. `topmostInStack` becomes unused — remove it along with its export if no external consumer (`grep -r "topmostInStack" src/ test/`).

- [ ] **Step 4: Re-run all tests;** both new descent tests and previous canStack test pass.

- [ ] **Step 5: Commit.**

**Acceptance:** descent tests green; placing on a bench that already has a tray at sub-region (0,0)-(1,1) correctly targets the tray when cursor is inside tray cells, and the bench otherwise.

---

## Task 3: Drop-to-underlying-surface on remove

**Files:**
- Modify: `src/game/stacking.js` (`collapsePlan` at lines 68-100)
- Modify: `src/game/Game.js` (`removePlaceable` around lines 1308-1312)

**What:** Two small changes, one place each.

1. **stacking.js:** in `collapsePlan`, the height-cap block `if (childDef && newY + childDef.subH > MAX_STACK_HEIGHT) return false` can never fire when removal shifts `Y` downward — delete it. Keep the `if (newY < 0) return false` guard as a defensive invariant. The function now never returns `null`; signature stays but reflect in comment. Caller-side `updates === null` path becomes dead; leave the check in place in Game.js for safety but change the behavior when it does fire (see below).

2. **Game.js `removePlaceable`:** when `updates === null` (shouldn't happen now but be defensive), do NOT abort with the "cannot remove" log. Instead, fall through to remove the item anyway and skip the updates loop (children will still be re-parented to `entry.stackParentId` via the direct-children loop that follows). Specifically, delete lines 1309-1312:
   ```
   if (updates === null) {
     this.log('Cannot remove — stack would exceed height limit!', 'bad');
     return false;
   }
   ```
   and replace the subsequent `for (const u of updates)` loop with `for (const u of (updates || []))` so it no-ops if updates is null.

- [ ] **Step 1: Write tests** for removal scenarios: (a) remove ground bench with 3 siblings on top — all 3 re-parent to ground, their cells appear in subgridOccupied, all have placeY=0; (b) remove middle tray with 2 beakers on it — both beakers re-parent to the underlying bench with placeY = bench.surfaceH; (c) remove a lone stackable on ground; (d) removing a deeply nested item doesn't violate any invariant (beaker on tray on bench: remove beaker, confirm tray and bench unchanged).

- [ ] **Step 2: Run tests; expect failures** (current code either blocks on height or mis-handles multi-child).

- [ ] **Step 3: Make the edits above** in stacking.js and Game.js.

- [ ] **Step 4: Re-run tests; remove-scenarios pass.**

- [ ] **Step 5: Commit.**

**Acceptance:** all T4/T5 scenarios from the spec pass; no "cannot remove — stack would exceed height limit" log path under any remove operation.

---

## Task 4: Test file

**Files:**
- Create: `test/test-surface-subtile-placement.js`

**What:** Self-contained test file in the project's simple `node test/foo.js` style (see `test/test-pipe-placements.js` for the idiom). Tests exercise `canStack`, `findStackTarget`, and `collapsePlan` directly with hand-crafted fixtures — no Game instance. For integration-level remove behavior (Task 3 Step 1), drive `Game` directly (see `test/test-place-all-components.js` for a Game-driver pattern) or use a thin mock; pick whichever is shorter. Prefer to keep tests on the pure helpers where possible.

**Fixture design:** Mock placeable defs with `footprintCells(col,row,sc,sr,dir)` returning cells for a subW×subL footprint; mock `getEntry` and `getDef` via small Maps. Tests T1-T8 from the spec map roughly 1:1 to unit tests here.

- [ ] **Step 1: Scaffolding** — copy the assert/test boilerplate from `test/test-pipe-placements.js`. Define `mockDef({ subW, subL, subH, hasSurface, stackable, surfaceY? })` that produces a stackable-compatible def with a `footprintCells` function iterating subW×subL. Define `mockEntry({ id, type, col, row, subCol, subRow, dir, cells, stackParentId, stackChildren, placeY })`.
- [ ] **Step 2: Tests T1-T2** (multi-place and collision) via `canStack`.
- [ ] **Step 3: Tests T3, T6** (recursive, cursor descent) via `findStackTarget`.
- [ ] **Step 4: Tests T4-T5** (re-parent on remove) via `collapsePlan` + a helper that applies updates to a cell-map to confirm subgridOccupied ends up correct.
- [ ] **Step 5: Test T8** (height cap on placement remains enforced).
- [ ] **Step 6: Run** `node test/test-surface-subtile-placement.js`. All pass.
- [ ] **Step 7: Commit** tests alongside the Task 1-3 commits is fine (grouped commit per project convention); if Tasks 1-3 are already committed, commit tests separately.

**Acceptance:** `node test/test-surface-subtile-placement.js` prints all-green.

---

## Task 5: Manual smoke test in browser

**Files:** None modified.

**What:** Start the dev server and verify the feature works end-to-end: UI ghost, click placement, visual result, demolish with children.

- [ ] **Step 1: Start dev server.** `npm run dev`. Open the printed URL.
- [ ] **Step 2: Smoke-test multi-placement.** Spawn an `rfWorkbench`, then place two `oscilloscope`s on different subtiles of the bench. Both should appear. Rotate/pan camera to confirm.
- [ ] **Step 3: Smoke-test sibling collision.** Try to place a third oscilloscope overlapping an existing one — ghost should show invalid.
- [ ] **Step 4: Smoke-test recursive stacking.** If any 2×2+ stackable with `hasSurface` exists in the catalog, place it on the bench, then place an oscilloscope on it. If no such item exists, document that recursive stacking works by unit test only and move on.
- [ ] **Step 5: Smoke-test demolish drop.** Demolish the bench from Step 2; the two oscilloscopes should remain on the floor at their prior subtile positions.
- [ ] **Step 6: Save/reload.** Trigger save, refresh, reload — tree structure and positions preserved.
- [ ] **Step 7: Report** any regressions; otherwise done.

**Acceptance:** all steps behave as described; no console errors.

---

## Non-Goals (reminder)

- No new items.
- No save-format bump.
- No animated drop; instantaneous re-parent.
- No unrelated refactors.
