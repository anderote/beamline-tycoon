# Followups Plan — remaining work after the overhaul

**Written to survive a context clear.** Everything needed to resume is in this file
or in the two documents it points at. Last updated 2026-08-10.

---

## 0. Where things stand right now

**Branch:** `master`. HEAD `71755c77`. All tests green (63 node suites + pytest), `npx vite build`
clean, `node scripts/balance-sim.mjs` clean.

**Uncommitted in the working tree** (deliberate — the user sets commit boundaries on their own
title-screen work):
- `src/ui/TitleScreen.js`, `src/ui/crtWarp.js`, `style.css` — the music toggle moved from a DOM
  button into the scene canvas so it bends with the CRT glass. Includes a new exported
  `destToSource()` in `crtWarp.js` that maps a click on the warped screen back to scene
  coordinates. Verified working by screenshot.

**Unpushed:** `71755c77` (deploy docs) is local-only. Everything before it is pushed.

**Deployed:** the post-overhaul build is live at
`https://www.deep-tech-week.com/beamline-tycoon-game/`, built from `c8fcc8bb`. The in-CRT speaker
icon is NOT deployed yet (it postdates that build).

**Worktrees:**
- `.claude/worktrees/followups` on branch `followups` (at `4ce31d08`) — set up, deps installed,
  intended home for the long-running phases below. **Currently 3 commits behind master; rebase or
  reset it onto master before starting.**
- `.claude/worktrees/overhaul` on branch `overhaul` — fully merged into master, safe to delete
  (`git worktree remove .claude/worktrees/overhaul && git branch -d overhaul`).

**Nothing is running in the background.** No workflows, no servers, no watchers.

### Read these two first when resuming
- `docs/superpowers/plans/overhaul-followups.md` — the 331-line evidence base. Every item below
  traces to a numbered section there, with real file:line references and repros. **Its line numbers
  have drifted; re-derive before moving code.**
- `docs/superpowers/plans/2026-08-07-overhaul-master-plan.md` — what the overhaul itself did
  (9 phases, 6 review rounds, 105 confirmed defect fixes).

---

## 1. Decisions already made — do not relitigate

| Decision | Choice | Consequence |
|---|---|---|
| Legacy MACHINES system | **Removed** | Done. `MACHINE_TIER`/`MACHINE_TYPES` kept for palette gating. |
| Wildlife / deer entities | **Deleted** | Done. ~1,400 lines gone. |
| On-pipe utility model | **Wire each placement individually** (not aggregated onto junctions) | Phase 11 must ship bulk-wiring tooling or the game becomes data entry. |
| Progression scope | **Full design pass** — pick a target playthrough length and derive costs/income from it | Phase 12 is design-led, not a tuning tweak. |
| deep-tech-week deploy | **Manual** | Auto-sync workflow deleted (its secret was never configured). `npm run build:web` prints the publish steps. |
| Save compatibility | **Ignore** — pre-release, single-user | Break saves freely; no migrators. |

---

## 2. Completed since the overhaul merged

- `3e81e9f8` — **all 25 placement-preview defects** (decoration rotation was dropped entirely;
  stackable ghosts snapped to an invisible hitbox; attachment ghost missed three fixes the unified
  path got; keyboard-armed tools painted no ghost; demolish/move didn't highlight decorations;
  validity coloring ignored cost). Also max zoom 8 → 14.
- `ee4fb660` — **registry-integrity test** (Phase 9b, done). Caught `machineShop.gatesCategory`
  pointing at a mode id instead of category ids, an unreachable `distribution:` config key, and a
  disposal path that threw on per-face material arrays. Also lands the reverse research check with
  9 known contradictions parked in a labelled allowlist for Phase 12 to empty.
- `4ce31d08` — **browser harness, WIP** (Phase 9a, unfinished — see below).
- `d8485506`, `71755c77` — repo hygiene and deploy docs.

---

## 3. Phase 9a — finish the browser harness (START HERE, ~1h)

Committed mid-development. `test/browser/README-coverage.md` has the full status. Summary:

- **The hard blocker is solved.** Chromium under SwiftShader/ANGLE renders WebGL, so specs drive
  the real app — vite, three.js, DOM HUD, real input. Flags that work:
  `--use-gl=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu-sandbox`.
- **Full pass/fail was never observed.** A complete run exceeds ~7 minutes; individual specs were
  progressing without failures, which is weak evidence, not a green suite.
- **The server leaks on interrupt.** Playwright's `webServer` teardown doesn't fire when a run is
  killed or times out, leaving vite on 8123 so the *next* run dies with "port is already used".
  Fix with a pretest `lsof -ti :8123 | xargs kill` or manage the server outside Playwright.
- **Not wired into `npm test`** — must survive three consecutive full runs first.

Remaining work: make a full run finish and be observed green; fix the teardown leak; then add
regression cases for the three preview bugs most likely to recur — decoration rotation, the
keyboard-arm ghost, and the invisible-hitbox ghost jump.

**Known environment fact:** the title screen only manages ~3 fps under SwiftShader (measured).
Anything timing-sensitive must not assume 60 fps headless.

---

## 4. Phase 10 — structural fixes for the two open bug classes (~1h)

Review found 105 bugs and fixed each where it sat; two *patterns* behind them are still open
(followups §10).

1. **Gesture ordering.** Nothing enforces "validate → charge → mutate → snapshot". That produced
   `_pushUndo()` before validation (a miss-click wiped the redo stack), `placeJunction` charging
   twice, and `_abortPointerGesture` destroying a carried payload. Build one helper on top of the
   existing `_withUndo` that owns the order, route every mutating tool path through it, delete the
   ad-hoc push sites.
2. **Aggregates with two definitions.** Drift entries counted as machines (income roughly doubled
   for a long time), `totalBeamOnTicks` divided by wall-clock ticks, `dataRate` billed raw while the
   tick derated it. Give each derived quantity exactly one accessor; assert single-source in tests.

---

## 5. Phase 11 — on-pipe utility gating, made ergonomic (2–4h) ★ gameplay

**The problem:** cavities, quads and BPMs *can* be wired but nothing checks that they are. An SRF
cavity with no power runs at perfect quality — and because a missing `nodeQualities` entry defaults
to fine, a **never-wired** component scores *better* than a badly-wired one. The whole
infrastructure layer is currently optional for the components that make up a beamline.

**11a — close the gate.**
- Feed the unconnected-sink pass `listUtilityEndpoints(state)` instead of
  `state.placeables.filter(category === 'beamline')` (`src/game/utility-gate.js`).
- **Fail closed:** a sink with no `nodeQualities` entry must resolve to 0.0, not 1.0 (`Game.js`,
  the `if (nq)` guard). This is the actual correctness fix.
- Update scenario generators + `scenario-wiring.js` so shipped content still comes up green;
  `test/test-scenarios.js` is the regression net.

**11b — make wiring dozens of components tractable.** Without this, 11a turns strategy into data
entry. In priority order:
- **Run-wiring gesture** — drag a utility line *along* a pipe to connect every compatible sink it
  passes; one gesture per utility per run.
- **Distribution bus** — a placeable serving every placement on its pipe segment, so the decision
  becomes "how many buses and where" rather than N identical stubs. This recovers the strategic
  content of the aggregate model while keeping per-component fidelity in the data.
- **Unwired-sink affordances** — a clear on-pipe visual, a blocker entry that frames-and-zooms to
  the offender, and a HUD count so the player is never hunting.
- Re-run `balance-sim` afterwards: more wiring means more infrastructure spend, and that should be
  a decision rather than a tax.

---

## 6. Phase 12 — progression design pass (2–4h) ★ gameplay

Research and economy were never designed against each other (followups §6, §7, §8). Evidence:

- $2.5M starting balance already pays for the first several research nodes → early research isn't a
  choice.
- Mid-game nets ~1,000/tick against $8M nodes → ~7,500 ticks per node. Reputation gates are worse:
  ~0.008 rep/tick against `reputation: 10` requirements.
- **9 components that research claims to unlock are buildable from tick 0** — five carry an explicit
  `unlocked: true` that directly contradicts the node granting them, including the SRF branch's
  headline $12M `cryomodule`. (`gyrotron` has the reverse problem: gated but never advertised.)
- `ECON.beamIncomePerNode` was moved 100 → 180 as a compensating constant after the drift
  double-count fix — so income now scales with hardware **density** rather than beamline **length**,
  and nobody chose that.

**Order matters.** Pick the target first, derive everything from it:
1. Choose total ticks to reach the top of the tree, and tier boundaries within it. Write the number
   down in this doc.
2. Extend `scripts/balance-sim.mjs` with a research-purchase policy so it simulates a *playthrough*,
   reporting the tick at which each tier unlocks.
3. Re-derive `beamIncomePerNode` from that target. Decide deliberately: density or length?
4. Lay research costs against the timeline; resolve the 9 gate-or-free contradictions against the
   opening-hour experience; empty the Phase-9b allowlist; add the reverse validator check.
5. Make milestone rewards the thing that unlocks the next tier, not a bonus on top.
6. Pin playthrough invariants (tier-unlock ticks in bounds, no dead stretches) as tests.

---

## 7. Phase 13 — code structure (2–4h, no player impact)

- **`InputHandler` is ~2,930 lines** (Phase 4 targeted <1,500). Five verified extraction clusters
  totalling ~1,600 lines: beamline/pipe geometry (~400), demolish lookup+hover (~450), wall/door/
  floor edge geometry (~250), tooltip/toast/preview DOM (~350), palette keyboard nav (~150).
  **Re-derive the line ranges — followups §2's are ~80 lines stale.** One cluster per step, each
  with its own test pass.
- **11 `_`-prefixed renderer internals** are reached into from `InputHandler`; put them behind an
  explicit surface (the `UIHost.PASS_THROUGH_PROPS` pattern).
- **Kill `UI_METHODS`** — a hand-maintained 44-name list in `ThreeRenderer` that must stay in sync
  with what `hud.js`/`overlays.js` attach. The existing drift check only catches listed-but-missing,
  never added-but-unlisted. Replace with registration (`registerUIMethods(obj)`).
- **Converge the three UI idioms** — fold the hand-rolled modals onto one dialog base with
  lifecycle + esc-stack + teardown built in. `ContextWindow` stays for world-anchored windows.

---

## 8. Phase 14 — performance and polish (1–2h)

- Terrain content-hash runs **3× per terrain refresh** (~3.7ms); compute once in
  `buildWorldSnapshot` as `snapshot.terrainKey` and have builders mix in the scalar.
- **Orphan grace window is broken across save/load**: `__orphanedAt` is stamped from
  `stats.solvePasses`, which resets per `SolveRunner` while the value is serialized — so the delta
  goes negative after a reload and abandoned network state never expires. Stamp `state.tick`.
- **Code splitting**: single 1.02 MB JS chunk (275 kB gz). Dynamic-import the 3D renderer + physics
  loader behind the title screen so first paint doesn't wait on three.js.
- Close the `_liveState()` boundary — 11 call sites and drifting the wrong way; terrain corner
  heights and cursor/hit-test paths need snapshot sections.
- Delete `UtilityLineSystem.js`'s `Math.random()` fallback id generator (unreachable in the real
  game, but a nondeterminism landmine for bare construction).
- Two live TODOs: `BeamlineDesigner.js` (~:515, restrict palette to attachment tools while editing)
  and `hud.js` (~:1439, tool-picker active-state highlight).
- Consider renaming one of the two `placement` axes (`placement: module|attachment` vs
  `role: junction|placement`) — one word meaning two things already broke the browser harnesses.

---

## 9. Phase 15 — review to convergence (unbounded — set a stopping rule)

Six adversarial rounds have run: 105 confirmed findings, and **round 6 was still producing them**.
Severity fell (structural breakage → "this feature silently never worked") but supply did not run
out. Do not represent this codebase as "reviewed clean".

**Set the stopping rule up front:** stop when a round's confirmed findings are all severity-low,
rather than waiting for a zero that may never arrive. Budget ~3h.

Lenses not yet used: save/load-cycle fuzzing, long-run simulation drift (10k+ ticks), and a pass
specifically over whatever Phases 11–13 touch.

---

## 10. How to actually run this

**Where:** `.claude/worktrees/followups` (rebase onto master first). Keeps long jobs from
hot-reloading under a running dev server. Working directly on `master` is fine for short phases.

**Shape that worked** (10 phases delivered this way): one background workflow per phase; agents
partitioned by **file ownership** so they never edit the same file concurrently; each phase ends in
a verify→fix loop capped at 4 iterations; the verifier is told to **independently audit, not trust
the implementers** (e.g. "confirm the test fails when you plant a bad id, then revert").

**Gates every phase must leave green:** `npm test` · `npx vite build` · `node scripts/balance-sim.mjs`.

**Rules for agents:** never kill a server they didn't start (the user's dev server runs on 5173);
use port 8123+ for their own; no scratch files in the repo root (use the scratchpad); no commits,
no pushes, no branch switching.

**Cost, measured from this session:** small focused phases 8–35 min; mid-size 35–50 min; large
refactors and review loops 2.5–4.5h each. Phases 10–14 ≈ **8–15h wall-clock**, plus Phase 15.
Roughly 18M subagent tokens were spent getting this far; expect a similar order again.

**Suggested order:** 9a → 10 → **11 → 12** → play it → decide whether 13/14/15 are worth it.
Phases 11 and 12 are the only ones a player will feel. 13 is craft no player sees, and 15 has
sharply diminishing returns after six rounds.

---

## 11. Deploying (manual, by design)

```
npm run build:web        # prints the remaining steps when it finishes
```
Then rsync `dist/` into `deep-tech-week/apps/web/static/beamline-tycoon-game/`, commit, and push
`main` — the push is what goes live via Vercel.

**Boot `dist/` from a plain static server before pushing.** Vite's dev server hides base-path and
missing-asset mistakes that only appear in the built bundle; a headless boot check catches them in
seconds. Verify afterwards by comparing the live hashed bundle filename to the local one, and
spot-checking runtime-fetched files (`beam_physics/*.py`, `music/tracks.json`) for 200s.
