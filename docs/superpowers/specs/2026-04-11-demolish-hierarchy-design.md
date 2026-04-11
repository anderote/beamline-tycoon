# Demolish Hierarchy & Unified Delete — Design

**Date:** 2026-04-11
**Status:** Approved (brainstorming)

## Problem

Delete/demolish behavior is inconsistent across the game. The same logical action ("recycle this beamline component") flows through different code paths depending on whether the user used a context menu, a window's action button, or a demolish-mode click. Each path does slightly different refund calculation, undo, event emission, and logging. The cascading demolish-mode hierarchy (`DEMOLISH_PLACEABLE_SCOPE` in `src/input/InputHandler.js:16`) doesn't cleanly map to the object-kind hierarchy users see in context menus, and several windows (`BeamlineWindow`, `MachineWindow`) have no delete action at all. Demolish hit-testing is also tile-based, which feels imprecise — users want to click the *visual* of an object, not the floor tile underneath.

## Goals

- One unified delete entry point so every code path produces identical state changes.
- A demolish-mode hierarchy whose tiers correspond to user-meaningful object kinds.
- Hover-based visual feedback (red outline, name, recycle price) on every demolish mode.
- Hit-testing against an object's visual region, not its floor tile. Generous for long/narrow beam pipes.
- Floors and walls get a tile/edge-based variant of the same overlay since they *are* grid geometry.

## Non-Goals

- Changing refund percentages (still 50%).
- Reworking the undo system internals.
- Reworking the per-kind low-level cleanup logic in existing `Game.remove*` methods.

## Design

### 1. Demolish hierarchy (single source of truth)

A new module `src/input/demolishScopes.js` defines every demolish mode in one table. Replaces `DEMOLISH_PLACEABLE_SCOPE` at `src/input/InputHandler.js:16-31`.

**Cascading tiers** — each tier deletes its own kind plus everything below:

| Tier | Mode | Deletes |
|---|---|---|
| 1 | `demolishBeamline` | beamline nodes + beam pipes + attachments + machines + equipment + furnishing + decoration |
| 2 | `demolishEquipment` | equipment + furnishing + decoration |
| 3 | `demolishFurnishing` | furnishing + decoration |
| 4 | `demolishDecoration` | decoration |

**Standalone single-kind modes** (not part of the cascade — each affects only its own kind):
`demolishWall`, `demolishDoor`, `demolishFloor`, `demolishZone`, `demolishUtility`

**Special:** `demolishAll` — deletes everything on the hovered tile, iterating cascade tiers top-to-bottom and then standalone systems.

The demolish menu in the HUD has 4 cascade buttons + 5 standalone buttons + `demolishAll` = 10 buttons total. No automatic mode selection — users pick the tool.

### 2. Hover visual

A new module `src/renderer/demolishHover.js` owns the hover presentation. It renders:

- **Red outline** traced around the target's visual bounds
- **White name** label above the target
- **Green "+$N (recycle)"** price label below

This object-shaped overlay is used by all placeable-tier modes (`demolishBeamline`, `demolishEquipment`, `demolishFurnishing`, `demolishDecoration`, `demolishAll` when hovering a placeable, plus `demolishUtility` and `demolishDoor` since those feel object-like).

**Floor/wall variant** — same module, different geometry, since floors and walls *are* the grid:

- `demolishFloor`: red-tinted tile fill + "+$N" label centered on the tile
- `demolishWall`: red thick-line along the specific edge being hovered + "+$N" label

Both variants share color, font, and refund logic via a single module so styling stays unified.

The overlay only renders when `state.demolishMode` is set and the hit test returns a non-null target. No false-positive red boxes.

### 3. Hit-testing by visual region

A new module `src/input/demolishHitTest.js` exports a function that takes a world-space mouse position and the active demolish mode, and returns the topmost deletable target as `{ kind, id, bounds, name, refund }` — or null.

**Per-kind hit test:**

- **Beamline nodes, equipment, furnishing, decoration, machines** — raycast against the 3D object group built by `src/renderer3d/component-builder.js`. Use the existing mesh bounds, not `state.subgridOccupied`.
- **Beam pipes** — expand the pipe segment AABB by ~0.25 tile on the perpendicular axis so long/narrow pipes are easy to grab. Ranked *below* nodes/equipment so overlapping cases prefer the solid object.
- **Attachments** — tested against their mesh bounds on the parent pipe.
- **Walls** — project mouse to the nearest tile edge within ~0.3 tile; require the edge to have a wall.
- **Doors** — same as walls but require a door.
- **Floors / zones / utility connections** — fall back to tile-based hit test (these *are* tile-level concepts).

**Topmost selection:** within a cascade mode, iterate the tiers top-to-bottom and return the first hit. For `demolishAll`, same iteration but also falls through to standalone kinds.

### 4. Unified removal path

A new method `Game.demolishTarget(target)` is the single delete entry point. It:

1. Looks up the object by `{ kind, id }`.
2. Computes refund via the shared `demolishRefund()` util (extracted from `InputHandler.js:17`).
3. Dispatches to the existing low-level `Game.remove*` method for that kind. The per-kind cleanup logic stays — this layer just unifies the wrapper concerns.
4. Emits a single `demolished` event with `{ kind, id, refund, name }`.
5. Pushes one undo point.
6. Logs via one shared formatter.

**Every entry point routes through `demolishTarget`:**

- Demolish-mode click → hit-test → `demolishTarget`
- Component popup "Recycle" button (`src/renderer/overlays.js:167`) → `demolishTarget`
- Facility popup "Remove" button (`src/renderer/overlays.js:280`) → `demolishTarget`
- `EquipmentWindow` "Remove" button (`src/ui/EquipmentWindow.js:35`) → `demolishTarget`
- New "Demolish (50% refund)" buttons added to `BeamlineWindow` and `MachineWindow` → `demolishTarget`

A beamline node deleted via right-click, popup, context window, or demolish mode now runs the exact same code.

### 5. Mode entry/exit

- Each tool sets `state.demolishMode = '<modeName>'`. The hit-test module reads that string to know which scope to use.
- Right-click anywhere or `Esc` exits demolish mode (existing behavior preserved).
- The current context-aware auto-selection logic in `InputHandler.js:2832-2852` is removed — users pick the tool explicitly from the demolish menu.

## Files Touched

**New:**
- `src/input/demolishScopes.js` — scope table + `demolishRefund()` util
- `src/input/demolishHitTest.js` — visual-region hit testing
- `src/renderer/demolishHover.js` — shared overlay (object variant + floor/wall variant)

**Modified:**
- `src/input/InputHandler.js` — replace `DEMOLISH_PLACEABLE_SCOPE`, `_findDeletablePlaceable`, `_demolishRefund`; route clicks through hit-test → `demolishTarget`; remove auto-selection logic
- `src/game/Game.js` — add `demolishTarget(target)`; existing `remove*` methods stay as low-level helpers
- `src/renderer/overlays.js` — popup buttons call `demolishTarget`
- `src/ui/EquipmentWindow.js` — unified delete button
- `src/ui/BeamlineWindow.js` — new "Demolish (50% refund)" button
- `src/ui/MachineWindow.js` — new "Demolish (50% refund)" button
- `src/data/modes.js` — add the new demolish mode entries
- `src/renderer/hud.js` — render demolish menu with the 10 buttons

**Out of scope:** existing refund percentages, undo system internals, the underlying per-kind cleanup logic in `Game.remove*`.

## Success Criteria

- Deleting a beamline node via popup, context window, or demolish mode produces identical state, undo, refund, log line, and `demolished` event.
- Hovering any placeable object in demolish mode shows the red outline + white name + green refund.
- Beam pipes can be hit by clicking near the pipe, not just on the floor tile under it.
- Floors and walls get tile/edge-shaped highlighting in their respective demolish modes.
- The 4 cascade tiers + 5 standalone modes + `demolishAll` are all reachable from the demolish menu, each tool affecting only the kinds in its scope.
- No code path bypasses `demolishTarget`.
