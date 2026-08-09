"""
Proton-source path: ionSource / ecrIonSource declare physicsType 'source'
and params.particleType 'proton', so the beam must initialize with the
proton rest mass and propagate sanely through a simple lattice.

Guards the end-to-end chain:
  beamline-components.raw.js (physicsType: 'source', params.particleType)
  -> gameplay.beamline_config_from_game (carries particleType onto the element)
  -> gameplay.extract_source_params (picks PROTON_MASS)
  -> lattice.propagate / beam.create_initial_beam (mass reaches BeamState)
"""

import json
import math

import pytest

from beam_physics.gameplay import (
    beamline_config_from_game,
    extract_source_params,
    compute_beam_for_game,
)
from beam_physics.constants import PROTON_MASS, ELECTRON_MASS
from beam_physics.beam import create_initial_beam
from beam_physics.lattice import propagate
from beam_physics.constants import DEFAULT_SOURCE


def _proton_beamline(source_type="ionSource"):
    """Minimal game beamline mirroring the raw component declarations."""
    return [
        {
            "type": source_type,
            "physicsType": "source",
            "subL": 4,
            "stats": {"beamCurrent": 50},
            "params": {"particleType": "proton", "extractionVoltage": 40},
        },
        {"type": "drift", "physicsType": "drift", "subL": 4, "stats": {}},
        {
            "type": "quadrupole",
            "physicsType": "quadrupole",
            "subL": 2,
            "stats": {"focusStrength": 1},
        },
        {"type": "beamStop", "physicsType": "beamStop", "subL": 4, "stats": {}},
    ]


def test_ion_source_element_is_source_with_particle_type():
    elements = beamline_config_from_game(_proton_beamline("ionSource"))
    src = elements[0]
    assert src["type"] == "source"
    assert src["game_type"] == "ionSource"
    assert src["particleType"] == "proton"


@pytest.mark.parametrize("source_type", ["ionSource", "ecrIonSource"])
def test_proton_source_params_use_proton_mass(source_type):
    game_beamline = _proton_beamline(source_type)
    elements = beamline_config_from_game(game_beamline)
    sp = extract_source_params(elements, game_beamline)
    assert sp is not None
    assert sp["mass"] == PROTON_MASS
    assert sp["current"] == 50


def test_electron_source_keeps_electron_mass():
    game_beamline = [
        {
            "type": "source",
            "physicsType": "source",
            "subL": 4,
            "stats": {"beamCurrent": 100},
            "params": {"extractionVoltage": 50},
        },
        {"type": "drift", "physicsType": "drift", "subL": 4, "stats": {}},
    ]
    elements = beamline_config_from_game(game_beamline)
    sp = extract_source_params(elements, game_beamline)
    assert sp is not None
    assert "mass" not in sp  # falls through to DEFAULT_SOURCE electron mass
    params = dict(DEFAULT_SOURCE)
    params.update(sp)
    beam = create_initial_beam(params)
    assert beam.mass == ELECTRON_MASS


def test_proton_beam_state_carries_proton_mass():
    game_beamline = _proton_beamline("ionSource")
    elements = beamline_config_from_game(game_beamline)
    sp = extract_source_params(elements, game_beamline)
    params = dict(DEFAULT_SOURCE)
    params.update(sp)
    beam = create_initial_beam(params)
    assert beam.mass == PROTON_MASS
    assert beam.current == 50


@pytest.mark.parametrize("source_type", ["ionSource", "ecrIonSource"])
def test_proton_beam_propagates_sanely(source_type):
    """End-to-end through the Pyodide entry point: alive beam, finite values."""
    result = json.loads(compute_beam_for_game(json.dumps(_proton_beamline(source_type))))
    assert result["beamAlive"] is True
    assert math.isfinite(result["beamEnergy"])
    assert result["beamEnergy"] >= 0
    assert math.isfinite(result["beamCurrent"])
    assert result["beamCurrent"] > 0
    assert 0.0 <= result["totalLossFraction"] <= 1.0
    # Envelope must be finite everywhere (no NaN blowup from the proton mass).
    assert len(result["envelope"]) > 0
    for snap in result["envelope"]:
        assert math.isfinite(snap["sigma_x"]), snap
        assert math.isfinite(snap["sigma_y"]), snap
        assert snap["sigma_x"] > 0
        assert snap["sigma_y"] > 0


def test_proton_beam_energy_not_pinned_to_rest_mass():
    """
    Regression: source energy used to be fed to the engine as TOTAL energy,
    so a proton beam entered its first RF element with gamma clamped to 1 and
    rf_acceleration's rest-mass floor pinned it to exactly PROTON_MASS
    (0.938 GeV) — auto-completing the 100 MeV objective for a keV-scale
    beamline. Source energy is now kinetic and beamEnergy reports kinetic.
    """
    beamline = [
        {
            "type": "ionSource",
            "physicsType": "source",
            "subL": 4,
            "stats": {"beamCurrent": 50},
            "params": {"particleType": "proton", "extractionVoltage": 40},
        },
        {
            "type": "buncher",
            "physicsType": "rfCavity",
            "subL": 4,
            "stats": {"energyGain": 0.0001},
        },
        {"type": "beamStop", "physicsType": "beamStop", "subL": 4, "stats": {}},
    ]
    result = json.loads(compute_beam_for_game(json.dumps(beamline)))
    assert result["beamAlive"] is True
    # Kinetic output: default source kinetic (0.01 GeV) plus a tiny RF gain —
    # nowhere near the proton rest mass and below the 0.1 GeV objective bar.
    assert result["beamEnergy"] < 0.1
    assert abs(result["beamEnergy"] - PROTON_MASS) > 0.5
    # Envelope energies are kinetic too: no snapshot may sit at ~m_p.
    for snap in result["envelope"]:
        assert abs(snap["energy"] - PROTON_MASS) > 0.5


def test_proton_propagate_uses_mass_in_snapshots():
    """Propagate directly and check the beam's relativistic state is proton-like."""
    game_beamline = _proton_beamline("ionSource")
    elements = beamline_config_from_game(game_beamline)
    sp = extract_source_params(elements, game_beamline)
    result = propagate(elements, machine_type="linac", source_params=sp)
    assert result["summary"]["alive"] is True
    # Default source energy with a proton rest mass is non-relativistic;
    # normalized emittance conversion must not blow up (finite sizes).
    for snap in result["snapshots"]:
        assert math.isfinite(snap["beam_size_x"])
        assert math.isfinite(snap["beam_size_y"])
