# Diagnostics & Probe Plots

The Probe window is your primary tool for understanding what the beam is doing. Place probes on beamline components to see detailed physics at that location, and along-beamline plots showing how the beam evolves through your machine.

## How to Use the Probe

1. Press **P** to enter Probe mode
2. Click on any beamline component to add a probe pin (up to 6)
3. The Probe window opens with a 2x2 grid of plots
4. Change plot types using the dropdown in each cell
5. Click probe pins in the legend to switch the active measurement point

---

## Along-Beamline Plots

These plots show how a quantity evolves from source to endpoint, with the horizontal axis being distance along the beamline (s in metres).

### Beam Envelope

**Quick Tip:** Shows beam size (sigma_x and sigma_y) in millimetres along the beamline.

**How It Works:**

This is usually the first plot you should look at. It shows the RMS beam size in both transverse planes. You want to see:
- **Oscillating pattern** from your FODO cells — the beam gets wider between quads and narrower at each focusing quad
- **Bounded oscillation** — if the envelope grows without limit, your focusing is too weak or unstable
- **No sudden jumps** — a jump means the beam hit an aperture or something changed abruptly

Sigma_x (blue, solid) and sigma_y (red, dashed) should both stay well within the beam pipe aperture (typically 25-50 mm). If either exceeds the pipe radius, you'll see losses in the Current & Loss plot.

---

### Emittance

**Quick Tip:** Shows normalized emittance (epsilon_n) — the conserved measure of beam quality.

**How It Works:**

Normalized emittance should ideally be flat along the beamline. That means your optics are preserving beam quality. When you see it increase, something is degrading the beam:

- **Jump at a dipole** → synchrotron radiation (quantum excitation) is growing the emittance. Worse at high energy.
- **Gradual growth at low energy** → space charge is pushing the beam apart
- **Steady growth over long drifts, worst near the injector** → beam-gas scattering. Emittance growth from residual gas scales as `P x L / (beta gamma)^2`, so it shows up first at low energy and it gets worse the more pipe you have per pump.
- **Slow drift upward** → possible mismatch or numerical effects

The emittance plot shows normalized emittance (epsilon_n = beta*gamma * epsilon_geometric). This removes the adiabatic damping effect of acceleration — so you can see true degradation rather than the expected shrinkage from gaining energy.

---

### Current & Loss

**Quick Tip:** Shows beam current in mA along the beamline. Red-shaded regions mark where beam is being lost.

**How It Works:**

Current should ideally stay flat from source to endpoint. Every drop means particles hit the wall, a collimator, or were scattered by residual gas.

Red-shaded regions highlight where current decreases — these are your problem areas. Common causes:
- **Large beam at a tight aperture** — fix your focusing upstream
- **After a dipole** — dispersion increases effective beam size; particles at different energies spread out and hit the wall
- **A steady decay over a long stretch of pipe** — beam-gas loss. That is a vacuum problem, not an optics problem: add pumps, especially near the injector.

Loss is not currently a trip condition — a beamline that loses 99% of its current keeps running, it just earns almost nothing. Fix the worst loss point first anyway; income scales with surviving current.

---

### Beam Power

**Quick Tip:** Shows the beam's average power along the beamline, calculated by the physics solver as kinetic energy times surviving current.

**How It Works:**

Beam power combines the two quantities that determine how much energy the beam can deliver: `P = E × I`. With the envelope's units, `1 GeV × 1 mA = 1 MW`. The plot automatically displays W, kW, MW, or GW so low-energy injectors and high-energy machines remain readable on the same plot type.

Power rises when RF adds energy, falls when particles are lost, and can do both across a lossy accelerating section. Compare it with Energy and Current & Loss to tell those cases apart. This is average beam power; Peak Current describes the much larger within-bunch current used for FEL and collective-effect calculations.

---

### Energy & Dispersion

**Quick Tip:** Dual-axis plot showing beam energy (GeV, left) and horizontal dispersion (eta_x in metres, right).

**How It Works:**

**Energy (green, left axis):** Shows how the beam gains energy through RF cavities and loses it in dipoles (synchrotron radiation). You should see:
- Step increases at each RF cavity
- Tiny decreases at dipoles (visible only at high energy)
- The total determines what physics you can do at the endpoint

**Dispersion (orange dashed, right axis):** Shows how much the beam position depends on energy. Dispersion is created by dipoles and must be managed:
- Zero dispersion at the source
- Jumps up in dipoles
- Propagates through drifts (eta grows by eta' * L)
- Can be focused/closed by quads (matching)

Non-zero dispersion at an undulator or interaction point is bad — it increases effective beam size and degrades performance. The dispersion plot helps you verify your lattice design is closing the dispersion where it needs to be.

---

### Bunch Evolution

**Quick Tip:** Shows RMS bunch duration (sigma_t) and relative energy spread (sigma_E/E) along the beamline.

**How It Works:**

The cyan line is the bunch's duration, automatically shown in fs, ps, or ns as appropriate. A falling line means the bunch is getting shorter. The magenta dashed line is RMS energy spread, shown as percent or ppm. Together they explain whether longitudinal manipulation is improving the beam or merely trading one problem for another.

- **Shorter bunch plus higher Peak Current** — compression is working
- **Shorter bunch plus rapidly growing energy spread** — compression works, but beam quality may be degrading
- **Energy-spread jump in a bend or chicane** — coherent synchrotron radiation may be the cause
- **No change through a chicane** — check the incoming RF chirp and the chicane's R56

Overlay **Peak Current** to see the compression relationship directly: as bunch duration falls, peak current should rise when bunch charge is preserved. This plot follows those summary quantities over distance; use **Longitudinal Phase Space** at a probe pin to inspect the time-energy ellipse and chirp at one specific point.

---

### Beam Beta & Acceptance

**Quick Tip:** Shows the beam's relativistic velocity beta = v/c against each accelerating component's usable beta window.

**How It Works:**

The cyan line is the beam velocity from 0 (stationary) to 1 (the speed of light). Colored bands are the acceptance windows authored for the RF structure under the beam:

- **Green band** — the beam enters inside the structure's beta window
- **Red band** — the beam is mismatched; the transit-time factor reduces its effective voltage and adds transverse mismatch
- **Gold dashed line** — the structure's design beta, or the local synchronous beta in an RFQ/DTL whose cells lengthen as the beam accelerates

For protons, build an overlapping ladder: RFQ (very low beta), DTL, spoke cavity, 650 MHz cryomodule, then 805 MHz high-beta cryomodules. An RFQ takes a keV source to a few MeV and into the DTL's window; it does not make a proton relativistic in one step. Electron beams reach beta near 1 after only a few MeV, so their S-band and TESLA-style structures are high-beta hardware.

Hover the plot for numerical beam beta, the active min/design/max window, match state, and transit-time factor (TTF). Beam beta can also be selected as a secondary trace on any distance plot.

---

### Twiss Beta

**Quick Tip:** Shows the horizontal and vertical optical beta functions, beta_x and beta_y, in metres.

**How It Works:**

Twiss beta describes the focusing shape of the lattice rather than particle speed. Minima are beam waists; large peaks reveal weak focusing or a mismatched section. In a FODO lattice, beta_x and beta_y should alternate as the quadrupoles focus one plane and defocus the other.

This plot is related to the physical beam envelope through `sigma^2 = emittance * beta`. A large Twiss beta does not automatically mean a large beam if the emittance is very small, but it shows where the optics magnifies that emittance most strongly.

---

### Phase Advance

**Quick Tip:** Shows cumulative horizontal and vertical betatron phase, mu_x and mu_y, in degrees.

**How It Works:**

Phase advance accumulates according to `d mu / ds = 1 / beta(s)`. Strong focusing advances the betatron oscillation faster; weak focusing advances it more slowly. Use the curve to compare cells and verify that repeated sections contribute similar phase.

This is deliberately called **phase advance**, not tune. Tune is the number of betatron oscillations per complete turn of a closed ring. An open transport line has no one-turn tune.

---

### Magnetic Rigidity

**Quick Tip:** Shows magnetic stiffness, B-rho, in tesla-metres.

**How It Works:**

Rigidity is `B-rho = p / |q|`. As RF cavities increase momentum, the beam becomes harder for the same dipole field to bend and for the same quadrupole gradient to focus. For the game's electron and proton beams, both of which have unit charge magnitude, `B-rho [T*m] = p [GeV/c] / 0.299792458`.

For one particle species the rigidity curve resembles the energy curve, but it is the more useful quantity when judging magnet strength. A gradient that is gentle near the source may become too weak after acceleration.

---

### Peak Current

**Quick Tip:** Shows peak current in Amperes along the beamline. Uses log scale when the range is large. Critical for FEL.

**How It Works:**

Peak current is the current *within a single bunch* — much higher than the average current. FELs need peak currents of 1-10 kA to lase.

Before bunch compression, peak current is typically 10-100 A (set by the gun). After a chicane with proper chirp, it jumps by the compression ratio (10-100x). You should see:

- **Flat before the chicane** — peak current set by the source
- **Sharp increase at the chicane** — bunch compression working
- **Flat after the chicane** — compressed bunch propagating

If peak current doesn't jump at the chicane, check:
1. Is the upstream RF running off-crest? (need rfPhase != 0 for chirping)
2. Is the chirp sign correct for the R56 sign?
3. Is the R56 large enough?

The plot auto-switches to log scale when the range spans more than 2 orders of magnitude — common after compression.

---

## At-This-Point Plots

These plots show the beam state at the currently selected probe pin location.

### Phase Space

**Quick Tip:** Shows x-x' and y-y' phase space ellipses at the probe location. The ellipse area is the emittance.

**How It Works:**

Each ellipse represents the distribution of particles in position-angle space. A tilted ellipse means the beam is either converging (tilted clockwise) or diverging (tilted counter-clockwise).

- **Upright ellipse** — beam is at a waist (alpha = 0)
- **Tilted right** — beam is converging (will focus downstream)
- **Tilted left** — beam is diverging (will grow downstream)
- **Large ellipse** — high emittance or poor focusing
- **Circular** — matched beta function

The emittance value (epsilon) is shown above each ellipse. Compare x and y planes — they should be similar unless you have an intentionally flat beam (needed for colliders).

---

### Longitudinal Phase Space

**Quick Tip:** Shows the time-energy ellipse (dt vs dE/E) at the probe location. Tilt indicates chirp.

**How It Works:**

This plot is essential for understanding bunch compression (Tier 3). The longitudinal phase space shows how particles are distributed in time and energy:

- **Upright ellipse** — no chirp, no time-energy correlation
- **Tilted ellipse** — beam has a chirp (energy depends on position in the bunch). This is what you create with off-crest RF before a chicane.
- **After compression** — the ellipse rotates (chirp partially removed by R56), and the time extent shrinks (bunch is shorter)

The sigma_t and sigma_E values shown tell you the bunch length and energy spread. For FEL operation, you want sigma_E < rho (the FEL Pierce parameter).

---

### Summary Stats

**Quick Tip:** A reference card showing all key beam parameters at the probe location.

**How It Works:**

| Quantity | Symbol | Unit | What it tells you |
|----------|--------|------|-------------------|
| Energy | E | GeV | Beam energy at this point |
| Current | I | mA | Average beam current surviving to here |
| Peak Current | I_peak | A | Within-bunch current (critical for FEL) |
| Relativistic beta | beta | dimensionless | Beam speed as a fraction of the speed of light |
| Beam size x | sigma_x | mm | Horizontal RMS beam size |
| Beam size y | sigma_y | mm | Vertical RMS beam size |
| Norm emittance x | epsilon_nx | m-rad | Horizontal normalized emittance |
| Norm emittance y | epsilon_ny | m-rad | Vertical normalized emittance |
| Dispersion x | eta_x | m | Horizontal dispersion |
| Beta function x | beta_x | m | Twiss beta (beam optics parameter) |
| Beta function y | beta_y | m | Twiss beta (beam optics parameter) |
| Magnetic rigidity | B-rho | T-m | Beam stiffness against magnetic bending and focusing |
| Phase advance x | mu_x | deg | Cumulative horizontal betatron phase |
| Phase advance y | mu_y | deg | Cumulative vertical betatron phase |
| Energy spread | sigma_E | (fractional) | RMS relative energy spread |
| Bunch length | sigma_t | s | RMS bunch length in time |

Place probes at key locations to compare:
- **After the gun** — check initial beam quality
- **After each compression stage** — verify bunch shortened
- **At the undulator entrance** — verify all parameters meet FEL requirements
- **At the IP (collider)** — check beam size and current for luminosity
