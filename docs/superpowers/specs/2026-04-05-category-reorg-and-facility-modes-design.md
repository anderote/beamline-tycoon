# Category Reorganization & Facility Modes

## Overview

Restructure the game's placement UI from a single flat category system into three top-level modes — **Beamline**, **Facility**, and **Structure** — each with their own category tabs and placement behavior. This spec covers Sub-projects 1–2: the category reorganization, mode switching UI, facility equipment placement, and the utility connection drawing system. Structure mode is deferred.

## Current State

- Six category tabs in a single row: Sources, Magnets, RF/Accel, Diagnostics, Beam Optics, Infra
- `CATEGORIES` dict maps category keys to display names/colors
- `COMPONENTS` dict holds all beamline components, each with a `category` field and optional `isInfrastructure: true` flag
- `INFRASTRUCTURE` dict holds only walkways and concrete pads
- `CATEGORY_MAP` in renderer.js maps HTML tab `data-category` values to component category keys
- Infrastructure items (vacuum pumps, cryo equipment, RF power sources, cooling, controls) are mixed into `COMPONENTS` with `isInfrastructure: true` and `category: 'special'` or `category: 'rf'`
- All components are placed on the beamline track regardless of their `isInfrastructure` flag

## Design

### Top-Level Mode Switcher

Three mode buttons rendered above the category tabs in the bottom HUD:

| Mode | Description | Status |
|------|-------------|--------|
| **Beamline** | On-beam accelerator components | Active |
| **Facility** | Off-beam support equipment + utility connections | Active |
| **Structure** | Buildings, surfaces, people infrastructure | Greyed out / deferred |

Selecting a mode swaps which category tabs are visible and changes click/drag behavior on the canvas.

All placed items (beamline, facility, connections, structure) are always visible on the canvas regardless of the active mode. The mode only controls the palette and input behavior.

### Beamline Mode

#### Category Tabs

| Tab | Category Key | Components |
|-----|-------------|------------|
| Sources | `source` | Electron gun, ion source, photocathode gun, plasma wakefield source, laser-plasma injector, all particle sources |
| Focusing | `focusing` | Quadrupole, solenoid, sextupole, corrector, SC quad, SC dipole, octupole, dipole (renamed from "Magnets") |
| RF / Accel | `rf` | Pillbox cavity, buncher, cryomodule, SRF cavities, harmonic linearizer — on-beam RF components only |
| Diagnostics | `diagnostic` | BPM, screen, Faraday cup, wire scanner, toroid, bunch length monitor, energy spectrometer, etc. |
| Beam Optics | `beamOptics` | Undulator, wiggler, collimator, splitter, kicker, septum, chicane, dogleg, stripper foil, bellows, beam dump/target |

#### Placement Behavior

Unchanged from current behavior. Select a component from the palette, click on the beamline track to place it. Components are added to the beamline directed graph.

### Facility Mode

#### Category Tabs

| Tab | Category Key | Color | Components |
|-----|-------------|-------|------------|
| Vacuum | `vacuum` | `#669` | Roughing pump, turbo pump, ion pump, NEG pump, Ti sublimation pump, Pirani gauge, cold cathode gauge, BA gauge, gate valve, bakeout system |
| Cryo | `cryo` | `#4aa` | He compressor, cold box (4K), cold box (2K), LN2 precooler, cryogenic transfer line, He recovery, cryocooler, cryomodule housing |
| RF Power | `rfPower` | `#aa4` | Solid-state amplifier, pulsed klystron, CW klystron, modulator, IOT, circulator, waveguide section, RF coupler, LLRF controller, multi-beam klystron, high-power SSA |
| Cooling | `cooling` | `#a66` | LCW skid, chiller, cooling tower, heat exchanger, water load, deionizer, emergency cooling |
| Data & Controls | `dataControls` | `#6a6` | IOC rack, PPS interlock, MPS, timing system, area monitor, radiation monitor, servers (new), network switches (new) |
| Power | `power` | `#a84` | Substation, power transformer, UPS (new), cable trays (new) |
| Safety | `safety` | `#888` | Shielding, beam containment, area radiation monitor |

#### Placement Behavior

Facility equipment is placed on the isometric grid as free-standing items (single-click placement). They occupy grid tiles and are rendered as isometric sprites. They are NOT part of the beamline directed graph — they exist in a separate facility layer.

### Utility Connections

#### Connection Types

| Type | Color | Connects From (Facility) | Connects To (Beamline) |
|------|-------|-------------------------|----------------------|
| Vacuum pipe | gray `#888888` | Vacuum equipment (pumps, gauges) | Any beamline tile |
| Cryo transfer | cyan `#44aacc` | Cryo equipment (compressors, cold boxes) | Cryomodule, SRF cavities |
| RF waveguide | gold `#ccaa44` | RF power equipment (klystrons, SSAs) | On-beam RF components (cavities, bunchers) |
| Cooling water | blue `#4488cc` | Cooling equipment (chillers, LCW skids) | Components with cooling needs (RF cavities, magnets, targets) |
| Power cable | red `#cc4444` | Power equipment (substations, transformers) | Any powered facility/beamline equipment |
| Data/fiber | green `#44cc44` | Data equipment (servers, IOC racks) | Experimental halls, diagnostics stations |

#### Drawing Mechanic

A secondary toolbar within Facility mode shows connection type buttons (small colored icons). Selecting one enters "draw connection" mode:

1. **Drawing:** Click and drag across tiles. Each tile crossed gets that connection type placed. Release to finish the stroke.
2. **Auto-shaping:** The renderer inspects each tile's neighbors of the same connection type and selects the correct shape:
   - **Straight** — neighbors on opposite sides (N-S or E-W)
   - **Elbow** — neighbors on two adjacent sides (N-E, N-W, S-E, S-W)
   - **Tee** — neighbors on three sides
   - **Cross** — neighbors on all four sides
   - **End cap** — neighbor on only one side
3. **Parallel stacking:** When multiple connection types share a tile, they render as parallel thin lines offset from tile center. Offset order follows a fixed priority (vacuum, cryo, RF waveguide, cooling, power, data — inside to outside). Each line is thin (2-3px at default zoom).
4. **Erasing:** Drawing over an existing connection of the same type removes it (toggle). Alternatively, a dedicated eraser sub-tool.
5. **Validation:** Connections are checked at endpoints. An RF waveguide must originate at an RF power source and terminate adjacent to an on-beam RF component. Invalid connections render with a visual warning (dashed line or red tint) but can still be placed — they simply don't count as functional until valid.

#### Gameplay Effect

Connections are **hard requirements**. A component that needs a specific utility type will not function unless a valid connection path exists between it and appropriate support equipment:

- An RF cavity won't accelerate without an RF waveguide connection to an RF power source
- A cryomodule won't cool without a cryo transfer line to a cryo plant
- Superconducting magnets need cryo connections
- Beamline components generally need vacuum connections to maintain beam quality
- Data connections are required for experimental stations to generate research data

### Data Model Changes

#### CATEGORIES

Replace the current `CATEGORIES` dict with a mode-grouped structure:

```js
const MODES = {
  beamline: {
    name: 'Beamline',
    categories: {
      source:     { name: 'Sources',     color: '#4a9' },
      focusing:   { name: 'Focusing',    color: '#c44' },
      rf:         { name: 'RF / Accel',  color: '#c90' },
      diagnostic: { name: 'Diagnostics', color: '#44c' },
      beamOptics: { name: 'Beam Optics', color: '#a4a' },
    },
  },
  facility: {
    name: 'Facility',
    categories: {
      vacuum:       { name: 'Vacuum',          color: '#669' },
      cryo:         { name: 'Cryo',            color: '#4aa' },
      rfPower:      { name: 'RF Power',        color: '#aa4' },
      cooling:      { name: 'Cooling',         color: '#a66' },
      dataControls: { name: 'Data & Controls', color: '#6a6' },
      power:        { name: 'Power',           color: '#a84' },
      safety:       { name: 'Safety',          color: '#888' },
    },
  },
  structure: {
    name: 'Structure',
    categories: {},  // deferred
    disabled: true,
  },
};
```

#### Component Re-categorization

- Rename category `'magnet'` → `'focusing'` on all magnet components (quadrupole, solenoid, sextupole, corrector, SC quad, SC dipole, octupole, dipole)
- Rename category `'special'` → `'beamOptics'` on beam optics components (undulator, wiggler, collimator, splitter, kicker, septum, chicane, dogleg, stripper foil, bellows, target)
- Move vacuum components from `category: 'special'` to `category: 'vacuum'` (roughing pump, turbo pump, ion pump, NEG pump, TSP, gauges, gate valve, bakeout)
- Move RF power infrastructure from `category: 'rf'` to `category: 'rfPower'` (klystron, SSA, modulator, IOT, circulator, waveguide, RF coupler, LLRF controller, multi-beam klystron, high-power SSA)
- Move cryo infrastructure to `category: 'cryo'` (He compressor, cold box, LN2 precooler, transfer line, He recovery, cryocooler, cryomodule housing)
- Move cooling infrastructure to `category: 'cooling'` (LCW skid, chiller, cooling tower, heat exchanger, water load, deionizer, emergency cooling)
- Move controls/safety to `category: 'dataControls'` or `category: 'safety'` (IOC rack, PPS interlock, MPS, timing system, area monitor, shielding)
- Move power infrastructure to `category: 'power'` (substation, power transformer, laser system, laser heater)
- Remove `isInfrastructure` flag — facility vs beamline is determined by category membership

#### Connection Data

New dict for connection types:

```js
const CONNECTION_TYPES = {
  vacuumPipe:   { name: 'Vacuum Pipe',   color: 0x888888, validTargets: 'any' },
  cryoTransfer: { name: 'Cryo Transfer', color: 0x44aacc, validTargets: { categoryMatch: ['rf'], idMatch: ['cryomodule', 'scQuad', 'scDipole'] } },
  rfWaveguide:  { name: 'RF Waveguide',  color: 0xccaa44, validTargets: { categoryMatch: ['rf'] } },
  coolingWater: { name: 'Cooling Water',  color: 0x4488cc, validTargets: { categoryMatch: ['rf', 'focusing'], idMatch: ['target'] } },
  powerCable:   { name: 'Power Cable',   color: 0xcc4444, validTargets: 'any' },
  dataFiber:    { name: 'Data/Fiber',    color: 0x44cc44, validTargets: { categoryMatch: ['diagnostic'] } },
};
// validTargets: 'any' means the connection can terminate adjacent to any beamline tile.
// categoryMatch: connection is valid if the adjacent beamline component's category is in the list.
// idMatch: connection is valid if the adjacent beamline component's id is in the list.
// Both categoryMatch and idMatch are OR'd — either match makes the connection valid.
```

Connection state stored per tile in the game state:

```js
// state.connections is a Map keyed by "x,y" tile coordinate
// Each entry is a Set of connection type keys present on that tile
state.connections = new Map();
// e.g., state.connections.get("5,3") === new Set(['vacuumPipe', 'powerCable'])
```

#### INFRASTRUCTURE Dict

The existing `INFRASTRUCTURE` dict (walkway, concrete) stays as-is for now — it belongs to Structure mode which is deferred. When Structure mode is implemented, these items will move into the Structure mode's categories.

### HTML Changes

Replace the static category tabs in `index.html` with:

```html
<div id="hud-controls">
  <div id="mode-switcher">
    <button class="mode-btn active" data-mode="beamline">Beamline</button>
    <button class="mode-btn" data-mode="facility">Facility</button>
    <button class="mode-btn disabled" data-mode="structure">Structure</button>
  </div>
  <div id="category-tabs">
    <!-- dynamically generated based on active mode -->
  </div>
  <div id="connection-tools" class="hidden">
    <!-- shown only in facility mode -->
  </div>
  <div id="hud-buttons">
    <button id="btn-research" class="hud-btn">Research</button>
    <button id="btn-goals" class="hud-btn">Goals</button>
    <button id="btn-toggle-beam" class="hud-btn btn-beam">Start Beam</button>
  </div>
</div>
```

### Renderer Changes

- `CATEGORY_MAP` replaced by dynamic lookup into `MODES[activeMode].categories`
- `_renderPalette()` reads from the active mode's categories
- New `_renderConnections()` method draws thin colored lines on the isometric grid with auto-shaping
- New `_renderFacilityEquipment()` method draws placed facility items as isometric sprites
- Connection auto-shape logic: for each tile with connections, check 4 neighbors, build a bitmask (N/E/S/W), select sprite/shape from a lookup table

### Input Changes

- Mode switching: clicking mode buttons updates `this.activeMode`, regenerates category tabs, updates palette
- Facility placement: in facility mode with a component selected, clicking a grid tile places facility equipment
- Connection drawing: in facility mode with a connection tool selected, click-drag across tiles to place connection segments
- Tab key cycles through categories within the active mode only

## Scope Boundaries

**In scope:**
- Mode switcher UI
- Category reorganization in data.js
- Re-categorizing all existing components
- Facility equipment grid placement
- Connection type definitions and drawing mechanic
- Auto-shape rendering for connections
- Parallel line stacking on shared tiles
- Connection validation (visual warnings)
- Hard-requirement gameplay logic (components don't work without connections)

**Out of scope (deferred):**
- Structure mode (offices, walls, entrances, control rooms, experimental halls)
- New components not already in data.js (servers, network switches, UPS, cable trays) — stubs can be added but full implementation deferred
- Ring/storage ring modes
- Machine placement changes
