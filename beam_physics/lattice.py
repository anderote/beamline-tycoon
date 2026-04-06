import numpy as np
from scipy.special import erf

from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_APERTURE, DEFAULT_SOURCE, TRIP_THRESHOLD
from beam_physics.elements import transfer_matrix, sextupole_correction_factor, collimator_aperture, apply_rf_damping
from beam_physics.radiation import (
    synchrotron_energy_loss,
    quantum_excitation_emittance_growth,
    undulator_energy_loss,
    photon_rate,
)


def compute_loss_fraction(beam, aperture):
    """
    Compute fraction of beam lost at an aperture.

    Uses the beam sigma to estimate what fraction of the Gaussian
    distribution exceeds the aperture radius.
    """
    sx = beam.beam_size_x()
    sy = beam.beam_size_y()

    if sx < 1e-15 or sy < 1e-15:
        return 0.0

    # Fraction within aperture for 2D Gaussian with independent x, y
    fx = erf(aperture / (np.sqrt(2.0) * sx))
    fy = erf(aperture / (np.sqrt(2.0) * sy))
    survived = fx * fy
    return max(0.0, 1.0 - survived)


def clip_sigma(beam, aperture):
    """
    Truncate the sigma matrix at a collimator.
    Reduces beam size to at most the aperture, representing
    the removal of tails.
    """
    a2 = aperture ** 2
    if beam.sigma[0, 0] > a2:
        scale = a2 / beam.sigma[0, 0]
        beam.sigma[0, 0] = a2
        beam.sigma[0, 1] *= np.sqrt(scale)
        beam.sigma[1, 0] *= np.sqrt(scale)
    if beam.sigma[2, 2] > a2:
        scale = a2 / beam.sigma[2, 2]
        beam.sigma[2, 2] = a2
        beam.sigma[2, 3] *= np.sqrt(scale)
        beam.sigma[3, 2] *= np.sqrt(scale)


def propagate(beamline_config, source_params=None):
    """
    Propagate a beam through a beamline configuration.

    Args:
        beamline_config: list of element dicts, each with:
            - type: str (source, drift, quadrupole, dipole, rfCavity, etc.)
            - length: float (m)
            - plus type-specific params (bendAngle, focusStrength, energyGain, etc.)
        source_params: dict of source parameters (uses defaults if None)

    Returns:
        dict with:
            - snapshots: list of per-element beam state dicts
            - summary: dict with final beam quantities for gameplay
    """
    params = dict(DEFAULT_SOURCE)
    if source_params:
        params.update(source_params)

    beam = create_initial_beam(params)
    initial_current = beam.current
    initial_eps_x = beam.emittance_x()
    initial_eps_y = beam.emittance_y()

    snapshots = []
    total_photon_rate = 0.0
    luminosities = []
    collision_rates = []
    chromaticity_correction = 0.0
    cumulative_loss = 0.0
    n_focusing = 0  # count of focusing elements (quads, sextupoles)

    cumulative_s = 0.0
    quad_index = 0
    for i, element in enumerate(beamline_config):
        etype = element["type"]

        if etype == "source":
            # Source just sets initial conditions, already done
            snapshots.append(beam.snapshot(i, etype, 0.0))
            continue

        # Auto-alternate quad focusing if not explicitly set
        if etype == "quadrupole" and "focusing" not in element:
            element = dict(element)
            element["focusing"] = (quad_index % 2 == 0)
        if etype in ("quadrupole", "sextupole"):
            n_focusing += 1
        if etype == "quadrupole":
            quad_index += 1

        # Get transfer matrix and propagate sigma
        R = transfer_matrix(element, beam.energy, beam.mass)
        beam.sigma = R @ beam.sigma @ R.T

        # Ensure sigma stays symmetric (numerical safety)
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # --- Element-specific effects ---

        # Synchrotron radiation in dipoles
        if etype == "dipole":
            angle = element.get("bendAngle", 15.0)
            length = element.get("length", 3.0)
            U = synchrotron_energy_loss(beam.energy, angle, length, beam.mass)
            beam.energy = max(beam.energy - U, beam.mass)
            beam.update_relativistic()
            beam.sigma = quantum_excitation_emittance_growth(
                beam.sigma, beam.energy, angle, length, beam.mass
            )

        # RF cavity / cryomodule: energy gain + adiabatic damping
        if etype in ("rfCavity", "cryomodule"):
            dE = element.get("energyGain", 0.5)
            energy_before = beam.energy
            beam.energy += dE
            beam.update_relativistic()
            beam.sigma = apply_rf_damping(beam.sigma, energy_before, beam.energy)

        # Sextupole: accumulate chromatic correction
        if etype == "sextupole":
            strength = element.get("focusStrength", 0.5)
            length = element.get("length", 2.0)
            chromaticity_correction += sextupole_correction_factor(strength, length)

        # Collimator: clip beam
        if etype == "collimator":
            bq = element.get("beamQuality", 0.2)
            coll_aperture = collimator_aperture(bq)
            loss = compute_loss_fraction(beam, coll_aperture)
            beam.current *= (1.0 - loss)
            cumulative_loss += loss * (1.0 - cumulative_loss)
            clip_sigma(beam, coll_aperture)

        # Undulator: photon production + small energy loss
        if etype == "undulator":
            length = element.get("length", 5.0)
            period = 0.03  # 30mm period, typical
            n_periods = int(length / period)
            U = undulator_energy_loss(beam.energy, n_periods, period, beam.mass)
            beam.energy = max(beam.energy - U, beam.mass)
            beam.update_relativistic()
            total_photon_rate += photon_rate(beam.energy, beam.current, n_periods)

        # Detector: compute luminosity
        if etype == "detector":
            sx = beam.beam_size_x()
            sy = beam.beam_size_y()
            if sx > 0 and sy > 0:
                L = beam.current**2 / (4.0 * np.pi * sx * sy)
                luminosities.append(L)

        # Target: compute collision rate
        if etype == "target":
            collision_rates.append(beam.current * element.get("collisionRate", 2.0))

        # Aperture check (all elements)
        aperture = element.get("aperture", DEFAULT_APERTURE)
        loss = compute_loss_fraction(beam, aperture)
        beam.current *= (1.0 - loss)
        cumulative_loss = 1.0 - (beam.current / initial_current)

        # Trip check
        if cumulative_loss > TRIP_THRESHOLD:
            beam.alive = False

        cumulative_s += element.get("length", 0.0)
        snapshots.append(beam.snapshot(i, etype, cumulative_s))

        if not beam.alive:
            break

    # Apply chromaticity correction retroactively
    # Reduces effective emittance growth from energy-spread-driven effects
    if chromaticity_correction > 0:
        correction = min(chromaticity_correction, 0.9)  # cap at 90%
        # Don't actually shrink below initial; just reduce growth
        eps_x_growth = beam.emittance_x() - initial_eps_x
        eps_y_growth = beam.emittance_y() - initial_eps_y
        if eps_x_growth > 0:
            reduction_x = eps_x_growth * correction
            beam.sigma[0, 0] -= reduction_x * beam.beta_x()
            beam.sigma[1, 1] -= reduction_x / max(beam.beta_x(), 1e-10)
        if eps_y_growth > 0:
            reduction_y = eps_y_growth * correction
            beam.sigma[2, 2] -= reduction_y * beam.beta_y()
            beam.sigma[3, 3] -= reduction_y / max(beam.beta_y(), 1e-10)

    # Beam quality: how well emittance is preserved
    final_eps = 0.5 * (beam.emittance_x() + beam.emittance_y())
    initial_eps = 0.5 * (initial_eps_x + initial_eps_y)
    if initial_eps > 0:
        beam_quality = max(0.0, min(1.0, initial_eps / final_eps))
    else:
        beam_quality = 0.0

    summary = {
        "final_energy": beam.energy,
        "final_current": beam.current,
        "initial_current": initial_current,
        "luminosity": sum(luminosities),
        "collision_rate": sum(collision_rates),
        "photon_rate": total_photon_rate,
        "beam_quality": beam_quality,
        "alive": beam.alive,
        "total_loss_fraction": cumulative_loss,
        "final_emittance_x": beam.emittance_x(),
        "final_emittance_y": beam.emittance_y(),
        "final_norm_emittance_x": beam.norm_emittance_x(),
        "final_norm_emittance_y": beam.norm_emittance_y(),
        "final_energy_spread": beam.energy_spread(),
        "final_beam_size_x": beam.beam_size_x(),
        "final_beam_size_y": beam.beam_size_y(),
        "n_focusing": n_focusing,
    }

    return {"snapshots": snapshots, "summary": summary}
