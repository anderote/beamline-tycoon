# Beamline Designer: draft → plan → apply

**Date:** 2026-08-11
**Status:** approved, ready for planning

## The problem

Opening the Beamline Designer from a placed beamline (`openFromSource`, "edit
mode") shows the full component palette but silently ignores most of it.
`BeamlineDesigner.insertComponent` opens with:

```js
if (this.editSourceId && comp.placement !== 'attachment') return;
```

A bare `return`. No log, no toast, no disabled styling. Measured against the
real app, 18 of 27 palette cards in edit mode do nothing at all: every
`placement: 'module'` component — Beam Pipe, all six cavities and linacs, every
source, every endpoint — is dead. Only the 9 `placement: 'attachment'`
components work. The same palette in sandbox mode (`openDesign`) accepts all of
them, which makes the failure read as a bug rather than a rule.

The underlying rule is real: modules are junction placeables on the map, and
the designer had no way to create map geometry. But the rule was enforced by
silence.

## Design goals

1. **Editing is free.** In the designer, the player edits a linear stack. No
   operation is refused while drafting.
2. **The map is touched once, deliberately.** Changes land as a single
   reviewed, transactional Apply.
3. **Cancel is always safe.** Discarding a draft leaves the map untouched.
4. **Hand-placed layout survives.** Applying a change must not flatten bends or
   dogleg routing the player built on the map.
5. **Nothing is a surprise.** Cost, moves, and collateral damage to utility
   wiring are shown before they happen.

## Domain model (existing, for reference)

- **Module** — a placeable on the sub-grid with a footprint, `dir`, ports, and
  a `routing` table. Sources, cavities, dipoles, endpoints. Created via
  `BeamlineSystem.placeJunction`.
- **Pipe** — a *straight* run between two junction ports
  (`state.beamPipes[]`: `{id, start:{junctionId,portName}, end:{...}, path,
  subL, placements[]}`). Created via `drawPipe` / `extendPipe`. Bends in a
  beamline exist only at junctions.
- **Placement** — an attachment at a fractional `position` along a pipe.
  Created via `placeOnPipe`.
- **Utility line** — `{id, utilityType, path, start:{placeableId, portName},
  end:{...}}`. Manhattan grid geometry plus endpoint references. When a
  placeable is removed, `UtilityLineSystem.onPlaceableRemoved` nulls the
  endpoint reference and **keeps the path as a dangling segment the player
  rewires**. This is the established convention for disturbing wiring.
- **`flattenPath(state, sourceId)`** — walks the graph and emits the ordered
  linear stack (`kind: 'module' | 'placement' | 'drift'`) the designer displays.

## Architecture: three stages

### Stage 1 — Draft (free editing)

`draftNodes` becomes a statement of the **desired end state**, not a queue of
map mutations.

- `insertComponent` drops its `placement !== 'attachment'` guard entirely.
  Every palette click lands in the stack in every mode.
- Nodes added during editing carry no `_targetPipeId` / `_targetPosition` /
  `_insertMode` map bookkeeping. That resolution moves to the planner.

**Sequencing hazard.** Phase 1 shipped alone would let the player add a module
to the draft that `_reconcileToPipeGraph` then ignores — trading a silent
palette failure for a silent *Apply* failure, which is worse. Two rules keep
that from happening:

- The existing attachment bookkeeping and reconciler stay working throughout
  phase 1; only the module guard is removed. Attachments must never regress.
- Until the planner lands, `confirm()` counts draft module changes it cannot
  apply and refuses with an explicit message naming them, rather than
  discarding them. Phase 2 replaces that refusal with the real plan.
- The schematic, tuning panel and physics preview already derive from
  `draftNodes` and therefore work unchanged.
- The designer palette gains the **beamline-type filter** the main HUD palette
  already applies (`beamlineTypeHidesComponent`), so components excluded for
  the line's type stop appearing at all. In edit mode the type comes from the
  beamline being edited; in sandbox mode from `getActiveBeamlineTypeId()`.

Stage 1 alone removes the dead-card defect.

### Stage 2 — Plan (pure)

New module: **`src/beamline/designer-plan.js`**. A pure function with no state
mutation, in the same spirit as `pipe-drawing.js` and `pipe-placements.js`.

```
planDesignerApply(state, { sourceId, draftNodes, originalNodes })
  → { ok: true,  ops: Op[], summary: Summary }
  | { ok: false, ops: Op[], summary: Summary, blockers: Blocker[] }
```

It re-walks the current map with `flattenPath`, aligns it against
`draftNodes` by `_sourceRef` identity, and emits an ordered operation list:

| Op | Meaning |
|---|---|
| `placeJunction` | a module added to the stack |
| `removeJunction` | a module deleted from the stack |
| `moveJunction` | an existing module displaced by a length delta (phase 4) |
| `drawPipe` / `extendPipe` / `trimPipe` | drift added, lengthened, shortened |
| `splitPipe` / `mergePipe` | a module inserted into / removed from a drift |
| `placeOnPipe` / `removeFromPipe` | attachments, as today |
| `tuneParams` | param edits on a surviving module or placement |

**Layout rule — displacement, not re-layout.** The source junction is anchored
and never moves. Where the draft agrees with the map, junctions keep their
exact positions. Where the draft has grown or shrunk, every downstream junction
slides *along the existing polyline* by the accumulated delta, and the pipes
between them are redrawn to fit. Bends and hand-tuned routing survive because
the polyline itself is preserved; only arc-length positions along it change.
When the polyline runs out, the run extends along the direction of its final
segment.

**Blockers.** The planner is where failure is discovered: occupied grid cells,
a displaced junction colliding with a wall or another placeable, a resulting
pipe that is not a legal straight run, insufficient funds. Every blocker
carries a terse code plus the draft node index it belongs to, so the UI can
point at the offending element in the schematic.

### Stage 3 — Apply (transactional)

`BeamlineDesigner.confirm()` in edit mode:

1. Build the plan. If `!ok`, show blockers and stay in the designer.
2. Show the **Apply preview** (below). On "Back to editing", return with the
   draft intact.
3. Snapshot state, execute ops in order through `BeamlineSystem` /
   `UtilityLineSystem`, and on *any* op failing, restore the snapshot and
   report. **All-or-nothing**: a half-applied beamline is never left behind.
4. On success, clear the draft, recompute the baseline envelope, and emit
   `beamlineChanged`.

The snapshot uses the existing save serializer over the fields the plan can
touch (`placeables`, `beamPipes`, `utilityLines`, resources, and sub-grid
occupancy). Pre-release, single-user: no migration concerns.

### The Apply preview

A modal summarizing the plan in the player's terms before anything is touched:

```
Apply changes to Radiation Testing Line
  + Beam Pipe  4.0 m              $40,000
  + S-band Structure             $850,000
  − Faraday Cup                  +$15,000 refund
  ↕ 3 modules shift downstream 2.0 m
  ⚡ 4 utility lines need rewiring
                        Total    $875,000
            [ Apply ]  [ Back to editing ]
```

Grouped by kind, not one row per op. The moves line and the rewiring line are
what make displacement acceptable rather than alarming.

## Utility lines under displacement

Best-effort, with the existing convention as the fallback:

1. Translate the line's final leg to the port's new position and re-run
   `validateDrawLine`.
2. If it validates, the line survives intact and is not counted in the preview.
3. If not, null the endpoint and keep the path — exactly what
   `onPlaceableRemoved` already does — and count it in the preview's "need
   rewiring" total.

The infra fault popup (top-left, dismissable) already surfaces unwired sinks
with click-to-locate, so the player is guided to whatever dangled.

## Proposed vs. current plots

The plan model already forces the designer to hold two states, so the
comparison costs one extra physics run rather than a new data path.

- **`baselineEnvelope`** — computed from `originalNodes` when the designer
  opens and recomputed after each successful Apply. `draftEnvelope` already
  exists and updates live.
- **A global source toggle** in the existing plot range bar:
  `Show: [Proposed] [Current] [Both]`, applied to all three panels at once.
  Hidden in sandbox mode, where there is no "current".
- In **Both**, the draft draws solid in its normal color and the baseline draws
  dimmed and dashed beneath it, so the proposal always reads first.

**Shared y-domain is a correctness requirement, not polish.** Each `_draw*` in
`probe-plots.js` autoscales from whatever single envelope it receives, so two
passes would silently rescale between them and the comparison would be a lie.
`ProbePlots.draw` therefore gains one optional trailing `opts` argument:

```js
draw(canvas, type, envelope, pins, activePin, xRange, yScale, opts)
// opts: { yDomain?: [lo, hi], noClear?: boolean, ghost?: boolean }
```

`yDomain` overrides autoscaling in the shared range helper; `noClear` skips the
background fill so a second pass composites; `ghost` selects the dimmed/dashed
stroke style. The designer computes the union domain over both envelopes and
passes it to both passes. One contained change to the shared helper rather than
eight rewritten plot functions.

**Phase Space and E/I/ε Triangle are not along-s curves** — they are a single
operating point. "Both" there means two markers, not two lines, and is spec'd
explicitly rather than left to fall out of the generic path.

## Phasing

1. **Draft becomes free editing.** Drop the guard; apply the type filter.
   Fixes the reported defect on its own.
2. **Plan / Apply / transaction / preview.** Append, fit-in-gap insert,
   deletion, param tuning. No moves yet.
3. **Proposed vs. current plots.** `yDomain` in `probe-plots.js`, baseline
   envelope, source toggle.
4. **Downstream displacement + utility reroute.** `moveJunction`, polyline
   displacement, best-effort reroute. Lands on a transaction proven by 2.

Phases 2 and 3 are independent of each other; both feed 4.

## Testing

- **`designer-plan.js` is pure and gets unit tests** in `test/`, following the
  existing `test-utility-*` / pipe-drawing suites: fixture state in, op list
  and blockers out. Cover append at an open end, append before a terminal
  endpoint, insert into a drift with room, insert into a drift without room,
  deletion with pipe merge, and every blocker code.
- **Transaction rollback** gets a test that forces a mid-plan op failure and
  asserts state is byte-identical to the snapshot.
- **Browser coverage** in `test/browser/`: open the designer from a placed
  beamline, click a module card, confirm it enters the draft and the schematic
  updates; apply and confirm the map matches; cancel and confirm it does not.
  The scratch spec written during diagnosis (every card in every category,
  asserting each one lands in the draft) becomes a committed regression test —
  it is exactly the check that would have caught this.
- **Plot comparison**: assert both passes receive the same `yDomain`.

## Out of scope

- Multi-branch beamlines (splitters, mergers) under displacement. The planner
  reports a blocker rather than guessing.
- Re-layout that reroutes around obstacles. A collision is a blocker the player
  resolves, not something the planner pathfinds past.
- Moving the source junction.
