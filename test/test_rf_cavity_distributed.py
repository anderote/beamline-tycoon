"""
Regression tests locking in the correct distributed envelope evolution
through RF cavities. RF cavities are sub-stepped so energy gain and beam
envelope changes are spread over the physical length of the element.
"""
import unittest
from beam_physics.lattice import propagate


class TestRFCavityDistributed(unittest.TestCase):
    def _make_config(self, rf_length, energy_gain):
        return [
            {"type": "source", "length": 1.0},
            {"type": "drift", "length": 2.0},
            {"type": "rfCavity", "length": rf_length, "energyGain": energy_gain},
            {"type": "drift", "length": 2.0},
        ]

    def test_rf_cavity_envelope_evolves_across_length(self):
        """
        Snapshots inside the RF cavity must show distributed evolution:
        at least 3 snapshots and at least 2 distinct sigma_x values,
        confirming the element is sub-stepped (not a thin lens).
        """
        config = self._make_config(rf_length=8.0, energy_gain=2.0)
        result = propagate(config, machine_type="linac")

        # element_index 2 is the rfCavity (0-based: source=0, drift=1, rfCavity=2)
        rf_snaps = [s for s in result["snapshots"] if s["element_type"] == "rfCavity"]

        self.assertGreaterEqual(
            len(rf_snaps), 3,
            f"Expected at least 3 snapshots inside RF cavity, got {len(rf_snaps)}"
        )

        distinct_sigma_x = set(round(s["beam_size_x"], 9) for s in rf_snaps)
        self.assertGreaterEqual(
            len(distinct_sigma_x), 2,
            f"Expected at least 2 distinct sigma_x values inside RF cavity, "
            f"got {len(distinct_sigma_x)}: {distinct_sigma_x}"
        )

    def test_rf_cavity_energy_gain_proportional_to_length(self):
        """
        A longer RF cavity with the same per-meter energy gain must produce
        a higher final beam energy than a shorter one.
        """
        # Short cavity: 4 m, 1.0 GeV total
        short_config = self._make_config(rf_length=4.0, energy_gain=1.0)
        short_result = propagate(short_config, machine_type="linac")

        # Long cavity: 8 m, 2.0 GeV total (same 0.25 GeV/m rate)
        long_config = self._make_config(rf_length=8.0, energy_gain=2.0)
        long_result = propagate(long_config, machine_type="linac")

        short_energy = short_result["summary"]["final_energy"]
        long_energy = long_result["summary"]["final_energy"]

        self.assertGreater(
            long_energy, short_energy,
            f"Long RF cavity (8m, 2GeV) should yield higher final energy than "
            f"short (4m, 1GeV). Got short={short_energy:.4f}, long={long_energy:.4f}"
        )


if __name__ == "__main__":
    unittest.main()
