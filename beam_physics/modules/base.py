class PhysicsModule:
    """Base class for all physics modules."""

    def __init__(self, name, order):
        self.name = name
        self.order = order

    def applies_to(self, element, machine_type):
        """Return True if this module should run for this element + machine type."""
        raise NotImplementedError

    def apply(self, beam, element, context):
        """Apply physics effect. Mutate beam in place. Return EffectReport."""
        raise NotImplementedError
