"""Machine types: which physics modules run, and what the machine is paid on.

A machine type is a routing hint from the game side. It decides three things
and nothing else: which modules `propagate()` runs, which optional physics a
module is allowed to claim (the capability set), and which quantity the type is
scored on (`success_metric`).

Two deliberate structural choices here, both of them fixes:

*Explicit per-type module lists.* The old table built `_TIER1 -> _TIER2 ->
_TIER3 -> _TIER4` by nesting, so a type at tier N inherited every
specialisation below it. That is why the collider silently ran FEL gain: the
tier ladder said "a collider is an FEL plus more", which is false. Tiers are an
economic ordering, not a physics containment relation.

*Capability sets instead of type-name literals in module files.* `fel_gain.py`
used to carry `{"fel", "collider"}` and `beam_beam.py` compared against the
string `"collider"`. Literals in module files drift the moment the roster gains
or renames a type — nothing forces them to be revisited, and nothing fails
loudly when they are not. That is the same drift that stranded `dcPhotoGun`.
A capability declared beside the module list cannot drift, because both are
read from this one config.
"""
from beam_physics.modules.linear_optics import LinearOpticsModule
from beam_physics.modules.rf_acceleration import RFAccelerationModule
from beam_physics.modules.synchrotron_rad import SynchrotronRadiationModule
from beam_physics.modules.aperture_loss import ApertureLossModule
from beam_physics.modules.collimation import CollimationModule
from beam_physics.modules.space_charge import SpaceChargeModule
from beam_physics.modules.beam_gas import BeamGasModule
from beam_physics.modules.bunch_compression import BunchCompressionModule
from beam_physics.modules.fel_gain import FELGainModule
from beam_physics.modules.beam_beam import BeamBeamModule

# The full capability vocabulary. A capability is optional physics that some
# machines produce and others must not: it names a *product*, not a component.
# Validated against every config at import — a typo here would silently switch
# a module off, which is precisely the failure the literals used to cause.
CAPABILITIES = frozenset({
    "fel",                # undulator gain is a product     -> fel_gain
    "beam_beam",          # two beams collide at an IP      -> beam_beam
    "sr_light",           # bend-magnet photons are the product (Wave 5 module)
    "bunch_compression",  # short bunches are a design goal -> bunch_compression
})

# Modules are stateless — they read the beam and the element and return a
# report — so one instance per module is shared by every config that runs it.
_LINEAR_OPTICS = LinearOpticsModule()
_RF_ACCELERATION = RFAccelerationModule()
_SPACE_CHARGE = SpaceChargeModule()
_BEAM_GAS = BeamGasModule()
_SYNCHROTRON_RAD = SynchrotronRadiationModule()
_COLLIMATION = CollimationModule()
_APERTURE_LOSS = ApertureLossModule()
_BUNCH_COMPRESSION = BunchCompressionModule()
_FEL_GAIN = FELGainModule()
_BEAM_BEAM = BeamBeamModule()

# Every machine transports, accelerates, radiates, scrapes and scatters. This
# is not a tier and nothing inherits from it — it is the physics no beamline
# can opt out of, named once so each config below reads as "transport, plus
# exactly this". Per-type lists extend this set; they never extend each other.
_TRANSPORT = [
    _LINEAR_OPTICS,
    _RF_ACCELERATION,
    _SPACE_CHARGE,
    _BEAM_GAS,
    _SYNCHROTRON_RAD,
    _COLLIMATION,
    _APERTURE_LOSS,
]


def _sorted_modules(modules):
    return sorted(modules, key=lambda m: m.order)


_MACHINE_CONFIGS = {
    # --- The ten game beamline types (ids match BEAMLINE_TYPES) ------------
    "testStand": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 1,
        "capabilities": frozenset(),
        "success_metric": "beam_power_kw",
        "description": "Test Stand",
    },
    "ebeamProcessing": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 1,
        "capabilities": frozenset(),
        "success_metric": "beam_power_kw",
        "description": "E-beam Processing Line",
    },
    "isotopeIrradiation": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 2,
        "capabilities": frozenset(),
        "success_metric": "fluence",
        "description": "Isotope & Irradiation Line",
    },
    "therapy": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 2,
        "capabilities": frozenset(),
        "success_metric": "dose_availability",
        "description": "Therapy Line",
    },
    "spallation": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 3,
        "capabilities": frozenset(),
        "success_metric": "beam_power_mw",
        "description": "Spallation Neutron Source",
    },
    "lightSource": {
        # No "fel" capability, and this is the load-bearing line of the file.
        # A storage ring has no undulator gain to speak of: bunches are long,
        # the current is stored rather than fresh, and the light is incoherent
        # bend/undulator emission. Running FELGainModule here would report
        # saturation the machine physically cannot reach, and the FoM would pay
        # for it. Light output arrives with the synchrotron_light module.
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 3,
        "capabilities": frozenset({"sr_light"}),
        "success_metric": "photon_flux",
        "description": "Synchrotron Light Source",
    },
    "xfel": {
        "modules": _sorted_modules(_TRANSPORT + [_BUNCH_COMPRESSION, _FEL_GAIN]),
        "tier": 4,
        "capabilities": frozenset({"fel", "bunch_compression"}),
        "success_metric": "fel_brilliance",
        "description": "XFEL (hard X-ray)",
    },
    "euvFel": {
        "modules": _sorted_modules(_TRANSPORT + [_BUNCH_COMPRESSION, _FEL_GAIN]),
        "tier": 4,
        "capabilities": frozenset({"fel", "bunch_compression"}),
        "success_metric": "euv_photon_power_w",
        "description": "EUV FEL Drive Line",
    },
    "collider": {
        # Deliberately no "fel". The old tier chain gave the collider FEL gain
        # for free; in a collider undulator radiation is a loss mechanism, not
        # a product.
        "modules": _sorted_modules(_TRANSPORT + [_BUNCH_COMPRESSION, _BEAM_BEAM]),
        "tier": 5,
        "capabilities": frozenset({"beam_beam", "bunch_compression"}),
        "success_metric": "integrated_luminosity",
        "description": "Linear Collider",
    },
    "blackHoleFactory": {
        # The collider's stack exactly, and that is the point: a black hole
        # factory is a collider, three orders of magnitude up. Nothing about
        # 500 TeV/beam calls for physics the collider does not already run —
        # what changes is the number the machine is paid on, not the modules
        # that produce it. `black_hole_yield` is computed analytically in
        # gameplay.py from the energy and the luminosity beam_beam already
        # reports; there is deliberately no black_hole.py, because a module
        # here would imply the game simulates production, and it does not.
        "modules": _sorted_modules(_TRANSPORT + [_BUNCH_COMPRESSION, _BEAM_BEAM]),
        "tier": 6,
        "capabilities": frozenset({"beam_beam", "bunch_compression"}),
        "success_metric": "black_hole_yield",
        "description": "Black Hole Factory",
    },

    # --- Legacy type names ------------------------------------------------
    # Saved games, BeamlineDesigner._pickMachineType() and most Python call
    # sites still pass these three. They are real configs, not aliases, so the
    # generic "linac" fallback stays a plain transport stack rather than
    # inheriting some named game type's scoring.
    "linac": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 1,
        "capabilities": frozenset(),
        "success_metric": "beam_power_kw",
        "description": "Electron Linac",
    },
    "photoinjector": {
        "modules": _sorted_modules(_TRANSPORT),
        "tier": 2,
        "capabilities": frozenset(),
        "success_metric": "brightness",
        "description": "Photoinjector",
    },
    "fel": {
        "modules": _sorted_modules(_TRANSPORT + [_BUNCH_COMPRESSION, _FEL_GAIN]),
        "tier": 3,
        "capabilities": frozenset({"fel", "bunch_compression"}),
        "success_metric": "fel_brilliance",
        "description": "Free Electron Laser",
    },
}

MACHINE_TYPES = frozenset(_MACHINE_CONFIGS)

for _name, _config in _MACHINE_CONFIGS.items():
    _unknown = _config["capabilities"] - CAPABILITIES
    if _unknown:
        raise ValueError(
            f"machine type '{_name}' declares unknown capabilities "
            f"{sorted(_unknown)} — known: {sorted(CAPABILITIES)}"
        )


def get_machine_config(machine_type):
    """Configuration for a machine type, falling back to 'linac' if unknown.

    This used to raise KeyError, which meant one bad string from the JS side
    took down the whole physics pass and returned nothing at all — the beamline
    then read as dead rather than as mis-typed. A machine type is a routing
    hint for which module stack to run, so degrading to the base linac stack is
    both recoverable and honest: the beam still propagates, it just doesn't get
    the specialised modules.

    Callers that need to KNOW the type was valid should check MACHINE_TYPES.
    """
    config = _MACHINE_CONFIGS.get(machine_type)
    if config is None:
        return _MACHINE_CONFIGS["linac"]
    return config


def machine_capabilities(machine_type):
    """Capability set for a machine type. Unknown types get the linac's (empty)."""
    return get_machine_config(machine_type)["capabilities"]


def machine_has_capability(machine_type, capability):
    """Whether this machine type produces `capability`.

    The gate modules call from `applies_to`. Note it fails closed: an unknown
    type resolves to the linac, which has no capabilities, so a mis-typed
    beamline loses its specialised physics rather than gaining someone else's.
    """
    return capability in machine_capabilities(machine_type)
