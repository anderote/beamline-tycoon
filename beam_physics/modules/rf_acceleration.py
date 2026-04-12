import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT

RF_ELEMENT_TYPES = {"rfCavity", "cryomodule", "buncher", "harmonicLinearizer",
                    "cbandCavity", "xbandCavity", "srf650Cavity"}

DEFAULT_RF_FREQ = 1.3e9

DESIGN_BETA = {
    "rfq":                0.04,
    "pillboxCavity":      0.1,
    "buncher":            0.3,
    "halfWaveResonator":  0.1,
    "spokeCavity":        0.35,
    "rfCavity":           0.999,
    "sbandStructure":     0.95,
    "cbandCavity":        0.95,
    "xbandCavity":        0.99,
    "ellipticalSrfCavity":0.65,
    "srf650Cavity":       0.65,
    "cryomodule":         0.65,
    "harmonicLinearizer": 0.9,
}

CAPTURE_EFFICIENCY = {
    "rfq":                0.80,
    "pillboxCavity":      0.50,
    "buncher":            0.65,
    "halfWaveResonator":  0.55,
    "spokeCavity":        0.60,
    "rfCavity":           0.45,
    "sbandStructure":     0.45,
    "cbandCavity":        0.45,
    "xbandCavity":        0.40,
    "ellipticalSrfCavity":0.50,
    "srf650Cavity":       0.50,
    "cryomodule":         0.50,
    "harmonicLinearizer": 0.55,
}


def _transit_time_factor(beam_beta, design_beta):
    if beam_beta <= 0 or design_beta <= 0:
        return 0.01
    inv_diff = abs(1.0 / beam_beta - 1.0 / design_beta) * design_beta
    if inv_diff < 1e-6:
        return 1.0
    arg = np.pi * inv_diff
    ttf = abs(np.sin(arg) / arg)
    return max(0.01, min(1.0, ttf))


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

        game_type = element.get("game_type", element.get("type", ""))
        design_beta = DESIGN_BETA.get(game_type, 0.9)
        ttf = _transit_time_factor(beam.beta, design_beta)
        dE *= ttf

        if ttf < 0.95:
            mismatch_factor = (1.0 - ttf) * 0.1
            beam.sigma[0, 0] *= (1.0 + mismatch_factor)
            beam.sigma[2, 2] *= (1.0 + mismatch_factor)
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        energy_before = beam.energy
        beam.energy += dE
        if beam.energy < beam.mass:
            beam.energy = beam.mass
        beam.update_relativistic()

        # First RF element establishes the bunch structure
        if not context.bunch_frequency_set:
            beam.bunch_frequency = f_rf
            context.bunch_frequency_set = True
            capture = CAPTURE_EFFICIENCY.get(game_type, 0.5)
            beam.current *= capture
            beam.initial_current = beam.current

        # Adiabatic damping
        if energy_before > 0 and beam.energy > 0 and beam.energy != energy_before:
            ratio = energy_before / beam.energy
            beam.sigma[1, :] *= ratio
            beam.sigma[:, 1] *= ratio
            beam.sigma[3, :] *= ratio
            beam.sigma[:, 3] *= ratio
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # RF-induced energy spread: bunch samples different RF phases
        # δ_rms = 2π f_rf × V_acc × |sin(φ)| × σ_t / E
        sigma_t = beam.bunch_length()
        if sigma_t > 0 and beam.energy > 0 and abs(phase_rad) > 1e-6:
            delta_rf = (2.0 * np.pi * f_rf * dE_nominal
                        * abs(np.sin(phase_rad)) * sigma_t / beam.energy)
            beam.sigma[5, 5] += delta_rf ** 2

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
                     "chirp_added": h, "total_chirp": context.chirp,
                     "rf_frequency": f_rf},
        )
