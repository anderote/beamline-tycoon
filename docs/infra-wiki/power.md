# Electrical Power

## Quick Tip
Every active component draws power. Transformers and panels supply it. No power connection = no function.

## How It Works

Electrical power is the most fundamental infrastructure system. Almost everything in your facility needs it — magnets, RF sources, pumps, chillers, diagnostics, controls. Without power, nothing runs.

### Supply

Power sources form a capacity ladder — upgrading is a real decision:

| Source | Capacity | Cost | Role |
|--------|----------|------|------|
| Power Panel | 40 kW | $60k | Branch circuit for diagnostics and small pumps |
| UPS / Battery Bank | 100 kW | $500k | Backup for critical controls and LLRF |
| Pad-Mount Transformer | 150 kW | $200k | Starter workhorse — feeds a small beamline |
| Motor Control Center | 250 kW | $300k | Motor loads: pumps, compressors, drives |
| Switchgear Cabinet | 400 kW | $400k | Mid-size facility distribution |
| HV Transformer | 1200 kW | $800k | Industrial — anchors a serious facility |

One pad-mount transformer covers a starter beamline (source + a few magnets + diagnostics). A facility with NC RF structures, a detector, or cryomodules needs planned distribution across several sources.

### Demand

Each component's power sink declares its own draw (kW), in rough tiers:

| Tier | Draw | Examples |
|------|------|----------|
| Tiny | 1-3 kW | BPM (1), ICT (1), Faraday cup (1), pepper-pot filter (2), screen (2), wire scanner (3) |
| Small | 5-25 kW | Buncher (5), half-wave resonator (8), sextupole (8), quad (10), pillbox (10), spoke cavity (10), elliptical SRF (12), velocity selector (15), collision point (20), dipole (25) |
| Medium | 30-80 kW | Ion source (30), RFQ (40), septum (40), electron gun (50), NC structures (60), ECR source (60), cryomodule (80) |
| Large | 100+ kW | Detector (120) |

Facility equipment draws power too, and its demand is its own `energyCost` — the same number the electricity bill charges, so the two can never drift apart. A gyrotron is a 2,000 kW sink; a high-power SSA is 500 kW.

If total draw exceeds total capacity in a network, every component on it derates (quality = capacity/demand). That derate is **linear on magnet focusing strength, and that is physically correct**: field goes as coil current, which goes as supply power. Power is the one utility where a linear scalar is the right model.

### Networks

Power cables form isolated networks. A transformer's capacity is only available to components reachable via power cable from it. Two sources on opposite sides of your facility with no cable between them are two independent power networks, each with its own capacity budget.

This means you can have one power network for your RF systems and another for your magnet string. If the RF network is overloaded, it doesn't matter that the magnet network has spare capacity.

### Strategy

- Start with one pad-mount transformer for a small linac
- Add switchgear or an HV transformer as you add high-draw equipment (NC RF structures, detectors, cryomodules)
- Power panels are cheap but tiny — good for a diagnostics run, not a magnet string
- Watch utilization — running above 90% leaves no headroom for expansion
- Plan power network topology before building: it's easier to lay cables on an empty floor

## The Math

**Network capacity:**
```
C_network = sum(capacity_kW for each power source in network)
```

**Network draw:**
```
D_network = sum(demand_kW for each power sink in network)
```

**Utilization and quality:**
```
U = D_network / C_network * 100%
quality = min(1, C_network / D_network)   (uniform across the network's sinks)
```

**What quality does:**
```
focusStrength *= powerQuality     (linear — magnet field goes as coil current goes as power)
```
Power does *not* multiply into cavity gradient any more. A cavity's gradient comes from the RF power and (for SRF) the cryogenic temperature it is actually supplied with; see [rf-power.md](rf-power.md) and [cryogenics.md](cryogenics.md).

**Hard gates:** a power sink not wired to any network at all, or a network with sinks and `C_network = 0` (`power_starved`). Overload (`D > C`) is a soft derate — and a *badly* powered magnet still beats an unwired one, which fails closed at quality 0.
