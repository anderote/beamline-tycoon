import numpy as np
from beam_physics.constants import ELECTRON_MASS, SPEED_OF_LIGHT


def relativistic_params(energy, mass):
    """Compute relativistic gamma and beta from total energy and rest mass."""
    gamma = energy / mass
    if gamma < 1.0:
        gamma = 1.0
    beta = np.sqrt(1.0 - 1.0 / (gamma * gamma)) if gamma > 1.0 else 0.0
    return gamma, beta


class BeamState:
    """
    6D beam state represented by a 6x6 sigma (covariance) matrix.

    Coordinates: (x, x', y, y', dt, dE/E)
    Units: m, rad, m, rad, s, dimensionless
    """

    def __init__(self, sigma, energy, current, mass=ELECTRON_MASS):
        self.sigma = np.array(sigma, dtype=np.float64)
        self.energy = energy        # GeV
        self.current = current      # mA
        self.mass = mass            # GeV/c^2
        self.alive = True
        self.gamma, self.beta = relativistic_params(energy, mass)
        self.initial_current = current
        self.initial_eps_x = self.emittance_x()
        self.initial_eps_y = self.emittance_y()

    def update_relativistic(self):
        self.gamma, self.beta = relativistic_params(self.energy, self.mass)

    # --- Twiss parameters per plane ---

    def emittance_x(self):
        """Geometric emittance in x plane."""
        det = self.sigma[0, 0] * self.sigma[1, 1] - self.sigma[0, 1] ** 2
        return np.sqrt(max(det, 1e-30))

    def emittance_y(self):
        """Geometric emittance in y plane."""
        det = self.sigma[2, 2] * self.sigma[3, 3] - self.sigma[2, 3] ** 2
        return np.sqrt(max(det, 1e-30))

    def norm_emittance_x(self):
        return self.emittance_x() * self.beta * self.gamma

    def norm_emittance_y(self):
        return self.emittance_y() * self.beta * self.gamma

    def beta_x(self):
        eps = self.emittance_x()
        return self.sigma[0, 0] / eps if eps > 0 else 0.0

    def alpha_x(self):
        eps = self.emittance_x()
        return -self.sigma[0, 1] / eps if eps > 0 else 0.0

    def beta_y(self):
        eps = self.emittance_y()
        return self.sigma[2, 2] / eps if eps > 0 else 0.0

    def alpha_y(self):
        eps = self.emittance_y()
        return -self.sigma[2, 3] / eps if eps > 0 else 0.0

    def beam_size_x(self):
        return np.sqrt(max(self.sigma[0, 0], 0.0))

    def beam_size_y(self):
        return np.sqrt(max(self.sigma[2, 2], 0.0))

    def energy_spread(self):
        return np.sqrt(max(self.sigma[5, 5], 0.0))

    def bunch_length(self):
        return np.sqrt(max(self.sigma[4, 4], 0.0))

    def snapshot(self, element_index, element_type, cumulative_s=0.0):
        """Return a dict snapshot of the current beam state."""
        return {
            "element_index": element_index,
            "element_type": element_type,
            "beam_size_x": self.beam_size_x(),
            "beam_size_y": self.beam_size_y(),
            "energy": self.energy,
            "current": self.current,
            "emittance_x": self.emittance_x(),
            "emittance_y": self.emittance_y(),
            "norm_emittance_x": self.norm_emittance_x(),
            "norm_emittance_y": self.norm_emittance_y(),
            "beta_x": self.beta_x(),
            "beta_y": self.beta_y(),
            "alpha_x": self.alpha_x(),
            "alpha_y": self.alpha_y(),
            "energy_spread": self.energy_spread(),
            "bunch_length": self.bunch_length(),
            "alive": self.alive,
            # Covariance submatrix elements (for phase space ellipses)
            "cov_xx": float(self.sigma[0, 0]),
            "cov_xxp": float(self.sigma[0, 1]),
            "cov_xpxp": float(self.sigma[1, 1]),
            "cov_yy": float(self.sigma[2, 2]),
            "cov_yyp": float(self.sigma[2, 3]),
            "cov_ypyp": float(self.sigma[3, 3]),
            "cov_tt": float(self.sigma[4, 4]),
            "cov_tdE": float(self.sigma[4, 5]),
            "cov_dEdE": float(self.sigma[5, 5]),
            "cov_xy": float(self.sigma[0, 2]),
            # Cumulative path length
            "s": cumulative_s,
        }


def create_initial_beam(params):
    """
    Create a BeamState from source parameters.

    params dict keys: energy, mass, current, eps_norm_x, eps_norm_y,
                      sigma_dE, sigma_dt, beta_x, beta_y, alpha_x, alpha_y
    """
    energy = params["energy"]
    mass = params.get("mass", ELECTRON_MASS)
    current = params["current"]

    gamma_rel, beta_rel = relativistic_params(energy, mass)

    # Convert normalized emittance to geometric
    bg = beta_rel * gamma_rel
    eps_x = params["eps_norm_x"] / bg if bg > 0 else params["eps_norm_x"]
    eps_y = params["eps_norm_y"] / bg if bg > 0 else params["eps_norm_y"]

    # Build 6x6 sigma matrix (block diagonal)
    sigma = np.zeros((6, 6))

    # X plane from Twiss
    bx = params["beta_x"]
    ax = params["alpha_x"]
    gx = (1.0 + ax * ax) / bx
    sigma[0, 0] = eps_x * bx
    sigma[0, 1] = -eps_x * ax
    sigma[1, 0] = -eps_x * ax
    sigma[1, 1] = eps_x * gx

    # Y plane from Twiss
    by = params["beta_y"]
    ay = params["alpha_y"]
    gy = (1.0 + ay * ay) / by
    sigma[2, 2] = eps_y * by
    sigma[2, 3] = -eps_y * ay
    sigma[3, 2] = -eps_y * ay
    sigma[3, 3] = eps_y * gy

    # Longitudinal
    sigma[4, 4] = params["sigma_dt"] ** 2
    sigma[5, 5] = params["sigma_dE"] ** 2

    return BeamState(sigma, energy, current, mass)
