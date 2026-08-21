# Electrical Power

## Quick Tip
Every active component draws power. A transformer supplies capacity; panels,
busways and spider boxes only distribute that upstream capacity. No power
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
transformer → HV feeder → distribution panel → branch circuit → field distributor → equipment
```

- **Compact HV Distributor**: one 200 kW HV feed, two protected 100 kW HV feeders; 1×1-subtile footprint.
- **HV Distributor Box**: one 400 kW HV feed, four protected 100 kW HV feeders.
- **Compact Distribution Panel**: 40 kW, one HV feed, four 10 kW branch outlets.
- **Section Distribution Panel**: 150 kW, one HV feed, six 25 kW branch outlets.
- **Main Distribution Panel**: 400 kW, one HV feed, eight 50 kW branch outlets.
- **Beamline Busway**: 160 kW field limit, one branch feed, eight plug-in taps.
- **Spider Box**: 30 kW field limit and four interchangeable sockets. Connect
  any socket to a panel; the other three become local taps.

Distribution equipment adds no capacity. Each item accepts exactly one
upstream feed; a field distributor cannot feed another field distributor. A
spider box does not care which physical socket receives that feed, but wiring a
second live feed is still invalid. If a future facility needs redundant feeds,
it will use an explicit transfer switch rather than silently paralleling two
live panels.

### Demand

Each component's power sink declares its own draw (kW), in rough tiers:

| Tier | Draw | Examples |
|------|------|----------|
| Tiny | 1-3 kW | BPM (1), ICT (1), Faraday cup (1), pepper-pot filter (2), screen (2), wire scanner (3) |
| Small | 5-25 kW | Buncher (5), half-wave resonator (8), sextupole (8), quad (10), pillbox (10), spoke cavity (10), elliptical SRF (12), velocity selector (15), collision point (20), dipole (25) |
| Medium | 30-80 kW | Ion source (30), RFQ (40), septum (40), electron gun (50), NC structures (60), ECR source (60), cryomodule (80) |
| Large | 100+ kW | Detector (120), high-voltage DC injector (400) |

Facility equipment draws power too, and its demand is its own `energyCost` — the same number the electricity bill charges, so the two can never drift apart. A gyrotron is a 2,000 kW sink; a high-power SSA is 500 kW.

If total draw exceeds total capacity in a network, every component on it derates (quality = capacity/demand). That derate is **linear on magnet focusing strength, and that is physically correct**: field goes as coil current, which goes as supply power. Power is the one utility where a linear scalar is the right model.

### Networks

Power cables form isolated radial networks. A transformer's capacity is only
available to components reachable through its feeder and distribution tree.
Two sources on opposite sides of your facility with no cable between them are
two independent power networks, each with its own capacity budget.

This means you can have one power network for your RF systems and another for your magnet string. If the RF network is overloaded, it doesn't matter that the magnet network has spare capacity.

### Strategy

- Start with one pad-mount transformer and a compact distribution panel
- Move through facility, HV and grid-intertie transformers in capacity/cost order as your demand grows
- Pick panel size by the number and rating of branch circuits; use a busway or spider box only to fan out one branch locally
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
