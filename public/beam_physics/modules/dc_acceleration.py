from beam_physics.context import EffectReport
from beam_physics.modules.base import PhysicsModule


class DCElectrostaticAccelerationModule(PhysicsModule):
    """Unbunched electrostatic acceleration and LEBT compensation.

    A DC column changes momentum without creating RF buckets. Normalized
    transverse emittance is conserved by scaling the angular coordinates with
    p_in / p_out; the following linear-optics pass supplies the authored
    einzel-lens channel. Ion-space-charge compensation is carried on the beam
    until the first RF element captures it.
    """

    def __init__(self):
        # Acceleration must precede transport and space charge in each sub-step.
        super().__init__(name="dc_acceleration", order=5)

    def applies_to(self, element, machine_type):
        return element.get("type") == "dcAccelerator"

    def apply(self, beam, element, context):
        energy_gain = max(float(element.get("energyGain", 0.0)), 0.0)
        energy_before = float(beam.energy)
        momentum_before = float(beam.momentum_gev())

        beam.energy += energy_gain
        beam.update_relativistic()
        momentum_after = float(beam.momentum_gev())

        # Adiabatic damping follows momentum, not total energy. The distinction
        # is essential for ions: adding 750 keV barely changes a proton's total
        # 938 MeV energy but changes its momentum by several times.
        damping = 1.0
        if momentum_before > 0 and momentum_after > momentum_before:
            damping = momentum_before / momentum_after
            for axis in (1, 3):
                beam.sigma[axis, :] *= damping
                beam.sigma[:, axis] *= damping
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        compensation = max(0.0, min(
            0.999, float(element.get("spaceChargeCompensation", 0.0))))
        if beam.bunch_frequency <= 0:
            beam.space_charge_compensation = max(
                beam.space_charge_compensation, compensation)

        beam._update_bunch_properties()
        return EffectReport(self.name, context.element_index, {
            "energy_before": energy_before,
            "energy_gain": energy_gain,
            "energy_after": float(beam.energy),
            "momentum_damping": damping,
            "space_charge_compensation": beam.space_charge_compensation,
        })
