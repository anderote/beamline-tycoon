# Followups Plan — 2026-08-09

Closes out `docs/superpowers/plans/overhaul-followups.md` (§1–§10 + smaller things), plus two items
raised directly by the user (placement previews, zoom range). Executed **directly on `master`** —
the overhaul is merged, so there is nothing to isolate from. Phase-by-phase by subagent workflows
with a verify-fix loop per phase, one commit per phase. Consequence of not using a worktree: edits
hot-reload into a running dev server, so avoid long-running builds while the user is mid-session.

**User decisions locked in:**
- On-pipe utility model: **wire each placement individually** (max fidelity). This makes bulk-wiring
  ergonomics a first-class requirement, not a nice-to-have — see Phase 11.
- Progression: **full design pass** — target playthrough length, tech-tree tiers laid against it,
  beam income re-derived rather than patched with a compensating constant.

**Invariants for every phase:** `npm test` green, `npx vite build` green, `node scripts/balance-sim.mjs`
green, no behavior regressions beyond those explicitly planned. Work never touches the user's
checkout.

---

## Phase 9 — Verification foundation (do first; de-risks everything after)

Two gaps make every later phase riskier than it needs to be: nothing executes the app, and nothing
checks that hand-written id strings still resolve.

**9a. Browser smoke, restored (§5).** Playwright with a software GL backend
(`--use-gl=swiftshader --use-angle=swiftshader`) so `ThreeRenderer` actually comes up headless.
Rewrite the two stale Puppeteer harnesses against the current `role` taxonomy (they still assume
every `placement: 'module'` is free-grid placeable — 9 components are `module`+`role:'placement'`
and correctly rejected, so they'd report ~9 spurious failures even with GL). Target scenario:
boot → title → continue → place floor/wall/decoration → place a junction → draw a pipe → place an
on-pipe component → wire a utility line → toggle beam → save → reload → undo/redo → Esc from each
UI layer, asserting zero uncaught console errors throughout. Add `npm run test:browser`; fold into
`npm test` only if it proves stable. **Acceptance: the app is proven to boot and render.**

**9b. Registry-integrity test (§10, first bullet).** One test that walks *every* hand-written id list
in `src/` against the real registries — `economy.js` (`PUMP_TYPES`, RF/cryo stat lists),
`research.js`, `Game.js`, `modes.js` categories, `MACHINE_TIER`. `validateResearch` already does
exactly this for one table and found 27 dead nodes; generalize it. This is the cheapest possible
insurance against the single largest bug class of rounds 4–6 (strings that used to be right).

**9c. Placement previews (user-reported).** Investigation complete — 25 defects, nearly all
**pre-existing**, not overhaul regressions. The overhaul's own surface came out clean: `onEnter`/
`onExit` ordering is correct, there are zero snapshot-boundary violations in preview code, and
`previewGroup` routing is right. Fix order:

*Tier 1 — the ghost lies about what you'll get:*
- **A1/A2 Decorations ignore rotation entirely.** `buildDecorations` (`world-snapshot.js:306`) never
  emits `dir`, so `DecorationBuilder` can't rotate — press R, the ghost turns, the placed bench
  doesn't. Same root cause omits the dir 1/3 footprint swap that `Placeable.footprintCells` and the
  ghost both apply, so a rotated bench renders offset from the cells it actually reserves.
  `EquipmentBuilder` gets this right; decorations are the only family broken.
- **G Stackable ghosts snap to an invisible hitbox.** `screenToPlacementWorld` raycasts
  `componentGroup` recursively and hits the invisible collision box `_createObject` adds at beam
  height (three.js tests `object.visible`, not `material.visible`). Hovering any of the 14 stackable
  items near a beamline makes the ghost jump a metre into the air. `_outlineObject` already guards
  this exact hazard — port the guard.
- **A4/A5/E4 `renderAttachmentGhost` missed three fixes the unified path got:** it uses the
  `obj.children.length` detail check that the unified path explicitly documents as always-true (so
  the cryomodule ghost sits 1 m below where it lands), it will throw on array materials on every
  mousemove for any future gauge without a role builder, and it sets `depthWrite` but not
  `depthTest`/per-child `renderOrder`, so on-pipe ghosts z-fight with their own pipe.

*Tier 2 — missing or stale previews:*
- **B4 Keyboard-armed tools show no ghost until you jiggle the mouse** (the one overhaul-introduced
  defect: `setTool` clears the preview and nothing repaints it after `onEnter`, though the last
  mouse position is known). One-line fix, kills a whole class of "the preview vanished".
- **B1/B2 Demolish and Move show no highlight on decorations** — `raycastScreen` omits
  `decorationGroup`, so the outline path is unreachable; Move additionally keys off tile-granular
  legacy mirrors so sub-tile furnishings don't resolve.
- **C1 Ghost stays green over the tile you just filled** — `_commitHoverPlaceable` doesn't
  re-preview, so a second click reports "Space occupied!" under a green ghost.

*Tier 3 — cosmetic and hygiene:* A3 (ghost tree is a different tree than you place — seed 0 vs
position hash), A6 (validity coloring ignores affordability: green ghost, "Can't afford"), A7 +
C4 (variant leaks/resets across tools), E1 (drag-rect preview is flat on slopes), E3 (ghost drapes
the slope, click flattens it — needs a call: preview at post-flatten height?), D1/D2/D3 (per-frame
grid + pipe-marker rebuilds at 60 Hz; stale tracking arrays double-dispose), D4/C5 (7 dead preview
methods each carrying a copy of the flat-Y bug, plus a stale `renderEquipmentGhost` caller on F).

Browser smoke (9a) grows preview cases for A1, B4 and G once they're fixed.

**9d. Zoom range — done.** Max zoom raised 8 → 14 (`ZOOM_MAX` in `ThreeRenderer.js`); the detail-LOD
threshold at 2.0 is far below it, so the whole new range is inside the high-detail band. Zoom-out
floor left at 0.2 — extend if the user meant "see more of the facility" rather than "get closer".

## Phase 10 — Structural fixes for the other two bug classes (§10)

Rounds 4–6 fixed 60 bugs at their sites and pinned regressions; the *classes* stayed open.

- **Gesture ordering.** No shared helper enforces "validate → charge → mutate → snapshot", which
  produced `_pushUndo()` before validation, `placeJunction` charging twice, and
  `_abortPointerGesture` destroying a carried payload. Introduce one gesture helper (building on the
  existing `_withUndo`) that owns the ordering, and route every mutating tool path through it.
  Delete the ad-hoc push sites.
- **Aggregates with two definitions.** Drift entries counted as machines, `totalBeamOnTicks` divided
  by wall-clock ticks, `dataRate` billed raw while the tick derated it — each is "two call sites
  compute the same quantity differently". Give each derived quantity exactly one accessor and make
  the other call sites use it; assert single-source in tests.

## Phase 11 — Individual on-pipe utility wiring, made ergonomic (§1)

The gating half of the on-pipe work, per the chosen model. Two halves, and the second is what makes
the first playable rather than tedious.

**11a. Close the gate.**
- Feed the unconnected-sink pass `listUtilityEndpoints(state)` instead of
  `state.placeables.filter(category === 'beamline')` (`utility-gate.js:64`), so on-pipe placements
  produce real hard blockers.
- **Fail closed:** a sink with no `nodeQualities` entry must resolve to 0.0, not 1.0
  (`Game.js:2515` currently `if (nq)` — a never-wired cavity outscores a half-wired one). This is
  the actual correctness fix.
- Scenario/demo generators and `scenario-wiring.js` updated so shipped content still comes up green
  under the stricter gate; `test-scenarios.js` is the regression net.

**11b. Make wiring dozens of components tractable.** Without this, 11a turns a strategy game into
data entry. In rough priority:
- **Run-wiring gesture:** drag a utility line *along* a pipe to connect every compatible sink it
  passes, one gesture per utility per run (the analogue of the existing drag-rect placement).
- **Distribution bus:** a placeable that serves every placement on the pipe segment it's attached
  to, so the player's decision becomes "how many buses and where" rather than N identical stubs.
  (This recovers the strategic content of the aggregate model while keeping per-component fidelity
  in the data.)
- **Unwired-sink affordances:** a clear visual for "this sink has no line" on the pipe itself, a
  blocker list entry that frames-and-zooms to the offender, and a palette/HUD count of unwired
  sinks so the player is never hunting.
- Cost/balance follow-through: more wiring means more infrastructure spend — re-run `balance-sim`
  and adjust so the new burden is a decision, not a tax.

## Phase 12 — Progression design pass (§6, §7, §8)

The one genuinely *design* phase. Order matters: pick the target, then derive everything from it.

1. **Pick a target playthrough** — total ticks to reach the top of the tech tree, and tier
   boundaries within it (early / mid / late / prestige). Everything below is derived from this
   number, so it gets written down explicitly in the plan doc.
2. **Extend `balance-sim.mjs` with a research-purchase policy** so it simulates a *playthrough*, not
   a steady state: buy the cheapest affordable node, expand when affordable, report tick-at-which
   each tier unlocks.
3. **Re-derive `beamIncomePerNode`** from the target rather than the compensating 100→180 that was
   fitted to double-counted numbers (§8). Decide deliberately whether income should scale with
   hardware *density* or beamline *length* — currently density, by accident.
4. **Lay the tech tree against the timeline:** research costs, and the 9 unlock contradictions
   (§7) resolved coherently — for each of `cryomodule`, `rfq`, `target`, `sextupole`, `wireScanner`,
   `ecrIonSource`, `ln2Precooler`, `cryocooler`, `ionSource`, decide *gate or free* against the
   opening-hour experience, then make `unlocked`/`requires`/`unlocks` agree. Add the reverse
   validator check (a node's `unlocks` id must actually be gated by that node) so this can't rot.
   Fix the `gyrotron`/`advancedRf` asymmetry.
5. **Milestone rewards as tier keys** rather than a bonus on top of passive accumulation.
6. **Pin playthrough invariants** (tier-unlock ticks within bounds, no dead stretches) as tests, so
   future balance edits get flagged.

## Phase 13 — Code structure (§2, §3)

Mechanical, low-behavioral-risk, and much safer once Phase 9 exists.

- **InputHandler 2,932 → under 1,500:** extract the five verified clusters (beamline/pipe geometry
  ~400, demolish lookup+hover ~450, wall/door/floor edge geometry ~250, tooltip/toast/preview DOM
  ~350, palette keyboard nav ~150). Re-derive line ranges first — the doc's are ~80 lines stale.
  One cluster per commit-sized step, each with its own test pass.
- **Renderer internals behind a contract:** the 11 `_`-prefixed renderer members InputHandler
  reaches into get an explicit surface (the `UIHost.PASS_THROUGH_PROPS` pattern).
- **Kill `UI_METHODS` (§3):** replace the hand-maintained 44-name list with registration
  (`registerUIMethods(obj)` at the bottom of each UI module). The existing drift check only catches
  listed-but-missing, never added-but-unlisted.
- **UI idiom convergence:** fold the hand-rolled modals (`HiringDialog`, `StaffInspector`,
  `SaveLoadDialog`, `OptionsDialog`, `WelcomeDialog`, `UtilityStatsPanel`) onto one dialog base with
  lifecycle + esc-stack + teardown built in. `ContextWindow` stays as-is for world-anchored windows.

## Phase 14 — Performance and polish (§4, §9, smaller things)

- Terrain content-hash computed **once** in `buildWorldSnapshot` (`snapshot.terrainKey`) and mixed
  into each builder's key instead of three independent 5,041-tile walks (~3.7 ms → ~1.2 ms per
  terrain event).
- Orphan grace window stamps `state.tick`, not `stats.solvePasses` — currently the clock is negative
  after a reload, so orphaned network state never expires.
- **Code splitting:** dynamic-import the 3D renderer + physics loader behind the title screen. The
  single 1.02 MB chunk (275 kB gz) warns on every build and delays first paint.
- Close the `_liveState()` boundary: 11 call sites (drifting the wrong way) get proper snapshot
  sections — terrain corner heights and cursor/hit-test paths.
- Delete `UtilityLineSystem.js:40`'s `Math.random()` fallback id generator so a bare construction
  can't silently reintroduce nondeterminism.
- The two live TODOs: `BeamlineDesigner.js:515` (palette restricted to attachment tools while
  editing) and `hud.js:1439` (tool-picker active-state highlight).
- Consider renaming one of the two `placement` axes (`placement: module|attachment` vs
  `role: junction|placement`) — the word meaning two things is a standing trap that already broke
  the browser harnesses.

## Phase 15 — Review to convergence

Rounds 7+ on the same harness (multi-lens review → adversarial verify → fix), but now with Phase 9's
registry test and Phase 10's structural fixes closing the three known bug classes. **Run until a
round confirms zero findings** — no cap this time; if it hasn't converged after several rounds,
that is itself the finding, and the honest conclusion goes in the doc rather than being papered over.
New lenses to add: save/load-cycle fuzzing, long-run simulation drift (10k+ ticks), and a pass
specifically over everything Phases 11–13 touched.

---

**Execution:** fresh worktree off `master`, one background workflow per phase, verify-fix loop
capped at 4 iterations per phase, commit per phase. Phases 9 and 10 can overlap (disjoint files);
11 and 12 are sequential (12's balance depends on 11's costs); 13 and 14 can run parallel to each
other; 15 is last.
