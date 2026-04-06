# Data, Controls, and Safety

## Quick Tip
Diagnostics need data/fiber connections to IOCs. PPS interlocks are required to run beam. MPS protects your machine.

## How It Works

A particle accelerator isn't just magnets and cavities — it's a control system. Thousands of signals flow between equipment and the control room every second: magnet currents, vacuum pressures, beam positions, RF phases, temperatures. Without the control infrastructure, you're flying blind.

### Control System

**Rack/IOC (Input/Output Controller)** — the basic unit of the control system. Each rack runs EPICS (Experimental Physics and Industrial Control System) software and connects to nearby beamline instruments via data/fiber cables. A diagnostic without a data/fiber connection to an IOC produces zero data.

Place racks distributed along your facility. Each rack can serve multiple diagnostics, but they need to be physically connected via data/fiber tiles.

**Timing System** — distributes precise timing signals to the entire facility. RF cavities, kickers, pulsed sources, and diagnostics all need to fire at exactly the right moment. One timing system serves the whole machine. Required for pulsed devices like kickers and choppers.

### Safety Systems

**PPS (Personnel Protection System) Interlock** — the most critical safety system. Monitors access doors, search buttons, and key switches. Prevents beam operation when anyone could be in a radiation area. At least one PPS interlock must exist in your facility to enable beam. This is a global check — it doesn't need a specific connection to anything.

In real accelerators, PPS is the one system that can never fail. It's hardwired, redundant, and has authority to shut down the entire machine instantly. In gameplay, it's a simple gate: have one or don't run beam.

**MPS (Machine Protection System)** — monitors critical machine parameters and dumps the beam within microseconds if anything goes wrong. Protects against magnet quenches, vacuum breaks, and beam mis-steering. Connect via data/fiber to beam loss monitors along the beamline.

MPS is not a hard gate — you can run without it. But without MPS, component wear rate doubles. The beam keeps running through faults that should trigger an abort, grinding down your equipment.

**Radiation Monitor (Area Monitor)** — fixed detector that monitors ambient radiation levels around the facility. Required by regulations in a real facility, useful in gameplay for detecting unexpected beam losses.

**Shielding** — concrete and lead walls that contain radiation. At least one shielding unit required to run beam. More required proportional to beam power (1 per 50 kW of beamline energy cost). Insufficient shielding blocks beam operation.

### Data Flow

The data flow for diagnostics is straightforward:

```
Beam -> Diagnostic instrument -> Data/Fiber -> Rack/IOC -> Data output
```

If any link in this chain is broken, the diagnostic produces zero data. A BPM with no data/fiber connection is just a metal ring around the beam pipe — it measures nothing useful because the measurement can't reach the control system.

### Strategy

- Place Rack/IOCs every few sections along the beamline, with data/fiber runs to nearby diagnostics
- PPS interlock first — you literally cannot run beam without one
- MPS early — the wear penalty for running without it is severe
- Timing system once you have kickers or pulsed sources
- Shielding proportional to beam power — more power needs more shielding

## The Math

**Data rate from diagnostics:**
```
If connected to IOC via data/fiber:
    data_rate = component.dataRate * quality_factor
Else:
    data_rate = 0
```

**Shielding requirement:**
```
N_shielding_required = max(1, ceil(total_beamline_energyCost / 50))
```

**MPS wear penalty:**
```
If no MPS in facility:
    wear_rate = base_wear_rate * 2.0
Else:
    wear_rate = base_wear_rate
```

**PPS hard gate:** At least 1 PPS interlock must exist in facility equipment. No connection check — global presence only.
