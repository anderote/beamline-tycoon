import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ALFVEN_CURRENT, ELECTRON_MASS

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
        # The Alfven current I_A = 4 pi eps0 m c^3 / q scales with the particle
        # MASS. The module constant is the electron value (17.045 kA); a proton's
        # is 1836x larger, so using the electron number for a hadron beam
        # overstated its perveance by that factor and made proton front ends
        # impossible to transport at any current.
        alfven = ALFVEN_CURRENT * (beam.mass / ELECTRON_MASS)
        K = (2.0 * I_peak) / (alfven * beta3 * gamma3)

        sigma_x = beam.beam_size_x()
        sigma_y = beam.beam_size_y()

        # The envelope equation gives sigma'' = K / sigma, so over a length L the
        # DIVERGENCE grows by d_sigma' = (K / sigma) * L. sigma[1,1] is <x'^2>,
        # a variance in rad^2, so what gets added is that angle SQUARED.
        #
        # This used to add (K * length / sigma_x) straight into sigma[1,1] —
        # an angle into a variance. Because these quantities are far below 1,
        # dropping the square inflated the result rather than shrinking it: for
        # a 250 keV / 20 mA beam it turned a correct 4.2e-4 rad of divergence
        # into 2.0e-2 rad, ~49x too much, compounding at every sub-step. The
        # beam blew from 2 mm to 98 mm in half a metre and was scraped away by
        # the aperture. That single term is why low-energy front ends were
        # unusable: the shipped ionSource transmitted 1e-141 of its beam, the
        # stock electron gun 2e-69, and smallBeamlineFacility ran at
        # totalLossFraction 1.0 with beamQuality 0.
        if sigma_x > 1e-15:
            d_xp = K * length / sigma_x
            beam.sigma[1, 1] += d_xp * d_xp
        if sigma_y > 1e-15:
            d_yp = K * length / sigma_y
            beam.sigma[3, 3] += d_yp * d_yp

        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
        return EffectReport(self.name, context.element_index, {"K": K, "I_peak": I_peak})
