import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT

RF_ELEMENT_TYPES = {"rfCavity", "cryomodule", "buncher", "harmonicLinearizer",
                    "cbandCavity", "xbandCavity", "srf650Cavity"}

DEFAULT_RF_FREQ = 1.3e9


class RFAccelerationModule(PhysicsModule):
    """Energy gain, adiabatic damping, and chirping from RF cavities."""

    def __init__(self):
        super().__init__(name="rf_acceleration", order=20)

    def applies_to(self, element, machine_type):
        return element.get("type", "") in RF_ELEMENT_TYPES

    def apply(self, beam, element, context):
        dE_nominal = element.get("energyGain", 0.5)
        phase_deg = element.get("rfPhase", 0.0)
        phase_rad = np.radians(phase_deg)
        f_rf = element.get("rfFrequency", DEFAULT_RF_FREQ)

        # Phase-dependent energy gain
        dE = dE_nominal * np.cos(phase_rad)
        energy_before = beam.energy
        beam.energy += dE
        if beam.energy < beam.mass:
            beam.energy = beam.mass
        beam.update_relativistic()

        # Adiabatic damping
        if energy_before > 0 and beam.energy > 0 and beam.energy != energy_before:
            ratio = energy_before / beam.energy
            beam.sigma[1, :] *= ratio
            beam.sigma[:, 1] *= ratio
            beam.sigma[3, :] *= ratio
            beam.sigma[:, 3] *= ratio
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # Chirp
        V_acc = dE_nominal
        h = (2.0 * np.pi * f_rf * V_acc * np.sin(phase_rad)) / (beam.energy * SPEED_OF_LIGHT)
        context.chirp += h

        if abs(h) > 1e-15:
            beam.sigma[4, 5] += h * beam.sigma[4, 4]
            beam.sigma[5, 4] = beam.sigma[4, 5]

        beam._update_bunch_properties()

        return EffectReport(
            module=self.name,
            element_index=context.element_index,
            details={"energy_gain": dE, "phase_deg": phase_deg,
                     "chirp_added": h, "total_chirp": context.chirp},
        )
