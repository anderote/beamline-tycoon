import unittest
import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, ELECTRON_CHARGE


class TestBeamStateBunchProperties(unittest.TestCase):
    def test_beam_leaves_the_source_unbunched(self):
        """A source emits a DC beam; the first RF element bunches it.

        This used to assert a 1.3 GHz default, which meant a DC thermionic gun
        was modelled as bunched into 1 ps packets from the moment of emission —
        reporting 307x its real peak current straight into the space-charge
        perveance.
        """
        beam = create_initial_beam(dict(DEFAULT_SOURCE))
        self.assertEqual(beam.bunch_frequency, 0.0)
        self.assertAlmostEqual(beam.peak_current, beam.current * 1e-3)

    def test_bunching_raises_peak_current(self):
        params = dict(DEFAULT_SOURCE)
        params["bunch_frequency"] = 1.3e9
        bunched = create_initial_beam(params)
        dc = create_initial_beam(dict(DEFAULT_SOURCE))
        self.assertGreater(bunched.peak_current, dc.peak_current)

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
        self.assertIn("rel_beta", snap)
        self.assertIn("rel_gamma", snap)
        self.assertGreater(snap["rel_beta"], 0)


if __name__ == "__main__":
    unittest.main()
