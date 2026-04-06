# Tier 2 Components — Photoinjector

Tier 2 unlocks high-brightness electron sources and the diagnostics to characterize them. The challenge shifts from "get beam to the target" to "produce the brightest beam possible."

---

## DC Photogun

**Quick Tip:** A laser hits a photocathode, releasing electrons with precise timing. Good current, moderate emittance.

**How It Works:**

A DC photogun uses a high-voltage DC field (100-500 kV) to accelerate electrons emitted from a photocathode. Unlike a thermionic gun, the electrons are released by a laser pulse hitting the cathode surface (the photoelectric effect). This gives precise control over when and how many electrons are produced.

Advantages over thermionic:
- **Timing control:** The laser defines the bunch structure
- **Better emittance:** The laser spot size on the cathode can be optimized
- **Higher brightness:** Lower thermal emittance from semiconductor photocathodes

Disadvantages:
- **Lower voltage:** DC guns are limited to ~500 kV by high-voltage breakdown. The beam spends more time at low energy where space charge is worst.
- **Cathode lifetime:** Photocathodes (GaAs, Cs2Te, alkali antimonides) degrade and must be replaced periodically

**Game parameters:**
- `extractionVoltage` (kV): Higher = less space charge, but harder to build
- `laserWavelength` (nm): Must match cathode material
- `cathodeQE` (%): Quantum efficiency — electrons out per photon in
- `laserSpotSize` (mm): Smaller spot = lower emittance, but higher charge density

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Voltage | 200-500 kV |
| Current | 0.1-10 mA average |
| Emittance | 0.5-2 um-rad (normalized) |
| Cathode QE | 1-10% (Cs2Te), 0.1% (GaAs with polarization) |

**Real-world example:** The Jefferson Lab DC photogun operates at 350 kV and produces polarized electron beams for nuclear physics experiments.

---

## Normal-Conducting RF Gun

**Quick Tip:** Electrons are created inside a high-gradient RF cavity — fast acceleration minimizes space charge damage. Best balance of brightness and current.

**How It Works:**

An NC RF gun combines the electron source and the first accelerating structure into one device. A photocathode sits at the back wall of a 1.5 or 2.5-cell RF cavity operating at high gradient (50-120 MV/m). The laser hits the cathode, electrons are emitted, and they're immediately accelerated to several MeV within centimeters.

This is the key advantage: the electrons spend very little time at low energy where space charge is strongest. By the time they exit the gun, they're at 3-6 MeV and space charge forces are already significantly reduced.

The RF gun is the workhorse source for most modern FELs (LCLS, European XFEL, SwissFEL).

**Trade-off vs. DC gun:**
- Higher gradient = faster acceleration = less space charge damage
- But: RF fields oscillate, so there's an RF-induced emittance growth (RF emittance)
- And: normal-conducting cavities can't run CW — they'd melt. Must be pulsed.

**Game parameters:**
- `rfFrequency` (MHz): Typically 1.3 GHz (L-band) or 2.856 GHz (S-band)
- `peakField` (MV/m): Cathode field — higher is better but limited by breakdown
- `laserSpotSize` (mm): Trade emittance vs. charge density

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Energy out | 3-6 MeV |
| Peak current | 10-100 A |
| Emittance | 0.3-1 um-rad (normalized) at 100 pC |
| Rep rate | 10-120 Hz (pulsed) |
| Peak field | 60-120 MV/m |

**Real-world example:** The LCLS-I gun is a 1.6-cell S-band copper gun producing 0.4 um-rad emittance at 250 pC.

---

## Superconducting RF Gun (SRF Gun)

**Quick Tip:** Best emittance and can run CW — but expensive and technically challenging. The premium source.

**How It Works:**

An SRF gun is like an NC RF gun but made from superconducting niobium operating at 2 K. This allows:
- **CW operation:** No duty-cycle limitation. Every RF bucket can have a bunch.
- **Higher average current:** Combined with CW operation, enables MHz repetition rates
- **Lower RF emittance:** Smoother fields, better field symmetry

The challenges: operating a photocathode inside a superconducting cavity is extremely difficult. The cathode must not contaminate the superconducting surface, and the laser must enter without introducing heat. Only a handful of SRF guns exist worldwide.

**Game parameters:**
- `gradient` (MV/m): Lower than NC (limited to ~30 MV/m by SRF physics)
- `cathodeType`: Material choice affects QE and emittance

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Energy out | 2-4 MeV |
| Peak current | 1-50 A |
| Emittance | 0.2-0.5 um-rad (normalized) |
| Rep rate | Up to MHz (CW capable) |
| Gradient | 15-30 MV/m |

**Real-world example:** The DESY/HZDR SRF gun produces 0.3 um-rad emittance for the ELBE facility.

---

## Solenoid

**Quick Tip:** Solenoids provide round focusing for both planes simultaneously — essential right after the gun for emittance compensation.

**How It Works:**

A solenoid is a coil of wire that creates a uniform magnetic field along the beam axis. Unlike a quadrupole (which focuses in one plane and defocuses in the other), a solenoid focuses in *both planes equally*. The trade-off is that it couples the x and y planes — the beam rotates as it passes through.

Solenoids are essential at the gun exit for **emittance compensation.** The idea: space charge forces cause the emittance to grow as the beam leaves the gun. But the growth is partially reversible — different slices of the bunch have different emittances that can be realigned with a properly placed solenoid. This is the Carlsten/Ferrario emittance compensation technique.

Without a solenoid after the gun, the emittance is permanently degraded by space charge. With a properly tuned solenoid, much of the space charge emittance growth can be undone.

**Game parameters:**
- `fieldStrength` (T): Solenoid magnetic field

**Typical values:**
| Parameter | Value |
|-----------|-------|
| Field | 0.1-0.5 T |
| Length | 0.1-0.5 m |
| Bore | 30-100 mm |

**The Math:**

Focusing strength: `k = eB / (2p) = 0.2998 * B[T] / (2 * p[GeV/c])`

The solenoid transfer matrix couples x and y:
```
R = [[C^2,      SC/k,    SC,     S^2/k  ],
     [-kSC,    C^2,     -kS^2,  SC     ],
     [-SC,     -S^2/k,  C^2,    SC/k   ],
     [kS^2,    -SC,     -kSC,   C^2    ]]
```
where `C = cos(kL)`, `S = sin(kL)`.

---

## Screen / Profile Monitor

**Quick Tip:** Screens show you the beam's cross-section — insert the screen to see the beam, retract it to let beam pass.

**How It Works:**

A screen is a thin phosphor or crystal (YAG:Ce, OTR foil) placed in the beam path. When the beam hits it, it fluoresces, and a camera captures the image. This gives a direct picture of the beam's transverse profile.

Screens are *intercepting* — they block the beam. You can't leave them in during normal operation. Insert to diagnose, retract to run.

From the screen image, you can measure:
- Beam position (centroid)
- Beam size (sigma)
- Beam shape (round? elliptical? halo?)
- With multiple screens at known optics, you can reconstruct emittance

**Game parameters:**
- Intercepting diagnostic: beam is disrupted when screen is active

---

## Integrating Current Transformer (ICT)

**Quick Tip:** ICTs measure beam current without touching the beam — essential for monitoring transmission.

**How It Works:**

An ICT is a toroidal coil around the beam pipe. The passing beam induces a current in the coil proportional to the beam charge. By integrating the signal, you get the charge per bunch, and from that the average current.

ICTs are **non-intercepting** — the beam passes through untouched. This makes them ideal for continuous monitoring.

**Game parameters:**
- `resolution_ua` (uA): Current measurement precision

---

## Wire Scanner

**Quick Tip:** A thin wire sweeps through the beam to measure its profile with high precision — the gold standard for emittance measurement.

**How It Works:**

A wire scanner moves a thin wire (typically 5-50 um diameter tungsten or carbon) through the beam. As the wire passes through different positions, the secondary particles produced are detected downstream. The signal vs. wire position gives the beam profile.

By measuring profiles at three (or more) locations with known transfer matrices between them, you can reconstruct the full emittance and Twiss parameters. This is the **three-screen method** or **quad scan** technique.

Wire scanners are slower than screens (the wire must physically move) but give much better resolution and don't fully intercept the beam.

**Game effect:** Installing wire scanners enables emittance measurements in the diagnostics panel.
