import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport


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


class LinearOpticsModule(PhysicsModule):
    """Transfer matrix propagation and dispersion tracking."""

    def __init__(self):
        super().__init__(name="linear_optics", order=10)

    def applies_to(self, element, machine_type):
        return True

    def apply(self, beam, element, context):
        etype = element.get("type", "drift")
        length = element.get("length", 0.0)

        R = self._transfer_matrix(element, beam)

        # For dipoles, compose edge focusing into the full transfer matrix
        # R_total = R_edge_exit @ R_body @ R_edge_entry
        if etype == "dipole":
            R_edge = dipole_edge_matrix(element.get("bendAngle", 0.0), length)
            R = R_edge @ R @ R_edge

        # Apply full transfer matrix
        beam.sigma = R @ beam.sigma @ R.T
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # Propagate dispersion
        d = _dispersion_generation_vector(element)
        _propagate_dispersion(context, R, d)

        return EffectReport(
            module=self.name,
            element_index=context.element_index,
            details={"dispersion_x": float(context.dispersion[0]),
                     "dispersion_xp": float(context.dispersion[1])},
        )

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
            return quadrupole_matrix(k * polarity, length)

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
            p = beam.energy
            return solenoid_matrix(B, p, length)

        if etype == "chicane":
            R = drift_matrix(length)
            r56 = element.get("r56", 0.0)
            if abs(r56) > 1e-15:
                R[4, 5] = r56
            return R

        # Everything else is drift-like
        return drift_matrix(length)
