# Rooms

> **Quick Tip:** Walls define rooms. Room type is auto-detected from flooring, zones, and contents.

## How It Works

A **room** is any contiguous area of flooring enclosed by walls. The game detects rooms automatically whenever you place or remove walls, floors, or zones.

### Room Detection

Rooms are found by flood-filling from flooring tiles. Movement between tiles is blocked by walls but allowed through doors. Each connected region of floor tiles becomes a room.

### Room Types

Rooms are auto-classified based on their contents:

| Type | How Detected |
|------|-------------|
| **Beam Hall** | 80%+ concrete flooring, contains beamline components |
| **Machine Hall** | 80%+ concrete flooring, contains a machine (cyclotron, etc.) |
| **Empty Hall** | 80%+ concrete flooring, no beamline or machine yet |
| **RF Lab, Vacuum Lab, etc.** | Room contains tiles with that zone overlay painted |
| **Hallway** | Majority hallway flooring |
| **Control Room, Office, etc.** | Room contains tiles with that zone overlay |

Zone overlays take priority -- if you paint an RF Lab zone in a concrete room, it becomes an RF Lab, not a beam hall.

### Room Properties

Each room tracks:

- **Tiles** -- all floor tiles in the room
- **Boundary tiles** -- tiles adjacent to a wall (the room's perimeter)
- **Flooring breakdown** -- percentage of each floor type
- **Zone types** -- any zone overlays painted in the room

### Lab Connectivity

Labs influence nearby infrastructure through their room boundaries. A lab's **reach** extends 1 tile (cardinal directions) outside its walls. Any utility network tile in that reach connects the lab to that network.

This means:
- A lab sharing a wall with a beam hall reaches network tiles on the other side
- A lab across a 1-tile hallway does **not** reach through to the other side
- But if utility cables run through the hallway within 1 tile of the lab wall, the lab touches those cables and boosts the entire connected network

### Layout Tips

- Build labs adjacent to beam halls for maximum effect
- Keep hallways narrow (1 tile) and run utility cables through them
- A single well-equipped lab can boost multiple network clusters if cables from each pass within reach
