# Infrastructure Quality

> **Quick Tip:** Underpowered infrastructure degrades beamline performance gradually. Build labs near your networks to compensate.

## How It Works

Every utility network (power, RF, cooling, vacuum, cryo, data) has a **quality score** from 0% to 100%. When a network's capacity falls short of demand, its quality drops below 100%, and every beamline component on that network operates at reduced performance.

### What Degrades

| Network | Effect When Degraded |
|---------|---------------------|
| Power | All connected components derate (weaker magnets, lower RF gradient) |
| RF Waveguide | RF cavities operate at reduced gradient |
| Cooling Water | RF gradient reduced, slight emittance growth from thermal effects |
| Vacuum | Beam scattering losses increase (reduced effective aperture) |
| Cryo Transfer | SRF cavities derate; **below 50% capacity, SRF quenches** (hard shutdown) |
| Data Fiber | Data collection rate reduced |

### The Math

Quality is computed per network cluster:

```
ratio     = capacity / demand       (clamped 0 to 1)
lab_bonus = sum of lab furnishing bonuses (capped at 0.5)
quality   = min(1.0, ratio + lab_bonus)
```

Effects stack multiplicatively across network types. An RF cavity on a power network at 90% and an RF network at 85% operates at 0.9 x 0.85 = 76.5% gradient.

### Hard vs Soft Failures

Most infrastructure shortfalls are **soft** -- they degrade performance but don't stop the beam. Only these conditions cause a hard beam trip:

- Missing utility connection entirely (no cable to component)
- No PPS interlock
- Insufficient radiation shielding

## Labs and Bonuses

Labs improve the performance of infrastructure networks they're connected to. An RF Lab with test equipment boosts the effective quality of nearby RF waveguide networks.

### How Lab Connectivity Works

1. Labs connect to networks within **1 tile** of their room boundary (cardinal directions only)
2. If a network cable/pipe runs past the lab wall, the lab's bonus applies to the entire connected network cluster
3. Multiple labs on the same network stack additively (capped at +50% total)

### Lab-to-Network Mapping

| Lab | Boosts |
|-----|--------|
| RF Lab | RF Waveguide networks |
| Cooling Lab | Cooling Water networks |
| Vacuum Lab | Vacuum Pipe networks |
| Diagnostics Lab | Data Fiber networks |
| Control Room | Data Fiber networks |

### Furnishing Bonuses

Each lab furnishing contributes a `zoneOutput` bonus. Better equipment = bigger bonus:

| Example | zoneOutput |
|---------|-----------|
| RF Workbench | +3% |
| Oscilloscope | +5% |
| Signal Generator | +6% |
| Spectrum Analyzer | +8% |
| Network Analyzer | +10% |

A well-equipped RF Lab can add up to +32% quality to connected RF networks, partially compensating for undersized klystrons.

## Viewing Network Quality

Click any utility cable or pipe to open the **Network Info Panel**. It shows:

- Capacity vs demand with a colored bar
- Base ratio percentage
- Lab bonuses (listed individually)
- Effective quality score
- Connected equipment and beamline components
- Human-readable effect summary
