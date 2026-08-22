# Wiki Audit — 2026-08-11

Audit of the 25 player-facing wiki articles (plus both README indexes) against
what the code actually does after the utility-driven beam physics rework.

Ground truth: `docs/superpowers/specs/2026-08-11-utility-driven-beam-physics-design.md`,
verified against source in every case. Nothing below was taken from the spec
alone.

**Files changed:** 27 of 28. `docs/physics-wiki/fundamentals.md` needed no
correction — it is pure beam physics with no game-mechanics claims.

---

## A. The three claims called out as flatly wrong

### A1. Multiplicative quality stacking onto gradient

- **File:** `infra-wiki/infrastructure-quality.md`
- **Old:** *"Effects stack multiplicatively across network types. An RF cavity on a power network at 90% and an RF network at 85% operates at 0.9 x 0.85 = 76.5% gradient."*
- **New:** Each utility acts through the physical quantity it controls. RF supplies **watts of peak power**, cryo supplies a **bath temperature**, cooling supplies a **temperature rise**, vacuum supplies a **pressure**; only power remains a linear scalar, and it acts on magnet focus strength, not on gradient.
- **Source:** `beam_physics/gameplay.py` — the `modelled` branch computes `achievable = srf.e_acc_max(power_per_cavity, cav_spec, cryo_temp_k)` and `energyGain = achieved * length / 1000`. The legacy `energyGain *= power_q * rf_q * cooling_q * cryo_q` product survives only in the `else` branch, for unmodelled cavities and nodes the solver produced no power data for. `focusStrength *= power_q` is unchanged and, per `srf.py`'s and the spec's reasoning (`k ~ I ~ P`), correct.

### A2. "Cryo: below 50% capacity, SRF quenches"

- **File:** `infra-wiki/infrastructure-quality.md` (also `cryogenics.md`)
- **Old:** *"SRF cavities derate; below 50% capacity, SRF quenches (hard shutdown)."*
- **New:** The bath holds a **design temperature** — 2.0 K with a `coldBox2K` on the network, else 4.5 K — and **warms** when load exceeds capacity. Warming accelerates because Q0 collapses. Quench is at **Tc = 9.25 K**, or independently when LHe drops below 20 L.
- **Source:** `src/utility/types/cryoTransfer.js` — `T_SUPERFLUID = 2.0`, `T_NORMAL = 4.5`, `PLANT_DESIGN_TEMP`, `designTemp()`, `THERMAL_MASS = 20000`, and the thermal step `tempK = prevTemp + (loadNow - capNow) / THERMAL_MASS` clamped to `[designTempK, T_CRITICAL]`. `T_CRITICAL = 9.25` in `beam_physics/srf.py` and its JS mirror `src/beamline/cavity-specs.js`. There is no 50%-capacity branch anywhere; the module's own header explains why a solved equilibrium temperature is not physical here.

### A3. "Vacuum: beam scattering losses increase (reduced effective aperture)"

- **File:** `infra-wiki/infrastructure-quality.md` (also `vacuum.md`, `tier1-physics.md`)
- **Old:** vacuum acts by narrowing the effective aperture.
- **New:** The aperture proxy is deleted. Vacuum reaches the beam through multiple Coulomb scattering (emittance growth) and beam-gas loss (current removal).
- **Source:** `beam_physics/modules/beam_gas.py`; `beam_physics/gameplay.py` now only stamps `el["pressure"] = infra_q["vacuumPressure"]`, with an explicit comment that the `aperture *= (0.5 + 0.5 * vac_q)` proxy was removed because `aperture_loss` only scales `beam.current` while `beam_quality` is an emittance ratio (`beam_physics/lattice.py`, `beam_quality = initial_eps / final_eps`).

---

## B. RF

| Claim | Old | New | Source |
|---|---|---|---|
| Gradient vs power | Linear derate by an `rfQuality` scalar; article's own math said `gradient_rated * sqrt(P_avail/P_req)` | `E_acc = sqrt(P (R/Q) Q0)/L` (SRF) or `sqrt(P r_shunt / L)` (NC), per cavity | `beam_physics/srf.py` `e_acc_max()` |
| Duty factor | Not mentioned | RF sources carry `dutyFactor`; peak power = average / duty, capacity-weighted mean across the network, clamped at 10000x. Pulsed klystron 50 kW at 0.1% = 50 MW peak | `src/utility/types/rfWaveguide.js` (`meanDuty`, `peakFactor`); `src/data/utility-ports-v2.js` `INFRA_UTILITY_PORTS` rf entries |
| Power sharing | Not described | Sinks in a bucket share capacity **in proportion to declared demand** | `rfWaveguide.js` `distributePower()` |
| Insufficient power | *"Beam runs only if `P_forward_available >= P_forward_required`"* | Soft `rf_overload`; the cavity derates, the beam runs | `rfWaveguide.js` — `severity: 'soft'` |
| Modulators | *"Without a modulator in the same RF network, a pulsed klystron contributes zero power. Always pair them."* | No modulator check exists anywhere. Documented as inert. | `rfWaveguide.js` has no modulator logic; `modulator` declares only `pwr_in` |
| Circulators | *"Missing circulators increase wear on your RF sources."* | Wear depends only on `energyCost` and whether an MPS exists. Documented as inert. | `src/game/Game.js` `_applyWearForBeamline()` |
| Reflected power | Flat 2% guess | Driven by real thermal detuning of the worst cavity, floored at 2% | `beam_physics/srf.py` `detune_coupling()`; `src/game/economy.js` `worstReflectedFraction()` |
| VSWR at 2% | *"VSWR ~ 1.30"* | 1.33 (`(1+sqrt(0.02))/(1-sqrt(0.02))`) | `economy.js` vswr computation |
| Source table | Missing TWT and Gyrotron in `connection-types.md`; "Klystron" not a real id | Full nine-source table with duty factors and peak power | `src/data/infrastructure.raw.js`, `utility-ports-v2.js` |

---

## C. Cryogenics

| Claim | Old | New | Source |
|---|---|---|---|
| Compressor requirement | Cold box acted as a complete plant by itself | Central plants require connected storage, chilling, and live heat rejection. The compressor provides heat rejection only while powered and cooling-water-fed. | `cryoTransfer.js` `cryoPlantCapabilities()` |
| Cryocooler as a source | Declared no cryo source port and contributed zero capacity | Powered integrated starter plant: 90 W chilling/rejection and sealed 50 L inventory | `getUtilityPortsV2('cryocooler')`; `cryoPlantCapabilities()` |
| Reservoir | Every network received an implicit fixed 500 L | Capacity is summed from connected `storageCapacityL` ports: 2,000 L central storage or 50 L integrated Cryocooler | `cryoInventoryForNetwork()`; `boundCryoPersistentState()` |
| Recovery | Facility-wide by placed type, even unwired/unpowered | Network-local through real cryo ports; powered stages require live feeds | `networkHeRecovery()` |
| Heat load | Static only | Static (declared `srfHeatW`) **plus** dynamic wall dissipation computed from last tick's achieved gradient at the current bath temperature | `cryoTransfer.js` `dynamicLoadAt()`, `collectCavities()`; write-back in `Game.js` `_writeBackCavityResults()` |
| Plant capacity | Fixed rating | `min(rated x (T/T_design)^1.3, rated x 3)` — a plant run warmer delivers more | `cryoTransfer.js` `capacityAt()`, `COLD_CAPACITY_EXPONENT = 1.3` |
| Consumers list | Included Tesla 9-cell, SC Quad, SC Dipole, SRF Gun | Half-Wave Resonator, Spoke Cavity, 9-cell Elliptical SRF, TESLA Cryomodule — the only four that exist | `src/data/beamline-components.raw.js`, `utility-ports-v2.js` |
| Quench recovery | Not described | Quench does not latch: a quenched cavity drops its RF and contributes no dynamic load, so the plant can pull the bath back down | `cryoTransfer.js` `wasQuenched` / `liveCavities` |
| Q0 / gradient math | Absent | Full BCS table added, calibrated against TESLA 9-cell, with per-component `f`, `R/Q`, `G`, `L_act`, `n_cav` | `beam_physics/srf.py` `CAVITY_SPECS`, `r_bcs()`, `q0()` |

Correct and retained: 4K cold box 500 W / $8M, 2K cold box 800 W / $15M, boil-off 0.0005 L/W/tick, 20 L quench threshold, $50/L, Carnot 250 vs 750 W/W.

---

## D. Vacuum

| Claim | Old | New | Source |
|---|---|---|---|
| Network model | *"Conductance-based (pump speed degraded by pipe length)"*, with a fixed `C_tile = 50 L/s` | Dynamic gas inventory and staged pumping, with circular-tube molecular conductance and `S_eff = SC/(S+C)` | `src/utility/types/vacuumPipe.js` — `molecularConductanceLps()`, `activePumpStack()` |
| Gas load | *"proportional to beamline volume"*, `Q_gas = V_beamline * q_outgassing` | Proportional to **surface area**. 3,770 cm^2 per metre at r = 0.06 m; 3.77e-7 mbar·L/s per metre unbaked | `src/data/utility-ports-v2.js` `pipeSurfaceAreaCm2()`, `outgassingForLength()`, `Q_SPECIFIC_UNBAKED = 1e-10` |
| Beam pipe cost | Zero — the article never charged for pipe | Every metre of pipe is charged to the pumps serving the components on it | `vacuumPipe.js` `beamPipeOutgassing()` |
| Bakeout | *"improve ultimate vacuum after any vacuum break"* (no mechanic) | Connected Bakeout System applies the implemented 100x outgassing reduction | `vacuumPipe.js` `BAKEOUT_FACTOR`, `isBaked()`; `utility-ports-v2.js` `bakeoutSystem.vac_out` |
| Consumers | *"Global beamline vacuum (not per-component)"* | Per-sink pressure published to every component | `vacuumPipe.js` `perSinkPressure` |
| Quality mapping | Prose table only | Log-linear 1e-8 → 1, 1e-2 → 0; unpumped reported as 1013 mbar for the beam-gas module | `vacuumPipe.js` `qualityFromPressure()`, `reportedPressure` |
| Panel pressure | *"Average pressure across the whole beamline"* | **Worst** network in the facility, and it is the same number the beam responds to (the old `1e-6/(S/V)` HUD formula is gone) | `src/game/economy.js` `worstVacuumPressure()` |
| Pump colour | Gray 0x999999 | 0x888888 | `vacuumPipe.js` `color` |

Correct and retained: all five pump speeds and costs.

---

## E. Cooling

| Claim | Old | New | Source |
|---|---|---|---|
| Evaporation rate | 0.001 L per kW per tick | **0.02** | `src/utility/types/coolingWater.js` `EVAP_PER_KW_PER_TICK = 0.02` |
| Refill cost | $10/L | **$12/L** | `coolingWater.js` `WATER_COST_PER_L = 12` |
| Hard gate | *"`Q_network > C_network` in any cooling network blocks beam operation."* | Soft. Hard gates are an unwired cooling sink or a dry reservoir. | `coolingWater.js` — only `cooling_dry` is `severity: 'hard'`; `cooling_starved` is soft; over-subscription raises nothing |
| Undercooling effect | *"RF gradient reduced, slight emittance growth from thermal effects"* | Temperature rise of up to 40 K at the sink, which **detunes NC cavities off resonance** (Lorentzian) and reflects power. SRF has no water loop. | `coolingWater.js` `MAX_DELTA_T = 40`, `perSinkDeltaT`; `beam_physics/srf.py` `detune_coupling()`; `gameplay.py` applies coupling only when `not is_srf` |
| Deionizer | *"improves long-term reliability (reduces wear on cooled components)"* | Inert — wear does not consult it | `Game.js` `_applyWearForBeamline()` |
| Electron gun heat | Absent from the load table | 30 kW | `utility-ports-v2.js` `source.cool_in` |

Correct and retained: LCW 100 kW / $600k, chiller 300 kW / $1.2M, tower 800 kW / $2M, and every component heat load listed.

---

## F. Power

Almost entirely correct. Changes:

- Hard gate wording: an **unwired** power sink is also a hard blocker, not just a network with zero capacity. Source: `src/game/utility-gate.js` `HARD_REQUIRED_UTILS` + `findUnconnectedSinks`.
- Added that the linear derate applies to **magnet focus strength** and is the physically correct exponent, and that power no longer multiplies into cavity gradient. Source: `beam_physics/gameplay.py`, `focusStrength *= power_q`.
- Demand tier table corrected against declared ports (SRF cavities are 8/10/12 kW, not "8-15"; added velocity selector 15, collision point 20, pepper-pot 2).
- Added that facility equipment power demand is derived from its own `energyCost`. Source: `utility-ports-v2.js` `buildInfraSinkPorts()`.
- Historical values at the time of this audit: panel 40/$60k, UPS 100/$500k, pad-mount 150/$200k, MCC 250/$300k, switchgear 400/$400k, HV 1200/$800k. The live power model now separates four HV supply tiers from downstream switchgear/panel distribution; see `power.md`.

---

## G. Networks, gating, and topology

| Claim | Old | New | Source |
|---|---|---|---|
| Network formation | *"flood-fill through adjacent tiles of the same type"*, cardinal directions only | **Union-find over named ports** joined by drawn lines. Membership is per-port, not per-tile or per-component. | `src/utility/network-discovery.js` — DSU over `${placeableId}:${portName}` |
| Distribution buses | Not mentioned | Five legacy utility buses retain service radii (fiber 12, power 10, RF 6, cryo 6, vacuum 5). Cooling instead uses an explicit 4-cold/4-hot LCW manifold with paired rigid headers. Add no capacity. | `utility-ports-v2.js`; `network-discovery.js` `computeBusService()` |
| Vacuum exception | *"The exception is vacuum, which uses conductance-based calculations"* | Discovery is shared; the vacuum solver then applies staged pump-down and conductance to the discovered network | `network-discovery.js`, `vacuumPipe.js` |
| Hard gate list | *"Missing utility connection entirely; no PPS interlock; insufficient radiation shielding"* | Unwired sink on any of five hard utilities; `power_starved`; `vacuum_no_pump`; `cooling_dry`; cryo quench; `beam_unstaffed`. **No PPS check and no shielding check exist.** | `utility-gate.js` `HARD_REQUIRED_UTILS` and `run()`; grep for `ppsInterlock` / `shielding` finds only counting in `economy.js` |
| Fail-closed values | Not documented | Documented in full: qualities → 0, `rfPowerW` → 0, `cryoTempK` → 300 K, `coolingDeltaT` → 100 K, `vacuumPressure` → 1013 mbar | `utility-gate.js` `UTILITY_PHYSICAL_FIELDS`, `sinkQualityFloorFrom()` |
| Wiring costs | Not mentioned | Full per-utility ladder $300–$4,000 per sub-unit added | each `src/utility/types/*.js` `costPerSubUnit` |

---

## H. Labs, rooms and controls

| Claim | Old | New | Source |
|---|---|---|---|
| Lab network bonuses | A whole section: 1-tile lab reach, additive stacking capped at +50%, a table of furnishing `zoneOutput` percentages, *"A well-equipped RF Lab can add up to +32% quality"* | **Removed entirely.** `zoneOutput` is still summed per zone type and stored on state, but nothing reads it. | `src/networks/rooms.js` header: *"Phase 6: LAB_NETWORK_MAP and findLabNetworkBonuses have been removed"*; `Game.js` `computeZoneFurnishingBonuses()` has one caller which only assigns `state.zoneFurnishingBonuses`, and nothing reads that field |
| Lab connectivity / reach | *"Labs connect to networks within 1 tile of their room boundary"* | Documented as removed | as above; `computeRoomReach()` in `rooms.js` has no caller in `src/` |
| Beam-physics furnishings | Not mentioned | `getBeamPhysicsEffects()` exists and has no caller — Laser Alignment System and Beam Profiler are inert | `Game.js`; grep finds no call site |
| PPS interlock | *"At least one PPS interlock must exist in your facility to enable beam."* | No such check. Documented as inert. | no gating code; `economy.js` only counts them |
| Shielding | *"N_shielding_required = max(1, ceil(total energyCost / 50))"*, blocks beam | No such check. Documented as inert. | `economy.js` only counts `shielding` |
| MPS wear penalty | 2x wear without MPS | **Correct** — retained, with the exact formula added | `Game.js` `_applyWearForBeamline()`, `wearMult = hasMPS ? 1 : 2` |
| Staffing gate | Not mentioned | Added: a beamline with no active Control Room operator trips (`beam_unstaffed`), including operators stuck on break | `utility-gate.js` `_hasActiveOperator()`, `_unstaffedMessage()` |
| Diagnostic data | *"A diagnostic without a data/fiber connection to an IOC produces zero data"* — implied on/off | Soft: the mean `dataQuality` over components with `stats.dataRate > 0` scales beamline data income. Only the detector (1.0) and Faraday cup (0.1) produce data. | `Game.js` `_dataConnectivityFactor()`; `beamline-components.raw.js` |
| Data sources | Rack/IOC only | Eight source types listed with their Gbps | `utility-ports-v2.js` `INFRA_UTILITY_PORTS` data entries |
| Timing system | *"Required for pulsed devices like kickers and choppers"* | No requirement; no kickers exist | no gating code |

---

## I. Component catalogue

`required-connections.md` was rebuilt from the registry. The old table listed
roughly 40 beamline components; the catalogue has **30**, and the old table's
Power/Cooling/RF/Cryo/Data columns were wrong in several places (it omitted
vacuum entirely, which every beamline component needs).

**Listed but nonexistent:** DC Photocathode Gun, NC RF Gun, SRF Gun, Solenoid,
Corrector, SC Quad, SC Dipole, Tesla 9-cell, SRF 650 Cavity, C-band Structure,
X-band Structure, Undulator, Wiggler, Chicane, Bunch Compressor, Kicker,
Splitter, Collimator, Photon Port, Positron Target, Emittance Scanner, Wall
Current Monitor, Stripline Pickup, Cavity BPM, Bunch Length Monitor, Energy
Spectrometer, Beam Loss Monitor, Substation.

**In the catalogue but missing from the old table:** Bellows, Aperture,
Velocity Selector, Pepper-pot Emittance Filter, Collision Point, Faraday Cup,
Duoplasmatron Ion Source, ECR Ion Source.

Two further corrections:

- Every beamline component gets an injected vacuum sink, so **vacuum is a hard requirement for all of them** — `drift` excepted, since it is a drawn connection with no ports. Source: `utility-ports-v2.js`, the `vac_in` injection loop.
- Gating keys off **declared sink ports**, not the `requiredConnections` array. The Electron Gun's `requiredConnections` lists only `powerCable`, but it declares a cooling sink, so an unwired cooling line on it does hard-block. Source: `utility-gate.js` `_computeTopology()` → `findUnconnectedSinks(endpoints, ..., HARD_REQUIRED_UTILS)`, which iterates ports.

---

## J. Physics wiki — tier reachability

- **Source:** `beam_physics/machines.py` puts `BunchCompressionModule` and `FELGainModule` in tier 3 and `BeamBeamModule` in tier 4. `src/game/Game.js` `_ensureBeamlineForSourcePlaceable()` is the only `createBeamline` call site and keys `machineType: 'photoinjector'` off `dcPhotoGun` / `ncRfGun` / `srfGun`, none of which exist in `COMPONENTS`. `src/ui/hud.js` carries the same finding in a comment: *"nothing ever sets machineType to anything but 'linac'"*.
- **Effect:** bunch compression, CSR, FEL gain, Ming Xie degradation and every beam-beam quantity **have never executed in play**. Scope notes added to `tier2-physics.md`, `tier2-components.md`, `tier3-physics.md`, `tier3-components.md`, `tier4-physics.md`, `tier4-components.md`, `equations.md`, `real-machines.md`, `README.md`.
- **Collimation:** `beam_physics/modules/collimation.py` `applies_to` requires `type == "collimator"`; no component declares that physics type. Noted in `tier1-components.md`. The `aperture` component is a drift.
- **Beam trip:** `beam.alive` is set `True` in `beam_physics/beam.py` and **never cleared anywhere in `beam_physics/`**. `Game.js` faults a beamline when `!result.beamAlive`, so the path exists but can never fire. The *"beam trips at 50% loss"* claim in `tier1-physics.md` and `diagnostics-and-plots.md` was corrected to say so.
- **Beam-gas scattering** added as a new section in `tier1-physics.md` and to `equations.md` and the physics glossary, since it is now live and is the mechanism the wiki previously attributed to aperture narrowing.
- **`equations.md` Engineering section** follows the live solvers. Vacuum now implements `S_eff = S_pump C / (S_pump + C)`, `C_tube = 12.1 d^3/L`, staged pumping and dynamic gas inventory.
- **`real-machines.md`** tier goals were rewritten against `src/data/objectives.js` — `reach100mev`/`reach1gev`/`reach10gev`/`goodVacuum` (1e-8 mbar)/`subMicronEmittance` are live and checkable; `bunchCompressed` and `felSaturation` are not reachable (`felSaturated` is always `false`), and `colliderMode` is satisfiable but the Collision Point is a plain drift. All real-world facility parameters in that article were left alone — they are accurate.

---

## K. The two known gaps, documented rather than papered over

1. **`coolingDegradation` is dead.** `beam_physics/gameplay.py` computes
   `el["coolingDegradation"] = 1.0 + 0.1 * (1.0 - cooling_q)` and nothing reads
   it. Magnets are hard-gated on having a cooling connection but have no graded
   response to an under-served loop. Documented in `infra-wiki/cooling.md`,
   `infra-wiki/infrastructure-quality.md`, and `physics-wiki/tier1-components.md`.

2. **FEL and beam-beam have never run.** See section J. Documented in seven
   physics-wiki articles.

---

## Unresolved

- Whether the `bakeoutSystem` missing-port issue is intentional (bakeout gated
  behind future work) or an oversight. Documented as a limitation either way;
  a one-line port addition in `src/data/utility-ports-v2.js` would fix it, but
  that is outside this audit's file ownership.
- `docs/infra-wiki/rooms.md` still describes room auto-classification. The
  classifier in `src/networks/rooms.js` is implemented but `detectRooms()` has
  no caller in `src/` — only the simpler `Game._detectRoom()` flood-fill runs,
  for morale. Whether the classified room types surface anywhere in the UI was
  not chased down; the article now describes only the morale path as live.
