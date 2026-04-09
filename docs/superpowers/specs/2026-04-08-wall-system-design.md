# Wall System Design

## Overview

Add edge-based walls to the game. Walls are placed on tile edges (not full tiles), dragged like utility pipes, and rendered as vertical planes in isometric view. Six wall types across two subsections with three height tiers.

## Wall Types

### Interior
- **Office Wall** — standard drywall partition, ~14px height
- **Cubicle Wall** — low cubicle divider, ~8px height

### Exterior
- **Exterior Wall** — concrete/brick building wall, ~24px height
- **Chain Link Fence** — standard chain link, ~14px height
- **Barbed Wire Fence** — chain link with barbed wire top, ~18px height
- **Wood Fence** — wooden slat fence, ~14px height

## Data Model

### Edge Representation

Each tile edge is canonicalized as `(col, row, edge)`:
- `'e'` — the SE/right edge of tile (col, row), shared with tile (col+1, row)
- `'s'` — the SW/bottom edge of tile (col, row), shared with tile (col, row+1)

Every edge in the grid maps uniquely to one canonical form. The north edge of (col, row) is the 's' edge of (col, row-1). The west edge of (col, row) is the 'e' edge of (col-1, row).

### Game State

```js
walls: [],          // [{type, col, row, edge}]
wallOccupied: {},   // "col,row,edge" -> wallType
```

Added to the existing `state` object in Game.js alongside infrastructure, zones, etc.

### No Placement Restrictions

Walls can be placed on any tile edge — no flooring requirement. This supports outdoor fences and boundary walls.

## Placement UX

### Edge Detection

When the mouse hovers over the map:
1. Convert screen position to fractional grid coordinates (no floor)
2. Compute fractional position within the tile: `col_frac`, `row_frac`
3. Nearest edge is whichever of the 4 sides has the smallest distance:
   - North: `row_frac` → canonical `(col, row-1, 's')`
   - South: `1 - row_frac` → canonical `(col, row, 's')`
   - East: `1 - col_frac` → canonical `(col, row, 'e')`
   - West: `col_frac` → canonical `(col-1, row, 'e')`

### Drag-to-Place

1. Select wall type from the Walls tab in Structure mode
2. Click near a tile edge to start placing
3. Drag to trace a path of connected edges (adjacent edges share a grid vertex)
4. On mouse release, place all wall segments in the path
5. Preview shows highlighted edges with wall color at reduced opacity

### Preview Rendering

- Highlighted edge drawn as a colored line/polygon matching wall color at 50% opacity
- Cost label shown at the last edge in the drag path
- Invalid placements (already occupied) shown in red

## Rendering

### Wall Geometry

Walls render as vertical parallelograms sitting on tile edges.

For an `'e'` wall at (col, row), the base sits on the edge from the tile's right vertex to its bottom vertex:
- Base: from `(cx + hw, cy)` to `(cx, cy + hh)` where `cx, cy` = tileCenterIso(col, row)
- Top: same points shifted up by wall height

For an `'s'` wall at (col, row), the base sits on the edge from the tile's bottom vertex to its left vertex:
- Base: from `(cx, cy + hh)` to `(cx - hw, cy)`
- Top: same points shifted up by wall height

### Depth Sorting

Walls use `zIndex = (col + row) * 10 + 5` to render above floor tiles at the same depth but below items on tiles further forward.

### Sprites

Two sprites per wall type (SE-facing and SW-facing) for proper directional lighting:
- SE face ('e' edge): brighter, lit from the right
- SW face ('s' edge): darker, lit from the left

Total: 6 types x 2 orientations = 12 sprites.

### Fallback Rendering

Without sprites, walls render as colored polygons with isometric shading:
- 'e' walls: base color darkened to 0.85x
- 's' walls: base color darkened to 0.7x
- Top edge: thin highlight line

### PixelLab Sprite Settings

- Dimensions: ~32px wide x height varies (8-24px depending on type)
- Style: isometric pixel art matching existing RCT2-inspired tile aesthetic
- Transparent background, wall face only
- Two orientations per type for directional lighting

## Structure Tab Reorganization

The Structure mode categories are reordered:

```
Basic:      Flooring, Walls
Rooms:      Office, Cafeteria, Meeting
Labs:       RF Lab, Cooling Lab, Vacuum Lab, Optics Lab, Diagnostics Lab
Industrial: Control Room, Machine Shop, Maintenance
```

Cafeteria and Meeting Room are new zone types with furnishings (already added to infrastructure.js).

## Demolish

Add "Remove Walls" to the demolish tool list. Click on a wall edge or drag across edges to remove wall segments. 50% cost refund on removal.

## Files Changed

- `src/data/infrastructure.js` — wall type definitions (update existing wall items to edge-based)
- `src/data/modes.js` — structure tab reorganization (already done)
- `src/game/Game.js` — wall state, placeWall(), removeWall() methods
- `src/renderer/grid.js` — add isoToGridFloat() for edge detection
- `src/input/InputHandler.js` — wall tool, edge detection, drag placement
- `src/renderer/infrastructure-renderer.js` — wall rendering, wall preview, remove full-tile wall rendering
- `src/renderer/hud.js` — walls palette (already done), demolish wall tool
- `assets/tiles/tile-manifest.json` — wall sprite entries (when generated)
