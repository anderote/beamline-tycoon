# Decorative Assets & Grass Base Map

## Overview

Transform the starting map from a blank dark grid into a grass-covered field with scattered trees, and add a full decorative item system sourced from extracted RCT2 sprites. Decorations provide minor background mechanics effects (staff morale, facility reputation) and give the game an RCT2-style "build your facility from a green field" feel.

## Asset Source

All decorative sprites are extracted from RollerCoaster Tycoon 2's `g1.dat` sprite archive (29,357 sprites already exported to `assets/rct2-extracted/g1/`). Sprites are used at their **native RCT2 resolution** (~12-20px characters, 32x16 terrain tiles) which maps well to the game's 64x32 isometric tile grid where one tile = 10x10ft.

Key sprite ranges (from OpenRCT2 animation JSON and pixel analysis):
- Grass terrain: g1 indices ~1915-2057 (isometric grass tiles with slope variants)
- Trees/vegetation: stored in `.pob` object files (scgtrees, scgshrub) — need extraction script
- Benches/lamps/fences: stored in `.pob` object files (bench1, lamp1-4, scgfence, etc.)
- Path surfaces: g1 indices ~3395-3420 and footpath `.parkobj` files

## Map Base Layer

### Grass Tiles
- The entire starting map is covered in grass tiles rendered below all other layers
- Grass uses RCT2 flat grass sprites scaled/tiled to fit the 64x32 isometric grid
- Multiple grass variants for visual variety (light/dark green, slight texture differences)
- Grass renders at the **lowest z-layer**, below the existing grid layer

### Implicit Clearing
- Placing any infrastructure (concrete, labFloor, hallway, officeFloor) or zone **automatically replaces grass** on those tiles — no explicit clear step needed
- Demolishing infrastructure/zones **restores grass** underneath
- Trees **block placement** — player must bulldoze trees before building on those tiles
- Bulldozing a tree costs $5-15 depending on tree size

### Starting Map Generation
- Trees distributed using simple noise-based placement:
  - Denser at map edges (60-70% tree coverage in outer ring)
  - Sparser toward center (10-20% coverage) to give building room
  - Small random clearings for natural feel
- 3-4 tree varieties (deciduous, evergreen, small/large)
- Shrubs scattered in gaps between trees (20-30% of non-tree grass tiles near edges)
- All starting decorations stored in game state so they persist through save/load

## Decorative Items

### Outdoor Decorations (grass-only placement)
| Item | Cost | Sprite Source | Morale | Notes |
|------|------|--------------|--------|-------|
| Oak Tree | $15 | RCT2 scgtrees | +1 | Large, blocks 1 tile |
| Pine Tree | $12 | RCT2 scgtrees | +1 | Tall, narrow |
| Small Tree | $8 | RCT2 scgtrees | +0.5 | Compact |
| Shrub | $3 | RCT2 scgshrub | +0.25 | Small decorative |
| Flower Bed | $5 | RCT2 scgshrub | +0.5 | Colorful |
| Park Bench | $10 | RCT2 bench1 | +1 | Staff rest area |
| Lamppost | $8 | RCT2 lamp1-4 | +0.5 | Several styles |
| Decorative Fence | $4/tile | RCT2 scgfence | +0.25 | Line placement like hallways |
| Hedge | $6/tile | RCT2 hedges | +0.25 | Line placement |

### Indoor Decorations (built flooring only)
| Item | Cost | Sprite Source | Morale | Notes |
|------|------|--------------|--------|-------|
| Potted Plant | $5 | Custom/recolor | +0.5 | Any indoor floor |
| Water Cooler | $8 | Custom | +1 | Office/lab floors |
| Bulletin Board | $6 | Custom | +0.5 | Office floors |
| Fire Extinguisher | $10 | Custom | +0.25 | Required by safety? |

### Placement Rules
- Outdoor items: only placeable on grass tiles (not on infrastructure/zones)
- Indoor items: only placeable on built flooring tiles (concrete, labFloor, officeFloor, hallway)
- One decoration per tile (decorations occupy the tile like furnishings)
- Decorations can be bulldozed for no refund (or small refund)

## Mechanics Effects

### Staff Morale
- Each decoration has a `morale` value (see tables above)
- Total morale = sum of all decoration morale values
- Morale provides a small multiplier to research speed: `1.0 + (totalMorale * 0.005)` capped at 1.25 (max +25%)
- This is a passive background effect — no UI prominence needed beyond maybe a small indicator in the stats panel

### Facility Reputation
- Total decoration count contributes to facility reputation score
- Reputation thresholds: 0-10 decorations = "Spartan", 10-30 = "Functional", 30-60 = "Pleasant", 60+ = "Distinguished"
- Reputation affects funding generation rate: +0/+2%/+5%/+10% bonus
- Displayed as a label in the existing stats panel

## Rendering

### New Layers
- `grassLayer` — renders below everything (z below grid layer)
- `decorationLayer` — renders between infrastructure and beamline components (z ~1.0)

### Grass Rendering
- Pre-render grass for all visible tiles each frame (or cache as a single texture for performance)
- Skip rendering grass on tiles that have infrastructure or zones placed
- Use the existing `infraOccupied` and `zoneOccupied` lookups to determine which tiles are built

### Decoration Rendering
- Decorations rendered as PIXI.Sprites positioned at tile centers
- Trees render taller than the tile (extending upward, anchored at base)
- Depth-sorted by isometric position like existing furnishings
- Outdoor decorations render on top of grass, below infrastructure
- Indoor decorations render on top of flooring, at same z as zone furnishings

## Data Model

### Game State Additions
```javascript
// In game.state:
{
  decorations: [
    { id: 'dec_001', type: 'oakTree', col: 5, row: 12 },
    { id: 'dec_002', type: 'parkBench', col: 8, row: 3 },
    // ...
  ],
  mapSeed: 12345,  // for regenerating starting layout
}
```

### Decoration Definitions (new file: src/data/decorations.js)
```javascript
export const DECORATIONS = {
  oakTree: {
    id: 'oakTree',
    name: 'Oak Tree',
    cost: 15,
    removeCost: 10,
    morale: 1,
    placement: 'outdoor',  // 'outdoor' = grass only, 'indoor' = flooring only
    spriteKey: 'oakTree',
    blocksBuild: true,      // must be removed before building
  },
  parkBench: {
    id: 'parkBench',
    name: 'Park Bench',
    cost: 10,
    removeCost: 0,
    morale: 1,
    placement: 'outdoor',
    spriteKey: 'parkBench',
    blocksBuild: false,     // auto-removed when building over
  },
  // ...
};
```

### Decoration Occupied Lookup
- New `decorationOccupied` map in game state (like `infraOccupied`, `zoneOccupied`)
- Checked during infrastructure/zone placement to handle tree blocking

## Asset Extraction Pipeline

### .pob File Extractor
The RCT Classic `.pob` files are RCT2 DAT object format (header shows object name like "SCGTREES"). Need a small Python script to:
1. Parse the `.pob` binary format (16-byte sprite headers + pixel data)
2. Export individual sprites as PNG with transparency
3. Generate a manifest mapping object names to sprite files

Target `.pob` files to extract:
- `scgtrees.pob` — tree sprites (multiple varieties with seasonal animation frames)
- `scgshrub.pob` — shrub and flower sprites
- `bench1.pob`, `benchstn.pob`, `benchpl.pob` — bench varieties
- `lamp1.pob` through `lamp4.pob` — lamppost styles
- `scgfence.pob` — decorative fences
- `scgpathx.pob` — extra path pieces

### Sprite Processing
1. Extract from `.pob` to individual PNGs
2. Select best frame for each item (skip animation frames, pick the "front-facing" isometric view)
3. Save to `assets/decorations/` directory
4. Add entries to tile manifest or a new `decoration-manifest.json`

## UI Integration

### Build Menu
- New "Decorations" tab in the build toolbar (alongside existing Infrastructure/Zones/etc.)
- Subsections: "Trees & Plants", "Furniture", "Fencing", "Lighting"
- Each item shows name, cost, and small morale bonus indicator

### Bulldoze Interaction
- Existing bulldoze tool works on decorations
- Trees that `blocksBuild: true` show a cost tooltip when hovering with bulldoze
- Non-blocking decorations (benches, shrubs) are auto-removed when building over them (with a small visual/audio feedback)

## Implementation Order
1. Grass base layer + rendering
2. `.pob` extraction script + asset pipeline
3. Decoration data model + state management
4. Starting map generation (tree/shrub scattering)
5. Decoration placement UI + build menu tab
6. Tree blocking + bulldoze cost logic
7. Morale/reputation mechanics
8. Indoor decorations (lower priority)
