# Windows — glazed openings in walls, and the daylight they let in

**Date:** 2026-08-13
**Status:** Approved for planning

## Problem

Walls are opaque slabs and doors are the only thing that ever breaks one. A
facility built in this game is a set of windowless concrete boxes: office
blocks with no glazing, control rooms with no view of the hall they control,
hutches with no observation window. There is no way to see into a room from
outside, no way to give an interior room borrowed light, and at night — now
that the lighting pass has made night genuinely dark — a lit building reads
from the outside as a black box with a glow leaking over the top of the walls.

Doors already prove the mechanic works: edge-placed, per-type geometry, drag
along a run, own palette tab. Windows are the missing sibling.

## Scope

**In:** a `WINDOW_TYPES` catalogue of six types with glass-tint variants,
edge placement with its own state and save field, 3D rendering (frame, glass,
wall fill above/below/beside), a night glow on the glass driven by the
existing darkness ramp, and a daylight contribution to room morale.

**Out:** new textures (frames reuse existing materials, glass is coloured
material, palette previews use the existing colour-swatch fallback); window
breakage/dirtiness; blinds or opening sashes; skylights or roof glazing
(there are no roofs); any 2D-renderer work (the 2D renderer never drew walls
or doors).

## Model

### Windows are not doors

The tempting shortcut is to add windows to `DOOR_TYPES` with an `isWindow`
flag and inherit the whole pipeline free. That is wrong for one specific
reason: `Game._detectRoom` treats `state.doorOccupied[key]` as **passable**.
An edge with a door does not separate rooms; it merges them, and the same map
feeds pawn movement and room-scoped effects. A window in `doorOccupied` would
let staff walk through glass and would silently merge every room that has a
window between it and the next.

So windows get their own catalogue and their own occupancy map, and are read
by nothing that asks "can I get through here".

### Edge slot

A window occupies the same `col,row,edge` slot a door does, under the same
dual-representation aliasing the rest of the edge code uses
(`InputHandler._edgeAlias`). One opening per edge: placing a window where a
door sits removes the door, and vice versa. A window requires an existing
wall on that edge — it is a hole in a wall, not a free-standing pane — and it
requires that wall to be tall enough (see Fit rule).

### Catalogue

Six types in three palette subsections. Heights are in the same data units
walls and doors already use (`wallHeight: 14` ≈ one 1.5 m storey, scaled by
`HEIGHT_SCALE` in `wall-builder.js`).

| Type | Subsection | Width | Sill | Opening h | Daylight | Variants |
|---|---|---|---|---|---|---|
| `officeWindow` | interior | single | 5 | 6–15 | 0.4 | Clear / Tinted / Frosted |
| `glassPartition` | interior | double | 1 | 11–21 | 0.6 | Clear / Frosted / Reeded |
| `pictureWindow` | exterior | double | 3 | 8–19 | 0.8 | Clear / Tinted / Mirrored |
| `industrialSash` | exterior | double | 4 | 8–24 | 0.5 | Clear / Wired / Grimy |
| `leadedObservation` | shielded | double | 2 | 11 | 0.2 | Clear / Amber |
| `hutchViewport` | shielded | narrow | 4 | 9 | 0.05 | — |

`single` is 0.7 tile, `double` is the full tile, and `narrow` is 0.6 tile.
The first opening-height number is the placement minimum and still fits a
standard 14-high wall. In taller interior and structural walls, the renderer
expands the aperture toward the second number while preserving a visible
header band. This keeps old saves and shielding-wall placement compatible
without leaving architectural windows at the undersized pre-tall-wall scale.

Variants are the mechanism `structuralWall` already uses — `variants`,
`variantPreviewColors`, and per-variant cost — but drive **glass colour and
opacity** rather than a texture swap. `industrialSash` additionally draws a
3x3 factory mullion grid; `leadedObservation` draws a thicker frame around one
broad green-tinted pane; `hutchViewport` is a compact port in a heavy frame.

Frames reuse existing tiled materials: `metal_brushed` for the sash and
partition types, `drywall_painted` for the office window, `metal_dark` for
the two shielded types.

### Fit rule

A window is placeable only where `wallHeight >= sillHeight + openingHeight + 1`.
That keeps every opening inside its wall with at least a token header, and it
naturally excludes the walls where a window makes no sense: cubicle dividers
(height 8), hedges, and fencing. Placement on a wall that fails the rule is a
no-op — no charge, no state change. The drag preview does not distinguish
valid from invalid edges; the tool simply places fewer windows than the
ghost showed, which matches how the door tool already behaves on edges it
cannot use.

### Daylight

Windows feed the room-morale system that already exists. `computeRoomMorale()`
sums `effects.morale` per detected room from zone furnishings; windows add a
second contribution to the same map.

For each placed window, both tiles adjacent to its edge are considered. For
each side, the room is detected with `_detectRoom`; if that flood fill hits
its 500-tile cap the side is outdoors and contributes nothing. Otherwise the
window's `daylight` value is added to that room's total. An interior glass
partition therefore lights both rooms it divides — borrowed light, which is
the actual architectural reason to build one.

Per-room daylight is capped at **3.0** before it joins the furnishing total,
so a wall of picture windows saturates rather than becoming an infinite morale
faucet. The cap applies to the daylight contribution alone, not to furnishing
morale.

No new state field, no new loop: daylight is computed inside
`computeRoomMorale` and flows out through `moraleMultiplier` exactly as
furnishing morale does today.

### Rendering

Windows render in `wall-builder.js` alongside doors, because they need the
same inputs the door pass already assembles: the wall-type-by-edge lookup,
the material cache, cutaway/transparent state, and the rule that a wall
coinciding with an opening is skipped so the opening builder can rebuild the
surrounding segments itself.

The door pass currently owns roughly eighty lines of "fill the wall around
this opening" — side fills for sub-tile widths and the band above the head.
Windows need the same logic plus a band **below the sill**. That logic is
factored into one shared private method on `WallBuilder`, parameterised by
opening width, bottom and top; the door pass calls it with bottom `0` and
the window pass with bottom `sillHeight`. Doors keep their existing visual
result exactly.

The window pass itself adds, per placed window:

- a frame — sill, head, and two jambs, plus mullions for `industrialSash` —
  in the type's frame material;
- a single thin glass box spanning the opening, using a transparent
  `MeshStandardMaterial` with the variant's colour and opacity, low
  roughness, `castShadow = false`;
- the wall fill below, above, and (for sub-tile widths) beside the opening,
  via the shared method.

`_cacheKey` gains the window data so a placement rebuilds.

**Night glow.** Glass panes are registered on the builder and exposed to
`ThreeRenderer._updateLightingRamp()`, which already runs a scalar-only pass
over fixture emitters, light pools and halos each frame using `this._darkness`.
Panes get a warm emissive scaled by the same darkness value via a
`glassGlowForDarkness(darkness)` helper exported from `lighting-builder.js`,
keeping every darkness ramp in the file that owns the taste knobs. The result:
as night falls, a facility's windows come up warm from the outside. No
geometry work, no per-frame allocation, and the ramp stays in lockstep with
the fixtures.

### Placement and UI

- `MODES.structure.categories.windows`, positioned after `doors`, with
  subsections `interior` / `exterior` / `shielded`.
- `hud.js` gains a `windows` palette branch modelled on the doors branch, but
  with the variant flyout the walls branch uses, since every window type but
  one has tint variants.
- A `WindowTool` in `structure-tools.js` mirroring `DoorTool`: drag along a
  wall run, commit through `game._withUndo(() => game.placeWindowPath(...))`.
- `paletteKind: 'window'` in the `_showPreviewForFocusedItem` switch and in
  the tool dispatch.
- Demolish: `_findWallOrDoorAtEdge` and `_removeWallAndDoorAtEdge` extend to
  windows, so the demolish tool picks them up with the same tooltip and
  refund path walls and doors use.
- `sprites.js` def lookup includes `WINDOW_TYPES`.

### Save

`state.windows` (array of `{ type, col, row, edge, variant }`) joins
`SAVE_KEYS`; `state.windowOccupied` is derived on load and on scenario apply,
exactly as `doorOccupied` is. Pre-release, single-user: old saves break, and
that is fine — no migrator.

## Testing

`test/test-windows.js`, in the style of its neighbours (`node test/<file>.js`,
non-zero exit on failure):

- **Catalogue invariants** — every entry has `isWindow`, a `subsection` that
  exists in `MODES.structure.categories.windows`, a `daylight` value, and a
  sill+opening that fits a 14-high wall.
- **Rooms stay separate** — a window on an edge between two tiles does not
  merge them in `_detectRoom`, where a door on the same edge does.
- **Fit rule** — placement succeeds on an `officeWall` and is a no-op on a
  `cubicleWall`, with no funding charged in the second case.
- **Mutual exclusion** — placing a window on a door edge removes the door and
  leaves exactly one opening; the reverse also holds.
- **Save round-trip** — `windowOccupied` rebuilds from `windows` on load.
- **Daylight morale** — a room with windows gains the expected total; the
  3.0 cap holds; a window whose room detection runs outdoors adds nothing;
  a glass partition credits both of the rooms it divides.

## Files

| File | Change |
|---|---|
| `src/data/structure.js` | `WINDOW_TYPES` catalogue |
| `src/data/modes.js` | `structure.categories.windows` |
| `src/game/Game.js` | state, place/remove/path, save keys, daylight in `computeRoomMorale` |
| `src/renderer3d/world-snapshot.js` | `windows` in the snapshot |
| `src/renderer3d/wall-builder.js` | shared opening-surround method, window pass, glass registry |
| `src/renderer3d/ThreeRenderer.js` | pass window data, glass in the darkness ramp, window drag preview |
| `src/renderer3d/lighting-builder.js` | `glassGlowForDarkness` |
| `src/input/structure-tools.js` | `WindowTool` |
| `src/input/InputHandler.js` | tool dispatch, preview panel, demolish edge lookup |
| `src/ui/hud.js` | windows palette branch |
| `src/renderer/sprites.js` | def lookup |
| `test/test-windows.js` | new |
