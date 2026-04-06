import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ELECTRON_MASS, ALFVEN_CURRENT

UNDULATOR_TYPES = {"undulator", "helicalUndulator", "wiggler", "apple2Undulator"}
MACHINE_TYPES_WITH_FEL = {"fel", "collider"}


class FELGainModule(PhysicsModule):
    """FEL Pierce parameter, gain length, saturation, and photon wavelength."""

    def __init__(self):
        super().__init__(name="fel_gain", order=80)

    def applies_to(self, element, machine_type):
        if machine_type not in MACHINE_TYPES_WITH_FEL:
            return False
        return element.get("type", "") in UNDULATOR_TYPES

    def apply(self, beam, element, context):
        period = element.get("period", 0.03)
        K = element.get("kParameter", 1.5)
        und_length = element.get("length", 5.0)
        gamma = beam.energy / beam.mass

        wavelength = period / (2.0 * gamma ** 2) * (1.0 + K ** 2 / 2.0)

        I_peak = beam.peak_current
        sigma_x = beam.beam_size_x()

        if I_peak <= 0 or sigma_x <= 0 or gamma <= 0:
            return EffectReport(self.name, context.element_index, {
                "wavelength_m": wavelength, "rho": 0.0, "gain_length_1D_m": float("inf"),
                "gain_length_3D_m": float("inf"), "ming_xie_eta": 0.0,
                "saturated": False, "saturation_fraction": 0.0,
                "power_w": 0.0, "saturation_power_w": 0.0,
            })

        rho = (1.0 / (2.0 * gamma)) * (
            I_peak * K ** 2 * period / (4.0 * ALFVEN_CURRENT * sigma_x ** 2)
        ) ** (1.0 / 3.0)

        L_gain_1D = period / (4.0 * np.pi * np.sqrt(3.0) * rho) if rho > 0 else float("inf")

        # 3D degradation factors (simplified from Ming Xie)
        # Each factor represents how far beam params are from ideal
        eps_n = beam.norm_emittance_x()
        sigma_delta = beam.energy_spread()
        eta = 0.0
        if np.isfinite(L_gain_1D) and L_gain_1D > 0 and rho > 0:
            # Energy spread degradation: need sigma_delta < rho
            eta_e = sigma_delta / rho if rho > 0 else 0
            # Emittance degradation: need eps_n/gamma < lambda/(4*pi)
            eps_geom = eps_n / gamma if gamma > 0 else eps_n
            eps_limit = wavelength / (4.0 * np.pi) if wavelength > 0 else 1e-10
            eta_eps = eps_geom / eps_limit if eps_limit > 0 else 0
            # Combined degradation — smooth growth beyond thresholds
            if eta_e > 1.0:
                eta += 0.5 * eta_e ** 2
            if eta_eps > 1.0:
                eta += 0.5 * eta_eps ** 2

        L_gain_3D = L_gain_1D * (1.0 + eta)
        L_sat = 20.0 * L_gain_3D
        saturation_fraction = und_length / L_sat if L_sat > 0 and np.isfinite(L_sat) else 0.0
        saturated = saturation_fraction >= 1.0

        E_beam_J = beam.energy * 1.602e-10
        P_sat = rho * E_beam_J * I_peak if rho > 0 else 0.0

        P_noise = 1e-3
        if saturated:
            power = P_sat
        elif L_gain_3D > 0 and np.isfinite(L_gain_3D):
            power = min(P_noise * np.exp(und_length / L_gain_3D), P_sat)
        else:
            power = 0.0

        return EffectReport(self.name, context.element_index, {
            "wavelength_m": wavelength, "rho": rho,
            "gain_length_1D_m": L_gain_1D, "gain_length_3D_m": L_gain_3D,
            "ming_xie_eta": eta, "saturated": saturated,
            "saturation_fraction": saturation_fraction,
            "power_w": power, "saturation_power_w": P_sat,
        })
