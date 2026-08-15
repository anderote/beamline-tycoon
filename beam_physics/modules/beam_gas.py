import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport

# Gas density follows the ideal-gas relation n = P/(k_B T). Pressure arrives
# in mbar from the utility solver; the explicit density is what the collision
# model consumes.
K_BOLTZMANN = 1.380649e-23
GAS_TEMPERATURE_K = 300.0
MBAR_TO_PA = 100.0
DENSITY_PER_MBAR = MBAR_TO_PA / (K_BOLTZMANN * GAS_TEMPERATURE_K)


def number_density_from_pressure(pressure_mbar, temperature_k=GAS_TEMPERATURE_K):
    if pressure_mbar is None or pressure_mbar <= 0 or temperature_k <= 0:
        return 0.0
    return pressure_mbar * MBAR_TO_PA / (K_BOLTZMANN * temperature_k)


# Calibration. C_SCATTER is fixed so that, for a 50 MeV electron beam
# (beta*gamma ~ 98) with 1e-8 m rad geometric emittance through a 10 m beta
# function:
#   - 1e-9 mbar over 100 m grows emittance by ~0.03% (free)
#   - 1e-5 mbar over 100 m grows it ~2.5x (severe)
# 1e-5 mbar is genuinely bad vacuum for an accelerator — the utility solver
# already makes this a poor vacuum — so a beam that barely survives it is the
# correct outcome, not an overtuned penalty.
# Units: rad^2 (beta*gamma)^2 / (mbar m).
C_SCATTER = 0.05

# The same transport coefficient expressed per molecule rather than per mbar.
# Keeping this conversion exact preserves the established multiple-scattering
# calibration while making temperature and density explicit.
SCATTER_TRANSPORT_M2 = C_SCATTER / DENSITY_PER_MBAR

# Effective total beam-gas loss cross section. 1e-22 m² is an accelerator-scale
# order-of-magnitude for relativistic electrons on an air-like residual gas;
# survival is now exp(-n σ L), rather than an independently tuned pressure law.
LOSS_CROSS_SECTION_M2 = 1.0e-22
P_REF = 1e-5
LAMBDA_REF = 1.0 / (number_density_from_pressure(P_REF) * LOSS_CROSS_SECTION_M2)

# Below this the gas load is irrelevant at any length we can build.
P_NEGLIGIBLE = 1e-12


class BeamGasModule(PhysicsModule):
    """Multiple Coulomb scattering and beam-gas loss on residual gas.

    This is the only path by which vacuum affects beam QUALITY. The previous
    coupling narrowed the effective aperture in proportion to a 0-1 vacuum
    quality scalar, which fed aperture_loss — and aperture_loss only scales
    beam.current, never beam.sigma. Since beam_quality is
    initial_emittance / final_emittance, vacuum could not move it at all.
    Worse, clipping a Gaussian at a tighter aperture scrapes halo, which is how
    emittance is *improved* in reality, so the proxy pointed the wrong way.

    The physics here is standard multiple scattering. Angular spread per unit
    length goes as

        <theta^2> ~ (13.6 MeV / (beta c p))^2 * L / X_0

    and the radiation length of a gas is inversely proportional to its number
    density. Collecting constants into a transport coefficient:

        d<theta^2> = K_TRANSPORT * n * L / (beta gamma)^2

    added to the divergence terms of the covariance matrix, exactly as
    synchrotron_rad adds quantum excitation. Emittance growth then emerges from
    the determinant rather than being imposed on it.

    The 1/(beta gamma)^2 scaling is the interesting part for gameplay: a
    low-energy beam is enormously more fragile than a high-energy one, so the
    injector is what needs protecting, not the far end of the linac.

    Separately, large-angle and nuclear scattering remove particles outright:

        I *= exp(-n * sigma_loss * L)
    """

    def __init__(self):
        super().__init__(name="beam_gas", order=35)

    def applies_to(self, element, machine_type):
        # Absent pressure means the utility solver produced no value for this
        # node — not a perfect vacuum. Skip rather than assume either extreme.
        density = element.get("gas_density")
        if density is None:
            density = number_density_from_pressure(element.get("pressure"))
        if density <= number_density_from_pressure(P_NEGLIGIBLE):
            return False
        return element.get("length", 0.0) > 0

    def apply(self, beam, element, context):
        pressure = element.get("pressure", 0.0)
        density = element.get("gas_density")
        if density is None:
            density = number_density_from_pressure(pressure)
        length = element.get("length", 0.0)

        bg = beam.beta * beam.gamma
        if bg <= 0:
            return EffectReport(self.name, context.element_index,
                                {"skipped": "no_momentum"})

        # --- Multiple Coulomb scattering: divergence growth ---
        d_theta2 = SCATTER_TRANSPORT_M2 * density * length / (bg * bg)

        eps_x_before = beam.emittance_x()
        eps_y_before = beam.emittance_y()

        beam.sigma[1, 1] += d_theta2
        beam.sigma[3, 3] += d_theta2
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # --- Beam-gas loss ---
        lam = 1.0 / (density * LOSS_CROSS_SECTION_M2) if density > 0 else float("inf")
        survival = float(np.exp(-length / lam)) if lam > 0 else 0.0
        beam.current *= survival

        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {
            "pressure": pressure,
            "gas_density": density,
            "d_theta2": d_theta2,
            "survival": survival,
            "loss_fraction": 1.0 - survival,
            "d_emit_x": beam.emittance_x() - eps_x_before,
            "d_emit_y": beam.emittance_y() - eps_y_before,
        })
