# Multi-Beamline & Context Window Design

## Overview

Transform Beamline Tycoon from a single-beamline game into a multi-beamline facility manager, inspired by RollerCoaster Tycoon 2's ride management. Each beamline is an independent "machine" with its own physics, economy, and status. Players interact with beamlines and machines through draggable RCT2-style context windows. Beamline components are built in a focused edit mode, one beamline at a time. Utility networks (RF, power, vacuum, cryo, cooling, data) remain spatial and shared across beamlines.

## Data Model

### BeamlineRegistry

New class: `src/beamline/BeamlineRegistry.js`

Manages multiple `Beamline` instances. Each entry contains:

```
{
  id: string,                  // e.g. "bl-1"
  name: string,                // user-editable, e.g. "Linac-1"
  status: 'stopped' | 'running' | 'faulted',
  beamline: Beamline,          // existing Beamline class instance (directed graph of components)
  beamState: {
    beamEnergy: number,
    beamCurrent: number,
    beamQuality: number,
    dataRate: number,
    luminosity: number,
    totalLength: number,
    totalEnergyCost: number,
    beamOnTicks: number,
    continuousBeamTicks: number,
    uptimeFraction: number,
    totalBeamHours: number,
    totalDataCollected: number,
    physicsAlive: boolean,
    physicsEnvelope: object | null,
    discoveryChance: number,
    photonRate: number,
    collisionRate: number,
    totalLossFraction: number,
    componentHealth: {},        // nodeId -> health (0-100)
    felSaturated: boolean,
    machineType: string,        // 'linac' | 'photoinjector' | 'fel' | 'collider'
  }
}
```

### Shared State

The registry maintains a **shared occupied grid** across all beamlines so components from different beamlines cannot overlap. When a beamline places or removes tiles, it updates the shared grid.

```
BeamlineRegistry:
  beamlines: Map<id, BeamlineEntry>
  sharedOccupied: {}            // "col,row" -> { beamlineId, nodeId }
  nextBeamlineId: number
```

### Game.state Changes

Fields that move from `Game.state` into per-beamline `beamState`:
- `beamOn` → `entry.status` ('running' vs 'stopped')
- `beamEnergy`, `beamCurrent`, `beamQuality`, `dataRate`, `luminosity`
- `totalLength`, `totalEnergyCost`
- `beamOnTicks`, `continuousBeamTicks`, `uptimeFraction`
- `totalBeamHours`, `totalDataCollected`
- `physicsAlive`, `physicsEnvelope`, `discoveryChance`
- `photonRate`, `collisionRate`, `totalLossFraction`
- `componentHealth`
- `felSaturated`, `machineType`

Fields that stay global on `Game.state`:
- `resources` (funding, reputation, data) — pooled across all beamlines
- `staff`, `staffCosts`
- `infrastructure`, `infraOccupied`
- `zones`, `zoneOccupied`, `zoneConnectivity`
- `facilityEquipment`, `facilityGrid`
- `zoneFurnishings`, `zoneFurnishingGrid`
- `connections` (utility network tiles)
- `machines` (standalone machines — cyclotrons, Van de Graaffs, etc.)
- `machineGrid`
- `completedResearch`, `activeResearch`, `researchProgress`
- `completedObjectives`, `discoveries`
- `systemStats`, `infraBlockers`, `networkData`
- `tick`, `log`

`Game.state.beamline` (the flat ordered component array used by the tick loop) is replaced by per-beamline ordered arrays computed from each beamline's `Beamline` instance.

### Standalone Machines

The existing machine system (`Game.state.machines`, `MACHINES` definitions, `_tickMachines()`) stays as-is. Cyclotrons, Van de Graaffs, synchrotrons, storage rings, and tabletop lasers remain standalone grid-placed machines with their own upgrades and operating modes. They get the same style of context window as beamlines (see UI section).

## Context Window UI

### Appearance

RCT2-style draggable popup window. Opens when the player clicks on a beamline component or a standalone machine on the map.

- **Title bar**: Draggable. Shows icon + name + status indicator (● RUNNING in green, ● STOPPED in grey, ● FAULTED in red). Close button (✕) on the right.
- **Color-coded**: Blue gradient title bar for beamlines, amber for standalone machines.
- **Multiple windows**: Can have several open simultaneously. Clicking a component whose beamline already has a window open brings that window to focus.
- **Persists across mode switches**: Switching the bottom HUD mode (beamline/facility/structure) doesn't close context windows.
- **Close**: Click ✕, or press Escape (closes the focused/topmost window).

### Beamline Window Tabs

**Overview tab**:
- Mini preview area with ISO/SCHEM toggle:
  - ISO: Small viewport showing the isometric game view, auto-framed to this beamline's components
  - SCHEM: Simplified linear schematic (source → quad → RF → ... → target) with color-coded blocks and status indicators
- Quick stats grid: energy, current, quality, data rate, uptime, health
- Action buttons: Start/Stop Beam, Edit, Rename

**Stats tab**:
- Detailed beam parameters: energy, current, quality, emittance, bunch length
- Data generation rate, total data collected
- Uptime fraction, continuous beam ticks
- Discovery chance, photon rate, collision rate (if applicable)

**Components tab**:
- Scrollable list of all components in this beamline
- Each row: component name, type icon, health bar, tunable parameter summary
- Click a component to jump the main view camera to it and open its detail popup

**Settings tab**:
- Operating mode selection (for beamlines with modes)
- Machine type display (informational — determined by source type)
- Per-component parameter tuning (or link to component detail popups)

**Finance tab**:
- Construction cost breakdown (sum of component costs)
- Revenue: data income, photon port user fees, discovery bonuses
- Operating costs: energy draw contribution
- Net income per tick from this beamline

**Utilities tab**:
- For each utility type (power, RF, vacuum, cooling, cryo, data):
  - Connection status (connected / not connected)
  - This beamline's demand vs available capacity from connected network
  - Contention indicator if network is shared with other beamlines
  - Warnings if underpowered

### Machine Window Tabs

Standalone machines use the same window style with amber title bar. Tabs:

**Overview tab**: Icon preview, quick stats (mode, health, $/tick, data/tick), action buttons (Pause/Resume, Repair)

**Upgrades tab**: Current upgrade levels with costs to upgrade (replaces Components tab)

**Settings tab**: Operating mode selection, active/inactive toggle

**Finance tab**: Revenue and cost breakdown

### Implementation

The context window is a DOM element (`div#context-windows-container`) appended to the `#game` div. Each window is a child div with CSS for the window chrome, tabs, and content areas. Dragging is handled via mousedown/mousemove/mouseup on the title bar. Z-ordering is managed by updating `z-index` on focus.

New files:
- `src/ui/ContextWindow.js` — ContextWindow class (create, update, drag, tab switching, close)
- `src/ui/BeamlineWindow.js` — Beamline-specific tab content renderers
- `src/ui/MachineWindow.js` — Machine-specific tab content renderers

## Edit Mode

### Entering Edit Mode

- Click "Edit" button in a beamline's context window
- Or double-click a beamline component on the map
- Or place a new source (auto-enters edit mode for the new beamline)

### Visual Changes

- The selected beamline's components remain fully visible and colored
- All OTHER beamlines are dimmed (reduced opacity, e.g. 0.3 alpha)
- Build cursors only appear at the ends of the selected beamline
- The bottom HUD palette shows components filtered by this beamline's machine type tier

### Interaction Changes

- Clicking a build cursor extends the active beamline only
- Clicking a component on the active beamline opens its detail popup
- Clicking components on other beamlines does nothing
- Bulldozer mode only removes components from the active beamline
- The palette filters components by the active beamline's `machineType` and corresponding `MACHINE_TIER`

### Exiting Edit Mode

- Press Escape
- Click on empty space (away from any beamline component)
- Click "Done" in the context window (the Edit button toggles)

Returns to normal view where all beamlines are fully visible at full opacity.

### State Tracking

`Game` gains:
- `editingBeamlineId: string | null` — which beamline is in edit mode, or null for no edit mode
- `selectedBeamlineId: string | null` — which beamline is "selected" (context window focused), separate from editing

`InputHandler` checks `game.editingBeamlineId` to determine which build cursors to use and which components respond to clicks.

`Renderer` checks `game.editingBeamlineId` to determine opacity per beamline.

## Source Placement & New Beamlines

### Flow

1. The palette always shows source types (even outside edit mode)
2. Player selects a source type and clicks the map
3. `Game.placeSource()` creates a new `BeamlineEntry` in the registry:
   - Auto-generates name: "Beamline-1", "Beamline-2", etc.
   - Sets `machineType` based on source type (e.g., `dcPhotoGun` → `'photoinjector'`)
   - Status starts as `'stopped'`
4. Immediately enters edit mode for the new beamline
5. Player builds out the chain using the palette
6. Player clicks away or presses Escape to exit edit mode
7. Player can start the beam from the beamline's context window

### Machine Type Determination

The source type determines the beamline's machine type:
- `source` (thermionic gun) → `'linac'` (tier 1)
- `dcPhotoGun`, `ncRfGun`, `srfGun` → `'photoinjector'` (tier 2)
- Sources requiring FEL research → `'fel'` (tier 3)
- Sources requiring collider research → `'collider'` (tier 4)

Higher-tier beamlines unlock more components in the palette via `MACHINE_TIER`.

### Global Beam Button Removal

The "Start Beam" button in the top bar (`#btn-toggle-beam`) is removed. Each beamline has its own start/stop control in its context window's Overview tab. The top bar shows a summary indicator (e.g., "2/3 beamlines running") but no global toggle.

The top-left beam stats panel (`#beam-stats-panel`) shows stats for the currently selected beamline (the one whose context window is focused, or the one in edit mode). When no beamline is selected, it shows a facility summary: total energy draw, total data rate, number of running beamlines.

## Utility Network Sharing

### Spatial Networks (Unchanged Discovery)

Utility networks are discovered via flood-fill on connection tiles, exactly as today. A single RF waveguide network can connect to components from multiple beamlines. This is the correct physical behavior — a klystron connected to cavities in two beamlines distributes power to all of them.

### Capacity Distribution

When a network's capacity is shared across multiple beamlines:

**RF Power**: Distributed proportionally by demand. If total demand ≤ supply, each cavity gets its full demand. If demand > supply, each cavity gets `(its_demand / total_demand) * supply`. Underpowered cavities reduce beam quality for their beamline.

**Electrical Power**: Same proportional split. If a power network is overloaded, all connected beamlines are affected.

**Vacuum**: Pump speed is shared across the total volume of all connected beamline components. More beamlines on the same vacuum network = higher gas load = worse pressure for everyone.

**Cooling**: Heat load from all connected components sums against plant capacity.

**Cryo**: Same as cooling — SRF heat loads from all beamlines sum against cold box capacity.

### Per-Beamline Reporting

The context window's Utilities tab shows each beamline's share:
- "RF: 6 MW demand, 10 MW available (shared with Linac-2: 2 MW)"
- "Vacuum: Good (1.2e-8 mbar) — shared network"
- Warning icons when a network is contended and this beamline is getting less than it needs

### Network Validation Changes

`Networks.validate()` continues to run globally. The results are stored on `Game.state.networkData` as today. Per-beamline fault attribution is computed by checking which beamline's nodes are in a failing network:
- If an RF network is underpowered, all beamlines with cavities on that network get faulted
- If vacuum is poor, all beamlines on that vacuum network get faulted
- A beamline with status `'running'` whose networks fail transitions to `'faulted'`

## Game Loop Changes

### Tick Loop

```
tick():
  state.tick++
  
  // Global economy (unchanged)
  apply passive income, reputation income
  deduct staff costs
  
  // Per-beamline tick
  for each entry in registry.beamlines:
    if entry.status === 'running':
      tickBeamline(entry)   // data, discoveries, photon ports, wear, etc.
  
  // Standalone machines (unchanged)
  _tickMachines()
  
  // Global systems (unchanged)
  research, objectives, system stats, auto-save
  
  emit('tick')
```

### tickBeamline(entry)

Extracted from the current monolithic tick. Operates on `entry.beamState`:
- Increment `beamOnTicks`, `continuousBeamTicks`
- Data generation (scaled by connected diagnostics and scientist staff)
- Photon data from undulators
- User beam hours from photon ports
- Discovery chance rolls
- Reputation from beam quality
- Component wear (every 10 ticks)
- Check network health — if this beamline's networks are failing, set `status = 'faulted'`

### recalcBeamline(beamlineId)

Runs physics simulation for one beamline:
- Gets ordered components from `registry.get(beamlineId).beamline.getOrderedComponents()`
- Sends lattice to Pyodide/BeamPhysics
- Stores results in `entry.beamState`

### Infrastructure Validation

`validateInfrastructure()` still runs globally since networks are spatial. After validation, per-beamline fault attribution:

```
for each entry in registry.beamlines:
  if entry.status === 'running':
    if any of this beamline's nodes are in a failing network:
      entry.status = 'faulted'
      log("Linac-1 TRIPPED: " + reason)
```

## Save/Load

### Save Format

Save version bumps from 5 to 6.

```json
{
  "version": 6,
  "state": { /* global state without flat beam fields */ },
  "beamlines": [
    {
      "id": "bl-1",
      "name": "Linac-1",
      "status": "running",
      "beamState": { /* per-beamline beam fields */ },
      "beamline": { "nodes": [...], "nextId": 5 }
    }
  ]
}
```

### Migration from v5

On load, if `version === 5`:
- Create a single beamline entry from the existing `data.beamline` and flat beam fields in `data.state`
- Name it "Beamline-1"
- Set status based on `data.state.beamOn`
- Move all beam-related fields from state into `beamState`
- Bump version to 6

## File Changes Summary

### New Files
- `src/beamline/BeamlineRegistry.js` — BeamlineRegistry class
- `src/ui/ContextWindow.js` — Draggable context window base class
- `src/ui/BeamlineWindow.js` — Beamline-specific tab renderers
- `src/ui/MachineWindow.js` — Machine-specific tab renderers

### Modified Files
- `src/main.js` — Create BeamlineRegistry instead of single Beamline, remove global beam button wiring
- `src/game/Game.js` — Major refactor: use registry, per-beamline tick, per-beamline physics, edit mode state, save/load v6
- `src/game/economy.js` — Adapt `computeSystemStats` for multi-beamline
- `src/input/InputHandler.js` — Edit mode gating, source placement creates new beamline, click-to-select beamline
- `src/renderer/Renderer.js` — Edit mode dimming, per-beamline rendering
- `src/renderer/beamline-renderer.js` — Per-beamline opacity, build cursors filtered by edit mode
- `src/renderer/hud.js` — Remove global beam button, update stats panel for selected beamline, palette filtering
- `src/renderer/overlays.js` — Context window rendering integration
- `src/beamline/physics.js` — `BeamPhysics` accepts beamline ID, returns results per-beamline
- `src/networks/networks.js` — Add per-beamline breakdown reporting (core discovery unchanged)
- `index.html` — Remove `#btn-toggle-beam`, add `#context-windows-container`
- `style.css` — Context window styles, edit mode dimming styles
