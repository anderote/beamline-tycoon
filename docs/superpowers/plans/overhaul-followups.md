# Overhaul Followups — what the overhaul deliberately did NOT do

Written at the end of the `overhaul` branch (7 phase commits + a 3-round adversarial review loop
that hit its round cap with 45 confirmed findings fixed). Everything below was verified against the
branch tip at the time of writing — line numbers and counts are real, not remembered.

Gate status at close: `npm test` 56/56 suites green (55 node suites + pytest, 123 python tests),
`npx vite build` green, `node scripts/balance-sim.mjs` exit 0.

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

## 2. InputHandler is still 2,851→2,859 lines (Phase 4 target was < 1,500)

Phase 4 delivered the important part — one `Tool` interface, one `activeTool` field, the 14
mutually-exclusive-by-convention fields and ~107 manual deselect calls are gone (2 `deselect`
references remain), tool families live in `placement-tools` / `structure-tools` / `demolish-tool` /
`mode-tools` / `beamline-tool` / `utility-line-tool`. What it did not do is finish the extraction:
the file went 4,002 → 2,859, not → 1,500. The residue is cohesive helper clusters that never found
a home. Verified extraction candidates, with real line ranges:

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
| B: small facility, beam running | +1,073 /tick, rep +0.8/100t | 15% |
| C: two beamlines + detector | +1,860 /tick, rep +2.9/100t | 45% |

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

---

## Smaller things found during the final audit

- **Two parallel taxonomies for the same axis.** Components carry both `placement:
  'module' | 'attachment'` (palette/footprint semantics) and `role: 'junction' | 'placement'`
  (beamline routing). The overlap is confusing enough that it broke the Puppeteer harnesses (§5):
  9 components are `module`/`placement`, 4 are `attachment` with no role, 58 are `module` with no
  role, and 43 non-beamline items have neither. `validate.js:204-218` enforces the intended
  relationship, so this is documented rather than broken — but the word "placement" meaning two
  different things is a standing trap.
- **Phase 8 acceptance not met as written.** The master plan asked for review rounds "until a round
  produces zero confirmed findings (cap 4)". The loop ran 3 rounds and was stopped at the cap with
  findings still being produced — 45 confirmed and fixed. Round 4 was never run; there is no
  evidence the finding stream had converged.
- **Single 1.02 MB JS chunk** (273 kB gzipped) — vite warns on every build. No code splitting; the
  title screen pulls in Three.js, the physics loader, and all UI. Dynamic-importing the 3D renderer
  behind the title screen is the obvious first cut.
- **Two `Math.random()` calls remain outside the seeded RNG**, both benign:
  `UtilityLineSystem.js:40` is a *fallback* id generator that `Game.js:275` always overrides with a
  deterministic counter (unreachable in the real game, reachable in a test that constructs the
  system bare), and `SaveSlots.js:39` mints save-slot ids, which is UI state, not sim state. Neither
  affects the 100-tick determinism guarantee, but the `UtilityLineSystem` fallback is worth deleting
  so a future bare construction can't silently reintroduce nondeterminism.
- **Two live `TODO`s in the tree**: `BeamlineDesigner.js:497` (restrict the palette to attachment
  tools while editing a design) and `hud.js:1440` (tool-picker active-state highlight, deferred from
  Phase 5).
- **`ThreeRenderer` still has 9 `_liveState()` call sites.** Phase 5 collapsed all direct
  `game.state` reads to one accessor (`ThreeRenderer.js:2863`), which was the point — but the
  boundary is not actually closed until those 9 reads (terrain corner heights, cursor/hit-test
  paths) get snapshot sections of their own.
