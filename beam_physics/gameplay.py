"""
Convert raw physics outputs to game-facing quantities.

This module bridges the physics simulation and the game state,
applying scaling, clamping, and multipliers from research effects.
"""

import json
from beam_physics.lattice import propagate

# Default stats per component type, matching data.js COMPONENTS
COMPONENT_DEFAULTS = {
    # === Electron Sources ===
    "source":       {"length": 2.0},
    "dcPhotoGun":   {"length": 2.0, "emittance": 1e-6},
    "ncRfGun":      {"length": 2.0, "emittance": 0.5e-6},
    "srfGun":       {"length": 3.0, "emittance": 0.3e-6},
    # === Beam Pipe ===
    "drift":        {"length": 5.0},
    "driftVert":    {"length": 5.0},
    "bellows":      {"length": 0.3},
    # === RF Cavities ===
    "rfCavity":     {"length": 4.0, "energyGain": 0.5},
    "cryomodule":   {"length": 5.0, "energyGain": 2.0},
    "buncher":      {"length": 2.0, "energyGain": 0.05},
    "harmonicLinearizer": {"length": 2.0, "energyGain": 0.02},
    "cbandCavity":  {"length": 2.0, "energyGain": 0.8},
    "xbandCavity":  {"length": 2.0, "energyGain": 1.2},
    "srf650Cavity": {"length": 4.0, "energyGain": 1.5},
    # === Magnets ===
    "dipole":       {"length": 3.0, "bendAngle": 90.0},
    "quadrupole":   {"length": 2.0, "focusStrength": 1.0},
    "solenoid":     {"length": 1.0, "field": 0.2},
    "corrector":    {"length": 1.0},
    "sextupole":    {"length": 2.0, "focusStrength": 0.5, "beamQuality": 0.3},
    "octupole":     {"length": 1.0},
    "scQuad":       {"length": 1.0, "focusStrength": 2.0},
    "scDipole":     {"length": 3.0, "bendAngle": 90.0},
    "combinedFunctionMagnet": {"length": 2.0, "focusStrength": 0.5, "bendAngle": 45.0},
    # === Diagnostics ===
    "bpm":          {"length": 0.1},
    "screen":       {"length": 0.1},
    "ict":          {"length": 0.1},
    "wireScanner":  {"length": 0.2},
    "bunchLengthMonitor": {"length": 0.2},
    "energySpectrometer": {"length": 1.0},
    "beamLossMonitor": {"length": 0.1},
    "srLightMonitor": {"length": 0.2},
    # === Insertion Devices ===
    "undulator":    {"length": 5.0, "photonRate": 1.0},
    "helicalUndulator": {"length": 5.0, "photonRate": 1.2},
    "wiggler":      {"length": 5.0, "photonRate": 2.0},
    "apple2Undulator": {"length": 5.0, "photonRate": 1.5},
    # === Beam Manipulation ===
    "collimator":   {"length": 2.0, "beamQuality": 0.2},
    "kickerMagnet": {"length": 1.0},
    "septumMagnet": {"length": 2.0},
    "chicane":      {"length": 4.0, "r56": -0.05},
    "dogleg":       {"length": 3.0},
    "stripperFoil": {"length": 0.1},
    # === Targets & Endpoints ===
    "detector":     {"length": 6.0, "dataRate": 1.0},
    "target":       {"length": 3.0, "collisionRate": 2.0},
    "fixedTargetAdv": {"length": 3.0, "collisionRate": 5.0},
    "photonPort":   {"length": 2.0, "photonRate": 0.5},
    "positronTarget": {"length": 3.0, "collisionRate": 3.0},
    "comptonIP":    {"length": 3.0, "photonRate": 1.0},
    "splitter":     {"length": 2.0},
    # === Infrastructure (no beam physics, just present in beamline) ===
    "beamDump":     {"length": 1.0},
}

# Source types that produce initial beam
SOURCE_TYPES = {"source", "dcPhotoGun", "ncRfGun", "srfGun"}

# Component types that are diagnostics
DIAGNOSTIC_TYPES = {"bpm", "screen", "ict", "wireScanner", "bunchLengthMonitor",
                    "energySpectrometer", "beamLossMonitor", "srLightMonitor"}

# Component types that are insertion devices
INSERTION_DEVICE_TYPES = {"undulator", "helicalUndulator", "wiggler", "apple2Undulator"}

# RF cavity types
RF_CAVITY_TYPES = {"rfCavity", "cryomodule", "buncher", "harmonicLinearizer",
                   "cbandCavity", "xbandCavity", "srf650Cavity"}

# Scaling factors: convert game stat values to physically reasonable parameters
# Game focusStrength=1 -> k=0.3 /m^2 (moderate quad, works with 5m drifts)
# Game bendAngle=90 -> 15 degrees physically (90 is a routing concept in the grid)
# Game energyGain stays as-is (already in GeV)
QUAD_K_SCALE = 0.3        # game focusStrength -> k (1/m^2)
DIPOLE_ANGLE_SCALE = 15.0 / 90.0  # game bendAngle -> physical degrees
LENGTH_SCALE = 0.5        # game length units -> physical meters (makes beamline more compact)


def beamline_config_from_game(game_beamline):
    """
    Convert game beamline format to physics element list.

    game_beamline: list of dicts, each with at minimum:
        {"type": "quadrupole", ...}
    May also include stats from the COMPONENTS template:
        {"type": "quadrupole", "stats": {"focusStrength": 1}, "length": 2}

    Maps game component stats to physics parameters.
    """
    elements = []
    quad_index = 0

    for comp in game_beamline:
        ctype = comp["type"]

        # Map game component types to physics element types
        if ctype in ("driftVert", "bellows", "splitter", "dogleg"):
            physics_type = "drift"
        elif ctype in SOURCE_TYPES:
            physics_type = "source"
        elif ctype in ("scQuad",):
            physics_type = "quadrupole"
        elif ctype in ("scDipole",):
            physics_type = "dipole"
        elif ctype in RF_CAVITY_TYPES:
            physics_type = "rfCavity" if ctype != "cryomodule" else "cryomodule"
            if ctype in ("buncher", "harmonicLinearizer", "cbandCavity",
                         "xbandCavity", "srf650Cavity"):
                physics_type = "rfCavity"
        elif ctype in INSERTION_DEVICE_TYPES:
            physics_type = "undulator"
        elif ctype in DIAGNOSTIC_TYPES:
            physics_type = "drift"  # diagnostics are thin elements
        elif ctype in ("fixedTargetAdv", "positronTarget"):
            physics_type = "target"
        elif ctype in ("photonPort", "comptonIP"):
            physics_type = "drift"  # endpoints, no beam physics effect
        elif ctype in ("kickerMagnet", "septumMagnet", "corrector",
                        "octupole", "stripperFoil"):
            physics_type = "drift"  # thin elements, minimal beam effect
        elif ctype == "combinedFunctionMagnet":
            physics_type = "combined_function"
        elif ctype == "chicane":
            physics_type = "chicane"
        elif ctype == "solenoid":
            physics_type = "solenoid"
        else:
            physics_type = ctype

        defaults = COMPONENT_DEFAULTS.get(ctype, {"length": 1.0})
        stats = comp.get("stats", {})

        el = {"type": physics_type}
        el["game_type"] = ctype  # preserve original type for diagnostics
        el["length"] = comp.get("length", defaults.get("length", 1.0)) * LENGTH_SCALE

        if physics_type == "source":
            el["length"] = 0
            # Read emittance from computed stats if available, else use defaults per gun type
            default_emit = {"dcPhotoGun": 1e-6, "ncRfGun": 0.5e-6, "srfGun": 0.3e-6}
            # component-physics.js computes emittance in mm·mrad; convert to m·rad
            raw_emit = stats.get("emittance", None)
            if raw_emit is not None and raw_emit > 0:
                el["emittance"] = raw_emit * 1e-6  # mm·mrad → m·rad
            else:
                el["emittance"] = default_emit.get(ctype, 1e-6)

        elif physics_type == "quadrupole":
            raw_k = stats.get("focusStrength",
                              defaults.get("focusStrength", 1.0))
            el["focusStrength"] = raw_k * QUAD_K_SCALE
            # Player-controlled polarity; fall back to auto-alternation
            polarity = comp.get("polarity", stats.get("polarity", None))
            if polarity is not None:
                el["polarity"] = polarity
            else:
                el["polarity"] = 1 if (quad_index % 2 == 0) else -1
                quad_index += 1

        elif physics_type == "dipole":
            raw_angle = stats.get("bendAngle",
                                  defaults.get("bendAngle", 90.0))
            el["bendAngle"] = raw_angle * DIPOLE_ANGLE_SCALE

        elif physics_type == "combined_function":
            raw_angle = stats.get("bendAngle",
                                  defaults.get("bendAngle", 45.0))
            el["bendAngle"] = raw_angle * DIPOLE_ANGLE_SCALE
            raw_k = stats.get("focusStrength",
                              defaults.get("focusStrength", 0.5))
            el["focusStrength"] = raw_k * QUAD_K_SCALE

        elif physics_type in ("rfCavity", "cryomodule"):
            el["energyGain"] = stats.get("energyGain",
                                         defaults.get("energyGain", 0.5))
            # rfPhase comes from params (slider) or stats (computed)
            params = comp.get("params", {})
            el["rfPhase"] = params.get("rfPhase",
                                       stats.get("rfPhase", 0.0))

        elif physics_type == "sextupole":
            el["focusStrength"] = stats.get("focusStrength",
                                            defaults.get("focusStrength", 0.5))

        elif physics_type == "collimator":
            el["beamQuality"] = stats.get("beamQuality",
                                          defaults.get("beamQuality", 0.2))

        elif physics_type == "undulator":
            el["photonRate"] = stats.get("photonRate",
                                         defaults.get("photonRate", 1.0))
            # Period in component-physics is in mm, convert to metres
            raw_period = stats.get("period", None)
            if raw_period is not None:
                el["period"] = raw_period * 1e-3  # mm → m
            else:
                el["period"] = defaults.get("period", 0.03)
            el["kParameter"] = stats.get("kParameter", defaults.get("kParameter", 1.5))

        elif physics_type == "detector":
            el["dataRate"] = stats.get("dataRate",
                                       defaults.get("dataRate", 1.0))

        elif physics_type == "target":
            el["collisionRate"] = stats.get("collisionRate",
                                            defaults.get("collisionRate", 2.0))

        elif physics_type == "solenoid":
            # Read field from params (slider) or stats, falling back to default
            params = comp.get("params", {})
            el["fieldStrength"] = params.get("fieldStrength",
                                             stats.get("fieldStrength",
                                                       defaults.get("field", 0.2)))

        elif physics_type == "chicane":
            params = comp.get("params", {})
            # r56 in game units is mm, convert to metres for physics
            raw_r56 = params.get("r56", stats.get("r56", None))
            if raw_r56 is not None:
                el["r56"] = raw_r56 * 1e-3  # mm → m
            else:
                el["r56"] = defaults.get("r56", -0.05)

        elements.append(el)

    return elements


def physics_to_game(physics_result, research_effects=None, elements=None):
    """
    Convert physics propagation results to game state updates.

    physics_result: output of lattice.propagate()
    research_effects: dict of active research multipliers, e.g.:
        {"luminosityMult": 2, "dataRateMult": 2, "energyCostMult": 0.7}
    elements: original element config list (for game_type info)

    Returns dict with game-facing values.
    """
    effects = research_effects or {}
    elements = elements or []
    summary = physics_result["summary"]

    lumi_mult = effects.get("luminosityMult", 1.0)
    data_mult = effects.get("dataRateMult", 1.0)

    # Infrastructure research effects
    vacuum_quality = effects.get("vacuumQuality", 0)
    beam_stability = effects.get("beamStability", 0)
    photon_flux_mult = effects.get("photonFluxMult", 1.0)
    beam_lifetime_mult = effects.get("beamLifetimeMult", 1.0)

    # Beam quality acts as a multiplier on data output:
    # quality=1.0 means perfect emittance preservation -> full output
    # quality=0.0 means beam is degraded -> no useful data
    # beam_stability research improves effective quality
    quality = min(1.0, summary["beam_quality"] * (1.0 + beam_stability))

    # Current fraction: how much beam survives
    # vacuum_quality research reduces losses, beam_lifetime_mult extends lifetime
    raw_loss = summary["total_loss_fraction"]
    improved_loss = raw_loss * max(0.1, 1.0 - vacuum_quality) / beam_lifetime_mult
    current_frac = 1.0 - min(improved_loss, raw_loss)  # never worse than raw

    # Data rate from detectors:
    # - sqrt(luminosity): compress the huge dynamic range
    # - quality: emittance preservation = cleaner data
    # - current_frac: more surviving beam = more events
    # - energy_factor: higher energy = more interesting physics
    #   log(1 + E/0.1) gives: 10MeV->0.1, 0.5GeV->1.8, 1GeV->2.4, 10GeV->4.6
    # - control_factor: beamline must have focusing elements to be useful
    #   An uncontrolled beam can't reliably deliver particles to an experiment
    import math
    raw_luminosity = summary["luminosity"]
    compressed_lumi = math.sqrt(max(raw_luminosity, 0))
    energy_factor = math.log(1.0 + summary["final_energy"] / 0.1)

    # Count focusing elements for beam control factor
    n_focusing = summary.get("n_focusing", 0)
    control_factor = 0.05 + min(0.95, n_focusing * 0.3)

    data_rate = (compressed_lumi * quality * current_frac
                 * energy_factor * control_factor
                 * lumi_mult * data_mult * 0.001)
    # Minimum viable data rate if there's a detector and beam is alive
    if data_rate > 0 and data_rate < 0.1:
        data_rate = 0.1

    # Photon rate from undulators: scales with current, quality, and photon science research
    photon_rate_val = summary["photon_rate"] * quality * current_frac * photon_flux_mult

    # Collision rate from targets: scales with current
    collision_rate = summary["collision_rate"] * current_frac * lumi_mult

    # Discovery chance scales with luminosity and energy
    discovery_base = effects.get("discoveryChance", 0.0)
    if summary["final_energy"] > 10.0 and raw_luminosity > 0:
        discovery_chance = discovery_base * summary["final_energy"] * 0.01
    else:
        discovery_chance = 0.0

    # Count diagnostics from original element config (game_type preserved there)
    n_diagnostics = sum(1 for el in elements
                        if el.get("game_type", el["type"]) in DIAGNOSTIC_TYPES)

    result = {
        # Core beam state
        "beamEnergy": summary["final_energy"],
        "beamAlive": summary["alive"],
        "beamCurrent": summary["final_current"],

        # Resource generation rates (per game tick)
        "dataRate": data_rate,
        "collisionRate": collision_rate,
        "photonRate": photon_rate_val,

        # Quality metrics
        "beamQuality": quality,
        "totalLossFraction": summary["total_loss_fraction"],
        "luminosity": raw_luminosity * lumi_mult,

        # Discovery
        "discoveryChance": discovery_chance,

        # Per-element envelope for visualization (maps back to beamPath order)
        "envelope": [
            {
                "index": s["element_index"],
                "type": s["element_type"],
                "sigma_x": s["beam_size_x"],
                "sigma_y": s["beam_size_y"],
                "energy": s["energy"],
                "current": s["current"],
                "alive": s["alive"],
                # New fields for probe diagnostics
                "s": s["s"],
                "beta_x": s["beta_x"],
                "beta_y": s["beta_y"],
                "alpha_x": s["alpha_x"],
                "alpha_y": s["alpha_y"],
                "emit_x": s["emittance_x"],
                "emit_y": s["emittance_y"],
                "emit_nx": s["norm_emittance_x"],
                "emit_ny": s["norm_emittance_y"],
                "energy_spread": s["energy_spread"],
                "bunch_length": s["bunch_length"],
                "cov_xx": s["cov_xx"],
                "cov_xxp": s["cov_xxp"],
                "cov_xpxp": s["cov_xpxp"],
                "cov_yy": s["cov_yy"],
                "cov_yyp": s["cov_yyp"],
                "cov_ypyp": s["cov_ypyp"],
                "cov_tt": s["cov_tt"],
                "cov_tdE": s["cov_tdE"],
                "cov_dEdE": s["cov_dEdE"],
                "cov_xy": s["cov_xy"],
            }
            for s in physics_result["snapshots"]
        ],

        # Detailed final state
        "finalEmittanceX": summary["final_emittance_x"],
        "finalEmittanceY": summary["final_emittance_y"],
        "finalNormEmittanceX": summary.get("final_norm_emittance_x", None),
        "finalNormEmittanceY": summary.get("final_norm_emittance_y", None),
        "finalEnergySpread": summary["final_energy_spread"],
        "finalBeamSizeX": summary["final_beam_size_x"],
        "finalBeamSizeY": summary["final_beam_size_y"],
        "finalBunchLength": summary.get("final_bunch_length", None),

        # Diagnostic coverage
        "nDiagnostics": n_diagnostics,
    }

    # Extract FEL data from module reports
    reports = physics_result.get("reports", [])
    fel_reports = [r for r in reports if r.module == "fel_gain"]
    if fel_reports:
        best = max(fel_reports, key=lambda r: r.details.get("power_w", 0))
        result["felSaturated"] = best.details.get("saturated", False)
        result["felWavelength"] = best.details.get("wavelength_m", None)
        result["felPower"] = best.details.get("power_w", 0)
        result["felGainLength"] = best.details.get("gain_length_3D_m", None)
        result["felRho"] = best.details.get("rho", 0)
    else:
        result["felSaturated"] = False

    # Extract beam-beam data
    bb_reports = [r for r in reports if r.module == "beam_beam"]
    if bb_reports:
        result["luminosity"] = bb_reports[0].details.get("luminosity", 0)
        result["tuneShiftY"] = bb_reports[0].details.get("tune_shift_y", 0)
        result["beamStable"] = bb_reports[0].details.get("beam_stable", True)

    return result


def compute_beam_for_game(game_beamline_json, research_effects_json=None):
    """
    Top-level entry point called from Pyodide.

    Accepts JSON strings, returns a JSON string.
    """
    game_beamline = json.loads(game_beamline_json)
    research_effects = json.loads(research_effects_json) if research_effects_json else {}

    elements = beamline_config_from_game(game_beamline)
    machine_type = research_effects.get("machineType", "linac") if research_effects else "linac"
    physics_result = propagate(elements, machine_type=machine_type)
    game_result = physics_to_game(physics_result, research_effects, elements)

    return json.dumps(game_result)
