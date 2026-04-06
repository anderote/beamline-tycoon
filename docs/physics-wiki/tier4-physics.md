# Tier 4 Physics — Electron-Positron Collider

---

## Luminosity

**Quick Tip:** Luminosity = collision rate per unit cross-section. It depends on how many particles you can squeeze into the smallest possible spot.

**How It Works:**

Luminosity is THE figure of merit for a collider. It determines how many collisions per second you get:

```
Event rate = Luminosity * cross-section
```

The cross-section is fixed by physics (it's how "big" the particles look to each other for a given process). You can only control the luminosity.

**The luminosity formula:**
```
L = (N1 * N2 * f_rep) / (4 * pi * sigma_x* * sigma_y*)
```

where:
- `N1, N2` = number of particles per bunch in each beam
- `f_rep` = collision frequency (bunch repetition rate)
- `sigma_x*, sigma_y*` = beam sizes at the interaction point (IP)

**What the player controls:**

| Factor | How to increase luminosity | Challenge |
|--------|--------------------------|-----------|
| N (bunch population) | Higher source current, better transmission | Space charge, wakefields, beam loading |
| f_rep (rep rate) | More bunches per second | RF power consumption, heat load |
| sigma_x* (horizontal IP size) | Stronger final focus | Chromatic aberration, alignment |
| sigma_y* (vertical IP size) | Stronger final focus | Beam-beam limit, chromaticity |

**Flat beams:** Real e+e- colliders use *flat beams* — much wider than tall (sigma_x >> sigma_y). This maximizes luminosity while keeping the beam-beam tune shift below the instability threshold. The ILC design has sigma_x = 500 nm, sigma_y = 5 nm — a 100:1 aspect ratio.

**Integrated luminosity:** What matters for physics discoveries is not the instantaneous luminosity but the *integral* over time: how many total collisions you accumulate. This is why machine uptime and reliability matter — a higher-luminosity machine that's always broken produces less physics than a moderate machine that runs reliably.

In the game, integrated luminosity is the success metric. It accumulates over time and determines when you achieve enough data for a "discovery."

**The Math:**

Converting from average current to bunch population:
```
N = I_avg / (e * f_rep)
```

For I = 1 mA and f_rep = 1 MHz: `N = 10^-3 / (1.6e-19 * 10^6) = 6.25 * 10^9` particles per bunch.

Luminosity with these parameters and sigma_x* = 500 nm, sigma_y* = 5 nm:
```
L = (6.25e9)^2 * 10^6 / (4 * pi * 500e-9 * 5e-9)
  = 3.9e25 / (3.14e-11)
  = 1.2e36 /cm^2/s
```

That's 10^36 — a very high luminosity, comparable to the ILC design.

---

## Beam-Beam Effects

**Quick Tip:** Each beam acts as a powerful lens for the other. This enhances luminosity but limits how much charge you can collide.

**How It Works:**

When the two beams meet at the IP, each beam's electromagnetic field deflects particles in the opposing beam. This *beam-beam interaction* is the strongest force the particles experience in the entire machine.

**Beam-beam tune shift:** The beam-beam force acts like a focusing lens. The tune shift quantifies how strong this lens is:

```
xi_y = (N * r_e * beta_y*) / (4 * pi * gamma * sigma_y* * (sigma_x* + sigma_y*))
```

If `xi_y > ~0.05`, the beam becomes unstable — particles are kicked into resonances and lost. This is the *beam-beam limit* and it's the fundamental constraint on collider luminosity.

**Disruption:** For a single-pass (linear) collider, the beams interact once and are discarded. This allows much higher disruption than a circular collider. The disruption parameter is:

```
D_y = (2 * N * r_e * sigma_z) / (gamma * sigma_y* * (sigma_x* + sigma_y*))
```

For D > 1, the beams significantly "pinch" (focus) each other during the collision. This actually enhances luminosity — the *pinch enhancement factor* `H_D` can be 1.5-2x.

**What the player sees:**
- Luminosity enhancement from pinch (good)
- A hard limit from beam-beam tune shift (can't just crank up the charge)
- The trade-off: smaller sigma_y* increases both luminosity AND tune shift
- Flat beam aspect ratio (sigma_x >> sigma_y) helps maximize luminosity within the tune shift budget

---

## Final Focus

**Quick Tip:** The final focus system squeezes the beam to nanometer size at the IP. It's the most demanding optics in the whole machine.

**How It Works:**

To achieve nanometer-scale beam sizes at the IP, you need very strong focusing — the beta function at the IP (beta*) must be millimeters, compared to metres in the rest of the machine. This means the beam divergence at the final doublet is enormous: `sigma' = sigma* / beta* = eps/sigma*`.

The final focus is a set of very strong quadrupoles close to the IP. The challenge is **chromaticity**: particles with different energies are focused differently. With a typical energy spread of 0.1%, chromatic aberration limits how small you can make the beam.

**Chromatic correction** uses sextupoles in dispersive regions (created by dedicated dipoles in the final focus system) to cancel the chromaticity. This is sophisticated optics — the sextupoles must be placed at exactly the right phase advance from the final quadrupoles.

**What the player must do:**
1. Build strong final-focus quadrupoles close to the IP
2. Achieve very low beta* (the lower, the higher the luminosity)
3. Add sextupoles for chromatic correction (otherwise energy spread kills the focus)
4. Keep the energy spread low (from good compression control)
5. Align everything precisely (in a future game version — alignment tolerances)

**The Math:**

The minimum achievable IP beam size with chromaticity is approximately:
```
sigma_y* >= sqrt(eps_y * beta_y*) * sqrt(1 + (xi_chrom * sigma_delta)^2)
```

where `xi_chrom = -(1/(4*pi)) * integral(beta * k * ds)` is the linear chromaticity. Without correction, chromaticity limits sigma* to much larger values than the ideal `sqrt(eps * beta*)`.

---

## Positron Production

**Quick Tip:** Making positrons is hard — you need a high-energy beam, a target, strong capture optics, and a way to cool the captured positrons.

**How It Works:**

The positron production chain is a machine within the machine:

**Step 1: Drive beam or photon source.** You need high-energy particles to create electron-positron pairs. Options:
- **Conventional:** Slam a ~few-GeV electron beam into a tungsten target
- **Undulator-based:** Use a helical undulator on the main electron beam to produce polarized photons, which then hit a thinner target. Produces polarized positrons.

**Step 2: Target.** The high-energy particles create electromagnetic showers in the target. Pair production (gamma → e+ e-) creates positrons at all energies and angles. The target must survive the intense beam power — typically a rotating wheel or a liquid metal jet.

**Step 3: Capture.** A strong solenoid (or lithium lens) immediately after the target focuses the divergent positrons. The captured positron beam has huge emittance (mm-rad) and large energy spread (tens of %).

**Step 4: Cooling.** The captured positrons must be cooled (emittance reduced) before they can be used in the collider. Options:
- **Damping ring:** A small electron storage ring where synchrotron radiation damps the emittance (this is where rings become relevant even in an otherwise linear machine)
- **Adiabatic damping:** Accelerate the positrons — geometric emittance shrinks as gamma increases

**Step 5: Acceleration.** The cooled positrons are injected into a linac (possibly the same linac as the electrons, running in the opposite direction) and accelerated to collision energy.

**Positron yield:** Typically 1-5 positrons captured per 100 electrons on target. The yield depends on:
- Drive beam energy
- Target material and thickness (must balance yield vs. power deposition)
- Capture optics strength
- Acceptance of the downstream transport

**In the game:** The player must build a dedicated positron source sub-beamline. This is a significant challenge because:
- It requires diverting beam energy from the main electron line
- The capture optics must handle a very different beam than the main linac
- The positron beamline must produce a beam matched to the collider requirements
- Everything from Tiers 1-3 applies to both the electron AND positron beamlines

---

## Crossing Angle

**Quick Tip:** A small crossing angle between the beams prevents parasitic collisions but reduces luminosity. The angle must be carefully chosen.

**How It Works:**

If the two beams collide head-on (zero crossing angle), they interact not just at the intended IP but also at nearby points where the bunches overlap. These *parasitic collisions* disturb both beams.

A small crossing angle (1-20 mrad) separates the beams everywhere except the IP. But the angle reduces the effective overlap of the bunches, lowering luminosity by the Piwinski reduction factor:

```
S = 1 / sqrt(1 + (phi * sigma_z / (2 * sigma_x*))^2)
```

where `phi` is the half crossing angle.

For short bunches (sigma_z << sigma_x*/phi), the reduction is small. For long bunches, it can be severe. This is another reason to compress bunches.

**Crab cavities** (a future feature) can rotate the bunches so they collide head-on even with a crossing angle, recovering the lost luminosity.

**In the game:** The player sets the crossing angle on the detector/IP component. Zero angle gives maximum luminosity but may cause instabilities (modeled as increased beam loss). A small angle is the safe choice; very small angles are the advanced optimization.

---

## Discovery Physics

**Quick Tip:** With enough integrated luminosity, you can discover new particles. The discovery threshold depends on the center-of-mass energy and accumulated data.

**How It Works:**

The whole point of a collider is to discover new physics. In the game, discoveries are triggered when:

1. **Center-of-mass energy** exceeds a threshold (each discovery has a minimum energy)
2. **Integrated luminosity** exceeds a threshold (enough data to claim a statistically significant observation)

The center-of-mass energy for an e+e- collider is:
```
sqrt(s) = 2 * E_beam  (for head-on collisions of equal-energy beams)
```

Famous thresholds:
| Discovery | sqrt(s) needed | Luminosity needed |
|-----------|---------------|-------------------|
| J/psi (charm quark) | 3.1 GeV | Low |
| Upsilon (bottom quark) | 9.5 GeV | Low |
| Z boson | 91 GeV | Moderate |
| W pair production | 161 GeV | Moderate |
| Higgs boson (e+e-) | 240 GeV | High |
| Top quark pair | 350 GeV | High |

In the game, reaching each threshold is a major milestone. The luminosity requirements scale with the rarity of the process — the Higgs requires much more data than the J/psi because its production cross-section is much smaller.
