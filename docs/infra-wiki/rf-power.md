# RF Power

## Quick Tip
A source drives any cavity in a band it covers — but one waveguide network carries one frequency, so mixed-frequency cavities need separate networks. Gradient goes as the square root of power, and for pulsed sources what matters is *peak* power, not average.

## How It Works

RF (radio frequency) power is what actually accelerates the beam. Oscillating electromagnetic fields inside cavities push charged particles forward, adding energy with each cavity they pass through. But the cavities don't generate their own RF — they need external sources connected by waveguides.

### RF Sources

Different source types serve different purposes. **Duty factor** is now a first-class stat: a pulsed source delivers its average power in short bursts, so its peak power is much higher.

| Source | Bands covered | Avg Power | Duty | Peak Power | Cost |
|--------|---------------|-----------|------|-----------|------|
| Magnetron | S | 5 kW | 0.01 | 500 kW | $50k |
| TWT | VHF, UHF, L, S, C, X | 20 kW | 0.05 | 400 kW | $400k |
| SSA | VHF, UHF | 35 kW | 1.0 (CW) | 35 kW | $150k |
| Pulsed Klystron | S, C | 50 kW | 0.001 | **50 MW** | $1.5M |
| CW Klystron | UHF, L | 50 kW | 1.0 (CW) | 50 kW | $3M |
| IOT | UHF, L | 80 kW | 1.0 (CW) | 80 kW | $2M |
| Multi-beam Klystron | S, C | 200 kW | 0.005 | 40 MW | $5M |
| High-power SSA | VHF, UHF, L | 300 kW | 1.0 (CW) | 300 kW | $4M |
| Gyrotron | C, X | 1000 kW | 1.0 (CW) | 1000 kW | $8M |

This is what reconciles the game's kilowatt-scale RF ladder with the **megawatt** peak power a normal-conducting structure actually needs. It also makes pulsed vs CW a real strategic axis rather than flavour text:

- **Pulsed** buys enormous peak gradient at low average current — brightness machines
- **CW** buys steady average current at lower gradient — power machines

A network mixing pulsed and CW sources gets a capacity-weighted mean duty factor, which dilutes the pulsed advantage. Keep your pulsed and CW chains on separate waveguide networks.

The bands themselves: **VHF** 50–500 MHz, **UHF** 500–1000, **L** 1000–2000, **S** 2000–4000, **C** 4000–8000, **X** 8000–16000. They are contiguous, so every cavity frequency lands in exactly one.

The TWT is the only source covering all six, and at 20 kW it is deliberately the weakest thing on the ladder. It exists to unblock a frequency you have no real source for, never to power a machine.

### Band Matching

**A source drives anything in a band it covers.** A klystron is built for S-band, not for one number on a dial, so a 2856 MHz tube drives any S-band cavity. What it cannot do is reach outside its bands: a gyrotron will never drive an L-band cryomodule, however many megawatts it has.

**One network carries one frequency.** A waveguide run is a resonant structure — you cannot put 162.5 MHz and 325 MHz down the same copper and have both arrive. So each RF network serves the frequency with the most demand on it (ties go to the lower frequency), and every cavity on that network cut for a different frequency is starved with a soft `rf_frequency_split`. The fix is always to run a second waveguide network, never to buy a different tube. **This is what keeps RF a layout problem.**

The cavity frequencies you will be planning around:

| Frequency | Band | Cavity | RF Demand |
|-----------|------|--------|-----------|
| 162.5 MHz | VHF | RFQ | 25 kW |
| 162.5 MHz | VHF | Buncher | 2 kW |
| 162.5 MHz | VHF | Pillbox Cavity | 5 kW |
| 162.5 MHz | VHF | Half-Wave Resonator | 3 kW |
| 325 MHz | VHF | Spoke Cavity | 8 kW |
| 1300 MHz | L | 9-cell Elliptical SRF | 5 kW |
| 1300 MHz | L | TESLA Cryomodule | 40 kW |
| 2450 MHz | S | ECR Ion Source | 2 kW |
| 2856 MHz | S | NC RF Cavity | 40 kW |
| 2856 MHz | S | S-band Structure | 45 kW |

The low-β front end is deliberately consolidated onto 162.5 MHz — the real PIP-II number for its RFQ, buncher and half-wave resonators. That is one network for the whole ion front end instead of four, at exactly the tier where you first meet the utility system.

A served frequency with no in-band source on its network gets **zero power** and a soft `rf_frequency_mismatch`. Those cavities accelerate nothing, but the beam keeps running.

### Power Allocation

Sinks on the served frequency share the available power **in proportion to their declared demand**. An over-subscribed network starves everything on it proportionally rather than picking winners by placement order. Capacity from a source that does not cover the served band does not count at all — it is not headroom.

What each cavity receives is published in **watts of peak power** — that is what sets its gradient. The old model derated gradient linearly by an abstract RF quality scalar, which had the wrong exponent as well as the wrong units.

### Gradient From Power

For a normal-conducting standing-wave structure:

```
E_acc = sqrt(P_peak x r_shunt / L_active)
```

| Cavity | r_shunt | L_active | Frequency |
|--------|---------|----------|-----------|
| Pillbox Cavity | 30 MOhm/m | 0.5 m | 0.1625 GHz |
| RFQ | 25 MOhm/m | 2.0 m | 0.1625 GHz |
| NC RF Cavity | 55 MOhm/m | 3.0 m | 2.856 GHz |
| S-band Structure | 55 MOhm/m | 3.0 m | 2.856 GHz |

Sanity check: 55 MOhm/m over 3 m at 30 MW peak gives 23.5 MV/m. SLAC ran ~20 MV/m at 35 MW. Close enough for the accuracy this game needs.

For a superconducting cavity, gradient depends on the cryogenic temperature too — see [cryogenics.md](cryogenics.md).

Either way, the gradient the cavity delivers is `min(demanded, achievable)`. Provision it well and it reaches its catalogue energy gain exactly; starve it and the ceiling binds.

### Forward and Reflected Power

Not all power from the source reaches the cavity. A well-tuned system reflects about 2% — that's the floor. But a **thermally detuned** cavity reflects far more: an undercooled copper structure expands, walks off resonance, and stops absorbing the power aimed at it. At S-band a 10 K cooling deficit reflects about 66%; a fully starved loop reflects about 97%.

The panel's VSWR readout is driven by the worst cavity in the facility, because one badly mismatched load is what the klystron actually sees.

Circulators absorb reflected power safely, and in a real machine that's what protects the source.

> **Known limitation:** circulators and modulators have no mechanical effect. A pulsed klystron with no modulator in its network still delivers full capacity; a chain with no circulator suffers no extra wear. Component wear depends only on energy cost and whether an MPS exists in the facility.

### Strategy

- Group cavities by frequency first, then decide which source covers each group's band — a network with two frequencies on it wastes one of them
- Don't mix pulsed and CW sources on the same waveguide network — the mean duty factor dilutes the pulsed peak
- One klystron can drive several cavities on the same network, but they split the power by demand share
- Use SSAs for the VHF/UHF front end; klystrons and the gyrotron are where the real power lives, higher up the bands
- Waveguide is $7,200/tile; a waveguide manifold ($160k) beats individual runs at about four sinks

## The Math

**Peak power from average and duty:**
```
mean_duty  = sum(capacity x dutyFactor) / sum(capacity)     across the ELIGIBLE sources
peak_factor = min(1 / mean_duty, 10000)
P_sink_W    = network_capacity_kW x 1000 x peak_factor x (sink_demand / served_demand)
```

**Gradient from power:**
```
NC:   E_acc = sqrt(P_peak x r_shunt / L_active)          r_shunt in ohm/m
SRF:  E_acc = sqrt(P x (R/Q) x Q0(T)) / L_active         per cavity
E_acc,achieved = min(demanded, achievable)
```

**Network quality (the 0-1 scalar, used for the panel and warnings):**
```
served     = frequency with the most demand on the network (ties -> lower)
capacity   = sum(capacity) over sources whose bands include band(served)
quality    = min(1, capacity / demand_at(served))       0 for every other frequency
```

**Reflected power and VSWR:**
```
coupling  = 1 / (1 + (2 Q_L df / f)^2),   df = 20 kHz/K x dT_cooling x (f_GHz / 2.856)
Gamma^2   = 1 - coupling                 (floored at 0.02 for a well-tuned cavity)
VSWR      = (1 + |Gamma|) / (1 - |Gamma|)
```
For 2% reflected power, VSWR ~ 1.33.

**Hard gate:** an RF sink not wired to any network. Everything else is soft — overload (`rf_overload`) and frequency mismatch (`rf_frequency_mismatch`) both degrade the cavity without stopping the beam.
