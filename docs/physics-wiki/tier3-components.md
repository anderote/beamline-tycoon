# Tier 3 Components — Free Electron Laser

Tier 3 introduces the components needed to build a free electron laser. The challenge is producing an ultra-short, ultra-bright electron bunch and sending it through a long undulator to produce intense, coherent X-ray light.

---

## Bunch Compressor Chicane

**Quick Tip:** A chicane compresses the bunch by making high-energy particles take a shorter path — but CSR fights back.

**How It Works:**

A chicane is a set of four dipole magnets arranged in a dogleg pattern: the beam is deflected out, travels a longer path, and is deflected back onto the original axis. The key property is the **R56** — the path length dependence on energy:

```
path_length_change = R56 * (dE/E)
```

If the beam has an energy *chirp* (head has lower energy, tail has higher energy — imparted by an off-crest RF cavity upstream), then:
- Higher-energy particles (tail) take a shorter path through the chicane
- Lower-energy particles (head) take a longer path
- The tail catches up to the head
- The bunch gets shorter

The compression ratio is:

```
C = 1 / |1 + h * R56|
```

where `h` is the chirp rate (energy-position correlation). A compression ratio of 10x turns a 1 ps bunch into 100 fs.

**The enemy: CSR.** As the bunch gets short inside the chicane dipoles, it begins to radiate *coherently* — all the electrons radiate in phase, and the radiation power scales as N^2 (where N is the number of electrons) instead of N. This CSR:
- Adds energy spread (the tail loses more energy than the head)
- Causes emittance growth (via dispersion in the chicane)

This is the fundamental limit on single-stage compression. The player must balance compression ratio against CSR degradation.

**Two-stage compression:** The solution is to compress partway, accelerate to higher energy (suppressing CSR by gamma), then compress again in a second chicane. Most real FELs use two compression stages.

**Game parameters:**
- `r56` (mm): Momentum compaction. Typically -20 to -80 mm. More negative = more compression for a given chirp.

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Length | 5-15 m |
| R56 | -20 to -80 mm |
| Dipole bend angle | 3-10 degrees per dipole |
| Energy at BC1 | 200-500 MeV |
| Energy at BC2 | 2-5 GeV |

**Real-world example:** LCLS has two chicanes: BC1 at 250 MeV (R56 = -45 mm, compresses 6x) and BC2 at 5 GeV (R56 = -25 mm, compresses 10x). Total compression: ~60x.

---

## Sub-harmonic Buncher

**Quick Tip:** A buncher groups electrons into tighter bunches before main acceleration — it sets up the bunch structure.

**How It Works:**

A buncher is a short RF cavity operated at a sub-harmonic of the main linac frequency (e.g., 100-200 MHz vs. 1.3 GHz main). It doesn't add significant energy — instead, it modulates the beam's energy so that particles at the head of the bunch are slowed down and particles at the tail are sped up. After a drift, the bunch naturally compresses.

This is a gentler form of compression than a chicane, used early in the beamline (near the gun) to prepare the initial bunch structure.

**Game parameters:**
- `rfFrequency` (MHz): Buncher frequency
- `voltage` (MV): RF voltage — determines compression strength
- `rfPhase` (deg): Phase relative to bunch center

---

## Harmonic Linearizer

**Quick Tip:** Corrects the RF curvature that would otherwise limit compression — turns a sinusoidal chirp into a linear one.

**How It Works:**

The main linac RF field is sinusoidal: `V(t) = V0 * cos(omega * t)`. When you run off-crest to create a chirp, the chirp isn't perfectly linear — it follows the cosine curve. The head and tail of the bunch get slightly different chirp rates than the center.

This nonlinearity limits how much you can compress: the bunch center compresses properly, but the head and tail don't compress as well, leaving "horns" in the current profile.

A harmonic linearizer is a cavity at a higher harmonic (e.g., 3rd harmonic: 3.9 GHz if the main linac is 1.3 GHz). By adding a small amount of this higher frequency, you can cancel the curvature of the fundamental, producing a nearly linear chirp.

The result: much more uniform compression and a cleaner current profile at the undulator.

**Game parameters:**
- `rfFrequency` (MHz): Must be a harmonic of the main linac
- `voltage` (MV): Small — just enough to cancel the curvature
- `rfPhase` (deg): Relative phase to the main RF

**Real-world example:** The European XFEL uses a 3.9 GHz linearizer before each bunch compressor.

---

## Undulator

**Quick Tip:** The undulator wiggles the beam to produce coherent light. With the right beam, it becomes a free electron laser.

**How It Works:**

An undulator is a series of alternating-polarity magnets (permanent magnets or electromagnets) that force the electron beam to follow a sinusoidal path. As the electrons wiggle, they emit radiation. In an FEL, this radiation interacts with the electron beam, causing the electrons to *micro-bunch* at the radiation wavelength. Once micro-bunched, the electrons radiate coherently — producing intense, laser-like X-rays.

The undulator is where everything comes together. The FEL process requires:
- **High peak current** (from bunch compression) — more electrons radiating
- **Low emittance** (from the source, preserved through the linac) — tight beam overlaps the radiation field
- **Low energy spread** (careful RF and compression) — all electrons radiate at the same wavelength
- **Proper beam size** (from matching optics) — optimal overlap with the radiation mode

**Key parameters:**
- `period` (mm): Distance between magnet poles. Typically 15-40 mm. Shorter period = shorter wavelength but weaker field.
- `kParameter`: Dimensionless undulator strength. K = 0.934 * B[T] * period[cm]. Typically 1-4.

**The radiation wavelength:**
```
lambda = (period / (2 * gamma^2)) * (1 + K^2/2)
```

At 10 GeV (gamma = 19570) with period = 30 mm and K = 1.5:
```
lambda = 0.03 / (2 * 19570^2) * (1 + 1.5^2/2) = 0.03 / (7.66e8) * 2.125 = 8.3e-11 m = 0.083 nm
```

That's hard X-rays — angstrom-scale wavelength. This is what makes X-ray FELs revolutionary: they produce laser-like coherent X-rays a billion times brighter than synchrotron sources.

**Game parameters:**
- `period` (mm): Undulator period
- `kParameter`: Undulator K value
- `length` (m): Total undulator length — must be long enough for FEL saturation (~20 gain lengths)

**Typical values:**
| Facility | Energy | Period | K | Wavelength | Undulator Length |
|----------|--------|--------|---|-----------|-----------------|
| LCLS-I | 13.6 GeV | 30 mm | 3.5 | 0.15 nm | 112 m |
| European XFEL | 17.5 GeV | 40 mm | 3.9 | 0.05 nm | 175 m |
| SwissFEL | 5.8 GeV | 15 mm | 1.2 | 0.1 nm | 60 m |
| FLASH | 1.25 GeV | 27 mm | 1.2 | 4.2 nm (EUV) | 27 m |

---

## Helical Undulator

**Quick Tip:** Produces circularly polarized light — useful for specific experiments. Slightly higher photon flux than a planar undulator.

**How It Works:**

A helical undulator has magnets arranged so the beam follows a helical (corkscrew) path instead of a flat sinusoidal wiggle. The radiation is circularly polarized (left or right, depending on the helix direction).

Helical undulators have a slightly higher FEL coupling than planar undulators and produce no odd-harmonic radiation on axis — the spectrum is cleaner.

**Game effect:** Higher photon rate multiplier than standard undulator. Produces circularly polarized photons (relevant for certain experiments that may give bonus science output).

---

## Photon Port / Beamline Endstation

**Quick Tip:** Where the FEL light is delivered to experiments. More ports = more simultaneous experiments = more science output.

**How It Works:**

After the undulator, the electron beam is dumped and the photon beam continues to experimental stations. Each photon port includes:
- Mirrors and monochromators to select the desired wavelength
- Focusing optics to concentrate the X-rays on the sample
- Experimental hutch with detectors

In the game, photon ports are the "endpoints" of an FEL beamline — each one contributes to science output based on the FEL brilliance and the experiment type.

---

## Bunch Length Monitor

**Quick Tip:** Measures how short your bunches are — essential for tuning compression.

**How It Works:**

Bunch length monitors measure the temporal length of the electron bunch, typically using:
- **Coherent radiation detection:** Short bunches emit coherent THz radiation whose spectrum encodes the bunch length
- **Streak camera:** Converts temporal profile to spatial profile using a fast-sweeping electric field
- **RF deflecting cavity:** "Streaks" the bunch transversely, turning time into position on a downstream screen

After compression, the bunch length can be tens of femtoseconds — too short to measure with electronics alone.

**Game parameters:**
- `resolution_ps` (ps): Measurement resolution

**Game effect:** Without a bunch length monitor, the player can't see the result of compression and must guess whether the chicane is tuned correctly.

---

## Energy Spectrometer

**Quick Tip:** Measures beam energy and energy spread — a dipole plus a screen shows how much the energy varies within the bunch.

**How It Works:**

An energy spectrometer is a dedicated dipole magnet followed by a screen (or BPM array). The dipole bends the beam, and particles with different energies bend by different amounts, spreading out on the screen. The centroid gives the mean energy; the width gives the energy spread.

This is critical for FEL tuning because:
- You need to verify the chirp before the chicane
- You need to verify the energy spread after compression (CSR adds spread)
- The FEL requires low energy spread (< the Pierce parameter rho)

**Game effect:** Shows energy and energy spread in the diagnostics panel.
