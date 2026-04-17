import numpy as np
from scipy.special import erf
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import DEFAULT_APERTURE


class ApertureLossModule(PhysicsModule):
    """Gaussian beam clipping at physical apertures."""

    def __init__(self):
        super().__init__(name="aperture_loss", order=70)

    def applies_to(self, element, machine_type):
        return element.get("type", "") not in ("source",)

    def apply(self, beam, element, context):
        aperture = element.get("aperture", DEFAULT_APERTURE)
        sx = beam.beam_size_x()
        sy = beam.beam_size_y()

        if sx < 1e-15 or sy < 1e-15:
            return EffectReport(self.name, context.element_index, {"loss_fraction": 0.0})

        fx = erf(aperture / (np.sqrt(2.0) * sx))
        fy = erf(aperture / (np.sqrt(2.0) * sy))
        loss = max(0.0, 1.0 - fx * fy)

        beam.current *= (1.0 - loss)
        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index,
                           {"loss_fraction": loss, "aperture": aperture})
