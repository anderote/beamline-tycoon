# Infrastructure Quality & Room System Design

## Overview

Infrastructure networks (power, RF, cooling, vacuum, cryo, data) currently enforce binary pass/fail validation. This design introduces **gradual quality degradation** so that underpowered infrastructure reduces beamline performance proportionally rather than shutting it down. Labs connected to networks via spatial proximity provide bonuses that can compensate for shortfalls. A new **room detection system** provides the spatial structure for lab-to-network connectivity.

## 1. Room Detection

### Algorithm

Flood-fill from any flooring tile, bounded by walls (or map edges). Each connected region of floor tiles fully enclosed by walls forms a **room**.

### Room Properties

```javascript
{
  id: Number,
  tiles: [{ col, row }],          // all tiles in the room
  boundaryTiles: [{ col, row }],  // tiles adjacent to a wall edge
  flooringBreakdown: { foundation: 0.85, labFloor: 0.15, ... },
  roomType: 'beamHall',           // auto-classified
  zoneTypes: ['rfLab'],           // zone overlays present in this room
}
```

### Room Type Classification

| Type | Detection Rule |
|------|---------------|
| Beam Hall | >= 80% foundation flooring, contains beamline node(s) |
| Machine Hall | >= 80% foundation flooring, contains machine (cyclotron, etc.), no beamline |
| Empty Hall | >= 80% foundation flooring, no beamline or machine |
| Zone-typed (RF Lab, Control Room, etc.) | Room contains tiles with that zone overlay |
| Hallway | Majority hallway flooring |
| Unclassified | Everything else |

### When to Compute

On infrastructure change (wall/floor/zone placed or removed) -- same cadence as current `validateInfrastructure()`.

## 2. Lab-to-Network Connectivity

### How Labs Find Networks

1. For each lab room, compute its **reach set**: all tiles exactly 1 cardinal step (N/S/E/W) outside the room's tile boundary.
2. Find any network tiles (rfWaveguide, vacuumPipe, etc.) that fall in the reach set.
3. The lab's bonus applies to that entire network cluster (since networks are flood-filled connected components).

This means:
- A lab directly adjacent to a beam hall (sharing a wall) can reach network tiles on the other side of the wall.
- A lab separated by a 1-tile hallway **cannot** reach into the room on the other side -- but if the network cable/pipe runs through the hallway within 1 tile of the lab wall, the lab touches that network tile, and the entire connected network cluster gets the bonus.
- A 2+ tile wide hallway without network cabling blocks the lab's influence entirely.

### Lab-to-Network Type Mapping

| Lab Zone Type | Boosts Network Type |
|---|---|
| rfLab | rfWaveguide |
| coolingLab | coolingWater |
| vacuumLab | vacuumPipe |
| diagnosticsLab | dataFiber |
| controlRoom | dataFiber |

### Lab Bonus Value

Sum of `zoneOutput` from all furnishings in that zone type within that room.

Example: RF Lab with oscilloscope (0.05) + spectrum analyzer (0.08) = **0.13 bonus**.

### Stacking

Multiple labs reaching the same network cluster stack additively. Total lab bonus is capped at **0.5** to prevent labs from fully compensating for missing infrastructure.

## 3. Infrastructure Quality Calculation

### Per-Network Quality Score

```
ratio     = capacity / demand      (clamped to 0..1, or 1.0 if demand = 0)
lab_bonus = sum of zoneOutput from all connected labs (capped at 0.5)
quality   = min(1.0, ratio + lab_bonus)
```

When `ratio >= 1.0`, quality is 1.0 regardless of lab bonus (labs don't boost beyond nominal performance).

### Network-to-Physics Effect Mapping

| Network | What degrades | How |
|---|---|---|
| powerCable | All connected component stats | `focusStrength *= quality`, `energyGain *= quality` |
| rfWaveguide | RF cavity gradient | `energyGain *= quality` |
| coolingWater | RF gradient + magnet field quality | `energyGain *= quality`, small emittance growth factor `1 + 0.1 * (1 - quality)` |
| vacuumPipe | Beam current survival | Increases beam loss proportional to `(1 - quality)` |
| cryoTransfer | SRF components | **Hard quench threshold**: if `ratio < 0.5`, SRF elements become drifts (zero acceleration). Above 0.5: `energyGain *= quality` |
| dataFiber | Data collection rate | `dataRate *= quality` applied in game tick (not physics engine) |

### Stacking Across Network Types

A beamline component on multiple networks receives all applicable penalties multiplied together. Example: an RF cavity with power quality 0.9 and RF quality 0.85 operates at `0.9 * 0.85 = 0.765` effective gradient.

## 4. Data Flow

### JS Side (networks.js)

1. `Networks.validate()` computes quality per network cluster, including lab bonuses from room connectivity.
2. Per beamline node: collect effective quality multipliers from all networks the node belongs to.
3. Attach per-node quality to the game beamline payload sent to Python.

### Python Side (gameplay.py)

4. `beamline_config_from_game()` reads per-node quality multipliers and applies them when building the physics element list:
   - `energyGain *= node.powerQuality * node.rfQuality * node.coolingQuality`
   - `focusStrength *= node.powerQuality`
   - Cooling emittance growth applied as envelope expansion factor
5. Vacuum quality affects beam loss calculation (applied as additional loss term in propagation or post-processing).
6. Cryo quench gate: if `cryoRatio < 0.5`, SRF elements converted to drift type.

### Game Tick (Game.js)

7. Data fiber quality scales `connectedDataRate` in `_tickBeamline()`.
8. Network quality scores stored in `state.networkQuality` for UI display.

## 5. Network Info Panel

### Trigger

Clicking on any network tile (connection cable/pipe) opens the panel.

### Panel Contents

- **Header**: Network type name and color (e.g., "RF Waveguide Network")
- **Capacity bar**: Visual bar showing capacity vs. demand (e.g., "1200 kW / 1000 kW")
- **Base ratio**: Percentage (e.g., "120%")
- **Lab bonuses**: Listed individually with source:
  - "RF Lab (Room 3): +0.13"
  - "RF Lab (Room 7): +0.08"
- **Effective quality**: Percentage, color-coded: green (>= 90%), yellow (60-89%), red (< 60%)
- **Connected equipment**: List of facility equipment on this network with their contribution (supply or demand)
- **Connected beamline components**: List of beamline nodes served by this network
- **Effect summary**: Human-readable impact, e.g., "RF cavities operating at 85% gradient" or "All systems nominal"

### Layout

Similar to existing beamline click popup. Appears on click, dismisses on click-away or Escape.

## 6. Click Behavior

- **Clicking a beamline component**: Opens the existing beamline window (no change).
- **Clicking a network tile** (cable/pipe): Opens the network info panel (Section 5) showing quality, lab bonuses, connected equipment, and effect summary.
- **Clicking facility equipment**: Could highlight which networks it belongs to (stretch goal, not required for v1).

## 7. Scope Boundaries

### In Scope
- Room detection via wall flood-fill
- Room auto-classification
- Lab-to-network connectivity via room reach sets
- Per-network quality scores with lab bonuses
- Quality multipliers fed into physics engine
- Network info panel UI
- SRF quench hard threshold

### Out of Scope (deferred)
- Machine Shop / Maintenance zone effects on wear and repair
- Optics Lab network connectivity (research-only for now)
- Research unlocking per-component parameter ranges
- Diagnostic phase-space data integration

## 8. Files to Modify

| File | Changes |
|---|---|
| `src/networks/networks.js` | Add room detection, lab connectivity, quality scoring |
| `src/game/Game.js` | Pass quality data to physics, store in state |
| `beam_physics/gameplay.py` | Apply per-node quality multipliers to element config |
| `src/data/modes.js` | Add lab-to-network mapping constant |
| `src/data/infrastructure.js` | No changes needed (furnishing effects already defined) |
| `src/ui/` (new or existing) | Network info panel rendering |
