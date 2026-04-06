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

    def test_snapshots_for_each_element(self):
        config = self._linac_config()
        result = propagate(config, machine_type="linac")
        self.assertEqual(len(result["snapshots"]), len(config))

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
            {"type": "source"},
            {"type": "rfCavity", "stats": {"energyGain": 0.1}},
            {"type": "quadrupole", "stats": {"focusStrength": 1}},
            {"type": "drift"},
            {"type": "target"},
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
            {"type": "source"},
            {"type": "drift", "length": 5},
            {"type": "target"},
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
            {"type": "source"},
            {"type": "rfCavity", "stats": {"energyGain": 0.1}},
            {"type": "quadrupole", "stats": {"focusStrength": 1}},
            {"type": "drift"},
            {"type": "target"},
        ]
        r1 = json.loads(compute_beam_for_game(json.dumps(beamline), json.dumps({})))
        r2 = json.loads(compute_beam_for_game(json.dumps(beamline), json.dumps({"beamStability": 0.2})))
        self.assertGreaterEqual(r2["beamQuality"], r1["beamQuality"])


if __name__ == "__main__":
    unittest.main()
