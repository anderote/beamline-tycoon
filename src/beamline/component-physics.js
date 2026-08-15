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
  // Cathode heat raises the available emission/beam power; extraction voltage
  // trades that power between current and injection energy. The resulting
  // 20-900 mA range makes high current easy to create but leaves the existing
  // space-charge and aperture-loss modules to decide how much is transportable.
  source: {
    extractionVoltage: {
      min: 25, max: 250, default: 50, unit: 'kV', step: 5,
    },
    cathodeTemperature: {
      min: 600, max: 2000, default: 1200, unit: 'K', step: 10,
    },
    beamCurrent:      { derived: true, unit: 'mA' },
    beamPower:        { derived: true, unit: 'kW' },
    extractionEnergy: { derived: true, unit: 'GeV' },
    emittance:        { derived: true, unit: 'mm·mrad' },
  },

  // ---- Duoplasmatron ion source ----
  // Proton source. Extraction energy is q·V just as for the thermionic gun
  // (species-independent), so without an entry here the beam silently
  // started at the engine's 0.01 GeV default instead of the declared 40 keV.
  ionSource: {
    extractionVoltage: {
      min: 10, max: 100, default: 40, unit: 'kV', step: 1,
    },
    arcCurrent: {
      min: 1, max: 20, default: 5, unit: 'A', step: 0.5,
    },
    beamCurrent:      { derived: true, unit: 'mA' },
    extractionEnergy: { derived: true, unit: 'GeV' },
  },

  // ---- ECR ion source ----
  // Same extraction physics; current comes from the microwave power heating
  // the plasma, with the mirror field setting the confinement efficiency.
  ecrIonSource: {
    extractionVoltage: {
      min: 10, max: 100, default: 40, unit: 'kV', step: 1,
    },
    microwavePower: {
      min: 200, max: 6000, default: 2500, unit: 'W', step: 50,
    },
    magnetCurrent: {
      min: 50, max: 500, default: 250, unit: 'A', step: 5,
    },
    beamCurrent:      { derived: true, unit: 'mA' },
    extractionEnergy: { derived: true, unit: 'GeV' },
  },

  // ---- Penning ion source ----
  penningIonSource: {
    extractionVoltage: {
      min: 10, max: 80, default: 30, unit: 'kV', step: 1,
    },
    dischargeCurrent: {
      min: 0.5, max: 10, default: 2.5, unit: 'A', step: 0.25,
    },
    magneticField: {
      min: 0.05, max: 0.3, default: 0.15, unit: 'T', step: 0.01,
    },
    beamCurrent:      { derived: true, unit: 'mA' },
    extractionEnergy: { derived: true, unit: 'GeV' },
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
    extractionEnergy: { derived: true, unit: 'GeV' },
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
    extractionEnergy: { derived: true, unit: 'GeV' },
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
    extractionEnergy: { derived: true, unit: 'GeV' },
  },

  // ---- Quadrupole ----
  quadrupole: {
    // Magnet focusing is k = 0.2998 g / p, so the gradient a beam wants scales
    // with its momentum: ~0.01 T/m at 10 MeV, ~0.8 at 1 GeV, ~8 at 10 GeV for a
    // gentle 1 m quad. The old 1 T/m floor was only usable above ~1 GeV, so
    // low-energy transport had no workable setting at all.
    gradient:     { min: 0.01, max: 50, default: 20, unit: 'T/m', step: 0.01 },
    polarity:     { min: 0, max: 1, default: 0, unit: '', step: 1,
                    labels: { 0: 'Focus X', 1: 'Focus Y' } },
    focusStrength: { derived: true, unit: 'm⁻²' },
  },

  // ---- Superconducting quadrupole ----
  scQuad: {
    gradient:     { min: 0.05, max: 200, default: 100, unit: 'T/m', step: 0.05 },
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
  // The floor used to be 0.01 T and the default 0.2 T, which meant the entire
  // slider was "beam gone" at the energies a solenoid is FOR. Measured with
  // scripts/eval-design.mjs — 250 kV gun, 20 mA, one 1 m solenoid, transmission
  // to a Faraday cup:
  //
  //     0.5 T  -> 100% loss (peak sigma 765 mm)   0.05 T -> 83% loss
  //     0.2 T  ->  98% loss                       0.02 T -> 31% loss
  //     0.1 T  -> 100% loss                       0.01 T ->  0% loss  <- old min
  //     0.005 T -> 0% loss (peak sigma 8.5 mm)    0.002 T -> 0% (3.5 mm)
  //
  // The arithmetic agrees. solenoid_matrix uses k = 0.2998 B / (2p), so at
  // p = 5.84e-4 GeV/c (a 250 keV electron) k = 256.7 B per metre, and the
  // quarter-wave match kL = pi/2 over the component's own 1 m length wants
  // B = 0.0061 T — BELOW the old minimum. 98% of the control's travel sat past
  // the point where the beam is already on the wall, and the one setting that
  // worked was the end stop.
  //
  // Same bug as the quadrupole gradient floor two entries down, which was
  // widened from 1 to 0.01 T/m for the same reason: a magnet range picked for
  // GeV beams, applied to a front end where the beam is a thousand times
  // softer. The max stays 0.5 T because it becomes useful once the beam
  // stiffens — at 1 GeV the same 1 m solenoid gives kL = 0.075.
  solenoid: {
    fieldStrength: { min: 0.001, max: 0.5, default: 0.005, unit: 'T', step: 0.001 },
    focusStrength: { derived: true, unit: 'm⁻²' },
  },

  // ---- Energy degrader + energy-selection system ----
  // One knob, and it is the output energy rather than a wedge thickness,
  // because the output energy is what the operator of a real ESS dials in and
  // what the treatment plan is written in. The range is the IBA Cyclone 230's
  // clinical range exactly: 230 MeV is wedge-out (no degradation at all) and
  // 70 MeV is as low as a clinical line goes before the transmission is not
  // worth the activation.
  energyDegrader: {
    outputEnergy:  { min: 70, max: 230, default: 150, unit: 'MeV', step: 1 },
    energyGain:    { derived: true, unit: 'GeV' },
    transmission:  { derived: true, unit: '%' },
    beamQuality:   { derived: true, unit: '' },
  },

  // ---- Scanning magnets ----
  // Scan field is the side of the square the magnets paint, at the target.
  // 5 mm is "don't scan, just point" and 400 mm covers a 40 cm treatment field
  // or a fully defocused irradiation sample.
  scanningMagnet: {
    scanFieldMm: { min: 5, max: 400, default: 175, unit: 'mm', step: 5 },
    // bendAngle is in GAME units — gameplay.py scales it by 15/90 on the way
    // into the engine, so it reads 6x the physical angle. `deflection` is the
    // same quantity in units a person can check against a nozzle drawing.
    bendAngle:   { derived: true, unit: '' },
    deflection:  { derived: true, unit: 'mrad' },
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

  // ---- Cryomodule (SRF, 1.3 GHz, TESLA-style) ----
  cryomodule: {
    gradient: { min: 5, max: 35, default: 25, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // ---- The RF ladder -------------------------------------------------------
  // Nine placements from 0.12 to 15 GeV. Every one of them takes its energy
  // gain as `gradient x the placement's own length`, so the DEFAULT gradient
  // here is not a taste decision: PARAM_DEFS defaults beat the catalogue's
  // `params` (see seedComponentParams) and computeStats OVERLAYS the
  // catalogue's `stats` (see physics-payload.js). If the default does not
  // reproduce the catalogue `energyGain` exactly, the component silently
  // delivers something other than what it advertises, and the placement-count
  // guarantees the whole ladder was designed around stop being true.
  //
  // Each default below is therefore written as `energyGain [MeV] / length [m]`
  // rather than as a rounded number, and gameplay.py derives the same quantity
  // a third way (energyGain * 1000 / length) for the utility solve. All three
  // agree by construction.
  //
  // The upper rungs quote gradients no single device reaches — one placement
  // is a cryostring or a sector standing for several modules, and the
  // catalogue `desc` is where that is said out loud.

  // 0.12 GeV over 3 m. 40 MV/m is a real C-band number (SACLA, SwissFEL).
  cbandStructure: {
    gradient: { min: 10, max: 50, default: 120 / 3, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 0.30 GeV over 3 m. 100 MV/m is the CLIC X-band design gradient.
  xbandStructure: {
    gradient: { min: 20, max: 120, default: 300 / 3, unit: 'MV/m', step: 1 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 0.15 GeV over 10 m. 15 MV/m is what a beta=0.61 elliptical really runs.
  srf650Cryomodule: {
    gradient: { min: 5, max: 20, default: 150 / 10, unit: 'MV/m', step: 0.5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 0.40 GeV over 12 m — about two real 805 MHz cryomodules per placement.
  srf805Cryomodule: {
    gradient: { min: 10, max: 45, default: 400 / 12, unit: 'MV/m', step: 0.1 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 0.50 GeV over 12 m — about three LCLS-II-class CW modules per placement.
  cwCryomodule: {
    gradient: { min: 15, max: 55, default: 500 / 12, unit: 'MV/m', step: 0.1 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 1.2 GeV over 12 m — about six modules per placement.
  nbSnCryomodule: {
    gradient: { min: 40, max: 130, default: 1200 / 12, unit: 'MV/m', step: 1 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 3.5 GeV over 16 m — a full cryogenic sector under one placement.
  srfLinacSector: {
    gradient: { min: 100, max: 260, default: 3500 / 16, unit: 'MV/m', step: 1.25 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // 6.0 GeV over 12 m. Not a klystron-fed structure — the drive beam does the
  // work — so there is no cavity model behind it in srf.py.
  twoBeamModule: {
    gradient: { min: 200, max: 600, default: 6000 / 12, unit: 'MV/m', step: 5 },
    rfPhase:  { min: -40, max: 40, default: 0, unit: 'deg', step: 1 },
    energyGain:   { derived: true, unit: 'GeV' },
    energySpread: { derived: true, unit: '' },
  },

  // ---- Plasma afterburner --------------------------------------------------
  // 15 GeV over 10 m. NOT RF: there is no resonator, no waveguide and no RF
  // phase to set — the accelerating field is a plasma wake and the knob is how
  // hard the stage is driven. `gradient` stays in MV/m so it reads on the same
  // axis as the rest of the ladder; 1500 MV/m is 1.5 GV/m, an order of
  // magnitude below the multi-GV/m fields real wakefield stages reach over
  // centimetres, because this is a metres-long staged device.
  //
  // No rfPhase entry, deliberately. energySpread is flat because it is not
  // tunable here: percent-level correlated spread is the technology's defining
  // weakness, not a setting.
  plasmaAfterburner: {
    gradient: { min: 500, max: 2000, default: 15000 / 10, unit: 'MV/m', step: 25 },
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

// Thermionic source. Heating the cathode increases available emission and the
// gun's delivered beam power from 5 kW at 600 K to 22.5 kW at 2000 K. At a
// fixed cathode setting P_beam = I * V, so extraction voltage remains a clean
// energy/current trade. Defaults produce 12.5 kW / 250 mA; the full control
// envelope spans 20 mA (cold, 250 kV) to 900 mA (hot, 25 kV).
const SOURCE_MIN_BEAM_POWER_W = 5000;
const SOURCE_MAX_BEAM_POWER_W = 22500;
const SOURCE_MIN_CATHODE_K = 600;
const SOURCE_MAX_CATHODE_K = 2000;

function computeSource(params) {
  const V_kV = params.extractionVoltage;  // kV
  const T    = params.cathodeTemperature; // K

  const V_V = V_kV * 1e3;
  const heatFraction = Math.max(0, Math.min(1,
    (T - SOURCE_MIN_CATHODE_K) / (SOURCE_MAX_CATHODE_K - SOURCE_MIN_CATHODE_K)));
  const beamPowerW = SOURCE_MIN_BEAM_POWER_W
    + heatFraction * (SOURCE_MAX_BEAM_POWER_W - SOURCE_MIN_BEAM_POWER_W);
  const I_A = beamPowerW / V_V;            // A
  const beamCurrent = I_A * 1e3;           // mA
  const beamPower = beamPowerW / 1e3;       // kW
  const extractionEnergy = V_kV * 1e-6;    // GeV (V kV = V * 1e-6 GeV)

  // Thermal emittance: ε [mm·mrad] = r_mm * sqrt(k_B * T / (me * c²))
  const r_mm = 3.0;
  const kTmc2 = (k_B * T) / (me * c * c);
  const emittance = r_mm * Math.sqrt(kTmc2) * 1e3;

  return { beamCurrent, beamPower, extractionEnergy, emittance };
}

// Duoplasmatron: extracted protons gain q·V, so the kinetic energy is the
// extraction voltage in eV — identical arithmetic to computeSource, since
// the charge state (1+) and not the mass sets it. Beam current scales with
// the arc discharge current (10 mA per arc amp reproduces the catalog's
// 50 mA at the default 5 A arc).
const ION_SOURCE_MA_PER_ARC_A = 10;

function computeIonSource(params) {
  const extractionEnergy = params.extractionVoltage * 1e-6; // kV → GeV
  const beamCurrent = params.arcCurrent * ION_SOURCE_MA_PER_ARC_A; // mA
  return { beamCurrent, extractionEnergy };
}

// ECR source: microwave power sets the plasma density (and so the extracted
// current), scaled by mirror-field confinement. The mirror benefit saturates
// above the design point so power remains the main high-current control.
// Defaults (2500 W, 250 A) produce 400 mA; pushed controls reach 1.15 A.
const ECR_MA_PER_W = 400 / 2500;
const ECR_DESIGN_MAGNET_A = 250;

function computeEcrIonSource(params) {
  const extractionEnergy = params.extractionVoltage * 1e-6; // kV → GeV
  const confinement = Math.min(1.2, Math.sqrt(params.magnetCurrent / ECR_DESIGN_MAGNET_A));
  const beamCurrent = params.microwavePower * ECR_MA_PER_W * confinement; // mA
  return { beamCurrent, extractionEnergy };
}

// Penning source: discharge current sets the available plasma density while
// the crossed magnetic field lengthens electron paths through the gas. The
// square-root confinement term keeps field tuning useful without letting a
// tiny permanent-magnet source outrun the duoplasmatron. Defaults give 25 mA.
const PENNING_MA_PER_DISCHARGE_A = 10;
const PENNING_DESIGN_FIELD_T = 0.15;

function computePenningIonSource(params) {
  const extractionEnergy = params.extractionVoltage * 1e-6; // kV → GeV
  const confinement = Math.min(1.2, Math.sqrt(params.magneticField / PENNING_DESIGN_FIELD_T));
  const beamCurrent = params.dischargeCurrent * PENNING_MA_PER_DISCHARGE_A * confinement;
  return { beamCurrent, extractionEnergy };
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
  const extractionEnergy = V_kV * 1e-6; // kV → GeV

  return { beamCurrent, emittance, cathodeQE, extractionEnergy };
}

/**
 * NC RF gun (1.3 GHz, S-band ~2.856 GHz or L-band 1.3 GHz typical).
 *
 * Bunch charge from RF gun (Kim 1989 / Carlsten model):
 *   Q [nC] ≈ k_charge * (E_peak [MV/m])^2 * r_spot² [mm²]
 * Calibrated so that E=120 MV/m, r=0.8 mm → Q ~ 1 nC.
 *
 * Average current (at 1 MHz, representative of a modern high-duty gun):
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

  // Average current at 1 MHz. This makes the gun useful in the game's
  // average-current model while its power and water demand pay for that duty.
  const f_rep = 1e6; // Hz
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
  // A compact two-cell copper gun produces roughly 5 MeV at the design field.
  const extractionEnergy = (E_MV / 120) * 0.005;

  return { beamCurrent, emittance, bunchCharge, extractionEnergy };
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

  const extractionEnergy = (G_MV / 20) * 0.005;
  return { beamCurrent, emittance, extractionEnergy };
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
// Energy degrader
// ---------------------------------------------------------------------------

// The fixed extraction energy this control is referenced to — cyclotron230,
// the only source in therapy's palette that needs a degrader at all. It has to
// be a constant because component-physics has no view of the lattice: it is
// handed one component's params and nothing else, so it cannot know what
// energy is arriving. `energyGain` is a DIFFERENCE and the engine applies it
// to whatever beam shows up, which is why energyDegrader's beamlineTypes is
// therapy alone — see the note there.
const DEGRADER_INPUT_MEV = 230;

// Transmission through wedge + energy-selection slits, fitted to the published
// PSI COMET / IBA ProteusPLUS curve: ~100% at full energy, ~40% at 200 MeV,
// ~15% at 150, ~1% at 70. exp(-dE/34.7) reproduces that to better than a
// factor of two across the whole clinical range, which is as much fidelity as
// a one-parameter fit to a Monte Carlo deserves.
const DEGRADER_TRANSMISSION_MEV = 34.7;

/**
 * Energy degrader + energy-selection system.
 *
 * energyGain is NEGATIVE — this is the only component in the catalogue that
 * takes energy out, and both the Pyodide path (RFAccelerationModule's
 * `beam.energy += dE`) and the headless fallback (which sums stats.energyGain)
 * read the sign correctly.
 *
 * beamQuality is also negative, and it is a STAND-IN. On the real physics path
 * the emittance cost arrives on its own through adiabatic anti-damping, but
 * that only accounts for the E_before/E_after ratio (~1.16 for a 230 -> 70
 * degrade) and misses multiple Coulomb scattering entirely. The headless model
 * has no emittance at all, so without this term the degrader would be free
 * there — and the headless model is what every balance sim and test measures.
 * It scales with the square root of the energy removed, which is the scattering
 * angle's own dependence on material thickness.
 */
function computeEnergyDegrader(params) {
  const outMeV = Math.min(params.outputEnergy, DEGRADER_INPUT_MEV);
  const removedMeV = Math.max(0, DEGRADER_INPUT_MEV - outMeV);
  const energyGain = -removedMeV / 1000;                       // GeV, negative
  const transmission = 100 * Math.exp(-removedMeV / DEGRADER_TRANSMISSION_MEV);
  // -0.30 at full 160 MeV of degradation, 0 with the wedge out.
  const beamQuality = -0.30 * Math.sqrt(removedMeV / DEGRADER_INPUT_MEV) / Math.sqrt(160 / DEGRADER_INPUT_MEV);
  return { energyGain, transmission, beamQuality };
}

// ---------------------------------------------------------------------------
// Scanning magnets
// ---------------------------------------------------------------------------

// Distance from the scanning magnets to the target. 2.5 m is the IBA / Varian
// nozzle geometry — the magnets sit above the snout and the isocentre is a
// couple of metres past them, which is what sets how much angle a given field
// size costs.
const SCAN_THROW_M = 2.5;

// gameplay.py: DIPOLE_ANGLE_SCALE = 15/90, i.e. the engine sees game/6 degrees.
const GAME_DEG_PER_PHYSICAL_DEG = 90 / 15;

/**
 * Scanning magnets — the deflection needed to reach the edge of the scan field.
 *
 * A field of `scanFieldMm` centred on the axis needs a half-deflection of
 * atan((field/2) / throw). That angle IS the dipole strength the engine gets:
 * the sweep itself has no representation (the engine has no time structure), so
 * what the physics sees is the extreme of the scan held static, and the
 * dispersion that comes with it.
 */
function computeScanningMagnet(params) {
  const halfFieldM = (params.scanFieldMm / 2) * 1e-3;
  const thetaRad = Math.atan(halfFieldM / SCAN_THROW_M);
  const physicalDeg = thetaRad * 180 / Math.PI;
  return {
    bendAngle: physicalDeg * GAME_DEG_PER_PHYSICAL_DEG,
    deflection: thetaRad * 1e3,
  };
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
 * Every rung of the RF ladder: gradient x the placement's own length, off
 * crest by the phase.
 *
 *   energyGain [GeV]  = G [MV/m] * length [m] * cos(φ) / 1000
 *   energySpread      = spreadCoeff * |sin(φ)|
 *
 * `length` is the PLACEMENT length (subL * 0.5 m), which is the same length
 * gameplay.py divides by to get the demanded gradient. Using a shorter
 * "active" length here — as the older per-cavity helpers above do — makes this
 * function and the physics backend disagree about what the same slider means.
 *
 * @param {number} lengthM      placement length, metres
 * @param {number} spreadCoeff  off-crest energy spread per unit |sin φ|
 */
function makeLadderCavity(lengthM, spreadCoeff) {
  return function (params) {
    const phi_rad = (params.rfPhase || 0) * Math.PI / 180;
    const energyGain   = params.gradient * lengthM * Math.cos(phi_rad) / 1000;
    const energySpread = spreadCoeff * Math.abs(Math.sin(phi_rad));
    return { energyGain, energySpread };
  };
}

/**
 * Plasma afterburner. Same energy arithmetic as the ladder, but the spread is
 * a constant: a plasma stage hands back percent-level correlated energy spread
 * whatever you do to it, and there is no phase knob to trade against.
 */
function computePlasmaAfterburner(params) {
  const energyGain = params.gradient * 10.0 / 1000; // 10 m placement
  return { energyGain, energySpread: 0.02 };
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
  source:       computeSource,
  penningIonSource: computePenningIonSource,
  ionSource:    computeIonSource,
  ecrIonSource: computeEcrIonSource,
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
  cryomodule:             computeCryomodule,
  // The RF ladder. Lengths are the placement lengths (subL * 0.5 m) and must
  // stay in step with subL in beamline-components.raw.js. Normal-conducting
  // copper carries more off-crest spread than SRF; the two-beam module is
  // X-band copper, so it takes the copper coefficient.
  cbandStructure:         makeLadderCavity(3.0, 0.008),
  xbandStructure:         makeLadderCavity(3.0, 0.008),
  twoBeamModule:          makeLadderCavity(12.0, 0.008),
  srf650Cryomodule:       makeLadderCavity(10.0, 0.003),
  srf805Cryomodule:       makeLadderCavity(12.0, 0.003),
  cwCryomodule:           makeLadderCavity(12.0, 0.003),
  nbSnCryomodule:         makeLadderCavity(12.0, 0.003),
  srfLinacSector:         makeLadderCavity(16.0, 0.003),
  plasmaAfterburner:      computePlasmaAfterburner,
  buncher:                computeBuncher,
  harmonicLinearizer:     computeHarmonicLinearizer,
  // insertion devices
  undulator:              computeUndulator,
  helicalUndulator:       computeHelicalUndulator,
  wiggler:                computeWiggler,
  apple2Undulator:        computeApple2Undulator,
  // beam manipulation
  energyDegrader:         computeEnergyDegrader,
  scanningMagnet:         computeScanningMagnet,
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
  // Fill in defaults for any missing non-derived params so compute functions
  // never receive undefined (which propagates to NaN → JSON null → Python
  // None → TypeError).
  const merged = { ...getDefaults(type), ...(params || {}) };
  return fn(merged);
}
