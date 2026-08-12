"""Beam-gas scattering: the vacuum -> beam quality link.

The calibration anchors are the two ends of the useful pressure range:
1e-9 mbar is a well-pumped machine and must cost essentially nothing over
100 m; 1e-5 mbar is the "poor" end of the solver's quality map and must hurt.
"""
import math

import numpy as np
import pytest

from beam_physics.beam import BeamState
from beam_physics.context import PropagationContext
from beam_physics.modules.beam_gas import BeamGasModule, C_SCATTER, LAMBDA_REF, P_REF


def make_beam(energy=0.05, emittance=1e-8, current=0.1, beta_twiss=10.0):
    """Upright (alpha = 0) beam with the given geometric emittance and beta."""
    sigma = np.zeros((6, 6))
    sigma[0, 0] = emittance * beta_twiss
    sigma[1, 1] = emittance / beta_twiss
    sigma[2, 2] = emittance * beta_twiss
    sigma[3, 3] = emittance / beta_twiss
    sigma[4, 4] = (1e-12) ** 2
    sigma[5, 5] = (1e-3) ** 2
    return BeamState(sigma, energy, current)


def run(beam, pressure, length, module=None):
    module = module or BeamGasModule()
    ctx = PropagationContext("linac")
    element = {"type": "drift", "length": length, "pressure": pressure}
    return module.apply(beam, element, ctx)


def test_skips_when_pressure_absent():
    """Absent means no solver data, not perfect vacuum."""
    module = BeamGasModule()
    assert not module.applies_to({"type": "drift", "length": 10.0}, "linac")


def test_skips_zero_length_elements():
    module = BeamGasModule()
    assert not module.applies_to(
        {"type": "bpm", "length": 0.0, "pressure": 1e-5}, "linac")


def test_applies_to_pressurised_drift():
    module = BeamGasModule()
    assert module.applies_to(
        {"type": "drift", "length": 10.0, "pressure": 1e-6}, "linac")


def test_good_vacuum_is_negligible_over_100m():
    beam = make_beam()
    before = beam.emittance_x()
    run(beam, 1e-9, 100.0)
    growth = beam.emittance_x() / before
    assert growth < 1.01, f"1e-9 mbar should be free, got {growth:.4f}x"


def test_poor_vacuum_wrecks_emittance_over_100m():
    beam = make_beam()
    before = beam.emittance_x()
    run(beam, 1e-5, 100.0)
    growth = beam.emittance_x() / before
    assert growth > 2.0, f"1e-5 mbar should hurt, got {growth:.4f}x"


def test_emittance_growth_is_monotonic_in_pressure():
    growths = []
    for pressure in (1e-9, 1e-8, 1e-7, 1e-6, 1e-5):
        beam = make_beam()
        before = beam.emittance_x()
        run(beam, pressure, 100.0)
        growths.append(beam.emittance_x() / before)
    assert all(a < b for a, b in zip(growths, growths[1:])), growths


def test_scattering_scales_with_pressure_times_length():
    """P and L enter as a product — twice the pressure over half the length is
    the same insult."""
    a, b = make_beam(), make_beam()
    ra = run(a, 2e-6, 50.0)
    rb = run(b, 1e-6, 100.0)
    assert ra.details["d_theta2"] == pytest.approx(rb.details["d_theta2"], rel=1e-9)


def test_high_energy_beams_are_far_more_robust():
    """The 1/(beta gamma)^2 scaling: protect the injector, not the far end."""
    low = make_beam(energy=0.05)
    high = make_beam(energy=5.0)
    r_low = run(low, 1e-6, 100.0)
    r_high = run(high, 1e-6, 100.0)
    assert r_high.details["d_theta2"] < r_low.details["d_theta2"] / 100


def test_beam_gas_loss_follows_exponential_law():
    beam = make_beam()
    before = beam.current
    report = run(beam, P_REF, LAMBDA_REF)
    # One loss length at the reference pressure: survival = 1/e.
    assert report.details["survival"] == pytest.approx(math.exp(-1.0), rel=1e-9)
    assert beam.current == pytest.approx(before * math.exp(-1.0), rel=1e-9)


def test_loss_length_scales_inversely_with_pressure():
    """A decade better vacuum buys a decade more lifetime."""
    clean, dirty = make_beam(), make_beam()
    r_clean = run(clean, 1e-7, 100.0)
    r_dirty = run(dirty, 1e-6, 100.0)
    assert r_clean.details["loss_fraction"] < r_dirty.details["loss_fraction"]


def test_good_vacuum_loses_almost_no_current():
    beam = make_beam()
    before = beam.current
    run(beam, 1e-9, 100.0)
    assert beam.current > before * 0.999


def test_report_records_emittance_growth():
    beam = make_beam()
    report = run(beam, 1e-5, 100.0)
    assert report.details["d_emit_x"] > 0
    assert report.details["d_emit_y"] > 0
