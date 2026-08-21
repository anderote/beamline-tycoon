"""High-current DC extraction and LEBT contract tests."""

import json

import pytest

from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, PROTON_MASS
from beam_physics.context import PropagationContext
from beam_physics.gameplay import (
    beamline_config_from_game,
    compute_beam_for_game,
    extract_source_params,
)
from beam_physics.modules.dc_acceleration import DCElectrostaticAccelerationModule
from beam_physics.modules.rf_acceleration import RFAccelerationModule
from beam_physics.modules.space_charge import SpaceChargeModule


def _beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


def _source():
    return {
        "type": "ecrIonSource",
        "physicsType": "source",
        "subL": 6,
        "apertureRadius": 40,
        "extractionEnergy": 0.00004,
        "sourceBeamRadiusMm": 10,
        "sourceSpaceChargeCompensation": 0.98,
        "params": {"particleType": "proton"},
        "stats": {"beamCurrent": 400, "emittance": 2},
    }


def _drift():
    return {"type": "drift", "physicsType": "drift", "subL": 0.666}


def _injector():
    return {
        "type": "dcInjector",
        "physicsType": "dcAccelerator",
        "subL": 4,
        "apertureRadius": 50,
        "stats": {
            "energyGain": 0.00075,
            "focusStrength": 0.9,
            "spaceChargeCompensation": 99,
        },
    }


def _rfq():
    return {
        "type": "rfq",
        "physicsType": "rfCavity",
        "subL": 6,
        "apertureRadius": 6,
        "rfFrequency": 162.5,
        "stats": {"energyGain": 0.003, "focusStrength": 60},
        "params": {"rfPhase": -30},
    }


def _stop():
    return {
        "type": "beamStop",
        "physicsType": "beamStop",
        "subL": 4,
        "apertureRadius": 48,
        "stats": {},
    }


def test_dc_module_accelerates_without_rf_capture_and_damps_angles():
    beam = _beam(
        energy=0.00004,
        mass=PROTON_MASS,
        current=400,
        space_charge_compensation=0.98,
    )
    module = DCElectrostaticAccelerationModule()
    context = PropagationContext("linac")
    energy_before = beam.energy
    divergence_before = beam.sigma[1, 1]
    current_before = beam.current

    report = module.apply(beam, {
        "type": "dcAccelerator",
        "energyGain": 0.00075,
        "spaceChargeCompensation": 0.99,
    }, context)

    assert beam.energy == pytest.approx(energy_before + 0.00075)
    assert beam.sigma[1, 1] < divergence_before
    assert beam.current == current_before
    assert beam.bunch_frequency == 0
    assert beam.space_charge_compensation == pytest.approx(0.99)
    assert report.details["momentum_damping"] < 1


def test_neutralization_reduces_dc_space_charge_but_rf_capture_clears_it():
    uncompensated = _beam(energy=0.00004, mass=PROTON_MASS, current=400)
    compensated = _beam(
        energy=0.00004,
        mass=PROTON_MASS,
        current=400,
        space_charge_compensation=0.99,
    )
    space_charge = SpaceChargeModule()
    element = {"type": "drift", "length": 0.5}
    before_u = uncompensated.sigma.copy()
    before_c = compensated.sigma.copy()
    report_u = space_charge.apply(uncompensated, element, PropagationContext("linac"))
    report_c = space_charge.apply(compensated, element, PropagationContext("linac"))

    kick_u = uncompensated.sigma[0, 1] - before_u[0, 1]
    kick_c = compensated.sigma[0, 1] - before_c[0, 1]
    assert abs(kick_c) < abs(kick_u) * 0.02
    assert report_c.details["I_peak"] == pytest.approx(
        report_u.details["I_peak"] * 0.01, rel=1e-6)

    RFAccelerationModule().apply(compensated, {
        "type": "rfCavity",
        "length": 0.5,
        "energyGain": 0.0001,
        "rfFrequency": 162.5e6,
        "game_type": "rfq",
    }, PropagationContext("linac"))
    assert compensated.bunch_frequency == pytest.approx(162.5e6)
    assert compensated.space_charge_compensation == 0


def test_source_exit_radius_and_compensation_initialize_twiss_state():
    source = _source()
    elements = beamline_config_from_game([source])
    params = dict(DEFAULT_SOURCE)
    params.update(extract_source_params(elements, [source]))
    beam = create_initial_beam(params)

    assert beam.beam_size_x() == pytest.approx(0.010)
    assert beam.beam_size_y() == pytest.approx(0.010)
    assert beam.space_charge_compensation == pytest.approx(0.98)
    assert beam.alpha_x() == pytest.approx(0)
    assert beam.alpha_y() == pytest.approx(0)


def test_ecr_dc_injector_rfq_front_end_has_useful_transmission():
    direct = [_source(), _drift(), _rfq(), _drift(), _stop()]
    extracted = [_source(), _drift(), _injector(), _drift(), _rfq(), _drift(), _stop()]

    direct_result = json.loads(compute_beam_for_game(json.dumps(direct)))
    extracted_result = json.loads(compute_beam_for_game(json.dumps(extracted)))

    # This was effectively zero before the extraction/neutralization and RFQ
    # focusing contracts.  Keep the threshold below the measured ~127 mA so
    # the test protects useful transmission without pinning a tuning optimum.
    assert direct_result["beamCurrent"] < 1
    assert extracted_result["beamCurrent"] > 100
    assert extracted_result["beamCurrent"] > direct_result["beamCurrent"] * 100
    assert extracted_result["beamEnergy"] > 0.002

    dc_samples = [s for s in extracted_result["envelope"] if s["type"] == "dcAccelerator"]
    rf_samples = [s for s in extracted_result["envelope"] if s["type"] == "rfCavity"]
    assert dc_samples and rf_samples
    assert dc_samples[-1]["bunch_frequency"] == 0
    assert dc_samples[-1]["space_charge_compensation"] == pytest.approx(0.99)
    assert rf_samples[-1]["bunch_frequency"] == pytest.approx(162.5e6)
    assert rf_samples[-1]["space_charge_compensation"] == 0
