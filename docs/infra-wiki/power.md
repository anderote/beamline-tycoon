# Electrical Power

## Quick Tip
Every active component draws power. Substations provide it. No substation connection = no function.

## How It Works

Electrical power is the most fundamental infrastructure system. Almost everything in your facility needs it — magnets, RF sources, pumps, chillers, diagnostics, controls. Without power, nothing runs.

### Supply

Power comes from **substations**. Each substation provides 1500 kW of electrical capacity. Substations themselves don't need connections — they represent the facility's connection to the utility grid. They're the root of every power network.

**Power distribution panels** extend your power network's reach without adding capacity. They're cheap junction points — place them along the beamline so you can run shorter power cable runs to nearby equipment.

### Demand

Every component with an `energyCost` value draws from its power network. This includes:
- Beamline components (magnets, RF cavities, diagnostics)
- Facility equipment (pumps, klystrons, chillers, compressors)

The draw is the sum of all `energyCost` values in that network. If total draw exceeds total substation capacity in that network, beam cannot run.

### Networks

Power cables form isolated networks. A substation's capacity is only available to components reachable via power cable from that substation. Two substations on opposite sides of your facility with no cable between them are two independent power networks, each with its own capacity budget.

This means you can have one power network for your RF systems and another for your magnet string. If the RF network is overloaded, it doesn't matter that the magnet network has spare capacity.

### Strategy

- Start with one substation for a small linac
- Add substations as you add high-draw equipment (klystrons, compressors, chillers)
- Use power panels to branch cables without running everything back to the substation
- Watch utilization — running above 90% leaves no headroom for expansion
- Plan power network topology before building: it's easier to lay cables on an empty floor

## The Math

**Network capacity:**
```
C_network = sum(1500 kW for each substation in network)
```

**Network draw:**
```
D_network = sum(energyCost_kW for each component in network)
```

**Utilization:**
```
U = D_network / C_network * 100%
```

**Hard gate:** `D_network > C_network` in any network blocks beam operation.
