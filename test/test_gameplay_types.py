"""Tests for the JS-Python physics seam: declared physicsType identities.

Guards the contract between src/data/beamline-components.raw.js (which
declares each component's physicsType) and beam_physics/gameplay.py (which
validates it against KNOWN_PHYSICS_TYPES and raises on missing/unknown).
"""
import re
import unittest
from pathlib import Path

from beam_physics.gameplay import (
    KNOWN_PHYSICS_TYPES,
    beamline_config_from_game,
)
from beam_physics.lattice import propagate
from beam_physics.machines import MACHINE_TYPES

RAW_JS = (Path(__file__).resolve().parent.parent
          / "src" / "data" / "beamline-components.raw.js")


class TestPhysicsTypeValidation(unittest.TestCase):
    def test_missing_physics_type_raises(self):
        with self.assertRaises(ValueError) as ctx:
            beamline_config_from_game([{"type": "quadrupole", "subL": 2}])
        self.assertIn("physicsType", str(ctx.exception))

    def test_unknown_physics_type_raises(self):
        with self.assertRaises(ValueError) as ctx:
            beamline_config_from_game([
                {"type": "quadrupole", "physicsType": "flibbertigibbet",
                 "subL": 2},
            ])
        self.assertIn("flibbertigibbet", str(ctx.exception))

    def test_old_fallthrough_is_gone(self):
        """A game type with no declaration must raise, never pass through."""
        with self.assertRaises(ValueError):
            beamline_config_from_game([
                {"type": "totallyNewComponent", "subL": 2, "stats": {}},
            ])


class TestKnownTypesResolve(unittest.TestCase):
    def test_every_known_type_propagates_on_every_tier(self):
        """Each declared physicsType must survive config mapping and
        propagation through every machine tier's module list."""
        for pt in sorted(KNOWN_PHYSICS_TYPES):
            game_beamline = [
                {"type": "source", "physicsType": "source", "subL": 4,
                 "stats": {}},
                {"type": f"game_{pt}", "physicsType": pt, "subL": 2,
                 "stats": {}, "params": {}},
            ]
            elements = beamline_config_from_game(game_beamline)
            self.assertEqual(elements[1]["type"], pt)
            for machine_type in sorted(MACHINE_TYPES):
                result = propagate(elements, machine_type=machine_type)
                self.assertIn("summary", result,
                              f"{pt} failed on {machine_type}")

    def test_module_gate_types_are_known(self):
        """Every element type the tier-list modules gate on (and that
        gameplay can emit) must be in the known set, so a declared
        physicsType can actually reach its module."""
        gated = {
            "rfCavity", "cryomodule",       # rf_acceleration
            "collimator",                    # collimation
            "chicane",                       # bunch_compression
            "detector",                      # beam_beam (collider)
            "undulator",                     # fel_gain
            "dipole", "combined_function",   # synchrotron_radiation
        }
        self.assertLessEqual(gated, KNOWN_PHYSICS_TYPES)


class TestRawFileDeclarations(unittest.TestCase):
    """Cross-language guard: every entry in beamline-components.raw.js must
    declare a physicsType that this module accepts."""

    def _raw(self):
        return RAW_JS.read_text(encoding="utf-8")

    def test_every_component_declares_physics_type(self):
        src = self._raw()
        ids = re.findall(r"^    id: '(\w+)',", src, re.M)
        declared = re.findall(r"^    physicsType: '(\w+)',", src, re.M)
        self.assertTrue(ids, "no component entries found — regex drifted?")
        self.assertEqual(
            len(ids), len(declared),
            f"{len(ids)} components but {len(declared)} physicsType "
            f"declarations in {RAW_JS.name}")

    def test_declared_physics_types_are_known(self):
        declared = set(re.findall(r"^    physicsType: '(\w+)',",
                                  self._raw(), re.M))
        unknown = declared - KNOWN_PHYSICS_TYPES
        self.assertFalse(
            unknown,
            f"{RAW_JS.name} declares physicsType(s) {sorted(unknown)} that "
            f"gameplay.KNOWN_PHYSICS_TYPES does not accept")


if __name__ == "__main__":
    unittest.main()
