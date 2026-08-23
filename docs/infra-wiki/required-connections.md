# Required Connections by Component

## Quick Tip
Every declared sink must be wired. Five utilities are hard-required — power, vacuum, RF, cooling, cryo. Data is soft.

## How It Works

What a component *needs* is not a hand-written list — it is the set of utility **sink ports** the component declares. If a component declares a sink for one of the five hard-required utilities and that sink is not wired to any network, the beam does not run, and that sink resolves to its worst-case value.

Two consequences worth knowing:

- **Every beamline component needs vacuum.** A vacuum sink is injected automatically for every placeable beamline module, whether or not it has any other utility. Bellows and apertures need nothing but vacuum — and they do need it.
- **Beam pipe (`drift`) is the exception.** It is a drawn connection, never a placeable, so it declares no ports at all. Its outgassing is charged directly by the vacuum solver to whichever pumps serve the components mounted on it.

The numbers below are the declared loads: power in kW, cooling in kW of heat, RF in kW (with the frequency bucket), cryo in watts of static heat, and vacuum in mbar·L/s. Data is a directionless bus and has no bandwidth load or capacity.

## Beamline Components

### Sources
| Component | Power | Cooling | RF | Cryo | Data | Vacuum |
|-----------|:-----:|:-------:|:--:|:----:|:----:|:------:|
| Electron Gun | 50 | 30 | | | | 1e-6 |
| Duoplasmatron Ion Source | 30 | 20 | | | | 1e-6 |
| ECR Ion Source | 60 | 40 | 6 @ 2450 MHz | | | 5e-6 |
| High-Voltage DC Injector | 400 | 150 | | | | 2e-6 |

### Drift / Beam Pipe
| Component | Power | Cooling | RF | Cryo | Data | Vacuum |
|-----------|:-----:|:-------:|:--:|:----:|:----:|:------:|
| Beam Pipe (`drift`) | | | | | | *charged by length to the pumps serving it* |
| Bellows Section | | | | | | by length (~3.8e-7 per metre) |
| Aperture | | | | | | 5e-7 |

### RF / Accelerating
| Component | Power | Cooling | RF | Cryo | Data | Vacuum |
|-----------|:-----:|:-------:|:--:|:----:|:----:|:------:|
| Buncher | 5 | | 2 @ 162.5 MHz | | | 5e-7 |
| Pillbox Cavity | 10 | | 5 @ 162.5 MHz | | | 1e-6 |
| RFQ | 40 | 60 | 25 @ 162.5 MHz | | | 1e-6 |
| Drift-Tube Linac | 22 | 140 | 45 @ 325 MHz | | | 1.5e-6 |
| NC RF Cavity | 60 | 120 | 40 @ 2856 MHz | | | 2e-6 |
| S-band Structure | 60 | 100 | 45 @ 2856 MHz | | | 2e-6 |
| Half-Wave Resonator | 8 | | 3 @ 162.5 MHz | 15 W | | 5e-7 |
| Spoke Cavity | 10 | | 8 @ 325 MHz | 25 W | | 1e-6 |
| 9-cell Elliptical SRF | 12 | | 5 @ 1300 MHz | 40 W | | 1e-6 |
| TESLA Cryomodule | 80 | | 40 @ 1300 MHz | 250 W | | 4e-6 |

SRF cavities take **no cooling water**. Their thermal path is the cryo network.

### Focusing / Steering
| Component | Power | Cooling | RF | Cryo | Data | Vacuum |
|-----------|:-----:|:-------:|:--:|:----:|:----:|:------:|
| Dipole | 25 | 20 | | | | 5e-7 |
| Quad | 10 | 8 | | | | 5e-7 |
| Sextupole | 8 | 6 | | | | 5e-7 |
| Injection Septum | 40 | 25 | | | | 5e-7 |
| Velocity Selector | 15 | | | | | 5e-7 |
| Pepper-pot Emittance Filter | 2 | | | | | 5e-7 |

### Diagnostics
| Component | Power | Cooling | RF | Cryo | Data | Vacuum |
|-----------|:-----:|:-------:|:--:|:----:|:----:|:------:|
| BPM | 1 | | | | 1 | 2e-7 |
| Screen/YAG | 2 | | | | 4 | 2e-7 |
| Current Monitor (ICT) | 1 | | | | 1 | 2e-7 |
| Wire Scanner | 3 | | | | 2 | 2e-7 |
| Faraday Cup | 1 | | | | 1 | 2e-7 |

### Endpoints
| Component | Power | Cooling | RF | Cryo | Data | Vacuum |
|-----------|:-----:|:-------:|:--:|:----:|:----:|:------:|
| Beam Stop | | 50 | | | | 5e-7 |
| Target | | 40 | | | 5 | 1e-6 |
| Detector | 120 | 60 | | | 40 | 5e-6 |
| Collision Point | 20 | | | | 10 | 5e-7 |

That is the whole beamline catalogue — 30 components. Photoinjector guns, solenoids, chicanes, undulators, photon ports, positron targets and kickers are **not** in the game yet; see the physics wiki for what that means for the tier-2-and-up articles.

## Facility Equipment

Equipment power demand is its own energy cost, so the panel and the bill can never disagree.

### RF Power
| Equipment | Power draw | Provides | Cooling | Data |
|-----------|:----------:|----------|:-------:|:----:|
| Magnetron | 7 | 5 kW RF, S-band, 1% duty | | |
| TWT | 55 | 20 kW RF, all six bands, 5% duty | | |
| SSA | 70 | 35 kW RF, VHF/UHF, CW | | |
| SLAC 5045 Klystron | 50 | 25 kW RF, S-band, 0.1% duty | | |
| Pulsed Klystron | 110 | 50 kW RF, S/C-band, 0.1% duty | | |
| CW Klystron | 90 | 50 kW RF, UHF/L-band, CW | | |
| IOT | 115 | 80 kW RF, UHF/L-band, CW | | |
| Multi-beam Klystron | 310 | 200 kW RF, S/C-band, 0.5% duty | | |
| High-power SSA | 500 | 300 kW RF, VHF/UHF/L-band, CW | | |
| Gyrotron | 2000 | 1000 kW RF, C/X-band, CW | | |
| Modulator | 3 | *nothing — inert* | | |
| Circulator | | *nothing — inert* | | |
| High-power Coupler | | *nothing — inert* | | |
| LLRF Controller | 0.5 | Data peer | | 1 |
| Waveguide Manifold | | RF bus, 6-cell reach | | |

### Vacuum
| Equipment | Power draw | Provides |
|-----------|:----------:|----------|
| Roughing Pump | 0.5 | 15 L/s |
| Four-Pump Roughing Cart | 2 | 60 L/s roughing/backing |
| Turbo Pump | 1 | 300 L/s |
| Turbo Pump Cart | 4 | 1,200 L/s high vacuum; needs 60 L/s backing |
| Vacuum Cart | 3 | Integrated 30 L/s roughing + 300 L/s turbo |
| High-Capacity Vacuum Station | 18 | Integrated 150 L/s roughing + 3,000 L/s turbo |
| Ti Sublimation Pump | | 400 L/s |
| NEG Pump | | 500 L/s |
| Ion Pump | 0.3 | 600 L/s |
| Vacuum Manifold | | Vacuum bus, 5-cell reach |
| Pirani Gauge | | Pressure trace, 1e3 to 1e-3 mbar |
| Cold Cathode Gauge | 0.1 | Pressure trace, 1e-2 to 1e-9 mbar |
| BA Gauge | 0.1 | Pressure trace, 1e-4 to 1e-12 mbar |
| Gate Valve | | *inert* |
| Bakeout System | 5 | 100x outgassing reduction when connected |

### Cooling
| Equipment | Power draw | Role | Cooling capacity |
|-----------|:----------:|----------|:------------:|
| Package Chiller | 2 | Process cooling | 50 kW |
| LCW Skid | 3 | Process cooling | 100 kW |
| Dual-Circuit Chiller | 4 | Process cooling | 175 kW |
| Chiller | 5 | Process cooling | 300 kW |
| Fan-Coil Cooler | 1 | Direct air heat rejection | 20 kW |
| Dry Cooler Bank | 5 | Heat rejection | 500 kW |
| Cooling Tower | 4 | Heat rejection | 800 kW |
| LCW Manifold | | 4 cold + 4 hot flexible branches to paired rigid headers | |
| Deionizer | 1 | Water treatment | |
| Emergency Cooling | 0.1 | Backup support | |
| Water Load | | RF support load | |

### Cryogenics
| Equipment | Power draw | Provides | Cooling sink |
|-----------|:----------:|----------|:------------:|
| 4 K Cryogenic Supply | 15 | 500 W @ 4.5 K design | |
| 2 K Cryogenic Supply | 25 | 800 W, **sets network design temp to 2.0 K** | |
| Helium Refrigeration | 20 | Helium compressor and 800 W warm-end heat rejection; required by a central plant | 20 |
| Cryogenic Distribution | | Cryo bus, 6-cell reach | |
| Compact Cryogenic Supply | 25 | Integrated 90 W chiller/rejector with sealed 50 L inventory | |
| Liquid Nitrogen Tank | | Enables LN2 precooling | |
| Liquid Nitrogen Pre-cooling | 5 | +0.15 cold capacity with connected tank | |
| Cryogenic Heat Shielding | 2 | -0.05 static heat load (up to -0.25) | |
| Helium Tank | 3 | 2,000 L reservoir; raises recovery ceiling 0.70 → 0.90 | |
| Helium Recovery Header | | +0.25 recovery fraction | |
| Helium Recovery Bag | | +0.15 recovery fraction | |
| Helium Purification | 3 | +0.20 recovery fraction | |
| Helium Make-up | 12 | +0.30 recovery fraction; +1 L/tick make-up | |

Every row has a cryo connector. Plant and recovery capabilities apply only on
the network to which the equipment is wired, and powered stages count only
with a live electrical feed. Helium Refrigeration also requires a complete live
cooling-water plant. Recovery counts each type once per network, multiplies net
LHe loss rather than boil-off, and is capped at 0.70 unless bulk storage raises
the ceiling to 0.90.

### Power
| Equipment | Provides |
|-----------|----------|
| Utility Service Point | 3 MW HV supply, 2 feeders |
| Pad-Mount Transformer | 150 kW HV supply, 1 feeder |
| Facility Transformer | 400 kW HV supply, 2 feeders |
| HV Transformer | 1.5 MW HV input, 4 feeders |
| Grid Intertie Transformer | 6 MW HV input, 6 feeders |
| Compact HV Distributor | Two-wire HV trunk tap → 2 protected 300 kW HV feeders; 600 kW maximum; no new capacity |
| Motor Control Center | 1 HV input → 8 branch circuits; no new capacity |
| Power Distribution Panel | Two-wire tensioning HV roof tap → 4 × 10 kW green branch circuits; 40 kW maximum; no new capacity |
| Section Distribution Panel | Two-wire tensioning HV roof tap → 6 × 50 kW green branches + 1 × 300 kW HV feeder; 600 kW maximum; no new capacity |
| Main Distribution Panel | Two-wire tensioning HV roof tap → 12 × 50 kW green branches + 2 × 300 kW HV feeders; 1,200 kW maximum; no new capacity |
| UPS / Battery Bank | 1 HV input → 2 critical branch circuits; no new capacity |
| Beamline Busway | 1 branch input, 10-cell field reach; no new capacity |
| Spider Box | 4 interchangeable sockets; one panel feed leaves 3 local taps; no new capacity |
| Disconnect Switch | *inert* |
| Laser System | 3 kW draw, *inert* |

There is no "Substation" component.

### Controls & Safety
| Equipment | Power draw | Data in | Provides |
|-----------|:----------:|:-------:|----------|
| Rack/IOC | 0.5 | | Data peer |
| Network Switch | 0.2 | | 8-port data switch |
| Archiver | 0.5 | 1 | Data peer |
| BPM Electronics | 0.3 | 1 | Data peer |
| BLM Readout | 0.3 | 1 | Data peer |
| Timing System | 0.5 | 1 | Data peer |
| Patch Panel | | 1 | Data peer |
| Fiber Bus | | | Data bus, 12-cell reach |
| MPS | 0.5 | 1 | Halves component wear facility-wide |
| PPS Interlock | 0.2 | | *inert — no gating check exists* |
| Area Monitor | 0.1 | | *inert* |
| Search & Secure Panel | 0.1 | | *inert* |
| Access Control System | 0.1 | | *inert* |

### Ops
| Equipment | Power draw | Cooling sink | Effect |
|-----------|:----------:|:------------:|--------|
| Beam Dump | | 50 | *inert beyond the cooling load* |
| Target Handling Station | 1 | | *inert* |
| Shielding | | | *inert — no shielding requirement is checked* |
| Rad Waste Storage | | | *inert* |
