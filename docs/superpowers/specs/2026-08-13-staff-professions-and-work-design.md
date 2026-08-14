# Staff Professions and Work — Design Spec

**Date:** 2026-08-13
**Scope:** Professions, labor economy, navigation, work stations, job system, pawn presentation
**Supersedes:** `2026-08-05-rimworld-staff-design.md`

## Problem

Staff are decoration. The 2026-08-05 spec delivered individuals — named pawns with
traits, skills, needs, and moods — and the figurines that walk around the facility. What
it deliberately did not deliver, and listed as a non-goal, was pathfinding or physical
work: "pawns are HUD portraits + abstracted location, not walkers." Pawns became walkers
anyway, but the walking is a random amble between floor tiles, weakly biased toward an
assigned zone.

The consequences show up everywhere:

- **Effects are aggregate multipliers.** One working operator existing *anywhere* permits
  the beam. Technicians add repair rate from across the map. Scientists multiply data by
  `1 + 0.1n` regardless of where they stand. Engineers do nothing whatsoever.
- **Furniture is inert.** Six chair types, desks, workstations, operator consoles, lab
  benches, lathes, and DAQ racks are placed, paid for, rendered — and never used by
  anyone. A control room with four consoles works exactly as well as an empty one.
- **Zones are unearned.** Zone tier is pure tile count. Painting twenty tiles of `rfLab`
  and walking away unlocks RF component tiers with no one ever setting foot in it.
- **`engineer` is a vacant role**, and nothing in the game asks a machine shop or an
  office to do anything.

The facility is a beautiful place where nobody works.

## Goals

1. **Labor is a real constraint.** Beam, repair, research, and fabrication each require a
   specific person, of a specific profession, physically present at a specific station.
2. **Professions are legible and distinct** — in what they do, what they need from the
   player, and what they look like across the room.
3. **Existing furniture becomes load-bearing.** Chairs, desks, consoles, and machine tools
   acquire mechanical purpose without new art.
4. **Failures explain themselves.** With four hard gates and pathfinding in the mix, "why
   is nothing happening" must always have an answer on screen.
5. **Staff are people you remember** — bios, backstories, and careers that accumulate.

## Non-Goals

- Inter-staff relationships, rivalries, or romance. Additive later; a time sink now.
- Health physics, custodial, and student professions. Real roles, not load-bearing.
- Blueprint construction. Placement stays instant — the build loop is not being rewritten.
- Save compatibility. Pre-release, per CLAUDE.md; old saves may break.

## Design

### 1. Professions

Six professions. Engineers and scientists carry a **specialty**; nobody else does.

| Profession | Specialty axis | Primary skill | Home zone | Station |
|---|---|---|---|---|
| Operator | — | `operating` | `controlRoom` | `operatorConsole` |
| Technician | — | `technical` | `maintenance` | works at the failed node |
| Engineer | rf / vacuum / cooling / diagnostics / controls | `technical` | matching lab | lab equipment |
| Scientist | optics / diagnostics / userScience | `research` | `opticsLab`, `diagnosticsLab` | lab equipment, beamline endpoint |
| Machinist | — | `construction` | `machineShop` | `lathe`, `millingMachine`, `cncMill`, `drillPress` |
| Admin | — | `admin` *(new)* | `officeSpace` | `desk`, `workstation`, `receptionDesk` |

`admin` is a fifth skill alongside the existing four.

**Specialty crossover** is one number: a specialist working outside their specialty runs at
0.5× and gains no skill. No adjacency matrix, no partial credit table.

#### What each profession does

**Operator — runs the machine.** Seated at an `operatorConsole` in a `controlRoom`, an
operator permits beam on up to K beamlines, K scaling with `operating` skill and console
tier. Growing the facility therefore requires more consoles and more operators rather than
one lucky hire. Skill drives trip frequency: a green operator drops the beam more often.
Secondary job *fault recovery* — after a component failure an operator restores beam faster
than waiting on the repair.

**Technician — keeps it running.** Home base is a `toolChest`/`workCart` in a `maintenance`
zone, used as an idle and restock point; the work happens at the failure. The technician
paths to the failed beamline node, works in place standing, and consumes **spares**. With
nothing broken they perform *preventive maintenance*, topping up component health before it
fails.

**Engineer — improves the machine.** Works lab equipment in the zone matching their
specialty. This carries the single largest mechanical change in the spec: **zone tier stops
being pure tile count** and becomes tiles × output from engineers actually working in the
zone. An empty lab unlocks nothing. Secondary job *commissioning* — a newly placed
component of the engineer's specialty starts off-spec until an engineer tunes it.

**Scientist — produces data and reputation.** Two station families: lab equipment
(`opticalTable`, `scopeStation`, `daqRack`) and the **beamline endpoint itself**. A
beamline scientist seated at the experimental station is what makes data accrue, replacing
the flat `1 + scientists × 0.1` multiplier with presence. Secondary job *analysis* at an
office workstation, converting raw `data` into reputation and research progress.

**Machinist — makes parts.** Works a machine tool in the `machineShop` producing **spares**.
This turns the machine shop from a palette-unlock gate into a production building and gives
repair a supply chain instead of a cooldown.

**Admin — keeps money and people flowing.** At an office desk: files grant proposals
(reputation → funding), reduces hiring cost, accelerates candidate refresh, books user beam
time. Secondary job *meetings* — gathers N staff in a `meetingRoom` for a timed
facility-wide morale bump, finally giving meeting rooms a purpose.

### 2. Labor economy

Four hard gates. Construction is explicitly not among them.

| System | Old rule | New rule |
|---|---|---|
| Beam | ≥1 working operator exists anywhere | An operator is **seated at a console covering this beamline** |
| Repair | technician count × 2 HP | Technicians **at the node**, drawing down spares |
| Research / data | `1 + scientists × 0.1` | Scientists **at endpoint and lab stations** |
| Fabrication | — | Machinists **at machine tools**, producing spares |
| Construction | instant | instant (unchanged) |

**`spares` is a new resource**, alongside `funding`, `reputation`, and `data`. Produced only
by machinists. Consumed by technician repairs and by beamline component purchases, which
gain a spares cost alongside their funding cost. This is the one genuinely new economic
quantity in the spec; everything else re-plumbs numbers the sim already computes.

**Zone tier** becomes `f(tiles, staffed engineer output)` rather than tile count alone,
which retroactively gives every lab zone a staffing requirement.

### 3. Navigation

A* over floor tiles (`state.infraOccupied`), reusing the edge-blocking test that
`networks/rooms.js:isBlocked` already implements — walls block, doors open, and there is no
second source of truth for what a wall means.

- Grass is walkable at a movement penalty, so detached buildings stay reachable.
- Large equipment footprints block; small `stackable` items do not. `blocksWalk` derives
  from footprint and `hasSurface` rather than being authored per def.
- The nav grid caches and invalidates on the structure-change events that already fire.
- Pawns keep the current procedural stride verbatim. They follow a path instead of a
  straight line; `StaffPawns._animate` is untouched.

**Unreachable stations are the failure mode this introduces** — a console walled off with
no door, a lab reachable only through a demolished tile. Jobs must reachability-check
*before* being offered, never after a pawn has committed to one.

### 4. Work stations

One new optional block on furnishing and equipment defs:

```js
station: { jobs: ['runBeam'], slots: 1, seated: 'required' | 'preferred' | 'never',
           anchor: { dx, dz, facing } }
```

`anchor` is in subtile space relative to the placeable origin and rotates with `dir`, like
every other footprint quantity. `slots` is how many staff can work the station at once —
one for a console, more for a large bench.

**Chairs are not stations.** They get `seat: { facing }` and are matched to stations by
adjacency: a station is worked seated when a chair occupies an adjacent tile facing it,
otherwise the pawn stands at the anchor at reduced efficiency and faster fatigue. This is
what makes the six existing chair types load-bearing. A console without a chair still
works, just worse — the player feels the furnishing rather than being blocked by it.

Chair geometry already supports this: seat parts sit at y ≈ 0.8 subtiles with the backrest
at +Z, so local −Z is the facing direction.

### 5. Job system

A job board rescans the world every N ticks and emits offers:

```js
{ type, target, specialty, priority, reservedBy }
```

An idle staffer takes the highest-priority offer they are eligible for, tie-broken by path
length. Lifecycle: `reserve → path → travel → work → complete | abandon`.

**Abandon** on need threshold crossed, target demolished, station destroyed, or path lost.
Reservations release on every exit path, including abandonment — a leaked reservation
silently disables a station forever, so this is the highest-risk invariant in the system and
gets direct test coverage.

**Needs outrank all work.** A break is itself a job targeting a cafeteria seat station,
which means hunger and fatigue recovery become physical too.

### 6. Legibility

Every idle staffer carries a reason string, surfaced in `StaffInspector` and aggregated into
a facility-level banner: *"4 staff idle: no reachable operator console."*

This follows the precedent already set by `utility-gate.js:_unstaffedMessage`, which names
the actual cause rather than the symptom — distinguishing "no operator hired" from
"operators on break and hungry — build a cafeteria." With four hard gates and A* added,
this is not polish; it is the difference between a debuggable game and a mysterious one.

### 7. Bios

`StaffMember.history` exists and only ever receives a "hired" entry. The bio layer makes it
earn its place.

- **Names** gain first names instead of initials (`A. Kowalski` → full names), from a pool
  wide enough that a 25-person facility does not repeat.
- **Backstory** is one line of origin and is **mechanically loaded**: starting skill floors
  and ceilings, growth rate, salary expectation, and trait affinity. "Twelve years at a
  national lab" means high starting `technical`, high salary, slow growth. "Fresh PhD, no
  beam time" means low everything, cheap, high ceiling. "Ex-Navy reactor tech" means
  unshakeable morale and a hard cap on `research`. This is what makes the hiring screen a
  decision rather than a button.
- **Traits** expand past the current six and gain profession flavor.
- **History accumulates.** Once jobs are real there is a steady supply of recordable events:
  commissioned the first undulator, recovered the beam forty-seven times, fabricated two
  hundred spares, vented Hall B. After a few in-game months each staffer has a readable
  career.
- **Portrait** is a live render of that staffer's own head — same figure, same seeded face,
  same mood expression — via one small offscreen render.

Bio cards appear in both `StaffInspector` and the hiring candidate list.

### 8. Presentation

**Profession identity.** The `look` object grows past
`{skin, hair, coat, collar, trouser, hardHat}` into an outfit spec: a torso layer (lab coat,
coveralls, shirtsleeves, hi-vis), headwear (hard hat, bump cap, welding visor, headset,
bare), and a carried prop parented to a hand so it swings with the existing arm animation
for free.

| Profession | Torso | Headwear | Prop |
|---|---|---|---|
| Operator | shirtsleeves | headset | — |
| Technician | coveralls | hard hat | tool belt, wrench |
| Engineer | lab coat | bump cap | tablet |
| Scientist | lab coat | safety glasses | clipboard |
| Machinist | coveralls, hi-vis | welding visor | — |
| Admin | shirtsleeves | — | lanyard, coffee |

Three coat silhouettes × four headwear × props is enough to read a room's staffing at a
squint. **Specialty rides as an accent** on coat trim or hat band, colored from
`ZONES[id].color` — so a purple-trimmed vacuum engineer standing in the purple room is
consistent for free, with no new color authoring.

**Faces.** Currently two eye dabs and a mouth dab in one dark color, identical on every
staffer and static forever. Four additions in value order:

1. **Brows** — two dabs above the eyes whose angle encodes mood. In low-detail characters
   brows do nearly all the expression work, and this finally renders the needs system:
   `mood` is computed every tick and currently visible only inside a panel.
2. **Mouth curve** driven from the same mood, via a small set of cached geometries rather
   than per-figure geometry.
3. **A nose dab** — one small box, grounding the face at chibi scale.
4. **Eyewear**, doing double duty: safety glasses on scientists, welding visor on
   machinists. Face detail and profession identity in the same geometry.

Per-person variation (eye spacing, brow thickness, facial hair) seeds off the staff id
exactly as skin and hair do today.

**Face detail stays expression-bearing, not realism-bearing** — brows, mouth, eyewear; no
nostrils, ears, or teeth. The builder's own comment asks whether a face reads "charming or
creepy," and added detail cuts both ways at chibi scale. Everything remains geometry dabs
proud of the +Z head face per the file's existing convention: a texture smears at 30px where
a dab holds its silhouette. `staff-foundry.html` gains a mood row so all four expressions
can be judged side by side before shipping.

**Poses.** Sitting requires a real change — legs are single segments today, so a seated pawn
would fold at the hip with a rigid straight leg. Adding a knee pivot to the leg build fixes
sitting and is reusable for everything after: desk work (forward lean, arm-forward typing
jitter), bench work, carrying, cart-pushing, and idle fidgets so a stationary crowd is not
frozen. All procedural, driven from the same phase and eased-amplitude machinery `_animate`
already runs — no frames, consistent with how the builder is written.

**Crowd variety.** Wider height jitter, girth jitter, seeded glasses/beard/lanyard/backpack,
and deeper skin and hair ramps — all routed through the module-level geometry and material
cache so twenty-five staff still share a handful of geometries.

## Testing

The sim half is entirely headless and is where the risk lives: job board eligibility and
priority, A* correctness across walls and doors, reachability rejection, station matching
and chair adjacency, reservation release on every abandon path, and each of the four hard
gates. These test without a renderer.

The presentation half is judged in `staff-foundry.html`, extended with a mood row and
profession outfits, and by eye in the running game.

## Risks

**The facility goes dark on first run of phase 3.** No control room, no console, no seated
operator, no beam — until one is built. Saves are expendable per CLAUDE.md, but this
interrupts a live session rather than merely invalidating a file, and it should not be a
surprise when it happens.

**Reservation leaks silently disable stations.** Covered above; the reason it earns its own
risk entry is that the symptom (one console that nobody ever uses again) is nearly invisible
and looks like a job-priority bug.

**Unreachable stations produce idle crowds.** Mitigated by reachability-checking at offer
time and by the idle-reason strings, but it is the most likely source of "why is nothing
happening" reports.

**Face detail can tip from charming to creepy.** Mitigated by the foundry mood row and by
holding the line at expression-bearing detail.

## Phasing

Four implementation plans, in order:

1. **Data model** — professions, specialties, the five skills, `spares`, backstories and
   bios, hiring and inspector UI. No behavior change.
2. **Navigation and stations** — A*, station registry, chair adjacency, reservation, knee
   joint, functional sit and stand.
3. **Jobs and gates** — job board, per-profession jobs, the four hard gates, idle-reason
   legibility. *This is the phase the facility goes dark.*
4. **Presentation** — props, silhouettes, faces, pose polish, crowd variety.

Presentation goes last deliberately: it is the only phase evaluated by eye rather than by
test, and it is worth iterating on once the pawns are doing things worth watching.
