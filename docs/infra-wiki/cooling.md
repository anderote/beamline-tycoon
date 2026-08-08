# Cooling Water

## Quick Tip
Magnets and RF cavities generate heat. Chillers and LCW skids remove it. No cooling = no beam.

## How It Works

About 60% of the electrical power consumed by beamline and facility equipment ends up as waste heat. Without cooling, components overheat and shut down — or worse, get damaged. The cooling water system removes this heat and dumps it to the environment.

### Cooling Plant

Three types of equipment provide cooling capacity:

| Equipment | Capacity | Cost | Role |
|-----------|----------|------|------|
| LCW Skid | 100 kW | $600k | Entry level — local distribution of low-conductivity water |
| Chiller | 300 kW | $1.2M | Precision temperature control (+/- 0.1 C) |
| Cooling Tower | 800 kW | $2M | Industrial bulk heat rejection |

In a real facility, the hierarchy is: cooling tower dumps heat to atmosphere, chiller provides stable-temperature water, LCW skid distributes deionized water to individual components. In gameplay, each provides capacity and they all connect through cooling water networks.

### Cooling Networks

Cooling water pipes form isolated networks. A chiller only cools components it's plumbed to via cooling water tiles. Two separate pipe runs form two separate cooling networks, each with its own capacity budget.

This means you need to plan your pipe routing. A common strategy:
- One cooling network for your magnet string
- One cooling network for your RF system (which generates more heat)
- Separate networks can have different capacity — build bigger where the heat is

### Heat Load

Each cooled component declares its own heat load (kW):

| Load | Components |
|------|------------|
| 6-8 kW | Sextupole (6), quadrupole (8) |
| 20-25 kW | Dipole (20), ion source (20), septum (25) |
| 40-60 kW | ECR source (40), target (40), beam stop (50), detector (60), RFQ (60) |
| 100-120 kW | S-band structure (100), NC RF cavity (120) |

Not all components need cooling water — passive elements and low-power electronics are air-cooled, and SRF cavities load the cryo plant instead. Only components with `coolingWater` in their required connections need to be in a cooling network.

The biggest heat producers are normal-conducting RF structures: a single NC cavity's 120 kW eats a whole chiller's margin. Magnets are gentle by comparison — a starter magnet string fits under one LCW skid.

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
Q_network = sum(heatLoad_kW for each cooling sink in network)
```

**Reservoir:** each cooling network evaporates `0.001 L per kW of heat load per tick` from its 500 L reservoir. Refills cost $10/L — big heat loads have a real operating cost. An empty reservoir is a hard beam trip.

**Margin:**
```
margin = (C_network - Q_network) / C_network * 100%
```

**Flow rate (assuming 10 C temperature rise):**
```
flow_rate = C_network / (4.18 kJ/(kg*K) * 10 K) * 60 L/min
```

**Hard gate:** `Q_network > C_network` in any cooling network blocks beam operation.
