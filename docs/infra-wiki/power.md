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
| Utility Service Point | 3 MW / 2 HV feeders | $520k | Map-edge utility takeoff feeding facility transformers |
| Pad-Mount Transformer | 150 kW | $200k | Starter workhorse — feeds a small beamline |
| Facility Transformer | 400 kW | $400k | Medium facility service with two HV feeders |
| HV Transformer | 1.5 MW / 4 HV feeders | $800k | Industrial transformer fed by the utility service |
| Grid Intertie Transformer | 6 MW / 6 HV feeders | $1.8M | Campus-scale transformer fed by the 6 MW utility service |

One pad-mount transformer covers a starter beamline. Larger facilities need a
larger source and enough protected feeder outlets to reach their local
distribution equipment.

### Distribution

Power is a radial tree, not a mesh:

```text
transformer → HV feeder → distribution panel → branch circuit → field distributor → equipment
```

- **Compact HV Distributor**: a two-wire roof tap draws up to 600 kW from a continuing HV trunk and feeds two protected 300 kW outputs; 1×1-subtile footprint.
- **Compact Distribution Panel**: 40 kW, four 10 kW green branch outlets; its cabinet is the same compact size as the Compact HV Distributor.
- **Section Distribution Panel**: 600 kW total, six 50 kW green branch outlets plus one protected 300 kW HV outlet.
- **Main Distribution Panel**: 1,200 kW total, twelve 50 kW green branch outlets plus two protected 300 kW HV outlets.
- **Beamline Busway**: 160 kW field limit, one branch feed, eight plug-in taps.
- **Spider Box**: 30 kW field limit and four interchangeable sockets. Connect
  any socket to a panel; the other three become local taps.

Distribution equipment adds no capacity. Every distribution cabinet accepts
two cable segments on its tensioning roof tap, letting the trunk continue
through the terminal; only one segment may lead to a live source. A field distributor cannot feed
another field distributor. A spider box does not care which physical socket
receives its feed, but wiring a second live feed is still invalid. Redundant
feeds require an explicit transfer switch rather than silently paralleling two
live sources.

Drawing an HV feeder through a wall automatically installs an elevated
feedthrough at one of the wall tile's two 1 m stations. Its terminals share the
indoor-rack 2.00 m height and tension the suspended cable on both faces. The
retired low-voltage passive wall feedthrough is not available for new builds.

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

### Breaker Protection

Breakers trip after a sustained overload and interrupt their protected output.
A tripped breaker automatically attempts to reset after 15 simulation seconds.
If the overload is still present, it trips again after its normal overload
delay; reducing or disconnecting the excess load lets the automatic reset hold.
You can also reset a tripped breaker immediately from its equipment controls.

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
