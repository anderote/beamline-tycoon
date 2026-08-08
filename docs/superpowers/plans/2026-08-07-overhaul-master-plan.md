# Overhaul Master Plan — 2026-08-07

Full-codebase quality overhaul executed on the `overhaul` branch in `.claude/worktrees/overhaul`,
driven by the four-subsystem architecture review (core sim, rendering, input/UI, data/domain).
Executed phase-by-phase by subagent workflows with a verify-fix loop ("ralph loop") at the end of
each phase. One commit per phase. Merged back to `master` when the user says so.

**User decisions locked in:**
- Legacy MACHINES system (stall machines, MachineWindow, upgrade ladders): **remove**. Keep
  `MACHINE_TIER` / `MACHINE_TYPES` (they gate component visibility in the current design).
- Wildlife/deer system (src/game/entities/, herd/spawner/steering + tests): **delete**.
- Old saves may break freely (per CLAUDE.md), but the game must always boot to a working state.

**Invariants for every phase:**
- `npm test` (created in Phase 0) green before commit.
- `npx vite build` succeeds (catches import/syntax errors across the whole graph).
- No behavior regressions beyond those explicitly planned (machines/wildlife removal).
- Never touch the main checkout; all work in the worktree.

---

## Phase 0+1 — Foundation + Deletion Sweep (one workflow, one commit)

**Test wiring (Phase 0):**
- `scripts/run-tests.mjs`: discovers and runs every `test/*.js` + `test/*.test.js` +
  `test/uv-utils.test.js` under node, aggregates exit codes, then runs `python3 -m pytest test/ -q`.
  Add `"test": "node scripts/run-tests.mjs"` to package.json.
- Fix stale red tests: `test-component-physics.js` (assert constant-power gun model:
  higher extractionVoltage → *lower* beamCurrent), `test-place-all-components.js` (components with
  `role:'placement'` must *reject* open-ground placement — assert the rejection).
  `test-entities-herd.js` is deleted with wildlife.

**Deletion sweep (Phase 1):** file-disjoint parallel tracks, then a sequential Game.js pass.
- Dead code: `src/store.js`, `src/renderer3d/camera-sync.js`, `src/renderer/utility-line-overlay.js`,
  `ThreeRenderer._syncThreeCameraFromOverlay`, `Renderer.js` class body (keep `isFacilityCategory`,
  `_pxText`, `_darkenPort` in a new `src/renderer/render-utils.js`), empty `Placeable` subclasses
  (registry maps every kind to base `Placeable`), unused Overlay layers/drawGrid.
- Dead Python: remove the ~8 unimported modules (elements, radiation, wear, diagnostics,
  vacuum_system, rf_system, cryo_system, cooling_system) from `beam_physics/` and the
  `physics.js` loader list.
- Save migrations: delete the migration tail in `Game.load()` (~150 lines), bump save version,
  reject older versions cleanly (fresh start).
- MACHINES removal: `Game.js` machine methods/tick/serialize fields, `MachineWindow.js`,
  machine palette/tabs/refs in hud/overlays/InputHandler/main, prune `data/machines.js` to
  `MACHINE_TIER`/`MACHINE_TYPES`. Economy compensation: small bump to base passive income so the
  early game stays viable (tune in Phase 7).
- Wildlife removal: `src/game/entities/`, `entity-renderer.js` refs, `entities.raw.js` deer entry,
  spawner/steering/herd tests, `entitiesTick` call site.
- Diag logging: remove the 11 `console.warn`s in InputHandler mousemove, ~24 in
  BeamlineInputController, per-rebuild `console.log` in component-builder, `_lastMoveBranch`.
- Event bus: `Game.on()` returns an unsubscribe fn; add `Game.off(fn)`. Fix listener leaks in
  HiringDialog, StaffInspector, UtilityStatsPanel, UtilityInspector (remove the two
  `game.listeners.splice` workarounds).
- `src/ui/draggable.js`: single `makeDraggable(el, handle, opts)` with proper listener teardown;
  replace all 8 copies.
- `src/ui/format.js`: shared money/number formatters, `escapeHtml`, staff initials/role-color/mood
  helpers; replace the duplicated copies.
- Renderer leaks: `_clearBeamPipePreview` disposes materials; preview meshes go through
  `previewGroup`, not `scene.add`.

**Acceptance:** npm test green, vite build green, game boots to title screen and into a scenario.

## Phase 2 — Deterministic Sim Core

- `Game` gets `this.rng` (small seeded LCG/mulberry32, `seed` in constructor options, persisted in
  state). Replace all `Math.random()` in sim code (staff gen, wear, outage rolls) and `Date.now()`
  id generation (monotonic counter in state). Fix `agent/env.js` `reset(seed)` so the seed actually
  drives terrain/map generation. Fix research.js module-level cache (per-instance or keyed reset).
- Tick loop: `start/pause/resume/setSpeed(0|1|2|4)`, `clearInterval` on stop, sim-time accumulator
  so background-tab throttling doesn't warp the sim. Keyboard: Space pause, 1/2/3 speeds; small HUD
  speed control.
- Extract the ~140-line utility-solve/gating block from `tick()` into `src/game/utility-gate.js`;
  move the O(placeables×ports×lines) unconnected-sink check into network discovery. The
  `Math.random() < 0.3` staffing roll becomes an rng-driven, testable rule.
- Serialize: explicit field whitelist instead of spread-with-blacklist; stop persisting derived data
  (systemStats, nodeQualities, infraBlockers, etc.). Replace the `main.js` save monkey-patch with
  `game.registerSerializer(key, save, load)` used by probe/camera/designer.
- New tests: headless Game construction, 100-tick determinism (same seed → same serialize),
  serialize/load roundtrip, pause/speed.

**Acceptance:** two Games with the same seed produce identical serialized state after 100 ticks.

## Phase 3 — Undo That Works

- Replace the partial-snapshot undo with full-state snapshots: undo stack holds `serialize()`
  outputs (cap ~20), restore goes through the load path minus page concerns. Redo optional.
- Tests: place pipe → undo → serialized state equals pre-action; same for walls, placeables,
  utility lines, demolish.

## Phase 4 — Input System Refactor

- `Tool` interface: `{id, onEnter, onExit, onMouseDown, onMouseMove, onMouseUp, onKey, cursor}` —
  the shape BeamlineInputController/UtilityLineInputController already converged on.
- `InputHandler.activeTool` (single field) + `setTool(tool)` handling exit/enter. Kill the 14
  selected* fields and all ~107 manual deselect calls; the utility-line exclusivity bug dies here.
- Tool families defined as data where possible (demolishScopes.js is the model). Palette items carry
  `{kind, key}` so `_showPreviewForIndex`'s 140-line category-guessing chain and
  `_getPaletteCompKeys`'s DOM round-trip are deleted.
- Single Esc owner: a UI stack (modal/window/tool) that keydown consults top-down; remove the 6
  competing Esc handlers and capture-phase workaround.
- InputHandler target: < 1,500 lines, dispatch via activeTool, no `_`-prefixed renderer internals
  (extend UIHost PASS_THROUGH_PROPS contract where needed).

**Acceptance:** all tools reachable and mutually exclusive; vite build + manual smoke via
Puppeteer placement test; no regression in placement flows covered by existing tests.

## Phase 5 — Renderer Boundary + Performance

- ThreeRenderer adopts its own snapshot boundary: zones/walls/utility-lines/pipes/cursor reads go
  through `buildWorldSnapshot` sections; add scoped builds (`buildWorldSnapshot(game, {only})`) so
  `_refreshInfra` doesn't walk 5,041 terrain tiles to read floors.
- Fix Terrain/Cliff cache keys (content hash covering brightness + topology, not len+revision).
- Wildflower/grass rebuild only on terrain-affecting events, with a cache key.
- Port markers: rebuild on change (hash), not per-rAF; `_buildErrorMap`'s per-tick
  `discoverNetworks` reuses the solve pass's discovery output instead of re-running.
- Per-frame allocs: module-scope scratch Raycaster/Vector2/Plane; `identifyHit` reverse index via
  `userData.nodeId`; label sprite cached while drawing.
- Move `hud.js`/`overlays.js` from `src/renderer/` to `src/ui/` (mechanical, imports updated).
- Stretch: drop the PixiJS CDN dependency (replace overlay app with a plain capture canvas +
  viewport oracle object).

## Phase 6 — Content Pipeline Hardening

- `src/data/validate.js`: throwing validator run at startup in dev + in tests — required fields per
  kind, ports table coverage for sink/source components, known `physicsType`, ROLE_BUILDERS
  coverage report. Replace the two `console.warn`s in components.js.
- Unify the 5 copy-pasted `toDims()` into one shared normalizer; single source of truth for utility
  colors (registry only).
- JS↔Python seam: pass payloads via `pyodide.globals.set` (no string-interpolated JSON); replace
  gameplay.py's if/elif type map with an explicit `physicsType` field authored in
  beamline-components.raw.js and validated on both sides.

## Phase 7 — Game Design & Balance

- Differentiated utility demands: per-component power/cooling/cryo/vacuum/RF values in the
  component defs (replacing flat 50 kW / 200 kW defaults), scaled by component class and tier so
  capacity planning is a real decision. Wiki pages updated to match.
- Solver perf: topology-dirty caching in solve-runner (re-discover only when lines/ports change).
- Economy pass post-machines-removal: passive income, reputation curve, refill costs sanity check
  via a 500-tick headless simulation script asserting the early game is survivable and the
  late game isn't free.
- Autosave: keep, but off the hot path (every 30 ticks, and skip while paused).

## Phase 8 — Final Ralph Loop

- Repeated adversarial review cycles: multi-agent code review of the full overhaul diff → verify
  findings → fix → re-review, until a review round produces zero confirmed findings (cap 4 rounds).
- Full test suite + vite build + Puppeteer smoke (boot, place component, draw pipe, save/load).
- Final architecture re-audit against the original review checklist; anything still open gets
  documented in `docs/superpowers/plans/overhaul-followups.md`.

---

**Execution notes:** each phase = one background Workflow in the worktree; verify-fix loop capped
at 4 iterations per phase; commit at phase end with a summary message. The user's main checkout and
running dev server are never touched.
