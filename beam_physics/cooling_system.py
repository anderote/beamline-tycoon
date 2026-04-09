"""
Thermal Budgets & Cooling System.

Models heat loads from normal-conducting magnets, cavities, klystrons,
and beam dumps, plus the water cooling capacity needed to remove them.

All power/heat values are in kW unless otherwise noted.
"""

import math

# Water properties at ~25 C
WATER_SPECIFIC_HEAT = 4.18     # kJ/(kg*C)
WATER_DENSITY = 1.0            # kg/L


def magnet_heat_load(current_a, resistance_ohm):
    """
    Compute resistive heat load in a normal-conducting magnet.

    P = I^2 * R

    Parameters
    ----------
    current_a : float
        Magnet current in amperes.
    resistance_ohm : float
        Coil resistance in ohms.

    Returns
    -------
    float
        Heat load in kW.
    """
    p_watts = current_a ** 2 * resistance_ohm
    return p_watts / 1.0e3


def cavity_heat_load(p_forward_kw, p_beam_kw):
    """
    Compute heat load on a normal-conducting RF cavity.

    The cavity absorbs the difference between forward power and beam power.

    Parameters
    ----------
    p_forward_kw : float
        Forward RF power into the cavity in kW.
    p_beam_kw : float
        Power transferred to the beam in kW.

    Returns
    -------
    float
        Heat load on cavity walls in kW.
    """
    return max(p_forward_kw - p_beam_kw, 0.0)


def klystron_heat_load(p_wall_kw, efficiency):
    """
    Compute waste heat from a klystron.

    Parameters
    ----------
    p_wall_kw : float
        Wall-plug power consumed by the klystron in kW.
    efficiency : float
        DC-to-RF conversion efficiency (0 to 1).

    Returns
    -------
    float
        Heat load in kW (must be removed by cooling water).
    """
    return p_wall_kw * (1.0 - efficiency)


def beam_dump_heat_load(current_ma, energy_gev):
    """
    Compute heat deposited in a beam dump.

    P = I_beam * E_beam

    Parameters
    ----------
    current_ma : float
        Beam current in mA.
    energy_gev : float
        Beam energy in GeV.

    Returns
    -------
    float
        Heat load in kW.
    """
    # I (A) * E (eV) = power in W; or I(mA) * E(GeV) * 1e6 / 1e3 = kW
    # 1 mA * 1 GeV = 1e-3 A * 1e9 eV * 1.6e-19 J/eV = 1.6e-13 * 1e6 = 0.16 W?
    # Actually: P = I * V, where V = E/q for singly charged particles
    # P = I(A) * E(GeV)*1e9 (V) = I(mA)*1e-3 * E(GeV)*1e9 = I*E * 1e6 W
    # Convert to kW: I*E * 1e3
    return current_ma * energy_gev * 1.0e3  # kW


def cooling_capacity(flow_rate_lpm, delta_t_c=10.0):
    """
    Compute cooling capacity of a water cooling loop.

    Q = m_dot * c_p * delta_T

    Parameters
    ----------
    flow_rate_lpm : float
        Water flow rate in litres per minute.
    delta_t_c : float
        Allowed temperature rise in degrees Celsius.

    Returns
    -------
    float
        Cooling capacity in kW.
    """
    # Convert L/min to kg/s
    mass_flow_kg_s = flow_rate_lpm * WATER_DENSITY / 60.0

    # Q = m_dot * c_p * delta_T  (kJ/s = kW)
    return mass_flow_kg_s * WATER_SPECIFIC_HEAT * delta_t_c


def check_cooling_adequate(total_heat_kw, total_cooling_kw):
    """
    Check whether cooling capacity is sufficient for the heat load.

    Parameters
    ----------
    total_heat_kw : float
        Total heat load in kW.
    total_cooling_kw : float
        Total available cooling capacity in kW.

    Returns
    -------
    tuple of (bool, float)
        (is_adequate, margin) where margin is the fractional safety margin.
        margin > 0 means cooling is sufficient; margin < 0 means overheating.
    """
    if total_cooling_kw <= 0:
        return (False, -1.0)

    margin = (total_cooling_kw - total_heat_kw) / total_cooling_kw
    is_adequate = total_heat_kw <= total_cooling_kw
    return (is_adequate, margin)
