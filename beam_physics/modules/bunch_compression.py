import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT

R_E = 2.818e-15
MACHINE_TYPES_WITH_COMPRESSION = {"fel", "collider"}


class BunchCompressionModule(PhysicsModule):
    """Bunch compression in chicanes using upstream chirp, with CSR effects."""

    def __init__(self):
        super().__init__(name="bunch_compression", order=50)

    def applies_to(self, element, machine_type):
        if machine_type not in MACHINE_TYPES_WITH_COMPRESSION:
            return False
        return element.get("type", "") == "chicane"

    def apply(self, beam, element, context):
        r56 = element.get("r56", -0.05)
        length = element.get("length", 10.0)
        h = context.chirp

        factor = 1.0 + h * r56
        if abs(factor) < 0.01:
            factor = 0.01 * np.sign(factor) if factor != 0 else 0.01

        # Compress longitudinal sigma
        beam.sigma[4, 4] *= factor ** 2
        beam.sigma[4, 5] *= factor
        beam.sigma[5, 4] *= factor

        # CSR effects
        compression_ratio = 1.0 / abs(factor)
        sigma_z = beam.bunch_length() * SPEED_OF_LIGHT

        if compression_ratio > 1.5 and sigma_z > 0 and beam.n_particles > 0:
            theta_chicane = np.radians(5.0)
            R_bend = (length / 4.0) / theta_chicane if theta_chicane > 0 else 100.0

            sigma_delta_csr = (beam.n_particles * R_E) / (
                R_bend ** (2.0 / 3.0) * max(sigma_z, 1e-10) ** (4.0 / 3.0)
            )
            beam.sigma[5, 5] += sigma_delta_csr ** 2

            beta_x = beam.beta_x()
            if beta_x > 0:
                d_eps = (r56 * sigma_delta_csr) ** 2 / beta_x
                beam.sigma[0, 0] += d_eps * beta_x
                beam.sigma[1, 1] += d_eps / beta_x

        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {
            "compression_ratio": 1.0 / abs(factor),
            "r56": r56, "chirp": h, "bunch_length_m": sigma_z,
        })
