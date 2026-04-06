import unittest
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import PropagationContext, EffectReport


class TestPhysicsModule(unittest.TestCase):
    def test_base_class_not_instantiable_directly(self):
        mod = PhysicsModule(name="test", order=0)
        with self.assertRaises(NotImplementedError):
            mod.applies_to({}, "linac")
        with self.assertRaises(NotImplementedError):
            mod.apply(None, {}, None)

    def test_module_ordering(self):
        a = PhysicsModule(name="a", order=5)
        b = PhysicsModule(name="b", order=1)
        c = PhysicsModule(name="c", order=3)
        modules = sorted([a, b, c], key=lambda m: m.order)
        self.assertEqual([m.name for m in modules], ["b", "c", "a"])


class TestPropagationContext(unittest.TestCase):
    def test_initial_state(self):
        ctx = PropagationContext(machine_type="linac")
        self.assertEqual(ctx.machine_type, "linac")
        self.assertAlmostEqual(ctx.cumulative_s, 0.0)
        self.assertEqual(len(ctx.dispersion), 4)
        np.testing.assert_array_equal(ctx.dispersion, [0, 0, 0, 0])
        self.assertAlmostEqual(ctx.chirp, 0.0)
        self.assertEqual(ctx.snapshots, [])
        self.assertEqual(ctx.reports, [])

    def test_record_report(self):
        ctx = PropagationContext(machine_type="fel")
        report = EffectReport(module="test", element_index=0, details={"loss": 0.01})
        ctx.record(report)
        self.assertEqual(len(ctx.reports), 1)
        self.assertEqual(ctx.reports[0].module, "test")
        self.assertEqual(ctx.reports[0].details["loss"], 0.01)


class TestEffectReport(unittest.TestCase):
    def test_creation(self):
        r = EffectReport(module="linear_optics", element_index=3, details={"dispersion_x": 0.5})
        self.assertEqual(r.module, "linear_optics")
        self.assertEqual(r.element_index, 3)
        self.assertEqual(r.details["dispersion_x"], 0.5)


if __name__ == "__main__":
    unittest.main()
