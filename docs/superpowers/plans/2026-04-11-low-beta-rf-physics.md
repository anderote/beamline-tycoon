# Low-Beta RF Physics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make low-energy beam acceleration realistic — transit time factor derates cavities used at wrong β, first RF element captures the DC beam with losses, β-mismatch grows emittance, and add a buncher component to the game.

**Architecture:** Each RF cavity type gets a `design_beta` attribute. During propagation, the RF module computes a transit time factor `T(β)` that derates energy gain based on how well the beam β matches the cavity's design. The first RF element applies a capture efficiency penalty (DC→bunched). β-mismatch beyond the transit time penalty also grows emittance. The buncher is a new game component (sub-harmonic cavity) that creates bunch structure with minimal acceleration.

**Tech Stack:** Python (beam_physics/), JavaScript (src/data/, src/beamline/)

---

### Task 1: Add design_beta to RF cavity types in gameplay bridge

**Files:**
- Modify: `beam_physics/gameplay.py` — add `designBeta` to RF element dicts
- Modify: `beam_physics/modules/rf_acceleration.py` — add `DESIGN_BETA` lookup

- [ ] **Step 1: Add DESIGN_BETA table to rf_acceleration.py**

Add after the `DEFAULT_RF_FREQ` constant at line 9:

```python
DESIGN_BETA = {
    "rfq":                0.04,
    "pillboxCavity":      0.1,
    "buncher":            0.3,
    "halfWaveResonator":  0.1,
    "spokeCavity":        0.35,
    "rfCavity":           0.9,
    "sbandStructure":     0.95,
    "cbandCavity":        0.95,
    "xbandCavity":        0.99,
    "ellipticalSrfCavity":0.65,
    "srf650Cavity":       0.65,
    "cryomodule":         0.65,
    "harmonicLinearizer": 0.9,
}
```

- [ ] **Step 2: Pass game_type through to physics elements for RF cavities**

In `gameplay.py`, inside the `elif physics_type in ("rfCavity", "cryomodule"):` block (around line 182), the element already gets `el["game_type"] = ctype` set at line 131. No change needed — `game_type` is already available. Verify by reading line 131.

- [ ] **Step 3: Write test for design_beta lookup**

In `test/test_all_modules.py`, add to `TestRFAcceleration`:

```python
def test_design_beta_lookup(self):
    from beam_physics.modules.rf_acceleration import DESIGN_BETA
    self.assertAlmostEqual(DESIGN_BETA["rfq"], 0.04)
    self.assertAlmostEqual(DESIGN_BETA["cryomodule"], 0.65)
    self.assertIn("buncher", DESIGN_BETA)
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration::test_design_beta_lookup -v`
Expected: PASS

---

### Task 2: Implement transit time factor

The transit time factor `T(β) = sin(πg/βλ) / (πg/βλ)` derates the effective voltage when beam β doesn't match the cavity's design. We simplify to a Gaussian-like penalty centered on design_beta.

**Files:**
- Modify: `beam_physics/modules/rf_acceleration.py` — add `_transit_time_factor()`, apply to energy gain
- Modify: `test/test_all_modules.py` — tests

- [ ] **Step 1: Write failing tests**

Add to `TestRFAcceleration` in `test/test_all_modules.py`:

```python
def test_transit_time_factor_at_design_beta(self):
    """TTF should be ~1.0 when beam beta matches cavity design beta."""
    from beam_physics.modules.rf_acceleration import _transit_time_factor
    ttf = _transit_time_factor(beam_beta=0.04, design_beta=0.04)
    self.assertAlmostEqual(ttf, 1.0, places=2)

def test_transit_time_factor_mismatch(self):
    """TTF should be < 1 when beam beta is far from design beta."""
    from beam_physics.modules.rf_acceleration import _transit_time_factor
    ttf = _transit_time_factor(beam_beta=0.04, design_beta=0.9)
    self.assertLess(ttf, 0.3)

def test_transit_time_factor_high_beta(self):
    """High-beta cavities should work well for relativistic beams."""
    from beam_physics.modules.rf_acceleration import _transit_time_factor
    ttf = _transit_time_factor(beam_beta=0.99, design_beta=0.9)
    self.assertGreater(ttf, 0.8)

def test_energy_gain_derated_by_ttf(self):
    """RF cavity with beta mismatch should give less energy gain."""
    mod = RFAccelerationModule()
    # Low-energy beam (beta ~ 0.2) hitting an S-band cavity (design_beta=0.9)
    beam_matched = make_beam(energy=0.5)  # beta ~ 0.86
    beam_low = make_beam(energy=0.015)    # beta ~ 0.24
    ctx1 = PropagationContext("linac")
    ctx2 = PropagationContext("linac")
    e1 = beam_matched.energy
    e2 = beam_low.energy
    el = {"type": "rfCavity", "length": 3.0, "energyGain": 0.045,
          "rfPhase": 0.0, "game_type": "rfCavity"}
    mod.apply(beam_matched, el.copy(), ctx1)
    mod.apply(beam_low, el.copy(), ctx2)
    gain_matched = beam_matched.energy - e1
    gain_low = beam_low.energy - e2
    self.assertGreater(gain_matched, gain_low)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration -k "transit_time or derated" -v`
Expected: FAIL (functions don't exist yet)

- [ ] **Step 3: Implement `_transit_time_factor` and apply in `apply()`**

Add the function before the class in `rf_acceleration.py`:

```python
def _transit_time_factor(beam_beta, design_beta):
    """
    Simplified transit time factor: how effectively a cavity accelerates
    a particle whose beta differs from the cavity's design beta.
    Uses sinc-like model: T = sin(π δ) / (π δ) where δ = |1/β - 1/β_d| × β_d
    Clamped to [0.01, 1.0].
    """
    if beam_beta <= 0 or design_beta <= 0:
        return 0.01
    inv_diff = abs(1.0 / beam_beta - 1.0 / design_beta) * design_beta
    if inv_diff < 1e-6:
        return 1.0
    arg = np.pi * inv_diff
    ttf = abs(np.sin(arg) / arg)
    return max(0.01, min(1.0, ttf))
```

In the `apply()` method, after computing `dE` and before applying it, look up design_beta and derate:

```python
# Transit time factor — derate energy gain for beta mismatch
game_type = element.get("game_type", element.get("type", ""))
design_beta = DESIGN_BETA.get(game_type, 0.9)
ttf = _transit_time_factor(beam.beta, design_beta)
dE *= ttf
```

Insert this block right after `dE = dE_nominal * np.cos(phase_rad)` (line 28) and before `energy_before = beam.energy` (line 29).

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration -v`
Expected: all PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `python3 -m pytest test/test_all_modules.py test/test_integration.py -v`
Expected: all PASS. Some energy values in integration tests may shift due to TTF — if so, the tests are checking `alive` and `> initial` which should still hold since the beams start at 10 MeV (β≈0.998) and hit S-band cavities (design_beta=0.9), giving TTF≈1.

---

### Task 3: Implement RF capture efficiency

When the first RF element encounters a DC (un-bunched) beam, it captures only a fraction of particles into RF buckets. This reduces current.

**Files:**
- Modify: `beam_physics/modules/rf_acceleration.py` — add capture loss logic
- Modify: `beam_physics/context.py` — already has `bunch_frequency_set` flag
- Modify: `test/test_all_modules.py` — tests

- [ ] **Step 1: Write failing tests**

Add to `TestRFAcceleration`:

```python
def test_first_rf_applies_capture_loss(self):
    """First RF cavity should reduce current (DC beam capture)."""
    mod = RFAccelerationModule()
    beam = make_beam()
    ctx = PropagationContext("linac")
    current_before = beam.current
    mod.apply(beam, {"type": "rfCavity", "length": 3.0, "energyGain": 0.1,
                     "rfPhase": -30.0, "game_type": "rfCavity"}, ctx)
    self.assertLess(beam.current, current_before)

def test_second_rf_no_capture_loss(self):
    """Second RF cavity should not apply capture loss again."""
    mod = RFAccelerationModule()
    beam = make_beam()
    ctx = PropagationContext("linac")
    # First RF — sets bunch structure
    mod.apply(beam, {"type": "rfCavity", "length": 3.0, "energyGain": 0.1,
                     "rfPhase": -30.0, "game_type": "rfCavity"}, ctx)
    current_after_first = beam.current
    # Second RF — should not lose more to capture
    mod.apply(beam, {"type": "rfCavity", "length": 3.0, "energyGain": 0.1,
                     "rfPhase": 0.0, "game_type": "rfCavity"}, ctx)
    self.assertAlmostEqual(beam.current, current_after_first, places=4)

def test_rfq_better_capture_than_pillbox(self):
    """RFQ should capture more beam than a pillbox cavity."""
    mod = RFAccelerationModule()
    beam_rfq = make_beam()
    beam_pb = make_beam()
    ctx_rfq = PropagationContext("linac")
    ctx_pb = PropagationContext("linac")
    mod.apply(beam_rfq, {"type": "rfCavity", "length": 3.0, "energyGain": 0.003,
                         "rfPhase": -30.0, "game_type": "rfq"}, ctx_rfq)
    mod.apply(beam_pb, {"type": "rfCavity", "length": 1.0, "energyGain": 0.0005,
                        "rfPhase": -30.0, "game_type": "pillboxCavity"}, ctx_pb)
    self.assertGreater(beam_rfq.current, beam_pb.current)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration -k "capture" -v`
Expected: FAIL

- [ ] **Step 3: Implement capture efficiency**

Add a capture efficiency table and logic after the `DESIGN_BETA` dict:

```python
CAPTURE_EFFICIENCY = {
    "rfq":                0.80,
    "pillboxCavity":      0.50,
    "buncher":            0.65,
    "halfWaveResonator":  0.55,
    "spokeCavity":        0.60,
    "rfCavity":           0.45,
    "sbandStructure":     0.45,
    "cbandCavity":        0.45,
    "xbandCavity":        0.40,
    "ellipticalSrfCavity":0.50,
    "srf650Cavity":       0.50,
    "cryomodule":         0.50,
    "harmonicLinearizer": 0.55,
}
```

In `apply()`, right after the `bunch_frequency_set` block, add:

```python
        # First RF element captures DC beam into bunches — apply current loss
        if not context.bunch_frequency_set:
            beam.bunch_frequency = f_rf
            context.bunch_frequency_set = True
            capture = CAPTURE_EFFICIENCY.get(game_type, 0.5)
            beam.current *= capture
```

Move the `game_type` lookup (from Task 2) before this block so it's available.

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration -v`
Expected: all PASS

- [ ] **Step 5: Run full suite**

Run: `python3 -m pytest test/test_all_modules.py test/test_integration.py -v`
Expected: all PASS (integration tests check `alive` and relative values, not absolute current)

---

### Task 4: Implement β-mismatch emittance growth

When beam β is far from cavity design_beta, the beam gets transverse kicks from field asymmetries, growing emittance.

**Files:**
- Modify: `beam_physics/modules/rf_acceleration.py` — add emittance growth after TTF
- Modify: `test/test_all_modules.py` — tests

- [ ] **Step 1: Write failing test**

Add to `TestRFAcceleration`:

```python
def test_beta_mismatch_grows_emittance(self):
    """Large beta mismatch should grow emittance."""
    mod = RFAccelerationModule()
    beam_match = make_beam(energy=0.5)
    beam_mismatch = make_beam(energy=0.015)
    ctx1 = PropagationContext("linac")
    ctx2 = PropagationContext("linac")
    ctx1.bunch_frequency_set = True  # skip capture loss
    ctx2.bunch_frequency_set = True
    eps_match_before = beam_match.emittance_x()
    eps_mismatch_before = beam_mismatch.emittance_x()
    el = {"type": "rfCavity", "length": 3.0, "energyGain": 0.045,
          "rfPhase": 0.0, "game_type": "rfCavity"}
    mod.apply(beam_match, el.copy(), ctx1)
    mod.apply(beam_mismatch, el.copy(), ctx2)
    # Mismatched beam should have worse emittance ratio
    ratio_match = beam_match.emittance_x() / eps_match_before
    ratio_mismatch = beam_mismatch.emittance_x() / eps_mismatch_before
    self.assertGreater(ratio_mismatch, ratio_match)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration::test_beta_mismatch_grows_emittance -v`
Expected: FAIL

- [ ] **Step 3: Implement β-mismatch emittance growth**

In `apply()`, after the TTF derate block and before the energy application, add:

```python
        # β-mismatch emittance growth: transverse kicks from field asymmetry
        if ttf < 0.95:
            mismatch_factor = (1.0 - ttf) * 0.1  # 10% emittance growth at ttf=0
            beam.sigma[0, 0] *= (1.0 + mismatch_factor)
            beam.sigma[2, 2] *= (1.0 + mismatch_factor)
            beam.sigma = 0.5 * (beam.sigma + beam.sigma.T)
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest test/test_all_modules.py::TestRFAcceleration -v`
Expected: all PASS

---

### Task 5: Add buncher component to game

**Files:**
- Modify: `src/data/beamline-components.raw.js` — add buncher entry in the normal-conducting RF section
- Modify: `beam_physics/gameplay.py` — ensure buncher maps through correctly (already in `RF_CAVITY_TYPES`)

- [ ] **Step 1: Add buncher component definition**

In `src/data/beamline-components.raw.js`, add after the `rfq` entry (after line 267, before `pillboxCavity`):

```javascript
  buncher: {
    id: 'buncher',
    name: 'Sub-harmonic Buncher',
    desc: 'Low-voltage RF cavity that imprints bunch structure onto a DC beam without significant acceleration. Operates at a sub-harmonic of the main linac frequency to give a wide capture window. Place between source and first accelerating cavity to pre-bunch the beam — dramatically improves capture efficiency downstream. Normal-conducting, low power.',
    category: 'rf',
    subsection: 'normalConducting',
    cost: { funding: 300000 },
    stats: { energyGain: 0.0001, bunchCompression: 0.3 },
    energyCost: 2,
    subL: 2,
    subW: 3,
    subH: 4, gridW: 3, gridH: 2, geometryType: 'cylinder',
    interiorVolume: 3,
    unlocked: false,
    spriteKey: 'pillboxCavity',
    spriteColor: 0xcc6644,
    params: { voltage: 0.1, rfPhase: -90 },
    placement: 'module',
    ports: {
      entry: { side: 'back' },
      exit: { side: 'front' },
    },

    requiredConnections: ['powerCable', 'rfWaveguide'],
    rfFrequency: 200,
    rfBand: 'vhf',
    rfPowerRequired: 2,
  },
```

- [ ] **Step 2: Verify buncher type already flows through gameplay bridge**

Confirm `buncher` is in `RF_CAVITY_TYPES` at line 63 of `gameplay.py` and in `COMPONENT_DEFAULTS` at line 22. Both already exist. The mapping at line 104 sends it to `physics_type = "rfCavity"`. No changes needed.

- [ ] **Step 3: Verify buncher is in rf_acceleration.py type sets**

Confirm `buncher` is in `RF_ELEMENT_TYPES` at line 6. It already is. Confirm it's in `DESIGN_BETA` and `CAPTURE_EFFICIENCY` (added in Tasks 1 and 3). No changes needed.

- [ ] **Step 4: Run integration test**

Run: `python3 -m pytest test/test_integration.py -v`
Expected: all PASS

---

### Task 6: Integration test — full low-beta beamline

**Files:**
- Modify: `test/test_integration.py` — add test for source → buncher → RFQ → spoke → elliptical progression

- [ ] **Step 1: Write integration test**

Add new test class to `test/test_integration.py`:

```python
class TestLowBetaAcceleration(unittest.TestCase):
    """Test realistic low-energy acceleration sequence."""

    def _low_beta_config(self):
        return [
            {"type": "source", "length": 2.0},
            {"type": "rfCavity", "length": 1.0, "energyGain": 0.0001,
             "rfPhase": -90.0, "game_type": "buncher", "rfFrequency": 200e6},
            {"type": "drift", "length": 0.5},
            {"type": "rfCavity", "length": 3.0, "energyGain": 0.003,
             "rfPhase": -30.0, "game_type": "rfq", "rfFrequency": 400e6},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 1.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "rfCavity", "length": 2.0, "energyGain": 0.01,
             "rfPhase": -25.0, "game_type": "spokeCavity", "rfFrequency": 325e6},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": 1},
            {"type": "drift", "length": 1.0},
            {"type": "quadrupole", "length": 0.5, "focusStrength": 0.3, "polarity": -1},
            {"type": "rfCavity", "length": 1.5, "energyGain": 0.0375,
             "rfPhase": 0.0, "game_type": "ellipticalSrfCavity", "rfFrequency": 1.3e9},
            {"type": "target", "length": 0},
        ]

    def test_beam_gains_energy(self):
        result = propagate(self._low_beta_config(), machine_type="linac")
        self.assertGreater(result["summary"]["final_energy"], 0.01)
        self.assertTrue(result["summary"]["alive"])

    def test_capture_reduces_current(self):
        result = propagate(self._low_beta_config(), machine_type="linac")
        self.assertLess(result["summary"]["final_current"],
                        result["summary"]["initial_current"])

    def test_bunch_frequency_set_by_first_rf(self):
        """Bunch frequency should be set by buncher (200 MHz), not later cavities."""
        result = propagate(self._low_beta_config(), machine_type="linac")
        last_snap = result["snapshots"][-1]
        self.assertAlmostEqual(last_snap["bunch_frequency"], 200e6)

    def test_wrong_order_loses_more_energy(self):
        """Putting high-beta cavity first should give less total energy gain."""
        wrong_order = [
            {"type": "source", "length": 2.0},
            {"type": "rfCavity", "length": 1.5, "energyGain": 0.0375,
             "rfPhase": 0.0, "game_type": "ellipticalSrfCavity", "rfFrequency": 1.3e9},
            {"type": "rfCavity", "length": 3.0, "energyGain": 0.003,
             "rfPhase": -30.0, "game_type": "rfq", "rfFrequency": 400e6},
            {"type": "target", "length": 0},
        ]
        right = propagate(self._low_beta_config(), machine_type="linac")
        wrong = propagate(wrong_order, machine_type="linac")
        self.assertGreater(right["summary"]["final_energy"],
                           wrong["summary"]["final_energy"])
```

- [ ] **Step 2: Run integration tests**

Run: `python3 -m pytest test/test_integration.py::TestLowBetaAcceleration -v`
Expected: all PASS

- [ ] **Step 3: Run full test suite**

Run: `python3 -m pytest test/test_all_modules.py test/test_integration.py test/test_linear_optics.py test/test_focus_advisor.py -v`
Expected: all PASS

---

### Task 7: Commit

- [ ] **Step 1: Stage and commit all changes**

```bash
git add beam_physics/modules/rf_acceleration.py \
       beam_physics/modules/space_charge.py \
       beam_physics/machines.py \
       beam_physics/context.py \
       beam_physics/gameplay.py \
       beam_physics/lattice.py \
       src/data/beamline-components.raw.js \
       test/test_all_modules.py \
       test/test_integration.py
git commit -m "feat(physics): low-beta RF, transit time factor, capture efficiency, dispersion warnings

- Transit time factor derates energy gain when beam β mismatches cavity design β
- First RF element applies capture efficiency loss (DC→bunched transition)
- β-mismatch grows emittance proportional to TTF penalty
- Space charge now active for all machine types at γ < 200
- RF-induced energy spread from off-crest operation
- Bunch frequency set by first RF cavity, not overwritten by subsequent ones
- rfFrequency passed from game components (MHz) through to physics (Hz)
- Dispersion warnings tracked and exposed in game output
- Add buncher component (sub-harmonic buncher cavity)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
