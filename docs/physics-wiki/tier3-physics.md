# Tier 3 Physics — Free Electron Laser

---

## Bunch Compression

**Quick Tip:** Off-crest RF creates an energy chirp; the chicane converts it to bunch shortening. This raises peak current by 10-100x.

**How It Works:**

FELs need extremely high peak current (1-10 kA) to achieve lasing. The source produces bunches with ~50-100 A peak current. Bunch compression bridges this gap.

**Step 1: Create the chirp.** Run an RF section slightly off-crest. Instead of maximum energy gain (on-crest, phase = 0), you run at phase = -15 to -25 degrees. This gives:
- Slightly less total energy gain: `dE = V * cos(phase)` (at -20 deg, you get 94% of max)
- An energy-time correlation: `dE/dt = 2*pi*f * V * sin(phase)` — particles at the tail get more energy than particles at the head

**Step 2: Compress in the chicane.** The chicane's R56 converts the energy correlation into a path length difference:
- Higher-energy tail particles take a shorter path
- Lower-energy head particles take a longer path
- The tail catches up to the head
- The bunch gets shorter

**Step 3: Accelerate after compression.** After compression, the energy chirp is still present (now with reversed sign). Continued acceleration reduces the relative energy spread (it's a fixed dE on a larger E). More acceleration also raises gamma, suppressing space charge and CSR in subsequent sections.

**The compression ratio:**
```
C = 1 / |1 + h * R56|
```
where `h` is the linear chirp (1/m), `R56` is in metres.

Example: If `h = 20 /m` and `R56 = -0.045 m`:
```
C = 1 / |1 + 20 * (-0.045)| = 1 / |1 - 0.9| = 1/0.1 = 10
```
A 1 ps bunch becomes 100 fs. Peak current goes from 50 A to 500 A.

**The limits:**

| Limit | What happens | Mitigation |
|-------|-------------|------------|
| CSR | Emittance and energy spread grow in chicane dipoles | Two-stage compression, higher energy |
| RF curvature | Non-linear chirp → horns in current profile | Harmonic linearizer |
| Space charge | At low energy, compressed bunch fights itself | Compress after some acceleration |
| Microbunching instability | Small density modulations get amplified | Laser heater (adds controlled energy spread) |

---

## Coherent Synchrotron Radiation (CSR)

**Quick Tip:** When the bunch gets short in a chicane, it radiates coherently — this degrades emittance and is the main limit on compression.

**How It Works:**

Normal synchrotron radiation is *incoherent*: each electron radiates independently, and the total power scales linearly with the number of electrons (P ~ N).

When the bunch length becomes comparable to or shorter than the radiation wavelength, the electrons radiate *in phase*. The radiation fields add coherently, and the power scales as N^2. For N = 10^10 electrons, this is a factor of 10^10 increase.

This coherent radiation (CSR) creates a longitudinal force within the bunch:
- The tail of the bunch radiates and the head absorbs → net energy loss at the tail, energy gain at the head
- This is the opposite of the intended chirp direction
- In the chicane's dispersive section, this energy change converts to a transverse kick → emittance growth

**The CSR energy spread:**
```
sigma_delta_CSR ~ (N * r_e) / (R^(2/3) * sigma_z^(4/3))
```

where `R` is the dipole bending radius and `sigma_z` is the bunch length.

**The CSR emittance growth:**
```
d_eps ~ (R56 * sigma_delta_CSR)^2 / beta_x
```

**What the player sees:** Over-compressing causes emittance to blow up. The optimal compression ratio balances peak current (want more) against emittance growth (want less). The FEL gain depends on both, so there's a clear optimum the player can find by tuning.

**Two-stage compression helps** because:
1. First chicane at moderate energy: compress 5-10x, moderate CSR
2. Accelerate to high energy: gamma^3 suppresses CSR
3. Second chicane at high energy: compress another 5-10x, minimal CSR
4. Total compression 25-100x with less emittance damage than single-stage 25-100x

---

## FEL Gain Process

**Quick Tip:** The FEL works by micro-bunching: the beam self-organizes at the radiation wavelength, then all electrons radiate together. It's an exponential instability — and that's a good thing.

**How It Works:**

The FEL process in an undulator:

1. **Spontaneous emission:** Electrons wiggling in the undulator emit radiation at the resonant wavelength. This is incoherent — just like regular synchrotron radiation from an undulator.

2. **Energy modulation:** The radiation field interacts with the electron beam. Some electrons gain energy, some lose energy, depending on their phase relative to the radiation wave.

3. **Micro-bunching:** In the undulator, electrons with more energy follow a slightly different path than those with less energy. Over many undulator periods, this causes electrons to cluster at the radiation wavelength — they "micro-bunch."

4. **Coherent emission:** Now the micro-bunched electrons radiate in phase. The radiation power grows. Stronger radiation → stronger micro-bunching → even stronger radiation. This is the exponential gain regime.

5. **Saturation:** Eventually the micro-bunches are fully formed and the electrons begin to *de-bunch* (the radiation field is so strong it overbunches them). Power stops growing — this is saturation.

**The gain length** determines how fast the power grows:
```
P(z) = P_noise * exp(z / L_gain)
```

The gain length is:
```
L_gain = lambda_u / (4 * pi * sqrt(3) * rho)
```

where `rho` is the FEL Pierce parameter.

**Saturation** occurs at roughly 20 gain lengths:
```
L_saturation ≈ 20 * L_gain
P_saturation = rho * E_beam * I_peak
```

If the undulator is shorter than the saturation length, you get partial lasing — exponentially less power for each missing gain length.

---

## Pierce Parameter

**Quick Tip:** The Pierce parameter rho is the single number that determines FEL performance. It depends on everything: current, emittance, energy, undulator. Bigger is better.

**How It Works:**

The FEL Pierce parameter (or rho parameter) is:

```
rho = (1 / (2*gamma)) * (I_peak * K^2 * lambda_u / (4 * I_A * sigma_x^2))^(1/3)
```

Typical values: rho = 10^-4 to 10^-3.

What rho tells you:
- **Gain length:** `L_gain ~ lambda_u / rho` — larger rho = shorter gain length = easier to saturate
- **Saturation power:** `P_sat = rho * P_beam` — larger rho = more output power
- **Bandwidth:** `delta_omega/omega ~ rho` — larger rho = broader bandwidth
- **Energy spread tolerance:** Need `sigma_dE/E < rho` for efficient lasing
- **Emittance tolerance:** Need `eps_n / gamma < lambda / (4*pi)` for overlap with radiation mode

**What the player controls and how it affects rho:**

| Parameter | How to increase it | Effect on rho |
|-----------|-------------------|---------------|
| Peak current | Better compression | rho ~ I^(1/3) |
| Beam size | Tighter matching at undulator | rho ~ 1/sigma_x^(2/3) |
| K parameter | Stronger undulator field | rho ~ K^(2/3) |
| Undulator period | Longer period (but: longer wavelength) | rho ~ lambda_u^(1/3) |
| Energy | Lower energy (but: longer wavelength) | rho ~ 1/gamma |

The trade-offs are real: higher energy gives shorter wavelength (more valuable) but lower rho (harder to lase). The player must find the optimum.

---

## Ming Xie Degradation

**Quick Tip:** The ideal 1D gain length gets worse when emittance, energy spread, or diffraction are significant. The Ming Xie formula quantifies how much.

**How It Works:**

The 1D gain length assumes a perfectly cold, perfectly matched beam in 1D. Real beams have:
- **Finite emittance** — the beam has angular spread, so not all electrons follow the ideal path
- **Energy spread** — electrons at different energies radiate at slightly different wavelengths, reducing coherence
- **Diffraction** — the radiation mode has a finite transverse size that may not match the beam

Each of these degrades the gain length:
```
L_gain_3D = L_gain_1D * (1 + eta)
```

where `eta` is computed from three dimensionless parameters:
- `eta_d = L_gain_1D / (4*pi*sigma_x^2 / lambda_r)` — diffraction
- `eta_e = 4*pi * L_gain_1D * sigma_delta / lambda_u` — energy spread
- `eta_gamma = L_gain_1D * 4*pi * eps_n / (gamma * lambda_r * sigma_x)` — emittance (this simplifies to `eps_n / (gamma * lambda_r / (4*pi))`)

The Ming Xie fit is a polynomial in these three parameters. For gameplay, a simplified model captures the essential scaling:

```
eta ≈ 0.45 * eta_d^0.57 + 0.55 * eta_e^1.6 + 2.0 * eta_gamma^2.9
     + 0.35 * eta_d^0.25 * eta_gamma^1.6 + 51 * eta_e^0.95 * eta_gamma^3.0
     + ...
```

**What the player sees:** The gain length in the FEL diagnostic panel shows both the ideal 1D value and the degraded 3D value. The ratio tells you what's limiting performance. If emittance is the dominant term, go back and improve the injector. If energy spread dominates, tune the compression. If diffraction dominates, focus tighter at the undulator.

---

## FEL Photon Properties

**Quick Tip:** The FEL wavelength is set by beam energy and undulator design. The game rewards shorter wavelengths (higher photon energy).

**How It Works:**

**Wavelength:**
```
lambda = lambda_u / (2 * gamma^2) * (1 + K^2/2)
```

This is the resonance condition — the electron travels one undulator period while the light travels one period plus one radiation wavelength. Constructive interference occurs.

| Regime | Wavelength | Energy needed (30mm period) | Applications |
|--------|-----------|---------------------------|-------------|
| THz | > 100 um | ~10 MeV | Material science |
| Infrared | 1-100 um | 30-300 MeV | Molecular dynamics |
| UV/EUV | 10-400 nm | 0.5-3 GeV | Lithography, surface science |
| Soft X-ray | 0.3-10 nm | 3-10 GeV | Protein imaging, magnetism |
| Hard X-ray | < 0.3 nm | > 10 GeV | Crystallography, atomic resolution |

**Pulse properties:**
- **Duration:** Comparable to electron bunch length (fs to ps)
- **Photons per pulse:** 10^11 to 10^13 at saturation
- **Peak brilliance:** 10^33 photons/s/mm^2/mrad^2/0.1%BW — a billion times brighter than synchrotrons

**Science output in the game** scales with:
- **Brilliance** (peak power / wavelength) — brighter, shorter wavelength = more science
- **FEL saturation fraction** — must actually reach saturation for full output
- **Beam stability** — consistent shot-to-shot performance (future feature)
