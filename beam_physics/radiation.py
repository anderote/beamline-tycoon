import numpy as np
from beam_physics.constants import C_GAMMA, ELECTRON_MASS

# Classical electron radius (m)
R_E = 2.818e-15
# Reduced Compton wavelength of electron (m)
LAMBDA_C = 3.861e-13
# Quantum diffusion prefactor: 55/(48*sqrt(3)) * r_e * lambda_c / (2*pi)
# This is the correct coefficient for single-pass energy spread growth
QD_PREFACTOR = (55.0 / (48.0 * np.sqrt(3.0))) * R_E * LAMBDA_C / (2.0 * np.pi)
# ≈ 1.15e-28 m


def synchrotron_energy_loss(energy, bend_angle_deg, length, mass=ELECTRON_MASS):
    """
    Energy lost to synchrotron radiation in a dipole.

    Returns energy loss in GeV.
    Only significant for electrons (mass << proton mass).
    """
    if mass > 0.01:
        return 0.0

    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return 0.0

    rho = length / theta
    if rho < 1e-6:
        return 0.0

    # Energy loss for this bend segment
    U = C_GAMMA * energy**4 * abs(theta) / rho
    return U


def quantum_excitation_emittance_growth(sigma, energy, bend_angle_deg, length, mass=ELECTRON_MASS):
    """
    Emittance growth from quantum excitation (stochastic photon emission)
    in a dipole magnet. Modifies the sigma matrix in-place.

    Uses the correct single-pass formula:
        d(sigma_delta^2)/ds = QD_PREFACTOR * gamma^5 / rho^3
        d(eps_x)/ds = QD_PREFACTOR * gamma^5 * H / rho^3

    where H is the dispersion invariant.
    """
    if mass > 0.01:
        return sigma

    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return sigma

    rho = length / theta
    if abs(rho) < 1e-6:
        return sigma

    gamma_rel = energy / mass
    rho3 = abs(rho) ** 3

    # --- Energy spread growth ---
    d_sigma_E2 = QD_PREFACTOR * gamma_rel**5 * length / rho3
    sigma[5, 5] += d_sigma_E2

    # --- Horizontal emittance growth ---
    # Dispersion invariant H = (eta^2 + (beta*eta' - alpha*eta)^2) / beta
    # For a simple sector dipole: eta ~ rho*(1-cos(theta)), eta' ~ sin(theta)
    # Approximate with smooth lattice: H ~ 1/rho (normalized)
    eps_x = np.sqrt(max(sigma[0, 0] * sigma[1, 1] - sigma[0, 1] ** 2, 1e-40))
    beta_x = sigma[0, 0] / eps_x if eps_x > 0 else 1.0

    # Dispersion at dipole exit
    eta = abs(rho) * (1.0 - np.cos(theta))
    eta_prime = np.sin(theta)
    alpha_x = -sigma[0, 1] / eps_x if eps_x > 0 else 0.0
    H = (eta**2 + (beta_x * eta_prime - alpha_x * eta) ** 2) / beta_x if beta_x > 0 else 0.0

    d_eps_x = QD_PREFACTOR * gamma_rel**5 * H * length / rho3

    sigma[0, 0] += d_eps_x * beta_x
    sigma[1, 1] += d_eps_x / beta_x if beta_x > 0 else 0.0

    # Vertical: driven by coupling, typically ~1% of horizontal
    eps_y = np.sqrt(max(sigma[2, 2] * sigma[3, 3] - sigma[2, 3] ** 2, 1e-40))
    beta_y = sigma[2, 2] / eps_y if eps_y > 0 else 1.0
    d_eps_y = d_eps_x * 0.01
    sigma[2, 2] += d_eps_y * beta_y
    sigma[3, 3] += d_eps_y / beta_y if beta_y > 0 else 0.0

    return sigma


def undulator_energy_loss(energy, num_periods, period_length, mass=ELECTRON_MASS):
    """
    Energy loss in an undulator. Weaker than dipole radiation.
    """
    if mass > 0.01:
        return 0.0

    K = 1.5  # typical undulator parameter
    gamma_rel = energy / mass
    if gamma_rel < 1:
        return 0.0

    rho_eff = period_length * gamma_rel / (2.0 * np.pi * K)
    total_length = num_periods * period_length

    if rho_eff < 1e-6:
        return 0.0

    U = C_GAMMA * energy**4 * total_length / rho_eff**2
    return U


def photon_rate(energy, current, num_periods):
    """
    Approximate photon production rate from an undulator.
    Returns relative photon rate (arbitrary units scaled for gameplay).
    """
    gamma_rel = energy / ELECTRON_MASS
    return current * gamma_rel**2 * num_periods * 1e-6


# ---------------------------------------------------------------------------
# Coherent Synchrotron Radiation (CSR) models
# ---------------------------------------------------------------------------

def csr_energy_spread(N_particles, bend_radius, bunch_length_m, energy_gev):
    """
    CSR-induced fractional energy spread in a chicane dipole.

    dE_CSR/E ~ (N * r_e) / (R^(2/3) * sigma_z^(4/3))

    N_particles: number of electrons in the bunch
    bend_radius: dipole bending radius in metres
    bunch_length_m: rms bunch length in metres
    energy_gev: beam energy in GeV

    Returns: fractional energy spread increase (dimensionless)
    """
    if bend_radius <= 0 or bunch_length_m <= 0 or energy_gev <= 0:
        return 0.0

    gamma = energy_gev / ELECTRON_MASS
    delta_E_over_E = (N_particles * R_E) / (
        bend_radius ** (2.0 / 3.0) * bunch_length_m ** (4.0 / 3.0)
    )
    return delta_E_over_E


def csr_emittance_growth(r56_m, sigma_delta_csr, beta_x_m):
    """
    Emittance growth from CSR-induced energy spread.

    d_eps ~ (R56 * sigma_delta_csr)^2 / beta_x

    r56_m: R56 of the chicane in metres
    sigma_delta_csr: CSR-induced fractional energy spread
    beta_x_m: horizontal beta function in metres

    Returns: emittance growth in m-rad
    """
    if beta_x_m <= 0:
        return 0.0

    return (r56_m * sigma_delta_csr) ** 2 / beta_x_m


# ---------------------------------------------------------------------------
# Free Electron Laser (FEL) models
# ---------------------------------------------------------------------------

# Alfven current (A)
I_ALFVEN = 17045.0


def fel_parameters(energy_gev, peak_current_a, k_undulator, lambda_u_m, sigma_x_m):
    """
    Calculate FEL Pierce parameter, gain length, and saturation power.

    rho = (1 / (2*gamma)) * (I_peak * K^2 * lambda_u / (4 * I_A * sigma_x^2))^(1/3)
    L_gain = lambda_u / (4 * pi * sqrt(3) * rho)
    P_sat = rho * E_beam_J * I_peak    (E_beam in Joules)

    energy_gev: beam energy in GeV
    peak_current_a: peak current in Amperes
    k_undulator: undulator K parameter (dimensionless)
    lambda_u_m: undulator period in metres
    sigma_x_m: rms transverse beam size in metres

    Returns: dict with keys 'rho', 'gain_length_m', 'saturation_power_w'
    """
    if energy_gev <= 0 or peak_current_a <= 0 or sigma_x_m <= 0 or lambda_u_m <= 0:
        return {"rho": 0.0, "gain_length_m": np.inf, "saturation_power_w": 0.0}

    gamma = energy_gev / ELECTRON_MASS

    # Pierce parameter
    rho = (1.0 / (2.0 * gamma)) * (
        peak_current_a * k_undulator ** 2 * lambda_u_m
        / (4.0 * I_ALFVEN * sigma_x_m ** 2)
    ) ** (1.0 / 3.0)

    # 1D gain length
    gain_length = lambda_u_m / (4.0 * np.pi * np.sqrt(3.0) * rho) if rho > 0 else np.inf

    # Beam energy in Joules: E = energy_gev * 1e9 * 1.602e-19
    E_beam_J = energy_gev * 1.602e-10  # GeV -> J

    # Saturation power
    P_sat = rho * E_beam_J * peak_current_a if rho > 0 else 0.0

    return {
        "rho": rho,
        "gain_length_m": gain_length,
        "saturation_power_w": P_sat,
    }


def fel_saturation_check(undulator_length_m, gain_length_m):
    """
    Check if undulator is long enough for FEL saturation.

    Need L_undulator > ~20 * L_gain for saturation.

    undulator_length_m: total undulator length in metres
    gain_length_m: FEL gain length in metres

    Returns: tuple (saturated: bool, saturation_fraction: float)
        saturation_fraction = L_undulator / (20 * L_gain)
        saturated is True when saturation_fraction >= 1.0
    """
    if gain_length_m <= 0 or not np.isfinite(gain_length_m):
        return (False, 0.0)

    saturation_length = 20.0 * gain_length_m
    saturation_fraction = undulator_length_m / saturation_length if saturation_length > 0 else 0.0
    saturated = saturation_fraction >= 1.0

    return (saturated, saturation_fraction)
