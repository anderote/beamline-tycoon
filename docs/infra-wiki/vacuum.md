# Vacuum Systems

## Quick Tip
Beam travels through vacuum. More pumps + shorter pipes = better pressure. Bad vacuum kills your beam.

## How It Works

Particle beams must travel through ultra-high vacuum. At atmospheric pressure, beam particles would scatter off air molecules and be lost within millimeters. The better your vacuum, the longer your beam survives and the higher quality it maintains.

### Pumps

Different pump types operate at different pressure ranges and speeds:

| Pump | Speed (L/s) | Best For |
|------|------------|----------|
| Roughing pump | 10 | Initial pump-down from atmosphere |
| Turbo pump | 300 | Workhorse high-vacuum pump |
| Ion pump | 100 | Ultra-high vacuum, maintenance-free |
| NEG pump | 200 | Distributed pumping, zero energy |
| Ti sublimation pump | 500 | Extreme vacuum with ion pumps |

In a real accelerator, you stage pumps: roughing pumps bring the system from atmosphere to ~1 mbar, then turbo pumps take over to reach 1e-8 mbar, and ion/NEG pumps achieve the final ultra-high vacuum.

### Conductance

Here's where vacuum gets interesting. A pump's rated speed is what it delivers at its inlet. But the pump isn't inside the beam pipe — it's connected by vacuum pipe tiles. Those pipes have **conductance**: a measure of how easily gas flows through them.

A short, wide pipe has high conductance. A long, narrow pipe has low conductance. The effective pumping speed at the beamline is always less than the pump's rated speed because the pipe restricts gas flow.

This is the key engineering constraint: you can buy the biggest pump in the catalog, but if it's connected through 20 tiles of skinny pipe, most of that pumping speed is wasted. **Place pumps close to the beamline with short pipe runs.**

### Pipe Topology

Multiple pipes in **series** (end to end) reduce conductance:
```
1/C_total = 1/C_1 + 1/C_2 + 1/C_3 + ...
```
A 10-tile pipe run has 1/10th the conductance of a single tile.

Multiple pipes in **parallel** (side by side) add conductance:
```
C_total = C_1 + C_2 + C_3 + ...
```
Two parallel pipe runs deliver twice the conductance of one.

This means:
- A single pump connected by a long pipe = poor effective speed
- The same pump connected by two short parallel paths = much better
- Multiple pumps with their own short connections = best

### Pressure Quality

Average pressure across the whole beamline determines quality:

| Quality | Pressure (mbar) | Effect |
|---------|-----------------|--------|
| Excellent | < 1e-9 | Best beam lifetime and quality |
| Good | < 1e-7 | Normal operation |
| Marginal | < 1e-4 | Beam runs but with losses |
| Poor | >= 1e-4 | **Beam blocked** |
| None | No pumps | **Beam blocked** |

### Strategy

- Place roughing + turbo pump pairs every few meters along the beamline
- Keep pipe runs as short as possible (2-3 tiles ideal)
- Use parallel pipe paths for high-speed pumps
- Ion pumps and NEG pumps for the cleanest sections (near SRF cavities, undulators)
- Gate valves let you isolate sections for maintenance without venting the whole machine
- Bakeout systems improve ultimate vacuum after any vacuum break

## The Math

**Effective pumping speed at beamline through a pipe path:**
```
1/S_eff = 1/S_pump + 1/C_path
```
Where `S_pump` is the pump's rated speed and `C_path` is the total conductance of the pipe path from pump to beamline.

**Series conductance (pipes end-to-end):**
```
1/C_series = 1/C_1 + 1/C_2 + ... + 1/C_n
```
For n identical tiles of conductance C_tile:
```
C_series = C_tile / n
```

**Parallel conductance (multiple paths):**
```
C_parallel = C_1 + C_2 + ... + C_n
```

**Total effective pump speed at beamline:**
```
S_total = sum(S_eff_i for each pump i connected to beamline)
```

**Average pressure (simplified):**
```
P_avg = Q_gas / S_total
```
Where `Q_gas` is the total gas load from outgassing of the beamline interior surfaces, proportional to beamline volume:
```
Q_gas = V_beamline * q_outgassing
```
With `q_outgassing` as the specific outgassing rate (mbar·L/s per liter of volume). Bakeout systems reduce `q_outgassing`.

**Conductance per vacuum pipe tile:**
```
C_tile = 50 L/s (baseline)
```
