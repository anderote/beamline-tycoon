# System-Level Infrastructure Stats Panel

## Overview

A collapsible panel below the top-bar that displays aggregate system-level statistics for each infrastructure category (Vacuum, Cryo, RF Power, Cooling, Data & Controls, Power). Visible only in Facility mode. The panel content changes based on the active facility category tab.

## UI Placement & Behavior

- **Position**: Below the top-bar, full width, above the isometric grid
- **Visibility**: Shown only when `activeMode === 'facility'`, hidden otherwise
- **Tab-reactive**: Content updates when the user switches facility category tabs
- **Collapsible**: Summary row always visible (when in facility mode); click toggle to expand/collapse a detail section below
- **Styling**: Matches existing UI — `rgba(15, 15, 35, 0.92)` background, same border/font treatment as beam-stats-panel and beam-plots

## System Metrics

### Vacuum
**Summary row**: Avg Pressure (mbar), Total Pump Speed (L/s), Beamline Volume (L), Pump Count, Gauge Count, Energy Draw (kW)
**Detail rows**:
- Roughing / Turbo / Ion / NEG / Ti-Sub pump counts and aggregate speed
- Pirani / Cold Cathode / BA gauge counts
- Gate valve count, Bakeout system count
- Pressure quality indicator (Good / Marginal / Poor based on avg pressure thresholds)

### RF Power
**Summary row**: Total Fwd Power (kW), Total Refl Power (kW), Wall Power (kW), VSWR, Source Count, Avg Efficiency (%)
**Detail rows**:
- Klystron / SSA / IOT / Magnetron counts and per-type power
- Modulator count
- Circulator / Waveguide / LLRF controller counts
- Total waveguide loss estimate

### Cryo
**Summary row**: Cooling Capacity (W), Heat Load (W), Operating Temp (K), Wall-Plug Power (kW), Margin (%)
**Detail rows**:
- Compressor count
- Cold Box 4K / Sub-cooling 2K counts and capacities
- Cryomodule Housing count
- LN2 Pre-cooler count (and whether present)
- He Recovery status
- Cryocooler count
- Static vs dynamic heat load breakdown

### Cooling
**Summary row**: Cooling Capacity (kW), Heat Load (kW), Flow Rate (L/min), Energy Draw (kW), Margin (%)
**Detail rows**:
- LCW Skid / Chiller / Cooling Tower / Heat Exchanger counts
- Water Load count
- Deionizer status (present/absent)
- Emergency Cooling status

### Power
**Summary row**: Capacity (kW), Total Draw (kW), Utilization (%), Substations, Panels
**Detail rows**:
- Per-substation capacity contribution
- Draw breakdown by system category (vacuum, cryo, RF, cooling, data)
- Headroom/margin

### Data & Controls
**Summary row**: IOC Count, Interlock Count, Monitor Count, Timing Systems, MPS Status
**Detail rows**:
- Rack/IOC count
- PPS Interlock count
- Radiation Monitor count
- Timing System count
- MPS count and status
- Laser System count

## Computation Approach

Stats are computed from placed `facilityEquipment[]` by counting equipment types per category and summing their properties from `COMPONENTS` data. Physics-engine results (pressure, RF power, cryo loads) are incorporated when available from `game.state` (populated by the Python beam physics each tick). When physics results aren't available, derive estimates from component properties.

A new `computeSystemStats()` method on Game aggregates these per-category, called on each tick (or on facilityEquipment change). Results stored in `game.state.systemStats`.

## Implementation Files

1. **data.js**: Add `SYSTEM_STATS_CONFIG` defining metric labels, units, and computation keys per category
2. **game.js**: Add `computeSystemStats()` method, call from tick and on equipment change
3. **index.html**: Add `#system-stats-panel` HTML structure
4. **style.css**: Add panel styles
5. **renderer.js**: Wire up show/hide on mode switch, update content on tab change and tick, handle expand/collapse
