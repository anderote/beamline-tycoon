# Connection Types

## Quick Tip
Six types of pipes and cables connect facility equipment to the beamline. Each carries a different utility.

## Connection Types

### Power Cable (green)
Carries electrical power from substations and power panels to all active equipment. Forms power networks with capacity budgets. Almost every active component needs one.

- **Color:** Green (0x44cc44)
- **Network type:** Capacity-based (kW supply vs demand)
- **Source equipment:** Substation, Power Distribution Panel
- **Typical consumers:** Everything with energyCost > 0

### Vacuum Pipe (gray)
Connects vacuum pumps to the beamline. Carries pumping speed, subject to conductance losses over distance. Any beamline component can be a vacuum connection point.

- **Color:** Gray (0x999999)
- **Network type:** Conductance-based (pump speed degraded by pipe length)
- **Source equipment:** Roughing pump, Turbo pump, Ion pump, NEG pump, Ti sublimation pump
- **Consumers:** Global beamline vacuum (not per-component)

### RF Waveguide (red)
Carries RF power from sources to accelerating cavities. Frequency-matched: source must operate at the same frequency as the cavities it drives.

- **Color:** Red (0xcc4444)
- **Network type:** Frequency + power budget
- **Source equipment:** Klystron, CW Klystron, SSA, IOT, Magnetron, Multi-beam Klystron, High-power SSA
- **Consumers:** RF cavities, accelerating structures, RF guns, bunchers, RFQ
- **Support equipment:** Modulator (required for pulsed klystrons), Circulator (absorbs reflected power), High-power Coupler, LLRF Controller

### Cooling Water (blue)
Carries cooling capacity from chillers and LCW systems to heat-producing components. Forms cooling networks with capacity budgets.

- **Color:** Blue (0x4488cc)
- **Network type:** Capacity-based (kW cooling vs heat load)
- **Source equipment:** Chiller, LCW Skid, Cooling Tower
- **Consumers:** Magnets, RF cavities, beam absorbers (targets, dumps, collimators), He compressors
- **Support equipment:** Deionizer, Heat Exchanger, Water Load, Emergency Cooling

### Cryo Transfer (cyan)
Carries cryogenic helium between cryo plant equipment and SRF components. Forms cryo networks with capacity budgets at specific operating temperatures.

- **Color:** Cyan (0x44aacc)
- **Network type:** Capacity-based (watts cooling at operating temperature)
- **Source equipment:** 4K Cold Box, 2K Cold Box, Cryocooler
- **Required support:** He Compressor (cold boxes need one in-network to function)
- **Consumers:** Cryomodule, Tesla 9-cell, SRF 650 Cavity, SC Quad, SC Dipole, SRF Gun
- **Support equipment:** Cryomodule Housing, LN2 Pre-cooler, He Recovery

### Data/Fiber (white)
Carries control signals and measurement data between diagnostics and the control system. Binary connection: connected or not, no capacity concept.

- **Color:** White (0xeeeeee)
- **Network type:** Binary (path exists to Rack/IOC or not)
- **Source equipment:** Rack/IOC
- **Consumers:** All diagnostics (BPM, wire scanner, emittance scanner, etc.)
- **Support equipment:** Timing System, MPS, LLRF Controller

## Network Formation

All connection types form networks the same way: flood-fill through adjacent tiles of the same type. All facility equipment and beamline components touching tiles in a network are members of that network.

Two tiles of the same connection type that are not adjacent (including diagonally — only cardinal directions count) belong to different networks.

## Connection Placement

Players place connection tiles on the isometric grid, one tile at a time or by dragging. Tiles can overlap with infrastructure (flooring, zones) but not with beamline components or facility equipment — pipes and cables run alongside, not through, the equipment they serve.

A beamline component or facility equipment is "connected" to a network if any of its occupied tiles is cardinally adjacent to a tile in that network.
