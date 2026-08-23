# Cryogenic Systems

## Quick Tip
SRF cavities need cryogenic cooling to superconduct. The bath holds its design temperature until you overload it — then it warms, and warming feeds itself.

## How It Works

Superconducting RF (SRF) cavities must be cooled to cryogenic temperatures — 4.5 Kelvin (-269 C) or 2 Kelvin (-271 C) — to become superconducting. At these temperatures, niobium's surface resistance drops by orders of magnitude, so RF fields oscillate in the cavity walls with almost no energy loss. This is what makes SRF cavities dramatically more efficient than normal-conducting copper cavities.

But maintaining these temperatures requires a complex cryo plant. The cryogenic system is the most expensive and demanding infrastructure in any SRF-based accelerator.

### The Cryo Chain

A central cryogenic plant mirrors the cooling-water chain: physical inventory,
active chilling, heat rejection, and make-up/recovery are separate jobs. All
equipment must be connected to the same cryo-transfer network.

1. **Helium Tank** — the central liquid-helium reservoir (2,000 L). It is required for a central plant and also raises the maximum recovery fraction from 0.70 to 0.90.
2. **4 K or 2 K Cryogenic Supply** — the cold box. The 4 K unit supplies 500 W at 4.5 K; the 2 K unit supplies 800 W and sets the network design temperature to 2.0 K.
3. **Helium Refrigeration** — the warm-end helium compressor and heat-rejection package (800 W). It needs live high-voltage power and a complete cooling-water supply/chiller/rejector chain before its cryogenic capacity counts.
4. **Cryo Transfer Line** — connects the reservoir, cold box, compressor, and SRF loads. A valve box can distribute one plant to nearby consumers.
5. **Recovery and Liquefaction** — a connected recovery header, gas bag, purifier, and liquefier capture boil-off and return part of it to the same network's reservoir. The liquefier also adds 1 L per tick while powered.

The **Compact Cryogenic Supply** is a small integrated exception: it combines a sealed 50 L
reservoir, 90 W chiller, and 90 W heat rejector in one powered unit. It can run
a small starter network without the central plant chain, but its inventory is
closed-cycle and cannot be manually refilled.

Two optional process stages improve a connected plant. A **Liquid Nitrogen Tank** and
powered **Liquid Nitrogen Pre-cooling** add up to 15% chilling capacity. Powered
**Cryogenic Heat Shielding** reduces static heat load by 5%; multiple units are
capped at 25%.

### Helium Recovery

Boil-off is physics: a watt of heat into the bath evaporates a fixed volume of liquid, and nothing you buy changes that. What a recovery plant changes is where the gas goes. Vented, it is gone for good. Caught, cleaned and re-liquefied, it goes back in the reservoir and you only buy the difference.

So recovery is a **fraction of net inventory loss**, not a change to the boil-off rate. The thermal model above is untouched — load, capacity, bath temperature and the quench mechanic all see exactly the same numbers.

Four components **contribute** to the fraction. A fifth **raises the ceiling** on it.

| Component | Cost | Recovery | Cost per point |
|-----------|------|:--------:|---------------|
| Helium Recovery Header | $350k | +0.25 | $1.4M |
| Helium Recovery Bag | $450k | +0.15 | $3.0M |
| Helium Purification | $1.2M | +0.20 | $6.0M |
| Helium Make-up | $3.5M | +0.30 | $11.7M |
| Helium Tank | $4M | ceiling 0.70 → 0.90 | $20M |

Three rules govern the total:

- **It is network-local.** Every recovery stage has a cryo connector and serves only the network it is wired into. Powered stages count only while their electrical feed is live.
- **Each type contributes once per network.** Five gas bags are five bags on one plant, not five complete recovery plants. The reward is for completing the chain, not for stamping out the cheapest rung.
- **The ceiling is 0.70, or 0.90 with bulk storage.** No recovery plant is closed — cool-down transients, relief lifts, purge losses and the purifier's own vent all leave through the roof. A real facility recovering 90% of its helium is doing very well, and it only gets there with somewhere to put the gas.

The four chain parts sum to 0.90 on their own, but without storage you are clipped to **0.70** no matter how complete the chain is. That is the point of the Helium Tank: it is a tank farm, and you cannot keep more helium than you have vessels for. Recovered gas with nowhere to go is vented like any other.

The central reservoir is required before a cold-box plant can run, but storage
alone recovers nothing. The connected chain reaches 0.70 for $5.5M and the
reservoir raises the finished chain's ceiling to 0.90. Thus storage has two
distinct jobs: plant inventory and room for recovered gas.

The panel reports the fraction and the ceiling in force, e.g. `70% / 70% cap`, so a saturated chain is visibly saturated.

### Temperature Is the Thing That Matters

The cryo network does not produce an abstract "cooling quality." It produces a **bath temperature**, and that temperature is what reaches the beam.

The bath's design temperature is **2.0 K** if any 2 K Cryogenic Supply sits on the network, and **4.5 K** otherwise. While the plant's capacity covers the heat load, the bath sits at that temperature. When load exceeds capacity, the bath warms — and the warming accelerates on its own, because the cavity's quality factor collapses as it warms, which makes it dissipate more, which warms it faster.

That runaway is the quench mechanic. It is emergent, not scripted, and it always gives you time to react. Measured against one cryomodule on a 300 W plant: a hard over-drive (25 MV/m) quenches at tick 21, a moderate one (22 MV/m) at tick 29, and a mild one (16 MV/m) never quenches at all. **Back off the demanded gradient and the plant pulls the bath back down.**

### Why 2 K Is Worth It (And Why It Isn't Free)

Going from 4.2 K to 2.0 K buys about **35x the cavity Q0**, which is about **5.9x the achievable gradient** at the same RF power. That is an enormous win.

The counter-pressure is the Carnot penalty: removing a watt at 2 K costs about **750 W** of wall power, against **250 W** at 4.5 K. So 2 K buys 35x the Q0 at 3x the electricity per watt removed, and the operating point is a genuine engineering choice rather than a strictly-better setting.

### Heat Load: Static and Dynamic

Each SRF component declares a **static** heat load — the vessel, transfer line and radiation heat it leaks whether or not it is powered:

| Component | Static Load | Description |
|-----------|-----------|-------------|
| Half-Wave Resonator | 15 W | Small coaxial cavity |
| Spoke Cavity | 25 W | Double-spoke resonator |
| 9-cell Elliptical SRF | 40 W | High-gradient cavity in its own He vessel |
| TESLA Cryomodule | 250 W | Eight 9-cell cavities in one cryostat |

On top of that sits the **dynamic** load: RF power dissipated in the cavity walls, computed from the gradient the cavity actually reached last tick and the bath's current temperature. This dominates while running, and it is what closes the feedback loop. A cryomodule at 20 MV/m dissipates about **429 W at 2.0 K** and about **18.5 kW at 4.5 K** — which is why the same hardware that is comfortable cold is hopeless warm.

An idle machine still boils helium: static load counts even with no RF.

### Quench

Two independent causes, both hard trips:

- **Thermal quench:** the bath reaches 9.25 K (niobium's Tc)
- **Dry reservoir:** liquid helium falls below 20 L

A quenched SRF cavity is converted to a drift — it accelerates nothing. It also contributes **no dynamic load**, because the machine-protection interlock drops its RF the moment it goes normal-conducting. That is what lets the plant recover; without it, Q0 would fall to the copper value, dissipation would go to megawatts, and the quench would latch forever.

### Strategy

- You don't need cryo until you place SRF components (half-wave resonator, spoke cavity, elliptical SRF, cryomodule)
- Minimum central cryo: Helium Tank + 4 K Cryogenic Supply + powered Helium Refrigeration with cooling water + cryo transfer to every SRF load.
- For a very small SRF load, a powered Compact Cryogenic Supply is an integrated 90 W alternative.
- 2K operation unlocks far higher cavity Q0 but costs 3x more wall power per watt removed
- Watch the temperature readout, not just the margin bar. A warming bath is the early warning; the margin bar goes red at the same moment but the temperature tells you how fast
- Cryo transfer costs $160/sub-unit ($640/tile); keep the plant and its process stages on one deliberately routed network.
- Helium is expensive. A cryomodule string has a real helium bill.

## The Math

**Surface resistance and quality factor** (niobium, BCS approximation):
```
R_BCS(T) = (2e-4 x f_GHz^2 / T) x exp(-17.67 / T)      ohm
Q0(T)    = G / (R_BCS(T) + R_res)                      R_res = 10 nohm
```

Calibrated against the TESLA 9-cell (f = 1.3 GHz, R/Q = 1030 ohm, G = 270 ohm, L = 1.038 m):

| T (K) | R_BCS (nohm) | Q0 | E_acc @ 42 W | P_diss @ 20 MV/m |
|---|---|---|---|---|
| 1.8 | 10 | 1.3e10 | 23.1 MV/m | 31 W |
| 2.0 | 25 | 7.8e9 | 17.7 MV/m | 54 W |
| 2.5 | 115 | 2.2e9 | 9.3 MV/m | 194 W |
| 3.0 | 312 | 8.4e8 | 5.8 MV/m | 499 W |
| 4.2 | 1198 | 2.2e8 | 3.0 MV/m | 1872 W |

Real TESLA cavities run Q0 ~ 1e10 at 2 K and dissipate 30-50 W at 20 MV/m, so the model reproduces hardware with no free parameters.

**Achievable gradient and wall dissipation** (per cavity — a cryomodule holds eight):
```
E_acc,max = sqrt(P_rf x (R/Q) x Q0) / L_active
P_diss    = (E_acc x L_active)^2 / ((R/Q) x Q0)
```

**Per-component SRF constants:**

| Component | f (GHz) | R/Q (ohm) | G (ohm) | L_act (m) | cavities |
|---|---|---|---|---|---|
| Half-Wave Resonator | 0.161 | 275 | 50 | 0.30 | 1 |
| Spoke Cavity | 0.325 | 220 | 110 | 0.46 | 1 |
| 9-cell Elliptical SRF | 0.65 | 380 | 190 | 0.72 | 1 |
| TESLA Cryomodule | 1.3 | 1030 | 270 | 1.038 | 8 |

**Thermal step, per tick:**
```
T_design = 2.0 K if a coldBox2K is on the network, else 4.5 K
load(T)  = sum(static heat) + sum(P_diss at last achieved gradient)
cap(T)   = min(rated_W x (T / T_design)^1.3, rated_W x 3)
T_next   = clamp(T + (load - cap) / 20000, T_design, 9.25)
```
`capacity` rises with temperature because a plant run warmer than its design point delivers more — which is exactly why 4 K operation is cheap. The thermal mass constant (20000 W-ticks/K) sets the whole warning window.

**Network plant and capacity:**
```
storage   = sum(storageCapacityL on connected equipment)
chilling  = sum(live coldCapacityW) x (1 + LN2 pre-cooling bonus)
rejection = sum(live heatRejectionCapacityW)
C_network = min(chilling, rejection)
```
The plant is offline unless storage, chilling, and heat rejection are all
positive. A cold box counts only while powered. A compressor counts only while
powered and supplied by a complete cooling-water plant. The integrated
Compact Cryogenic Supply declares all three capabilities itself.

**LHe reservoir:** boil-off is `0.0005 L per W of total heat load per tick`; below 20 L the network **quenches**. Capacity is physical and network-local: the Helium Tank provides 2,000 L, while the Compact Cryogenic Supply carries a sealed 50 L inventory. Central storage refills cost $50/L, so a full 1,980 L top-up is about $99,000. Adding or removing a tank changes the persistent inventory ceiling without creating free helium during topology edits.

**Recovery:**
```
net_loss = boiloff x (1 - f)
f        = min(cap, sum of installed contributing TYPES)
cap      = 0.90 with Helium Tank, else 0.70
```
The reservoir loses `net_loss`, not gross `boiloff`. Only live recovery stages
connected to that reservoir's network contribute. A powered liquefier then
adds up to 1 L/tick of make-up after boil-off and recovery are applied, stopping
at the connected reservoir's physical capacity.

**Wall power (Carnot penalty):**
```
P_wall = Q_total x COP
```
- 2.5 K and below: COP ~ 750 W_wall / W_cold
- Above 2.5 K: COP ~ 250 W_wall / W_cold

**Hard gates:** an SRF cavity's cryo sink is unwired; the connected network is
missing reservoir, chilling, or heat rejection; or the network is in quench
(thermal or dry-reservoir). Merely exceeding a complete plant's capacity is a
**soft** warning (`cryo_warming`) — the bath starts climbing, and you have time
to do something about it.
