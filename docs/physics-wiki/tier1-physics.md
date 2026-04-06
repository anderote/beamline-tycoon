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

In the game, if cumulative losses exceed 50%, the beam "trips" — it shuts off automatically (like a real machine protection system). You need to redesign your optics to reduce losses.

Common causes of excessive loss:
- **No focusing:** Beam diverges until it hits the wall
- **Mismatched optics:** Beta beating causes the beam to be intermittently too large
- **Dispersion:** Energy spread creates an effective beam size increase in dispersive regions
- **Space charge (Tier 2):** Self-charge pushes the beam outward at low energy

**The Math:**

Loss fraction at an aperture `a`:
```
survived = erf(a / (sqrt(2) * sigma_x)) * erf(a / (sqrt(2) * sigma_y))
loss = 1 - survived
```

The beam trips when `total_loss > 0.5` (50% of initial current lost).
