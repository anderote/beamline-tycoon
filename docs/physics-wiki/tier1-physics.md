# Tier 1 Physics — Electron Linac

---

## Linear Optics

**Quick Tip:** Every beamline element transforms the beam in a predictable way described by a transfer matrix. Chain them together and you can predict the beam anywhere.

**How It Works:**

The key idea of linear beam optics is that each element's effect on the beam can be described by a 6x6 matrix. If you know the beam state going in (the sigma matrix), you can compute the beam state coming out:

```
sigma_out = R * sigma_in * R^T
```

where `R` is the transfer matrix and `R^T` is its transpose.

This is exact for linear elements (drifts, quadrupoles, dipoles at small angles) and a good approximation for most elements the beam encounters. Nonlinear effects (sextupoles, space charge, CSR) are applied as corrections on top.

The key property: **emittance is conserved** by linear transport. The ellipse in phase space changes shape (the beam gets wider, then narrower as it focuses) but its area stays the same. This is Liouville's theorem.

**What this means for gameplay:** You're not trying to "create" good beam quality — that comes from the source. Your job is to *preserve* it while transporting and accelerating the beam. Every mismatched quad, every unnecessary bend, every aperture loss degrades what the source gave you.

**The Math:**

Full 6x6 transfer matrix is block-diagonal for uncoupled elements:

```
R = [[R_x(2x2),   0,        0      ],
     [0,         R_y(2x2),  0      ],
     [0,         0,        R_z(2x2)]]
```

Dipoles break this structure by coupling x and dE/E (dispersion). Solenoids break it by coupling x and y (rotation).

---

## FODO Focusing

**Quick Tip:** FODO = Focus-drift-Defocus-drift. It's the most basic focusing structure and the backbone of every beamline.

**How It Works:**

A single quadrupole focuses in one plane and defocuses in the other. But if you place two quads with opposite polarities separated by drifts, the net effect is focusing in *both* planes. This is the FODO cell:

```
[F quad] --- drift --- [D quad] --- drift ---
```

Why does this work? Consider the horizontal plane. The F quad focuses the beam, making it converge. By the time the beam reaches the D quad, it's smaller — so the defocusing kick from D is weaker than the focusing kick from F (because the kick is proportional to distance from axis). The net effect is focusing.

The same argument works in the vertical plane (where D is focusing and F is defocusing), because the beam is also smaller at the "focusing" quad.

**Tuning your FODO cell:**

| Parameter | Effect |
|-----------|--------|
| Stronger quads | Smaller beam at focus, larger beam at defocus. More sensitive to errors. |
| Weaker quads | Gentler focusing. Beam stays moderate everywhere. Less sensitive. |
| Longer drifts | Beta function grows. Need stronger quads to compensate. |
| Shorter drifts | Tighter cells. Good for emittance preservation but less room for other components. |

**Phase advance per cell:** The key number is the phase advance `mu` — how many degrees of oscillation the beam goes through per FODO cell. The sweet spot is 60-90 degrees. Below 30 degrees, focusing is too weak. Above 120 degrees, the beam becomes sensitive to errors.

**The Math:**

For a thin-lens FODO cell with focal length `f` and half-cell length `L`:

```
cos(mu) = 1 - L^2 / (2*f^2)
beta_max = L * (1 + sin(mu/2)) / sin(mu)
beta_min = L * (1 - sin(mu/2)) / sin(mu)
```

Stability requires `|cos(mu)| < 1`, i.e. `L < 2f`. If `L >= 2f`, the beam is unstable and will be lost.

---

## Beam Transport and Matching

**Quick Tip:** "Matching" means adjusting quads so the beam's Twiss parameters fit what the next section expects. A mismatched beam oscillates in size — wasting aperture.

**How It Works:**

Different sections of the beamline have different optimal beta functions. A FODO channel has a periodic beta. An undulator wants a specific, often small beta. A target wants a tight focus.

If you send a beam from one section into another without adjusting the optics, the beam's Twiss parameters won't match the new section's periodic solution. The result is **beta beating** — the beam size oscillates wildly, sometimes much larger than it needs to be. This wastes aperture and can cause beam loss.

**Matching** is the process of inserting a few quadrupoles between sections and adjusting their strengths so that the Twiss parameters at the exit of section A equal the expected Twiss parameters at the entrance of section B.

In the game, you'll notice beta beating when the beam envelope graph shows oscillations that are larger than they should be. Adding matching quads at section boundaries fixes this.

---

## Synchrotron Radiation

**Quick Tip:** Electrons radiate energy whenever they're bent. Higher energy = much more radiation (scales as energy^4).

**How It Works:**

When a charged particle is deflected (accelerated transversely), it emits electromagnetic radiation. For electrons in a dipole magnet, this is synchrotron radiation.

The energy lost per dipole is:

```
U = C_gamma * E^4 * |theta| / rho
```

The E^4 dependence is brutal. Doubling the beam energy increases radiation loss by 16x. This is why:
- Low-energy linacs (< 100 MeV) barely notice synchrotron radiation
- Multi-GeV machines must account for it in dipole design
- Electron circular colliders above ~100 GeV are impractical (the LEP ring at CERN reached its limit around 100 GeV per beam)

**Quantum excitation:** Synchrotron radiation is emitted as individual photons. Each photon emission is random, creating a "quantum kick" to the emitting electron. This causes:
- **Energy spread growth:** Random energy changes broaden the distribution
- **Emittance growth:** In dispersive regions, energy change → position change → emittance growth

In a storage ring, quantum excitation and radiation damping reach an equilibrium. In a linac (single pass), there's only growth — another reason to minimize unnecessary bending.

**The Math:**

Energy loss per dipole:
```
U = C_gamma * E^4 * |theta| / rho
C_gamma = 8.85e-5 m/GeV^3
```

For a 1 GeV electron in a 1 m long, 15-degree bend: `rho = L/theta = 1/0.262 = 3.82 m`, `U = 8.85e-5 * 1 * 0.262 / 3.82 = 6.1 uGeV`. Tiny!

For a 10 GeV electron in the same bend: `U = 8.85e-5 * 10000 * 0.262 / 3.82 = 6.1 mGeV`. Still small but measurable.

For a 100 GeV electron: `U = 61 GeV`. The electron loses more than half its energy in one bend! This is why 100 GeV electron dipoles must have enormous bending radii.

---

## Beam Loss

**Quick Tip:** If the beam is bigger than the pipe, particles hit the wall and are lost. Enough loss and the beam trips off.

**How It Works:**

The beam pipe has a finite aperture (typically 25-50 mm radius). Particles whose transverse position exceeds this aperture hit the wall and are absorbed. Since the beam has a Gaussian distribution, there's always a small fraction in the tails that exceeds any finite aperture.

The loss fraction depends on how many "sigmas" the aperture is:
- 3 sigma aperture: 0.3% loss
- 4 sigma: 0.006% loss
- 5 sigma: 0.00006% loss

Loss compounds down the line: current is scaled at every element, and since income scales with surviving current, a machine that scrapes 10% at each of twenty quads earns a fraction of what it should.

Common causes of excessive loss:
- **No focusing:** Beam diverges until it hits the wall
- **Mismatched optics:** Beta beating causes the beam to be intermittently too large
- **Dispersion:** Energy spread creates an effective beam size increase in dispersive regions
- **Space charge:** Self-charge pushes the beam outward at low energy
- **Residual gas:** beam-gas collisions knock particles out along the whole line (see below)

> **Known limitation:** the engine has a beam-trip path — a beamline whose beam reports `alive: false` is faulted and stopped — but nothing in the physics ever sets that flag. `beam.alive` is initialised true and never cleared. There is currently **no 50% loss trip**; a beamline that loses 99% of its current keeps running and simply earns almost nothing.

**The Math:**

Loss fraction at an aperture `a`:
```
survived = erf(a / (sqrt(2) * sigma_x)) * erf(a / (sqrt(2) * sigma_y))
loss = 1 - survived
```

---

## Beam-Gas Scattering

**Quick Tip:** Your beam collides with whatever gas is left in the pipe. It grows emittance and eats current — and it hurts a low-energy beam far more than a high-energy one.

**How It Works:**

No vacuum is perfect. The residual gas in the beam pipe scatters the beam two ways:

**Multiple Coulomb scattering.** Each particle takes a huge number of tiny deflections off gas nuclei. The deflections are random, so they add in quadrature and show up as growth in the beam's angular spread — which is emittance growth, and emittance is the thing that pays. This is the *only* path by which vacuum reaches beam quality.

**Beam-gas loss.** Large-angle and nuclear scattering removes particles outright. Current decays exponentially with the length of pipe traversed, with a loss length inversely proportional to pressure: a decade better vacuum buys a decade more lifetime.

The scaling that matters for how you build:

```
d<theta^2> = C_scatter * P * L / (beta*gamma)^2
```

That `1/(beta*gamma)^2` is the whole design lesson. **A low-energy beam is enormously more fragile than a high-energy one.** Ten metres of mediocre vacuum right after the gun does more damage than a hundred metres of the same vacuum at 1 GeV. Put your pumps at the injector.

For a 50 MeV electron beam through a 10 m beta function: 1e-9 mbar over 100 m grows emittance about 0.03% — free. 1e-5 mbar over the same 100 m grows it about 2.5x — severe. The utility solver already maps 1e-4 mbar to quality zero, so a beam that barely survives 1e-5 is the correct outcome, not an overtuned penalty.

**What replaced the old model:** vacuum used to narrow the "effective aperture" in proportion to a 0-1 vacuum quality scalar. That could never work — aperture clipping only scales current, never the covariance matrix, and beam quality is an emittance ratio. Worse, clipping a Gaussian tighter scrapes halo, which is how emittance is *improved* in reality, so the proxy pointed backwards. It has been deleted.

**The Math:**

```
d<theta^2> = C_scatter * P * L / (beta*gamma)^2      C_scatter = 0.05
sigma[1,1] += d<theta^2>
sigma[3,3] += d<theta^2>

I *= exp(-L / lambda),   lambda = 100 m * (1e-5 mbar / P)
```

Divergence growth is added to the covariance matrix exactly as synchrotron radiation adds quantum excitation, so emittance growth emerges from the determinant rather than being imposed on it.

Pressure below 1e-12 mbar is treated as negligible. A component with *no* solved pressure is skipped rather than assumed to be at either extreme — but an unwired vacuum sink fails closed at 1013 mbar, which will destroy the beam, and also blocks it outright.
