# Staff Professions — Plan 3: Jobs and Labor Gates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff do real work at real stations, and beam, repair, research, and
fabrication stop happening when nobody is there to do them.

**Architecture:** A job board rescans the world periodically and emits offers;
idle staff claim the highest-priority offer they are eligible for, reserve its
station, path to it, and tick work that writes back into the sim. The four
aggregate formulas in `Game.js` and `utility-gate.js` are then replaced one at a
time, each by the sum of what actually-working staff produced. Every rejection
along the way records a human-readable reason, because with four hard gates a
silent facility is unshippable.

**Tech Stack:** Vanilla ES modules, node test runner (`npm test` →
`scripts/run-tests.mjs` over `test/*.js`), Three.js (CDN global), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-staff-professions-and-work-design.md`

**Depends on:** Plans 1 and 2, both complete.

## Global Constraints

- **Pre-release, single-user: ignore save compatibility.** Old saves may break.
  No migrators, no version bumps, no graceful-degradation shims.
- **Commit your own task's files, and only those.** Use
  `git commit -m "msg" -- path/one.js path/two.js` naming exactly the files you
  wrote — **never** `git add`, never a bare commit, never `git commit -a`.
  Multiple sessions share this checkout and the index is shared state. Never
  include a file you did not write; if one appears in your commit, say so in
  your report.
- **Don't start or kill a dev server.** The user keeps one running.
- **Every rejection carries a reason string.** A staffer who is not working, a
  gate that is closed, a job that could not be offered — all of them record
  *why*, in player-facing language. Follow the precedent in
  `utility-gate.js:_unstaffedMessage`, which distinguishes "no operator hired"
  from "operators on break and hungry — build a cafeteria".
- **Release reservations on every exit path.** Completion, abandonment, need
  interrupt, target demolition, staff fired, save load. A leaked reservation
  silently disables a station forever and presents as a job-priority bug.
- **This is the plan where the facility goes dark.** Expected and intended. Make
  sure the reason on screen says how to fix it.
- New tests are `test/*.js`, run by `node test/<file>.js`; failure is signalled
  by a non-zero exit code.

---

### Task 1: The job board

**Files:**
- Create: `src/game/staff/jobs.js`
- Test: `test/test-job-board.js` (create)

**Interfaces:**
- Consumes: Plan 1's `PROFESSIONS`/`SPECIALTY_AXES`, Plan 2's `getStationIndex`,
  `findStation`, `isReachable`.
- Produces:
  - `JOB_TYPES` — object keyed by the eleven job ids already authored into the
    station data in Plan 2 Task 3: `runBeam`, `repair`, `labWork`, `commission`,
    `takeData`, `analyze`, `fabricate`, `paperwork`, `meet`, `eat`, `rest`.
    Each entry: `{ id, name, professions, usesSpecialty, basePriority, workTicks, interruptible }`.
    `professions` is the array of profession ids eligible. `workTicks` is `null`
    for open-ended jobs (`runBeam` is held indefinitely) or an integer for
    finite ones (`repair`, `commission`, `analyze`).
  - `buildJobOffers(game)` → array of
    `{ jobType, target, specialty, priority, stationKey }`, sorted by
    descending priority.
  - `target` is `null` for station-only jobs. For `repair` and `commission` it
    is `{ beamlineId, nodeId }` — **both fields, always.** Component health is
    stored per beamline at `entry.beamState.componentHealth[node.id]`
    (`src/game/Game.js:3999-4015`), not in a flat global map, so a bare node id
    cannot address a repair target. Resolve a target through
    `game.registry.getAll()` to find the entry, then index its `beamState`. A
    target whose beamline no longer exists is a stale job: abandon it.
  - `eligibleFor(member, offer)` → `{ ok, reason }` — never a bare boolean, so
    the rejection reason survives to the UI.

Priority ordering, highest first: `eat` and `rest` (need-driven, injected by
Task 2 rather than the board), then `repair`, `runBeam`, `commission`,
`fabricate`, `takeData`, `labWork`, `analyze`, `paperwork`, `meet`.

Offer generation, per job type:
- `runBeam` — one offer per free `runBeam` station slot, but no more than the
  number of beamlines that currently exist. A console with no beamline to run is
  not work.
- `repair` — one offer per beamline node whose `componentHealth < 100`, priority
  scaled by how low the health is. Rejected before offering when the node is
  unreachable or `resources.spares <= 0`, each with its own reason.
- `commission` — one offer per placed component flagged `needsCommissioning`
  (Task 6 sets the flag), carrying that component's specialty.
- `fabricate`, `labWork`, `takeData`, `analyze`, `paperwork` — one offer per free
  station slot of that job type. `labWork` and `takeData` carry the specialty of
  the zone the station sits in, resolved through `ZONES[zoneId]` and the
  specialty's `zoneId` back-reference.
- `meet` — offered only when an admin is present and at least three staff are
  otherwise idle; this is a morale release valve, not a default activity.

`eligibleFor` rejects with reasons: profession mismatch, specialty mismatch when
the job type has `usesSpecialty` and the member has a specialty that differs *and*
`CROSS_SPECIALTY_EFFICIENCY` would make it pointless (never reject purely on
specialty — a mismatched engineer works at half rate, per the spec, so only
reject when the member has no relevant skill at all), station unreachable from
the member's current position, and station already reserved.

- [ ] **Step 1: Write the failing test**

`test/test-job-board.js` asserts:
- A world with a console and one beamline offers exactly one `runBeam`; with no
  beamline, zero.
- A damaged node produces a `repair` offer whose priority rises as health falls.
- With `spares === 0`, the `repair` offer is absent and the recorded reason
  mentions spares.
- A walled-off console produces no offer, with an unreachability reason.
- An RF-specialty `labWork` offer is eligible for an RF engineer, eligible for a
  vacuum engineer (at reduced efficiency, not rejected), and rejected for an
  operator on profession grounds.
- `eligibleFor` always returns a non-empty `reason` when `ok` is false.
- Offers come back sorted by descending priority, with `repair` ahead of
  `runBeam` ahead of `analyze`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-job-board.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-job-board.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): job board and offer generation" -- src/game/staff/jobs.js test/test-job-board.js
```

---

### Task 2: Job assignment and the work state machine

**Files:**
- Create: `src/game/staff/jobRunner.js`
- Modify: `src/game/staff/StaffMember.js` — add the `job` and `idleReason` fields
- Modify: `src/game/Game.js:3689-3702` — the needs loop calls the runner
- Test: `test/test-job-runner.js` (create)

**Interfaces:**
- Consumes: Task 1's board, Plan 2's `reserveStation`/`releaseStation`/
  `releaseAllFor`, `findPath`.
- Produces:
  - `member.job` — `{ jobType, target, specialty, stationKey, phase, progress }`,
    where `target` has the shape Task 1 defines (`null`, or
    `{ beamlineId, nodeId }`)
    or `null`. `phase` is `'travel' | 'work'`.
  - `member.idleReason` — string or `null`.
  - `assignJobs(game)` — one pass: for each member with no job and status
    `'working'`, take the best eligible offer, reserve, set `job`, set
    `phase: 'travel'`. Members left without a job get an `idleReason` from the
    best rejection they collected, or a generic "nothing to do" when the board
    was empty.
  - `tickJobs(game)` — advance every member's job by one tick: travel progress is
    driven by the renderer, so the sim only checks arrival; work progress
    increments `job.progress` by `member.efficiency(zoneTier, job.specialty)`,
    and at `workTicks` the job completes.
  - `abandonJob(member, game, reason)` — releases the station, clears `job`, sets
    `idleReason`. The single choke point every exit path goes through.
  - `onJobComplete(game, member, job)` — a dispatch hook; Tasks 3-6 register the
    per-job-type effects here rather than editing the runner.

Needs outrank work. Before assignment, a member whose `hunger > 0.8` or
`fatigue > 0.8` abandons any current job and takes an `eat` or `rest` job
instead. This replaces the current `status = 'onBreak'` transition in
`staffSystem.tickStaffMember` — hunger and fatigue recovery now require actually
reaching a cafeteria seat or a maintenance rest station.

**Deadlock guard, non-negotiable:** the existing code carries a scar comment
about hunger that *rose* on break, making the recovery condition unsatisfiable
and permanently tripping the beam. The same trap exists here: a hungry staffer
with no reachable cafeteria must not become permanently unemployable. When an
`eat` or `rest` job cannot be offered, the member recovers slowly in place —
at the current cafeteria-less rate — and keeps working, with an `idleReason`
naming the missing cafeteria. Test this explicitly.

- [ ] **Step 1: Write the failing test**

`test/test-job-runner.js` asserts:
- An idle operator in a world with a console and a beamline is assigned
  `runBeam`, holds the reservation, and reaches `phase: 'work'` on arrival.
- A finite job (`repair`) completes after `workTicks / efficiency` ticks and
  fires `onJobComplete` exactly once.
- Demolishing the station mid-job abandons it and releases the reservation.
- Firing a staffer mid-job releases the reservation.
- A member crossing the hunger threshold abandons work and takes `eat`.
- **With no cafeteria anywhere, a hungry member keeps working, recovers slowly,
  and never becomes permanently jobless** — run 500 ticks and assert they are
  still doing `runBeam` at the end.
- Every member without a job has a non-empty `idleReason`.
- `serialize()` → `deserialize()` round-trips `job`, and a reservation whose
  holder no longer exists is dropped on load.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-job-runner.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-job-runner.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): job assignment and work state machine" -- src/game/staff/jobRunner.js src/game/staff/StaffMember.js src/game/Game.js test/test-job-runner.js
```

---

### Task 3: Wire the runner to the pawns

**Files:**
- Modify: `src/renderer3d/StaffPawns.js` — replace the throwaway station-picking
  from Plan 2 Task 6
- Test: `test/test-pawn-job-integration.js` (create)

**Interfaces:**
- Consumes: Task 2's `member.job`, Plan 2's `sendToStation`/`setDestination`.
- Produces: nothing new. Pawn motion becomes a pure function of `member.job`.

Delete the random-station driver. A pawn now mirrors its member: `job === null`
→ amble as before; `phase: 'travel'` → path to the job's station and report
arrival by setting `job.phase = 'work'`; `phase: 'work'` → hold the station's
pose. The sim decides; the renderer displays and reports arrival.

Arrival reporting is the one place the renderer writes to sim state. Keep it to
that single field and comment why.

- [ ] **Step 1: Write the failing test**

`test/test-pawn-job-integration.js` asserts a member assigned a job with a known
station gets a pawn whose path ends at that station's anchor, that stepping the
pawn to arrival flips `job.phase` to `'work'`, and that clearing the job returns
the pawn to ambling.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-pawn-job-integration.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then watch it**

Run: `node test/test-pawn-job-integration.js` then `npm test`
Expected: PASS. In game, staff should now walk to consoles and benches on purpose
rather than at random.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): pawns follow assigned jobs" -- src/renderer3d/StaffPawns.js test/test-pawn-job-integration.js
```

---

### Task 4: The beam gate moves to seated operators

**Files:**
- Modify: `src/game/utility-gate.js:204-212` (the gate), `:240-266`
  (`_unstaffedMessage`, `_hasActiveOperator`)
- Test: `test/test-beam-staffing-gate.js` (create)

**Interfaces:**
- Consumes: `member.job`.
- Produces:
  - `operatorCoverage(state)` → `{ covered, capacity, operators }` — `capacity`
    is the summed per-operator coverage of every operator currently in
    `phase: 'work'` on a `runBeam` job; `covered` is `capacity >= beamlineCount`.
  - Per-operator coverage: `1 + floor(skills.operating / 4)`, so a green operator
    covers one beamline and a maxed one covers three. Console tier, when
    `zoneConnectivity.controlRoom.tier` is 3 or more, adds 1.

The gate becomes: `beamlineCount > 0 && !operatorCoverage(state).covered` →
hard blocker `beam_unstaffed`.

Every operator in `phase: 'work'` on `runBeam` increments `member.stats.beamHours`
once per in-game hour (`DAY_LENGTH_TICKS / 24` ticks) — the counter Plan 1
declared and the "recovered the beam 47 times" milestone in Task 7 reads from.

Rewrite `_unstaffedMessage` to name the real cause, extending the existing
ladder: no operator hired; operator hired but no `operatorConsole` placed; a
console exists but is unreachable; operators are travelling (transient, and it
should say so rather than reading as an error); operators are on break with no
cafeteria; capacity short of beamline count — *"2 operators cover 3 beamlines;
hire another or promote one"*.

Delete `_hasActiveOperator` and its `mood === 'stressed' && rng() < 0.3` random
rejection. Randomly refusing to run based on a hidden roll is not legible, and
skill-driven trips (Task 8, if pursued) are the honest version of that idea.

- [ ] **Step 1: Write the failing test**

`test/test-beam-staffing-gate.js` asserts:
- No operator → blocked, reason names hiring.
- Operator hired but no console → blocked, reason names the console.
- Operator working at a console, one beamline → not blocked.
- Two beamlines, one green operator → blocked, reason names the capacity
  shortfall with both numbers.
- Two beamlines, one operator with `operating >= 4` → not blocked.
- Operator in `phase: 'travel'` → blocked, reason says they are on their way.
- Console walled off with no door → blocked, reason names reachability.
- The gate never depends on `Math.random` — run the same state twice and get
  identical blockers.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-beam-staffing-gate.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-beam-staffing-gate.js` then `npm test`
Expected: PASS. Expect existing beam tests to fail until they place a console and
seat an operator — fix them by building the control room, not by weakening the
gate.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): beam requires an operator seated at a console" -- src/game/utility-gate.js test/test-beam-staffing-gate.js
```

---

### Task 5: Repair, spares, and fabrication

**Files:**
- Modify: `src/game/Game.js:4024-4058` — `_autoRepair` becomes job-driven
- Modify: `src/game/staff/jobRunner.js` — register the `repair` and `fabricate`
  completion effects
- Test: `test/test-repair-and-fabrication.js` (create)

**Interfaces:**
- Consumes: `onJobComplete`, `state.resources.spares`.
- Produces:
  - `repair` completion: restores the target node's `componentHealth` by
    `25 * efficiency`, consumes 1 spare, increments `member.stats.repairs`, and
    appends a history entry naming the component.
  - `fabricate` completion: adds `1 + floor(skills.construction / 3)` spares and
    increments `member.stats.sparesMade`.
  - Beamline component purchase gains a spares cost alongside funding —
    `Math.ceil(fundingCost / 5000)`, minimum 1 — checked and deducted at
    placement.

**Route the spares debit through `Game.chargeConstruction`, extending it rather
than writing `resources.spares -=` at the call site.** That method
(`src/game/Game.js:929`) carries a comment explaining that *every* build-time
funding debit goes through it precisely so **sandbox mode has one place to
suppress and cannot be leaked by a code path that decrements the balance
itself**. A spares debit written inline would charge sandbox players for parts
they are supposed to get free — exactly the leak the comment warns about.
Widen the signature to take a cost object (`{ funding, spares }`), keep the
`if (this.sandboxMode) return;` guard, and update its doc comment. The
affordability check must respect sandbox mode the same way.

Delete `_autoRepair` entirely, including its legacy
`repairRate = technicians * 2` fallback. Repair is now exclusively the completion
effect of a technician's job.

A repair with no spares must not silently do nothing: the offer is already
suppressed in Task 1, and the player-facing surface is the idle reason plus a log
line the first time it happens.

- [ ] **Step 1: Write the failing test**

`test/test-repair-and-fabrication.js` asserts:
- A damaged node with a technician and spares available heals on job completion,
  and `spares` drops by one.
- With `spares === 0` the node stays damaged and the technician has an idle
  reason naming spares.
- A machinist completing `fabricate` raises `spares`, more so at higher
  `construction`.
- Placing a beamline component deducts the computed spares cost, and placement
  is refused when spares are short.
- `_autoRepair` no longer exists — grep the source and assert the symbol is gone.
- Nothing repairs when every technician is idle or travelling.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-repair-and-fabrication.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-repair-and-fabrication.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): job-driven repair, machinist fabrication, spares economy" -- src/game/Game.js src/game/staff/jobRunner.js test/test-repair-and-fabrication.js
```

---

### Task 6: Data, analysis, zone tier, and commissioning

The engineer and scientist half of the economy.

**Files:**
- Modify: `src/game/Game.js:3912` — the science multiplier
- Modify: `src/game/Game.js:1729-1748` — `recomputeZoneConnectivity`
- Modify: `src/game/research.js` — research progress from `analyze`
- Modify: `src/game/staff/jobRunner.js` — `takeData`, `analyze`, `labWork`,
  `commission` effects
- Test: `test/test-science-and-zone-staffing.js` (create)

**Interfaces:**
- Consumes: `onJobComplete`, `zoneConnectivity`.
- Produces:
  - `takeData`: replaces `1 + scientists * 0.1`. Data accrues per tick as the
    summed `efficiency` of scientists in `phase: 'work'` on `takeData` at a
    station belonging to, or at the endpoint of, the beamline in question. No
    scientist → no data from detectors, full stop.
  - `analyze` completion: converts `data` into research progress and reputation,
    incrementing `member.stats.analyses`.
  - `labWork`: accumulates `zoneConnectivity[zoneId].staffedOutput`, a float that
    rises by `efficiency * 0.01` per worked tick and decays by 0.001 per tick
    otherwise, clamped to `[0, 1]`.
  - `commission`: components placed after this plan carry
    `needsCommissioning: true` and run at 0.7 of their rated contribution until
    an engineer of the matching specialty completes the job, which clears the
    flag and increments `member.stats.commissions`.

**Zone tier gets a ratchet, and this matters more than it looks.** Tier is
`min(tierFromTiles, tierFromStaffedOutput)` where `tierFromStaffedOutput` maps
`staffedOutput` through the same four thresholds normalised to `[0, 1]`. Because
`staffedOutput` decays slowly (a 0.001/tick decay is ~1000 ticks from full to
empty) an engineer taking a lunch break does not drop the zone a tier and
un-unlock the palette under the player's cursor. Additionally, **the highest tier
a zone has ever reached is remembered in `zoneConnectivity[id].peakTier` and used
for palette unlocks**, while the live tier drives efficiency. Losing access to
components you already bought is punishing in a way that losing throughput is
not.

- [ ] **Step 1: Write the failing test**

`test/test-science-and-zone-staffing.js` asserts:
- With detectors running and no scientist, `data` does not increase.
- With a scientist working `takeData`, it does, scaled by their efficiency.
- `analyze` converts data into research progress and reputation.
- A freshly painted 20-tile `rfLab` with no engineer has `tier === 0` and
  `peakTier === 0`.
- After an engineer works `labWork` in it long enough, `tier` rises to the
  tile-count tier.
- The engineer then stops; after 100 ticks `tier` is unchanged (the decay is slow
  enough that a break is harmless), and `peakTier` never falls.
- A newly placed component has `needsCommissioning` and contributes at 0.7; a
  matching-specialty engineer completing `commission` clears it.
- A mismatched-specialty engineer can still commission, at half rate.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-science-and-zone-staffing.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-science-and-zone-staffing.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): staffed data, analysis, zone tier, and commissioning" -- src/game/Game.js src/game/research.js src/game/staff/jobRunner.js test/test-science-and-zone-staffing.js
```

---

### Task 7: Admin work, and career history that accumulates

**Files:**
- Modify: `src/game/staff/jobRunner.js` — `paperwork` and `meet` effects
- Modify: `src/game/Game.js` — `staffHireCost` consumers, candidate refresh
- Create: `src/game/staff/careerLog.js` — the history writer
- Test: `test/test-admin-and-career.js` (create)

**Interfaces:**
- Consumes: `onJobComplete`, `member.stats`.
- Produces:
  - `paperwork` completion: converts reputation into funding at a rate scaled by
    `skills.admin`, and reduces the next hire's cost by 5% per completion, capped
    at 40%.
  - `meet` completion: a facility-wide `+0.15` morale bump to every attendee and
    `+0.05` to everyone else, once, on completion.
  - `logCareerEvent(member, tick, event, note)` — appends to `member.history`,
    capping it at the most recent 50 entries so a long game does not grow
    unboundedly, and de-duplicating consecutive identical events into a count.
  - `careerMilestones(member)` → array of player-facing lines derived from
    `stats` — "recovered the beam 47 times", "fabricated 200 spares" — emitted at
    round-number thresholds rather than every event.

Wire `logCareerEvent` into the completion effects added in Tasks 5 and 6: first
commission, every tenth repair, every hundredth spare, every analysis that
completes a research item.

- [ ] **Step 1: Write the failing test**

`test/test-admin-and-career.js` asserts:
- `paperwork` completion moves reputation into funding and lowers hire cost, and
  the discount caps at 40%.
- `meet` raises attendee morale more than non-attendee morale, exactly once.
- `logCareerEvent` caps history at 50 and collapses consecutive duplicates.
- `careerMilestones` is empty for a new hire and non-empty after 10 repairs.
- History survives `serialize()` → `deserialize()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-admin-and-career.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-admin-and-career.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): admin jobs and accumulating career history" -- src/game/staff/jobRunner.js src/game/staff/careerLog.js src/game/Game.js test/test-admin-and-career.js
```

---

### Task 8: Idle legibility

The task that makes the other seven debuggable. Do not skip it or fold it in.

**Files:**
- Modify: `src/ui/StaffInspector.js` — per-staffer reason
- Modify: `src/ui/hud.js` — facility banner
- Create: `src/game/staff/staffDiagnostics.js`
- Test: `test/test-staff-diagnostics.js` (create)

**Interfaces:**
- Consumes: `member.idleReason`, `member.job`, the gate reasons from Task 4.
- Produces:
  - `facilityStaffingReport(game)` →
    `{ idleCount, byReason: [{ reason, count, members }], worst }`, grouping
    identical reasons so twelve staff with one problem read as one line.
  - `worst` is the highest-impact reason, ordered: beam blocked, then repairs
    stalled, then everything else — so the banner leads with what is costing
    money.

Banner copy is one line, of the form *"4 staff idle: no reachable operator
console"*, clickable to open the inspector filtered to those staff. It appears
only when `idleCount > 0` and clears itself when the cause does.

The inspector shows, per staffer: current job and phase, or the idle reason;
their station; and the career milestones from Task 7.

- [ ] **Step 1: Write the failing test**

`test/test-staff-diagnostics.js` asserts:
- Twelve staff sharing one reason produce one `byReason` entry with count 12.
- `worst` picks the beam-blocking reason over a lower-priority one.
- A fully employed facility reports `idleCount === 0` and an empty `byReason`.
- Every reason string is non-empty and contains no identifier-looking text (no
  camelCase job ids leaking into player copy) — assert against a regex.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-diagnostics.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-staff-diagnostics.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): idle reasons and facility staffing banner" -- src/game/staff/staffDiagnostics.js src/ui/StaffInspector.js src/ui/hud.js test/test-staff-diagnostics.js
```

---

## Done when

`npm test` passes and a facility with no control room reports, in one clear line,
that it needs one — then runs beam the moment an operator sits down at a console.
Repairs stop without spares, data stops without scientists, and lab zones only
reach tier with engineers in them.
