# Staff Professions — Plan 4: Presentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a room's staffing by squinting at it — six professions
distinguishable by silhouette, faces that show how people feel, and a crowd that
does not look cloned.

**Architecture:** The `look` object grows from a flat color bag into an outfit
spec — torso layer, headwear, carried prop, specialty accent — resolved from the
profession table and seeded per staff id. Faces gain brows, a mouth curve, a
nose, and eyewear, all as geometry dabs driven by the `mood` the sim already
computes. Poses gain the fidgets and working motions that make a stationary
crowd look alive. Everything stays in the style config so the foundry can render
it, and everything stays in the module-level geometry cache so a 25-person crowd
still shares a handful of geometries.

**Tech Stack:** Three.js (CDN global — never import it), vanilla ES modules,
Playwright for browser tests, `staff-foundry.html` as the iteration surface.

**Spec:** `docs/superpowers/specs/2026-08-13-staff-professions-and-work-design.md`

**Depends on:** Plans 1-3 complete. Plan 2 Task 5 supplied the knee joint and
`applyPose`; this plan builds on that skeleton.

## Global Constraints

- **Pre-release, single-user: ignore save compatibility.** Old saves may break.
- **Commit your own task's files, and only those.** Use
  `git commit -m "msg" -- path/one.js path/two.js` naming exactly the files you
  wrote — **never** `git add`, never a bare commit, never `git commit -a`.
  Multiple sessions share this checkout and the index is shared state. Never
  include a file you did not write; if one appears in your commit, say so in
  your report.
- **Don't start or kill a dev server.** The user keeps one running.
- **Three.js is a CDN global.** Do not add an import to any renderer file.
- **Geometry dabs, never textures.** A face, a badge, a hat band is a few tiny
  boxes. A texture smears at 30px where a dab holds its silhouette. This is the
  builder's existing documented convention — do not break it.
- **Nothing visual is hardcoded outside the style config or its palette.** The
  whole point of the config is that approving a variant is a one-line change.
  `StaffPawns` must keep reading everything through `staffPalette()`.
- **Cache discipline.** Geometries and materials are module-level, keyed on their
  own dimensions and colors, per the `_partMatCache` idiom.
  `disposeStaffFigure` only detaches — it must never dispose a shared geometry.
- **Face detail stays expression-bearing, not realism-bearing.** Brows, mouth,
  eyewear. No nostrils, ears, or teeth. The existing code comment asks whether a
  face reads "charming or creepy" at this scale; err toward charming.
- New tests are `test/*.js`; browser specs live under `test/browser/`.
- **Test the builder headlessly, not in a browser.** `test/test-staff-builder.js`
  already carries a full THREE stub (`Obj3D`, `Vec3`, geometry-dimension
  recording) and already guards figure origin, shadow flags, and role tells.
  Every geometry, hierarchy, rotation, and cache assertion in this plan belongs
  there. Playwright specs are **smoke only** — the foundry page renders its rows
  and logs no console errors. A browser screenshot is a slow, flaky way to
  assert a number the stub can read directly.
- **Every task must keep the pre-existing assertions in
  `test/test-staff-builder.js` green.** They guard the figure's origin-at-feet
  contract and its shadow flags; an outfit or a face that breaks them is a
  regression.

---

### Task 1: Outfits — torso layers, headwear, and props

**Files:**
- Modify: `src/renderer3d/builders/staff-builder.js` — the `StaffStyle` typedef,
  the `roles` blocks at `:215` and `:247`, and `buildStaffFigure`
- Modify: `src/renderer3d/StaffPawns.js:157-192` — `_addPawn`'s look assembly
- Modify: `staff-foundry.html` — a profession row
- Test: extend `test/test-staff-builder.js` (headless — the substantive
  assertions) and add `test/browser/staff-outfits.spec.js` (smoke only)

**Interfaces:**
- Consumes: Plan 1's `PROFESSIONS`, `SPECIALTY_AXES`, and `ZONES[id].color`.
- Produces:
  - `OUTFITS` in the builder, keyed by profession id, replacing the `roles`
    blocks: `{ torso, headwear, prop, baseColor }` where `torso` is
    `'labCoat' | 'coveralls' | 'shirtsleeves'`, `headwear` is
    `'hardHat' | 'bumpCap' | 'weldingVisor' | 'headset' | 'safetyGlasses' | 'none'`,
    and `prop` is `'clipboard' | 'tablet' | 'wrench' | 'toolBelt' | 'coffee' | 'lanyard' | 'none'`.
    Multiple props are allowed as an array.
  - `buildOutfit(group, look, style, pal)` — adds the outfit parts to an existing
    figure. Props parent to a **hand**, so they swing with the arm for free;
    `toolBelt` and `lanyard` parent to the torso.
  - `look.accent` — the specialty's zone color, or `null`.

Per the spec's table: operator gets shirtsleeves + headset; technician coveralls
+ hard hat + toolBelt + wrench; engineer labCoat + bumpCap + tablet; scientist
labCoat + safetyGlasses + clipboard; machinist coveralls + weldingVisor (worn up
on the forehead) + a hi-vis overlay; admin shirtsleeves + lanyard + coffee.

`labCoat` is the silhouette workhorse: a skirt-like extension below the torso,
slightly flared, that reads as a different outline from bare legs at distance.
Coveralls read by covering the trouser/torso split in one color. These three
must be distinguishable in a 30px silhouette test — check it in the foundry with
the camera pulled back, not just up close.

Specialty accent goes on the coat trim (a thin band at the hem) or the hat band,
in `ZONES[specialty.zoneId].color`. `userScience` has no zone and gets no accent.

- [ ] **Step 1: Write the failing test**

In `test/test-staff-builder.js`, headless:
- Each of the six professions produces a figure whose part-name set is distinct
  from all five others — this is the assertion that catches a missing or
  duplicated outfit.
- A `labCoat` figure differs in silhouette from a `coveralls` one by more than
  color: assert a measurable geometry difference (an extra part, or different
  recorded dimensions), not just a material change.
- Props parent to a hand mesh; `toolBelt` and `lanyard` parent to the torso.
- An engineer with an RF specialty carries an accent part colored
  `ZONES.rfLab.color`; a `userScience` scientist carries no accent part.
- The origin-at-feet and shadow-flag assertions that already exist still pass
  for every profession.

Then `test/browser/staff-outfits.spec.js`, smoke only: the profession row
renders six labelled figures with no console errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-builder.js`
Expected: FAIL on the new assertions, PASS on the pre-existing ones.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the test, then do the squint check**

Run: `node test/test-staff-builder.js`, then `npm test`, then
`npx playwright test test/browser/staff-outfits.spec.js`
Expected: PASS. Then open the foundry, shrink the figures to roughly in-game
size, and confirm you can tell the six apart. If you cannot, the silhouettes are
wrong and no amount of color fixes it.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): profession outfits, headwear, and carried props" -- src/renderer3d/builders/staff-builder.js src/renderer3d/StaffPawns.js staff-foundry.html test/test-staff-builder.js test/browser/staff-outfits.spec.js
```

---

### Task 2: Faces that show mood

**Files:**
- Modify: `src/renderer3d/builders/staff-builder.js:527-542` — the face block
- Modify: `src/renderer3d/StaffPawns.js` — drive expression from `member.mood`
- Modify: `staff-foundry.html` — a mood row
- Test: extend `test/test-staff-builder.js` (headless — the substantive
  assertions) and add `test/browser/staff-faces.spec.js` (smoke only)

**Interfaces:**
- Consumes: `member.mood` — `'content' | 'tired' | 'stressed' | 'inspired'`,
  already computed every tick by `StaffMember.updateMood`.
- Produces:
  - Figure record gains `leftBrow`, `rightBrow`, `mouth`, `nose`, `eyewear`.
  - `EXPRESSIONS` — keyed by mood: `{ browAngle, browRaise, mouthCurve, eyeScale }`.
    `browAngle` is signed, mirrored between the two brows so an inward-down tilt
    reads as a frown.
  - `applyExpression(figure, mood, t)` — eases toward the mood's targets using
    the same `1 - Math.exp(-dt / TAU)` idiom as the rest of the animation.
  - Style fields: `brows`, `nose` (booleans), `browScale`, `noseScale`.

The four expressions: `content` — level brows, flat mouth. `tired` — brows
lowered and flat, mouth flat, eyes scaled down vertically to read as half-lidded.
`stressed` — brows angled inward and down, mouth curved down. `inspired` — brows
raised, mouth curved up.

Mouth curve is achieved by rotating and offsetting the existing mouth dab, or by
swapping among three cached mouth geometries — not by generating geometry per
figure. Three cached geometries is fine; twenty-five per-figure ones is not.

Eyewear comes from the outfit's `headwear`: `safetyGlasses` is a thin wide box
across both eyes in a light tint with a slight transparency; `weldingVisor` is a
larger box angled up on the forehead. Both are geometry, both are cached.

- [ ] **Step 1: Write the failing test**

In `test/test-staff-builder.js`, headless:
- A figure built with `brows: true` exposes `leftBrow`/`rightBrow`, both children
  of the head, and both positioned proud of the head's `+Z` face.
- `applyExpression(figure, mood, 1)` produces four distinct `leftBrow.rotation.z`
  values across the four moods — assert all four differ pairwise, not merely that
  two do.
- Brows are **mirrored**: for `stressed`, `leftBrow.rotation.z` and
  `rightBrow.rotation.z` have opposite signs, so the angle reads as a frown
  rather than a tilt.
- `EXPRESSIONS` has exactly the four mood keys `StaffMember.updateMood` can
  produce — `content`, `tired`, `stressed`, `inspired` — and every target is a
  finite number.
- Mouth geometry comes from a bounded cache: build fifty figures across all four
  moods and assert the number of distinct mouth geometries created stays ≤ 3.
- `safetyGlasses` and `weldingVisor` add an eyewear part; `none` does not.
- The pre-existing origin and shadow assertions still pass.

Then `test/browser/staff-faces.spec.js`, smoke only: the mood row renders four
labelled heads with no console errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-builder.js`
Expected: FAIL on the new assertions, PASS on the pre-existing ones.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the test, then judge it by eye**

Run: `node test/test-staff-builder.js`, then `npm test`, then
`npx playwright test test/browser/staff-faces.spec.js`
Expected: PASS. Then look at the mood row at in-game scale. The four must be
distinguishable, and none of them may be unsettling. If a face is creepy, the
fix is less detail, not more.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): brows, nose, eyewear, and mood-driven expression" -- src/renderer3d/builders/staff-builder.js src/renderer3d/StaffPawns.js staff-foundry.html test/test-staff-builder.js test/browser/staff-faces.spec.js
```

---

### Task 3: Working poses and idle fidgets

**Files:**
- Modify: `src/renderer3d/builders/staff-builder.js` — extend `POSES`
- Modify: `src/renderer3d/StaffPawns.js:313` — `_animate`
- Test: `test/browser/staff-poses.spec.js` — extend the spec from Plan 2 Task 5

**Interfaces:**
- Consumes: Plan 2's `POSES` and `applyPose`; Plan 3's `member.job.jobType`.
- Produces:
  - Pose selection from job type: `runBeam`/`analyze`/`paperwork` → `deskWork`;
    `labWork`/`takeData`/`fabricate`/`repair`/`commission` → `benchWork`;
    `eat` → `sit`; `meet` → `sit`; `rest` → `stand`.
  - Per-pose motion overlays: `deskWork` gets a small hand jitter at a
    desk-typing frequency; `benchWork` gets one arm cycling slowly; `sit` gets an
    occasional weight shift.
  - `IDLE_FIDGETS` — occasional head turns and weight shifts on a randomised
    timer, so a stationary crowd is never frozen. Seeded per pawn so twenty-five
    staff do not fidget in unison.

Motion overlays compose on top of the pose targets rather than replacing them,
using the same additive structure the walk swing already uses over `stand`.

- [ ] **Step 1: Write the failing test**

Extend `test/browser/staff-poses.spec.js` to assert that a figure held in
`deskWork` for several frames shows a changing hand position, that a figure in
`sit` does not drift its hip angle, and that two pawns with different seeds
fidget at different times.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test test/browser/staff-poses.spec.js`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the test, then watch the game**

Run: `npx playwright test test/browser/staff-poses.spec.js` then `npm test`
Expected: PASS. In game, a control room with three seated operators should look
occupied, not like a waxwork.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): working pose overlays and idle fidgets" -- src/renderer3d/builders/staff-builder.js src/renderer3d/StaffPawns.js test/browser/staff-poses.spec.js
```

---

### Task 4: Crowd variety

**Files:**
- Modify: `src/renderer3d/builders/staff-builder.js` — palettes and the look spec
- Modify: `src/renderer3d/StaffPawns.js:157-172` — seeded look assembly
- Modify: `staff-foundry.html` — a crowd row
- Test: extend `test/test-staff-builder.js` (headless — the substantive
  assertions, including the cache guard) and add `test/browser/staff-crowd.spec.js`
  (smoke only)

**Interfaces:**
- Consumes: the existing `mulberry32(hashString(member.id))` seeding.
- Produces:
  - `look` gains `girthScale`, `glasses`, `beard`, `backpack`, and keeps
    `heightScale` with its range widened from ±4% to ±8%.
  - `STAFF_PALETTES.rct2` skins and hairs each extend to at least eight entries,
    sampled in the same spirit as the existing set rather than invented — the
    file's comment is explicit that these values were read out of the real
    sprite sheets, so extend by interpolating within that ramp, not by picking
    new hues.

Everything stays keyed through the module-level cache. A `girthScale` that
produces a unique geometry per staffer defeats the cache — quantise it to a small
number of buckets (three is enough) so the crowd shares geometry.

- [ ] **Step 1: Write the failing test**

In `test/test-staff-builder.js`, headless — the THREE stub records every
geometry construction, which makes the cache guard a direct count rather than an
inference:
- Twenty-five figures built from distinct seeded ids yield at least twelve
  distinct `heightScale` values, at least four distinct skin colors, and exactly
  three distinct girth buckets.
- **The cache guard, the most important assertion in this task:** building those
  twenty-five figures creates no more distinct geometries than building three
  does, plus a small fixed allowance for the girth buckets. A `girthScale`
  applied as a unique geometry per staffer would balloon this count — that is
  precisely the regression this catches.
- `disposeStaffFigure` on all twenty-five disposes zero shared geometries.
- Skins and hairs each have at least eight entries in `STAFF_PALETTES.rct2`.

Then `test/browser/staff-crowd.spec.js`, smoke only: the crowd row renders with
no console errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-builder.js`
Expected: FAIL on the new assertions, PASS on the pre-existing ones.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the test, then check frame time**

Run: `node test/test-staff-builder.js`, then `npm test`, then
`npx playwright test test/browser/staff-crowd.spec.js`
Expected: PASS. Confirm a 25-pawn facility has not lost frame rate.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): crowd variety with shared geometry" -- src/renderer3d/builders/staff-builder.js src/renderer3d/StaffPawns.js staff-foundry.html test/test-staff-builder.js test/browser/staff-crowd.spec.js
```

---

### Task 5: Live portraits on bio cards

The payoff loop: face work shows up where you can actually see it.

**Files:**
- Create: `src/ui/StaffPortrait.js`
- Modify: `src/ui/StaffBioCard.js` — fill the placeholder slot from Plan 1 Task 6
- Test: `test/browser/staff-portrait.spec.js` (create)

**Interfaces:**
- Consumes: `buildStaffFigure`, `applyExpression`, the member's seeded look.
- Produces:
  - `renderPortrait(member, size)` → an `HTMLCanvasElement` showing that
    staffer's own head and shoulders, with their seeded face, outfit collar, and
    current mood expression.
  - `disposePortrait(canvas)` — tears down the renderer.

Use **one** shared offscreen `WebGLRenderer` and scene for all portraits, drawing
each on demand and copying the result into a 2D canvas — not one WebGL context
per card. Browsers cap live WebGL contexts at around sixteen, and a roster panel
would blow straight through that.

Light the portrait with the same rig the foundry uses so a face does not change
character between the world and the panel.

Portraits refresh when mood changes, not every frame. A bio card is not an
animation.

- [ ] **Step 1: Write the failing test**

`test/browser/staff-portrait.spec.js` asserts: opening the inspector for a
staffer renders a non-blank portrait canvas; two staff with different ids produce
visibly different portraits (compare pixel data); opening and closing twenty
cards does not increase the WebGL context count; and changing a member's mood
changes their portrait.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test test/browser/staff-portrait.spec.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the test, then the whole suite**

Run: `npx playwright test test/browser/staff-portrait.spec.js` then `npm test`
and `npm run test:browser`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): live staff portraits on bio cards" -- src/ui/StaffPortrait.js src/ui/StaffBioCard.js test/browser/staff-portrait.spec.js
```

---

## Done when

You can look at a facility and tell, without clicking anything, which room is
staffed by whom and whether those people are having a good day — and the bio card
shows you the same face at a size where you can read it.
