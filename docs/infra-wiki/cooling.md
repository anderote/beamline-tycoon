# Cooling Water

## Quick Tip
Magnets and RF cavities generate heat. Chillers and LCW skids remove it. No cooling = no beam.

## How It Works

About 60% of the electrical power consumed by beamline and facility equipment ends up as waste heat. Without cooling, components overheat and shut down — or worse, get damaged. The cooling water system removes this heat and dumps it to the environment.

### Cooling Plant

Three types of equipment provide cooling capacity:

| Equipment | Capacity | Role |
|-----------|----------|------|
| LCW Skid | 100 kW | Local distribution of low-conductivity water |
| Chiller | 200 kW | Precision temperature control (+/- 0.1 C) |
| Cooling Tower | 500 kW | High-capacity bulk heat rejection |

In a real facility, the hierarchy is: cooling tower dumps heat to atmosphere, chiller provides stable-temperature water, LCW skid distributes deionized water to individual components. In gameplay, each provides capacity and they all connect through cooling water networks.

### Cooling Networks

Cooling water pipes form isolated networks. A chiller only cools components it's plumbed to via cooling water tiles. Two separate pipe runs form two separate cooling networks, each with its own capacity budget.

This means you need to plan your pipe routing. A common strategy:
- One cooling network for your magnet string
- One cooling network for your RF system (which generates more heat)
- Separate networks can have different capacity — build bigger where the heat is

### Heat Load

Each component's heat output is proportional to its electrical power consumption:
```
heat_output = energyCost * 0.6
```
Not all components need cooling water — passive elements and low-power electronics are air-cooled. Only components with `coolingWater` in their required connections need to be in a cooling network.

The biggest heat producers:
- RF cavities and structures (high gradient = high heat)
- Magnets (especially large dipoles and quadrupoles)
- RF sources (klystrons, IOTs)
- Beam absorbers (targets, beam dumps, collimators)

### Supporting Equipment

**Deionizer/Water Treatment** — keeps cooling water resistivity high (>1 MOhm-cm). Without it, dissolved ions cause electrical leakage and corrosion. Doesn't add capacity but improves long-term reliability (reduces wear on cooled components).

**Heat Exchanger** — transfers heat between isolated cooling loops. Use between the beamline LCW circuit and the facility chilled water, or to isolate sensitive equipment.

**High-Power Water Load** — absorbs reflected RF power as heat. Protects your RF chain. Place near circulators.

**Emergency Cooling (UPS)** — keeps water flowing during power outages. Prevents thermal damage to expensive superconducting magnets and RF cavities.

### Strategy

- Start with an LCW skid for a small beamline
- Add a chiller when you add RF cavities (they need tight temperature control)
- Cooling tower for large facilities with many heat-producing systems
- Keep pipe runs simple — branch from a central chiller
- Watch your cooling margin — running too close to capacity risks thermal trips
- Deionizers prevent long-term corrosion problems

## The Math

**Network cooling capacity:**
```
C_network = sum(capacity_kW for each plant in network)
```

**Network heat load:**
```
Q_network = sum(energyCost * 0.6 for each component with coolingWater connection in network)
```

**Margin:**
```
margin = (C_network - Q_network) / C_network * 100%
```

**Flow rate (assuming 10 C temperature rise):**
```
flow_rate = C_network / (4.18 kJ/(kg*K) * 10 K) * 60 L/min
```

**Hard gate:** `Q_network > C_network` in any cooling network blocks beam operation.
