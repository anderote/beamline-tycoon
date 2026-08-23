# Data, Controls, and Safety

## Quick Tip
Diagnostics need to share a connected data/fiber bus with another control or data device. Data is the one soft utility — an unwired detector costs money, not beam. An MPS halves component wear.

## How It Works

A particle accelerator isn't just magnets and cavities — it's a control system. Thousands of signals flow between equipment and the control room every second: magnet currents, vacuum pressures, beam positions, RF phases, temperatures. Without the control infrastructure, you're flying blind.

### Control System

**Rack/IOC (Input/Output Controller)** — the basic unit of the machine-control system. Each rack runs EPICS (Experimental Physics and Industrial Control System) software and joins nearby beamline instruments to the shared data/fiber fabric, but it does not capture experimental raw data by itself.

Data has no inlet, outlet, source, or bandwidth direction. Every connected port is a peer on one shared bus. A powered **Network Switch** exposes eight interchangeable sockets so a Control Room or Data & Controls area can join many devices to the same fabric. **Archivers**, **BPM Electronics**, **BLM Readouts**, **Timing Systems**, **LLRF Controllers**, **Patch Panels**, and **Rack/IOCs** are ordinary peers. Experimental endpoints must share that fabric with an **All-in-One Capture Rack**, **Compact Capture Appliance**, **High-Throughput DAQ Rack**, or **Data Processing Cluster** before their stream can enter the science pipeline.

Place peer devices throughout your facility, join dense groups through Network Switches, or run a Fiber Bus ($35k, 12-cell reach — the longest reach of any bus, and the cheapest).

**Timing System** — distributes precise timing signals to the entire facility. RF cavities, kickers, pulsed sources, and diagnostics all need to fire at exactly the right moment. In gameplay it is a data-bus peer with no additional enforcement.

### Safety Systems

**PPS (Personnel Protection System) Interlock** — the most critical safety system in a real facility. Monitors access doors, search buttons, and key switches. Prevents beam operation when anyone could be in a radiation area.

**MPS (Machine Protection System)** — monitors critical machine parameters and dumps the beam within microseconds if anything goes wrong. Protects against magnet quenches, vacuum breaks, and beam mis-steering.

MPS is not a hard gate — you can run without it. But **without an MPS anywhere in the facility, every beamline component wears at 2x the normal rate.** The beam keeps running through faults that should trigger an abort, grinding down your equipment. This is the one safety component with a live mechanical effect.

**Radiation Monitor (Area Monitor)** — fixed detector that monitors ambient radiation levels around the facility.

**Shielding** — concrete and lead walls that contain radiation.

> **Known limitation:** the PPS interlock, area monitor and shielding have **no gating effect**. There is no PPS presence check and no shielding-vs-beam-power requirement anywhere in the tick loop. You can run beam with none of them. They are placeable, billable, and currently inert. Only the MPS wear multiplier is live.
>
> The one live "human" gate is staffing: a beamline with no active operator in the Control Room trips (`beam_unstaffed`). Operators who are off-shift, assigned elsewhere, mid stress-breakdown, or currently eating/resting instead of seated at their console don't count — a cafeteria and rest area near the control room keep operators cycling back to their console faster, so build one.

### Data Flow

The data flow for diagnostics is:

```
Beam -> Endpoint -> Data/Fiber -> DAQ ingest -> Raw storage -> CPU/GPU -> Research data
```

Data connectivity is a **soft** binary derate, not a beam trip. The game averages the `dataQuality` of every data-producing endpoint on the beamline and scales its incoming stream by that average. Purpose-built materials, irradiation, isotope, therapy, neutron, photon, XFEL, EUV, and particle-physics endpoints all declare data connections. An isolated endpoint has data quality 0; an endpoint on a bus with at least one other device has data quality 1.

Connected data then needs four facility resources. **DAQ ingest** limits how much can enter per tick. **Raw storage** buffers work that cannot be processed immediately. **CPU racks** are best for controls, dosimetry, isotope accounting, and ordinary reconstruction. **GPU racks** are best for imaging, photon science, and high-rate detector events. A scientist working **Take Data** operates the processing pipeline; without one, raw data accumulates until storage fills. Data hardware can operate anywhere on a valid build surface. Give the cluster explicit power and connect at least one ingest-capable gateway to fiber; touching data cabinets share that gateway automatically. The preferred Control Room or Diagnostics Lab only grants the hardware's authored zone and research bonuses.

The **Compact Capture Appliance** and **All-in-One Capture Rack** are starter all-in-one packages. Larger facilities can add a **High-Throughput DAQ Rack**, **Data Processing Cluster**, standalone **Raw Data Buffers**, **CPU Compute Racks**, and **GPU Compute Racks** independently so the limiting stage can be expanded instead of buying another copy of everything. The process-variable **Archiver** supports monitoring and post-mortems; it is not detector-event storage and no longer expands the raw buffer.

Diagnostics like BPMs and wire scanners declare data sinks and must be wired for the same reason any sink must — but they contribute no data rate of their own, so leaving one unwired costs you nothing directly.

### Strategy

- Data fiber is the cheapest run in the game ($1,200/tile) and the Fiber Bus has the longest reach. Use eight-port switches to join multiple Control Room and Data & Controls devices to the same fabric.
- Start with an all-in-one appliance. Add standalone storage when the raw buffer stays full, CPU for service/controls workloads, and GPUs for imaging or detector workloads.
- Build the MPS early — 2x wear on everything is the single largest avoidable running cost in the game
- Data fiber is the only utility that will never trip your beam, so wire it last if you're short on cash — but wire it

## The Math

**Fiber delivery factor:**
```
network_quality = 1 if the connected bus contains at least two peer devices, else 0
connected_rate = raw_endpoint_rate x mean(endpoint dataQuality)
```
A declared-but-unwired data sink resolves to `dataQuality = 0`; a component that declares no data sink is not applicable and doesn't drag the average down. DAQ, free storage, the correct compute class, and scientist availability apply after this factor.

**Component wear (applied every 10 ticks):**
```
base_wear = 0.01 + energyCost x 0.002
wear_mult = 1 if any MPS exists in the facility, else 2
health   -= base_wear x wear_mult
```
Below 20% health, each wear tick has a 5% chance of outright failure.

Health now feeds the beam physics directly: active strength/output falls with
health, source damage reduces current and worsens emittance, and a downstream
component at 0% health becomes passive beam pipe. Hover any downstream
beamline component and press **Space** to switch it between active service and
the same passive-pipe state. Switched-off hardware does not accrue active wear.

**Staffing gate:** at least one operator with status `working`, actively seated and running the beam at a console. Fatigue and hunger level are not checked directly — an operator only drops out of coverage once a need is bad enough to pull them off the console onto an eat/rest job (or a stress breakdown). Without coverage, the source is held until an operator returns.

**Not implemented:** PPS presence check, shielding-per-kilowatt requirement, timing-system requirement for pulsed devices, circulator and modulator requirements.
