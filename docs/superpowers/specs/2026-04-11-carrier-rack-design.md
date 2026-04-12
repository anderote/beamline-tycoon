# Carrier Rack Utility Distribution Design

## Summary

Replace the floor-level connection tile system with an elevated **carrier rack** — a structural framework at 4m height that carries all utility pipes and cables. Players place rack segments on a 2x2 grid, then paint utility types onto them. The rack has fixed slots: heavy pipes (cryo, vacuum, RF waveguide, cooling water) hang below a bottom rail, while light cables (power, data fiber) sit in an open tray on top. Last-meter vertical drops connect rack-mounted utilities to component ports below.

## Carrier Rack Structure

### Physical description

The carrier rack is a steel framework at **4m height** spanning a **2x2 tile footprint** (4m × 4m in world space). Each segment consists of:

- **Top cable tray**: open mesh tray with raised side lips, holds power cables and data fiber
- **Bottom pipe rail**: horizontal structural member from which heavy pipes are suspended
- **Four vertical supports**: two on each lateral side, at the ends of the 2x2 segment, running from floor to rack height. Supports are thin steel columns (~0.1m square)

### Non-blocking placement

Rack supports do not block placement of anything underneath. Beamline components, infrastructure equipment, floors, walls, and other placeables build freely below the rack. The rack occupies airspace only — its ground-level supports are treated as pass-through for placement collision purposes.

### Auto-connecting geometry

Adjacent rack segments automatically connect to form continuous runs. The system determines segment type from cardinal adjacency:

| Adjacent neighbors | Segment type |
|---|---|
| 1 neighbor | End cap (dead end) |
| 2 opposite neighbors | Straight |
| 2 adjacent neighbors (90°) | L-bend |
| 3 neighbors | T-junction |
| 4 neighbors | X-cross |
| 0 neighbors | Isolated (all four sides capped) |

The auto-connection logic matches the existing wall system pattern. Supports, rails, and tray geometry adapt to the segment type — straights have continuous rails, bends curve, junctions branch.

### Placement rules

- Rack segments are placed on a **2x2 tile grid** — the anchor tile is the top-left corner, and the segment occupies the 2x2 area from (col, row) to (col+1, row+1)
- Rack segments can only connect to other rack segments whose 2x2 footprints are cardinally adjacent (sharing a 2-tile edge)
- Multiple rack segments can be placed by click-dragging, like floor tiles

## Utility Pipe Slots

Each rack segment has **fixed, predefined positions** for all six utility types. Pipes and cables only render in their slot when that utility type has been painted onto the segment.

### Bottom rail — heavy pipes (hanging below)

Listed from left to right when looking down the rack's primary direction:

| Slot | Utility Type | Profile | Color |
|---|---|---|---|
| 1 (outer left) | cryoTransfer | round, vacuum-jacketed | teal `#44aacc` |
| 2 (inner left) | vacuumPipe | round pipe | gray `#888888` |
| 3 (center) | rfWaveguide | rectangular | red `#cc4444` |
| 4 (inner right) | coolingWater | round pipe | blue `#4488ff` |

Pipes hang below the bottom rail on short brackets/hangers. The vertical center of the pipes is approximately 0.2m below the bottom rail.

### Top cable tray — light cables (resting on top)

| Slot | Utility Type | Visual | Color |
|---|---|---|---|
| Left half | powerCable | cluster of 3-4 round cables | green `#44cc44` |
| Right half | dataFiber | cluster of 4-5 thin cables | white `#eeeeee` |

Power and data cables render as multiple small round cross-sections loosely filling their half of the tray, not as a single fat pipe. This gives a realistic cable-tray appearance.

### Slot positions are constant

The left-to-right ordering and spacing of slots is identical on every rack segment regardless of which utilities are painted on. When only some utilities are present, their slots render pipes but the empty slots remain invisible — the rack doesn't collapse or rearrange.

## Painting Utilities

### Mechanic

Painting utilities onto rack segments uses the same interaction as the current connection painting:

1. Player selects a utility type from the infrastructure panel (e.g. "RF Waveguide")
2. Player clicks or click-drags across placed rack segments
3. Each touched rack segment gains that utility type — the corresponding pipe/cable appears in its slot
4. Painting a utility type onto a tile with no rack segment does nothing

### Per-segment state

Each rack segment stores a `Set<connType>` of assigned utility types, analogous to the old `game.state.connections` Map but keyed on rack segment position.

### Demolition

- Removing a utility type from a rack segment removes just that pipe/cable from the slot
- Removing a rack segment removes the structure and all utility assignments on it

## Last-Meter Connections

### Vertical drops

When a rack segment carries a utility type that matches a port on a component directly below:

1. **Vertical pipe** drops straight down from the utility's slot position on the rack to the component's port height (0.5m)
2. **Short horizontal stub** connects from the vertical drop into the component's side-face port

### Connection detection

- The system checks whether any rack segment occupies the 2x2 area above a component's tiles
- If a rack segment is overhead and carries a matching utility type, the connection is made
- The drop connects to whichever lateral side of the component is closer to the pipe's slot position on the rack
- Components that span multiple tiles: connection checks all tiles the component occupies

### Component port rules (unchanged from previous design)

- **Modules**: vacuum ports on beam axis (front/back), utility ports on lateral side faces at 0.5m
- **Attachments**: utility ports on lateral side faces at 0.5m, no vacuum ports
- **Drift tubes**: no ports, no attachments
- **Infrastructure equipment**: output ports on lateral side faces (these connect UP to the rack, same vertical drop logic in reverse)

### Infrastructure equipment connections

Infrastructure equipment (substations, chillers, RF sources, etc.) connects to the rack the same way — if a rack segment is overhead and the equipment has an output port for that utility type, a vertical pipe routes between them. The equipment feeds utility into the rack network, which distributes it to beamline components.

## Network Discovery

### Replacing floor connection tiles

Rack segments replace `game.state.connections` as the network primitive:

- **Data structure**: `game.state.rackSegments` — a Map of `"col,row"` (anchor tile) to `{ utilities: Set<connType> }`
- **Adjacency**: two rack segments are adjacent if their 2x2 footprints share a 2-tile edge (cardinal neighbors on the 2x2 grid)
- **Flood fill**: per-utility-type flood fill across adjacent rack segments that carry the same type, identical algorithm to current `Networks._discoverType()` but operating on rack segment adjacency

### Finding connected equipment and beamline nodes

- For each rack network (connected cluster of rack segments carrying the same utility type), find all beamline components and infrastructure equipment whose tiles fall within any rack segment's 2x2 footprint
- This replaces the current cardinal-adjacency check with a vertical overlap check
- Equipment/components must have a matching port type to be considered connected

### Validation

All existing network validation logic (power capacity, RF frequency matching, cooling capacity, vacuum conductance) operates on the rack-based networks. The validation functions receive the same network shape (`{tiles, equipment, beamlineNodes}`) — only the discovery input changes.

## Rendering

### New: `rack-builder.js`

Builds the 3D geometry for carrier rack segments:
- Vertical supports (thin steel columns from floor to 4m)
- Bottom pipe rail (horizontal member)
- Top cable tray (mesh tray with side lips)
- Junction geometry (straights, bends, T/X junctions)
- Auto-connecting based on adjacency

### Modified: `utility-pipe-builder.js`

Replaces floor-level pipe rendering with:
- Pipes in their designated rack slots (bottom rail hangers)
- Cable clusters in the top tray
- Vertical drop geometry from rack to component ports
- Cryo jacket visual on cryoTransfer pipes

### Modified: `world-snapshot.js`

`buildUtilityRouting()` changes to:
- Read rack segment data instead of floor connection tiles
- Compute rack segment adjacency and junction types
- Compute vertical drop routes from rack to components below

### Modified: `ThreeRenderer.js`

- Add rack builder and its scene group
- Update refresh cycle to rebuild rack geometry when rack segments change

### Unchanged

- `utility-ports.js` — port assignment data stays the same
- `utility-port-builder.js` — port stub rendering on components stays the same
- `component-builder.js` / `equipment-builder.js` — port stub integration stays the same

## Data Model

### Rack segment

```js
{
  col: number,        // anchor tile (top-left of 2x2)
  row: number,
  utilities: Set<string>,  // e.g. Set(['powerCable', 'rfWaveguide'])
}
```

### Game state

```js
game.state.rackSegments  // Map<"col,row", { utilities: Set<connType> }>
```

Replaces `game.state.connections`.

### Rack segment adjacency

Two segments at (c1,r1) and (c2,r2) are adjacent if:
- `|c1 - c2| === 2 && r1 === r2` (east/west neighbors)
- `c1 === c2 && |r1 - r2| === 2` (north/south neighbors)

This is because each segment occupies a 2x2 area, so adjacent segments are 2 tiles apart on one axis.
