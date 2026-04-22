# Entities: Deer Wildlife (v1)

## Overview

Introduce a general **Entity** subsystem to Beamline Tycoon, with **deer** as the first concrete entity type. Entities are moving, AI-driven inhabitants of the world — distinct from the existing static placeables, terrain, and utility networks. V1 ships one species (deer) grouped into herds that wander the map using flocking behavior, react to construction activity by fleeing to the map edge, and migrate in from wild map edges to maintain a steady population.

The Entity substrate is designed to generalize to future types (workers, visitors, other animals), but v1 only implements deer. Other entity roles — embodied workforce, tour guests, full ecosystem — are out of scope.

## Current State

The project has no entity/NPC/agent system. Staff are abstract counters on `Game.state` (headcounts per role), not placed individuals (`src/game/Game.js:53–54`). The world is static: placeables, walls, floors, beamline components, machines, terrain. All gameplay objects are grid-snapped and stationary; none update position over time.

Rendering is Three.js 3D isometric with procedurally textured low-poly meshes. Precedent for procedural-mesh builders lives in `src/renderer3d/builders/` (endpoint-builder, component-builder, decoration-builder, grass-tuft-builder, wildflower-builder, wall-builder). Per-frame animation hooks run in `ThreeRenderer._animate` (`src/game/Game.js:2696`); tick-rate sim logic runs in `Game.tick()` at 1 Hz (`src/game/Game.js:2399–2490`).

Terrain exposes a per-corner heightmap (`src/game/terrain.js`, `src/game/map-generator.js`) with noise-driven elevation and ground-type tiles (grass, wildgrass, dirt, concrete, etc., defined in `src/data/grounds.js`). Placeable occupancy is tracked in a subtile grid (`subgridOccupied`) used by the placement system.

## Goals

1. Generic Entity + Herd data model, serialized on game state, extensible to non-deer types later.
2. Deer species with three behavioral states: **wander**, **graze**, **flee**.
3. Herd-level flocking using boids-lite forces (cohesion, separation, alignment) around a slowly drifting herd anchor.
4. Terrain awareness: entities follow the heightmap for Y coordinate, avoid steep slopes, prefer grass/wildgrass tiles over concrete, avoid walking through placed walls/buildings.
5. Reactive steering only — no A* or tile-path planning.
6. Startle / flee triggered by construction activity within spook radius of any herd member.
7. Edge-migration lifecycle: herds spawn from wild map edges, roam, eventually exit another edge and despawn. Background spawner maintains ~2 herds on map.
8. Three gait animations — walk, graze-still, prance (flee-bound) — driven per-frame by entity state and velocity.
9. Clean architecture split: pure steering math unit-testable, herd state machine unit-testable, renderer isolated from sim.

## Non-Goals

- A* or tile-based pathfinding.
- Needs (hunger, thirst), aging, breeding, death.
- Day/night reactivity (no day/night cycle exists yet).
- Additional species (rabbits, birds, etc.) — slot in later as pure data + mesh.
- People / visitors / embodied workers.
- Deer-beam or deer-equipment collision / interaction.
- Save-file migration — per project rules, old saves break when the data model changes.
- GPU instancing of deer meshes (unnecessary at v1 population ≤ 20).

## Design

### File layout

```
src/game/entities/
  index.js              — Entity/Herd registry + tick orchestration; plugs into Game.tick()
  steering.js           — pure boids + seek/avoid math (unit-testable)
  herd.js               — herd state machine, startle propagation
  spawner.js            — edge spawning, despawn on exit
src/data/
  entities.raw.js       — per-species data: mesh params, AI tunings, size, animation tunings
src/renderer3d/
  entity-renderer.js    — per-frame mesh updates, animation driver
  builders/deer-builder.js — low-poly procedurally-textured mesh
test/
  test-entities-steering.js
  test-entities-herd.js
```

No changes to existing placeable / network / terrain systems. Entities are read-only consumers of terrain heightmap and placeable occupancy.

### Data model

Stored on `Game.state`:

```js
Entity {
  id: string                    // "deer_001"
  type: 'deer'                  // discriminator; future: 'rabbit', 'worker', ...
  herdId: string
  pos: { x, y, z }              // world coords; y sampled from heightmap
  vel: { x, z }                 // planar velocity; y follows terrain
  heading: number               // radians; mesh Y-rotation
  state: 'wander' | 'graze' | 'flee'
  stateTimer: number            // seconds since last state transition
  animPhase: number             // 0..1, drives gait cycle per-frame
}

Herd {
  id: string                    // "herd_001"
  type: 'deer'                  // all members share type in v1
  entityIds: string[]
  center: { x, z }              // slowly drifting wander anchor
  wanderTarget: { x, z }        // where center is drifting toward
  state: 'calm' | 'alarmed'
  alarmTimer: number            // seconds remaining in alarmed state
  exitTarget: { x, z } | null   // map-edge point set when fleeing
  cursorDwellTimer: number      // seconds cursor has been within cursorSpookRadius
}
```

Key shape choices:

- **World coords, not grid coords.** Entities move continuously; grid is only used for terrain/occupancy lookups.
- **Herd owns `wanderTarget` and `center`.** Individuals flock around a herd-level anchor — simpler than per-entity wander-target, and herd-y behavior falls out naturally.
- **No health / needs / age.** Deliberately flat.
- **`type` as string discriminator**; per-type data (mesh, AI tunings, size) lives in `entities.raw.js` and is looked up by type at spawn / render time. No subclass hierarchy.
- **Herd state is the source of startle.** Individuals read `herd.state` each tick to decide whether they're in flee mode.

### Per-species data (`entities.raw.js`)

Deer tunings live here; future species are additional entries with the same shape:

```js
deer: {
  // Sim / AI
  walkSpeed: number               // world units/sec
  fleeSpeed: number
  minSpacing: number              // for separation force
  herdCohesionRadius: number
  wanderJitterStrength: number
  terrainBiasStrength: number
  labAversionRadius: number
  spookRadius: number             // construction within this triggers flee
  cursorSpookRadius: number       // cursor within this for cursorSpookDwell triggers flee
  cursorSpookDwell: number        // seconds cursor must dwell within cursorSpookRadius
  grazeChance: number             // per-tick, when on grass in calm state
  grazeDurationRange: [min, max]  // seconds
  maxSteepness: number            // reject moves onto slopes steeper than this

  // Rendering
  bodyLength: number              // world units
  bodyHeight: number
  legHeight: number
  coatColors: { base, belly, tail }  // for procedural texture

  // Animation
  walkFrequency: number           // Hz
  pranceFrequency: number
  walkLegAmplitude: number        // radians
  pranceLegAmplitude: number
  pranceBodyBobAmplitude: number  // world units
  gaitCrossfadeDuration: number   // seconds
}
```

### Behavior: steering forces (pure math)

Each entity's per-tick target velocity is the weighted sum of component forces. Weights vary by `state`:

| Force              | wander | graze | flee |
|--------------------|--------|-------|------|
| `seekHerdCenter`   | medium | —     | —    |
| `seekExit`         | —      | —     | high |
| `separate`         | medium | —     | high |
| `align`            | low    | —     | —    |
| `wanderJitter`     | low    | —     | —    |
| `avoidObstacles`   | high   | —     | high |
| `terrainBias`      | low    | —     | —    |
| `labAversion`      | medium | —     | low  |

(graze freezes velocity entirely; all forces skipped)

All forces are pure functions in `steering.js` taking `(entity, herd, worldSampler)` and returning a `{x, z}` vector. `worldSampler` exposes `sampleHeight(x,z)`, `sampleGroundType(x,z)`, `isOccupied(x,z)` — abstracts terrain/placeable queries so the math is testable with a fake sampler.

- **`seekHerdCenter`** — vector toward `herd.center`, magnitude proportional to distance beyond cohesionRadius.
- **`seekExit`** — vector toward `herd.exitTarget`, near-constant magnitude (flee is urgent).
- **`separate`** — sum of away-vectors from neighbors within `minSpacing`.
- **`align`** — delta between entity heading and average neighbor heading (classic boids).
- **`wanderJitter`** — small random perturbation per tick so motion isn't mechanical.
- **`avoidObstacles`** — short-range look-ahead: if the step at `pos + vel * lookAheadSec` is occupied / off-map / too steep, steer laterally (perpendicular to velocity, side chosen to stay in bounds).
- **`terrainBias`** — sample ground type at a few points ahead; bias velocity toward points with "softer" types (grass > wildgrass > dirt > concrete).
- **`labAversion`** — repulsion from nearest placeable within `labAversionRadius`. Only active in `wander`; weak-to-zero in `flee` (flee path may require cutting near buildings).

After summing forces, clamp to species `walkSpeed` / `fleeSpeed` and integrate position. Heading is updated to match velocity direction (smoothed with a turn-rate cap so deer don't snap-rotate).

### Behavior: per-entity state machine

```
wander → graze     when on grass, herd.state = calm, random chance per tick
graze  → wander    graze timer elapsed, OR herd.state transitions to alarmed
wander → flee      herd.state = alarmed
graze  → flee      herd.state = alarmed
flee   → wander    herd.state = calm (occurs if alarm timer expires before exit reached;
                   rare — usually the herd despawns first at the exit edge)
```

Entities read herd state every tick. The `wander ↔ graze` transitions are per-entity and independent — at any moment a herd may have some deer grazing and others wandering.

### Behavior: per-herd state machine

```
calm → alarmed     when a startle trigger fires (see below)
                   — sets alarmTimer = 10s, picks exitTarget on nearest map edge
alarmed → calm     when alarmTimer reaches zero
```

Startle triggers:

- **Construction / placement** within `spookRadius` (~6 tiles) of any herd member. Hooked via the existing placement flow — the entity system subscribes to a placement event (or polls recent placements each tick, whichever fits the existing event model in `Game.js`).
- **Mouse cursor proximity (hover threat).** If the cursor's projected world position stays within `cursorSpookRadius` (~4 tiles — deliberately tighter than `spookRadius`) of any herd member for at least `cursorSpookDwell` seconds (~0.5s), the herd alarms. The dwell requirement prevents a mouse fly-by (player sweeping the cursor across the map to click somewhere else) from triggering constant flees; only intentional lingering near the herd spooks them.
- **Not** triggered by camera position alone (camera glides around freely; it's not a player intent signal). The cursor is the intent signal.

Cursor threat is checked each tick in `Game.tick()` by reading the current cursor world position from the input controller; a per-herd `cursorDwellTimer` accumulates while any member is within radius and resets when the cursor moves out. If the timer exceeds `cursorSpookDwell`, the herd alarms exactly as with construction.

`exitTarget` is chosen as the closest map-edge point to the herd center at the moment of alarm. All members then share the same exit target, which creates the "herd flees together in the same direction" visual.

### Spawning and lifecycle

**Initial map gen:** the spawner places 2 herds at distant points on the map edges. Distance constraint: herd centers at least 50% of the map diagonal apart at spawn. Each herd has 3–5 deer (uniform random per herd), clustered within ~3 tiles of the herd center.

**Edge selection for spawn:** edges are ranked by "wildness" — fraction of nearby tiles that are grass/wildgrass within a local window. Spawns draw from the top quartile of wild edges. If no edge is wild enough (e.g., player has built out heavily), the spawner picks the least-developed edge available.

**Wandering:** `herd.wanderTarget` drifts slowly (reassigned every 30–60 game seconds to a new point within the map, biased toward wild terrain). `herd.center` interpolates toward `wanderTarget` at a slow rate. Entities flock around `center` as it moves.

**Exit:** when herd flees, all members seek `herd.exitTarget`. Once all members are within 1 tile of the map edge, the entire herd despawns (removed from `state.entities` and `state.herds`).

**Respawn:** background tick (every ~60 game seconds) checks herd count. If `herds.length < 2`, spawn a new herd from a wild edge. Cooldown of ~30 seconds after a despawn prevents immediate respawn.

All spawn / despawn / cooldown parameters live in `entities.raw.js` for playtesting tuning.

### Terrain awareness

Entities sample the existing heightmap for their Y-coordinate. The sim-tick updates `entity.pos.y` from `sampleHeight(pos.x, pos.z)`; the renderer lerps mesh position toward target Y per-frame for smooth hills.

Steepness rejection uses the gradient between the entity's current cell and the target cell; if the height delta exceeds `maxSteepness`, the `avoidObstacles` force rejects the step.

Ground-type sampling (`sampleGroundType`) needs a small helper in `src/game/terrain.js` exposing "what ground type is under this world-point?" — if such a helper doesn't exist cleanly today, add it as a minimal addition. This is the only touch to existing terrain code.

Obstacle sampling uses `subgridOccupied` from the placement system to check whether a world-point lies on an occupied subtile.

### Tick / render decomposition

**`Game.tick()` (1 Hz) — sim logic in `src/game/entities/index.js`:**
1. Update each herd's `wanderTarget` drift, `center` interpolation, `state` / alarm timer.
2. Check startle triggers:
   - New placements since last tick within `spookRadius` of any herd member.
   - Update `cursorDwellTimer` from current cursor world position; if timer exceeds `cursorSpookDwell`, alarm the herd.
3. For each entity: run `state` transitions, recompute target velocity from steering forces, integrate position, sample terrain Y.
4. Check despawn condition (fleeing herd reached exit).
5. Run background spawner: maintain herd count target.

**`ThreeRenderer._animate` (per-frame) — `entity-renderer.js`:**
1. For each entity, lerp mesh world position toward `entity.pos` for smooth movement between ticks.
2. Advance `animPhase` by `dt * gaitFrequency(state)`.
3. Update leg / body / head mesh transforms from `animPhase` and current gait.
4. If state changed since last frame, crossfade between gait parameters over `gaitCrossfadeDuration`.
5. Update mesh rotation from `entity.heading`.

### Rendering: deer mesh builder

`src/renderer3d/builders/deer-builder.js` produces a low-poly deer mesh as a single `Object3D` with named child meshes for animation:

- `body` — ellipsoid or elongated capsule
- `neck` + `head` — box/wedge attached forward of body
- `leg_fl`, `leg_fr`, `leg_bl`, `leg_br` — four thin cylinders attached under body at corners
- `tail` — short tapered stub, back of body
- (optional) `antlers` — small forked shapes on head; treat as cosmetic variation controlled by a per-entity `hasAntlers` flag if desired, else always on

Proportions from species data in `entities.raw.js`. Mesh is built once per species at first spawn and cloned per entity (one mesh per entity; max ~20 entities → ≤20 meshes, fine without instancing).

Procedural texture via existing `tiled.js` / noise helpers:
- Body base: mottled brown, using `coatColors.base`
- Belly: lighter, using `coatColors.belly`
- Tail tip: `coatColors.tail` (white)

Reuse whatever texture generation pattern is already standard in the decoration builders.

### Rendering: per-frame animation

Animation is driven by `entity.state`, `entity.vel` magnitude, and `animPhase` in `entity-renderer.js`:

**Walk (wander state):**
- Legs swing in two alternating diagonal pairs (FL+BR together, FR+BL together), opposite phase
- Amplitude scales with `vel` magnitude (standing still → zero, max speed → full `walkLegAmplitude`)
- Body: slight vertical bob at 2× leg frequency, very low amplitude
- Head: level

**Graze:**
- Legs static at neutral pose
- Head rotated down (pitch ~ -60°) to ground
- Body: subtle breathing scale (sinusoidal ~0.5 Hz, ±2%)

**Prance / bound (flee state):**
- Bounding gait, not walk cycle — front legs and back legs move as pairs rather than alternating diagonals
- Front legs: both up and bent forward on push-off phase
- Back legs: both extended behind on push-off; tucked under on landing
- Cycle: [push-off → airborne → landing → push-off], `pranceFrequency` ~2.5 Hz
- Body pitches forward on push-off, back on landing
- Vertical bob with `pranceBodyBobAmplitude` (much higher than walk)
- Head: level or slightly forward

**Crossfade on state change:** when `entity.state` changes, mix current gait output with target gait output over `gaitCrossfadeDuration` (~0.2s) so transitions aren't a snap. Implemented by tracking `prevState`, `prevStateTime`, and blending leg/body/head transforms between the two state generators until the crossfade completes.

## Testing

**Unit tests (pure math) — `test/test-entities-steering.js`:**
- `separate` with two entities at known positions returns expected vectors
- `seekHerdCenter` magnitude increases with distance past cohesionRadius, zero inside
- `avoidObstacles` with a faked `worldSampler` returns a perpendicular vector when look-ahead hits an occupied cell
- `terrainBias` on a fake ground map returns vector biased toward grass

**Unit tests (state machines) — `test/test-entities-herd.js`:**
- Startle trigger (construction) flips `calm → alarmed`, sets `alarmTimer` and `exitTarget`
- Cursor dwell within `cursorSpookRadius` for `cursorSpookDwell` seconds triggers alarm
- Cursor fly-by (< dwell threshold) does NOT trigger alarm; dwell timer resets when cursor leaves radius
- `exitTarget` is the nearest map-edge point given a herd center
- Alarm timer decrements per tick and transitions back to `calm` at zero
- Per-entity `wander → graze` requires on-grass + herd-calm conditions
- Herd-alarm forces all members to `flee` regardless of prior state

**Integration test (lightweight) — `test/test-entities-herd.js`:**
- Spawn a herd on a fake map, tick N times, confirm members stay within bounded distance of herd center
- Trigger startle, tick N times, confirm all members' positions have moved toward exit target
- Continue ticking until despawn condition met, confirm herd and entities removed from state

**Manual smoke test (not automated):**
- Load game, observe ≥1 herd visible, deer wandering with flocking visible
- Grazing visible when on grass tiles
- Place a building within ~6 tiles of a herd, confirm prance-flee begins and herd exits a map edge
- Hover the cursor on a herd for ~0.5s, confirm flee begins
- Sweep the cursor quickly past a herd (less than dwell threshold), confirm no flee
- After ~60s, new herd spawns from a different edge

## Open Questions

None blocking. Minor tuning items (exact spook radius, exact herd size distribution, gait frequencies, coat color ranges) will be tuned during playtesting via `entities.raw.js` without code changes.
