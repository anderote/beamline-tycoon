# Fundamentals of Beam Physics

These concepts underpin everything in the game. You'll encounter them from your first linac onward.

---

## What Is a Particle Beam?

**Quick Tip:** A beam is a stream of charged particles — electrons or protons — traveling together at nearly the speed of light.

**How It Works:**

A particle beam is billions of charged particles (typically electrons) all moving in roughly the same direction at nearly the speed of light. "Nearly" is important — at 10 MeV, an electron is already traveling at 99.9% of the speed of light. At 1 GeV, it's 99.99999% of c.

The beam isn't a perfect laser-like line. Every particle is slightly different — slightly off-center, slightly different angle, slightly different energy. The *distribution* of these differences is what defines the beam's quality.

In the game, you're building the machine that creates, accelerates, steers, and focuses this beam. Every component you place affects the distribution of particles.

**The Math:**

A single particle's state is described by six numbers (the *phase space coordinates*):

```
(x, x', y, y', t, dE/E)
```

- `x, y` — transverse position (metres) relative to the design orbit
- `x', y'` — transverse angles (radians), i.e. `dx/ds` and `dy/ds` where `s` is distance along the beamline
- `t` — arrival time relative to the bunch center (seconds)
- `dE/E` — fractional energy deviation from the design energy

The beam as a whole is described by the *sigma matrix* — a 6x6 covariance matrix of these coordinates across all particles.

---

## Energy and Relativity

**Quick Tip:** Higher energy = stiffer beam (harder to bend), smaller emittance (adiabatic damping), and more synchrotron radiation.

**How It Works:**

Particle energy is measured in electron-volts (eV). The key milestones:

| Energy | What it means |
|--------|--------------|
| 511 keV | Electron rest mass — below this, the electron isn't relativistic |
| 10 MeV | Typical gun output. Already 99.9% of c. Space charge still matters. |
| 100 MeV | Space charge negligible. Synchrotron radiation starts to matter in bends. |
| 1 GeV | Synchrotron radiation significant. FEL-capable. |
| 10 GeV | Hard X-ray FEL territory. Synchrotron radiation dominates dipole design. |
| 100 GeV | Collider energy. Z-boson mass = 91 GeV. |

Two key relativistic parameters:

- **Gamma (Lorentz factor):** `gamma = E / (m*c^2)`. At 1 GeV, an electron has gamma = 1957. This huge number suppresses space charge (by gamma^3) and determines synchrotron radiation power (by gamma^4).
- **Beta:** The particle speed as a fraction of c. For ultra-relativistic particles, `beta ≈ 1 - 1/(2*gamma^2)`. Effectively 1 for most purposes.

**The Math:**

```
gamma = E_total / (m * c^2)
beta = sqrt(1 - 1/gamma^2)
```

For electrons: `m*c^2 = 0.511 MeV`. So a 1 GeV electron has `gamma = 1000/0.511 = 1957`.

For protons: `m*c^2 = 938 MeV`. A 1 GeV proton has `gamma = 1938/938 = 2.07`. Protons are much less relativistic at the same energy — this is why electron and proton machines are so different.

---

## Phase Space and Emittance

**Quick Tip:** Emittance measures your beam's quality — lower is better. It can grow (bad) but never shrink without tricks like radiation damping or cooling.

**How It Works:**

If you plot every particle's position `x` against its angle `x'`, you get a cloud of points — the *phase space distribution*. For a well-behaved beam, this cloud is an ellipse.

**Emittance** is the area of this ellipse (divided by pi). It measures how "spread out" the beam is in phase space. A low-emittance beam has particles that are both close together in position AND traveling in nearly the same direction.

Why emittance matters:
- **Lower emittance = smaller beam size** at a focus point (for the same focusing strength)
- **Lower emittance = brighter beam** (more particles per unit area per unit angle)
- **Emittance is conserved** by linear optics (Liouville's theorem) — quadrupoles and drifts don't change it
- **Emittance can grow** from nonlinear effects, scattering, space charge, CSR, etc.
- **Emittance can shrink** from radiation damping (electrons in a ring) or adiabatic damping (acceleration)

In the game, emittance is your most precious resource. Everything you build should aim to preserve the emittance from the source.

**Normalized emittance** accounts for adiabatic damping during acceleration:

```
eps_n = beta * gamma * eps_geometric
```

When you accelerate a beam, geometric emittance shrinks (the beam gets "stiffer"), but normalized emittance stays constant. This is why normalized emittance is the fair comparison between beams at different energies.

**The Math:**

For a 2D Gaussian beam in the x-plane:

```
emittance = sqrt(det(sigma_2x2))
          = sqrt(<x^2><x'^2> - <x*x'>^2)
```

The full 6x6 sigma matrix has the x-plane in indices [0,1], y-plane in [2,3], and longitudinal in [4,5].

Twiss parameters describe the shape of the phase space ellipse:

```
sigma_xx = eps * beta       (beam size squared)
sigma_xx' = -eps * alpha    (position-angle correlation)
sigma_x'x' = eps * gamma_t  (divergence squared, gamma_t = (1 + alpha^2)/beta)
```

where `beta`, `alpha`, `gamma_t` are the Twiss parameters (not to be confused with relativistic beta and gamma).

---

## Beam Size

**Quick Tip:** Beam size depends on emittance and focusing. At a focus point: `sigma = sqrt(emittance * beta_function)`.

**How It Works:**

The beam size at any point in the beamline is:

```
sigma_x = sqrt(emittance_x * beta_x)
```

where `beta_x` is the Twiss beta function — determined by the focusing structure (quadrupole layout). A FODO cell (alternating focusing and defocusing quads) creates a periodic beta function that oscillates between a minimum (at the focusing quad) and a maximum (between quads).

The beam must fit inside the vacuum pipe at every point. If the beam size exceeds the pipe aperture, particles are lost. This is why focusing matters — without quads, the beam diverges and hits the walls.

**The Math:**

The beta function evolves through the beamline according to:

```
beta(s) = from transfer matrix: beta_2 = (R11^2 * beta_1 - 2*R11*R12*alpha_1 + R12^2 * gamma_1)
```

In a FODO cell of length `L` with quad focal length `f`:

```
beta_max ≈ L * (1 + sin(mu/2)) / sin(mu)
beta_min ≈ L * (1 - sin(mu/2)) / sin(mu)
```

where the phase advance per cell is `cos(mu) = 1 - L^2/(2*f^2)`.

---

## Current and Beam Power

**Quick Tip:** More current = more particles = more science output, but also more space charge and more power deposited everywhere.

**How It Works:**

Beam current is measured in milliamps (mA). A 1 mA electron beam at 1 GeV carries:

```
Power = current * energy = 0.001 A * 1e9 V = 1 MW
```

That's a megawatt of beam power. If this beam hits something (a beam dump, a collimator, the wall), that power has to go somewhere — as heat. This is why beam loss matters: even 0.1% loss of a 1 MW beam is 1 kW deposited in the wall, enough to melt things.

**Peak current vs. average current:** The beam comes in bunches (packets of particles). Average current determines total beam power. Peak current (current within a single bunch) determines space charge effects and FEL performance. Compressing the bunch raises peak current while keeping average current the same.

---

## Dispersion

**Quick Tip:** Dispersion means particles with different energies follow different paths — a dipole creates it, and it must be managed.

**How It Works:**

When a beam enters a dipole magnet, particles with higher energy bend less (they're stiffer). Particles with lower energy bend more. After the dipole, the beam is spread out according to energy — this is *dispersion*.

Dispersion `eta` is measured in metres: it tells you how far off-center a particle is per unit of fractional energy deviation. If `eta = 1 m` and a particle has 0.1% more energy than the design energy, it will be 1 mm off-center.

Dispersion matters because:
- **Beam size increases:** Effective beam size is `sigma_x = sqrt(eps*beta + (eta*sigma_dE)^2)`. The energy spread contribution can dominate.
- **Chromatic effects:** A quad focusing a dispersed beam applies different kicks to particles at different positions — this is chromaticity, and it degrades focusing.
- **Bunch compression:** Chicanes deliberately create dispersion to convert energy differences into path length differences — this is how bunch compression works.

Dispersion propagates through the beamline. It's created by dipoles and transformed by all elements. It must be tracked as a state variable alongside the sigma matrix.

**The Math:**

Dispersion propagation:

```
eta_new = R[0,0]*eta + R[0,1]*eta' + R[0,5]  (using 6x6 matrix)
eta'_new = R[1,0]*eta + R[1,1]*eta' + R[1,5]
```

For a sector dipole: `R[0,5] = rho*(1-cos(theta))`, `R[1,5] = sin(theta)`.

For a drift or quad: `R[0,5] = R[1,5] = 0`, so dispersion transforms but isn't generated.
