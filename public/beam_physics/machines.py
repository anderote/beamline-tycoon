from beam_physics.modules.linear_optics import LinearOpticsModule
from beam_physics.modules.rf_acceleration import RFAccelerationModule
from beam_physics.modules.synchrotron_rad import SynchrotronRadiationModule
from beam_physics.modules.aperture_loss import ApertureLossModule
from beam_physics.modules.collimation import CollimationModule
from beam_physics.modules.space_charge import SpaceChargeModule
from beam_physics.modules.bunch_compression import BunchCompressionModule
from beam_physics.modules.fel_gain import FELGainModule
from beam_physics.modules.beam_beam import BeamBeamModule

MACHINE_TYPES = {"linac", "photoinjector", "fel", "collider"}

_TIER1_MODULES = [
    LinearOpticsModule(),
    RFAccelerationModule(),
    SynchrotronRadiationModule(),
    CollimationModule(),
    ApertureLossModule(),
]

_TIER2_MODULES = _TIER1_MODULES + [SpaceChargeModule()]
_TIER3_MODULES = _TIER2_MODULES + [BunchCompressionModule(), FELGainModule()]
_TIER4_MODULES = _TIER3_MODULES + [BeamBeamModule()]


def _sorted_modules(modules):
    return sorted(modules, key=lambda m: m.order)


_MACHINE_CONFIGS = {
    "linac": {
        "modules": _sorted_modules(_TIER1_MODULES),
        "tier": 1,
        "success_metric": "beam_power_kw",
        "description": "Electron Linac",
    },
    "photoinjector": {
        "modules": _sorted_modules(_TIER2_MODULES),
        "tier": 2,
        "success_metric": "brightness",
        "description": "Photoinjector",
    },
    "fel": {
        "modules": _sorted_modules(_TIER3_MODULES),
        "tier": 3,
        "success_metric": "fel_brilliance",
        "description": "Free Electron Laser",
    },
    "collider": {
        "modules": _sorted_modules(_TIER4_MODULES),
        "tier": 4,
        "success_metric": "integrated_luminosity",
        "description": "Electron-Positron Collider",
    },
}


def get_machine_config(machine_type):
    """Return the configuration dict for a machine type. Raises KeyError for unknown types."""
    return _MACHINE_CONFIGS[machine_type]
