"""Cavity device physics: Q0(T), achievable gradient, dissipation round-trip.

The calibration table below is the contract. It is not arbitrary — it
reproduces real TESLA 9-cell behaviour (Q0 ~ 1e10 and 30-50 W dynamic load at
20 MV/m, both at 2 K), which is what lets the rest of the game be balanced
against hardware rather than against tuning constants. If a change here moves
these numbers, the model has stopped describing niobium.
"""
import math

import pytest

from beam_physics.srf import (
    CAVITY_SPECS, T_CRITICAL, Q0_COPPER,
    r_bcs, q0, e_acc_max, p_diss, detune_coupling, get_spec,
)

TESLA = CAVITY_SPECS["cryomodule"]

# T (K), R_BCS (nohm), Q0, E_acc at 42 W (MV/m), P_diss at 20 MV/m (W)
CALIBRATION = [
    (1.8, 10.2, 1.33e10, 23.1, 31),
    (2.0, 24.6, 7.80e9, 17.7, 54),
    (2.5, 115.2, 2.16e9, 9.3, 194),
    (3.0, 311.7, 8.39e8, 5.8, 499),
    (4.2, 1198.2, 2.23e8, 3.0, 1872),
]


@pytest.mark.parametrize("temp,rb_nohm,q,eacc,pd", CALIBRATION)
def test_calibration_table(temp, rb_nohm, q, eacc, pd):
    """Each column of the calibration table, within 5%."""
    assert r_bcs(temp, TESLA["f_ghz"]) * 1e9 == pytest.approx(rb_nohm, rel=0.05)
    assert q0(temp, TESLA) == pytest.approx(q, rel=0.05)
    assert e_acc_max(42.0, TESLA, temp) == pytest.approx(eacc, rel=0.05)
    assert p_diss(20.0, TESLA, temp) == pytest.approx(pd, rel=0.05)


def test_gradient_collapses_with_lost_cold():
    """2.0 K -> 4.2 K costs ~35x in Q0 and ~6x in gradient. This ratio is the
    whole reason cryogenic provisioning is a decision."""
    assert q0(2.0, TESLA) / q0(4.2, TESLA) == pytest.approx(35, rel=0.1)
    ratio = e_acc_max(42.0, TESLA, 2.0) / e_acc_max(42.0, TESLA, 4.2)
    assert ratio == pytest.approx(5.9, rel=0.1)


def test_dissipation_round_trips():
    """p_diss is the exact inverse of e_acc_max — the property the thermal
    feedback loop depends on. If these drift apart the loop either runs away
    when it shouldn't or never runs away at all."""
    for temp in (1.8, 2.0, 3.0, 4.5):
        for power in (10.0, 42.0, 500.0):
            grad = e_acc_max(power, TESLA, temp)
            assert p_diss(grad, TESLA, temp) == pytest.approx(power, rel=1e-9)


def test_q0_monotonic_decreasing_in_temperature():
    temps = [1.8, 2.0, 2.5, 3.0, 3.5, 4.2, 4.5, 5.0]
    values = [q0(t, TESLA) for t in temps]
    assert all(a > b for a, b in zip(values, values[1:]))


def test_gradient_monotonic_increasing_in_power():
    powers = [1.0, 10.0, 42.0, 100.0, 1000.0]
    values = [e_acc_max(p, TESLA, 2.0) for p in powers]
    assert all(a < b for a, b in zip(values, values[1:]))


def test_gradient_scales_as_sqrt_power():
    """4x the power buys 2x the gradient, not 4x. Getting this exponent wrong
    was the original defect: rfQuality entered linearly."""
    base = e_acc_max(50.0, TESLA, 2.0)
    assert e_acc_max(200.0, TESLA, 2.0) == pytest.approx(2.0 * base, rel=1e-9)


def test_above_critical_temperature_is_dead():
    assert q0(T_CRITICAL + 0.1, TESLA) == Q0_COPPER
    assert e_acc_max(1000.0, TESLA, T_CRITICAL + 0.1) == 0.0


def test_zero_and_negative_power_yield_no_gradient():
    for bad in (0.0, -1.0, None):
        assert e_acc_max(bad, TESLA, 2.0) == 0.0


def test_lower_residual_resistance_raises_q0():
    """The research hook: N-doping and better surface prep cut R_res."""
    assert q0(2.0, TESLA, r_res=1e-9) > q0(2.0, TESLA, r_res=20e-9)


# --- Normal conducting ---------------------------------------------------

def test_nc_gradient_matches_slac():
    """S-band, 55 Mohm/m, 3 m, 30 MW -> ~23.5 MV/m. SLAC runs ~20 MV/m at
    35 MW, so this is the right ballpark for real hardware."""
    spec = CAVITY_SPECS["sbandStructure"]
    assert e_acc_max(30e6, spec) == pytest.approx(23.5, rel=0.05)


def test_nc_ignores_temperature():
    spec = CAVITY_SPECS["sbandStructure"]
    assert e_acc_max(30e6, spec, 2.0) == e_acc_max(30e6, spec, 300.0)
    assert q0(2.0, spec) == Q0_COPPER


def test_nc_dissipation_round_trips():
    spec = CAVITY_SPECS["cbandCavity"]
    for power in (1e6, 30e6):
        grad = e_acc_max(power, spec)
        assert p_diss(grad, spec) == pytest.approx(power, rel=1e-9)


# --- Detune --------------------------------------------------------------

def test_detune_coupling_is_unity_when_cooled():
    spec = CAVITY_SPECS["sbandStructure"]
    assert detune_coupling(0.0, spec) == 1.0
    assert detune_coupling(None, spec) == 1.0


def test_detune_coupling_falls_off_with_temperature_rise():
    spec = CAVITY_SPECS["sbandStructure"]
    values = [detune_coupling(dt, spec) for dt in (0.0, 1.0, 5.0, 20.0)]
    assert all(a > b for a, b in zip(values, values[1:]))
    assert values[-1] < 0.5


# --- Table integrity -----------------------------------------------------

def test_every_spec_is_well_formed():
    for cid, spec in CAVITY_SPECS.items():
        assert spec["kind"] in ("srf", "nc"), cid
        assert spec["l_active"] > 0, cid
        assert spec["n_cav"] >= 1, cid
        assert spec["f_ghz"] > 0, cid
        if spec["kind"] == "srf":
            assert spec["r_over_q"] > 0 and spec["G"] > 0, cid
        else:
            assert spec["r_shunt"] > 0, cid


def test_get_spec_returns_none_for_unmodelled_component():
    assert get_spec("quadrupole") is None
    assert get_spec("cryomodule") is CAVITY_SPECS["cryomodule"]
