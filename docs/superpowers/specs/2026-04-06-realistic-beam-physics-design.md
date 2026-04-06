# Realistic Beam Physics — Design Spec

**Date:** 2026-04-06
**Status:** Draft

## Overview

Redesign the beam physics engine to support multiple accelerator types with physically accurate, modular physics. Each accelerator type ("machine type") is the game's equivalent of a ride type in RollerCoaster Tycoon — distinct physics, components, challenges, and success metrics.

Machine types unlock progressively. The player starts with a simple electron linac and works toward an electron-positron collider. Each tier introduces new physics the player must master.

Particle species: electrons first. Protons unlock as a future expansion (Tier 5+), bringing fundamentally different physics (no synchrotron radiation, space charge dominated, transition crossing).

Energy scale: starts at MeV (Tier 1), reaches ~100 GeV by Tier 4. This covers the richest set of physics regimes without the late game becoming purely about scale.

No storage rings in initial scope — all machines use linear topology.

## Architecture: Modular Physics Engine

### Module Interface

Each physics module is an independent unit:

```python
class PhysicsModule:
    name: str
    order: int  # execution order within the propagation loop

    def applies_to(self, element: dict, machine_type: str) -> bool:
        """Whether this module should run for this element + machine type."""

    def apply(self, beam: BeamState, element: dict, context: PropagationContext) -> EffectReport:
        """Apply physics effect. Mutates beam in place. Returns report for UI/diagnostics."""
```

### PropagationContext

Carries accumulated state across elements:

```python
class PropagationContext:
    machine_type: str           # "linac", "photoinjector", "fel", "collider"
    cumulative_s: float         # path length in metres
    dispersion: np.array        # (eta_x, eta_x', eta_y, eta_y')
    chirp: float                # energy-time correlation dE/dt
    active_modules: list        # ordered list of PhysicsModule instances
    element_index: int
    snapshots: list             # accumulated beam snapshots
    diagnostics: dict           # accumulated diagnostic readbacks
```

### Propagation Loop

```python
def propagate(beamline_config, machine_type, source_params=None):
    beam = create_initial_beam(source_params)
    context = PropagationContext(machine_type)

    for i, element in enumerate(beamline_config):
        context.element_index = i

        for module in context.active_modules:
            if module.applies_to(element, machine_type):
                report = module.apply(beam, element, context)
                context.record(report)

        context.cumulative_s += element.get("length", 0.0)
        context.snapshots.append(beam.snapshot(i, element["type"], context.cumulative_s))

        if not beam.alive:
            break

    return build_result(context)
```

### Module Execution Order

Modules run in a fixed order per element:

1. `linear_optics` — transfer matrix propagation
2. `rf_acceleration` — energy gain, adiabatic damping, chirping
3. `space_charge` — defocusing kick (low energy only)
4. `synchrotron_radiation` — energy loss, quantum excitation
5. `bunch_compression` — R56 application, CSR effects
6. `collimation` — beam scraping
7. `aperture_loss` — Gaussian clipping at beam pipe
8. `fel_gain` — FEL calculation at undulators
9. `beam_beam` — tune shift, disruption at IP

Order matters: optics first (sets beam size), then energy changes, then losses based on resulting beam size.

## Module Specifications

### Module 1: linear_optics

**Active:** All tiers

**What it does:** Applies 6x6 transfer matrices to the sigma matrix. Propagates dispersion vector.

**Current state:** `elements.py` transfer matrices are mostly correct. Dispersion is not tracked as state.

**Changes needed:**

1. **Dispersion tracking.** Add `dispersion = (eta_x, eta_x', eta_y, eta_y')` to `PropagationContext`. Initialize to zero. Propagate through every element using the same transfer matrix: `eta_new = R @ eta_old + d` where `d` is the dispersion generation vector (nonzero only for dipoles: `d = [rho*(1-cos theta), sin theta, 0, 0]`).

2. **Player-controlled quad polarity.** Remove the `quad_index % 2` auto-alternation. Each quadrupole node gets a `polarity` parameter (+1 = focusing in x, -1 = focusing in y) set by the player. Default to +1. The player learns to alternate them.

3. **Combined function magnet matrix.** Superposition of dipole bend + quadrupole gradient. The horizontal transfer matrix becomes:
   ```
   k_eff = k_quad + 1/rho^2
   ```
   Use the quadrupole matrix formula with `k_eff` in horizontal, `k_quad` in vertical.

4. **Dipole edge focusing.** Add thin-lens vertical kicks at dipole entry/exit:
   ```
   M_edge = [[1, 0], [tan(e)/rho, 1]]
   ```
   where `e` is the edge angle (= half bend angle for symmetric sector dipole).

**Transfer matrices retained as-is:** drift, quadrupole, solenoid, RF cavity (drift + damping applied separately).

### Module 2: rf_acceleration

**Active:** All tiers

**What it does:** Applies energy gain, adiabatic damping, and (for Tier 3+) energy chirping from off-crest operation.

**Current state:** Energy gain and adiabatic damping are implemented. No phase/chirp support.

**Changes needed:**

1. **RF phase parameter.** Each RF cavity gets an `rfPhase` parameter in degrees. Default 0 (on-crest, maximum acceleration).

2. **Phase-dependent energy gain:**
   ```
   dE = V_acc * cos(phi)
   ```
   where `V_acc = gradient * length` and `phi` is the RF phase.

3. **Chirp imparted to the beam:**
   ```
   h = (2 * pi * f_rf * V_acc * sin(phi)) / (E_beam * c)
   ```
   This adds correlation to the longitudinal sigma matrix:
   ```
   sigma[4,5] += h * sigma[4,4]  (simplified linear model)
   ```

4. **Adiabatic damping** stays as-is (scale divergence terms by energy ratio).

### Module 3: space_charge

**Active:** Tier 2+ (photoinjector), only when `beam.energy < threshold`

**What it does:** Applies envelope-equation defocusing at low energy where the beam's self-charge is significant.

**Model:** Smooth-approximation space charge kick. The generalized perveance is:

```
K_sc = (2 * I_peak) / (I_A * beta^3 * gamma^3)
```

where `I_A = 17045 A` is the Alfven current.

**Effect on sigma:** After the transfer matrix, add a defocusing kick:

```
delta_sigma[1,1] += K_sc * L / sigma_x  (x divergence growth)
delta_sigma[3,3] += K_sc * L / sigma_y  (y divergence growth)
```

This is the linearized envelope equation term. It captures:
- Space charge blowup is worst at low energy (gamma^3 suppression)
- Higher current = stronger effect
- Larger beam = weaker effect (self-consistent)

**Threshold:** Module skips when `beam.gamma > 200` (~100 MeV for electrons). Above this, the effect is negligible.

### Module 4: synchrotron_radiation

**Active:** All tiers (electrons only)

**What it does:** Energy loss and quantum excitation in dipoles. Energy loss in undulators.

**Current state:** `radiation.py` is largely correct. Quantum excitation uses locally-computed dispersion.

**Changes needed:**

1. **Use tracked dispersion** from context instead of computing it locally. The dispersion invariant H should use the actual `eta_x, eta_x'` at the dipole, not the single-dipole approximation.

2. **Undulator radiation** stays as-is (weak effect, mainly for energy bookkeeping).

3. No changes to synchrotron energy loss formula — it's correct.

### Module 5: bunch_compression

**Active:** Tier 3+ (FEL)

**What it does:** Models bunch compression in chicanes using upstream chirp, and applies CSR effects.

**Trigger:** Runs on `chicane` type elements.

**Physics:**

1. **Bunch length after compression:**
   ```
   sigma_t_new = |1 + h * R56| * sigma_t_old
   ```
   where `h` is the accumulated chirp from off-crest RF, and `R56` is the chicane's momentum compaction.

2. **Peak current after compression:**
   ```
   I_peak_new = I_peak_old / |1 + h * R56|
   ```

3. **CSR energy spread** (already in `radiation.py`, needs to be called):
   ```
   delta_E/E ~ (N * r_e) / (R^(2/3) * sigma_z^(4/3))
   ```
   Applied to sigma[5,5].

4. **CSR emittance growth** (already in `radiation.py`, needs to be called):
   ```
   d_eps ~ (R56 * sigma_delta_csr)^2 / beta_x
   ```
   Applied to sigma[0,0] and sigma[1,1].

**Gameplay:** The player learns to balance compression ratio against CSR degradation. Two-stage compression (two chicanes with acceleration between) is a real technique that the player can discover for better performance.

### Module 6: collimation

**Active:** All tiers

**What it does:** Models physical beam scraping at collimators.

**Current state:** Simple Gaussian truncation. Adequate for now.

**Changes for later:** Proper secondary particle shower model, halo repopulation. Not needed for initial implementation.

### Module 7: aperture_loss

**Active:** All tiers

**What it does:** Computes beam loss at physical apertures for every element.

**Current state:** Working correctly using `erf` for Gaussian clipping.

**No changes needed** for initial implementation.

### Module 8: fel_gain

**Active:** Tier 3 (FEL)

**What it does:** Computes FEL performance at undulator elements.

**Current state:** `fel_parameters()` and `fel_saturation_check()` exist but are disconnected from propagation.

**Changes needed:**

1. **Wire into propagation.** When an undulator is encountered, compute FEL parameters using actual beam state (not defaults).

2. **Ming Xie degradation factors.** The 1D gain length is degraded by emittance, energy spread, and diffraction:
   ```
   L_g_3D = L_g_1D * (1 + eta)
   ```
   where `eta` is a polynomial function of three dimensionless parameters:
   ```
   eta_d = (L_g_1D / (4*pi*sigma_x^2)) * lambda_r     (diffraction)
   eta_e = (L_g_1D * 4*pi * sigma_delta) / lambda_u     (energy spread)
   eta_gamma = (L_g_1D * eps_n) / (sigma_x^2 * gamma)   (emittance)
   ```
   The Ming Xie formula is a fit:
   ```
   eta = a1*eta_d^b1 + a2*eta_e^b2 + a3*eta_gamma^b3 + ...  (19 terms)
   ```
   We can use a simplified 3-term version for gameplay.

3. **Exponential power growth** through the undulator:
   ```
   P(z) = P_noise * exp(z / L_g_3D)
   ```
   capped at `P_sat = rho * E_beam * I_peak`.

   The player sees a power curve: exponential growth, then saturation. Partial lasing if undulator is too short.

4. **Photon wavelength:**
   ```
   lambda = lambda_u / (2 * gamma^2) * (1 + K^2/2)
   ```
   Displayed to the player. Shorter = harder but more valuable (higher science output).

### Module 9: beam_beam

**Active:** Tier 4 (Collider)

**What it does:** Computes luminosity and beam-beam effects at the interaction point.

**Trigger:** Runs on `detector` type elements in collider machine type.

**Physics:**

1. **Luminosity:**
   ```
   L = (N1 * N2 * f_rep * H_D) / (4 * pi * sigma_x* * sigma_y*)
   ```
   where `H_D` is the pinch enhancement factor and `N` is computed from current and bunch structure.

2. **Beam-beam tune shift:**
   ```
   xi_y = (N * r_e * beta_y*) / (4 * pi * gamma * sigma_y* * (sigma_x* + sigma_y*))
   ```
   If `xi_y > 0.05`, beam becomes unstable — effective current limit.

3. **Disruption parameter:**
   ```
   D_y = (2 * N * r_e * sigma_z) / (gamma * sigma_y* * (sigma_x* + sigma_y*))
   ```
   Pinch enhancement: `H_D ≈ 1 + D_y^(1/4)` (empirical fit for flat beams).

4. **Crossing angle reduction:**
   ```
   L_eff = L_geometric * S(phi)
   ```
   where `S(phi) = 1 / sqrt(1 + (phi * sigma_z / (2 * sigma_x*))^2)` is the Piwinski reduction factor.

**Deferred:** Beamstrahlung, crab cavities, multiple IPs.

## Machine Type Definitions

### Tier 1: Electron Linac

- **Unlock:** Available from start
- **Active modules:** linear_optics, rf_acceleration, synchrotron_radiation, collimation, aperture_loss
- **Available components:** source (thermionic), drift, quadrupole, dipole, rfCavity, collimator, target, beamDump, bpm
- **Success metric:** Beam energy x current delivered to target (beam power in kW)
- **Win condition:** Deliver >100 MeV at >0.1 mA to a fixed target
- **Key physics the player learns:**
  - Transfer matrices and focusing
  - Building a FODO cell (alternating quad polarities)
  - Beam size must fit in the pipe
  - RF cavities add energy
  - Dipoles steer but cost energy (synchrotron radiation)

### Tier 2: Photoinjector

- **Unlock:** Deliver beam to target in Tier 1
- **Active modules:** All Tier 1 + space_charge
- **New components:** dcPhotoGun, ncRfGun, srfGun, solenoid, screen, ict, wireScanner
- **Success metric:** Beam brightness = current / (emittance_x * emittance_y)
- **Win condition:** Achieve normalized emittance < 1 um-rad at > 1 mA
- **Key physics the player learns:**
  - Source emittance matters — different guns have different quality
  - Space charge defocusing at low energy
  - Solenoid focusing after the gun (emittance compensation)
  - Diagnostics are needed to see what's happening
  - Brightness is the figure of merit, not just current or energy

### Tier 3: Free Electron Laser

- **Unlock:** Achieve brightness target in Tier 2
- **Active modules:** All Tier 2 + bunch_compression, fel_gain
- **New components:** chicane, buncher, harmonicLinearizer, undulator, helicalUndulator, photonPort, bunchLengthMonitor, energySpectrometer
- **Success metric:** FEL saturation power x photon energy (brilliance proxy)
- **Win condition:** Achieve FEL saturation at < 10 nm wavelength
- **Key physics the player learns:**
  - Off-crest RF for chirping
  - Chicane R56 for compression
  - CSR as the enemy of emittance
  - FEL Pierce parameter — everything connects
  - Two-stage compression as an advanced technique
  - Harmonic linearizer to correct RF curvature

### Tier 4: Electron-Positron Collider

- **Unlock:** Achieve FEL saturation in Tier 3
- **Active modules:** All Tier 3 + beam_beam
- **New components:** positronTarget, detector, septumMagnet, kickerMagnet, comptonIP
- **Success metric:** Integrated luminosity (luminosity x running time)
- **Win condition:** Accumulate enough integrated luminosity for a "discovery"
- **Key physics the player learns:**
  - Luminosity depends on beam size at IP (σ*) — final focus is critical
  - Beam-beam tune shift limits current
  - Positron production requires its own beamline
  - Crossing angle trades luminosity for collision cleanliness
  - This is the hardest machine because everything from Tiers 1-3 must work simultaneously on two beamlines

## BeamState Changes

Add to `BeamState`:

```python
class BeamState:
    sigma: np.array          # 6x6 covariance matrix (existing)
    energy: float            # GeV (existing)
    current: float           # mA (existing)
    mass: float              # GeV/c^2 (existing)
    alive: bool              # (existing)

    # New fields
    peak_current: float      # A (derived from current and bunch length)
    n_particles: float       # particles per bunch
    bunch_frequency: float   # Hz (repetition rate)
```

Derived quantities:
```
peak_current = charge_per_bunch / (sqrt(2*pi) * sigma_t)
n_particles = charge_per_bunch / e
charge_per_bunch = average_current / bunch_frequency
```

## Component Parameter Changes

### Quadrupole
- Add `polarity` parameter: +1 (focus x, defocus y) or -1 (defocus x, focus y)
- Remove auto-alternation in lattice.py
- Player must learn to set this correctly

### RF Cavity / Cryomodule
- Add `rfPhase` parameter: degrees, default 0 (on-crest)
- Player can detune for chirping (Tier 3+)
- Energy gain becomes `dE * cos(phase)`

### Chicane
- Already has `r56` parameter
- Bunch compression is now actually computed using upstream chirp

### Undulator
- Add `period` parameter (mm), default 30
- Add `kParameter`, default 1.5
- FEL wavelength, gain length, saturation computed from these + beam state

### Detector
- Add `crossingAngle` parameter (mrad), default 0
- Luminosity properly computed in collider mode

## Gameplay-to-Physics Mapping

### Scaling factors (revised)

The current scaling factors (QUAD_K_SCALE, DIPOLE_ANGLE_SCALE, LENGTH_SCALE) remain in `gameplay.py` to convert game units to physics units. These may need retuning as the physics becomes more accurate, but the architecture stays the same.

### Machine type selection

The game state carries a `machineType` field. When the player starts a new accelerator project, they pick a type (from those unlocked). This determines:
- Which modules are active in the physics engine
- Which components appear in the build palette
- What the success metric and win condition are
- What wiki articles are available

## Player-Facing Physics Wiki

### Structure

Each wiki article has three layers:
1. **Quick tip** — one sentence tooltip shown on component hover or first placement
2. **Concept page** — 2-3 paragraphs with diagrams, plain language
3. **Deep dive** — actual equations with textbook references

Articles unlock when the player first encounters the relevant component or physics effect.

### Unlock triggers

Articles unlock based on game events:
- Place a component type for the first time
- Encounter a physics effect (beam loss, space charge blowup, FEL attempt)
- Reach a milestone (beam on target, brightness threshold)
- Unlock a new tier

Full wiki content is in the companion document: `docs/physics-wiki/`.

## File Structure

```
beam_physics/
  __init__.py
  constants.py          # Physical constants (existing, minor additions)
  beam.py               # BeamState class (existing, add peak_current etc.)
  context.py            # NEW: PropagationContext class
  modules/
    __init__.py
    base.py             # PhysicsModule base class
    linear_optics.py    # Transfer matrices + dispersion tracking
    rf_acceleration.py  # Energy gain, damping, chirp
    space_charge.py     # Envelope-equation defocusing
    synchrotron_rad.py  # Energy loss, quantum excitation
    bunch_compression.py # R56 compression, CSR
    collimation.py      # Beam scraping
    aperture_loss.py    # Gaussian clipping
    fel_gain.py         # FEL Pierce parameter, gain, saturation
    beam_beam.py        # Luminosity, tune shift, disruption
  machines.py           # NEW: Machine type definitions (modules, components, metrics)
  lattice.py            # Refactored: uses module system
  gameplay.py           # Existing: game <-> physics bridge
  # Legacy files to remove after migration:
  elements.py           # Absorbed into linear_optics.py
  radiation.py          # Split into synchrotron_rad.py and fel_gain.py
  rf_system.py          # Absorbed into rf_acceleration.py
  cryo_system.py        # Retained as engineering model, called by gameplay.py
  vacuum_system.py      # Retained as engineering model, called by gameplay.py
  cooling_system.py     # Retained as engineering model, called by gameplay.py
  wear.py               # Retained as gameplay model
  diagnostics.py        # Retained as gameplay model
```

## Testing Strategy

Each physics module gets its own test file with known analytic results:

- **linear_optics:** Verify FODO cell tune, verify dispersion in a dipole matches analytic formula
- **rf_acceleration:** Verify energy gain, verify adiabatic damping ratio
- **space_charge:** Verify envelope equation against known solutions
- **synchrotron_radiation:** Verify energy loss against synchrotron radiation integrals
- **bunch_compression:** Verify compression ratio for known chirp + R56
- **fel_gain:** Verify Pierce parameter against published FEL parameters for LCLS
- **beam_beam:** Verify luminosity formula against known collider parameters (ILC TDR)

Integration tests: propagate a full beamline config for each machine type and verify summary metrics are in physically reasonable ranges.

## Migration Path

1. Implement module base class and PropagationContext
2. Migrate existing physics into modules (linear_optics, synchrotron_rad, rf_acceleration, aperture_loss, collimation) — behavior should be identical to current code
3. Add dispersion tracking to linear_optics
4. Add player-controlled quad polarity
5. Add space_charge module
6. Add bunch_compression module (chirp + R56 + CSR)
7. Add fel_gain module
8. Add beam_beam module
9. Add machine type definitions and component gating
10. Write wiki content per tier
