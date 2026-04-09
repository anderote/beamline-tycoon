"""
Cryogenic Heat Load & Capacity.

Models dynamic and static heat loads on superconducting cavities and
cryomodules, plus the cryoplant wall-plug power needed to remove them.

Heat loads are in watts at the cold mass temperature.
Wall-plug power is in kW.
"""

import math

# Typical SRF parameters
DEFAULT_R_OVER_Q = 1036.0       # Ohms (TESLA-type 9-cell)
DEFAULT_Q0_PEAK = 2.0e10        # intrinsic Q0 at low field
DEFAULT_E_REF = 40.0            # MV/m reference for Q-slope

# Static heat loads
STATIC_LOAD_PER_CRYOMODULE_4K = 3.0    # W at 4 K (typical)
STATIC_LOAD_PER_CRYOMODULE_2K = 1.5    # W at 2 K
TRANSFER_LINE_LOAD_PER_M = 1.0         # W/m

# Carnot efficiency multipliers (wall-plug watts per cold watt)
# 1 W at 2 K ~ 750 W wall-plug; 1 W at 4 K ~ 250 W wall-plug
WALL_POWER_PER_COLD_WATT = {
    2.0: 750.0,
    4.2: 250.0,
}


def cavity_dynamic_load(gradient, length, r_over_q=DEFAULT_R_OVER_Q,
                        q0=DEFAULT_Q0_PEAK):
    """
    Compute dynamic heat load dissipated in a superconducting cavity.

    Parameters
    ----------
    gradient : float
        Accelerating gradient in MV/m.
    length : float
        Active cavity length in m.
    r_over_q : float
        Cavity R/Q in Ohms.
    q0 : float
        Intrinsic quality factor.

    Returns
    -------
    float
        Dynamic heat load in watts at operating temperature.
    """
    v_acc = gradient * length * 1.0e6  # MV -> V
    if q0 <= 0:
        q0 = 1.0
    return v_acc ** 2 / (r_over_q * q0)


def q0_vs_gradient(q0_peak=DEFAULT_Q0_PEAK, gradient=16.0,
                   e_ref=DEFAULT_E_REF):
    """
    Model Q0 degradation with accelerating gradient (Q-slope).

    Q0(E) = Q0_peak * exp(-E / E_ref)

    Parameters
    ----------
    q0_peak : float
        Peak Q0 at low field.
    gradient : float
        Operating gradient in MV/m.
    e_ref : float
        Reference gradient for exponential decay (MV/m).

    Returns
    -------
    float
        Q0 at the given gradient.
    """
    return q0_peak * math.exp(-gradient / e_ref)


def static_heat_load(n_cryomodules, transfer_line_length, temp_k=4.2):
    """
    Compute total static heat load from cryomodules and transfer lines.

    Parameters
    ----------
    n_cryomodules : int
        Number of cryomodules.
    transfer_line_length : float
        Total length of cryogenic transfer lines in m.
    temp_k : float
        Operating temperature in Kelvin (2.0 or 4.2).

    Returns
    -------
    float
        Total static heat load in watts.
    """
    if temp_k <= 2.5:
        load_per_cm = STATIC_LOAD_PER_CRYOMODULE_2K
    else:
        load_per_cm = STATIC_LOAD_PER_CRYOMODULE_4K

    cm_load = n_cryomodules * load_per_cm
    tl_load = transfer_line_length * TRANSFER_LINE_LOAD_PER_M
    return cm_load + tl_load


def cryo_plant_wall_power(total_cold_load_w, temp_k=4.2,
                          carnot_efficiency=0.25):
    """
    Compute cryoplant wall-plug power from total cold load.

    Uses the real Carnot COP with a practical efficiency factor:
        COP_ideal = T_cold / (T_hot - T_cold)
        COP_real  = COP_ideal * eta_carnot
        P_wall    = Q_cold / COP_real

    Parameters
    ----------
    total_cold_load_w : float
        Total heat load at cold temperature in watts.
    temp_k : float
        Cold temperature in Kelvin.
    carnot_efficiency : float
        Fraction of Carnot efficiency achieved (typically 0.2-0.3).

    Returns
    -------
    float
        Wall-plug power in kW.
    """
    t_hot = 300.0  # room temperature
    if temp_k >= t_hot or temp_k <= 0:
        return 0.0

    cop_ideal = temp_k / (t_hot - temp_k)
    cop_real = cop_ideal * carnot_efficiency

    if cop_real <= 0:
        return 0.0

    p_wall_w = total_cold_load_w / cop_real
    return p_wall_w / 1.0e3  # W -> kW


def check_quench(gradient, max_gradient, cryo_capacity, cryo_load):
    """
    Check whether a cavity has quenched.

    A quench occurs when the gradient exceeds the cavity limit or
    when the cryogenic load exceeds available cooling capacity.

    Parameters
    ----------
    gradient : float
        Operating gradient in MV/m.
    max_gradient : float
        Maximum achievable gradient before quench (MV/m).
    cryo_capacity : float
        Available cryogenic cooling capacity in watts.
    cryo_load : float
        Current cryogenic heat load in watts.

    Returns
    -------
    bool
        True if quenched, False otherwise.
    """
    if gradient > max_gradient:
        return True
    if cryo_load > cryo_capacity:
        return True
    return False
