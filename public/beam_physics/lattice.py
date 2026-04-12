import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_APERTURE, DEFAULT_SOURCE
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

# Fixed number of snapshot sample points returned by propagate()
SAMPLE_POINTS = 1000


def _make_sub_element(element, length_fraction):
    """Create a sub-element with scaled length-proportional properties."""
    sub = dict(element)
    full_length = element["length"]
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
    prev_max_sigma = None  # for divergence rate estimation
    prev_s = 0.0
    last_focus_s = 0.0  # s position of last focusing element

    for i, element in enumerate(beamline_config):
        context.element_index = i
        etype = element.get("type", "drift")

        if etype == "source":
            source_len = element["length"]
            context.cumulative_s += source_len
            sx = beam.beam_size_x()
            sy = beam.beam_size_y()
            max_sigma = max(sx, sy, 1e-15)
            prev_max_sigma = max_sigma
            prev_s = context.cumulative_s
            aperture = element.get("aperture", DEFAULT_APERTURE)
            focus_margin = 1.0 - (max_sigma / aperture)
            context.snapshots.append(beam.snapshot(i, etype, context.cumulative_s, extra={
                "eta_x": 0.0, "eta_xp": 0.0,
                "focus_margin": float(focus_margin),
                "focus_urgency": 0.0,
            }))
            continue

        if etype in ("quadrupole", "sextupole"):
            n_focusing += 1
            last_focus_s = context.cumulative_s

        length = element["length"]

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

            context.cumulative_s += sub_el["length"]

            # Compute focus margin and urgency for FODO advisor
            aperture = element.get("aperture", DEFAULT_APERTURE)
            sx = beam.beam_size_x()
            sy = beam.beam_size_y()
            max_sigma = max(sx, sy, 1e-15)
            focus_margin = 1.0 - (max_sigma / aperture)

            # Focus urgency: how soon does this beam need focusing?
            # Combines beam growth rate with distance since last focusing
            focus_urgency = 0.0
            if prev_max_sigma is not None and context.cumulative_s > prev_s:
                ds = context.cumulative_s - prev_s
                divergence_rate = (max_sigma - prev_max_sigma) / ds
                if divergence_rate > 0:
                    remaining = aperture - max_sigma
                    if remaining > 0:
                        meters_to_loss = remaining / divergence_rate
                    else:
                        meters_to_loss = 0.0
                    # Distance since last focusing element
                    drift_since_focus = context.cumulative_s - last_focus_s
                    # Reference scale based on energy (practical FODO half-cell)
                    # f = p / (q*c * G * l) with G=20 T/m, l=2m (1-tile quad), q*c=0.2998
                    p_gev = beam.energy
                    ref_focal = p_gev / (0.2998 * 20.0 * 2.0)
                    ref_scale = max(ref_focal, 1.0)
                    # Component 1: proximity to beam loss
                    loss_urgency = max(0.0, min(1.0, 1.0 - meters_to_loss / (ref_scale * 100.0)))
                    # Component 2: drift distance without focusing (saturates ~20m)
                    drift_urgency = min(1.0, drift_since_focus / 20.0)
                    # Take the max: either close to loss or long unfocused drift
                    focus_urgency = max(0.0, min(1.0, max(loss_urgency, drift_urgency)))

            prev_max_sigma = max_sigma
            prev_s = context.cumulative_s

            # Snapshot after each sub-step
            context.snapshots.append(beam.snapshot(i, etype, context.cumulative_s, extra={
                "eta_x": float(context.dispersion[0]),
                "eta_xp": float(context.dispersion[1]),
                "focus_margin": float(focus_margin),
                "focus_urgency": float(focus_urgency),
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

    # Resample snapshots to fixed 1000-point grid
    if context.snapshots and len(context.snapshots) > 1:
        total_s = context.snapshots[-1].get("s", 0)
        if total_s > 0:
            sample_positions = [i * total_s / (SAMPLE_POINTS - 1) for i in range(SAMPLE_POINTS)]
            resampled = []
            snap_idx = 0
            for target_s in sample_positions:
                # Advance snap_idx to bracket target_s
                while snap_idx < len(context.snapshots) - 1 and context.snapshots[snap_idx + 1].get("s", 0) <= target_s:
                    snap_idx += 1
                resampled.append(context.snapshots[snap_idx])
            context.snapshots = resampled

    return {
        "snapshots": context.snapshots,
        "summary": summary,
        "reports": context.reports,
    }
