# Data, Controls, and Safety

## Quick Tip
Diagnostics need data/fiber connections to a data source. Data is the one soft utility — an unwired detector costs money, not beam. An MPS halves component wear.

## How It Works

A particle accelerator isn't just magnets and cavities — it's a control system. Thousands of signals flow between equipment and the control room every second: magnet currents, vacuum pressures, beam positions, RF phases, temperatures. Without the control infrastructure, you're flying blind.

### Control System

**Rack/IOC (Input/Output Controller)** — the basic unit of the control system. Each rack runs EPICS (Experimental Physics and Industrial Control System) software and feeds nearby beamline instruments via data/fiber. It supplies 10 Gbps to its network.

It is not the only data source: **Network Switch** (40 Gbps), **Archiver** (20), **BPM Electronics** (8), **BLM Readout** (8), **Timing System** (5), **LLRF Controller** (4), and **Patch Panel** (2) all act as sources. The solver's physics is binary connectivity — the network has a source or it doesn't — so the Gbps figures are display values, not a budget the solver enforces.

Place data sources distributed along your facility, or run a Fiber Bus ($35k, 12-cell reach — the longest reach of any bus, and the cheapest).

**Timing System** — distributes precise timing signals to the entire facility. RF cavities, kickers, pulsed sources, and diagnostics all need to fire at exactly the right moment. In gameplay it is a data source with no additional enforcement.

### Safety Systems

**PPS (Personnel Protection System) Interlock** — the most critical safety system in a real facility. Monitors access doors, search buttons, and key switches. Prevents beam operation when anyone could be in a radiation area.

**MPS (Machine Protection System)** — monitors critical machine parameters and dumps the beam within microseconds if anything goes wrong. Protects against magnet quenches, vacuum breaks, and beam mis-steering.

MPS is not a hard gate — you can run without it. But **without an MPS anywhere in the facility, every beamline component wears at 2x the normal rate.** The beam keeps running through faults that should trigger an abort, grinding down your equipment. This is the one safety component with a live mechanical effect.

**Radiation Monitor (Area Monitor)** — fixed detector that monitors ambient radiation levels around the facility.

**Shielding** — concrete and lead walls that contain radiation.

> **Known limitation:** the PPS interlock, area monitor and shielding have **no gating effect**. There is no PPS presence check and no shielding-vs-beam-power requirement anywhere in the tick loop. You can run beam with none of them. They are placeable, billable, and currently inert. Only the MPS wear multiplier is live.
>
> The one live "human" gate is staffing: a beamline with no active operator in the Control Room trips (`beam_unstaffed`). Operators who are on break, off-shift, assigned elsewhere or too fatigued don't count — build a cafeteria.

### Data Flow

The data flow for diagnostics is:

```
Beam -> Diagnostic instrument -> Data/Fiber -> data source -> Data income
```

Data connectivity is a **soft** derate, not an on/off switch. The game averages the `dataQuality` of every data-producing component on the beamline and scales the beamline's data income by that average. Only two components produce data: the **detector** (rate 1.0) and the **Faraday cup** (0.1). A detector wired to nothing has data quality 0 and earns nothing; a facility with two detectors, one wired, earns half.

Diagnostics like BPMs and wire scanners declare data sinks and must be wired for the same reason any sink must — but they contribute no data rate of their own, so leaving one unwired costs you nothing directly.

### Strategy

- Data fiber is the cheapest run in the game ($1,200/tile) and the Fiber Bus has the longest reach. There is no good reason to leave a detector unwired.
- Build the MPS early — 2x wear on everything is the single largest avoidable running cost in the game
- Data fiber is the only utility that will never trip your beam, so wire it last if you're short on cash — but wire it

## The Math

**Data income factor:**
```
factor = mean(dataQuality) over components with stats.dataRate > 0
data_income = base_data_rate x factor
```
A declared-but-unwired data sink resolves to `dataQuality = 0`; a component that declares no data sink is not applicable and doesn't drag the average down.

**Component wear (applied every 10 ticks):**
```
base_wear = 0.01 + energyCost x 0.002
wear_mult = 1 if any MPS exists in the facility, else 2
health   -= base_wear x wear_mult
```
Below 20% health, each wear tick has a 5% chance of outright failure.

**Staffing gate:** at least one operator with status `working`, assigned to the Control Room (or unassigned), fatigue below 0.85. Otherwise the beam trips.

**Not implemented:** PPS presence check, shielding-per-kilowatt requirement, timing-system requirement for pulsed devices, circulator and modulator requirements.
