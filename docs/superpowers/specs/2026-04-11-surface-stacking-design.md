# Surface & Stacking System

## Overview

Items can be placed on top of furniture, racks, and other flat-topped objects. Small items (oscilloscopes, monitors, coffee machines) can stack on surfaces or on each other. The system uses parent-child relationships between placed instances rather than extending the 2D subtile occupancy grid.

## Data Model

### Definition Flags

Two boolean flags on raw item definitions (furnishings, equipment, infrastructure):

- **`hasSurface`** (default `true`) — item has a usable flat top that stackable items can be placed on. Set `false` only on items without flat tops (round pumps, cranes, irregular shapes).
- **`stackable`** (default `false`) — item can be placed on surfaces or stacked on other stackable items. Applied to small bench-sized items (typically 1x1 or 1x2 footprint, subH <= 2): oscilloscopes, signal generators, spectrum analyzers, network analyzers, leak detectors, flow meters, beam profilers, mirror mounts, coffee machines, microwaves, alarm panels, projectors, conference phones, scope stations.

### Instance Fields

Each `state.placeables` entry gains three fields:

- **`placeY`** (number, subtile units) — Y origin. `0` for floor-level items. For stacked items: `parent.placeY + parent.subH`.
- **`stackParentId`** (string | null) — ID of the item this sits on, or `null` for floor items.
- **`stackChildren`** (string[]) — IDs of items sitting on top of this one.

### Constraints

- **Footprint containment**: stackable item's footprint cells must fit entirely within the target item's footprint cells.
- **Height cap**: total stack height capped at **8 subtiles (4m)** from floor. `placeY + subH <= 8` for any item in the stack.
- **Subgrid occupancy**: only floor-level items occupy `subgridOccupied`. Stacked items are tracked entirely through the parent-child chain.

## Placement Logic

When placing a stackable item:

1. Snap XZ to subtile grid as usual.
2. Look up `subgridOccupied` at the snapped cells.
3. If occupied, walk the `stackChildren` chain to the topmost item.
4. Check: target has `hasSurface` OR target is `stackable`; footprint containment passes; `target.placeY + target.subH + item.subH <= 8`.
5. If all pass: place at `placeY = target.placeY + target.subH`, set `stackParentId` to target's ID, push item ID into target's `stackChildren`.
6. If unoccupied: place on floor at `placeY = 0`, occupy `subgridOccupied` normally.

## Deletion & Collapse

1. When deleting an item with `stackChildren`, compute each child's new position after collapse.
2. Children reparent to the deleted item's `stackParentId` (or become floor-level if the deleted item was on the floor).
3. All `placeY` values in the chain update: each child shifts down by the deleted item's `subH`.
4. If collapsing would cause any item's `placeY + subH > 8`, block the deletion.
5. If the deleted item was floor-level, its children become floor-level (`stackParentId = null`, `placeY = 0`). Each child registers its own footprint in `subgridOccupied` (their footprints are subsets of the deleted item's, so no new collisions arise).

## Edge Cases

- **Multiple items on one surface**: a 4x2 desk can hold two 1x1 oscilloscopes side by side. Each is an independent child of the desk with its own `stackParentId` pointing to the desk. Footprint containment is checked per-child, not collectively.
- **Stacking stackables**: an oscilloscope on the floor can have another oscilloscope on top of it (both are stackable, first also hasSurface by default). The chain is: floor -> oscA (placeY=0) -> oscB (placeY=1). Height cap applies to the topmost item.
- **Non-stackable items**: large items like chillers, lathes, server racks cannot be stacked. They can *receive* stackable items (if `hasSurface` is true) but cannot be placed on other items.
- **Rotation**: stackable items can be rotated independently of their parent. Footprint containment check uses the rotated footprint.

## 3D Rendering

In `equipment-builder.js`, read `placeY` from the instance (default `0`):

- **Parts path**: `group.position.set(centerX, placeY * SUB_UNIT, centerZ)` (was `y = 0`).
- **Single-box path**: `mesh.position.set(centerX, placeY * SUB_UNIT + h/2, centerZ)` (was `y = h/2`).

Ghost preview during placement mode also uses the computed `placeY` for visual feedback.

## Input / UX

- **No new input mode** — auto-detection handles surface vs floor placement. The elevated ghost preview gives clear feedback.
- **`screenToWorld`** unchanged — still raycasts the ground plane for XZ snapping.
- **Stack target resolution** happens after XZ snap: find ground occupant, walk stack chain, compute target Y.
- **Demolish**: existing `raycastScreen` + `identifyHit` naturally hits individual meshes at different heights. Clicking any item in a stack targets that specific item. Collapse-validity check runs before confirming.
