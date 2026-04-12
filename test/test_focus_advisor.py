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
            {"type": "source", "subL": 2, "stats": {}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1}, "params": {"polarity": 0}},
            {"type": "drift", "subL": 10, "stats": {}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1}, "params": {"polarity": 1}},
            {"type": "drift", "subL": 10, "stats": {}},
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


class TestFocusAdvisorIntegration(unittest.TestCase):
    """End-to-end: game beamline through full pipeline produces focus data."""

    def test_unfocused_beamline_has_high_urgency(self):
        """A beamline with no quads should show high urgency somewhere."""
        beamline = json.dumps([
            {"type": "source", "subL": 2, "stats": {}},
            {"type": "drift", "subL": 10, "stats": {}},
            {"type": "drift", "subL": 10, "stats": {}},
            {"type": "drift", "subL": 10, "stats": {}},
        ])
        result = json.loads(compute_beam_for_game(beamline))
        max_urgency = max(p["focus_urgency"] for p in result["envelope"])
        self.assertGreater(max_urgency, 0.5,
                          "Long unfocused beamline should have high urgency")

    def test_well_focused_beamline_has_low_urgency(self):
        """A proper FODO lattice should keep urgency low throughout."""
        beamline = json.dumps([
            {"type": "source", "subL": 2, "stats": {}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1},
             "params": {"polarity": 0}},
            {"type": "drift", "subL": 2, "stats": {}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1},
             "params": {"polarity": 1}},
            {"type": "drift", "subL": 2, "stats": {}},
            {"type": "quadrupole", "subL": 2, "stats": {"focusStrength": 1},
             "params": {"polarity": 0}},
        ])
        result = json.loads(compute_beam_for_game(beamline))
        max_urgency = max(p["focus_urgency"] for p in result["envelope"])
        self.assertLess(max_urgency, 0.5,
                       "Well-focused FODO should keep urgency low")


if __name__ == "__main__":
    unittest.main()
