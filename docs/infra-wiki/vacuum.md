# Vacuum Systems

## Quick Tip
Vacuum is a pump-down process, not an instant quality bonus. Start with roughing, back a turbo for high vacuum, and add ion/NEG/Ti-sub pumping for UHV. Long, narrow connections reduce the speed that reaches the beamline.

## How It Works

Particle beams must travel through ultra-high vacuum. The better your vacuum, the fewer gas molecules remain to scatter the beam and remove particles.

### Pumps

| Pump | Speed (L/s) | Cost | Best For |
|------|------------|------|----------|
| Roughing pump | 15 roughing | $50k | First pump-down stage and backing for one turbo |
| Four-pump roughing cart | 60 roughing | $170k | Faster pump-down or backing for four turbos |
| Turbo pump | 300 high-vacuum | $200k | Workhorse high-vacuum stage; requires 15 L/s backing |
| Turbo pump cart | 1,200 high-vacuum | $680k | Four-stage mobile bank; requires 60 L/s backing |
| Vacuum cart | 30 roughing + 300 high-vacuum | $475k | Integrated portable two-stage package |
| Ti sublimation pump | 400 UHV | $300k | Extreme vacuum with a working high-vacuum stage |
| NEG pump | 500 UHV | $600k | Distributed pumping, zero energy cost |
| Ion pump | 600 UHV | $400k | Ultra-high vacuum, maintenance-free |
| High-capacity station | 150 roughing + 3,000 high-vacuum | $2.4M | Integrated large-volume pump-down package |

The stages are live. Roughing operates from atmosphere toward 1e-3 mbar. A backed turbo takes over below 1 mbar and can approach 1e-8 mbar. Ion, NEG and Ti-sub pumps join below 1e-5 mbar only when a working high-vacuum stage is present. A lone turbo reports an unbacked-pump blocker; a lone UHV pump cannot evacuate a vented chamber.

The network stores its gas inventory in mbar·L. Beam-pipe and service-line volume set how long pump-down takes, so the four-pump roughing cart genuinely evacuates the same chamber about four times faster than one roughing pump. One of those compact roughing carts supplies exactly the 60 L/s backing capacity required by a turbo pump cart.

### Gas Load, Volume and Conductance

Outgassing from chamber walls is `Q = q_specific x A`; for a pipe, `A = 2 pi r L`. At the game's 0.06 m beam-pipe radius, one metre has **3,770 cm²** of internal surface and contributes about **3.8e-7 mbar·L/s** unbaked.

Every metre of beam pipe adds gas load and volume. Every metre of narrow service pipe also adds volume and restricts molecular flow. A remote turbo therefore delivers less effective speed than the same pump mounted close to the chamber. Use distributed pumps and short hookups on long machines.

Each beam pipe is charged once to the network serving its mounted components.

### Bakeout

A connected **Bakeout System** drops the network's specific outgassing rate 100x, from 1e-10 to 1e-12 mbar·L/(s·cm²). It has a vacuum connection, so the upgrade is active in play.

### Gauges and Pressure History

Pirani, cold-cathode and BA gauges mount directly on a drawn vacuum run. Each has its own useful pressure range; powered cold-cathode and BA gauges read offline if their power connection is absent.

Click a vacuum pipe network to see its pressure history. The inspector plots one log-scale trace per mounted gauge, sampled every half in-game hour over a rolling **two in-game days**. This makes stage handoffs, slow pump-down and a weak remote connection visible instead of reducing the network to one number.

### How Vacuum Reaches the Beam

Each sink receives its local pressure and gas number density. Residual gas affects the beam in two live ways:

- **Multiple Coulomb scattering** grows angular spread, emittance and therefore reduces beam quality.
- **Beam-gas loss** removes particles through large-angle and nuclear scattering: `I *= exp(-n sigma L)`.

The scattering term scales as `1/(beta gamma)^2`. A low-energy beam is enormously more fragile than a high-energy one, so protect the injector first.

### Pressure Quality

| Quality | Pressure (mbar) | Effect |
|---------|-----------------|--------|
| Excellent | < 1e-8 | Best beam lifetime and quality |
| Good | < 1e-6 | Normal operation |
| Marginal | < 1e-4 | Beam runs with growing losses |
| Poor | 1e-4 to 1e-2 | Heavy scattering |
| Unusable | >= 1e-2 | Quality 0 |
| None | No valid active stage on a network with sinks | **Beam blocked** |

The Systems panel reports the facility's worst vacuum network. Within a network, remote sinks and gauges can read worse than the volume-average pressure because their local effective pumping speed is lower.

### Strategy

- Start with a roughing pump and turbo, or buy an integrated vacuum cart.
- One roughing pump backs one turbo; the four-pump roughing cart backs one four-stage turbo cart.
- Distribute molecular pumps and keep their service runs short.
- Use ion, NEG or Ti-sub pumps only after high vacuum is established.
- A vacuum manifold ($120k) reduces connection clutter but adds no pumping speed.
- Watch the pressure graph during pump-down, especially near the injector.

## The Math

**Conductance and effective speed:**
```
C_tube = 12.1 d^3 / L                       L/s, air; d and L in cm
S_eff  = S_pump C_tube / (S_pump + C_tube)
```

**Dynamic pump-down:**
```
P_eq   = Q_total / S_eff + P_ultimate
P_next = P_eq + (P_previous - P_eq) exp(-S_eff dt / V)
```
`V` is the connected beam-pipe plus service-line volume and `dt` is one simulation second. The solver conserves `P V`, its gas inventory, when networks join or split.

**Gas load:**
```
Q_total = sum(component outgassing) + sum(beam pipe outgassing)
Q_pipe  = q_specific x 2 pi r L,   r = 0.06 m
        = 3.77e-7 mbar·L/s per metre unbaked
q_specific = 1e-10 mbar·L/(s·cm²)  unbaked stainless
           = 1e-12 mbar·L/(s·cm²)  baked UHV
```

**Gas density at 300 K:**
```
n = (100 P_mbar) / (k_B T)                  molecules/m³
N_molecules = n V
```

**Quality, mapped log-linearly:**
```
P <= 1e-8            -> quality 1
P >= 1e-2            -> quality 0
otherwise            -> 1 - (log10(P) + 8) / 6
no active stage      -> quality 0, hard error when sinks are present
```

**Beam-gas effects:**
```
d<theta²> = K_transport n L / (beta gamma)²
I        *= exp(-n sigma_loss L),   sigma_loss = 1e-22 m²
```

Bellows are charged by their own length rather than a size class. Beam pipe (`drift`) is a drawn connection rather than a placeable, so its surface area and volume are added directly by the vacuum solver.

**Hard gate:** a vacuum sink not wired to any network, or a network with sinks but no valid active stage. Poor pressure itself remains a soft warning.
