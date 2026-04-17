# Junction / Pipe / Placement Redesign

**Date:** 2026-04-17
**Goal:** Replace the current implicit-connectivity beamline model (where pipes guess their `fromId/toId` from geometry) with an explicit port-based model. Components split into two roles: **junctions** (grid-placed, port-bearing) and **placements** (live on pipes). Pipes are the beam-carrying track and own an ordered list of placements; their length is set by drawing, not by placing components.

This is a clean-cut rewrite. No save-file migration; old saves won't load.

## Why

The current system infers the pipe graph from hand-drawn geometry:
- `_resolveEndpointModules` guesses a pipe's `fromId/toId` by looking for modules within 0.35 tiles of the loose tip.
- `tryInsertOnBeamPipe` splits a pipe when a module is dropped on it, leaving graph-connectivity up to the split logic.
- `_mergeWithAdjacentPipes` and the bridge-merge in `removePlaceable` heal pipes that were broken by earlier guesses.
- `placePlaceable` falls through to free grid placement for beamline modules when `tryInsertOnBeamPipe` fails, leaving through-modules orphaned from the pipe graph silently.

Every beamline bug observed recently is a consequence of this: green ghost lies about connectivity, pipes aren't connected to sources, modules placed "on" pipes aren't in the flattened beam graph. The fix is to make connectivity explicit by construction.

## Core Model

### Junction
A grid-placed placeable with one or more named **ports**. Every junction type declares:
- **Ports**: a map of port name → side/direction relative to the junction's local frame (e.g. `entry: { side: 'back' }`, `exit: { side: 'front' }`, `exitBranch: { side: 'left' }`).
- **Port routing**: an array of `{ from, to, fraction?, tunable? }` entries describing which entry port flows to which exit port. A 2-port junction's routing is trivially `entry → exit`. Splitters and septa declare multiple entries or multiple exits.

Junction types (all grid-placed):
- **Source** — 1 exit port.
- **Endpoint / dump / detector** — 1 entry port.
- **Dipole, SC dipole** — 1 entry, 1 exit (bent).
- **Collision point / target** — N entry ports.
- **Splitter** — 1 entry, 2+ exit ports (physics branching deferred).
- **Chicane, dogleg** — multi-port assemblies.
- **Injection septum** — 2 entry ports, 1 exit.

Every existing beamline component with a `ports` field becomes a junction. Every component that used to be placed-on-grid-and-inserted-into-pipe (cavities, bunchers) becomes a placement — see below.

### Pipe
A straight, axis-aligned polyline segment of track. Each end is either a `{ junctionId, portName }` ref or `null` (open end). An open end shows a visible "plug" cap; placements on an open-ended pipe are valid but the beam doesn't terminate cleanly.

The full pipe shape is spelled out in **State Shape** below. Key semantics:
- `position` is a 0..1 fraction of the pipe's total `subL` (one sub-unit = 0.5 m).
- A placement occupies the interval `[position, position + (placement.subL / pipe.subL)]`.
- Thin placements (BPMs, correctors) use `subL = 1` (half a metre of pipe) for rendering but physics treats them as point elements.

**Unification with old `attachments[]`:** what used to be an attachment (BPM) and what used to be a grid-module-inserted-onto-pipe (cavity) are now the same thing — an ordered element on a pipe with `position` and `subL`. `tryInsertOnBeamPipe`'s splitting logic disappears entirely; there's one code path for all pipe-resident components.

### Placement
A beam-axis-aligned, non-bending component that lives on a pipe. Every placement has `position`, `subL`, `type`, `params`. Placements never occupy the grid directly — they render on top of the pipe they belong to.

All of these become placements (the current `attachments[]` union with the current on-grid-through-modules):
- All RF cavities (pillbox, NC RF, SRF, buncher)
- Quads, sextupoles, octupoles, correctors
- Solenoids, undulators, wigglers (big but straight)
- All diagnostics (BPM, screen, ICT, wire scanner, bunch length, energy spectrometer, SR monitor)
- Apertures, collimators, velocity selectors
- Bellows, gate valves, pumps (ion/NEG/turbo/cryo)
- Stripper foils, kickers

## State Shape

Junctions continue to live in `state.placeables` alongside other placeables — the existing placement infrastructure (footprint cells, collision, subgrid occupancy, `placeableIndex`) is fine to reuse. Distinguishing a junction from a non-beamline placeable is done by `COMPONENTS[placeable.type].role === 'junction'`. No new top-level state array.

Pipes keep their current slot, renamed for clarity:

```js
state.beamPipes = [
  {
    id,
    start: { junctionId, portName } | null,   // was fromId/fromPort
    end:   { junctionId, portName } | null,   // was toId/toPort
    path:  [{col, row}, ...],                 // straight, axis-aligned
    subL,                                      // length in sub-units (1 sub-unit = 0.5 m)
    placements: [                             // ordered along the pipe; was attachments[]
      { id, type, position, subL, params }
    ],
  }
];
```

`position` is a 0..1 fraction of the pipe's total subL (matches existing `attachments[].position`). The old `fromId/fromPort/toId/toPort` flat fields are replaced by the structured `start/end` refs to make null (open) semantics obvious and to leave room for routing metadata if ever needed.

`attachments[]` is renamed to `placements[]` and absorbs both what used to be attachments and what used to be on-grid-then-inserted through-modules.

## Flattener

Input: a source junction ID.
Output: an ordered list of entries (source → pipe drift → placement → drift → ... → endpoint junction) with cumulative `beamStart` metres, matching the current contract.

Algorithm:
1. Start at the source junction. Add a `module` entry for it.
2. Follow its sole exit port's routing to pick an outgoing pipe (look up `pipes[i].start` or `pipes[i].end` matching the junction+port).
3. Walk the pipe: emit drift → placement → drift → placement → ... → trailing drift. Use the placement list sorted by position.
4. Reach the other end of the pipe. If it's `null` (open), stop. If it's a junction, add a `module` entry for it.
5. If the junction has outgoing routing from the arriving port, pick the next pipe via the routing table. Repeat from step 3.
6. **Cycle detection:** maintain a `visited` set of `{ pipeId, direction }` entries. If the next pipe is already visited in the same direction, stop — we've closed a ring. This is how ring beams flatten as a single turn.

Splitter branching: for v1, if a junction's routing has multiple outgoing targets, pick the first (`fraction: 1.0` or similar default). Multi-beam splitting is deferred.

## Authoritative API — BeamlineSystem

A new module `src/beamline/BeamlineSystem.js` is the only thing that mutates `state.beamPipes` and the beamline-junction entries within `state.placeables`. Game.js delegates to it. Public API:

```js
placeJunction({ type, col, row, subCol, subRow, dir, params })
  → junctionId | null
  // Grid-places a junction placeable. Same footprint/collision checks as
  // today. No auto-connecting to nearby pipes.

removeJunction(junctionId)
  → void
  // Removes the junction. Any pipes referencing this junction's ports
  // have those refs set to null (open ends). Placements on those pipes
  // are preserved.

drawPipe(start, end, path)
  → pipeId | null
  // start/end are { junctionId, portName } | null. Validates:
  //   - path is straight and axis-aligned
  //   - start port (if given) is an available exit/entry matching flow direction
  //   - end port (if given) is available and matches
  //   - no pipe overlap on the same tiles
  // Does NOT guess endpoints from geometry — caller must pass refs.

extendPipe(pipeId, additionalPath)
  → void
  // Appends more track to a pipe's open end. Validates straightness and
  // that the pipe has an open end to extend from.

removePipe(pipeId)
  → void
  // Deletes the pipe and all its placements.

placeOnPipe(pipeId, { type, position, params, mode })
  → placementId | null
  // mode is 'replace' | 'insert' | 'snap'.
  // - 'replace': if an existing placement covers `position`, swap it out.
  // - 'insert': shift neighbors along the pipe to make room for the new
  //   placement, consuming drift. Fails if not enough drift available.
  // - 'snap': place in the nearest free slot to `position`; fail if none.
  // Caller passes the position; the UI converts cursor world-position
  // to a pipe-local position via the pipe's path.

removeFromPipe(pipeId, placementId)
  → void

placementAt(pipeId, position)
  → placement | null
  // Look up an existing placement at a given pipe-local position.
```

All the following current Game.js methods are **deleted** (their behaviors are absorbed or rejected):
- `tryInsertOnBeamPipe`
- `_mergeWithAdjacentPipes`
- `_resolveEndpointModules`
- `_autoConnectPipesToModule`
- `_findAvailablePortForModule`
- `_stripOverlappingPipePoints`
- Bridge-merge logic inside `removePlaceable`
- Free-placement fall-through for beamline kind inside `placePlaceable`

`placePlaceable` keeps its responsibility for non-beamline placeables (equipment/furnishing/decoration) but routes beamline kinds to `BeamlineSystem.placeJunction` (for junctions) or rejects them (for placements — which must go through `placeOnPipe`).

## UX Rules

### Junction placement
- Selecting a junction tool (source, dipole, endpoint, etc.) shows a grid-snapped ghost.
- Green when footprint fits, red when colliding. No pipe involvement — junctions don't connect to anything automatically.
- Click places the junction. Adjacent pipes are unaffected.

### Pipe drawing
- Selecting the pipe tool: cursor is hover-only until the player clicks.
- **Click origin:** must be on an available junction port OR on an existing pipe's open end (extending it). Clicking elsewhere does nothing.
- **Drag:** live preview of a straight polyline from the origin along the dominant axis.
- **Click release:** valid endpoints are (a) an available port of another junction, (b) empty grid (creates an open end), or (c) an existing pipe's open end (connects to it). Release on an invalid target cancels.
- No free-floating pipes. Every pipe has at least one port-connected end at creation.

### Placement on pipe
- Selecting a placement tool (cavity, quad, BPM, …) shows a ghost **only when the cursor is over a pipe**. Off-pipe: no ghost, no placement possible.
- Ghost shows the placement's length along the pipe's axis, projected onto the pipe.
- Green when a free slot of sufficient length exists under the cursor; red when overlapping another placement (in `snap` mode) or when insert would exceed pipe length (in `insert` mode).
- Modes mirror the designer:
  - **Replace** (default): swap whatever placement is under the cursor.
  - **Insert**: shift neighbors along s to make room.
  - **Snap**: fit into nearest drift without disturbing neighbors.
- Click places. No silent fallback to grid placement.

### Open-end indicator
A visible cap on pipes with `start: null` or `end: null` — e.g., a dashed circle or a "port cap" geometry in 3D. Tooltip: "unconnected." Placements on open-ended pipes work; the beam just doesn't terminate cleanly until a junction is added.

## Module Layout

```
src/beamline/
  BeamlineSystem.js        NEW — facade, owns mutations (~400 lines)
  junctions.js             NEW — junction placement rules (~200 lines)
  pipe-drawing.js          NEW — drawPipe / extendPipe validation (~200 lines)
  pipe-placements.js       NEW — placeOnPipe / slot finding / insert-replace-snap (~300 lines)
  flattener.js             RENAMED from path-flattener.js; cycle-aware (~180 lines)
  pipe-geometry.js         EXISTING — unchanged
  module-axis.js           EXISTING — unchanged
  component-physics.js     EXISTING — unchanged
  BeamlineRegistry.js      EXISTING — slimmed per 2026-04-14 plan
```

```
src/input/
  BeamlineInputController.js  NEW — ghost preview, click-to-draw, click-to-place (~500 lines)
  InputHandler.js              ~800 lines lighter; delegates beamline input
```

Net: ~1500 lines leave Game.js, ~800 leave InputHandler.js. New files sum to ~1800 lines but are focused and independently reviewable.

### Boundary rules
- `BeamlineSystem` is the only module that mutates `state.beamPipes` or beamline-junction placeables. Tests can exercise it without Game.js.
- Game.js calls `beamlineSystem.drawPipe(...)` etc.; it does not poke pipe state directly.
- `BeamlineInputController` is the only thing that translates cursor events into BeamlineSystem calls. InputHandler keeps infra/zones/decoration/camera input.
- `flattener.js` is a pure function over state. It's the single reader path for the designer and physics.

## Component Data Changes

Every entry in `src/data/beamline-components.raw.js` gets one of:
- `role: 'junction'` with a `ports` map and a `routing` array.
- `role: 'placement'` with no ports, no routing.

The old `placement: 'module' | 'attachment'` field is retired — subsumed by `role`.

Rule of thumb:
- Bends beam / splits beam / caps beam → `junction`.
- Beam goes straight through → `placement`.

## Deletions

Beyond the Game.js method list above, these go away:
- The `placement: 'module' | 'attachment'` property on components — replaced by `role`.
- Tests tied to `tryInsertOnBeamPipe` splitting semantics — rewritten against `placeOnPipe`.
- `_autoDetectPipeEndpoints`, `_findAvailablePortForModule` — gone.

Kept intact:
- `src/beamline/module-axis.js` — still needed for junction port orientation math.
- `src/beamline/pipe-geometry.js` — still needed for mapping cursor → pipe-local position.

## Tests

Each new module gets unit tests:
- `pipe-drawing.test.js`: straight-only enforcement, port matching, open-end handling, overlap rejection.
- `pipe-placements.test.js`: slot finding, replace/insert/snap semantics, insufficient-drift rejection, sort order, replace preserving params.
- `flattener.test.js`: linear walk, cycle termination, routing through multi-port junctions, open-end stop.
- `junctions.test.js`: footprint collision, adjacent-pipe behavior when removed, port uniqueness.
- Integration: place source → draw pipe → place cavity → place BPM → flattener produces ordered list → designer round-trip.

Existing tests that exercised the old split/merge logic are deleted.

## Save Compatibility

None. Per project CLAUDE.md rule, old saves don't load after this change.

## Scope Cut-Line

**In:**
- Junction/placement model and API.
- Straight-only pipe drawing port-to-port with open ends.
- Placements on pipes with replace/insert/snap modes.
- Cycle-aware flattener (rings *structurally* work; physics later).
- Module extraction from Game.js and InputHandler.js.

**Deferred:**
- Splitter branching physics (v1 picks first routing).
- Ring physics — turn tracking, closed orbit (v1 just flattens one turn).
- Diagonal pipes — straight-only for now; bends require dipole junctions.
- Multi-pipe-segment junctions like chicanes as single placeables (can model as multiple dipoles for now).

## Risks

- **Placement positioning math.** Mapping cursor world-position onto a pipe's local 0..1 position needs to be robust at pipe endpoints and corners in the polyline path. Pre-existing `pipe-geometry.js` already handles expansion; reuse.
- **Component re-classification.** Every beamline component def needs auditing to pick `role: junction | placement`. ~40 components; one sitting to do.
- **3D renderer assumptions.** Currently rendering assumes modules have grid cells. Placements on pipes need a new render path that interpolates along the pipe path. Add to 3D renderer work, not to this spec's critical path; render as a placeholder box on the pipe first, polish later.
