# Facility Lighting — fixtures that actually light the place up

**Date:** 2026-08-13
**Status:** Approved for planning

## Problem

The game has a day/night cycle and three light fixtures, and none of it means
anything. Four defects, one theme: **light is decoration, not illumination.**

### 1. The fixtures are painted on

`lamppost`, `bollardLight` and `spotLight` (`src/data/decorations.raw.js:137`)
build to geometry with emissive materials — `emissiveIntensity` 1.2–1.8, fixed
(`decoration-builder.js:1194`–`1285`). They glow at noon exactly as hard as they
glow at midnight, they cast no light on anything, and nothing in the sim knows
they exist. A lamppost is a small glowing box on a stick.

### 2. Night is not dark

`_updateSunCycle` (`ThreeRenderer.js:2963`) orbits the sun and shifts its color
warm-to-blue, but pins ambient flat:

```
this._ambientLight.intensity = 1.3;   // ':3008' — "constant — no day/night swing"
```

Night ambient is `RGB(0.4, 0.45, 0.6)` at intensity 1.3 against a sun that only
drops to 0.8. The facility at midnight is a well-lit facility with a blue cast.
There is no darkness for a lamp to push back.

### 3. There are two clocks and they disagree

| Clock | Owner | Period |
|---|---|---|
| `_sunAngle` | renderer, wall-clock (`performance.now()`) | 1 hour real time |
| `isNight = (state.tick % 240) >= 120` | sim (`Game.js:3649`) | 240 ticks = 4 min at 1× |

The sun on screen and the night the staff-needs loop reacts to are unrelated
quantities. Staff get tired on a two-minute night while the sky is at noon.
Any lighting feature with gameplay meaning has to resolve this first, and it
also blocks testing: there is no way to ask for "midnight" and get it.

### 4. No indoor lighting exists at any level

All 24 decorations are `placement: 'outdoor'`. Indoor items are zone
furnishings, tile-placed, and none of them are lights. There is no
wall-mounted anything (doors are the only wall-keyed entity), and there are
no ceilings — walls stop at 1.5 m (`wall-builder.js:12`) and rooms are open
to the camera by design.

## Scope

**In:** fixture catalogue, placement mechanics for all four mount types, the
visual illumination model, night darkening, clock unification, power draw.

**Deferred** to a follow-up pass, specified in "Deferred gameplay effects"
below but *not built*: room morale penalty, night-shift productivity, safety
and incident risk, reputation rating. The work here is chosen so those four
are cheap to add afterward — specifically, unifying the clock and exposing a
per-room lit query are what those effects need.

## 1. Time of day becomes sim state

Delete the renderer's private clock. Add to game state:

- `state.timeOfDay` — float in `[0, 1)`, `0` = midnight, `0.5` = noon.
  Advanced once per tick by `1 / DAY_LENGTH_TICKS`.
- `DAY_LENGTH_TICKS` — a single tuning constant. **Default: 240 ticks**, which
  at `TICK_MS = 1000` is a 4-minute day at 1× speed and scales with game speed
  for free.
- `isNight` derives from `timeOfDay` and replaces the `tick % 240` expression
  at `Game.js:3649`. Everything already consuming `isNight` keeps working.

240 is chosen to **exactly match the period the sim already runs**, so
staff-needs pacing is bit-for-bit unchanged and this refactor carries no
balance risk. The renderer's hour-long sun is the clock that changes, and it
was pure ambience with nothing depending on it.

`ThreeRenderer._updateSunCycle` reads `game.state.timeOfDay` instead of
`performance.now()`, and interpolates between ticks so the sun glides rather
than steps. `_sunAngle`, `_sunCycleSpeed` and `_lastSunTime` go away.

**Benefit:** `timeOfDay` is settable, so tests and dev tooling can force
midnight. The visual test in this spec depends on that.

## 2. Night gets dark

In `_updateSunCycle`, replace the pinned ambient with a ramp driven by
`timeOfDay`:

- Ambient intensity: `1.3` at midday → **`0.35`** at deep night, eased so dusk
  and dawn read as transitions rather than a switch.
- Sun intensity falls to `0` at night; a weak moonlit directional (cool blue,
  low intensity) replaces it so geometry keeps some form and the scene never
  goes to flat black.
- Keep the existing warm-to-blue color shift; deepen it. **Cool blue ambient
  against warm fixture pools is what sells the entire feature** — the contrast
  matters more than the absolute darkness.

Expose `NIGHT_AMBIENT` and `NIGHT_TINT` as named constants at the top of the
module. These are taste knobs and will be retuned by eye.

## 3. The illumination model — hybrid, staged

Two layers, built in order.

### Layer 1 — faked pools (does the heavy lifting)

Per fixture, no Three.js light involved:

- **Fixture emissive** scales with darkness instead of being constant, so
  lamps visibly switch on at dusk.
- **Ground pool** — an additive, radial-falloff quad on the floor beneath the
  fixture, sized and tinted from the fixture's `light` block. Circular for
  point-type fixtures, an ellipse stretched along the aim direction for cones.
- **Halo** — a soft additive billboard at the lamp head, so the source reads
  as bright from any camera angle.

Pools for all fixtures merge into a small number of draw calls, rebuilt only
when fixtures change or the day/night state crosses a threshold — **never per
frame**. Their opacity is driven by the same darkness curve as ambient.

### Layer 2 — a fixed pool of real lights (adds the depth)

Faked pools cannot light a wall standing in them, or a staff pawn walking
through. So: allocate **12 `PointLight`s once at scene init** and never add or
remove one. Each frame (or every N frames), rank fixtures by distance to the
camera center and assign the top 12 to the light objects, lerping intensity
in and out so reassignment never pops.

Holding the light count constant is the whole trick — the forward renderer
recompiles shaders when the light count changes, and that is the expensive
failure mode. Moving and dimming a fixed set is cheap. **No shadows from
fixtures** at any point; the sun keeps its shadow map, lamps do not get one.

Build Layer 1 first and confirm it reads well before adding Layer 2.

## 4. Fixture catalogue

Nine fixtures across four families. The three existing fakes are reworked into
this system rather than left as a parallel path.

| Fixture | Family | Mount | Footprint | Notes |
|---|---|---|---|---|
| `lamppost` | lamp | ground | 1×1 | exists — rework, keep the patina-teal look |
| `doubleLamppost` | lamp | ground | 1×1 | two heads, wider pool |
| `bollardLight` | lamp | ground | 1×1 | exists — ankle-height, small tight pool |
| `highMastLight` | lamp | ground | 3×3 | tall parking-lot mast, large soft pool |
| `floodLight` | flood | ground, **aimed** | 1×1 | reworked from `spotLight`; harsh cone |
| `wallSconce` | wall | wall edge | — | warm, small; indoor or facade |
| `bulkheadLight` | wall | wall edge | — | industrial cage fixture; corridors, exteriors |
| `ceilingPanel` | overhead | floor tile | 1×1 | cool-white office panel |
| `highBay` | overhead | floor tile | 1×1 | industrial cone for the experimental hall |

Color temperature is a deliberate axis: sodium/warm for outdoor lamps, warm
for sconces, cool white for office panels, harsh near-white for floods and
high bays. A facility built at night should read as several distinct kinds of
light, not one orange wash.

## 5. Data shape and registry placement

**Fixtures stay `kind: 'decoration'`** with `category: 'lighting'`. They are
not a new placeable kind.

This is deliberate. `Placeable` validates kind against a fixed list
(`Placeable.js:12`), and `'decoration'` is load-bearing in at least
`demolishScopes.js:31`, `world-snapshot.js:306`, `Game.js:1928` (id prefix),
`Game.js:3608`, `mode-tools.js:85`, `placement-tools.js:64` and
`InputHandler.js:2616`. Introducing `kind: 'lighting'` would mean touching
every one of those to teach it that lighting is decoration-like — pure churn
for a distinction that buys nothing.

**Ground and overhead fixtures are ordinary placeables** in `state.placeables`,
so demolish, save/load, snapshot and palette keep working untouched for seven
of the nine fixtures. **Wall fixtures are the exception**: they key on a wall
edge rather than a tile, so they cannot live in `state.placeables` and need
their own store plus explicit handling in demolish scoping, save/load and the
world snapshot (see §6). That cost is unavoidable — it is inherent to being
edge-mounted, not a consequence of the kind choice.

Two new fields discriminate behavior:

- **`mount`** — `'ground' | 'wall' | 'overhead'`. Drives placement path and
  render height only.
- **`light`** — the illumination block, read uniformly by the renderer
  regardless of mount: emitted color, intensity, pool radius, beam shape
  (`point` or `cone`), cone half-angle and tilt where relevant, and the
  emitter's height above its mount point.

Defs live in a new `src/data/placeables/lighting.js` feeding `ALL_DEFS` in
`placeables/index.js`, alongside the existing per-kind def files. The three
reworked fixtures move out of `decorations.raw.js` into it, so there is one
source of truth for anything with a `light` block.

`src/data/validate.js` gains a rule: any def carrying `light` must declare a
valid `mount`, a positive `energyCost`, and a positive pool radius.

## 6. Placement mechanics per mount

### Ground (`lamppost`, `doubleLamppost`, `bollardLight`, `highMastLight`, `floodLight`)

No new mechanism. Existing outdoor decoration placement, palette entry,
preview and demolish all apply unchanged.

### Aim, for `floodLight`

A flood that cannot be pointed is not a flood. Add a `dir` field (`0–7`,
compass octants) to the placed record. Clicking an already-placed flood cycles
`dir`, reusing the click-to-cycle path that already handles decoration variants
at `InputHandler.js:2616` — same gesture, same discoverability, no new UI. The
fixture yaws to match and its pool becomes an ellipse thrown along `dir`.

Note that ground decorations currently take a deterministic random yaw from an
rng (`decoration-builder.js:428`). Fixtures with a `dir` must opt out of that.

### Wall (`wallSconce`, `bulkheadLight`)

The one genuinely new placement path. Wall fixtures key on
`` `${col},${row},${edge}` `` — the exact scheme `wallOccupied` and
`doorOccupied` already use (`networks/rooms.js`), so the concept is precedented
even though the entity is new.

- Stored in `state.wallFixtures`, keyed by that string — not in
  `state.placeables`. Save/load, demolish scoping (`demolishScopes.js`) and
  the world snapshot each need an explicit branch for this store.
- Placement requires an existing wall on that edge, and rejects an edge that
  already carries a fixture. A door on the edge does not block a fixture.
- The tool snaps to wall edges — reuse the edge-snapping already implemented
  for walls and doors in `src/input/structure-tools.js`.
- **Which face** the fixture mounts on is decided by which side of the wall
  the cursor is on at placement, so the same edge can light a corridor or a
  facade. Store the face alongside the fixture.
- Demolishing the wall demolishes its fixtures.

### Overhead (`ceilingPanel`, `highBay`)

There are no ceilings and this design does not add any. The convention:

> An overhead fixture is placed on a floor tile and renders **hanging at wall
> height (1.5 m) on a short stem or chain**.

Against the surrounding wall tops it reads as ceiling-mounted, which is all it
needs to do. Requirement is **flooring on the tile** — not membership in a
detected room. Requiring a sealed room would make the fixture unplaceable in
exactly the half-built spaces where a player wants to see progress, and
`detectRooms` is not free.

Overhead fixtures do not block build and do not collide with tile-placed
furnishings beneath them.

## 7. Power draw — aggregate, not cabled

Every fixture carries `energyCost` in kW. A new `lightingEnergyDraw(state)` in
`src/game/aggregates.js` sums it across placed fixtures (all three mounts) and
folds into `facilityEnergyDraw` (`aggregates.js:75`). That single change puts
lighting into both the power panel's utilization figure and the electricity
bill, because both already derive from that function
(`economy.js:181`, `economy.js:546`) — the spec's own comment insists the bill
and the panel must not disagree, and routing through `facilityEnergyDraw`
honors it.

**Lights are not individually wired with the cable tool.** No `pwr_in` port, no
utility-line connection, no per-fixture powered state. Cabling forty lamps is
tedium, not gameplay, and real facilities run lighting off general building
service rather than dedicated feeders. A fixture is lit whenever it is dark.

Draw values are chosen so lighting is a small but visible fraction of a
facility's load — tens of fixtures should be a noticeable line on the bill
against a `powerPanel`'s 40 kW capacity, never the dominant term. Sconces and
panels are near-free; high masts, floods and high bays are where the cost is.

**The hook this leaves:** once lighting draw can push a facility past its power
capacity, "over capacity → lights brown out" is the natural first gameplay
consequence, and it needs no new data. That belongs to the deferred pass.

## 8. Performance budget

The failure mode is a player who places sixty lamps.

- Pool and halo geometry is merged/instanced and rebuilt **on change only** —
  fixture added or removed, or the darkness curve crossing a threshold. Never
  rebuilt per frame.
- The real-light array is allocated once at init. Per-frame work is a distance
  sort over fixtures and an intensity lerp — no allocation, no light count
  change, no shader recompile.
- Fixture geometry participates in the existing LOD path (`lod: 'detail'`,
  `ThreeRenderer.js:2955`) so lamp detail drops out when zoomed away.
- Pools and halos are additive and depth-tested but do not write depth.

## 9. Files touched

| File | Change |
|---|---|
| `src/data/placeables/lighting.js` | **new** — the nine fixture defs |
| `src/data/placeables/index.js` | register the new def file |
| `src/data/decorations.raw.js` | remove the three reworked fixtures |
| `src/data/validate.js` | validation rule for `light` blocks |
| `src/renderer3d/lighting-builder.js` | **new** — fixture geometry, pools, halos, the real-light pool |
| `src/renderer3d/ThreeRenderer.js` | read `timeOfDay`; night ambient ramp; wire the lighting builder and its group |
| `src/renderer3d/decoration-builder.js` | drop the three fake fixture builders |
| `src/renderer3d/world-snapshot.js` | emit wall fixtures and overhead fixtures into the snapshot |
| `src/game/Game.js` | `timeOfDay` advance; `isNight` derivation; wall-fixture place/remove |
| `src/input/demolishScopes.js` | teach demolish about the wall-fixture store |
| `src/game/Game.js` (`serialize`/`deserialize`) | persist `state.wallFixtures` and `timeOfDay` |
| `src/game/aggregates.js` | `lightingEnergyDraw`, folded into `facilityEnergyDraw` |
| `src/input/structure-tools.js` | wall-fixture placement tool |
| `src/input/InputHandler.js` | flood `dir` cycling on click |
| `src/ui/hud.js` | palette entries for the lighting category |

## 10. Testing

Node tests:

- Content validation — every `light`-bearing def has a valid `mount`, positive
  `energyCost`, positive pool radius; ids unique across the registry.
- `lightingEnergyDraw` sums all three mounts, and `facilityEnergyDraw` includes
  it; a facility with no fixtures is unchanged from today.
- `timeOfDay` advances, wraps at 1, and `isNight` agrees with it at midnight,
  noon and both crossings.
- Wall-fixture keying — place, reject duplicate on the same edge, reject an
  edge with no wall, allow an edge with a door, remove with the wall.
- Flood `dir` cycles 0→7→0 and survives a save/load round trip.

Playwright:

- A screenshot with `timeOfDay` forced to midnight, with fixtures placed —
  the regression guard for "night went bright again" and "pools stopped
  drawing". The clock unification is what makes this expressible.

## Deferred gameplay effects

Specified here so the follow-up pass has a starting point. **None of this is
built in this spec.**

The enabling primitive is a per-room and per-area **lit query**: given a tile,
is it within the pool of a fixture right now? Pool radii already exist for the
visuals, so the query is geometry the renderer is computing anyway — it should
be lifted into shared code rather than re-derived.

- **Room morale penalty** — an unlit room contributes negative morale through
  the existing per-room path (`computeRoomMorale`, `Game.js:3480`), which
  already aggregates furnishing morale by room.
- **Night-shift productivity** — research progress and staff task speed scale
  down in unlit rooms while `isNight`.
- **Safety / incident risk** — unlit areas raise incident chance, fitting the
  facility's safety-culture theme.
- **Reputation rating** — facility-wide lit coverage feeds the reputation tier
  that already drives grant income (`getReputationTier`).

The brown-out behavior described in §7 belongs to this pass as well.

## Defaults chosen without asking

These are all one-constant taste knobs, recorded so they are easy to find and
argue with later:

- Day length 240 ticks (4 real minutes at 1×) — matches the existing sim cycle.
- Deep-night ambient 0.35, down from a pinned 1.3.
- 12 real lights in the fixed pool.
- Nine fixtures, two per new mount type.
- Overhead fixtures need flooring, not a sealed room.
