"""Test infrastructure quality multipliers in physics pipeline."""
from beam_physics.gameplay import beamline_config_from_game

def test_quality_derates_rf_gradient():
    """RF cavity with power=0.9, rf=0.85, cooling=1.0 → 76.5% gradient."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "rfCavity", "stats": {"energyGain": 1.0},
         "infraQuality": {"powerQuality": 0.9, "rfQuality": 0.85, "coolingQuality": 1.0}},
    ]
    elements = beamline_config_from_game(game_beamline)
    rf_el = [e for e in elements if e["type"] == "rfCavity"][0]
    expected = 1.0 * 0.9 * 0.85 * 1.0  # 0.765
    assert abs(rf_el["energyGain"] - expected) < 0.01, f"Expected ~{expected}, got {rf_el['energyGain']}"

def test_quality_derates_quad_strength():
    """Quad with power=0.8 → 80% focus strength."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "quadrupole", "stats": {"focusStrength": 1.0},
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
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "cryomodule", "stats": {"energyGain": 2.0},
         "infraQuality": {"cryoQuenched": True}},
    ]
    elements = beamline_config_from_game(game_beamline)
    cryo_el = elements[1]
    assert cryo_el["type"] == "drift", f"Quenched SRF should be drift, got {cryo_el['type']}"
    assert "energyGain" not in cryo_el, "Quenched drift should not have energyGain"

def test_no_quality_means_full_performance():
    """Components without infraQuality run at full."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "rfCavity", "stats": {"energyGain": 1.0}},
    ]
    elements = beamline_config_from_game(game_beamline)
    rf_el = [e for e in elements if e["type"] == "rfCavity"][0]
    assert abs(rf_el["energyGain"] - 1.0) < 0.01, f"No quality = full, got {rf_el['energyGain']}"

if __name__ == "__main__":
    test_quality_derates_rf_gradient()
    print("  PASS: test_quality_derates_rf_gradient")
    test_quality_derates_quad_strength()
    print("  PASS: test_quality_derates_quad_strength")
    test_cryo_quench_converts_to_drift()
    print("  PASS: test_cryo_quench_converts_to_drift")
    test_no_quality_means_full_performance()
    print("  PASS: test_no_quality_means_full_performance")
    print("\nAll infrastructure quality tests passed!")
