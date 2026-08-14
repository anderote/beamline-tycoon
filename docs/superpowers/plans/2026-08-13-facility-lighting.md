# Facility Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nine placeable light fixtures across four mount types that visibly
illuminate a facility at night and draw power for it.

**Architecture:** Time of day moves from the renderer's private wall clock into
sim state, which makes night both real and testable. Night ambient then ramps
down for the first time, creating darkness for fixtures to push back. Fixtures
render illumination in two layers — cheap faked pools everywhere, plus a fixed
pool of twelve real `PointLight`s reassigned by camera proximity so that
geometry near the viewer is genuinely lit without ever changing the scene's
light count.

**Tech Stack:** Vanilla ES modules, Three.js (`MeshStandardMaterial`,
orthographic dimetric camera), Vite, node test runner (`npm test` →
`scripts/run-tests.mjs` over `test/*.js`), Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-08-13-facility-lighting-design.md`

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
- Fixtures are `kind: 'decoration'`, `category: 'lighting'`. Do **not** add a
  new `Placeable` kind.
- No shadow casting from any fixture, at any point. The sun keeps its shadow
  map; lamps never get one.
- The scene's real-light count must never change after init.
- New tests are `test/*.js`, run by `node test/<file>.js`; failure is signalled
  by a non-zero exit code (both `node:test` and hand-rolled styles exist in the
  repo — match whichever neighbouring file you are extending).

---

### Task 1: Time of day becomes sim state

Kills the renderer's private clock so "it is night" is one fact instead of two
disagreeing ones, and so tests can ask for midnight.

**Files:**
- Modify: `src/game/Game.js` — `TICK_MS` neighbourhood for the constant, the
  tick body for the advance, `:3649` for the `isNight` derivation, and
  `serialize`/`deserialize`
- Modify: `src/renderer3d/ThreeRenderer.js:2963` `_updateSunCycle`, plus the
  init block at `:494` that seeds `_sunAngle` / `_sunCycleSpeed` / `_lastSunTime`
- Test: `test/test-time-of-day.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DAY_LENGTH_TICKS = 240` exported from `src/game/Game.js` — matches the
    period the sim already ran, so staff-needs pacing is unchanged.
  - `state.timeOfDay` — float in `[0, 1)`, `0` = midnight, `0.5` = noon.
  - `isNightAt(timeOfDay) -> boolean` — pure, exported from `src/game/Game.js`.
    Night is `timeOfDay < 0.25 || timeOfDay >= 0.75`, i.e. half the day,
    centred on midnight.

- [ ] **Step 1: Write the failing test**

`test/test-time-of-day.js` asserts:
- A fresh game starts with `timeOfDay` in `[0, 1)`.
- After `DAY_LENGTH_TICKS` ticks, `timeOfDay` has returned to (within float
  tolerance of) its starting value — it advances and wraps, never exceeding 1.
- `isNightAt` is `true` at `0.0`, `false` at `0.5`, and flips exactly at the
  `0.25` / `0.75` boundaries.
- `serialize()` → `deserialize()` round-trips `timeOfDay` exactly.

- [ ] **Step 2: Run it and confirm it fails**

Run `node test/test-time-of-day.js`. Expect failure on `timeOfDay` /
`isNightAt` being undefined.

- [ ] **Step 3: Implement**

Add the constant and the state field; advance `timeOfDay` by
`1 / DAY_LENGTH_TICKS` once per tick, wrapping with `% 1`. Replace the
`(this.state.tick % 240) >= 120` expression at `Game.js:3649` with
`isNightAt(this.state.timeOfDay)` — leave every consumer of the `isNight`
local alone. Add `timeOfDay` to serialize/deserialize.

- [ ] **Step 4: Point the renderer at it**

`_updateSunCycle` derives its angle from `game.state.timeOfDay` instead of
accumulating `performance.now()` deltas. Map `timeOfDay` → sun angle so that
`0.5` is noon (sun highest) and `0.0` is midnight, preserving the existing
orbit radius, elevation range and camera-following shadow-texel snapping
verbatim — this task changes *where the angle comes from*, nothing about how
the sun moves or how shadows are stabilised.

Interpolate across the tick boundary so the sun glides: the renderer runs at
frame rate and the sim ticks at 1 Hz, so advance a local copy of `timeOfDay` by
elapsed frame time and re-sync it whenever the sim's value changes. Delete
`_sunAngle`, `_sunCycleSpeed` and `_lastSunTime`.

- [ ] **Step 5: Verify**

`node test/test-time-of-day.js` passes, and `npm test` shows no regression.
Then load the game and confirm the sun still moves smoothly and shadows do not
jitter or swim.

*Suggested commit boundary: Tasks 1–2 together ("one clock, and night that is
actually dark").*

---

### Task 2: Night gets dark

**Files:**
- Create: `src/renderer3d/day-night.js`
- Modify: `src/renderer3d/ThreeRenderer.js` `_updateSunCycle` (the intensity and
  colour block, currently `:3001`–`:3025`), and the light init at `:475`–`:491`
- Test: `test/test-day-night-grade.js` (create)

**Interfaces:**
- Consumes: `state.timeOfDay` (Task 1).
- Produces: `dayNightGrade(timeOfDay) -> { darkness, ambientIntensity,
  ambientColor: [r,g,b], sunIntensity, sunColor: [r,g,b], moonIntensity }`.
  Pure, no Three.js imports — that is what makes it testable.
  `darkness` is `0` at full day and `1` at deep night; **every consumer of
  "how dark is it" in later tasks reads this one value**, so fixture emissive,
  pool opacity and real-light intensity all ramp in lockstep.

Extracting this into its own module is the point of the task: the grading curve
is the thing most likely to be retuned by eye, and it should be adjustable
without touching renderer plumbing.

- [ ] **Step 1: Write the failing test**

`test/test-day-night-grade.js` asserts:
- `darkness` is `0` at noon (`0.5`) and `1` at midnight (`0.0`).
- `darkness` is monotonic from noon to midnight — sample a dozen points and
  assert non-decreasing. This is the property that guarantees no flicker or
  reversal at dusk.
- `ambientIntensity` is `1.3` at noon and `NIGHT_AMBIENT` (`0.35`) at midnight,
  and never leaves that range.
- `sunIntensity` reaches `0` at night; `moonIntensity` is `0` by day.

- [ ] **Step 2: Run it and confirm it fails**

Run `node test/test-day-night-grade.js`.

- [ ] **Step 3: Implement the grade**

Write `day-night.js` with `NIGHT_AMBIENT = 0.35` and `NIGHT_TINT` as named
top-of-module constants. Ease dusk and dawn (smoothstep over the twilight
bands) rather than switching — a linear ramp reads as a dimmer knob being
turned, which is exactly the wrong feel. Keep the existing warm-to-blue colour
shift and deepen it toward the tint constant.

- [ ] **Step 4: Apply it in the renderer**

`_updateSunCycle` calls `dayNightGrade` and assigns the results. Delete the
pinned `this._ambientLight.intensity = 1.3` at `:3008` and the inline colour
branches at `:3010`–`:3025`. Add the moon: a second low-intensity cool-blue
`DirectionalLight` created once at init beside the sun, `castShadow = false`,
driven by `moonIntensity`.

Store the frame's `darkness` on the renderer (e.g. `this._darkness`) — Tasks 5,
6 and 9 all read it.

- [ ] **Step 5: Verify**

`node test/test-day-night-grade.js` passes and `npm test` is clean. Then watch
a full day cycle in the game: dusk should ease rather than snap, and midnight
should be genuinely dark but never flat black — geometry must keep its form.
Retune the two constants by eye now; that is cheaper than doing it later.

---

### Task 3: Fixture definitions and registry

**Files:**
- Create: `src/data/placeables/lighting.js`
- Modify: `src/data/placeables/index.js` — import and spread into `ALL_DEFS`
- Modify: `src/data/decorations.raw.js:137`–`154` — remove `lamppost`,
  `bollardLight`, `spotLight` and their `:210`–`:212` description entries
- Modify: `src/data/validate.js` — validation rule for `light`-bearing defs
- Modify: `src/renderer3d/world-snapshot.js:308` — **required, see below**
- Test: `test/test-lighting-defs.js` (create); extend
  `test/test-content-validate.js`

**Required companion change (preflight ruling P1).** `buildDecorations` at
`world-snapshot.js:308` resolves defs via `DECORATIONS_RAW[d.type]` directly.
Once lighting defs live outside `DECORATIONS_RAW`, every fixture would silently
get `category: 'unknown'` and default 4×4×4 dims, breaking builder routing and
footprints. Change that lookup to the unified `PLACEABLES[d.type]` registry
(`src/data/placeables/index.js`), which is a superset of `DECORATIONS_RAW` and
already the source of truth. Verify the 24 existing decorations still resolve
identical `category`, `subW`, `subL` and `subH` values through the new lookup —
that equivalence is the thing to test, not the new fixtures.

**Interfaces:**
- Consumes: nothing.
- Produces: `LIGHTING_DEFS` — an array of def objects consumed by
  `placeables/index.js`. Every entry carries, in addition to the usual
  decoration fields (`id`, `name`, `cost`, `removeCost`, `subW/subL/subH`,
  `placement`, `blocksBuild`):

  - `kind: 'decoration'`, `category: 'lighting'`
  - `mount: 'ground' | 'wall' | 'overhead'`
  - `energyCost` — kW, a positive number
  - `light: { color, intensity, radius, shape: 'point' | 'cone', coneDeg?,
    tiltDeg?, emitterY }` where `radius` is the pool radius in world units,
    `emitterY` is the emitter's height above its mount point, and `coneDeg` /
    `tiltDeg` are required when `shape === 'cone'`.

  Every later task reads fixtures through this block and must not special-case
  individual fixture ids.

- [ ] **Step 1: Write the failing test**

`test/test-lighting-defs.js` asserts:
- All nine ids from the spec's catalogue table exist in `PLACEABLES`, with the
  `mount` values the table specifies.
- Every def with a `light` block has a valid `mount`, `energyCost > 0`,
  `light.radius > 0`, and — when `shape === 'cone'` — a `coneDeg` and `tiltDeg`.
- No id collides with an existing placeable (`placeables/index.js` throws on
  duplicates, so a bare import is the assertion).
- `DECORATIONS_RAW` no longer contains `lamppost`, `bollardLight` or
  `spotLight`, proving there is one source of truth rather than two.

Extend `test/test-content-validate.js` with a synthetic bad def — a `light`
block with no `mount`, and one with `energyCost: 0` — asserting
`validateContent` reports both.

- [ ] **Step 2: Run and confirm failure**

`node test/test-lighting-defs.js` and `node test/test-content-validate.js`.

- [ ] **Step 3: Author the nine defs**

Nine entries per the spec catalogue: `lamppost`, `doubleLamppost`,
`bollardLight`, `highMastLight`, `floodLight` (ground); `wallSconce`,
`bulkheadLight` (wall); `ceilingPanel`, `highBay` (overhead). Carry over the
existing cost, morale and footprint values for the three that already exist;
`floodLight` inherits `spotLight`'s.

Colour temperature is a deliberate axis — warm sodium outdoors, warm sconces,
cool white office panels, harsh near-white floods and high bays. Do not give
them all the same tint.

Set `energyCost` so lighting is a visible but never dominant share of facility
load, measured against a `powerPanel`'s 40 kW capacity: sconces and ceiling
panels near-free (tens of watts), lampposts and bollards small, high masts,
floods and high bays carrying the real cost. Forty fixtures should be a
noticeable line on the bill, not a crisis.

- [ ] **Step 4: Wire the registry and validator**

Spread `LIGHTING_DEFS` into `ALL_DEFS`; remove the three raw entries. Add the
validator rule. `modes.js:71` already declares a `lighting` decoration tab, so
the palette picks all nine up with no HUD change — **verify this rather than
assuming it**, and note in your report if wall/overhead fixtures need a
separate palette treatment.

- [ ] **Step 5: Verify**

`npm test` clean. Load the game, open the Lighting palette tab, confirm nine
entries with thumbnails. Ground fixtures should already be placeable (the
existing decoration path handles them); wall and overhead ones will render at
ground level and place wrongly for now — that is expected, Tasks 7 and 8 fix
it.

*Suggested commit boundary: Tasks 3–4 ("lighting catalogue and its power draw").*

---

### Task 4: Power draw

**Files:**
- Modify: `src/game/aggregates.js` — add beside `equipmentEnergyDraw` (`:56`)
  and fold into `facilityEnergyDraw` (`:75`)
- Test: `test/test-lighting-power.js` (create)

**Interfaces:**
- Consumes: `light`/`energyCost` defs (Task 3); `state.wallFixtures` (Task 7 —
  guard for its absence so this task lands standalone).
- Produces: `lightingEnergyDraw(state) -> number` (kW), summed across all three
  mounts, folded into `facilityEnergyDraw`.

Routing through `facilityEnergyDraw` is the whole design: the electricity bill
(`economy.js:181`) and the power panel's utilisation (`economy.js:546`) both
derive from it, and the code there carries an explicit warning that the bill
and the panel must never disagree. Do not add a second summation anywhere.

- [ ] **Step 1: Write the failing test**

`test/test-lighting-power.js` asserts:
- A state with no fixtures returns `0`, and `facilityEnergyDraw` is unchanged
  from its pre-existing value — the no-regression guard.
- Placing fixtures sums their `energyCost`, and the total appears in
  `facilityEnergyDraw`.
- Wall fixtures (from `state.wallFixtures`) are counted alongside tile-placed
  ones, and a state with `wallFixtures` absent or empty does not throw.
- Decorations without a `light` block contribute nothing.

- [ ] **Step 2: Run and confirm failure**

`node test/test-lighting-power.js`.

- [ ] **Step 3: Implement**

Note that `poweredPlaceables` (`aggregates.js:50`) deliberately filters to
`category === 'equipment' || 'infrastructure'` and so excludes decorations —
`lightingEnergyDraw` must do its own walk over `state.placeables` filtering on
the presence of a `light` block, plus a walk over `state.wallFixtures`. Do not
widen `poweredPlaceables`; other consumers depend on its current meaning.

- [ ] **Step 4: Verify**

`npm test` clean. In game, place several lampposts and confirm the power panel
utilisation and the electricity line in the economy panel both move, and agree
with each other.

---

### Task 5: Ground fixture geometry and flood aim

**Files:**
- Create: `src/renderer3d/lighting-builder.js`
- Modify: `src/renderer3d/decoration-builder.js:1194`–`1285` — delete
  `_lamppost`, `_bollardLight`, `_spotLight` and their `:1413`–`:1415` registry
  entries; `:428` random-yaw path must not apply to aimed fixtures
- Modify: `src/renderer3d/ThreeRenderer.js` — create the lighting group, route
  lighting-category decorations to the new builder
- Test: `test/test-flood-aim.js` (create)

**Interfaces:**
- Consumes: `LIGHTING_DEFS` (Task 3).
- Produces:
  - `buildLightFixture(def, placement) -> THREE.Group` — geometry for one
    fixture of any mount. `placement` is an opaque bag carrying `{ dir }` for
    aimed ground fixtures, `{ face }` for wall fixtures (Task 7), `{}` for
    overhead (Task 8).
  - Aimed fixtures use the **existing** `dir` field, integer `0–3`.

**Preflight ruling P2 — do not invent an aim mechanic.** An earlier draft of
this plan specified `dir` as 0–7 octants cycled by clicking a placed fixture.
That was wrong on both counts. `dir` already exists as a 0–3 quarter-turn
field, it is load-bearing in footprint occupancy (`world-snapshot.js:315`
`swap = dir===1||dir===3`, mirrored in `Placeable.footprintCells`), and
placeables are already rotated at placement time by the existing rotate key
(`InputHandler.js:1217`, `:1280`, `:2554`). Redefining it to octants would
corrupt occupancy for all 24 existing decorations.

So: floods reuse `dir` 0–3 and the existing placement-rotate gesture.
**No `InputHandler.js` change, no new click behaviour, no new state field.**
Aiming should already work end-to-end once the geometry yaws by `dir * 90°`.

- [ ] **Step 1: Write the failing test**

`test/test-flood-aim.js` asserts:
- A `floodLight` placed with each of `dir` 0–3 persists that value, and it
  survives a `serialize` → `deserialize` round trip.
- `buildLightFixture` yaws the returned group by `dir * 90°`.
- A fixture def with `shape: 'cone'` opts out of the deterministic random yaw
  ordinary decorations get (`decoration-builder.js:428`), while a `point`
  fixture may keep it — random yaw applied on top of an aim silently destroys
  the aim, and that is the bug this assertion exists to catch.

Keep this test headless: exercise the state and the returned group's rotation,
not the DOM.

- [ ] **Step 2: Run and confirm failure**

`node test/test-flood-aim.js`.

- [ ] **Step 3: Build the fixture geometry**

Port the three existing builders into `lighting-builder.js` and add six more.
Preserve the established look — the lamppost's patina-teal cast iron is
deliberate, and the new fixtures should read as the same facility's hardware,
not as a different art pass.

Every fixture keeps a glowing emitter mesh whose material is retained on the
group's `userData` so Task 6 can ramp its `emissiveIntensity` with darkness.
Tag detail-level meshes `userData.lod = 'detail'` so they drop out via the
existing LOD path at `ThreeRenderer.js:2955`.

- [ ] **Step 4: Wire aim**

Yaw aimed fixtures by `dir * 90°`. Fixtures declaring `shape: 'cone'` must opt
out of the deterministic random yaw at `decoration-builder.js:428` — otherwise
the aim is overwritten by noise and rotating at placement does nothing visible.
That opt-out is the entire change: per ruling P2, the rotate gesture already
exists and `InputHandler.js` is not touched.

- [ ] **Step 5: Verify**

`npm test` clean. In game: place one of each ground fixture, confirm they look
right at noon; press the rotate key while placing a flood and watch it turn
through four positions before you commit it.

*Suggested commit boundary: Tasks 5–6 ("fixtures that light the ground").*

---

### Task 6: Light pools and halos — illumination Layer 1

The layer that does the heavy lifting. No Three.js lights are involved.

**Files:**
- Modify: `src/renderer3d/lighting-builder.js`
- Modify: `src/renderer3d/ThreeRenderer.js` — pool group, rebuild triggers,
  per-frame opacity from `this._darkness`
- Test: `test/test-light-pools.js` (create)

**Interfaces:**
- Consumes: `dayNightGrade().darkness` (Task 2); `light` blocks (Task 3);
  `buildLightFixture` (Task 5).
- Produces: `buildLightPools(fixtures) -> THREE.Mesh` — a single merged
  additive mesh for every pool in the scene, and
  `poolFootprint(light, dir) -> { rx, rz, offsetX, offsetZ }`, pure and
  exported for testing.

- [ ] **Step 1: Write the failing test**

`test/test-light-pools.js` asserts on `poolFootprint`:
- A `point` fixture yields a circle: `rx === rz`, zero offset.
- A `cone` fixture yields an ellipse elongated along its aim, with the centre
  pushed away from the fixture — `rx !== rz` and a non-zero offset.
- Incrementing `dir` by one rotates the offset by 90°, so aim and pool actually
  agree. (`dir` is 0–3 quarter turns — see preflight ruling P2 in Task 5.)
- `radius` scales the footprint linearly.

- [ ] **Step 2: Run and confirm failure**

`node test/test-light-pools.js`.

- [ ] **Step 3: Implement pools**

An additive, radial-falloff quad per fixture, laid on the floor plane, tinted
from `light.color`. Depth-tested but **not** depth-writing, so pools never
occlude each other or the geometry standing in them. Merge all pools into one
mesh — the failure mode this design exists to avoid is sixty draw calls for
sixty lamps.

Add the halo: a soft additive billboard at the emitter, so a lamp reads as
bright from any camera angle.

- [ ] **Step 4: Wire the darkness ramp**

Pool and halo opacity, and fixture `emissiveIntensity`, all scale with
`this._darkness` so lamps visibly switch on at dusk. Rebuild pool geometry
**only** when the fixture set changes — opacity is a per-frame material
uniform, geometry is not. A per-frame rebuild here is the single most likely
performance mistake in this plan.

- [ ] **Step 5: Verify**

`npm test` clean. Then the real test, in game: place a mix of fixtures, watch a
full day cycle. Pools should fade in through dusk and hold at night, warm
against the blue ambient. Place twenty-plus fixtures and confirm the frame rate
is unaffected.

---

### Task 7: Wall fixtures

The one genuinely new placement mechanism.

**Files:**
- Modify: `src/game/Game.js` — `state.wallFixtures`, place/remove,
  serialize/deserialize, wall-demolish cascade
- Modify: `src/input/structure-tools.js` — the placement tool
- Modify: `src/input/demolishScopes.js:31`–`32`
- Modify: `src/renderer3d/world-snapshot.js` — emit wall fixtures
- Modify: `src/renderer3d/lighting-builder.js` — mount on the wall face
- Test: `test/test-wall-fixtures.js` (create)

**Interfaces:**
- Consumes: `LIGHTING_DEFS` with `mount: 'wall'` (Task 3);
  `buildLightFixture` (Task 5).
- Produces: `state.wallFixtures` — an object keyed
  `` `${col},${row},${edge}` `` where `edge` is `'n' | 'e' | 's' | 'w'`, each
  value `{ type, face }` and `face` naming which side of the wall the fixture
  hangs on. This is the same key scheme `wallOccupied` and `doorOccupied`
  already use (`src/networks/rooms.js`), so follow that module's conventions
  exactly — including its `wallKey1` / `wallKey2` double-lookup, since the same
  physical wall is addressable from either adjoining tile.

- [ ] **Step 1: Write the failing test**

`test/test-wall-fixtures.js` asserts:
- Placing on an edge that has a wall succeeds; the key matches the
  `rooms.js` scheme.
- Placing on an edge with **no** wall is rejected.
- Placing on an edge that already holds a fixture is rejected.
- Placing on an edge that holds a **door** is allowed — a door does not
  exclude a light.
- The same physical wall addressed from the neighbouring tile
  (`col,row,'n'` vs `col,row-1,'s'`) resolves to the same edge and is
  correctly rejected as a duplicate. This is the bug this scheme invites.
- Demolishing the wall removes its fixtures.
- `wallFixtures` round-trips through serialize/deserialize.

- [ ] **Step 2: Run and confirm failure**

`node test/test-wall-fixtures.js`.

- [ ] **Step 3: Implement state and placement**

Add the store and its place/remove/cascade logic. Wall fixtures are **not** in
`state.placeables`, so demolish scoping, save/load and the world snapshot each
need an explicit branch — the plan touches all three deliberately.

- [ ] **Step 4: Implement the tool and rendering**

Reuse the edge-snapping already implemented for walls and doors in
`structure-tools.js`. Which face the fixture mounts on comes from which side of
the wall the cursor is on at placement — that is what lets one wall light a
corridor or a facade. Render offset from that face at `light.emitterY`, facing
outward from it.

- [ ] **Step 5: Verify**

`npm test` clean. In game: build a room, mount sconces inside and bulkheads on
the exterior face of the same wall, check they hang on the correct sides at the
right height, then demolish the wall and confirm they vanish with it.

*Suggested commit boundary: Tasks 7–8 ("wall and overhead mounts").*

---

### Task 8: Overhead fixtures

**Files:**
- Modify: `src/game/Game.js` — placement validation for `mount: 'overhead'`
- Modify: `src/renderer3d/lighting-builder.js` — hang at wall height
- Modify: `src/renderer3d/world-snapshot.js` — carry `mount` through
- Test: `test/test-overhead-fixtures.js` (create)

**Interfaces:**
- Consumes: `LIGHTING_DEFS` with `mount: 'overhead'` (Task 3).
- Produces: no new state — overhead fixtures are ordinary tile-placed
  decorations in `state.placeables`, distinguished only by `mount`.

- [ ] **Step 1: Write the failing test**

`test/test-overhead-fixtures.js` asserts:
- Placement on a tile with flooring succeeds.
- Placement on bare terrain is rejected.
- A sealed room is **not** required — placing on a floored tile with no walls
  around it succeeds. This is a deliberate design decision (see spec §6) and
  the test exists to stop someone "fixing" it into a room requirement.
- An overhead fixture does not block a tile-placed furnishing beneath it.

- [ ] **Step 2: Run and confirm failure**

`node test/test-overhead-fixtures.js`.

- [ ] **Step 3: Implement**

Validation requires flooring on the tile, nothing more. Do not call
`detectRooms` — it is not free, and requiring a sealed room would make the
fixture unplaceable in exactly the half-built spaces where a player wants to
see progress.

- [ ] **Step 4: Hang the geometry**

Render at wall height — `DEFAULT_WALL_HEIGHT` from
`src/renderer3d/wall-builder.js:12`, imported rather than re-derived — on a
short stem or chain. Against surrounding wall tops that reads as
ceiling-mounted, which is all it has to do. Fixtures must not block build.

- [ ] **Step 5: Verify**

`npm test` clean. In game: floor a room, place ceiling panels and a high bay,
confirm they hang level with the wall tops and read as mounted rather than
floating, and that the pool lands on the floor beneath.

---

### Task 9: Real light pool — illumination Layer 2, and the visual regression test

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` — allocate the light array at init,
  reassign per frame
- Create: `src/renderer3d/light-assignment.js`
- Test: `test/test-light-assignment.js` (create);
  `test/browser/lighting-night.spec.mjs` (create)

**Interfaces:**
- Consumes: fixture positions and `light` blocks (Tasks 3, 5); `darkness`
  (Task 2).
- Produces: `assignLights(fixtures, cameraCenter, slotCount) -> Array<fixture |
  null>` of exactly `slotCount` entries — pure, so the selection rule is
  testable without a GPU.

- [ ] **Step 1: Write the failing test**

`test/test-light-assignment.js` asserts:
- Returns exactly `slotCount` entries always — padded with `null` when there
  are fewer fixtures than slots. **This is the load-bearing assertion**: a
  varying light count triggers Three.js shader recompiles, which is the
  performance failure this whole design exists to avoid.
- The nearest fixtures to `cameraCenter` win.
- The result is stable under a tiny camera nudge — an unchanged fixture set and
  a barely-moved camera must not reshuffle slots, or lights will pop every
  frame.

- [ ] **Step 2: Run and confirm failure**

`node test/test-light-assignment.js`.

- [ ] **Step 3: Implement**

Allocate exactly 12 `PointLight`s once at scene init, `castShadow = false`,
`intensity = 0`. Never add or remove one thereafter. Each frame (or every N
frames — measure before deciding), call `assignLights` and move each light to
its assigned fixture's emitter, lerping intensity toward the fixture's
`light.intensity × darkness`, and toward `0` for unassigned slots. Lerping is
what makes reassignment invisible.

- [ ] **Step 4: Add the browser regression test**

`test/browser/lighting-night.spec.mjs`: force `timeOfDay` to midnight (Task 1
made this settable), place fixtures, screenshot. This is the guard against
"night went bright again" and "pools stopped drawing" — both silent failures
that no unit test catches. Follow the conventions in
`test/browser/README-coverage.md`.

Run with `npm run test:browser`. This starts its own server via
`playwright.config.mjs`; do not start or kill a dev server yourself.

- [ ] **Step 5: Verify**

`npm test` and `npm run test:browser` both clean. Then judge it by eye at
night: fixtures near the camera should light walls, equipment and staff pawns,
and panning across a lit facility must not pop or stutter. If it does, raise
the lerp duration before raising the slot count.

---

## Self-Review

**Spec coverage.** §1 clock → Task 1. §2 night darkening → Task 2. §3 Layer 1 →
Task 6, Layer 2 → Task 9. §4 catalogue → Task 3. §5 data shape and registry →
Task 3. §6 ground placement → Task 5, flood aim → Task 5, wall → Task 7,
overhead → Task 8. §7 power → Task 4. §8 performance budget → constraints in
Tasks 6 and 9 (merged pools, fixed light count, LOD tagging in Task 5). §9
files → covered across tasks; `hud.js` is verified-not-modified in Task 3 Step
4, since `modes.js:71` already declares the tab. §10 testing → each task's
tests, plus the Playwright night shot in Task 9. Deferred gameplay effects →
correctly absent, by design.

**Naming consistency.** `darkness` is produced by `dayNightGrade` (Task 2) and
consumed under that name in Tasks 6 and 9. `light.radius` feeds `poolFootprint`
(Task 6). `dir` is written in Task 5 and read by `poolFootprint` in Task 6.
`mount` is set in Task 3 and branched on in Tasks 5, 7 and 8. `buildLightFixture`
is defined in Task 5 and consumed in Tasks 7 and 8.

**Sequencing risk.** Task 4 sums `state.wallFixtures`, which Task 7 creates.
Task 4 explicitly guards for its absence so it lands standalone, and Task 7's
test re-checks the total. This is the only forward reference in the plan.
