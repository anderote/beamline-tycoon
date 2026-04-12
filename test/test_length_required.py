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


if __name__ == "__main__":
    unittest.main()
