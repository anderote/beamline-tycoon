# Full Beamline Component List (Implementation Backlog)

Archived from the original 64-component `src/data/beamline-components.raw.js` before it was shrunk to a 24-component starter set. This is the to-implement backlog: each unchecked item is a component to bring back into the active code (or reimagine) post-MVP.

Legend: **MVP** = currently in the starter set; everything else is deferred.

---

## Sources (`category: source`)

### Electron sources (`subsection: electron`)

- [x] **MVP** `source` — Source — cost 200000 — beamCurrent 100 — energy 15 — _Simple thermionic electron gun, 25 kV / 200 mA up to 250 kV / 20 mA. Starter source._
- [ ] `dcPhotoGun` — DC Photocathode Gun — cost 1500000 — beamCurrent 1.5 — energy 3 — requires `photocathodes` — _Laser-driven DC photocathode, mid-tier brightness upgrade._
- [ ] `ncRfGun` — NC RF Gun — cost 3000000 — beamCurrent 2.5 — energy 8 — requires `rfPhotoinjectors` — _RF photoinjector, very high peak brightness, pulsed._
- [ ] `srfGun` — SRF Gun — cost 8000000 — beamCurrent 4 — energy 5 — requires `srfGunTech` — _Top-tier CW superconducting RF gun, needs cryo._

### Ion sources (no subsection in original)

- [ ] `ionSource` — Ion Source — cost 300000 — beamCurrent 0.5 — energy 8 — requires `protonAcceleration` — _H- ion source for proton linac. Needs Stripper Foil downstream._

### Utility / drift (`subsection: utility`)

- [x] **MVP** `drift` — Beam Pipe — cost 10000 — energy 0 — _Straight beam pipe, no active elements. Drawn-connection. Cheap length filler._
- [x] **MVP** `bellows` — Bellows Section — cost 15000 — energy 0 — _Flexible vacuum bellows, absorbs thermal expansion / vibration._

---

## Optics — Focusing (originally `category: focusing`, `subsection: normalConducting/superconducting`)

### Normal-conducting magnets

- [x] **MVP** `dipole` — Dipole — cost 300000 — bendAngle 90 — energy 8 — _90° C-clamp bending magnet for layout routing._
- [x] **MVP** `quadrupole` — Quad — cost 200000 — focusStrength 1 — energy 6 — _Focusing quadrupole. FODO lattice element._
- [x] **MVP** `sextupole` — Sextupole — cost 350000 — focusStrength 0.5, beamQuality 0.3 — energy 8 — _(originally requires `advancedOptics`; ungated in MVP) Six-pole magnet correcting chromatic aberration._
- [ ] `solenoid` — Solenoid — cost 150000 — focusStrength 0.4 — energy 1 — _Axial-field focusing, best at low energies near the source._
- [ ] `corrector` — Corrector (H/V) — cost 50000 — beamQuality 0.05 — energy 0.5 — _Small steering dipoles for orbit alignment._
- [ ] `octupole` — Octupole — cost 400000 — beamQuality 0.15 — energy 2 — requires `advancedOptics` — _Eight-pole, Landau damping._
- [ ] `combinedFunctionMagnet` — Combined Function — cost 2000000 — bendAngle 45, focusStrength 0.8 — energy 2 — requires `latticeDesign` — _Bend + focus in one magnet, compact rings._
- [ ] `protonQuad` — Proton Quad — cost 300000 — focusStrength 0.8 — energy 8 — requires `protonAcceleration` — _Heavy-duty proton-rigidity quad._
- [ ] `protonDipole` — Proton Dipole — cost 500000 — bendAngle 90 — energy 12 — requires `protonAcceleration` — _High-field proton bending magnet._

### Superconducting magnets

- [ ] `scQuad` — SC Quadrupole — cost 1500000 — focusStrength 2.5 — energy 1 — requires `scMagnets` — _2.5x focusing, needs cryo._
- [ ] `scDipole` — SC Dipole — cost 3000000 — bendAngle 90 — energy 2 — requires `scMagnets` — _6 T superconducting dipole, high-energy bending._

---

## Optics — Manipulation (originally `category: beamOptics`, `subsection: manipulation`)

- [x] **MVP** `aperture` — Aperture — cost 30000 — beamQuality 0.1 — energy 0 — _Adjustable slit, halo scraping._
- [x] **MVP** `splitter` — Splitter — cost 500000 — energy 10 — _Splits beam into straight + branch outputs._
- [x] **MVP** `velocitySelector` — Velocity Selector — cost 250000 — beamQuality 0.3 — energy 3 — _Crossed E×B Wien filter._
- [x] **MVP** `emittanceFilter` — Pepper-pot Emittance Filter — cost 100000 — beamQuality 0.15 — energy 0 — _Phase-space cleanup via pinhole array._
- [ ] `collimator` — Collimator — cost 400000 — beamQuality 0.2 — energy 2 — requires `beamOptics` — _Halo scraper for sensitive components._
- [ ] `kickerMagnet` — Kicker Magnet — cost 800000 — energy 2 — requires `fastKickers` — _25 ns rise-time pulsed magnet for injection/extraction._
- [ ] `septumMagnet` — Septum Magnet — cost 1200000 — energy 2 — requires `beamTransport` — _2 mm septum, separates injected from circulating beam._
- [ ] `chicane` — Chicane (4-dipole) — cost 2500000 — bunchCompression 0.8 — energy 3 — requires `bunchCompression` — _Primary bunch compressor._
- [ ] `dogleg` — Dog-leg (2-dipole) — cost 1500000 — energy 2 — requires `beamTransport` — _Vertical/horizontal beam offset._
- [ ] `stripperFoil` — Stripper Foil — cost 100000 — energy 0 — requires `ionSources` — _200 nm carbon foil, H- → p+ conversion._
- [ ] `laserHeater` — Laser Heater — cost 2000000 — energy 4 — requires `felPhysics` — _IR laser energy-spread heater for FEL microbunching suppression._

---

## Optics — Insertion Devices (originally `category: beamOptics`, `subsection: insertionDevices`)

- [ ] `undulator` — Undulator — cost 3000000 — photonRate 1 — energy 12 — requires `synchrotronLight` — _Periodic magnet, coherent SR._
- [ ] `helicalUndulator` — Helical Undulator — cost 4000000 — photonRate 1.5 — energy 2 — requires `advancedUndulators` — _Circularly polarized photons._
- [ ] `wiggler` — Wiggler — cost 2000000 — photonRate 2 — energy 3 — requires `synchrotronLight` — _High-K broadband, highest flux._
- [ ] `apple2Undulator` — APPLE-II Undulator — cost 5000000 — photonRate 1.8 — energy 2 — requires `advancedUndulators` — _Variable polarization sliding-row undulator._

---

## RF / Acceleration (`category: rf`)

### Normal conducting (`subsection: normalConducting`)

- [x] **MVP** `pillboxCavity` — Pillbox Cavity (200 MHz) — cost 200000 — energyGain 0.0005 — energy 3 — _Single-cell copper cavity, first acceleration after source._
- [x] **MVP** `rfq` — RFQ (400 MHz) — cost 1500000 — energyGain 0.003, bunchCompression 0.5 — energy 6 — _Radio-Frequency Quadrupole, bunches + accelerates from keV to 3 MeV._
- [x] **MVP** `rfCavity` — NC RF Cavity (2.856 GHz) — cost 500000 — energyGain 0.5 — energy 20 — _Standard NC RF cavity, 500 MeV/unit._
- [x] **MVP** `sbandStructure` — S-band Structure (2.856 GHz) — cost 600000 — energyGain 0.6 — energy 15 — _SLAC-style traveling-wave NC structure, 600 MeV/section._
- [ ] `buncher` — Sub-harmonic Buncher (2.856 GHz) — cost 300000 — bunchCompression 0.3 — energy 3 — requires `bunchCompression` — _Longitudinal compressor, place after source._
- [ ] `dtl` — Drift-Tube Linac (400 MHz) — cost 2000000 — energyGain 0.008 — energy 8 — requires `bunchCompression` — _Alvarez DTL, 3→50 MeV proton/ion workhorse._
- [ ] `cbandCavity` — C-band Cavity (5.712 GHz) — cost 1000000 — energyGain 0.8 — energy 8 — requires `highGradientRf` — _35 MV/m compact NC structure, 800 MeV/unit._
- [ ] `xbandCavity` — X-band Cavity (11.424 GHz) — cost 1500000 — energyGain 1.2 — energy 12 — requires `highGradientRf` — _65 MV/m ultra-compact NC, 1200 MeV/unit._
- [ ] `dtlCavity` — DTL Cavity — cost 1200000 — energyGain 0.05 — energy 20 — requires `protonAcceleration` — _Proton DTL chain, 3-70 MeV._

### Superconducting (`subsection: superconducting`)

- [x] **MVP** `halfWaveResonator` — Half-Wave Resonator (161 MHz) — cost 400000 — energyGain 0.001 — energy 4 — _Coaxial SRF cavity, low-beta acceleration. Needs cryo._
- [x] **MVP** `spokeCavity` — Spoke Cavity (325 MHz) — cost 600000 — energyGain 0.01 — energy 5 — _Mid-energy SRF spoke resonator, 10 MeV/unit. Needs cryo._
- [ ] `harmonicLinearizer` — 3rd Harmonic Linearizer (3.9 GHz) — cost 800000 — bunchCompression 0.2, beamQuality 0.2 — energy 4 — requires `bunchCompression` — _Cancels RF curvature for uniform bunch energy._
- [ ] `srf650Cavity` — 650 MHz SRF Cavity — cost 4500000 — energyGain 1.5 — energy 4 — requires `cwLinacDesign` — _Large-bore CW SRF, 1500 MeV/unit at 4 kW._
- [ ] `tesla9Cell` — TESLA 9-cell (1.3 GHz) — cost 8000000 — energyGain 3.0 — energy 20 — requires `nDopedSrf` — _ILC-style N-doped niobium 9-cell, 3000 MeV/unit. Gold standard._
- [ ] `cryomodule` — Cryomodule (1.3 GHz) — cost 5000000 — energyGain 2.0 — energy 30 — requires `srfTechnology` — _Standard SRF cryomodule, 2000 MeV/unit._

---

## Diagnostics (`category: diagnostic`)

### Beam monitors (`subsection: monitors`)

- [x] **MVP** `bpm` — BPM — cost 30000 — beamQuality 0.02 — energy 0.1 — _Non-destructive beam position monitor._
- [x] **MVP** `screen` — Screen/YAG — cost 50000 — beamQuality 0.03 — energy 0.2 — _Insertable YAG fluorescent screen._
- [x] **MVP** `ict` — Current Monitor (ICT) — cost 40000 — energy 0.1 — _Integrating Current Transformer._
- [x] **MVP** `wireScanner` — Wire Scanner — cost 200000 — beamQuality 0.05 — energy 0.5 — _(originally requires `beamDiagnostics`; ungated in MVP) Transverse profile via thin wire._
- [ ] `bunchLengthMonitor` — Bunch Length Monitor — cost 500000 — energy 1 — requires `beamDiagnostics` — _Coherent radiation longitudinal length sensor._
- [ ] `beamLossMonitor` — Beam Loss Monitor — cost 100000 — energy 0.2 — requires `machineProtection` — _Radiation-based loss detector for MPS._
- [ ] `srLightMonitor` — SR Light Monitor — cost 300000 — energy 0.3 — requires `synchrotronLight` — _Synchrotron-light beam imaging at dipoles._

### Spectrometers (`subsection: spectrometers`)

- [ ] `energySpectrometer` — Energy Spectrometer — cost 1000000 — dataRate 0.3 — energy 1 — requires `beamDiagnostics` — _Bending-magnet energy spread measurement, also data._

---

## Endpoints (`category: endpoint`)

### Detectors (`subsection: detectors`)

- [x] **MVP** `faradayCup` — Faraday Cup — cost 30000 — dataRate 0.1 — energy 0 — _Cheapest endpoint, charge collector._
- [x] **MVP** `detector` — Detector — cost 50000000 — dataRate 1 — energy 15 — _General-purpose detector, primary data source._

### Targets (`subsection: targets`)

- [x] **MVP** `beamStop` — Beam Stop — cost 200000 — energy 0 — _Water-cooled copper absorber. Safety endpoint._
- [x] **MVP** `target` — Target — cost 1000000 — collisionRate 2 — energy 0 — _Fixed target, 2x collision rate._
- [ ] `fixedTargetAdv` — Fixed Target (W/LH2) — cost 3000000 — collisionRate 4, dataRate 1.5 — energy 0 — requires `targetPhysicsAdv` — _Heavy-duty W or LH2 target with secondary collection._
- [ ] `positronTarget` — Positron Target — cost 8000000 — collisionRate 2, dataRate 2 — energy 0 — requires `antimatter` — _High-Z e+/e- pair production target._

### Photon (`subsection: photon`)

- [ ] `photonPort` — Photon Beamline Port — cost 1500000 — dataRate 1 — energy 0 — requires `synchrotronLight` — _Photon extraction port for undulator hutches._
- [ ] `comptonIP` — Compton Backscatter IP — cost 5000000 — dataRate 1.5 — energy 1 — requires `photonScience` — _Inverse Compton gamma source._

---

## Summary

- **Total components archived:** 64
- **In MVP starter set (24):** source, drift, bellows, dipole, quadrupole, sextupole, aperture, splitter, velocitySelector, emittanceFilter, pillboxCavity, rfq, rfCavity, sbandStructure, halfWaveResonator, spokeCavity, bpm, screen, ict, wireScanner, faradayCup, beamStop, target, detector
- **Deferred (40):** all other items above. Implement in research-tier order as gameplay needs demand them.

Note: the new active code merges the old `focusing` and `beamOptics` categories into a single `optics` category with `focusing` and `manipulation` subsections. When restoring deferred components, map them as: old `focusing` → `optics/focusing`; old `beamOptics/manipulation` → `optics/manipulation`; old `beamOptics/insertionDevices` will need a new subsection (e.g. `optics/insertionDevices`) added to `MODES.beamline.categories.optics.subsections`.
