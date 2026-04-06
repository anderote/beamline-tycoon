# Cryogenic Systems

## Quick Tip
SRF cavities need cryogenic cooling to superconduct. No cryo connection = zero energy gain from SRF.

## How It Works

Superconducting RF (SRF) cavities must be cooled to cryogenic temperatures — 4.5 Kelvin (-269 C) or 2 Kelvin (-271 C) — to become superconducting. At these temperatures, niobium has zero electrical resistance, so RF fields oscillate in the cavity walls with almost no energy loss. This is what makes SRF cavities dramatically more efficient than normal-conducting copper cavities.

But maintaining these temperatures requires a complex cryo plant. The cryogenic system is the most expensive and demanding infrastructure in any SRF-based accelerator.

### The Cryo Chain

A complete cryogenic system has these components, roughly in order of the cooling process:

1. **LN2 Dewar** — liquid nitrogen storage at 77K. Cheapest cryogen, used for pre-cooling.
2. **LN2 Pre-cooler** — uses LN2 to cool helium gas from 300K to 80K before the main refrigerator, reducing compressor load.
3. **Helium Compressor** — the heart of the system. Compresses warm return helium gas. High energy cost. Required for cold boxes to function.
4. **4K Cold Box** — refrigerator that cools helium to 4.5K. Standard operating temperature for most SRF cavities. 500W capacity.
5. **2K Cold Box** — sub-atmospheric pumping to reach 2.0K (superfluid helium). Higher Q-factor operation. 200W capacity.
6. **Cryomodule Housing** — insulated vacuum vessel surrounding SRF cavities. Provides thermal shielding between 2-4K interior and room temperature.
7. **Helium Recovery** — captures boil-off helium gas for recycling. Reduces long-term costs.
8. **Cryocooler** — small closed-cycle refrigerator (40-80K). Good for individual components, not powerful enough for SRF strings.

### Cryo Networks

Cryo transfer lines form isolated networks, just like other utility systems. A cold box only serves SRF cavities it's connected to via cryo transfer tiles. The key constraints per network:

- **Compressor required**: cold boxes produce zero capacity without a helium compressor in the same network. The compressor drives the refrigeration cycle.
- **Capacity vs load**: total cooling capacity must exceed total heat load
- **Operating temperature**: determined by the coldest cold box in the network (4.5K or 2K)

### Heat Load

Each cryomodule generates heat from two sources:

| Source | Load per Unit | Description |
|--------|--------------|-------------|
| Static (housing) | 3 W | Heat leak through insulation |
| Static (cavity) | 3 W | Conduction through supports |
| Dynamic (cavity) | 15 W | RF losses in cavity walls during operation |
| **Total per SRF cavity** | **~18 W** | |

This seems tiny (watts, not kilowatts), but removing heat at 4K requires enormous energy input. The **Carnot penalty** means every watt removed at 4K costs about 250 watts of electrical power, and at 2K it costs about 750 watts. A cryo plant cooling 10 SRF cavities (180W heat load) at 4K draws 45 kW of wall power.

### Strategy

- You don't need cryo until you place SRF components (cryomodule, Tesla 9-cell, SRF 650, SC magnets)
- Minimum viable cryo: He compressor + 4K cold box + cryo transfer to SRF cavities
- LN2 pre-cooler reduces compressor energy cost — good optimization
- 2K operation unlocks higher cavity Q but costs 3x more wall power per watt
- Helium recovery is worth it for large installations — helium is expensive
- Plan cryo network routing early — the components are large and the transfer lines need to reach every cryomodule

## The Math

**Network cryo capacity:**
```
C_network = sum(capacity_W for each cold box or cryocooler in network)
```
Cold boxes contribute zero if no He compressor is in the network.

**Network heat load:**
```
Q_static = N_housings * 3W + N_srf_cavities * 3W
Q_dynamic = N_srf_cavities * 15W
Q_total = Q_static + Q_dynamic
```

**Margin:**
```
margin = (C_network - Q_total) / C_network * 100%
```

**Wall power (Carnot penalty):**
```
P_wall = Q_total * COP
```
Where COP (coefficient of performance, inverse) is:
- 4.5K operation: COP ~ 250 W_wall / W_cold
- 2.0K operation: COP ~ 750 W_wall / W_cold

**Operating temperature:**
```
T_op = min(T_coldbox for each cold box in network)
```
If no cold box, only cryocoolers: T_op = 40K (insufficient for SRF).

**Hard gate:** `Q_total > C_network` or no compressor in network blocks SRF operation.
