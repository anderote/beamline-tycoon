"""Integration tests — full beamline propagation through the module system."""
import unittest
from beam_physics.lattice import propagate


class TestLinacPropagation(unittest.TestCase):
    def _linac_config(self):
        return [
            {"type": "source", "length": 0},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.1, "rfPhase": 0.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 2.5},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 2.5},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.1, "rfPhase": 0.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 2.5},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 2.5},
            {"type": "target", "length": 0},
        ]

    def test_beam_gains_energy(self):
        result = propagate(self._linac_config(), machine_type="linac")
        self.assertGreater(result["summary"]["final_energy"], 0.01)

    def test_beam_survives(self):
        result = propagate(self._linac_config(), machine_type="linac")
        self.assertTrue(result["summary"]["alive"])

    def test_snapshots_resampled(self):
        config = self._linac_config()
        result = propagate(config, machine_type="linac")
        self.assertEqual(len(result["snapshots"]), 1000)

    def test_has_summary_keys(self):
        result = propagate(self._linac_config(), machine_type="linac")
        for key in ["final_energy", "final_current", "initial_current", "alive",
                     "beam_quality", "total_loss_fraction",
                     "final_emittance_x", "final_emittance_y"]:
            self.assertIn(key, result["summary"], f"Missing key: {key}")

    def test_has_reports(self):
        result = propagate(self._linac_config(), machine_type="linac")
        self.assertIn("reports", result)
        self.assertGreater(len(result["reports"]), 0)


class TestFELPropagation(unittest.TestCase):
    def _fel_config(self):
        return [
            {"type": "source", "length": 0},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.5, "rfPhase": 0.0},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.3, "rfPhase": -20.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 2.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 2.0},
            {"type": "chicane", "length": 10.0, "r56": -0.04},
            {"type": "rfCavity", "length": 4.0, "energyGain": 1.0, "rfPhase": 0.0},
            {"type": "undulator", "length": 30.0, "period": 0.03, "kParameter": 1.5},
        ]

    def test_fel_has_reports(self):
        result = propagate(self._fel_config(), machine_type="fel")
        fel_reports = [r for r in result["reports"] if r.module == "fel_gain"]
        self.assertGreater(len(fel_reports), 0)
        self.assertGreater(fel_reports[0].details["wavelength_m"], 0)

    def test_beam_survives_fel(self):
        result = propagate(self._fel_config(), machine_type="fel")
        self.assertTrue(result["summary"]["alive"])

    def test_compression_ran(self):
        """Bunch compression module should have run on the chicane."""
        result = propagate(self._fel_config(), machine_type="fel")
        bc_reports = [r for r in result["reports"] if r.module == "bunch_compression"]
        self.assertGreater(len(bc_reports), 0)
        self.assertIn("compression_ratio", bc_reports[0].details)


class TestDefaultMachineType(unittest.TestCase):
    def test_defaults_to_linac(self):
        config = [{"type": "source", "length": 0}, {"type": "drift", "length": 5.0}]
        result = propagate(config)
        self.assertIn("summary", result)
        self.assertIn("snapshots", result)


class TestGameplayBridge(unittest.TestCase):
    def test_compute_beam_for_game_roundtrip(self):
        """Test the full JSON roundtrip through gameplay.py."""
        import json
        from beam_physics.gameplay import compute_beam_for_game
        beamline = [
            {"type": "source", "subL": 4},
            {"type": "rfCavity", "subL": 6, "stats": {"energyGain": 0.1}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1}},
            {"type": "drift", "subL": 4},
            {"type": "target", "subL": 4},
        ]
        result_json = compute_beam_for_game(json.dumps(beamline), json.dumps({}))
        result = json.loads(result_json)
        self.assertIn("beamEnergy", result)
        self.assertIn("beamAlive", result)
        self.assertIn("envelope", result)
        self.assertIn("felSaturated", result)
        self.assertTrue(result["beamAlive"])


class TestResearchEffects(unittest.TestCase):
    def test_vacuum_quality_reduces_loss(self):
        """vacuumQuality research effect should reduce beam loss in game output."""
        import json
        from beam_physics.gameplay import compute_beam_for_game
        beamline = [
            {"type": "source", "subL": 4},
            {"type": "drift", "subL": 10},
            {"type": "target", "subL": 4},
        ]
        # Without vacuum research
        r1 = json.loads(compute_beam_for_game(json.dumps(beamline), json.dumps({})))
        # With vacuum research
        r2 = json.loads(compute_beam_for_game(json.dumps(beamline), json.dumps({"vacuumQuality": 0.1})))
        # Loss should be same or less with vacuum quality
        self.assertLessEqual(r2.get("totalLossFraction", 0), r1.get("totalLossFraction", 0) + 1e-10)

    def test_beam_stability_improves_quality(self):
        """beamStability research effect should improve beam quality."""
        import json
        from beam_physics.gameplay import compute_beam_for_game
        beamline = [
            {"type": "source", "subL": 4},
            {"type": "rfCavity", "subL": 6, "stats": {"energyGain": 0.1}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1}},
            {"type": "drift", "subL": 4},
            {"type": "target", "subL": 4},
        ]
        r1 = json.loads(compute_beam_for_game(json.dumps(beamline), json.dumps({})))
        r2 = json.loads(compute_beam_for_game(json.dumps(beamline), json.dumps({"beamStability": 0.2})))
        self.assertGreaterEqual(r2["beamQuality"], r1["beamQuality"])


class TestLowBetaAcceleration(unittest.TestCase):
    """Test realistic low-energy acceleration sequence."""

    # Large aperture (0.5 m) is used throughout so aperture clipping doesn't
    # kill the beam before it reaches the target; these tests focus on energy
    # gain, capture efficiency, bunch-frequency assignment, and cavity ordering
    # rather than transverse halo management.
    _APERTURE = 0.5

    def _low_beta_config(self):
        ap = self._APERTURE
        return [
            {"type": "source", "length": 2.0},
            {"type": "rfCavity", "length": 1.0, "energyGain": 0.0001,
             "rfPhase": -90.0, "game_type": "buncher", "rfFrequency": 200e6,
             "aperture": ap},
            {"type": "drift", "length": 0.5, "aperture": ap},
            {"type": "rfCavity", "length": 3.0, "energyGain": 0.003,
             "rfPhase": -30.0, "game_type": "rfq", "rfFrequency": 400e6,
             "aperture": ap},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1,
             "aperture": ap},
            {"type": "drift", "length": 1.0, "aperture": ap},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1,
             "aperture": ap},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.01,
             "rfPhase": -25.0, "game_type": "spokeCavity", "rfFrequency": 325e6,
             "aperture": ap},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1,
             "aperture": ap},
            {"type": "drift", "length": 1.0, "aperture": ap},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1,
             "aperture": ap},
            {"type": "rfCavity", "length": 1.5, "energyGain": 0.0375,
             "rfPhase": 0.0, "game_type": "ellipticalSrfCavity", "rfFrequency": 1.3e9,
             "aperture": ap},
            {"type": "target", "length": 0},
        ]

    def test_beam_gains_energy(self):
        result = propagate(self._low_beta_config(), machine_type="linac")
        self.assertGreater(result["summary"]["final_energy"], 0.01)
        self.assertTrue(result["summary"]["alive"])

    def test_capture_reduces_current(self):
        result = propagate(self._low_beta_config(), machine_type="linac")
        self.assertLess(result["summary"]["final_current"],
                        result["summary"]["initial_current"])

    def test_bunch_frequency_set_by_first_rf(self):
        """Bunch frequency should be set by buncher (200 MHz), not later cavities."""
        result = propagate(self._low_beta_config(), machine_type="linac")
        last_snap = result["snapshots"][-1]
        self.assertAlmostEqual(last_snap["bunch_frequency"], 200e6)

    def test_wrong_order_loses_more_energy(self):
        """Putting high-beta cavity first should give less total energy gain."""
        ap = self._APERTURE
        wrong_order = [
            {"type": "source", "length": 2.0},
            {"type": "rfCavity", "length": 1.5, "energyGain": 0.0375,
             "rfPhase": 0.0, "game_type": "ellipticalSrfCavity", "rfFrequency": 1.3e9,
             "aperture": ap},
            {"type": "rfCavity", "length": 3.0, "energyGain": 0.003,
             "rfPhase": -30.0, "game_type": "rfq", "rfFrequency": 400e6,
             "aperture": ap},
            {"type": "target", "length": 0},
        ]
        right = propagate(self._low_beta_config(), machine_type="linac")
        wrong = propagate(wrong_order, machine_type="linac")
        self.assertGreater(right["summary"]["final_energy"],
                           wrong["summary"]["final_energy"])


if __name__ == "__main__":
    unittest.main()
