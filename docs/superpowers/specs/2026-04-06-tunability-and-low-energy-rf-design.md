# Component Tunability & Low-Energy RF Design

## Overview

Three connected changes to the game's core mechanics:

1. **Component tunability** — clicking any placed component opens a slider panel where you adjust its physical parameters. Changes propagate through real physics formulas and update beam properties in real time.
2. **Low-energy RF/accel components** — add Pillbox Cavity, RFQ, and DTL to fill the gap between source extraction and the existing medium/high-energy cavities.
3. **Category subsections** — split palette tabs into labeled subsections where natural groupings exist, and separate Endpoints from Diagnostics into its own top-level tab.

## 1. Component Parameter System

### 1.1 Parameter Definitions

Every component type gains an optional `paramDefs` object that describes its tunable knobs:

```js
paramDefs: {
  extractionVoltage: { min: 10, max: 100, default: 50, unit: 'kV', step: 1 },
  beamCurrent:       { min: 0.1, max: 5, default: 1, unit: 'mA', step: 0.1, derived: true },
  emittance:         { min: 0.5, max: 20, default: 5, unit: 'mm·mrad', step: 0.1, derived: true },
}
```

- Fields without `derived: true` render as interactive sliders.
- Fields with `derived: true` render as read-only numeric displays that update when input sliders change.
- `min`, `max`, `default`, `unit`, `step` are all required for each param.

### 1.2 Per-Component Physics Formulas

Each component type with `paramDefs` also gets a `computeStats(params) -> stats` function in a new `component-physics.js` file. These are JS functions (no Pyodide dependency) that compute derived params and output stats from the current slider values.

#### Sources

**Thermionic source:**
- Child-Langmuir law: `I = P * V^(3/2)` where P is the perveance (geometry-dependent constant)
- Thermal emittance: `ε_th = r_cathode * sqrt(kT / (m_e * c^2))`
- Trade-off: higher extraction voltage -> higher current but beam gets harder to focus (space charge)
- Adjustable: `extractionVoltage`, `cathodeTemperature`
- Derived: `beamCurrent`, `emittance`

**DC Photocathode Gun:**
- QE model: `I = QE * P_laser * e / (h * c / λ)`
- Intrinsic emittance: `ε = r_laser * sqrt((hν - φ) / (3 * m_e * c^2))`
- Adjustable: `laserPower`, `laserSpotSize`, `extractionVoltage`
- Derived: `beamCurrent`, `emittance`, `cathodeQE` (display only, fixed by cathode material)

**NC RF Gun:**
- Peak field determines max extractable charge per bunch
- Emittance dominated by RF contribution: `ε_rf ∝ σ_z * E_peak * f_rf`
- Adjustable: `peakField`, `rfPhase`, `laserSpotSize`
- Derived: `beamCurrent`, `emittance`, `bunchCharge`

**SRF Gun:**
- CW operation: average current = bunch charge * rep rate
- Lower peak fields but continuous operation
- Adjustable: `gradient`, `repRate`, `laserSpotSize`
- Derived: `beamCurrent`, `emittance`, `avgPower`

#### Quadrupoles

- `focusStrength = 0.2998 * gradient / p_GeV` (normalized gradient)
- Adjustable: `gradient` (T/m)
- Derived: `focusStrength` (recomputed based on beam momentum at that point)
- Normal quads: gradient range 0-50 T/m
- SC quads: gradient range 0-200 T/m

#### Dipoles

- `bendAngle = length * 0.2998 * B / p_GeV`
- Adjustable: `fieldStrength` (T)
- Derived: `bendAngle` (display only — the physical bend is fixed at 90 degrees by geometry, but field strength affects what momentum the dipole can handle)
- Normal dipoles: 0-2 T
- SC dipoles: 0-8 T

#### RF Cavities (all types)

- `energyGain = voltage * transitTimeFactor * cos(rfPhase)`
- Transit time factor is computed from frequency and gap geometry
- Adjustable: `voltage` (or `gradient` for multi-cell), `rfPhase`
- Derived: `energyGain`, `energySpread` (from phase-dependent effects)
- Phase affects both acceleration and longitudinal focusing

#### Solenoids

- `focusStrength = (e * B / (2 * p))^2 * L` (thin-lens solenoid)
- Adjustable: `fieldStrength` (T)
- Derived: `focusStrength`

#### Sextupoles / Octupoles

- Adjustable: `fieldStrength`
- Derived: `beamQuality` contribution (chromaticity correction)

#### Insertion Devices (Undulators, Wigglers)

- `photonEnergy = 0.665 * E_GeV^2 / (period_mm * (1 + K^2/2))`
- Adjustable: `gap` (which determines K parameter via `K = 0.934 * period_cm * B_peak`)
- Derived: `photonRate`, `photonEnergy`, `kParameter`

### 1.3 Per-Node State

When a component is placed, its node in the beamline graph stores a copy of its current parameter values:

```js
node.params = { extractionVoltage: 50, cathodeTemperature: 1200 }
```

These are initialized from `paramDefs[*].default` at placement time. Slider changes update `node.params` directly, then trigger a beamline recalculation.

### 1.4 Beamline Recalculation Flow

On any parameter change:
1. `computeStats(node.params)` runs for the changed component
2. The component's `stats` object is updated with the result
3. `game.recalcBeamline()` is called, which walks the ordered component list and accumulates beam properties
4. The renderer updates all beam property displays

This should be debounced (e.g., 50ms) so rapid slider dragging doesn't cause excessive recalculations.

### 1.5 Serialization

`node.params` is already included in `toJSON()` since nodes are serialized wholesale. No changes needed for save/load — params persist automatically.

## 2. Slider Panel UI

### 2.1 Popup Rework

The existing `showPopup()` in `renderer.js` is extended:

- The popup gains a **"Parameters" section** below the description, containing sliders for each non-derived param and readouts for derived params.
- Each slider is an HTML `<input type="range">` with a numeric readout showing current value + unit.
- Derived values display below sliders with a subtle visual distinction (e.g., lighter text, no slider track).
- The popup width increases from ~260px to ~320px to accommodate sliders.

### 2.2 Slider Behavior

- Dragging a slider updates `node.params[key]` immediately.
- A debounced (50ms) recalc fires, updating derived values in the same popup and beam properties globally.
- Derived param readouts animate briefly (flash/highlight) when they change, so the player sees cause and effect.
- Sliders snap to `step` increments.

### 2.3 Components Without Tunable Params

Components like `drift`, `bellows`, `bpm`, `ict`, etc. that have no meaningful tunable parameters show the existing read-only popup (stats, health, recycle/probe buttons). No slider section appears.

## 3. Low-Energy RF Components

### 3.1 New Components

**Pillbox Cavity** (low-energy subsection):
- Simple single-cell copper cavity for initial acceleration
- Energy range: ~0.1-1 MeV gain
- Category: `rf`
- Subsection: `lowEnergy`
- Cost: 150 funding
- Default params: `{ voltage: 0.5 (MV), rfPhase: 0 (deg) }`
- Fixed display params: `rfFrequency: 200 MHz` (frequency is set by cavity geometry, not tunable)
- `computeStats`: `energyGain = voltage * cos(rfPhase)` with basic transit time factor
- Track length: 1
- Unlocked by default (starter component)

**RFQ (Radio-Frequency Quadrupole)** (low-energy subsection):
- Bunches and accelerates simultaneously from keV to ~3 MeV
- The classic first accelerating structure after a source
- Category: `rf`
- Subsection: `lowEnergy`
- Cost: 600 funding
- Default params: `{ intervaneVoltage: 80 (kV), rfFrequency: 352 (MHz), rfPhase: -30 (deg) }`
- `computeStats`: energy gain depends on vane voltage and length, also provides bunch compression
- Stats: `{ energyGain: 0.3, bunchCompression: 0.5 }`
- Track length: 3
- Unlocked by default

**DTL (Drift-Tube Linac)** (low-energy subsection):
- Alvarez-style structure, efficient from ~3-50 MeV
- Bridge between RFQ and high-energy structures
- Category: `rf`
- Subsection: `lowEnergy`
- Cost: 800 funding
- Default params: `{ gradient: 3 (MV/m), rfFrequency: 352 (MHz), rfPhase: -25 (deg) }`
- `computeStats`: `energyGain = gradient * length * cos(rfPhase)` with cell-length correction
- Stats: `{ energyGain: 0.6 }`
- Track length: 3
- Requires: `bunchCompression` research (since DTLs need properly bunched beams)

### 3.2 Source Extraction Voltage

DC extraction is not a separate component. Instead, the source's `extractionVoltage` slider (10-100 kV for thermionic, up to 300 kV for DC photogun) determines the initial beam energy that feeds into the first accelerating element. This is physically realistic — the gun voltage *is* the extraction.

## 4. Category Subsections

### 4.1 Subsection System

Each category in `MODES` gains an optional `subsections` definition:

```js
rf: {
  name: 'RF / Accel',
  color: '#c90',
  subsections: {
    lowEnergy:  { name: 'Low Energy' },
    highEnergy: { name: 'High Energy' },
  },
}
```

Components specify which subsection they belong to via a `subsection` field. Components without a `subsection` field go into the first subsection by default.

### 4.2 Palette Rendering

The horizontal palette bar renders subsections as labeled groups within the same tab:
- A subtle vertical divider separates subsections
- Each subsection has a small label above its component icons
- Both subsections are always visible simultaneously (no extra click to switch)

### 4.3 Full Subsection Map

**Sources:**
- `electron`: "Electron" — source, dcPhotoGun, ncRfGun, srfGun
- `utility`: "Utility" — drift, bellows

**Focusing:**
- `normalConducting`: "Normal" — dipole, quadrupole, solenoid, corrector, combinedFunctionMagnet
- `superconducting`: "Superconducting" — scQuad, scDipole

**RF / Accel:**
- `lowEnergy`: "Low Energy" — pillboxCavity, rfq, dtl, buncher (buncher moves here from its current position but keeps its `bunchCompression` research requirement)
- `highEnergy`: "High Energy" — rfCavity, cbandCavity, xbandCavity, harmonicLinearizer, cryomodule, srf650Cavity

**Diagnostics** (monitors only now):
- `position`: "Beam Monitors" — bpm, screen, ict, wireScanner, bunchLengthMonitor, srLightMonitor, beamLossMonitor
- `energy`: "Spectrometers" — energySpectrometer

**Beam Optics:**
- `insertionDevices`: "Insertion Devices" — undulator, helicalUndulator, wiggler, apple2Undulator
- `manipulation`: "Manipulation" — collimator, sextupole, octupole, kickerMagnet, septumMagnet, chicane, dogleg, stripperFoil, splitter

**Endpoints** (new top-level category):
- `detectors`: "Detectors" — detector
- `targets`: "Targets" — target, fixedTargetAdv, positronTarget
- `photon`: "Photon" — photonPort, comptonIP

### 4.4 Mode Categories Update

```js
beamline: {
  categories: {
    source:     { name: 'Sources',     color: '#4a9' },
    focusing:   { name: 'Focusing',    color: '#c44' },
    rf:         { name: 'RF / Accel',  color: '#c90' },
    diagnostic: { name: 'Diagnostics', color: '#44c' },
    beamOptics: { name: 'Beam Optics', color: '#a4a' },
    endpoint:   { name: 'Endpoints',   color: '#864' },
  },
},
```

## 5. Param Definitions by Component Type

Summary of what becomes tunable for every existing component that has meaningful physics knobs:

| Component | Adjustable Params | Key Derived Output |
|---|---|---|
| source (thermionic) | extractionVoltage, cathodeTemperature | beamCurrent, emittance |
| dcPhotoGun | laserPower, laserSpotSize, extractionVoltage | beamCurrent, emittance |
| ncRfGun | peakField, rfPhase, laserSpotSize | beamCurrent, emittance, bunchCharge |
| srfGun | gradient, repRate, laserSpotSize | beamCurrent, emittance |
| quadrupole | gradient | focusStrength |
| scQuad | gradient | focusStrength |
| dipole | fieldStrength | maxMomentum |
| scDipole | fieldStrength | maxMomentum |
| solenoid | fieldStrength | focusStrength |
| sextupole | fieldStrength | chromaticityCorrection |
| octupole | fieldStrength | landauDamping |
| rfCavity | voltage, rfPhase | energyGain, energySpread |
| pillboxCavity | voltage, rfPhase | energyGain |
| rfq | intervaneVoltage, rfPhase | energyGain, bunchCompression |
| dtl | gradient, rfPhase | energyGain |
| cbandCavity | gradient, rfPhase | energyGain, energySpread |
| xbandCavity | gradient, rfPhase | energyGain, energySpread |
| cryomodule | gradient, rfPhase | energyGain, energySpread |
| srf650Cavity | gradient, rfPhase | energyGain, energySpread |
| buncher | voltage, rfPhase | bunchCompression |
| harmonicLinearizer | voltage, rfPhase | bunchCompression, beamQuality |
| undulator | gap | photonRate, photonEnergy, kParameter |
| helicalUndulator | gap | photonRate, photonEnergy, kParameter |
| wiggler | gap | photonRate, photonEnergy, kParameter |
| apple2Undulator | gap, polarizationMode | photonRate, photonEnergy, kParameter |
| combinedFunctionMagnet | dipoleField, quadGradient | bendAngle, focusStrength |
| corrector | kickAngle | orbitCorrection |
| kickerMagnet | kickAngle, riseTime | kickStrength |

Components with no tunable physics (drift, bellows, bpm, screen, ict, wireScanner, bunchLengthMonitor, beamLossMonitor, srLightMonitor, splitter, collimator, all endpoints, all facility equipment) keep the existing read-only popup.

## 6. File Structure

- `component-physics.js` — new file containing all `computeStats` functions and `PARAM_DEFS` object, keyed by component type
- `data.js` — add `subsection` field to components, add `subsections` to category defs, add new low-energy RF components (pillboxCavity, rfq, dtl), create `endpoint` category, move endpoint components to it
- `renderer.js` — extend `showPopup()` with slider panel, update palette rendering to show subsections with dividers and labels
- `input.js` — wire slider changes to `node.params` updates and debounced recalc
- `style.css` — slider styling, subsection divider styling, derived-value styling
