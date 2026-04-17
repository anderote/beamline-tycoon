# Junction / Pipe / Placement Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit-connectivity beamline model with an explicit port-based model. Junctions (grid-placed, port-bearing) are connected by pipes (straight, port-to-port); placements (cavities, BPMs, quads) live on pipes. Extract the beamline subsystem from Game.js/InputHandler.js into its own modules.

**Architecture:** `BeamlineSystem` facade is the sole mutator of pipes and junction placeables. UI goes through a new `BeamlineInputController`. Flattener becomes cycle-aware so rings work structurally. All the guessing-and-healing code (`tryInsertOnBeamPipe`, `_mergeWithAdjacentPipes`, `_resolveEndpointModules`, bridge-merge in `removePlaceable`, free-placement fallthrough) is deleted.

**Tech Stack:** Vanilla JS, existing placeables system, existing 3D renderer. Node-based tests in `test/` directory following the pattern of `test-insert-and-split.js`.

**Spec:** `docs/superpowers/specs/2026-04-17-junction-pipe-placement-design.md`

**No save migration.** Starting a new game after merge gets the new shape; old save files don't load. Per project CLAUDE.md.

**Game is broken during Phases C–F** and restored at end of Phase F. Commits during those phases land on master per project convention (dirty states are fine). Don't stop to fix partial UI breakage until the phase completes.

---

## File Structure

### New files
| Path | Responsibility |
|------|----------------|
| `src/beamline/BeamlineSystem.js` | Facade: `placeJunction`, `removeJunction`, `drawPipe`, `extendPipe`, `removePipe`, `placeOnPipe`, `removeFromPipe`, `placementAt`. Only module that mutates `state.beamPipes` and beamline placeables. |
| `src/beamline/junctions.js` | Pure helpers for junction placement: compatible-port lookup, port world position, port side → rotated direction. |
| `src/beamline/pipe-drawing.js` | `validateDrawPipe(state, start, end, path)` — straight-axis check, port compatibility, overlap rejection. Does not mutate state; returns an object describing what BeamlineSystem should push. |
| `src/beamline/pipe-placements.js` | `findSlot(pipe, position, subL, mode)` — replace/insert/snap slot resolution. Pure. Returns `{ placements: [...] }` describing the new ordering. |
| `src/beamline/flattener.js` | Renamed from `src/beamline/path-flattener.js`. Cycle-aware walker over junction/pipe graph. Single reader path for designer + physics. |
| `src/input/BeamlineInputController.js` | All beamline-related input: junction ghost, pipe drawing, placement-on-pipe ghost. Translates cursor events into BeamlineSystem calls. |
| `test/test-flattener.js` | Cycle walk, routing through multi-port junctions, open-end termination. |
| `test/test-pipe-drawing.js` | Port-to-port validation, straight-only, overlap rejection, open-end handling. |
| `test/test-pipe-placements.js` | Replace/insert/snap slot finding, drift accounting, order preservation. |
| `test/test-junctions.js` | Junction placement, pipes get open ends when junction removed. |
| `test/test-beamline-system.js` | Integration across the facade. |

### Modified files
| Path | Change |
|------|--------|
| `src/data/beamline-components.raw.js` | Add `role: 'junction' | 'placement'` and `routing` to every component. Retire `placement: 'module' | 'attachment'`. |
| `src/data/placeables/beamline-modules.js` | Switch filter from `placement === 'module'` to `role === 'junction' \|\| role === 'placement'`. |
| `src/game/Game.js` | Delete all listed methods; delegate to `BeamlineSystem`. Update pipe shape accessors. |
| `src/input/InputHandler.js` | Delete beamline input blocks; delegate to `BeamlineInputController`. |
| `src/beamline/BeamlineRegistry.js` | Update any reference to `pipe.fromId` etc. to the new `start/end` shape. |
| `src/ui/BeamlineDesigner.js` | Rename `attachments` → `placements` in access paths; update `_reconcileToPipeGraph` to route through BeamlineSystem. |
| `src/renderer3d/ThreeRenderer.js` | Render open-end caps; render placements along pipe path (placeholder box for now). |
| `src/renderer3d/builders/endpoint-builder.js` | Unchanged besides any ref to old pipe shape. |
| `test/test-insert-and-split.js` | **Deleted.** Replaced by `test-pipe-placements.js` and `test-beamline-system.js`. |

### Deleted (from `src/game/Game.js`)
- `tryInsertOnBeamPipe`
- `_mergeWithAdjacentPipes`
- `_resolveEndpointModules`
- `_autoConnectPipesToModule`
- `_findAvailablePortForModule`
- `_stripOverlappingPipePoints`
- Bridge-merge block inside `removePlaceable`
- Beamline fall-through block inside `_placePlaceableInner`
- Legacy `addAttachmentToPipe` / `removeAttachment` (merged into `placeOnPipe` / `removeFromPipe`)

---

## Phase A — Component data prep

### Task A1: Add `role` and `routing` to every beamline component

**Files:**
- Modify: `src/data/beamline-components.raw.js`

- [ ] **Step 1: Classify every component**

Add `role: 'junction'` or `role: 'placement'` to each entry. Keep `placement` for one more task (retired in Task A3). Rule: a component has `role: 'junction'` iff the beam enters and leaves on different axes, OR it has one side only (source/endpoint), OR it splits/merges beams. Everything else is `role: 'placement'`.

Concrete tagging (from the spec):
- **Junctions:** `source`, `faradayCup`, `beamStop`, `beamDump`, `detector` / `fastFaradayCup`, `dipole`, `scDipole`, `combinedFunctionMagnet` (if bends), `splitter`, `kickerSeptum` / `injectionSeptum`, `chicane` (for now — multi-port assembly), `dogleg`, `collisionPoint` (new; see A2).
- **Placements:** every RF cavity (`pillboxCavity`, `rfCavity`, `scRfCavity`, `buncher`, `prebuncher`, `chopper`...), all quads/sextupoles/octupoles/correctors, solenoids, undulators/wigglers/appleII, all diagnostics (`bpm`, `screen`, `ict`, `wireScanner`, `bunchLengthMonitor`, `energySpectrometer`, `beamLossMonitor`, `srMonitor`, `gasMonitor`), `aperture`, `collimator`, `velocitySelector`, `emittanceFilter`, `bellows`, `gateValve`, all pumps, `stripperFoil`, `kickerMagnet` (if straight-through).

- [ ] **Step 2: Add `routing` to every junction**

Append a `routing: [{ from, to, fraction?, tunable? }, ...]` array to each junction. 2-port junctions: `[{ from: 'entry', to: 'exit' }]`. Single-port junctions (source, endpoint): `[]`. Splitters: multiple entries with `fraction` (default `1.0` for straight, `0.0` for branch). Injection septum: entries from both ringEntry and linacEntry routing to ringExit.

- [ ] **Step 3: Sanity check — run existing tests**

Run: `node test/test-insert-and-split.js`
Expected: PASS (these tests don't read `role` yet; this is just a safety net).

- [ ] **Step 4: Commit**

```bash
git add src/data/beamline-components.raw.js
git commit -m "data: add role and routing to beamline components"
```

---

### Task A2: Add `collisionPoint` and `injectionSeptum` components

**Files:**
- Modify: `src/data/beamline-components.raw.js`

- [ ] **Step 1: Add `collisionPoint`**

A junction with `ports: { entryA: { side: 'back' }, entryB: { side: 'front' } }` and `routing: []` (both beams terminate here). Small 1×1 footprint. Category: `endpoint`. Same `subL`/`subW` pattern as `faradayCup`.

- [ ] **Step 2: Add `injectionSeptum`**

`ports: { linacEntry: { side: 'back' }, ringEntry: { side: 'left' }, ringExit: { side: 'right' } }`. `routing: [{ from: 'linacEntry', to: 'ringExit' }, { from: 'ringEntry', to: 'ringExit' }]`. Category: `magnet`. 1×1 footprint.

These aren't reachable from normal gameplay yet (unlock rules deferred); they exist for future tech-tree work and serve as test fixtures for the flattener in Task B1.

- [ ] **Step 3: Commit**

```bash
git add src/data/beamline-components.raw.js
git commit -m "data: add collisionPoint and injectionSeptum junction defs"
```

---

## Phase B — Flattener + new pipe shape

### Task B1: Write cycle-aware flattener + tests

**Files:**
- Create: `src/beamline/flattener.js`
- Create: `test/test-flattener.js`
- Delete at end of task: `src/beamline/path-flattener.js`

- [ ] **Step 1: Write failing tests for linear walk with new pipe shape**

Write `test/test-flattener.js` exercising:
1. Source → pipe → endpoint (linear) with new `start/end` refs and `placements[]`.
2. Source → pipe → (open end) — stops at open end.
3. Source → pipe(placements=[cavity, bpm]) → endpoint — emits drift/placement/drift in order.
4. Ring: 4 dipole junctions + 4 pipes forming a cycle, injection septum joins linac to ring; beam from injection septum returns to septum after one turn.
5. Multi-port routing: splitter picks first `fraction: 1.0` routing.

Tests construct state objects directly (no Game instance). The helper builder should use the new shape:
```js
const pipe = {
  id: 'bp_1',
  start: { junctionId: 'src_1', portName: 'exit' },
  end:   { junctionId: 'end_1', portName: 'entry' },
  path: [{ col: 2, row: 4 }, { col: 2, row: 12 }],
  subL: 32,
  placements: [{ id: 'pl_1', type: 'buncher', position: 0.5, subL: 2, params: {} }],
};
```

- [ ] **Step 2: Run tests; expect all to fail**

Run: `node test/test-flattener.js`
Expected: FAIL with "module not found" (flattener.js doesn't exist yet).

- [ ] **Step 3: Create `src/beamline/flattener.js`**

Export `flattenPath(state, sourceJunctionId, opts = {})`. Algorithm per spec:
1. Start at `sourceJunctionId` placeable; emit a `module` entry.
2. Use `COMPONENTS[type].routing` to pick next port. If the junction has `routing.length === 0` (source), use the first exit port from `ports`. (Sources have `routing: []` per Task A1; just emit the sole exit port.)
3. Find the pipe whose `start` OR `end` matches `{junctionId, portName}`. Walk the pipe in the direction away from the junction.
4. Inside the pipe: sort `placements` by `position`; emit `drift`/`placement`/`drift`/...
5. At pipe's far end: if `null`, stop. If `{junctionId, portName}`, emit a `module` entry for that junction.
6. Use routing at that junction to pick the next outgoing port and pipe. Multiple exits → pick first routing entry (splitter branching deferred; we pick the dominant path).
7. **Cycle detection:** keep a `Set` of `pipeId:direction` strings. If we're about to enter a pipe we've already walked in this direction, stop.

Same entry shape as the existing path-flattener for compatibility with downstream consumers (designer, physics). Every entry has `{ kind, id, type, beamStart, subL, placeable?, pipeId? }`.

- [ ] **Step 4: Run tests; expect all to pass**

Run: `node test/test-flattener.js`
Expected: PASS for all 5 test cases.

- [ ] **Step 5: Delete old path-flattener and update imports**

Delete `src/beamline/path-flattener.js`. Update imports in `src/game/Game.js`, `src/ui/BeamlineDesigner.js` to point to `flattener.js` (same export name, so only the path changes). Existing tests relying on `path-flattener.js` import path get updated.

Note: the old `path-flattener.js` reads `pipe.fromId/pipe.toId` and `pipe.attachments`. The new `flattener.js` reads `pipe.start/pipe.end` and `pipe.placements`. **Game state hasn't been migrated yet** — so between Task B1 Step 5 and Task B2, `_deriveBeamGraph` will be reading the new flattener against old-shape pipes and getting nothing. That's expected; the next task fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/beamline/flattener.js src/beamline/path-flattener.js test/test-flattener.js src/game/Game.js src/ui/BeamlineDesigner.js
git commit -m "refactor: cycle-aware flattener with new pipe/placement shape"
```

---

### Task B2: Migrate pipe shape in-code

**Files:**
- Modify: `src/game/Game.js`, `src/ui/BeamlineDesigner.js`, `src/renderer3d/*.js`, `src/beamline/BeamlineRegistry.js`, any other reader of `pipe.fromId/toId/attachments`.

This is a mechanical rename across the codebase. The pipe shape is the one from Task B1's tests; pipes still live in `state.beamPipes`.

- [ ] **Step 1: Grep for old field names**

Run: `grep -rn "fromId\|toId\|attachments" src/ test/`
Catalog every hit. Separate true pipe-field usages from unrelated matches (placeable `fromId` is pipe-only; `attachments` might appear in other contexts — audit each).

- [ ] **Step 2: Rewrite every pipe construction site**

Any code that creates a pipe object: change
```js
{ id, fromId, fromPort, toId, toPort, path, subL, attachments }
```
to
```js
{ id, start: fromId ? {junctionId: fromId, portName: fromPort} : null,
      end:   toId   ? {junctionId: toId,   portName: toPort} : null,
      path, subL, placements: attachments }
```
The old `attachments[]` entries are renamed to `placements[]`. Their shape stays the same (`{ id, type, position, subL, params }`).

- [ ] **Step 3: Rewrite every pipe read site**

`pipe.fromId` → `pipe.start?.junctionId`, `pipe.fromPort` → `pipe.start?.portName`, same for `to`→`end`. `pipe.attachments` → `pipe.placements`.

Most hits will be in `Game.js` (auto-detect, merge, remove, createBeamPipe), `BeamlineDesigner.js`, and the 3D renderer.

- [ ] **Step 4: Write a quick shape-invariant check**

Add a dev-only assertion in Game's constructor: `for (const p of state.beamPipes) assert(!p.fromId && Array.isArray(p.placements))` — catches any missed migration site.

- [ ] **Step 5: Run all existing tests**

Run: `node test/test-flattener.js && node test/test-insert-and-split.js`
Expected: flattener tests pass; insert-and-split tests will likely fail because that file is about to be deleted anyway. Don't fix them here — just verify the flattener ones still pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: migrate pipe shape to start/end refs and placements[]"
```

---

## Phase C — BeamlineSystem modules

### Task C1: `junctions.js` — pure helpers

**Files:**
- Create: `src/beamline/junctions.js`
- Create: `test/test-junctions.js`

- [ ] **Step 1: Write failing tests**

Test cases:
1. `availablePorts(junctionPlaceable, beamPipes)` returns ports not already connected.
2. `portWorldPosition(junctionPlaceable, portName)` returns world-space `{x, z}` on the junction's edge along the port's side, rotated by `dir`.
3. `portSide(junctionPlaceable, portName)` returns the rotated compass side ('N'|'E'|'S'|'W').
4. `isJunctionType(type)` returns true for `role: 'junction'`, false otherwise.

Run: `node test/test-junctions.js`
Expected: FAIL.

- [ ] **Step 2: Implement `src/beamline/junctions.js`**

Pure functions; no state mutation. Read `COMPONENTS[type]` for port layout and `placeable.dir` for rotation. Reuse helpers from `module-axis.js` where applicable.

- [ ] **Step 3: Run tests; expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/beamline/junctions.js test/test-junctions.js
git commit -m "feat: junction port helpers"
```

---

### Task C2: `pipe-drawing.js` — validate draw

**Files:**
- Create: `src/beamline/pipe-drawing.js`
- Create: `test/test-pipe-drawing.js`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Straight +row path with valid source.exit → endpoint.entry → returns a valid pipe spec.
2. Path with a corner → rejected.
3. Path that overlaps an existing pipe → rejected.
4. Open-start (start=null) with valid end → returns a valid pipe spec with `start: null`.
5. End on a junction port that's already connected → rejected.
6. End on a port whose `side` doesn't match the pipe's approach axis → rejected.
7. Extend an existing pipe's open end with a collinear new path → returns updated pipe spec (new `subL`, merged `path`).

Run: `node test/test-pipe-drawing.js`
Expected: FAIL.

- [ ] **Step 2: Implement `src/beamline/pipe-drawing.js`**

Export:
```js
validateDrawPipe(state, { start, end, path })
  // → { ok: true, pipe: {...new pipe shape...} } | { ok: false, reason }

validateExtendPipe(state, pipeId, additionalPath)
  // → { ok: true, pipe: {...updated pipe shape...} } | { ok: false, reason }
```

Pure — no state mutation. Returns the new pipe object or a rejection reason. BeamlineSystem will call these and, on success, push/swap the pipe into state.

Straight-only check: every consecutive pair of path points must share one axis (only col differs, or only row differs); the ENTIRE path must be on one axis (single corner check catches this).

Port compatibility: use `junctions.portSide(junction, portName)` to determine the port's compass side, and match against the pipe's approach direction at that endpoint. An `exit` port facing south must be met by a pipe approaching from the north, etc.

Overlap check: iterate existing `state.beamPipes`; if any expanded path point of the new pipe falls within 0.25 tiles of an existing pipe's expanded path and the two aren't being explicitly extended, reject. Reuse `expandPipePath` from `pipe-geometry.js`.

- [ ] **Step 3: Run tests; expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/beamline/pipe-drawing.js test/test-pipe-drawing.js
git commit -m "feat: pipe-drawing validation (port-to-port, straight-only)"
```

---

### Task C3: `pipe-placements.js` — replace/insert/snap

**Files:**
- Create: `src/beamline/pipe-placements.js`
- Create: `test/test-pipe-placements.js`

- [ ] **Step 1: Write failing tests**

Test cases:
1. **snap on empty pipe:** one placement at position 0.5 → placement list = `[{pos=0.5}]`.
2. **snap finds free drift:** pipe with placement at [0.2..0.3]; new placement subL=2 requested at 0.5 → placed at 0.5, order = `[pos=0.25, pos=0.5]`.
3. **snap rejects overlap:** new placement at 0.25 (over existing) → rejected in `snap` mode.
4. **replace swaps:** existing placement at 0.5 is a `buncher` (subL=2); requesting `pillboxCavity` (subL=2) at 0.5 in `replace` mode → buncher is removed, pillboxCavity at same position.
5. **replace with different length:** existing buncher subL=2 at 0.5, replacing with rfCavity subL=6 at 0.5 → only allowed if neighbors don't collide; shift neighbors in `insert` semantics when possible, else reject.
6. **insert shifts neighbors:** pipe subL=40, placements at [0.2 subL=2, 0.6 subL=2]; new subL=4 at 0.4 in `insert` mode → neighbors shift so new element fits, order = `[..., new@center, ...]`.
7. **insert rejects when no room:** pipe subL=4, already full with two subL=2 placements → reject a new subL=2 insert.
8. **order preserved by position.**

Pipe `subL` is in sub-units (0.5 m each). Placement `subL` is in same units.

- [ ] **Step 2: Implement `src/beamline/pipe-placements.js`**

Export:
```js
findSlot(pipe, { type, requestedPosition, subL, mode })
  // → { ok: true, placements: [...new placements array...] }
  //   | { ok: false, reason }
```

Pure function. Given the pipe's current placement list and a request, return the new placement list or a rejection. Modes:
- `'snap'`: find nearest free interval ≥ `subL` to `requestedPosition`; fail if none.
- `'replace'`: identify the placement covering `requestedPosition` (if any); replace it with the new type. If new subL > old subL, shift neighbors in place to make room (or fail).
- `'insert'`: regardless of existing neighbors, shift them outward from `requestedPosition` by `subL/pipe.subL` to make room; fail if total occupancy would exceed pipe length.

The new placement gets a fresh `id` (caller passes a `state.placementNextId` counter via opts).

- [ ] **Step 3: Run tests; expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/beamline/pipe-placements.js test/test-pipe-placements.js
git commit -m "feat: pipe placement slot finding (replace/insert/snap)"
```

---

### Task C4: `BeamlineSystem.js` facade + tests

**Files:**
- Create: `src/beamline/BeamlineSystem.js`
- Create: `test/test-beamline-system.js`

- [ ] **Step 1: Write failing integration tests**

Test cases:
1. `placeJunction({type: 'source', col: 2, row: 2, dir: 0})` → junction appears in `state.placeables`.
2. `drawPipe({junctionId, portName: 'exit'}, null, path)` → pipe appears in `state.beamPipes` with correct `start` ref and `end: null`.
3. `placeOnPipe(pipeId, {type: 'buncher', position: 0.5, mode: 'snap'})` → placement appears in `pipe.placements`.
4. Flattener walks: source → pipe (with buncher) → open end; flat includes buncher.
5. `removeJunction(srcId)` → pipe still exists, `pipe.start === null`, placement still on pipe.
6. `removePipe(pipeId)` → pipe gone, placements gone with it.
7. `drawPipe` rejects a port-to-port draw across a corner (delegates to pipe-drawing validation).
8. `placeOnPipe` in `insert` mode against a full pipe returns null (delegates to pipe-placements validation).

- [ ] **Step 2: Implement `src/beamline/BeamlineSystem.js`**

Class or object with the public API from the spec. Each method:
- Calls the appropriate pure validator (`junctions.js`, `pipe-drawing.js`, `pipe-placements.js`).
- On success, mutates `state.beamPipes` / `state.placeables` directly.
- On success, emits the equivalent of what Game.js emits today: `beamlineChanged`, `placeableChanged`. These are passed in via constructor (the system gets `{state, emit, nextId, log, spend}` callbacks — no Game.js dependency).
- On failure, returns `null` and logs a soft reason via the `log` callback.

`placeJunction` reuses Game's placeable placement machinery — the cleanest way is to have the constructor accept a `placePlaceable(opts)` callback that hands off footprint/collision checks. This keeps the sub-grid occupancy logic in Game.js and just reflects the junction registration.

`removeJunction(id)` iterates `state.beamPipes`, sets `pipe.start = null` or `pipe.end = null` for every ref that matches, then calls the `removePlaceable(id)` callback (without the bridge-merge logic — that path is gone in Phase D).

- [ ] **Step 3: Run tests; expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/beamline/BeamlineSystem.js test/test-beamline-system.js
git commit -m "feat: BeamlineSystem facade over junctions/pipes/placements"
```

---

## Phase D — Replace Game.js legacy paths

### Task D1: Instantiate BeamlineSystem in Game constructor

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Wire the system**

In Game's constructor, after state is initialized:
```js
this.beamline = new BeamlineSystem({
  state: this.state,
  emit: this.emit.bind(this),
  log: this.log.bind(this),
  spend: this.spend.bind(this),
  placePlaceable: (opts) => this._placePlaceableInner(opts, { skipBeamlineRoute: true }),
  removePlaceable: (id) => this._removePlaceableRaw(id),
  nextPipeId: () => 'bp_' + this.state.beamPipeNextId++,
  nextPlacementId: () => 'pl_' + (this.state.placementNextId = (this.state.placementNextId || 0) + 1),
});
```

Add `state.placementNextId` to Game's default state shape (starts at 0).

`_placePlaceableInner` gets a new opt `skipBeamlineRoute` so BeamlineSystem can call it to actually register the junction without recursing back into BeamlineSystem. `_removePlaceableRaw` is the existing remove minus the bridge-merge.

- [ ] **Step 2: Run flattener + system tests**

Run: `node test/test-flattener.js && node test/test-beamline-system.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: instantiate BeamlineSystem in Game"
```

---

### Task D2: Delete `tryInsertOnBeamPipe` and fallthrough

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Delete the method and its call site**

Delete `tryInsertOnBeamPipe` entirely (lines ~1057–1304). Delete the fallthrough block inside `_placePlaceableInner` (lines ~1324–1327) that calls it.

`_placePlaceableInner` for `kind === 'beamline'` now:
- If `COMPONENTS[type].role === 'junction'` → route to `this.beamline.placeJunction(opts)` (unless `skipBeamlineRoute` is set — in which case do the normal placement path).
- If `COMPONENTS[type].role === 'placement'` → reject (`log('placements must be placed on a pipe', 'bad')`, return false). The UI controller is responsible for calling `beamline.placeOnPipe` instead.

- [ ] **Step 2: Delete `test/test-insert-and-split.js`**

```bash
git rm test/test-insert-and-split.js
```

- [ ] **Step 3: Run remaining tests**

Run: `node test/test-flattener.js && node test/test-beamline-system.js && node test/test-junctions.js && node test/test-pipe-drawing.js && node test/test-pipe-placements.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete tryInsertOnBeamPipe and free-placement fallthrough"
```

---

### Task D3: Delete legacy pipe helpers

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Delete these methods**

- `_mergeWithAdjacentPipes`
- `_resolveEndpointModules`
- `_autoConnectPipesToModule`
- `_findAvailablePortForModule`
- `_stripOverlappingPipePoints`
- The bridge-merge block inside `removePlaceable` (replace with the plain "remove this module's pipes" or "set pipe.start/end refs null" — but the latter is what BeamlineSystem.removeJunction does, so if delete comes via the UI the facade path handles it).

- [ ] **Step 2: Rewrite `createBeamPipe` to delegate**

Replace the body of `createBeamPipe(fromId, fromPort, toId, toPort, path)` with:
```js
return this.beamline.drawPipe(
  fromId ? {junctionId: fromId, portName: fromPort} : null,
  toId ? {junctionId: toId, portName: toPort} : null,
  path,
);
```
The function exists only for compatibility with callers that haven't been updated yet.

- [ ] **Step 3: Rewrite `addAttachmentToPipe` to delegate**

Replace with `this.beamline.placeOnPipe(pipeId, {type, position, params, mode: 'snap'})`.

`removeAttachment` → `this.beamline.removeFromPipe(pipeId, attachmentId)`.

- [ ] **Step 4: Run tests**

Run: `node test/test-flattener.js && node test/test-beamline-system.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "refactor: delete legacy pipe helpers; delegate to BeamlineSystem"
```

---

## Phase E — UI controller

### Task E1: Extract BeamlineInputController skeleton

**Files:**
- Create: `src/input/BeamlineInputController.js`

- [ ] **Step 1: Define the controller interface**

```js
export class BeamlineInputController {
  constructor({ game, renderer }) { ... }

  // Called by InputHandler when selected tool is a beamline component
  // or the pipe-drawing tool.
  onHover(worldX, worldY) { ... }
  onMouseDown(worldX, worldY, button) { ... }
  onMouseMove(worldX, worldY) { ... }
  onMouseUp(worldX, worldY, button) { ... }
  onRotate() { ... }

  // External: returns true if the controller is currently owning the
  // input stream (mid-draw, showing a ghost). Used by InputHandler to
  // skip other input handlers.
  isActive() { ... }

  // Clears any in-progress preview (tool switch, escape key).
  reset() { ... }
}
```

Initially all methods are no-ops. Tests that exercise controller integration come later via manual playtesting; unit-testing the controller in isolation isn't worth the mock surface area.

- [ ] **Step 2: Commit skeleton**

```bash
git add src/input/BeamlineInputController.js
git commit -m "feat: BeamlineInputController skeleton"
```

---

### Task E2: Move junction placement preview into controller

**Files:**
- Modify: `src/input/BeamlineInputController.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Move junction ghost logic**

The current `_updatePlaceablePreview` path in InputHandler handles all placeables generically. Junction placement remains essentially the same as today's module placement (grid snap, ghost rendering, click to place). Move the branch that detects `COMPONENTS[selectedPlaceableId].role === 'junction'` into the controller's `onHover`. Click handling calls `game.beamline.placeJunction(opts)`.

The generic placeable path in InputHandler keeps handling equipment/furnishing/decoration.

- [ ] **Step 2: Manual smoke test**

Load the game. Select a source. Hover over the grid. Verify the ghost renders and clicks place a source. Rotate (R key) and verify the ghost rotates. Place two sources and verify both land.

- [ ] **Step 3: Commit**

```bash
git add src/input/BeamlineInputController.js src/input/InputHandler.js
git commit -m "feat: junction placement via BeamlineInputController"
```

---

### Task E3: Pipe drawing flow

**Files:**
- Modify: `src/input/BeamlineInputController.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Move pipe drawing logic**

Move the mousedown/mousemove/mouseup blocks for the pipe tool (`isDrawnConnection`) from InputHandler into the controller. New behavior:
- **Mousedown:** determine origin. Must be a junction port (use hit-testing against junction world positions via `junctions.portWorldPosition`) OR an existing pipe's open end. Else ignore.
- **Mousemove:** live preview of a straight polyline from origin along whichever axis dominates cursor delta.
- **Mouseup:** determine destination. If over a compatible junction port → full port-to-port pipe. If over an existing pipe's open end → extend it. Else open-ended pipe. Call `game.beamline.drawPipe(...)` or `extendPipe(...)`.

The existing `_snapPipePoint` helper moves to a static method on the controller (or to `pipe-geometry.js`; prefer geometry for reuse).

- [ ] **Step 2: Manual smoke test**

Place a source, draw pipe from its exit. Verify the pipe renders with open end cap. Place an endpoint. Draw a pipe from its entry port to an existing pipe's open end. Verify it extends rather than creates a disconnected pipe.

- [ ] **Step 3: Commit**

```bash
git add src/input/BeamlineInputController.js src/input/InputHandler.js src/beamline/pipe-geometry.js
git commit -m "feat: pipe drawing UX via BeamlineInputController (port-to-port)"
```

---

### Task E4: Placement-on-pipe ghost + click

**Files:**
- Modify: `src/input/BeamlineInputController.js`

- [ ] **Step 1: Implement placement preview**

When the selected tool has `role: 'placement'`:
- `onHover`: project cursor world-pos onto nearest pipe via `_projectOntoPipe` (already exists in InputHandler; move it to `pipe-geometry.js`). If no pipe within projection range → no ghost, no placement possible. If over a pipe: compute the placement's `position` on the pipe's subL, compute the projected ghost geometry (a box of the placement's `subL` length along the pipe axis, centered on the projection point).
- Call `beamline.placementAt(pipeId, position)` to determine if this is a replace. Color ghost green if placement is valid (per the current mode), red otherwise. Use `pipe-placements.findSlot` in `dry-run` mode to pre-check.
- `onMouseDown`: commit via `game.beamline.placeOnPipe(pipeId, {...})` with the current mode (derived from a toggle in the HUD, defaulting to `snap`).

- [ ] **Step 2: Add a mode toggle in the HUD**

Three buttons or keyboard shortcuts (R/I/S for replace/insert/snap, matching the designer's existing convention). Default mode = `snap`. Controller reads `this.game.placementMode` (new state field).

- [ ] **Step 3: Manual smoke test**

Place source, draw pipe, select a buncher tool. Hover over pipe — see ghost snap to pipe axis. Click — buncher appears on pipe. Open the beamline designer for the source — buncher shows up. Switch mode to `insert`. Place a second buncher mid-pipe — neighbors shift. Switch to `replace`. Click on existing buncher — swaps for the selected type.

- [ ] **Step 4: Commit**

```bash
git add src/input/BeamlineInputController.js src/game/Game.js
git commit -m "feat: placement-on-pipe UX with replace/insert/snap modes"
```

---

### Task E5: Wire InputHandler to delegate

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Delegation structure**

At the start of each mouse handler in InputHandler, check: if the selected tool is a beamline component (junction or placement) or the pipe-drawing tool, delegate to `this.beamlineController.onMouseDown/onMouseMove/onMouseUp` and return. If the controller's `isActive()` is true, consume the event.

Delete the original junction/pipe-drawing/attachment code blocks from InputHandler (they're now in the controller).

- [ ] **Step 2: Full-game smoke test**

Play through: place source, draw pipe, place several placements, open designer, verify flattener output, remove a junction (pipe goes open-ended with placements intact), delete a pipe (placements go with it).

- [ ] **Step 3: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor: InputHandler delegates beamline input to controller"
```

---

## Phase F — Renderer updates

### Task F1: Open-end cap geometry

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` (or the appropriate pipe-rendering module).

- [ ] **Step 1: Locate pipe rendering code**

Grep for where pipes are rendered — probably `buildPipeMesh` or similar in the 3D renderer.

- [ ] **Step 2: Add open-end cap**

For each pipe, if `pipe.start === null` or `pipe.end === null`, add a small mesh at that end: a dashed ring or a disc with a distinct color (reuse the existing "loose" or "warning" palette). Tooltip on hover: "unconnected."

- [ ] **Step 3: Manual verification**

Draw a pipe with one open end. Verify the cap renders at the open end only. Draw a pipe connecting to both ports. Verify no caps.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js
git commit -m "feat: render open-end caps on unconnected pipes"
```

---

### Task F2: Placement rendering along pipe

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js`, `src/renderer3d/component-builder.js`.

- [ ] **Step 1: Build placements as children of pipes**

The old code renders attachments on pipes. Audit that code — most of the logic transfers directly. The only change is the unified `placements[]` now includes what used to be grid-placed modules (cavities, bunchers). For those, use the component-builder's existing mesh (the same geometry they had as grid modules) but position it along the pipe path using the projection helper.

For v1, if a component-builder lookup for a placement fails, render a placeholder box sized to the placement's `subL`. Polish in a follow-up task.

- [ ] **Step 2: Manual verification**

Draw a pipe. Place a buncher, an rfCavity, and a BPM on it. Verify all three render at their positions on the pipe. Verify rotations follow the pipe axis.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/
git commit -m "feat: render placements along pipe (unified code path)"
```

---

## Phase G — Designer integration

### Task G1: Designer uses new flattener contract

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`

- [ ] **Step 1: Verify the designer still opens**

Open the designer from a source after Phase F. Check the flat list includes placements correctly.

- [ ] **Step 2: Update any remaining `attachments`→`placements` references**

The Phase B2 rename should have caught this, but double-check `_reconcileToPipeGraph` and any draft-node conversion logic.

- [ ] **Step 3: Route confirm through BeamlineSystem**

`_reconcileToPipeGraph` currently reads and writes state directly. Change writes to route through `game.beamline.placeOnPipe` / `removeFromPipe` so invariants are maintained. Reads can still pull from `flattenPath`.

- [ ] **Step 4: Manual end-to-end test**

Place source → draw pipe → open designer → add a buncher via the designer palette → confirm → verify buncher appears on the pipe in 3D. Remove it in the designer → confirm → verify it's gone on the map.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BeamlineDesigner.js
git commit -m "refactor: designer confirms via BeamlineSystem"
```

---

## Phase H — Cleanup + plan self-check

### Task H1: Delete leftover dead code

**Files:**
- Modify: various.

- [ ] **Step 1: Final grep for legacy symbols**

Run: `grep -rn "tryInsertOnBeamPipe\|_mergeWithAdjacent\|_resolveEndpointModules\|_autoConnectPipesToModule\|_findAvailablePortForModule\|_stripOverlappingPipePoints\|fromId\|toId\|attachments" src/`
Any remaining hits that aren't about the new structured refs are dead code. Delete.

- [ ] **Step 2: Run full test suite**

```bash
for f in test/test-flattener.js test/test-beamline-system.js test/test-pipe-drawing.js test/test-pipe-placements.js test/test-junctions.js test/test-module-axis.js; do node "$f" || exit 1; done
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "cleanup: remove final legacy references"
```

---

### Task H2: Regression pass

**Files:** N/A (manual testing)

- [ ] **Step 1: Playthrough smoke test**

1. Fresh new game (no save load).
2. Place source → draw pipe → open end. Verify cap renders.
3. Place endpoint beyond pipe. Draw pipe from endpoint to open end → extends.
4. Select buncher. Ghost shows only over pipe. Click → buncher renders on pipe. Verify designer shows it.
5. Swap to rfCavity, replace mode, click on buncher → replaces.
6. Insert mode, second rfCavity mid-pipe → neighbors shift.
7. Delete source → pipe becomes fully open-ended, placements intact. Verify caps on both ends.
8. Delete pipe → placements gone.
9. Verify no console errors throughout.

- [ ] **Step 2: If any issues found, file them as follow-up tasks** (don't fix inline unless they're trivial; this task is a regression pass, not a fix sprint).

---

## Self-review checklist

After completing this plan, compare against the spec:

**Spec coverage:**
- ✅ Junction model (Phase A, C1)
- ✅ Pipe shape with start/end refs (B2)
- ✅ Placements unified with old attachments (B2, C3)
- ✅ Cycle-aware flattener (B1)
- ✅ Port routing tables (A1, B1)
- ✅ Strict port-to-port pipe drawing (C2, E3)
- ✅ Replace/insert/snap placement modes (C3, E4)
- ✅ Open-end cap rendering (F1)
- ✅ BeamlineSystem facade sole mutator (C4, D1-D3)
- ✅ BeamlineInputController extracted (E1-E5)
- ✅ Deletions: `tryInsertOnBeamPipe`, `_mergeWithAdjacentPipes`, `_resolveEndpointModules`, `_autoConnectPipesToModule`, `_findAvailablePortForModule`, `_stripOverlappingPipePoints`, bridge-merge, fallthrough (D2, D3)
- ✅ No save migration (doc intro; CLAUDE.md covers)
- ✅ Splitter branching / ring physics deferred (spec Scope Cut-Line; B1 picks first routing)

**Known follow-ups (not in this plan):**
- Polishing placement mesh rendering beyond placeholder boxes (F2)
- Splitter branching physics (multi-beam walk)
- Ring physics (turn-tracking closed orbit)
- Unlock progression for `collisionPoint` and `injectionSeptum`
- HUD mode toggle visual design
