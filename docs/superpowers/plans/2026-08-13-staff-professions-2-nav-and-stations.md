# Staff Professions — Plan 2: Navigation and Work Stations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pawns path around walls to a specific piece of furniture, claim a slot
on it, and sit down in an adjacent chair — with no job system driving them yet.

**Architecture:** A subtile-resolution A* grid derived from `infraOccupied`,
`wallOccupied`/`doorOccupied`, and `subgridOccupied`, reusing the exact edge
test `networks/rooms.js` already implements so a wall means one thing in the
game. Furniture defs gain an optional `station` block and chairs gain a `seat`
block; a station index resolves those into concrete world anchors with a
reservation table. `StaffPawns` swaps its straight-line walk for path following
and gains a pose state machine; the figure builder gains a knee so a seated pawn
does not fold flat.

**Tech Stack:** Vanilla ES modules, node test runner (`npm test` →
`scripts/run-tests.mjs` over `test/*.js`), Three.js (CDN global — never import
it), Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-08-13-staff-professions-and-work-design.md`

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-08-13-staff-professions-1-data-model.md`)
must be complete — `member.profession` and `member.specialty` are assumed
throughout.

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
- **Grid units, memorise these:** a tile is 2 world units; a tile is 4×4
  subtiles; a subtile is 0.5 world units. Tile `(col,row)` spans world
  `[col*2, col*2+2)`. `StaffPawns` already uses tile-centre world coordinates
  (`col*2 + 1`).
- **One source of truth for walls.** Do not write a second wall-blocking test.
  Export and reuse the one in `src/networks/rooms.js`.
- **No behaviour change to the sim.** No gate moves in this plan. Pawns move
  differently and can sit; nothing they do affects beam, repair, data, or money.
- Three.js is a CDN global in renderer files. Do **not** add an import.
- New tests are `test/*.js`, run by `node test/<file>.js`; failure is signalled
  by a non-zero exit code.

---

### Task 1: Export the wall test, add a nav revision

Two small seams the rest of the plan is built on. Kept separate because they
touch shared files that later tasks must not re-edit.

**Files:**
- Modify: `src/networks/rooms.js:18-33` — export `isBlocked`
- Modify: `src/game/Game.js` — add `state.navRevision` and `_markNavDirty()`
- Test: `test/test-nav-revision.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isBlocked(col, row, edge, state)` — now exported from
    `src/networks/rooms.js`. Signature and behaviour unchanged: `edge` is one of
    `'n' | 'e' | 's' | 'w'`, `state` needs only `wallOccupied` and
    `doorOccupied`. Returns `true` when a wall blocks and no door opens it.
  - `state.navRevision` — integer, starts at 0, incremented by `_markNavDirty()`.
  - `Game._markNavDirty()` — bumps the revision.

Step 1 of the implementation is to enumerate, by grep, every seam in `Game.js`
that mutates `infraOccupied`, `wallOccupied`, `doorOccupied`, or `placeables` —
placement, demolition, zone paint that replaces floors, scenario apply, save
load, and map growth. Call `_markNavDirty()` from each. List the seams you found
in the commit message body so a reviewer can check the set.

A count-based cache signature is **not** acceptable here: demolishing one wall
and placing another in the same tick leaves every count unchanged while the
topology has moved.

- [ ] **Step 1: Write the failing test**

`test/test-nav-revision.js` asserts:
- `isBlocked` is importable from `src/networks/rooms.js` and returns `false`
  with empty wall/door maps, `true` with a wall, and `false` again once a door
  is added on either of the two equivalent keys (`col,row,edge` and the
  neighbour's opposite edge).
- A fresh game has `navRevision === 0`.
- Placing a floor tile bumps it; removing one bumps it again.
- Placing a wall bumps it; adding a door bumps it.
- Placing a furnishing bumps it.
- A demolish-and-replace pair in the same tick bumps it twice, not zero times.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-nav-revision.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-nav-revision.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): export wall test, add nav revision" -- src/networks/rooms.js src/game/Game.js test/test-nav-revision.js
```

---

### Task 2: The navigation grid and A*

**Files:**
- Create: `src/game/staff/nav.js`
- Test: `test/test-staff-nav.js` (create)

**Interfaces:**
- Consumes: `isBlocked` from Task 1; `state.infraOccupied`,
  `state.wallOccupied`, `state.doorOccupied`, `state.subgridOccupied`,
  `state.navRevision`.
- Produces:
  - `buildNavGrid(state)` → a `NavGrid`: `{ revision, passable, cost, bounds }`,
    where `passable` is a `Set` of subtile keys `"col,row,subCol,subRow"` and
    `cost` maps a key to a movement multiplier.
  - `getNavGrid(state)` → memoised `buildNavGrid`, rebuilt only when
    `state.navRevision` differs from the cached grid's `revision`.
  - `findPath(nav, from, to)` → array of subtile nodes from `from` to `to`
    inclusive, or `null` when unreachable. `from`/`to` are subtile coords
    `{ col, row, subCol, subRow }`.
  - `isReachable(nav, from, to)` → boolean; may short-circuit without building
    the full path.
  - `worldToSubtile(x, z)` and `subtileToWorld(node)` — the coordinate bridge,
    `subtileToWorld` returning the subtile **centre** in world units.

Passability rules:
- A subtile inside a tile present in `infraOccupied` is passable at cost 1.
- A subtile on bare ground (no floor) is passable at cost 2.5, so pawns will
  cross grass to reach a detached building but strongly prefer floors.
- A subtile in `subgridOccupied` is impassable **unless** its entry's def is
  `stackable`, has `subH <= 1`, **or carries a `seat` block** — small desktop
  items do not block a doorway, and a chair is something you walk into rather
  than around. Resolve the def through `state.placeableIndex` to get the entry
  (`subgridOccupied` stores the placeable **instance** id), then
  `PLACEABLES[entry.type]`.

  **Chairs must be passable, and this is load-bearing, not a detail.** Every
  chair in the repo has `subH: 2` (see `officeChair`), so a naive
  height-based rule makes them solid — and a seated pawn's final position *is*
  the chair's tile. Get this wrong and no staffer can ever sit down, which is
  the headline feature of this plan.
- Movement is 4-directional only. No diagonals — a diagonal step between two
  tiles would need both shared edges tested and buys nothing at this
  resolution.
- A step between two subtiles that lie in **different tiles** is blocked when
  `isBlocked` says so for the crossed edge. Steps within a tile are never
  wall-blocked.
- Bound the search: reject any `findPath` whose start or goal lies outside
  `bounds` (the bounding box of `infraOccupied` inflated by 8 tiles), and cap
  expanded nodes at 20000, returning `null` on exhaustion. An unbounded A* over
  open grass will otherwise walk forever.

Use a binary heap for the open set, not an array scan — a 25-pawn facility
re-paths often enough that the difference is real.

- [ ] **Step 1: Write the failing test**

`test/test-staff-nav.js` builds small hand-made states and asserts:
- Straight-line path across an open 5×1 tile floor has the expected length.
- A wall bisecting a room makes the far side unreachable — `findPath` returns
  `null`, `isReachable` returns `false`.
- Adding a door in that wall makes it reachable again, and the path passes
  through the door's tile.
- A path routes **around** a blocking 3×2 placeable rather than through it.
- A `stackable` desktop item does not block.
- A detached floor patch across bare ground is reachable, and the returned path
  prefers floor subtiles over grass where both are available (compare total cost
  against a forced-grass route).
- `worldToSubtile` and `subtileToWorld` round-trip a subtile centre.
- `getNavGrid` returns the identical object on a second call, and a different
  one after `navRevision` bumps.
- A goal outside `bounds` returns `null` rather than hanging.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-nav.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-staff-nav.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): subtile A* navigation grid" -- src/game/staff/nav.js test/test-staff-nav.js
```

---

### Task 3: Station and seat schema on placeable defs

Data only. No consumer yet.

**Files:**
- Modify: `src/data/facility-room-furnishings.raw.js` — `operatorConsole`,
  `desk`, `workstation`, `receptionDesk`, `conferenceTable`, `diningTable`,
  `monitorBank`, and the six chairs
- Modify: `src/data/facility-lab-furnishings.raw.js` — `labBench`,
  `oscilloscope`, `networkAnalyzer`, `spectrumAnalyzer`, `testChamber`, `rga`,
  `heatExchanger`, `flowMeter`, `opticalTable`, `scopeStation`, `daqRack`,
  `lathe`, `millingMachine`, `cncMill`, `drillPress`, `toolChest`, `workCart`
- Modify: `src/data/validate.js` — validate the new blocks
- Test: `test/test-station-schema.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces, as optional def fields:
  - `station: { jobs, slots, seated, anchors }` — `jobs` is an array of job-type
    ids (Plan 3 defines the vocabulary; author the strings now:
    `runBeam`, `repair`, `labWork`, `commission`, `takeData`, `analyze`,
    `fabricate`, `paperwork`, `meet`, `eat`, `rest`). `slots` is a positive
    integer. `seated` is `'required' | 'preferred' | 'never'`. `anchors` is an
    array of `{ subCol, subRow, facing }` **in def-local subtile space at
    `dir: 0`**, one per slot, where the pawn stands or sits; `facing` is
    `'n' | 'e' | 's' | 'w'`.
  - `seat: { facing }` on chairs — `facing` is the direction the sitter looks at
    `dir: 0`. For every chair in the repo that is `-Z`, i.e. `'n'`, because the
    backrest parts sit at `+Z`.

Assignment guide — `slots` and `jobs` per station family:

| Def | jobs | slots | seated |
|---|---|---|---|
| `operatorConsole` | `runBeam` | 1 | `preferred` |
| `monitorBank` | `runBeam` | 1 | `preferred` |
| `desk`, `workstation` | `analyze`, `paperwork` | 1 | `preferred` |
| `receptionDesk` | `paperwork` | 1 | `preferred` |
| `conferenceTable` | `meet` | 6 | `required` |
| `diningTable` | `eat` | 4 | `required` |
| `labBench` | `labWork` | 2 | `never` |
| RF/vacuum/cooling/optics/diagnostics instruments | `labWork` | 1 | `never` |
| `opticalTable` | `labWork`, `takeData` | 2 | `never` |
| `scopeStation`, `daqRack` | `takeData` | 1 | `preferred` |
| `lathe`, `millingMachine`, `cncMill`, `drillPress` | `fabricate` | 1 | `never` |
| `toolChest`, `workCart` | `rest` | 1 | `never` |

Place each anchor on a subtile **immediately outside** the def's own footprint,
on the face a person would work from. Equipment in this repo declares its front
as `+Z` — that is the face carrying the `*_front` decal in its `faces` block —
so the anchor goes on the **`+Z` side**, i.e. `facing: 'n'`, so the pawn stands
in front of the machine looking at it. A station whose anchor lands inside its
own footprint, or behind the machine, will never be usable.

**Direction correspondence — verify this before authoring anchors, nothing else
in the repo writes it down.** `src/data/directions.js` defines
`DIR = { NE: 0, SE: 1, SW: 2, NW: 3 }` with deltas that line up exactly with the
`n`/`e`/`s`/`w` edges `rooms.js` uses, and with world axes as follows:

| `dir` | `DIR` name | `(dc, dr)` | `rooms.js` edge | world axis |
|---|---|---|---|---|
| 0 | NE | `(0, -1)` | `n` | `-Z` |
| 1 | SE | `(1, 0)` | `e` | `+X` |
| 2 | SW | `(0, 1)` | `s` | `+Z` |
| 3 | NW | `(-1, 0)` | `w` | `-X` |

So `facing` values map to `dir` indices 1:1, and rotating a def-local anchor by
its instance `dir` is a rotation by that many quarter-turns. Chairs put their
backrest at local `+Z` (see the `back` part on `officeChair`), so a sitter looks
along `-Z` — `seat: { facing: 'n' }` — which is what the table above requires.

`validate.js` gains checks: `slots` matches `anchors.length`; `seated` is one of
the three literals; every job id is in the vocabulary above; every anchor lies
outside the def's own `subW`×`subL` footprint; `seat.facing` is a cardinal.

- [ ] **Step 1: Write the failing test**

`test/test-station-schema.js` asserts, over all of `PLACEABLES`:
- Every def with a `station` passes each `validate.js` rule above.
- Every def in the assignment table has a `station`, with the listed `jobs` and
  `slots`.
- All six chairs have a `seat` with a cardinal `facing`.
- No chair has a `station` — chairs are matched by adjacency, never worked
  directly.
- Every job id used anywhere in the data appears in the vocabulary list.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-station-schema.js`
Expected: FAIL.

- [ ] **Step 3: Author the station and seat blocks**

- [ ] **Step 4: Run test, then the full suite**

Run: `node test/test-station-schema.js` then `npm test`
Expected: PASS — `validate.js` runs over the whole catalogue, so a bad anchor
fails here.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(facility): station and seat blocks on furnishings" -- src/data/facility-room-furnishings.raw.js src/data/facility-lab-furnishings.raw.js src/data/validate.js test/test-station-schema.js
```

---

### Task 4: The station index, seat matching, and reservations

**Files:**
- Create: `src/game/staff/stations.js`
- Modify: `src/game/Game.js` — add `state.stationReservations` to the state
  init and to both serialize/deserialize key lists (`:51-59`, `:113`)
- Test: `test/test-staff-stations.js` (create)

**Interfaces:**
- Consumes: Task 2's nav helpers, Task 3's def blocks,
  `state.placeables`/`placeableIndex`, `state.zoneOccupied`.
- Produces:
  - `StationRef` — plain object
    `{ key, placeableId, defId, slotIndex, jobs, node, facing, seated, seatPlaceableId, zoneId }`.
    `key` is `` `${placeableId}:${slotIndex}` ``. `node` is the anchor's absolute
    subtile coord. `seated` is the **resolved** boolean (did a matching chair
    turn up), not the def's preference string.
  - `buildStationIndex(state)` → `{ revision, byKey, byJob }`, where `byJob` maps
    a job id to an array of `StationRef`.
  - `getStationIndex(state)` → memoised on `state.navRevision`.
  - `reserveStation(state, key, staffId)` → boolean. Fails when the slot is held
    by a different staff id. Re-reserving your own slot succeeds.
  - `releaseStation(state, key, staffId)` → boolean. Releasing a slot you do not
    hold is a no-op returning `false`, never a throw.
  - `releaseAllFor(state, staffId)` — the safety net; releases every slot held by
    one staffer.
  - `findStation(state, { jobs, specialty, fromNode, staffId })` → the nearest
    free, **reachable** `StationRef` matching any of `jobs`, or `null`.

Reservations live in `state.stationReservations`, a plain `key → staffId` map,
serialized with the rest of state. On load, clear any reservation whose staff id
is not in the roster and any whose key is not in the current index — a
reservation surviving its station is the leak the spec calls out.

Anchor resolution: rotate the def-local `{ subCol, subRow, facing }` by the
instance's `dir` about the footprint centre, using the same convention
`Placeable.footprintCells` uses for `dir: 1/3` swapping `subW`/`subL`, then
offset by the instance origin. Get this wrong and every rotated console is
unreachable, so it gets its own test.

Seat matching: for a station with `seated !== 'never'`, look for a chair
placeable whose own tile is cardinally adjacent to the anchor's tile and whose
resolved `seat.facing` points at the anchor. Found → `seated: true` and
`seatPlaceableId` set. Not found → `seated: false`, and if the def said
`'required'` the station is **omitted from the index entirely** (a dining table
with no chairs is not an eating spot). If the def said `'preferred'`, keep it
with `seated: false`.

**Where the worker actually stands — spell this out, the two cases differ.**
`StationRef.node` is the *nav target*, and it is not the same subtile in both
cases:

- `seated: false` → `node` is the station's own anchor subtile. The pawn stands
  there facing `facing`, pose `benchWork`.
- `seated: true` → `node` is the **chair's** seat subtile, and `facing` is the
  chair's resolved facing (which by construction points at the station). The
  pawn paths into the chair and adopts pose `sit`. Its world position is the
  chair's seat, not the desk's edge.

This is why chairs must be passable in the nav grid. A seated pawn's destination
is a tile the chair occupies; if the grid calls that solid, `findPath` returns
`null` and the station is silently unusable forever. Carry both cases in the
`StationRef` so `StaffPawns` needs no special-casing: it walks to `node`, faces
`facing`, and adopts the pose the ref names.

`findStation` must call `isReachable` before returning — the spec is explicit
that reachability is checked at offer time, not after a pawn commits.

- [ ] **Step 1: Write the failing test**

`test/test-staff-stations.js` asserts:
- A placed `operatorConsole` yields one `StationRef` under job `runBeam`, whose
  `node` is outside the console's footprint and on a passable subtile.
- The same console at `dir: 1`, `2`, and `3` yields anchors that are still
  outside the footprint and still passable — rotation correctness.
- A `desk` with an `officeChair` on the adjacent tile facing it resolves
  `seated: true` with the chair's id; rotate the chair away and it becomes
  `seated: false`.
- That seated ref's `node` is the **chair's** subtile, not the desk's anchor,
  and `findPath` to it succeeds — the direct regression test for chair
  passability. The same ref when `seated: false` targets the desk's anchor
  instead.
- A chair subtile is passable in the nav grid; a `desk` subtile is not.
- A `diningTable` (`seated: 'required'`) with no chairs is absent from the
  index; add one chair and it appears with one usable slot.
- `reserveStation` succeeds once, fails for a second staffer, and succeeds again
  for the original holder.
- `releaseStation` by a non-holder returns `false` and leaves the holder intact.
- `releaseAllFor` clears every slot held by one staffer across multiple
  stations.
- `findStation` skips a reserved station and returns the next nearest.
- `findStation` returns `null` when the only matching station is walled off with
  no door, and returns it once a door is added.
- Deserializing a state whose `stationReservations` name a demolished station or
  a fired staffer drops those entries.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-stations.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-staff-stations.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): station index, seat matching, and slot reservations" -- src/game/staff/stations.js src/game/Game.js test/test-staff-stations.js
```

---

### Task 5: The knee joint and pose states

Renderer-only. Do this before path following so a pawn that arrives somewhere has
something to do when it gets there.

**Files:**
- Modify: `src/renderer3d/builders/staff-builder.js` — leg construction, the
  `StaffStyle` typedef, and the figure record returned by `buildStaffFigure`
- Modify: `staff-foundry.html` — add a pose row
- Test: **extend `test/test-staff-builder.js`** — it already carries a complete
  headless THREE stub (`Obj3D`, `Vec3`, geometry dimension recording) built for
  exactly this, and already guards figure origin, shadow flags, and role tells.
  Assert joint rotations and part hierarchy there. Do **not** reach for
  Playwright: these are geometry facts, and the stub asserts them faster and
  more precisely than a browser screenshot can.
- Test: `test/browser/staff-poses.spec.js` (create, Playwright) — smoke only:
  the foundry page renders the pose row and logs no console errors.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Legs become two segments. `buildStaffFigure` returns
    `{ ..., leftLeg, leftShin, rightLeg, rightShin }` — `leftLeg` keeps its
    existing name and meaning (the thigh, pivoting at the hip), `leftShin` is a
    **child** of it pivoting at the knee, and the foot becomes a child of the
    shin. Existing walk code that rotates `leftLeg.rotation.x` keeps working
    unchanged with the shin at zero rotation.
  - `POSES` — `{ stand, walk, sit, deskWork, benchWork, carry, push }`, each a
    plain description of joint targets: `{ hip, knee, torsoLean, armL, armR, headTilt }`
    in radians.
  - `applyPose(figure, poseId, t)` — eases the figure's joints toward the named
    pose's targets, `t` being the frame's easing factor, using the same
    `1 - Math.exp(-dt / TAU)` idiom `StaffPawns._animate` already uses. Walk
    swing composes on top of `stand`; it must not fight `sit`.
  - `staffStyleHipHeight(style)` → the world-space Y of the hip joint, so a
    caller can drop a sitting figure to a chair's seat height.

Sitting geometry: hip rotates forward ~90°, knee back ~90°, so thigh is
horizontal and shin vertical. The figure's origin is at the feet by convention;
when sitting, the caller raises the whole group so the hip lands at seat height
rather than the builder moving parts around — keep the origin contract intact.

Extend the foundry page with a row rendering every pose for the default style,
beside the existing style gallery.

- [ ] **Step 1: Write the failing test**

Extend `test/test-staff-builder.js` (headless, via its existing THREE stub):
- `buildStaffFigure` returns `leftShin`/`rightShin`, and each shin's `parent` is
  the matching thigh, and each foot's parent is the matching shin.
- With every rotation at zero the figure's total height and foot position are
  **unchanged from before this task** — the knee at rest must be a no-op. Assert
  against `staffFigureHeight(style)` exactly as the existing origin tests do.
- `applyPose(figure, 'sit', 1)` drives the hip toward ~+π/2 and the knee toward
  ~−π/2, and `applyPose(figure, 'stand', 1)` returns both to ~0.
- `POSES` has all seven keys, and every pose's joint targets are finite numbers.
- `staffStyleHipHeight(style)` is between 0 and `style.height`.

Then a Playwright smoke spec `test/browser/staff-poses.spec.js`: the foundry's
pose row renders seven labelled figures with no console errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-staff-builder.js`
Expected: FAIL on the new assertions, PASS on the pre-existing ones.

- [ ] **Step 3: Implement**

Geometry and material caching is module-level and keyed on dimensions and colors
— a shin is a new cache key, not a per-figure geometry. `disposeStaffFigure` must
keep only detaching; it must not dispose the shared shin geometry.

- [ ] **Step 4: Run the test, then check the walk still reads**

Run: `node test/test-staff-builder.js`, then `npm test`, then
`npx playwright test test/browser/staff-poses.spec.js`
Expected: PASS, **including every assertion that already existed in
`test-staff-builder.js`** — those guard figure origin and shadow flags, and a
knee that breaks them is a regression, not a new feature.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): knee joint and pose state targets" -- src/renderer3d/builders/staff-builder.js staff-foundry.html test/test-staff-builder.js test/browser/staff-poses.spec.js
```

---

### Task 6: Pawns follow paths and occupy stations

**Files:**
- Modify: `src/renderer3d/StaffPawns.js` — `_pickTarget` `:239`, `update` `:260`,
  `_animate` `:313`, `_walkableTiles` `:196` (deleted, nav replaces it)
- Test: `test/test-pawn-pathing.js` (create) — exercise the pure movement
  helpers headlessly; extract them from `StaffPawns` if they are not already
  callable without a scene

**Interfaces:**
- Consumes: Task 2's `getNavGrid`/`findPath`, Task 4's station index and
  reservations, Task 5's `applyPose`.
- Produces:
  - `pawn.path` — array of nodes, and `pawn.pathIndex`.
  - `pawn.pose` — a `POSES` key, driven by pawn mode.
  - `pawn.stationKey` — the reserved slot, or `null`.
  - `StaffPawns.setDestination(pawnId, node)` and
    `StaffPawns.sendToStation(pawnId, stationRef)` — the seams Plan 3's job
    system will drive.

Behaviour in this plan, with no job system: a pawn with no station picks a random
**reachable** station matching any job, reserves it, walks there, adopts the
station's pose (`sit` when `seated`, `benchWork` otherwise), holds it for
20-60 seconds, releases, and picks another. If no station is reachable it falls
back to the current random amble. This is throwaway driving logic — Plan 3
replaces it wholesale — so keep it to a few lines and mark it clearly as such.

Path following: walk toward the next node's world centre; on arrival advance
`pathIndex`. Keep the existing heading easing, distance-driven stride phase, and
bob exactly as they are — the stride must still lock to speed. On the final node,
snap to the station anchor, face its `facing`, and switch pose.

Re-path when `navRevision` changes mid-walk; if the new path is `null`, release
the reservation and go idle with the ambling fallback. A pawn stranded by a
demolished floor must never freeze mid-stride.

- [ ] **Step 1: Write the failing test**

`test/test-pawn-pathing.js` asserts:
- A pawn given a destination across a doorway produces a path whose nodes are all
  passable and which ends on the destination.
- Advancing the pawn by many small `dt` steps lands it within a subtile of the
  destination and leaves `pathIndex` at the end.
- Demolishing the floor mid-path releases the station reservation and clears
  `pawn.path`.
- A pawn arriving at a `seated: true` station has `pose === 'sit'`; at a
  `seated: false` one, `pose === 'benchWork'`.
- Every reservation a pawn takes is released when it is destroyed via
  `_destroyPawn` — no leak on fire or on `sync()` removal.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-pawn-pathing.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test, then the full suite, then look at it**

Run: `node test/test-pawn-pathing.js` then `npm test`
Expected: PASS. Then watch the game: pawns should walk through doors rather than
through walls, and should be sitting in chairs.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(staff): pawns path to and occupy stations" -- src/renderer3d/StaffPawns.js test/test-pawn-pathing.js
```

---

## Done when

`npm test` passes, and in the running game staff walk through doorways instead of
through walls, sit down in chairs at desks and consoles, and never strand
themselves or leak a reservation when the building changes around them. Nothing
they do yet affects the economy.
