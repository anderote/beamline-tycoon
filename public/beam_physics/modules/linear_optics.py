import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT


def _block_diag_6x6(Rx, Ry, Rlong=None):
    R = np.eye(6)
    R[0:2, 0:2] = Rx
    R[2:4, 2:4] = Ry
    if Rlong is not None:
        R[4:6, 4:6] = Rlong
    return R


def drift_matrix(length):
    Rx = np.array([[1.0, length], [0.0, 1.0]])
    return _block_diag_6x6(Rx, Rx)


def quadrupole_matrix(k, length):
    if abs(k) < 1e-10:
        return drift_matrix(length)
    sqrt_k = np.sqrt(abs(k))
    phi = sqrt_k * length
    Rf = np.array([
        [np.cos(phi), np.sin(phi) / sqrt_k],
        [-sqrt_k * np.sin(phi), np.cos(phi)]
    ])
    Rd = np.array([
        [np.cosh(phi), np.sinh(phi) / sqrt_k],
        [sqrt_k * np.sinh(phi), np.cosh(phi)]
    ])
    if k > 0:
        return _block_diag_6x6(Rf, Rd)
    else:
        return _block_diag_6x6(Rd, Rf)


def axisymmetric_focusing_matrix(k, length):
    """Equal linear focusing in both transverse planes.

    This is the paraxial channel approximation used for an electrostatic
    einzel-lens train and for the alternating vane field of an RFQ. It keeps
    those devices distinct from a solenoid, whose coupled x/y rotation is
    already modeled by ``solenoid_matrix``.
    """
    if k <= 1e-12:
        return drift_matrix(length)
    sqrt_k = np.sqrt(k)
    phi = sqrt_k * length
    plane = np.array([
        [np.cos(phi), np.sin(phi) / sqrt_k],
        [-sqrt_k * np.sin(phi), np.cos(phi)],
    ])
    return _block_diag_6x6(plane, plane)


def dipole_matrix(bend_angle_deg, length):
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return drift_matrix(length)
    rho = length / theta
    c, s = np.cos(theta), np.sin(theta)
    R = np.eye(6)
    R[0, 0] = c
    R[0, 1] = rho * s
    R[1, 0] = -s / rho
    R[1, 1] = c
    R[0, 5] = rho * (1.0 - c)
    R[1, 5] = s
    R[2, 2] = 1.0
    R[2, 3] = length
    R[3, 2] = 0.0
    R[3, 3] = 1.0
    R[4, 0] = s
    R[4, 1] = rho * (1.0 - c)
    R[4, 5] = rho * (theta - s)
    return R


def dipole_edge_matrix(bend_angle_deg, length):
    """Thin-lens vertical edge focusing at dipole entry/exit."""
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return np.eye(6)
    rho = length / theta
    edge_angle = theta / 2.0
    R = np.eye(6)
    R[3, 2] = np.tan(edge_angle) / rho
    return R


def combined_function_matrix(bend_angle_deg, k_quad, length):
    """Combined function magnet: dipole + quadrupole."""
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return quadrupole_matrix(k_quad, length)
    rho = length / theta
    k_x = k_quad + 1.0 / (rho * rho)
    k_y = -k_quad

    def plane_matrix(k, L):
        if abs(k) < 1e-10:
            return np.array([[1.0, L], [0.0, 1.0]])
        sk = np.sqrt(abs(k))
        phi = sk * L
        if k > 0:
            return np.array([
                [np.cos(phi), np.sin(phi) / sk],
                [-sk * np.sin(phi), np.cos(phi)]
            ])
        else:
            return np.array([
                [np.cosh(phi), np.sinh(phi) / sk],
                [sk * np.sinh(phi), np.cosh(phi)]
            ])

    Rx = plane_matrix(k_x, length)
    Ry = plane_matrix(k_y, length)
    R = _block_diag_6x6(Rx, Ry)
    c, s = np.cos(theta), np.sin(theta)
    R[0, 5] = rho * (1.0 - c)
    R[1, 5] = s
    R[4, 0] = s
    R[4, 1] = rho * (1.0 - c)
    R[4, 5] = rho * (theta - s)
    return R


def solenoid_matrix(B_field, momentum_gev, length):
    if abs(B_field) < 1e-12 or momentum_gev <= 0:
        return drift_matrix(length)
    k = 0.2998 * B_field / (2.0 * momentum_gev)
    phi = k * length
    C, S = np.cos(phi), np.sin(phi)
    R = np.eye(6)
    R[0, 0] = C * C
    R[0, 1] = S * C / k if abs(k) > 1e-15 else length
    R[0, 2] = S * C
    R[0, 3] = S * S / k if abs(k) > 1e-15 else 0.0
    R[1, 0] = -k * S * C
    R[1, 1] = C * C
    R[1, 2] = -k * S * S
    R[1, 3] = S * C
    R[2, 0] = -S * C
    R[2, 1] = -S * S / k if abs(k) > 1e-15 else 0.0
    R[2, 2] = C * C
    R[2, 3] = S * C / k if abs(k) > 1e-15 else length
    R[3, 0] = k * S * S
    R[3, 1] = -S * C
    R[3, 2] = -k * S * C
    R[3, 3] = C * C
    R[4, 5] = length
    return R


def _dispersion_generation_vector(element):
    etype = element.get("type", "")
    if etype not in ("dipole", "combined_function"):
        return np.zeros(4)
    theta = np.radians(element.get("bendAngle", 0.0))
    length = element.get("length", 1.0)
    if abs(theta) < 1e-10:
        return np.zeros(4)
    rho = length / theta
    return np.array([rho * (1.0 - np.cos(theta)), np.sin(theta), 0.0, 0.0])


def _propagate_dispersion(context, R, d):
    eta = context.dispersion
    new_eta = np.zeros(4)
    new_eta[0] = R[0, 0] * eta[0] + R[0, 1] * eta[1] + d[0]
    new_eta[1] = R[1, 0] * eta[0] + R[1, 1] * eta[1] + d[1]
    new_eta[2] = R[2, 2] * eta[2] + R[2, 3] * eta[3] + d[2]
    new_eta[3] = R[3, 2] * eta[2] + R[3, 3] * eta[3] + d[3]
    context.dispersion = new_eta


# Reference momentum the game's focusStrength stat is computed at
# (component-physics.js computeQuadrupole hardcodes p = 1.0 GeV). Magnets are
# rescaled from here to the beam's real momentum.
P_REF_GEV = 1.0


def _time_of_flight_r56(beam, length):
    """dt response to fractional total-energy error through a straight section.

    BeamState's longitudinal coordinate is seconds and sigma[5] is fractional
    energy error. Differentiating L/(beta*c) gives
    R_tδ = -L/(beta^3 gamma^2 c). It is negligible once the beam is
    relativistic and dominant in exactly the injector regime where a buncher
    needs a following drift to turn velocity modulation into shorter bunches.
    """
    beta = float(getattr(beam, "beta", 0.0))
    gamma = float(getattr(beam, "gamma", 1.0))
    if length <= 0 or beta <= 0 or gamma <= 0:
        return 0.0
    return -length / (beta ** 3 * gamma ** 2 * SPEED_OF_LIGHT)


def _momentum_gev(beam):
    """p = sqrt(E_total^2 - m^2), GeV/c. Zero for a beam at rest."""
    return beam.momentum_gev()


def _plane_phase_advance(matrix, beta_in, alpha_in, beta_out, length):
    """Unwrapped local Courant-Snyder phase advance for one transport step.

    For an uncoupled 2x2 map, M12 = sqrt(beta_in*beta_out) sin(mu) and
    M11 = sqrt(beta_out/beta_in) (cos(mu) + alpha_in sin(mu)). The fallback
    integrates dmu/ds = 1/beta with endpoint Twiss values; it is used for the
    coupled solenoid map where a projected x/y 2x2 block is not symplectic.
    """
    if beta_in <= 0 or beta_out <= 0:
        return 0.0

    determinant = np.linalg.det(matrix)
    if np.isfinite(determinant) and abs(determinant - 1.0) < 1e-8:
        sin_mu = matrix[0, 1] / np.sqrt(beta_in * beta_out)
        cos_mu = matrix[0, 0] * np.sqrt(beta_in / beta_out) - alpha_in * sin_mu
        if np.isfinite(sin_mu) and np.isfinite(cos_mu):
            mu = np.arctan2(sin_mu, cos_mu)
            if mu < -1e-12:
                mu += 2.0 * np.pi
            elif mu < 0:
                mu = 0.0
            return float(mu)

    # Positive, stable definition for coupled transport. Sub-stepping keeps
    # this trapezoidal integral accurate while avoiding a false ring "tune".
    return float(max(length, 0.0) * 0.5 * (1.0 / beta_in + 1.0 / beta_out))


def _active_region(element):
    """Return the active field length and symmetric drift margins.

    Catalogue geometry is the element's occupied longitudinal span.  A magnet
    can have a smaller effective field length inside that span; representing
    the margins as drift keeps the element at the right s-coordinate while
    avoiding the false assumption that the field fills its housing.
    """
    total = max(float(element.get("length", 0.0)), 0.0)
    active = element.get("activeLength", total)
    try:
        active = float(active)
    except (TypeError, ValueError):
        active = total
    active = max(0.0, min(active, total))
    margin = 0.5 * (total - active)
    return active, margin


class LinearOpticsModule(PhysicsModule):
    """Transfer matrix propagation and dispersion tracking."""

    def __init__(self):
        super().__init__(name="linear_optics", order=10)

    def applies_to(self, element, machine_type):
        return True

    def apply(self, beam, element, context):
        etype = element.get("type", "drift")
        length = element.get("length", 0.0)

        beta_x_in = beam.beta_x()
        alpha_x_in = beam.alpha_x()
        beta_y_in = beam.beta_y()
        alpha_y_in = beam.alpha_y()

        R = self._transfer_matrix(element, beam)

        # For dipoles, compose edge focusing into the full transfer matrix
        # R_total = R_edge_exit @ R_body @ R_edge_entry
        if etype == "dipole":
            R_edge = dipole_edge_matrix(element.get("bendAngle", 0.0), length)
            R = R_edge @ R @ R_edge

        # Every finite-length element advances particles in time. The old
        # matrices either left this block as identity or (for solenoids and
        # chicanes) wrote metres into a coordinate stored in seconds. Use the
        # beam-energy-dependent time-of-flight term consistently; specialised
        # chicane compression remains in BunchCompressionModule.
        if length > 0:
            R[4, 5] = _time_of_flight_r56(beam, length)

        # Apply full transfer matrix
        beam.sigma = R @ beam.sigma @ R.T
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
        beam._update_bunch_properties()

        context.phase_advance[0] += _plane_phase_advance(
            R[0:2, 0:2], beta_x_in, alpha_x_in, beam.beta_x(), length)
        context.phase_advance[1] += _plane_phase_advance(
            R[2:4, 2:4], beta_y_in, alpha_y_in, beam.beta_y(), length)

        # Propagate dispersion
        d = _dispersion_generation_vector(element)
        _propagate_dispersion(context, R, d)

        return EffectReport(
            module=self.name,
            element_index=context.element_index,
            details={"dispersion_x": float(context.dispersion[0]),
                     "dispersion_xp": float(context.dispersion[1]),
                     "time_of_flight_r56_s": float(R[4, 5]),
                     "phase_advance_x": float(context.phase_advance[0]),
                     "phase_advance_y": float(context.phase_advance[1])},
        )

    def _rigidity_scale(self, beam):
        """Ratio by which a magnet's focusing strength changes at this momentum.

        A magnet has a fixed GRADIENT; its focusing strength is
        k = 0.2998 * g / p, so k falls as the beam stiffens. The game's
        `focusStrength` stat is computed in component-physics.js as
        0.2998 * gradient / p with p HARDCODED to 1 GeV ("representative beam
        momentum"), so every quadrupole behaved as though the beam were 1 GeV
        no matter its actual energy — a quad was equally strong on a 50 keV
        injector and a 10 GeV linac.

        Rescaling by P_REF / p here recovers the real 1/p dependence while
        leaving the stat, and therefore the whole existing balance, exactly as
        it was at the 1 GeV reference point.

        The consequence is a real physics lesson rather than a nuisance: at
        50 keV the rigidity is ~4300x lower, so even a minimum-gradient quad is
        wildly over-focused. Low-energy transport wants solenoids, and quads
        become the right tool once the beam has stiffened. That is how real
        front ends are built.
        """
        p = _momentum_gev(beam)
        if p <= 0:
            return 1.0
        return P_REF_GEV / p

    def _transfer_matrix(self, element, beam):
        etype = element.get("type", "drift")
        length = element.get("length", 0.0)

        if etype == "source" or length == 0:
            return np.eye(6)

        if etype == "drift":
            return drift_matrix(length)

        if etype == "quadrupole":
            k = element.get("focusStrength", 1.0)
            polarity = element.get("polarity", 1)
            active, margin = _active_region(element)
            body = quadrupole_matrix(
                k * polarity * self._rigidity_scale(beam), active)
            return drift_matrix(margin) @ body @ drift_matrix(margin)

        if etype == "dipole":
            return dipole_matrix(element.get("bendAngle", 15.0), length)

        if etype == "combined_function":
            return combined_function_matrix(
                element.get("bendAngle", 10.0),
                element.get("focusStrength", 0.3),
                length,
            )

        if etype == "solenoid":
            B = element.get("fieldStrength", 1.0)
            # MOMENTUM, not energy. This read `p = beam.energy` with the note
            # "approximate momentum ~ energy for relativistic" — true at 1 GeV,
            # wrong by 2.4x at 50 keV, which is exactly the regime solenoids
            # exist for.
            active, margin = _active_region(element)
            body = solenoid_matrix(B, _momentum_gev(beam), active)
            return drift_matrix(margin) @ body @ drift_matrix(margin)

        if etype == "dcAccelerator":
            active, margin = _active_region(element)
            body = axisymmetric_focusing_matrix(
                max(0.0, element.get("focusStrength", 0.0)), active)
            return drift_matrix(margin) @ body @ drift_matrix(margin)

        if etype == "rfCavity" and element.get("game_type") == "rfq":
            return axisymmetric_focusing_matrix(
                max(0.0, element.get("focusStrength", 0.0)), length)

        if etype == "chicane":
            R = drift_matrix(length)
            r56 = element.get("r56", 0.0)
            if abs(r56) > 1e-15:
                R[4, 5] = r56
            return R

        # Everything else is drift-like
        return drift_matrix(length)
