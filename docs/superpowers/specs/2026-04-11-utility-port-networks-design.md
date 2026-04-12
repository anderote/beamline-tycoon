# Utility Port Networks Design

## Summary

Replace the current tile-based pip rendering for utility connections with a physically grounded system: explicit ports on beamline components and infrastructure equipment, 3D pipe geometry on floor networks, and Z-shaped last-meter routing connecting them.

## Core Concepts

### Hybrid connection model

Infrastructure equipment (substations, chillers, RF sources) distributes utilities via **painted floor networks** — the existing tile-painting mechanic. Beamline components and infrastructure equipment both have explicit **utility ports** on their side faces. When a floor network tile is adjacent to a component, a **last-meter pipe** auto-routes from the floor network up to the component's port.

### Port placement rules

- **Modules** (placement: `module`): vacuum ports on the beam axis (front/back faces), utility ports on lateral side faces only
- **Attachments** (placement: `attachment`): utility ports on lateral side faces only, no vacuum ports (they wrap the beam pipe)
- **Drawn connections** (drift tubes): no ports of any kind, no attachments allowed
- **Infrastructure equipment**: output ports on lateral side faces, feeding into floor networks
- All utility ports are **mirrored on both lateral sides** — the system connects whichever side faces the adjacent floor network
- Port height: **0.5m** from floor level
- Passive components with no `requiredConnections` (bellows, aperture) have no utility ports

### Six utility types

| Type | Color | Profile | Approx Diameter |
|---|---|---|---|
| powerCable | green `#44cc44` | round | ~4cm |
| coolingWater | blue `#4488ff` | round pipe with wall thickness | ~8cm |
| cryoTransfer | teal `#44aacc` | round, vacuum-jacketed with insulation | ~12cm |
| rfWaveguide | red `#cc4444` | rectangular cross-section | ~10×7cm |
| dataFiber | white `#eeeeee` | thin round cable | ~2cm |
| vacuumPipe | gray `#888888` | round (existing beam pipe, slightly thinner than current) | ~12cm |

Each type has a distinct profile and size. RF waveguide is the only rectangular cross-section.

## Port Assignments

### Source

| Component | Placement | Vacuum | Power | Cooling | RF | Cryo | Data |
|---|---|---|---|---|---|---|---|
| source | module | yes | yes | - | - | - | - |
| drift | drawn conn | - | - | - | - | - | - |
| bellows | attachment | - | - | - | - | - | - |

### Optics

| Component | Placement | Vacuum | Power | Cooling | RF | Cryo | Data |
|---|---|---|---|---|---|---|---|
| dipole | module | yes | yes | yes | - | - | - |
| quadrupole | attachment | - | yes | yes | - | - | - |
| sextupole | attachment | - | yes | yes | - | - | - |
| aperture | attachment | - | - | - | - | - | - |
| splitter | module | yes | yes | - | - | - | - |
| velocitySelector | module | yes | yes | - | - | - | - |
| emittanceFilter | module | yes | - | - | - | - | - |

### RF / Acceleration (normal conducting)

| Component | Placement | Vacuum | Power | Cooling | RF | Cryo | Data |
|---|---|---|---|---|---|---|---|
| rfq | module | yes | yes | yes | yes | - | - |
| pillboxCavity | module | yes | yes | - | yes | - | - |
| rfCavity | module | yes | yes | yes | yes | - | - |
| sbandStructure | module | yes | yes | yes | yes | - | - |

### RF / Acceleration (superconducting)

| Component | Placement | Vacuum | Power | Cooling | RF | Cryo | Data |
|---|---|---|---|---|---|---|---|
| halfWaveResonator | module | yes | yes | - | yes | yes | - |
| spokeCavity | module | yes | yes | - | yes | yes | - |
| ellipticalSrfCavity | module | yes | yes | - | yes | yes | - |
| cryomodule | module | yes | yes | - | yes | yes | - |

### Diagnostics

| Component | Placement | Vacuum | Power | Cooling | RF | Cryo | Data |
|---|---|---|---|---|---|---|---|
| bpm | attachment | - | yes | - | - | - | yes |
| screen | module | yes | yes | - | - | - | yes |
| ict | attachment | - | yes | - | - | - | yes |
| wireScanner | module | yes | yes | - | - | - | yes |

### Endpoints

| Component | Placement | Vacuum | Power | Cooling | RF | Cryo | Data |
|---|---|---|---|---|---|---|---|
| faradayCup | module | yes | yes | - | - | - | yes |
| beamStop | module | yes | - | yes | - | - | - |
| detector | module | yes | yes | yes | - | - | yes |
| target | module | yes | - | yes | - | - | yes |

### Key decisions

- SRF cavities get cryo transfer, not cooling water — mutually exclusive for these components
- Pillbox cavity has no cooling (low power, air-cooled)
- ICT is an attachment (toroid around beam pipe)
- Drift tubes accept no attachments and have no ports
- Bellows and aperture are fully passive — no utility ports

### Infrastructure output port assignments

Infrastructure equipment has output ports for the utility type(s) it provides:

| Equipment | Output Ports |
|---|---|
| substation | powerCable |
| powerPanel | powerCable |
| magnetron, solidStateAmp, twt, pulsedKlystron, cwKlystron, iot, multibeamKlystron, highPowerSSA, gyrotron | rfWaveguide |
| lcwSkid, chiller, coolingTower | coolingWater |
| coldBox4K, coldBox2K | cryoTransfer |
| roughingPump, turboPump, ionPump, negPump, tiSubPump | vacuumPipe |
| rackIoc, timingSystem, networkSwitch, archiver, bpmElectronics, blmReadout, llrfController | dataFiber |
| patchPanel | dataFiber |

Equipment that is purely internal (modulators, circulators, gauges, safety interlocks, shielding) does not have output ports — it either connects implicitly to its parent system or has no network role.

## Port Data Model

Each component and infrastructure entry gains a `utilityPorts` array in its data definition:

```js
utilityPorts: [
  { type: 'powerCable',   offset: 0.3 },
  { type: 'coolingWater',  offset: 0.5 },
  { type: 'rfWaveguide',   offset: 0.7 },
]
```

- `type`: one of the six utility connection types
- `offset`: normalized 0→1 position along the lateral side face (0 = back end, 1 = front end), controlling port spacing along the component's length
- Ports are automatically mirrored to both lateral sides
- Port height is fixed at 0.5m — not per-port configurable
- Vacuum ports on modules are implicit from `ports.entry`/`ports.exit` (existing system), not part of `utilityPorts`

Infrastructure equipment uses the same schema for its output ports.

## Last-Meter Routing

### Z-shaped route geometry

When a component's port is connected to an adjacent floor network:

1. **Horizontal stub**: pipe extends ~0.15m straight out from the port on the side face
2. **Vertical drop**: pipe turns 90° downward to floor level (~0.5m drop)
3. **Horizontal floor run**: pipe turns 90° toward the floor network tile and joins it

Each segment uses the pipe's correct profile (round, rectangular for RF, jacketed for cryo) and color.

### Connection detection

- The system checks which lateral side of the component faces a floor network tile carrying the matching utility type
- If the left side faces the network, left-side ports are connected; right-side stubs remain disconnected
- If both sides face matching networks, prefer the side with the shorter path (or left by convention)

### Disconnected ports

Ports always render as short colored stubs on both side faces. Connected ports additionally get the full Z-route pipe run. Disconnected stubs make it visually obvious what's missing.

## Floor Network Rendering

### Replacing pips with pipe geometry

Current colored pips are replaced with actual 3D pipe geometry running along tiles at floor level:

- Pipes sit on the floor surface, running along the tile centerline in the direction of adjacency
- At corners (L-shaped adjacency), pipes bend 90°
- At T/cross junctions, pipes branch

### Side-by-side arrangement

When multiple utility types share a tile, pipes run parallel side by side:

- Sorted by size: largest (cryo/RF) on the outside, smallest (data) on the inside
- Centered on the tile as a group
- Each pipe at its correct profile and color

### Infrastructure output ports

Infrastructure equipment (chillers, substations, RF sources) has output ports on its side faces using the same visual system. A chiller's cooling water output port connects via Z-route down to the floor network, making the full chain visible: infrastructure port → floor network → beamline component port.

## Rendering Architecture

### New: `utility-port-builder.js`

Responsible for generating port stub geometry on components — small colored cylinders/rectangles at the correct positions on side faces. Called by `component-builder.js` and `equipment-builder.js` when building component meshes.

### Modified: `connection-builder.js`

Replaces pip rendering with:
- Floor-level pipe geometry (parallel runs with correct profiles)
- Z-route geometry from floor network up to component ports
- Corner/junction handling for floor network routing

### Modified: `world-snapshot.js`

`buildConnections` gains:
- Port position data for each beamline component and infrastructure node
- Which side is connected vs disconnected per component
- Floor network path segments with direction/junction info for 3D rendering

### Modified: `component-builder.js` / `equipment-builder.js`

Call `utility-port-builder` to add port stubs when constructing component meshes. Port positions derived from the component's `utilityPorts` data.

## Beam Pipe Changes

The vacuum beam pipe (existing rendered geometry) becomes slightly thinner than current to better match the utility pipe scale hierarchy. No functional change — visual only.
