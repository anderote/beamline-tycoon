# Beamline Tycoon — Physics Wiki

Player-facing documentation for the physics in Beamline Tycoon. Each article teaches real accelerator physics in the context of gameplay.

## Structure

Each article has three sections:
- **Quick Tip** — one-line tooltip for in-game display
- **How It Works** — plain-language explanation with real units
- **The Math** — actual equations for players who want the full picture

## What Is Currently Playable

The physics engine models four machine tiers, but **only tier 1 currently
executes**. Nothing in the game sets a machine type other than `linac`, and the
component catalogue is 30 beamline modules: sources, drifts, bellows, magnets,
NC and SRF cavities, diagnostics, and endpoints.

That means the tier 2-4 articles describe **physics that is implemented and
correct but not yet reachable**, using components that are not yet in the
catalogue (photoinjector guns, solenoids, chicanes, undulators, photon ports,
positron targets, septa, kickers). Each of those articles now carries a note
saying so. They are kept because the physics is real, the modules are written
and tested, and they are the design target — not because you can build one
today.

The live physics is: linear optics, RF acceleration with transit-time factor
and capture efficiency, adiabatic damping, synchrotron radiation with quantum
excitation, space charge, **beam-gas scattering**, and aperture loss — plus the
utility-driven device physics that decides what a cavity can actually do
(see the [infrastructure wiki](../infra-wiki/README.md)).

## Files

### Fundamentals
- [fundamentals.md](fundamentals.md) — Core concepts: what a beam is, phase space, emittance, energy

### Tier 1: Electron Linac
- [tier1-components.md](tier1-components.md) — Source, drift, quadrupole, dipole, RF cavity, collimator, target, beam dump, BPM
- [tier1-physics.md](tier1-physics.md) — Linear optics, FODO focusing, beam transport, synchrotron radiation, beam loss

### Tier 2: Photoinjector
- [tier2-components.md](tier2-components.md) — DC photogun, NC RF gun, SRF gun, solenoid, diagnostics
- [tier2-physics.md](tier2-physics.md) — Space charge, emittance compensation, beam brightness

### Tier 3: Free Electron Laser
- [tier3-components.md](tier3-components.md) — Chicane, buncher, harmonic linearizer, undulators, photon port
- [tier3-physics.md](tier3-physics.md) — Bunch compression, CSR, FEL gain, Pierce parameter, photon wavelength

### Tier 4: Electron-Positron Collider
- [tier4-components.md](tier4-components.md) — Positron target, detector, septum, kicker
- [tier4-physics.md](tier4-physics.md) — Luminosity, beam-beam effects, final focus, positron production

### Using the Tools
- [diagnostics-and-plots.md](diagnostics-and-plots.md) — Probe window: all 7 plot types explained, what to look for, how to diagnose problems

### Reference
- [equations.md](equations.md) — All equations in one place
- [glossary.md](glossary.md) — Accelerator physics terminology
- [real-machines.md](real-machines.md) — Real-world machines and how they map to the game
