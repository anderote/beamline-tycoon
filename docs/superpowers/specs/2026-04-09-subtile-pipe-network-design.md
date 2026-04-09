# Subtile Pipe Network Design

## Summary

Replace the tile-level utility connection system with a subtile-level pipe routing system. Pipes are thin, single-unit-width lines that players place by click-and-dragging straight lines across the 4x4 subtile grid. Multiple pipe types can stack vertically at the same subtile position, and same-type pipes merge into a single network when they meet.

## Current System

- `state.connections`: `Map<"col,row", Set<connectionType>>` — each tile either has a connection type or doesn't
- Rendering draws all 6 types as parallel offset lines within each tile
- Network discovery flood-fills across tiles using cardinal adjacency
- 6 connection types: `powerCable`, `vacuumPipe`, `rfWaveguide`, `coolingWater`, `cryoTransfer`, `dataFiber`

## Data Model

### New State Structure

```js
state.pipes = new Map()  // Map<"col,row,subCol,subRow", Array<{type, directions}>>
```

- **Key:** `"col,row,subCol,subRow"` — e.g., `"5,3,2,1"`, identifying a specific subtile cell
- **Value:** Ordered array of pipe entries
  - `type`: one of the 6 connection types (e.g., `"powerCable"`)
  - `directions`: `Set<"n"|"s"|"e"|"w">` — which subtile-grid neighbors this segment connects to
- Array order = placement order = visual stacking order (index 0 is bottom, last is top)

### Subtile Coordinates

Each tile has a 4x4 subtile grid (subCol 0–3, subRow 0–3). Pipe positions use absolute tile coordinates plus subtile offsets within that tile.

### Same-Type Merge

When a new pipe of the same type is placed at a subtile that already has that type, the new direction is added to the existing entry's `directions` set. No duplicate entries of the same type at a single subtile.

### Different-Type Stacking

When a different pipe type is placed at a subtile, a new entry is appended to the array. All 6 types can coexist at a single subtile position.

### Cross-Tile Connectivity

Pipes at tile boundaries connect seamlessly to the adjacent tile's subtile grid:
- `subCol=3` heading east → neighbor is `col+1, row, subCol=0, same subRow`
- `subCol=0` heading west → neighbor is `col-1, row, subCol=3, same subRow`
- `subRow=3` heading south → neighbor is `col, row+1, subRow=0, same subCol`
- `subRow=0` heading north → neighbor is `col, row-1, subRow=3, same subCol`

## Rendering

### Subtile Positioning

Each pipe segment is positioned at the center of its subtile cell:
```js
tilePos = gridToIso(col, row)
subOffset = subGridToIso(subCol + 0.5, subRow + 0.5)
pipeCenter = { x: tilePos.x + subOffset.x, y: tilePos.y + subOffset.y }
```

### Vertical Stacking

Each pipe in the ordered array gets a vertical (screen-Y) offset:
```js
yOffset = -stackIndex * STACK_HEIGHT  // STACK_HEIGHT ≈ 3px
```
Index 0 (earliest placed) is at the base; later pipes render higher.

### Line Drawing

- Pipe width: ~2px
- For each pipe entry, draw line segments from the subtile center (with stack offset) halfway toward each neighbor subtile center in the `directions` set
- The neighboring subtile's matching segment completes the visual connection

### Crossings

When different-type pipes cross at the same subtile, the higher stack index renders on top naturally. A small shadow ellipse beneath upper pipes sells the "bridge" effect in isometric view.

### Same-Type Junctions

Where a pipe has 3+ directions (T-junction or 4-way), a small dot/node marker renders at the center to indicate the junction point.

### Depth Sorting

Standard isometric depth: `(col + row) * 16 + subRow` — same formula used for zone furnishings.

## Input Handling

### Placement (Left-Click-and-Drag)

1. Player selects a pipe type from the infra category's "Distribution" subsection
2. Left-click resolves to a subtile position using `isoToGrid` then `isoToSubGrid`
3. While dragging, the line is constrained to the dominant axis (horizontal or vertical in grid space) — straight lines only
4. On mouse release, all subtile positions along the line are filled:
   - Same type already present → merge directions into existing entry
   - Different type or no entry → append new entry to array
5. A translucent drag preview renders during the drag showing the planned path

### Removal (Right-Click-and-Drag)

1. Right-click resolves the subtile under the cursor
2. The pipe type at the top of the stack at that subtile is identified as the removal target
3. Dragging selects a straight line of subtiles (same axis constraint as placement)
4. On release, the target type is removed from all subtiles along the line:
   - If the entry's directions become empty, remove it from the array
   - If the array becomes empty, delete the map key

## Network Discovery

### Subtile-Level Flood Fill

1. Collect all subtile positions that have the target connection type
2. Flood-fill from an unvisited subtile, following only the `directions` set of each pipe entry (not all 4 cardinal neighbors)
3. Two pipes of the same type on the same tile but in different subtile lanes are separate networks unless they connect somewhere

### Equipment Adjacency

- Derive the tile footprint from a network's subtile positions (unique `col,row` pairs)
- Find equipment adjacent to or overlapping those tiles — same logic as current system
- Equipment connects if a pipe enters any subtile within its tile footprint

## Migration

### One-Way Conversion

On save load, if `state.connections` exists and `state.pipes` does not:

1. For each tile in `state.connections`, for each connection type in its set:
   - Place the pipe at a default subtile position (e.g., `subCol=1, subRow=1`)
   - Derive directions from which neighboring tiles also have that connection type
2. Delete `state.connections` from state

No backwards compatibility with the old format after migration.

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| Subtile grid | 4x4 per tile | Placement resolution |
| Subtile iso size | 16x8 px | Rendering unit |
| `STACK_HEIGHT` | ~3px | Vertical offset per stacked pipe |
| `LINE_WIDTH` | ~2px | Pipe line thickness |
| Max stack depth | 6 | All connection types at one subtile |

## Files to Modify

- `src/data/modes.js` — no changes needed, connection types stay the same
- `src/game/Game.js` — replace `state.connections` with `state.pipes`, new placement/removal logic
- `src/renderer/infrastructure-renderer.js` — rewrite `_renderConnections`, add drag preview for subtile pipes
- `src/renderer/grid.js` — potentially add subtile neighbor resolution helpers
- `src/networks/networks.js` — rewrite flood-fill to use subtile directions instead of tile adjacency
- `src/input/InputHandler.js` — add subtile-level click-and-drag input for pipe placement/removal
