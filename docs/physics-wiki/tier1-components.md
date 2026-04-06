# Tier 1 Components — Electron Linac

---

## Electron Source (Thermionic Gun)

**Quick Tip:** The electron source creates your beam. It heats a cathode until electrons boil off — simple but limited in brightness.

**How It Works:**

A thermionic gun heats a metal cathode (typically lanthanum hexaboride, LaB6, or barium oxide) to ~1500 K. At this temperature, electrons have enough thermal energy to escape the surface. An electric field (tens of kV) accelerates them away from the cathode.

The beam quality from a thermionic gun is limited by the thermal energy of the electrons — they leave the cathode in random directions, giving an inherent emittance of ~1-5 um-rad (normalized). The current is limited by the Child-Langmuir law: the beam's own space charge limits how much current you can extract.

**Game parameters:**
- `extractionVoltage` (kV): Higher voltage = more current, but also more energy spread
- `cathodeTemperature` (K): Higher temperature = more current, but worse emittance

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Energy out | 10-100 keV |
| Current | 0.1-10 mA |
| Normalized emittance | 1-5 um-rad |
| Energy spread | 0.1-1% |

**Real-world example:** The SLAC thermionic gun produced 120 keV, 2A peak current electrons for the SLC collider.

---

## Drift (Beam Pipe)

**Quick Tip:** A drift is empty beam pipe — the beam coasts through but spreads out as it travels.

**How It Works:**

A drift space is the simplest beamline element: just a vacuum tube with nothing inside. The beam travels in a straight line, but because particles have slightly different angles, the beam size grows. A particle at angle `x'` moves transversely by `x' * L` over a drift of length `L`.

This is why you can't just have long stretches of beam pipe — the beam diverges and eventually hits the walls. Drifts between focusing elements should be kept reasonably short relative to the beta function.

**Game parameters:**
- `length` (m): How long the drift section is

**The Math:**

Transfer matrix:
```
R = [[1, L],
     [0, 1]]
```

Beam size after a drift: `sigma_x(s) = sqrt(eps * (beta_0 - 2*alpha_0*s + gamma_0*s^2))` where `beta_0, alpha_0, gamma_0` are the Twiss parameters at the entrance.

At a waist (alpha=0): `sigma_x(s) = sigma_0 * sqrt(1 + (s/beta_0)^2)`. The beam doubles in size after traveling a distance equal to the beta function.

---

## Quadrupole Magnet

**Quick Tip:** Quadrupoles focus the beam — but they focus in one plane and defocus in the other. Alternate them to keep the beam contained in both planes.

**How It Works:**

A quadrupole magnet has four poles arranged in alternating north-south pattern. The magnetic field is zero on the beam axis and increases linearly with distance from the axis. This creates a restoring force — particles far from the center get pushed back.

The catch: a quadrupole that focuses horizontally *defocuses* vertically (and vice versa). This is fundamental — you can't avoid it. The solution is the **FODO cell**: alternate Focusing and Defocusing quadrupoles with drift (O) spaces between them. The net effect of F-O-D-O is focusing in both planes.

Building a good FODO cell is the first real skill in the game. The quad strength and spacing determine:
- How tight the focus is (stronger quads = smaller beta = smaller beam)
- How stable the beam is (too strong = the beam oscillates wildly and is lost)
- The **phase advance per cell** — ideally 60-90 degrees for stability

**Game parameters:**
- `focusStrength` (T/m): Quadrupole gradient. Higher = stronger focusing.
- `polarity`: +1 (focus in x, defocus in y) or -1 (defocus in x, focus in y). You must set this!

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Gradient | 1-50 T/m |
| Length | 0.2-2 m |
| Bore radius | 20-50 mm |

**The Math:**

The focusing strength `k` (in 1/m^2) is:

```
k = (e * G) / p = 0.2998 * G[T/m] / p[GeV/c]
```

where `G` is the gradient in T/m and `p` is the beam momentum.

Transfer matrix (focusing plane):
```
R = [[cos(phi),        sin(phi)/sqrt(k)],
     [-sqrt(k)*sin(phi), cos(phi)       ]]
```
where `phi = sqrt(k) * L`.

Defocusing plane: replace cos/sin with cosh/sinh.

**Stability:** A FODO cell is stable when `|cos(mu)| < 1`, where `cos(mu) = 1 - L^2/(2*f^2)` and `f = 1/(k*L_quad)` is the focal length. Phase advance per cell `mu` should be between 0 and 180 degrees.

---

## Dipole Magnet

**Quick Tip:** Dipoles bend the beam's path using a uniform magnetic field. Electrons radiate energy when they bend — this is synchrotron radiation.

**How It Works:**

A dipole magnet creates a uniform vertical field that bends the beam horizontally. The bend angle depends on the field strength and beam momentum:

```
theta = L / rho = (0.2998 * B * L) / p
```

Higher energy beams need stronger fields or longer magnets for the same bend.

When electrons are bent, they radiate electromagnetic radiation — *synchrotron radiation*. This is a fundamental consequence of accelerating charged particles. The radiated power scales as gamma^4, so it's negligible for protons but dominant for high-energy electrons.

Synchrotron radiation is both a curse (energy loss, emittance growth from quantum excitation) and a blessing (it's the useful output of synchrotron light sources, and radiation damping enables storage ring operation).

Dipoles also create *dispersion* — particles with different energies follow different paths. And real dipoles have *edge focusing*: the fringe field at entry and exit provides vertical focusing.

**Game parameters:**
- `bendAngle` (deg): How much the beam path turns
- `fieldStrength` (T): Magnetic field strength

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Field | 0.1-2 T (normal conducting), up to 8 T (superconducting) |
| Length | 1-10 m |
| Bend angle | 1-90 degrees |

**The Math:**

Sector dipole transfer matrix (horizontal):
```
R_x = [[cos(theta),       rho*sin(theta)],
       [-sin(theta)/rho,  cos(theta)     ]]
```

Vertical (drift-like):
```
R_y = [[1, L],
       [0, 1]]
```

Dispersion generation:
```
eta_out = rho * (1 - cos(theta))
eta'_out = sin(theta)
```

Edge focusing (thin lens at entry/exit):
```
R_edge_y = [[1, 0],
            [tan(e)/rho, 1]]
```
where `e` is the edge angle.

Synchrotron radiation energy loss per pass through a dipole:
```
U = C_gamma * E^4 * |theta| / rho
```
where `C_gamma = 8.85 x 10^-5 m/GeV^3`.

---

## RF Cavity

**Quick Tip:** RF cavities accelerate the beam using oscillating electric fields. More cavities = higher energy.

**How It Works:**

An RF (Radio Frequency) cavity is a metal resonator — typically a copper structure shaped so that electromagnetic waves bounce back and forth, creating a strong oscillating electric field along the beam axis. When the beam arrives at the right moment in the oscillation (the *crest*), particles gain energy.

The energy gain per cavity is:

```
dE = gradient * length * cos(phase)
```

At Tier 1, you run cavities on-crest (phase = 0) for maximum energy gain. At Tier 3, you'll learn to run off-crest to chirp the beam for bunch compression.

**Adiabatic damping:** When the beam gains energy, its geometric emittance shrinks proportionally. This is *adiabatic damping* — the beam gets "stiffer" as it speeds up, so the angular spread decreases. Normalized emittance is conserved.

**Game parameters:**
- `gradient` (MV/m): Accelerating electric field strength
- `voltage` (MV): Total voltage = gradient x length
- `rfPhase` (deg): Phase relative to crest. 0 = max acceleration. (Relevant from Tier 3)

**Typical values:**
| Cavity Type | Gradient | Frequency | Temperature |
|-------------|----------|-----------|-------------|
| Normal conducting copper | 10-30 MV/m | 1-12 GHz | Room temperature |
| Superconducting niobium (SRF) | 15-50 MV/m | 0.65-1.3 GHz | 2 K |

SRF cavities have much lower wall losses (Q0 ~ 10^10 vs 10^4) so they can run CW (continuously) instead of pulsed, but they require cryogenic cooling.

**The Math:**

Energy gain: `dE = V_acc * cos(phi)` where `V_acc = E_acc * L_active`.

Adiabatic damping of transverse emittance:
```
eps_after = eps_before * (E_before / E_after)
```

This is equivalent to scaling the divergence components of the sigma matrix:
```
sigma[1,:] *= E_before/E_after
sigma[:,1] *= E_before/E_after
sigma[3,:] *= E_before/E_after
sigma[:,3] *= E_before/E_after
```

---

## Collimator

**Quick Tip:** Collimators scrape off stray particles — they clean the beam at the cost of losing some current.

**How It Works:**

A collimator is a block of dense material (tungsten, copper, or graphite) with a small aperture. Particles inside the aperture pass through; particles outside hit the material and are absorbed.

Collimators are used to:
- **Clean the beam halo:** Remove particles that would otherwise be lost in sensitive areas (like undulators or interaction regions)
- **Define the beam size:** After a collimator, the beam's effective size is at most the collimator aperture
- **Protect downstream components:** Better to lose beam in a collimator (designed for it) than in a magnet or cavity

The trade-off: tighter collimation = cleaner beam = less current. You're literally throwing away particles to improve quality.

**Game parameters:**
- `beamQuality` (mm-mrad): Controls aperture size. Higher quality = tighter collimation.

**The Math:**

Fraction of beam surviving a collimator with aperture `a`:

```
survival = erf(a / (sqrt(2) * sigma_x)) * erf(a / (sqrt(2) * sigma_y))
```

For a 2-sigma collimator (aperture = 2 * sigma), survival is ~95%. For 3-sigma, ~99.7%.

---

## Fixed Target

**Quick Tip:** The target is where your beam does science — slamming electrons into matter to study what comes out.

**How It Works:**

A fixed target is a slab of material (often tungsten, lead, or liquid hydrogen) placed in the beam path. When high-energy electrons hit the target, they interact with atomic nuclei, producing showers of secondary particles (photons, positrons, pions, etc.) that are detected and analyzed.

The science output depends on:
- **Beam energy:** Higher energy accesses rarer physics processes
- **Beam current:** More particles per second = more collisions = more data
- **Beam quality:** A well-focused beam on a thin target minimizes backgrounds

Fixed-target experiments are the simplest way to do particle physics — you just point the beam at something. Colliders (Tier 4) are more efficient at reaching high center-of-mass energy, but fixed targets are simpler and great for studying rare processes with high-intensity beams.

**Game parameters:**
- `collisionRate` (events/s): Base event rate, scaled by beam current

---

## Beam Dump

**Quick Tip:** The beam dump safely absorbs the beam at the end of the line. Every beamline needs one.

**How It Works:**

A beam dump is a massive block of material (water-cooled copper, aluminum, or graphite) designed to absorb the full beam power. When a 1 mA, 1 GeV electron beam hits a dump, it deposits 1 MW of power. The dump must be:

- **Massive enough** to spread the energy over a large volume (to avoid melting)
- **Well-cooled** to remove the heat continuously
- **Shielded** to contain the secondary radiation (neutrons, photons)

In the game, every beamline should end in a dump (or a target/detector). Beam that goes nowhere causes damage and radiation.

---

## Beam Position Monitor (BPM)

**Quick Tip:** BPMs tell you where the beam is — you can't fix what you can't measure.

**How It Works:**

A BPM is a set of electrodes (typically four button or stripline pickups) that detect the electromagnetic field of the passing beam. The signal difference between opposite electrodes gives the beam position.

BPMs are your primary diagnostic tool. Without them, you're flying blind — you can't see if the beam is centered, if it's oscillating, or if it's about to hit the wall.

**Game parameters:**
- `resolution_um` (um): Position measurement precision (1 sigma)

**Typical values:**
| Type | Resolution | Bandwidth |
|------|-----------|-----------|
| Button BPM | 10-100 um | DC to MHz |
| Stripline BPM | 1-10 um | MHz to GHz |
| Cavity BPM | 0.1-1 um | Narrow band |

In the game, BPMs enable the physics engine to report beam position to the player. Without BPMs installed, beam position reads as "???" in the diagnostics panel.
