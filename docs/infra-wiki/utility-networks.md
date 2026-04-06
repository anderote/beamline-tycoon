# Utility Networks

## Quick Tip
Pipes and cables form isolated networks — equipment only serves components it's physically connected to.

## How It Works

Every facility system in Beamline Tycoon operates through **utility networks**: groups of equipment and components linked together by pipes or cables of the same type. A klystron connected by RF waveguide to three cavities forms one RF network. A second klystron with its own waveguide run to different cavities is a separate RF network. They don't share power, and they're validated independently.

This mirrors how real accelerator facilities work. You can't run cooling water to a magnet by placing a chiller on the other side of the building with no pipes between them. The chiller's capacity only serves components it's physically plumbed to.

### Network Formation

Networks form by **flood-fill** through connection tiles of the same type. Starting from any tile, every adjacent tile of the same connection type belongs to the same network. All facility equipment and beamline components touching tiles in that network are members of it.

There are six connection types, each forming its own independent networks:
- **Power Cable** (green) — carries electrical power
- **Vacuum Pipe** (gray) — carries pumping speed
- **RF Waveguide** (red) — carries RF power
- **Cooling Water** (blue) — carries cooling capacity
- **Cryo Transfer** (cyan) — carries cryogenic cooling
- **Data/Fiber** (white) — carries control signals and data

### Network Properties

Each network type computes different stats:

| Network Type | Key Stats |
|-------------|-----------|
| Power | Capacity (kW), draw (kW), utilization |
| Vacuum | Effective pump speed (L/s), pressure (mbar) |
| RF | Frequency (MHz), forward power (kW), reflected power |
| Cooling | Capacity (kW), heat load (kW), margin |
| Cryo | Capacity (W), heat load (W), operating temp (K) |
| Data/Fiber | Binary: connected or not |

### Hard Gates

Every network is validated when you try to run beam. If any network fails validation — insufficient capacity, missing connections, bad vacuum — beam cannot start. If a running beam's infrastructure is disrupted (you remove a substation, delete a pipe), beam shuts off immediately.

## The Math

Network discovery is a standard connected-components algorithm. For each connection type:

1. Find all tiles of that type that haven't been assigned to a network yet
2. Flood-fill from that tile to find all connected tiles
3. Identify all facility equipment and beamline components adjacent to tiles in this cluster
4. Compute network-specific stats from the equipment and component properties
5. Validate supply >= demand (for capacity-based networks)

The exception is vacuum, which uses conductance-based calculations instead of simple capacity sums. See [vacuum.md](vacuum.md) for the conductance model.
