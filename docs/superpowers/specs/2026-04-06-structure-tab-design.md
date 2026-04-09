# Structure Tab Design

## Overview

The Structure tab enables players to build out their facility's physical layout: flooring, zones, and hallways. Zones gate access to equipment categories with tiered area requirements, and must be connected to a Control Room via hallways to be active.

## Flooring Types

Four flooring types, each placed as isometric tiles via drag-to-place:

| Flooring | Visual | Hex Colors (top/side) | Allows Zones |
|----------|--------|-----------------------|-------------|
| Lab Flooring | Clean light gray/white tile | `0xdddddd` / `0xbbbbbb` | RF Lab, Cryo Lab, Vacuum Lab |
| Office Flooring | Warm beige/tan carpet | `0xccbb99` / `0xaa9977` | Office Space, Control Room |
| Concrete | Dark gray slab | `0x999999` / `0x777777` (existing) | Machine Shop, Maintenance |
| Hallway | White linoleum | `0xeeeeee` / `0xcccccc` | None (connectivity only) |

All flooring uses the existing `isDragPlacement: true` mechanic for rectangle drag placement.

## Zone Types

Zones are semi-transparent colored overlays placed on top of compatible flooring via drag-to-place. Each zone type gates a specific equipment category.

| Zone | Overlay Color | Required Flooring | Gates Category |
|------|---------------|-------------------|----------------|
| RF Laboratory | Amber `0xaa8833` | Lab | RF Power |
| Cryogenic Lab | Cyan `0x33aaaa` | Lab | Cryo |
| Vacuum Lab | Purple `0x7744aa` | Lab | Vacuum |
| Office Space | Blue `0x4466aa` | Office | (none) |
| Control Room | Green `0x44aa66` | Office | Data & Controls |
| Machine Shop | Gray-brown `0x886655` | Concrete | Beamline components |
| Maintenance | Orange `0xaa6633` | Concrete | Cooling, Safety |

Zone overlays render at ~40% opacity on top of the flooring tile so the base flooring texture is still visible.

## Tiered Area Requirements

Equipment is gated by total zone area (sum of all tiles of that zone type, not necessarily contiguous):

| Tier | Min Area | Equivalent Square | Equipment Level |
|------|----------|-------------------|-----------------|
| Tier 1 | 16 tiles | 4x4 | Basic/entry-level equipment |
| Tier 2 | 36 tiles | 6x6 | Mid-tier equipment |
| Tier 3 | 64 tiles | 8x8 | Advanced equipment |

When a player lacks sufficient zone area for a piece of equipment, it appears grayed out / unaffordable in the palette with a tooltip indicating the required zone area.

## Connectivity

### Rules
- Every active zone must be connected to a Control Room via hallway tiles.
- A zone is "connected" when at least one of its tiles is orthogonally adjacent (in grid coords) to a hallway tile, and that hallway tile can reach (via other adjacent hallway tiles) a tile that is adjacent to a Control Room zone tile.
- Disconnected zones are **inactive**: their gating doesn't count, and equipment in their category won't function.
- Visual indicator: inactive zones render with reduced opacity or a warning icon.

### Pathfinding
- On each zone/hallway change, run a flood-fill from all hallway tiles adjacent to the Control Room.
- Mark all reachable hallway tiles. Then check each zone: if any zone tile is adjacent to a reachable hallway tile, that zone is active.
- This is O(n) in hallway tile count — fine for expected facility sizes.

## Data Model

### State Storage

```js
// In game.state:
infrastructure: [
  // Flooring tiles (existing array, new types added)
  { type: 'labFloor', col: 5, row: 3 },
  { type: 'officeFloor', col: 10, row: 2 },
  { type: 'concrete', col: 7, row: 8 },    // existing
  { type: 'hallway', col: 6, row: 3 },
],
zones: [
  // Zone overlays (new array)
  { type: 'rfLab', col: 5, row: 3 },
  { type: 'controlRoom', col: 10, row: 2 },
],
```

### Data Definitions

Flooring items added to `INFRASTRUCTURE`:

```js
labFloor:    { id: 'labFloor',    name: 'Lab Flooring',    cost: 15, color: 0xbbbbbb, topColor: 0xdddddd, isDragPlacement: true },
officeFloor: { id: 'officeFloor', name: 'Office Flooring', cost: 12, color: 0xaa9977, topColor: 0xccbb99, isDragPlacement: true },
hallway:     { id: 'hallway',     name: 'Hallway',         cost: 8,  color: 0xcccccc, topColor: 0xeeeeee, isDragPlacement: true },
```

Existing `concrete` and `path` entries updated/renamed as needed. The old `path` (Walkway) can be kept or replaced by `hallway`.

New `ZONES` constant:

```js
const ZONES = {
  rfLab:       { id: 'rfLab',       name: 'RF Laboratory',  color: 0xaa8833, requiredFloor: 'labFloor',    gatesCategory: 'rfPower' },
  cryoLab:     { id: 'cryoLab',     name: 'Cryogenic Lab',  color: 0x33aaaa, requiredFloor: 'labFloor',    gatesCategory: 'cryo' },
  vacuumLab:   { id: 'vacuumLab',   name: 'Vacuum Lab',     color: 0x7744aa, requiredFloor: 'labFloor',    gatesCategory: 'vacuum' },
  officeSpace: { id: 'officeSpace', name: 'Office Space',   color: 0x4466aa, requiredFloor: 'officeFloor', gatesCategory: null },
  controlRoom: { id: 'controlRoom', name: 'Control Room',   color: 0x44aa66, requiredFloor: 'officeFloor', gatesCategory: 'dataControls' },
  machineShop: { id: 'machineShop', name: 'Machine Shop',   color: 0x886655, requiredFloor: 'concrete',    gatesCategory: 'beamline' },
  maintenance: { id: 'maintenance', name: 'Maintenance',    color: 0xaa6633, requiredFloor: 'concrete',    gatesCategory: ['cooling', 'safety'] },
};
```

### Zone Area Thresholds

```js
const ZONE_TIER_THRESHOLDS = [16, 36, 64];
```

Each component gets a `zoneTier` property (1, 2, or 3) indicating the minimum zone tier needed. Components without a `zoneTier` default to tier 1.

## Structure Tab Palette

The Structure mode in `MODES` gets three category tabs:

```js
structure: {
  name: 'Structure',
  categories: {
    flooring: { name: 'Flooring', color: '#999' },
    zones:    { name: 'Zones',    color: '#6a6' },
    demolish: { name: 'Demolish', color: '#a44' },
  },
},
```

- **Flooring tab**: lists Lab Flooring, Office Flooring, Concrete, Hallway. All drag-to-place.
- **Zones tab**: lists all 7 zone types. Drag-to-place, but placement is validated against the flooring underneath (wrong floor = placement rejected with feedback).
- **Demolish tab**: a tool that removes flooring or zone tiles on click/drag. Removing flooring also removes any zone on that tile.

## Rendering

### Flooring
Rendered on the existing `infraLayer` using `_drawInfraTile()` — same isometric tile drawing as current concrete/walkway.

### Zones
Rendered on a new `zoneLayer` (above `infraLayer`, below `facilityLayer`). Each zone tile is an isometric diamond filled with the zone color at ~40% alpha. Inactive zones render at ~15% alpha with a small warning icon or dashed border.

### Zone Labels
Each contiguous zone region gets a centered text label showing the zone name and current tile count (e.g., "RF Laboratory (24)").

## Equipment Gating Logic

When rendering the palette for facility/beamline categories:

1. Determine which zone type gates this category.
2. Count total tiles of that zone type that are **active** (connected to Control Room).
3. Determine the achieved tier based on `ZONE_TIER_THRESHOLDS`.
4. For each component, if `component.zoneTier > achievedTier`, gray it out with a tooltip: "Requires X tiles of [Zone Name] (have Y)".

## Migration

- Existing saves have `infrastructure[]` with `path` and `concrete` types — these continue to work.
- `zones` array initializes to `[]` if missing.
- The old `path` type is kept as-is but `hallway` is the new connectivity-aware type. Existing `path` tiles are cosmetic only.
