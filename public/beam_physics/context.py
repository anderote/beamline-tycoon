import numpy as np


class EffectReport:
    """Report from a physics module for diagnostics/UI."""

    def __init__(self, module, element_index, details=None):
        self.module = module
        self.element_index = element_index
        self.details = details or {}


class PropagationContext:
    """Carries accumulated state across elements during propagation."""

    def __init__(self, machine_type):
        self.machine_type = machine_type
        self.cumulative_s = 0.0
        self.dispersion = np.zeros(4)  # (eta_x, eta_x', eta_y, eta_y')
        self.chirp = 0.0               # energy-time correlation (1/m)
        self.bunch_frequency_set = False  # True after first RF element sets bunch structure
        self.active_modules = []       # list of PhysicsModule, sorted by order
        self.element_index = 0
        self.snapshots = []
        self.reports = []

    def record(self, report):
        """Record an EffectReport from a module."""
        self.reports.append(report)
