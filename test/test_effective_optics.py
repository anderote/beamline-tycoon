"""Contracts for catalogue footprint versus active optics length."""

import numpy as np

from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.gameplay import beamline_config_from_game
from beam_physics.modules.linear_optics import LinearOpticsModule


def _beam():
    params = dict(DEFAULT_SOURCE)
    params.update({"energy": 1.0})
    return create_initial_beam(params)


def test_catalogue_active_length_is_separate_from_occupied_length():
    elements = beamline_config_from_game([{
        "type": "quadrupole",
        "physicsType": "quadrupole",
        "subL": 4,
        "activeLengthM": 0.25,
        "stats": {"focusStrength": 0.3},
    }])

    assert elements[0]["length"] == 2.0
    assert elements[0]["activeLength"] == 0.25


def test_short_active_quad_keeps_housing_as_drift():
    optics = LinearOpticsModule()
    compact_beam = _beam()
    compact = {
        "type": "quadrupole",
        "length": 2.0,
        "activeLength": 0.5,
        "focusStrength": 0.3,
        "polarity": 1,
    }
    full_beam = _beam()
    full = {
        **compact,
        "activeLength": 2.0,
    }

    optics.apply(compact_beam, compact, PropagationContext("linac"))
    optics.apply(full_beam, full, PropagationContext("linac"))

    # Both occupy 2 m, but only the compact magnet has 1.5 m of field-free
    # housing. The public module seam exposes the resulting beam transport.
    assert not np.allclose(compact_beam.sigma, full_beam.sigma,
                           rtol=1e-6, atol=1e-15)
    assert compact_beam.beam_size_x() > full_beam.beam_size_x()


def test_zero_active_length_reduces_to_a_drift():
    optics = LinearOpticsModule()
    active_beam = _beam()
    drift_beam = _beam()
    element = {
        "type": "quadrupole",
        "length": 0.5,
        "activeLength": 0.0,
        "focusStrength": 100.0,
        "polarity": 1,
    }
    drift = {"type": "drift", "length": 0.5}

    optics.apply(active_beam, element, PropagationContext("linac"))
    optics.apply(drift_beam, drift, PropagationContext("linac"))
    assert np.allclose(active_beam.sigma, drift_beam.sigma)


def test_dc_injector_declares_compact_active_lens_region():
    elements = beamline_config_from_game([{
        "type": "dcInjector",
        "physicsType": "dcAccelerator",
        "subL": 4,
        "activeLengthM": 0.35,
        "stats": {"energyGain": 0.00075, "focusStrength": 0.9},
    }])

    assert elements[0]["length"] == 2.0
    assert elements[0]["activeLength"] == 0.35
