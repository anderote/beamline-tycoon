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
- **Jump at a chicane** → CSR is degrading emittance during bunch compression
- **Slow drift upward** → possible mismatch or numerical effects

The emittance plot shows normalized emittance (epsilon_n = beta*gamma * epsilon_geometric). This removes the adiabatic damping effect of acceleration — so you can see true degradation rather than the expected shrinkage from gaining energy.

---

### Current & Loss

**Quick Tip:** Shows beam current in mA along the beamline. Red-shaded regions mark where beam is being lost.

**How It Works:**

Current should ideally stay flat from source to endpoint. Every drop means particles hit the wall, a collimator, or were scattered by residual gas.

Red-shaded regions highlight where current decreases — these are your problem areas. Common causes:
- **Large beam at a tight aperture** — fix your focusing upstream
- **Collimator scraping** — intentional, but check if it's cutting too much
- **After a dipole** — dispersion increases effective beam size; particles at different energies spread out and hit the wall

If total loss exceeds 50%, the beam trips off automatically (machine protection). Fix the worst loss point first.

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
| Beam size x | sigma_x | mm | Horizontal RMS beam size |
| Beam size y | sigma_y | mm | Vertical RMS beam size |
| Norm emittance x | epsilon_nx | m-rad | Horizontal normalized emittance |
| Norm emittance y | epsilon_ny | m-rad | Vertical normalized emittance |
| Dispersion x | eta_x | m | Horizontal dispersion |
| Beta function x | beta_x | m | Twiss beta (beam optics parameter) |
| Beta function y | beta_y | m | Twiss beta (beam optics parameter) |
| Energy spread | sigma_E | (fractional) | RMS relative energy spread |
| Bunch length | sigma_t | s | RMS bunch length in time |

Place probes at key locations to compare:
- **After the gun** — check initial beam quality
- **After each compression stage** — verify bunch shortened
- **At the undulator entrance** — verify all parameters meet FEL requirements
- **At the IP (collider)** — check beam size and current for luminosity
