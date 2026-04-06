import unittest
import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, ELECTRON_CHARGE


class TestBeamStateBunchProperties(unittest.TestCase):
    def test_default_bunch_frequency(self):
        params = dict(DEFAULT_SOURCE)
        beam = create_initial_beam(params)
        self.assertGreater(beam.bunch_frequency, 0)

    def test_n_particles_from_current(self):
        params = dict(DEFAULT_SOURCE)
        params["current"] = 1.0
        params["bunch_frequency"] = 1.0e6
        beam = create_initial_beam(params)
        expected = 1.0e-3 / (ELECTRON_CHARGE * 1.0e6)
        self.assertAlmostEqual(beam.n_particles, expected, delta=expected * 0.01)

    def test_peak_current_from_bunch_length(self):
        params = dict(DEFAULT_SOURCE)
        params["current"] = 1.0
        params["bunch_frequency"] = 1.0e6
        beam = create_initial_beam(params)
        charge = 1.0e-3 / 1.0e6
        sigma_t = beam.bunch_length()
        expected = charge / (np.sqrt(2 * np.pi) * sigma_t) if sigma_t > 0 else 0
        self.assertAlmostEqual(beam.peak_current, expected, delta=expected * 0.01)

    def test_snapshot_includes_new_fields(self):
        params = dict(DEFAULT_SOURCE)
        beam = create_initial_beam(params)
        snap = beam.snapshot(0, "source", 0.0)
        self.assertIn("peak_current", snap)
        self.assertIn("n_particles", snap)
        self.assertIn("bunch_frequency", snap)


if __name__ == "__main__":
    unittest.main()
