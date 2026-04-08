"""
RF Power Chain Physics.

Models the full RF power chain from wall plug to cavity:
    wall plug -> modulator -> klystron/SSA -> waveguide -> coupler -> cavity

All power values are in kW unless otherwise noted.
"""

import math

# Typical SRF cavity parameters
DEFAULT_R_OVER_Q = 1036.0       # Ohms (TESLA-type 9-cell)
DEFAULT_Q_LOADED = 3.0e7        # loaded Q for SRF
DEFAULT_KLYSTRON_EFF = 0.65     # typical klystron efficiency
DEFAULT_WG_ATTEN = 0.01         # dB/m for WR284 waveguide


def cavity_rf_power(gradient, length, r_over_q=DEFAULT_R_OVER_Q,
                    q_loaded=DEFAULT_Q_LOADED, beam_current=0.0,
                    phase_deg=0.0):
    """
    Compute RF power budget for a single cavity.

    Parameters
    ----------
    gradient : float
        Accelerating gradient in MV/m.
    length : float
        Active cavity length in m.
    r_over_q : float
        Cavity R/Q in Ohms.
    q_loaded : float
        Loaded quality factor.
    beam_current : float
        Average beam current in mA.
    phase_deg : float
        Beam phase relative to crest in degrees.

    Returns
    -------
    dict with keys:
        V_acc      : accelerating voltage (MV)
        P_cavity   : cavity wall dissipation (kW)
        P_beam     : beam loading power (kW)
        P_reflected: reflected power (kW)
        P_forward  : total forward power from source (kW)
    """
    v_acc = gradient * length  # MV
    v_acc_v = v_acc * 1.0e6    # convert to volts

    # Fundamental power demand: P = V^2 / (R/Q * Q_L)
    p_cavity_w = v_acc_v ** 2 / (r_over_q * q_loaded)
    p_cavity = p_cavity_w / 1.0e3  # kW

    # Beam loading: P_beam = I_beam * V_acc * cos(phi)
    i_beam_a = beam_current * 1.0e-3  # mA -> A
    phi = math.radians(phase_deg)
    p_beam_w = i_beam_a * v_acc_v * math.cos(phi)
    p_beam = p_beam_w / 1.0e3  # kW

    # Reflected power from impedance mismatch (simplified model)
    # In a matched system this is zero; we model a small mismatch
    p_forward = p_cavity + p_beam
    mismatch = 0.02  # 2% reflection coefficient
    p_reflected = p_forward * mismatch

    # Total forward power accounts for reflection
    p_forward_total = p_cavity + p_beam + p_reflected

    return {
        "V_acc": v_acc,
        "P_cavity": p_cavity,
        "P_beam": max(p_beam, 0.0),
        "P_reflected": p_reflected,
        "P_forward": p_forward_total,
    }


def waveguide_loss(power_in, attenuation_db_per_m=DEFAULT_WG_ATTEN,
                   length=10.0):
    """
    Compute power delivered after waveguide attenuation.

    Parameters
    ----------
    power_in : float
        Input power in kW.
    attenuation_db_per_m : float
        Waveguide attenuation in dB per metre.
    length : float
        Waveguide length in metres.

    Returns
    -------
    float
        Delivered power in kW.
    """
    total_loss_db = attenuation_db_per_m * length
    return power_in * 10.0 ** (-total_loss_db / 10.0)


def klystron_power(power_out_needed, efficiency=DEFAULT_KLYSTRON_EFF,
                   duty_factor=1.0):
    """
    Compute klystron wall-plug power requirements.

    Parameters
    ----------
    power_out_needed : float
        Required RF output power in kW.
    efficiency : float
        Klystron DC-to-RF efficiency (0 to 1).
    duty_factor : float
        Pulsed duty factor (1.0 for CW).

    Returns
    -------
    dict with keys:
        P_wall : wall-plug power (kW, peak)
        P_avg  : average wall-plug power (kW)
    """
    if efficiency <= 0:
        efficiency = 0.01
    p_wall = power_out_needed / efficiency
    p_avg = p_wall * duty_factor

    return {
        "P_wall": p_wall,
        "P_avg": p_avg,
    }


def rf_chain_budget(cavities_config, sources_config):
    """
    Compute total RF wall power for a chain of cavities and sources.

    Parameters
    ----------
    cavities_config : list of dict
        Each dict has keys: gradient, length, r_over_q, q_loaded,
        beam_current, phase_deg.
    sources_config : dict
        Keys: efficiency, duty_factor, wg_atten_db_per_m, wg_length.

    Returns
    -------
    dict with keys:
        total_wall_power  : total wall-plug power (kW)
        per_cavity        : list of per-cavity power dicts
        per_source_loading: average loading fraction per source
    """
    eff = sources_config.get("efficiency", DEFAULT_KLYSTRON_EFF)
    duty = sources_config.get("duty_factor", 1.0)
    wg_atten = sources_config.get("wg_atten_db_per_m", DEFAULT_WG_ATTEN)
    wg_len = sources_config.get("wg_length", 10.0)

    total_wall = 0.0
    per_cavity = []

    for cav in cavities_config:
        rf = cavity_rf_power(
            gradient=cav.get("gradient", 16.0),
            length=cav.get("length", 1.038),
            r_over_q=cav.get("r_over_q", DEFAULT_R_OVER_Q),
            q_loaded=cav.get("q_loaded", DEFAULT_Q_LOADED),
            beam_current=cav.get("beam_current", 0.0),
            phase_deg=cav.get("phase_deg", 0.0),
        )

        # Account for waveguide loss: source must produce more
        p_source_needed = rf["P_forward"] / max(
            waveguide_loss(1.0, wg_atten, wg_len), 0.01
        )

        kly = klystron_power(p_source_needed, eff, duty)
        total_wall += kly["P_avg"]

        rf["source"] = kly
        per_cavity.append(rf)

    n_cav = len(cavities_config) if cavities_config else 1
    avg_loading = total_wall / max(n_cav, 1)

    return {
        "total_wall_power": total_wall,
        "per_cavity": per_cavity,
        "per_source_loading": avg_loading,
    }
