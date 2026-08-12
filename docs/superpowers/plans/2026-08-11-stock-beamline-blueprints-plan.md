# Stock Beamline Blueprints — implementation plan

**Goal.** RCT2 ships every coaster type with a handful of prebuilt, working
designs. We ship every `BEAMLINE_TYPES` entry with 2–3 prebuilt, **physics-
validated** beamlines at ascending tiers, browsable from the type picker, and
placeable as a translucent ghost on the map.

## What already exists (do not rebuild)

| Piece | File | State |
|---|---|---|
| Type roster (9 types, spec bands, palette filtering) | `src/data/beamline-types.js` | Complete |
| RCT2-style type picker | `src/ui/BeamlineTypePicker.js` | Complete |
| Ghost placement: layout, cost quote, collision, rollback | `src/ui/DesignPlacer.js` | Complete, but ghost is flat tile tint |
| Saved-design library overlay | `src/ui/DesignLibrary.js` | Complete, user designs only |
| Design record shape | `Game.addDesign` | `{id, name, category, components:[{type,params,bendDir}]}` |

So this feature is **content + curation + one UI surface**, not new placement
machinery. The design record shape already carries everything a blueprint needs.

## What is missing

1. Blueprints as *data* (they must always exist and be undeletable, so they
   cannot live in `state.savedDesigns`).
2. Any way to check a design actually produces an in-band beam.
3. Components for tiers that currently have no hardware that reaches them.
4. A browse surface, and the picker → placer handoff.
5. A ghost that looks like the machine rather than a green rectangle.

## Acceptance criteria for a blueprint

A blueprint ships only if the headless evaluator says:

- final energy inside `type.spec.energyGeV`
- final current inside `type.spec.currentMA` (types that declare one)
- `spotSizeMm` inside band where the type declares one (isotopeIrradiation)
- `beamAlive === true` — it must actually deliver beam, not survive on paper.
  **Not** a transmission floor: `totalLossFraction` folds in RF capture
  efficiency (a bunched S-band line reads 0.55 purely from its 0.45 capture),
  so any threshold on it would reject every correctly-built bunched machine.
  Loss is reported as a diagnostic; the current band is the real gate.
- terminates in one of `type.requiredEndpoint`
- every component passes `beamlineTypeHidesComponent` for its own type

A blueprint that cannot meet these is a **finding**, not a fudge: either the
component library has a real gap (fill it) or the type's band is wrong (report
it, do not silently retune the type to match a weak template).

---

## Phase 0 — Extract the physics payload builder

`Game._recalcBeamlineEntry` builds the element array for Pyodide inline
(`Game.js` ~2918–2990). The evaluator must produce a **byte-identical** payload
or it validates a machine the player never gets.

- New `src/beamline/physics-payload.js` exporting
  `buildPhysicsElements(orderedNodes, { componentHealth, nodeQualities })`.
- Move the block verbatim; `Game.js` calls it.
- Test: a fixed ordered-node fixture through both old and new produces
  deep-equal output (pin with a snapshot committed in the test).

No behaviour change. This is the seam everything downstream hangs off.

## Phase 1 — Headless evaluator

`scripts/eval-design.mjs`, plus `beam_physics/eval_design.py` as the thin
Python side.

- Node: blueprint → ordered nodes → `buildPhysicsElements` → JSON on stdout.
  The ordering **must** reproduce what `DesignPlacer.confirm()` actually lays
  down: modules in sequence, one drift per inter-module pipe, attachments
  distributed onto the pipe *following* the preceding module at evenly spaced
  positions. Factor that walk out of `DesignPlacer` into
  `src/beamline/design-layout.js` so the placer and the evaluator cannot drift
  apart — a shared `layoutDesign(design)` returning `[{kind, type, params, subL}]`.
- Python: `compute_beam_for_game` on the payload, print result JSON.
- Node: compare against the type's bands, print a table, exit non-zero on fail.

```
node scripts/eval-design.mjs            # all blueprints
node scripts/eval-design.mjs therapy    # one type
node scripts/eval-design.mjs --verbose  # per-element trace
```

Guard test (`test/test-design-layout.js`): place a blueprint headlessly through
the real `DesignPlacer`, `flattenPath` the result, and assert the node type
sequence equals `layoutDesign`'s. This is the test that keeps "validated" and
"what you get" the same thing.

## Phase 2 — Component gap fill

Driven by Phase 1 output, not by guesswork. Known gaps from the catalogue audit:

- **`cyclotron230`** — therapy's band is 70–250 MeV and `cyclotron70` tops out
  at exactly the floor. IBA C230 class, compound source, ~$45M.
- **`energyDegrader`** — how every cyclotron therapy line actually varies depth:
  attachment, drops energy, pays in emittance and energy spread. Makes the
  therapy band playable instead of a single point.
- **`scanningMagnet`** — raster scanning. Directly serves the
  `spotSizeMm: [5, 50]` band that isotopeIrradiation scores on, which nothing
  currently controls deliberately.
- **`positronSource`** — collider is `e+e-` and no positron hardware exists.
  Check whether the physics layer has a positron species before committing;
  if not, the collider blueprint is a target-converter + damping section and
  the species work is called out as deferred rather than faked.

Prefer **params over new components** wherever the existing part can be tuned —
quadrupole gradient is already 0.01–50 T/m, so "small magnet" is a param, not a
new SKU. Add a component only when the evaluator proves no tuning reaches the band.

## Phase 3 — Author the blueprints

`src/data/stock-designs.js`. Entry shape:

```js
{
  id: 'therapy-cyclotron-gantry',   // stable key
  typeId: 'therapy',                 // BEAMLINE_TYPES id
  tier: 2,                           // 1..3 WITHIN the type — a ladder, not the type's tier
  name: 'Cyclotron + Gantry Room',
  blurb: 'One-sentence pitch, RCT2 ride-list voice.',
  components: [{ type, params }],    // same shape as savedDesigns
}
```

Roughly 22 blueprints, weighted toward the low tiers where the player actually
starts: 3 each for testStand / ebeamProcessing / isotopeIrradiation / therapy,
2 each for spallation / lightSource / xfel / euvFel / collider.

Each tier within a type is a real progression — more energy, more current, or
better beam quality — not the same machine with a bigger price tag.

**`lightSource` caveat.** The flattener is linear and `flattenPath` stops
silently on rings; `photonFlux` is not implemented. Its blueprints are the
injector + arc + insertion straight, validated on energy and current only. Say
so in the blurb and in the plan's closing notes rather than pretending the ring
is modelled.

## Phase 4 — Blueprint gallery UI

Extend `BeamlineTypePicker` rather than adding a fourth overlay. Selecting a
type reveals its blueprints in a right-hand column:

- Cards: name, tier pips, energy/current the evaluator measured, build cost,
  blurb. **Show measured values, not nameplate claims** — the numbers come from
  a generated `stock-designs.measured.json` that Phase 1 writes, so the card
  cannot lie about what the machine does.
- A permanent **"Custom — empty palette"** entry: picking a type and building
  it yourself stays first-class.
- Confirm → set `pendingBeamlineTypeId` → `DesignPlacer.start(blueprint)`.
- Locked types keep their existing greyed treatment; their blueprints are
  visible but unplaceable, because showing what you cannot have yet is the
  point of the roster.

Also surface blueprints read-only in `DesignLibrary` under a "Stock" tab, with
**Duplicate to My Designs** as the editing path — that is how a player learns
the component library.

## Phase 5 — Ghost that looks like the machine

Today `ThreeRenderer._renderCursors` tints footprint tiles green/red. Upgrade to
translucent component meshes at the previewed transform, which is what makes it
read as RCT2.

- `previewTiles` gains the per-module `{type, dir}` the placer already computes.
- Renderer instantiates the same builders `_refreshComponents` uses, with a
  translucent override material, into a disposable ghost group.
- Keep the red tint for invalid placements — that signal is doing real work.
- Rebuild only when the placer's transform signature changes (position,
  rotation, design id), never per frame.

Mesh reuse and disposal must follow the existing `utility-line-builder-v2`
pattern; a ghost that leaks geometry every mouse move is worse than tiles.

## Phase 6 — Integration, tests, docs

- `DesignPlacer.confirm()` stamps the beamline type. Today the type is consumed
  by `_ensureBeamlineForSourcePlaceable` when a source is placed; a blueprint
  places its own source, so `pendingBeamlineTypeId` must be armed *before* the
  first `placeJunction` and the resulting entry verified to carry it.
- Blueprint placement is already all-or-nothing via `_makeUndoEntry` — extend
  the rollback test to cover a blueprint that fails midway.
- `test/test-stock-designs.js`: every blueprint references live component ids,
  targets a live type id, respects its type's palette filter, ends in a
  `requiredEndpoint`, and has a unique id. Registry-integrity style.
- `test/test-blueprint-physics.js`: the measured JSON is in-band for every
  blueprint. This is the regression that catches a physics change silently
  invalidating the shipped content.
- Wiki page per the existing `src/data/wiki` structure: what a blueprint is,
  the tier ladder per type, and that they are starting points rather than
  optimal builds.

## Ordering

0 → 1 → 2 ⇄ 3 (iterate: author, measure, fill gaps, re-measure) → 4 → 5 → 6.

Phases 4 and 5 are independent of each other and can run in parallel once 3
settles the data shape.

## Explicit non-goals

- Figures of merit. `fom` is declared in `beamline-types.js` and **not
  implemented** — no `photonFlux`, `felBrilliance`, `doseAvailability` anywhere
  in `beam_physics/`. Blueprints are validated against `spec` bands only.
  This is upstream of that work, not a substitute: the calibration note in
  `beamline-types.js` asks for reference recipes to measure `fomRef` against,
  and these blueprints are exactly those recipes.
- Ring physics for `lightSource`.
- Rebalancing type bands to accommodate a template that will not reach them.
