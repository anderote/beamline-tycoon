import unittest
import numpy as np
from beam_physics.elements import transfer_matrix


class TestLengthRequired(unittest.TestCase):
    def test_transfer_matrix_raises_without_length(self):
        element = {"type": "drift"}
        with self.assertRaises(KeyError):
            transfer_matrix(element)

    def test_transfer_matrix_with_length_succeeds(self):
        element = {"type": "drift", "length": 1.5}
        R = transfer_matrix(element)
        self.assertEqual(R.shape, (6, 6))
        self.assertAlmostEqual(R[0, 1], 1.5)


from beam_physics.lattice import propagate, _make_sub_element


class TestLatticeLengthRequired(unittest.TestCase):
    def test_make_sub_element_raises_without_length(self):
        with self.assertRaises(KeyError):
            _make_sub_element({"type": "drift"}, 0.5)

    def test_propagate_raises_without_length(self):
        config = [
            {"type": "source", "length": 1.0},
            {"type": "drift"},  # missing length
        ]
        with self.assertRaises(KeyError):
            propagate(config, machine_type="linac")


if __name__ == "__main__":
    unittest.main()
