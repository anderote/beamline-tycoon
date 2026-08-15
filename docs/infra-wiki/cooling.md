# Cooling Water

## Quick Tip
Magnets and normal-conducting RF cavities generate heat. Chillers and LCW skids remove it. Undercool a copper cavity and it walks off resonance.

## How It Works

About 60% of the electrical power consumed by beamline and facility equipment ends up as waste heat. Without cooling, components overheat — or, in the case of an RF cavity, expand and detune. The cooling water system removes this heat and dumps it to the environment.

### Cooling Plant Roles

The blue pipe is the **process-water loop** that reaches magnets, RF, targets,
and detectors. Do not read every blue-capacity item as “a water source”:

| Role | Equipment | What it does |
|------|-----------|--------------|
| **Process cooling** | Package Chiller, LCW Skid, Dual-Circuit Chiller, Chiller | Conditions and circulates water for the beamline loop. These are the normal starting points for a blue-pipe network. |
| **Heat rejection** | Fan-Coil Cooler, Dry Cooler Bank, Cooling Tower | Disposes of heat to room/outdoor air. The fan-coil does it directly; the dry cooler and tower are plant-scale rejectors. |
| **Make-up supply** | Make-up Water Tank, Facility Water Supply | Replaces evaporated water at a finite rate. The facility supply has the larger flow but no onboard storage. |
| **Storage** | Make-up Water Tank, Bulk Water Storage Tanks | Sets how many litres the network can hold. Bulk tanks are passive and never generate water. |
| **Water & treatment** | Deionizer | Keeps the loop clean; it does not add cooling capacity. |
| **Distribution** | LCW Manifold | Extends a live process-water loop to nearby on-pipe sinks; it does not add capacity. |

The current simulation expresses both process cooling and heat rejection as
capacity on the same cooling-water network. The palette and equipment cards
now label them separately so their physical jobs remain clear.

Cooling suppliers, make-up sources and storage use one standard connection layout:
four independently routable sockets on the primary header and two on the
opposite side. Heat rejectors instead expose one supply/return pair together
on a single side. The sockets on a component all share its one nameplate
rating; extra connections simplify routing and do not multiply capacity.
Press **M** while placing to swap the headers to the opposite sides, or **F**
to rotate the complete component.

#### Process Cooling

| Equipment | Capacity | Cost | $/kW | Role |
|-----------|----------|------|------|------|
| Package Chiller | 5 kW | $325k | $65,000 | Single-circuit process-water skid |
| LCW Skid | 25 kW | $600k | $24,000 | Low-conductivity process-water supply |
| Dual-Circuit Chiller | 175 kW | $900k | $5,143 | Two process-water circuits and setpoints |
| Chiller | 300 kW | $1.2M | $4,000 | Precision process-water control (+/- 0.1 C) |

#### Heat Rejection

| Equipment | Capacity | Cost | $/kW | Role |
|-----------|----------|------|------|------|
| Fan-Coil Cooler | 50 kW | $140k | $2,800 | Direct room-air rejection for a tiny starter loop |
| Dry Cooler Bank | 500 kW | $1.55M | $3,100 | Air-blast outdoor rejection without a basin |
| Cooling Tower | 800 kW | $2M | $2,500 | Industrial evaporative heat rejection |

The package chiller and LCW skid are compact, self-contained ways into cooling. Central chillers become much cheaper per kilowatt once the machine grows, while heat rejectors are a separate requirement for those central plants.

Capacity per tile and wall power per kilowatt generally improve with central
plant scale, so compact packages buy an affordable start while larger systems
buy efficient expansion.

In a real facility, the hierarchy is: cooling tower dumps heat to atmosphere, chiller provides stable-temperature water, LCW skid distributes deionized water to individual components. A fan-coil unit skips the whole hierarchy and rejects straight to room air, which is why its supply temperature can never get below ambient. A dry cooler bank does the same thing at plant scale — no basin, no make-up water, no water treatment — at the price of capacity that sags with the outdoor air temperature, which is exactly why the evaporative tower still sits above it.

### Cooling Networks

Cooling water pipes form isolated networks. A chiller only cools components it's plumbed to via cooling water tiles. Two separate pipe runs form two separate cooling networks, each with its own capacity budget.

Water inventory is also local to that network. The **Make-up Water Tank**
combines a 1 L/tick supply with 500 L of storage. The **Facility Water Supply**
delivers 20 L/tick but stores nothing, so it needs a tank. **Bulk Water Storage
Tanks** hold 5,000 L but supply 0 L/tick: without a make-up source their level
only goes down. Connecting several tanks adds their capacities; connecting
several sources adds their flow rates.

This means you need to plan your pipe routing. A common strategy:
- One cooling network for your magnet string
- One cooling network for your RF system (which generates far more heat)
- Separate networks can have different capacity — build bigger where the heat is

### Heat Load

Each cooled component declares its own heat load (kW):

| Load | Components |
|------|------------|
| 6-8 kW | Sextupole (6), quadrupole (8) |
| 20-30 kW | Dipole (20), ion source (20), septum (25), electron gun (30) |
| 40-60 kW | ECR source (40), target (40), beam stop (50), detector (60), RFQ (60) |
| 100-120 kW | S-band structure (100), NC RF cavity (120) |

Not all components need cooling water — passive elements and low-power electronics are air-cooled, and **SRF cavities have no water loop at all**: their thermal path is the cryo model. Only components that declare a `coolingWater` sink need to be in a cooling network.

The biggest heat producers are normal-conducting RF structures: a single NC cavity's 120 kW eats a whole chiller's margin. Magnets are gentle by comparison — a starter magnet string fits under one LCW skid.

### What Undercooling Actually Does

The solver turns an unmet heat load into a **temperature rise at the sink**: a fully starved loop reaches 40 K above design, a partly served one scales in between.

For a normal-conducting cavity, that temperature rise causes thermal expansion, which shifts the resonant frequency. The cavity falls off resonance and stops absorbing the power aimed at it — the response is Lorentzian, so a small deficit is nearly free and a large one is catastrophic. At S-band, a 10 K rise couples only about 34% of forward power; a fully starved 40 K rise couples about 3%.

**It does not gently fade.** The power that doesn't couple in reflects back at the klystron, and that reflected fraction is what drives the VSWR readout in the RF panel.

> **Known limitation:** magnets have *no* graded response to cooling. A `coolingDegradation` emittance-growth factor is computed in the physics layer and read by nothing. A magnet's cooling connection is hard-gated — no connection, no beam — but an under-served cooling loop leaves the magnet's focusing strength untouched.

### Supporting Equipment

**Deionizer/Water Treatment** — keeps cooling water resistivity high (>1 MOhm-cm). Without it, dissolved ions cause electrical leakage and corrosion. Flavour only in gameplay: it adds no capacity and has no mechanical effect.

**Heat Exchanger** — transfers heat between isolated cooling loops. Use between the beamline LCW circuit and the facility chilled water, or to isolate sensitive equipment.

**High-Power Water Load** — absorbs reflected RF power as heat. Place near circulators.

**Emergency Cooling (UPS)** — keeps water flowing during power outages.

### Strategy

- Start with a Package Chiller or LCW Skid for a small beamline
- Add a Make-up Water Tank when evaporation begins to outrun manual refills
- Pair the Facility Water Supply with Bulk Water Storage Tanks for a large plant
- Add a chiller when you add NC RF structures — they are where the heat actually is
- Cooling tower for large facilities with many heat-producing systems
- A cooling manifold ($80k) beats individual runs at about four sinks; cooling pipe is $3,600/tile
- Watch the reservoir, not just the capacity bar. Big heat loads drink water fast, and an empty reservoir is a hard beam trip.

## The Math

**Network cooling capacity:**
```
C_network = sum(capacity_kW for each plant in network)
```

**Network heat load:**
```
Q_network = sum(heatLoad_kW for each cooling sink in network)
quality   = min(1, C_network / Q_network)
```

**Temperature rise at the sink:**
```
dT = 40 K x (1 - quality)
```
Quality 1 means the loop keeps up and the component sits at design temperature.

**Thermal detuning of normal-conducting cavities:**
```
df       = 20 kHz/K x dT x (f_GHz / 2.856)
coupling = 1 / (1 + (2 Q_L df / f)^2)          Q_L = 1e4
P_eff    = P_forward x coupling
reflected fraction = 1 - coupling
```

**Water inventory:** each cooling network sums storage and make-up flow from its connected equipment.
```
storage_max = sum(storageCapacityL)
make_up     = sum(supplyRateLPerTick)
evaporation = 0.02 L x heat_load_kW per tick
stored_next = clamp(stored + make_up - evaporation, 0, storage_max)
```
Refills cost $12/L up to the network's actual storage capacity. A 30 kW loop
evaporates 0.6 L/tick, so the make-up tank's 1 L/tick feed keeps it full. A
1 MW plant evaporates 20 L/tick, exactly the Facility Water Supply's rating.
Bulk tanks extend the buffer but do not change either rate. The integrated
Package Chiller and LCW Skid retain their automatic 0.1 L/tick and 0.5 L/tick
feeds, enough to offset evaporation at their respective nameplate loads.

**Margin:**
```
margin = (C_network - Q_network) / C_network * 100%
```

**Flow rate (assuming 10 C temperature rise):**
```
flow_rate = C_network / (4.18 kJ/(kg*K) * 10 K) * 60 L/min
```

**Hard gates:** a cooling sink not wired to any network; a network whose stored water has run dry without enough live make-up flow (`cooling_dry`); or an incomplete central plant without storage, a chiller, and a heat rejector (`cooling_plant_offline`). Exceeding thermal capacity is a **soft** derate — the loop warms and NC cavities detune, but the beam keeps running.
