"""
Convert raw physics outputs to game-facing quantities.

This module bridges the physics simulation and the game state,
applying scaling, clamping, and multipliers from research effects.
"""

import json
from beam_physics.lattice import propagate
from beam_physics.machines import get_machine_config
from beam_physics.constants import DEFAULT_APERTURE
from beam_physics import srf

# Default stats per component type, matching data.js COMPONENTS
# Note: length is NOT stored here — every component must declare subL in JS
COMPONENT_DEFAULTS = {
    # === Electron Sources ===
    "dcPhotoGun":   {"emittance": 1e-6},
    "ncRfGun":      {"emittance": 0.5e-6},
    "srfGun":       {"emittance": 0.3e-6},
    # === RF Cavities ===
    "rfCavity":     {"energyGain": 0.5},
    "cryomodule":   {"energyGain": 2.0},
    "buncher":      {"energyGain": 0.05},
    "harmonicLinearizer": {"energyGain": 0.02},
    "dtl":           {"energyGain": 0.0073},
    # The RF ladder. These are fallbacks only — the JS catalogue's `stats`
    # win whenever a component is supplied. Keep them in agreement with
    # beamline-components.raw.js; they must never diverge.
    "cbandStructure":   {"energyGain": 0.12},
    "xbandStructure":   {"energyGain": 0.30},
    "srf650Cryomodule": {"energyGain": 0.15},
    "srf805Cryomodule": {"energyGain": 0.40},
    "cwCryomodule":     {"energyGain": 0.50},
    "nbSnCryomodule":   {"energyGain": 1.2},
    "srfLinacSector":   {"energyGain": 3.5},
    "twoBeamModule":    {"energyGain": 6.0},
    "plasmaAfterburner": {"energyGain": 15},
    "crystalChannelStage": {"energyGain": 12000},
    # === Magnets ===
    "dipole":       {"bendAngle": 90.0},
    "quadrupole":   {"focusStrength": 1.0},
    "solenoid":     {"field": 0.2},
    "sextupole":    {"focusStrength": 0.5, "beamQuality": 0.3},
    "scQuad":       {"focusStrength": 2.0},
    "scDipole":     {"bendAngle": 90.0},
    "combinedFunctionMagnet": {"focusStrength": 0.5, "bendAngle": 45.0},
    # === Insertion Devices ===
    "undulator":    {"photonRate": 1.0},
    "helicalUndulator": {"photonRate": 1.2},
    "wiggler":      {"photonRate": 2.0},
    "apple2Undulator": {"photonRate": 1.5},
    # === Beam Manipulation ===
    "collimator":   {"beamQuality": 0.2},
    "chicane":      {"r56": -0.05},
    # === Targets & Endpoints ===
    "detector":     {"dataRate": 1.0},
    "target":       {"collisionRate": 2.0},
    "fixedTargetAdv": {"collisionRate": 5.0},
    "photonPort":   {"photonRate": 0.5},
    "positronTarget": {"collisionRate": 3.0},
    "comptonIP":    {"photonRate": 1.0},
    "blackHoleChamber": {"collisionRate": 12.0},
    "hawkingDetector":  {"dataRate": 40.0},
}

# Component types that are diagnostics (game types; used for coverage counting)
DIAGNOSTIC_TYPES = {"bpm", "screen", "ict", "wireScanner", "bunchLengthMonitor",
                    "energySpectrometer", "beamLossMonitor", "srLightMonitor"}

# The closed set of physics element types the engine understands
# (elements.transfer_matrix dispatch, lattice special-casing, and the
# module tier lists in machines.py). Every game component declares one of
# these as `physicsType` in src/data/beamline-components.raw.js; a missing
# or unknown value raises ValueError — no silent fallthrough.
KNOWN_PHYSICS_TYPES = {
    "source", "drift", "quadrupole", "dipole", "combined_function",
    "rfCavity", "cryomodule", "sextupole", "collimator", "undulator",
    "solenoid", "chicane", "detector", "target", "beamStop",
}

# Scaling factors: convert game stat values to physically reasonable parameters
# Game focusStrength=1 -> k=0.3 /m^2 (moderate quad, 1-tile quad = 2m physical)
# Game bendAngle=90 -> 15 degrees physically (90 is a routing concept in the grid)
# Game energyGain stays as-is (already in GeV)
QUAD_K_SCALE = 0.3        # game focusStrength -> k (1/m^2)
DIPOLE_ANGLE_SCALE = 15.0 / 90.0  # game bendAngle -> physical degrees

# --- black_hole_yield ------------------------------------------------------
#
# The success metric for machines.py's "blackHoleFactory", and the only figure
# of merit in the game computed here rather than on the JS side. It is here for
# one reason: it needs the luminosity, and luminosity is produced by the
# beam_beam module, which only this file ever sees the reports of.
#
# ANALYTIC, and no new physics module. In a theory with `n` flat extra
# dimensions and a fundamental scale M_D of order a TeV, two partons that pass
# within their common Schwarzschild radius form a black hole, and the
# production cross-section is simply the area of that disc — the standard
# Dimopoulos-Landsberg / Giddings-Thomas geometric estimate:
#
#     r_s ~ (1 / M_D) * (sqrt(s) / M_D)^(1 / (n + 1))
#     sigma = pi * r_s^2
#
# with sqrt(s) = 2 * E_beam for head-on equal beams. Yield is then sigma x L,
# which is the same shape as every other metric in the roster: a physics
# quantity times the beam that delivers it, with no fitted constants. The one
# input that is a CHOICE rather than a measurement is M_D, and the choice is
# stated below rather than buried.
#
# Note what this does NOT claim. Nothing here models formation, evaporation, or
# the parton distribution that decides how much of the beam energy is actually
# available — real yield estimates integrate over PDFs and lose orders of
# magnitude doing it. This is a figure of merit with the right dependence on
# the two things the player controls, exactly as `fluence` and `photon_flux`
# are, and the spec (docs/superpowers/specs/2026-08-12-*) puts a real
# production model explicitly out of scope.

# Fundamental (higher-dimensional) Planck scale, GeV. 5 TeV is inside what LHC
# searches have not excluded for large n, and it is the number the band floor
# was chosen against: below ~200 TeV in the centre of mass nothing is above
# threshold by enough to see.
PLANCK_SCALE_GEV = 5000.0
# Number of flat extra dimensions. 6 is the ADD benchmark and the value that
# makes r_s scale as the seventh root — a very weak energy dependence, which is
# why this machine is bought for luminosity and not for the last 100 TeV.
EXTRA_DIMENSIONS = 6
# (hbar c)^2 = 0.3894 mb GeV^2, and 1 mb = 1e-27 cm^2.
GEV_MINUS_2_TO_CM2 = 3.894e-28

# A stored beam is filled over repeated injection cycles. Five is deliberately
# conservative: it turns a healthy 40-60 mA injector into a 200-300 mA ring,
# while the machine-type specification caps the useful operating range at
# 500 mA. This is a game-timescale fill abstraction, not turn-by-turn tracking.
STORAGE_RING_ACCUMULATION_FACTOR = 5.0
STORAGE_RING_CURRENT_CAP_MA = 500.0


def stored_ring_current(injected_current_ma, ring_ready=True):
    """Stored current after a conservative multi-cycle fill, in mA."""
    if not ring_ready or injected_current_ma is None or injected_current_ma <= 0:
        return 0.0
    return min(STORAGE_RING_CURRENT_CAP_MA,
               injected_current_ma * STORAGE_RING_ACCUMULATION_FACTOR)


def black_hole_yield(beam_energy_gev, luminosity_cm2_s,
                     planck_scale_gev=PLANCK_SCALE_GEV,
                     extra_dimensions=EXTRA_DIMENSIONS):
    """Black holes produced per second: sigma(E) x L.

    `beam_energy_gev` is the KINETIC energy of one beam; both beams are assumed
    equal and head-on, so sqrt(s) = 2 E. Returns 0 below threshold, where the
    centre-of-mass energy does not exceed the fundamental scale and the
    semiclassical estimate does not apply at all.
    """
    import math
    if luminosity_cm2_s <= 0 or beam_energy_gev <= 0:
        return 0.0
    sqrt_s = 2.0 * beam_energy_gev
    if sqrt_s <= planck_scale_gev:
        return 0.0
    r_s = (sqrt_s / planck_scale_gev) ** (1.0 / (extra_dimensions + 1.0))
    r_s /= planck_scale_gev                       # GeV^-1
    sigma_cm2 = math.pi * r_s * r_s * GEV_MINUS_2_TO_CM2
    return sigma_cm2 * luminosity_cm2_s


def beamline_config_from_game(game_beamline):
    """
    Convert game beamline format to physics element list.

    game_beamline: list of dicts, each with at minimum:
        {"type": "quadrupole", "physicsType": "quadrupole", ...}
    May also include stats from the COMPONENTS template:
        {"type": "quadrupole", "stats": {"focusStrength": 1}, "length": 2}

    The physics identity is declared in the data (physicsType, from
    beamline-components.raw.js); this function only validates it and maps
    game stats/params onto physics parameters.
    """
    elements = []
    quad_index = 0

    for comp in game_beamline:
        ctype = comp["type"]

        physics_type = comp.get("physicsType")
        if physics_type is None:
            raise ValueError(
                f"component '{ctype}' has no physicsType — every beamline "
                f"component must declare physicsType in "
                f"beamline-components.raw.js"
            )
        if physics_type not in KNOWN_PHYSICS_TYPES:
            raise ValueError(
                f"component '{ctype}' declares unknown physicsType "
                f"'{physics_type}' — known types: "
                f"{sorted(KNOWN_PHYSICS_TYPES)}"
            )

        defaults = COMPONENT_DEFAULTS.get(ctype, {})
        stats = comp.get("stats", {})

        el = {"type": physics_type}
        el["game_type"] = ctype  # preserve original type for diagnostics
        beta_acceptance = comp.get("betaAcceptance")
        if beta_acceptance is not None:
            el["betaAcceptance"] = dict(beta_acceptance)
        # Physical half-aperture, metres. Declared per component in mm; a single
        # global DEFAULT_APERTURE of 50 mm used to apply to everything, which
        # was uniformly generous and most generous exactly where real machines
        # are tightest — an RFQ bore is 3-5 mm, an undulator half-gap 3-5, a
        # TESLA iris 35. That inverted a real design pressure: the front end,
        # where aperture is genuinely fought for, was the most forgiving part of
        # the machine.
        ap_mm = comp.get("apertureRadius")
        if ap_mm is not None and ap_mm > 0:
            el["aperture"] = ap_mm * 1e-3
        # Placeable id, when the caller supplied one. Lets per-cavity results
        # (achieved gradient, wall dissipation) be written back onto the
        # placeable, which is where the JS cryogenic solver reads them to
        # compute next tick's heat load.
        if comp.get("id") is not None:
            el["game_id"] = comp["id"]
        # subL sub-units × 0.5m per sub-unit — every component must declare subL
        sub_l = comp.get("subL", None)
        if sub_l is None:
            raise ValueError(
                f"component '{ctype}' has no subL — every beamline component must "
                f"declare subL in beamline-components.raw.js"
            )
        el["length"] = sub_l * 0.5

        # Endpoint data production is a catalogue capability, not a physics
        # type. Several purpose-built endpoints are thin drifts or targets but
        # still carry digitizers; preserve their declared rate for lattice.py.
        if stats.get("dataRate", 0) > 0:
            el["dataRate"] = stats["dataRate"]

        if physics_type == "source":
            # Read emittance from computed stats if available, else use defaults per gun type
            default_emit = {"dcPhotoGun": 1e-6, "ncRfGun": 0.5e-6, "srfGun": 0.3e-6}
            # component-physics.js computes emittance in mm·mrad; convert to m·rad
            raw_emit = stats.get("emittance", None)
            if raw_emit is not None and raw_emit > 0:
                el["emittance"] = raw_emit * 1e-6  # mm·mrad → m·rad
            else:
                el["emittance"] = default_emit.get(ctype, 1e-6)
            # Extraction energy from component definition (GeV)
            if "extractionEnergy" in comp:
                el["extractionEnergy"] = comp["extractionEnergy"]
            # Particle species from component params (ion sources declare
            # particleType: 'proton'); used to pick the beam rest mass.
            particle = comp.get("params", {}).get("particleType")
            if particle is not None:
                el["particleType"] = particle

        elif physics_type == "quadrupole":
            raw_k = stats.get("focusStrength",
                              defaults.get("focusStrength", 1.0))
            el["focusStrength"] = raw_k * QUAD_K_SCALE
            # Player-controlled polarity; fall back to auto-alternation
            # JS param: 0 = Focus X (+1), 1 = Focus Y (-1)
            params = comp.get("params", {})
            polarity = params.get("polarity",
                        comp.get("polarity", stats.get("polarity", None)))
            if polarity is not None:
                el["polarity"] = -1 if polarity == 1 else 1
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
            # A -90 degree buncher has zero mean energy gain but non-zero RF
            # voltage. Preserve the actual knob separately so the longitudinal
            # solver can create head-tail chirp and the player can tune it.
            if ctype == "buncher" and params.get("voltage") is not None:
                el["rfVoltage"] = params["voltage"] * 1e-3  # MV -> GeV
                el["energyGain"] = el["rfVoltage"]
            # The gradient the player is ASKING for, MV/m, ALWAYS back-derived
            # from the effective energy gain over this element's own physics
            # length.
            #
            # Deliberately NOT read from params/stats `gradient`, even though
            # some components carry one. Those two disagree: pillboxCavity
            # ships stats.energyGain 0.00035 GeV alongside stats.gradient 0.5
            # MV/m over a 1.0 m element, which are different machines. Deriving
            # from energyGain keeps ONE source of truth and makes the balance
            # guarantee exact — a cavity with ample RF and cold reproduces its
            # catalogue energy gain to the last digit, because achieved ==
            # demanded feeds straight back through the same conversion below.
            # Player sliders still reach this: component-physics.js computes
            # energyGain from voltage/gradient/phase before it gets here.
            cav_spec = srf.get_spec(ctype)
            if cav_spec is not None and el["length"] > 0:
                el["gradientDemanded"] = max(
                    0.0, el["energyGain"] * 1000.0 / el["length"])
            # rfFrequency: game stores MHz, physics needs Hz
            raw_freq = (params.get("rfFrequency", None)
                        or comp.get("rfFrequency", None)
                        or stats.get("rfFrequency", None))
            if raw_freq is not None:
                el["rfFrequency"] = float(raw_freq) * 1e6

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

        # === Infrastructure coupling ===
        #
        # Utilities used to collapse to four abstract 0-1 scalars multiplied
        # together onto energyGain. They now act through the quantities they
        # physically control: RF power and cryo temperature set the achievable
        # gradient (beam_physics/srf.py), cooling deficit detunes NC cavities,
        # and vacuum acts on the beam directly via the beam_gas module rather
        # than through an aperture proxy.
        #
        # ABSENT vs ZERO is load-bearing throughout. An absent field means the
        # solver produced no value for this node (unwired, pre-solve, or a test
        # fixture), and falls back to the legacy linear path so nothing
        # silently zeroes. A present 0 means the solver decided this node gets
        # nothing, and is honoured as starvation. Game.js stamps fail-closed
        # floors so a declared-but-unwired sink arrives as an explicit 0.
        infra_q = comp.get("infraQuality", {})
        power_q = infra_q.get("powerQuality", 1.0)
        rf_q = infra_q.get("rfQuality", 1.0)
        cooling_q = infra_q.get("coolingQuality", 1.0)
        cryo_q = infra_q.get("cryoQuality", 1.0)
        cryo_quenched = infra_q.get("cryoQuenched", False)
        rf_power_w = infra_q.get("rfPowerW")
        cryo_temp_k = infra_q.get("cryoTempK")
        cooling_dt = infra_q.get("coolingDeltaT")

        cav_spec = srf.get_spec(ctype)
        is_srf = cav_spec is not None and cav_spec["kind"] == "srf"

        # SRF quench: convert to drift (zero acceleration). Either cause counts
        # — the LHe reservoir emptying, or the cavity going over Tc thermally.
        #
        # Eligibility is `is_srf`, i.e. the component's own spec says kind
        # "srf". This used to be a hand-maintained SRF_TYPES_SET of ids sitting
        # next to the identical fact already derived one line above, and it
        # failed silently in the only way that matters: a new superconducting
        # component missing from the set kept accelerating through an empty
        # helium vessel, skipping the entire cryogenic mechanic, with no test
        # to notice. One source of truth (srf.CAVITY_SPECS) instead.
        thermally_quenched = (is_srf and cryo_temp_k is not None
                              and cryo_temp_k >= srf.T_CRITICAL)
        if (cryo_quenched or thermally_quenched) and is_srf:
            el["type"] = "drift"
            el.pop("energyGain", None)
            el.pop("focusStrength", None)
            el["quenched"] = True
            elements.append(el)
            continue

        # --- Achievable gradient ---
        # Modelled cavities get their energy gain from the power and cold they
        # are actually supplied with. Everything else keeps the legacy derate.
        modelled = (cav_spec is not None and "gradientDemanded" in el
                    and rf_power_w is not None)
        if modelled:
            n_cav = cav_spec["n_cav"]

            # NC cavities that lose cooling detune off resonance and reflect
            # power rather than absorbing it. SRF cavities have no separate
            # water loop — their thermal path is the cryo model below.
            coupling = 1.0
            if not is_srf:
                coupling = srf.detune_coupling(cooling_dt, cav_spec)
            el["reflectedFraction"] = 1.0 - coupling

            power_per_cavity = (rf_power_w * coupling) / n_cav if n_cav else 0.0
            achievable = srf.e_acc_max(power_per_cavity, cav_spec, cryo_temp_k)
            achieved = min(el["gradientDemanded"], achievable)

            el["gradientAchievable"] = achievable
            el["gradientAchieved"] = achieved
            el["cavityQ0"] = srf.q0(cryo_temp_k if cryo_temp_k is not None else 2.0,
                                    cav_spec)
            # Heat the cryoplant has to remove next tick — the term that closes
            # the thermal feedback loop. Dissipation is per cavity over the
            # cavity's own active length, which is real hardware geometry, not
            # the element's grid footprint.
            el["pDissW"] = srf.p_diss(achieved, cav_spec, cryo_temp_k) * n_cav
            # Same length used to derive the demand, so achieved == demanded
            # returns the catalogue energy gain exactly.
            el["energyGain"] = achieved * el["length"] / 1000.0
        else:
            # Legacy linear derate, retained for unmodelled cavities and for
            # any node the utility solver has not produced power data for.
            if "energyGain" in el:
                el["energyGain"] *= power_q * rf_q * cooling_q * cryo_q

        # Derate focus strength: power only. Magnet field goes as coil current,
        # which goes as supply power, so linear is already correct here.
        if "focusStrength" in el:
            el["focusStrength"] *= power_q

        # Cooling degradation: emittance growth factor (stored for potential use)
        if cooling_q < 1.0:
            el["coolingDegradation"] = 1.0 + 0.1 * (1.0 - cooling_q)

        # Residual gas pressure in mbar, consumed by the beam_gas module. This
        # replaced an `aperture *= (0.5 + 0.5 * vacuumQuality)` proxy that could
        # never reach the quantity it was meant to affect: aperture_loss only
        # scales beam.current, while beam_quality is an emittance ratio. Poor
        # vacuum now grows emittance and scatters beam out directly.
        pressure = infra_q.get("vacuumPressure")
        if pressure is not None:
            el["pressure"] = pressure
            # Ideal-gas number density at the room-temperature beam pipe.
            # beam_gas consumes molecules/m³ directly; pressure remains on the
            # element for diagnostics and backwards-compatible reports.
            el["gas_density"] = pressure * 100.0 / (1.380649e-23 * 300.0)

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
    machine_config = get_machine_config(effects.get("machineType"))

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
    # Interaction rate driving data collection.
    #
    # This used to be sqrt(luminosity), and luminosity is produced by exactly
    # one module (beam_beam) which only runs on colliders — a machine type the
    # game could never set. So dataRate was identically zero for every beamline
    # ever built, research income was zero, and the tech tree was unreachable.
    # It went unnoticed because the headless fallback computes data separately,
    # which is what every balance sim measured.
    #
    # event_rate counts what the endpoints actually record and scales with the
    # beam current reaching them. sqrt() keeps the original dynamic-range
    # compression.
    event_rate = summary.get("event_rate", 0.0)
    compressed_lumi = math.sqrt(max(event_rate, 0))
    # Kinetic energy (total minus rest mass) is the game-facing figure: for
    # protons the 0.938 GeV rest mass would otherwise inflate every energy
    # readout, objective check, and data-rate factor.
    beam_mass = summary.get("mass", 0.0)
    kinetic_energy = summary.get(
        "final_kinetic_energy", summary["final_energy"] - beam_mass)
    energy_factor = math.log(1.0 + max(kinetic_energy, 0.0) / 0.1)

    # Count focusing elements for beam control factor
    n_focusing = summary.get("n_focusing", 0)
    control_factor = 0.05 + min(0.95, n_focusing * 0.3)

    # DATA_RATE_SCALE is calibrated so a general-purpose detector (dataRate 1)
    # on a healthy ~20 mA, 0.5 GeV beam with a focused lattice yields ~1 data/s
    # — matching what Game._fallbackStatsForBeamline produces for the same
    # machine. The two paths MUST agree: the fallback runs headless (tests,
    # balance sims, the agent env) while real physics runs in the browser, and
    # a facility that earns differently in each is a balance trap. The old
    # 0.001 was tuned against sqrt(luminosity) ~ 1e16 and is meaningless here.
    DATA_RATE_SCALE = 0.2
    data_rate = (compressed_lumi * quality * current_frac
                 * energy_factor * control_factor
                 * lumi_mult * data_mult * DATA_RATE_SCALE)
    # Minimum viable data rate if there's a detector and beam is alive
    if data_rate > 0 and data_rate < 0.1:
        data_rate = 0.1

    # A ring accumulates several injector shots before serving users. Demand
    # both halves of real ring injection; merely choosing the machine type does
    # not multiply a straight linac's current.
    game_types = {el.get("game_type", el.get("type")) for el in elements}
    ring_ready = {"injectionSeptum", "fastKicker"} <= game_types
    injected_ring_current = summary.get("ring_injection_current")
    stored_current = stored_ring_current(injected_ring_current, ring_ready)
    is_storage_ring = machine_config["success_metric"] == "photon_flux"
    current_scale = 1.0
    if is_storage_ring and stored_current > 0 and injected_ring_current > 0:
        current_scale = stored_current / injected_ring_current

    # Incoherent bend/undulator flux scales with the number of stored
    # electrons, beam quality, and photon-science research.
    photon_survival = 1.0 if is_storage_ring else current_frac
    photon_rate_val = (summary["photon_rate"] * current_scale
                       * quality * photon_survival * photon_flux_mult)

    # Keep the public loss number on the same current basis as beamCurrent. For
    # a storage ring that is injector capture; the raw one-pass loss through
    # the simplified ring branch remains available separately for diagnostics.
    reported_loss = raw_loss
    if (is_storage_ring and stored_current > 0
            and summary.get("initial_current", 0) > 0):
        reported_loss = 1.0 - min(
            1.0, injected_ring_current / summary["initial_current"])

    # Collision rate from targets: scales with current and beam quality
    collision_rate = summary["collision_rate"] * current_frac * quality * lumi_mult

    # Discovery chance scales with luminosity, energy, and beam quality squared
    discovery_base = effects.get("discoveryChance", 0.0)
    if kinetic_energy > 10.0 and raw_luminosity > 0:
        discovery_chance = discovery_base * kinetic_energy * 0.01 * quality * quality
    else:
        discovery_chance = 0.0

    # Count diagnostics from original element config (game_type preserved there)
    n_diagnostics = sum(1 for el in elements
                        if el.get("game_type", el["type"]) in DIAGNOSTIC_TYPES)

    result = {
        # Core beam state (energies are kinetic, GeV)
        "beamEnergy": max(kinetic_energy, 0.0),
        "beamAlive": summary["alive"],
        "beamCurrent": (stored_current if is_storage_ring and stored_current > 0
                        else summary["final_current"]),

        # Resource generation rates (per game tick)
        "dataRate": data_rate,
        "collisionRate": collision_rate,
        "photonRate": photon_rate_val,

        # Quality metrics
        "beamQuality": quality,
        "totalLossFraction": reported_loss,
        "singlePassLossFraction": summary["total_loss_fraction"],
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
                "energy": max(s["energy"] - beam_mass, 0.0),
                # Kinetic energy [GeV] times average current [mA] is beam
                # power [MW]. Publish it with the envelope so presentation
                # layers never grow a second definition of this beam metric.
                "beam_power_mw": (max(s["energy"] - beam_mass, 0.0)
                                  * max(s["current"], 0.0)),
                "rel_beta": s["rel_beta"],
                "rel_gamma": s["rel_gamma"],
                "momentum_gev_c": s["momentum_gev_c"],
                "rigidity_t_m": s["rigidity_t_m"],
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
                # Dispersion and bunch properties
                "eta_x": s.get("eta_x", 0),
                "eta_xp": s.get("eta_xp", 0),
                "phase_advance_x": s.get("phase_advance_x", 0),
                "phase_advance_y": s.get("phase_advance_y", 0),
                "peak_current": s.get("peak_current", 0),
                # Keep the designer's longitudinal advisor on the exact beam
                # state the RF module propagated. Zero means DC/unbunched;
                # the first RF element replaces it with its bucket frequency.
                "bunch_frequency": s.get("bunch_frequency", 0),
                "focus_margin": s.get("focus_margin", 1.0),
                "focus_urgency": s.get("focus_urgency", 0.0),
                # RF velocity match. Null outside accelerating structures;
                # rel_beta remains available everywhere along the line.
                "rel_beta_input": s.get("rel_beta_input"),
                "beta_acceptance_min": s.get("beta_acceptance_min"),
                "beta_acceptance_design": s.get("beta_acceptance_design"),
                "beta_synchronous": s.get("beta_synchronous"),
                "beta_acceptance_max": s.get("beta_acceptance_max"),
                "beta_accepted": s.get("beta_accepted"),
                "beta_ttf": s.get("beta_ttf"),
                # Per-RF-step commissioning evidence. These are solver values,
                # not UI derivations: the Designer and Probe may format them,
                # but must not independently recompute capture or chirp.
                "rf_capture_efficiency": s.get("rf_capture_efficiency"),
                "rf_captured_dc": s.get("rf_captured_dc"),
                "rf_current_before": s.get("rf_current_before"),
                "rf_current_after": s.get("rf_current_after"),
                "rf_bunch_frequency_before": s.get("rf_bunch_frequency_before"),
                "rf_bunch_frequency_after": s.get("rf_bunch_frequency_after"),
                "rf_bunch_length_before": s.get("rf_bunch_length_before"),
                "rf_bunch_length_after": s.get("rf_bunch_length_after"),
                "rf_peak_current_before": s.get("rf_peak_current_before"),
                "rf_peak_current_after": s.get("rf_peak_current_after"),
                "rf_time_chirp_added": s.get("rf_time_chirp_added"),
                "rf_energy_gain": s.get("rf_energy_gain"),
                "rf_phase_deg": s.get("rf_phase_deg"),
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

        # Dispersion warnings
        "maxDispersion": summary.get("max_dispersion", 0),
        "dispersionWarnings": summary.get("dispersion_warnings", []),
    }

    # Per-cavity results, keyed by placeable id. The JS cryogenic solver reads
    # `pDissW` back off the placeable to compute next tick's heat load — that
    # one-tick lag is what breaks the circular dependency between temperature
    # and gradient (heat depends on gradient, gradient depends on temperature).
    # Explicit-Euler coupling, and it makes thermal runaway something the
    # player watches happen rather than something that snaps.
    cavities = []
    for el in elements:
        if "gradientAchieved" not in el and not el.get("quenched"):
            continue
        cavities.append({
            "id": el.get("game_id"),
            "gameType": el.get("game_type"),
            "gradientDemanded": el.get("gradientDemanded", 0.0),
            "gradientAchieved": el.get("gradientAchieved", 0.0),
            "gradientAchievable": el.get("gradientAchievable", 0.0),
            "pDissW": el.get("pDissW", 0.0),
            "q0": el.get("cavityQ0", 0.0),
            "reflectedFraction": el.get("reflectedFraction", 0.0),
            "quenched": bool(el.get("quenched", False)),
        })
    result["cavities"] = cavities

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

    # The type's own figure of merit, when the type has one this file can
    # compute. Keyed off `success_metric` rather than off the machine type
    # string, for the same reason machines.py uses capability sets instead of
    # type literals: a renamed or added type that is paid on black_hole_yield
    # gets the number automatically, and one that is not can never
    # accidentally inherit it. Deliberately AFTER the beam-beam block — the
    # luminosity this reads is the one that module just reported.
    machine_type = effects.get("machineType")
    if machine_config["success_metric"] == "black_hole_yield":
        result["blackHoleYield"] = black_hole_yield(
            max(kinetic_energy, 0.0), result.get("luminosity", 0.0))

    return result


def extract_source_params(elements, game_beamline):
    """
    Extract beam-initialization parameters from the first source element so
    that gun-tuning sliders (emittance, current) and the particle species
    feed into beam initialization. Returns None when the beamline has no
    source element.
    """
    for idx, el in enumerate(elements):
        if el.get("type") != "source":
            continue
        source_params = {}
        if "emittance" in el:
            source_params["eps_norm_x"] = el["emittance"]
            source_params["eps_norm_y"] = el["emittance"]
        # Extraction energy from the source component (GeV)
        if "extractionEnergy" in el:
            source_params["energy"] = el["extractionEnergy"]
        # Set mass for proton sources. Species comes from the component's
        # params.particleType (carried through beamline_config_from_game);
        # game_type is kept as a fallback for hand-built configs.
        game_type = el.get("game_type", "")
        if (el.get("particleType") == "proton"
                or game_type in ("ionSource", "ecrIonSource")):
            from beam_physics.constants import PROTON_MASS
            source_params["mass"] = PROTON_MASS
        # Find corresponding game component for beamCurrent
        if idx < len(game_beamline):
            bc = game_beamline[idx].get("stats", {}).get("beamCurrent", None)
            if bc is not None and bc > 0:
                source_params["current"] = bc
        return source_params
    return None


def compute_beam_for_game(game_beamline_json, research_effects_json=None):
    """
    Top-level entry point called from Pyodide.

    Accepts JSON strings, returns a JSON string.
    """
    game_beamline = json.loads(game_beamline_json)
    research_effects = json.loads(research_effects_json) if research_effects_json else {}

    elements = beamline_config_from_game(game_beamline)
    machine_type = research_effects.get("machineType", "linac") if research_effects else "linac"

    source_params = extract_source_params(elements, game_beamline)

    # Vacuum research used to WIDEN the aperture here — a leftover from the
    # model where vacuum reached the beam by narrowing it. Better vacuum does
    # not make a beam pipe physically bigger. Vacuum now acts on the beam
    # properly, through gas scattering in beam_gas.py, and the aperture is
    # fixed hardware declared per component.

    physics_result = propagate(elements, machine_type=machine_type,
                               source_params=source_params)
    game_result = physics_to_game(physics_result, research_effects, elements)

    return json.dumps(game_result)
