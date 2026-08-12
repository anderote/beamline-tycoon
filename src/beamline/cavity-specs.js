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
  srf650Cavity: {
    kind: 'srf', f_ghz: 0.65, r_over_q: 380.0, G: 190.0,
    l_active: 0.72, n_cav: 5, r_res: R_RES_DEFAULT,
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
  cbandCavity: {
    kind: 'nc', f_ghz: 5.712, r_shunt: 90e6, l_active: 0.6, n_cav: 1,
  },
  xbandCavity: {
    kind: 'nc', f_ghz: 11.424, r_shunt: 110e6, l_active: 0.23, n_cav: 1,
  },
  pillboxCavity: {
    kind: 'nc', f_ghz: 0.2, r_shunt: 30e6, l_active: 0.5, n_cav: 1,
  },
  rfq: {
    kind: 'nc', f_ghz: 0.4, r_shunt: 25e6, l_active: 2.0, n_cav: 1,
  },
};

/** Cavity constants for a game component id, or null if it has no model. */
export function getCavitySpec(componentId) {
  return CAVITY_SPECS[componentId] || null;
}

/** BCS surface resistance, ohms. */
export function rBcs(tempK, fGhz) {
  const t = Math.max(tempK, T_FLOOR);
  return (BCS_A * fGhz * fGhz / t) * Math.exp(-BCS_DELTA_OVER_K / t);
}

/** Unloaded quality factor at temperature. NC cavities return the copper value. */
export function q0(tempK, spec, rRes) {
  if (!spec || spec.kind !== 'srf') return Q0_COPPER;
  if (tempK >= T_CRITICAL) return Q0_COPPER;
  const res = rRes == null ? (spec.r_res ?? R_RES_DEFAULT) : rRes;
  return spec.G / (rBcs(tempK, spec.f_ghz) + res);
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
