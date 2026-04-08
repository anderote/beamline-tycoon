import numpy as np
from scipy.special import erf
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport


def _collimator_aperture(beam_quality):
    base = 0.025
    return base * (1.0 - 0.3 * beam_quality)


class CollimationModule(PhysicsModule):
    """Beam scraping at collimators."""

    def __init__(self):
        super().__init__(name="collimation", order=60)

    def applies_to(self, element, machine_type):
        return element.get("type", "") == "collimator"

    def apply(self, beam, element, context):
        bq = element.get("beamQuality", 0.2)
        aperture = _collimator_aperture(bq)

        sx = beam.beam_size_x()
        sy = beam.beam_size_y()
        loss = 0.0
        if sx > 1e-15 and sy > 1e-15:
            fx = erf(aperture / (np.sqrt(2.0) * sx))
            fy = erf(aperture / (np.sqrt(2.0) * sy))
            loss = max(0.0, 1.0 - fx * fy)
            beam.current *= (1.0 - loss)

        a2 = aperture ** 2
        if beam.sigma[0, 0] > a2:
            scale = a2 / beam.sigma[0, 0]
            beam.sigma[0, 0] = a2
            beam.sigma[0, 1] *= np.sqrt(scale)
            beam.sigma[1, 0] *= np.sqrt(scale)
        if beam.sigma[2, 2] > a2:
            scale = a2 / beam.sigma[2, 2]
            beam.sigma[2, 2] = a2
            beam.sigma[2, 3] *= np.sqrt(scale)
            beam.sigma[3, 2] *= np.sqrt(scale)

        beam._update_bunch_properties()
        return EffectReport(self.name, context.element_index,
                           {"loss_fraction": loss, "aperture": aperture})
