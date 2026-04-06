# Component Tunability & Low-Energy RF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all placed beamline components tunable via physics-based sliders, add low-energy RF components (Pillbox, RFQ, DTL), reorganize palette with subsections, and split Endpoints from Diagnostics.

**Architecture:** Per-component physics formulas in a new `component-physics.js` compute derived stats from slider params. The existing popup in `renderer.js` is extended with slider controls. `data.js` gains subsection metadata, new components, and a new `endpoint` category. Slider changes update `node.params` and trigger debounced `recalcBeamline()`.

**Tech Stack:** Vanilla JS (no frameworks), HTML range inputs for sliders, existing PixiJS renderer for visuals.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `component-physics.js` | Create | `PARAM_DEFS` object and `computeStats(type, params)` for all tunable components |
| `data.js` | Modify | Add `subsection` fields, `subsections` in category defs, new endpoint category, 3 new low-energy RF components, new UNITS entries |
| `renderer.js` | Modify | Extend `showPopup()` with slider UI, update `_renderPalette()` for subsection rendering |
| `style.css` | Modify | Slider styling, subsection dividers, derived-value styling |
| `index.html` | Modify | Add `<script>` tag for `component-physics.js` |
| `input.js` | Modify | Wire slider changes to `node.params` + debounced recalc |
| `beamline.js` | Modify | Initialize `node.params` from `PARAM_DEFS` defaults at placement time |
| `test/test-component-physics.js` | Create | Tests for physics formulas |

---

### Task 1: Create component-physics.js with source physics

**Files:**
- Create: `component-physics.js`
- Create: `test/test-component-physics.js`

- [ ] **Step 1: Write the test file for thermionic source physics**

```js
// test/test-component-physics.js — Tests for component physics formulas

// Stub minimal globals
global.COMPONENTS = {
  source: { id: 'source', length: 2 },
  dcPhotoGun: { id: 'dcPhotoGun', length: 2 },
  ncRfGun: { id: 'ncRfGun', length: 2 },
  srfGun: { id: 'srfGun', length: 3 },
};

const { PARAM_DEFS, computeStats } = require('../component-physics.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function approx(a, b, tol = 0.01) {
  return Math.abs(a - b) < tol;
}

console.log('\n=== Component Physics Tests ===\n');

// --- PARAM_DEFS structure ---
console.log('-- PARAM_DEFS structure --');
assert(PARAM_DEFS.source !== undefined, 'source has paramDefs');
assert(PARAM_DEFS.source.extractionVoltage !== undefined, 'source has extractionVoltage');
assert(PARAM_DEFS.source.extractionVoltage.min === 10, 'extractionVoltage min is 10');
assert(PARAM_DEFS.source.extractionVoltage.max === 100, 'extractionVoltage max is 100');
assert(PARAM_DEFS.source.extractionVoltage.unit === 'kV', 'extractionVoltage unit is kV');
assert(PARAM_DEFS.source.beamCurrent.derived === true, 'beamCurrent is derived');
assert(PARAM_DEFS.source.emittance.derived === true, 'emittance is derived');

// --- Thermionic source: Child-Langmuir ---
console.log('-- Thermionic source --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.source)) {
    defaults[k] = v.default;
  }
  const result = computeStats('source', defaults);
  assert(result.beamCurrent > 0, 'default params produce positive current');
  assert(result.emittance > 0, 'default params produce positive emittance');

  // Higher voltage → higher current (Child-Langmuir V^3/2)
  const lowV = computeStats('source', { ...defaults, extractionVoltage: 20 });
  const highV = computeStats('source', { ...defaults, extractionVoltage: 80 });
  assert(highV.beamCurrent > lowV.beamCurrent, 'higher voltage gives higher current');

  // Higher temperature → higher emittance
  const lowT = computeStats('source', { ...defaults, cathodeTemperature: 800 });
  const highT = computeStats('source', { ...defaults, cathodeTemperature: 1600 });
  assert(highT.emittance > lowT.emittance, 'higher temperature gives higher emittance');
}

// --- DC Photocathode Gun ---
console.log('-- DC Photocathode Gun --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.dcPhotoGun)) {
    defaults[k] = v.default;
  }
  const result = computeStats('dcPhotoGun', defaults);
  assert(result.beamCurrent > 0, 'dcPhotoGun produces positive current');
  assert(result.emittance > 0, 'dcPhotoGun produces positive emittance');

  // Higher laser power → higher current
  const lowP = computeStats('dcPhotoGun', { ...defaults, laserPower: 0.1 });
  const highP = computeStats('dcPhotoGun', { ...defaults, laserPower: 1.0 });
  assert(highP.beamCurrent > lowP.beamCurrent, 'higher laser power gives higher current');

  // Larger spot size → higher emittance
  const smallSpot = computeStats('dcPhotoGun', { ...defaults, laserSpotSize: 0.5 });
  const bigSpot = computeStats('dcPhotoGun', { ...defaults, laserSpotSize: 2.0 });
  assert(bigSpot.emittance > smallSpot.emittance, 'larger spot gives higher emittance');
}

// --- NC RF Gun ---
console.log('-- NC RF Gun --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.ncRfGun)) {
    defaults[k] = v.default;
  }
  const result = computeStats('ncRfGun', defaults);
  assert(result.beamCurrent > 0, 'ncRfGun produces positive current');
  assert(result.emittance > 0, 'ncRfGun produces positive emittance');
  assert(result.bunchCharge > 0, 'ncRfGun produces positive bunch charge');
}

// --- SRF Gun ---
console.log('-- SRF Gun --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.srfGun)) {
    defaults[k] = v.default;
  }
  const result = computeStats('srfGun', defaults);
  assert(result.beamCurrent > 0, 'srfGun produces positive current');
  assert(result.emittance > 0, 'srfGun produces positive emittance');

  // Higher rep rate → higher average current
  const lowRep = computeStats('srfGun', { ...defaults, repRate: 100 });
  const highRep = computeStats('srfGun', { ...defaults, repRate: 1000 });
  assert(highRep.beamCurrent > lowRep.beamCurrent, 'higher rep rate gives higher current');
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-component-physics.js`
Expected: FAIL — `Cannot find module '../component-physics.js'`

- [ ] **Step 3: Create component-physics.js with source formulas**

```js
// === COMPONENT PHYSICS: Per-component parameter definitions and formulas ===
// Pure JS physics — no Pyodide dependency. Each component type with tunable
// parameters gets an entry in PARAM_DEFS and a handler in COMPUTE_STATS.

// Physical constants
const PHYS = {
  e: 1.602e-19,        // electron charge (C)
  me: 9.109e-31,       // electron mass (kg)
  c: 2.998e8,          // speed of light (m/s)
  k_B: 1.381e-23,      // Boltzmann constant (J/K)
  h: 6.626e-34,        // Planck constant (J·s)
  mc2_eV: 0.511e6,     // electron rest mass energy (eV)
};

// Parameter definitions: { paramName: { min, max, default, unit, step, derived? } }
const PARAM_DEFS = {

  // ── Sources ───────────────────────────────────────────────────────────
  source: {
    extractionVoltage: { min: 10, max: 100, default: 50, unit: 'kV', step: 1 },
    cathodeTemperature: { min: 600, max: 2000, default: 1200, unit: 'K', step: 10 },
    beamCurrent: { min: 0, max: 10, default: 1, unit: 'mA', step: 0.01, derived: true },
    emittance: { min: 0, max: 50, default: 5, unit: 'mm·mrad', step: 0.1, derived: true },
  },

  dcPhotoGun: {
    extractionVoltage: { min: 50, max: 300, default: 200, unit: 'kV', step: 5 },
    laserPower: { min: 0.01, max: 2, default: 0.5, unit: 'W', step: 0.01 },
    laserSpotSize: { min: 0.1, max: 3, default: 1.0, unit: 'mm', step: 0.1 },
    beamCurrent: { min: 0, max: 20, default: 1.5, unit: 'mA', step: 0.01, derived: true },
    emittance: { min: 0, max: 10, default: 1, unit: 'mm·mrad', step: 0.01, derived: true },
    cathodeQE: { min: 0, max: 10, default: 0.01, unit: '%', step: 0.001, derived: true },
  },

  ncRfGun: {
    peakField: { min: 50, max: 150, default: 120, unit: 'MV/m', step: 1 },
    rfPhase: { min: -60, max: 0, default: -30, unit: 'deg', step: 1 },
    laserSpotSize: { min: 0.1, max: 3, default: 0.8, unit: 'mm', step: 0.1 },
    beamCurrent: { min: 0, max: 10, default: 2.5, unit: 'mA', step: 0.01, derived: true },
    emittance: { min: 0, max: 5, default: 1, unit: 'mm·mrad', step: 0.01, derived: true },
    bunchCharge: { min: 0, max: 5, default: 1, unit: 'nC', step: 0.01, derived: true },
  },

  srfGun: {
    gradient: { min: 5, max: 40, default: 20, unit: 'MV/m', step: 0.5 },
    repRate: { min: 10, max: 1300, default: 650, unit: 'kHz', step: 10 },
    laserSpotSize: { min: 0.1, max: 3, default: 1.0, unit: 'mm', step: 0.1 },
    beamCurrent: { min: 0, max: 20, default: 4, unit: 'mA', step: 0.01, derived: true },
    emittance: { min: 0, max: 5, default: 0.5, unit: 'mm·mrad', step: 0.01, derived: true },
  },
};

// Physics compute functions: (params) -> { stat: value, ... }
const COMPUTE_STATS = {

  // Thermionic source — Child-Langmuir law
  source(params) {
    const V_kV = params.extractionVoltage;
    const T = params.cathodeTemperature;

    // Child-Langmuir: I = P * V^(3/2), perveance P ~ 2e-6 A/V^(3/2) for typical geometry
    const perveance = 2e-6;
    const V_volts = V_kV * 1000;
    const I_amps = perveance * Math.pow(V_volts, 1.5);
    const beamCurrent = I_amps * 1000; // mA

    // Thermal emittance: ε = r_cathode * sqrt(kT / mc²)
    // r_cathode ~ 2mm for thermionic, kT in eV
    const r_cathode_mm = 2.0;
    const kT_eV = (PHYS.k_B * T) / PHYS.e;
    const emittance = r_cathode_mm * Math.sqrt(kT_eV / PHYS.mc2_eV) * 1000; // mm·mrad

    return { beamCurrent, emittance };
  },

  // DC Photocathode Gun — QE model
  dcPhotoGun(params) {
    const V_kV = params.extractionVoltage;
    const P_laser = params.laserPower; // W
    const r_laser = params.laserSpotSize; // mm

    // GaAs photocathode at 532nm: QE ~ 1%, work function φ ~ 1.4 eV, hν = 2.33 eV
    const QE = 0.01;
    const hv_eV = 2.33; // 532nm photon energy
    const phi_eV = 1.4; // GaAs work function

    // I = QE * P_laser / (hν in joules) * e
    const hv_J = hv_eV * PHYS.e;
    const I_amps = QE * P_laser / hv_J * PHYS.e;
    const beamCurrent = I_amps * 1000; // mA

    // Intrinsic emittance: ε = r_laser * sqrt((hν - φ) / (3 * mc²))
    const excessEnergy_eV = hv_eV - phi_eV;
    const emittance = r_laser * Math.sqrt(excessEnergy_eV / (3 * PHYS.mc2_eV)) * 1000; // mm·mrad

    const cathodeQE = QE * 100; // percent

    return { beamCurrent, emittance, cathodeQE };
  },

  // NC RF Gun — peak field model
  ncRfGun(params) {
    const E_peak = params.peakField; // MV/m
    const phi_deg = params.rfPhase;
    const r_laser = params.laserSpotSize; // mm

    // Bunch charge scales with peak field: Q ~ 0.01 * E_peak (nC) at optimal phase
    const phi_rad = phi_deg * Math.PI / 180;
    const phaseFactor = Math.cos(phi_rad);
    const bunchCharge = 0.01 * E_peak * Math.max(phaseFactor, 0.1); // nC

    // Average current at 1 kHz rep rate: I = Q * f
    const repRate_Hz = 1000;
    const beamCurrent = bunchCharge * 1e-9 * repRate_Hz * 1000; // mA

    // RF emittance: ε_rf ∝ σ_z * E_peak * f_rf / mc²
    // Simplified: ε ~ r_laser * 0.5 + 0.3 * E_peak/100
    const emittance = r_laser * 0.5 + 0.3 * (E_peak / 100); // mm·mrad

    return { beamCurrent, emittance, bunchCharge };
  },

  // SRF Gun — CW operation
  srfGun(params) {
    const gradient = params.gradient; // MV/m
    const repRate = params.repRate; // kHz
    const r_laser = params.laserSpotSize; // mm

    // Bunch charge from gradient: Q ~ 0.005 * gradient (nC)
    const bunchCharge = 0.005 * gradient;

    // CW average current: I = Q * f
    const I_amps = bunchCharge * 1e-9 * repRate * 1000;
    const beamCurrent = I_amps * 1000; // mA

    // Cs2Te cathode at 265nm: hν=4.68eV, φ=3.5eV
    const excessEnergy_eV = 1.18;
    const emittance = r_laser * Math.sqrt(excessEnergy_eV / (3 * PHYS.mc2_eV)) * 1000; // mm·mrad

    return { beamCurrent, emittance };
  },
};

/**
 * Compute derived stats for a component given its current params.
 * @param {string} type - component type key (e.g., 'source', 'quadrupole')
 * @param {Object} params - current parameter values
 * @returns {Object|null} - derived stats, or null if type has no physics
 */
function computeStats(type, params) {
  const fn = COMPUTE_STATS[type];
  if (!fn) return null;
  return fn(params);
}

/**
 * Get default param values for a component type.
 * @param {string} type - component type key
 * @returns {Object|null} - { paramName: defaultValue } or null
 */
function getDefaults(type) {
  const defs = PARAM_DEFS[type];
  if (!defs) return null;
  const defaults = {};
  for (const [k, v] of Object.entries(defs)) {
    defaults[k] = v.default;
  }
  return defaults;
}

// Export for browser (global) and Node.js (require)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PARAM_DEFS, COMPUTE_STATS, computeStats, getDefaults, PHYS };
} else {
  window.PARAM_DEFS = PARAM_DEFS;
  window.computeStats = computeStats;
  window.getDefaults = getDefaults;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-component-physics.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add component-physics.js test/test-component-physics.js
git commit -m "feat: add component-physics.js with source formulas and tests"
```

---

### Task 2: Add magnet and RF cavity physics formulas

**Files:**
- Modify: `component-physics.js`
- Modify: `test/test-component-physics.js`

- [ ] **Step 1: Add magnet and cavity tests to test file**

Append to `test/test-component-physics.js`, before the final results line:

```js
// --- Quadrupole ---
console.log('-- Quadrupole --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.quadrupole)) {
    defaults[k] = v.default;
  }
  const result = computeStats('quadrupole', defaults);
  assert(result.focusStrength > 0, 'quadrupole produces positive focus strength');

  // Higher gradient → stronger focusing
  const lowG = computeStats('quadrupole', { ...defaults, gradient: 10 });
  const highG = computeStats('quadrupole', { ...defaults, gradient: 40 });
  assert(highG.focusStrength > lowG.focusStrength, 'higher gradient gives stronger focusing');
}

// --- Dipole ---
console.log('-- Dipole --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.dipole)) {
    defaults[k] = v.default;
  }
  const result = computeStats('dipole', defaults);
  assert(result.maxMomentum > 0, 'dipole produces positive max momentum');

  // Higher field → higher max momentum
  const lowB = computeStats('dipole', { ...defaults, fieldStrength: 0.5 });
  const highB = computeStats('dipole', { ...defaults, fieldStrength: 1.5 });
  assert(highB.maxMomentum > lowB.maxMomentum, 'higher field handles higher momentum');
}

// --- Solenoid ---
console.log('-- Solenoid --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.solenoid)) {
    defaults[k] = v.default;
  }
  const result = computeStats('solenoid', defaults);
  assert(result.focusStrength > 0, 'solenoid produces positive focus strength');
}

// --- RF Cavity ---
console.log('-- RF Cavity --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.rfCavity)) {
    defaults[k] = v.default;
  }
  const result = computeStats('rfCavity', defaults);
  assert(result.energyGain > 0, 'rfCavity produces positive energy gain');

  // Off-crest phase reduces energy gain
  const onCrest = computeStats('rfCavity', { ...defaults, rfPhase: 0 });
  const offCrest = computeStats('rfCavity', { ...defaults, rfPhase: -30 });
  assert(onCrest.energyGain > offCrest.energyGain, 'off-crest phase reduces energy gain');
}

// --- Cryomodule ---
console.log('-- Cryomodule --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.cryomodule)) {
    defaults[k] = v.default;
  }
  const result = computeStats('cryomodule', defaults);
  assert(result.energyGain > 0, 'cryomodule produces positive energy gain');
}

// --- Undulator ---
console.log('-- Undulator --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.undulator)) {
    defaults[k] = v.default;
  }
  const result = computeStats('undulator', defaults);
  assert(result.kParameter > 0, 'undulator produces positive K');
  assert(result.photonRate > 0, 'undulator produces positive photon rate');

  // Smaller gap → higher K
  const bigGap = computeStats('undulator', { ...defaults, gap: 20 });
  const smallGap = computeStats('undulator', { ...defaults, gap: 8 });
  assert(smallGap.kParameter > bigGap.kParameter, 'smaller gap gives higher K');
}
```

- [ ] **Step 2: Run test to verify new tests fail**

Run: `node test/test-component-physics.js`
Expected: FAIL — `PARAM_DEFS.quadrupole` is undefined

- [ ] **Step 3: Add PARAM_DEFS and COMPUTE_STATS for magnets, RF cavities, and insertion devices**

Add to `PARAM_DEFS` in `component-physics.js`:

```js
  // ── Quadrupoles ──────────────────────────────────────────────────────
  quadrupole: {
    gradient: { min: 1, max: 50, default: 20, unit: 'T/m', step: 0.5 },
    focusStrength: { min: 0, max: 20, default: 1, unit: 'T/m', step: 0.1, derived: true },
  },

  scQuad: {
    gradient: { min: 1, max: 200, default: 100, unit: 'T/m', step: 1 },
    focusStrength: { min: 0, max: 50, default: 2.5, unit: 'T/m', step: 0.1, derived: true },
  },

  // ── Dipoles ──────────────────────────────────────────────────────────
  dipole: {
    fieldStrength: { min: 0.1, max: 2.0, default: 1.0, unit: 'T', step: 0.01 },
    maxMomentum: { min: 0, max: 20, default: 3, unit: 'GeV/c', step: 0.1, derived: true },
  },

  scDipole: {
    fieldStrength: { min: 0.5, max: 8.0, default: 6.0, unit: 'T', step: 0.1 },
    maxMomentum: { min: 0, max: 100, default: 20, unit: 'GeV/c', step: 0.1, derived: true },
  },

  // ── Solenoid ─────────────────────────────────────────────────────────
  solenoid: {
    fieldStrength: { min: 0.01, max: 0.5, default: 0.2, unit: 'T', step: 0.01 },
    focusStrength: { min: 0, max: 5, default: 0.4, unit: '', step: 0.01, derived: true },
  },

  // ── Sextupole / Octupole ─────────────────────────────────────────────
  sextupole: {
    fieldStrength: { min: 10, max: 500, default: 100, unit: 'T/m²', step: 5 },
    beamQuality: { min: 0, max: 1, default: 0.3, unit: '', step: 0.01, derived: true },
  },

  octupole: {
    fieldStrength: { min: 10, max: 1000, default: 200, unit: 'T/m³', step: 10 },
    beamQuality: { min: 0, max: 0.5, default: 0.15, unit: '', step: 0.01, derived: true },
  },

  // ── RF Cavities ──────────────────────────────────────────────────────
  rfCavity: {
    voltage: { min: 0.1, max: 2.0, default: 1.0, unit: 'MV', step: 0.05 },
    rfPhase: { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 2, default: 0.5, unit: 'GeV', step: 0.01, derived: true },
    energySpread: { min: 0, max: 5, default: 0.1, unit: '%', step: 0.01, derived: true },
  },

  cbandCavity: {
    gradient: { min: 10, max: 50, default: 35, unit: 'MV/m', step: 0.5 },
    rfPhase: { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 2, default: 0.8, unit: 'GeV', step: 0.01, derived: true },
    energySpread: { min: 0, max: 5, default: 0.15, unit: '%', step: 0.01, derived: true },
  },

  xbandCavity: {
    gradient: { min: 20, max: 100, default: 65, unit: 'MV/m', step: 1 },
    rfPhase: { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 3, default: 1.2, unit: 'GeV', step: 0.01, derived: true },
    energySpread: { min: 0, max: 5, default: 0.2, unit: '%', step: 0.01, derived: true },
  },

  cryomodule: {
    gradient: { min: 5, max: 35, default: 25, unit: 'MV/m', step: 0.5 },
    rfPhase: { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 5, default: 2.0, unit: 'GeV', step: 0.01, derived: true },
    energySpread: { min: 0, max: 2, default: 0.05, unit: '%', step: 0.01, derived: true },
  },

  srf650Cavity: {
    gradient: { min: 5, max: 25, default: 18, unit: 'MV/m', step: 0.5 },
    rfPhase: { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 4, default: 1.5, unit: 'GeV', step: 0.01, derived: true },
    energySpread: { min: 0, max: 2, default: 0.03, unit: '%', step: 0.01, derived: true },
  },

  buncher: {
    voltage: { min: 0.01, max: 0.5, default: 0.1, unit: 'MV', step: 0.01 },
    rfPhase: { min: -90, max: 0, default: -90, unit: 'deg', step: 1 },
    bunchCompression: { min: 0, max: 1, default: 0.3, unit: '', step: 0.01, derived: true },
  },

  harmonicLinearizer: {
    voltage: { min: 0.01, max: 0.2, default: 0.05, unit: 'MV', step: 0.005 },
    rfPhase: { min: -180, max: 180, default: 180, unit: 'deg', step: 1 },
    bunchCompression: { min: 0, max: 0.5, default: 0.2, unit: '', step: 0.01, derived: true },
    beamQuality: { min: 0, max: 0.5, default: 0.2, unit: '', step: 0.01, derived: true },
  },

  // ── Insertion Devices ────────────────────────────────────────────────
  undulator: {
    gap: { min: 5, max: 30, default: 10, unit: 'mm', step: 0.5 },
    kParameter: { min: 0, max: 5, default: 1.5, unit: '', step: 0.01, derived: true },
    photonRate: { min: 0, max: 5, default: 1, unit: '×10¹²', step: 0.01, derived: true },
    photonEnergy: { min: 0, max: 100, default: 10, unit: 'keV', step: 0.1, derived: true },
  },

  helicalUndulator: {
    gap: { min: 5, max: 30, default: 10, unit: 'mm', step: 0.5 },
    kParameter: { min: 0, max: 5, default: 1.5, unit: '', step: 0.01, derived: true },
    photonRate: { min: 0, max: 8, default: 1.5, unit: '×10¹²', step: 0.01, derived: true },
    photonEnergy: { min: 0, max: 100, default: 10, unit: 'keV', step: 0.1, derived: true },
  },

  wiggler: {
    gap: { min: 10, max: 50, default: 20, unit: 'mm', step: 1 },
    kParameter: { min: 0, max: 30, default: 10, unit: '', step: 0.1, derived: true },
    photonRate: { min: 0, max: 10, default: 2, unit: '×10¹²', step: 0.01, derived: true },
    photonEnergy: { min: 0, max: 200, default: 30, unit: 'keV', step: 0.1, derived: true },
  },

  apple2Undulator: {
    gap: { min: 5, max: 30, default: 10, unit: 'mm', step: 0.5 },
    polarizationMode: { min: 0, max: 2, default: 0, unit: '', step: 1, labels: ['Linear H', 'Circular', 'Linear V'] },
    kParameter: { min: 0, max: 5, default: 2.5, unit: '', step: 0.01, derived: true },
    photonRate: { min: 0, max: 8, default: 1.8, unit: '×10¹²', step: 0.01, derived: true },
    photonEnergy: { min: 0, max: 100, default: 10, unit: 'keV', step: 0.1, derived: true },
  },

  // ── Beam Manipulation ────────────────────────────────────────────────
  corrector: {
    kickAngle: { min: -2, max: 2, default: 0, unit: 'mrad', step: 0.1 },
  },

  combinedFunctionMagnet: {
    dipoleField: { min: 0.1, max: 2.0, default: 1.2, unit: 'T', step: 0.05 },
    quadGradient: { min: 1, max: 50, default: 20, unit: 'T/m', step: 0.5 },
    focusStrength: { min: 0, max: 10, default: 0.8, unit: '', step: 0.01, derived: true },
  },

  kickerMagnet: {
    kickAngle: { min: 0.5, max: 10, default: 5, unit: 'mrad', step: 0.1 },
    riseTime: { min: 5, max: 100, default: 25, unit: 'ns', step: 1 },
  },
```

Add to `COMPUTE_STATS` in `component-physics.js`:

```js
  // Quadrupole — normalized gradient: k = 0.2998 * G / p
  quadrupole(params) {
    const G = params.gradient; // T/m
    // Assume 1 GeV/c beam for default display — actual value overridden by beamline calc
    const p_GeV = 1.0;
    const focusStrength = 0.2998 * G / p_GeV;
    return { focusStrength };
  },

  scQuad(params) {
    const G = params.gradient;
    const p_GeV = 1.0;
    const focusStrength = 0.2998 * G / p_GeV;
    return { focusStrength };
  },

  // Dipole — max momentum from field and bend radius
  dipole(params) {
    const B = params.fieldStrength; // T
    // 90-deg bend over length 3m → radius = length/(π/2) ≈ 1.91m
    const bendLength = 3.0;
    const rho = bendLength / (Math.PI / 2);
    const maxMomentum = 0.2998 * B * rho; // GeV/c
    return { maxMomentum };
  },

  scDipole(params) {
    const B = params.fieldStrength;
    const bendLength = 3.0;
    const rho = bendLength / (Math.PI / 2);
    const maxMomentum = 0.2998 * B * rho;
    return { maxMomentum };
  },

  // Solenoid — thin-lens focusing
  solenoid(params) {
    const B = params.fieldStrength; // T
    // f = 4 * p² / (e² * B² * L), simplified: focusStrength ∝ B²
    const L = 1.0; // 1m length
    const focusStrength = 0.088 * B * B * L * 1000; // arbitrary scaled units matching game
    return { focusStrength };
  },

  // Sextupole — chromaticity correction
  sextupole(params) {
    const S = params.fieldStrength; // T/m²
    // beamQuality improvement scales with sextupole strength (diminishing returns)
    const beamQuality = 0.3 * (1 - Math.exp(-S / 150));
    return { beamQuality };
  },

  // Octupole — Landau damping
  octupole(params) {
    const O = params.fieldStrength; // T/m³
    const beamQuality = 0.15 * (1 - Math.exp(-O / 300));
    return { beamQuality };
  },

  // RF Cavity — energy gain = V * T * cos(φ)
  rfCavity(params) {
    const V = params.voltage; // MV
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const transitTimeFactor = 0.85; // typical for pillbox-like
    const energyGain = V * transitTimeFactor * Math.cos(phi_rad) / 1000; // GeV
    const energySpread = 0.1 * Math.abs(Math.sin(phi_rad)) + 0.02; // %
    return { energyGain: Math.max(energyGain, 0), energySpread };
  },

  cbandCavity(params) {
    const G = params.gradient; // MV/m
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const length = 2; // m (active length)
    const energyGain = G * length * Math.cos(phi_rad) / 1000; // GeV
    const energySpread = 0.15 * Math.abs(Math.sin(phi_rad)) + 0.03;
    return { energyGain: Math.max(energyGain, 0), energySpread };
  },

  xbandCavity(params) {
    const G = params.gradient;
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const length = 2;
    const energyGain = G * length * Math.cos(phi_rad) / 1000;
    const energySpread = 0.2 * Math.abs(Math.sin(phi_rad)) + 0.04;
    return { energyGain: Math.max(energyGain, 0), energySpread };
  },

  cryomodule(params) {
    const G = params.gradient;
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const length = 5; // m (cryomodule active length)
    const energyGain = G * length * Math.cos(phi_rad) / 1000;
    const energySpread = 0.05 * Math.abs(Math.sin(phi_rad)) + 0.01;
    return { energyGain: Math.max(energyGain, 0), energySpread };
  },

  srf650Cavity(params) {
    const G = params.gradient;
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const length = 4; // m
    const energyGain = G * length * Math.cos(phi_rad) / 1000;
    const energySpread = 0.03 * Math.abs(Math.sin(phi_rad)) + 0.01;
    return { energyGain: Math.max(energyGain, 0), energySpread };
  },

  buncher(params) {
    const V = params.voltage; // MV
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    // Bunching at -90 deg phase = maximum compression
    const bunchCompression = 0.3 * V * Math.abs(Math.sin(phi_rad));
    return { bunchCompression: Math.min(bunchCompression, 0.8) };
  },

  harmonicLinearizer(params) {
    const V = params.voltage;
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const bunchCompression = 0.2 * V * (1 + Math.cos(phi_rad));
    const beamQuality = 0.2 * V * (1 + Math.cos(phi_rad));
    return {
      bunchCompression: Math.min(bunchCompression, 0.5),
      beamQuality: Math.min(beamQuality, 0.4),
    };
  },

  // Undulator — K and photon energy from gap
  undulator(params) {
    const gap = params.gap; // mm
    const period = 30; // mm (fixed by design)
    // B_peak decays exponentially with gap/period
    const B_peak = 3.0 * Math.exp(-Math.PI * gap / period);
    const kParameter = 0.0934 * period * B_peak;
    // Photon rate scales with K (up to saturation)
    const photonRate = 1.0 * kParameter / (1 + kParameter * kParameter / 2);
    // Photon energy: assume 3 GeV beam
    const E_GeV = 3.0;
    const photonEnergy = 0.665 * E_GeV * E_GeV / (period / 10 * (1 + kParameter * kParameter / 2));
    return { kParameter, photonRate: Math.max(photonRate, 0), photonEnergy };
  },

  helicalUndulator(params) {
    const gap = params.gap;
    const period = 30;
    const B_peak = 3.0 * Math.exp(-Math.PI * gap / period);
    const kParameter = 0.0934 * period * B_peak;
    const photonRate = 1.5 * kParameter / (1 + kParameter * kParameter / 2);
    const E_GeV = 3.0;
    const photonEnergy = 0.665 * E_GeV * E_GeV / (period / 10 * (1 + kParameter * kParameter / 2));
    return { kParameter, photonRate: Math.max(photonRate, 0), photonEnergy };
  },

  wiggler(params) {
    const gap = params.gap;
    const period = 80; // mm
    const B_peak = 3.0 * Math.exp(-Math.PI * gap / period);
    const kParameter = 0.0934 * period * B_peak;
    const photonRate = 2.0 * Math.min(kParameter / 10, 1);
    const E_GeV = 3.0;
    const photonEnergy = 0.665 * E_GeV * E_GeV * kParameter / (period / 10 * (1 + kParameter * kParameter / 2));
    return { kParameter, photonRate: Math.max(photonRate, 0), photonEnergy };
  },

  apple2Undulator(params) {
    const gap = params.gap;
    const period = 40;
    const B_peak = 3.0 * Math.exp(-Math.PI * gap / period);
    const kParameter = 0.0934 * period * B_peak;
    // Polarization mode affects rate slightly
    const modeFactor = [1.0, 0.9, 0.95][params.polarizationMode || 0];
    const photonRate = 1.8 * kParameter / (1 + kParameter * kParameter / 2) * modeFactor;
    const E_GeV = 3.0;
    const photonEnergy = 0.665 * E_GeV * E_GeV / (period / 10 * (1 + kParameter * kParameter / 2));
    return { kParameter, photonRate: Math.max(photonRate, 0), photonEnergy };
  },

  // Corrector — just returns kickAngle (no derived)
  corrector(params) {
    return {};
  },

  combinedFunctionMagnet(params) {
    const G = params.quadGradient;
    const p_GeV = 1.0;
    const focusStrength = 0.2998 * G / p_GeV;
    return { focusStrength };
  },

  kickerMagnet(params) {
    return {};
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-component-physics.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add component-physics.js test/test-component-physics.js
git commit -m "feat: add magnet, cavity, and insertion device physics formulas"
```

---

### Task 3: Add low-energy RF components and physics

**Files:**
- Modify: `component-physics.js`
- Modify: `data.js` (lines 389-470, RF Cavities section)
- Modify: `test/test-component-physics.js`

- [ ] **Step 1: Add low-energy RF tests**

Append to `test/test-component-physics.js` before the results line:

```js
// Stub new components for tests
global.COMPONENTS.pillboxCavity = { id: 'pillboxCavity', length: 1 };
global.COMPONENTS.rfq = { id: 'rfq', length: 3 };
global.COMPONENTS.dtl = { id: 'dtl', length: 3 };

// --- Pillbox Cavity ---
console.log('-- Pillbox Cavity --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.pillboxCavity)) {
    defaults[k] = v.default;
  }
  const result = computeStats('pillboxCavity', defaults);
  assert(result.energyGain > 0, 'pillboxCavity produces positive energy gain');
  assert(result.energyGain < 0.002, 'pillboxCavity energy gain is in MeV range (< 2 MeV as GeV)');
}

// --- RFQ ---
console.log('-- RFQ --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.rfq)) {
    defaults[k] = v.default;
  }
  const result = computeStats('rfq', defaults);
  assert(result.energyGain > 0, 'RFQ produces positive energy gain');
  assert(result.bunchCompression > 0, 'RFQ produces bunch compression');
}

// --- DTL ---
console.log('-- DTL --');
{
  const defaults = {};
  for (const [k, v] of Object.entries(PARAM_DEFS.dtl)) {
    defaults[k] = v.default;
  }
  const result = computeStats('dtl', defaults);
  assert(result.energyGain > 0, 'DTL produces positive energy gain');
  assert(result.energyGain > 0.005, 'DTL energy gain is meaningful (> 5 MeV as GeV)');
}
```

- [ ] **Step 2: Run test to verify new tests fail**

Run: `node test/test-component-physics.js`
Expected: FAIL — `PARAM_DEFS.pillboxCavity` is undefined

- [ ] **Step 3: Add PARAM_DEFS and COMPUTE_STATS for low-energy RF**

Add to `PARAM_DEFS` in `component-physics.js`:

```js
  // ── Low-Energy RF ────────────────────────────────────────────────────
  pillboxCavity: {
    voltage: { min: 0.05, max: 2.0, default: 0.5, unit: 'MV', step: 0.05 },
    rfPhase: { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 0.002, default: 0.0005, unit: 'GeV', step: 0.0001, derived: true },
  },

  rfq: {
    intervaneVoltage: { min: 20, max: 150, default: 80, unit: 'kV', step: 1 },
    rfPhase: { min: -60, max: 0, default: -30, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 0.005, default: 0.003, unit: 'GeV', step: 0.0001, derived: true },
    bunchCompression: { min: 0, max: 1, default: 0.5, unit: '', step: 0.01, derived: true },
  },

  dtl: {
    gradient: { min: 1, max: 5, default: 3, unit: 'MV/m', step: 0.1 },
    rfPhase: { min: -40, max: 0, default: -25, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 0.05, default: 0.008, unit: 'GeV', step: 0.001, derived: true },
  },
```

Add to `COMPUTE_STATS`:

```js
  // Pillbox cavity — simple single-cell
  pillboxCavity(params) {
    const V = params.voltage; // MV
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const transitTimeFactor = 0.7; // lower for simple geometry
    const energyGain = V * transitTimeFactor * Math.cos(phi_rad) / 1000; // GeV
    return { energyGain: Math.max(energyGain, 0) };
  },

  // RFQ — simultaneous bunching and acceleration
  rfq(params) {
    const V_kV = params.intervaneVoltage; // kV
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    // RFQ energy gain: ~3 MeV over 3m with 80 kV vanes
    const energyGain = (V_kV / 80) * 0.003 * Math.cos(phi_rad + Math.PI / 6); // GeV
    // Bunch compression from RF focusing
    const bunchCompression = 0.5 * Math.abs(Math.sin(phi_rad));
    return {
      energyGain: Math.max(energyGain, 0),
      bunchCompression: Math.min(bunchCompression, 0.8),
    };
  },

  // DTL — Alvarez drift-tube linac
  dtl(params) {
    const G = params.gradient; // MV/m
    const phi_deg = params.rfPhase;
    const phi_rad = phi_deg * Math.PI / 180;
    const length = 3; // m active length
    const cellEfficiency = 0.9; // cell-length packing efficiency
    const energyGain = G * length * cellEfficiency * Math.cos(phi_rad) / 1000; // GeV
    return { energyGain: Math.max(energyGain, 0) };
  },
```

- [ ] **Step 4: Add the 3 new components to data.js**

Add after the `buncher` component definition (around line 406 in `data.js`), before the `harmonicLinearizer`:

```js
  pillboxCavity: {
    id: 'pillboxCavity',
    name: 'Pillbox Cavity',
    desc: 'Simple single-cell copper cavity for initial low-energy acceleration. Provides 0.1-1 MeV energy gain at 200 MHz. Cheap and compact — a good first accelerating structure right after the source. Normal-conducting, no cryo required.',
    category: 'rf',
    subsection: 'lowEnergy',
    cost: { funding: 150 },
    stats: { energyGain: 0.0005 },
    energyCost: 3,
    length: 1,
    trackLength: 1,
    interiorVolume: 5,
    unlocked: true,
    spriteKey: 'pillboxCavity',
    spriteColor: 0xcc9900,
    params: { voltage: 0.5, rfPhase: 0 },
  },
  rfq: {
    id: 'rfq',
    name: 'RFQ',
    desc: 'Radio-Frequency Quadrupole that simultaneously bunches and accelerates beam from keV to ~3 MeV. The classic first accelerating structure after a source — it captures the DC beam and forms it into bunches while gently accelerating. Operates at 352 MHz.',
    category: 'rf',
    subsection: 'lowEnergy',
    cost: { funding: 600 },
    stats: { energyGain: 0.003, bunchCompression: 0.5 },
    energyCost: 6,
    length: 3,
    trackLength: 3,
    interiorVolume: 15,
    unlocked: true,
    spriteKey: 'rfq',
    spriteColor: 0xcc9900,
    params: { intervaneVoltage: 80, rfPhase: -30 },
  },
  dtl: {
    id: 'dtl',
    name: 'Drift-Tube Linac',
    desc: 'Alvarez-style drift-tube linac that efficiently accelerates bunched beams from ~3 MeV to ~50 MeV. Each drift tube shields the beam from the decelerating RF phase. The workhorse of low-energy proton and ion acceleration. Requires properly bunched beam input.',
    category: 'rf',
    subsection: 'lowEnergy',
    cost: { funding: 800 },
    stats: { energyGain: 0.008 },
    energyCost: 8,
    length: 5,
    trackLength: 3,
    interiorVolume: 25,
    requires: 'bunchCompression',
    spriteKey: 'dtl',
    spriteColor: 0xcc9900,
    params: { gradient: 3, rfPhase: -25 },
  },
```

- [ ] **Step 5: Run tests**

Run: `node test/test-component-physics.js`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add component-physics.js data.js test/test-component-physics.js
git commit -m "feat: add pillbox cavity, RFQ, and DTL low-energy RF components"
```

---

### Task 4: Add subsection metadata to data.js

**Files:**
- Modify: `data.js` (lines 82-117, MODES and categories)

This task adds `subsection` fields to all existing components and `subsections` definitions to all categories. It also creates the new `endpoint` category and moves endpoint components into it.

- [ ] **Step 1: Update MODES categories to include subsections and new endpoint tab**

In `data.js`, replace the beamline categories block (lines 84-92):

```js
  beamline: {
    name: 'Beamline',
    categories: {
      source:     { name: 'Sources',     color: '#4a9', subsections: { electron: { name: 'Electron' }, utility: { name: 'Utility' } } },
      focusing:   { name: 'Focusing',    color: '#c44', subsections: { normalConducting: { name: 'Normal' }, superconducting: { name: 'Superconducting' } } },
      rf:         { name: 'RF / Accel',  color: '#c90', subsections: { lowEnergy: { name: 'Low Energy' }, highEnergy: { name: 'High Energy' } } },
      diagnostic: { name: 'Diagnostics', color: '#44c', subsections: { monitors: { name: 'Beam Monitors' }, spectrometers: { name: 'Spectrometers' } } },
      beamOptics: { name: 'Beam Optics', color: '#a4a', subsections: { insertionDevices: { name: 'Insertion Devices' }, manipulation: { name: 'Manipulation' } } },
      endpoint:   { name: 'Endpoints',   color: '#864', subsections: { detectors: { name: 'Detectors' }, targets: { name: 'Targets' }, photon: { name: 'Photon' } } },
    },
  },
```

- [ ] **Step 2: Add `subsection` field to every beamline component**

Add `subsection` field to each component in `data.js`. This is a bulk edit — add the field right after the `category` field for each component:

**Sources:**
- `source`: add `subsection: 'electron',`
- `dcPhotoGun`: add `subsection: 'electron',`
- `ncRfGun`: add `subsection: 'electron',`
- `srfGun`: add `subsection: 'electron',`
- `drift`: add `subsection: 'utility',`
- `bellows`: add `subsection: 'utility',`

**Focusing:**
- `dipole`: add `subsection: 'normalConducting',`
- `quadrupole`: add `subsection: 'normalConducting',`
- `solenoid`: add `subsection: 'normalConducting',`
- `corrector`: add `subsection: 'normalConducting',`
- `combinedFunctionMagnet`: add `subsection: 'normalConducting',`
- `octupole`: add `subsection: 'normalConducting',`
- `scQuad`: add `subsection: 'superconducting',`
- `scDipole`: add `subsection: 'superconducting',`

**RF / Accel:**
- `rfCavity`: add `subsection: 'highEnergy',`
- `buncher`: add `subsection: 'lowEnergy',`
- `pillboxCavity`: already has `subsection: 'lowEnergy',` (from Task 3)
- `rfq`: already has `subsection: 'lowEnergy',` (from Task 3)
- `dtl`: already has `subsection: 'lowEnergy',` (from Task 3)
- `harmonicLinearizer`: add `subsection: 'highEnergy',`
- `cbandCavity`: add `subsection: 'highEnergy',`
- `xbandCavity`: add `subsection: 'highEnergy',`
- `cryomodule`: add `subsection: 'highEnergy',`
- `srf650Cavity`: add `subsection: 'highEnergy',`

**Diagnostics** (monitors only):
- `bpm`: add `subsection: 'monitors',`
- `screen`: add `subsection: 'monitors',`
- `ict`: add `subsection: 'monitors',`
- `wireScanner`: add `subsection: 'monitors',`
- `bunchLengthMonitor`: add `subsection: 'monitors',`
- `beamLossMonitor`: add `subsection: 'monitors',`
- `srLightMonitor`: add `subsection: 'monitors',`
- `energySpectrometer`: add `subsection: 'spectrometers',`

**Beam Optics:**
- `undulator`: add `subsection: 'insertionDevices',`
- `helicalUndulator`: add `subsection: 'insertionDevices',`
- `wiggler`: add `subsection: 'insertionDevices',`
- `apple2Undulator`: add `subsection: 'insertionDevices',`
- `collimator`: add `subsection: 'manipulation',`
- `sextupole`: add `subsection: 'manipulation',`
- `kickerMagnet`: add `subsection: 'manipulation',`
- `septumMagnet`: add `subsection: 'manipulation',`
- `chicane`: add `subsection: 'manipulation',`
- `dogleg`: add `subsection: 'manipulation',`
- `stripperFoil`: add `subsection: 'manipulation',`
- `splitter`: add `subsection: 'manipulation',`

**Endpoints** (change `category` from `diagnostic` to `endpoint`):
- `detector`: change `category: 'diagnostic'` to `category: 'endpoint', subsection: 'detectors',`
- `target`: change `category: 'diagnostic'` to `category: 'endpoint', subsection: 'targets',`
- `fixedTargetAdv`: change `category: 'diagnostic'` to `category: 'endpoint', subsection: 'targets',`
- `positronTarget`: change `category: 'diagnostic'` to `category: 'endpoint', subsection: 'targets',`
- `photonPort`: change `category: 'diagnostic'` to `category: 'endpoint', subsection: 'photon',`
- `comptonIP`: change `category: 'diagnostic'` to `category: 'endpoint', subsection: 'photon',`

- [ ] **Step 3: Add new UNITS entries for new param types**

Add to the `UNITS` object in `data.js`:

```js
  // New tunability params
  extractionVoltage: 'kV',
  cathodeTemperature: 'K',
  laserPower: 'W',
  laserSpotSize: 'mm',
  repRate: 'kHz',
  intervaneVoltage: 'kV',
  maxMomentum: 'GeV/c',
  photonEnergy: 'keV',
  energySpread: '%',
  gap: 'mm',
  polarizationMode: '',
  bunchCharge: 'nC',
  rfPhase: 'deg',
```

- [ ] **Step 4: Verify the game still loads**

Open `index.html` in a browser and confirm the palette renders without JS errors. (Console should be clean.)

- [ ] **Step 5: Commit**

```bash
git add data.js
git commit -m "feat: add subsection metadata, endpoint category, and reorganize components"
```

---

### Task 5: Update palette rendering for subsections

**Files:**
- Modify: `renderer.js` (lines 1001-1162, `_renderPalette` method)
- Modify: `style.css`

- [ ] **Step 1: Add subsection CSS styles**

Append to `style.css`:

```css
/* Palette subsections */
.palette-subsection {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-subsection-label {
  font-size: 7px;
  color: rgba(200, 160, 100, 0.5);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  padding: 0 4px;
  white-space: nowrap;
}

.palette-subsection-items {
  display: flex;
  gap: 6px;
}

.palette-subsection-divider {
  width: 1px;
  background: rgba(200, 160, 100, 0.2);
  margin: 0 4px;
  align-self: stretch;
}
```

- [ ] **Step 2: Update `_renderPalette` to group by subsections**

In `renderer.js`, replace the beamline component loop in `_renderPalette` (the `for (const [key, comp] of Object.entries(COMPONENTS))` block at line 1085-1161) with subsection-aware rendering:

```js
    // Get subsection definitions from category
    const mode = MODES[this.activeMode];
    const catDef = mode?.categories?.[compCategory];
    const subsections = catDef?.subsections;

    // Collect components for this category
    const catComps = [];
    for (const [key, comp] of Object.entries(COMPONENTS)) {
      if (comp.category !== compCategory) continue;
      catComps.push({ key, comp });
    }

    if (subsections && Object.keys(subsections).length > 0) {
      // Render with subsection grouping
      const subKeys = Object.keys(subsections);
      subKeys.forEach((subKey, subIdx) => {
        const subDef = subsections[subKey];
        const subComps = catComps.filter(({ comp }) => {
          if (comp.subsection) return comp.subsection === subKey;
          // Default to first subsection if not specified
          return subIdx === 0;
        });

        if (subComps.length === 0) return;

        // Add divider between subsections (not before first)
        if (subIdx > 0) {
          const divider = document.createElement('div');
          divider.className = 'palette-subsection-divider';
          palette.appendChild(divider);
        }

        const section = document.createElement('div');
        section.className = 'palette-subsection';

        const label = document.createElement('div');
        label.className = 'palette-subsection-label';
        label.textContent = subDef.name;
        section.appendChild(label);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'palette-subsection-items';

        for (const { key, comp } of subComps) {
          const item = this._createPaletteItem(key, comp, paletteIdx);
          paletteIdx++;
          itemsContainer.appendChild(item);
        }

        section.appendChild(itemsContainer);
        palette.appendChild(section);
      });
    } else {
      // No subsections — flat rendering (original behavior)
      for (const { key, comp } of catComps) {
        const item = this._createPaletteItem(key, comp, paletteIdx);
        paletteIdx++;
        palette.appendChild(item);
      }
    }
```

- [ ] **Step 3: Extract `_createPaletteItem` helper method**

Add a new method to the Renderer class (extract from the existing palette item creation code in `_renderPalette`):

```js
  _createPaletteItem(key, comp, idx) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.dataset.paletteIndex = idx;

    const unlocked = this.game.isComponentUnlocked(comp);
    const affordable = this.game.canAfford(comp.cost);

    if (!unlocked) item.classList.add('locked');
    if (!affordable) item.classList.add('unaffordable');

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'palette-name';
    nameEl.textContent = comp.name;
    item.appendChild(nameEl);

    // Cost
    const costEl = document.createElement('div');
    costEl.className = 'palette-cost';
    const costs = Object.entries(comp.cost).map(([r, a]) => `${this._fmt(a)} ${r}`).join(', ');
    costEl.textContent = unlocked ? costs : 'Locked';
    item.appendChild(costEl);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'palette-tooltip';
    const ttName = document.createElement('div');
    ttName.className = 'tt-name';
    ttName.textContent = comp.name;
    tooltip.appendChild(ttName);

    const ttDesc = document.createElement('div');
    ttDesc.className = 'tt-desc';
    ttDesc.textContent = comp.desc || '';
    tooltip.appendChild(ttDesc);

    const ttStats = document.createElement('div');
    ttStats.className = 'tt-stats';

    const statEntries = [
      ['Cost', costs],
      ['Energy Cost', `${comp.energyCost} E/s`],
      ['Length', `${comp.length} m`],
    ];
    if (comp.stats) {
      for (const [k, v] of Object.entries(comp.stats)) {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        statEntries.push([label, v]);
      }
    }
    if (comp.requires) {
      const reqs = Array.isArray(comp.requires) ? comp.requires : [comp.requires];
      statEntries.push(['Requires', reqs.join(', ')]);
    }
    for (const [label, val] of statEntries) {
      const row = document.createElement('div');
      row.className = 'tt-stat-row';
      row.innerHTML = `<span>${label}</span><span class="tt-stat-val">${val}</span>`;
      ttStats.appendChild(row);
    }
    tooltip.appendChild(ttStats);
    item.appendChild(tooltip);

    if (unlocked) {
      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(idx);
        if (this._onToolSelect) this._onToolSelect(key);
      });
    }

    return item;
  }
```

- [ ] **Step 4: Verify palette renders with subsections**

Open `index.html` in browser. Check:
- Sources tab shows "Electron" and "Utility" subsections with a divider
- RF / Accel shows "Low Energy" and "High Energy"
- Endpoints tab appears and contains detector, targets, photon port
- Diagnostics no longer shows endpoint components

- [ ] **Step 5: Commit**

```bash
git add renderer.js style.css
git commit -m "feat: render palette subsections with labels and dividers"
```

---

### Task 6: Add slider UI to component popup

**Files:**
- Modify: `renderer.js` (lines 551-625, `showPopup` method)
- Modify: `style.css`
- Modify: `index.html`

- [ ] **Step 1: Add slider CSS styles**

Append to `style.css`:

```css
/* Parameter sliders in popup */
#component-popup {
  width: 320px;
}

.popup-sliders {
  margin: 8px 0;
  padding-top: 6px;
  border-top: 1px solid rgba(100, 80, 60, 0.2);
}

.popup-sliders .popup-section-label {
  margin-bottom: 8px;
}

.param-slider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 8px;
  color: rgba(160, 160, 200, 0.7);
}

.param-slider-row .param-label {
  width: 75px;
  flex-shrink: 0;
  text-align: right;
  font-size: 8px;
}

.param-slider-row input[type="range"] {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(80, 80, 120, 0.4);
  border-radius: 2px;
  outline: none;
}

.param-slider-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ee9944;
  cursor: pointer;
  border: 1px solid rgba(200, 120, 40, 0.8);
}

.param-slider-row input[type="range"]::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ee9944;
  cursor: pointer;
  border: 1px solid rgba(200, 120, 40, 0.8);
}

.param-slider-row .param-value {
  width: 55px;
  flex-shrink: 0;
  text-align: right;
  font-size: 8px;
  font-family: 'Press Start 2P', monospace;
  color: #ccccee;
}

.param-slider-row .param-unit {
  width: 35px;
  flex-shrink: 0;
  font-size: 7px;
  color: rgba(160, 160, 200, 0.4);
}

/* Derived (read-only) params */
.param-derived-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 8px;
  color: rgba(130, 130, 170, 0.6);
}

.param-derived-row .param-label {
  width: 75px;
  flex-shrink: 0;
  text-align: right;
  font-size: 8px;
}

.param-derived-row .param-value {
  flex: 1;
  text-align: right;
  font-size: 8px;
  font-family: 'Press Start 2P', monospace;
  color: rgba(180, 180, 220, 0.7);
}

.param-derived-row .param-unit {
  width: 35px;
  flex-shrink: 0;
  font-size: 7px;
  color: rgba(130, 130, 170, 0.4);
}

.param-derived-row.flash {
  color: #ee9944;
  transition: color 0.3s ease;
}

.param-derived-row .param-value.flash {
  color: #ee9944;
  transition: color 0.3s ease;
}
```

- [ ] **Step 2: Add script tag for component-physics.js in index.html**

In `index.html`, add the script tag before the other game scripts (find the existing `<script src="data.js">` tag and add right after it):

```html
  <script src="component-physics.js"></script>
```

- [ ] **Step 3: Extend `showPopup()` with slider panel**

In `renderer.js`, modify the `showPopup` method (lines 551-625). After the stats section and before the health bar, add the slider panel. Replace the entire method:

```js
  showPopup(node, screenX, screenY) {
    const popup = document.getElementById('component-popup');
    if (!popup) return;

    const comp = COMPONENTS[node.type];
    if (!comp) return;

    const title = popup.querySelector('.popup-title');
    if (title) title.textContent = comp.name;

    const body = popup.querySelector('.popup-body');
    if (body) {
      const health = this.game.getComponentHealth(node.id);
      const healthColor = health > 60 ? '#44dd66' : health > 25 ? '#ddaa22' : '#ff4444';
      const healthClass = health < 40 ? ' low' : '';

      const row = (label, val, unit) =>
        `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${val}</span>${unit ? `<span class="stat-unit">${unit}</span>` : ''}</div>`;

      let html = '';

      // Description
      if (comp.desc) {
        html += `<div class="popup-desc">${comp.desc}</div>`;
      }

      // Fixed stats
      html += '<div class="popup-stats">';
      html += '<div class="popup-section-label">Info</div>';
      html += row('Direction', DIR_NAMES[node.dir] || '--', '');
      html += row('Energy Cost', comp.energyCost, 'E/s');
      html += row('Length', comp.length, 'm');
      html += '</div>';

      // Parameter sliders (if this component type has paramDefs)
      const paramDefs = typeof PARAM_DEFS !== 'undefined' ? PARAM_DEFS[node.type] : null;
      if (paramDefs) {
        // Initialize node.params if missing (backwards compat with old saves)
        if (!node.params) {
          node.params = {};
          for (const [k, def] of Object.entries(paramDefs)) {
            if (!def.derived) node.params[k] = def.default;
          }
        }

        html += '<div class="popup-sliders">';
        html += '<div class="popup-section-label">Parameters</div>';

        // Adjustable sliders
        for (const [key, def] of Object.entries(paramDefs)) {
          if (def.derived) continue;
          const val = node.params[key] ?? def.default;
          if (def.labels) {
            // Discrete selector (e.g., polarization mode)
            html += `<div class="param-slider-row">`;
            html += `<span class="param-label">${this._paramLabel(key)}</span>`;
            html += `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param="${key}">`;
            html += `<span class="param-value" data-param-display="${key}">${def.labels[val] || val}</span>`;
            html += `<span class="param-unit">${def.unit}</span>`;
            html += `</div>`;
          } else {
            html += `<div class="param-slider-row">`;
            html += `<span class="param-label">${this._paramLabel(key)}</span>`;
            html += `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param="${key}">`;
            html += `<span class="param-value" data-param-display="${key}">${this._fmtParam(val)}</span>`;
            html += `<span class="param-unit">${def.unit}</span>`;
            html += `</div>`;
          }
        }

        // Derived readouts
        const derivedKeys = Object.entries(paramDefs).filter(([_, def]) => def.derived);
        if (derivedKeys.length > 0) {
          html += '<div class="popup-section-label" style="margin-top:6px">Output</div>';
          const computed = typeof computeStats !== 'undefined' ? computeStats(node.type, node.params) : null;
          for (const [key, def] of derivedKeys) {
            const val = computed ? computed[key] : (node.params[key] ?? def.default);
            html += `<div class="param-derived-row">`;
            html += `<span class="param-label">${this._paramLabel(key)}</span>`;
            html += `<span class="param-value" data-derived-display="${key}">${this._fmtParam(val)}</span>`;
            html += `<span class="param-unit">${def.unit}</span>`;
            html += `</div>`;
          }
        }

        html += '</div>';
      }

      // Health with bar
      html += `<div class="stat-row health-row${healthClass}"><span class="stat-label">Health</span><span class="stat-value">${Math.round(health)}%</span></div>`;
      html += `<div class="popup-health-bar"><div class="popup-health-fill" style="width:${health}%;background:${healthColor}"></div></div>`;

      // Actions
      const refund = Object.entries(comp.cost).map(([r, a]) => `${Math.floor(a * 0.5)} ${r}`).join(', ');
      html += '<div class="popup-actions">';
      html += `<button class="btn-danger" id="popup-remove-btn">Recycle (${refund})</button>`;
      html += '<button class="popup-probe-btn" id="popup-probe-btn">Probe</button>';
      html += '</div>';

      body.innerHTML = html;

      // Wire up slider events
      if (paramDefs) {
        this._wirePopupSliders(node, paramDefs, body);
      }

      document.getElementById('popup-remove-btn')?.addEventListener('click', () => {
        this.game.removeComponent(node.id);
        this.hidePopup();
      });

      document.getElementById('popup-probe-btn')?.addEventListener('click', () => {
        this.hidePopup();
        if (this.onProbeClick) this.onProbeClick(node);
      });
    }

    // Position near click, clamped to viewport
    popup.style.left = Math.min(screenX + 14, window.innerWidth - 340) + 'px';
    popup.style.top = Math.min(screenY + 14, window.innerHeight - 400) + 'px';
    popup.classList.remove('hidden');

    const closeBtn = popup.querySelector('.popup-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.hidePopup();
    }
  }
```

- [ ] **Step 4: Add helper methods to Renderer**

Add these methods to the Renderer class:

```js
  _paramLabel(key) {
    // Convert camelCase to Title Case
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  _fmtParam(val) {
    if (val === undefined || val === null) return '--';
    if (Math.abs(val) >= 100) return val.toFixed(0);
    if (Math.abs(val) >= 1) return val.toFixed(2);
    if (Math.abs(val) >= 0.01) return val.toFixed(3);
    return val.toExponential(2);
  }

  _wirePopupSliders(node, paramDefs, body) {
    let debounceTimer = null;

    const sliders = body.querySelectorAll('input[type="range"][data-param]');
    sliders.forEach(slider => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.param;
        const def = paramDefs[key];
        const val = parseFloat(slider.value);
        node.params[key] = val;

        // Update displayed value
        const display = body.querySelector(`[data-param-display="${key}"]`);
        if (display) {
          if (def.labels) {
            display.textContent = def.labels[val] || val;
          } else {
            display.textContent = this._fmtParam(val);
          }
        }

        // Debounced recalc
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // Recompute derived values
          if (typeof computeStats !== 'undefined') {
            const computed = computeStats(node.type, node.params);
            if (computed) {
              // Update derived displays
              for (const [dKey, dDef] of Object.entries(paramDefs)) {
                if (!dDef.derived) continue;
                const dDisplay = body.querySelector(`[data-derived-display="${dKey}"]`);
                if (dDisplay && computed[dKey] !== undefined) {
                  dDisplay.textContent = this._fmtParam(computed[dKey]);
                  // Flash animation
                  const row = dDisplay.closest('.param-derived-row');
                  if (row) {
                    row.classList.add('flash');
                    dDisplay.classList.add('flash');
                    setTimeout(() => {
                      row.classList.remove('flash');
                      dDisplay.classList.remove('flash');
                    }, 300);
                  }
                }
              }

              // Update component stats for game engine
              const comp = COMPONENTS[node.type];
              if (comp && comp.stats) {
                for (const [sk, sv] of Object.entries(computed)) {
                  if (sk in comp.stats) {
                    // Update the node's effective stats
                    if (!node.computedStats) node.computedStats = {};
                    node.computedStats[sk] = sv;
                  }
                }
              }
            }
          }

          // Trigger full beamline recalc
          this.game.recalcBeamline();
          this.game.emit('beamlineChanged');
        }, 50);
      });
    });
  }
```

- [ ] **Step 5: Verify slider popup works**

Open `index.html`, place a source, click it. Confirm:
- Sliders appear for extractionVoltage and cathodeTemperature
- Derived beamCurrent and emittance readouts show
- Moving a slider updates derived values with a flash
- Game beam stats update in the HUD

- [ ] **Step 6: Commit**

```bash
git add renderer.js style.css index.html
git commit -m "feat: add interactive parameter sliders to component popup"
```

---

### Task 7: Wire param initialization into beamline placement

**Files:**
- Modify: `beamline.js` (lines 61-79, `placeSource`; lines 82-111, `placeAt`)

- [ ] **Step 1: Initialize node.params from PARAM_DEFS on placement**

In `beamline.js`, modify `placeSource()` to initialize params. After the node object is created (line 67-77) and before `this.nodes.push(node)`:

```js
    // Initialize tunable params from PARAM_DEFS defaults
    if (typeof PARAM_DEFS !== 'undefined' && PARAM_DEFS['source']) {
      node.params = {};
      for (const [k, def] of Object.entries(PARAM_DEFS['source'])) {
        if (!def.derived) node.params[k] = def.default;
      }
    }
```

Similarly in `placeAt()`, after the node object is created (line 93-107) and before `this.nodes.push(node)`:

```js
    // Initialize tunable params from PARAM_DEFS defaults
    if (typeof PARAM_DEFS !== 'undefined' && PARAM_DEFS[compType]) {
      node.params = {};
      for (const [k, def] of Object.entries(PARAM_DEFS[compType])) {
        if (!def.derived) node.params[k] = def.default;
      }
    }
```

- [ ] **Step 2: Update recalcBeamline to use node params**

In `game.js`, modify `recalcBeamline()` (line 415-423) to pass node params to the physics engine:

Replace:
```js
    const physicsBeamline = ordered
      .map(node => {
        const t = COMPONENTS[node.type];
        return {
          type: node.type,
          length: t.length,
          stats: t.stats || {},
        };
      });
```

With:
```js
    const physicsBeamline = ordered
      .map(node => {
        const t = COMPONENTS[node.type];
        // Use computed stats from slider tuning if available, otherwise template defaults
        const effectiveStats = { ...(t.stats || {}) };
        if (node.computedStats) {
          Object.assign(effectiveStats, node.computedStats);
        }
        return {
          type: node.type,
          length: t.length,
          stats: effectiveStats,
          params: node.params || {},
        };
      });
```

- [ ] **Step 3: Verify placement initializes params**

Open `index.html`, place a source. Open browser console and run:
```js
game.beamline.nodes[0].params
```
Expected: `{ extractionVoltage: 50, cathodeTemperature: 1200 }`

- [ ] **Step 4: Commit**

```bash
git add beamline.js game.js
git commit -m "feat: initialize node params on placement and wire to physics engine"
```

---

### Task 8: Update existing tests and run full test suite

**Files:**
- Modify: `test/test-beamline.js`

- [ ] **Step 1: Update test stubs to include PARAM_DEFS**

In `test/test-beamline.js`, add a stub for `PARAM_DEFS` after the existing `COMPONENTS` stub (after line 24):

```js
global.PARAM_DEFS = {
  source: {
    extractionVoltage: { min: 10, max: 100, default: 50, derived: false },
    cathodeTemperature: { min: 600, max: 2000, default: 1200, derived: false },
    beamCurrent: { min: 0, max: 10, default: 1, derived: true },
    emittance: { min: 0, max: 50, default: 5, derived: true },
  },
};
```

- [ ] **Step 2: Add test that verifies param initialization**

Add a new test to `test/test-beamline.js`:

```js
console.log('-- Param initialization on placement --');
{
  const bl = new Beamline();
  const id = bl.placeSource(5, 5, DIR.NE);
  const node = bl.nodes.find(n => n.id === id);
  assert(node.params !== undefined, 'placed source has params');
  assert(node.params.extractionVoltage === 50, 'extractionVoltage initialized to default');
  assert(node.params.cathodeTemperature === 1200, 'cathodeTemperature initialized to default');
  assert(node.params.beamCurrent === undefined, 'derived param beamCurrent not in params');
}
```

- [ ] **Step 3: Run all tests**

Run: `node test/test-beamline.js && node test/test-component-physics.js`
Expected: All PASS in both test files

- [ ] **Step 4: Commit**

```bash
git add test/test-beamline.js
git commit -m "test: update beamline tests for param initialization"
```

---

### Task 9: Handle backwards compatibility for old saves

**Files:**
- Modify: `game.js` (in `load()` method)

- [ ] **Step 1: Find the load method**

Search for the `load()` method in `game.js` that calls `beamline.fromJSON()`.

- [ ] **Step 2: Add param migration to load**

After `this.beamline.fromJSON(data.beamline)` in the load method, add migration code:

```js
    // Migrate old saves: initialize params for nodes that don't have them
    if (typeof PARAM_DEFS !== 'undefined') {
      for (const node of this.beamline.nodes) {
        const defs = PARAM_DEFS[node.type];
        if (defs && !node.params) {
          node.params = {};
          for (const [k, def] of Object.entries(defs)) {
            if (!def.derived) node.params[k] = def.default;
          }
        }
      }
    }
```

Also migrate endpoint components — old saves may have `category: 'diagnostic'` for endpoint components. Add after the params migration:

```js
    // Migrate old saves: endpoint components that were previously 'diagnostic'
    // No action needed — category is read from COMPONENTS, not from saved nodes
```

- [ ] **Step 3: Test with a fresh save**

Open browser, start new game, place components, save, reload. Verify params persist and sliders show correct values.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "fix: migrate old saves to initialize component params"
```
