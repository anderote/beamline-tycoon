# Infrastructure Quality

> **Quick Tip:** Utilities don't derate your beam by a percentage — they set the physical conditions the hardware runs under. Watts of RF and kelvin of helium decide what a cavity can do.

## How It Works

Every utility network still computes a **quality score** from 0 to 1 (`capacity / demand`, clamped). But that scalar is no longer what reaches the beam. Each utility now acts through the quantity it physically controls, and the solver publishes that quantity per sink alongside the scalar:

| Network | What reaches the beam | Effect when short |
|---------|----------------------|-------------------|
| Power | quality scalar | Magnet focusing strength scales **linearly** with it. Field goes as coil current, which goes as supply power — linear is the correct exponent here. |
| RF Waveguide | **watts of peak power** at the cavity | Cavity gradient goes as **sqrt(P)**, not P. Halving the power costs ~29% of gradient, not 50%. |
| Cryo Transfer | **bath temperature in kelvin** | Q0 collapses as the bath warms, which drops the achievable gradient and raises the heat load. Runaway ends in quench at 9.25 K. |
| Cooling Water | **temperature rise in kelvin** at the sink | Normal-conducting cavities *detune off resonance* and reflect power back at the source. They do not gently fade. |
| Vacuum Pipe | **pressure in mbar** at the sink | Residual gas scatters the beam: emittance grows, current is knocked out. |
| Data Fiber | quality scalar | Scales data income only. Never trips the beam. |

### RF: gradient goes as the square root of power

A cavity's accelerating gradient is limited by the power it is fed:

- **Superconducting:** `E_acc = sqrt(P x (R/Q) x Q0) / L` per cavity
- **Normal-conducting:** `E_acc = sqrt(P x r_shunt / L)`, with `r_shunt` in ohm/m

The player sets a demanded gradient; the plant decides what is achievable. The cavity delivers `min(demanded, achievable)`. Provision it properly and it delivers its catalogue energy gain exactly; starve it and the ceiling binds.

### Cryo: the bath holds a design temperature, or it warms

A helium bath sits at the temperature the pressure above it dictates. A 2 K plant holds 2 K. **It does not settle at some intermediate temperature proportional to how overloaded it is.** Load decides whether the plant can *maintain* the design point:

- Design temperature is **2.0 K** if a 2 K Cryogenic Supply is on the network, otherwise **4.5 K**
- While capacity covers load, the bath holds that temperature
- When load exceeds capacity, the bath **warms** — and the warming accelerates, because Q0 falls as temperature rises, which raises dissipation, which warms it faster
- At **9.25 K** (niobium's critical temperature) superconductivity is lost: **quench**

There is no "below 50% capacity it quenches" rule. Quench is a thermal event you drive the machine into, with visible warning, and it does not latch — a quenched cavity drops its RF, so its dynamic load goes to zero and the plant can pull the bath back down.

### Cooling: detuning, not fading

An undercooled normal-conducting cavity expands, its resonant frequency shifts, and it falls off resonance. The coupled power fraction is Lorentzian, so a small deficit is nearly free and a large one is catastrophic. The power that doesn't couple in is reflected back at the klystron — which is what drives the VSWR readout.

SRF cavities have no separate water loop. Their thermal path is the cryo model above.

### Vacuum: scattering, not aperture

Poor vacuum used to be modelled as a narrower effective aperture. **That mechanism no longer exists** — and it was pointing the wrong way, since clipping a Gaussian scrapes halo, which *improves* emittance. Vacuum now acts on the beam directly: multiple Coulomb scattering off residual gas grows emittance, and large-angle/nuclear scattering removes current outright.

The scattering term scales as `1/(beta x gamma)^2`, so **low-energy beam is enormously more fragile**. The injector is what needs protecting, not the far end of the linac.

## The Math

**Network quality (all six utilities):**
```
quality = clamp(total_capacity / total_demand, 0, 1)
```
Uniform across every sink on the network. There is no lab bonus term.

**Effects do NOT stack multiplicatively onto gradient.** Each utility enters the physics through its own quantity:

```
E_acc,achievable = sqrt(P_rf x coupling / n_cav x (R/Q) x Q0(T)) / L_active   [SRF]
E_acc,achievable = sqrt(P_rf x coupling x r_shunt / L_active)                 [NC]
E_acc,achieved   = min(E_acc,demanded, E_acc,achievable)

Q0(T)     = G / (R_BCS(T) + R_res)
R_BCS(T)  = (2e-4 x f_GHz^2 / T) x exp(-17.67 / T)          ohm
coupling  = 1 / (1 + (2 Q_L df / f)^2),  df = 20 kHz/K x dT x (f_GHz / 2.856)

focusStrength *= powerQuality                                 (linear, correct)
```

**Fail-closed defaults.** A component that declares a utility sink and is never wired does not silently run at full quality. Each declared-but-unsolved field resolves to its worst case:

| Field | Worst-case default |
|-------|-------------------|
| `powerQuality` / `rfQuality` / `coolingQuality` / `cryoQuality` / `vacuumQuality` / `dataQuality` | 0 |
| `rfPowerW` | 0 W |
| `cryoTempK` | 300 K |
| `coolingDeltaT` | 100 K |
| `vacuumPressure` | 1013 mbar (atmosphere) |

A utility a component *doesn't* consume stays absent and costs nothing. Zeroing the physical quantities would read as "ice cold" and "perfect vacuum" — the exact inversion this floor exists to prevent.

### Source gates vs downstream faults

The source is the only hardware whose operating state gates beam emission. Its
explicitly required operating services (depending on source type: power or HV,
and sometimes RF, cooling, or cryogenics) must deliver a non-zero quality, the
source must have health remaining, and an operator must be at the controls. If
those conditions hold, the source can run regardless of downstream equipment
faults. Beam-path vacuum remains a physics condition rather than a source
switch.

Downstream hard utility errors remain visible equipment faults, but they no
longer turn the source off. They feed their zero or degraded service values
into the beam solver, so the beam can lose energy, focus, current, quality, or
die before reaching the endpoint while the source remains on.

Hover a downstream beamline component and press **Space** to switch it out.
An off component becomes passive beam pipe at the same length: its active
power/RF/cooling/cryo/data demand drops to zero and it contributes no field,
acceleration, or measurement. Its vacuum vessel remains part of the beam path,
so bad vacuum can still scatter or lose the beam. Press Space again to restore
it.

**Soft** — these degrade but don't stop:

- Any network merely *over-subscribed* (demand > capacity). Power overload, RF overload, cooling shortfall, cryo warming, poor vacuum are all soft.
- An RF frequency bucket with no matching source (`rf_frequency_mismatch`) — that cavity gets zero power, but the beam keeps running.
- A data-fiber sink with no source. Unwired diagnostics cost money, not beam.

Data fiber is deliberately never a source gate. An unwired downstream sink is
still treated more harshly than an under-served one in that component's own
physics.

## Known Limitations

These are documented rather than papered over:

- **Labs no longer boost networks.** `LAB_NETWORK_MAP` and `findLabNetworkBonuses` were removed. Zone furnishing `zoneOutput` bonuses are still computed and stored on the game state, but nothing reads them — they have no effect on network quality or anything else.
- **Magnets have no graded response to cooling.** A `coolingDegradation` factor is computed in the physics layer and read by nothing. Missing cooling is reported but does not stop the source; the only live graded cooling effect is NC-cavity detuning.

## Viewing Network Quality

Click any utility cable or pipe to open the **Network Info Panel**. It shows:

- Capacity vs demand with a colored bar
- Utilization percentage
- The physical readout for that utility (pressure, bath temperature, peak RF power, delta-T)
- Connected equipment and beamline components
- Human-readable effect summary
