"""
Beam Diagnostics — Measurement Models.

Each diagnostic instrument measures a BeamState quantity with finite
resolution. The measured value is the true value plus Gaussian noise
scaled by the instrument resolution.

Without a diagnostic installed, the player sees None ("???") for that
quantity. This module provides the noise model and readback aggregation.
"""

import math
import random


def _gaussian_noise(rng, sigma):
    """
    Generate a single Gaussian-distributed noise sample.

    Uses the Box-Muller transform with the provided random generator.

    Parameters
    ----------
    rng : random.Random or None
        Random number generator instance. If None, uses module-level random.
    sigma : float
        Standard deviation of the noise.

    Returns
    -------
    float
        A Gaussian-distributed random value with mean 0 and std dev sigma.
    """
    if rng is None:
        u1 = random.random()
        u2 = random.random()
    else:
        u1 = rng.random()
        u2 = rng.random()

    # Avoid log(0)
    u1 = max(u1, 1.0e-15)

    z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    return z * sigma


def measure_position(true_pos_mm, resolution_um, rng=None):
    """
    Simulate a beam position monitor (BPM) measurement.

    Parameters
    ----------
    true_pos_mm : float
        True beam position in mm.
    resolution_um : float
        BPM resolution in micrometres (1 sigma).
    rng : random.Random or None
        Random number generator for reproducibility.

    Returns
    -------
    float
        Measured position in mm.
    """
    noise_mm = _gaussian_noise(rng, resolution_um / 1000.0)
    return true_pos_mm + noise_mm


def measure_current(true_current_ma, resolution_ua, rng=None):
    """
    Simulate a beam current monitor measurement.

    Parameters
    ----------
    true_current_ma : float
        True beam current in mA.
    resolution_ua : float
        Current monitor resolution in microamperes (1 sigma).
    rng : random.Random or None
        Random number generator for reproducibility.

    Returns
    -------
    float
        Measured current in mA (clamped to >= 0).
    """
    noise_ma = _gaussian_noise(rng, resolution_ua / 1000.0)
    return max(0.0, true_current_ma + noise_ma)


def measure_emittance(true_emit, resolution_frac, rng=None):
    """
    Simulate an emittance measurement (e.g. from a wire scanner).

    Parameters
    ----------
    true_emit : float
        True geometric emittance in m-rad.
    resolution_frac : float
        Fractional resolution (e.g. 0.1 = 10% of true value, 1 sigma).
    rng : random.Random or None
        Random number generator for reproducibility.

    Returns
    -------
    float
        Measured emittance in m-rad (clamped to >= 0).
    """
    sigma = true_emit * resolution_frac
    noise = _gaussian_noise(rng, sigma)
    return max(0.0, true_emit + noise)


def measure_energy(true_energy_gev, resolution_pct, rng=None):
    """
    Simulate a beam energy measurement (e.g. from a spectrometer).

    Parameters
    ----------
    true_energy_gev : float
        True beam energy in GeV.
    resolution_pct : float
        Energy resolution as a percentage (e.g. 0.1 = 0.1%).
    rng : random.Random or None
        Random number generator for reproducibility.

    Returns
    -------
    float
        Measured energy in GeV (clamped to >= 0).
    """
    sigma = true_energy_gev * resolution_pct / 100.0
    noise = _gaussian_noise(rng, sigma)
    return max(0.0, true_energy_gev + noise)


def measure_bunch_length(true_bl_ps, resolution_ps, rng=None):
    """
    Simulate a bunch length measurement (e.g. streak camera).

    Parameters
    ----------
    true_bl_ps : float
        True RMS bunch length in picoseconds.
    resolution_ps : float
        Measurement resolution in picoseconds (1 sigma).
    rng : random.Random or None
        Random number generator for reproducibility.

    Returns
    -------
    float
        Measured bunch length in picoseconds (clamped to >= 0).
    """
    noise = _gaussian_noise(rng, resolution_ps)
    return max(0.0, true_bl_ps + noise)


# Diagnostic type registry: maps type name to (beam_state_attr, measure_func, default_kwargs)
DIAGNOSTIC_TYPES = {
    "bpm_x": {
        "quantity": "beam_size_x",
        "unit": "mm",
        "measure": measure_position,
        "default_resolution_key": "resolution_um",
        "default_resolution": 10.0,
    },
    "bpm_y": {
        "quantity": "beam_size_y",
        "unit": "mm",
        "measure": measure_position,
        "default_resolution_key": "resolution_um",
        "default_resolution": 10.0,
    },
    "current_monitor": {
        "quantity": "current",
        "unit": "mA",
        "measure": measure_current,
        "default_resolution_key": "resolution_ua",
        "default_resolution": 1.0,
    },
    "emittance_x": {
        "quantity": "emittance_x",
        "unit": "m-rad",
        "measure": measure_emittance,
        "default_resolution_key": "resolution_frac",
        "default_resolution": 0.1,
    },
    "emittance_y": {
        "quantity": "emittance_y",
        "unit": "m-rad",
        "measure": measure_emittance,
        "default_resolution_key": "resolution_frac",
        "default_resolution": 0.1,
    },
    "energy_spectrometer": {
        "quantity": "energy",
        "unit": "GeV",
        "measure": measure_energy,
        "default_resolution_key": "resolution_pct",
        "default_resolution": 0.1,
    },
    "bunch_length_monitor": {
        "quantity": "bunch_length",
        "unit": "ps",
        "measure": measure_bunch_length,
        "default_resolution_key": "resolution_ps",
        "default_resolution": 0.5,
    },
}


def diagnostic_readback(beam_state, diagnostics_list, rng=None):
    """
    Produce a full readback of all installed diagnostics.

    For each diagnostic in the list, measure the corresponding beam
    quantity with appropriate noise. Quantities without a diagnostic
    return None (displayed as "???" in the UI).

    Parameters
    ----------
    beam_state : dict
        Beam state snapshot dict with keys like "beam_size_x", "current",
        "energy", "emittance_x", "emittance_y", "bunch_length".
    diagnostics_list : list of dict
        Each dict has at minimum {"type": "bpm_x"} and optionally
        a resolution override, e.g. {"type": "bpm_x", "resolution_um": 5.0}.
    rng : random.Random or None
        Random number generator for reproducibility.

    Returns
    -------
    dict
        Keys are quantity names (e.g. "beam_size_x", "current"),
        values are measured floats or None if no diagnostic is installed.
    """
    # Start with all quantities unknown
    all_quantities = [
        "beam_size_x", "beam_size_y", "current", "energy",
        "emittance_x", "emittance_y", "bunch_length",
    ]
    readback = {q: None for q in all_quantities}

    for diag in diagnostics_list:
        dtype = diag.get("type", "")
        spec = DIAGNOSTIC_TYPES.get(dtype)
        if spec is None:
            continue

        quantity = spec["quantity"]
        true_value = beam_state.get(quantity)
        if true_value is None:
            continue

        # Get resolution (use override or default)
        res_key = spec["default_resolution_key"]
        resolution = diag.get(res_key, spec["default_resolution"])

        # Call the appropriate measurement function
        measured = spec["measure"](true_value, resolution, rng)
        readback[quantity] = measured

    return readback
