import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ALFVEN_CURRENT

GAMMA_THRESHOLD = 200


class SpaceChargeModule(PhysicsModule):
    """Envelope-equation defocusing from beam space charge at low energy."""

    def __init__(self):
        super().__init__(name="space_charge", order=30)

    def applies_to(self, element, machine_type):
        return element.get("type", "") not in ("source",)

    def apply(self, beam, element, context):
        if beam.gamma > GAMMA_THRESHOLD:
            return EffectReport(self.name, context.element_index, {"skipped": "high_energy"})

        length = element.get("length", 0.0)
        if length <= 0:
            return EffectReport(self.name, context.element_index)

        I_peak = beam.peak_current
        if I_peak <= 0:
            return EffectReport(self.name, context.element_index, {"K": 0.0})

        beta3 = beam.beta ** 3 if beam.beta > 0 else 1e-10
        gamma3 = beam.gamma ** 3
        K = (2.0 * I_peak) / (ALFVEN_CURRENT * beta3 * gamma3)

        sigma_x = beam.beam_size_x()
        sigma_y = beam.beam_size_y()

        if sigma_x > 1e-15:
            beam.sigma[1, 1] += K * length / sigma_x
        if sigma_y > 1e-15:
            beam.sigma[3, 3] += K * length / sigma_y

        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
        return EffectReport(self.name, context.element_index, {"K": K, "I_peak": I_peak})
