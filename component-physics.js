// component-physics.js — Source component physics formulas
// Supports both browser (window globals) and Node.js (module.exports)

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    const result = factory();
    root.PARAM_DEFS    = result.PARAM_DEFS;
    root.computeStats  = result.computeStats;
    root.getDefaults   = result.getDefaults;
  }
})(typeof window !== 'undefined' ? window : global, function () {

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
  const PARAM_DEFS = {

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
  };

  // ---------------------------------------------------------------------------
  // getDefaults(type) — return object of { param: defaultValue } for non-derived
  // ---------------------------------------------------------------------------
  function getDefaults(type) {
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
  // COMPUTE_STATS dispatch table
  // ---------------------------------------------------------------------------
  const COMPUTE_STATS = {
    source:     computeSource,
    dcPhotoGun: computeDcPhotoGun,
    ncRfGun:    computeNcRfGun,
    srfGun:     computeSrfGun,
  };

  /**
   * computeStats(type, params) — compute derived stats for a source component.
   * @param {string} type   — component type key (e.g. 'source', 'dcPhotoGun')
   * @param {object} params — object with param values (non-derived keys)
   * @returns {object}      — derived stats { beamCurrent, emittance, ... }
   */
  function computeStats(type, params) {
    const fn = COMPUTE_STATS[type];
    if (!fn) return {};
    return fn(params);
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  return { PARAM_DEFS, computeStats, getDefaults };

});
