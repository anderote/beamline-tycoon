# Vacuum Systems

## Quick Tip
Beam travels through vacuum. Pressure is gas load over pump speed, and gas load scales with the length of your beam pipe. Long machines need distributed pumping.

## How It Works

Particle beams must travel through ultra-high vacuum. At atmospheric pressure, beam particles would scatter off air molecules and be lost within millimetres. The better your vacuum, the longer your beam survives and the higher quality it maintains.

### Pumps

Different pump types operate at different pressure ranges and speeds:

| Pump | Speed (L/s) | Cost | Best For |
|------|------------|------|----------|
| Roughing pump | 15 | $50k | Entry level — keeps a short starter chain alive at mediocre quality |
| Turbo pump | 300 | $200k | Workhorse high-vacuum pump |
| Ti sublimation pump | 400 | $300k | Extreme vacuum with ion pumps |
| NEG pump | 500 | $600k | Distributed pumping, zero energy cost |
| Ion pump | 600 | $400k | Ultra-high vacuum, maintenance-free |

In a real accelerator, you stage pumps: roughing pumps bring the system from atmosphere to ~1 mbar, then turbo pumps take over to reach 1e-8 mbar, and ion/NEG pumps achieve the final ultra-high vacuum. In gameplay, every pump on a network simply adds its speed to a single pumping-speed total.

### Gas Load Comes From Surface Area

This is the key engineering constraint, and it is about **length**, not layout.

Real vacuum systems are dominated by outgassing from the chamber walls: `Q = q_specific x A`, and for a pipe `A = 2 pi r L`. Length is the whole story. At the game's 0.06 m pipe radius, one metre of beam pipe has **3,770 cm^2** of internal surface, which outgasses about **3.8e-7 mbar·L/s** unbaked — roughly as much as an entire component.

So every metre of pipe you draw costs you vacuum. A 300 m beamline on one turbo pump is a fundamentally worse vacuum system than a 20 m beamline on the same pump, and no amount of clever routing changes that. **The fix is more pumps, spread along the line.**

Each beam pipe is charged to whatever pumps serve the components mounted on it, once.

| Pipe length | 1 pump (100 L/s) | 4 pumps (400 L/s) |
|---|---|---|
| 20 m | 0.78 | 0.93 |
| 100 m | 0.61 | 0.76 |
| 300 m | 0.49 | 0.64 |

Baked, all of these reach ~1.00.

### Bakeout

A **Bakeout System** on the vacuum network drops the specific outgassing rate 100x — from 1e-10 to 1e-12 mbar·L/(s·cm^2) — which takes even a 300 m unbaked line to essentially perfect vacuum. This is the single biggest vacuum upgrade in the game.

> **Known limitation:** the Bakeout System currently declares only a power sink and *no vacuum port*, so it cannot actually join a vacuum network. The 100x factor is implemented and tested, but there is no way to trigger it in play yet. Treat bakeout as a future upgrade rather than a current purchase.

### How Vacuum Reaches the Beam

Residual gas scatters the beam. Two effects, both live:

- **Multiple Coulomb scattering** grows the beam's angular spread, and therefore its emittance. This is the only path by which vacuum affects beam *quality*, and therefore income.
- **Beam-gas loss** removes particles outright through large-angle and nuclear scattering: `I *= exp(-L / lambda)`, where the loss length scales as 1/P.

The scattering term scales as **1/(beta x gamma)^2**, which is the interesting part for gameplay: a low-energy beam is enormously more fragile than a high-energy one. **Protect the injector**, not the far end of the linac.

The older "poor vacuum narrows the effective aperture" model is gone. It could never reach the quantity it was meant to affect — aperture clipping only scales current, never the beam's covariance matrix — and, since clipping a Gaussian scrapes halo, it arguably pointed the wrong way.

### Pressure Quality

One pressure, computed once, drives both the HUD readout and the beam:

| Quality | Pressure (mbar) | Effect |
|---------|-----------------|--------|
| Excellent | < 1e-9 | Best beam lifetime and quality |
| Good | < 1e-7 | Normal operation |
| Marginal | < 1e-4 | Beam runs but with losses |
| Poor | >= 1e-4 | Quality 0 — heavy scattering |
| None | No pumps on a network with sinks | **Beam blocked** (hard error) |

The panel reports the **worst** network in the facility, not an average: a beamline is only as good as its dirtiest section, and one unpumped run will scatter the beam regardless of how well the rest is pumped.

### Strategy

- Distribute pumps along the beamline. Pipe *length* is what costs you, so one big pump at one end is the wrong shape of answer for a long machine.
- A vacuum manifold ($120k) beats individual runs at about four sinks — vacuum pipe is $5,600/tile.
- Ion pumps and NEG pumps for the cleanest sections (near SRF cavities)
- Gate valves let you isolate sections for maintenance without venting the whole machine
- Watch the injector. Low-energy beam is where scattering hurts most.

## The Math

**Steady-state pressure:**
```
P = Q_total / S_total
```
Where `Q_total` is total outgassing (mbar·L/s) and `S_total` is total pump speed (L/s). That's it — there is **no conductance model**. Pipe runs do not degrade pumping speed, and pumps do not care how far from the beamline they sit. The pipe's *length* matters only because it adds gas load.

**Gas load:**
```
Q_total = sum(component outgassing) + sum(beam pipe outgassing)
Q_pipe  = q_specific x 2 pi r L,   r = 0.06 m
        = 3.77e-7 mbar·L/s per metre unbaked
q_specific = 1e-10 mbar·L/(s·cm^2)  unbaked stainless
           = 1e-12 mbar·L/(s·cm^2)  baked UHV  (100x better)
```

**Quality, mapped log-linearly:**
```
P <= 1e-8            -> quality 1
P >= 1e-4            -> quality 0
otherwise            -> 1 - (log10(P) + 8) / 4
no pump, sinks present -> quality 0, hard error, pressure reported as 1013 mbar
```

**Beam-gas scattering** (per element, added to the divergence terms of the covariance matrix):
```
d<theta^2> = C_scatter x P x L / (beta x gamma)^2      C_scatter = 0.05
I         *= exp(-L / lambda),   lambda = 100 m x (1e-5 mbar / P)
```
Emittance growth then emerges from the covariance determinant rather than being imposed on it. For a 50 MeV electron beam through a 10 m beta function: 1e-9 mbar over 100 m grows emittance ~0.03% (free); 1e-5 mbar over the same 100 m grows it ~2.5x (severe).

**Per-component gas load (mbar·L/s):**

| Size class | Outgassing | Examples |
|------------|------------|----------|
| Tiny | 2e-7 | BPM, ICT, screen, wire scanner, Faraday cup |
| Small | 5e-7 (default) | Dipole, quad, sextupole, buncher, half-wave resonator, aperture, septum, beam stop |
| Medium | 1e-6 | Electron gun, ion source, pillbox, RFQ, spoke cavity, elliptical SRF, target |
| Large | 2e-6 – 5e-6 | NC structures (2e-6), cryomodule (4e-6), detector (5e-6), ECR source (5e-6 — deliberate gas feed) |

Bellows are charged by their own length rather than a size class. Beam pipe (`drift`) carries no port at all — it is a drawn connection, never a placeable, so its surface area is added directly by the vacuum solver, which can see the pipes and knows which pumps serve them.

**Hard gate:** a vacuum sink not wired to any network, or a vacuum network with sinks and zero pump speed. Merely *poor* pressure (> 1e-5 mbar) is a soft warning.
