import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.machines import get_machine_config


# Element types that are thin-lens effects (not length-proportional)
# These should only be applied once, on the final sub-step
THIN_EFFECT_TYPES = {"chicane", "collimator", "detector", "target", "beamStop",
                     "fixedTargetAdv", "positronTarget", "splitter"}

# Modules that are thin-lens effects (apply once, not per sub-step)
THIN_MODULES = {"bunch_compression", "collimation", "beam_beam", "fel_gain"}

# Default sub-step size in meters
SUB_STEP_SIZE = 0.5


def _make_sub_element(element, length_fraction):
    """Create a sub-element with scaled length-proportional properties."""
    sub = dict(element)
    full_length = element.get("length", 0.0)
    sub["length"] = full_length * length_fraction

    # Scale bend angle proportionally for dipoles/combined-function
    etype = element.get("type", "")
    if etype in ("dipole", "combined_function"):
        bend = element.get("bendAngle", 0.0)
        sub["bendAngle"] = bend * length_fraction

    # Scale energy gain for RF elements
    if "energyGain" in element:
        sub["energyGain"] = element["energyGain"] * length_fraction

    # Scale R56 for chicanes
    if "r56" in element:
        sub["r56"] = element["r56"] * length_fraction

    return sub


def propagate(beamline_config, machine_type=None, source_params=None):
    """
    Propagate a beam through a beamline using the modular physics engine.
    Elements are sub-stepped for smooth intra-element envelope evolution.

    Args:
        beamline_config: list of element dicts
        machine_type: "linac", "photoinjector", "fel", "collider" (default: "linac")
        source_params: dict of source parameters (uses defaults if None)

    Returns:
        dict with "snapshots", "summary", "reports"
    """
    if machine_type is None:
        machine_type = "linac"

    machine_config = get_machine_config(machine_type)
    modules = machine_config["modules"]

    params = dict(DEFAULT_SOURCE)
    if source_params:
        params.update(source_params)

    beam = create_initial_beam(params)
    initial_current = beam.current
    initial_eps_x = beam.emittance_x()
    initial_eps_y = beam.emittance_y()

    context = PropagationContext(machine_type)
    context.active_modules = modules

    total_photon_rate = 0.0
    luminosities = []
    collision_rates = []
    n_focusing = 0

    for i, element in enumerate(beamline_config):
        context.element_index = i
        etype = element.get("type", "drift")

        if etype == "source":
            context.snapshots.append(beam.snapshot(i, etype, 0.0, extra={
                "eta_x": 0.0, "eta_xp": 0.0,
            }))
            continue

        if etype in ("quadrupole", "sextupole"):
            n_focusing += 1

        length = element.get("length", 0.0)

        # Determine sub-stepping
        if length > 0 and etype not in THIN_EFFECT_TYPES:
            n_steps = max(1, int(np.ceil(length / SUB_STEP_SIZE)))
        else:
            n_steps = 1

        fraction = 1.0 / n_steps

        for step in range(n_steps):
            is_last = (step == n_steps - 1)

            if n_steps > 1:
                sub_el = _make_sub_element(element, fraction)
            else:
                sub_el = element

            # Run modules
            for module in modules:
                if not module.applies_to(element, machine_type):
                    continue

                # Thin-lens modules only run on the last sub-step
                if module.name in THIN_MODULES and not is_last:
                    continue

                report = module.apply(beam, sub_el, context)
                context.record(report)

                if module.name == "fel_gain" and report.details:
                    total_photon_rate += report.details.get("power_w", 0) * 1e-6
                if module.name == "beam_beam" and report.details:
                    luminosities.append(report.details.get("luminosity", 0))

            if etype == "target" and is_last:
                collision_rates.append(beam.current * element.get("collisionRate", 2.0))

            context.cumulative_s += sub_el.get("length", 0.0)

            # Snapshot after each sub-step
            context.snapshots.append(beam.snapshot(i, etype, context.cumulative_s, extra={
                "eta_x": float(context.dispersion[0]),
                "eta_xp": float(context.dispersion[1]),
            }))

            if not beam.alive:
                break

        if not beam.alive:
            break

    # Beam quality
    final_eps = 0.5 * (beam.emittance_x() + beam.emittance_y())
    initial_eps = 0.5 * (initial_eps_x + initial_eps_y)
    beam_quality = max(0.0, min(1.0, initial_eps / final_eps)) if initial_eps > 0 and final_eps > 0 else 0.0

    cumulative_loss = 1.0 - (beam.current / initial_current) if initial_current > 0 else 0.0

    summary = {
        "final_energy": beam.energy,
        "final_current": beam.current,
        "initial_current": initial_current,
        "luminosity": sum(luminosities),
        "collision_rate": sum(collision_rates),
        "photon_rate": total_photon_rate,
        "beam_quality": beam_quality,
        "alive": beam.alive,
        "total_loss_fraction": cumulative_loss,
        "final_emittance_x": beam.emittance_x(),
        "final_emittance_y": beam.emittance_y(),
        "final_norm_emittance_x": beam.norm_emittance_x(),
        "final_norm_emittance_y": beam.norm_emittance_y(),
        "final_energy_spread": beam.energy_spread(),
        "final_beam_size_x": beam.beam_size_x(),
        "final_beam_size_y": beam.beam_size_y(),
        "final_bunch_length": beam.bunch_length(),
        "n_focusing": n_focusing,
    }

    return {
        "snapshots": context.snapshots,
        "summary": summary,
        "reports": context.reports,
    }
