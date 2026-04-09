// component-physics.js — Source component physics formulas
// ES module version (no UMD wrapper)

// ---------------------------------------------------------------------------
// Physical constants (SI)
// ---------------------------------------------------------------------------
const e      = 1.602176634e-19;   // C  — elementary charge
const me     = 9.1093837015e-31;  // kg — electron rest mass
const c      = 2.99792458e8;      // m/s — speed of light
const k_B    = 1.380649e-23;      // J/K — Boltzmann constant
const h      = 6.62607015e-34;    // J·s — Planck constant
const mc2_eV = 510998.95;         // eV  — electron rest energy

// ---------------------------------------------------------------------------
// PARAM_DEFS
// Each non-derived param: { min, max, default, unit, step }
// Each derived param:     { derived: true, unit }
// ---------------------------------------------------------------------------
export const PARAM_DEFS = {

  // ---- Thermionic gun ----
  source: {
    extractionVoltage: {
      min: 10, max: 100, default: 50, unit: 'kV', step: 1,
    },
    cathodeTemperature: {
      min: 600, max: 2000, default: 1200, unit: 'K', step: 10,
    },
    beamCurrent: { derived: true, unit: 'mA' },
    emittance:   { derived: true, unit: 'mm·mrad' },
  },

  // ---- DC photocathode gun ----
  dcPhotoGun: {
    extractionVoltage: {
      min: 50, max: 300, default: 200, unit: 'kV', step: 5,
    },
    laserPower: {
      min: 0.01, max: 2, default: 0.5, unit: 'W', step: 0.01,
    },
    laserSpotSize: {
      min: 0.1, max: 3, default: 1.0, unit: 'mm', step: 0.05,
    },
    beamCurrent: { derived: true, unit: 'mA' },
    emittance:   { derived: true, unit: 'mm·mrad' },
    cathodeQE:   { derived: true, unit: '%' },
  },

  // ---- NC RF gun ----
  ncRfGun: {
    peakField: {
      min: 50, max: 150, default: 120, unit: 'MV/m', step: 1,
    },
    rfPhase: {
      min: -60, max: 0, default: -30, unit: 'deg', step: 1,
    },
    laserSpotSize: {
      min: 0.1, max: 3, default: 0.8, unit: 'mm', step: 0.05,
    },
    beamCurrent: { derived: true, unit: 'mA' },
    emittance:   { derived: true, unit: 'mm·mrad' },
    bunchCharge: { derived: true, unit: 'nC' },
  },

  // ---- SRF gun ----
  srfGun: {
    gradient: {
      min: 5, max: 40, default: 20, unit: 'MV/m', step: 0.5,
    },
    repRate: {
      min: 10, max: 1300, default: 650, unit: 'kHz', step: 10,
    },
    laserSpotSize: {
      min: 0.1, max: 3, default: 1.0, unit: 'mm', step: 0.05,
    },
    beamCurrent: { derived: true, unit: 'mA' },
    emittance:   { derived: true, unit: 'mm·mrad' },
  },

  // ---- Quadrupole ----
  quadrupole: {
    gradient:     { min: 1, max: 50, default: 20, unit: 'T/m', step: 0.5 },
    polarity:     { min: 0, max: 1, default: 0, unit: '', step: 1,
                    labels: { 0: 'Focus X', 1: 'Focus Y' } },
    focusStrength: { derived: true, unit: 'm⁻²' },
  },

  // ---- Superconducting quadrupole ----
  scQuad: {
    gradient:     { min: 1, max: 200, default: 100, unit: 'T/m', step: 1 },
    polarity:     { min: 0, max: 1, default: 0, unit: '', step: 1,
                    labels: { 0: 'Focus X', 1: 'Focus Y' } },
    focusStrength: { derived: true, unit: 'm⁻²' },
  },

  // ---- Dipole ----
  dipole: {
    fieldStrength: { min: 0.1, max: 2.0, default: 1.0, unit: 'T', step: 0.01 },
    maxMomentum:   { derived: true, unit: 'GeV/c' },
  },

  // ---- Superconducting dipole ----
  scDipole: {
    fieldStrength: { min: 0.5, max: 8.0, default: 6.0, unit: 'T', step: 0.1 },
    maxMomentum:   { derived: true, unit: 'GeV/c' },
  },

  // ---- Solenoid ----
  solenoid: {
    fieldStrength: { min: 0.01, max: 0.5, default: 0.2, unit: 'T', step: 0.01 },
    focusStrength: { derived: true, unit: 'm⁻²' },
  },

  // ---- Sextupole ----
  sextupole: {
    fieldStrength: { min: 10, max: 500, default: 100, unit: 'T/m²', step: 5 },
    beamQuality:   { derived: true, unit: '' },
  },

  // ---- Octupole ----
  octupole: {
    fieldStrength: { min: 10, max: 1000, default: 200, unit: 'T/m³', step: 10 },
    beamQuality:   { derived: true, unit: '' },
  },

  // ---- Normal-conducting RF cavity ----
  rfCavity: {
    voltage:    { min: 0.1, max: 2.0, default: 1.0, unit: 'MV', step: 0.01 },
    rfPhase:    { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:    { derived: true, unit: 'GeV' },
    energySpread:  { derived: true, unit: '' },
  },

  // ---- C-band cavity ----
  cbandCavity: {
    gradient: { min: 10, max: 50, default: 35, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // ---- X-band cavity ----
  xbandCavity: {
    gradient: { min: 20, max: 100, default: 65, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // ---- Cryomodule (SRF, 1.3 GHz, TESLA-style) ----
  cryomodule: {
    gradient: { min: 5, max: 35, default: 25, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // ---- SRF 650 MHz cavity ----
  srf650Cavity: {
    gradient: { min: 5, max: 25, default: 18, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // ---- Buncher cavity ----
  buncher: {
    voltage:         { min: 0.01, max: 0.5, default: 0.1, unit: 'MV', step: 0.01 },
    rfPhase:         { min: -90, max: 0, default: -90, unit: 'deg', step: 1 },
    bunchCompression: { derived: true, unit: '' },
  },

  // ---- Harmonic linearizer ----
  harmonicLinearizer: {
    voltage:         { min: 0.01, max: 0.2, default: 0.05, unit: 'MV', step: 0.005 },
    rfPhase:         { min: -180, max: 180, default: 180, unit: 'deg', step: 1 },
    bunchCompression: { derived: true, unit: '' },
    beamQuality:     { derived: true, unit: '' },
  },

  // ---- Undulator ----
  undulator: {
    gap:        { min: 5, max: 30, default: 10, unit: 'mm', step: 0.5 },
    kParameter:  { derived: true, unit: '' },
    photonRate:  { derived: true, unit: 'ph/s' },
    photonEnergy:{ derived: true, unit: 'keV' },
  },

  // ---- Helical undulator ----
  helicalUndulator: {
    gap:        { min: 5, max: 30, default: 10, unit: 'mm', step: 0.5 },
    kParameter:  { derived: true, unit: '' },
    photonRate:  { derived: true, unit: 'ph/s' },
    photonEnergy:{ derived: true, unit: 'keV' },
  },

  // ---- Wiggler ----
  wiggler: {
    gap:        { min: 10, max: 50, default: 20, unit: 'mm', step: 0.5 },
    kParameter:  { derived: true, unit: '' },
    photonRate:  { derived: true, unit: 'ph/s' },
    photonEnergy:{ derived: true, unit: 'keV' },
  },

  // ---- APPLE-2 undulator (variable polarization) ----
  apple2Undulator: {
    gap:              { min: 5, max: 30, default: 10, unit: 'mm', step: 0.5 },
    polarizationMode: {
      min: 0, max: 2, default: 0, unit: '', step: 1,
      labels: ['Linear H', 'Circular', 'Linear V'],
    },
    kParameter:  { derived: true, unit: '' },
    photonRate:  { derived: true, unit: 'ph/s' },
    photonEnergy:{ derived: true, unit: 'keV' },
  },

  // ---- Corrector magnet ----
  corrector: {
    kickAngle: { min: -2, max: 2, default: 0, unit: 'mrad', step: 0.01 },
  },

  // ---- Combined-function magnet ----
  combinedFunctionMagnet: {
    dipoleField:   { min: 0.1, max: 2.0, default: 1.2, unit: 'T', step: 0.01 },
    quadGradient:  { min: 1, max: 50, default: 20, unit: 'T/m', step: 0.5 },
    focusStrength: { derived: true, unit: 'm⁻²' },
  },

  // ---- Kicker magnet ----
  kickerMagnet: {
    kickAngle: { min: 0.5, max: 10, default: 5, unit: 'mrad', step: 0.1 },
    riseTime:  { min: 5, max: 100, default: 25, unit: 'ns', step: 1 },
  },

  // ---- Pillbox cavity (low-energy, 200 MHz) ----
  pillboxCavity: {
    voltage:    { min: 0.05, max: 2.0, default: 0.5, unit: 'MV', step: 0.05 },
    rfPhase:    { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 0.002, default: 0.0005, unit: 'GeV', step: 0.0001, derived: true },
  },

  // ---- RFQ (Radio-Frequency Quadrupole, 352 MHz) ----
  rfq: {
    intervaneVoltage: { min: 20, max: 150, default: 80, unit: 'kV', step: 1 },
    rfPhase:          { min: -60, max: 0, default: -30, unit: 'deg', step: 1 },
    energyGain:       { min: 0, max: 0.005, default: 0.003, unit: 'GeV', step: 0.0001, derived: true },
    bunchCompression: { min: 0, max: 1, default: 0.5, unit: '', step: 0.01, derived: true },
  },

  // ---- DTL (Drift-Tube Linac, Alvarez-style) ----
  dtl: {
    gradient:   { min: 1, max: 5, default: 3, unit: 'MV/m', step: 0.1 },
    rfPhase:    { min: -40, max: 0, default: -25, unit: 'deg', step: 1 },
    energyGain: { min: 0, max: 0.05, default: 0.008, unit: 'GeV', step: 0.001, derived: true },
  },
};

// ---------------------------------------------------------------------------
// getDefaults(type) — return object of { param: defaultValue } for non-derived
// ---------------------------------------------------------------------------
export function getDefaults(type) {
  const defs = PARAM_DEFS[type];
  if (!defs) return {};
  const result = {};
  for (const [key, def] of Object.entries(defs)) {
    if (!def.derived) {
      result[key] = def.default;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// COMPUTE_STATS implementations
// ---------------------------------------------------------------------------

/**
 * Thermionic gun — Child-Langmuir space-charge limited emission.
 *
 * I = P * V^(3/2)   (Child-Langmuir law, planar diode approximation)
 * P ≈ (4ε₀/9) * sqrt(2e/me) * A / d²
 *
 * We use a simplified perveance calibrated so that at V=50 kV we get ~50 mA,
 * which is realistic for a thermionic gun.
 *
 * Thermal emittance (rms, normalised):
 * εₙ = r_cathode * sqrt(k_B * T / (me * c²))
 * where r_cathode is estimated from the extraction voltage (higher V → larger
 * beam optics, we use a fixed cathode radius of 3 mm as representative).
 */
function computeSource(params) {
  const V_kV = params.extractionVoltage;  // kV
  const T    = params.cathodeTemperature; // K

  // Child-Langmuir: I [mA] = P_perv * (V[kV])^(3/2)
  // Calibrated: at 50 kV → ~50 mA  →  P_perv = 50 / 50^1.5 ≈ 0.2828
  const P_perv = 0.2828; // mA / kV^(3/2)
  const beamCurrent = P_perv * Math.pow(V_kV, 1.5); // mA

  // Thermal emittance: ε [mm·mrad] = r_mm * sqrt(k_B * T / (me * c²))
  // r_cathode = 3 mm (fixed representative value)
  const r_mm = 3.0;
  const kTmc2 = (k_B * T) / (me * c * c); // dimensionless
  const emittance = r_mm * Math.sqrt(kTmc2) * 1e3; // convert to mm·mrad

  return { beamCurrent, emittance };
}

/**
 * DC photocathode gun.
 *
 * QE model for Cs2Te at 263 nm (typical FLASH/LCLS cathode):
 *   QE ≈ QE0 * exp(-E_threshold / E_photon)  — simplified Fowler-Dubridge
 * We use a fixed representative QE of ~1% (tuned for realism).
 *
 * Photon energy at 263 nm: E_ph = hc/λ = 4.72 eV
 * Current: I [mA] = QE * P_laser [W] * e / (h * ν)
 *                  = QE * P_laser / E_ph_J
 *
 * Intrinsic emittance from excess photon energy (Dowell-Schmerge model):
 *   εₙ = r_σ [mm] * sqrt((E_ph - φ) / (3 * mc²))
 * where φ = 3.7 eV work function for Cs2Te, mc² in eV.
 *
 * Spot-size contribution (geometric emittance dominates at larger spots):
 *   ε_geom = r_σ [mm] * sqrt(e * V / mc²)  (from the gun momentum)
 * We take emittance = sqrt(ε_intrinsic² + ε_geom_spot²) as representative.
 */
function computeDcPhotoGun(params) {
  const V_kV   = params.extractionVoltage; // kV
  const P_W    = params.laserPower;        // W
  const r_mm   = params.laserSpotSize;     // mm (1-sigma RMS)

  // Photon parameters for UV laser (263 nm)
  const lambda = 263e-9; // m
  const E_ph_J = (h * c) / lambda;         // J
  const E_ph_eV = E_ph_J / e;              // eV  ≈ 4.72

  // Representative QE for Cs2Te at 263 nm (~1%)
  const phi_eV = 3.7;  // work function [eV]
  const QE0    = 0.03; // max QE at threshold (calibration constant)
  const QE_frac = QE0 * Math.sqrt(Math.max(0, E_ph_eV - phi_eV) / phi_eV);
  const cathodeQE = QE_frac * 100; // percent

  // Average current: I = QE * P / E_ph_J  →  C/s = A  →  convert to mA
  const beamCurrent = (QE_frac * P_W / E_ph_J) * e * 1e3; // mA

  // Intrinsic emittance (Dowell-Schmerge):
  const excess_eV = Math.max(0, E_ph_eV - phi_eV);
  const eps_intrinsic = r_mm * Math.sqrt(excess_eV / (3.0 * mc2_eV)); // mm·mrad

  // Geometric contribution from extraction field (accelerating to ~V keV)
  // ε_geom ≈ r_mm * sqrt(V_keV / (2 * mc2_keV))  — simplified
  const V_eV = V_kV * 1e3;
  const eps_geom = r_mm * Math.sqrt(V_eV / (2.0 * mc2_eV));

  // Total (add in quadrature, dominated by geom in DC gun)
  const emittance = Math.sqrt(eps_intrinsic * eps_intrinsic + eps_geom * eps_geom);

  return { beamCurrent, emittance, cathodeQE };
}

/**
 * NC RF gun (1.3 GHz, S-band ~2.856 GHz or L-band 1.3 GHz typical).
 *
 * Bunch charge from RF gun (Kim 1989 / Carlsten model):
 *   Q [nC] ≈ k_charge * (E_peak [MV/m])^2 * r_spot² [mm²]
 * Calibrated so that E=120 MV/m, r=0.8 mm → Q ~ 1 nC.
 *
 * Average current (at 120 Hz rep rate typical for NC LINAC):
 *   I [mA] = Q [nC] * f_rep [Hz] * 1e-6
 * We use f_rep = 120 Hz as a fixed representative value for NC guns.
 *
 * RF emittance (Carlsten):
 *   ε_rf [mm·mrad] = k_rf * r_spot³ * E_peak * cos(φ)
 *   k_rf calibrated to give ~1 mm·mrad at E=120, r=0.8, φ=-30°.
 *
 * Thermal/intrinsic emittance from spot:
 *   ε_th = r_spot * sqrt(E_excess / (3 mc²))  (same as DC case)
 */
function computeNcRfGun(params) {
  const E_MV   = params.peakField;    // MV/m
  const phi_deg = params.rfPhase;     // degrees (negative = injection phase)
  const r_mm   = params.laserSpotSize; // mm

  // Bunch charge
  // k_charge calibrated: 120² * 0.8² * k = 1 nC  → k = 1/(14400*0.64) ≈ 1.085e-4
  const k_charge = 1.085e-4; // nC / (MV/m)² / mm²
  const bunchCharge = k_charge * E_MV * E_MV * r_mm * r_mm; // nC

  // Average current at 120 Hz
  const f_rep = 120; // Hz — representative NC linac rep rate
  const beamCurrent = bunchCharge * f_rep * 1e-6; // mA  (nC * Hz = nA → *1e-3 = mA? no: nC*Hz=nA, *1e-3=μA; fix below)
  // Correct: Q[C] * f[Hz] = I[A] → I[mA] = Q[nC]*1e-9 * f * 1e3 = Q[nC]*f*1e-6
  // Already correct above.

  // RF emittance (Carlsten term)
  const phi_rad = phi_deg * Math.PI / 180.0;
  // k_rf calibrated: at E=120, r=0.8, cos(-30°)=0.866 → ε≈1
  // k_rf * 120 * 0.8^3 * 0.866 = 1  → k_rf = 1/(120*0.512*0.866) ≈ 0.01878
  const k_rf = 0.01878; // mm·mrad / (MV/m) / mm³
  const eps_rf = k_rf * E_MV * r_mm * r_mm * r_mm * Math.abs(Math.cos(phi_rad));

  // Intrinsic emittance from cathode (UV photocathode, same as DC)
  const E_ph_eV = 4.72;
  const phi_work_eV = 3.7;
  const excess_eV = Math.max(0, E_ph_eV - phi_work_eV);
  const eps_intrinsic = r_mm * Math.sqrt(excess_eV / (3.0 * mc2_eV));

  const emittance = Math.sqrt(eps_rf * eps_rf + eps_intrinsic * eps_intrinsic);

  return { beamCurrent, emittance, bunchCharge };
}

/**
 * SRF gun (Cs2Te photocathode, CW or high-rep-rate operation).
 *
 * Bunch charge from SRF gun:
 *   Q [nC] ≈ k_srf * gradient [MV/m] * r_spot² [mm²]
 * At 20 MV/m, r=1.0 mm → Q ~ 0.1 nC (typical for SRF CW guns like bERLinPro).
 *
 * Average current (CW operation):
 *   I [mA] = Q [nC] * repRate [kHz]  (repRate in kHz, Q in nC → I in μA; fix units)
 *   I [mA] = Q [nC] * repRate [kHz] * 1e3 [Hz/kHz] * 1e-9 [C/nC] * 1e3 [mA/A]
 *          = Q [nC] * repRate [kHz] * 1e-3
 *
 * Emittance (Cs2Te intrinsic + spot-size geometric from SRF field):
 *   ε = r_spot * sqrt(excess_eV / (3 * mc²))   [intrinsic]
 *   Geometric from RF kick negligible in SRF guns (low gradient, low emittance).
 */
function computeSrfGun(params) {
  const G_MV   = params.gradient;    // MV/m
  const f_kHz  = params.repRate;     // kHz
  const r_mm   = params.laserSpotSize; // mm

  // Bunch charge: calibrated at G=20, r=1 → Q=0.1 nC
  // k_srf * 20 * 1² = 0.1  → k_srf = 0.005
  const k_srf = 0.005; // nC / (MV/m) / mm²
  const bunchCharge = k_srf * G_MV * r_mm * r_mm; // nC

  // Average current: Q[nC] * f[kHz] * 1e-3 = I[mA]
  const beamCurrent = bunchCharge * f_kHz * 1e-3; // mA

  // Intrinsic emittance (Cs2Te at 263 nm, Dowell-Schmerge)
  const E_ph_eV     = 4.72;
  const phi_work_eV = 3.7;
  const excess_eV   = Math.max(0, E_ph_eV - phi_work_eV);
  const emittance   = r_mm * Math.sqrt(excess_eV / (3.0 * mc2_eV)); // mm·mrad

  return { beamCurrent, emittance };
}

// ---------------------------------------------------------------------------
// Magnet physics
// ---------------------------------------------------------------------------

/**
 * Quadrupole / scQuad — thin-lens focusing strength.
 * k [m⁻²] = 0.2998 * G [T/m] / p [GeV/c]
 * We display for a 1 GeV/c beam.
 */
function computeQuadrupole(params) {
  const G = params.gradient; // T/m
  const p_GeV = 1.0;         // representative beam momentum
  const focusStrength = 0.2998 * G / p_GeV;
  return { focusStrength };
}

/**
 * Dipole / scDipole — maximum momentum that can be bent through 90° over a
 * 3 m arc (rho = L/θ = 3 m for θ=π/2 → rho = 6/π ≈ 1.91 m).
 * p_max [GeV/c] = 0.2998 * B [T] * rho [m]
 */
function computeDipole(params) {
  const B = params.fieldStrength; // T
  const rho = 3.0 / (Math.PI / 2); // ~1.909 m
  const maxMomentum = 0.2998 * B * rho;
  return { maxMomentum };
}

/**
 * Solenoid — thin-lens focal length from integrated B² (paraxial optics).
 * f⁻¹ [m⁻²] = (e / (2*p))² * ∫B² dz ≈ (0.1499 * B)² * L
 * Use representative L=0.5 m, p=1 GeV/c (in SI-like units, factored out).
 * Simplified: focusStrength = 0.0225 * B² (calibrated for display).
 */
function computeSolenoid(params) {
  const B = params.fieldStrength; // T
  const L = 0.5;                  // m — representative active length
  const focusStrength = Math.pow(0.1499 * B, 2) * L;
  return { focusStrength };
}

/**
 * Sextupole — chromatic correction quality metric (normalised 0–1).
 * beamQuality = 0.3 * (1 - exp(-S/150))  where S = fieldStrength [T/m²]
 */
function computeSextupole(params) {
  const S = params.fieldStrength;
  const beamQuality = 0.3 * (1 - Math.exp(-S / 150));
  return { beamQuality };
}

/**
 * Octupole — nonlinear detuning quality metric.
 * beamQuality = 0.15 * (1 - exp(-O/300))
 */
function computeOctupole(params) {
  const O = params.fieldStrength;
  const beamQuality = 0.15 * (1 - Math.exp(-O / 300));
  return { beamQuality };
}

// ---------------------------------------------------------------------------
// RF cavity physics
// ---------------------------------------------------------------------------

/**
 * Normal-conducting RF cavity.
 * energyGain [GeV] = V [MV] * 0.85 * cos(φ) / 1000
 * energySpread      = 0.01 * |sin(φ)|  (relative, dimensionless)
 */
function computeRfCavity(params) {
  const V       = params.voltage; // MV
  const phi_rad = params.rfPhase * Math.PI / 180;
  const energyGain   = V * 0.85 * Math.cos(phi_rad) / 1000; // GeV
  const energySpread = 0.01 * Math.abs(Math.sin(phi_rad));
  return { energyGain, energySpread };
}

/**
 * C-band cavity (active length 0.6 m representative).
 * energyGain [GeV] = G [MV/m] * length [m] * cos(φ) / 1000
 */
function computeCbandCavity(params) {
  const G       = params.gradient; // MV/m
  const phi_rad = params.rfPhase * Math.PI / 180;
  const length  = 0.6; // m
  const energyGain   = G * length * Math.cos(phi_rad) / 1000;
  const energySpread = 0.008 * Math.abs(Math.sin(phi_rad));
  return { energyGain, energySpread };
}

/**
 * X-band cavity (active length 0.23 m representative).
 */
function computeXbandCavity(params) {
  const G       = params.gradient; // MV/m
  const phi_rad = params.rfPhase * Math.PI / 180;
  const length  = 0.23; // m
  const energyGain   = G * length * Math.cos(phi_rad) / 1000;
  const energySpread = 0.008 * Math.abs(Math.sin(phi_rad));
  return { energyGain, energySpread };
}

/**
 * Cryomodule (TESLA 9-cell, 1.3 GHz, active length 5 m for 8 cavities).
 * Lower energy spread due to CW / low-loss operation.
 */
function computeCryomodule(params) {
  const G       = params.gradient; // MV/m
  const phi_rad = params.rfPhase * Math.PI / 180;
  const length  = 5.0; // m active
  const energyGain   = G * length * Math.cos(phi_rad) / 1000;
  const energySpread = 0.003 * Math.abs(Math.sin(phi_rad));
  return { energyGain, energySpread };
}

/**
 * SRF 650 MHz cavity (active length 4 m).
 */
function computeSrf650Cavity(params) {
  const G       = params.gradient; // MV/m
  const phi_rad = params.rfPhase * Math.PI / 180;
  const length  = 4.0; // m active
  const energyGain   = G * length * Math.cos(phi_rad) / 1000;
  const energySpread = 0.003 * Math.abs(Math.sin(phi_rad));
  return { energyGain, energySpread };
}

/**
 * Buncher cavity — compresses bunch longitudinally.
 * bunchCompression = 0.3 * V [MV] * |sin(φ)|, capped at 0.8
 */
function computeBuncher(params) {
  const V       = params.voltage; // MV
  const phi_rad = params.rfPhase * Math.PI / 180;
  const bunchCompression = Math.min(0.8, 0.3 * V * Math.abs(Math.sin(phi_rad)));
  return { bunchCompression };
}

/**
 * Harmonic linearizer — 3rd-harmonic cavity for chirp linearisation.
 * Operates at φ=180° (decelerating) to flatten the energy-time correlation.
 * bunchCompression = 0.5 * V * (1 + cos(φ))   [0 at 180°, max at 0°]
 * beamQuality      = 0.4 * V * (1 + cos(φ))
 */
function computeHarmonicLinearizer(params) {
  const V       = params.voltage; // MV
  const phi_rad = params.rfPhase * Math.PI / 180;
  const factor  = 1 + Math.cos(phi_rad);
  const bunchCompression = 0.5 * V * factor;
  const beamQuality      = 0.4 * V * factor;
  return { bunchCompression, beamQuality };
}

// ---------------------------------------------------------------------------
// Insertion device physics
// ---------------------------------------------------------------------------

/**
 * Shared undulator/wiggler helper.
 * B_peak = B_0 * exp(-π * gap / period)  (Halbach formula, B_0 = 3 T)
 * K = 0.0934 * period [mm] * B_peak [T]
 * photonEnergy [keV] ∝ γ² * K (simplified, γ=2000 representative for 1 GeV)
 * photonRate [arb] ∝ K²  (total power ∝ K²)
 */
function _undulatorCalc(gap_mm, period_mm, rateScale) {
  const B_0    = 3.0; // T — peak field at gap→0
  const B_peak = B_0 * Math.exp(-Math.PI * gap_mm / period_mm);
  const kParam = 0.0934 * period_mm * B_peak;
  const gamma  = 2000; // representative (1 GeV electrons)
  // First harmonic energy: E1 = 0.95 * gamma^2 * (1/period_m) / (1 + K²/2) keV (simplified)
  const period_m = period_mm * 1e-3;
  const photonEnergy = 0.95e-3 * gamma * gamma / (period_m * (1 + kParam * kParam / 2)); // keV
  const photonRate   = rateScale * kParam * kParam; // relative units
  return { kParameter: kParam, photonRate, photonEnergy };
}

function computeUndulator(params) {
  return _undulatorCalc(params.gap, 20, 1.0);
}

function computeHelicalUndulator(params) {
  const base = _undulatorCalc(params.gap, 20, 1.5);
  return base;
}

function computeWiggler(params) {
  return _undulatorCalc(params.gap, 80, 2.0);
}

function computeApple2Undulator(params) {
  // polarizationMode affects effective K: 0=Linear H (full K), 1=Circular (0.707x), 2=Linear V (full K)
  const base = _undulatorCalc(params.gap, 20, 1.8);
  const mode = params.polarizationMode !== undefined ? params.polarizationMode : 0;
  const kFactor = (mode === 1) ? 0.707 : 1.0;
  return {
    kParameter:  base.kParameter * kFactor,
    photonRate:  base.photonRate * kFactor * kFactor,
    photonEnergy: base.photonEnergy,
  };
}

// ---------------------------------------------------------------------------
// Beam manipulation — no derived outputs
// ---------------------------------------------------------------------------

function computeCorrector(/* params */) {
  return {};
}

function computeKickerMagnet(/* params */) {
  return {};
}

function computeCombinedFunctionMagnet(params) {
  const G = params.quadGradient; // T/m
  const p_GeV = 1.0;
  const focusStrength = 0.2998 * G / p_GeV;
  return { focusStrength };
}

// ---------------------------------------------------------------------------
// Low-energy RF physics
// ---------------------------------------------------------------------------

/**
 * Pillbox cavity — single-cell copper cavity, 200 MHz.
 * energyGain [GeV] = V [MV] * 0.7 * cos(φ) / 1000   (transit time factor 0.7)
 */
function computePillboxCavity(params) {
  const V       = params.voltage; // MV
  const phi_rad = params.rfPhase * Math.PI / 180;
  const energyGain = V * 0.7 * Math.cos(phi_rad) / 1000; // GeV
  return { energyGain };
}

/**
 * RFQ — simultaneous bunching and acceleration from keV to ~3 MeV.
 * energyGain [GeV]      = (V_kV/80) * 0.003 * cos(φ + π/6)
 * bunchCompression       = 0.5 * |sin(φ)|, capped at 0.8
 */
function computeRfq(params) {
  const V_kV    = params.intervaneVoltage; // kV
  const phi_rad = params.rfPhase * Math.PI / 180;
  const energyGain      = (V_kV / 80) * 0.003 * Math.cos(phi_rad + Math.PI / 6);
  const bunchCompression = Math.min(0.8, 0.5 * Math.abs(Math.sin(phi_rad)));
  return { energyGain, bunchCompression };
}

/**
 * DTL — Alvarez drift-tube linac, accelerates 3–50 MeV.
 * energyGain [GeV] = G [MV/m] * 3 [m] * 0.9 * cos(φ) / 1000
 */
function computeDtl(params) {
  const G       = params.gradient; // MV/m
  const phi_rad = params.rfPhase * Math.PI / 180;
  const energyGain = G * 3 * 0.9 * Math.cos(phi_rad) / 1000; // GeV
  return { energyGain };
}

// ---------------------------------------------------------------------------
// COMPUTE_STATS dispatch table
// ---------------------------------------------------------------------------
const COMPUTE_STATS = {
  source:     computeSource,
  dcPhotoGun: computeDcPhotoGun,
  ncRfGun:    computeNcRfGun,
  srfGun:     computeSrfGun,
  // magnets
  quadrupole:             computeQuadrupole,
  scQuad:                 computeQuadrupole,
  dipole:                 computeDipole,
  scDipole:               computeDipole,
  solenoid:               computeSolenoid,
  sextupole:              computeSextupole,
  octupole:               computeOctupole,
  // RF cavities
  rfCavity:               computeRfCavity,
  cbandCavity:            computeCbandCavity,
  xbandCavity:            computeXbandCavity,
  cryomodule:             computeCryomodule,
  srf650Cavity:           computeSrf650Cavity,
  buncher:                computeBuncher,
  harmonicLinearizer:     computeHarmonicLinearizer,
  // insertion devices
  undulator:              computeUndulator,
  helicalUndulator:       computeHelicalUndulator,
  wiggler:                computeWiggler,
  apple2Undulator:        computeApple2Undulator,
  // beam manipulation
  corrector:              computeCorrector,
  kickerMagnet:           computeKickerMagnet,
  combinedFunctionMagnet: computeCombinedFunctionMagnet,
  // low-energy RF
  pillboxCavity:          computePillboxCavity,
  rfq:                    computeRfq,
  dtl:                    computeDtl,
};

/**
 * computeStats(type, params) — compute derived stats for a source component.
 * @param {string} type   — component type key (e.g. 'source', 'dcPhotoGun')
 * @param {object} params — object with param values (non-derived keys)
 * @returns {object}      — derived stats { beamCurrent, emittance, ... }
 */
export function computeStats(type, params) {
  const fn = COMPUTE_STATS[type];
  if (!fn) return {};
  return fn(params);
}
