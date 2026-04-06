import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT

R_E = 2.818e-15


class BeamBeamModule(PhysicsModule):
    """Luminosity, beam-beam tune shift, and disruption at the IP."""

    def __init__(self):
        super().__init__(name="beam_beam", order=90)

    def applies_to(self, element, machine_type):
        if machine_type != "collider":
            return False
        return element.get("type", "") == "detector"

    def apply(self, beam, element, context):
        crossing_angle_mrad = element.get("crossingAngle", 0.0)
        phi = crossing_angle_mrad * 0.5e-3

        sigma_x = beam.beam_size_x()
        sigma_y = beam.beam_size_y()
        gamma = beam.gamma
        N = beam.n_particles
        f_rep = beam.bunch_frequency
        sigma_z = beam.bunch_length() * SPEED_OF_LIGHT

        if sigma_x <= 0 or sigma_y <= 0 or N <= 0 or gamma <= 0:
            return EffectReport(self.name, context.element_index, {
                "luminosity": 0.0, "tune_shift_y": 0.0, "disruption_y": 0.0,
                "pinch_enhancement": 1.0, "piwinski_factor": 1.0, "beam_stable": True,
            })

        xi_y = (N * R_E * beam.beta_y()) / (
            4.0 * np.pi * gamma * sigma_y * (sigma_x + sigma_y)
        ) if (sigma_x + sigma_y) > 0 else 0

        D_y = (2.0 * N * R_E * sigma_z) / (
            gamma * sigma_y * (sigma_x + sigma_y)
        ) if (sigma_y > 0 and (sigma_x + sigma_y) > 0) else 0

        H_D = 1.0 + D_y ** 0.25 if D_y > 0 else 1.0

        if abs(phi) > 1e-10 and sigma_x > 0:
            S = 1.0 / np.sqrt(1.0 + (phi * sigma_z / (2.0 * sigma_x)) ** 2)
        else:
            S = 1.0

        L = (N * N * f_rep * H_D * S) / (4.0 * np.pi * sigma_x * sigma_y)

        return EffectReport(self.name, context.element_index, {
            "luminosity": L, "tune_shift_y": xi_y, "disruption_y": D_y,
            "pinch_enhancement": H_D, "piwinski_factor": S,
            "beam_stable": xi_y < 0.05, "n_particles": N,
        })
