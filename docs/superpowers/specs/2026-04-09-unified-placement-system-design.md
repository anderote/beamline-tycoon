# Unified Placement & Supply Network System

Standardizes the three separate placement systems (beamline components, facility equipment, zone furnishings) into one unified sub-grid placement model. Beamline components become freely placeable objects connected by drawn beam pipe. Facility equipment gains physics-meaningful supply stats. Zone furnishings gain small power requirements. All items share the same cost format, occupancy grid, selection/delete/move UX, and interact through the existing supply network system.

## Current State

Three separate systems with inconsistent formats:

| Aspect | Beamline Components | Facility Equipment | Zone Furnishings |
|---|---|---|---|
| Definition | `COMPONENTS` in components.js | `COMPONENTS` in components.js | `ZONE_FURNISHINGS` in infrastructure.js |
| Grid | Tile-level (col, row) | Tile-level (col, row) | Sub-grid (col, row, subCol, subRow) |
| Cost | `{ funding: X }` | `{ funding: X }` | Plain number |
| Energy | `energyCost` (kW) | `energyCost` (kW) | None |
| Physics | Full beam simulation | None | `effects` only |
| Occupancy | `Beamline.occupied` map | `facilityGrid` map | `zoneFurnishingSubgrids` 4x4 arrays |
| Placement | Must connect to parent in beam graph | Free on concrete | Free on infrastructure |
| UI | Interactive parameter editor | Info-only window | Hover tooltip |
| ID format | Integer per beamline | `fac_` prefix | `zf_` prefix |
| Refund | N/A | 50% | 50% |

## Unified Sub-Grid Model

All placeables use the 4x4 sub-grid per tile, as defined in the subtile equipment grid spec. Every item has `gridW` and `gridH` in sub-grid cells (1-4 each).

### Beamline Components on the Sub-Grid

Beamline components already have `subL` and `subW` (in 50cm sub-units), which map directly to sub-grid cells since each sub-grid cell is one sub-unit. A quadrupole with `subL: 2, subW: 2` occupies a 2x2 area in the sub-grid.

Components are placed freely — no parent-child relationship required at placement time. The player places components anywhere on concrete flooring, then draws beam pipe to connect them into a beam graph.

Direction/orientation is set at placement time (NE, SE, SW, NW) and determines which face has the beam entry/exit ports.

### Unified Occupancy

One occupancy system for all placeables:

```js
state.subgridOccupied = new Map()  // "col,row,subCol,subRow" -> { id, category }
```

Where `category` is `"beamline"`, `"equipment"`, or `"furnishing"`. This replaces:
- `Beamline.occupied`
- `state.facilityGrid`
- `state.zoneFurnishingSubgrids`

Collision checking: no two items can occupy the same sub-grid cell, regardless of category.

### Unified Item Entry

All placed items are stored in one flat array with a common format:

```js
state.placeables = [
  {
    id: "bl_1",           // prefix: bl_ (beamline), eq_ (equipment), fn_ (furnishing)
    type: "quadrupole",   // key into COMPONENTS or ZONE_FURNISHINGS
    category: "beamline", // "beamline" | "equipment" | "furnishing"
    col: 5, row: 3,       // tile position
    subCol: 1, subRow: 0, // sub-grid position within tile
    rotated: false,       // swaps gridW/gridH
    dir: "NE",            // beam direction (beamline only, null for others)
    params: {},           // tunable parameters (beamline components with PARAM_DEFS)
  },
]
```

A lookup map provides O(1) access by ID:

```js
state.placeableIndex = {}  // id -> index in placeables array
```

### Unified Definition Format

Both `COMPONENTS` and `ZONE_FURNISHINGS` share these base fields:

```js
{
  id: 'quadrupole',
  name: 'Quadrupole',
  desc: '...',
  category: 'focusing',
  subsection: 'normalConducting',
  cost: { funding: 150000 },      // always object format
  energyCost: 5,                   // kW, always present (0 for passive items)
  gridW: 2,                       // sub-grid width (derived from subW for beamline)
  gridH: 2,                       // sub-grid height (derived from subL for beamline)
  subH: 3,                        // visual height in sub-units
  spriteKey: 'quadrupole',
  spriteColor: 0xcc4444,
  effects: {},                     // gameplay bonuses (optional)
}
```

#### Cost Format Migration

Zone furnishings change from `cost: 120` to `cost: { funding: 120 }`. All cost handling uses the object format everywhere.

#### Energy Cost for Furnishings

All furnishings gain an `energyCost` field. Realistic small values:

| Category | Range | Examples |
|---|---|---|
| Passive furniture | 0 | filing cabinet, whiteboard, dining table, tool cabinet |
| Small electronics | 0.1-0.5 kW | oscilloscope, coffee machine, microwave, phone |
| Medium equipment | 0.5-2 kW | signal generator, spectrum analyzer, beam profiler |
| Large equipment | 2-5 kW | server rack, CNC mill, DAQ rack, monitor bank |
| Heavy machinery | 5-15 kW | lathe, milling machine, welding station, chiller unit |
| High-power | 15-50 kW | assembly crane, crane hoist, server cluster |

These draw from the power network. A lab full of equipment now needs adequate power cabling and substation capacity.

## Beam Pipe as Drawn Connection

Drift sections stop being a separately-placed component. Instead, beam pipe is drawn between beamline components to connect them.

### Drawing Beam Pipe

1. Player selects "Beam Pipe" tool from the beamline category
2. Click on a beamline component's port (entry or exit face)
3. Drag to another component's port
4. The path follows the sub-grid, constrained to straight lines and 90-degree turns
5. On release, drift nodes are created along the path with length computed from the sub-grid distance

### Port Model

Each beamline component has entry and exit ports defined by its orientation:

```js
// Ports are sub-grid positions relative to the component's anchor (subCol, subRow)
// For a quadrupole facing NE with gridW:2, gridH:2 at (subCol:1, subRow:0):
//   entry port: left face (SW side)
//   exit port: right face (NE side)
```

Port positions are derived from the component's `dir`, `gridW`, and `gridH`. The beam enters from one side and exits the other along the beam axis.

### Snap Behavior

When the player is drawing beam pipe and the cursor approaches a component's port (within 1 sub-grid cell), the endpoint snaps to that port. Visual feedback: the port highlights green when in snap range.

### Drift Node Creation

The drawn path creates one or more drift nodes:
- Straight sections become single drift nodes with `subL` = path length in sub-grid cells
- Each drift node is stored in the placeables array like any other beamline component
- The drift occupies sub-grid cells along its path (using `subW: 2` width centered on the path)

### Beam Graph Derivation

The beam graph is no longer stored as an explicit parent-child tree. Instead, it is computed from connectivity:

1. Start at each source component
2. Follow beam pipe from the source's exit port
3. When pipe reaches another component's entry port, that component is next in the graph
4. Continue from that component's exit port
5. Dipoles redirect the beam direction; splitters create branches

The graph is recomputed whenever placeables change. The physics simulation uses this derived graph for beam transport calculations.

### Disconnected Components

Components not connected to any source via beam pipe are "unpowered" — they exist physically but don't participate in beam simulation. The UI shows them with a dimmed or desaturated appearance and a "Not connected" indicator.

## Facility Equipment Physics

Facility equipment already has physics-meaningful properties in COMPONENTS (RF frequency, cooling capacity, etc.) used by the network validators. This doesn't change — the existing `validatePowerNetwork`, `validateCoolingNetwork`, `validateRfNetwork` etc. in networks.js already compute capacity vs demand.

What changes:
- Equipment uses the unified placement system instead of its own `facilityGrid`
- Equipment entries use the same sub-grid occupancy as everything else
- Network discovery finds equipment by checking which placeables with `category: "equipment"` are adjacent to pipe networks

### Network Discovery Update

`Networks._findAdjacentEquipment` and `Networks._findAdjacentBeamline` are updated to query the unified `state.placeables` array filtered by category, checking sub-grid adjacency to pipe network tiles.

## Zone Furnishing Network Bonuses

Zone furnishings already provide bonuses via `effects.zoneOutput`. The existing `findLabNetworkBonuses` system in networks.js already feeds these into network quality calculations. This doesn't change.

What changes:
- Furnishings with `energyCost > 0` now appear as consumers on power networks
- Furnishings use the unified placement system instead of `zoneFurnishingSubgrids`

## Unified UX

### Selection

Click any placeable to select it. All categories show the same selection highlight (colored outline around occupied sub-grid cells).

### Delete / Move

All categories use the same delete and move interactions:
- Right-click or demolish mode: red highlight on hovered item, click to remove (50% refund for equipment and furnishings, configurable for beamline)
- Move mode (if implemented): pick up and re-place at new sub-grid position

Beamline components: removing a component also removes any beam pipe connected to its ports. The beam graph is recomputed.

### Info Window

One unified `PlaceableWindow` replaces both `EquipmentWindow` and the beamline component info display:

- **All items:** name, description, cost, energy cost, position, remove button
- **Equipment:** supply stats (RF power output, cooling capacity, etc.), network membership
- **Furnishings:** effects (morale, research, zone output), zone bonus status
- **Beamline components:** physics parameters (tunable sliders), beam graph position, connection status, required connections checklist

### Rotation

All items support rotation via R key before placement (swaps gridW/gridH). Beamline components additionally set their beam direction (NE/SE/SW/NW) which determines port positions.

## State Migration

On save load, if old format is detected:

1. Convert `Beamline.occupied` entries → unified `placeables` with `category: "beamline"`
2. Convert `facilityEquipment` entries → unified `placeables` with `category: "equipment"`, assigning sub-grid positions (center of tile: subCol 1, subRow 1)
3. Convert `zoneFurnishings` entries → unified `placeables` with `category: "furnishing"` (sub-grid positions already exist)
4. Build `subgridOccupied` map from all entries
5. Convert existing beamline parent-child relationships into beam pipe connections
6. Remove old state fields: `facilityGrid`, `facilityEquipment`, `zoneFurnishings`, `zoneFurnishingSubgrids`

## Files to Modify

- `src/data/components.js` — add `gridW`/`gridH` to all beamline components (derived from `subL`/`subW`); drift becomes a non-placeable type used only for drawn connections
- `src/data/infrastructure.js` — change all `ZONE_FURNISHINGS` costs to `{ funding: X }` format; add `energyCost` to all entries
- `src/game/Game.js` — replace three placement systems with unified `placeables` array + `subgridOccupied` map; unified place/remove/move methods; beam pipe drawing state; beam graph derivation
- `src/beamline/Beamline.js` — remove parent-child placement logic; beam graph becomes a derived computation from pipe connectivity; keep physics simulation
- `src/networks/networks.js` — update `_findAdjacentEquipment` and `_findAdjacentBeamline` to query unified placeables; no changes to validators
- `src/input/InputHandler.js` — unified click/select/delete for all placeables; beam pipe drawing mode (click port, drag path, release on port)
- `src/renderer/sprites.js` — unified sprite rendering for all placeables on sub-grid; remove separate equipment/furnishing render paths
- `src/renderer3d/component-builder.js` — read positions from unified placeables array
- `src/renderer3d/equipment-builder.js` — read from unified placeables array
- `src/ui/EquipmentWindow.js` — replace with unified `PlaceableWindow` or extend to handle all categories
- `src/renderer/overlays.js` — unified selection/delete highlight for all placeables
