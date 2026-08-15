"""Incoherent photon production for storage-ring light sources.

SynchrotronRadiationModule accounts for the energy the electron beam loses in
bends and insertion devices. That loss is a liability for every linear
machine, but it is the product of a light source. Keeping photon production in
its own capability-gated module prevents an XFEL or collider from being paid
for radiation that merely degrades its beam.
"""

import numpy as np

from beam_physics.constants import C_GAMMA, ELECTRON_CHARGE
from beam_physics.context import EffectReport
from beam_physics.modules.base import PhysicsModule


class SynchrotronLightModule(PhysicsModule):
    """Convert bend/undulator radiation into a physically scaled photon rate."""

    def __init__(self):
        # Run immediately after synchrotron_radiation. The energy decrement is
        # tiny per element, and using the post-loss energy is conservative.
        super().__init__(name="synchrotron_light", order=41)

    def applies_to(self, element, machine_type):
        # Local import avoids the machines.py -> module -> machines.py cycle.
        from beam_physics.machines import machine_has_capability

        if not machine_has_capability(machine_type, "sr_light"):
            return False
        return element.get("type", "") in {
            "dipole", "combined_function", "undulator",
        }

    def apply(self, beam, element, context):
        if beam.mass > 0.01 or beam.current <= 0:
            return EffectReport(self.name, context.element_index, {
                "photon_rate": 0.0,
                "radiated_power_w": 0.0,
                "skipped": "not_electron_or_no_beam",
            })

        etype = element.get("type", "")
        length = max(float(element.get("length", 0.0)), 0.0)
        energy_gev = max(float(beam.energy), float(beam.mass))

        if etype in ("dipole", "combined_function"):
            theta = abs(np.radians(float(element.get("bendAngle", 15.0))))
            if length <= 0 or theta <= 1e-12:
                return EffectReport(self.name, context.element_index)
            rho = length / theta
            energy_loss_gev = C_GAMMA * energy_gev ** 4 * theta / rho

            # Critical photon energy for an electron bend, keV. The mean
            # synchrotron photon carries about 0.308 E_c.
            critical_kev = 0.665 * energy_gev ** 3 / rho
            photon_energy_j = max(0.3079 * critical_kev * 1e3
                                  * ELECTRON_CHARGE, 1e-30)
        else:
            period = max(float(element.get("period", 0.03)), 1e-9)
            k_value = max(float(element.get("kParameter", 1.5)), 0.0)
            gamma_rel = energy_gev / beam.mass
            if length <= 0 or gamma_rel <= 1 or k_value <= 0:
                return EffectReport(self.name, context.element_index)
            rho_eff = period * gamma_rel / (2.0 * np.pi * k_value)
            energy_loss_gev = C_GAMMA * energy_gev ** 4 * length / rho_eff ** 2

            wavelength_m = (period / (2.0 * gamma_rel ** 2)
                            * (1.0 + k_value ** 2 / 2.0))
            # hc / lambda, with hc in eV m.
            photon_energy_j = max(
                (1.239841984e-6 / max(wavelength_m, 1e-30))
                * ELECTRON_CHARGE,
                1e-30,
            )

        # U[GeV] x I[mA] x 1e6 = radiated watts.
        power_w = max(energy_loss_gev, 0.0) * beam.current * 1e6
        photon_rate = power_w / photon_energy_j
        return EffectReport(self.name, context.element_index, {
            "photon_rate": float(photon_rate),
            "radiated_power_w": float(power_w),
            "photon_energy_j": float(photon_energy_j),
        })
