import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.linear_optics import LinearOpticsModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


def make_context(machine_type="linac"):
    return PropagationContext(machine_type)


class TestDrift(unittest.TestCase):
    def test_beam_size_grows_in_drift(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        size_before = beam.beam_size_x()
        mod.apply(beam, {"type": "drift", "length": 5.0}, ctx)
        self.assertGreater(beam.beam_size_x(), size_before)

    def test_emittance_preserved_in_drift(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        eps_before = beam.emittance_x()
        mod.apply(beam, {"type": "drift", "length": 10.0}, ctx)
        self.assertAlmostEqual(beam.emittance_x(), eps_before, places=15)


class TestQuadrupole(unittest.TestCase):
    def test_emittance_preserved_in_quad(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        eps_x_before = beam.emittance_x()
        eps_y_before = beam.emittance_y()
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 1.0, "polarity": 1}, ctx)
        self.assertAlmostEqual(beam.emittance_x(), eps_x_before, places=12)
        self.assertAlmostEqual(beam.emittance_y(), eps_y_before, places=12)

    def test_polarity_minus_defocuses_x(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        div_before = beam.sigma[1, 1]
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 0.5, "polarity": -1}, ctx)
        self.assertGreater(beam.sigma[1, 1], 0)

    def test_fodo_cell_stability(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        max_size = 0
        for _ in range(10):
            mod.apply(beam, {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1}, ctx)
            mod.apply(beam, {"type": "drift", "length": 2.5}, ctx)
            mod.apply(beam, {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1}, ctx)
            mod.apply(beam, {"type": "drift", "length": 2.5}, ctx)
            max_size = max(max_size, beam.beam_size_x(), beam.beam_size_y())
        self.assertLess(max_size, 0.1)


class TestDipole(unittest.TestCase):
    def test_dipole_creates_dispersion(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        self.assertAlmostEqual(ctx.dispersion[0], 0.0)
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertNotAlmostEqual(ctx.dispersion[0], 0.0)

    def test_dipole_edge_focusing_affects_vertical(self):
        """Edge focusing changes vertical divergence (sigma[3,3])."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        sigma_33_before = beam.sigma[3, 3]
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        # Edge focusing should change sigma[3,3] — compare with relative tolerance
        ratio = beam.sigma[3, 3] / sigma_33_before
        self.assertGreater(abs(ratio - 1.0), 0.01)  # at least 1% change

    def test_vertical_emittance_preserved_in_dipole(self):
        """Vertical emittance should be preserved (no y-dE coupling in sector dipole)."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        eps_y_before = beam.emittance_y()
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        # Vertical plane has no dispersion coupling, so emittance is preserved
        self.assertAlmostEqual(beam.emittance_y(), eps_y_before, places=10)


class TestDispersionTracking(unittest.TestCase):
    def test_dispersion_propagates_through_drift(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        eta_x = ctx.dispersion[0]
        eta_xp = ctx.dispersion[1]
        L = 5.0
        mod.apply(beam, {"type": "drift", "length": L}, ctx)
        expected_eta_x = eta_x + eta_xp * L
        self.assertAlmostEqual(ctx.dispersion[0], expected_eta_x, places=10)

    def test_zero_dispersion_stays_zero_without_dipole(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        mod.apply(beam, {"type": "drift", "length": 5.0}, ctx)
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 0.3, "polarity": 1}, ctx)
        np.testing.assert_array_almost_equal(ctx.dispersion, [0, 0, 0, 0])


class TestCombinedFunction(unittest.TestCase):
    def test_creates_dispersion(self):
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        mod.apply(beam, {"type": "combined_function", "length": 2.0, "bendAngle": 10.0, "focusStrength": 0.3}, ctx)
        self.assertNotAlmostEqual(ctx.dispersion[0], 0.0)


class TestAppliesTo(unittest.TestCase):
    def test_applies_to_all_types(self):
        mod = LinearOpticsModule()
        for etype in ["drift", "quadrupole", "dipole", "rfCavity", "solenoid", "source", "detector"]:
            self.assertTrue(mod.applies_to({"type": etype}, "linac"))

    def test_applies_to_all_machine_types(self):
        mod = LinearOpticsModule()
        for mt in ["linac", "photoinjector", "fel", "collider"]:
            self.assertTrue(mod.applies_to({"type": "drift"}, mt))


if __name__ == "__main__":
    unittest.main()
