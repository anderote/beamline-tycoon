# Utility Connection Overhaul — ports on the geometry, cable you can aim

**Date:** 2026-08-13
**Status:** Approved for planning

## Problem

Wiring a facility is the main non-beamline activity in the game and it currently
reads as annotation floating over the world rather than as plumbing. Four
distinct defects, one theme: **the utility system has no 3D identity.**

### 1. A port is a point on the floor

`portWorldPosition` (`src/utility/ports.js:96`) returns `{x, z}` — the midpoint
of the footprint edge the port's `side` names, at ground level. Every consumer
then invents its own height:

| Consumer | Height used |
|---|---|
| available-port dots (`utility-line-builder-v2.js:305`) | `PIPE_Y + 0.3` = 0.8 m |
| unwired-sink pins (`:353`) | stem from `PIPE_Y` to `PIPE_Y + 0.7` |
| committed line endpoints (`buildWorldPoints`, `:96`) | `PIPE_Y` = 0.5 m |

None of those relate to the model. A pillbox cavity's power inlet, a rack's
feed and a turbo pump's tap all get a dot 0.8 m over the tile edge, and the
cable stops 0.5 m above the floor *beside* the device rather than entering it.
Devices have no visible connectors at all, so there is nothing for a cable to
plug into even in principle.

### 2. The tool draws half a metre above the cursor

`ThreeRenderer.screenToWorld` (`:732`) raycasts the ground plane at **y = 0**
(`_raycastGround`, `:914`). The utility tool draws its preview and commits its
geometry at **y = 0.5**. Under the iso camera a half-metre of height projects
15–25 px up-screen at normal zoom, so the cable consistently lands above where
the player clicked. This is the "doesn't want to place where you're clicking"
report, and it is a pure projection bug — the *data* is correct, the picture is
displaced.

### 3. The bend order is a dead field

`UtilityLineInputController._preferVerticalFirst` (`:58`) is initialised to
`false` and never assigned again. Every one-bend path therefore turns the same
way (horizontal leg first), and the player has no way to say "go down, then
across". The routing pass added in `buildPortRoutedPath` tries both orders, but
only as a validity search — it silently keeps whichever the validator accepts,
which is not the same as letting the player choose when both are legal.

### 4. You cannot build off an existing line

`_snapToNearestPort` (`:371`) considers ports only. A drag that ends on a trunk
gets an ordinary open end, and `pathOverlapsSameType`
(`src/utility/line-drawing.js:72`) then rejects the commit for overlapping the
trunk it was trying to join. This is the sharpest of the four: network discovery
*already* merges lines that share a subtile (the spatial-union pass,
`network-discovery.js:274`), so branch topology is fully supported by the sim
and is simply unreachable from input. Every branch has to be drawn back to the
source instead, which is why a wired facility looks like a starburst.

## Design

### A. Port anchors — one 3D truth for where a port is

New module `src/renderer3d/port-anchors.js`:

```
portAnchor3D(placeable, def, portName) →
  { x, y, z, out: {x, z}, radius } | null
```

- `x`/`z` stay exactly `portWorldPosition` — the sim's notion of where a port
  is does not change, and nothing about pathing, snapping or costing moves.
- `out` is the port's outward normal in world metres (from `portApproachVec`),
  so fittings, risers and markers all lean the same way.
- `y` comes from an override table if the type declares one, else from the
  component's own model.

Auto-derivation: `getModelBounds(type)` in `component-builder.js` instantiates
the type's role template / parts model once, takes a `THREE.Box3`, caches by
type and disposes the temporary. Anchor height is `bounds.max.y * 0.55`, clamped
to `[0.35, 2.0]` m — mid-shell on a rack, low on a floor-mounted pump, never
underground and never on a roof. The thumbnail generator (`:3845`) already does
exactly this instantiate-and-measure dance, so the mechanism is proven; this
lifts the measurement half out of it.

Overrides live in `src/data/utility-port-anchors.js` as
`{ [type]: { [portName]: { y, out } } }`, hand-authored for the components that
get wired most — the cavities, cryomodule, quadrupole, BPM, turbo/roughing
pumps, transformer, switchgear, the three buses. A missing entry is not an
error; it falls through to the derived value.

### B. Visible fittings

New `src/renderer3d/builders/port-fitting-builder.js`: per declared utility
port, a small flange (collar disc + short stub cylinder, ~0.12 m) at the
anchor, oriented along `out`, in the utility's descriptor colour, at low
saturation so a fully-wired hall doesn't strobe. Built for **every** endpoint
regardless of tool state — the point is that devices visibly have ports — into
a new `portFittingGroup`, signature-guarded on the endpoint set exactly as
`setUnwiredSinkMarkers` is (`:571`), and dropped entirely below the existing LOD
zoom threshold.

The interactive dots stay separate and stay tool-gated: fittings say "there is
a port here", dots say "you can click this one now".

### C. Cables that terminate into the fitting

`buildWorldPoints` gains a riser at each port end: the run stays at `PIPE_Y`
until it reaches the port's (x, z), then climbs to `anchor.y` and steps out
along `out` into the fitting. Three extra points per anchored end, no change to
the stored path — this is presentation only, the sim's path is untouched.

### D. Markers on the anchor

`buildPortMarker` and `buildUnwiredMarker` take the anchor's `y` instead of
their invented constants. The unwired pin's stem then starts at the port it is
complaining about rather than at an arbitrary height over the tile.

### E. Cursor on the cable plane

`ThreeRenderer.screenToWorldAtHeight(screenX, screenY, height)` — same as
`screenToWorld` but intersecting a plane at `y = height` and skipping the
terrain-mesh hit (the terrain is the wrong surface for a cable that flies over
it). `UtilityLineTool` uses it with `PIPE_Y` for down/move/up. The cable then
lands under the cursor.

The height belongs to the tool, not the renderer: `PIPE_Y` is exported from the
line builder and imported by the tool, so there is one constant.

### F. R flips the bend

New optional `Tool.onRotateKey(ctx)`. `InputHandler`'s `'r'` case (`:1204`)
offers the key to the active tool before its placement-rotation and
research-overlay fallbacks. `UtilityLineTool` consumes it, flips
`preferVerticalFirst` on the controller and re-plans from the last cursor
position (the same path `onShiftChange` already uses, `:41`).

`_dragGeometry`'s two-order search stays, but the player's choice is tried
first, so R switches the corner whenever both orders are legal and is a no-op
when only one is.

### G. Tapping an existing line

`_snapToNearestPort` becomes `_snapToNearest`, returning either today's port
anchor or a **tap**: `{ tap: true, lineId, worldPos }` for the nearest point on
a same-utility line within half a tile. Ports win ties — a port under the
cursor is always the more specific intent.

Commit-side, a tap end is an open end whose terminal path point sits on the
tapped line's subtile, which the spatial-union pass then merges into one
network. The overlap check has to allow that one subtile: `validateDrawLine`
gains `opts.tapLineIds` (up to two, one per end) and `pathOverlapsSameType`
skips *only the terminal subtile* of the new path against those lines. Interior
overlap and overlap with any other line still reject — a tap is a T-join at a
point, not a licence to run down a trunk.

Visual: the hover dot over a tap point is drawn as a small ring rather than a
sphere, so "I will join this line" and "I will grab this port" don't look alike.

## Deliberate non-goals

- **No re-routing of committed lines.** Dragging an existing cable to a new
  shape is a separate feature; this is about drawing them correctly the first
  time.
- **No per-port capacity display in world space.** The inspector owns that.
- **No change to path storage, cost, or validation semantics** beyond the tap
  exemption. Saves stay readable (and are disposable anyway, per CLAUDE.md).
- **Anchors are not physics.** Height is presentation; nothing in solve,
  discovery or gating reads `y`.

## Acceptance criteria

1. Clicking a port dot at any zoom starts the drag on that port, and the
   preview line's first segment leaves from under the cursor, not above it.
2. Every component that declares a utility port has a visible fitting on its
   model at the same place its dot appears, and a committed cable visibly
   enters that fitting.
3. R during a drag flips which way the corner turns whenever both orders are
   legal; the tooltip cost updates with it.
4. A drag ending on an existing same-utility line commits, and the two lines
   solve as one network.
5. `findUnconnectedSinks`, solve results, costs and undo behaviour are
   unchanged by any of the above — the accompanying tests for adjacency
   bridging, run-wiring and drag routing all still pass untouched.
