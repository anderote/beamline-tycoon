# Rooms

> **Quick Tip:** Walls define rooms. Rooms carry staff morale from furnishings — they no longer boost utility networks.

## How It Works

A **room** is any contiguous area of flooring enclosed by walls. The game detects rooms by flood-filling from a tile, bounded by walls and passing through doors.

### Room Detection

Rooms are found by flood-filling from a starting tile. Movement between tiles is blocked by walls but allowed through doors. Each connected region of floor tiles becomes a room, capped at 500 tiles.

### Room Types

The classifier is auto-detected from flooring and zone overlays:

| Type | How Detected |
|------|-------------|
| **Beam Hall** | 80%+ concrete flooring, contains beamline components |
| **Machine Hall** | 80%+ concrete flooring, contains a machine |
| **Empty Hall** | 80%+ concrete flooring, no beamline or machine yet |
| **RF Lab, Vacuum Lab, etc.** | Room contains tiles with that zone overlay painted |
| **Hallway** | Majority hallway flooring |
| **Control Room, Office, etc.** | Room contains tiles with that zone overlay |

Zone overlays take priority — if you paint an RF Lab zone in a concrete room, it becomes an RF Lab, not a beam hall.

### What Rooms Actually Do

**Morale.** Furnishings with a `morale` effect apply to every staff member in the room they sit in. This is the live room mechanic, and it feeds the staffing gate: an unhappy or exhausted operator can't hold the beam on.

**Zone matching.** Equipment and furnishings can be placed and operated on any valid build surface. An item's preferred zone is a bonus condition, not an operating permit: its complete footprint must be inside that zone to contribute zone-output or research bonuses. A spectrum analyzer still works in a hallway, but only earns its authored bonus in an RF Lab.

**Control-room connections.** The Control Room palette includes Data Fiber and Power Cable. Powered consoles, displays, alarms, and data cabinets expose both connectors on their rear panels. Power remains an explicit cable connection; touching data cabinets share the same internal data backbone once fiber reaches one ingest-capable gateway.

### Known Limitations

Two room systems are built but inert:

- **Labs no longer boost utility networks.** The lab-to-network mapping (`LAB_NETWORK_MAP`, `findLabNetworkBonuses`) and the 1-tile lab reach were removed along with the legacy network layer. Furnishing `zoneOutput` bonuses are still summed per zone type and stored on the game state, but nothing reads them. A fully equipped RF Lab has no effect on any RF network.
- **Beam-physics furnishings are inert.** A few lab furnishings (Laser Alignment System, Beam Profiler) declare `beamPhysics` effects, and the game has a function to match them to beamlines sharing their room — but nothing calls it.

Build labs for the look, the morale, and the zone tiers. Don't build them expecting to compensate for an undersized klystron; that mechanic is gone. Fix the klystron.

### Layout Tips

- Put the Control Room where operators will actually stay in it — the staffing gate is the one room-adjacent mechanic that can stop your beam
- Furnish for morale, and build a cafeteria: operators on a break they can't finish trip the beam just as effectively as no operators at all
- Keep hallways narrow and run utility lines through them; utility routing is a cost question now, not a lab-reach question
