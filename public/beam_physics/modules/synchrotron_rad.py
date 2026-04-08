import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import C_GAMMA, ELECTRON_MASS

R_E = 2.818e-15
LAMBDA_C = 3.861e-13
QD_PREFACTOR = (55.0 / (48.0 * np.sqrt(3.0))) * R_E * LAMBDA_C / (2.0 * np.pi)


class SynchrotronRadiationModule(PhysicsModule):
    """Energy loss and quantum excitation in dipoles and undulators."""

    def __init__(self):
        super().__init__(name="synchrotron_radiation", order=40)

    def applies_to(self, element, machine_type):
        return element.get("type", "") in ("dipole", "undulator", "combined_function")

    def apply(self, beam, element, context):
        if beam.mass > 0.01:
            return EffectReport(self.name, context.element_index, {"skipped": "not_electron"})
        etype = element.get("type", "")
        if etype in ("dipole", "combined_function"):
            return self._apply_dipole(beam, element, context)
        elif etype == "undulator":
            return self._apply_undulator(beam, element, context)
        return EffectReport(self.name, context.element_index)

    def _apply_dipole(self, beam, element, context):
        angle = element.get("bendAngle", 15.0)
        length = element.get("length", 3.0)
        theta = np.radians(angle)
        if abs(theta) < 1e-10:
            return EffectReport(self.name, context.element_index)
        rho = length / theta

        U = C_GAMMA * beam.energy ** 4 * abs(theta) / abs(rho)
        beam.energy = max(beam.energy - U, beam.mass)
        beam.update_relativistic()

        gamma_rel = beam.energy / beam.mass
        rho3 = abs(rho) ** 3
        d_sigma_E2 = QD_PREFACTOR * gamma_rel ** 5 * length / rho3
        beam.sigma[5, 5] += d_sigma_E2

        eta_x = context.dispersion[0]
        eta_xp = context.dispersion[1]
        eps_x = beam.emittance_x()
        beta_x = beam.beta_x()
        alpha_x = beam.alpha_x()
        H = 0.0
        if beta_x > 0:
            H = (eta_x ** 2 + (beta_x * eta_xp - alpha_x * eta_x) ** 2) / beta_x
        d_eps_x = QD_PREFACTOR * gamma_rel ** 5 * H * length / rho3
        if d_eps_x > 0 and beta_x > 0:
            beam.sigma[0, 0] += d_eps_x * beta_x
            beam.sigma[1, 1] += d_eps_x / beta_x

        eps_y = beam.emittance_y()
        beta_y = beam.beta_y()
        d_eps_y = d_eps_x * 0.01
        if d_eps_y > 0 and beta_y > 0:
            beam.sigma[2, 2] += d_eps_y * beta_y
            beam.sigma[3, 3] += d_eps_y / beta_y

        beam._update_bunch_properties()
        return EffectReport(self.name, context.element_index,
                           {"energy_loss": U, "d_sigma_E2": d_sigma_E2, "d_eps_x": d_eps_x, "H": H})

    def _apply_undulator(self, beam, element, context):
        length = element.get("length", 5.0)
        period = element.get("period", 0.03)
        K = element.get("kParameter", 1.5)
        gamma_rel = beam.energy / beam.mass
        if gamma_rel < 1:
            return EffectReport(self.name, context.element_index)
        rho_eff = period * gamma_rel / (2.0 * np.pi * K) if K > 0 else 1e10
        if rho_eff < 1e-6:
            return EffectReport(self.name, context.element_index)
        U = C_GAMMA * beam.energy ** 4 * length / rho_eff ** 2
        beam.energy = max(beam.energy - U, beam.mass)
        beam.update_relativistic()
        beam._update_bunch_properties()
        return EffectReport(self.name, context.element_index, {"energy_loss": U})
