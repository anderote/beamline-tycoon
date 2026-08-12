import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport

# Calibration. C_SCATTER is fixed so that, for a 50 MeV electron beam
# (beta*gamma ~ 98) with 1e-8 m rad geometric emittance through a 10 m beta
# function:
#   - 1e-9 mbar over 100 m grows emittance by ~0.03% (free)
#   - 1e-5 mbar over 100 m grows it ~2.5x (severe)
# 1e-5 mbar is genuinely bad vacuum for an accelerator — the utility solver
# already maps 1e-4 to quality zero — so a beam that barely survives it is the
# correct outcome, not an overtuned penalty.
# Units: rad^2 (beta*gamma)^2 / (mbar m).
C_SCATTER = 0.05

# Beam-gas loss length. At P_REF the 1/e length is LAMBDA_REF; it scales as
# 1/P, so a decade better vacuum buys a decade more lifetime.
P_REF = 1e-5
LAMBDA_REF = 100.0

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

    and the radiation length of a gas is inversely proportional to its density,
    hence to pressure. Collecting constants:

        d<theta^2> = C_SCATTER * P * L / (beta gamma)^2

    added to the divergence terms of the covariance matrix, exactly as
    synchrotron_rad adds quantum excitation. Emittance growth then emerges from
    the determinant rather than being imposed on it.

    The 1/(beta gamma)^2 scaling is the interesting part for gameplay: a
    low-energy beam is enormously more fragile than a high-energy one, so the
    injector is what needs protecting, not the far end of the linac.

    Separately, large-angle and nuclear scattering remove particles outright:

        I *= exp(-L / lambda),   lambda = LAMBDA_REF * (P_REF / P)
    """

    def __init__(self):
        super().__init__(name="beam_gas", order=35)

    def applies_to(self, element, machine_type):
        # Absent pressure means the utility solver produced no value for this
        # node — not a perfect vacuum. Skip rather than assume either extreme.
        pressure = element.get("pressure")
        if pressure is None or pressure <= P_NEGLIGIBLE:
            return False
        return element.get("length", 0.0) > 0

    def apply(self, beam, element, context):
        pressure = element.get("pressure", 0.0)
        length = element.get("length", 0.0)

        bg = beam.beta * beam.gamma
        if bg <= 0:
            return EffectReport(self.name, context.element_index,
                                {"skipped": "no_momentum"})

        # --- Multiple Coulomb scattering: divergence growth ---
        d_theta2 = C_SCATTER * pressure * length / (bg * bg)

        eps_x_before = beam.emittance_x()
        eps_y_before = beam.emittance_y()

        beam.sigma[1, 1] += d_theta2
        beam.sigma[3, 3] += d_theta2
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # --- Beam-gas loss ---
        lam = LAMBDA_REF * (P_REF / pressure)
        survival = float(np.exp(-length / lam)) if lam > 0 else 0.0
        beam.current *= survival

        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {
            "pressure": pressure,
            "d_theta2": d_theta2,
            "survival": survival,
            "loss_fraction": 1.0 - survival,
            "d_emit_x": beam.emittance_x() - eps_x_before,
            "d_emit_y": beam.emittance_y() - eps_y_before,
        })
