# RF Power

## Quick Tip
RF sources must match cavity frequency. Waveguides carry the power. Wrong frequency = zero acceleration.

## How It Works

RF (radio frequency) power is what actually accelerates the beam. Oscillating electromagnetic fields inside cavities push charged particles forward, adding energy with each cavity they pass through. But the cavities don't generate their own RF — they need external sources connected by waveguides.

### RF Sources

Different source types serve different purposes:

| Source | Frequency | Power | Cost | Notes |
|--------|-----------|-------|------|------|
| Magnetron | 2450 MHz | 5 kW | $50k | Fixed frequency — drives the ECR ion source |
| TWT | Broadband | 20 kW | $400k | Flexible driver amplifier |
| SSA | Broadband | 35 kW | $150k | The starter RF source — drives any bucket |
| Pulsed Klystron | 2856 MHz (S-band) | 50 kW | $1.5M | Workhorse for NC structures, needs modulator |
| CW Klystron | 1300 MHz (L-band) | 50 kW | $3M | For SRF cavities |
| IOT | 1300 MHz (L-band) | 80 kW | $2M | High efficiency for SRF strings |
| Multi-beam Klystron | 2856 MHz (S-band) | 200 kW | $5M | Drives several NC structures at once |
| High-power SSA | Broadband | 300 kW | $4M | Best flexible CW source |
| Gyrotron | Broadband | 1000 kW | $8M | The megawatt endgame source |

### Frequency Matching

This is the most important rule in RF power: **the source frequency must match the cavity frequency**. A 2856 MHz klystron cannot drive a 1300 MHz SRF cavity. The RF energy simply won't couple in.

Cavity demand per frequency bucket:

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

**Broadband sources** (TWT, SSA, high-power SSA, gyrotron) can drive any frequency. Their capacity is a shared pool: after fixed-frequency sources are counted, the pool tops up unmet demand bucket by bucket (lowest frequency first). They're flexible, but a shared pool spread across many buckets runs out — dedicated fixed-frequency sources are how a big machine scales.

### Waveguide Networks

RF waveguide tiles carry power from sources to cavities. All sources and cavities connected by a contiguous run of waveguide form one **RF network**. Each network is validated independently:

1. Are all sources and cavities at the same frequency (or broadband)?
2. Is total forward power from sources >= total power demanded by cavities?
3. Are pulsed klystrons paired with a modulator in the network?
4. Are circulators present to handle reflected power?

### Forward and Reflected Power

Not all power from the source reaches the cavity. A small fraction reflects back due to impedance mismatch at the cavity coupler. In a well-tuned system this is about 2% — barely noticeable. But without a **circulator** in the waveguide chain, reflected power travels back to the source and can damage it.

Circulators absorb reflected power safely. Missing circulators increase wear on your RF sources. Always place one between the source and the cavities.

### Modulators

Pulsed klystrons need extremely high voltage pulses (hundreds of kV) to operate. A **modulator** provides these pulses. Without a modulator in the same RF network, a pulsed klystron contributes zero power. Always pair them.

CW sources (CW klystron, IOT, SSA) don't need modulators — they run continuously from normal power.

### Strategy

- Match frequencies carefully: plan which sources drive which cavities before building
- One klystron can drive several cavities of the same frequency
- Use SSAs for low-power applications (bunchers, low-energy cavities)
- Use klystrons for high-power normal-conducting structures
- Use CW klystrons or IOTs for SRF cavities
- Always include circulators — cheap insurance against source damage
- Modulators are mandatory for pulsed klystrons

## The Math

**Forward power budget:**
```
P_forward_available = sum(P_source for each matched-frequency source in network)
P_forward_required = sum(P_cavity for each cavity in network)
```
Beam runs only if `P_forward_available >= P_forward_required`.

**Reflected power:**
```
P_reflected = P_forward * Gamma^2
```
Where `Gamma` is the reflection coefficient. For a simple mismatch model:
```
Gamma^2 ~ 0.02 (2% reflected)
```

**VSWR (Voltage Standing Wave Ratio):**
```
VSWR = (1 + |Gamma|) / (1 - |Gamma|)
```
For 2% reflected power: VSWR ~ 1.30.

**Effective power to beam:**
```
P_beam = P_forward - P_reflected - P_wall_losses
```

**Cavity gradient from available power (simplified):**
```
If P_available < P_required:
    gradient_actual = gradient_rated * sqrt(P_available / P_required)
```
Gradient scales as square root of power — halving the power reduces gradient by ~30%, not 50%.
