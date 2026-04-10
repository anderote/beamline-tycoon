# Required Connections by Component

## Quick Tip
Each component lists exactly what it needs to function. No guessing — check the table.

## How It Works

Every component has a `requiredConnections` array that explicitly lists which connection types it needs. If any required connection is missing, the component does not function (hard gate). Passive components like drift tubes need nothing. Active components need power, cooling, RF, cryo, or data connections depending on their role.

## Beamline Components

### Sources
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Source (thermionic) | x | | | | |
| DC Photocathode Gun | x | | | | |
| NC RF Gun | x | x | x | | |
| SRF Gun | x | | x | x | |

### Drift / Beam Pipe
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Beam Pipe | | | | | |
| Beam Pipe | | | | | |

### RF / Accelerating
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| RF Cavity | x | x | x | | |
| Pillbox Cavity | x | | x | | |
| Half-wave Cavity | x | | x | | |
| RFQ | x | x | x | | |
| S-band Structure | x | x | x | | |
| C-band Structure | x | x | x | | |
| X-band Structure | x | x | x | | |
| Buncher Cavity | x | | x | | |
| Cryomodule | x | | x | x | |
| Tesla 9-cell | x | | x | x | |
| SRF 650 Cavity | x | | x | x | |

### Focusing / Steering
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Dipole | x | x | | | |
| Quadrupole | x | x | | | |
| Sextupole | x | x | | | |
| Corrector | x | | | | |
| Solenoid | x | x | | | |
| SC Quad | x | x | | x | |
| SC Dipole | x | x | | x | |

### Diagnostics
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| BPM | x | | | | x |
| Emittance Scanner | x | | | | x |
| Wall Current Monitor | x | | | | x |
| Wire Scanner | x | | | | x |
| Stripline Pickup | x | | | | x |
| Cavity BPM | x | | | | x |
| Bunch Length Monitor | x | | | | x |
| Energy Spectrometer | x | | | | x |
| Beam Loss Monitor | x | | | | x |

### Beam Optics / Manipulation
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Undulator | x | | | | |
| Wiggler | x | | | | |
| Chicane | x | | | | |
| Bunch Compressor | x | | | | |
| Septum | x | | | | |
| Kicker | x | | | | |
| Splitter | x | | | | |

### Endpoints
| Component | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Collimator | | x | | | |
| Target | | x | | | |
| Beam Stop | | x | | | |
| Photon Port | | | | | |
| Detector | x | x | | | x |
| Positron Target | x | x | | | |

## Facility Equipment

### RF Power
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Magnetron | x | | | | |
| SSA | x | | | | |
| Klystron | x | | | | |
| CW Klystron | x | | | | |
| IOT | x | | | | |
| Multi-beam Klystron | x | | | | |
| High-power SSA | x | | | | |
| Modulator | x | | | | |
| Circulator | | | | | |
| High-power Coupler | | | | | |
| LLRF Controller | x | | | | x |

### Vacuum
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Roughing Pump | x | | | | |
| Turbo Pump | x | | | | |
| Ion Pump | x | | | | |
| NEG Pump | | | | | |
| Ti Sublimation Pump | | | | | |
| Pirani Gauge | | | | | |
| Cold Cathode Gauge | x | | | | |
| BA Gauge | x | | | | |
| Gate Valve | | | | | |
| Bakeout System | x | | | | |

### Cooling
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| LCW Skid | x | | | | |
| Chiller | x | | | | |
| Cooling Tower | x | | | | |
| Heat Exchanger | | | | | |
| Water Load | | | | | |
| Deionizer | x | | | | |
| Emergency Cooling | x | | | | |

### Cryogenics
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| LN2 Dewar | | | | | |
| Cryocooler | x | | | | |
| LN2 Pre-cooler | | | | | |
| He Compressor | x | x | | | |
| 4K Cold Box | x | | | | |
| 2K Cold Box | x | | | | |
| Cryomodule Housing | | | | | |
| He Recovery | x | | | | |

### Power
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Substation | | | | | |
| Power Panel | | | | | |
| Laser System | x | | | | |

### Controls & Safety
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Rack/IOC | x | | | | |
| PPS Interlock | x | | | | |
| MPS | x | | | | x |
| Area Monitor | x | | | | |
| Timing System | x | | | | x |

### Ops
| Equipment | Power | Cooling | RF | Cryo | Data |
|-----------|:-----:|:-------:|:--:|:----:|:----:|
| Shielding | | | | | |
| Target Handling | x | | | | |
| Beam Dump (facility) | | x | | | |
| Rad Waste Storage | | | | | |
