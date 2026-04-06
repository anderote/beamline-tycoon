# Tier 4 Components — Electron-Positron Collider

Tier 4 is the endgame of the electron era. You build two beamlines that converge at an interaction point where electrons and positrons annihilate, producing new particles. This is particle physics at its most ambitious.

---

## Positron Target

**Quick Tip:** Slam high-energy electrons into a target to produce positron-electron pairs. The positrons are captured and fed into the second beamline.

**How It Works:**

There are no natural sources of positrons. To make them, you:

1. **Produce a high-energy electron beam** (or use photons from an undulator)
2. **Slam it into a dense target** (tungsten, typically). The high-energy electrons interact with the atomic nuclei and produce electromagnetic showers containing electron-positron pairs.
3. **Capture the positrons** with a strong solenoid (or lithium lens) immediately after the target. Positrons emerge at all angles, so you need a very strong focusing field to capture them.
4. **Cool and re-accelerate.** The captured positrons have a large energy spread and emittance. They must be decelerated, damped (in a damping ring, or through radiation), and re-accelerated to match the electron beam parameters.

Positron production is inherently inefficient — you might produce 1 positron for every 100 electrons hitting the target. The yield depends on:
- Electron energy (higher = more pairs)
- Target material and thickness
- Capture solenoid strength

In the game, the positron target is a major sub-project. You need a dedicated electron beamline (or photon source) to drive it, plus the capture and re-acceleration chain.

**Game parameters:**
- `collisionRate`: Base rate of positron production
- Requires upstream electron beam with sufficient energy (> 1 GeV recommended)

**Real-world example:** The ILC design uses a helical undulator on the main electron beam to produce photons, which then hit a target to produce positrons. The SLC at SLAC used a simpler scheme: the spent electron beam after the interaction point was directed onto a target.

---

## Detector

**Quick Tip:** The detector surrounds the interaction point and records every collision. Its output is your science data.

**How It Works:**

A particle physics detector is a massive instrument built in concentric layers around the collision point:

1. **Tracking detector (innermost):** Silicon pixels and strips that record the paths of charged particles with micrometer precision
2. **Electromagnetic calorimeter:** Dense crystal or liquid argon that absorbs electrons and photons, measuring their energy
3. **Hadronic calorimeter:** Iron and scintillator layers that absorb protons, neutrons, and pions
4. **Muon system (outermost):** Only muons penetrate to the outer layers — these chambers identify and measure them
5. **Solenoid magnet:** A large superconducting solenoid (2-4 T) bends charged particle tracks, allowing momentum measurement from track curvature

The detector doesn't affect the beam directly (the interaction region is designed to be transparent). But the detector's acceptance and resolution determine what physics you can observe.

In the game, the detector is the primary endpoint for a collider beamline. Its data rate depends on:
- **Luminosity** — more collisions = more data
- **Beam quality** — cleaner beams = less background
- **Detector type** — different detectors are optimized for different physics

**Game parameters:**
- `dataRate`: Base data rate multiplier

---

## Septum Magnet

**Quick Tip:** A septum separates two beams traveling close together — one beam passes through the field, the other through a field-free region.

**How It Works:**

A septum magnet has a thin (1-10 mm) conducting wall (the "septum") separating a magnetic field region from a field-free region. One beam passes through the field and is deflected; the other beam passes through the field-free region and continues straight.

In a collider, septa are used:
- To inject/extract beams into/from the interaction region
- To separate the electron and positron beams after the collision
- To route the spent beams to beam dumps

The septum thickness matters: thinner is better (less aperture loss) but harder to build and more prone to damage from stray beam.

**Game parameters:**
- `septumThickness` (mm): Thinner = better but more fragile
- `kickAngle` (mrad): Deflection angle

---

## Kicker Magnet

**Quick Tip:** A fast-pulsing magnet that deflects individual bunches — used for injection, extraction, and beam switching.

**How It Works:**

A kicker is a pulsed magnet with a very fast rise time (nanoseconds). Unlike a DC dipole, it can be turned on and off between bunches, allowing you to:
- Inject a single bunch into a beamline
- Extract a single bunch for diagnostics or dumping
- Switch bunches between different beamlines (for multiple interaction points)

Kickers are essential for collider operation because you need to steer individual bunches of electrons and positrons into the interaction point at precisely the right time.

**Game parameters:**
- `riseTime` (ns): How fast the kicker turns on. Must be shorter than the bunch spacing.
- `kickAngle` (mrad): Deflection angle

---

## Compton Interaction Point

**Quick Tip:** Scatter laser light off the electron beam to produce polarized gamma rays or to measure beam properties.

**How It Works:**

A Compton IP is where a laser beam intersects the electron beam. When a photon from the laser scatters off a relativistic electron, the photon gains enormous energy (Compton backscattering):

```
E_photon_max = 4 * gamma^2 * E_laser / (1 + 4*gamma*E_laser/(m_e*c^2))
```

For a 50 GeV electron (gamma = 98000) and a 2.4 eV laser photon:
```
E_photon_max ≈ 4 * 98000^2 * 2.4 eV ≈ 92 GeV
```

Almost all the electron's energy goes into the photon.

Uses in a collider:
- **Polarimetry:** Measure beam polarization (if the beam is polarized)
- **Energy measurement:** The Compton edge position gives precise beam energy
- **Luminosity monitor:** Count Compton-scattered photons for a luminosity measurement
- **Gamma-gamma collider option:** An advanced future feature where two Compton beams collide

**Game parameters:**
- `laserWavelength` (nm): Laser wavelength
- `crossingAngle` (deg): Angle between laser and electron beam
