"""Cavity device physics: surface resistance, quality factor, achievable gradient.

This module answers one question: given the RF power and (for SRF) the cryogenic
temperature a cavity is actually being supplied with, what accelerating gradient
can it reach?

Before this existed, `energyGain` was a flat per-component constant in
beamline-components.raw.js, derated by a linear product of four abstract 0-1
"quality" scalars. A cavity delivered the same energy whether it was fed 5 kW or
1 MW, and cryogenics had no temperature at all.

The physics, for a dissipation-limited CW superconducting cavity:

    R_BCS(T) = (A f_GHz^2 / T) exp(-Delta/T)      BCS surface resistance
    Q0(T)    = G / (R_BCS(T) + R_res)             geometry factor over resistance
    E_acc    = sqrt(P (R/Q) Q0) / L               dissipation-limited gradient
    P_diss   = (E_acc L)^2 / ((R/Q) Q0)           inverse of the above

E_acc goes as sqrt(Q0), so a cavity that loses its cold loses its gradient
quadratically fast. And because P_diss rises as Q0 falls, the two form a
feedback loop: over-drive a cavity, dissipate more, warm up, lose Q0, dissipate
more still. That runaway is the quench mechanic, and it is emergent rather than
scripted.

Calibration (TESLA 9-cell, 1.3 GHz, R/Q = 1030 ohm, G = 270 ohm, L = 1.038 m,
R_res = 10 nohm) against real cavities:

    T (K)   R_BCS (nohm)   Q0        E_acc @ 42 W   P_diss @ 20 MV/m
    1.8     10             1.3e10    23.1 MV/m      31 W
    2.0     25             7.8e9     17.7 MV/m      54 W
    4.2     1198           2.2e8     3.0 MV/m       1872 W

Real TESLA cavities run Q0 ~ 1e10 at 2 K and dissipate 30-50 W at 20 MV/m, so
the model reproduces hardware with no free parameters. test/test_srf.py pins
this table.

For normal-conducting cavities Q0 is fixed by copper (~1e4) and folded into the
tabulated shunt impedance, so the gradient is purely RF-power-limited:

    E_acc = sqrt(P r_shunt / L)

with r_shunt in ohm/m. Verification: S-band, r = 55 Mohm/m, L = 3 m, P = 30 MW
gives 23.5 MV/m; SLAC runs ~20 MV/m at 35 MW.

UNIT TRAP: e_acc_max() and p_diss() are both PER CAVITY. A cryomodule holds
eight of them. Callers must multiply energy gain and heat load by `n_cav`.

The JS mirror of CAVITY_SPECS lives in src/beamline/cavity-specs.js because the
utility solver runs every tick and cannot call into Python.
test/test-cavity-specs.js asserts the two tables agree — a silent divergence
would make the thermal solve disagree with the physics pass.
"""

import math

# --- BCS surface resistance constants (niobium) ---
# R_BCS = (A f_GHz^2 / T) exp(-Delta/T). Delta/k_B = 17.67 K corresponds to
# Tc = 9.25 K with the standard Delta/kTc = 1.85 for Nb.
#
# These are the DEFAULTS, not the only possibility: a spec may carry its own
# "bcs_a" / "bcs_delta_over_k" when the cavity is not bare niobium. Nb3Sn is
# the case that forces this — see nbSnCryomodule below.
BCS_A = 2e-4
BCS_DELTA_OVER_K = 17.67

T_CRITICAL = 9.25       # Nb critical temperature, K — above this, no superconductivity
T_FLOOR = 1.5           # clamp: below superfluid-He operating range, model not valid
R_RES_DEFAULT = 10e-9   # residual surface resistance, ohm. Research hook: N-doping
                        # and improved surface prep lower this, raising Q0 at fixed T.

# Copper Q0 at room temperature — not used directly (it is folded into the
# tabulated shunt impedances) but kept for reference and for the NC branch of
# detune_coupling's loaded-Q default.
Q0_COPPER = 1e4


# ---------------------------------------------------------------------------
# Cavity constants, keyed on game component id (beamline-components.raw.js).
#
# SRF entries: f_ghz, r_over_q (ohm), G (ohm), l_active (m, per cavity),
#              n_cav (cavities per placed component), r_res (ohm),
#              optional bcs_a / bcs_delta_over_k for non-niobium surfaces
# NC entries:  f_ghz, r_shunt (ohm/m), l_active (m), n_cav
#
# HOW n_cav IS CHOSEN. gameplay.py derives the demanded gradient over the
# PLACEMENT's footprint (energyGain * 1000 / length), then compares it against
# the per-cavity ceiling this module computes over l_active. The two only
# describe the same machine when n_cav * l_active is about the footprint
# length — i.e. when the cavities really do account for the energy the
# catalogue promises. The TESLA entry already satisfies this by construction
# (8 * 1.038 = 8.3 m against an 8 m footprint) and every entry added for the
# RF ladder follows it: n_cav is the cavity count that fills the placement,
# NOT the count in one real cryomodule. A placement is a cryostring or a
# sector, so it holds several modules' worth of cavities; the desc in the
# catalogue is where that abstraction is stated to the player.
#
# n_cav also decides the heat: the placement's voltage is split across n_cav
# cavities, so total P_diss goes as 1/n_cav at fixed energy gain. Getting the
# count wrong bills the cryoplant for heat that is not there.
# ---------------------------------------------------------------------------
CAVITY_SPECS = {
    # --- Superconducting ---
    "cryomodule": {
        "kind": "srf", "f_ghz": 1.3, "r_over_q": 1030.0, "G": 270.0,
        "l_active": 1.038, "n_cav": 8, "r_res": R_RES_DEFAULT,
    },
    "ellipticalSrfCavity": {
        "kind": "srf", "f_ghz": 0.65, "r_over_q": 380.0, "G": 190.0,
        "l_active": 0.72, "n_cav": 1, "r_res": R_RES_DEFAULT,
    },
    # PIP-II LB650: 5-cell elliptical cut for beta = 0.61, so the active length
    # is 5 * beta * lambda/2 = 0.70 m. R/Q and G are the measured cavity
    # constants for that shape — both well below the 1.3 GHz TESLA values,
    # which is the whole reason a proton linac needs its own rungs.
    "srf650Cryomodule": {
        "kind": "srf", "f_ghz": 0.65, "r_over_q": 375.0, "G": 191.0,
        "l_active": 0.703, "n_cav": 14, "r_res": R_RES_DEFAULT,
    },
    # SNS high-beta: 6-cell at 805 MHz, here cut for beta = 0.86, giving
    # 6 * 0.86 * lambda/2 = 0.96 m. A higher-beta cavity is a better resonator
    # — more cells see the same field, so R/Q and G both climb.
    "srf805Cryomodule": {
        "kind": "srf", "f_ghz": 0.805, "r_over_q": 483.0, "G": 260.0,
        "l_active": 0.961, "n_cav": 12, "r_res": R_RES_DEFAULT,
    },
    # LCLS-II: geometrically the same TESLA 9-cell as `cryomodule`, but built
    # for CW. The difference that matters here is surface prep — nitrogen-doped
    # niobium runs a lower residual resistance, and when the RF never switches
    # off, residual resistance is the entire helium bill.
    "cwCryomodule": {
        "kind": "srf", "f_ghz": 1.3, "r_over_q": 1030.0, "G": 270.0,
        "l_active": 1.038, "n_cav": 11, "r_res": 5e-9,
    },
    # Nb3Sn coating on the same TESLA 9-cell. Geometry is unchanged (a coating
    # a few microns thick moves no field), but the SUPERCONDUCTOR is not
    # niobium, so the BCS constants are not niobium's either: Tc = 18 K with
    # Delta/kTc = 2.2 gives Delta/k_B = 39.6 K, and the prefactor is set so
    # R_BCS = 20 nohm at 4.5 K and 1.3 GHz, which is what coated cavities
    # measure. Residual resistance is worse than good niobium (15 nohm), and
    # that is the honest trade: Nb3Sn wins at 4.5 K and gains nothing at 2 K.
    #
    # LIMITATION: T_CRITICAL is a module-wide constant because the cryo
    # network quenches as a whole (src/utility/types/cryoTransfer.js), so this
    # cavity still quenches at niobium's 9.25 K rather than its own 18 K. It
    # is the conservative direction, and it keeps one quench rule for the plant.
    "nbSnCryomodule": {
        "kind": "srf", "f_ghz": 1.3, "r_over_q": 1030.0, "G": 270.0,
        "l_active": 1.038, "n_cav": 11, "r_res": 15e-9,
        "bcs_a": 3.6e-4, "bcs_delta_over_k": 39.6,
    },
    # A whole cryogenic sector of TESLA cryomodules under one placement. Same
    # cavity as `cryomodule` in every respect; only the count differs.
    "srfLinacSector": {
        "kind": "srf", "f_ghz": 1.3, "r_over_q": 1030.0, "G": 270.0,
        "l_active": 1.038, "n_cav": 15, "r_res": R_RES_DEFAULT,
    },
    "spokeCavity": {
        "kind": "srf", "f_ghz": 0.325, "r_over_q": 220.0, "G": 110.0,
        "l_active": 0.46, "n_cav": 1, "r_res": R_RES_DEFAULT,
    },
    "halfWaveResonator": {
        "kind": "srf", "f_ghz": 0.161, "r_over_q": 275.0, "G": 50.0,
        "l_active": 0.30, "n_cav": 1, "r_res": R_RES_DEFAULT,
    },

    # --- Normal conducting ---
    # r_shunt in ohm/m. Values are representative of real structures:
    # SLAC S-band ~55 Mohm/m, CLIC-class X-band ~110 Mohm/m.
    "rfCavity": {
        "kind": "nc", "f_ghz": 2.856, "r_shunt": 55e6, "l_active": 3.0, "n_cav": 1,
    },
    "sbandStructure": {
        "kind": "nc", "f_ghz": 2.856, "r_shunt": 55e6, "l_active": 3.0, "n_cav": 1,
    },
    # Industrial 10 MeV sterilisation linac: the same S-band copper geometry as
    # the structure above, cut to a third of the length. Same 55 Mohm/m shunt
    # impedance because it IS the same structure — only the number of cells
    # differs, and r_shunt is a per-metre property.
    "industrialLinac": {
        "kind": "nc", "f_ghz": 2.856, "r_shunt": 55e6, "l_active": 1.0, "n_cav": 1,
    },
    # SACLA / SwissFEL class C-band travelling wave. r_shunt tracks roughly
    # sqrt(f) off the S-band value, which is why the high-gradient rungs are
    # about power, not impedance. l_active is the full 3 m placement — a
    # disc-loaded structure accelerates over its whole length.
    "cbandStructure": {
        "kind": "nc", "f_ghz": 5.712, "r_shunt": 90e6, "l_active": 3.0, "n_cav": 1,
    },
    "xbandStructure": {
        "kind": "nc", "f_ghz": 11.424, "r_shunt": 110e6, "l_active": 3.0, "n_cav": 1,
    },
    "pillboxCavity": {
        "kind": "nc", "f_ghz": 0.2, "r_shunt": 30e6, "l_active": 0.5, "n_cav": 1,
    },
    "rfq": {
        "kind": "nc", "f_ghz": 0.4, "r_shunt": 25e6, "l_active": 2.0, "n_cav": 1,
    },

    # --- Deliberately absent -------------------------------------------------
    # `twoBeamModule` and `plasmaAfterburner` have NO entry, and must not get
    # one invented for them. This table answers exactly one question — what
    # gradient does the site RF network buy? — and neither device is driven by
    # the site RF network:
    #
    #   twoBeamModule: the accelerating power arrives from a decelerating drive
    #     beam through PETS transfer structures. Real CLIC-G copper has a shunt
    #     impedance of ~36 Mohm/m, LOWER than S-band; the 100 MV/m comes from
    #     tens of megawatts per 23 cm structure, not from a better resonator.
    #     Entering it here at an honest r_shunt would starve it permanently,
    #     and entering it at a dishonest one would be tuning a physical
    #     constant to hit a game number.
    #
    #   plasmaAfterburner: it is not a cavity at all. There is no resonator, no
    #     shunt impedance and no waveguide — the accelerating field is a plasma
    #     wake, and the wall plug feeds a laser.
    #
    # Both fall through to gameplay.py's legacy linear derate, which is what
    # that path exists for.
}


def get_spec(component_id):
    """Cavity constants for a game component id, or None if it has no model."""
    return CAVITY_SPECS.get(component_id)


def r_bcs(temp_k, f_ghz, bcs_a=BCS_A, delta_over_k=BCS_DELTA_OVER_K):
    """BCS surface resistance in ohms. Diverges as T -> 0 is approached from
    above only in the sense that it vanishes; clamped at T_FLOOR since the
    model is not valid below the superfluid operating range.

    `bcs_a` and `delta_over_k` default to niobium. A spec that names a
    different superconductor passes its own.
    """
    t = max(temp_k, T_FLOOR)
    return (bcs_a * f_ghz * f_ghz / t) * math.exp(-delta_over_k / t)


def q0(temp_k, spec, r_res=None):
    """Unloaded quality factor at temperature `temp_k`.

    Normal-conducting cavities have no temperature dependence worth modelling
    here (their Q0 is folded into r_shunt), so this returns Q0_COPPER for them.
    Above T_CRITICAL superconductivity is gone entirely — return the copper
    value rather than a nonsense extrapolation of the BCS formula.
    """
    if spec.get("kind") != "srf":
        return Q0_COPPER
    if temp_k >= T_CRITICAL:
        return Q0_COPPER
    res = spec.get("r_res", R_RES_DEFAULT) if r_res is None else r_res
    surface = r_bcs(temp_k, spec["f_ghz"],
                    spec.get("bcs_a", BCS_A),
                    spec.get("bcs_delta_over_k", BCS_DELTA_OVER_K))
    return spec["G"] / (surface + res)


def e_acc_max(power_w, spec, temp_k=None, r_res=None):
    """Maximum achievable accelerating gradient in MV/m, PER CAVITY.

    `power_w` is the RF power available to a single cavity (callers divide the
    network's per-component share by n_cav). For SRF this is the dissipation
    budget; for NC it is peak forward power.
    """
    if power_w is None or power_w <= 0:
        return 0.0
    length = spec["l_active"]
    if length <= 0:
        return 0.0

    if spec.get("kind") == "srf":
        if temp_k is None:
            temp_k = 2.0
        # A quenched cavity accelerates nothing. Callers also convert it to a
        # drift, but returning 0 here keeps this function honest standalone.
        if temp_k >= T_CRITICAL:
            return 0.0
        volts = math.sqrt(power_w * spec["r_over_q"] * q0(temp_k, spec, r_res))
    else:
        # Standing-wave NC: R_shunt = r * L, V = sqrt(P R_shunt), E = V / L,
        # so E = sqrt(P r / L).
        volts = math.sqrt(power_w * spec["r_shunt"] * length)

    return volts / length / 1e6


def p_diss(e_acc_mv_m, spec, temp_k=None, r_res=None):
    """Power dissipated in the cavity walls, watts, PER CAVITY.

    This is the inverse of e_acc_max and is what loads the cryoplant. Callers
    multiply by n_cav for a component's total heat load.
    """
    if e_acc_mv_m is None or e_acc_mv_m <= 0:
        return 0.0
    length = spec["l_active"]
    volts = e_acc_mv_m * 1e6 * length

    if spec.get("kind") == "srf":
        if temp_k is None:
            temp_k = 2.0
        quality = q0(temp_k, spec, r_res)
        return volts * volts / (spec["r_over_q"] * quality)

    # NC dissipation: essentially all forward power ends up as wall heat.
    return volts * volts / (spec["r_shunt"] * length)


def detune_coupling(delta_t_k, spec, q_loaded=1e4):
    """Fraction of forward RF power that couples into a thermally detuned cavity.

    An undercooled normal-conducting cavity expands, its resonant frequency
    shifts, and it falls off resonance — it does not gently fade, it starts
    reflecting power back at the source. The response is Lorentzian:

        coupling = 1 / (1 + (2 Q_L df / f)^2)

    df scales with the cavity frequency; 20 kHz/K is representative at S-band.
    Returns 1.0 for no deficit. The reflected fraction (1 - coupling) is what
    drives the VSWR readout.
    """
    if delta_t_k is None or delta_t_k <= 0:
        return 1.0
    f_hz = spec["f_ghz"] * 1e9
    detune_hz = 20e3 * delta_t_k * (spec["f_ghz"] / 2.856)
    x = 2.0 * q_loaded * detune_hz / f_hz
    return 1.0 / (1.0 + x * x)
