# Staff Professions — Plan 1: Data Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four hardcoded staff roles with six data-driven professions
carrying specialties, five skills, mechanically-loaded backstories, accumulating
career stats, and a new `spares` resource — with no change to what staff actually
do yet.

**Architecture:** Professions move out of the string literals scattered across
`Game.js`, `staffSystem.js`, `utility-gate.js`, and `staff-builder.js` into a
single `src/data/professions.js` table, mirroring how `ZONES` and `PLACEABLES`
already work. `StaffMember.role` becomes `.profession` and gains `.specialty`,
`.backstoryId`, and `.stats`. Behaviour is deliberately frozen: after this plan
the game plays exactly as it did, with six hireable professions instead of four
and richer hiring cards. Plans 2–4 supply the behaviour.

**Tech Stack:** Vanilla ES modules, node test runner (`npm test` →
`scripts/run-tests.mjs` over `test/*.js`), Vite, Three.js (runtime `THREE` global).

**Spec:** `docs/superpowers/specs/2026-08-13-staff-professions-and-work-design.md`

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
- **No behaviour changes in this plan.** The beam gate, repair rate, data
  multiplier, and zone tier keep their current formulas. If a rename forces you
  to touch one, preserve its arithmetic exactly.
- `profession` is the field name everywhere. The old name `role` must not
  survive anywhere in `src/` when this plan is done.
- New tests are `test/*.js`, run by `node test/<file>.js`; failure is signalled
  by a non-zero exit code. Match the style of the neighbouring file you extend.

---

### Task 1: The professions table

The single source of truth every later task reads from.

**Files:**
- Create: `src/data/professions.js`
- Test: `test/test-professions.js` (create)

**Interfaces:**
- Consumes: `ZONES` from `src/data/facility.js` (for `homeZone` validation and
  the specialty accent colors Plan 4 will read).
- Produces:
  - `SKILLS` — ordered array of the five skill ids:
    `['operating', 'technical', 'research', 'construction', 'admin']`.
  - `PROFESSIONS` — object keyed by profession id. Six entries: `operator`,
    `technician`, `engineer`, `scientist`, `machinist`, `admin`. Each carries
    `{ id, name, plural, desc, primarySkill, homeZone, specialtyAxis, baseSalary, hireMultiplier }`.
    `specialtyAxis` is `null` for the four professions without one, or the id of
    an entry in `SPECIALTY_AXES`.
  - `SPECIALTY_AXES` — object keyed by axis id. Two entries:
    `engineering` (`rf`, `vacuum`, `cooling`, `diagnostics`, `controls`) and
    `science` (`optics`, `diagnostics`, `userScience`). Each specialty carries
    `{ id, name, zoneId }`, where `zoneId` is the `ZONES` key its accent color
    and home lab come from — `null` for `userScience`, which lives at beamline
    endpoints rather than in a lab.
  - `professionDef(id)` → def or `undefined`.
  - `specialtiesFor(professionId)` → array of specialty defs, empty when the
    profession has no axis.
  - `CROSS_SPECIALTY_EFFICIENCY = 0.5` — the one crossover number from the spec.

Salary scale: keep the current four professions at their existing `staffCosts`
values (`operator` 120, `technician` 180, `scientist` 250, `engineer` 300 per
tick) so the economy does not shift under this plan. Price `machinist` at 200 and
`admin` at 150. `hireMultiplier` is 12 for every profession, matching the current
`staffHireCost` behaviour.

- [ ] **Step 1: Write the failing test**

`test/test-professions.js` asserts:
- `PROFESSIONS` has exactly six entries and every id matches its key.
- Every `primarySkill` is a member of `SKILLS`, and all five skills are the
  primary skill of at least one profession.
- Every non-null `homeZone` exists in `ZONES`.
- Every non-null `specialtyAxis` exists in `SPECIALTY_AXES`.
- Every specialty's non-null `zoneId` exists in `ZONES`.
- `specialtiesFor('engineer')` returns five entries; `specialtiesFor('operator')`
  returns an empty array.
- `professionDef('nope')` is `undefined`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-professions.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the professions table**

Author `src/data/professions.js` per the Interfaces block. Follow the shape and
comment density of `src/data/facility.js`: a scannable table, with the long
`desc` strings pulled out into a separate block below it and merged in a loop, so
the table itself stays readable. Descriptions are player-facing hiring-card copy
— match the dry institutional humour of `ZONE_DESCS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-professions.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): profession and specialty data table" -- src/data/professions.js test/test-professions.js
```

---

### Task 2: Backstories

Mechanically-loaded origins, so the hiring screen becomes a decision.

**Files:**
- Create: `src/data/backstories.js`
- Test: `test/test-backstories.js` (create)

**Interfaces:**
- Consumes: `SKILLS`, `PROFESSIONS` from Task 1.
- Produces:
  - `BACKSTORIES` — object keyed by backstory id. Each entry:
    `{ id, name, blurb, professions, skillFloor, skillCap, growthMult, salaryMult, traitAffinity }`.
    `professions` is the array of profession ids the backstory can appear on
    (`null` means any). `skillFloor` and `skillCap` are partial maps of skill id
    → 0-10 bound. `growthMult` scales skill gain. `salaryMult` scales the
    profession's `baseSalary`. `traitAffinity` is an array of trait ids made
    more likely at roll time.
  - `rollBackstory(professionId, rng)` → a backstory def, chosen uniformly from
    those eligible for that profession.
  - `applyBackstory(member, backstory)` — mutates `member.skills` to respect
    floors and caps, and returns nothing. Idempotent: applying twice is the same
    as applying once.

Author at least twelve backstories covering all six professions, at least two of
which are profession-agnostic. Include the three named in the spec — the
twelve-year national lab veteran (high `technical` floor, high `salaryMult`, low
`growthMult`), the fresh PhD (low floors, `salaryMult` well under 1, high
`growthMult`), and the ex-Navy reactor tech (morale-related trait affinity, hard
`research` cap). `blurb` is one sentence, player-facing, and appears on the bio
card.

- [ ] **Step 1: Write the failing test**

`test/test-backstories.js` asserts:
- Every backstory's `professions` entries (when non-null) exist in `PROFESSIONS`.
- Every key of every `skillFloor` and `skillCap` is a member of `SKILLS`, and
  every floor is `<=` the cap for the same skill when both are present.
- Every profession has at least one eligible backstory, checked by calling
  `rollBackstory` for each of the six with a fixed seeded rng.
- `applyBackstory` raises a skill below its floor up to the floor, lowers a skill
  above its cap down to the cap, and leaves an in-range skill untouched.
- `applyBackstory` is idempotent — apply twice, compare to applying once.
- Every skill stays within 0-10 after `applyBackstory`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-backstories.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the backstories table**

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-backstories.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): mechanically-loaded backstories" -- src/data/backstories.js test/test-backstories.js
```

---

### Task 3: StaffMember gains professions, specialties, and career stats

**Files:**
- Modify: `src/game/staff/StaffMember.js` (whole file — the primary-skill map at
  `:41` and `:71` is duplicated and both copies die here)
- Modify: `src/game/staff/staffSystem.js` (`createStaffMember`,
  `tickStaffMember`'s primary-skill lookup at `:32`, `deriveStaffCounts`,
  `staffHireCost`)
- Test: `test/test-staff-member.js` (create)

**Interfaces:**
- Consumes: Task 1 and Task 2 exports.
- Produces:
  - `StaffMember` fields: `profession` (replaces `role`), `specialty` (string or
    `null`), `backstoryId`, `skills` (now five keys including `admin`),
    `stats` — a counter bag `{ ticksWorked, breakdowns, repairs, beamHours, sparesMade, analyses, commissions }`,
    all integers starting at 0. `ticksWorked` and `breakdowns` move into `stats`
    and come off the top level.
  - `member.firstName` / `member.lastName`, with `name` a derived getter — full
    first names, not initials.
  - `member.primarySkill` getter → the profession's `primarySkill`.
  - `member.efficiency(zoneTier, jobSpecialty = null)` — unchanged formula, plus:
    multiply by `CROSS_SPECIALTY_EFFICIENCY` when `jobSpecialty` is non-null,
    the member has a specialty, and they differ.
  - `createStaffMember(profession, id, tick, rng, specialty = null)` — rolls a
    specialty from the profession's axis when one exists and none is passed,
    rolls and applies a backstory, and seeds `history` with the hire event.
  - `deriveStaffCounts(members)` → object keyed by **profession id** (singular),
    with a zero entry for every profession, replacing the old plural keys.
  - `staffHireCost(member, costs)` — takes the **StaffMember**, not a profession
    id. Candidates are `StaffMember` instances, so the member carries both
    `profession` and `backstoryId`. Returns
    `costs[member.profession] * PROFESSIONS[member.profession].hireMultiplier *
    BACKSTORIES[member.backstoryId].salaryMult`, rounded.

    A profession-only signature cannot express a backstory's salary expectation,
    and the spec makes backstory mechanically loaded on salary precisely so a
    twelve-year veteran costs more than a fresh PhD — that is what makes the
    hiring screen a decision rather than a button. Callers to update:
    `Game.hireStaffMember` and `HiringDialog.js:27,40`.

Name pools: extend `FIRST` from initials to at least 40 full first names and
`LAST` to at least 40 surnames, keeping the existing entries. Draw both from a
wide range of origins, as the current surname list already does.

- [ ] **Step 1: Write the failing test**

`test/test-staff-member.js` asserts:
- A member created for each of the six professions has that `profession`, a
  `specialty` that is non-null exactly for `engineer` and `scientist`, and five
  skill keys.
- `name` reads as two words, neither of which is a single letter followed by a
  period.
- `primarySkill` matches the profession table.
- `efficiency` returns the same value for a matching specialty and `null`, and
  exactly half for a mismatched one.
- `stats` starts as all-zero integers, and `ticksWorked`/`breakdowns` are absent
  from the top level.
- `deriveStaffCounts` on a mixed roster returns all six profession keys, with
  zeros for absent professions.
- `toJSON` → `fromJSON` round-trips `profession`, `specialty`, `backstoryId`,
  `stats`, and `firstName`/`lastName` exactly.
- Two members created with the same seeded rng are identical; with different
  seeds, they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-member.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Delete both copies of the inline `{ operator: 'operating', ... }` map — the
profession table is the only source now. Keep `updateMood`, the needs loop, and
the trait effects arithmetically identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-staff-member.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): professions, specialties, and career stats on StaffMember" -- src/game/staff/StaffMember.js src/game/staff/staffSystem.js test/test-staff-member.js
```

---

### Task 4: Sweep `role` → `profession` across the codebase

The mechanical half of the rename. Behaviour must not move.

**Files:**
- Modify: `src/game/Game.js` — `_ensureStaffSeed` `:461`, `_refreshStaffCandidates`
  `:473`, the needs loop `:3689-3702`, `_autoRepair` `:4024-4031`, the science
  multiplier `:3912`, `hireStaffMember` `:4065`, `fireStaffMember` `:4084`,
  `hireStaff`/`fireStaff` `:4107-4131`, and `state.staff`/`state.staffCosts`
  init at `:232`
- Modify: `src/game/utility-gate.js:240-266` — `_unstaffedMessage`,
  `_hasActiveOperator`
- Modify: `src/game/agent/observation.js`, `src/game/research.js` — any
  plural-keyed staff count reads
- Modify: `src/ui/HiringDialog.js`, `src/ui/StaffInspector.js`, `src/ui/hud.js`,
  `src/ui/EconomyWindow.js`, `src/ui/ScenarioEditor.js`
- Modify: `src/renderer3d/StaffPawns.js:159`, `src/renderer3d/builders/staff-builder.js`
  `roles` blocks at `:215` and `:247`
- Test: `test/test-staff-rename-sweep.js` (create)

**Interfaces:**
- Consumes: Task 3's `StaffMember` and `deriveStaffCounts`.
- Produces: `state.staff` keyed by profession id; `state.staffCosts` keyed by
  profession id, seeded from `PROFESSIONS[id].baseSalary`.

`staff-builder.js` needs entries for the two new professions. Give `machinist`
and `admin` placeholder colors sampled from the same RCT2 buckets the four
existing ones use — Plan 4 replaces the whole block with outfits, so do not
invest here beyond making a machinist visually distinct from an engineer.

`hireStaff(type)` / `fireStaff(type)` currently do string surgery on plurals
(`type.slice(0, -1) === 'operato'`). Delete that; they take a profession id now.

- [ ] **Step 1: Write the failing test**

`test/test-staff-rename-sweep.js` asserts:
- A fresh `Game` seeds exactly one staff member, whose `profession` is
  `'operator'`.
- `state.staff` has all six profession keys and none of the old plural keys.
- `state.staffCosts` has all six profession keys, and the four pre-existing
  professions still carry their original values (120/180/250/300).
- Hiring each of the six professions through `hireStaffMember` succeeds given
  sufficient funding and bumps the right count.
- `serialize()` → `deserialize()` round-trips the roster with professions and
  specialties intact.
- Grep guard, **narrowly scoped**: no source file contains a *staff* `role`
  read — search for the regex
  `(\bm|\bs|\bc|member|cand|staff)\.role\b` and for
  `\.role\s*===\s*'(operator|technician|scientist|engineer)'`, and assert zero
  hits.

  **Do not** grep for a bare `\.role\b`. `def.role` is used extensively and
  legitimately throughout the beamline code for component roles — `'junction'`,
  `'placement'`, `'source'`, `'sink'` — in `InputHandler.js`,
  `beamline-tool.js`, `utility-run-wiring.js`, `hud.js`, `WikiWindow.js`, and
  `BeamlineInputController.js`. Those are unrelated to staff and **must not be
  renamed**. Touching them is a task failure.
- Grep guard: the plural keys `operators:`, `technicians:`, `scientists:`,
  `engineers:` appear nowhere in `src/` outside a comment. (They currently
  appear in exactly three places, all of which this task rewrites:
  `staffSystem.js:78`, `Game.js:232`, `Game.js:233`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-rename-sweep.js`
Expected: FAIL.

- [ ] **Step 3: Implement the sweep**

Preserve every formula. `_autoRepair`'s legacy fallback
(`repairRate = technicians * 2` when no pawns) and the `1 + scientists * 0.1`
science multiplier both stay — Plan 3 removes them.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. Fix any test that referenced `role` or plural count keys.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(staff): rename role to profession across sim, UI, and renderer" -- <the files you actually changed>
```

---

### Task 5: The `spares` resource

**Files:**
- Modify: `src/game/Game.js:213` — `resources` init
- Modify: `src/ui/hud.js` — the resource readout
- Modify: `src/ui/format.js` if a formatter is needed
- Test: `test/test-spares-resource.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `state.resources.spares` — integer, starts at 50 so a fresh facility
  can absorb a few repairs before a machine shop exists. Serialized like
  `funding`, `reputation`, and `data`.

Nothing produces or consumes spares in this plan; Plan 3 wires both ends. The
HUD shows it alongside the other resources so the number is visible before it
matters.

- [ ] **Step 1: Write the failing test**

`test/test-spares-resource.js` asserts a fresh game starts with
`resources.spares === 50`, and that `serialize()` → `deserialize()` round-trips a
modified value.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-spares-resource.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-spares-resource.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(economy): spares resource" -- src/game/Game.js src/ui/hud.js test/test-spares-resource.js
```

---

### Task 6: Bio cards in hiring and inspector

The payoff for Tasks 1-3: the player reads people, not stat blocks.

**Files:**
- Modify: `src/ui/HiringDialog.js` (96 lines — candidate cards)
- Modify: `src/ui/StaffInspector.js` (208 lines — the detail panel)
- Create: `src/ui/StaffBioCard.js` — shared card renderer, so the two callers
  cannot drift
- Test: `test/test-staff-bio-card.js` (create)

**Interfaces:**
- Consumes: `PROFESSIONS`, `SPECIALTY_AXES`, `BACKSTORIES`, and the `StaffMember`
  fields from Task 3.
- Produces:
  - `renderBioCard(member, opts)` → an `HTMLElement`. `opts.compact` for the
    hiring list, full for the inspector.
  - `formatCareer(member)` → array of `{ label, value }` rows derived from
    `member.stats`, omitting zero-valued counters so a new hire's card is short
    and a veteran's is long.

The card shows: full name, profession and specialty (with the specialty's zone
accent color as a swatch), backstory name and blurb, traits with their existing
`traitDesc` text, the five skills, and the career rows. The portrait slot is
rendered as an empty placeholder element with a stable class name — Plan 4 fills
it with a live head render.

Follow the existing pixel-UI idiom in these two files; do not introduce a new
visual language.

- [ ] **Step 1: Write the failing test**

`test/test-staff-bio-card.js` asserts, against a constructed `StaffMember`
without a DOM-heavy harness (use the same lightweight DOM approach the repo's
existing UI tests use; if there is none, assert on `formatCareer` only and cover
`renderBioCard` in the browser suite):
- `formatCareer` omits zero counters and includes non-zero ones.
- `formatCareer` on an all-zero `stats` returns an empty array.
- A card for an engineer includes the specialty name; a card for an operator
  does not include a specialty row at all.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-bio-card.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `node test/test-staff-bio-card.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): staff bio cards in hiring and inspector" -- src/ui/StaffBioCard.js src/ui/HiringDialog.js src/ui/StaffInspector.js test/test-staff-bio-card.js
```

---

## Done when

`npm test` passes, the game runs, six professions are hireable with readable bio
cards, `spares` shows in the HUD, and the game plays exactly as it did before.
