# Entities: Deer Wildlife Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic Entity subsystem to Beamline Tycoon, with deer as the first concrete type — herds of 3–5 deer wandering the map with boids-lite flocking, grazing on grass, and fleeing with a bounding prance when startled by construction or by cursor dwell.

**Architecture:** A new `src/game/entities/` module owns sim-tick AI (1 Hz), with pure-math steering forces unit-tested against fake world samplers. A new `src/renderer3d/entity-renderer.js` owns per-frame mesh animation, consuming a low-poly deer mesh built by `src/renderer3d/builders/deer-builder.js`. Entities are plain data on `Game.state.entities` / `Game.state.herds`, serialized normally. No changes to placement, utility, or beamline systems — entities only read from terrain and placeable occupancy.

**Tech Stack:** Three.js (CDN global, not imported), Node's built-in `node:test` runner, procedural texture helpers in `src/renderer3d/materials/tiled.js`.

**Design spec:** `docs/superpowers/specs/2026-04-18-entities-deer-wildlife-design.md`.

---

## Conventions used throughout this plan

- **Test runner:** tests use `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`. Run tests with `node test/path/to/test-file.js`. No `describe()` wrappers — plain `test(name, fn)` blocks.
- **THREE.js** is a CDN global on `window.THREE`; renderer files use it without import, matching existing builders (e.g. `src/renderer3d/grass-tuft-builder.js`).
- **World coords vs grid:** entities use continuous world coords. A "tile" is 2 world units; a "subtile" is 0.5 world units. Conversions follow the pattern in `src/input/InputHandler.js:2775–2779`.
- **Ground-type lookup at (x, z):** `const col = Math.floor(x / 2), row = Math.floor(z / 2)`; then read `state.floors[row]?.[col]?.type` (floor tile type) — falls back to `state.infraOccupied[col+','+row]` if present. Grass kinds are `{'grass', 'wildgrass', 'tallgrass'}` per `src/renderer3d/world-snapshot.js:117`.
- **Height lookup at (x, z):** `sampleSurfaceYAt(state, x, z)` from `src/game/terrain.js:158`.
- **Commit boundaries:** follow `CLAUDE.md` — group commits at logical boundaries, not per task. Suggested commit points are marked at the end of each phase, not each task.

---

## File Structure

**New files:**
```
src/data/
  entities.raw.js                 — per-species data (deer tunings: AI, mesh, animation)
  entities.js                     — thin consumer shim exporting ENTITIES lookup
src/game/entities/
  index.js                        — tick orchestrator, plugs into Game.tick()
  steering.js                     — pure boids + seek/avoid math (unit-testable)
  herd.js                         — herd state machine, startle logic
  spawner.js                      — edge wildness scoring, spawn/despawn
src/renderer3d/
  entity-renderer.js              — per-entity mesh pool, per-frame transforms + gait
  builders/
    deer-builder.js               — low-poly deer mesh + procedural coat
test/
  test-entities-steering.js       — pure-math force tests
  test-entities-herd.js           — herd + per-entity state machine tests
  test-entities-spawner.js        — edge-wildness scoring + spawn position tests
```

**Modified files:**
- `src/game/Game.js` — add `entities: []` and `herds: []` to `state`; call `entitiesTick(this)` in `tick()`; include `entities`/`herds` in `save()`/`load()`; bump save version to `7`.
- `src/input/InputHandler.js` — add cursor world position tracking (continuous, updated on mousemove).
- `src/renderer3d/ThreeRenderer.js` — construct `EntityRenderer` at init; call `entityRenderer.update(dt, state)` per frame in `_animate()`.
- `src/game/terrain.js` — add `sampleGroundTypeAt(state, x, z)` helper (small addition).

---

## Phase 1: Species data

### Task 1: Create deer species data + consumer shim

**Files:**
- Create: `src/data/entities.raw.js`
- Create: `src/data/entities.js`

**Purpose:** Define all tunable deer parameters in one place so downstream tasks can import them. Mirrors `src/data/decorations.raw.js` convention (named const export of id-keyed plain objects).

- [ ] **Step 1:** Create `src/data/entities.raw.js` exporting `ENTITIES_RAW = { deer: { ... } }`. The `deer` entry contains every field listed in the spec's "Per-species data" section. Use these starter values (all tunable later):

  - Sim / AI: `walkSpeed: 1.2`, `fleeSpeed: 4.0`, `minSpacing: 1.0`, `herdCohesionRadius: 4.0`, `wanderJitterStrength: 0.15`, `terrainBiasStrength: 0.3`, `labAversionRadius: 3.0`, `spookRadius: 6.0`, `cursorSpookRadius: 4.0`, `cursorSpookDwell: 0.5`, `grazeChance: 0.02`, `grazeDurationRange: [3, 8]`, `maxSteepness: 1.0`
  - Rendering: `bodyLength: 1.2`, `bodyHeight: 0.8`, `legHeight: 0.8`, `coatColors: { base: '#8b6b3a', belly: '#c7a574', tail: '#f5efe3' }`
  - Animation: `walkFrequency: 1.5`, `pranceFrequency: 2.5`, `walkLegAmplitude: 0.5`, `pranceLegAmplitude: 1.1`, `pranceBodyBobAmplitude: 0.25`, `gaitCrossfadeDuration: 0.2`

- [ ] **Step 2:** Create `src/data/entities.js` that imports `ENTITIES_RAW`, adds any derived/defaulted fields (none needed for v1), and exports both `ENTITIES` (same shape) and a `getEntityType(id)` helper that throws on unknown id.

- [ ] **Step 3:** No tests in this phase — data file with no logic.

**Acceptance:** `node -e "import('./src/data/entities.js').then(m => console.log(m.ENTITIES.deer.walkSpeed))"` prints `1.2`.

---

## Phase 2: Pure steering math (TDD)

All forces in `src/game/entities/steering.js` are pure functions of `(entity, herd, neighbors, worldSampler, species)` returning a `{x, z}` vector. `worldSampler` is a small interface the tests can fake: `{ sampleHeight(x, z), sampleGroundType(x, z), isOccupied(x, z) }`.

### Task 2: Core flocking forces

**Files:**
- Create: `src/game/entities/steering.js`
- Create: `test/test-entities-steering.js`

- [ ] **Step 1:** Write failing tests in `test/test-entities-steering.js` for three pure functions:
  - `separate(entity, neighbors, species)` returns zero vector when neighbors ≥ `minSpacing` away; returns a vector pointing away from a single neighbor when closer than `minSpacing`; scales up as distance decreases.
  - `seekHerdCenter(entity, herd, species)` returns zero when entity is inside `herdCohesionRadius` of `herd.center`; returns a vector pointing toward `herd.center` when outside, magnitude growing with distance.
  - `align(entity, neighbors)` returns a vector whose direction matches the mean neighbor velocity, magnitude proportional to the delta vs entity's own velocity. Returns zero with no neighbors.
- [ ] **Step 2:** Run `node test/test-entities-steering.js`; expect FAIL (module not found or functions undefined).
- [ ] **Step 3:** Implement the three functions in `steering.js`. All arithmetic uses plain `{x, z}` vector math; no external deps. Export each function individually.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** All three tests pass; functions are pure (same inputs → same outputs, no state).

### Task 3: Wander and bias forces

**Files:**
- Modify: `src/game/entities/steering.js`
- Modify: `test/test-entities-steering.js`

- [ ] **Step 1:** Add failing tests:
  - `wanderJitter(entity, species, rng)` returns a vector with magnitude ≤ `wanderJitterStrength`; uses the injected `rng` function so tests are deterministic.
  - `terrainBias(entity, species, worldSampler)` with a fake sampler that reports `grass` to the north and `concrete` to the south returns a vector biased northward. With uniform grass around, returns near-zero magnitude.
  - `labAversion(entity, species, worldSampler)` with a fake sampler reporting an occupied cell to the east returns a vector pointing west.
  - `seekExit(entity, herd, species)` returns a unit-magnitude-ish vector toward `herd.exitTarget` scaled by `fleeSpeed`.
- [ ] **Step 2:** Run tests; expect FAIL.
- [ ] **Step 3:** Implement the four functions. For `terrainBias`, sample 4 points at `entity.pos ± [1, 0]` and `± [0, 1]` (one tile ahead in each cardinal direction) and bias toward whichever has the "softest" ground type (use a lookup table: `grass: 1.0, wildgrass: 1.0, tallgrass: 0.9, dirt: 0.5, concrete: 0.0`, unknown: 0.5). Vector is the weighted average of the four cardinal directions using `softness - 0.5` as signed weight, scaled by `terrainBiasStrength`. For `labAversion`, sample `entity.pos + heading * lookAhead` and any occupancy within `labAversionRadius` tiles; repulsion magnitude falls off linearly with distance.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** All new tests pass; worldSampler is a clean injection point (no hidden globals read).

### Task 4: Obstacle avoidance + force summation

**Files:**
- Modify: `src/game/entities/steering.js`
- Modify: `test/test-entities-steering.js`

- [ ] **Step 1:** Add failing tests:
  - `avoidObstacles(entity, species, worldSampler)` with a fake sampler that reports occupied at `entity.pos + vel * lookAheadSec` returns a perpendicular vector (perpendicular to `entity.vel`, sign chosen toward the side with a free space). With no obstacle, returns zero.
  - `avoidObstacles` with a fake sampler that reports a height delta > `maxSteepness` between current and look-ahead position also returns a perpendicular avoidance vector.
  - `sumForces(entity, herd, neighbors, worldSampler, species, weights)` sums forces weighted by the provided `weights` object and clamps final magnitude to `species.walkSpeed` in calm states or `species.fleeSpeed` in flee. Test with a known force set and known weights.
- [ ] **Step 2:** Run tests; expect FAIL.
- [ ] **Step 3:** Implement `avoidObstacles` (probe one lookAhead point forward; lateral probes for side selection). Implement `sumForces` that takes a `weights: { seekHerdCenter, separate, align, ... }` object and dispatches to each force function. Use the per-state weight tables from the spec (provide them as exported constants `WEIGHTS_WANDER`, `WEIGHTS_GRAZE`, `WEIGHTS_FLEE`).
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** Steering module is complete; `sumForces` returns a valid velocity vector for any state.

---

## Phase 3: State machines (TDD)

### Task 5: Herd state machine — construction startle

**Files:**
- Create: `src/game/entities/herd.js`
- Create: `test/test-entities-herd.js`

- [ ] **Step 1:** Write failing tests:
  - `createHerd({ id, type, entityIds, center })` returns a Herd object with `state: 'calm'`, `alarmTimer: 0`, `exitTarget: null`, `cursorDwellTimer: 0`, `wanderTarget` equal to `center`.
  - `startleHerd(herd, triggerPoint, mapBounds, species)` sets `state = 'alarmed'`, `alarmTimer = 10`, picks `exitTarget` as the nearest point on `mapBounds` (four-edge rectangle) to `herd.center`. Idempotent if already alarmed — does not reset the timer or exit target.
  - `tickHerd(herd, dt, ...)` decrements `alarmTimer` by `dt` when alarmed; transitions back to `calm` when timer hits zero and clears `exitTarget`.
- [ ] **Step 2:** Run `node test/test-entities-herd.js`; expect FAIL.
- [ ] **Step 3:** Implement `createHerd`, `startleHerd`, and a skeleton `tickHerd` in `herd.js`. `tickHerd` signature: `tickHerd(herd, members, dt, context)` where `context = { mapBounds, cursorPos, recentPlacements, species }`. For this task, implement only the alarm-timer decrement path.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** Herd lifecycle (calm → alarmed → calm) works deterministically given explicit startle calls and time advancement.

### Task 6: Herd cursor-dwell trigger

**Files:**
- Modify: `src/game/entities/herd.js`
- Modify: `test/test-entities-herd.js`

- [ ] **Step 1:** Write failing tests:
  - Given a herd with one member at `(0, 0)` and `cursorPos = (1, 1)` (within `cursorSpookRadius`), after `dt = 0.6` the herd alarms (dwell threshold 0.5 exceeded).
  - Given `cursorPos = (1, 1)` for `dt = 0.3` then `cursorPos = (999, 999)` (out of radius) for `dt = 0.3`, the herd does NOT alarm (dwell timer reset when cursor left radius). `cursorDwellTimer` returns to `0`.
  - Given cursor within radius for two separate `dt = 0.3` ticks with nothing between, the herd DOES alarm on the second tick (timer accumulates across ticks while cursor stays in radius).
- [ ] **Step 2:** Run tests; expect FAIL.
- [ ] **Step 3:** Extend `tickHerd` to check cursor dwell: if `cursorPos` is non-null and any member is within `species.cursorSpookRadius`, increment `cursorDwellTimer` by `dt`; if it exceeds `species.cursorSpookDwell`, call `startleHerd` with `triggerPoint = cursorPos`. If cursor is out of radius (for all members), reset `cursorDwellTimer = 0`.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** Cursor hover triggers startle; fly-by does not.

### Task 7: Herd construction-startle observation + per-entity state machine

**Files:**
- Modify: `src/game/entities/herd.js`
- Modify: `test/test-entities-herd.js`

- [ ] **Step 1:** Write failing tests:
  - `tickHerd` given a `recentPlacements: [{ x, z }]` entry within `species.spookRadius` of any member alarms the herd.
  - `tickEntity(entity, herd, species, dt, context)`:
    - When `herd.state === 'alarmed'`, entity state becomes `'flee'` regardless of prior state.
    - When `herd.state === 'calm'`, an entity in `wander` on a grass tile has probability `species.grazeChance * dt` of transitioning to `graze` (test with a deterministic RNG stub — injected via `context.rng`).
    - When `herd.state === 'calm'`, an entity in `graze` transitions back to `wander` after `stateTimer` exceeds its assigned `grazeDuration` (picked at entry from `grazeDurationRange`). Verify by driving `stateTimer` forward.
    - `stateTimer` is reset to 0 on every state transition.
- [ ] **Step 2:** Run tests; expect FAIL.
- [ ] **Step 3:** Extend `tickHerd` to loop over `recentPlacements`, call `startleHerd` if any lies within `spookRadius` of any member. Implement `tickEntity` with the state-machine rules above.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** Per-entity and per-herd state machines match the spec; all transitions covered by tests.

---

## Phase 4: Spawner (TDD)

### Task 8: Edge wildness scoring

**Files:**
- Create: `src/game/entities/spawner.js`
- Create: `test/test-entities-spawner.js`

- [ ] **Step 1:** Write failing tests:
  - `scoreEdgeTile(x, z, worldSampler, windowRadius)` returns `1.0` when all tiles within `windowRadius` of `(x, z)` report grass ground types; `0.0` when all report concrete; fractional values for mixed.
  - `pickSpawnPoint(mapBounds, worldSampler, avoidNear = [], minDistance)` returns a point on one of the four edges, drawn from the top quartile of edge tiles by wildness score, at least `minDistance` from every point in `avoidNear`. Returns `null` if no valid tile exists.
- [ ] **Step 2:** Run tests; expect FAIL.
- [ ] **Step 3:** Implement both functions. For `pickSpawnPoint`: sample N candidate points along each edge (e.g., 8 per edge, 32 total), score each, reject any within `minDistance` of `avoidNear`, keep top quartile, pick one via injected `rng`.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** Spawner can pick a wild edge spot that's far from existing herds.

### Task 9: Herd spawn + despawn + background respawn

**Files:**
- Modify: `src/game/entities/spawner.js`
- Modify: `test/test-entities-spawner.js`

- [ ] **Step 1:** Write failing tests:
  - `spawnHerd(state, species, worldSampler, rng, mapBounds)` appends a new Herd and 3–5 new Entities to `state.herds` and `state.entities`, with all entities within ~3 units of the herd center, IDs are unique.
  - `checkDespawn(state, herd, mapBounds, threshold)` returns `true` when all herd members are within `threshold` (1 unit) of `mapBounds` edge; `false` otherwise.
  - `despawnHerd(state, herdId)` removes the herd and all its entities from `state`.
  - `maintainHerdCount(state, species, worldSampler, rng, mapBounds, targetCount, cooldownRemaining)`:
    - When `state.herds.length < targetCount` AND `cooldownRemaining <= 0`, spawns a new herd and returns a new cooldown (30s).
    - When `state.herds.length >= targetCount`, does nothing and returns 0.
    - When cooldown is positive, does nothing and returns `cooldownRemaining - dt` (caller passes `dt`).
- [ ] **Step 2:** Run tests; expect FAIL.
- [ ] **Step 3:** Implement `spawnHerd`, `checkDespawn`, `despawnHerd`, `maintainHerdCount`. IDs use incrementing integers scoped to `state` (track `state._entityIdCounter` / `state._herdIdCounter`, adding to state if missing).
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** Spawn/despawn/respawn lifecycle is fully deterministic given injected rng.

---

## Phase 5: Wiring into Game loop

### Task 10: Entity tick orchestrator

**Files:**
- Create: `src/game/entities/index.js`
- Modify: `src/game/Game.js`

- [ ] **Step 1:** Create `src/game/entities/index.js` exporting `entitiesTick(game)`. Responsibilities per call:
  1. Build a `worldSampler` closure bound to `game.state` (wraps `sampleSurfaceYAt`, `sampleGroundTypeAt`, and a `isOccupied(x, z)` that does the world→subtile conversion and reads `state.subgridOccupied`).
  2. Build `mapBounds` from `game.state.mapCols`/`mapRows` (each tile = 2 world units).
  3. Build a `recentPlacements` list by diffing `state.placeables` IDs vs a cached set on `state._entitiesLastPlaceableIds`; the diff's new entries contribute their `{x, z}` center.
  4. Read `cursorPos` from `game.inputHandler?._hoverWorld ?? null` (added in Task 11).
  5. For each herd: `tickHerd(herd, herd.entityIds.map(id => findEntity(id)), dt, { mapBounds, cursorPos, recentPlacements, species, rng: Math.random })` where `dt = 1.0` (one tick second).
  6. For each entity: compute target velocity via `sumForces(...)` with state-appropriate weights, integrate position (`entity.pos.x += vel.x * dt`, same for z), update `entity.pos.y = sampleSurfaceYAt(...)`, update `entity.heading` with a turn-rate cap (max Δheading per tick ≈ `Math.PI`), advance `entity.stateTimer += dt`.
  7. For each herd: check `checkDespawn`; if true, call `despawnHerd`.
  8. Call `maintainHerdCount(state, deerSpecies, worldSampler, Math.random, mapBounds, 2, state._herdRespawnCooldown ?? 0)`; store returned cooldown back on state.

- [ ] **Step 2:** Modify `src/game/Game.js`:
  - In state initializer (near line 76 where `subgridOccupied` is defined), add `entities: []`, `herds: []`, `_entitiesLastPlaceableIds: null` (null sentinel means "no diff yet — seed but do not trigger startle").
  - In `Game.tick()`, after `_tickMachines()` and before `computeSystemStats()`, call `entitiesTick(this)`.
  - Import `entitiesTick` at top of Game.js.
- [ ] **Step 3:** Write a lightweight integration smoke test in `test/test-entities-herd.js` (reuse existing file): construct a minimal fake `game` with stub state (including `placeables: []`, `floors: []`), spawn one herd manually, call `entitiesTick(game)` 5 times, assert herd still exists and entity positions have moved.
- [ ] **Step 4:** Run tests; expect PASS.

**Acceptance:** `entitiesTick(game)` runs without throwing against a minimal stub game and produces observable movement.

### Task 11: Cursor world-position tracking

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1:** In `InputHandler`, add a field `this._hoverWorld = null` near the existing `this.hoverCol` / `this.hoverRow` tracking.
- [ ] **Step 2:** In the mousemove handler (the same location where `renderer.screenToWorld(e.clientX, e.clientY)` is currently called for hover updates — around `InputHandler.js:1137`-area, look for `hoverCol`/`hoverRow` updates), convert the iso-pixel result to world coords using the existing iso→world conversion (same formula already used nearby), and assign to `this._hoverWorld = { x, z }`.
- [ ] **Step 3:** On mouseleave / when no projection is valid, set `this._hoverWorld = null` so the entity system sees no cursor threat.
- [ ] **Step 4:** No new unit test (this is UI plumbing). Manual verification: `console.log(game.inputHandler._hoverWorld)` in devtools after hovering the game canvas reports `{x, z}` values; reports `null` after moving mouse outside the canvas.

**Acceptance:** `game.inputHandler._hoverWorld` is populated with the world point under the cursor, `null` when the cursor isn't over the map.

### Task 12: Save/load wiring

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1:** In `Game.save()` (around `Game.js:3059`), add `entities: this.state.entities` and `herds: this.state.herds` to the `saveState` spread.
- [ ] **Step 2:** Bump the save `version` field from `6` to `7`. In `Game.load()`, update the version check: reject saves with `version < 7` (display existing "incompatible save" message — per project rules, we don't migrate).
- [ ] **Step 3:** Remove the `_migrateV5` call from `load()` since v5 is no longer accepted; delete `_migrateV5` if it's not referenced elsewhere (grep first).
- [ ] **Step 4:** No new unit test. Manual verification: in devtools, `game.save()` succeeds, inspect `localStorage` to see `entities` and `herds` arrays; `game.load()` restores them.

**Acceptance:** Saves include entities/herds; loading works.

---

## Phase 6: Rendering

### Task 13: Deer mesh builder — structure

**Files:**
- Create: `src/renderer3d/builders/deer-builder.js`

**Purpose:** Build a low-poly deer mesh as a single `THREE.Group` with named children for animation. Mirror the pattern in `src/renderer3d/grass-tuft-builder.js`: a factory function that returns an object with `.add(parent)` and any needed update hooks.

- [ ] **Step 1:** Create `deer-builder.js` exporting `buildDeerMesh(species)` — pure mesh construction, no world-state dependency.
- [ ] **Step 2:** Construct children using `THREE.Mesh` + primitive geometries:
  - `body`: `THREE.CapsuleGeometry(bodyHeight / 2, bodyLength - bodyHeight, 4, 8)` oriented horizontally (rotate 90° around Z)
  - `neck`: thin `CapsuleGeometry`, angled upward-forward, attached at body front
  - `head`: small `BoxGeometry` attached to neck top
  - `ears`: two small angled `BoxGeometry` wedges on head (cosmetic)
  - `leg_fl`, `leg_fr`, `leg_bl`, `leg_br`: four `CylinderGeometry(0.07, 0.07, legHeight, 6)` attached at body corners (slightly inset), positioned below body
  - `tail`: small tapered `CylinderGeometry` at body rear, angled upward
- [ ] **Step 3:** Name children (`.name = 'leg_fl'` etc.) so `entity-renderer.js` can look them up for animation. Group the whole thing under a root `THREE.Group` named `deer`.
- [ ] **Step 4:** Apply a placeholder `MeshStandardMaterial({ color: species.coatColors.base })` for now — procedural texture comes in Task 14.
- [ ] **Step 5:** No unit test (THREE.js object construction — verify visually in Task 16).

**Acceptance:** `buildDeerMesh(ENTITIES.deer)` returns a `THREE.Group` with the expected named children; can be added to a scene without errors.

### Task 14: Deer mesh builder — procedural coat texture

**Files:**
- Modify: `src/renderer3d/builders/deer-builder.js`

- [ ] **Step 1:** Inspect the procedural-texture helpers already in use by other builders — `src/renderer3d/materials/tiled.js` and any noise helpers in `src/renderer3d/` (search for existing mottled/coat patterns used by e.g. animal-adjacent decorations). Adapt the same approach rather than inventing a new one.
- [ ] **Step 2:** Generate a mottled brown coat texture: simple noise-driven variation between `coatColors.base` and a darker shade (±20% brightness). Apply to `body`, `neck`, `head`, legs.
- [ ] **Step 3:** Apply `coatColors.belly` to a separate material on the underside — easiest approach: a second material on the body using vertex groups is overkill; instead add a thin belly `BoxGeometry` child that hugs the underside of the body, or use UV-based gradient in the coat texture. Pick whichever is simpler given existing texture utility capabilities.
- [ ] **Step 4:** Apply `coatColors.tail` (white) to the tail mesh.
- [ ] **Step 5:** No unit test — verify visually in Task 16.

**Acceptance:** Deer mesh looks like a deer (brown body, lighter belly, white tail) when added to a scene.

### Task 15: Entity renderer — mesh pool + per-frame transforms

**Files:**
- Create: `src/renderer3d/entity-renderer.js`
- Modify: `src/renderer3d/ThreeRenderer.js`

- [ ] **Step 1:** Create `entity-renderer.js` exporting a `createEntityRenderer(scene, meshCache)` factory returning an object with:
  - `update(dt, state)`: per-frame entry point
  - `dispose()`: clean up meshes

  Internal state: a `Map<entityId, { mesh, prevState, stateChangeTime, animPhase }>`.

- [ ] **Step 2:** In `update(dt, state)`:
  1. Sync mesh pool vs `state.entities`: for new entity ids, call `buildDeerMesh(species)`, add to `scene`, store in map. For missing ids, remove mesh from scene and delete from map.
  2. For each entity, lerp `mesh.position` toward `entity.pos` at a rate such that a full sim-tick worth of distance closes over ~1 second (smoothing factor `1 - exp(-dt * 6)` or similar); same lerp for `mesh.position.y`.
  3. Slerp `mesh.rotation.y` toward `entity.heading` with a similar smoothing.
  4. Advance `animPhase` by `dt * gaitFrequency(state, species)` where gait-freq is `walkFrequency` for wander, `pranceFrequency` for flee, `0.5` for graze (breathing).
  5. Dispatch to gait animator (implemented in Tasks 16–18).
- [ ] **Step 3:** In `ThreeRenderer.js` constructor (around line 170 where `this.game` is assigned), construct `this.entityRenderer = createEntityRenderer(this.scene)`.
- [ ] **Step 4:** In `_animate()` (around line 2696), compute `const dt = (now - this._lastAnimTime) / 1000` (add `_lastAnimTime` field if absent), call `this.entityRenderer.update(dt, this.game?.state)` before `this.renderer.render(...)`.
- [ ] **Step 5:** No unit test. Manual: load game, no deer yet (no spawner wired visually until entity tick runs), but no errors.

**Acceptance:** Entity renderer runs per frame without errors; mesh pool sync is observable via devtools.

### Task 16: Walk gait animation

**Files:**
- Modify: `src/renderer3d/entity-renderer.js`

- [ ] **Step 1:** Add `applyWalkGait(mesh, animPhase, speedScale, species)` that:
  - Legs: sets `leg_fl.rotation.x` and `leg_br.rotation.x` to `Math.sin(animPhase * 2 * PI) * walkLegAmplitude * speedScale`; sets `leg_fr.rotation.x` and `leg_bl.rotation.x` to the negative (opposite phase — alternating diagonals).
  - Body: adds a tiny vertical bob `body.position.y = sin(animPhase * 4 * PI) * 0.02`.
  - Head: level (no rotation change).
- [ ] **Step 2:** `speedScale = clamp(|vel| / species.walkSpeed, 0, 1)` so standing still = no swing.
- [ ] **Step 3:** In `update()`, when `entity.state === 'wander'`, call `applyWalkGait`.
- [ ] **Step 4:** Manual verification: deer walking across map visibly step their legs.

**Acceptance:** Walking deer animate legs in alternating diagonal pairs scaled with speed.

### Task 17: Graze pose

**Files:**
- Modify: `src/renderer3d/entity-renderer.js`

- [ ] **Step 1:** Add `applyGrazePose(mesh, animPhase, species)`:
  - Legs: rotations set to 0 (neutral standing).
  - Head: `head.rotation.x = -Math.PI / 3` (tilt down ~60°); also tilt `neck.rotation.x` down a bit so it's not a crease.
  - Body breathing: `body.scale.y = 1 + sin(animPhase * 2 * PI) * 0.02`.
- [ ] **Step 2:** In `update()`, when `entity.state === 'graze'`, call `applyGrazePose`.
- [ ] **Step 3:** Manual verification: grazing deer stand still with head lowered to ground.

**Acceptance:** Grazing deer visibly lower head, stationary.

### Task 18: Prance gait (flee)

**Files:**
- Modify: `src/renderer3d/entity-renderer.js`

- [ ] **Step 1:** Add `applyPranceGait(mesh, animPhase, species)`:
  - Front legs (`leg_fl`, `leg_fr`): same phase. On push-off (`sin > 0`), rotate forward-up: `rotation.x = -pranceLegAmplitude * max(0, sin(animPhase * 2 * PI))` (knees forward when sin positive, straight when negative). Add a bent-knee effect by also rotating the lower leg — for v1, the single-cylinder leg is fine; just rotate the whole cylinder.
  - Back legs (`leg_bl`, `leg_br`): same phase as each other, OPPOSITE to front. On push-off, rotate backward: `rotation.x = pranceLegAmplitude * max(0, sin(animPhase * 2 * PI))`.
  - Body bob: `body.position.y = sin(animPhase * 2 * PI) * pranceBodyBobAmplitude`.
  - Body pitch: `body.rotation.x = -sin(animPhase * 2 * PI) * 0.15` (pitches forward on push-off, back on landing).
- [ ] **Step 2:** In `update()`, when `entity.state === 'flee'`, call `applyPranceGait`.
- [ ] **Step 3:** Manual verification: place a building next to a herd; deer prance away with visible bounding gait (front legs together, back legs together, vertical bob).

**Acceptance:** Fleeing deer visibly bound rather than walk — legs move as pairs, body pitches and bobs heavily.

### Task 19: Gait crossfade

**Files:**
- Modify: `src/renderer3d/entity-renderer.js`

- [ ] **Step 1:** Track `prevState` and `stateChangeTime` per entity in the mesh pool map.
- [ ] **Step 2:** In `update(dt, state)`, when `entity.state !== entry.prevState`:
  - Record `entry.prevState = (old value)` into a secondary field `entry.crossfadeFromState`.
  - Set `entry.stateChangeTime = now`.
- [ ] **Step 3:** When applying gait, compute `alpha = min(1, (now - stateChangeTime) / species.gaitCrossfadeDuration)`. If `alpha < 1`, call both the `crossfadeFromState` gait and the current-state gait, then blend the resulting bone transforms linearly (`targetRot = fromRot * (1 - alpha) + toRot * alpha`). Simplest implementation: apply the `from` gait first, stash transforms, apply the `to` gait, lerp each tracked transform.
- [ ] **Step 4:** Manual verification: trigger startle on a grazing herd; deer smoothly transition from lowered head / still legs into prancing over ~200ms, not a snap.

**Acceptance:** State transitions are visibly smooth, not a snap cut.

---

## Phase 7: Smoke test + finalize

### Task 20: Add `sampleGroundTypeAt` helper

**Files:**
- Modify: `src/game/terrain.js`
- Create: `test/test-terrain-ground-type.js`

This helper is referenced by the worldSampler in Phase 5. Implement it now so Phase 5 tests' fake samplers can be backed by a real one in the integration smoke.

- [ ] **Step 1:** Write failing test `test/test-terrain-ground-type.js`:
  - Build a minimal `state` with a `floors` array containing a floor tile of `type: 'grass'` at `(col=1, row=1)` and nothing elsewhere.
  - `sampleGroundTypeAt(state, worldX=2, worldZ=2)` (which is inside tile (1,1) since tile size is 2) returns `'grass'`.
  - `sampleGroundTypeAt(state, worldX=100, worldZ=100)` (outside map) returns `null` or `'grass'` fallback — pick one and assert.
- [ ] **Step 2:** Run test; expect FAIL.
- [ ] **Step 3:** Implement `sampleGroundTypeAt(state, x, z)` in `terrain.js`. `state.infraOccupied` is keyed `"col,row"` and maps to a ground-type string (`'grass'`, `'wildgrass'`, `'tallgrass'`, `'concrete'`, `'hallway'`, etc.). Cells with no entry are default grass terrain — return `null` for those (callers treat `null` as grass-equivalent):
  ```js
  const col = Math.floor(x / 2);
  const row = Math.floor(z / 2);
  const infra = state.infraOccupied?.[col + ',' + row];
  return infra ?? null;
  ```
  (The original plan referenced `state.floors` as a 2D array but `state.floors` is actually a flat `[{ type, col, row }]` array used for specific floor placements — `infraOccupied` is the correct per-tile ground-type map. Phase 5 already inlined this same logic in `src/game/entities/index.js:19-25`; Phase 7's job is to move it to `terrain.js` as a shared helper and update Phase 5's inline version to import it.)
- [ ] **Step 4:** Run test; expect PASS.

**Acceptance:** Ground-type sampling works against real state shape.

### Task 21: Manual smoke test

**Files:**
- None (or add `docs/superpowers/plans/2026-04-18-entities-deer-wildlife-smoke-checklist.md` if you want a persistent checklist).

Run the dev server (`npm run dev`) and verify each item. Report any failure as a new task; don't try to fix in-line during smoke.

- [ ] **Step 1:** Load game → at least one herd of 3–5 deer visible within 30 game seconds.
- [ ] **Step 2:** Observe deer wandering — loose grouping (boids separation/cohesion visible; no overlap, no scatter to opposite corners).
- [ ] **Step 3:** Observe at least one deer grazing on grass (head down, stationary) within 2 minutes.
- [ ] **Step 4:** Observe walk gait — legs animate in alternating diagonals.
- [ ] **Step 5:** Hover cursor directly on a herd for ~1 second → herd transitions to prance-flee; deer visibly bound (front legs together, back legs together, heavy body bob).
- [ ] **Step 6:** Sweep cursor quickly across the herd (less than 0.5s over any member) → no flee triggered.
- [ ] **Step 7:** Place a new building within ~6 tiles of a herd → flee triggers.
- [ ] **Step 8:** Fleeing herd reaches a map edge → herd and all members despawn.
- [ ] **Step 9:** Within ~90 game seconds of a despawn, a new herd spawns from a different edge (wild edge preferred).
- [ ] **Step 10:** Verify no console errors during any of the above.
- [ ] **Step 11:** Save, reload page, load — herds and their member positions persist.

**Acceptance:** All 11 items pass. If any fail, file as follow-up tasks with specific observations.

---

## Self-Review Notes

Spec coverage check (post-writing):

- Generic Entity + Herd data model → Task 10 (state shape), Task 1 (species data), serialization Task 12 ✓
- Three behavioral states → Task 7 (transitions), Tasks 16–18 (gait per state) ✓
- Herd flocking → Task 2 (separate, seekHerdCenter, align) ✓
- Terrain awareness: heightmap + steep-slope + placeable avoidance + grass bias → Task 4 (avoidObstacles), Task 3 (terrainBias, labAversion), Task 10 (Y sampling in tick), Task 20 (ground-type helper) ✓
- Reactive steering only (no A*) → confirmed in spec non-goals and by absence of any pathfinding task ✓
- Construction startle → Task 7 ✓
- Cursor dwell startle → Task 6 + Task 11 (cursor tracking) ✓
- Edge-migration lifecycle → Tasks 8, 9 (spawn/despawn/respawn) ✓
- Three gaits: walk / graze / prance → Tasks 16, 17, 18 ✓
- Gait crossfade → Task 19 ✓
- Mottled-brown procedural coat + white tail tip → Task 14 ✓
- Low-poly mesh with named sub-parts → Task 13 ✓
- Save/load with version bump → Task 12 ✓
- Unit tests for pure math + state machines → Tasks 2, 3, 4 (steering), 5, 6, 7 (herd + entity SM), 8, 9 (spawner) ✓
- Manual smoke test → Task 21 ✓

No placeholders found. Type names (Entity, Herd fields) consistent across tasks. Function signatures match between steering-force tests and `sumForces` consumption in Task 10.

---

## Commit strategy

One commit at the end covering the whole feature. Do NOT commit between phases or tasks. Leave the working tree dirty throughout; only the user (not subagents) commits when the smoke test passes. Any `git commit` steps in the task bodies above are overridden by this rule.
