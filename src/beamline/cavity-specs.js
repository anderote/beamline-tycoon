// src/beamline/cavity-specs.js
//
// JS mirror of beam_physics/srf.py — cavity constants and the Q0/dissipation
// maths built on them.
//
// WHY THIS IS DUPLICATED: the cryogenic thermal solve runs inside
// src/utility/types/cryoTransfer.js on every tick of the utility network, and
// the utility layer has no route into the Python backend. The physics pass
// (which decides achievable gradient) and the thermal solve (which decides the
// temperature that gradient is achieved at) therefore evaluate the same
// formulas on opposite sides of the language boundary.
//
// The two tables MUST agree. test/test-cavity-specs.js parses both files and
// asserts they match key-for-key and value-for-value, because a silent
// divergence would make the plant bill for heat the cavities never produced
// (or, worse, not bill for heat they did).
//
// See the Python module for the derivation, calibration table, and references.

// --- BCS surface resistance constants (niobium) ---
// Defaults only: a spec may carry its own `bcs_a` / `bcs_delta_over_k` when the
// cavity surface is not bare niobium (see nbSnCryomodule).
export const BCS_A = 2e-4;
export const BCS_DELTA_OVER_K = 17.67;

export const T_CRITICAL = 9.25;
export const T_FLOOR = 1.5;
export const R_RES_DEFAULT = 10e-9;
export const Q0_COPPER = 1e4;

export const CAVITY_SPECS = {
  // --- Superconducting ---
  cryomodule: {
    kind: 'srf', f_ghz: 1.3, r_over_q: 1030.0, G: 270.0,
    l_active: 1.038, n_cav: 8, r_res: R_RES_DEFAULT,
  },
  ellipticalSrfCavity: {
    kind: 'srf', f_ghz: 0.65, r_over_q: 380.0, G: 190.0,
    l_active: 0.72, n_cav: 1, r_res: R_RES_DEFAULT,
  },
  // PIP-II LB650, 5-cell cut for beta = 0.61 (l_active = 5 * beta * lambda/2).
  srf650Cryomodule: {
    kind: 'srf', f_ghz: 0.65, r_over_q: 375.0, G: 191.0,
    l_active: 0.703, n_cav: 14, r_res: R_RES_DEFAULT,
  },
  // SNS high-beta, 6-cell at 805 MHz cut for beta = 0.86.
  srf805Cryomodule: {
    kind: 'srf', f_ghz: 0.805, r_over_q: 483.0, G: 260.0,
    l_active: 0.961, n_cav: 12, r_res: R_RES_DEFAULT,
  },
  // LCLS-II: the TESLA 9-cell built for CW, nitrogen-doped for low residual
  // resistance — which is the whole helium bill when the RF never switches off.
  cwCryomodule: {
    kind: 'srf', f_ghz: 1.3, r_over_q: 1030.0, G: 270.0,
    l_active: 1.038, n_cav: 11, r_res: 5e-9,
  },
  // Nb3Sn coating on the same 9-cell: same geometry, different superconductor,
  // so it carries its own BCS constants (Tc 18 K, Delta/kTc 2.2). Wins at
  // 4.5 K, gains nothing at 2 K. See beam_physics/srf.py for the derivation
  // and for the T_CRITICAL limitation.
  nbSnCryomodule: {
    kind: 'srf', f_ghz: 1.3, r_over_q: 1030.0, G: 270.0,
    l_active: 1.038, n_cav: 11, r_res: 15e-9,
    bcs_a: 3.6e-4, bcs_delta_over_k: 39.6,
  },
  // A whole cryogenic sector of TESLA cryomodules: same cavity, more of them.
  srfLinacSector: {
    kind: 'srf', f_ghz: 1.3, r_over_q: 1030.0, G: 270.0,
    l_active: 1.038, n_cav: 15, r_res: R_RES_DEFAULT,
  },
  spokeCavity: {
    kind: 'srf', f_ghz: 0.325, r_over_q: 220.0, G: 110.0,
    l_active: 0.46, n_cav: 1, r_res: R_RES_DEFAULT,
  },
  halfWaveResonator: {
    kind: 'srf', f_ghz: 0.161, r_over_q: 275.0, G: 50.0,
    l_active: 0.30, n_cav: 1, r_res: R_RES_DEFAULT,
  },

  // --- Normal conducting ---
  rfCavity: {
    kind: 'nc', f_ghz: 2.856, r_shunt: 55e6, l_active: 3.0, n_cav: 1,
  },
  sbandStructure: {
    kind: 'nc', f_ghz: 2.856, r_shunt: 55e6, l_active: 3.0, n_cav: 1,
  },
  industrialLinac: {
    kind: 'nc', f_ghz: 2.856, r_shunt: 55e6, l_active: 1.0, n_cav: 1,
  },
  // SACLA / SwissFEL class C-band travelling wave, accelerating over the whole
  // 3 m placement.
  cbandStructure: {
    kind: 'nc', f_ghz: 5.712, r_shunt: 90e6, l_active: 3.0, n_cav: 1,
  },
  xbandStructure: {
    kind: 'nc', f_ghz: 11.424, r_shunt: 110e6, l_active: 3.0, n_cav: 1,
  },
  pillboxCavity: {
    kind: 'nc', f_ghz: 0.2, r_shunt: 30e6, l_active: 0.5, n_cav: 1,
  },
  rfq: {
    kind: 'nc', f_ghz: 0.4, r_shunt: 25e6, l_active: 2.0, n_cav: 1,
  },

  // DELIBERATELY ABSENT: twoBeamModule (driven by a decelerating drive beam
  // through PETS, not by the site RF network) and plasmaAfterburner (not a
  // cavity at all — a laser-driven plasma wake). Both fall through to the
  // legacy derate. See the matching note in beam_physics/srf.py.
};

/** Cavity constants for a game component id, or null if it has no model. */
export function getCavitySpec(componentId) {
  return CAVITY_SPECS[componentId] || null;
}

/** BCS surface resistance, ohms. Constants default to niobium. */
export function rBcs(tempK, fGhz, bcsA = BCS_A, deltaOverK = BCS_DELTA_OVER_K) {
  const t = Math.max(tempK, T_FLOOR);
  return (bcsA * fGhz * fGhz / t) * Math.exp(-deltaOverK / t);
}

/** Unloaded quality factor at temperature. NC cavities return the copper value. */
export function q0(tempK, spec, rRes) {
  if (!spec || spec.kind !== 'srf') return Q0_COPPER;
  if (tempK >= T_CRITICAL) return Q0_COPPER;
  const res = rRes == null ? (spec.r_res ?? R_RES_DEFAULT) : rRes;
  const surface = rBcs(tempK, spec.f_ghz,
    spec.bcs_a ?? BCS_A, spec.bcs_delta_over_k ?? BCS_DELTA_OVER_K);
  return spec.G / (surface + res);
}

/** Maximum achievable gradient, MV/m, PER CAVITY. */
export function eAccMax(powerW, spec, tempK, rRes) {
  if (!spec || !(powerW > 0)) return 0;
  const length = spec.l_active;
  if (!(length > 0)) return 0;

  let volts;
  if (spec.kind === 'srf') {
    const t = tempK == null ? 2.0 : tempK;
    if (t >= T_CRITICAL) return 0;
    volts = Math.sqrt(powerW * spec.r_over_q * q0(t, spec, rRes));
  } else {
    volts = Math.sqrt(powerW * spec.r_shunt * length);
  }
  return volts / length / 1e6;
}

/**
 * Power dissipated in the cavity walls, watts, PER CAVITY. Callers multiply by
 * n_cav for a component's total heat load. This is the term that closes the
 * thermal feedback loop: it rises as Q0 falls, so a warming cavity heats
 * itself faster.
 */
export function pDiss(eAccMvM, spec, tempK, rRes) {
  if (!spec || !(eAccMvM > 0)) return 0;
  const length = spec.l_active;
  const volts = eAccMvM * 1e6 * length;

  if (spec.kind === 'srf') {
    const t = tempK == null ? 2.0 : tempK;
    return volts * volts / (spec.r_over_q * q0(t, spec, rRes));
  }
  return volts * volts / (spec.r_shunt * length);
}
