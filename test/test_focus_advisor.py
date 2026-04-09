"""Tests for focus margin and urgency fields in propagation snapshots."""
import unittest
from beam_physics.lattice import propagate


class TestFocusMargin(unittest.TestCase):
    def _simple_fodo(self):
        """FODO cell: source, quad, drift, quad, drift."""
        return [
            {"type": "source", "length": 0},
            {"type": "quadrupole", "length": 1.0, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 5.0},
            {"type": "quadrupole", "length": 1.0, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 5.0},
        ]

    def test_snapshots_have_focus_margin(self):
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertIn("focus_margin", snap)

    def test_snapshots_have_focus_urgency(self):
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertIn("focus_urgency", snap)

    def test_focus_margin_range(self):
        """Focus margin should be <= 1.0 (beam smaller than aperture)."""
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertLessEqual(snap["focus_margin"], 1.0)

    def test_focus_urgency_range(self):
        """Focus urgency should be clamped to [0, 1]."""
        result = propagate(self._simple_fodo())
        for snap in result["snapshots"]:
            self.assertGreaterEqual(snap["focus_urgency"], 0.0)
            self.assertLessEqual(snap["focus_urgency"], 1.0)

    def test_long_drift_increases_urgency(self):
        """A very long drift without focusing should have high urgency at the end."""
        config = [
            {"type": "source", "length": 0},
            {"type": "drift", "length": 50.0},
        ]
        result = propagate(config)
        last = result["snapshots"][-1]
        self.assertGreater(last["focus_urgency"], 0.5)

    def test_focused_beam_has_low_urgency(self):
        """Right after a quad, urgency should be low."""
        result = propagate(self._simple_fodo())
        # Find first snapshot after first quad (element_index=1)
        post_quad = [s for s in result["snapshots"] if s["element_index"] == 1]
        if post_quad:
            self.assertLess(post_quad[-1]["focus_urgency"], 0.3)


import json
from beam_physics.gameplay import compute_beam_for_game


class TestFocusFieldsInGameOutput(unittest.TestCase):
    def _game_beamline_json(self):
        beamline = [
            {"type": "source", "length": 1, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1}, "params": {"polarity": 0}},
            {"type": "drift", "length": 5, "stats": {}},
            {"type": "quadrupole", "length": 1, "stats": {"focusStrength": 1}, "params": {"polarity": 1}},
            {"type": "drift", "length": 5, "stats": {}},
        ]
        return json.dumps(beamline)

    def test_envelope_has_focus_margin(self):
        result = json.loads(compute_beam_for_game(self._game_beamline_json()))
        for point in result["envelope"]:
            self.assertIn("focus_margin", point)

    def test_envelope_has_focus_urgency(self):
        result = json.loads(compute_beam_for_game(self._game_beamline_json()))
        for point in result["envelope"]:
            self.assertIn("focus_urgency", point)


if __name__ == "__main__":
    unittest.main()
