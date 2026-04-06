# Tier 2 Physics — Photoinjector

---

## Space Charge

**Quick Tip:** At low energy, the beam's own electric charge pushes it apart. This is the dominant effect below ~100 MeV and the main enemy of brightness.

**How It Works:**

Every electron in the beam has a negative charge. Like charges repel. In a bunch of billions of electrons, this mutual repulsion (space charge) creates a defocusing force that pushes the beam outward.

Why doesn't this matter at high energy? Relativity. A moving charge creates both an electric field (repulsive) and a magnetic field (attractive, since parallel currents attract). At relativistic speeds, the magnetic force nearly cancels the electric force. The net force scales as `1/gamma^2`, so at 1 GeV (gamma ~ 2000), space charge is suppressed by a factor of 4 million.

But at the gun exit (10 MeV, gamma ~ 20), the suppression is only 400x. With billions of electrons in a tight bunch, space charge is the dominant force.

**What the player learns:**
- The first few MeV of acceleration are the most critical — the beam is most vulnerable here
- Higher current = more space charge = harder to control
- Getting through the low-energy region fast (high gradient) helps
- A solenoid right after the gun provides essential focusing to counteract space charge
- Longer bunches have lower peak charge density and less space charge — but FELs want short bunches (Tier 3 tension)

**The Math:**

The generalized perveance (dimensionless space charge strength):

```
K = (2 * I_peak) / (I_A * beta^3 * gamma^3)
```

where `I_A = 17045 A` is the Alfven current, and `I_peak` is the peak current in the bunch.

For a 50 A peak current beam at 5 MeV (gamma = 10, beta = 0.995):
```
K = (2 * 50) / (17045 * 0.995^3 * 10^3) = 5.9e-6
```

This seems small, but over a 1-metre drift, the beam size grows as:
```
sigma'' = K / (4 * sigma)
```

For a 1 mm beam: `sigma'' = 5.9e-6 / (4 * 0.001) = 1.5e-3 rad/m`. Over 1 metre, the beam doubles its divergence. Without focusing, the beam blows up within a few metres of the gun.

At 1 GeV (gamma = 2000):
```
K = (2 * 50) / (17045 * 1 * 8e9) = 7.4e-13
```

Completely negligible. This is why the space charge module turns off above ~100 MeV.

---

## Emittance Compensation

**Quick Tip:** Space charge grows emittance, but a well-placed solenoid can undo most of the damage — this is emittance compensation.

**How It Works:**

When the beam leaves the gun, space charge causes different longitudinal slices of the bunch to develop different emittances and Twiss parameters. The *projected* emittance (looking at all slices together) is larger than the *slice* emittance (each individual slice).

The Carlsten/Ferrario trick: place a solenoid at the right location and strength so that the different slices are "realigned" in phase space by the time the beam reaches the first accelerating section. The projected emittance drops back toward the slice emittance.

The optimal solenoid position and strength depend on:
- Gun voltage and gradient
- Bunch charge
- Laser spot size on cathode
- Distance to first accelerating cavity

In the game, this means the solenoid is not just "a focusing element" — its exact strength matters critically. Too strong or too weak, and the compensation doesn't work. The player needs to tune it by watching the emittance diagnostic.

**The rule of thumb:**

The solenoid field should create a beam waist at the entrance to the first accelerating section. The acceleration then "freezes" the space charge dynamics by rapidly increasing gamma.

```
B_sol ≈ 2 * sqrt(2 * m * V_gun) / (e * r_beam * z_acc)
```

where `z_acc` is the distance from cathode to first accelerating cavity.

---

## Beam Brightness

**Quick Tip:** Brightness = current / emittance^2. It measures how many particles you can squeeze into a small spot and angle — the ultimate figure of merit for a source.

**How It Works:**

Brightness combines the two things that matter about a beam: how much current it carries and how well-focused that current can be.

```
B = I / (eps_nx * eps_ny)
```

where `eps_nx, eps_ny` are the normalized emittances in x and y.

Why brightness? Because emittance is conserved (or grows) through the beamline, and current can only decrease (losses). The brightness you get from the source is the best you'll ever have. Everything downstream either preserves it or makes it worse.

A high-brightness source enables:
- **Smaller beam at focus** (lower emittance → tighter spot)
- **Higher peak current after compression** (same charge in shorter bunch)
- **Better FEL performance** (Tier 3 — Pierce parameter depends on brightness)
- **Higher luminosity** (Tier 4 — smaller IP spot size)

**Comparison of sources:**

| Source Type | Emittance (um-rad) | Current (mA) | Relative Brightness |
|------------|-------------------|-------------|-------------------|
| Thermionic gun | 5 | 10 | 1x (baseline) |
| DC photogun | 1 | 5 | 12.5x |
| NC RF gun | 0.5 | 50 (peak) | 500x |
| SRF gun | 0.3 | 20 (peak) | 555x |

The RF guns win on brightness by orders of magnitude, which is why every modern FEL uses one.

---

## Source Emittance

**Quick Tip:** The emittance from the source is set by the cathode — thermal energy, laser spot size, and field profile all matter.

**How It Works:**

The intrinsic (thermal) emittance from a photocathode is:

```
eps_thermal = sigma_laser * sqrt(MTE / (m_e * c^2))
```

where `sigma_laser` is the RMS laser spot size on the cathode and `MTE` is the Mean Transverse Energy of the emitted electrons.

MTE depends on the cathode material and laser wavelength:

| Cathode | MTE (meV) | Notes |
|---------|----------|-------|
| Copper (UV) | 150-300 | Robust, low QE |
| Cs2Te | 200-500 | Good QE (~5%), moderate emittance |
| GaAs (near-IR) | 30-50 | Polarized electrons, very fragile |
| Alkali antimonide | 100-200 | High QE (~10%), good lifetime |

Lower MTE = lower emittance. But low-MTE cathodes tend to be fragile, have lower QE, or require UHV conditions. This is a real engineering trade-off the player faces.

**The catch:** Smaller laser spot also reduces emittance, but concentrates the same charge in a smaller area, making space charge worse. There's an optimum spot size for each bunch charge.

**The Math:**

The optimal spot size balances thermal emittance against space charge emittance. The total emittance is approximately:

```
eps_total = sqrt(eps_thermal^2 + eps_sc^2 + eps_rf^2)
```

where:
- `eps_thermal = sigma * sqrt(MTE / mc^2)` — from cathode physics
- `eps_sc` — from space charge (depends on charge, spot size, gun gradient)
- `eps_rf` — from RF field curvature (depends on bunch length, frequency, spot size)

Minimizing the total requires optimizing spot size, bunch charge, gun gradient, and solenoid strength simultaneously. This is the injector designer's art — and the player's Tier 2 challenge.

---

## Diagnostics and Measurement

**Quick Tip:** You can only optimize what you can measure. Install diagnostics to see what your beam is actually doing.

**How It Works:**

At Tier 2, diagnostics become essential. At Tier 1, you could get away with "is the beam alive?" and "did it hit the target?" Now you need to know:

- **Emittance:** Is the source working well? Is space charge ruining the beam?
- **Beam size at multiple points:** Is the optics matched?
- **Current along the beamline:** Where are you losing beam?
- **Energy and energy spread:** Is the RF doing what you expect?

The game models diagnostics with finite resolution — each instrument has a measurement noise level. Better (more expensive) diagnostics give more accurate readings.

**Key diagnostic combinations:**

| What you want to know | What to install | Where |
|-----------------------|----------------|-------|
| Beam position | BPM | At every quad (minimum) |
| Transmission | ICT | At source and at end |
| Emittance | Wire scanner (x3) or Screen + quad scan | After gun, after first accel section |
| Energy | Spectrometer dipole + screen | After acceleration |
| Bunch length | Bunch length monitor | After compression (Tier 3) |

**Without diagnostics installed, the corresponding quantities show as "???" in the game's instrument panel.** You're flying blind. A real accelerator operator would never run without diagnostics, and neither should you.
