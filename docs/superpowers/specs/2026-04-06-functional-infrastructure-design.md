# Functional Facility Infrastructure

All facility infrastructure systems become hard gates on beam operation. Components without proper connections and sufficient capacity do not function. Utility networks are isolated by physical topology — disconnected equipment has no effect.

## Power System

Remove the abstract `energy` resource and per-tick recharge mechanic. Replace with direct kW supply/demand.

### Model
- Connected clusters of power cable tiles form **power networks**
- Each network's capacity = sum of substation kW in that network (1500 kW per substation)
- Each network's draw = sum of `energyCost` from all beamline + facility components reachable via power cables in that network
- Base capacity of 500 kW is removed — all power must come from substations
- Every component with `energyCost > 0` must list `powerCable` in its `requiredConnections`

### Hard Gate
- Draw > capacity in any power network = beam cannot start / shuts off
- Component with no power cable connection to a substation = does not function

## Vacuum System

Global per-beamline, but topology-aware through pipe conductance.

### Model
- Each vacuum pipe tile has a conductance value C (L/s)
- Pipes in series: 1/C_total = 1/C1 + 1/C2 + ...
- Pipes in parallel: C_total = C1 + C2 + ...
- For each pump connected to the beamline via vacuum pipe, compute effective pumping speed delivered through the conductance network
- Total effective pump speed across all paths determines average pressure
- Pressure = beamline_volume / effective_pump_speed (simplified)
- Any beamline component can serve as a vacuum connection point

### Pressure Quality Thresholds
- Excellent: < 1e-9 mbar
- Good: < 1e-7 mbar
- Marginal: < 1e-4 mbar
- Poor: >= 1e-4 mbar
- None: no connected pumps

### Hard Gate
- "Poor" or "None" pressure quality = beam cannot start / shuts off

### Pump Speed Reference
- Roughing pump: 10 L/s
- Turbo pump: 300 L/s
- Ion pump: 100 L/s
- NEG pump: 200 L/s
- Ti sublimation pump: 500 L/s

### Pipe Conductance
- Each vacuum pipe tile: 50 L/s conductance (placeholder, tunable)
- Conductance decreases through longer pipe runs (series reduction)
- Multiple parallel paths from a pump to the beamline add conductance

## RF Power System

Connected clusters of RF waveguide tiles form **RF networks**.

### Model
Each RF network is validated for:

1. **Frequency match** — RF source operating frequency must match cavity resonant frequency. Mismatched source/cavity pairs in the same network do not couple. Components declare their frequency via params (e.g. `rfFrequency: 2856` for S-band).

2. **Forward power budget** — Total RF source output power (at the matched frequency) must meet total cavity power demand. Each cavity type has a power demand derived from its gradient and shunt impedance. Sources declare output via `peakPower` or `cwPower` params.

3. **Reflected power** — Simple mismatch model: ~2% of forward power reflected. Circulators in the network absorb reflected power. Missing circulator = flagged as warning (increased wear on RF sources).

4. **Modulator check** — Pulsed klystrons require a modulator in the same RF network to function. Without a modulator, the klystron contributes zero power.

### Component Frequencies
- Magnetron: 2856 MHz (S-band)
- SSA: broadband (matches any)
- Klystron: 2856 MHz (S-band)
- CW Klystron: 1300 MHz (L-band)
- IOT: 1300 MHz (L-band)
- Multi-beam klystron: 11424 MHz (X-band)
- High-power SSA: broadband
- Pillbox cavity: 200 MHz
- Half-wave cavity: 100 MHz
- RFQ: 400 MHz
- S-band structure: 2856 MHz
- C-band structure: 5712 MHz
- X-band structure: 11424 MHz
- Tesla 9-cell: 1300 MHz
- SRF 650 cavity: 650 MHz
- RF cavity (basic): 2856 MHz
- Cryomodule: 1300 MHz
- NC RF gun: 2856 MHz
- SRF gun: 1300 MHz
- Buncher cavity: 2856 MHz

### Hard Gate
- Cavity with no RF network = zero energy gain
- Frequency mismatch between source and cavity = zero energy gain for mismatched cavities
- Insufficient forward power = cavities operate at reduced gradient proportional to available/required power ratio (exception to pure hard gate — RF power affects gradient continuously)

## Cooling System

Connected clusters of cooling water tiles form **cooling networks**.

### Model
- Each network's capacity = sum of cooling plant equipment kW:
  - LCW skid: 100 kW
  - Chiller: 200 kW
  - Cooling tower: 500 kW
- Each network's heat load = sum of connected components' heat output
  - Heat output per component = `energyCost * 0.6` (60% of electrical draw becomes heat)
- Deionizer in network improves water quality (reduces corrosion/wear on cooled components)
- Emergency cooling in network prevents damage on power loss (future mechanic)

### Hard Gate
- Heat load > capacity in any cooling network = beam cannot start / shuts off
- Component with `coolingWater` in `requiredConnections` but no connection to a cooling network = does not function

## Cryogenics

Connected clusters of cryo transfer tiles form **cryo networks**.

### Model
- Each network's cooling capacity:
  - 4K cold box: 500 W
  - 2K cold box: 200 W
  - Cryocooler: 50 W
- Each network's heat load:
  - Cryomodule housing: 3 W static
  - SRF cavity (beamline): 3 W static + 15 W dynamic = 18 W per cavity
- Operating temperature = coldest cold box in network (4.5K or 2K)
- He compressor required in network for cold boxes to function (without compressor, cold boxes contribute zero capacity)
- LN2 pre-cooler in network reduces energy draw of compressors (optimization, not required)
- He recovery in network reduces operating cost (future mechanic)

### Hard Gate
- Heat load > capacity in any cryo network = beam cannot start / shuts off
- SRF cavity with no cryo network = zero energy gain
- Cold box without compressor in same network = zero capacity

## Data & Controls

Binary per-component connection check.

### Model
- Diagnostics with `dataFiber` in `requiredConnections` must trace a data/fiber path to a Rack/IOC
- No connection = diagnostic produces zero data rate
- Timing system in facility = required for kickers and pulsed devices (future mechanic)

### Hard Gate
- PPS interlock: at least 1 must exist in facility equipment to run beam (global check, not connection-traced)
- Diagnostic without data connection = zero data output

## Ops / Safety

### Model
- Shielding: minimum 1 required to run beam. Additional shielding required proportional to beam power: 1 per 50 kW of total beamline energy cost
- MPS (Machine Protection System): if absent, component wear rate doubles
- Beam dump (facility): at least 1 recommended but not hard-gated
- Rad waste storage: required once beam power exceeds threshold (future mechanic)

### Hard Gate
- Insufficient shielding = beam cannot start

## Per-Component requiredConnections

Added to each component definition in `data.js` as an explicit array.

### Beamline Components
| Component | Required Connections |
|-----------|---------------------|
| source (thermionic) | `['powerCable']` |
| drift | `[]` |
| beam pipe | `[]` |
| dipole | `['powerCable', 'coolingWater']` |
| quadrupole | `['powerCable', 'coolingWater']` |
| sextupole | `['powerCable', 'coolingWater']` |
| corrector | `['powerCable']` |
| solenoid | `['powerCable', 'coolingWater']` |
| rfCavity | `['powerCable', 'coolingWater', 'rfWaveguide']` |
| cryomodule | `['powerCable', 'cryoTransfer', 'rfWaveguide']` |
| tesla9Cell | `['powerCable', 'cryoTransfer', 'rfWaveguide']` |
| srf650Cavity | `['powerCable', 'cryoTransfer', 'rfWaveguide']` |
| pillboxCavity | `['powerCable', 'rfWaveguide']` |
| halfWaveCavity | `['powerCable', 'rfWaveguide']` |
| rfq | `['powerCable', 'coolingWater', 'rfWaveguide']` |
| sBandStructure | `['powerCable', 'coolingWater', 'rfWaveguide']` |
| cBandStructure | `['powerCable', 'coolingWater', 'rfWaveguide']` |
| xBandStructure | `['powerCable', 'coolingWater', 'rfWaveguide']` |
| ncRfGun | `['powerCable', 'coolingWater', 'rfWaveguide']` |
| srfGun | `['powerCable', 'cryoTransfer', 'rfWaveguide']` |
| dcPhotocathodeGun | `['powerCable']` |
| bpm | `['powerCable', 'dataFiber']` |
| emittanceScanner | `['powerCable', 'dataFiber']` |
| wallCurrentMonitor | `['powerCable', 'dataFiber']` |
| wireScanner | `['powerCable', 'dataFiber']` |
| striplinePickup | `['powerCable', 'dataFiber']` |
| cavityBpm | `['powerCable', 'dataFiber']` |
| bunchLengthMonitor | `['powerCable', 'dataFiber']` |
| energySpectrometer | `['powerCable', 'dataFiber']` |
| blm | `['powerCable', 'dataFiber']` |
| collimator | `['coolingWater']` |
| target | `['coolingWater']` |
| beamStop | `['coolingWater']` |
| scQuad | `['powerCable', 'cryoTransfer', 'coolingWater']` |
| scDipole | `['powerCable', 'cryoTransfer', 'coolingWater']` |
| undulator | `['powerCable']` |
| wiggler | `['powerCable']` |
| chicane | `['powerCable']` |
| bunchCompressor | `['powerCable']` |
| septum | `['powerCable']` |
| kicker | `['powerCable']` |
| photonPort | `[]` |
| detector | `['powerCable', 'coolingWater', 'dataFiber']` |
| positronTarget | `['powerCable', 'coolingWater']` |
| splitter | `['powerCable']` |
| buncher | `['powerCable', 'rfWaveguide']` |

### Facility Equipment
Facility equipment also gets `requiredConnections` where appropriate:
| Equipment | Required Connections |
|-----------|---------------------|
| Turbo pump | `['powerCable']` |
| Ion pump | `['powerCable']` |
| Bakeout system | `['powerCable']` |
| Klystron | `['powerCable']` |
| CW Klystron | `['powerCable']` |
| SSA | `['powerCable']` |
| IOT | `['powerCable']` |
| Magnetron | `['powerCable']` |
| Multi-beam klystron | `['powerCable']` |
| High-power SSA | `['powerCable']` |
| He compressor | `['powerCable', 'coolingWater']` |
| Cold box 4K | `['powerCable']` |
| Cold box 2K | `['powerCable']` |
| Cryocooler | `['powerCable']` |
| LCW skid | `['powerCable']` |
| Chiller | `['powerCable']` |
| Cooling tower | `['powerCable']` |
| Deionizer | `['powerCable']` |
| Modulator | `['powerCable']` |
| LLRF controller | `['powerCable', 'dataFiber']` |
| Rack/IOC | `['powerCable']` |
| Timing system | `['powerCable', 'dataFiber']` |
| MPS | `['powerCable', 'dataFiber']` |
| Substation | `[]` |
| Power panel | `[]` |
| Roughing pump | `['powerCable']` |
| LN2 dewar | `[]` |
| LN2 pre-cooler | `[]` |
| Heat exchanger | `[]` |
| Water load | `[]` |
| Gate valve | `[]` |
| Pirani gauge | `[]` |
| Cold cathode gauge | `['powerCable']` |
| BA gauge | `['powerCable']` |
| PPS interlock | `['powerCable']` |
| Shielding | `[]` |
| Area monitor | `['powerCable']` |
| Beam dump (facility) | `['coolingWater']` |
| Target handling | `['powerCable']` |
| Rad waste storage | `[]` |
| Laser system | `['powerCable']` |
| Circulator | `[]` |
| High-power coupler | `[]` |
| Cryomodule housing | `[]` |
| He recovery | `['powerCable']` |
| Emergency cooling | `['powerCable']` |

## Validation Engine

### Trigger Events
Validation runs on:
- Beam toggle (player presses beam on)
- Infrastructure change (tile placed/removed)
- Facility equipment change (placed/removed)
- Connection change (pipe/cable placed/removed)

### Validation Steps
1. **Discover networks** — flood-fill per connection type to find all connected clusters
2. **Per-network stats** — compute capacity, demand, frequency, conductance for each network
3. **Per-component check** — for each beamline component, verify every entry in `requiredConnections` has a valid traced path to appropriate facility equipment
4. **Per-network capacity** — for power/cooling/cryo networks, verify supply >= demand
5. **Vacuum check** — compute effective pump speed via conductance network, determine pressure quality
6. **RF check** — validate frequency match + forward power budget per RF network
7. **Global checks** — PPS interlock exists, sufficient shielding for beam power
8. **Produce blockers list** — each blocker identifies the component, the missing requirement, and the network (if applicable)

### Consequences
- Any blocker present: beam cannot start; running beam shuts off immediately
- Blockers displayed in game log with specific messages
- Existing `!` warning indicators on components become authoritative (they already render for missing connections)
- Beam toggle button shows blocker count when beam is blocked

## Network Inspection UI

### Activation
- Click on any facility equipment (klystron, chiller, pump, substation, etc.)
- Opens a network overlay for the connection type associated with that equipment

### Overlay Behavior
- All tiles, pipes, and equipment in the network highlighted on the isometric map
- Connected beamline components highlighted with a subtle indicator
- Equipment outside the network dimmed

### Network Stats Panel
Floating panel showing network-specific information:

**Power Network:**
- Capacity (kW), Total draw (kW), Utilization %
- List of substations, list of powered components

**RF Network:**
- Operating frequency (MHz)
- Forward power (kW), Reflected power (kW)
- Source count, Cavity count
- Frequency mismatches (if any)
- Missing circulators, missing modulators

**Cooling Network:**
- Cooling capacity (kW), Heat load (kW), Margin %
- Flow rate (L/min)
- Component list

**Cryo Network:**
- Cooling capacity (W), Heat load (W), Margin %
- Operating temperature (K)
- Compressor status
- Connected SRF cavities and housings

**Vacuum (global):**
- Effective pump speed (L/s)
- Average pressure (mbar)
- Pressure quality
- Pump breakdown by type
- Conductance bottlenecks (lowest-conductance paths)

### Dismissal
- Click elsewhere on empty ground or press Escape
- Clicking another facility equipment switches to that network
