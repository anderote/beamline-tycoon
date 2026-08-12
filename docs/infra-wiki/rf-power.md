# RF Power

## Quick Tip
RF sources must match cavity frequency. Gradient goes as the square root of power — and for pulsed sources, what matters is *peak* power, not average.

## How It Works

RF (radio frequency) power is what actually accelerates the beam. Oscillating electromagnetic fields inside cavities push charged particles forward, adding energy with each cavity they pass through. But the cavities don't generate their own RF — they need external sources connected by waveguides.

### RF Sources

Different source types serve different purposes. **Duty factor** is now a first-class stat: a pulsed source delivers its average power in short bursts, so its peak power is much higher.

| Source | Frequency | Avg Power | Duty | Peak Power | Cost |
|--------|-----------|-----------|------|-----------|------|
| Magnetron | 2450 MHz | 5 kW | 0.01 | 500 kW | $50k |
| TWT | Broadband | 20 kW | 0.05 | 400 kW | $400k |
| SSA | Broadband | 35 kW | 1.0 (CW) | 35 kW | $150k |
| Pulsed Klystron | 2856 MHz (S-band) | 50 kW | 0.001 | **50 MW** | $1.5M |
| CW Klystron | 1300 MHz (L-band) | 50 kW | 1.0 (CW) | 50 kW | $3M |
| IOT | 1300 MHz (L-band) | 80 kW | 1.0 (CW) | 80 kW | $2M |
| Multi-beam Klystron | 2856 MHz (S-band) | 200 kW | 0.005 | 40 MW | $5M |
| High-power SSA | Broadband | 300 kW | 1.0 (CW) | 300 kW | $4M |
| Gyrotron | Broadband | 1000 kW | 1.0 (CW) | 1000 kW | $8M |

This is what reconciles the game's kilowatt-scale RF ladder with the **megawatt** peak power a normal-conducting structure actually needs. It also makes pulsed vs CW a real strategic axis rather than flavour text:

- **Pulsed** buys enormous peak gradient at low average current — brightness machines
- **CW** buys steady average current at lower gradient — power machines

A network mixing pulsed and CW sources gets a capacity-weighted mean duty factor, which dilutes the pulsed advantage. Keep your pulsed and CW chains on separate waveguide networks.

### Frequency Matching

This is the most important rule in RF power: **the source frequency must match the cavity frequency**. A 2856 MHz klystron cannot drive a 1300 MHz SRF cavity. The RF energy simply won't couple in.

Sinks are bucketed by frequency and each bucket is solved independently:

| Frequency | Cavity | RF Demand |
|-----------|--------|-----------|
| 161 MHz | Half-Wave Resonator | 3 kW |
| 200 MHz | Buncher | 2 kW |
| 200 MHz | Pillbox Cavity | 5 kW |
| 325 MHz | Spoke Cavity | 8 kW |
| 400 MHz | RFQ | 25 kW |
| 1300 MHz (L-band) | 9-cell Elliptical SRF | 5 kW |
| 1300 MHz (L-band) | TESLA Cryomodule | 40 kW |
| 2450 MHz | ECR Ion Source | 2 kW |
| 2856 MHz (S-band) | NC RF Cavity | 40 kW |
| 2856 MHz (S-band) | S-band Structure | 45 kW |

**Broadband sources** (TWT, SSA, high-power SSA, gyrotron) can drive any frequency. Their capacity is a shared pool: after fixed-frequency sources are counted, the pool tops up unmet demand bucket by bucket, lowest frequency first. They're flexible, but a shared pool spread across many buckets runs out — dedicated fixed-frequency sources are how a big machine scales.

A bucket with demand and no matching capacity gets **zero power** and a soft `rf_frequency_mismatch`. Those cavities accelerate nothing, but the beam keeps running.

### Power Allocation

Within a bucket, sinks share the available power **in proportion to their declared demand**. An over-subscribed bucket starves everything on it proportionally rather than picking winners by placement order.

What each cavity receives is published in **watts of peak power** — that is what sets its gradient. The old model derated gradient linearly by an abstract RF quality scalar, which had the wrong exponent as well as the wrong units.

### Gradient From Power

For a normal-conducting standing-wave structure:

```
E_acc = sqrt(P_peak x r_shunt / L_active)
```

| Cavity | r_shunt | L_active | Frequency |
|--------|---------|----------|-----------|
| Pillbox Cavity | 30 MOhm/m | 0.5 m | 0.2 GHz |
| RFQ | 25 MOhm/m | 2.0 m | 0.4 GHz |
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

- Match frequencies carefully: plan which sources drive which cavities before building
- Don't mix pulsed and CW sources on the same waveguide network — the mean duty factor dilutes the pulsed peak
- One klystron can drive several cavities of the same frequency, but they split the power by demand share
- Use broadband SSAs for low-power odds and ends (bunchers, pillboxes); use fixed-frequency klystrons where the real power goes
- Waveguide is $7,200/tile; a waveguide manifold ($160k) beats individual runs at about four sinks

## The Math

**Peak power from average and duty:**
```
mean_duty  = sum(capacity x dutyFactor) / sum(capacity)     across the network's sources
peak_factor = min(1 / mean_duty, 10000)
P_sink_W    = bucket_capacity_kW x 1000 x peak_factor x (sink_demand / bucket_demand)
```

**Gradient from power:**
```
NC:   E_acc = sqrt(P_peak x r_shunt / L_active)          r_shunt in ohm/m
SRF:  E_acc = sqrt(P x (R/Q) x Q0(T)) / L_active         per cavity
E_acc,achieved = min(demanded, achievable)
```

**Bucket quality (the 0-1 scalar, used for the panel and warnings):**
```
quality = min(1, bucket_capacity / bucket_demand)
```

**Reflected power and VSWR:**
```
coupling  = 1 / (1 + (2 Q_L df / f)^2),   df = 20 kHz/K x dT_cooling x (f_GHz / 2.856)
Gamma^2   = 1 - coupling                 (floored at 0.02 for a well-tuned cavity)
VSWR      = (1 + |Gamma|) / (1 - |Gamma|)
```
For 2% reflected power, VSWR ~ 1.33.

**Hard gate:** an RF sink not wired to any network. Everything else is soft — overload (`rf_overload`) and frequency mismatch (`rf_frequency_mismatch`) both degrade the cavity without stopping the beam.
