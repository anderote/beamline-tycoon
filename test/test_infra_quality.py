"""Test infrastructure quality multipliers in physics pipeline."""
from beam_physics.gameplay import beamline_config_from_game

def test_quality_derates_rf_gradient():
    """RF cavity with power=0.9, rf=0.85, cooling=1.0 → 76.5% gradient."""
    game_beamline = [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "rfCavity", "physicsType": "rfCavity", "subL": 6, "stats": {"energyGain": 1.0},
         "infraQuality": {"powerQuality": 0.9, "rfQuality": 0.85, "coolingQuality": 1.0}},
    ]
    elements = beamline_config_from_game(game_beamline)
    rf_el = [e for e in elements if e["type"] == "rfCavity"][0]
    expected = 1.0 * 0.9 * 0.85 * 1.0  # 0.765
    assert abs(rf_el["energyGain"] - expected) < 0.01, f"Expected ~{expected}, got {rf_el['energyGain']}"

def test_quality_derates_quad_strength():
    """Quad with power=0.8 → 80% focus strength."""
    game_beamline = [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "quadrupole", "physicsType": "quadrupole", "subL": 2, "stats": {"focusStrength": 1.0},
         "infraQuality": {"powerQuality": 0.8}},
    ]
    elements = beamline_config_from_game(game_beamline)
    quad_el = [e for e in elements if e["type"] == "quadrupole"][0]
    # focusStrength = 1.0 * QUAD_K_SCALE(0.3) * powerQuality(0.8) = 0.24
    expected = 1.0 * 0.3 * 0.8
    assert abs(quad_el["focusStrength"] - expected) < 0.01, f"Expected ~{expected}, got {quad_el['focusStrength']}"

def test_cryo_quench_converts_to_drift():
    """SRF cryomodule with cryoQuenched=true → drift."""
    game_beamline = [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "cryomodule", "physicsType": "cryomodule", "subL": 16, "stats": {"energyGain": 2.0},
         "infraQuality": {"cryoQuenched": True}},
    ]
    elements = beamline_config_from_game(game_beamline)
    cryo_el = elements[1]
    assert cryo_el["type"] == "drift", f"Quenched SRF should be drift, got {cryo_el['type']}"
    assert "energyGain" not in cryo_el, "Quenched drift should not have energyGain"

def test_no_quality_means_full_performance():
    """Components without infraQuality run at full."""
    game_beamline = [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "rfCavity", "physicsType": "rfCavity", "subL": 6, "stats": {"energyGain": 1.0}},
    ]
    elements = beamline_config_from_game(game_beamline)
    rf_el = [e for e in elements if e["type"] == "rfCavity"][0]
    assert abs(rf_el["energyGain"] - 1.0) < 0.01, f"No quality = full, got {rf_el['energyGain']}"

def _cryomodule(infra, gradient=25.0):
    """A cryomodule demanding `gradient` MV/m.

    The demand is expressed as catalogue energy gain, because that is the only
    thing the model reads — a 16-sub-unit module is 8 m long, so the energy
    gain and the gradient are the same statement in different units. There is
    deliberately no `gradient` param: it would be a second source of truth that
    could disagree with energyGain, and did.
    """
    return [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "cryomodule", "physicsType": "cryomodule", "subL": 16,
         "stats": {"energyGain": gradient * 8.0 / 1000.0},
         "infraQuality": infra},
    ]

def test_cold_cavity_with_ample_rf_meets_demand():
    """2 K and generous power: the player gets the gradient they asked for,
    and the cavity delivers its catalogue energy gain EXACTLY.

    That exactness is the balance guarantee. A correctly provisioned facility
    earns what it earned before this model existed; only under-provisioned
    ones lose ground.
    """
    els = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 2.0, "rfPowerW": 8000.0}, gradient=15.0))
    cav = els[1]
    assert abs(cav["gradientAchieved"] - 15.0) < 1e-9, cav["gradientAchieved"]
    assert abs(cav["energyGain"] - 15.0 * 8.0 / 1000.0) < 1e-12, cav["energyGain"]

def test_warm_cavity_cannot_reach_demand():
    """Same cavity, same RF, cryo let go to 4.5 K: gradient collapses. This is
    the headline consequence of the whole model."""
    cold = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 2.0, "rfPowerW": 400.0}, gradient=25.0))[1]
    warm = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 4.5, "rfPowerW": 400.0}, gradient=25.0))[1]
    assert warm["gradientAchieved"] < cold["gradientAchieved"] / 4, \
        f"cold {cold['gradientAchieved']}, warm {warm['gradientAchieved']}"
    assert warm["energyGain"] < cold["energyGain"]

def test_gradient_is_capped_by_demand_not_exceeded():
    """Over-provisioning does not overshoot what the operator asked for."""
    cav = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 1.8, "rfPowerW": 1e6}, gradient=10.0))[1]
    assert abs(cav["gradientAchieved"] - 10.0) < 1e-9

def test_starved_rf_yields_no_gradient():
    """A solved zero is starvation and is honoured as such."""
    cav = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 2.0, "rfPowerW": 0.0}, gradient=25.0))[1]
    assert cav["gradientAchieved"] == 0.0
    assert cav["energyGain"] == 0.0

def test_absent_rf_power_falls_back_to_legacy_derate():
    """Absent != zero. With no solver data the old linear path runs, so
    existing beamlines and fixtures do not silently drop to nothing."""
    cav = beamline_config_from_game(_cryomodule({"cryoQuality": 0.5}))[1]
    assert "gradientAchieved" not in cav
    # Catalogue 0.2 GeV (25 MV/m x 8 m), halved by the old linear cryo derate.
    assert abs(cav["energyGain"] - 0.1) < 1e-12, cav["energyGain"]

def test_gradient_stat_is_ignored_in_favour_of_energy_gain():
    """A `gradient` in stats must NOT override the catalogue energy gain.

    pillboxCavity ships stats.energyGain 0.00035 GeV next to stats.gradient
    0.5 MV/m over a 1.0 m element — 0.35 vs 0.5 MV/m, two different machines.
    Reading the gradient stat made a well-provisioned cavity deliver 71% of its
    catalogue energy, silently rebalancing the game. energyGain is the single
    source of truth.
    """
    els = beamline_config_from_game([
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "pillboxCavity", "physicsType": "rfCavity", "subL": 2,
         "stats": {"energyGain": 0.00035, "gradient": 0.5},
         "infraQuality": {"rfPowerW": 1e6}},
    ])
    cav = els[1]
    # 0.00035 GeV over a 1.0 m element is 0.35 MV/m, not the 0.5 in stats.
    assert abs(cav["gradientDemanded"] - 0.35) < 1e-9, cav["gradientDemanded"]
    assert abs(cav["energyGain"] - 0.00035) < 1e-12, cav["energyGain"]

def test_thermal_quench_converts_to_drift():
    """Over Tc is a quench even with the LHe reservoir full."""
    cav = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 9.5, "rfPowerW": 4000.0}))[1]
    assert cav["type"] == "drift"
    assert cav.get("quenched") is True
    assert "energyGain" not in cav

def test_dissipation_is_reported_for_the_thermal_loop():
    """pDissW is what the cryo solver bills against plant capacity next tick."""
    cav = beamline_config_from_game(_cryomodule(
        {"cryoTempK": 2.0, "rfPowerW": 400.0}, gradient=15.0))[1]
    assert cav["pDissW"] > 0
    # Eight cavities, so the module load is well above a single cavity's.
    assert cav["pDissW"] > 8 * 10

def test_nc_cavity_gradient_is_rf_power_limited():
    """No cryo involved: an NC structure scales as sqrt(P)."""
    def grad(p):
        els = beamline_config_from_game([
            {"type": "source", "physicsType": "source", "subL": 4,
             "stats": {"beamCurrent": 1.0}},
            {"type": "sbandStructure", "physicsType": "rfCavity", "subL": 6,
             "stats": {"energyGain": 0.6}, "params": {"gradient": 100.0},
             "infraQuality": {"rfPowerW": p}},
        ])
        return els[1]["gradientAchieved"]
    assert abs(grad(40e6) - 2 * grad(10e6)) < 1e-6

def test_undercooled_nc_cavity_detunes_and_reflects():
    """Losing water on an NC structure costs gradient AND shows up as
    reflected power, which is what the VSWR readout reports."""
    def cav(dt):
        return beamline_config_from_game([
            {"type": "source", "physicsType": "source", "subL": 4,
             "stats": {"beamCurrent": 1.0}},
            {"type": "sbandStructure", "physicsType": "rfCavity", "subL": 6,
             "stats": {"energyGain": 0.6}, "params": {"gradient": 100.0},
             "infraQuality": {"rfPowerW": 30e6, "coolingDeltaT": dt}},
        ])[1]
    cooled, hot = cav(0.0), cav(20.0)
    assert hot["gradientAchieved"] < cooled["gradientAchieved"]
    assert hot["reflectedFraction"] > 0.5
    assert cooled["reflectedFraction"] < 1e-9

def test_vacuum_pressure_is_stamped_onto_elements():
    """Residual gas pressure reaches the element, for the beam_gas module.

    This replaced an `aperture *= (0.5 + 0.5 * vacuumQuality)` proxy. The proxy
    could not do the job it was written for: it fed aperture_loss, which only
    scales beam.current, while beam_quality is an emittance ratio — so there
    was no path at all from vacuum to beam quality. Pressure now goes to the
    beam directly.
    """
    game_beamline = [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "drift", "physicsType": "drift", "subL": 4, "stats": {},
         "infraQuality": {"vacuumPressure": 1e-6}},
    ]
    elements = beamline_config_from_game(game_beamline)
    drift_el = elements[1]
    assert drift_el.get("pressure") == 1e-6, \
        f"Expected pressure 1e-6, got {drift_el.get('pressure', 'missing')}"

def test_absent_vacuum_pressure_leaves_element_clean():
    """Absent means "no solver data", not "perfect vacuum" — the element simply
    carries no pressure and beam_gas skips it."""
    game_beamline = [
        {"type": "source", "physicsType": "source", "subL": 4, "stats": {"beamCurrent": 1.0}},
        {"type": "drift", "physicsType": "drift", "subL": 4, "stats": {}},
    ]
    elements = beamline_config_from_game(game_beamline)
    assert "pressure" not in elements[1]

if __name__ == "__main__":
    test_quality_derates_rf_gradient()
    print("  PASS: test_quality_derates_rf_gradient")
    test_quality_derates_quad_strength()
    print("  PASS: test_quality_derates_quad_strength")
    test_cryo_quench_converts_to_drift()
    print("  PASS: test_cryo_quench_converts_to_drift")
    test_no_quality_means_full_performance()
    print("  PASS: test_no_quality_means_full_performance")
    test_vacuum_pressure_is_stamped_onto_elements()
    print("  PASS: test_vacuum_pressure_is_stamped_onto_elements")
    test_absent_vacuum_pressure_leaves_element_clean()
    print("  PASS: test_absent_vacuum_pressure_leaves_element_clean")
    print("\nAll infrastructure quality tests passed!")
