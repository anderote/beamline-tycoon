import numpy as np


def _block_diag_6x6(Rx, Ry, Rlong=None):
    """Build a 6x6 transfer matrix from 2x2 blocks for x, y, and longitudinal."""
    R = np.eye(6)
    R[0:2, 0:2] = Rx
    R[2:4, 2:4] = Ry
    if Rlong is not None:
        R[4:6, 4:6] = Rlong
    return R


def drift_matrix(length):
    """Drift space of given length (m)."""
    Rx = np.array([[1.0, length], [0.0, 1.0]])
    Ry = np.array([[1.0, length], [0.0, 1.0]])
    return _block_diag_6x6(Rx, Ry)


def quadrupole_matrix(k, length):
    """
    Quadrupole magnet.

    k > 0: focusing in x, defocusing in y
    k < 0: defocusing in x, focusing in y
    k: quadrupole strength in 1/m^2
    length: effective length in m
    """
    if abs(k) < 1e-10:
        return drift_matrix(length)

    sqrt_k = np.sqrt(abs(k))
    phi = sqrt_k * length

    # Focusing 2x2
    Rf = np.array([
        [np.cos(phi), np.sin(phi) / sqrt_k],
        [-sqrt_k * np.sin(phi), np.cos(phi)]
    ])

    # Defocusing 2x2
    Rd = np.array([
        [np.cosh(phi), np.sinh(phi) / sqrt_k],
        [sqrt_k * np.sinh(phi), np.cosh(phi)]
    ])

    if k > 0:
        Rx, Ry = Rf, Rd
    else:
        Rx, Ry = Rd, Rf

    return _block_diag_6x6(Rx, Ry)


def dipole_matrix(bend_angle_deg, length):
    """
    Sector dipole magnet.

    bend_angle_deg: bend angle in degrees
    length: arc length in m

    Returns 6x6 matrix including dispersion coupling.
    """
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return drift_matrix(length)

    rho = length / theta  # bending radius

    c = np.cos(theta)
    s = np.sin(theta)

    R = np.eye(6)

    # Horizontal (bend) plane
    R[0, 0] = c
    R[0, 1] = rho * s
    R[1, 0] = -s / rho
    R[1, 1] = c

    # Dispersion: x-dE/E coupling
    R[0, 5] = rho * (1.0 - c)
    R[1, 5] = s

    # Vertical plane: drift-like
    R[2, 2] = 1.0
    R[2, 3] = length
    R[3, 2] = 0.0
    R[3, 3] = 1.0

    # Path length dependence on energy (longitudinal)
    R[4, 0] = s
    R[4, 1] = rho * (1.0 - c)
    R[4, 5] = rho * (theta - s)

    return R


def rf_cavity_matrix(energy_gain, beam_energy, beam_mass, length):
    """
    RF cavity / cryomodule.

    Returns a pure drift matrix for the transfer. Adiabatic damping
    and energy change are applied to the sigma matrix directly in
    lattice.py to preserve symplecticity of the transport.
    """
    return drift_matrix(length)


def apply_rf_damping(sigma, energy_before, energy_after):
    """
    Apply adiabatic damping to the sigma matrix after an RF cavity.

    When a beam is accelerated, its transverse emittance shrinks by the
    ratio of momenta (adiabatic damping). This is applied directly to
    sigma to avoid breaking symplecticity of the transfer matrix.
    """
    if energy_before <= 0 or energy_after <= 0:
        return sigma
    ratio = energy_before / energy_after
    # Transverse planes: scale divergence-related terms
    # x' scales by ratio, so sigma terms involving x' get ratio or ratio^2
    sigma[1, :] *= ratio
    sigma[:, 1] *= ratio
    sigma[3, :] *= ratio
    sigma[:, 3] *= ratio
    return sigma


def sextupole_correction_factor(strength, length):
    """
    Sextupoles don't have a linear transfer matrix.
    Returns a chromatic correction factor (0 to 1) that reduces
    chromaticity-driven emittance growth in neighboring quads.

    strength: sextupole strength parameter from game
    length: element length in m
    """
    # Map game strength to correction: strength of 0.5 gives ~30% correction
    return min(1.0, strength * 0.6)


def collimator_aperture(game_beam_quality):
    """
    Collimator aperture derived from game stat.
    Tighter collimators clean better but cut more beam.
    """
    # Base aperture 25mm, beamQuality stat tightens it
    base = 0.025
    return base * (1.0 - 0.3 * game_beam_quality)


def solenoid_matrix(B_field, momentum_gev, length):
    """
    Solenoid magnet transfer matrix (4x4 transverse coupled to 6x6).

    Solenoids couple x and y planes via rotation in the Larmor frame.

    B_field: magnetic field in Tesla
    momentum_gev: beam momentum in GeV/c
    length: effective length in m

    Returns: 6x6 numpy transfer matrix
    """
    if abs(B_field) < 1e-12 or momentum_gev <= 0:
        return drift_matrix(length)

    # Focusing strength: k = e*c * B / (2 * p)
    # e*c = 0.2998 GeV/(T*m)
    k = 0.2998 * B_field / (2.0 * momentum_gev)
    phi = k * length
    C = np.cos(phi)
    S = np.sin(phi)

    R = np.eye(6)

    # 4x4 transverse block (x, x', y, y')
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

    # Longitudinal block: same as drift
    R[4, 5] = length

    return R


def transfer_matrix(element, beam_energy=None, beam_mass=None):
    """
    Dispatch to the appropriate matrix builder based on element type.

    element: dict with 'type', 'length', and type-specific params
    beam_energy: current beam energy (needed for RF cavities)
    beam_mass: particle rest mass (needed for RF cavities)

    Returns: 6x6 numpy transfer matrix
    """
    etype = element["type"]
    length = element["length"]

    if etype == "source":
        return np.eye(6)

    elif etype == "drift":
        return drift_matrix(length)

    elif etype == "quadrupole":
        k = element.get("focusStrength", 1.0)
        # Use polarity (+1/-1) if set, fall back to legacy "focusing" flag
        polarity = element.get("polarity", None)
        if polarity is not None:
            sign = float(polarity)
        else:
            sign = 1.0 if element.get("focusing", True) else -1.0
        return quadrupole_matrix(k * sign, length)

    elif etype == "dipole":
        angle = element.get("bendAngle", 15.0)
        return dipole_matrix(angle, length)

    elif etype in ("rfCavity", "cryomodule"):
        dE = element.get("energyGain", 0.5)
        return rf_cavity_matrix(
            dE,
            beam_energy or 0.01,
            beam_mass or 0.511e-3,
            length,
        )

    elif etype == "sextupole":
        # Linear part is a drift; chromatic correction applied separately
        return drift_matrix(length)

    elif etype == "collimator":
        # Collimator is a drift; clipping applied separately
        return drift_matrix(length)

    elif etype == "undulator":
        # Undulator is drift-like for the beam
        return drift_matrix(length)

    elif etype == "solenoid":
        B = element.get("fieldStrength", 1.0)  # Tesla
        p = beam_energy or 0.01  # approximate momentum ~ energy for relativistic
        return solenoid_matrix(B, p, length)

    elif etype == "chicane":
        # 4-dipole bunch compressor; linear transport is drift-like.
        # R56 is stored on the element for use in longitudinal dynamics.
        R = drift_matrix(length)
        r56 = element.get("r56", 0.0)  # metres
        R[4, 5] = r56 if abs(r56) > 1e-15 else R[4, 5]
        return R

    elif etype == "buncher":
        # Sub-harmonic buncher cavity; drift-like linear transport
        return drift_matrix(length)

    elif etype == "kicker":
        # Fast kicker magnet; drift-like linear transport
        return drift_matrix(length)

    elif etype == "septum":
        # Extraction septum; drift-like linear transport
        return drift_matrix(length)

    elif etype in ("detector", "target"):
        # Thin interaction point
        return np.eye(6)

    else:
        # Unknown element: treat as drift
        return drift_matrix(length)
