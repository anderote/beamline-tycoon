"""
Vacuum System Physics.

Models pressure profiles, outgassing, pumping, and beam-gas interactions
for beamline vacuum chambers.

Pressures are in mbar, gas loads in mbar*L/s, pump speeds in L/s.
"""

import math

# Outgassing rates (mbar*L/s per cm^2)
OUTGAS_UNBAKED_SS = 1.0e-8      # unbaked stainless steel
OUTGAS_BAKED_SS = 1.0e-11       # baked stainless steel (150C, 24h)
OUTGAS_NEG_COATED = 1.0e-12     # NEG-coated surface (activated)

# Beam-gas cross sections (simplified)
# Total cross section for beam-gas scattering at relativistic energies
SIGMA_BEAM_GAS = 1.0e-22        # m^2 (order of magnitude for N2 at GeV)

# Boltzmann constant and gas properties
K_BOLTZMANN = 1.381e-23         # J/K
MOLECULAR_MASS_N2 = 28.0        # g/mol (nitrogen)
AVOGADRO = 6.022e23
GAS_TEMP = 300.0                # K (room temperature)

# Number density from pressure: n = P / (k_B * T)
# 1 mbar = 100 Pa
MBAR_TO_PA = 100.0

# Speed of light
C_LIGHT = 2.998e8               # m/s


def outgassing_rate(surface_area_cm2, baked=False, neg_coated=False):
    """
    Compute total outgassing gas load from a vacuum chamber surface.

    Parameters
    ----------
    surface_area_cm2 : float
        Inner surface area of the vacuum chamber in cm^2.
    baked : bool
        Whether the chamber has been baked out.
    neg_coated : bool
        Whether the surface is NEG-coated (implies baked).

    Returns
    -------
    float
        Gas load in mbar*L/s.
    """
    if neg_coated:
        rate = OUTGAS_NEG_COATED
    elif baked:
        rate = OUTGAS_BAKED_SS
    else:
        rate = OUTGAS_UNBAKED_SS

    return rate * surface_area_cm2


def molecular_conductance(diameter_mm, length_m):
    """
    Compute molecular flow conductance of a circular tube.

    C = 12.1 * d^3 / L  (L/s, with d and L in cm)

    Parameters
    ----------
    diameter_mm : float
        Tube inner diameter in mm.
    length_m : float
        Tube length in metres.

    Returns
    -------
    float
        Conductance in L/s.
    """
    d_cm = diameter_mm / 10.0
    l_cm = length_m * 100.0

    if l_cm <= 0:
        return 1.0e6  # effectively infinite for zero length

    return 12.1 * d_cm ** 3 / l_cm


def effective_pump_speed(pump_speed, conductance):
    """
    Compute effective pumping speed at the chamber.

    S_eff = S_pump * C / (S_pump + C)

    Parameters
    ----------
    pump_speed : float
        Pump nominal speed in L/s.
    conductance : float
        Conductance between pump and chamber in L/s.

    Returns
    -------
    float
        Effective pump speed in L/s.
    """
    if pump_speed + conductance <= 0:
        return 0.0
    return pump_speed * conductance / (pump_speed + conductance)


def segment_pressure(gas_load, eff_pump_speed):
    """
    Compute average pressure in a vacuum segment.

    P = Q / S_eff

    Parameters
    ----------
    gas_load : float
        Total gas load in mbar*L/s.
    eff_pump_speed : float
        Effective pump speed at the chamber in L/s.

    Returns
    -------
    float
        Average pressure in mbar.
    """
    if eff_pump_speed <= 0:
        return 1.0  # atmosphere (pump is off)
    return gas_load / eff_pump_speed


def beam_gas_lifetime(pressure_mbar, energy_gev):
    """
    Compute beam-gas scattering lifetime.

    tau = 1 / (sigma * n_gas * c)

    Higher energy beams have slightly lower cross sections (1/beta^2 scaling).

    Parameters
    ----------
    pressure_mbar : float
        Residual gas pressure in mbar.
    energy_gev : float
        Beam energy in GeV.

    Returns
    -------
    float
        Beam lifetime in seconds due to beam-gas scattering.
    """
    if pressure_mbar <= 0:
        return 1.0e12  # essentially infinite

    # Number density from ideal gas law: n = P / (k_B * T)
    pressure_pa = pressure_mbar * MBAR_TO_PA
    n_gas = pressure_pa / (K_BOLTZMANN * GAS_TEMP)  # molecules/m^3

    # Cross section with energy scaling (lower at higher energy)
    mass_gev = 0.511e-3  # electron mass
    gamma = max(energy_gev / mass_gev, 1.0)
    beta = math.sqrt(1.0 - 1.0 / (gamma * gamma)) if gamma > 1.0 else 0.01
    sigma = SIGMA_BEAM_GAS / (beta * beta)

    denom = sigma * n_gas * C_LIGHT
    if denom <= 0:
        return 1.0e12

    return 1.0 / denom


def beam_gas_loss_rate(current_ma, pressure_mbar, energy_gev, length_m):
    """
    Compute beam current loss rate from beam-gas scattering in a segment.

    loss = I_beam * (1 - exp(-L / (c * tau)))

    Parameters
    ----------
    current_ma : float
        Beam current in mA.
    pressure_mbar : float
        Residual gas pressure in mbar.
    energy_gev : float
        Beam energy in GeV.
    length_m : float
        Segment length in metres.

    Returns
    -------
    float
        Current lost in mA.
    """
    tau = beam_gas_lifetime(pressure_mbar, energy_gev)

    if tau <= 0:
        return current_ma

    # Time spent traversing the segment
    transit_time = length_m / C_LIGHT
    loss_frac = 1.0 - math.exp(-transit_time / tau)

    return current_ma * loss_frac
