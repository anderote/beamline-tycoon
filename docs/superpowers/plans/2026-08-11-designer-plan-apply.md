# Beamline Designer: draft → plan → apply — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-08-11-designer-plan-apply-design.md`

**Goal:** Make the Beamline Designer a real editing surface in pipe-graph edit mode. The draft is a desired end state that accepts every component; a pure planner diffs it against the map; Apply executes the plan as an all-or-nothing transaction behind a preview; plots can compare proposed against current.

**Architecture:** One new pure module (`designer-plan.js`) holds all diff/layout reasoning. `BeamlineSystem` gains the mutation primitives the plan needs (`splitPipe`, `mergePipe`, `trimPipe`, `moveJunction`). `BeamlineDesigner.confirm()` becomes plan → preview → transactional apply, replacing `_reconcileToPipeGraph`. `probe-plots.js` gains an opts argument so two envelopes can share a y-domain.

**Tech Stack:** Vanilla JS (ES modules), Playwright for browser coverage, `node scripts/run-tests.mjs` for the unit suite.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/ui/BeamlineDesigner.js` | Modify | Drop the module guard; `confirm()` → plan/preview/apply; baseline envelope |
| `src/renderer/designer-renderer.js` | Modify | Type-filter the designer palette; two-pass plot render; source toggle |
| `src/beamline/designer-plan.js` | Create | Pure planner: draft + map → ordered ops, summary, blockers |
| `src/beamline/pipe-splice.js` | Create | Pure validators for splitting / merging / trimming a pipe |
| `src/beamline/BeamlineSystem.js` | Modify | `splitPipe`, `mergePipe`, `trimPipe`, `moveJunction` mutators |
| `src/ui/ApplyPreviewDialog.js` | Create | Modal summarizing a plan; Apply / Back to editing |
| `src/game/Game.js` | Modify | Snapshot/restore helpers for the apply transaction |
| `src/utility/UtilityLineSystem.js` | Modify | `reanchorLine` best-effort reroute on a moved placeable |
| `src/ui/probe-plots.js` | Modify | Optional `opts` arg: `yDomain`, `noClear`, `ghost` |
| `index.html` | Modify | Plot source toggle in the range bar; preview dialog root |
| `style.css` | Modify | Preview dialog + source toggle styling |
| `test/test-designer-plan.js` | Create | Unit coverage for the planner and blockers |
| `test/test-pipe-splice.js` | Create | Unit coverage for split/merge/trim validators |
| `test/browser/designer-editing.spec.mjs` | Create | Regression: every palette card lands in the draft; apply/cancel |

---

## Phase 1 — Draft becomes free editing

### Task 1.1: Remove the silent module rejection

**Files:** Modify `src/ui/BeamlineDesigner.js`

- [ ] Delete the `if (this.editSourceId && comp.placement !== 'attachment') return;` guard in `insertComponent` (~line 1018). Every palette click lands in `draftNodes` in every mode.
- [ ] Leave the existing attachment bookkeeping (`_pipeKind`, `_sourceRef`, `_targetPipeId`, `_targetPosition`, `_insertMode`) and `_reconcileToPipeGraph` intact. Attachments must not regress at any point in this phase.
- [ ] Track added modules so `confirm()` can see them: a draft node with `_pipeKind === 'module'` and no `_sourceRef.placeableId` is new; snapshot original module ids into `_originalModuleIds` in `openFromSource` alongside the existing `_originalPlacementIds`.
- [ ] **Interim guard (removed in Task 2.5):** `confirm()` counts draft module additions/deletions it cannot yet apply and refuses with an explicit `game.log(..., 'bad')` naming them, leaving the draft intact. It must never discard them silently — that would replace one silent failure with a worse one.

**Acceptance:** In edit mode, clicking Beam Pipe / a cavity / an endpoint adds it to the stack, updates the schematic, and updates the physics preview. Attachment add/remove/tune still applies on confirm exactly as before.

### Task 1.2: Type-filter the designer palette

**Files:** Modify `src/renderer/designer-renderer.js`

- [ ] In `_renderDesignerPalette`, skip components where `beamlineTypeHidesComponent(typeId, key, comp)` is true — the same filter `hud.js` already applies at line 1829. Import from `../ui/BeamlineTypePicker.js`.
- [ ] Resolve `typeId` from the beamline under edit when `editSourceId` is set (`game.getBeamlineTypeId` on the registry entry owning that source), else `game.getActiveBeamlineTypeId()`. Null means no filtering, as everywhere else.
- [ ] A subsection or category left with zero cards renders nothing rather than an empty labelled section.

**Acceptance:** A therapy line no longer shows components its type excludes. A line with no type still shows everything.

---

## Phase 2 — Plan / Apply / transaction / preview

### Task 2.1: Pipe splice validators

**Files:** Create `src/beamline/pipe-splice.js`, `test/test-pipe-splice.js`

Pure, no mutation, matching the `pipe-drawing.js` house pattern (`{ok:true, ...}` / `{ok:false, reason}` with terse codes).

- [ ] `validateSplitPipe(state, pipeId, atPosition, gapSubL)` — can the pipe be divided at this fraction leaving a `gapSubL` hole? Returns the two resulting paths and how the existing placements distribute between them. Reasons: `pipe_not_found`, `gap_too_large`, `placement_in_gap`, `stub_too_short`.
- [ ] `validateMergePipes(state, pipeIdA, pipeIdB)` — are these collinear, adjacent, and mergeable into one straight run? Returns the merged path and combined placements with positions remapped. Reasons: `not_collinear`, `not_adjacent`, `pipe_not_found`.
- [ ] `validateTrimPipe(state, pipeId, newSubL)` — shorten from the open end. Reasons: `no_open_end`, `placement_beyond_new_end`, `invalid_length`.
- [ ] Unit tests for every reason code plus the happy paths, including placement position remapping across a split and a merge.

### Task 2.2: BeamlineSystem mutators

**Files:** Modify `src/beamline/BeamlineSystem.js`

- [ ] `splitPipe(pipeId, atPosition, gapSubL)` → `{headPipeId, tailPipeId}` or null. Delegates to the validator; on success replaces the pipe in `state.beamPipes` with two, preserving placement ids, and calls `onPlacementRemoved` for anything the gap swallowed.
- [ ] `mergePipes(pipeIdA, pipeIdB)` → merged pipe id or null.
- [ ] `trimPipe(pipeId, newSubL)` → pipeId or null. Refunds the removed length at the same 50% `pipeRefund` rate the demolish tooltip promises.
- [ ] All three log via `reasonMessage` and emit `beamlineChanged`, matching the existing methods.

### Task 2.3: The planner

**Files:** Create `src/beamline/designer-plan.js`, `test/test-designer-plan.js`

- [ ] `planDesignerApply(state, {sourceId, draftNodes, originalNodes})` → `{ok, ops, summary, blockers}`. Pure: reads state, mutates nothing.
- [ ] Re-walk the map with `flattenPath(state, sourceId)` and align against `draftNodes` by `_sourceRef` identity (placeableId for modules, placementId for placements). Unmatched draft nodes are additions; unmatched map entries are deletions.
- [ ] Emit ops in execution order: removals first (freeing space and refunding), then geometry (split/merge/trim/draw/extend), then placements, then `tuneParams`. Op shape: `{kind, ...args, nodeIndex}` — `nodeIndex` lets the UI point at the offending element.
- [ ] Compute `summary`: `{adds:[{type,count,cost}], removes:[...], movedCount, movedDistanceM, danglingLineCount, totalCost}`.
- [ ] Blockers carry `{code, nodeIndex, message}`. Codes: `no_space`, `collision`, `not_straight`, `unaffordable`, `multi_branch_unsupported`, `source_immovable`.
- [ ] Phase 2 scope: append at an open end, append before a terminal endpoint by consuming drift, insert into a drift with room, deletion with pipe merge, param tuning. A change requiring downstream movement emits a `no_space` blocker until Task 4.2 replaces it with a `moveJunction` op.
- [ ] Unit tests per the spec's testing section, fixture-state in / ops out.

### Task 2.4: Transaction

**Files:** Modify `src/game/Game.js`

- [ ] `snapshotBeamlineState()` → an opaque restorable blob covering `placeables`, `beamPipes`, `utilityLines`, `resources`, and sub-grid occupancy. Reuse the existing save serializer rather than inventing a second serialization path.
- [ ] `restoreBeamlineState(snapshot)` — replaces those fields wholesale and emits `placeableChanged`, `beamlineChanged`, `utilityLinesChanged` so every renderer and the utility topology resolve.
- [ ] Test: mutate, restore, assert deep-equality with the pre-mutation state.

### Task 2.5: confirm() → plan / preview / apply

**Files:** Modify `src/ui/BeamlineDesigner.js`; create `src/ui/ApplyPreviewDialog.js`; modify `index.html`, `style.css`

- [ ] Replace `_reconcileToPipeGraph` with `_planAndApply()`: build the plan; if `!ok`, log blockers and highlight the offending nodes in the schematic, staying open.
- [ ] `ApplyPreviewDialog.open(summary)` → resolves `'apply' | 'back'`. Rows grouped by kind, not one per op; shows the moved-modules line and the utility-rewiring line; total cost with refunds netted. Follow the existing modal conventions (esc-stack via `pushEscHandler`, dialog styling from `SaveLoadDialog` / `HiringDialog`).
- [ ] On `'apply'`: snapshot → execute ops through `BeamlineSystem` / `UtilityLineSystem` → on any op returning null/false, restore and report which op failed. On success clear the draft, recompute the baseline envelope, `emit('beamlineChanged')`, close.
- [ ] Remove the Task 1.1 interim refusal.

**Acceptance:** Adding a beam pipe and a cavity to a real beamline, applying, and seeing both on the map with geometry intact. Cancel leaves the map untouched. A forced mid-plan failure leaves state byte-identical.

---

## Phase 3 — Proposed vs. current plots

### Task 3.1: `opts` in ProbePlots

**Files:** Modify `src/ui/probe-plots.js`

- [ ] Add a trailing optional `opts` argument to `draw(canvas, type, envelope, pins, activePin, xRange, yScale, opts)` carrying `{yDomain, noClear, ghost}`, defaulting to today's behavior when absent.
- [ ] Honor `yDomain` in the shared range helper so it overrides autoscaling for all eight plot types — this is the correctness requirement; two passes that autoscale independently render a misleading comparison.
- [ ] `noClear` skips the background fill so a second pass composites. `ghost` selects a dimmed, dashed stroke style.
- [ ] `phase-space` and `eic-triangle` are single operating points, not along-s curves: under `ghost` they draw a second dimmed marker/triangle, explicitly, not via the curve path.

### Task 3.2: Baseline envelope and source toggle

**Files:** Modify `src/ui/BeamlineDesigner.js`, `src/renderer/designer-renderer.js`, `index.html`, `style.css`

- [ ] Compute `this.baselineEnvelope` from `originalNodes` at the end of `openFromSource`, and recompute after a successful apply. Null in sandbox mode.
- [ ] Add `plotSource` state (`'proposed' | 'current' | 'both'`, default `'proposed'`) and a segmented toggle in the existing `.dsgn-plot-range-bar`. Hide the toggle when `baselineEnvelope` is null.
- [ ] In `_renderPlots`, compute the union y-domain across whichever envelopes are shown, then draw baseline first with `{ghost:true, yDomain}` and draft second with `{noClear:true, yDomain}`.

**Acceptance:** Toggling to Both shows the proposed curve solid over a dimmed current curve on the same axes; the y-axis does not jump between passes.

---

## Phase 4 — Downstream displacement + utility reroute

### Task 4.1: moveJunction and line reanchoring

**Files:** Modify `src/beamline/BeamlineSystem.js`, `src/utility/UtilityLineSystem.js`

- [ ] `moveJunction(id, {col, row, subCol, subRow})` → boolean. Frees the old sub-grid cells, claims the new ones, fails cleanly if occupied. Does not touch pipes — the planner emits the pipe ops.
- [ ] `UtilityLineSystem.reanchorLine(lineId, placeableId, newPortPos)` — translate the line's final leg to the port's new position and re-run `validateDrawLine`. On success keep the line intact; on failure null the endpoint and keep the path, exactly as `onPlaceableRemoved` does, and report it so the planner can count it.

### Task 4.2: Polyline displacement in the planner

**Files:** Modify `src/beamline/designer-plan.js`, `test/test-designer-plan.js`

- [ ] Build the run's polyline from the ordered pipe paths. The source is anchored and never moves.
- [ ] Where the draft's cumulative length diverges from the map's, emit `moveJunction` ops sliding each downstream junction along the polyline by the accumulated delta, with pipe ops redrawing the runs between them. When the polyline runs out, extend along the final segment's direction.
- [ ] Replace the Task 2.3 `no_space` blocker for the movable case; keep it for genuine collisions.
- [ ] Multi-branch runs (splitters/mergers) emit `multi_branch_unsupported` rather than guessing.
- [ ] Feed displaced junctions' utility lines through `reanchorLine` and surface the failure count in `summary.danglingLineCount`.
- [ ] Unit tests: displacement with a straight run, with a bend, with a collision, and with a branch.

---

## Task 5: Browser regression coverage

**Files:** Create `test/browser/designer-editing.spec.mjs`

- [ ] Open the designer from a placed beamline, walk every category, click every card, and assert each one lands in the draft. This is the exact check that would have caught the original defect — 18 of 27 cards silently doing nothing.
- [ ] Apply a draft containing a new module and assert the map matches (a new placeable exists, pipes reconnect, `flattenPath` returns the new stack).
- [ ] Cancel a draft and assert the map is unchanged.
- [ ] Toggle the plot source to Both and assert both passes rendered.

---

## Verification

- `npm test` (77 suites today) stays green throughout; new unit suites added by Tasks 2.1, 2.3, 2.4, 4.2.
- `npx playwright test` — existing specs plus the new `designer-editing.spec.mjs`.
- Do not commit; the user decides commit boundaries.
