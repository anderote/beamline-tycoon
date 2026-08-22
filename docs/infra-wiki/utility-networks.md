# Utility Networks

## Quick Tip
Lines form isolated networks — equipment only serves the ports you actually connect it to.

## How It Works

Every facility system in Beamline Tycoon operates through **utility networks**: groups of equipment and components linked together by drawn lines of the same type. A klystron connected by RF waveguide to three cavities forms one RF network. A second klystron with its own waveguide run to different cavities is a separate RF network. They don't share power, and they're solved independently.

This mirrors how real accelerator facilities work. You can't run cooling water to a magnet by placing a chiller on the other side of the building with no pipes between them. The chiller's capacity only serves components it's physically plumbed to.

### Network Formation

Networks form by **union-find over ports**. Every utility connection is a drawn line between two named ports; a port's identity is `placeableId:portName`. Two ports are in the same network if and only if a line connects them, directly or transitively.

That means membership is about *ports*, not tiles and not components. A cryomodule has a power sink, a cryo sink, an RF sink and a vacuum sink, and each one belongs to a different network. If two networks of the same utility both feed the same component, the **worst** feed wins.

There are eight connection types, each forming its own independent networks:
- **HV Feeder** (black) — carries upstream electrical power
- **Power Cable** (green) — carries electrical power
- **Vacuum Pipe** (gray) — carries pumping speed
- **RF Waveguide** (red) — carries RF power
- **Cooling Water** (blue/red) — flexible cold supply or hot return branches
- **Water Supply Pipe** (blue/red) — rigid bulk cold supply or hot return
- **Cryo Transfer** (cyan) — carries cryogenic cooling
- **Data/Fiber** (white) — carries control signals and data

**Distribution buses** shortcut the wiring without changing the physics: a wired bus stands in for the individual stub to every on-pipe sink of its utility within its service radius. It adds no capacity.

### Network Properties

Each network type produces both a 0-1 quality scalar and a **physical quantity** that is what actually reaches the beam:

| Network Type | Key Stats | Physical output |
|-------------|-----------|-----------------|
| Power | Capacity (kW), draw (kW), utilization | quality scalar (linear on magnet strength) |
| Vacuum | Pump speed (L/s), gas load (mbar·L/s) | pressure (mbar) per sink |
| RF | Per-frequency buckets, forward power (kW), duty | peak power (W) per sink |
| Cooling | Capacity (kW), heat load (kW), margin | temperature rise (K) per sink |
| Water Supply Pipe | Capacity/rejection (kW), circuit | cold supply or hot-return service |
| Cryo | Capacity (W), static + dynamic load (W) | bath temperature (K) per sink |
| Data/Fiber | Directionless bus: at least two peer devices connected | binary quality scalar (scales data income) |

### Hard Gates

Five utilities are hard-required: **power, vacuum, RF, cooling, cryo**. A component that declares a sink for one of them and never wires it fails **closed** — the beam will not run, and that sink resolves to the worst possible value (0 W of RF, 300 K of helium, 1013 mbar of vacuum) rather than a permissive default. Ignoring infrastructure must never outscore wiring it badly.

Beyond unwired sinks, the hard trips include: a power network with sinks and no
capacity, a vacuum network with sinks and no pump, a cold-water circuit without
a chiller, a hot-water circuit without heat rejection, a cryo network in
quench, and no active operator in the Control Room.

Everything else — overload, frequency mismatch, poor vacuum, a warming cryo bath, a disconnected diagnostic — is **soft**. It degrades output without stopping the machine.

**Data fiber is deliberately not hard-gated.** An unwired BPM costs money rather than tripping the beam.

## The Math

For each utility type, per tick:

1. Collect every utility endpoint in the world — `state.placeables` **and** the components living inside beam pipes (cavities, quads, BPMs and cryomodules are pipe placements, not placeables)
2. Union-find over port keys joined by drawn lines; each connected component is a network, identified by a stable hash of its sorted port list
3. Expand distribution buses: a wired bus's covered sinks are treated as connected
4. Run that utility's solver over the network's sources and sinks
5. Publish `perSinkQuality` plus the utility's physical per-sink quantity
6. Aggregate onto each component (worst feed wins), then stamp fail-closed floors on any declared sink the solve produced nothing for

Persistent state (LHe volume, water reservoir volume, bath temperature) carries across ticks, which is what makes cryogenic warm-up a process the player watches happen rather than a value that snaps.
