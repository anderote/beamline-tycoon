"""Tests for all physics modules (Tasks 4-10)."""
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, ELECTRON_MASS
from beam_physics.context import PropagationContext
from beam_physics.modules.rf_acceleration import RFAccelerationModule
from beam_physics.modules.synchrotron_rad import SynchrotronRadiationModule
from beam_physics.modules.aperture_loss import ApertureLossModule
from beam_physics.modules.collimation import CollimationModule
from beam_physics.modules.space_charge import SpaceChargeModule
from beam_physics.modules.bunch_compression import BunchCompressionModule
from beam_physics.modules.fel_gain import FELGainModule
from beam_physics.modules.beam_beam import BeamBeamModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


# === RF Acceleration ===

class TestRFAcceleration(unittest.TestCase):
    def test_on_crest_energy_gain(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        self.assertAlmostEqual(beam.energy, e_before + 0.5, places=6)

    def test_off_crest_reduced_gain(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": -20.0}, ctx)
        expected = e_before + 0.5 * np.cos(np.radians(-20.0))
        self.assertAlmostEqual(beam.energy, expected, places=6)

    def test_emittance_shrinks_with_acceleration(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        eps_before = beam.emittance_x()
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        self.assertLess(beam.emittance_x(), eps_before)

    def test_off_crest_creates_chirp(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("fel")
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": -20.0}, ctx)
        self.assertNotAlmostEqual(ctx.chirp, 0.0)

    def test_on_crest_no_chirp(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        self.assertAlmostEqual(ctx.chirp, 0.0, places=10)

    def test_applies_to_rf_elements(self):
        mod = RFAccelerationModule()
        self.assertTrue(mod.applies_to({"type": "rfCavity"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "cryomodule"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))

    # --- Task 1: DESIGN_BETA table ---

    def test_design_beta_lookup(self):
        from beam_physics.modules.rf_acceleration import DESIGN_BETA
        self.assertAlmostEqual(DESIGN_BETA["rfq"], 0.04)
        self.assertAlmostEqual(DESIGN_BETA["cryomodule"], 0.65)
        self.assertIn("buncher", DESIGN_BETA)

    # --- Task 2: Transit time factor ---

    def test_transit_time_factor_at_design_beta(self):
        from beam_physics.modules.rf_acceleration import _transit_time_factor
        ttf = _transit_time_factor(beam_beta=0.04, design_beta=0.04)
        self.assertAlmostEqual(ttf, 1.0, places=2)

    def test_transit_time_factor_mismatch(self):
        from beam_physics.modules.rf_acceleration import _transit_time_factor
        ttf = _transit_time_factor(beam_beta=0.04, design_beta=0.9)
        self.assertLess(ttf, 0.3)

    def test_transit_time_factor_high_beta(self):
        from beam_physics.modules.rf_acceleration import _transit_time_factor
        ttf = _transit_time_factor(beam_beta=0.99, design_beta=0.9)
        self.assertGreater(ttf, 0.8)

    def test_energy_gain_derated_by_ttf(self):
        mod = RFAccelerationModule()
        beam_matched = make_beam(energy=0.5)
        beam_low = make_beam(energy=0.001)
        ctx1 = PropagationContext("linac")
        ctx2 = PropagationContext("linac")
        e1 = beam_matched.energy
        e2 = beam_low.energy
        el = {"type": "rfCavity", "length": 3.0, "energyGain": 0.045,
              "rfPhase": 0.0, "game_type": "rfCavity"}
        mod.apply(beam_matched, el.copy(), ctx1)
        mod.apply(beam_low, el.copy(), ctx2)
        gain_matched = beam_matched.energy - e1
        gain_low = beam_low.energy - e2
        self.assertGreater(gain_matched, gain_low)

    # --- Task 3: RF capture efficiency ---

    def test_first_rf_applies_capture_loss(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        current_before = beam.current
        mod.apply(beam, {"type": "rfCavity", "length": 3.0, "energyGain": 0.1,
                         "rfPhase": -30.0, "game_type": "rfCavity"}, ctx)
        self.assertLess(beam.current, current_before)

    def test_second_rf_no_capture_loss(self):
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        mod.apply(beam, {"type": "rfCavity", "length": 3.0, "energyGain": 0.1,
                         "rfPhase": -30.0, "game_type": "rfCavity"}, ctx)
        current_after_first = beam.current
        mod.apply(beam, {"type": "rfCavity", "length": 3.0, "energyGain": 0.1,
                         "rfPhase": 0.0, "game_type": "rfCavity"}, ctx)
        self.assertAlmostEqual(beam.current, current_after_first, places=4)

    def test_rfq_better_capture_than_pillbox(self):
        mod = RFAccelerationModule()
        beam_rfq = make_beam()
        beam_pb = make_beam()
        ctx_rfq = PropagationContext("linac")
        ctx_pb = PropagationContext("linac")
        mod.apply(beam_rfq, {"type": "rfCavity", "length": 3.0, "energyGain": 0.003,
                             "rfPhase": -30.0, "game_type": "rfq"}, ctx_rfq)
        mod.apply(beam_pb, {"type": "rfCavity", "length": 1.0, "energyGain": 0.0005,
                            "rfPhase": -30.0, "game_type": "pillboxCavity"}, ctx_pb)
        self.assertGreater(beam_rfq.current, beam_pb.current)

    # --- Task 4: Beta-mismatch emittance growth ---

    def test_beta_mismatch_grows_emittance(self):
        mod = RFAccelerationModule()
        beam_match = make_beam(energy=0.5)
        beam_mismatch = make_beam(energy=0.0008)
        ctx1 = PropagationContext("linac")
        ctx2 = PropagationContext("linac")
        ctx1.bunch_frequency_set = True
        ctx2.bunch_frequency_set = True
        eps_match_before = beam_match.emittance_x()
        eps_mismatch_before = beam_mismatch.emittance_x()
        el = {"type": "rfCavity", "length": 3.0, "energyGain": 1e-6,
              "rfPhase": 0.0, "game_type": "rfCavity"}
        mod.apply(beam_match, el.copy(), ctx1)
        mod.apply(beam_mismatch, el.copy(), ctx2)
        ratio_match = beam_match.emittance_x() / eps_match_before
        ratio_mismatch = beam_mismatch.emittance_x() / eps_mismatch_before
        self.assertGreater(ratio_mismatch, ratio_match)


# === Synchrotron Radiation ===

class TestSynchrotronRadiation(unittest.TestCase):
    def test_dipole_loses_energy(self):
        mod = SynchrotronRadiationModule()
        beam = make_beam(energy=1.0)
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertLess(beam.energy, e_before)

    def test_energy_loss_scales_with_e4(self):
        mod = SynchrotronRadiationModule()
        beam_1 = make_beam(energy=1.0)
        beam_2 = make_beam(energy=2.0)
        ctx1, ctx2 = PropagationContext("linac"), PropagationContext("linac")
        el = {"type": "dipole", "length": 3.0, "bendAngle": 15.0}
        e1 = beam_1.energy
        mod.apply(beam_1, el, ctx1)
        loss_1 = e1 - beam_1.energy
        e2 = beam_2.energy
        mod.apply(beam_2, el, ctx2)
        loss_2 = e2 - beam_2.energy
        ratio = loss_2 / loss_1 if loss_1 > 0 else 0
        self.assertAlmostEqual(ratio, 16.0, delta=2.0)

    def test_no_energy_loss_for_protons(self):
        mod = SynchrotronRadiationModule()
        beam = make_beam(energy=1.0, mass=0.938)
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertAlmostEqual(beam.energy, e_before, places=10)

    def test_energy_spread_grows_in_dipole(self):
        mod = SynchrotronRadiationModule()
        beam = make_beam(energy=1.0)
        ctx = PropagationContext("linac")
        theta = np.radians(15.0)
        rho = 3.0 / theta
        ctx.dispersion = np.array([rho * (1 - np.cos(theta)), np.sin(theta), 0, 0])
        spread_before = beam.energy_spread()
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertGreater(beam.energy_spread(), spread_before)

    def test_applies_to_dipoles_and_undulators(self):
        mod = SynchrotronRadiationModule()
        self.assertTrue(mod.applies_to({"type": "dipole"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "undulator"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))


# === Aperture Loss ===

class TestApertureLoss(unittest.TestCase):
    def test_wide_aperture_no_loss(self):
        mod = ApertureLossModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        current_before = beam.current
        mod.apply(beam, {"type": "drift", "length": 1.0, "aperture": 1.0}, ctx)
        self.assertAlmostEqual(beam.current, current_before, places=6)

    def test_tight_aperture_causes_loss(self):
        mod = ApertureLossModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        beam.sigma[0, 0] = 0.01 ** 2
        beam.sigma[2, 2] = 0.01 ** 2
        current_before = beam.current
        mod.apply(beam, {"type": "drift", "length": 1.0, "aperture": 0.005}, ctx)
        self.assertLess(beam.current, current_before)

    def test_large_loss_reduces_current_but_beam_survives(self):
        mod = ApertureLossModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        beam.sigma[0, 0] = 0.1 ** 2
        beam.sigma[2, 2] = 0.1 ** 2
        current_before = beam.current
        mod.apply(beam, {"type": "drift", "length": 1.0, "aperture": 0.001}, ctx)
        self.assertTrue(beam.alive)
        self.assertLess(beam.current, current_before * 0.01)

    def test_source_excluded(self):
        mod = ApertureLossModule()
        self.assertFalse(mod.applies_to({"type": "source"}, "linac"))


# === Collimation ===

class TestCollimation(unittest.TestCase):
    def test_collimator_reduces_current(self):
        mod = CollimationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        current_before = beam.current
        mod.apply(beam, {"type": "collimator", "length": 2.0, "beamQuality": 0.5}, ctx)
        self.assertLessEqual(beam.current, current_before)

    def test_collimator_clips_sigma(self):
        mod = CollimationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        beam.sigma[0, 0] = 0.05 ** 2
        mod.apply(beam, {"type": "collimator", "length": 2.0, "beamQuality": 0.8}, ctx)
        aperture = 0.025 * (1.0 - 0.3 * 0.8)
        self.assertLessEqual(beam.sigma[0, 0], aperture ** 2 + 1e-10)

    def test_applies_only_to_collimators(self):
        mod = CollimationModule()
        self.assertTrue(mod.applies_to({"type": "collimator"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))


# === Space Charge ===

class TestSpaceCharge(unittest.TestCase):
    def test_increases_divergence_at_low_energy(self):
        mod = SpaceChargeModule()
        beam = make_beam(energy=0.01)
        ctx = PropagationContext("photoinjector")
        div_before = beam.sigma[1, 1]
        mod.apply(beam, {"type": "drift", "length": 1.0}, ctx)
        self.assertGreater(beam.sigma[1, 1], div_before)

    def test_negligible_at_high_energy(self):
        mod = SpaceChargeModule()
        beam = make_beam(energy=1.0)
        ctx = PropagationContext("photoinjector")
        div_before = beam.sigma[1, 1]
        mod.apply(beam, {"type": "drift", "length": 1.0}, ctx)
        self.assertAlmostEqual(beam.sigma[1, 1], div_before, places=15)

    def test_stronger_with_higher_current(self):
        mod = SpaceChargeModule()
        beam_lo = make_beam(energy=0.01, current=0.1)
        beam_hi = make_beam(energy=0.01, current=10.0)
        ctx_lo, ctx_hi = PropagationContext("photoinjector"), PropagationContext("photoinjector")
        el = {"type": "drift", "length": 1.0}
        d_lo = beam_lo.sigma[1, 1]
        mod.apply(beam_lo, el, ctx_lo)
        d_hi = beam_hi.sigma[1, 1]
        mod.apply(beam_hi, el, ctx_hi)
        self.assertGreater(beam_hi.sigma[1, 1] - d_hi, beam_lo.sigma[1, 1] - d_lo)

    def test_active_for_all_machine_types(self):
        mod = SpaceChargeModule()
        self.assertTrue(mod.applies_to({"type": "drift"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "drift"}, "photoinjector"))

    def test_not_active_for_source(self):
        mod = SpaceChargeModule()
        self.assertFalse(mod.applies_to({"type": "source"}, "linac"))


# === Bunch Compression ===

class TestBunchCompression(unittest.TestCase):
    def test_compression_shortens_bunch(self):
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 20.0
        bl_before = beam.bunch_length()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        self.assertLess(beam.bunch_length(), bl_before)

    def test_compression_ratio(self):
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        h, r56 = 20.0, -0.04
        ctx.chirp = h
        bl_before = beam.bunch_length()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": r56}, ctx)
        expected = abs(1.0 + h * r56)
        actual = beam.bunch_length() / bl_before
        self.assertAlmostEqual(actual, expected, delta=0.05)

    def test_peak_current_increases(self):
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 20.0
        pk_before = beam.peak_current
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        self.assertGreater(beam.peak_current, pk_before)

    def test_csr_adds_energy_spread(self):
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 20.0
        spread_before = beam.energy_spread()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        self.assertGreater(beam.energy_spread(), spread_before)

    def test_not_active_for_linac(self):
        mod = BunchCompressionModule()
        self.assertFalse(mod.applies_to({"type": "chicane"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "chicane"}, "fel"))


# === FEL Gain ===

class TestFELGain(unittest.TestCase):
    def _make_fel_beam(self):
        params = dict(DEFAULT_SOURCE)
        params["energy"] = 5.0
        params["current"] = 1.0
        params["eps_norm_x"] = 0.5e-6
        params["eps_norm_y"] = 0.5e-6
        params["sigma_dE"] = 1e-4
        params["bunch_frequency"] = 1e6
        return create_initial_beam(params)

    def test_computes_wavelength(self):
        mod = FELGainModule()
        beam = self._make_fel_beam()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 60.0, "period": 0.03, "kParameter": 1.5}, ctx)
        gamma = 5.0 / ELECTRON_MASS
        expected = 0.03 / (2 * gamma ** 2) * (1 + 1.5 ** 2 / 2)
        self.assertAlmostEqual(report.details["wavelength_m"], expected, places=15)

    def test_computes_pierce_parameter(self):
        mod = FELGainModule()
        beam = self._make_fel_beam()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 60.0, "period": 0.03, "kParameter": 1.5}, ctx)
        self.assertGreater(report.details["rho"], 0)

    def test_saturation_with_long_undulator(self):
        """LCLS-like beam should saturate in a long undulator."""
        mod = FELGainModule()
        params = dict(DEFAULT_SOURCE)
        params["energy"] = 13.6
        params["eps_norm_x"] = 0.4e-6
        params["eps_norm_y"] = 0.4e-6
        params["sigma_dE"] = 1e-4
        params["beta_x"] = 30.0
        params["beta_y"] = 30.0
        params["alpha_x"] = 0.0
        params["alpha_y"] = 0.0
        beam = create_initial_beam(params)
        # Set LCLS-like peak current directly (post-compression)
        beam.peak_current = 3000.0  # 3 kA
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 120.0, "period": 0.03, "kParameter": 3.5}, ctx)
        self.assertTrue(report.details["saturated"],
                       f"Expected saturation. rho={report.details['rho']:.2e}, "
                       f"L_gain_3D={report.details['gain_length_3D_m']:.1f}m, "
                       f"sigma_x={beam.beam_size_x()*1e6:.1f}um, "
                       f"sat_frac={report.details['saturation_fraction']:.2f}")

    def test_no_saturation_short_undulator(self):
        mod = FELGainModule()
        beam = self._make_fel_beam()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 1.0, "period": 0.03, "kParameter": 1.5}, ctx)
        self.assertFalse(report.details["saturated"])

    def test_not_active_for_linac(self):
        mod = FELGainModule()
        self.assertFalse(mod.applies_to({"type": "undulator"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "undulator"}, "fel"))


# === Beam-Beam ===

class TestBeamBeam(unittest.TestCase):
    def _make_collider_beam(self):
        params = dict(DEFAULT_SOURCE)
        params["energy"] = 45.6
        params["current"] = 1.0
        params["eps_norm_x"] = 5e-6
        params["eps_norm_y"] = 0.05e-6
        params["bunch_frequency"] = 1e6
        params["beta_x"] = 0.01
        params["beta_y"] = 0.0001
        return create_initial_beam(params)

    def test_computes_luminosity(self):
        mod = BeamBeamModule()
        beam = self._make_collider_beam()
        ctx = PropagationContext("collider")
        report = mod.apply(beam, {"type": "detector", "length": 6.0, "crossingAngle": 0.0}, ctx)
        self.assertGreater(report.details["luminosity"], 0)

    def test_computes_tune_shift(self):
        mod = BeamBeamModule()
        beam = self._make_collider_beam()
        ctx = PropagationContext("collider")
        report = mod.apply(beam, {"type": "detector", "length": 6.0, "crossingAngle": 0.0}, ctx)
        self.assertGreater(report.details["tune_shift_y"], 0)

    def test_crossing_angle_reduces_luminosity(self):
        mod = BeamBeamModule()
        beam_0 = self._make_collider_beam()
        beam_a = self._make_collider_beam()
        ctx_0, ctx_a = PropagationContext("collider"), PropagationContext("collider")
        r0 = mod.apply(beam_0, {"type": "detector", "length": 6.0, "crossingAngle": 0.0}, ctx_0)
        ra = mod.apply(beam_a, {"type": "detector", "length": 6.0, "crossingAngle": 10.0}, ctx_a)
        self.assertGreater(r0.details["luminosity"], ra.details["luminosity"])

    def test_not_active_for_non_collider(self):
        mod = BeamBeamModule()
        self.assertFalse(mod.applies_to({"type": "detector"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "detector"}, "collider"))


if __name__ == "__main__":
    unittest.main()
