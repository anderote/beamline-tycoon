# Overhaul Followups — what the overhaul deliberately did NOT do

## Convergence status — read this first

**The review loop did not converge. It was stopped at a round cap, twice.**

- 8 phase commits are on `overhaul` (`ab48df75` … `715ab058`).
- Review rounds 1–3 ran against the phase-8 commit: **45 confirmed findings**, all fixed, committed
  as `715ab058`.
- Review rounds 4–6 ran after that: **60 confirmed findings**, all fixed. **These fixes are
  uncommitted** — one 40-file working-tree diff (+1,480 / −500) plus 4 untracked suites
  (`test-review-regressions.js`, `test-convergence-regressions.js`,
  `test-convergence-regressions-2.js`, `test-research-integrity.js`, 1,400 lines, 31 pinned
  regression blocks). The orchestrator owns the commit split.
- **105 confirmed findings across 6 rounds. Round 6 still produced confirmed findings.** The rate
  fell but never reached zero. The honest reading is that the *severity* dropped (rounds 1–3 found
  structural breakage; rounds 4–6 found economy/data/gating bugs of the "this feature silently never
  worked" kind) while the *supply* did not run out. Anyone assuming "reviewed six times" means
  "clean" is assuming something this branch has not demonstrated.

Gate status at close, run against the working tree:

| Gate | Result |
|---|---|
| `npm test` | **60/60 suites green** (59 node suites + pytest) |
| `python3 -m pytest test/ -q` | **123 passed** in 0.29 s |
| `npx vite build` | green in 1.77 s — 1,022 kB JS / 275 kB gzip, chunk-size warning (see below) |
| `node scripts/balance-sim.mjs` | exit 0, all three scenarios `blockers=none` |

Suite count 38 → 60 across the whole overhaul; +4 during rounds 4–6.

Everything below was verified against the working tree at the time of writing — line numbers and
counts are real, not remembered. Items 1–6 and the first "smaller things" block predate rounds 4–6
and were re-checked; items 7–10 are new, discovered in rounds 4–6 and deliberately deferred there.

Ordered roughly by "how much future pain this causes".

---

## 1. On-pipe placements: wireable, but not *gated* — the biggest open gameplay item

**What the overhaul fixed.** At the start of the branch, components with `role: 'placement'`
(cavities, quadrupoles, BPMs, cryomodules — they live in `pipe.placements`, not `state.placeables`)
declared utility-port tables in `utility-ports-v2.js` that nothing could reach. Phase-6/review work
added `src/utility/utility-endpoints.js`, which flattens placements into placeable-like records, and
routed discovery (`network-discovery.js:66`), line validation (`line-drawing.js:113`), the port
hit-test / hover (`UtilityLineInputController.js:203`), the renderer's port markers
(`ThreeRenderer.js:2725,3230`) and the inspector through it. So **placements can now be wired, and
a wired placement does land in `state.nodeQualities`** (regression-covered by
`test/test-utility-placement-endpoints.js`).

**What is still open.** The *gating* half was not extended. `UtilityGate.run()`
(`src/game/utility-gate.js:64`) builds its unconnected-sink input as:

```js
const beamlinePlaceables = (state.placeables || []).filter(p => p.category === 'beamline');
```

— `state.placeables` only. So `findUnconnectedSinks` never sees an on-pipe placement, and an SRF
cavity with an entirely unwired `pwr_in` / `vac_in` produces **no hard blocker**. Worse, the
consumer side fails open: `Game.js:2515` does `if (nq) physEl.infraQuality = nq;`, and
`_aggregateNodeQualities` only creates entries for sinks that appear in a solved network. A
never-wired placement therefore has no `nodeQualities` entry at all and silently runs at quality
1.0 — better than a half-wired one.

**The design question this defers.** Should each on-pipe placement be individually wired (visually
noisy — a FODO cell is a dozen quads), or should a placement's declared demand aggregate onto its
host pipe / nearest junction, so the player wires *junctions* and the pipe distributes? The current
data model supports the first; the second is probably the better game. Whichever is chosen, the
unconnected-sink pass must be fed `listUtilityEndpoints(state)` (or the aggregate) instead of
`state.placeables`, and the fail-open default in `Game.js:2515` needs a decision: missing
`nodeQualities` entry should probably mean 0.0, not 1.0.

## 2. InputHandler is still 2,932 lines and growing (Phase 4 target was < 1,500)

Phase 4 delivered the important part — one `Tool` interface, one `activeTool` field, the 14
mutually-exclusive-by-convention fields and ~107 manual deselect calls are gone (2 `deselect`
references remain), tool families live in `placement-tools` / `structure-tools` / `demolish-tool` /
`mode-tools` / `beamline-tool` / `utility-line-tool`. What it did not do is finish the extraction:
the file went 4,002 → 2,859, not → 1,500, and rounds 4–6 pushed it back up to **2,932** (gesture-abort
and button-guard fixes). The residue is cohesive helper clusters that never found a home. Verified
extraction candidates below — **the line ranges are as of the phase-8 commit and have since drifted
by roughly +80; re-derive before moving anything**: 

| Candidate | Methods | ~Lines |
|---|---|---|
| Beamline / pipe geometry lookups | `_getNodeAtGrid`–`_getActiveBeamlineNodes` (416–482), `_findBeamlineComponentAt`–`_updateAttachmentPreview` (658–940), `_beamPipeNearWorldPos` (1860–1908) | ~400 |
| Demolish lookup + hover | `_updateDemolishHover` (240–353), demolish tooltips (353–416), `_findDeletablePlaceable` (1710–1860), `_demolishEverythingAt` (2199–2243), mode swap trio (2470–2551) | ~450 |
| Wall / door / floor edge geometry | `_getNearestEdge`–`_buildDoorSegmentPath` (482–658), `_getNearestFloorEdge` / `_getNearestWallEdge` (940–1014) | ~250 |
| Tooltip / toast / preview DOM | `_showTooltip`–`_hideDragCostTooltip` (142–240, 353–416), `_updateShiftHint` (2412–2457), `_showToast` (2457–2470), `_showPreviewForFocusedItem`–`_hidePreview` (2707–2859) | ~350 |
| Palette keyboard navigation | `_handlePlacementModeKey` (1924–1939), `_syncPaletteClick`–`_applyPaletteFocus` (2597–2707) | ~150 |

That is ~1,600 lines of mechanically-extractable code; taking all five gets the file under the
original target. None of it is behaviourally risky — these are pure-ish lookups and DOM helpers —
but each move needs its own test pass, which is why it was not attempted inside a phase that was
already rewriting dispatch.

Related, smaller: InputHandler still reaches into 11 distinct `_`-prefixed renderer internals
(`_clearPreview` ×9, `_outlineObject` ×4, `_renderCursors` ×3, `_openBeamlineWindow` ×3,
`_generateCategoryTabs` ×3, `_snapping`, `_selectedParamOverrides`, `_schematicDrawers`,
`_panX`/`_panY`, `_openEquipmentWindow`). Phase 4 wanted these behind an explicit contract like
`UIHost`'s `PASS_THROUGH_PROPS`.

## 3. Three coexisting UI idioms, and a hand-maintained method list

The UI layer never got a unifying pass, so `src/ui/` currently runs three different construction
idioms side by side:

- **`ContextWindow` subclasses** — `BeamlineWindow`, `EquipmentWindow`, `UtilityInspector`: proper
  classes with world-anchoring, lifecycle, and `_refreshContextWindows` driving them.
- **Hand-rolled modals** — `HiringDialog`, `StaffInspector`, `SaveLoadDialog`, `OptionsDialog`,
  `WelcomeDialog`, `TitleScreen`, `UtilityStatsPanel`: each builds its own DOM, its own close
  button, its own `esc-stack` registration, its own teardown.
- **`UIHost` prototype-patching** — `hud.js` and `overlays.js` (~6,000 lines of DOM UI) attach
  their methods onto `UIHost.prototype` by side-effect import, and `ThreeRenderer` installs
  per-instance forwards for them.

The third idiom carries an explicit hazard: `UI_METHODS` in `ThreeRenderer.js:3756` is a
**hand-maintained list of 44 method names** that must stay in sync with what `hud.js`/`overlays.js`
actually attach. There is a startup drift check (`ThreeRenderer.js:3782`) that `console.warn`s on a
listed-but-missing method, but nothing catches the reverse — a method added to `hud.js` and *not*
listed simply never gets forwarded, and fails at some distant call site. A registration-based
approach (`registerUIMethods(obj)` at the bottom of each UI module) would delete the list entirely.
`UIHost.PASS_THROUGH_PROPS` (14 entries) is the same pattern but is at least documented as a
deliberate contract.

## 4. Terrain content-hash is computed up to 3× per terrain refresh (~4 ms)

`ThreeRenderer._refreshTerrain()` (line 2894) fans a single snapshot out to four builders, three of
which independently `contentKey()`-walk the same ~5,041-tile terrain array:

- `terrainBuilder.build(snap.terrain)` → `contentKey(terrainData)` (`terrain-builder.js:39`)
- `wildflowerBuilder.rebuild(snap)` → `contentKey(snapshot.terrain)` (`wildflower-builder.js:126`)
- `grassTuftBuilder.rebuild(snap)` → `contentKey([snapshot.terrain, snapshot.grassSurfaces])`
  (`grass-tuft-builder.js:188`)

Measured on this machine with a synthetic 5,041-tile terrain: **1.21 ms per terrain walk**,
1.29 ms for the terrain+grassSurfaces pair → **~3.7 ms per refresh event** spent hashing the same
data three times. This is the intended cost of the Phase-5 "correct cache keys" fix and it is far
cheaper than the rebuilds it prevents, but the obvious win is to compute the terrain key **once**
in `buildWorldSnapshot` (e.g. `snapshot.terrainKey`) and have each builder mix that scalar into its
own key rather than re-walking. Cliff/floor/wall keys are over much smaller arrays and are fine.

## 5. Browser smoke coverage is gone: stale harnesses + no headless WebGL

Two Puppeteer harnesses survive but are **not run by `npm test`** — `scripts/run-tests.mjs` filters
to `test/*.js` and explicitly excludes `.mjs` (they need a dev server). Both are blocked twice over:

- **Environment.** Headless Chromium on this machine has no WebGL, so `ThreeRenderer` never comes
  up. This was hit and documented during Phase 4; it is an environment limitation, not a regression.
- **Stale premises.** Both harnesses predate the pipe-centric model. `test-render-placement.mjs:63-70`
  and `test-ui-placement.mjs:52` branch on `comp.placement === 'module' | 'attachment'` and expect
  every "module" to be free-grid placeable. Under the current taxonomy, 9 components are
  `placement: 'module'` **and** `role: 'placement'` (`buncher`, `pillboxCavity`, `rfCavity`,
  `sbandStructure`, …) — palette-visible but rejected by `Game.placePlaceable` (`Game.js:1531`) with
  "must be placed on a beampipe". So `test-render-placement.mjs` would report ~9 spurious failures
  even with WebGL working.

Restoring this means both a rewrite against `role` and a runner that has GL: Playwright with
SwiftShader (`--use-gl=swiftshader --use-angle=swiftshader`) or an ANGLE software backend is the
usual answer. The unit suites cover placement *logic* well (`test-place-all-components.js`,
`test-input-tools.js`, `test-esc-stack.js`); what is genuinely uncovered is "does the app boot and
render without throwing".

## 6. Economy is tuned; progression is not designed

Phase 7 rescaled objective rewards ($20k–$2M, rep 1–50) and pinned economy invariants in
`test/test-economy-balance.js` and `scripts/balance-sim.mjs`. Those invariants are about *rates*,
not about *a playthrough*. The sim's own numbers show the gap:

| Scenario | Steady-state | Upkeep fraction |
|---|---|---|
| A: fresh sandbox, idle | **−10 /tick** (drains $2.5M start over ~250k ticks) | 109% |
| B: small facility, beam running | +1,030 /tick, rep +0.8/100t | 15.5% |
| C: two beamlines + detector | +2,100 /tick, rep +2.9/100t | 42% |

*(Numbers refreshed against the working tree. Rounds 4–6 changed the inputs — see §8 — but the
shape of the curve, and the gap described below, are unchanged.)*

Against `src/data/research.js`: the cheapest node costs `{data: 5, funding: $200k}`, mid-tier nodes
$3M–$8M, and the top of the tree $20M with `reputation: 10`. In scenario B a player nets ~$1.07k/tick
— **~7,500 ticks to afford one $8M node**, while the $2.5M starting balance already pays for the
first several. Reputation is the harder gate: B accrues ~0.008 rep/tick, so `reputation: 10`
research is ~1,250 ticks of a *running facility* away. The result is a curve that is flat-then-flat:
starting funds trivialize early research, and mid-game funding rate makes late research a long
grind rather than a decision.

What is missing is a deliberate pass over **research cost ladder × milestone reward schedule ×
tick income across a full playthrough** — pick a target playthrough length in ticks, place the tech
tree's tiers against it, and make objective rewards the thing that unlocks the next tier rather than
a bonus on top of passive accumulation. The tooling to do this now exists (`balance-sim.mjs` can be
extended with a research-purchase policy); the design decision has not been made.

## 7. Research `unlocks` is decorative for 9 components — the gating half was not wired

Round 5 added `validateResearch()` (`src/data/validate.js:341`), which found that 27 of 68 nodes —
$403M of content — advertised a payload nothing delivered: `unlocks` ids absent from `COMPONENTS`,
and `effect` keys no consumer ever reads. Those were repaired.

**What was deliberately left.** The validator checks the forward direction only (does the id
resolve?). It does not check the reverse: that an id a node claims to unlock is actually *gated* by
that node. `Game.isComponentUnlocked` (`Game.js:623`) is `comp.unlocked → true`, then
`!comp.requires → true` — **no requirement means available by default**. Auditing the 29 ids that
appear in some node's `unlocks`:

| Component | Why it is already available | Cost |
|---|---|---|
| `cryomodule` | `unlocked: true` | $12,000,000 |
| `rfq` | `unlocked: true` | $1,500,000 |
| `target` | `unlocked: true` | $1,000,000 |
| `sextupole` | `unlocked: true` | $350,000 |
| `wireScanner` | `unlocked: true` | $200,000 |
| `ecrIonSource` | no `requires`, no `unlocked` | $1,200,000 |
| `ln2Precooler` | no `requires`, no `unlocked` | $1,500,000 |
| `cryocooler` | no `requires`, no `unlocked` | $500,000 |
| `ionSource` | no `requires`, no `unlocked` | $400,000 |

So 9 of 29 "unlocks" are buildable from tick 0 — including the SRF branch's headline `cryomodule`.
The research node still charges its cost and prints its unlock line; the player just already had the
part. Five of the nine carry an *explicit* `unlocked: true` that directly contradicts the node, so
this is not an oversight of omission — somebody made both statements.

One asymmetry the other way, verified: `gyrotron` declares `requires: 'advancedRf'`, but
`advancedRf.unlocks` does not list it. It is correctly gated and never advertised.

**Why deferred.** Deleting the five `unlocked: true` flags and adding `requires` to the other four
is a two-line data edit, but it is a *gating* decision, not a data repair: `ionSource` / `rfq` /
`target` are the first beamline a new player builds, and locking them behind research changes the
opening of the game. The tech tree's tier structure has never been laid against a target playthrough
(§6) — pick that first, then decide which of these nine are genuinely gates.

## 8. Beam income was rescaled by a compensating constant, not re-derived

Round 4 found `computeBeamIncome` was being fed `flattenPath(...).length`, which counts the
flattener's synthetic **drift** entries — the gaps *between* placements — as machines. On a normal
layout that roughly doubles the count, so every beamline had been earning roughly double for its
whole life. The count was fixed (`Game.js:3235` now filters `kind !== 'drift'`).

**What was deliberately left.** Income was restored by scaling `ECON.beamIncomePerNode` 100 → 180
(`economy.js:24`) until `scripts/balance-sim.mjs` steady-states landed near their Phase-7 values.
That holds the *rates* the invariants in `test/test-economy-balance.js` pin, but:

- it preserves whatever was wrong about the Phase-7 tuning, which was itself done against the
  double-counted number;
- it silently re-weights what a beamline earns for. Income now scales with **hardware density**
  rather than **length** — a long drift-heavy transport line earns strictly less than it did last
  week, a densely-packed one is unchanged. Nobody chose that; it fell out of the fix.

The per-node income curve has still never been derived from a target playthrough length. Same
missing pass as §6, now with one more unexamined constant in it.

## 9. The orphan grace window is not a window across a save/load

Round 6 found that deleting a cooling loop's lines and redrawing them re-minted the network from
`persistentStateDefaults` — i.e. a **full reservoir for two free clicks**, when a refill costs
$5,760 of coolant or $24,000 of LHe. The fix holds an orphaned network's persistent state for
`ORPHAN_GRACE_PASSES = 300` before pruning (`solve-runner.js:34,264-276`), so the redraw re-adopts
the drained state (ids are content-hashed from port membership, so they come back identical).

**What was deliberately left.** The grace clock is stamped as `entry.__orphanedAt =
this.stats.solvePasses`. `stats` is per-`SolveRunner` and starts at `{solvePasses: 0}` in the
constructor (`solve-runner.js:63`), but `state.utilityNetworkState` **is serialized** (`Game.js:578`
writes it out as an entry array), so `__orphanedAt` survives a save. After a reload,
`this.stats.solvePasses - entry.__orphanedAt` is negative for anything orphaned before the save, and
`negative < 300` is permanently true. Verified with a repro: entry orphaned at pass 3,900, reload,
5,000 further passes — still present, never pruned.

Harm is bounded and points the safe way: one small object per abandoned network, only for the two
utility types that have persistent state (`coolingWater`, `cryoTransfer`), and the *effect* of never
expiring is that a drained reservoir is remembered rather than re-minted full — the anti-exploit
direction. What is actually broken is that "300 passes" is not a duration anyone can reason about.
Stamp `state.tick` instead of a solve-pass count, or strip `__orphanedAt` on load.

## 10. Rounds 4–6 leaned on regression suites, not on the seams that produced the bugs

Worth recording as a pattern, because it predicts where round 7 would find things. The 60 findings
cluster hard in three places:

- **Data-vs-code id drift** — `computeSystemStats` quoted `klystron` / `ssa` / `heliumCompressor` /
  `subCooling2K`, none of which are real `COMPONENTS` ids; `_getFurnishingTier` read
  `state.zoneFurnishings` when the 43 LAB items live in `state.zoneItems`; `hasMPS` read
  `facilityEquipment` for a `kind: 'infrastructure'` item. Every one is a string that used to be
  right. There is still **no test that asserts a hand-written id list resolves against
  `COMPONENTS`** — `validateResearch` does exactly this for one table and found 27 dead nodes; the
  same check does not exist for the ~10 remaining hand-written type lists in `economy.js`,
  `research.js` and `Game.js`.
- **Aggregates billed off the wrong denominator** — drift entries counted as machines (§8),
  `totalBeamOnTicks` divided by wall-clock ticks instead of beamline-ticks, `dataRate` billed raw
  while the tick derated it. These are all "two call sites compute the same quantity differently".
- **Gestures that mutate before they validate** — `_pushUndo()` before validation, `placeJunction`
  charging twice, `_abortPointerGesture` destroying a carried payload. Phase 4 unified *dispatch*;
  it did not unify **"charge, mutate, snapshot" ordering**, and there is no shared helper enforcing
  it.

None of the three was fixed structurally. Each bug was fixed at its site and pinned with a
regression block. That is the right call under a round cap, but it means the *classes* are still
open, and a seventh round would most cheaply be spent on the first bullet — a single test that walks
every hand-written id list in `src/` against the registries.

---

## Smaller things found during the final audit

- **Two parallel taxonomies for the same axis.** Components carry both `placement:
  'module' | 'attachment'` (palette/footprint semantics) and `role: 'junction' | 'placement'`
  (beamline routing). The overlap is confusing enough that it broke the Puppeteer harnesses (§5):
  9 components are `module`/`placement`, 4 are `attachment` with no role, 58 are `module` with no
  role, and 43 non-beamline items have neither. `validate.js:204-218` enforces the intended
  relationship, so this is documented rather than broken — but the word "placement" meaning two
  different things is a standing trap.
- **Phase 8 acceptance still not met as written.** The master plan asked for review rounds "until a
  round produces zero confirmed findings (cap 4)". Rounds 1–3 hit the cap with 45 confirmed; rounds
  4–6 were then run and hit a second cap with 60 more confirmed. **Six rounds, 105 findings, and
  round 6 was still producing them.** There is still no evidence the stream had converged — only
  evidence that severity fell. See the convergence-status block at the top.
- **Single 1.02 MB JS chunk** (275 kB gzipped) — vite warns on every build. No code splitting; the
  title screen pulls in Three.js, the physics loader, and all UI. Dynamic-importing the 3D renderer
  behind the title screen is the obvious first cut.
- **Two `Math.random()` calls remain outside the seeded RNG**, both benign:
  `UtilityLineSystem.js:40` is a *fallback* id generator that `Game.js:275` always overrides with a
  deterministic counter (unreachable in the real game, reachable in a test that constructs the
  system bare), and `SaveSlots.js:39` mints save-slot ids, which is UI state, not sim state. Neither
  affects the 100-tick determinism guarantee, but the `UtilityLineSystem` fallback is worth deleting
  so a future bare construction can't silently reintroduce nondeterminism.
- **Two live `TODO`s in the tree**: `BeamlineDesigner.js:515` (restrict the palette to attachment
  tools while editing a design) and `hud.js:1439` (tool-picker active-state highlight, deferred from
  Phase 5).
- **`ThreeRenderer` now has 11 `_liveState()` call sites** (was 9; rounds 4–6 added two while fixing
  hit-test paths). Phase 5 collapsed all direct `game.state` reads to one accessor, which was the
  point — but the boundary is not closed until those reads (terrain corner heights, cursor/hit-test
  paths) get snapshot sections of their own, and the count is drifting the wrong way.
