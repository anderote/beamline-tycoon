# Sub-tile Equipment Grid

Replaces the existing 1:1 ZONE_FURNISHINGS system with a 4x4 isometric sub-grid per infrastructure tile, allowing multiple pieces of equipment of varying sizes to be placed within a single tile.

## Sub-tile Grid Model

Each infrastructure tile is subdivided into a 4x4 isometric sub-grid (16 cells), with grid lines aligned to the main iso axes (NE-SW and NW-SE). Each cell is a mini-diamond.

Furnishings have a fixed shape defined as `gridW x gridH` in sub-tile cells. The player can rotate an item 90 degrees, which swaps `gridW` and `gridH`.

### Size classes

| Size class | Cells | Example shapes | Example items |
|---|---|---|---|
| Tiny (1/16) | 1 | 1x1 | oscilloscope, coffee machine, flow meter |
| Small (1/8) | 2 | 2x1, 1x2 | spectrum analyzer, leak detector |
| Medium (1/4) | 4 | 2x2, 4x1, 1x4 | VNA, optical table, operator console |
| Large (1/2) | 8 | 4x2, 2x4 | server rack, CNC mill, assembly crane |
| Full (1/1) | 16 | 4x4 | chiller unit, test chamber |

### Placement rules

- Items snap to valid positions within the 4x4 grid.
- No overlapping occupied cells within a tile.
- Items must fit entirely within the 4x4 boundary (no spanning across tiles).
- Rotation swaps `gridW`/`gridH`.

## Data Model

### Furnishing definitions

Each entry in `ZONE_FURNISHINGS` gains new fields:

```js
oscilloscope: {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  zoneType: 'rfLab',          // preferred zone (bonus), NOT required
  cost: 120,
  spriteColor: 0x44aa44,
  gridW: 1,                   // sub-tile width in cells (1-4)
  gridH: 1,                   // sub-tile height in cells (1-4)
  effects: {
    zoneOutput: 0.05,         // +5% zone effectiveness in matching zone
  },
  spriteKey: 'oscilloscope',  // for asset pipeline
}
```

The `zoneType` field changes meaning from "required zone" to "preferred zone." Items can be placed on any tile with infrastructure but receive bonus effects only in their preferred zone.

### Effect types

- `zoneOutput` — percentage boost to zone effectiveness. Per-zone scope.
- `research` — percentage boost to research speed for zone-relevant topics. Per-zone scope.
- `morale` — staff happiness bonus. Per-room scope (rooms defined by wall boundaries).
- `beamPhysics` — direct beam parameter modifiers. Requires placement in the same room as the target beamline segment, or on an adjacent tile. Applies to the nearest beamline segment within that room.

### Occupancy tracking

Replaces the old `furnishingOccupied[col,row] = id` with a per-tile sub-grid:

```js
tile.subgrid = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
]  // 0 = empty, itemIndex = occupied

tile.furnishings = [
  { id: 'oscilloscope', subCol: 2, subRow: 0, rotated: false },
  { id: 'serverRack',   subCol: 0, subRow: 0, rotated: true },
]
```

The `subgrid` array provides O(1) collision checks. The `furnishings` array stores the actual item placements with position and rotation state.

## Placement UI

### Entering sub-tile mode

- Player selects a furnishing from the existing infrastructure/decoration palette (furnishings remain in their current tab).
- When hovering over a tile that has infrastructure, the 4x4 sub-grid overlay appears on that tile.
- The selected item's shape is shown as a ghost preview snapping to valid positions within the grid.
- Click to place. R key (or right-click) to rotate before placing.

### Visual feedback

- Valid placement cells: green highlight.
- Invalid/occupied cells: red highlight.
- Ghost preview shows the item shape at cursor position within the sub-grid.
- Existing items on the tile shown with subtle outline during placement.

### Removal

- In demolish mode, hovering a tile with furnishings shows the sub-grid with each item highlighted.
- Click an individual item to remove it (50% refund, matching existing demolish behavior).

### Infrastructure removal

- If the player demolishes the infrastructure tile underneath, all furnishings on it are removed (with refund).
- Same if flooring changes under a zone — zone clears, furnishings go with it.

## Rendering

### Phase 1: icon placeholders

- Each furnishing renders as a colored isometric box at its sub-grid position.
- Box size proportional to `gridW x gridH`.
- Color from existing `spriteColor` field.
- Depth sorted within the tile: higher sub-row renders in front of lower sub-row.

### Pixel math

- Main tile: 64x32 iso. Sub-cell: 16x8 iso (64/4 x 32/4).
- Sub-grid origin is the tile's top vertex.
- `subGridToIso(subCol, subRow)` uses the same iso formula scaled down 4x.
- Items larger than 1x1 anchor at their top-left sub-cell.

### Phase 2: sprites

- When sprites exist, render the sprite anchored at the sub-grid position instead of the colored box.
- Sprites generated at the correct pixel size for their grid footprint via the asset pipeline.

### Sub-grid overlay (during placement only)

- Semi-transparent grid lines drawn on the hovered tile.
- Lines follow iso axes, dividing the diamond into 16 mini-diamonds.
- Only shown when a furnishing is selected for placement.

## Asset Pipeline

The asset generator (`tools/asset-gen/`) is extended to produce correctly sized furnishing sprites.

### Sprite dimensions by footprint

Furnishings are 3D objects with visual height above the floor plane. The sprite canvas includes floor area plus a height allowance.

| Footprint | Floor area (px) | Sprite canvas (w x h) | Examples |
|---|---|---|---|
| 1x1 | 16x8 | 16x24 | oscilloscope, coffee machine |
| 2x1 | 32x16 | 32x32 | spectrum analyzer |
| 1x2 | 32x16 | 32x32 | leak detector |
| 2x2 | 32x16 | 32x32 | VNA, optical table |
| 4x2 | 64x32 | 64x48 | server rack, CNC mill |
| 2x4 | 64x32 | 64x48 | assembly crane |
| 4x4 | 64x32 | 64x48 | chiller unit |

Height allowance is ~16px for standard items. Tall items (server racks, cranes) may get additional height.

### Pipeline changes

- Add `furnishings` section to the asset-gen catalog builder (`server.cjs` already parses `ZONE_FURNISHINGS`).
- Pass `gridW`, `gridH`, and computed pixel dimensions to PixelLab endpoints.
- Store generated sprites in `assets/furnishings/` (new directory).
- Add furnishing entries to `tile-manifest.json` with sub-tile dimensions.

## Gameplay Effects

### Zone output (per-zone)

Each furnishing with `zoneOutput` adds to the zone's effectiveness percentage when placed in its preferred `zoneType`. No bonus in non-matching zones. The item still functions (occupies space, renders) but gives no zone boost.

### Research (per-zone)

Items with `research` boost research speed for topics gated by that zone type. Same zone-preference rule as `zoneOutput`.

### Morale (per-room)

Morale contributions are scoped to the room the furnishing is in, where rooms are defined by wall boundaries. Uses the existing room detection system (wall-based flood fill from `223e54c`). A coffee machine makes the people in that room happier, not the entire facility.

### Beam physics (proximity-based)

Beam physics equipment must be placed in the same room as the beamline segment it affects. The effect applies to the nearest beamline segment within that room (measured by tile distance from the furnishing's host tile to the beamline component's occupied tiles). These are item-specific modifiers applied during the physics tick.

### Stacking

- Multiple items of the same type stack additively.
- Different effect types are independent.
- No caps. Balancing is a separate concern.

### Tier thresholds

The existing `FURNISHING_TIER_THRESHOLDS` system stays. Tier is based on furnishing item count (not cells occupied).

## Migration

All ~50 existing `ZONE_FURNISHINGS` items get `gridW`, `gridH`, and `effects` fields added. Suggested size assignments:

**Tiny (1x1):** oscilloscope, coffeeMachine, flowMeter, filingCabinet, microwave, waterCooler, phoneUnit, alarmPanel, drillPress, mirrorMount, scopeStation, workCart

**Small (2x1 or 1x2):** signalGenerator, spectrumAnalyzer, leakDetector, pumpCart, gasManifold, vendingMachine, toolCabinet, partsShelf, beamProfiler, bpmTestFixture

**Medium (2x2):** networkAnalyzer, coolantPump, heatExchanger, rfWorkbench, desk, whiteboard, whiteboardLarge, operatorConsole, monitorBank, lathe, millingMachine, weldingStation, opticalTable, laserAlignment, interferometer, wireScannerBench, daqRack, diningTable, servingCounter, conferenceTable, projector, toolChest

**Large (2x4 or 4x2):** serverRack, serverCluster, cncMill, assemblyCrane, craneHoist, rga

**Full (4x4):** chillerUnit, testChamber
