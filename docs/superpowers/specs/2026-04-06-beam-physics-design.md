# Beam Physics Module — Design Spec

## Overview

A 6D phase-space beam physics simulation for Beamline Cowboy, written in Python (numpy), running client-side via Pyodide. The module propagates a particle beam through the player's beamline using transfer-matrix formalism, computing realistic beam envelopes, losses, energy evolution, luminosity, and photon production. These quantities feed back into the game's resource and scoring systems.

## Beam Representation

The beam state is a **6x6 covariance (sigma) matrix** in the coordinates `(x, x', y, y', dt, dE/E)`:

- `x, y` — transverse position (meters)
- `x', y'` — transverse divergence (radians)
- `dt` — arrival time offset from bunch center (seconds)
- `dE/E` — fractional energy deviation (dimensionless)

Plus scalar state carried alongside:

- `energy` — reference beam energy in GeV
- `current` — beam current in mA (reduced by losses)
- `alive` — whether the beam has tripped

From the sigma matrix, Twiss parameters are derived per plane:

```
emittance = sqrt(sigma_11 * sigma_22 - sigma_12^2)
beta = sigma_11 / emittance
alpha = -sigma_12 / emittance
gamma = sigma_22 / emittance
beam_size = sqrt(sigma_11)
divergence = sqrt(sigma_22)
```

### Initial Beam (Electron Source)

| Parameter | Value |
|-----------|-------|
| Energy | 10 MeV (0.01 GeV) |
| Normalized emittance (x, y) | 1 um-rad |
| Energy spread (dE/E rms) | 0.001 |
| Bunch length (dt rms) | 3.3 ps (~1 mm / c) |
| Beam current | 1 mA |

Geometric emittance is derived from normalized emittance: `eps_geo = eps_norm / (beta_rel * gamma_rel)` where `beta_rel` and `gamma_rel` are the relativistic factors at the current energy.

## Element Transfer Matrices

Each beamline component maps to a 6x6 transfer matrix R. The beam propagates as `sigma_out = R @ sigma_in @ R.T`.

### Drift (length L)

Identity in all planes except position-divergence coupling:

```
R_x = [[1, L], [0, 1]]
R_y = [[1, L], [0, 1]]
R_long = [[1, 0], [0, 1]]  # no longitudinal effect
```

Block-diagonal 6x6 from the three 2x2 blocks.

### Quadrupole (strength k, length L)

Focusing in x, defocusing in y (or vice versa, alternating):

Focusing plane (k > 0):
```
sqrt_k = sqrt(k)
phi = sqrt_k * L
R = [[cos(phi), sin(phi)/sqrt_k], [-sqrt_k*sin(phi), cos(phi)]]
```

Defocusing plane:
```
sqrt_k = sqrt(k)
phi = sqrt_k * L
R = [[cosh(phi), sinh(phi)/sqrt_k], [sqrt_k*sinh(phi), cosh(phi)]]
```

Longitudinal: identity.

The game's `focusStrength` stat maps to k (1/m^2). A quadrupole with `focusStrength: 1` corresponds to `k = 1.0 /m^2`.

### Dipole (bend angle theta, length L)

Bending radius `rho = L / theta`.

Horizontal plane (bend plane):
```
R_x = [[cos(theta), rho*sin(theta)],
       [-sin(theta)/rho, cos(theta)]]
```

With dispersion coupling to energy (columns/rows 5-6):
```
R_16 = rho * (1 - cos(theta))    # position-energy coupling
R_26 = sin(theta)                  # divergence-energy coupling
```

Vertical plane: drift-like `[[1, L], [0, 1]]`.

Additionally, electrons in dipoles emit **synchrotron radiation**, causing:
- Energy loss per dipole: `U = C_gamma * E^4 / rho` where `C_gamma = 8.85e-5 m/GeV^3`
- Emittance growth from quantum excitation (stochastic photon emission)

### RF Cavity (energy gain dE, frequency f, length L)

The cavity adds energy and rotates longitudinal phase space:
- `energy_out = energy_in + dE`
- Longitudinal matrix depends on voltage, frequency, and synchronous phase
- Transverse: thin-lens edge focusing `1/(2 * gamma^2)` effect (small, included for completeness)

The game's `energyGain` stat maps directly to dE in GeV.

### Sextupole (strength m, length L)

Sextupoles provide chromatic correction. In linear approximation, they don't have a direct 6x6 matrix. We model their effect as a **chromatic correction factor** that modifies the effective chromaticity of neighboring quadrupoles:

- Reduces the chromatic emittance growth that would otherwise occur from energy spread passing through quadrupoles
- Applied as a multiplier on chromatic terms: `xi_corrected = xi_natural * (1 - correction_factor)`

### Collimator (aperture radius a)

Not a transfer matrix — instead, a **clipping operation**:
1. Compute beam size `sigma_x, sigma_y` at the collimator
2. Compute fraction of beam within aperture: `f = erf(a / (sqrt(2) * sigma_x)) * erf(a / (sqrt(2) * sigma_y))`
3. Multiply `current` by `f`
4. Truncate the sigma matrix to reflect the reduced distribution (reduce sigma_11, sigma_33 to `min(sigma, a^2)`)

This models collimation reducing beam current but improving beam quality.

### Undulator (period lambda_u, num_periods N, length L)

Transfer matrix: drift-like for the beam.

Photon production rate:
```
P_photons = C * current * energy^2 * N
```
where C is a constant derived from undulator parameters. The game's `photonRate` stat scales this.

Small energy loss from radiation (similar to dipole but weaker).

### Detector / Target (interaction point)

Transfer matrix: identity (thin element).

Luminosity at this location:
```
L = current^2 / (4 * pi * sigma_x * sigma_y)
```

For fixed targets, collision rate scales with `current * target_thickness`.

## Propagation Algorithm

```python
def propagate(beamline_config, source_params):
    beam = create_initial_beam(source_params)
    results = []

    for element in beamline_config:
        R = transfer_matrix(element)
        beam.sigma = R @ beam.sigma @ R.T

        # Synchrotron radiation (dipoles)
        if element.type == 'dipole':
            apply_synchrotron_radiation(beam, element)

        # Aperture check
        loss_fraction = compute_loss(beam, element.aperture)
        beam.current *= (1.0 - loss_fraction)

        # Collimator clipping
        if element.type == 'collimator':
            clip_beam(beam, element.aperture)

        # RF energy gain
        if element.type in ('rfCavity', 'cryomodule'):
            beam.energy += element.energy_gain
            update_relativistic_params(beam)

        # Trip check
        if beam.current / initial_current < trip_threshold:
            beam.alive = False

        results.append(snapshot(beam, element))

    return results
```

### Trip Threshold

- Beam trips if cumulative losses exceed **50%** of initial current (configurable)
- Below 50%: beam stays on but weakened — all current-dependent outputs degrade proportionally
- Player must fix optics (add/reposition quads, adjust strengths) and restart

## Outputs to Game

The propagation returns a list of beam snapshots (one per element) plus summary values:

### Per-Element Snapshot
- `beam_size_x`, `beam_size_y` — for envelope visualization
- `beam_current` — current remaining at this point
- `energy` — beam energy at this point
- `loss_fraction` — local loss at this element

### Summary (fed to game state)
| Output | Game Use |
|--------|----------|
| `final_energy` | `state.beamEnergy` in GeV |
| `final_current` | Scales data rate, collision rate, photon rate |
| `luminosity` | At detector/target locations, drives `dataRate` and `collisionRate` |
| `photon_rate` | At undulator locations |
| `beam_quality` | `1 - (final_emittance / initial_emittance)`, clamped [0, 1]. Affects reputation gain. |
| `alive` | If false, beam is off. No resource generation. |
| `envelope` | Array of (element_index, sigma_x, sigma_y) for beamline visualization |
| `total_loss_fraction` | For UI warnings |

## Pyodide Integration

### Loading
```javascript
async function initPhysics() {
    const pyodide = await loadPyodide();
    await pyodide.loadPackage('numpy');
    // Load the beam_physics Python package
    await pyodide.runPythonAsync(await fetch('beam_physics/...').then(r => r.text()));
    return pyodide;
}
```

### Calling
```javascript
function computeBeam(pyodide, beamlineConfig) {
    pyodide.globals.set('config_json', JSON.stringify(beamlineConfig));
    const resultJson = pyodide.runPython(`
        import json
        from beam_physics.lattice import propagate
        config = json.loads(config_json)
        result = propagate(config)
        json.dumps(result)
    `);
    return JSON.parse(resultJson);
}
```

### When to Recompute
- On beamline change (add/remove/reorder component)
- On beam toggle (start/stop)
- On component parameter change (if upgrades modify element strengths)
- NOT on every game tick — beam physics is steady-state for a given beamline config

## File Structure

```
beam_physics/
    __init__.py
    beam.py          # BeamState class: sigma matrix, Twiss, relativistic params
    elements.py      # transfer_matrix() for each element type
    lattice.py       # propagate(): main loop, returns results
    radiation.py     # synchrotron radiation: energy loss, emittance growth
    gameplay.py      # convert physics results to game quantities
    constants.py     # physical constants, default parameters
```

## Constants

```python
ELECTRON_MASS = 0.511e-3        # GeV/c^2
C_GAMMA = 8.85e-5               # m/GeV^3, synchrotron radiation constant
DEFAULT_APERTURE = 0.025        # 25 mm radius
TRIP_THRESHOLD = 0.5            # beam trips at 50% loss
SPEED_OF_LIGHT = 2.998e8        # m/s
```

## Future Extensions

- **Proton beam** — different mass, no synchrotron radiation, unlockable
- **Space charge** — current-dependent defocusing at low energy
- **Beam-beam effects** — for collider configurations
- **Nonlinear tracking** — particle-by-particle for advanced gameplay
- **Orbit errors / misalignment** — random kicks, steering corrections as a gameplay mechanic
