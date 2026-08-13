"""Machine-type table: module lists, capability gating, and the fallback.

The contract this pins is that a machine type's module list and its capability
set are the *only* things deciding which physics a beamline gets. Before
capabilities, module files matched machine-type strings themselves, which is
how the collider ended up running FEL gain — the tier chain put FELGainModule
in its list and fel_gain.py's literal set agreed. Both halves are asserted here
so neither can drift back.
"""
import pytest

from beam_physics.gameplay import black_hole_yield
from beam_physics.lattice import propagate
from beam_physics.machines import (
    CAPABILITIES, MACHINE_TYPES, _MACHINE_CONFIGS,
    get_machine_config, machine_capabilities, machine_has_capability,
)
from beam_physics.modules.beam_beam import BeamBeamModule
from beam_physics.modules.bunch_compression import BunchCompressionModule
from beam_physics.modules.fel_gain import FELGainModule

# The ten game beamline types. Ids must match BEAMLINE_TYPES on the JS side —
# the machineType a beamline stores is looked up here verbatim.
GAME_TYPES = [
    "testStand", "ebeamProcessing", "isotopeIrradiation", "therapy",
    "spallation", "lightSource", "xfel", "euvFel", "collider",
    "blackHoleFactory",
]

# Names still passed by saved games, BeamlineDesigner._pickMachineType() and
# most Python call sites. Removing one of these silently downgrades live
# beamlines to the fallback stack.
LEGACY_TYPES = ["linac", "photoinjector", "fel"]

ALL_TYPES = GAME_TYPES + LEGACY_TYPES

# Which module class each capability is supposed to switch on. The point of
# capabilities is that these two facts agree for every config; below they are
# checked in both directions.
CAPABILITY_MODULE = {
    "fel": FELGainModule,
    "beam_beam": BeamBeamModule,
    "bunch_compression": BunchCompressionModule,
}


def _minimal_beamline():
    """One of every element the gated modules care about, so a config that
    declares a capability actually exercises it during propagation."""
    return [
        {"type": "source", "length": 0},
        {"type": "rfCavity", "length": 2.0, "energyGain": 0.5, "rfPhase": 0.0},
        {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
        {"type": "drift", "length": 2.0},
        {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
        {"type": "drift", "length": 2.0},
        {"type": "chicane", "length": 10.0, "r56": -0.04},
        {"type": "collimator", "length": 0.5, "gap": 0.01},
        {"type": "undulator", "length": 30.0, "period": 0.03, "kParameter": 1.5},
        {"type": "detector", "length": 1.0, "crossingAngle": 14.0},
        {"type": "beamStop", "length": 1.0},
    ]


# --- Table shape ---------------------------------------------------------

@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_config_is_complete(machine_type):
    config = _MACHINE_CONFIGS[machine_type]
    assert config["modules"], f"{machine_type} runs no physics at all"
    assert isinstance(config["tier"], int) and config["tier"] >= 1
    assert config["success_metric"], f"{machine_type} is paid on nothing"
    assert isinstance(config["capabilities"], frozenset)
    assert config["description"]


def test_every_type_is_accounted_for():
    """No config exists that this file does not know about. A new type must be
    classified as game or legacy here, which is what forces the rest of these
    parametrised checks to cover it."""
    assert set(ALL_TYPES) == set(MACHINE_TYPES)


@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_modules_sorted_by_order(machine_type):
    """propagate() runs modules in list order, so the list must already be in
    physics order — optics before RF before losses."""
    orders = [m.order for m in _MACHINE_CONFIGS[machine_type]["modules"]]
    assert orders == sorted(orders)


@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_no_duplicate_modules(machine_type):
    """An explicit list can repeat a module where the old nested one could not.
    A repeated module applies its effect twice per element."""
    names = [m.name for m in _MACHINE_CONFIGS[machine_type]["modules"]]
    assert len(names) == len(set(names))


@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_capabilities_are_known(machine_type):
    assert machine_capabilities(machine_type) <= CAPABILITIES


# --- Capability / module-list agreement ----------------------------------

@pytest.mark.parametrize("capability,module_cls", sorted(
    CAPABILITY_MODULE.items(), key=lambda kv: kv[0]))
@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_capability_matches_module_list(machine_type, capability, module_cls):
    """The invariant that makes capabilities trustworthy: a config declares a
    capability if and only if it runs the module that capability gates."""
    declared = machine_has_capability(machine_type, capability)
    present = any(isinstance(m, module_cls)
                  for m in _MACHINE_CONFIGS[machine_type]["modules"])
    assert declared == present, (
        f"{machine_type}: capability {capability!r}={declared} but "
        f"{module_cls.__name__} in module list = {present}")


# --- The specific gating this refactor exists to fix ---------------------

def test_light_source_has_no_fel():
    """A storage ring cannot lase. If lightSource ever carries "fel" it will
    run FELGainModule and report a saturation fraction it physically cannot
    reach, and the light-source FoM will pay for it."""
    assert not machine_has_capability("lightSource", "fel")
    assert not any(isinstance(m, FELGainModule)
                   for m in _MACHINE_CONFIGS["lightSource"]["modules"])


def test_collider_has_no_fel():
    """It never should have had it — the old _TIER3 -> _TIER4 nesting gave the
    collider FEL gain for free, and fel_gain.py's literal set agreed."""
    assert not machine_has_capability("collider", "fel")


@pytest.mark.parametrize("machine_type", ["xfel", "euvFel", "fel"])
def test_fel_types_have_fel(machine_type):
    assert machine_has_capability(machine_type, "fel")


def test_only_fel_types_have_fel():
    assert {t for t in MACHINE_TYPES if machine_has_capability(t, "fel")} == {
        "xfel", "euvFel", "fel"}


def test_only_colliding_types_have_beam_beam():
    """Two beams meeting at an IP is what beam_beam models, and exactly two
    types do it: the linear collider and the tier-6 machine that is a linear
    collider three orders of magnitude up. Nothing else may acquire it — a
    single-beam machine that reported luminosity would be paid for a collision
    that never happened."""
    assert {t for t in MACHINE_TYPES
            if machine_has_capability(t, "beam_beam")} == {
                "collider", "blackHoleFactory"}


def test_light_source_is_the_sr_light_type():
    assert {t for t in MACHINE_TYPES
            if machine_has_capability(t, "sr_light")} == {"lightSource"}


# --- The gates as the modules actually evaluate them ---------------------

@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_fel_gain_gate_follows_capability(machine_type):
    module = FELGainModule()
    expected = machine_has_capability(machine_type, "fel")
    assert module.applies_to({"type": "undulator"}, machine_type) is expected
    # Never on a non-undulator, capability or not.
    assert module.applies_to({"type": "drift"}, machine_type) is False


@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_beam_beam_gate_follows_capability(machine_type):
    module = BeamBeamModule()
    expected = machine_has_capability(machine_type, "beam_beam")
    assert module.applies_to({"type": "detector"}, machine_type) is expected
    assert module.applies_to({"type": "drift"}, machine_type) is False


def test_bunch_compression_gate_follows_capability():
    """Chicanes fire on exactly the types that declare the capability.

    This was an xfail: bunch_compression.py literal-matched {'fel', 'collider'},
    which excluded xfel and euvFel — the two types whose figure of merit is
    driven by peak current. A chicane on an XFEL did nothing at all.
    """
    module = BunchCompressionModule()
    for machine_type in ALL_TYPES:
        expected = machine_has_capability(machine_type, "bunch_compression")
        assert module.applies_to({"type": "chicane"}, machine_type) is expected, (
            f"{machine_type}: chicane gate {not expected} vs capability {expected}")


# --- Fallback ------------------------------------------------------------

def test_unknown_type_falls_back_to_linac():
    """One bad string from the JS side used to raise KeyError and take down
    the whole physics pass, so a mis-typed beamline read as dead rather than
    as mis-typed."""
    assert get_machine_config("hyperdrive") is get_machine_config("linac")
    assert get_machine_config(None) is get_machine_config("linac")


def test_fallback_grants_no_capabilities():
    """Fails closed: a mis-typed beamline loses its specialised physics rather
    than inheriting someone else's."""
    assert machine_capabilities("hyperdrive") == frozenset()


# --- Propagation ---------------------------------------------------------

@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_propagation_runs(machine_type):
    result = propagate(_minimal_beamline(), machine_type=machine_type)
    assert "summary" in result
    assert result["summary"]["final_energy"] > 0


@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_only_capable_types_emit_fel_reports(machine_type):
    """End to end: the module list and the gate together decide what a
    beamline is scored on, and the undulator in the lattice is only ever
    productive for a type that declares "fel"."""
    result = propagate(_minimal_beamline(), machine_type=machine_type)
    emitted = any(r.module == "fel_gain" for r in result["reports"])
    assert emitted == machine_has_capability(machine_type, "fel")


@pytest.mark.parametrize("machine_type", ALL_TYPES)
def test_only_capable_types_emit_beam_beam_reports(machine_type):
    result = propagate(_minimal_beamline(), machine_type=machine_type)
    emitted = any(r.module == "beam_beam" for r in result["reports"])
    assert emitted == machine_has_capability(machine_type, "beam_beam")


# --- The tier-6 success metric -------------------------------------------
#
# black_hole_yield is the one figure of merit computed in beam_physics rather
# than on the JS side, because it needs the luminosity only beam_beam reports.
# It is analytic — a geometric cross-section times a luminosity — and these
# pin the three properties that make it a figure of merit rather than a fudge.

def test_black_hole_factory_is_paid_on_black_hole_yield():
    assert (_MACHINE_CONFIGS["blackHoleFactory"]["success_metric"]
            == "black_hole_yield")


def test_black_hole_yield_is_zero_below_threshold():
    """Below the fundamental scale the semiclassical estimate does not apply
    at all, so the machine earns nothing rather than a small number. A collider
    at 500 GeV/beam must not quietly produce black holes."""
    assert black_hole_yield(500.0, 1e34) == 0.0
    assert black_hole_yield(250000.0, 0.0) == 0.0
    assert black_hole_yield(0.0, 1e34) == 0.0


def test_black_hole_yield_is_linear_in_luminosity():
    """sigma x L, so doubling the luminosity doubles the yield exactly. This is
    what makes the type a luminosity machine rather than an energy one."""
    a = black_hole_yield(250000.0, 1e34)
    b = black_hole_yield(250000.0, 2e34)
    assert a > 0
    assert abs(b - 2 * a) < 1e-12 * b


def test_black_hole_yield_rises_weakly_with_energy():
    """r_s goes as the seventh root of sqrt(s) for n=6, so five times the
    energy is well under twice the yield. The band top is worth having and is
    not where the machine is won."""
    lo = black_hole_yield(100000.0, 1e34)
    hi = black_hole_yield(500000.0, 1e34)
    assert hi > lo
    assert hi < 2.0 * lo


def test_black_hole_yield_matches_the_declared_fomRef():
    """src/data/beamline-types.js declares fomRef 1.8 for a reference machine
    at 250,000 GeV/beam and 1e34 cm^-2 s^-1. The two numbers are written in
    different languages and nothing else forces them to agree."""
    assert abs(black_hole_yield(250000.0, 1e34) - 1.8) < 0.1
