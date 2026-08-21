import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ALFVEN_CURRENT, ELECTRON_MASS

GAMMA_THRESHOLD = 200
# For a round RMS envelope the generalized perveance term is K/(4 sigma).
# Expressing that as a linear defocusing kick gives
# x' <- x' + K L x / (4 sigma^2).
RMS_ENVELOPE_FACTOR = 0.25


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

        compensation = (beam.space_charge_compensation
                        if beam.bunch_frequency <= 0 else 0.0)
        I_peak = beam.peak_current * (1.0 - compensation)
        if I_peak <= 0:
            return EffectReport(self.name, context.element_index, {"K": 0.0})

        beta3 = beam.beta ** 3 if beam.beta > 0 else 1e-10
        gamma3 = beam.gamma ** 3
        # The Alfven current I_A = 4 pi eps0 m c^3 / q scales with the particle
        # MASS. The module constant is the electron value (17.045 kA); a proton's
        # is 1836x larger, so using the electron number for a hadron beam
        # overstated its perveance by that factor and made proton front ends
        # impossible to transport at any current.
        alfven = ALFVEN_CURRENT * (beam.mass / ELECTRON_MASS)
        K = (2.0 * I_peak) / (alfven * beta3 * gamma3)

        sigma_x = beam.beam_size_x()
        sigma_y = beam.beam_size_y()

        # Space charge is a coherent envelope force, not random scattering.
        # Adding d_sigma'^2 directly to <x'^2> made the kick irreversible
        # emittance growth, so no solenoid or RFQ focusing channel could ever
        # counter it. Apply the equivalent linear defocusing map instead. It
        # grows the envelope while preserving phase-space area, allowing real
        # focusing hardware to trade against it; beam-gas and radiation remain
        # the modules that add incoherent emittance.
        R = np.eye(6)
        if sigma_x > 1e-15:
            R[1, 0] = RMS_ENVELOPE_FACTOR * K * length / (sigma_x * sigma_x)
        if sigma_y > 1e-15:
            R[3, 2] = RMS_ENVELOPE_FACTOR * K * length / (sigma_y * sigma_y)
        beam.sigma = R @ beam.sigma @ R.T
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
        return EffectReport(self.name, context.element_index, {
            "K": K,
            "I_peak": I_peak,
            "space_charge_compensation": compensation,
        })
