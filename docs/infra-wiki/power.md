# Electrical Power

## Quick Tip
Every active component draws power. A transformer supplies capacity; switchgear,
panels, busways and spider boxes only distribute that upstream capacity. No power
connection = no function.

## How It Works

Electrical power is the most fundamental infrastructure system. Almost everything in your facility needs it — magnets, RF sources, pumps, chillers, diagnostics, controls. Without power, nothing runs.

### HV Supply

Power sources form a capacity ladder — upgrading is a real decision:

| Source | Capacity | Cost | Role |
|--------|----------|------|------|
| Pad-Mount Transformer | 150 kW | $200k | Starter workhorse — feeds a small beamline |
| Facility Transformer | 400 kW | $400k | Medium facility service with two HV feeders |
| HV Transformer | 1200 kW | $800k | Industrial — anchors a serious facility |
| Grid Intertie Transformer | 3000 kW | $1.8M | Campus-scale supply for several accelerator halls |

One pad-mount transformer covers a starter beamline. Larger facilities need a
larger source and enough protected feeder outlets to reach their local
distribution equipment.

### Distribution

Power is a radial tree, not a mesh:

```text
transformer → HV feeder → main switchgear → HV feeder → panel / MCC / UPS
            → branch circuit → busway / spider box → equipment
```

- **Main Switchgear** takes one HV input and provides four protected feeders
  for downstream distribution equipment.
- **Power Distribution Panel** has four front-face branch outlets for nearby
  diagnostics, small pumps and electronics.
- **Motor Control Center** has eight front-face outlets for larger equipment
  clusters.
- **UPS / Battery Bank** has two protected outlets for critical controls and
  LLRF. It does not yet simulate stored-energy ride-through.
- **Beamline Busway** is a long field distributor: one feeder in, a whole
  beamline segment covered.
- **Spider Box** is a small field distributor: one feeder in, four local taps.

Distribution equipment adds no capacity. Each item accepts exactly one
upstream feeder, and distribution outputs cannot be tied together. If a future
facility needs redundant feeds, it will use an explicit transfer switch rather
than silently paralleling two live panels.

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

Power cables form isolated radial networks. A transformer's capacity is only
available to components reachable through its feeder and distribution tree.
Two sources on opposite sides of your facility with no cable between them are
two independent power networks, each with its own capacity budget.

This means you can have one power network for your RF systems and another for your magnet string. If the RF network is overloaded, it doesn't matter that the magnet network has spare capacity.

### Strategy

- Start with one pad-mount transformer and a small distribution panel
- Add a facility/HV transformer and main switchgear as you add high-draw equipment (NC RF structures, detectors, cryomodules)
- Power panels are cheap but tiny; use a busway or spider box to reach clustered equipment without creating a second supply
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
