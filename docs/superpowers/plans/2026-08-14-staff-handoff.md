# Staff Work — Handoff

Everything below is what remains after Plans 1–3. Plans 1 and 2 are complete and
reviewed. Plan 3's eight tasks are all implemented and the labour economy works
end to end (full playthrough 54/54), with two known open items listed here.

**Spec:** `docs/superpowers/specs/2026-08-13-staff-professions-and-work-design.md`

---

## 0. FIRST — discard a mutation artifact left in the working tree

`src/data/facility.js` is modified and **must not be committed**. A review agent
was mutation-testing and was interrupted before reverting. The change reverts
`LABWORK_CAPABLE_ZONES` from an explicit set back to a derived one — which is
exactly the defect that blocked 81% of a playthrough (it silently includes
`machineShop`, a zone no engineer can ever staff, because a `labBench` happens to
be placeable there).

```
git checkout -- src/data/facility.js
```

Also present: an untracked `node_modules` symlink, created by another session.
`.gitignore`'s `node_modules/` does not match a symlink. Leave or remove; do not
commit.

---

## 1. The sim depends on its renderer — fix the ownership

**This is the most important item here.** Two sim-critical fields are written
only by the renderer and read throughout the simulation:

- `job.phase = 'work'` — written **only** at `src/renderer3d/StaffPawns.js:771,781`
- `member.fromNode` — written **only** at `StaffPawns.js:837`, never initialised
  at staff creation

`member.fromNode` is read by `utility-gate.js:444` (the reachability check that
gates **all beam income**), `stations.js`'s `findStation` (hard-bails when falsy),
`jobs.js:693`, and four sites in `jobRunner.js`.

Measured, identical roster, 3000 ticks:

```
renderer present (shim)        true headless
beam         running           beam         stopped, beamOnTicks 0
work-ticks   7508 / travel 0   work-ticks      0 / travel 5990
repairs 12, commissions 8      repairs 0, commissions 0, spares 0
fromNode set 3/4               fromNode set 0/4
```

Headless, the job system does not function at all: nothing leaves `travel`,
nothing accrues or completes, `onJobComplete` never fires, zone `staffedOutput`
never ratchets (so lab tiers and research gating never open), `eat`/`rest` never
complete so every staffer ends permanently penalised, and `toggleBeam()` cannot
start the beam because `operatorCoverage` requires a `runBeam` job in
`phase: 'work'`.

**This is not confined to test scaffolding.** `src/game/agent/env.js` — the
shipped headless agent/RL environment — builds a `Game` with no renderer and no
shim, so it is in this state today.

### What to do

Own both fields in the sim. In `jobRunner.js`'s `tickJobs`, advance travel by a
tick budget and flip `phase` to `'work'` on arrival; initialise `fromNode` when a
member is created and update it as the sim moves them. `StaffPawns.js` then
*animates toward* that state instead of *authoring* it — which is the ownership
boundary the spec already states ("the sim decides; the renderer displays").
`computeTravelBudget` / `travelBudgetTicks` already exist in `jobRunner.js`.

### Two things this will expose — surface them, do not smooth them over

1. **`scripts/balance-playthrough.mjs`'s shim teleports staff** (`fromNode = destNode`
   on the same tick). The 80,000-tick benchmark therefore measures a facility
   where **nobody ever walks**: throughput is overstated, station contention
   understated, and the travel-abandonment paths (`"Gave up trying to get
   there."`, `"The path there was lost."`) plus every reachability-driven idle
   reason are never exercised. Remove the shim and re-run. **If the numbers get
   worse, that is the truth arriving, not a regression** — report it, do not tune
   it away. The current 54/54 was earned without real travel.
2. `jobRunner.js`'s travel-budget work was verified against the shimmed harness.
   Re-check it against real travel.

**Acceptance:** a `Game` with no renderer completes jobs, accrues stats, ratchets
zone tier, and can start its beam. `src/game/agent/env.js` works unshimmed.

---

## 2. The stall detector needs a different signal shape

`src/game/staff/staffDiagnostics.js`'s `facilityProgressReport` is meant to catch
"everyone is busy and nothing is progressing" — the shape of the two most
expensive bugs in this work. It has been through three rounds and still does not
work in the game.

- Round 1 fired on legitimate states (slow job in flight, research mid-progress).
- Round 2 fixed that by summing in-flight `job.progress` — which silenced it
  entirely, because progress accrues every tick and open-ended `runBeam` never
  completes.
- Round 3 excluded open-ended jobs and capped finite ones at `workTicks`. Still
  silenced: `eat`/`rest` are finite jobs, so staff merely getting hungry resets
  the clock every ~250 ticks, and **a single engineer on a perpetual `labWork`
  loop silences it outright** — which is the original motivating example.

Measured on a real dead facility (28 hard faults, beam never run, zero income),
5000 ticks:

```
operator only          first fire  458   banner visible 139/5000 (2.8%)
operator + engineer    first fire  null  banner visible   0/5000
full 5-person roster   first fire  null  banner visible   0/5000
```

**The structural problem:** `min(progress, workTicks)` cannot distinguish
"`labWork` cycling and producing nothing" (must fire) from "`takeData` cycling and
producing something" (must stay silent). Same code path. **No fix that keeps this
fingerprint shape can satisfy both.**

### What to do

Key the signal on **facility output**, not on any per-member job field — deltas in
`resources.data`, `resources.funding`, `reputation`, `completedResearch.length`,
and zone-tier progress. "Nothing has completed" is a statement about the facility
and should be measured on the facility.

Do this **after** item 1: headless fixtures currently behave differently from the
real game, and the existing TP2 test passes only because nothing flips `job.phase`
without a renderer — it is measuring the renderer-absence bug, not the detector.

### Also outstanding in that file

- **`stats.ticksWorked` in `staffWindowSig` defeats the signature guard entirely**
  — measured 2000 changes over 2000 ticks, longest untouched stretch **1 tick**,
  so an open `<select>` in the inspector is destroyed every second. It increments
  every tick a member works, so it can never be a change *detector*. Drop it and
  `beamHours` (same shape). Keep needs rounding coarser than their per-tick drift
  (`FATIGUE_PER_TICK = 0.005` moves a 1%-rounded value every other tick).
- **A deliberately-stopped beam fires a generic stall at t=241.** Test 13b asserts
  only that the "never started" *text* is gone, never that `stalled === false`.
- **`.every()` labels a productive facility "⏸ Facility stalled" the instant a
  second beamline is registered**, outranking the correct clickable idle banner.
  Name the specific line; don't route a never-started *new* line through
  facility-stall styling.
- **Delete `longestInFlightWindow`.** Its stated purpose is impossible by
  construction — any advancing job resets the fingerprint every tick, so the
  window is never consulted for the case it exists for (proven: a 0.01-efficiency
  job, 15,000 real ticks, stays silent regardless). It only applies to jobs that
  are *not* advancing, where it delays a true positive by up to 3751 ticks.
- `staffDiagnostics.js:381-384` still claims a `labWork`-only facility "is covered
  without a special case" — *covered* there means *suppressed*, the opposite of
  the requirement. Fix the comment.

---

## 3. Plan 4 — presentation (not started)

**The plan is already written and ready to execute:**
`docs/superpowers/plans/2026-08-13-staff-professions-4-presentation.md`

Five tasks: profession outfits and silhouettes; mood-driven faces (brows, mouth
curve, nose, eyewear); working poses and idle fidgets; crowd variety; and live
portraits on the bio cards.

This is the original ask — "improve the look of the staff people" — and none of it
is done. The plan carries its own constraints; three worth repeating because they
were learned expensively:

- **Test the builder headlessly** via `test/test-staff-builder.js`'s existing THREE
  stub, not Playwright. The browser suite cannot complete a run in this repo.
- **The stub records geometry but never applies transforms**, so it is blind to
  world placement and facing. It missed three bugs of exactly that shape in Plan 2
  (inverted pose signs; a doubled seat height that floated pawns at 60% of figure
  height). Assert direction and placement with hand-computed forward kinematics —
  `legForwardKinematics` in that file is the pattern.
- **Keep `test/test-staff-builder.js`'s pre-existing assertions green.** They guard
  the origin-at-feet contract and shadow flags.

---

## 4. Smaller items recorded but not fixed

- **Morale is a one-way ratchet.** Nothing restores it while `status === 'working'`
  — not eat, not rest, not `meet` — so every working staffer decays toward
  breakdowns (15-18% of all ticks at cafeteria tier 0, 9-10% at tier 2). And
  `cafeteriaTier` derives from a painted *zone*, not from placed tables, so
  dining furniture buys hunger relief and no morale relief. A completed `meet` is
  currently the only voluntary in-work recovery in the game.
- **At exactly 1 beamline per operator, neglect still beats amenities** on beam
  coverage (74.5–77.9% vs 82.0–85.0%). The unserviced-operator coverage cap only
  inverts the comparison at ≥2 beamlines per operator.
- **`Game.placePlaceable` has no off-map guard** — only `DesignPlacer.js:245`
  refuses off-site placement, so any non-UI caller can create a permanently
  unreachable placeable. This is what let the harness silently build 20 of 25
  beamlines outside the nav grid.
- **`getZoneTierForCategory` returns a hardcoded `99`**, so palette unlocks are
  ungated. Do **not** simply un-stub it: the original implementation gates
  `source`/`optics`/`rf`/`diagnostic`/`endpoint` on `machineShop`, whose
  `peakTier` never rises — re-enabling it today would lock the entire beamline
  catalogue. `peakTier` is computed and read only by `research.js:140`.
- **Seat matching has zero placement tolerance** — a chair one subtile off-axis
  silently fails to match and a `seated: 'required'` slot vanishes from the index
  with no feedback.
- `_removeBeamlineForSourcePlaceable` (`Game.js:3355`) is dead code with no
  caller, so removing a source junction leaves a phantom registry entry.

---

## Methodology notes — these cost real time to learn

- **Measure the whole run or do not claim the result.** Four separate times a
  partial or averaged measurement hid a full-run failure: a "beam on 99%" average
  reading through a 24,000-tick dead half-run; a whole-run line fraction reading
  91% through the same stall; a 15,000-tick partial reporting a blocker at 10.8%
  that a full run put at 81%; and a 30,000-tick partial reporting 5% where the
  full run gave 19%.
- **Isolated `git archive` checkouts have no `node_modules`**, so every
  three.js-dependent suite fails spuriously. Use them for timing, never for
  pass/fail.
- **Mutation-verify every guard.** Repeatedly in this work a test passed against
  the bug it was written to catch — because its fixture used a shape no real
  component has, or it could not reach the path that mattered. Break the thing,
  confirm the test fails, restore, confirm it passes.
- **Check the unguarded path.** Six defects came from a second route nobody
  looked at: components charged by one placement path and not another, two
  definitions of a beamline, presence-based work escaping a progress-based
  penalty, photon data bypassing the science gate, a compat hiring route with its
  own cost formula.
- **Derived sets are a trap.** `LABWORK_CAPABLE_ZONES` derived from "where can a
  bench be placed" swept in a zone no engineer can staff and cost 81% of a
  playthrough. Prefer explicit sets with a comment saying why.
