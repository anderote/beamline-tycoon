# Comprehensive Component Expansion — Design Spec

## Overview

Expand Beamline Cowboy from ~13 simplified components to a comprehensive, physics-accurate accelerator facility simulator. The player builds an electron linac / light source user facility with ~100+ distinct component types across beamline elements and infrastructure. All components have realistic tunable parameters modeled by the Python `beam_physics/` engine. Components are gated behind a 5-tier research tree, progressing from a basic thermionic pulsed linac to a frontier-energy user facility.

### Design Principles

- **Full parameter exposure:** Every component exposes its real physical parameters (gradient, frequency, aperture, field quality, K-value, etc.) and the player can tune them.
- **Tune when beam is off:** Parameters are adjustable only when beam is stopped, creating a natural commissioning cycle.
- **Infrastructure is spatial:** RF stations, cryo plants, vacuum pumps, and cooling systems are placeable grid components with service connections to beamline elements.
- **Physics-driven consequences:** Pushing parameters (high gradient, high current, poor vacuum) has real modeled consequences — higher power draw, faster wear, beam loss, quenches.
- **Research-gated unlocks:** Start with basic components; research unlocks new types and frequency bands over time.
- **Energy range:** keV to 100+ GeV, covering injector through frontier-scale.

---

## 1. Component Catalog — Beamline Components

Components the beam passes through. Each has tunable parameters with realistic ranges.

### 1.1 Electron Sources (Guns)

| Component | Key Parameters | Typical Ranges | Unlocked By |
|-----------|---------------|----------------|-------------|
| Thermionic Gun | voltage (kV), cathode temp (K), current (mA) | 50-150 kV, 0.1-10 mA, emittance ~10 um | Start |
| DC Photocathode Gun | voltage (kV), laser spot size (mm), QE (%), rep rate (MHz) | 100-400 kV, 0.1-5 mA, emittance ~1 um | Research: Photocathodes |
| NC RF Gun | gradient (MV/m), frequency (GHz), phase (deg), solenoid field (T) | 80-120 MV/m at 2.856 GHz, emittance ~0.5 um, high peak current | Research: RF Photoinjectors |
| SRF Gun | gradient (MV/m), frequency (GHz), Q0, CW capable | 20-40 MV/m at 1.3 GHz, emittance ~0.3 um, CW operation | Research: SRF Gun Technology |

Each gun produces a BeamState with energy, current, emittance, bunch length, and energy spread determined by its parameters. Higher voltage = higher energy but more power draw. Smaller laser spot = lower emittance but lower charge.

### 1.2 Drift / Beam Pipe

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| Drift Tube | length (m), aperture (mm) | 0.5-10 m, 20-50 mm | Start |
| Bellows Section | length (m) | 0.2-0.5 m | Start |

Drift is cheap but beam diverges. Longer drifts need better vacuum. Bellows absorb thermal expansion — required periodically or components degrade faster.

### 1.3 RF Cavities

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| S-band NC Cavity (2.856 GHz) | gradient (MV/m), length (m), power (MW), fill time (us) | 10-25 MV/m, 0.3-3 m, pulsed only | Start |
| Buncher (sub-harmonic) | frequency (MHz), voltage (kV), phase (deg) | 100-500 MHz, 10-200 kV | Research: Bunch Compression |
| Harmonic Linearizer (3.9 GHz) | gradient (MV/m), phase (deg) | 5-15 MV/m, corrects RF curvature | Research: Bunch Compression |
| L-band SRF Cavity (1.3 GHz) | gradient (MV/m), Q0, cavity count, cryo load (W) | 15-35 MV/m, Q0 1e10, CW capable | Research: SRF Technology |
| C-band NC Cavity (5.7 GHz) | gradient (MV/m), length (m), power (MW) | 30-50 MV/m, compact | Research: High Gradient RF |
| X-band NC Cavity (9.3 GHz) | gradient (MV/m), length (m), power (MW) | 50-100 MV/m, very compact, high power | Research: High Gradient RF |
| 650 MHz SRF Cavity | gradient (MV/m), Q0, cryo load (W) | 15-25 MV/m, high current capability | Research: CW Linac Design |

Higher gradient = more acceleration per meter but more RF power consumed and higher breakdown risk. SRF cavities need cryogenic infrastructure. Each cavity's frequency determines its aperture (lower freq = larger aperture = easier beam transport).

### 1.4 Magnets

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| Solenoid | field (T), length (m), bore (mm) | 0.01-0.5 T, emittance compensation near guns | Start |
| Quadrupole | gradient (T/m), length (m), bore (mm) | 1-100 T/m, 0.1-1 m | Start |
| Dipole (H-type) | field (T), bend angle (deg), gap (mm) | 0.1-2 T, 1-90 deg | Start |
| Corrector (H/V) | field (mT), length (m) | +/-10 mT, small orbit kicks | Start |
| Sextupole | strength (T/m^2), length (m) | 10-500 T/m^2, chromatic correction | Research: Beam Optics |
| Octupole | strength (T/m^3), length (m) | Landau damping, amplitude-dependent tune | Research: Advanced Optics |
| SC Quad | gradient (T/m), length (m), cryo load (W) | 100-300 T/m, stronger focusing | Research: SC Magnets |
| SC Dipole | field (T), bend angle (deg), cryo load (W) | 2-8 T, tighter bends at high energy | Research: SC Magnets |
| Combined Function Magnet | dipole field (T) + quad gradient (T/m) | Space-efficient, less flexible | Research: Lattice Design |

All magnets consume cooling water (NC) or cryo (SC). Higher fields = more infrastructure demand.

### 1.5 Diagnostics

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| BPM (Beam Position Monitor) | resolution (um) | 1-100 um, passive | Start |
| Screen/YAG | insertable, resolution (um) | Destructive — intercepts beam | Start |
| ICT/Toroid (Current Monitor) | resolution (uA) | Non-destructive current measurement | Start |
| Wire Scanner | wire diameter (um), scan speed | Emittance measurement, semi-destructive | Research: Beam Diagnostics |
| Bunch Length Monitor | resolution (ps) | Streak camera or RF deflector based | Research: Beam Diagnostics |
| Energy Spectrometer | dipole + screen combo, resolution (%) | Measures energy and energy spread | Research: Beam Diagnostics |
| Beam Loss Monitor | sensitivity, coverage length | Detects lost particles, triggers interlocks | Research: Machine Protection |
| Synchrotron Light Monitor | passive, uses SR from dipoles | Non-destructive profile measurement | Research: Synchrotron Light |

Without diagnostics, the player sees "???" for beam properties. Diagnostics "measure" quantities from BeamState with resolution-dependent noise. Incentivizes placement and upgrading.

### 1.6 Insertion Devices (Photon Production)

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| Planar Undulator | period (mm), K-value, num periods, gap (mm) | 15-80 mm period, K 0.5-3, tunable gap | Research: Synchrotron Light |
| Helical Undulator | period (mm), K-value, polarization | Circularly polarized light | Research: Advanced Undulators |
| Wiggler | period (mm), K-value (K >> 1), field (T) | Broadband high-flux, K > 5 | Research: Synchrotron Light |
| APPLE-II Undulator | period (mm), K-value, polarization mode | Variable polarization | Research: Advanced Undulators |

Undulators/wigglers produce photon beams for user facility clients. Higher K = more flux but more energy loss and heat load.

### 1.7 Beam Manipulation

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| Collimator | aperture (mm), material, length (m) | 1-25 mm, cleans beam halo | Research: Beam Optics |
| Beam Dump | power rating (kW), material | Absorbs full beam, required endpoint | Start |
| Kicker Magnet | field (mT), rise time (ns) | Fast beam switching | Research: Fast Kickers |
| Septum Magnet | field (T), thin wall thickness (mm) | Beam extraction/splitting | Research: Beam Distribution |
| Chicane (4-dipole) | R56 (mm), bend angle (deg) | Bunch compression via path length | Research: Bunch Compression |
| Dog-leg (2-dipole) | offset (m), bend angle (deg) | Parallel beam offset | Research: Beam Transport |
| Velocity Selector | crossed E and B fields, passband (%) | Selects particles by velocity | Research: Beam Optics |
| Stripper Foil | material, thickness (ug/cm^2) | Charge state selection (future: ions) | Research: Ion Sources |

### 1.8 Targets & Endpoints

| Component | Key Parameters | Ranges | Unlocked By |
|-----------|---------------|--------|-------------|
| Beam Dump (simple) | power rating (kW) | Stops beam safely | Start |
| Fixed Target (Be, Cu) | material, thickness, collision rate | Nuclear/particle physics | Research: Target Physics |
| Fixed Target (W, LH2) | material, thickness, collision rate | Higher-Z targets | Research: Target Physics (Advanced) |
| Photon Beamline Port | acceptance angle (mrad), monochromator | Delivers photons to users | Research: Synchrotron Light |
| Positron Target | material (W), thickness, capture solenoid | Pair production | Research: Antimatter |
| Compton Backscatter IP | laser wavelength, crossing angle | Polarimetry or gamma production | Research: Photon Science |

---

## 2. Component Catalog — Infrastructure Components

Placeable on grid. Provide resources that beamline components consume.

### 2.1 RF Power

| Component | Key Parameters | Provides | Unlocked By |
|-----------|---------------|----------|-------------|
| Solid-State Amplifier | frequency (GHz), power (kW) | 1-50 kW CW, low maintenance | Start |
| Pulsed Klystron | frequency (GHz), peak power (MW), rep rate (Hz), pulse length (us) | 5-65 MW peak, pulsed only | Start |
| CW Klystron | frequency (GHz), power (kW), efficiency (%) | 50-500 kW CW | Research: CW RF Systems |
| Modulator | voltage (kV), pulse rate (Hz) | Drives pulsed klystrons, 1 per klystron | Start |
| IOT (Inductive Output Tube) | frequency (MHz), power (kW) | 50-100 kW, 500 MHz, high efficiency | Research: CW RF Systems |
| Circulator / Load | power rating (kW) | Protects RF source from reflected power | Start |
| Waveguide Run | length (m), loss (dB/m) | Connects RF source to cavity | Start |
| High-Power Coupler | power rating (kW), coupling (Qext) | Feeds power into cavity, 1 per cavity | Start |
| LLRF Controller | channels, bandwidth (MHz) | Regulates amplitude/phase | Research: Digital LLRF |
| Multi-beam Klystron | frequency (GHz), power (MW), efficiency (%) | Higher efficiency | Research: Advanced RF |
| High-Power SS Transmitter | frequency (GHz), power (kW), modular | 100-300 kW, graceful degradation | Research: Advanced RF |

### 2.2 Cryogenics

| Component | Key Parameters | Provides | Unlocked By |
|-----------|---------------|----------|-------------|
| Helium Compressor | capacity (g/s), power draw (kW) | Feeds the cold box | Research: SRF Technology |
| 4K Cold Box | cooling capacity (W at 4K), He flow (g/s) | Cools SRF cavities to 4.2 K | Research: SRF Technology |
| 2K Cold Box | cooling capacity (W at 2K), He flow (g/s) | Sub-atmospheric He, higher Q0 | Research: High-Q SRF |
| Cryomodule Housing | cavity count, length (m), static/dynamic heat loads | Houses SRF cavities | Research: SRF Technology |
| Transfer Line | length (m), heat leak (W/m) | Connects cryo plant to cryomodules | Research: SRF Technology |
| LN2 Pre-cooler | capacity (L/hr) | Reduces He refrigeration load | Research: SRF Technology |
| Helium Recovery / Storage | tank volume (L), recovery rate (%) | Recaptures boil-off | Research: Cryo Optimization |
| Cryocooler (small) | capacity (W at 4K) | Small-scale cryo for single SC magnets | Research: SC Magnets |

### 2.3 Vacuum

| Component | Key Parameters | Provides | Unlocked By |
|-----------|---------------|----------|-------------|
| Roughing Pump | speed (L/s), base pressure (mbar) | Gets to ~1e-3 mbar | Start |
| Turbo Pump | speed (L/s), base pressure (mbar) | Gets to ~1e-8 mbar | Start |
| Ion Pump | speed (L/s), base pressure (mbar) | 1e-9 to 1e-11 mbar, maintenance-free | Research: UHV Systems |
| NEG Pump | capacity (mbar-L), activation temp (C) | Distributed pumping | Research: UHV Systems |
| Ti Sublimation Pump | speed (L/s), filament lifetime (hrs) | Burst pumping for very low pressure | Research: UHV Systems |
| Vacuum Gauge (Pirani) | range (mbar) | Monitors rough vacuum | Start |
| Vacuum Gauge (Cold Cathode) | range (mbar) | Monitors HV/UHV | Start |
| Vacuum Gauge (BA Gauge) | range (mbar) | Precision UHV measurement | Research: UHV Systems |
| Gate Valve | aperture (mm), interlock capable | Isolates vacuum sectors | Start |
| Bakeout System | temp (C), zone length (m) | Reduces outgassing 1000x | Research: UHV Systems |

### 2.4 Cooling Water

| Component | Key Parameters | Provides | Unlocked By |
|-----------|---------------|----------|-------------|
| LCW Skid | flow rate (L/min), capacity (kW) | Cools magnets, NC cavities, RF loads | Start |
| Chiller | capacity (kW), supply temp (C) | Provides chilled water | Start |
| Cooling Tower | capacity (kW) | Rejects heat to environment | Start |
| Heat Exchanger | capacity (kW), delta-T (C) | Transfers between loops | Start |
| High-Power Water Load | power rating (kW) | Absorbs reflected RF power | Start |
| Deionizer / Water Treatment | flow rate (L/min), resistivity (MOhm-cm) | Maintains water quality | Research: Facility Systems |
| Emergency Cooling (UPS) | capacity (kW), battery runtime (min) | Prevents thermal damage on outage | Research: Machine Protection |

### 2.5 Controls & Safety

| Component | Key Parameters | Provides | Unlocked By |
|-----------|---------------|----------|-------------|
| Rack / IOC | channel count | EPICS controls for a sector | Start |
| Personnel Protection Interlock | zone coverage | Required — no beam without it | Start |
| Beam Containment Shielding | thickness (cm), material | Required at high energy/power | Start |
| Machine Protection System | response time (us), BLM inputs | Fast beam abort | Research: Machine Protection |
| Radiation Monitor (Area) | sensitivity, alarm setpoints | Monitors dose | Start |
| Timing System | resolution (ps), trigger outputs | Synchronizes RF, kickers, diagnostics | Research: Digital LLRF |
| Laser System (gun drive) | wavelength (nm), rep rate (MHz), pulse energy (uJ) | Required for photocathode guns | Research: Photocathodes |
| Laser Heater | power (kW), undulator periods | Suppresses microbunching | Research: FEL Physics |

### 2.6 Electrical Power

| Component | Key Parameters | Provides | Unlocked By |
|-----------|---------------|----------|-------------|
| Substation / Transformer | capacity (kVA) | Wall-plug power budget for facility. Start: 500 kVA. Upgrades: 2 MVA, 10 MVA, 50 MVA. | Start (small), upgradeable |
| Power Distribution Panel | circuits, capacity (A) | Routes power to equipment sectors | Start |

### 2.7 Infrastructure Connection Model

Infrastructure components serve beamline components via **adjacency and sector assignment**, not abstract pools:

- **RF sources** must be connected to cavities via waveguide runs. One RF source can feed 1 cavity (or multiple via power splitters at reduced power). Waveguide must be placed as grid cells between source and cavity.
- **Vacuum pumps** serve the beamline segment they are adjacent to. Effective pumping speed drops with distance (conductance-limited). Gate valves define sector boundaries.
- **Cooling water** skids serve components within a configurable plumbing radius (default: 10 grid cells). Components outside range of any skid overheat.
- **Cryogenics** plant connects to cryomodules via transfer lines (placed on grid). Each transfer line segment adds heat leak. Cryo plant capacity is shared across all connected cryomodules.
- **Electrical power** panels serve components within a wiring radius (default: 15 grid cells). Total draw on a panel cannot exceed its capacity.

---

## 3. Physics System Expansion

### 3.1 RF Power Physics

The chain: wall plug -> modulator -> klystron/SSA -> waveguide -> coupler -> cavity. Every link has real losses.

**Cavity RF power demand:**
```
P_cavity = V_acc^2 / (R_over_Q * Q_L)           # fundamental power demand
P_beam = I_beam * V_acc * cos(phi)               # beam loading
P_reflected = |P_forward - P_cavity - P_beam|^2  # impedance mismatch
P_forward = P_cavity + P_beam + P_reflected      # total from source
```

Where:
- `V_acc = E_acc * L_active` — accelerating voltage from gradient x active length
- `R/Q` — geometry factor, fixed per cavity design (~1000 Ohm for 1.3 GHz elliptical, ~100 Ohm for 650 MHz)
- `Q_L` — loaded Q, set by coupler. Player tunes Q_ext to match beam loading.
- `phi` — RF phase relative to crest. Off-crest costs more power.
- Waveguide attenuation: `P_delivered = P_source * 10^(-alpha*L/10)`

**Klystron/SSA model:**
- `P_out = eta * P_wall` where eta is efficiency (45-65% klystrons, 30-40% SSAs)
- `P_wall` draws from facility electrical budget
- Pulsed: `P_avg = P_peak * duty_factor` where `duty_factor = pulse_length * rep_rate`
- Tube lifetime tracking: degrades efficiency over time, eventually fails

New module: `beam_physics/rf_system.py`

### 3.2 Cryogenic Physics

**Cavity dynamic heat load:**
```
P_dynamic = V_acc^2 / (R_over_Q * Q0)
```

Q0 depends on temperature (4.2K vs 2.0K), surface prep, and gradient:
```
Q0(E) = Q0_peak * exp(-E / E_ref)
```

**Static heat loads:** 1-5 W at 4K per cryomodule, 0.5-2 W at 2K. Transfer lines ~1 W/m.

**Cryo plant capacity (Carnot):**
- `COP_ideal = T_cold / (T_hot - T_cold)`
- `COP_real = COP_ideal / eta_carnot` where eta_carnot ~ 0.2-0.3
- 1W at 2K ~ 750W wall-plug; 1W at 4K ~ 250W wall-plug
- Total load = sum of all dynamic + static loads + transfer line losses

Quench model: cavity goes normal-conducting if field exceeds limit or cryo capacity exceeded. Dumps stored energy into helium, pressure spike, safety valve, trip.

New module: `beam_physics/cryo_system.py`

### 3.3 Vacuum Physics

**Pressure profile (1D molecular flow) per segment between pumps:**
```
Q_total = Q_thermal + Q_beam + Q_photon          # gas load (mbar-L/s)
Q_thermal = q * A_surface                         # q depends on material + bakeout
Q_beam = sigma_ion * I_beam * n_gas * L           # beam-induced ionization
Q_photon = eta_psd * Gamma_photon                 # photon-stimulated desorption

P_avg = Q_total / S_eff
S_eff = S_pump * C / (S_pump + C)                # effective speed
C = 12.1 * d^3 / L                               # molecular flow conductance (L/s)
```

Outgassing rates:
- Unbaked stainless: q ~ 1e-8 mbar-L/s/cm^2
- Baked stainless: q ~ 1e-11 mbar-L/s/cm^2
- NEG-coated: q ~ 1e-12 mbar-L/s/cm^2

**Beam lifetime from vacuum:**
```
tau_vacuum = 1 / (sigma_total * n_gas * c)
loss_rate = I_beam * (1 - exp(-L / (c * tau_vacuum)))
```

New module: `beam_physics/vacuum_system.py`

### 3.4 Cooling Water Physics

**Heat loads per component:**
```
NC magnet:    P = I^2 * R
NC cavity:    P = P_forward - P_beam
Klystron:     P = P_wall * (1 - eta)
RF load:      P = P_reflected
Beam dump:    P = I_beam * E_beam
```

**Cooling capacity:** `Q = m_dot * c_p * delta_T` (kW from flow rate and temp rise)

Each LCW skid serves components within a plumbing radius. Chiller removes heat from LCW loop. Cooling tower rejects to atmosphere.

New module: `beam_physics/cooling_system.py`

### 3.5 Beam Physics Expansion

**Solenoid transfer matrix (new):**
Couples x and y planes via full 4x4 transverse matrix. Focusing strength: `k = eB/(2p)`. Larmor rotation mixes x-y. Critical for emittance compensation near guns.

**Buncher/chicane longitudinal physics (new):**
```
Buncher chirp:  dE/E = eV/E * sin(omega*t + phi)
Chicane:        sigma_z_final = |1 + h*R56| * sigma_z_initial
                R56 = -2*theta^2 * L_drift / cos^3(theta)
```

**CSR model (new, in chicane dipoles):**
```
dE_CSR = -(N*r_e / (3^(1/3) * R^(2/3))) * dI/ds
Emittance growth: d_eps_x ~ (R56 * sigma_delta_CSR)^2 / beta_x
```

**FEL gain (new):**
```
rho_FEL = (1/(2*gamma)) * (I_peak * K^2 * lambda_u / (4*I_A*sigma_x^2))^(1/3)
L_gain = lambda_u / (4*pi*sqrt(3)*rho)
P_sat = rho * E_beam * I_peak
Condition: L_undulator > ~20 * L_gain for saturation
```

FEL performance depends on entire upstream chain: gun brightness -> emittance preservation -> bunch compression -> undulator matching.

**Diagnostic measurement model (new):**
Each diagnostic "measures" a BeamState quantity with resolution-dependent Gaussian noise. Without diagnostics, player sees "???" for those properties.

New/expanded modules: `beam_physics/elements.py` (solenoid matrix), `beam_physics/radiation.py` (CSR, FEL), `beam_physics/diagnostics.py` (new)

### 3.6 Wear & Degradation Physics

Every component has:
- **Health (0-100%):** Ticks down based on operating stress
- **Wear rate factors:** gradient/field (exponential), current (linear), vacuum quality (threshold), temperature margin
- **Failure model:** At ~20% health, random failures begin (probability increases as health drops). At 0%, component is offline.
- **Consumables:** Klystron tubes (~40,000 hr lifetime), cathodes (QE degrades), getter pumps (saturate), filaments (burn out)
- **Maintenance:** Take offline to repair. Cost = f(damage). Time = f(component complexity). Technicians reduce time.

New module: `beam_physics/wear.py`

### 3.7 Physics Module Architecture

```
beam_physics/
  constants.py          # physical constants, particle masses
  beam.py               # BeamState (6D sigma matrix)
  elements.py           # transfer matrices (add solenoid, chicane)
  radiation.py          # synchrotron radiation, CSR, FEL gain
  lattice.py            # beam propagation through element list
  rf_system.py          # NEW: RF power chain calculations
  cryo_system.py        # NEW: cryogenic heat load and capacity
  vacuum_system.py      # NEW: pressure profile, beam-gas scattering
  cooling_system.py     # NEW: thermal budgets, water flow
  wear.py               # NEW: component degradation, failure model
  diagnostics.py        # NEW: measurement models with resolution/noise
  gameplay.py           # bridge: game state <-> physics (expanded)
```

Each infrastructure system computed per game tick. `gameplay.py` aggregates into a single result:
- Can beam run? (interlocks, RF, cryo, vacuum all OK)
- Beam quality (full propagation with current conditions)
- What's failing? (over-capacity systems, worn components, pressure excursions)
- What does the player see? (diagnostic readbacks with resolution)

---

## 4. Tiered Research Progression

### Tier 0 — Starter Kit (Unlocked at Start)

**Beamline:** Thermionic gun, drift tube, bellows, S-band NC cavity, solenoid, quadrupole, dipole, corrector, BPM, screen/YAG, ICT, beam dump

**Infrastructure:** Solid-state amplifier, pulsed klystron + modulator, circulator/load, waveguide, coupler, roughing pump, turbo pump, Pirani gauge, cold cathode gauge, gate valve, LCW skid, chiller, cooling tower, heat exchanger, water load, rack/IOC, PPS interlock, shielding, area radiation monitor, substation, power distribution panel

Enough to build a short pulsed linac, accelerate to ~50-100 MeV, dump beam, measure basic properties.

### Tier 1 — Beam Science Basics

| Research | Cost | Duration | Unlocks | Requires |
|----------|------|----------|---------|----------|
| Beam Optics | 10 data, $500 | 30s | Collimator, sextupole, velocity selector | — |
| Beam Diagnostics | 10 data, $500 | 30s | Wire scanner, bunch length monitor, energy spectrometer | — |
| Bunch Compression | 15 data, $1K | 45s | Buncher, chicane, dog-leg, harmonic linearizer | Beam Optics |
| Target Physics | 15 data, $1K | 45s | Fixed target (Be, Cu) | — |
| Machine Protection | 15 data, $1K | 40s | MPS, BLM, emergency cooling | Beam Diagnostics |

### Tier 2 — CW & Photon Capability

| Research | Cost | Duration | Unlocks | Requires |
|----------|------|----------|---------|----------|
| Photocathodes | 25 data, $3K | 60s | DC photocathode gun, laser system | Beam Diagnostics |
| CW RF Systems | 25 data, $3K | 60s | CW klystron, IOT | Bunch Compression |
| Synchrotron Light | 30 data, $5K | 70s | Planar undulator, wiggler, SR light monitor, photon beamline port | Beam Optics |
| UHV Systems | 20 data, $2K | 50s | Ion pump, NEG pump, TSP, BA gauge, bakeout | — |
| Facility Systems | 15 data, $2K | 40s | Deionizer/water treatment | — |
| Digital LLRF | 25 data, $3K | 50s | LLRF controller, timing system | CW RF Systems |

### Tier 3 — SRF & Advanced Magnets

| Research | Cost | Duration | Unlocks | Requires |
|----------|------|----------|---------|----------|
| SRF Technology | 50 data, $10K, 5 rep | 90s | L-band SRF cavity, cryomodule, He compressor, 4K cold box, transfer line, LN2 pre-cooler | CW RF Systems |
| SC Magnets | 40 data, $8K, 5 rep | 80s | SC quad, SC dipole, cryocooler | Beam Optics |
| RF Photoinjectors | 40 data, $8K | 70s | NC RF gun | Photocathodes + Digital LLRF |
| Beam Transport | 30 data, $5K | 60s | Septum magnet | Beam Optics |
| Lattice Design | 35 data, $6K | 65s | Combined function magnet | SC Magnets |

### Tier 4 — High Performance

| Research | Cost | Duration | Unlocks | Requires |
|----------|------|----------|---------|----------|
| High-Q SRF | 60 data, $15K, 10 rep | 100s | 2K cold box, He recovery/storage | SRF Technology |
| High Gradient RF | 50 data, $12K | 90s | C-band cavity, X-band cavity | RF Photoinjectors |
| Advanced RF | 50 data, $12K | 90s | Multi-beam klystron, high-power SS transmitter | CW RF Systems + Digital LLRF |
| CW Linac Design | 60 data, $15K, 10 rep | 100s | 650 MHz SRF cavity | SRF Technology + High-Q SRF |
| Fast Kickers | 40 data, $8K | 70s | Kicker magnet | Beam Transport |
| Advanced Optics | 40 data, $8K | 70s | Octupole | Lattice Design |
| Advanced Undulators | 50 data, $12K | 90s | Helical undulator, APPLE-II | Synchrotron Light |
| FEL Physics | 60 data, $15K, 10 rep | 100s | Laser heater | Advanced Undulators + Bunch Compression |

### Tier 5 — Frontier

| Research | Cost | Duration | Unlocks | Requires |
|----------|------|----------|---------|----------|
| SRF Gun Technology | 80 data, $25K, 15 rep | 120s | SRF gun | SRF Technology + RF Photoinjectors |
| Cryo Optimization | 60 data, $15K | 100s | Improved He recovery, reduced static loads | High-Q SRF |
| Antimatter | 100 data, $50K, 20 rep | 150s | Positron target, capture solenoid | High Gradient RF + Target Physics |
| Photon Science | 80 data, $25K, 15 rep | 120s | Compton backscatter IP | FEL Physics |
| Target Physics (Advanced) | 60 data, $15K, 10 rep | 100s | Fixed target (W, LH2) | Target Physics + Machine Protection |

---

## 5. Game Economy

### 5.1 Resources

| Resource | Symbol | Purpose |
|----------|--------|---------|
| Funding ($) | $ | Build and operate everything |
| Electrical Power (kW) | lightning | Wall-plug budget. Hard cap, upgrade via substations. |
| Research Data | D | Generated by diagnostics + detectors. Spent on research. |
| Reputation | R | Academic prestige. Unlocks higher-tier research, attracts funding. |
| User Beam Hours | U | Generated when photon ports operational + beam on. Converts to $ + R. |

### 5.2 Operating Costs

Per tick while beam is on:
```
Total power draw = sum(klystron P_wall) + sum(cryo compressor P_wall)
                 + sum(pump power) + sum(magnet power) + sum(cooling power)
Funding drain = electricity_rate * total_power + staffing + consumables_amortization
```

### 5.3 Staffing (Facility Upgrades, not grid-placed)

| Staff Type | Effect | Cost |
|------------|--------|------|
| Operators | Required to run beam. 1 per N components. | Salary/tick |
| Technicians | Auto-repair worn components. More = faster. | Salary/tick |
| Scientists | Increase research speed. | Salary/tick |
| Engineers | Reduce construction cost (diminishing returns). | Salary/tick |

### 5.4 Revenue Streams

| Source | Trigger | Payout |
|--------|---------|--------|
| Startup Grant | Game start | One-time $500 |
| Operating Grant | Per-tick, scales with reputation | Passive $ |
| User Fees | Per beam-hour at photon/experiment ports | Steady $ + reputation |
| Discovery Bonus | Particle discovery event | Large one-time $ + reputation |
| Milestone Grants | Completing objectives | One-time $ + reputation |
| Equipment Grants | Reputation thresholds | One-time large $ for construction |
| Industry Contracts | High reputation, specific beam specs | High $ if specs maintained |

### 5.5 Failure & Recovery

- **Beam trip:** Component failure / vacuum excursion / RF fault auto-shuts beam. Diagnose and fix.
- **Quench:** SRF cavity normal-conducting transition. Cryo recovery time. Possible damage (wear jump).
- **Vacuum leak:** Pressure spike, gate valves auto-close. Find and fix.
- **Budget crisis:** Operating costs exceed revenue too long -> warning -> forced staff cuts -> accelerated degradation.

---

## 6. Objectives

### Tier 0 — Getting Started
- First Beam: Turn on beam with a source -> $500, +1 rep
- First Measurement: Place BPM and measure beam position -> $300, +1 rep
- Stable Beam: Run beam 60 continuous seconds -> $500, +1 rep

### Tier 1 — Basic Competence
- 100 MeV: Reach 100 MeV -> $1K, +2 rep
- Beam Characterization: Measure emittance, energy, current -> $500, +2 rep
- First User: Build photon port and deliver beam hours -> $2K, +3 rep
- Good Vacuum: Achieve <1e-8 mbar average -> $500, +1 rep

### Tier 2 — Real Facility
- 1 GeV: Reach 1 GeV -> $5K, +5 rep
- CW Operation: Run CW beam 300 seconds -> $3K, +3 rep
- Sub-micron Emittance: <1 um normalized at >100 MeV -> $3K, +5 rep
- 5 Users: Serve 5 simultaneous photon ports -> $10K, +10 rep
- First Target: Run beam on fixed target -> $3K, +5 rep

### Tier 3 — World Class
- 10 GeV: Reach 10 GeV -> $20K, +10 rep
- SRF Linac: Operate 10+ SRF cavities -> $10K, +5 rep
- Bunch Compression: Achieve <100 fs bunch length -> $5K, +10 rep
- FEL Saturation: Achieve FEL saturation -> $50K, +20 rep
- High Availability: 95% uptime over 1000 ticks -> $10K, +10 rep

### Tier 4 — Frontier
- 100 GeV: Reach 100 GeV -> $100K, +30 rep
- Particle Discovery: Observe new particle -> $200K, +50 rep
- Positron Beam: Generate and accelerate positrons -> $50K, +30 rep
- 10 Publications: Accumulate research milestones -> +20 rep
- National Lab Status: Reach 100 reputation -> $500K

### Tier 5 — Legacy
- Nobel Prize: Discover fundamental particle at frontier energy -> $1M, +100 rep
- User Facility of the Year: Deliver 10,000 beam hours -> $200K, +50 rep
- Full Catalog: Build every component type -> $100K, +30 rep
