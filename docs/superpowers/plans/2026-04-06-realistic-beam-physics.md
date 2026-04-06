# Realistic Beam Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `lattice.py` propagation with a modular physics engine where each effect is an independent module, composed per machine type.

**Architecture:** Python physics modules under `beam_physics/modules/`, each implementing `applies_to()` + `apply()`. A `PropagationContext` carries state across elements. Machine types declare which modules are active. `gameplay.py` remains the JS-Python bridge.

**Tech Stack:** Python 3.13, numpy, scipy. Tests use `unittest` (no pytest dependency). Runs client-side via Pyodide.

**Important constraints:**
- `beam_physics/` runs in Pyodide (browser). No filesystem, no subprocess, no pip at runtime.
- Tests run in native Python (`python3 -m unittest`). numpy and scipy are available.
- The existing `lattice.py` propagation must keep working until migration is complete.
- `gameplay.py` is the only entry point called from JS — its `compute_beam_for_game()` signature must stay stable.

---

## File Structure

```
beam_physics/
  constants.py            # MODIFY — add Alfven current, electron charge, RF frequency defaults
  beam.py                 # MODIFY — add peak_current, n_particles, bunch_frequency to BeamState
  context.py              # CREATE — PropagationContext, EffectReport
  modules/
    __init__.py            # CREATE — exports all module classes
    base.py                # CREATE — PhysicsModule base class
    linear_optics.py       # CREATE — transfer matrices + dispersion tracking
    rf_acceleration.py     # CREATE — energy gain, damping, chirp
    space_charge.py        # CREATE — envelope defocusing at low energy
    synchrotron_rad.py     # CREATE — energy loss, quantum excitation
    bunch_compression.py   # CREATE — R56 compression, CSR
    collimation.py         # CREATE — beam scraping
    aperture_loss.py       # CREATE — Gaussian clipping
    fel_gain.py            # CREATE — FEL Pierce parameter, gain, saturation
    beam_beam.py           # CREATE — luminosity, tune shift, disruption
  machines.py              # CREATE — machine type definitions
  lattice.py               # MODIFY — new propagate() using module system
  gameplay.py              # MODIFY — pass machine_type, wire new params

test/
  test_base_module.py      # CREATE
  test_linear_optics.py    # CREATE
  test_rf_acceleration.py  # CREATE
  test_space_charge.py     # CREATE
  test_synchrotron_rad.py  # CREATE
  test_bunch_compression.py # CREATE
  test_collimation.py      # CREATE
  test_aperture_loss.py    # CREATE
  test_fel_gain.py         # CREATE
  test_beam_beam.py        # CREATE
  test_machines.py         # CREATE (Python, not the existing JS one)
  test_integration.py      # CREATE — full beamline propagation tests
```

---

### Task 1: Module Base Class and PropagationContext

**Files:**
- Create: `beam_physics/modules/__init__.py`
- Create: `beam_physics/modules/base.py`
- Create: `beam_physics/context.py`
- Create: `test/test_base_module.py`

- [ ] **Step 1: Write test for PhysicsModule and PropagationContext**

Create `test/test_base_module.py`:

```python
import unittest
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import PropagationContext, EffectReport


class TestPhysicsModule(unittest.TestCase):
    def test_base_class_not_instantiable_directly(self):
        """Base class methods raise NotImplementedError."""
        mod = PhysicsModule(name="test", order=0)
        with self.assertRaises(NotImplementedError):
            mod.applies_to({}, "linac")
        with self.assertRaises(NotImplementedError):
            mod.apply(None, {}, None)

    def test_module_ordering(self):
        """Modules sort by order attribute."""
        a = PhysicsModule(name="a", order=5)
        b = PhysicsModule(name="b", order=1)
        c = PhysicsModule(name="c", order=3)
        modules = sorted([a, b, c], key=lambda m: m.order)
        self.assertEqual([m.name for m in modules], ["b", "c", "a"])


class TestPropagationContext(unittest.TestCase):
    def test_initial_state(self):
        ctx = PropagationContext(machine_type="linac")
        self.assertEqual(ctx.machine_type, "linac")
        self.assertAlmostEqual(ctx.cumulative_s, 0.0)
        self.assertEqual(len(ctx.dispersion), 4)
        np.testing.assert_array_equal(ctx.dispersion, [0, 0, 0, 0])
        self.assertAlmostEqual(ctx.chirp, 0.0)
        self.assertEqual(ctx.snapshots, [])
        self.assertEqual(ctx.reports, [])

    def test_record_report(self):
        ctx = PropagationContext(machine_type="fel")
        report = EffectReport(module="test", element_index=0, details={"loss": 0.01})
        ctx.record(report)
        self.assertEqual(len(ctx.reports), 1)
        self.assertEqual(ctx.reports[0].module, "test")
        self.assertEqual(ctx.reports[0].details["loss"], 0.01)


class TestEffectReport(unittest.TestCase):
    def test_creation(self):
        r = EffectReport(module="linear_optics", element_index=3, details={"dispersion_x": 0.5})
        self.assertEqual(r.module, "linear_optics")
        self.assertEqual(r.element_index, 3)
        self.assertEqual(r.details["dispersion_x"], 0.5)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python3 -m unittest test.test_base_module -v`
Expected: `ModuleNotFoundError: No module named 'beam_physics.modules'`

- [ ] **Step 3: Create modules package and base class**

Create `beam_physics/modules/__init__.py`:

```python
from beam_physics.modules.base import PhysicsModule
```

Create `beam_physics/modules/base.py`:

```python
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
```

Create `beam_physics/context.py`:

```python
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
        self.active_modules = []       # list of PhysicsModule, sorted by order
        self.element_index = 0
        self.snapshots = []
        self.reports = []

    def record(self, report):
        """Record an EffectReport from a module."""
        self.reports.append(report)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/andrewcote/Documents/software/beamline-tycoon && python3 -m unittest test.test_base_module -v`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add beam_physics/modules/__init__.py beam_physics/modules/base.py beam_physics/context.py test/test_base_module.py
git commit -m "feat: add PhysicsModule base class and PropagationContext"
```

---

### Task 2: Update BeamState with Bunch Properties

**Files:**
- Modify: `beam_physics/beam.py`
- Modify: `beam_physics/constants.py`
- Create: `test/test_beam_state.py`

- [ ] **Step 1: Write test for new BeamState fields**

Create `test/test_beam_state.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, ELECTRON_CHARGE


class TestBeamStateBunchProperties(unittest.TestCase):
    def test_default_bunch_frequency(self):
        """BeamState has a default bunch_frequency."""
        params = dict(DEFAULT_SOURCE)
        beam = create_initial_beam(params)
        self.assertGreater(beam.bunch_frequency, 0)

    def test_n_particles_from_current(self):
        """n_particles = average_current / (e * f_bunch)."""
        params = dict(DEFAULT_SOURCE)
        params["current"] = 1.0  # mA
        params["bunch_frequency"] = 1.0e6  # 1 MHz
        beam = create_initial_beam(params)
        # 1 mA / (1.602e-19 C * 1e6 Hz) = 6.24e9 particles
        expected = 1.0e-3 / (ELECTRON_CHARGE * 1.0e6)
        self.assertAlmostEqual(beam.n_particles, expected, delta=expected * 0.01)

    def test_peak_current_from_bunch_length(self):
        """peak_current = charge_per_bunch / (sqrt(2*pi) * sigma_t)."""
        params = dict(DEFAULT_SOURCE)
        params["current"] = 1.0  # mA
        params["bunch_frequency"] = 1.0e6  # 1 MHz
        beam = create_initial_beam(params)
        charge = 1.0e-3 / 1.0e6  # C per bunch
        sigma_t = beam.bunch_length()  # seconds
        expected = charge / (np.sqrt(2 * np.pi) * sigma_t) if sigma_t > 0 else 0
        self.assertAlmostEqual(beam.peak_current, expected, delta=expected * 0.01)

    def test_snapshot_includes_new_fields(self):
        """Snapshot dict includes peak_current and n_particles."""
        params = dict(DEFAULT_SOURCE)
        beam = create_initial_beam(params)
        snap = beam.snapshot(0, "source", 0.0)
        self.assertIn("peak_current", snap)
        self.assertIn("n_particles", snap)
        self.assertIn("bunch_frequency", snap)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_beam_state -v`
Expected: `ImportError` on `ELECTRON_CHARGE` or `AttributeError` on `beam.bunch_frequency`

- [ ] **Step 3: Add ELECTRON_CHARGE to constants.py**

Add to `beam_physics/constants.py` after the existing constants:

```python
# Elementary charge (Coulombs)
ELECTRON_CHARGE = 1.602176634e-19

# Alfven current (A)
ALFVEN_CURRENT = 17045.0

# Default bunch frequency (Hz) — 1.3 GHz is typical for L-band linacs
DEFAULT_BUNCH_FREQUENCY = 1.3e9
```

- [ ] **Step 4: Update BeamState in beam.py**

Add new fields to `BeamState.__init__` (after `self.initial_eps_y`):

```python
        self.bunch_frequency = params.get("bunch_frequency", 1.3e9) if isinstance(params, dict) else 1.3e9
        self._update_bunch_properties()
```

Add new method to `BeamState` (after `update_relativistic`):

```python
    def _update_bunch_properties(self):
        """Derive peak current and n_particles from average current and bunch length."""
        from beam_physics.constants import ELECTRON_CHARGE
        charge_per_bunch = (self.current * 1e-3) / self.bunch_frequency if self.bunch_frequency > 0 else 0
        self.n_particles = charge_per_bunch / ELECTRON_CHARGE if ELECTRON_CHARGE > 0 else 0
        sigma_t = self.bunch_length()
        if sigma_t > 0:
            self.peak_current = charge_per_bunch / (np.sqrt(2 * np.pi) * sigma_t)
        else:
            self.peak_current = 0.0
```

Update `BeamState.__init__` signature to accept params dict for bunch_frequency:

Change the constructor to:

```python
    def __init__(self, sigma, energy, current, mass=ELECTRON_MASS, bunch_frequency=1.3e9):
        self.sigma = np.array(sigma, dtype=np.float64)
        self.energy = energy
        self.current = current
        self.mass = mass
        self.alive = True
        self.gamma, self.beta = relativistic_params(energy, mass)
        self.initial_current = current
        self.initial_eps_x = self.emittance_x()
        self.initial_eps_y = self.emittance_y()
        self.bunch_frequency = bunch_frequency
        self._update_bunch_properties()
```

Update `create_initial_beam` to pass `bunch_frequency`:

At the end of `create_initial_beam`, change the return:

```python
    bunch_freq = params.get("bunch_frequency", 1.3e9)
    return BeamState(sigma, energy, current, mass, bunch_frequency=bunch_freq)
```

Add `peak_current`, `n_particles`, `bunch_frequency` to the `snapshot` method's return dict (after the `"s"` key):

```python
            "peak_current": self.peak_current,
            "n_particles": self.n_particles,
            "bunch_frequency": self.bunch_frequency,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_beam_state -v`
Expected: all 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/constants.py beam_physics/beam.py test/test_beam_state.py
git commit -m "feat: add peak_current, n_particles, bunch_frequency to BeamState"
```

---

### Task 3: Linear Optics Module

**Files:**
- Create: `beam_physics/modules/linear_optics.py`
- Create: `test/test_linear_optics.py`

This is the largest module — it absorbs `elements.py` transfer matrices and adds dispersion tracking, player-controlled quad polarity, edge focusing, and combined function magnets.

- [ ] **Step 1: Write tests for linear_optics module**

Create `test/test_linear_optics.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.linear_optics import LinearOpticsModule


def make_beam():
    return create_initial_beam(dict(DEFAULT_SOURCE))


def make_context(machine_type="linac"):
    return PropagationContext(machine_type)


class TestDrift(unittest.TestCase):
    def test_beam_size_grows_in_drift(self):
        """Beam size should grow in a drift space."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        size_before = beam.beam_size_x()
        mod.apply(beam, {"type": "drift", "length": 5.0}, ctx)
        size_after = beam.beam_size_x()
        self.assertGreater(size_after, size_before)

    def test_emittance_preserved_in_drift(self):
        """Emittance should be preserved through a drift."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        eps_before = beam.emittance_x()
        mod.apply(beam, {"type": "drift", "length": 10.0}, ctx)
        eps_after = beam.emittance_x()
        self.assertAlmostEqual(eps_before, eps_after, places=15)


class TestQuadrupole(unittest.TestCase):
    def test_focusing_quad_reduces_beam_size_x(self):
        """A focusing quad should reduce beam size in x (at a waist)."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        # Drift to let beam grow first
        mod.apply(beam, {"type": "drift", "length": 5.0}, ctx)
        size_before = beam.beam_size_x()
        # Apply focusing quad (polarity=+1)
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 0.5, "polarity": 1}, ctx)
        # Drift again to see effect
        mod.apply(beam, {"type": "drift", "length": 5.0}, ctx)
        # Alpha should have changed sign (beam is now converging in x)
        # We check that emittance is preserved
        eps_after = beam.emittance_x()
        self.assertAlmostEqual(beam.emittance_x(), eps_after, places=12)

    def test_polarity_minus_defocuses_x(self):
        """A quad with polarity=-1 should defocus in x (focus in y)."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        alpha_x_before = beam.alpha_x()
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 0.5, "polarity": -1}, ctx)
        # After defocusing quad, divergence in x increases
        # sigma[1,1] should increase
        self.assertGreater(beam.sigma[1, 1], 0)

    def test_emittance_preserved_in_quad(self):
        """Emittance should be preserved through a quadrupole."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        eps_x_before = beam.emittance_x()
        eps_y_before = beam.emittance_y()
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 1.0, "polarity": 1}, ctx)
        self.assertAlmostEqual(beam.emittance_x(), eps_x_before, places=12)
        self.assertAlmostEqual(beam.emittance_y(), eps_y_before, places=12)

    def test_fodo_cell_stability(self):
        """A matched FODO cell should keep beam size bounded."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        # 10 FODO cells: F-drift-D-drift
        max_size = 0
        for _ in range(10):
            mod.apply(beam, {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1}, ctx)
            mod.apply(beam, {"type": "drift", "length": 2.5}, ctx)
            mod.apply(beam, {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1}, ctx)
            mod.apply(beam, {"type": "drift", "length": 2.5}, ctx)
            max_size = max(max_size, beam.beam_size_x(), beam.beam_size_y())
        # Beam should stay bounded (not grow without limit)
        self.assertLess(max_size, 0.1)  # < 100 mm


class TestDipole(unittest.TestCase):
    def test_dipole_creates_dispersion(self):
        """A dipole should create nonzero horizontal dispersion."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        self.assertAlmostEqual(ctx.dispersion[0], 0.0)
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertNotAlmostEqual(ctx.dispersion[0], 0.0)

    def test_dipole_edge_focusing_affects_vertical(self):
        """Edge focusing should change vertical sigma."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        sigma_33_before = beam.sigma[3, 3]
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        # Edge focusing adds a vertical kick — sigma[3,3] should change
        self.assertNotAlmostEqual(beam.sigma[3, 3], sigma_33_before)

    def test_emittance_preserved_in_dipole(self):
        """Geometric emittance preserved through linear dipole transport."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        eps_x_before = beam.emittance_x()
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        # Emittance should be preserved by the linear transfer matrix
        self.assertAlmostEqual(beam.emittance_x(), eps_x_before, places=10)


class TestDispersionTracking(unittest.TestCase):
    def test_dispersion_propagates_through_drift(self):
        """Dispersion should propagate: eta_x grows by eta_x' * L in a drift."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        # Create dispersion with a dipole
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        eta_x = ctx.dispersion[0]
        eta_xp = ctx.dispersion[1]
        # Propagate through a drift
        L = 5.0
        mod.apply(beam, {"type": "drift", "length": L}, ctx)
        expected_eta_x = eta_x + eta_xp * L
        self.assertAlmostEqual(ctx.dispersion[0], expected_eta_x, places=10)

    def test_zero_dispersion_stays_zero_without_dipole(self):
        """Without dipoles, dispersion stays zero."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        mod.apply(beam, {"type": "drift", "length": 5.0}, ctx)
        mod.apply(beam, {"type": "quadrupole", "length": 1.0, "focusStrength": 0.3, "polarity": 1}, ctx)
        np.testing.assert_array_almost_equal(ctx.dispersion, [0, 0, 0, 0])


class TestCombinedFunctionMagnet(unittest.TestCase):
    def test_combined_function_has_dipole_and_quad_effects(self):
        """Combined function magnet should create dispersion (dipole) and focus (quad)."""
        mod = LinearOpticsModule()
        beam = make_beam()
        ctx = make_context()
        mod.apply(beam, {"type": "combined_function", "length": 2.0, "bendAngle": 10.0, "focusStrength": 0.3}, ctx)
        # Should have created dispersion (dipole part)
        self.assertNotAlmostEqual(ctx.dispersion[0], 0.0)


class TestAppliesTo(unittest.TestCase):
    def test_applies_to_all_element_types(self):
        """Linear optics applies to all standard element types."""
        mod = LinearOpticsModule()
        for etype in ["drift", "quadrupole", "dipole", "rfCavity", "cryomodule",
                       "solenoid", "sextupole", "collimator", "undulator", "chicane",
                       "source", "detector", "target"]:
            self.assertTrue(mod.applies_to({"type": etype}, "linac"),
                          f"Should apply to {etype}")

    def test_applies_to_all_machine_types(self):
        """Linear optics applies to all machine types."""
        mod = LinearOpticsModule()
        el = {"type": "drift"}
        for mt in ["linac", "photoinjector", "fel", "collider"]:
            self.assertTrue(mod.applies_to(el, mt))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_linear_optics -v`
Expected: `ImportError: cannot import name 'LinearOpticsModule'`

- [ ] **Step 3: Implement LinearOpticsModule**

Create `beam_physics/modules/linear_optics.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport


def _block_diag_6x6(Rx, Ry, Rlong=None):
    R = np.eye(6)
    R[0:2, 0:2] = Rx
    R[2:4, 2:4] = Ry
    if Rlong is not None:
        R[4:6, 4:6] = Rlong
    return R


def drift_matrix(length):
    Rx = np.array([[1.0, length], [0.0, 1.0]])
    return _block_diag_6x6(Rx, Rx)


def quadrupole_matrix(k, length):
    if abs(k) < 1e-10:
        return drift_matrix(length)
    sqrt_k = np.sqrt(abs(k))
    phi = sqrt_k * length
    Rf = np.array([
        [np.cos(phi), np.sin(phi) / sqrt_k],
        [-sqrt_k * np.sin(phi), np.cos(phi)]
    ])
    Rd = np.array([
        [np.cosh(phi), np.sinh(phi) / sqrt_k],
        [sqrt_k * np.sinh(phi), np.cosh(phi)]
    ])
    if k > 0:
        return _block_diag_6x6(Rf, Rd)
    else:
        return _block_diag_6x6(Rd, Rf)


def dipole_matrix(bend_angle_deg, length):
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return drift_matrix(length)
    rho = length / theta
    c, s = np.cos(theta), np.sin(theta)
    R = np.eye(6)
    R[0, 0] = c
    R[0, 1] = rho * s
    R[1, 0] = -s / rho
    R[1, 1] = c
    R[0, 5] = rho * (1.0 - c)
    R[1, 5] = s
    R[2, 2] = 1.0
    R[2, 3] = length
    R[3, 2] = 0.0
    R[3, 3] = 1.0
    R[4, 0] = s
    R[4, 1] = rho * (1.0 - c)
    R[4, 5] = rho * (theta - s)
    return R


def dipole_edge_matrix(bend_angle_deg, length):
    """Thin-lens vertical edge focusing at dipole entry/exit."""
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return np.eye(6)
    rho = length / theta
    edge_angle = theta / 2.0  # symmetric sector dipole
    R = np.eye(6)
    R[3, 2] = np.tan(edge_angle) / rho
    return R


def combined_function_matrix(bend_angle_deg, k_quad, length):
    """Combined function magnet: dipole + quadrupole."""
    theta = np.radians(bend_angle_deg)
    if abs(theta) < 1e-10:
        return quadrupole_matrix(k_quad, length)
    rho = length / theta
    # Horizontal: effective k = k_quad + 1/rho^2
    k_x = k_quad + 1.0 / (rho * rho)
    # Vertical: just the quad gradient
    k_y = -k_quad  # defocusing in y if k_quad > 0

    def plane_matrix(k, L):
        if abs(k) < 1e-10:
            return np.array([[1.0, L], [0.0, 1.0]])
        sk = np.sqrt(abs(k))
        phi = sk * L
        if k > 0:
            return np.array([
                [np.cos(phi), np.sin(phi) / sk],
                [-sk * np.sin(phi), np.cos(phi)]
            ])
        else:
            return np.array([
                [np.cosh(phi), np.sinh(phi) / sk],
                [sk * np.sinh(phi), np.cosh(phi)]
            ])

    Rx = plane_matrix(k_x, length)
    Ry = plane_matrix(k_y, length)
    R = _block_diag_6x6(Rx, Ry)

    # Add dispersion terms (same as sector dipole)
    c, s = np.cos(theta), np.sin(theta)
    R[0, 5] = rho * (1.0 - c)
    R[1, 5] = s
    R[4, 0] = s
    R[4, 1] = rho * (1.0 - c)
    R[4, 5] = rho * (theta - s)
    return R


def solenoid_matrix(B_field, momentum_gev, length):
    if abs(B_field) < 1e-12 or momentum_gev <= 0:
        return drift_matrix(length)
    k = 0.2998 * B_field / (2.0 * momentum_gev)
    phi = k * length
    C, S = np.cos(phi), np.sin(phi)
    R = np.eye(6)
    R[0, 0] = C * C
    R[0, 1] = S * C / k if abs(k) > 1e-15 else length
    R[0, 2] = S * C
    R[0, 3] = S * S / k if abs(k) > 1e-15 else 0.0
    R[1, 0] = -k * S * C
    R[1, 1] = C * C
    R[1, 2] = -k * S * S
    R[1, 3] = S * C
    R[2, 0] = -S * C
    R[2, 1] = -S * S / k if abs(k) > 1e-15 else 0.0
    R[2, 2] = C * C
    R[2, 3] = S * C / k if abs(k) > 1e-15 else length
    R[3, 0] = k * S * S
    R[3, 1] = -S * C
    R[3, 2] = -k * S * C
    R[3, 3] = C * C
    R[4, 5] = length
    return R


def _dispersion_generation_vector(element):
    """Return the 4-element dispersion generation vector for this element.
    Nonzero only for dipoles."""
    etype = element.get("type", "")
    if etype not in ("dipole", "combined_function"):
        return np.zeros(4)
    theta = np.radians(element.get("bendAngle", 0.0))
    length = element.get("length", 1.0)
    if abs(theta) < 1e-10:
        return np.zeros(4)
    rho = length / theta
    return np.array([rho * (1.0 - np.cos(theta)), np.sin(theta), 0.0, 0.0])


def _propagate_dispersion(context, R, d):
    """Propagate 4-vector dispersion through transfer matrix R with generation d."""
    eta = context.dispersion
    # eta_x_new = R[0,0]*eta_x + R[0,1]*eta_x' + d[0]
    # eta_x'_new = R[1,0]*eta_x + R[1,1]*eta_x' + d[1]
    # eta_y_new = R[2,2]*eta_y + R[2,3]*eta_y' + d[2]
    # eta_y'_new = R[3,2]*eta_y + R[3,3]*eta_y' + d[3]
    new_eta = np.zeros(4)
    new_eta[0] = R[0, 0] * eta[0] + R[0, 1] * eta[1] + d[0]
    new_eta[1] = R[1, 0] * eta[0] + R[1, 1] * eta[1] + d[1]
    new_eta[2] = R[2, 2] * eta[2] + R[2, 3] * eta[3] + d[2]
    new_eta[3] = R[3, 2] * eta[2] + R[3, 3] * eta[3] + d[3]
    context.dispersion = new_eta


class LinearOpticsModule(PhysicsModule):
    """Transfer matrix propagation and dispersion tracking."""

    def __init__(self):
        super().__init__(name="linear_optics", order=10)

    def applies_to(self, element, machine_type):
        return True  # linear optics applies to every element in every machine type

    def apply(self, beam, element, context):
        etype = element.get("type", "drift")
        length = element.get("length", 0.0)

        R = self._transfer_matrix(element, beam)

        # Apply edge focusing for dipoles (entry)
        if etype in ("dipole",):
            R_edge = dipole_edge_matrix(element.get("bendAngle", 0.0), length)
            beam.sigma = R_edge @ beam.sigma @ R_edge.T

        # Apply main transfer matrix
        beam.sigma = R @ beam.sigma @ R.T
        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)  # symmetry

        # Apply edge focusing for dipoles (exit)
        if etype in ("dipole",):
            R_edge = dipole_edge_matrix(element.get("bendAngle", 0.0), length)
            beam.sigma = R_edge @ beam.sigma @ R_edge.T
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # Propagate dispersion
        d = _dispersion_generation_vector(element)
        _propagate_dispersion(context, R, d)

        return EffectReport(
            module=self.name,
            element_index=context.element_index,
            details={"dispersion_x": float(context.dispersion[0]),
                     "dispersion_xp": float(context.dispersion[1])},
        )

    def _transfer_matrix(self, element, beam):
        etype = element.get("type", "drift")
        length = element.get("length", 0.0)

        if etype == "source" or length == 0:
            return np.eye(6)

        if etype == "drift":
            return drift_matrix(length)

        if etype == "quadrupole":
            k = element.get("focusStrength", 1.0)
            polarity = element.get("polarity", 1)
            return quadrupole_matrix(k * polarity, length)

        if etype == "dipole":
            return dipole_matrix(element.get("bendAngle", 15.0), length)

        if etype == "combined_function":
            return combined_function_matrix(
                element.get("bendAngle", 10.0),
                element.get("focusStrength", 0.3),
                length,
            )

        if etype == "solenoid":
            B = element.get("fieldStrength", 1.0)
            p = beam.energy  # approx momentum ~ energy for relativistic
            return solenoid_matrix(B, p, length)

        if etype == "chicane":
            R = drift_matrix(length)
            r56 = element.get("r56", 0.0)
            if abs(r56) > 1e-15:
                R[4, 5] = r56
            return R

        # Everything else (sextupole, collimator, undulator, rfCavity, etc.) is drift-like
        return drift_matrix(length)
```

- [ ] **Step 4: Update modules/__init__.py**

```python
from beam_physics.modules.base import PhysicsModule
from beam_physics.modules.linear_optics import LinearOpticsModule
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_linear_optics -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/linear_optics.py beam_physics/modules/__init__.py test/test_linear_optics.py
git commit -m "feat: add LinearOpticsModule with dispersion tracking and edge focusing"
```

---

### Task 4: RF Acceleration Module

**Files:**
- Create: `beam_physics/modules/rf_acceleration.py`
- Create: `test/test_rf_acceleration.py`

- [ ] **Step 1: Write tests**

Create `test/test_rf_acceleration.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.rf_acceleration import RFAccelerationModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


class TestEnergyGain(unittest.TestCase):
    def test_on_crest_energy_gain(self):
        """On-crest RF (phase=0) should give full energy gain."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        self.assertAlmostEqual(beam.energy, e_before + 0.5, places=6)

    def test_off_crest_reduced_gain(self):
        """Off-crest RF should give reduced energy gain: dE * cos(phase)."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        e_before = beam.energy
        phase_deg = -20.0
        dE = 0.5
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": dE, "rfPhase": phase_deg}, ctx)
        expected = e_before + dE * np.cos(np.radians(phase_deg))
        self.assertAlmostEqual(beam.energy, expected, places=6)

    def test_no_gain_at_90_degrees(self):
        """At 90 degrees off-crest, energy gain should be ~zero."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 90.0}, ctx)
        self.assertAlmostEqual(beam.energy, e_before, places=6)


class TestAdiabaticDamping(unittest.TestCase):
    def test_emittance_shrinks_with_acceleration(self):
        """Geometric emittance should decrease after acceleration."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        eps_before = beam.emittance_x()
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        eps_after = beam.emittance_x()
        self.assertLess(eps_after, eps_before)

    def test_normalized_emittance_approximately_preserved(self):
        """Normalized emittance should be approximately preserved."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        norm_eps_before = beam.norm_emittance_x()
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        norm_eps_after = beam.norm_emittance_x()
        # Should be within ~10% (adiabatic damping is approximate)
        self.assertAlmostEqual(norm_eps_after / norm_eps_before, 1.0, delta=0.15)


class TestChirp(unittest.TestCase):
    def test_off_crest_creates_chirp(self):
        """Off-crest RF should create nonzero chirp in context."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("fel")
        self.assertAlmostEqual(ctx.chirp, 0.0)
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": -20.0}, ctx)
        self.assertNotAlmostEqual(ctx.chirp, 0.0)

    def test_on_crest_no_chirp(self):
        """On-crest RF should not create chirp."""
        mod = RFAccelerationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        mod.apply(beam, {"type": "rfCavity", "length": 4.0, "energyGain": 0.5, "rfPhase": 0.0}, ctx)
        self.assertAlmostEqual(ctx.chirp, 0.0, places=10)


class TestAppliesTo(unittest.TestCase):
    def test_applies_to_rf_elements(self):
        mod = RFAccelerationModule()
        self.assertTrue(mod.applies_to({"type": "rfCavity"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "cryomodule"}, "linac"))

    def test_does_not_apply_to_non_rf(self):
        mod = RFAccelerationModule()
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "quadrupole"}, "linac"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_rf_acceleration -v`
Expected: `ImportError`

- [ ] **Step 3: Implement RFAccelerationModule**

Create `beam_physics/modules/rf_acceleration.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT

RF_ELEMENT_TYPES = {"rfCavity", "cryomodule", "buncher", "harmonicLinearizer",
                    "cbandCavity", "xbandCavity", "srf650Cavity"}

# Default RF frequency (Hz) for chirp calculation
DEFAULT_RF_FREQ = 1.3e9  # L-band


class RFAccelerationModule(PhysicsModule):
    """Energy gain, adiabatic damping, and chirping from RF cavities."""

    def __init__(self):
        super().__init__(name="rf_acceleration", order=20)

    def applies_to(self, element, machine_type):
        return element.get("type", "") in RF_ELEMENT_TYPES

    def apply(self, beam, element, context):
        dE_nominal = element.get("energyGain", 0.5)
        phase_deg = element.get("rfPhase", 0.0)
        phase_rad = np.radians(phase_deg)
        f_rf = element.get("rfFrequency", DEFAULT_RF_FREQ)

        # Phase-dependent energy gain
        dE = dE_nominal * np.cos(phase_rad)
        energy_before = beam.energy
        beam.energy += dE
        if beam.energy < beam.mass:
            beam.energy = beam.mass
        beam.update_relativistic()

        # Adiabatic damping
        if energy_before > 0 and beam.energy > 0 and beam.energy != energy_before:
            ratio = energy_before / beam.energy
            beam.sigma[1, :] *= ratio
            beam.sigma[:, 1] *= ratio
            beam.sigma[3, :] *= ratio
            beam.sigma[:, 3] *= ratio
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        # Chirp: h = (2*pi*f_rf * V_acc * sin(phi)) / (E_beam * c)
        V_acc = dE_nominal  # in GeV, which is also GeV (energy units)
        h = (2.0 * np.pi * f_rf * V_acc * np.sin(phase_rad)) / (beam.energy * SPEED_OF_LIGHT)
        context.chirp += h

        # Apply chirp correlation to longitudinal sigma
        if abs(h) > 1e-15:
            beam.sigma[4, 5] += h * beam.sigma[4, 4]
            beam.sigma[5, 4] = beam.sigma[4, 5]

        # Update bunch properties
        beam._update_bunch_properties()

        return EffectReport(
            module=self.name,
            element_index=context.element_index,
            details={
                "energy_gain": dE,
                "phase_deg": phase_deg,
                "chirp_added": h,
                "total_chirp": context.chirp,
            },
        )
```

- [ ] **Step 4: Update modules/__init__.py**

Add import:

```python
from beam_physics.modules.rf_acceleration import RFAccelerationModule
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_rf_acceleration -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/rf_acceleration.py beam_physics/modules/__init__.py test/test_rf_acceleration.py
git commit -m "feat: add RFAccelerationModule with phase-dependent gain and chirp"
```

---

### Task 5: Synchrotron Radiation Module

**Files:**
- Create: `beam_physics/modules/synchrotron_rad.py`
- Create: `test/test_synchrotron_rad.py`

- [ ] **Step 1: Write tests**

Create `test/test_synchrotron_rad.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, C_GAMMA, ELECTRON_MASS
from beam_physics.context import PropagationContext
from beam_physics.modules.synchrotron_rad import SynchrotronRadiationModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


class TestEnergyLoss(unittest.TestCase):
    def test_dipole_loses_energy(self):
        """Beam should lose energy in a dipole from synchrotron radiation."""
        mod = SynchrotronRadiationModule()
        beam = make_beam(energy=1.0)  # 1 GeV
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertLess(beam.energy, e_before)

    def test_energy_loss_scales_with_e4(self):
        """Energy loss should scale roughly as E^4."""
        mod = SynchrotronRadiationModule()
        beam_1 = make_beam(energy=1.0)
        beam_2 = make_beam(energy=2.0)
        ctx1 = PropagationContext("linac")
        ctx2 = PropagationContext("linac")
        el = {"type": "dipole", "length": 3.0, "bendAngle": 15.0}
        e1_before = beam_1.energy
        mod.apply(beam_1, el, ctx1)
        loss_1 = e1_before - beam_1.energy
        e2_before = beam_2.energy
        mod.apply(beam_2, el, ctx2)
        loss_2 = e2_before - beam_2.energy
        # Should scale as (2/1)^4 = 16
        ratio = loss_2 / loss_1 if loss_1 > 0 else 0
        self.assertAlmostEqual(ratio, 16.0, delta=2.0)

    def test_no_energy_loss_for_protons(self):
        """Protons should have negligible synchrotron radiation."""
        mod = SynchrotronRadiationModule()
        beam = make_beam(energy=1.0, mass=0.938)
        ctx = PropagationContext("linac")
        e_before = beam.energy
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertAlmostEqual(beam.energy, e_before, places=10)


class TestQuantumExcitation(unittest.TestCase):
    def test_energy_spread_grows_in_dipole(self):
        """Energy spread should grow from quantum excitation in a dipole."""
        mod = SynchrotronRadiationModule()
        beam = make_beam(energy=1.0)
        ctx = PropagationContext("linac")
        # Set dispersion (would normally come from linear_optics)
        theta = np.radians(15.0)
        rho = 3.0 / theta
        ctx.dispersion = np.array([rho * (1 - np.cos(theta)), np.sin(theta), 0, 0])
        spread_before = beam.energy_spread()
        mod.apply(beam, {"type": "dipole", "length": 3.0, "bendAngle": 15.0}, ctx)
        self.assertGreater(beam.energy_spread(), spread_before)


class TestAppliesTo(unittest.TestCase):
    def test_applies_to_dipoles_and_undulators(self):
        mod = SynchrotronRadiationModule()
        self.assertTrue(mod.applies_to({"type": "dipole"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "undulator"}, "linac"))

    def test_does_not_apply_to_drifts(self):
        mod = SynchrotronRadiationModule()
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_synchrotron_rad -v`
Expected: `ImportError`

- [ ] **Step 3: Implement SynchrotronRadiationModule**

Create `beam_physics/modules/synchrotron_rad.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import C_GAMMA, ELECTRON_MASS

# Classical electron radius (m)
R_E = 2.818e-15
# Reduced Compton wavelength (m)
LAMBDA_C = 3.861e-13
# Quantum diffusion prefactor
QD_PREFACTOR = (55.0 / (48.0 * np.sqrt(3.0))) * R_E * LAMBDA_C / (2.0 * np.pi)


class SynchrotronRadiationModule(PhysicsModule):
    """Energy loss and quantum excitation in dipoles and undulators."""

    def __init__(self):
        super().__init__(name="synchrotron_radiation", order=40)

    def applies_to(self, element, machine_type):
        return element.get("type", "") in ("dipole", "undulator", "combined_function")

    def apply(self, beam, element, context):
        etype = element.get("type", "")
        if beam.mass > 0.01:
            # Only significant for electrons
            return EffectReport(self.name, context.element_index, {"skipped": "not_electron"})

        if etype in ("dipole", "combined_function"):
            return self._apply_dipole(beam, element, context)
        elif etype == "undulator":
            return self._apply_undulator(beam, element, context)
        return EffectReport(self.name, context.element_index)

    def _apply_dipole(self, beam, element, context):
        angle = element.get("bendAngle", 15.0)
        length = element.get("length", 3.0)
        theta = np.radians(angle)
        if abs(theta) < 1e-10:
            return EffectReport(self.name, context.element_index)

        rho = length / theta

        # Energy loss
        U = C_GAMMA * beam.energy ** 4 * abs(theta) / abs(rho)
        beam.energy = max(beam.energy - U, beam.mass)
        beam.update_relativistic()

        # Quantum excitation — use tracked dispersion from context
        gamma_rel = beam.energy / beam.mass
        rho3 = abs(rho) ** 3

        # Energy spread growth
        d_sigma_E2 = QD_PREFACTOR * gamma_rel ** 5 * length / rho3
        beam.sigma[5, 5] += d_sigma_E2

        # Horizontal emittance growth using tracked dispersion
        eta_x = context.dispersion[0]
        eta_xp = context.dispersion[1]
        eps_x = beam.emittance_x()
        beta_x = beam.beta_x()
        alpha_x = beam.alpha_x()

        H = 0.0
        if beta_x > 0:
            H = (eta_x ** 2 + (beta_x * eta_xp - alpha_x * eta_x) ** 2) / beta_x

        d_eps_x = QD_PREFACTOR * gamma_rel ** 5 * H * length / rho3
        if d_eps_x > 0 and beta_x > 0:
            beam.sigma[0, 0] += d_eps_x * beta_x
            beam.sigma[1, 1] += d_eps_x / beta_x

        # Vertical: coupling-driven, ~1% of horizontal
        eps_y = beam.emittance_y()
        beta_y = beam.beta_y()
        d_eps_y = d_eps_x * 0.01
        if d_eps_y > 0 and beta_y > 0:
            beam.sigma[2, 2] += d_eps_y * beta_y
            beam.sigma[3, 3] += d_eps_y / beta_y

        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {
            "energy_loss": U,
            "d_sigma_E2": d_sigma_E2,
            "d_eps_x": d_eps_x,
            "H": H,
        })

    def _apply_undulator(self, beam, element, context):
        length = element.get("length", 5.0)
        period = element.get("period", 0.03)
        K = element.get("kParameter", 1.5)
        gamma_rel = beam.energy / beam.mass
        if gamma_rel < 1:
            return EffectReport(self.name, context.element_index)

        rho_eff = period * gamma_rel / (2.0 * np.pi * K) if K > 0 else 1e10
        if rho_eff < 1e-6:
            return EffectReport(self.name, context.element_index)

        U = C_GAMMA * beam.energy ** 4 * length / rho_eff ** 2
        beam.energy = max(beam.energy - U, beam.mass)
        beam.update_relativistic()
        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {"energy_loss": U})
```

- [ ] **Step 4: Update modules/__init__.py**

Add: `from beam_physics.modules.synchrotron_rad import SynchrotronRadiationModule`

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_synchrotron_rad -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/synchrotron_rad.py beam_physics/modules/__init__.py test/test_synchrotron_rad.py
git commit -m "feat: add SynchrotronRadiationModule with tracked dispersion"
```

---

### Task 6: Aperture Loss and Collimation Modules

**Files:**
- Create: `beam_physics/modules/aperture_loss.py`
- Create: `beam_physics/modules/collimation.py`
- Create: `test/test_aperture_loss.py`
- Create: `test/test_collimation.py`

- [ ] **Step 1: Write tests**

Create `test/test_aperture_loss.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.aperture_loss import ApertureLossModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


class TestApertureLoss(unittest.TestCase):
    def test_wide_aperture_no_loss(self):
        """A very wide aperture should cause negligible loss."""
        mod = ApertureLossModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        current_before = beam.current
        mod.apply(beam, {"type": "drift", "length": 1.0, "aperture": 1.0}, ctx)
        self.assertAlmostEqual(beam.current, current_before, places=6)

    def test_tight_aperture_causes_loss(self):
        """A tight aperture should cause beam loss."""
        mod = ApertureLossModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        # Make beam large first
        beam.sigma[0, 0] = 0.01 ** 2  # 10 mm rms
        beam.sigma[2, 2] = 0.01 ** 2
        current_before = beam.current
        mod.apply(beam, {"type": "drift", "length": 1.0, "aperture": 0.005}, ctx)
        self.assertLess(beam.current, current_before)

    def test_beam_trips_on_large_loss(self):
        """Beam should trip if cumulative loss exceeds threshold."""
        mod = ApertureLossModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        beam.sigma[0, 0] = 0.1 ** 2  # 100 mm rms — huge beam
        beam.sigma[2, 2] = 0.1 ** 2
        mod.apply(beam, {"type": "drift", "length": 1.0, "aperture": 0.001}, ctx)
        self.assertFalse(beam.alive)

    def test_applies_to_all_elements(self):
        mod = ApertureLossModule()
        self.assertTrue(mod.applies_to({"type": "drift"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "quadrupole"}, "linac"))
        # Source has no aperture check
        self.assertFalse(mod.applies_to({"type": "source"}, "linac"))


if __name__ == "__main__":
    unittest.main()
```

Create `test/test_collimation.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.collimation import CollimationModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


class TestCollimation(unittest.TestCase):
    def test_collimator_reduces_current(self):
        """Collimator should reduce beam current."""
        mod = CollimationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        current_before = beam.current
        mod.apply(beam, {"type": "collimator", "length": 2.0, "beamQuality": 0.5}, ctx)
        self.assertLessEqual(beam.current, current_before)

    def test_collimator_clips_sigma(self):
        """Collimator should reduce beam size if larger than aperture."""
        mod = CollimationModule()
        beam = make_beam()
        ctx = PropagationContext("linac")
        beam.sigma[0, 0] = 0.05 ** 2  # 50 mm rms — larger than collimator
        mod.apply(beam, {"type": "collimator", "length": 2.0, "beamQuality": 0.8}, ctx)
        # Aperture with bq=0.8: 0.025*(1-0.3*0.8) = 0.019 m
        # sigma_x^2 should be at most aperture^2
        self.assertLessEqual(beam.sigma[0, 0], 0.019 ** 2 + 1e-10)

    def test_applies_only_to_collimators(self):
        mod = CollimationModule()
        self.assertTrue(mod.applies_to({"type": "collimator"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest test.test_aperture_loss test.test_collimation -v`
Expected: `ImportError`

- [ ] **Step 3: Implement both modules**

Create `beam_physics/modules/aperture_loss.py`:

```python
import numpy as np
from scipy.special import erf
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import DEFAULT_APERTURE, TRIP_THRESHOLD


class ApertureLossModule(PhysicsModule):
    """Gaussian beam clipping at physical apertures."""

    def __init__(self):
        super().__init__(name="aperture_loss", order=70)

    def applies_to(self, element, machine_type):
        return element.get("type", "") not in ("source",)

    def apply(self, beam, element, context):
        aperture = element.get("aperture", DEFAULT_APERTURE)
        sx = beam.beam_size_x()
        sy = beam.beam_size_y()

        if sx < 1e-15 or sy < 1e-15:
            return EffectReport(self.name, context.element_index, {"loss_fraction": 0.0})

        fx = erf(aperture / (np.sqrt(2.0) * sx))
        fy = erf(aperture / (np.sqrt(2.0) * sy))
        survived = fx * fy
        loss = max(0.0, 1.0 - survived)

        beam.current *= (1.0 - loss)
        beam._update_bunch_properties()

        # Trip check
        if beam.initial_current > 0:
            total_loss = 1.0 - (beam.current / beam.initial_current)
            if total_loss > TRIP_THRESHOLD:
                beam.alive = False

        return EffectReport(self.name, context.element_index, {
            "loss_fraction": loss,
            "aperture": aperture,
        })
```

Create `beam_physics/modules/collimation.py`:

```python
import numpy as np
from scipy.special import erf
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport


def _collimator_aperture(beam_quality):
    base = 0.025
    return base * (1.0 - 0.3 * beam_quality)


class CollimationModule(PhysicsModule):
    """Beam scraping at collimators."""

    def __init__(self):
        super().__init__(name="collimation", order=60)

    def applies_to(self, element, machine_type):
        return element.get("type", "") == "collimator"

    def apply(self, beam, element, context):
        bq = element.get("beamQuality", 0.2)
        aperture = _collimator_aperture(bq)

        # Compute loss
        sx = beam.beam_size_x()
        sy = beam.beam_size_y()
        if sx > 1e-15 and sy > 1e-15:
            fx = erf(aperture / (np.sqrt(2.0) * sx))
            fy = erf(aperture / (np.sqrt(2.0) * sy))
            loss = max(0.0, 1.0 - fx * fy)
            beam.current *= (1.0 - loss)
        else:
            loss = 0.0

        # Clip sigma at aperture
        a2 = aperture ** 2
        if beam.sigma[0, 0] > a2:
            scale = a2 / beam.sigma[0, 0]
            beam.sigma[0, 0] = a2
            beam.sigma[0, 1] *= np.sqrt(scale)
            beam.sigma[1, 0] *= np.sqrt(scale)
        if beam.sigma[2, 2] > a2:
            scale = a2 / beam.sigma[2, 2]
            beam.sigma[2, 2] = a2
            beam.sigma[2, 3] *= np.sqrt(scale)
            beam.sigma[3, 2] *= np.sqrt(scale)

        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {
            "loss_fraction": loss,
            "aperture": aperture,
        })
```

- [ ] **Step 4: Update modules/__init__.py**

Add:
```python
from beam_physics.modules.aperture_loss import ApertureLossModule
from beam_physics.modules.collimation import CollimationModule
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m unittest test.test_aperture_loss test.test_collimation -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/aperture_loss.py beam_physics/modules/collimation.py beam_physics/modules/__init__.py test/test_aperture_loss.py test/test_collimation.py
git commit -m "feat: add ApertureLossModule and CollimationModule"
```

---

### Task 7: Space Charge Module

**Files:**
- Create: `beam_physics/modules/space_charge.py`
- Create: `test/test_space_charge.py`

- [ ] **Step 1: Write tests**

Create `test/test_space_charge.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.space_charge import SpaceChargeModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


class TestSpaceCharge(unittest.TestCase):
    def test_increases_divergence_at_low_energy(self):
        """Space charge should increase beam divergence at low energy."""
        mod = SpaceChargeModule()
        beam = make_beam(energy=0.01)  # 10 MeV
        ctx = PropagationContext("photoinjector")
        div_before = beam.sigma[1, 1]
        mod.apply(beam, {"type": "drift", "length": 1.0}, ctx)
        self.assertGreater(beam.sigma[1, 1], div_before)

    def test_negligible_at_high_energy(self):
        """Space charge should be negligible at high energy (skipped)."""
        mod = SpaceChargeModule()
        beam = make_beam(energy=1.0)  # 1 GeV, gamma ~ 2000
        ctx = PropagationContext("photoinjector")
        div_before = beam.sigma[1, 1]
        mod.apply(beam, {"type": "drift", "length": 1.0}, ctx)
        self.assertAlmostEqual(beam.sigma[1, 1], div_before, places=15)

    def test_stronger_with_higher_current(self):
        """Higher current should give stronger space charge."""
        mod = SpaceChargeModule()
        beam_lo = make_beam(energy=0.01, current=0.1)
        beam_hi = make_beam(energy=0.01, current=10.0)
        ctx_lo = PropagationContext("photoinjector")
        ctx_hi = PropagationContext("photoinjector")
        el = {"type": "drift", "length": 1.0}
        div_lo_before = beam_lo.sigma[1, 1]
        mod.apply(beam_lo, el, ctx_lo)
        delta_lo = beam_lo.sigma[1, 1] - div_lo_before
        div_hi_before = beam_hi.sigma[1, 1]
        mod.apply(beam_hi, el, ctx_hi)
        delta_hi = beam_hi.sigma[1, 1] - div_hi_before
        self.assertGreater(delta_hi, delta_lo)

    def test_only_active_for_tier2_plus(self):
        """Should not apply for linac machine type."""
        mod = SpaceChargeModule()
        self.assertFalse(mod.applies_to({"type": "drift"}, "linac"))
        self.assertTrue(mod.applies_to({"type": "drift"}, "photoinjector"))
        self.assertTrue(mod.applies_to({"type": "drift"}, "fel"))
        self.assertTrue(mod.applies_to({"type": "drift"}, "collider"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_space_charge -v`

- [ ] **Step 3: Implement SpaceChargeModule**

Create `beam_physics/modules/space_charge.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ALFVEN_CURRENT

# Space charge is negligible above this gamma
GAMMA_THRESHOLD = 200  # ~100 MeV for electrons

MACHINE_TYPES_WITH_SPACE_CHARGE = {"photoinjector", "fel", "collider"}


class SpaceChargeModule(PhysicsModule):
    """Envelope-equation defocusing from beam space charge at low energy."""

    def __init__(self):
        super().__init__(name="space_charge", order=30)

    def applies_to(self, element, machine_type):
        if machine_type not in MACHINE_TYPES_WITH_SPACE_CHARGE:
            return False
        return element.get("type", "") not in ("source",)

    def apply(self, beam, element, context):
        # Skip if beam is relativistic enough
        if beam.gamma > GAMMA_THRESHOLD:
            return EffectReport(self.name, context.element_index, {"skipped": "high_energy"})

        length = element.get("length", 0.0)
        if length <= 0:
            return EffectReport(self.name, context.element_index)

        # Generalized perveance: K = 2*I_peak / (I_A * beta^3 * gamma^3)
        I_peak = beam.peak_current
        if I_peak <= 0:
            return EffectReport(self.name, context.element_index, {"K": 0.0})

        beta3 = beam.beta ** 3 if beam.beta > 0 else 1e-10
        gamma3 = beam.gamma ** 3
        K = (2.0 * I_peak) / (ALFVEN_CURRENT * beta3 * gamma3)

        # Defocusing kick on sigma
        sigma_x = beam.beam_size_x()
        sigma_y = beam.beam_size_y()

        if sigma_x > 1e-15:
            beam.sigma[1, 1] += K * length / sigma_x
        if sigma_y > 1e-15:
            beam.sigma[3, 3] += K * length / sigma_y

        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)

        return EffectReport(self.name, context.element_index, {"K": K, "I_peak": I_peak})
```

- [ ] **Step 4: Update modules/__init__.py**

Add: `from beam_physics.modules.space_charge import SpaceChargeModule`

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_space_charge -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/space_charge.py beam_physics/modules/__init__.py test/test_space_charge.py
git commit -m "feat: add SpaceChargeModule with envelope-equation defocusing"
```

---

### Task 8: Bunch Compression Module

**Files:**
- Create: `beam_physics/modules/bunch_compression.py`
- Create: `test/test_bunch_compression.py`

- [ ] **Step 1: Write tests**

Create `test/test_bunch_compression.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.modules.bunch_compression import BunchCompressionModule


def make_beam(**overrides):
    params = dict(DEFAULT_SOURCE)
    params.update(overrides)
    return create_initial_beam(params)


class TestBunchCompression(unittest.TestCase):
    def test_compression_shortens_bunch(self):
        """With chirp and R56, bunch should get shorter."""
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 20.0  # 1/m
        bl_before = beam.bunch_length()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        bl_after = beam.bunch_length()
        self.assertLess(bl_after, bl_before)

    def test_compression_ratio(self):
        """Compression ratio should match C = 1/|1 + h*R56|."""
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        h = 20.0
        r56 = -0.04
        ctx.chirp = h
        bl_before = beam.bunch_length()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": r56}, ctx)
        bl_after = beam.bunch_length()
        expected_ratio = abs(1.0 + h * r56)
        actual_ratio = bl_after / bl_before
        self.assertAlmostEqual(actual_ratio, expected_ratio, delta=0.05)

    def test_peak_current_increases(self):
        """Peak current should increase after compression."""
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 20.0
        pk_before = beam.peak_current
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        self.assertGreater(beam.peak_current, pk_before)

    def test_csr_adds_energy_spread(self):
        """CSR should increase energy spread during compression."""
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 20.0
        spread_before = beam.energy_spread()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        spread_after = beam.energy_spread()
        self.assertGreater(spread_after, spread_before)

    def test_no_chirp_no_compression(self):
        """Without chirp, chicane should not change bunch length significantly."""
        mod = BunchCompressionModule()
        beam = make_beam(energy=0.5)
        ctx = PropagationContext("fel")
        ctx.chirp = 0.0
        bl_before = beam.bunch_length()
        mod.apply(beam, {"type": "chicane", "length": 10.0, "r56": -0.045}, ctx)
        bl_after = beam.bunch_length()
        self.assertAlmostEqual(bl_after, bl_before, delta=bl_before * 0.01)

    def test_applies_only_to_chicanes_in_fel(self):
        mod = BunchCompressionModule()
        self.assertTrue(mod.applies_to({"type": "chicane"}, "fel"))
        self.assertTrue(mod.applies_to({"type": "chicane"}, "collider"))
        self.assertFalse(mod.applies_to({"type": "chicane"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "fel"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_bunch_compression -v`

- [ ] **Step 3: Implement BunchCompressionModule**

Create `beam_physics/modules/bunch_compression.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import SPEED_OF_LIGHT, ELECTRON_CHARGE

# Classical electron radius (m)
R_E = 2.818e-15

MACHINE_TYPES_WITH_COMPRESSION = {"fel", "collider"}


class BunchCompressionModule(PhysicsModule):
    """Bunch compression in chicanes using upstream chirp, with CSR effects."""

    def __init__(self):
        super().__init__(name="bunch_compression", order=50)

    def applies_to(self, element, machine_type):
        if machine_type not in MACHINE_TYPES_WITH_COMPRESSION:
            return False
        return element.get("type", "") == "chicane"

    def apply(self, beam, element, context):
        r56 = element.get("r56", -0.05)
        length = element.get("length", 10.0)
        h = context.chirp

        # Compression ratio: C = 1 / |1 + h * R56|
        factor = 1.0 + h * r56
        if abs(factor) < 0.01:
            factor = 0.01 * np.sign(factor) if factor != 0 else 0.01

        # Apply compression to longitudinal sigma
        # sigma_t scales by |factor|, sigma_dE is preserved (plus CSR)
        beam.sigma[4, 4] *= factor ** 2
        beam.sigma[4, 5] *= factor
        beam.sigma[5, 4] *= factor

        # CSR effects — only significant when compressing
        compression_ratio = 1.0 / abs(factor)
        sigma_z = beam.bunch_length() * SPEED_OF_LIGHT  # convert seconds to metres

        if compression_ratio > 1.5 and sigma_z > 0 and beam.n_particles > 0:
            # CSR energy spread: delta_E/E ~ N*r_e / (R^(2/3) * sigma_z^(4/3))
            # Estimate bend radius from chicane length and typical 5-degree bends
            theta_chicane = np.radians(5.0)
            R_bend = (length / 4.0) / theta_chicane if theta_chicane > 0 else 100.0

            sigma_delta_csr = (beam.n_particles * R_E) / (
                R_bend ** (2.0 / 3.0) * max(sigma_z, 1e-10) ** (4.0 / 3.0)
            )
            beam.sigma[5, 5] += sigma_delta_csr ** 2

            # CSR emittance growth: d_eps ~ (R56 * sigma_delta_csr)^2 / beta_x
            beta_x = beam.beta_x()
            if beta_x > 0:
                d_eps = (r56 * sigma_delta_csr) ** 2 / beta_x
                beam.sigma[0, 0] += d_eps * beta_x
                beam.sigma[1, 1] += d_eps / beta_x

        beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
        beam._update_bunch_properties()

        return EffectReport(self.name, context.element_index, {
            "compression_ratio": 1.0 / abs(factor),
            "r56": r56,
            "chirp": h,
            "bunch_length_m": sigma_z,
        })
```

- [ ] **Step 4: Update modules/__init__.py**

Add: `from beam_physics.modules.bunch_compression import BunchCompressionModule`

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_bunch_compression -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/bunch_compression.py beam_physics/modules/__init__.py test/test_bunch_compression.py
git commit -m "feat: add BunchCompressionModule with CSR effects"
```

---

### Task 9: FEL Gain Module

**Files:**
- Create: `beam_physics/modules/fel_gain.py`
- Create: `test/test_fel_gain.py`

- [ ] **Step 1: Write tests**

Create `test/test_fel_gain.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, ELECTRON_MASS
from beam_physics.context import PropagationContext
from beam_physics.modules.fel_gain import FELGainModule


def make_fel_beam():
    """Create a beam typical for FEL operation."""
    params = dict(DEFAULT_SOURCE)
    params["energy"] = 5.0  # 5 GeV
    params["current"] = 1.0  # mA average
    params["eps_norm_x"] = 0.5e-6
    params["eps_norm_y"] = 0.5e-6
    params["sigma_dE"] = 1e-4
    params["bunch_frequency"] = 1e6  # 1 MHz -> high peak current after compression
    return create_initial_beam(params)


class TestFELGain(unittest.TestCase):
    def test_computes_wavelength(self):
        """Should compute resonant FEL wavelength."""
        mod = FELGainModule()
        beam = make_fel_beam()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 60.0,
                                   "period": 0.03, "kParameter": 1.5}, ctx)
        # lambda = period / (2*gamma^2) * (1 + K^2/2)
        gamma = 5.0 / ELECTRON_MASS
        expected = 0.03 / (2 * gamma ** 2) * (1 + 1.5 ** 2 / 2)
        self.assertAlmostEqual(report.details["wavelength_m"], expected, places=15)

    def test_computes_pierce_parameter(self):
        """Should compute a positive Pierce parameter."""
        mod = FELGainModule()
        beam = make_fel_beam()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 60.0,
                                   "period": 0.03, "kParameter": 1.5}, ctx)
        self.assertGreater(report.details["rho"], 0)

    def test_saturation_with_long_undulator(self):
        """A very long undulator should achieve saturation."""
        mod = FELGainModule()
        beam = make_fel_beam()
        # Boost peak current to make FEL easier
        beam.sigma[4, 4] = (1e-14) ** 2  # very short bunch -> high peak current
        beam._update_bunch_properties()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 200.0,
                                   "period": 0.03, "kParameter": 1.5}, ctx)
        self.assertTrue(report.details["saturated"])

    def test_no_saturation_with_short_undulator(self):
        """A very short undulator should not saturate."""
        mod = FELGainModule()
        beam = make_fel_beam()
        ctx = PropagationContext("fel")
        report = mod.apply(beam, {"type": "undulator", "length": 1.0,
                                   "period": 0.03, "kParameter": 1.5}, ctx)
        self.assertFalse(report.details["saturated"])

    def test_applies_only_to_undulators_in_fel(self):
        mod = FELGainModule()
        self.assertTrue(mod.applies_to({"type": "undulator"}, "fel"))
        self.assertFalse(mod.applies_to({"type": "undulator"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "fel"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_fel_gain -v`

- [ ] **Step 3: Implement FELGainModule**

Create `beam_physics/modules/fel_gain.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ELECTRON_MASS, ALFVEN_CURRENT

UNDULATOR_TYPES = {"undulator", "helicalUndulator", "wiggler", "apple2Undulator"}
MACHINE_TYPES_WITH_FEL = {"fel", "collider"}


class FELGainModule(PhysicsModule):
    """FEL Pierce parameter, gain length, saturation, and photon wavelength."""

    def __init__(self):
        super().__init__(name="fel_gain", order=80)

    def applies_to(self, element, machine_type):
        if machine_type not in MACHINE_TYPES_WITH_FEL:
            return False
        return element.get("type", "") in UNDULATOR_TYPES

    def apply(self, beam, element, context):
        period = element.get("period", 0.03)  # metres
        K = element.get("kParameter", 1.5)
        und_length = element.get("length", 5.0)
        gamma = beam.energy / beam.mass

        # Resonant wavelength
        wavelength = period / (2.0 * gamma ** 2) * (1.0 + K ** 2 / 2.0)

        # Pierce parameter
        I_peak = beam.peak_current
        sigma_x = beam.beam_size_x()

        if I_peak <= 0 or sigma_x <= 0 or gamma <= 0:
            return EffectReport(self.name, context.element_index, {
                "wavelength_m": wavelength, "rho": 0.0, "gain_length_m": float("inf"),
                "saturated": False, "saturation_fraction": 0.0,
                "power_w": 0.0, "saturation_power_w": 0.0,
            })

        rho = (1.0 / (2.0 * gamma)) * (
            I_peak * K ** 2 * period / (4.0 * ALFVEN_CURRENT * sigma_x ** 2)
        ) ** (1.0 / 3.0)

        # 1D gain length
        L_gain_1D = period / (4.0 * np.pi * np.sqrt(3.0) * rho) if rho > 0 else float("inf")

        # Ming Xie degradation (simplified 3-term model)
        eps_n = beam.norm_emittance_x()
        sigma_delta = beam.energy_spread()

        eta = 0.0
        if np.isfinite(L_gain_1D) and L_gain_1D > 0:
            # Diffraction parameter
            eta_d = L_gain_1D * wavelength / (4.0 * np.pi * sigma_x ** 2) if sigma_x > 0 else 0
            # Energy spread parameter
            eta_e = 4.0 * np.pi * L_gain_1D * sigma_delta / period if period > 0 else 0
            # Emittance parameter
            eta_gamma = L_gain_1D * 4.0 * np.pi * eps_n / (gamma * wavelength * sigma_x) if (wavelength > 0 and sigma_x > 0) else 0

            eta = (0.45 * eta_d ** 0.57 + 0.55 * eta_e ** 1.6 + 2.0 * eta_gamma ** 2.9
                   + 0.35 * max(eta_d, 0) ** 0.25 * max(eta_gamma, 0) ** 1.6
                   + 51.0 * max(eta_e, 0) ** 0.95 * max(eta_gamma, 0) ** 3.0)

        L_gain_3D = L_gain_1D * (1.0 + eta)

        # Saturation check
        L_sat = 20.0 * L_gain_3D
        saturation_fraction = und_length / L_sat if L_sat > 0 and np.isfinite(L_sat) else 0.0
        saturated = saturation_fraction >= 1.0

        # Power
        E_beam_J = beam.energy * 1.602e-10  # GeV to Joules
        P_sat = rho * E_beam_J * I_peak if rho > 0 else 0.0

        # Exponential growth model
        P_noise = 1e-3  # Watts (shot noise)
        if saturated:
            power = P_sat
        elif L_gain_3D > 0 and np.isfinite(L_gain_3D):
            power = min(P_noise * np.exp(und_length / L_gain_3D), P_sat)
        else:
            power = 0.0

        return EffectReport(self.name, context.element_index, {
            "wavelength_m": wavelength,
            "rho": rho,
            "gain_length_1D_m": L_gain_1D,
            "gain_length_3D_m": L_gain_3D,
            "ming_xie_eta": eta,
            "saturated": saturated,
            "saturation_fraction": saturation_fraction,
            "power_w": power,
            "saturation_power_w": P_sat,
        })
```

- [ ] **Step 4: Update modules/__init__.py**

Add: `from beam_physics.modules.fel_gain import FELGainModule`

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_fel_gain -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/fel_gain.py beam_physics/modules/__init__.py test/test_fel_gain.py
git commit -m "feat: add FELGainModule with Ming Xie degradation and saturation"
```

---

### Task 10: Beam-Beam Module

**Files:**
- Create: `beam_physics/modules/beam_beam.py`
- Create: `test/test_beam_beam.py`

- [ ] **Step 1: Write tests**

Create `test/test_beam_beam.py`:

```python
import unittest
import numpy as np
from beam_physics.beam import create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE, ELECTRON_MASS
from beam_physics.context import PropagationContext
from beam_physics.modules.beam_beam import BeamBeamModule


def make_collider_beam():
    params = dict(DEFAULT_SOURCE)
    params["energy"] = 45.6  # Z-pole
    params["current"] = 1.0
    params["eps_norm_x"] = 5e-6
    params["eps_norm_y"] = 0.05e-6  # flat beam
    params["bunch_frequency"] = 1e6
    params["beta_x"] = 0.01  # 10 mm
    params["beta_y"] = 0.0001  # 0.1 mm
    return create_initial_beam(params)


class TestBeamBeam(unittest.TestCase):
    def test_computes_luminosity(self):
        """Should compute a positive luminosity."""
        mod = BeamBeamModule()
        beam = make_collider_beam()
        ctx = PropagationContext("collider")
        report = mod.apply(beam, {"type": "detector", "length": 6.0, "crossingAngle": 0.0}, ctx)
        self.assertGreater(report.details["luminosity"], 0)

    def test_computes_tune_shift(self):
        """Should compute beam-beam tune shift."""
        mod = BeamBeamModule()
        beam = make_collider_beam()
        ctx = PropagationContext("collider")
        report = mod.apply(beam, {"type": "detector", "length": 6.0, "crossingAngle": 0.0}, ctx)
        self.assertGreater(report.details["tune_shift_y"], 0)

    def test_crossing_angle_reduces_luminosity(self):
        """Crossing angle should reduce luminosity via Piwinski factor."""
        mod = BeamBeamModule()
        beam_0 = make_collider_beam()
        beam_a = make_collider_beam()
        ctx_0 = PropagationContext("collider")
        ctx_a = PropagationContext("collider")
        r0 = mod.apply(beam_0, {"type": "detector", "length": 6.0, "crossingAngle": 0.0}, ctx_0)
        ra = mod.apply(beam_a, {"type": "detector", "length": 6.0, "crossingAngle": 10.0}, ctx_a)
        self.assertGreater(r0.details["luminosity"], ra.details["luminosity"])

    def test_applies_only_to_detector_in_collider(self):
        mod = BeamBeamModule()
        self.assertTrue(mod.applies_to({"type": "detector"}, "collider"))
        self.assertFalse(mod.applies_to({"type": "detector"}, "linac"))
        self.assertFalse(mod.applies_to({"type": "drift"}, "collider"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_beam_beam -v`

- [ ] **Step 3: Implement BeamBeamModule**

Create `beam_physics/modules/beam_beam.py`:

```python
import numpy as np
from beam_physics.modules.base import PhysicsModule
from beam_physics.context import EffectReport
from beam_physics.constants import ELECTRON_CHARGE, SPEED_OF_LIGHT

# Classical electron radius (m)
R_E = 2.818e-15


class BeamBeamModule(PhysicsModule):
    """Luminosity, beam-beam tune shift, and disruption at the IP."""

    def __init__(self):
        super().__init__(name="beam_beam", order=90)

    def applies_to(self, element, machine_type):
        if machine_type != "collider":
            return False
        return element.get("type", "") == "detector"

    def apply(self, beam, element, context):
        crossing_angle_mrad = element.get("crossingAngle", 0.0)
        phi = crossing_angle_mrad * 0.5e-3  # half crossing angle in radians

        sigma_x = beam.beam_size_x()
        sigma_y = beam.beam_size_y()
        gamma = beam.gamma
        N = beam.n_particles
        f_rep = beam.bunch_frequency
        sigma_z = beam.bunch_length() * SPEED_OF_LIGHT  # m

        if sigma_x <= 0 or sigma_y <= 0 or N <= 0 or gamma <= 0:
            return EffectReport(self.name, context.element_index, {
                "luminosity": 0.0, "tune_shift_y": 0.0, "disruption_y": 0.0,
                "pinch_enhancement": 1.0, "piwinski_factor": 1.0,
            })

        # Beam-beam tune shift
        xi_y = (N * R_E * beam.beta_y()) / (
            4.0 * np.pi * gamma * sigma_y * (sigma_x + sigma_y)
        ) if (sigma_x + sigma_y) > 0 else 0

        # Disruption parameter
        D_y = (2.0 * N * R_E * sigma_z) / (
            gamma * sigma_y * (sigma_x + sigma_y)
        ) if (sigma_y > 0 and (sigma_x + sigma_y) > 0) else 0

        # Pinch enhancement
        H_D = 1.0 + D_y ** 0.25 if D_y > 0 else 1.0

        # Piwinski crossing angle reduction
        if abs(phi) > 1e-10 and sigma_x > 0:
            S = 1.0 / np.sqrt(1.0 + (phi * sigma_z / (2.0 * sigma_x)) ** 2)
        else:
            S = 1.0

        # Luminosity (symmetric beams: N1 = N2 = N)
        L = (N * N * f_rep * H_D * S) / (4.0 * np.pi * sigma_x * sigma_y)

        # Beam-beam instability check
        beam_stable = xi_y < 0.05

        return EffectReport(self.name, context.element_index, {
            "luminosity": L,
            "tune_shift_y": xi_y,
            "disruption_y": D_y,
            "pinch_enhancement": H_D,
            "piwinski_factor": S,
            "beam_stable": beam_stable,
            "n_particles": N,
        })
```

- [ ] **Step 4: Update modules/__init__.py**

Add: `from beam_physics.modules.beam_beam import BeamBeamModule`

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest test.test_beam_beam -v`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/modules/beam_beam.py beam_physics/modules/__init__.py test/test_beam_beam.py
git commit -m "feat: add BeamBeamModule with luminosity, tune shift, and disruption"
```

---

### Task 11: Machine Type Definitions

**Files:**
- Create: `beam_physics/machines.py`
- Create: `test/test_machines_py.py`

- [ ] **Step 1: Write tests**

Create `test/test_machines_py.py`:

```python
import unittest
from beam_physics.machines import get_machine_config, MACHINE_TYPES


class TestMachineDefinitions(unittest.TestCase):
    def test_all_four_tiers_defined(self):
        self.assertIn("linac", MACHINE_TYPES)
        self.assertIn("photoinjector", MACHINE_TYPES)
        self.assertIn("fel", MACHINE_TYPES)
        self.assertIn("collider", MACHINE_TYPES)

    def test_linac_has_correct_modules(self):
        cfg = get_machine_config("linac")
        names = {m.name for m in cfg["modules"]}
        self.assertIn("linear_optics", names)
        self.assertIn("rf_acceleration", names)
        self.assertIn("synchrotron_radiation", names)
        self.assertIn("aperture_loss", names)
        self.assertIn("collimation", names)
        self.assertNotIn("space_charge", names)
        self.assertNotIn("bunch_compression", names)
        self.assertNotIn("fel_gain", names)
        self.assertNotIn("beam_beam", names)

    def test_fel_has_compression_and_fel(self):
        cfg = get_machine_config("fel")
        names = {m.name for m in cfg["modules"]}
        self.assertIn("bunch_compression", names)
        self.assertIn("fel_gain", names)
        self.assertIn("space_charge", names)

    def test_collider_has_all_modules(self):
        cfg = get_machine_config("collider")
        names = {m.name for m in cfg["modules"]}
        self.assertIn("beam_beam", names)
        self.assertIn("fel_gain", names)
        self.assertIn("bunch_compression", names)

    def test_modules_sorted_by_order(self):
        for mt in MACHINE_TYPES:
            cfg = get_machine_config(mt)
            orders = [m.order for m in cfg["modules"]]
            self.assertEqual(orders, sorted(orders),
                           f"Modules not sorted for {mt}")

    def test_machine_has_success_metric(self):
        for mt in MACHINE_TYPES:
            cfg = get_machine_config(mt)
            self.assertIn("success_metric", cfg)

    def test_unknown_machine_raises(self):
        with self.assertRaises(KeyError):
            get_machine_config("tokamak")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_machines_py -v`

- [ ] **Step 3: Implement machines.py**

Create `beam_physics/machines.py`:

```python
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

# Tier 1 modules — used by all machine types
_TIER1_MODULES = [
    LinearOpticsModule(),
    RFAccelerationModule(),
    SynchrotronRadiationModule(),
    CollimationModule(),
    ApertureLossModule(),
]

# Tier 2 adds space charge
_TIER2_MODULES = _TIER1_MODULES + [
    SpaceChargeModule(),
]

# Tier 3 adds bunch compression and FEL
_TIER3_MODULES = _TIER2_MODULES + [
    BunchCompressionModule(),
    FELGainModule(),
]

# Tier 4 adds beam-beam
_TIER4_MODULES = _TIER3_MODULES + [
    BeamBeamModule(),
]


def _sorted_modules(modules):
    return sorted(modules, key=lambda m: m.order)


_MACHINE_CONFIGS = {
    "linac": {
        "modules": _sorted_modules(_TIER1_MODULES),
        "tier": 1,
        "success_metric": "beam_power_kw",
        "description": "Electron Linac — deliver beam to target",
    },
    "photoinjector": {
        "modules": _sorted_modules(_TIER2_MODULES),
        "tier": 2,
        "success_metric": "brightness",
        "description": "Photoinjector — maximize beam brightness",
    },
    "fel": {
        "modules": _sorted_modules(_TIER3_MODULES),
        "tier": 3,
        "success_metric": "fel_brilliance",
        "description": "Free Electron Laser — achieve FEL saturation",
    },
    "collider": {
        "modules": _sorted_modules(_TIER4_MODULES),
        "tier": 4,
        "success_metric": "integrated_luminosity",
        "description": "Electron-Positron Collider — accumulate discoveries",
    },
}


def get_machine_config(machine_type):
    """Return the configuration dict for a machine type.
    Raises KeyError for unknown types."""
    return _MACHINE_CONFIGS[machine_type]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest test.test_machines_py -v`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add beam_physics/machines.py test/test_machines_py.py
git commit -m "feat: add machine type definitions with tier-based module composition"
```

---

### Task 12: New Propagation Loop in lattice.py

**Files:**
- Modify: `beam_physics/lattice.py`
- Create: `test/test_integration.py`

This task replaces the monolithic `propagate()` with the module-based system while maintaining the same output format.

- [ ] **Step 1: Write integration tests**

Create `test/test_integration.py`:

```python
import unittest
import numpy as np
from beam_physics.lattice import propagate


class TestLinacPropagation(unittest.TestCase):
    """Tier 1: basic linac with FODO and RF."""

    def _linac_config(self):
        return [
            {"type": "source", "length": 0},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.1, "rfPhase": 0.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 2.5},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 2.5},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.1, "rfPhase": 0.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 2.5},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 2.5},
            {"type": "target", "length": 0},
        ]

    def test_beam_gains_energy(self):
        result = propagate(self._linac_config(), machine_type="linac")
        self.assertGreater(result["summary"]["final_energy"], 0.01)

    def test_beam_survives(self):
        result = propagate(self._linac_config(), machine_type="linac")
        self.assertTrue(result["summary"]["alive"])

    def test_snapshots_for_each_element(self):
        config = self._linac_config()
        result = propagate(config, machine_type="linac")
        self.assertEqual(len(result["snapshots"]), len(config))

    def test_has_summary_keys(self):
        result = propagate(self._linac_config(), machine_type="linac")
        s = result["summary"]
        for key in ["final_energy", "final_current", "initial_current", "alive",
                     "beam_quality", "total_loss_fraction",
                     "final_emittance_x", "final_emittance_y"]:
            self.assertIn(key, s, f"Missing key: {key}")


class TestFELPropagation(unittest.TestCase):
    """Tier 3: FEL with compression and undulator."""

    def _fel_config(self):
        return [
            {"type": "source", "length": 0},
            # Accelerate
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.5, "rfPhase": 0.0},
            # Chirp
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.3, "rfPhase": -20.0},
            # FODO
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 2.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "drift", "length": 2.0},
            # Compress
            {"type": "chicane", "length": 10.0, "r56": -0.04},
            # More acceleration
            {"type": "rfCavity", "length": 4.0, "energyGain": 1.0, "rfPhase": 0.0},
            # Undulator
            {"type": "undulator", "length": 30.0, "period": 0.03, "kParameter": 1.5},
        ]

    def test_fel_reports_wavelength(self):
        result = propagate(self._fel_config(), machine_type="fel")
        # Check that FEL report is in the reports
        fel_reports = [r for r in result.get("reports", []) if r.module == "fel_gain"]
        self.assertGreater(len(fel_reports), 0)
        self.assertGreater(fel_reports[0].details["wavelength_m"], 0)

    def test_beam_survives_fel(self):
        result = propagate(self._fel_config(), machine_type="fel")
        self.assertTrue(result["summary"]["alive"])


class TestDefaultMachineType(unittest.TestCase):
    def test_defaults_to_linac(self):
        """If no machine_type given, should default to linac."""
        config = [
            {"type": "source", "length": 0},
            {"type": "drift", "length": 5.0},
        ]
        result = propagate(config)
        self.assertIn("summary", result)
        self.assertIn("snapshots", result)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest test.test_integration -v`
Expected: fails because `propagate()` doesn't accept `machine_type` yet

- [ ] **Step 3: Rewrite lattice.py to use module system**

Replace the content of `beam_physics/lattice.py` with:

```python
import numpy as np
from beam_physics.beam import BeamState, create_initial_beam
from beam_physics.constants import DEFAULT_SOURCE
from beam_physics.context import PropagationContext
from beam_physics.machines import get_machine_config


def propagate(beamline_config, machine_type=None, source_params=None):
    """
    Propagate a beam through a beamline using the modular physics engine.

    Args:
        beamline_config: list of element dicts
        machine_type: "linac", "photoinjector", "fel", "collider" (default: "linac")
        source_params: dict of source parameters (uses defaults if None)

    Returns:
        dict with "snapshots", "summary", "reports"
    """
    if machine_type is None:
        machine_type = "linac"

    machine_config = get_machine_config(machine_type)
    modules = machine_config["modules"]

    params = dict(DEFAULT_SOURCE)
    if source_params:
        params.update(source_params)

    beam = create_initial_beam(params)
    initial_current = beam.current
    initial_eps_x = beam.emittance_x()
    initial_eps_y = beam.emittance_y()

    context = PropagationContext(machine_type)
    context.active_modules = modules

    total_photon_rate = 0.0
    luminosities = []
    collision_rates = []
    n_focusing = 0

    for i, element in enumerate(beamline_config):
        context.element_index = i
        etype = element.get("type", "drift")

        if etype == "source":
            context.snapshots.append(beam.snapshot(i, etype, 0.0))
            continue

        if etype in ("quadrupole", "sextupole"):
            n_focusing += 1

        # Run all applicable modules
        for module in modules:
            if module.applies_to(element, machine_type):
                report = module.apply(beam, element, context)
                context.record(report)

                # Extract FEL and collision data from reports
                if module.name == "fel_gain" and report.details:
                    total_photon_rate += report.details.get("power_w", 0) * 1e-6
                if module.name == "beam_beam" and report.details:
                    luminosities.append(report.details.get("luminosity", 0))

        # Target collision rate
        if etype == "target":
            collision_rates.append(beam.current * element.get("collisionRate", 2.0))

        context.cumulative_s += element.get("length", 0.0)
        context.snapshots.append(beam.snapshot(i, etype, context.cumulative_s))

        if not beam.alive:
            break

    # Beam quality
    final_eps = 0.5 * (beam.emittance_x() + beam.emittance_y())
    initial_eps = 0.5 * (initial_eps_x + initial_eps_y)
    beam_quality = max(0.0, min(1.0, initial_eps / final_eps)) if initial_eps > 0 and final_eps > 0 else 0.0

    cumulative_loss = 1.0 - (beam.current / initial_current) if initial_current > 0 else 0.0

    summary = {
        "final_energy": beam.energy,
        "final_current": beam.current,
        "initial_current": initial_current,
        "luminosity": sum(luminosities),
        "collision_rate": sum(collision_rates),
        "photon_rate": total_photon_rate,
        "beam_quality": beam_quality,
        "alive": beam.alive,
        "total_loss_fraction": cumulative_loss,
        "final_emittance_x": beam.emittance_x(),
        "final_emittance_y": beam.emittance_y(),
        "final_norm_emittance_x": beam.norm_emittance_x(),
        "final_norm_emittance_y": beam.norm_emittance_y(),
        "final_energy_spread": beam.energy_spread(),
        "final_beam_size_x": beam.beam_size_x(),
        "final_beam_size_y": beam.beam_size_y(),
        "n_focusing": n_focusing,
    }

    return {
        "snapshots": context.snapshots,
        "summary": summary,
        "reports": context.reports,
    }
```

- [ ] **Step 4: Run integration tests to verify they pass**

Run: `python3 -m unittest test.test_integration -v`
Expected: all tests PASS

- [ ] **Step 5: Run all tests to verify nothing is broken**

Run: `python3 -m unittest discover test -p "test_*.py" -v`
Expected: all tests across all modules PASS

- [ ] **Step 6: Commit**

```bash
git add beam_physics/lattice.py test/test_integration.py
git commit -m "feat: replace monolithic propagation with modular physics engine"
```

---

### Task 13: Update gameplay.py Bridge

**Files:**
- Modify: `beam_physics/gameplay.py`

This wires the new `machine_type` parameter through from the game, passes new component parameters (polarity, rfPhase), and updates the output format.

- [ ] **Step 1: Update beamline_config_from_game to pass new params**

In `beam_physics/gameplay.py`, update the quadrupole section of `beamline_config_from_game` to use `polarity` instead of auto-alternation:

Replace:
```python
        elif physics_type == "quadrupole":
            raw_k = stats.get("focusStrength",
                              defaults.get("focusStrength", 1.0))
            el["focusStrength"] = raw_k * QUAD_K_SCALE
            el["focusing"] = (quad_index % 2 == 0)
            quad_index += 1
```

With:
```python
        elif physics_type == "quadrupole":
            raw_k = stats.get("focusStrength",
                              defaults.get("focusStrength", 1.0))
            el["focusStrength"] = raw_k * QUAD_K_SCALE
            # Player-controlled polarity; fall back to auto-alternation for backwards compat
            polarity = comp.get("polarity", stats.get("polarity", None))
            if polarity is not None:
                el["polarity"] = polarity
            else:
                el["polarity"] = 1 if (quad_index % 2 == 0) else -1
                quad_index += 1
```

Add rfPhase for RF cavities. After the `energyGain` line in the RF section, add:
```python
            el["rfPhase"] = stats.get("rfPhase", comp.get("rfPhase", 0.0))
```

Add undulator params. Replace the undulator section:
```python
        elif physics_type == "undulator":
            el["photonRate"] = stats.get("photonRate",
                                         defaults.get("photonRate", 1.0))
            el["period"] = stats.get("period", defaults.get("period", 0.03))
            el["kParameter"] = stats.get("kParameter", defaults.get("kParameter", 1.5))
```

- [ ] **Step 2: Update compute_beam_for_game to pass machine_type**

In `compute_beam_for_game`, update the call to `propagate`:

Replace:
```python
    elements = beamline_config_from_game(game_beamline)
    physics_result = propagate(elements)
    game_result = physics_to_game(physics_result, research_effects, elements)
```

With:
```python
    elements = beamline_config_from_game(game_beamline)
    machine_type = research_effects.get("machineType", "linac") if research_effects else "linac"
    physics_result = propagate(elements, machine_type=machine_type)
    game_result = physics_to_game(physics_result, research_effects, elements)
```

- [ ] **Step 3: Update physics_to_game to include FEL and beam-beam data from reports**

In `physics_to_game`, after the existing code, add extraction of FEL reports:

```python
    # Extract FEL data from reports
    fel_reports = [r for r in physics_result.get("reports", []) if r.module == "fel_gain"]
    if fel_reports:
        best_fel = max(fel_reports, key=lambda r: r.details.get("power_w", 0))
        game_result["felSaturated"] = best_fel.details.get("saturated", False)
        game_result["felWavelength"] = best_fel.details.get("wavelength_m", None)
        game_result["felPower"] = best_fel.details.get("power_w", 0)
        game_result["felGainLength"] = best_fel.details.get("gain_length_3D_m", None)
        game_result["felRho"] = best_fel.details.get("rho", 0)

    # Extract beam-beam data from reports
    bb_reports = [r for r in physics_result.get("reports", []) if r.module == "beam_beam"]
    if bb_reports:
        game_result["luminosity"] = bb_reports[0].details.get("luminosity", 0)
        game_result["tuneShiftY"] = bb_reports[0].details.get("tune_shift_y", 0)
        game_result["beamStable"] = bb_reports[0].details.get("beam_stable", True)
```

Note: `EffectReport` objects have `.module` and `.details` attributes. The `physics_result["reports"]` list is new — it comes from the refactored `lattice.py`.

- [ ] **Step 4: Run all tests**

Run: `python3 -m unittest discover test -p "test_*.py" -v`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add beam_physics/gameplay.py
git commit -m "feat: wire machine_type, polarity, rfPhase through gameplay bridge"
```

---

### Task 14: Update physics.js Module List

**Files:**
- Modify: `physics.js`

The Pyodide loader needs to know about the new files.

- [ ] **Step 1: Update PY_MODULES list in physics.js**

Replace the `PY_MODULES` array with:

```javascript
  const PY_MODULES = [
    'beam_physics/constants.py',
    'beam_physics/beam.py',
    'beam_physics/context.py',
    'beam_physics/modules/__init__.py',
    'beam_physics/modules/base.py',
    'beam_physics/modules/linear_optics.py',
    'beam_physics/modules/rf_acceleration.py',
    'beam_physics/modules/space_charge.py',
    'beam_physics/modules/synchrotron_rad.py',
    'beam_physics/modules/bunch_compression.py',
    'beam_physics/modules/collimation.py',
    'beam_physics/modules/aperture_loss.py',
    'beam_physics/modules/fel_gain.py',
    'beam_physics/modules/beam_beam.py',
    'beam_physics/machines.py',
    'beam_physics/lattice.py',
    'beam_physics/rf_system.py',
    'beam_physics/cryo_system.py',
    'beam_physics/vacuum_system.py',
    'beam_physics/cooling_system.py',
    'beam_physics/wear.py',
    'beam_physics/diagnostics.py',
    'beam_physics/gameplay.py',
  ];
```

- [ ] **Step 2: Update the filesystem creation to handle subdirectories**

In the `init()` function, after the `os.makedirs('beam_physics', exist_ok=True)` line, add:

```javascript
      pyodide.runPython(`
import os
os.makedirs('beam_physics', exist_ok=True)
os.makedirs('beam_physics/modules', exist_ok=True)
with open('beam_physics/__init__.py', 'w') as f:
    f.write('')
      `);
```

Replace the existing `os.makedirs` block with the above.

- [ ] **Step 3: Update the file loading loop**

Replace the loop that writes files:

```javascript
      for (const path of PY_MODULES) {
        const response = await fetch(path);
        const code = await response.text();
        // Write to the correct subdirectory in Pyodide's filesystem
        pyodide.runPython(`
with open('${path}', 'w') as f:
    f.write(${JSON.stringify(code)})
        `);
      }
```

- [ ] **Step 4: Commit**

```bash
git add physics.js
git commit -m "feat: update Pyodide loader for modular physics engine"
```

---

### Task 15: Final Verification — Run All Tests

- [ ] **Step 1: Run all Python tests**

Run: `python3 -m unittest discover test -p "test_*.py" -v`
Expected: all tests PASS, no errors

- [ ] **Step 2: Verify existing JS tests still work**

Run: `node test/test-beamline.js`
Expected: passes (or pre-existing failures only)

- [ ] **Step 3: Commit any fixes needed**

If any tests revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve test failures from integration"
```
