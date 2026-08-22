# Connection Types

## Quick Tip
Eight types of pipes and cables connect facility equipment to the beamline. Each carries a different utility, and each is drawn port-to-port.

## Connection Types

### HV Feeder (black)
Carries high-voltage power from a transformer to main/local distribution. It is the upstream half of the radial electrical tree.

- **Color:** Black (0x141418)
- **Network type:** Capacity-based (kW supply vs live downstream demand, capped by each distribution device's rating)
- **Source equipment:** Pad-Mount, Facility, HV and Grid Intertie transformers; the Compact HV Distributor taps a continuing trunk into two protected outgoing feeders, while the HV Distributor Box taps it into four
- **Consumers:** Compact HV Distributor and HV Distributor Box through their two-wire roof taps; compact/section/main distribution panels, RF sources, and other dedicated HV loads remain terminal connections
- **Cost:** $1,200/sub-unit ($4,800/tile)

### Power Cable (green)
Carries low-voltage branch power from distribution panels to field distribution or active equipment. It never starts at a transformer.

- **Color:** Green (0x44cc44)
- **Network type:** Capacity-based (kW supply vs demand)
- **Source equipment:** Compact, Section and Main Distribution Panels
- **Consumers:** Nearly every beamline component, plus every piece of facility equipment with an energy cost
- **Cost:** $600/sub-unit ($2,400/tile)
- **Field distribution:** Beamline Busway ($70k, eight taps, 160 kW) and Spider Box (four interchangeable sockets, 30 kW). Connect a panel to any spider-box socket and use the remaining three for loads. Both add no capacity and cannot be chained.

### Vacuum Pipe (gray)
Connects staged vacuum pumps to the beamline. The network tracks gas inventory and volume through time, hands off from roughing to backed high-vacuum and UHV stages, and limits remote molecular pumps by tube conductance.

- **Color:** Gray (0x888888)
- **Network type:** Dynamic pressure, approaching `P_eq = Q/S_eff + P_ultimate`
- **Source equipment:** Roughing pump and four-pump cart; turbo pump; integrated vacuum cart and station; ion, NEG and Ti sublimation pumps
- **Consumers:** Every beamline component — each declares its own gas load, and the beam pipe itself is charged by length
- **Cost:** $1,400/sub-unit ($5,600/tile)
- **Distribution:** 1×4 Vacuum Manifold ($120k, four pump branches, 5-cell service radius) or 1×8 Vacuum Manifold ($260k, eight branches, 7-cell radius). Both combine real pump outlets and add no capacity.

For molecular-flow stages, the hookup uses `C = 12.1 d³/L` and `S_eff = SC/(S+C)`, so long narrow runs reduce delivered pumping speed. Beam-pipe length also adds chamber volume and outgassing. See [vacuum.md](vacuum.md).

### RF Waveguide (red)
Carries RF power from sources to accelerating cavities. Band-matched: a source drives any cavity whose frequency falls inside one of the bands it covers. But a single waveguide network carries only **one** frequency, so cavities cut for different frequencies need separate networks even when one source could feed both.

- **Color:** Red (0xcc4444)
- **Network type:** One frequency per network, fed by the sources covering its band
- **Source equipment:** Magnetron, 5 kW Wideband Driver Amplifier, 10 kW Low-Band Buncher Amplifier, TWT, SSA, SLAC 5045 Klystron, Pulsed Klystron, CW Klystron, IOT, Multi-beam Klystron, High-power SSA, Gyrotron
- **Consumers:** All RF cavities and structures, the RFQ, bunchers, and the ECR ion source
- **Cost:** $1,800/sub-unit ($7,200/tile)
- **Bus:** Waveguide Manifold, $160k, 6-cell service radius
- **Support equipment (flavour only — no mechanical effect):** Modulator, Circulator, High-power Coupler, LLRF Controller

### Cooling Water (blue/red)
Flexible equipment hose for ordinary cooled components. Every run is tagged as
cold supply or hot return and never passes directly through a wall; drawing
across one automatically installs the matching blue or red sleeve. Choose Cold
Water or Hot Water from the Water Line palette flyout; directly dragging a
colored port infers the same choice.

- **Color:** Blue cold supply / red hot return
- **Network type:** Capacity-based (kW cooling vs heat load), producing a temperature rise at each sink
- **Process-cooling equipment:** Package Chiller, LCW Skid, Dual-Circuit Chiller, Chiller
- **Distribution:** 2-Line and 4-Line Dual Water Distributors, plus the LCW Manifold with four cold and four hot branches (all add no capacity)
- **Consumers:** Magnets, normal-conducting RF structures, beam absorbers (target, beam stop), the detector, the electron gun and ion sources, and the He compressor
- **Cost:** $900/sub-unit ($3,600/tile)
- **LCW Manifold:** $80k; requires explicit hoses and rigid headers, with no implicit service radius
- **Support equipment:** Deionizer, Heat Exchanger, Water Load, Emergency Cooling

### Water Supply Pipe (blue/red)
Rigid fabricated bulk-water header, modeled like cryogenic transfer pipe. Cold
supply uses the blue 0.60 m lane; hot return uses the red 0.90 m lane.

- **Network type:** Capacity-based, with hot and cold circuits kept isolated
- **Cold source:** Central chiller rigid cold outlet
- **Hot rejection:** Fan-Coil Cooler, Dry Cooler Bank, Cooling Tower
- **Consumers:** High-flow equipment such as the 70 and 230 MeV cyclotrons, or flexible Water Lines through a distributor
- **Wall crossings:** 1x1 and 2x2 Water Pipe Penetrations
- **Supports:** Same 3 m support stations as cryo, RF, and vacuum, so independent runs can stack vertically

SRF cavities are **not** cooling-water consumers. Their thermal path is cryogenics.

### Cryo Transfer (cyan)
Carries cryogenic helium between cold boxes and SRF components. The network's output is a **bath temperature**, not an abstract capacity fraction.

- **Color:** Cyan (0x44aacc)
- **Network type:** Thermal — heat load vs plant capacity, resolved into a bath temperature
- **Plant chain:** Helium Recovery/Storage reservoir + 4K or 2K Cold Box chiller + powered Helium Compressor heat rejector. The compressor also needs a live cooling-water loop. A 2K Cold Box sets the network design temperature to 2.0 K.
- **Integrated source:** Cryocooler (90 W, 50 L sealed inventory) combines all three plant roles for a small starter network.
- **Consumers:** Half-Wave Resonator, Spoke Cavity, 9-cell Elliptical SRF, TESLA Cryomodule
- **Cost:** $160/sub-unit ($640/tile)
- **Bus:** Cryo Valve Box, $400k, 6-cell service radius
- **Networked process equipment:** LN2 Dewar + powered LN2 Pre-cooler, Cryomodule Housing, Recovery Header, Gas Bag, powered Purifier, and powered Liquefier

Every buildable cryogenic item exposes a visible cryo connector. Missing storage, chilling, heat rejection, electrical power, or compressor cooling fails closed instead of silently producing refrigeration.

### Data/Fiber (white)
Carries control signals and measurement data between diagnostics and the control system. It is a directionless shared fabric: every data port is a peer, and a device is connected when its bus reaches at least one other device.

- **Color:** White (0xeeeeee)
- **Network type:** Directionless bus with binary peer connectivity
- **Peer equipment:** Rack/IOC, Archiver, Timing System, BPM Electronics, BLM Readout, LLRF Controller, Patch Panel, diagnostics, endpoints, and control-room data hardware
- **Switching:** Powered Network Switch with eight interchangeable ports, available in both Control Room and Data & Controls palettes
- **Cost:** $300/sub-unit ($1,200/tile) — the cheapest run to pull
- **Bus:** Fiber Bus, $35k, 12-cell service radius; fiber runs may tee into the same shared network

Data fiber is the one utility that is **not hard-gated**. An unwired BPM costs you data income; it does not trip the beam.

## Network Formation

Networks are **not** flood-filled through tiles. Each connection is a drawn line between two named **ports**, and two ports belong to the same network if a line joins them, directly or transitively. Network membership is a union-find over port keys (`placeableId:portName`), which is why a component with several ports of different utilities belongs to several independent networks at once.

A component with more than one sink of the same utility can therefore be fed by two different networks; where that happens, the worst feed wins.

### Distribution Buses

Several utilities retain a **bus** — a distribution component that stands in for the per-component stub to every on-pipe sink within its service radius (measured in grid cells; one cell is 2 m). Cooling is deliberately physical: its LCW manifold uses eight real flexible connections and two real rigid headers.

A bus adds **no capacity**. It only changes how many lines you have to draw. Draw one line to a wired bus and every covered sink on the pipe counts as connected.

## Connection Placement

Lines are drawn from a source port to a sink port, and priced per sub-unit of drawn path (a sub-unit is a quarter tile). The rates above bind on both the run-wiring drag and the ordinary single-line draw — free single runs would make every bus in the catalogue a strictly worse buy.

Measured on the reference beamline: about $458k of wire against $3.25M of hardware — 14%, so wiring is a real budget line and never the dominant one.
