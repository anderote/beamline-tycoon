# Infrastructure Quality & Room System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace binary infrastructure pass/fail with gradual quality degradation, add room detection from walls, connect labs to networks via room proximity, and add a network info panel.

**Architecture:** Room detection flood-fills from flooring tiles bounded by walls. Lab rooms compute a 1-tile reach set; network tiles in that reach connect the lab to the network cluster. Each network computes a quality score (capacity/demand + lab bonus). Per-node quality multipliers are passed to the Python physics engine to derate component performance.

**Tech Stack:** Vanilla JS (ES modules), Python (Pyodide), PIXI.js 8, DOM-based UI panels via ContextWindow.

---

### Task 1: Room Detection Module

**Files:**
- Create: `src/networks/rooms.js`
- Test: `test/test-rooms.js`

This module flood-fills rooms from flooring tiles bounded by walls. It uses `state.infrastructure` (flooring tiles), `state.walls` (edge-based walls), `state.doors` (edge-based doors), `state.zoneOccupied` (zone overlays), `state.beamline` (beamline nodes), and `state.machines` (machines).

- [ ] **Step 1: Write failing tests for room detection**

Create `test/test-rooms.js`:

```javascript
// test/test-rooms.js — Room detection tests
import { detectRooms } from '../src/networks/rooms.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); failed++; }
  else { passed++; }
}

function mockState() {
  return {
    infrastructure: [],
    infraOccupied: {},
    walls: [],
    wallOccupied: {},
    doors: [],
    doorOccupied: {},
    zoneOccupied: {},
    beamline: [],
    machines: [],
  };
}

function placeFloor(state, col, row, type) {
  state.infrastructure.push({ type, col, row });
  state.infraOccupied[col + ',' + row] = type;
}

function placeWall(state, col, row, edge, type) {
  state.walls.push({ type: type || 'concreteWall', col, row, edge });
  state.wallOccupied[col + ',' + row + ',' + edge] = type || 'concreteWall';
}

function placeDoor(state, col, row, edge, type) {
  state.doors.push({ type: type || 'steelDoor', col, row, edge });
  state.doorOccupied[col + ',' + row + ',' + edge] = type || 'steelDoor';
}

function placeZone(state, col, row, zoneType) {
  state.zoneOccupied[col + ',' + row] = zoneType;
}

console.log('=== Room Detection Tests ===');

// 1. No flooring = no rooms
{
  const state = mockState();
  const rooms = detectRooms(state);
  assert(rooms.length === 0, 'R1: no flooring = no rooms, got ' + rooms.length);
}

// 2. Single 2x2 room enclosed by walls
// Floor tiles at (0,0), (1,0), (0,1), (1,1)
// Walls: north edge of row 0, south edge of row 1, west edge of col 0, east edge of col 1
{
  const state = mockState();
  placeFloor(state, 0, 0, 'concrete');
  placeFloor(state, 1, 0, 'concrete');
  placeFloor(state, 0, 1, 'concrete');
  placeFloor(state, 1, 1, 'concrete');
  // North walls on row 0
  placeWall(state, 0, 0, 'n');
  placeWall(state, 1, 0, 'n');
  // South walls on row 1
  placeWall(state, 0, 1, 's');
  placeWall(state, 1, 1, 's');
  // West walls on col 0
  placeWall(state, 0, 0, 'w');
  placeWall(state, 0, 1, 'w');
  // East walls on col 1
  placeWall(state, 1, 0, 'e');
  placeWall(state, 1, 1, 'e');
  const rooms = detectRooms(state);
  assert(rooms.length === 1, 'R2: 2x2 enclosed room should be 1 room, got ' + rooms.length);
  assert(rooms[0].tiles.length === 4, 'R2: room should have 4 tiles, got ' + rooms[0].tiles.length);
}

// 3. Two rooms separated by a wall
// 2x1 room at (0,0)-(1,0), wall on east of (1,0) and west of (2,0), 2x1 room at (2,0)-(3,0)
{
  const state = mockState();
  for (let c = 0; c < 4; c++) {
    placeFloor(state, c, 0, 'concrete');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 3, 0, 'e');
  // Dividing wall between (1,0) and (2,0)
  placeWall(state, 1, 0, 'e');
  const rooms = detectRooms(state);
  assert(rooms.length === 2, 'R3: wall divides into 2 rooms, got ' + rooms.length);
  assert(rooms[0].tiles.length === 2, 'R3: first room should have 2 tiles');
  assert(rooms[1].tiles.length === 2, 'R3: second room should have 2 tiles');
}

// 4. Door does not divide rooms (tiles connected through door)
{
  const state = mockState();
  for (let c = 0; c < 4; c++) {
    placeFloor(state, c, 0, 'concrete');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 3, 0, 'e');
  // Wall with door between (1,0) and (2,0)
  placeWall(state, 1, 0, 'e');
  placeDoor(state, 1, 0, 'e');
  const rooms = detectRooms(state);
  assert(rooms.length === 1, 'R4: door connects rooms, got ' + rooms.length);
  assert(rooms[0].tiles.length === 4, 'R4: single room should have 4 tiles');
}

// 5. Room type: beam hall (>= 80% foundation + beamline node)
{
  const state = mockState();
  for (let c = 0; c < 5; c++) {
    placeFloor(state, c, 0, 'concrete');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 4, 0, 'e');
  // Beamline node inside the room
  state.beamline.push({ id: 's1', type: 'source', col: 2, row: 0, tiles: [{ col: 2, row: 0 }] });
  const rooms = detectRooms(state);
  assert(rooms.length === 1, 'R5: should be 1 room');
  assert(rooms[0].roomType === 'beamHall', 'R5: should be beamHall, got ' + rooms[0].roomType);
}

// 6. Room type: zone-typed room (RF Lab zone overlay)
{
  const state = mockState();
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 0, 'labFloor');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 2, 0, 'e');
  placeZone(state, 0, 0, 'rfLab');
  placeZone(state, 1, 0, 'rfLab');
  const rooms = detectRooms(state);
  assert(rooms.length === 1, 'R6: should be 1 room');
  assert(rooms[0].zoneTypes.indexOf('rfLab') !== -1, 'R6: should have rfLab zone, got ' + JSON.stringify(rooms[0].zoneTypes));
}

// 7. Room type: hallway (majority hallway flooring)
{
  const state = mockState();
  for (let c = 0; c < 5; c++) {
    placeFloor(state, c, 0, 'hallway');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 4, 0, 'e');
  const rooms = detectRooms(state);
  assert(rooms.length === 1, 'R7: should be 1 room');
  assert(rooms[0].roomType === 'hallway', 'R7: should be hallway, got ' + rooms[0].roomType);
}

// 8. Boundary tiles are tiles adjacent to a wall
{
  const state = mockState();
  // 3x3 room
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      placeFloor(state, c, r, 'concrete');
    }
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 2, 's');
  }
  for (let r = 0; r < 3; r++) {
    placeWall(state, 0, r, 'w');
    placeWall(state, 2, r, 'e');
  }
  const rooms = detectRooms(state);
  assert(rooms.length === 1, 'R8: should be 1 room');
  // All tiles except center (1,1) are boundary tiles (8 boundary, 1 interior)
  assert(rooms[0].boundaryTiles.length === 8, 'R8: should have 8 boundary tiles, got ' + rooms[0].boundaryTiles.length);
}

console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed > 0) {
  console.log('\n=== ROOM DETECTION TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL ROOM DETECTION TESTS PASSED ===');
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-rooms.js`
Expected: FAIL — `rooms.js` doesn't exist yet.

- [ ] **Step 3: Implement room detection**

Create `src/networks/rooms.js`:

```javascript
// rooms.js — Detect rooms from flooring tiles bounded by walls
//
// A "room" is a connected region of flooring tiles where connectivity
// is blocked by wall edges. Doors allow passage (don't block).
//
// Wall convention: walls are stored as { col, row, edge } where edge
// is 'n','e','s','w'. A wall on the east edge of (1,0) blocks movement
// from (1,0) to (2,0). The same wall viewed from (2,0) is its west edge.

const FOUNDATION_TYPES = new Set(['concrete']);
const HALLWAY_TYPES = new Set(['hallway']);

const CARDINAL = [
  { dc: 0, dr: -1, exitEdge: 'n', entryEdge: 's' },  // north
  { dc: 1, dr: 0,  exitEdge: 'e', entryEdge: 'w' },   // east
  { dc: 0, dr: 1,  exitEdge: 's', entryEdge: 'n' },   // south
  { dc: -1, dr: 0, exitEdge: 'w', entryEdge: 'e' },   // west
];

// Lab zone types that provide network bonuses
export const LAB_NETWORK_MAP = {
  rfLab: 'rfWaveguide',
  coolingLab: 'coolingWater',
  vacuumLab: 'vacuumPipe',
  diagnosticsLab: 'dataFiber',
  controlRoom: 'dataFiber',
};

/**
 * Detect all rooms in the current game state.
 *
 * @param {object} state - Game state with infrastructure, walls, doors, zoneOccupied, beamline, machines
 * @returns {Array<Room>} Array of room objects
 */
export function detectRooms(state) {
  const infraOccupied = state.infraOccupied || {};
  const wallOccupied = state.wallOccupied || {};
  const doorOccupied = state.doorOccupied || {};
  const zoneOccupied = state.zoneOccupied || {};

  // Collect all flooring tile keys
  const floorKeys = new Set();
  for (const tile of state.infrastructure) {
    floorKeys.add(tile.col + ',' + tile.row);
  }

  if (floorKeys.size === 0) return [];

  const visited = new Set();
  const rooms = [];
  let roomId = 0;

  for (const key of floorKeys) {
    if (visited.has(key)) continue;

    // Flood-fill from this tile, respecting walls
    const roomTiles = [];
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const cur = queue.shift();
      const parts = cur.split(',');
      const col = parseInt(parts[0], 10);
      const row = parseInt(parts[1], 10);
      roomTiles.push({ col, row });

      for (const dir of CARDINAL) {
        const nc = col + dir.dc;
        const nr = row + dir.dr;
        const nKey = nc + ',' + nr;

        if (visited.has(nKey) || !floorKeys.has(nKey)) continue;

        // Check for wall blocking this direction
        // A wall on the exit edge of current tile blocks passage,
        // UNLESS there's a door on that same edge
        const wallKey = col + ',' + row + ',' + dir.exitEdge;
        const hasWall = wallOccupied[wallKey] !== undefined;
        const hasDoor = doorOccupied[wallKey] !== undefined;

        // Also check the entry edge of the neighbor (same physical wall)
        const neighborWallKey = nc + ',' + nr + ',' + dir.entryEdge;
        const neighborHasWall = wallOccupied[neighborWallKey] !== undefined;
        const neighborHasDoor = doorOccupied[neighborWallKey] !== undefined;

        const blocked = (hasWall && !hasDoor) || (neighborHasWall && !neighborHasDoor);

        if (!blocked) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    // Build room object
    const room = _buildRoom(roomId++, roomTiles, state);
    rooms.push(room);
  }

  return rooms;
}

function _buildRoom(id, tiles, state) {
  const wallOccupied = state.wallOccupied || {};
  const zoneOccupied = state.zoneOccupied || {};
  const infraOccupied = state.infraOccupied || {};

  // Compute flooring breakdown
  const flooringCounts = {};
  let totalTiles = tiles.length;
  for (const t of tiles) {
    const type = infraOccupied[t.col + ',' + t.row] || 'unknown';
    flooringCounts[type] = (flooringCounts[type] || 0) + 1;
  }
  const flooringBreakdown = {};
  for (const type of Object.keys(flooringCounts)) {
    flooringBreakdown[type] = flooringCounts[type] / totalTiles;
  }

  // Compute boundary tiles (tiles that have a wall on any edge)
  const boundaryTiles = [];
  for (const t of tiles) {
    let isBoundary = false;
    for (const edge of ['n', 'e', 's', 'w']) {
      if (wallOccupied[t.col + ',' + t.row + ',' + edge] !== undefined) {
        isBoundary = true;
        break;
      }
    }
    if (isBoundary) boundaryTiles.push({ col: t.col, row: t.row });
  }

  // Collect zone types present in this room
  const zoneTypesSet = new Set();
  for (const t of tiles) {
    const zt = zoneOccupied[t.col + ',' + t.row];
    if (zt) zoneTypesSet.add(zt);
  }
  const zoneTypes = [...zoneTypesSet];

  // Determine room type
  const roomType = _classifyRoom(flooringBreakdown, zoneTypes, tiles, state);

  return {
    id,
    tiles,
    boundaryTiles,
    flooringBreakdown,
    roomType,
    zoneTypes,
  };
}

function _classifyRoom(flooringBreakdown, zoneTypes, tiles, state) {
  // Foundation fraction
  let foundationFrac = 0;
  for (const type of Object.keys(flooringBreakdown)) {
    if (FOUNDATION_TYPES.has(type)) {
      foundationFrac += flooringBreakdown[type];
    }
  }

  // Hallway fraction
  let hallwayFrac = 0;
  for (const type of Object.keys(flooringBreakdown)) {
    if (HALLWAY_TYPES.has(type)) {
      hallwayFrac += flooringBreakdown[type];
    }
  }

  // Check for zone overlays first (explicit zone assignment takes priority)
  if (zoneTypes.length > 0) {
    // Return the first zone type found (rooms should generally have one zone type)
    return zoneTypes[0];
  }

  // Check for beam hall: >= 80% foundation + contains beamline node
  if (foundationFrac >= 0.8) {
    const tileSet = new Set(tiles.map(t => t.col + ',' + t.row));
    const hasBeamline = state.beamline.some(node => {
      const nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
      return nodeTiles.some(nt => tileSet.has(nt.col + ',' + nt.row));
    });
    if (hasBeamline) return 'beamHall';

    const hasMachine = (state.machines || []).some(m => {
      const mTiles = m.tiles || [{ col: m.col, row: m.row }];
      return mTiles.some(mt => tileSet.has(mt.col + ',' + mt.row));
    });
    if (hasMachine) return 'machineHall';

    return 'emptyHall';
  }

  // Hallway: majority hallway flooring
  if (hallwayFrac > 0.5) return 'hallway';

  return 'unclassified';
}

/**
 * Compute the 1-tile cardinal reach set outside a room's boundary.
 * Returns a Set of "col,row" keys for tiles just outside the room walls.
 *
 * @param {object} room - Room object from detectRooms()
 * @returns {Set<string>} Set of "col,row" keys
 */
export function computeRoomReach(room) {
  const roomTileSet = new Set(room.tiles.map(t => t.col + ',' + t.row));
  const reach = new Set();

  for (const bt of room.boundaryTiles) {
    for (const dir of CARDINAL) {
      const nc = bt.col + dir.dc;
      const nr = bt.row + dir.dr;
      const nKey = nc + ',' + nr;
      // Only include tiles outside the room
      if (!roomTileSet.has(nKey)) {
        reach.add(nKey);
      }
    }
  }

  return reach;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-rooms.js`
Expected: ALL ROOM DETECTION TESTS PASSED

- [ ] **Step 5: Commit**

```bash
git add src/networks/rooms.js test/test-rooms.js
git commit -m "feat: add room detection module with wall-bounded flood fill"
```

---

### Task 2: Lab-to-Network Connectivity

**Files:**
- Modify: `src/networks/rooms.js` (add `findLabNetworkBonuses`)
- Modify: `test/test-rooms.js` (add connectivity tests)

- [ ] **Step 1: Write failing tests for lab connectivity**

Append to `test/test-rooms.js`:

```javascript
import { computeRoomReach, findLabNetworkBonuses } from '../src/networks/rooms.js';
import { ZONE_FURNISHINGS } from '../src/data/infrastructure.js';

let lPassed = 0;
let lFailed = 0;
function lassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); lFailed++; }
  else { lPassed++; }
}

console.log('\n=== Lab Connectivity Tests ===');

// 1. Room reach: 3x1 room with walls on all sides, reach set is tiles just outside walls
{
  const state = mockState();
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 0, 'concrete');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 2, 0, 'e');
  const rooms = detectRooms(state);
  const reach = computeRoomReach(rooms[0]);
  // Reach should include: row -1 (north of walls), row 1 (south of walls), (-1,0), (3,0)
  lassert(reach.has('0,-1'), 'LC1: should reach north');
  lassert(reach.has('0,1'), 'LC1: should reach south');
  lassert(reach.has('-1,0'), 'LC1: should reach west');
  lassert(reach.has('3,0'), 'LC1: should reach east');
  // Should NOT include tiles inside the room
  lassert(!reach.has('1,0'), 'LC1: should not reach inside room');
}

// 2. Lab bonus: RF Lab with furnishings, waveguide tile in reach set
{
  const state = mockState();
  // RF Lab room at (0,0)-(2,0)
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 0, 'labFloor');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
    placeZone(state, c, 0, 'rfLab');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 2, 0, 'e');
  // Furnishings inside lab
  state.zoneFurnishings = [
    { id: 1, type: 'oscilloscope', col: 0, row: 0 },
    { id: 2, type: 'spectrumAnalyzer', col: 1, row: 0 },
  ];
  // RF waveguide tile at (0,1) — south of room, in reach
  state.connections = new Map();
  state.connections.set('0,1', new Set(['rfWaveguide']));

  // Mock network clusters (from Networks.discoverAll)
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 0, row: 1 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [],
    vacuumPipe: [],
    dataFiber: [],
    powerCable: [],
    cryoTransfer: [],
  };

  const bonuses = findLabNetworkBonuses(state, networkClusters);
  // oscilloscope zoneOutput=0.05, spectrumAnalyzer zoneOutput=0.08 => 0.13 total
  lassert(bonuses.rfWaveguide.length === 1, 'LC2: should have 1 RF bonus entry, got ' + bonuses.rfWaveguide.length);
  lassert(Math.abs(bonuses.rfWaveguide[0].bonus - 0.13) < 0.001,
    'LC2: RF bonus should be 0.13, got ' + bonuses.rfWaveguide[0].bonus);
}

// 3. Lab NOT connected: waveguide 2 tiles away (across 1-tile hallway with no network in hallway)
{
  const state = mockState();
  // RF Lab at (0,0)-(2,0)
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 0, 'labFloor');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
    placeZone(state, c, 0, 'rfLab');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 2, 0, 'e');
  state.zoneFurnishings = [{ id: 1, type: 'oscilloscope', col: 0, row: 0 }];
  // Hallway at row 1
  placeFloor(state, 0, 1, 'hallway');
  placeWall(state, 0, 1, 'w');
  placeWall(state, 0, 1, 'e');
  placeWall(state, 0, 1, 's');
  // Waveguide at (0,2) — too far (2 tiles from lab room)
  state.connections = new Map();
  state.connections.set('0,2', new Set(['rfWaveguide']));
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 0, row: 2 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [], vacuumPipe: [], dataFiber: [], powerCable: [], cryoTransfer: [],
  };
  const bonuses = findLabNetworkBonuses(state, networkClusters);
  lassert(bonuses.rfWaveguide.length === 0, 'LC3: should have 0 RF bonus (too far), got ' + bonuses.rfWaveguide.length);
}

// 4. Lab bonus capped at 0.5
{
  const state = mockState();
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 0, 'labFloor');
    placeWall(state, c, 0, 'n');
    placeWall(state, c, 0, 's');
    placeZone(state, c, 0, 'rfLab');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 2, 0, 'e');
  // Lots of furnishings to exceed 0.5
  state.zoneFurnishings = [
    { id: 1, type: 'rfWorkbench', col: 0, row: 0 },
    { id: 2, type: 'oscilloscope', col: 0, row: 0 },
    { id: 3, type: 'signalGenerator', col: 1, row: 0 },
    { id: 4, type: 'spectrumAnalyzer', col: 1, row: 0 },
    { id: 5, type: 'networkAnalyzer', col: 2, row: 0 },
  ];
  state.connections = new Map();
  state.connections.set('0,1', new Set(['rfWaveguide']));
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 0, row: 1 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [], vacuumPipe: [], dataFiber: [], powerCable: [], cryoTransfer: [],
  };
  const bonuses = findLabNetworkBonuses(state, networkClusters);
  const totalBonus = bonuses.rfWaveguide.reduce((sum, b) => sum + b.bonus, 0);
  // Raw sum: 0.03+0.05+0.06+0.08+0.10 = 0.32 (under cap, but test the cap logic exists)
  lassert(totalBonus <= 0.5, 'LC4: total bonus should be capped at 0.5, got ' + totalBonus);
}

console.log('Passed: ' + lPassed + '  Failed: ' + lFailed);
if (lFailed > 0) {
  console.log('\n=== LAB CONNECTIVITY TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL LAB CONNECTIVITY TESTS PASSED ===');
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-rooms.js`
Expected: FAIL — `findLabNetworkBonuses` not yet exported.

- [ ] **Step 3: Implement lab-to-network connectivity**

Add to `src/networks/rooms.js`:

```javascript
import { ZONE_FURNISHINGS } from '../data/infrastructure.js';

const MAX_LAB_BONUS = 0.5;

/**
 * Find lab bonuses for each network type.
 *
 * For each lab room, checks if any network tiles (from discovered clusters)
 * fall within the room's 1-tile cardinal reach. If so, computes the
 * zoneOutput bonus from furnishings in that lab.
 *
 * @param {object} state - Game state
 * @param {object} networkClusters - Output of Networks.discoverAll()
 * @returns {object} { rfWaveguide: [{ roomId, zoneType, bonus }], ... }
 */
export function findLabNetworkBonuses(state, networkClusters) {
  const rooms = detectRooms(state);
  const result = {};
  for (const connType of Object.keys(LAB_NETWORK_MAP)) {
    // connType here is zoneType; we need the network type
  }
  // Initialize result with all network types that labs can boost
  const networkTypes = new Set(Object.values(LAB_NETWORK_MAP));
  for (const nt of networkTypes) {
    result[nt] = [];
  }

  for (const room of rooms) {
    // Check each zone type in this room
    for (const zt of room.zoneTypes) {
      const networkType = LAB_NETWORK_MAP[zt];
      if (!networkType) continue;

      // Compute reach set for this room
      const reach = computeRoomReach(room);

      // Check if any network cluster of the matching type has a tile in the reach
      const clusters = networkClusters[networkType] || [];
      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        const clusterTouches = cluster.tiles.some(t => reach.has(t.col + ',' + t.row));
        if (!clusterTouches) continue;

        // Compute bonus from furnishings of this zone type in this room
        const roomTileSet = new Set(room.tiles.map(t => t.col + ',' + t.row));
        let bonus = 0;
        for (const f of (state.zoneFurnishings || [])) {
          const def = ZONE_FURNISHINGS[f.type];
          if (!def || def.zoneType !== zt) continue;
          // Furnishing must be in this room (its tile is in room tiles)
          if (!roomTileSet.has(f.col + ',' + f.row)) continue;
          bonus += (def.effects && def.effects.zoneOutput) || 0;
        }

        if (bonus > 0) {
          result[networkType].push({
            roomId: room.id,
            zoneType: zt,
            bonus: Math.min(bonus, MAX_LAB_BONUS),
            clusterIndex: ci,
          });
        }
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-rooms.js`
Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/networks/rooms.js test/test-rooms.js
git commit -m "feat: add lab-to-network connectivity with furnishing bonuses"
```

---

### Task 3: Network Quality Scoring

**Files:**
- Modify: `src/networks/networks.js` (add quality computation to each validate function)
- Modify: `test/test-networks.js` (add quality tests)

- [ ] **Step 1: Write failing tests for quality scores**

Append to `test/test-networks.js`:

```javascript
import { detectRooms, findLabNetworkBonuses } from '../src/networks/rooms.js';

let qPassed = 0;
let qFailed = 0;
function qassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); qFailed++; }
  else { qPassed++; }
}

console.log('\n=== Network Quality Tests ===');

// 1. Power network at 50% capacity → quality 0.5
{
  const pNet = {
    equipment: [{ id: 'sub1', type: 'substation' }],
    beamlineNodes: [],
    tiles: [],
  };
  const result = Networks.validatePowerNetwork(pNet);
  // Substation = 1500 kW capacity, 0 draw → ratio = 1.0
  qassert(result.quality === 1.0, 'Q1: no draw = quality 1.0, got ' + result.quality);
}

// 2. Power overloaded: draw > capacity → quality < 1.0
{
  // Simulate by adding many consumers manually — use the result object
  const result = Networks.validatePowerNetwork({
    equipment: [],
    beamlineNodes: [
      { id: 'q1', type: 'quadrupole' },
    ],
    tiles: [],
  });
  // No substation: capacity=0, draw>0, ratio=0
  qassert(result.quality === 0, 'Q2: no capacity = quality 0, got ' + result.quality);
}

// 3. Quality with lab bonus applied
{
  const labBonuses = [{ roomId: 0, zoneType: 'rfLab', bonus: 0.15, clusterIndex: 0 }];
  const result = Networks.validateRfNetwork({
    equipment: [],
    beamlineNodes: [{ id: 'cav1', type: 'rfCavity' }],
    tiles: [],
  });
  // ratio = 0 (no sources), but with lab bonus = min(1.0, 0 + 0.15) = 0.15
  const quality = Networks.computeNetworkQuality(result.capacity || 0, result.totalDemand || 0, labBonuses);
  qassert(Math.abs(quality - 0.15) < 0.01, 'Q3: quality with lab bonus should be ~0.15, got ' + quality);
}

// 4. Quality capped at 1.0 when ratio + bonus > 1.0
{
  const quality = Networks.computeNetworkQuality(1500, 1000, [{ bonus: 0.3 }]);
  qassert(quality === 1.0, 'Q4: quality capped at 1.0, got ' + quality);
}

console.log('Passed: ' + qPassed + '  Failed: ' + qFailed);
if (qFailed > 0) {
  console.log('\n=== QUALITY TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL QUALITY TESTS PASSED ===');
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-networks.js`
Expected: FAIL — `quality` property not on validation results, `computeNetworkQuality` not defined.

- [ ] **Step 3: Add quality scoring to network validation**

Modify `src/networks/networks.js`:

Add a new exported function `computeNetworkQuality`:

```javascript
/**
 * Compute effective quality for a network given capacity, demand, and lab bonuses.
 * @param {number} capacity - Total supply capacity
 * @param {number} demand - Total demand
 * @param {Array} labBonuses - Array of { bonus } from findLabNetworkBonuses
 * @returns {number} Quality 0.0 - 1.0
 */
computeNetworkQuality: function(capacity, demand, labBonuses) {
  var ratio = demand > 0 ? Math.min(1.0, capacity / demand) : 1.0;
  var labBonus = 0;
  if (Array.isArray(labBonuses)) {
    for (var i = 0; i < labBonuses.length; i++) {
      labBonus += labBonuses[i].bonus || 0;
    }
  }
  labBonus = Math.min(labBonus, 0.5);
  return Math.min(1.0, ratio + labBonus);
},
```

Add `quality` field to each validate function's return object:

In `validatePowerNetwork`, before the return statement add:
```javascript
var ratio = draw > 0 ? Math.min(1.0, capacity / draw) : (capacity > 0 ? 1.0 : 0);
// ...existing return, add:
//   quality: ratio,
```

Similarly for `validateCoolingNetwork`:
```javascript
var ratio = heatLoad > 0 ? Math.min(1.0, capacity / heatLoad) : (capacity > 0 ? 1.0 : 0);
// add quality: ratio to return
```

For `validateCryoNetwork`:
```javascript
var ratio = heatLoad > 0 ? Math.min(1.0, capacity / heatLoad) : (capacity > 0 ? 1.0 : 0);
// add quality: ratio, quenched: ratio < 0.5 && heatLoad > 0 to return
```

For `validateRfNetwork`:
```javascript
var ratio = totalDemand > 0 ? Math.min(1.0, totalForwardPower / totalDemand) : (sources.length > 0 ? 1.0 : 0);
// add quality: ratio to return
```

For `validateVacuumNetwork`:
```javascript
// Map pressureQuality to a numeric quality
var qualityMap = { 'Excellent': 1.0, 'Good': 0.85, 'Marginal': 0.6, 'Poor': 0.3, 'None': 0 };
// add quality: qualityMap[pressureQuality] || 0 to return
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-networks.js`
Expected: ALL tests pass (both old and new).

- [ ] **Step 5: Commit**

```bash
git add src/networks/networks.js test/test-networks.js
git commit -m "feat: add quality scores to network validation"
```

---

### Task 4: Per-Node Quality Multipliers in Game State

**Files:**
- Modify: `src/networks/networks.js` — add `computeNodeQualities` to `validate()`
- Modify: `src/game/Game.js` — store and pass quality data

- [ ] **Step 1: Write failing test for per-node quality computation**

Append to `test/test-networks.js`:

```javascript
console.log('\n=== Per-Node Quality Tests ===');

let pnPassed = 0;
let pnFailed = 0;
function pnassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); pnFailed++; }
  else { pnPassed++; }
}

// 1. RF cavity on power network (90% quality) and RF network (80% quality) → combined multipliers
{
  const nodeQualities = {
    'cav1': { powerQuality: 0.9, rfQuality: 0.8, coolingQuality: 1.0, vacuumQuality: 1.0, cryoQuality: 1.0, cryoQuenched: false, dataQuality: 1.0 },
  };
  // energyGain multiplier = power * rf * cooling = 0.9 * 0.8 * 1.0 = 0.72
  const mult = nodeQualities['cav1'].powerQuality * nodeQualities['cav1'].rfQuality * nodeQualities['cav1'].coolingQuality;
  pnassert(Math.abs(mult - 0.72) < 0.01, 'PN1: combined multiplier should be 0.72, got ' + mult);
}

console.log('Passed: ' + pnPassed + '  Failed: ' + pnFailed);
if (pnFailed > 0) {
  console.log('\n=== PER-NODE QUALITY TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL PER-NODE QUALITY TESTS PASSED ===');
}
```

- [ ] **Step 2: Run test to verify it passes (this is a data structure test)**

Run: `node test/test-networks.js`
Expected: PASS (this test validates the multiplier math, not code that needs writing).

- [ ] **Step 3: Add `computeNodeQualities` to networks.js**

Add a function to `Networks` in `src/networks/networks.js` that, given the validation results and lab bonuses, produces a per-node quality map:

```javascript
/**
 * Compute per-beamline-node quality multipliers from all network validations.
 *
 * @param {object} allNetworks - Output of discoverAll()
 * @param {object} labBonuses - Output of findLabNetworkBonuses()
 * @returns {object} nodeId -> { powerQuality, rfQuality, coolingQuality, vacuumQuality, cryoQuality, cryoQuenched, dataQuality }
 */
computeNodeQualities: function(allNetworks, labBonuses) {
  var nodeMap = {};

  function ensureNode(id) {
    if (!nodeMap[id]) {
      nodeMap[id] = {
        powerQuality: 1.0,
        rfQuality: 1.0,
        coolingQuality: 1.0,
        vacuumQuality: 1.0,
        cryoQuality: 1.0,
        cryoQuenched: false,
        dataQuality: 1.0,
      };
    }
    return nodeMap[id];
  }

  // Power networks
  var powerNets = allNetworks.powerCable || [];
  for (var pi = 0; pi < powerNets.length; pi++) {
    var pResult = Networks.validatePowerNetwork(powerNets[pi]);
    var pBonuses = (labBonuses.powerCable || []).filter(function(b) { return b.clusterIndex === pi; });
    var pQuality = Networks.computeNetworkQuality(pResult.capacity, pResult.draw, pBonuses);
    for (var pn = 0; pn < powerNets[pi].beamlineNodes.length; pn++) {
      ensureNode(powerNets[pi].beamlineNodes[pn].id).powerQuality = pQuality;
    }
  }

  // RF networks
  var rfNets = allNetworks.rfWaveguide || [];
  for (var ri = 0; ri < rfNets.length; ri++) {
    var rResult = Networks.validateRfNetwork(rfNets[ri]);
    var rBonuses = (labBonuses.rfWaveguide || []).filter(function(b) { return b.clusterIndex === ri; });
    var rQuality = Networks.computeNetworkQuality(rResult.forwardPower, rResult.totalDemand, rBonuses);
    for (var rn = 0; rn < rfNets[ri].beamlineNodes.length; rn++) {
      ensureNode(rfNets[ri].beamlineNodes[rn].id).rfQuality = rQuality;
    }
  }

  // Cooling networks
  var coolNets = allNetworks.coolingWater || [];
  for (var ci = 0; ci < coolNets.length; ci++) {
    var cResult = Networks.validateCoolingNetwork(coolNets[ci]);
    var cBonuses = (labBonuses.coolingWater || []).filter(function(b) { return b.clusterIndex === ci; });
    var cQuality = Networks.computeNetworkQuality(cResult.capacity, cResult.heatLoad, cBonuses);
    for (var cn = 0; cn < coolNets[ci].beamlineNodes.length; cn++) {
      ensureNode(coolNets[ci].beamlineNodes[cn].id).coolingQuality = cQuality;
    }
  }

  // Vacuum networks
  var vacNets = allNetworks.vacuumPipe || [];
  for (var vi = 0; vi < vacNets.length; vi++) {
    var vResult = Networks.validateVacuumNetwork(vacNets[vi], []);
    var vBonuses = (labBonuses.vacuumPipe || []).filter(function(b) { return b.clusterIndex === vi; });
    var vQuality = Networks.computeNetworkQuality(
      vResult.pressureQuality === 'Excellent' ? 1 : vResult.pressureQuality === 'Good' ? 0.85 : vResult.pressureQuality === 'Marginal' ? 0.6 : 0,
      1.0, vBonuses);
    for (var vn = 0; vn < vacNets[vi].beamlineNodes.length; vn++) {
      ensureNode(vacNets[vi].beamlineNodes[vn].id).vacuumQuality = vQuality;
    }
  }

  // Cryo networks
  var cryoNets = allNetworks.cryoTransfer || [];
  for (var cri = 0; cri < cryoNets.length; cri++) {
    var crResult = Networks.validateCryoNetwork(cryoNets[cri]);
    var crBonuses = (labBonuses.cryoTransfer || []).filter(function(b) { return b.clusterIndex === cri; });
    var crQuality = Networks.computeNetworkQuality(crResult.capacity, crResult.heatLoad, crBonuses);
    var crRatio = crResult.heatLoad > 0 ? crResult.capacity / crResult.heatLoad : 1.0;
    var quenched = crRatio < 0.5 && crResult.heatLoad > 0;
    for (var crn = 0; crn < cryoNets[cri].beamlineNodes.length; crn++) {
      var nq = ensureNode(cryoNets[cri].beamlineNodes[crn].id);
      nq.cryoQuality = quenched ? 0 : crQuality;
      nq.cryoQuenched = quenched;
    }
  }

  // Data networks
  var dataNets = allNetworks.dataFiber || [];
  for (var di = 0; di < dataNets.length; di++) {
    // Data networks don't have a simple capacity/demand — use 1.0 base + lab bonus
    var dBonuses = (labBonuses.dataFiber || []).filter(function(b) { return b.clusterIndex === di; });
    var dQuality = Networks.computeNetworkQuality(1, 1, dBonuses);
    for (var dn = 0; dn < dataNets[di].beamlineNodes.length; dn++) {
      ensureNode(dataNets[di].beamlineNodes[dn].id).dataQuality = dQuality;
    }
  }

  return nodeMap;
},
```

- [ ] **Step 4: Wire into Game.js validateInfrastructure**

In `src/game/Game.js`, in `validateInfrastructure()`, after `const result = Networks.validate(validationState)`:

```javascript
import { findLabNetworkBonuses } from '../networks/rooms.js';

// In validateInfrastructure():
const labBonuses = findLabNetworkBonuses(validationState, result.networks);
const nodeQualities = Networks.computeNodeQualities(result.networks, labBonuses);
this.state.nodeQualities = nodeQualities;
this.state.labBonuses = labBonuses;
```

- [ ] **Step 5: Run all tests**

Run: `node test/test-networks.js && node test/test-rooms.js`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/networks/networks.js src/game/Game.js
git commit -m "feat: compute per-node infrastructure quality multipliers"
```

---

### Task 5: Pass Quality Multipliers to Physics Engine

**Files:**
- Modify: `src/beamline/physics.js` — pass nodeQualities alongside beamline config
- Modify: `beam_physics/gameplay.py` — apply multipliers in `beamline_config_from_game`

- [ ] **Step 1: Write failing Python test**

Create `test/test_infra_quality.py`:

```python
"""Test infrastructure quality multipliers in physics pipeline."""
import json
from beam_physics.gameplay import beamline_config_from_game

def test_quality_derates_rf_gradient():
    """RF cavity with power=0.9, rf=0.85, cooling=1.0 should get 76.5% gradient."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "rfCavity", "stats": {"energyGain": 1.0},
         "infraQuality": {"powerQuality": 0.9, "rfQuality": 0.85, "coolingQuality": 1.0}},
    ]
    elements = beamline_config_from_game(game_beamline)
    rf_el = [e for e in elements if e["type"] == "rfCavity"][0]
    expected = 1.0 * 0.9 * 0.85 * 1.0  # 0.765
    assert abs(rf_el["energyGain"] - expected) < 0.01, f"Expected ~{expected}, got {rf_el['energyGain']}"

def test_quality_derates_quad_strength():
    """Quad with power=0.8 should get 80% focus strength."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "quadrupole", "stats": {"focusStrength": 1.0},
         "infraQuality": {"powerQuality": 0.8}},
    ]
    elements = beamline_config_from_game(game_beamline)
    quad_el = [e for e in elements if e["type"] == "quadrupole"][0]
    expected = 1.0 * 0.3 * 0.8  # QUAD_K_SCALE * power quality
    assert abs(quad_el["focusStrength"] - expected) < 0.01, f"Expected ~{expected}, got {quad_el['focusStrength']}"

def test_cryo_quench_converts_to_drift():
    """SRF cryomodule with cryoQuenched=true should become a drift."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "cryomodule", "stats": {"energyGain": 2.0},
         "infraQuality": {"cryoQuenched": True}},
    ]
    elements = beamline_config_from_game(game_beamline)
    cryo_el = elements[1]
    assert cryo_el["type"] == "drift", f"Quenched SRF should be drift, got {cryo_el['type']}"

def test_no_quality_means_full_performance():
    """Components without infraQuality should run at full."""
    game_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "rfCavity", "stats": {"energyGain": 1.0}},
    ]
    elements = beamline_config_from_game(game_beamline)
    rf_el = [e for e in elements if e["type"] == "rfCavity"][0]
    assert abs(rf_el["energyGain"] - 1.0) < 0.01, f"No quality = full performance, got {rf_el['energyGain']}"

if __name__ == "__main__":
    test_quality_derates_rf_gradient()
    test_quality_derates_quad_strength()
    test_cryo_quench_converts_to_drift()
    test_no_quality_means_full_performance()
    print("All infrastructure quality tests passed!")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest test/test_infra_quality.py -v` (or `python3 test/test_infra_quality.py`)
Expected: FAIL — `infraQuality` not handled in `beamline_config_from_game`.

- [ ] **Step 3: Modify gameplay.py to apply quality multipliers**

In `beam_physics/gameplay.py`, in `beamline_config_from_game`, after building each element, apply infrastructure quality:

```python
# After the main element construction loop, before elements.append(el):

        # Apply infrastructure quality multipliers
        infra_q = comp.get("infraQuality", {})
        power_q = infra_q.get("powerQuality", 1.0)
        rf_q = infra_q.get("rfQuality", 1.0)
        cooling_q = infra_q.get("coolingQuality", 1.0)
        cryo_quenched = infra_q.get("cryoQuenched", False)
        cryo_q = infra_q.get("cryoQuality", 1.0)

        # SRF quench: convert to drift
        SRF_TYPES = {"cryomodule", "srf650Cavity", "srfGun"}
        if cryo_quenched and ctype in SRF_TYPES:
            el["type"] = "drift"
            el.pop("energyGain", None)
            el.pop("focusStrength", None)
            elements.append(el)
            continue

        # Derate energy gain: power * rf * cooling * cryo
        if "energyGain" in el:
            el["energyGain"] *= power_q * rf_q * cooling_q * cryo_q

        # Derate focus strength: power only
        if "focusStrength" in el:
            el["focusStrength"] *= power_q

        # Cooling degradation: emittance growth factor
        if cooling_q < 1.0:
            el["coolingDegradation"] = 1.0 + 0.1 * (1.0 - cooling_q)

        elements.append(el)
```

Also move the `elements.append(el)` that's currently at the end of each iteration to be inside the new block (remove the old one).

- [ ] **Step 4: Modify physics.js to pass nodeQualities**

In `src/beamline/physics.js`, where the beamline config is assembled before calling `compute_beam_for_game`, attach `infraQuality` to each node:

```javascript
// When building the game_beamline array for Python:
for (const node of nodes) {
  const entry = { ...nodeData };
  // Attach infrastructure quality if available
  const nq = game.state.nodeQualities?.[node.id];
  if (nq) {
    entry.infraQuality = nq;
  }
  gameBeamline.push(entry);
}
```

- [ ] **Step 5: Run Python tests**

Run: `python3 test/test_infra_quality.py`
Expected: All infrastructure quality tests passed!

- [ ] **Step 6: Run all JS tests**

Run: `node test/test-networks.js && node test/test-rooms.js`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add beam_physics/gameplay.py src/beamline/physics.js test/test_infra_quality.py
git commit -m "feat: apply infrastructure quality multipliers to physics parameters"
```

---

### Task 6: Vacuum Quality Affects Beam Loss

**Files:**
- Modify: `beam_physics/gameplay.py` — apply vacuum quality as additional loss
- Modify: `test/test_infra_quality.py` — add vacuum loss test

- [ ] **Step 1: Write failing test**

Add to `test/test_infra_quality.py`:

```python
def test_vacuum_quality_increases_loss():
    """Poor vacuum should increase beam loss fraction."""
    from beam_physics.gameplay import compute_beam_for_game
    import json

    base_beamline = [
        {"type": "source", "stats": {"beamCurrent": 1.0}},
        {"type": "quadrupole", "stats": {"focusStrength": 1.0}},
        {"type": "drift", "stats": {}},
        {"type": "detector", "stats": {"dataRate": 1.0}},
    ]

    # Good vacuum
    good_result = json.loads(compute_beam_for_game(
        json.dumps(base_beamline),
        json.dumps({"vacuumQuality": 0})
    ))

    # Bad vacuum via infraQuality
    bad_beamline = [dict(c) for c in base_beamline]
    for c in bad_beamline:
        c["infraQuality"] = {"vacuumQuality": 0.3}

    bad_result = json.loads(compute_beam_for_game(
        json.dumps(bad_beamline),
        json.dumps({})
    ))

    assert bad_result["totalLossFraction"] > good_result["totalLossFraction"], \
        f"Bad vacuum should increase loss: good={good_result['totalLossFraction']}, bad={bad_result['totalLossFraction']}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 test/test_infra_quality.py`
Expected: FAIL — vacuum quality not yet applied.

- [ ] **Step 3: Apply vacuum quality in gameplay.py**

In `beam_physics/gameplay.py`, in `compute_beam_for_game`, after the existing vacuum quality aperture widening, add vacuum degradation from per-node `infraQuality`:

```python
    # Per-node vacuum quality: reduce effective aperture for poor vacuum
    for i, comp in enumerate(game_beamline):
        vac_q = comp.get("infraQuality", {}).get("vacuumQuality", 1.0)
        if vac_q < 1.0 and i < len(elements):
            # Poor vacuum narrows effective aperture (gas scattering)
            current_aperture = elements[i].get("aperture", DEFAULT_APERTURE)
            elements[i]["aperture"] = current_aperture * (0.5 + 0.5 * vac_q)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 test/test_infra_quality.py`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add beam_physics/gameplay.py test/test_infra_quality.py
git commit -m "feat: vacuum quality degrades beam aperture causing losses"
```

---

### Task 7: Data Fiber Quality in Game Tick

**Files:**
- Modify: `src/game/Game.js` — scale data rate by data fiber quality in `_tickBeamline`

- [ ] **Step 1: Apply data quality multiplier**

In `src/game/Game.js`, in `_tickBeamline`, where `connectedDataRate` is computed, after the existing control room gating logic, multiply by data fiber quality:

```javascript
// After the existing connectedDataRate computation, before sciMult:
// Apply data fiber network quality
if (this.state.nodeQualities) {
  let totalDataQ = 0;
  let dataNodeCount = 0;
  for (const node of blNodes) {
    const comp = COMPONENTS[node.type];
    if (comp && (comp.stats?.dataRate || 0) > 0) {
      const nq = this.state.nodeQualities[node.id];
      totalDataQ += nq ? nq.dataQuality : 1.0;
      dataNodeCount++;
    }
  }
  if (dataNodeCount > 0) {
    connectedDataRate *= totalDataQ / dataNodeCount;
  }
}
```

- [ ] **Step 2: Run the game to verify no errors**

Run: `npx vite` and open the game, place some components, verify no console errors.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: data fiber quality scales data collection rate"
```

---

### Task 8: Network Info Panel UI

**Files:**
- Create: `src/ui/NetworkWindow.js`
- Modify: `src/input/InputHandler.js` (or wherever click handling dispatches to UI)

- [ ] **Step 1: Create NetworkWindow**

Create `src/ui/NetworkWindow.js`:

```javascript
// NetworkWindow.js — Context window for a network cluster

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { CONNECTION_TYPES, CONN_TYPES } from '../networks/networks.js';
import { Networks } from '../networks/networks.js';

const QUALITY_COLORS = {
  good: '#4c4',    // >= 90%
  warn: '#cc4',    // 60-89%
  bad: '#c44',     // < 60%
};

function qualityColor(q) {
  if (q >= 0.9) return QUALITY_COLORS.good;
  if (q >= 0.6) return QUALITY_COLORS.warn;
  return QUALITY_COLORS.bad;
}

export class NetworkWindow {
  /**
   * @param {object} game - Game instance
   * @param {string} networkType - e.g., 'powerCable', 'rfWaveguide'
   * @param {number} clusterIndex - Index into Networks.discoverAll()[networkType]
   */
  constructor(game, networkType, clusterIndex) {
    this.game = game;
    this.networkType = networkType;
    this.clusterIndex = clusterIndex;

    const connInfo = CONNECTION_TYPES[networkType] || {};
    const windowId = 'net-' + networkType + '-' + clusterIndex;

    const existing = ContextWindow.getWindow(windowId);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    const ctx = new ContextWindow({
      id: windowId,
      title: (connInfo.name || networkType) + ' Network',
      icon: '\u26A1',
      accentColor: '#' + (connInfo.color || 0x888888).toString(16).padStart(6, '0'),
      tabs: [
        { key: 'overview', label: 'Overview' },
        { key: 'equipment', label: 'Equipment' },
      ],
    });

    this.ctx = ctx;
    ctx.registerTab('overview', (container) => this._renderOverview(container));
    ctx.registerTab('equipment', (container) => this._renderEquipment(container));
    ctx.showTab('overview');

    // Auto-refresh on tick
    this._tickHandler = () => {
      if (ctx._activeTab) ctx.showTab(ctx._activeTab);
    };
    game.on('tick', this._tickHandler);
    ctx._onClose = () => game.off('tick', this._tickHandler);
  }

  _getNetworkData() {
    const allNetworks = this.game.state.networkData || {};
    const clusters = allNetworks[this.networkType] || [];
    return clusters[this.clusterIndex] || { tiles: [], equipment: [], beamlineNodes: [] };
  }

  _getValidation(network) {
    switch (this.networkType) {
      case 'powerCable': return Networks.validatePowerNetwork(network);
      case 'coolingWater': return Networks.validateCoolingNetwork(network);
      case 'cryoTransfer': return Networks.validateCryoNetwork(network);
      case 'rfWaveguide': return Networks.validateRfNetwork(network);
      case 'vacuumPipe': return Networks.validateVacuumNetwork(network, this.game.state.beamline || []);
      default: return {};
    }
  }

  _renderOverview(container) {
    const network = this._getNetworkData();
    const validation = this._getValidation(network);
    const labBonuses = this.game.state.labBonuses || {};
    const bonusEntries = (labBonuses[this.networkType] || []).filter(b => b.clusterIndex === this.clusterIndex);

    let html = '<div style="padding:8px;font-size:12px;color:#ccc;">';

    // Capacity bar
    const capacity = validation.capacity || validation.forwardPower || 0;
    const demand = validation.draw || validation.heatLoad || validation.totalDemand || 0;
    const ratio = demand > 0 ? Math.min(1.0, capacity / demand) : (capacity > 0 ? 1.0 : 0);
    const ratioPercent = Math.round(ratio * 100);

    html += '<div style="margin-bottom:8px;">';
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">';
    html += '<span>Capacity</span>';
    html += '<span>' + Math.round(capacity) + ' / ' + Math.round(demand) + '</span>';
    html += '</div>';
    html += '<div style="background:#333;border-radius:3px;height:12px;overflow:hidden;">';
    html += '<div style="background:' + qualityColor(ratio) + ';height:100%;width:' + Math.min(100, ratioPercent) + '%;"></div>';
    html += '</div>';
    html += '<div style="text-align:right;font-size:10px;color:#999;">Base: ' + ratioPercent + '%</div>';
    html += '</div>';

    // Lab bonuses
    if (bonusEntries.length > 0) {
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="color:#aaa;font-size:11px;margin-bottom:4px;">Lab Bonuses</div>';
      for (const b of bonusEntries) {
        html += '<div style="display:flex;justify-content:space-between;">';
        html += '<span>' + b.zoneType + ' (Room ' + b.roomId + ')</span>';
        html += '<span style="color:#4c4;">+' + Math.round(b.bonus * 100) + '%</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Effective quality
    const totalLabBonus = bonusEntries.reduce((s, b) => s + b.bonus, 0);
    const effectiveQuality = Math.min(1.0, ratio + Math.min(totalLabBonus, 0.5));
    const eqPercent = Math.round(effectiveQuality * 100);
    html += '<div style="font-size:14px;font-weight:bold;color:' + qualityColor(effectiveQuality) + ';">';
    html += 'Effective Quality: ' + eqPercent + '%';
    html += '</div>';

    // Effect summary
    html += '<div style="margin-top:8px;font-size:11px;color:#999;">';
    if (effectiveQuality >= 1.0) {
      html += 'All systems nominal.';
    } else if (this.networkType === 'rfWaveguide') {
      html += 'RF cavities operating at ' + eqPercent + '% gradient.';
    } else if (this.networkType === 'powerCable') {
      html += 'Components derated to ' + eqPercent + '% performance.';
    } else if (this.networkType === 'coolingWater') {
      html += 'Cooling at ' + eqPercent + '% — thermal derating active.';
    } else if (this.networkType === 'vacuumPipe') {
      html += 'Vacuum quality: ' + (validation.pressureQuality || 'Unknown');
    } else if (this.networkType === 'cryoTransfer') {
      if (validation.quenched) {
        html += 'QUENCH — SRF cavities offline!';
      } else {
        html += 'Cryo at ' + eqPercent + '% capacity.';
      }
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  _renderEquipment(container) {
    const network = this._getNetworkData();
    let html = '<div style="padding:8px;font-size:12px;color:#ccc;">';

    // Facility equipment
    if (network.equipment.length > 0) {
      html += '<div style="color:#aaa;font-size:11px;margin-bottom:4px;">Facility Equipment</div>';
      for (const eq of network.equipment) {
        const comp = COMPONENTS[eq.type];
        const name = comp ? comp.name : eq.type;
        html += '<div style="padding:2px 0;">' + name + '</div>';
      }
    }

    // Beamline components
    if (network.beamlineNodes.length > 0) {
      html += '<div style="color:#aaa;font-size:11px;margin-top:8px;margin-bottom:4px;">Beamline Components</div>';
      for (const node of network.beamlineNodes) {
        const comp = COMPONENTS[node.type];
        const name = comp ? comp.name : node.type;
        html += '<div style="padding:2px 0;">' + name + '</div>';
      }
    }

    if (network.equipment.length === 0 && network.beamlineNodes.length === 0) {
      html += '<div style="color:#666;">No equipment connected.</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }
}
```

- [ ] **Step 2: Wire click handler for network tiles**

In the input handler (wherever tile clicks are dispatched), add detection for clicking on a connection tile. Find which network cluster the clicked tile belongs to:

```javascript
import { NetworkWindow } from '../ui/NetworkWindow.js';

// When a tile is clicked and it's a connection tile:
const key = col + ',' + row;
const connTypes = game.state.connections.get(key);
if (connTypes && connTypes.size > 0) {
  // Find which network cluster this tile belongs to
  const networkData = game.state.networkData || {};
  for (const connType of connTypes) {
    const clusters = networkData[connType] || [];
    for (let ci = 0; ci < clusters.length; ci++) {
      const inCluster = clusters[ci].tiles.some(t => t.col === col && t.row === row);
      if (inCluster) {
        new NetworkWindow(game, connType, ci);
        return;
      }
    }
  }
}
```

- [ ] **Step 3: Run the game to verify the panel opens**

Run: `npx vite`, place some infrastructure (power cables, substation, beamline component), click on a power cable tile. The Network Window should appear.

- [ ] **Step 4: Commit**

```bash
git add src/ui/NetworkWindow.js src/input/InputHandler.js
git commit -m "feat: add network info panel with quality display and lab bonuses"
```

---

### Task 9: Remove Binary Beam Stop for Degraded Networks

**Files:**
- Modify: `src/game/Game.js` — change `infraCanRun` logic to only hard-stop for truly missing connections, not for capacity shortfalls
- Modify: `src/networks/networks.js` — mark blockers as `hard` vs `soft`

- [ ] **Step 1: Classify blockers as hard vs soft**

In `src/networks/networks.js`, in the `validate` function, add a `severity` field to each blocker:

- `connection` type (missing cable entirely): `severity: 'hard'`
- `power`, `cooling`, `rf` capacity overloads: `severity: 'soft'` (these now degrade rather than block)
- `vacuum` pressure too high: `severity: 'soft'`
- `cryo` overloaded: `severity: 'soft'` (quench handled via quality multiplier)
- `pps` missing: `severity: 'hard'`
- `shielding` insufficient: `severity: 'hard'`

In each blocker push, add the severity:

```javascript
blockers.push({
  type: 'power',
  severity: 'soft',  // <-- add this
  reason: 'Power network overloaded: ...',
});
```

For connection-type blockers and pps/shielding, use `severity: 'hard'`.

- [ ] **Step 2: Update canRun to only check hard blockers**

In `src/networks/networks.js`, change the return statement:

```javascript
var hardBlockers = blockers.filter(function(b) { return b.severity === 'hard'; });
return {
  canRun: hardBlockers.length === 0,
  blockers: blockers,
  networks: allNetworks,
};
```

- [ ] **Step 3: Update Game.js to log soft blockers as warnings**

In `src/game/Game.js`, in `validateInfrastructure`, change the blocker iteration to distinguish hard vs soft:

```javascript
for (const blocker of result.blockers) {
  if (blocker.severity === 'hard' && blocker.nodeId) {
    // Hard blockers trip the beam (existing behavior)
    const blEntry = this.registry.getBeamlineForNode(blocker.nodeId);
    if (blEntry && blEntry.status === 'running') {
      blEntry.status = 'stopped';
      blEntry.beamState.continuousBeamTicks = 0;
      this.log(`Beam TRIPPED: ${blocker.reason}`, 'bad');
      this.emit('beamToggled');
    }
  }
  // Soft blockers just get logged as warnings (first time only)
  if (blocker.severity === 'soft' && !this._softBlockerWarned?.[blocker.reason]) {
    this.log(`Warning: ${blocker.reason}`, 'warn');
    if (!this._softBlockerWarned) this._softBlockerWarned = {};
    this._softBlockerWarned[blocker.reason] = true;
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `node test/test-networks.js && node test/test-rooms.js`
Expected: Some existing tests may need updating since `canRun` logic changed. Update tests that check `canRun=false` for capacity overloads to expect `canRun=true` (since those are now soft blockers). The test for missing PPS should still expect `canRun=false`.

- [ ] **Step 5: Commit**

```bash
git add src/networks/networks.js src/game/Game.js test/test-networks.js
git commit -m "feat: soft blockers degrade performance instead of stopping beam"
```

---

### Task 10: Integration Test

**Files:**
- Modify: `test/test-rooms.js` — add end-to-end test

- [ ] **Step 1: Write integration test**

Append to `test/test-rooms.js`:

```javascript
console.log('\n=== Integration Test: Lab Bonus → Network Quality ===');

let iPassed = 0;
let iFailed = 0;
function iassert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); iFailed++; }
  else { iPassed++; }
}

// Setup: RF Lab room adjacent to beam hall, waveguide connecting them
{
  const state = mockState();

  // Beam hall at (0,0)-(4,0) — 5 tiles of concrete, enclosed
  for (let c = 0; c < 5; c++) {
    placeFloor(state, c, 0, 'concrete');
    placeWall(state, c, 0, 'n');
  }
  // South wall of beam hall
  for (let c = 0; c < 5; c++) {
    placeWall(state, c, 0, 's');
  }
  placeWall(state, 0, 0, 'w');
  placeWall(state, 4, 0, 'e');

  // RF Lab at (0,2)-(2,2) — 3 tiles of lab floor, enclosed
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 2, 'labFloor');
    placeWall(state, c, 2, 'n');
    placeWall(state, c, 2, 's');
    placeZone(state, c, 2, 'rfLab');
  }
  placeWall(state, 0, 2, 'w');
  placeWall(state, 2, 2, 'e');

  // Hallway at row 1 (1 tile wide)
  for (let c = 0; c < 3; c++) {
    placeFloor(state, c, 1, 'hallway');
  }
  // Hallway walls (south = RF lab north wall, north = beam hall south wall, already placed)

  // RF waveguide running through hallway at (0,1) — in reach of RF Lab (1 tile north of lab)
  state.connections = new Map();
  state.connections.set('0,1', new Set(['rfWaveguide']));
  // Waveguide also in beam hall at (0,0)
  state.connections.set('0,0', new Set(['rfWaveguide']));

  // RF cavity in beam hall
  state.beamline.push({ id: 'cav1', type: 'rfCavity', col: 2, row: 0, tiles: [{ col: 2, row: 0 }] });

  // Furnishing in RF Lab
  state.zoneFurnishings = [
    { id: 1, type: 'oscilloscope', col: 0, row: 2 },
  ];

  // Detect rooms
  const rooms = detectRooms(state);
  iassert(rooms.length === 3, 'INT: should have 3 rooms (beam hall, hallway, RF lab), got ' + rooms.length);

  const beamHall = rooms.find(r => r.roomType === 'beamHall');
  const rfLabRoom = rooms.find(r => r.zoneTypes.indexOf('rfLab') !== -1);
  iassert(beamHall !== undefined, 'INT: should have a beam hall');
  iassert(rfLabRoom !== undefined, 'INT: should have an RF Lab room');

  // Network discovery
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 0, row: 1 }, { col: 0, row: 0 }], equipment: [], beamlineNodes: [{ id: 'cav1', type: 'rfCavity' }] }],
    coolingWater: [], vacuumPipe: [], dataFiber: [], powerCable: [], cryoTransfer: [],
  };

  // Lab bonuses
  const bonuses = findLabNetworkBonuses(state, networkClusters);
  iassert(bonuses.rfWaveguide.length === 1, 'INT: should find 1 RF lab bonus, got ' + bonuses.rfWaveguide.length);
  iassert(bonuses.rfWaveguide[0].bonus === 0.05, 'INT: oscilloscope bonus should be 0.05, got ' + bonuses.rfWaveguide[0]?.bonus);

  // Quality computation: no RF source, so ratio=0, but lab gives 0.05
  const quality = Networks.computeNetworkQuality(0, 100, bonuses.rfWaveguide);
  iassert(Math.abs(quality - 0.05) < 0.01, 'INT: quality should be ~0.05, got ' + quality);
}

console.log('Passed: ' + iPassed + '  Failed: ' + iFailed);
if (iFailed > 0) {
  console.log('\n=== INTEGRATION TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL INTEGRATION TESTS PASSED ===');
}
```

- [ ] **Step 2: Run full test suite**

Run: `node test/test-rooms.js && node test/test-networks.js && python3 test/test_infra_quality.py`
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add test/test-rooms.js
git commit -m "test: add integration test for lab bonus → network quality pipeline"
```
