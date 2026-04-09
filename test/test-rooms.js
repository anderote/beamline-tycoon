import { detectRooms, computeRoomReach, LAB_NETWORK_MAP, findLabNetworkBonuses } from '../src/networks/rooms.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.log('FAIL: ' + msg); failed++; }
  else { passed++; }
}

function makeState(overrides) {
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
    ...overrides,
  };
}

function addFloor(state, col, row, type) {
  state.infrastructure.push({ type, col, row });
  state.infraOccupied[col + ',' + row] = type;
}

function addWall(state, col, row, edge, wallType) {
  wallType = wallType || 'wall';
  state.walls.push({ type: wallType, col, row, edge });
  state.wallOccupied[col + ',' + row + ',' + edge] = wallType;
}

function addDoor(state, col, row, edge, doorType) {
  doorType = doorType || 'door';
  state.doors.push({ type: doorType, col, row, edge });
  state.doorOccupied[col + ',' + row + ',' + edge] = doorType;
}

console.log('=== Room Detection Tests ===');

// 1. No flooring = no rooms
{
  const state = makeState();
  const rooms = detectRooms(state);
  assert(rooms.length === 0, '1: no flooring should produce 0 rooms, got ' + rooms.length);
}

// 2. Single 2x2 room enclosed by walls -> 1 room, 4 tiles
{
  const state = makeState();
  // 2x2 flooring at (0,0), (1,0), (0,1), (1,1)
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 1, 0, 'concrete');
  addFloor(state, 0, 1, 'concrete');
  addFloor(state, 1, 1, 'concrete');
  // Walls around the perimeter
  addWall(state, 0, 0, 'n');
  addWall(state, 1, 0, 'n');
  addWall(state, 0, 0, 'w');
  addWall(state, 0, 1, 'w');
  addWall(state, 1, 0, 'e');
  addWall(state, 1, 1, 'e');
  addWall(state, 0, 1, 's');
  addWall(state, 1, 1, 's');

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '2: should have 1 room, got ' + rooms.length);
  assert(rooms[0].tiles.length === 4, '2: room should have 4 tiles, got ' + rooms[0].tiles.length);
}

// 3. Two rooms separated by a wall -> 2 rooms, 2 tiles each
{
  const state = makeState();
  // Left room: (0,0), (0,1)
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 0, 1, 'concrete');
  // Right room: (1,0), (1,1)
  addFloor(state, 1, 0, 'concrete');
  addFloor(state, 1, 1, 'concrete');
  // Wall between col 0 and col 1
  addWall(state, 0, 0, 'e');
  addWall(state, 0, 1, 'e');

  const rooms = detectRooms(state);
  assert(rooms.length === 2, '3: should have 2 rooms, got ' + rooms.length);
  assert(rooms[0].tiles.length === 2, '3: room 0 should have 2 tiles, got ' + rooms[0].tiles.length);
  assert(rooms[1].tiles.length === 2, '3: room 1 should have 2 tiles, got ' + rooms[1].tiles.length);
}

// 4. Door connects rooms (wall + door on same edge) -> 1 room
{
  const state = makeState();
  // Left room: (0,0), (0,1)
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 0, 1, 'concrete');
  // Right room: (1,0), (1,1)
  addFloor(state, 1, 0, 'concrete');
  addFloor(state, 1, 1, 'concrete');
  // Wall between col 0 and col 1
  addWall(state, 0, 0, 'e');
  addWall(state, 0, 1, 'e');
  // Door on one of the wall edges -> connects the rooms
  addDoor(state, 0, 0, 'e');

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '4: door should connect rooms into 1, got ' + rooms.length);
  assert(rooms[0].tiles.length === 4, '4: connected room should have 4 tiles, got ' + rooms[0].tiles.length);
}

// 5. Beam hall detection (>= 80% concrete + beamline node)
{
  const state = makeState();
  // 5 tiles, all concrete
  for (let c = 0; c < 5; c++) addFloor(state, c, 0, 'concrete');
  // Beamline node on one of the tiles
  state.beamline.push({ id: 'bl1', type: 'drift', col: 2, row: 0, tiles: [{ col: 2, row: 0 }] });

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '5: should have 1 room');
  assert(rooms[0].roomType === 'beamHall', '5: should be beamHall, got ' + rooms[0].roomType);
}

// 5b. Machine hall (>= 80% concrete + machine, no beamline)
{
  const state = makeState();
  for (let c = 0; c < 5; c++) addFloor(state, c, 0, 'concrete');
  state.machines.push({ id: 'm1', col: 2, row: 0, tiles: [{ col: 2, row: 0 }] });

  const rooms = detectRooms(state);
  assert(rooms[0].roomType === 'machineHall', '5b: should be machineHall, got ' + rooms[0].roomType);
}

// 5c. Empty hall (>= 80% concrete, nothing inside)
{
  const state = makeState();
  for (let c = 0; c < 5; c++) addFloor(state, c, 0, 'concrete');

  const rooms = detectRooms(state);
  assert(rooms[0].roomType === 'emptyHall', '5c: should be emptyHall, got ' + rooms[0].roomType);
}

// 6. Zone-typed room (RF Lab zone overlay)
{
  const state = makeState();
  addFloor(state, 0, 0, 'labFloor');
  addFloor(state, 1, 0, 'labFloor');
  state.zoneOccupied['0,0'] = 'rfLab';

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '6: should have 1 room');
  assert(rooms[0].roomType === 'rfLab', '6: should be rfLab, got ' + rooms[0].roomType);
  assert(rooms[0].zoneTypes.length === 1, '6: should have 1 zoneType');
  assert(rooms[0].zoneTypes[0] === 'rfLab', '6: zoneType should be rfLab');
}

// 6b. Zone-typed takes priority over beam hall
{
  const state = makeState();
  for (let c = 0; c < 5; c++) addFloor(state, c, 0, 'concrete');
  state.zoneOccupied['2,0'] = 'controlRoom';
  state.beamline.push({ id: 'bl1', type: 'drift', col: 3, row: 0, tiles: [{ col: 3, row: 0 }] });

  const rooms = detectRooms(state);
  assert(rooms[0].roomType === 'controlRoom', '6b: zone should override beamHall, got ' + rooms[0].roomType);
}

// 7. Hallway detection (majority hallway flooring)
{
  const state = makeState();
  addFloor(state, 0, 0, 'hallway');
  addFloor(state, 1, 0, 'hallway');
  addFloor(state, 2, 0, 'concrete');

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '7: should have 1 room');
  assert(rooms[0].roomType === 'hallway', '7: should be hallway, got ' + rooms[0].roomType);
}

// 8. Boundary tiles (tiles adjacent to a wall)
{
  const state = makeState();
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 1, 0, 'concrete');
  addFloor(state, 2, 0, 'concrete');
  // Wall only on (0,0) west edge
  addWall(state, 0, 0, 'w');

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '8: should have 1 room');
  assert(rooms[0].boundaryTiles.length === 1, '8: only 1 boundary tile, got ' + rooms[0].boundaryTiles.length);
  assert(rooms[0].boundaryTiles[0].col === 0 && rooms[0].boundaryTiles[0].row === 0,
    '8: boundary tile should be (0,0)');
}

// 9. computeRoomReach: reach set is tiles just outside room walls, not inside
{
  const state = makeState();
  // 2x1 room with walls on all sides
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 1, 0, 'concrete');
  addWall(state, 0, 0, 'n');
  addWall(state, 0, 0, 'w');
  addWall(state, 0, 0, 's');
  addWall(state, 1, 0, 'n');
  addWall(state, 1, 0, 'e');
  addWall(state, 1, 0, 's');

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '9: should have 1 room');
  assert(rooms[0].boundaryTiles.length === 2, '9: both tiles should be boundary tiles');

  const reach = computeRoomReach(rooms[0]);
  // Room tiles: (0,0) and (1,0)
  // Boundary tiles: both. Neighbors outside room:
  // (0,0): n=>(0,-1), w=>(-1,0), s=>(0,1)
  // (1,0): n=>(1,-1), e=>(2,0), s=>(1,1)
  assert(!reach.has('0,0'), '9: reach should not include room tile (0,0)');
  assert(!reach.has('1,0'), '9: reach should not include room tile (1,0)');
  assert(reach.has('0,-1'), '9: reach should include (0,-1)');
  assert(reach.has('-1,0'), '9: reach should include (-1,0)');
  assert(reach.has('0,1'), '9: reach should include (0,1)');
  assert(reach.has('1,-1'), '9: reach should include (1,-1)');
  assert(reach.has('2,0'), '9: reach should include (2,0)');
  assert(reach.has('1,1'), '9: reach should include (1,1)');
  assert(reach.size === 6, '9: reach should have 6 tiles, got ' + reach.size);
}

// 10. LAB_NETWORK_MAP has correct entries
{
  assert(LAB_NETWORK_MAP.rfLab === 'rfWaveguide', '10: rfLab mapping');
  assert(LAB_NETWORK_MAP.coolingLab === 'coolingWater', '10: coolingLab mapping');
  assert(LAB_NETWORK_MAP.vacuumLab === 'vacuumPipe', '10: vacuumLab mapping');
  assert(LAB_NETWORK_MAP.diagnosticsLab === 'dataFiber', '10: diagnosticsLab mapping');
  assert(LAB_NETWORK_MAP.controlRoom === 'dataFiber', '10: controlRoom mapping');
}

// 11. Flooring breakdown fractions
{
  const state = makeState();
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 1, 0, 'concrete');
  addFloor(state, 2, 0, 'concrete');
  addFloor(state, 3, 0, 'concrete');
  addFloor(state, 4, 0, 'labFloor');

  const rooms = detectRooms(state);
  assert(Math.abs(rooms[0].flooringBreakdown['concrete'] - 0.8) < 0.001,
    '11: concrete should be 0.8, got ' + rooms[0].flooringBreakdown['concrete']);
  assert(Math.abs(rooms[0].flooringBreakdown['labFloor'] - 0.2) < 0.001,
    '11: labFloor should be 0.2, got ' + rooms[0].flooringBreakdown['labFloor']);
}

// 12. Wall on neighbor side also blocks
{
  const state = makeState();
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 1, 0, 'concrete');
  // Wall on (1,0) west edge (equivalent to (0,0) east edge)
  addWall(state, 1, 0, 'w');

  const rooms = detectRooms(state);
  assert(rooms.length === 2, '12: wall on neighbor side should split into 2 rooms, got ' + rooms.length);
}

// === Lab-to-Network Connectivity Tests ===
console.log('\n=== Lab-to-Network Connectivity Tests ===');

function addZone(state, col, row, zoneType) {
  state.zoneOccupied[col + ',' + row] = zoneType;
}

function addFurnishing(state, col, row, type) {
  state.zoneFurnishings = state.zoneFurnishings || [];
  state.zoneFurnishings.push({ id: type + '_' + col + '_' + row, type, col, row });
}

// 13. Room reach: 3x1 room with walls -> reach includes tiles outside, not inside
{
  const state = makeState();
  addFloor(state, 0, 0, 'concrete');
  addFloor(state, 1, 0, 'concrete');
  addFloor(state, 2, 0, 'concrete');
  // Walls on all sides
  addWall(state, 0, 0, 'n'); addWall(state, 1, 0, 'n'); addWall(state, 2, 0, 'n');
  addWall(state, 0, 0, 's'); addWall(state, 1, 0, 's'); addWall(state, 2, 0, 's');
  addWall(state, 0, 0, 'w');
  addWall(state, 2, 0, 'e');

  const rooms = detectRooms(state);
  assert(rooms.length === 1, '13: should have 1 room');
  const reach = computeRoomReach(rooms[0]);

  // Should NOT include room tiles
  assert(!reach.has('0,0'), '13: reach excludes (0,0)');
  assert(!reach.has('1,0'), '13: reach excludes (1,0)');
  assert(!reach.has('2,0'), '13: reach excludes (2,0)');

  // Should include tiles N, S, W, E of room
  assert(reach.has('0,-1'), '13: reach includes north of (0,0)');
  assert(reach.has('1,-1'), '13: reach includes north of (1,0)');
  assert(reach.has('2,-1'), '13: reach includes north of (2,0)');
  assert(reach.has('0,1'), '13: reach includes south of (0,0)');
  assert(reach.has('1,1'), '13: reach includes south of (1,0)');
  assert(reach.has('2,1'), '13: reach includes south of (2,0)');
  assert(reach.has('-1,0'), '13: reach includes west of (0,0)');
  assert(reach.has('3,0'), '13: reach includes east of (2,0)');
}

// 14. Lab bonus connected: RF Lab with oscilloscope + spectrumAnalyzer, waveguide tile in reach
{
  const state = makeState();
  // 3x1 RF Lab room
  addFloor(state, 0, 0, 'labFloor');
  addFloor(state, 1, 0, 'labFloor');
  addFloor(state, 2, 0, 'labFloor');
  addZone(state, 0, 0, 'rfLab');
  addZone(state, 1, 0, 'rfLab');
  addZone(state, 2, 0, 'rfLab');
  // Walls on all sides
  addWall(state, 0, 0, 'n'); addWall(state, 1, 0, 'n'); addWall(state, 2, 0, 'n');
  addWall(state, 0, 0, 's'); addWall(state, 1, 0, 's'); addWall(state, 2, 0, 's');
  addWall(state, 0, 0, 'w');
  addWall(state, 2, 0, 'e');
  // Furnishings inside the room
  addFurnishing(state, 0, 0, 'oscilloscope');    // zoneOutput: 0.05
  addFurnishing(state, 1, 0, 'spectrumAnalyzer'); // zoneOutput: 0.08

  // Waveguide cluster tile at (3, 0) — east of the room, in reach
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 3, row: 0 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [],
    vacuumPipe: [],
    dataFiber: [],
  };

  const bonuses = findLabNetworkBonuses(state, networkClusters);
  assert(bonuses.rfWaveguide.length === 1, '14: should find 1 rfWaveguide bonus, got ' + bonuses.rfWaveguide.length);
  assert(Math.abs(bonuses.rfWaveguide[0].bonus - 0.13) < 0.001,
    '14: bonus should be 0.13, got ' + bonuses.rfWaveguide[0].bonus);
  assert(bonuses.rfWaveguide[0].clusterIndex === 0, '14: clusterIndex should be 0');
}

// 15. Lab NOT connected: waveguide 2 tiles away, no network in hallway
{
  const state = makeState();
  // 1x1 RF Lab room
  addFloor(state, 0, 0, 'labFloor');
  addZone(state, 0, 0, 'rfLab');
  addWall(state, 0, 0, 'n'); addWall(state, 0, 0, 's');
  addWall(state, 0, 0, 'w'); addWall(state, 0, 0, 'e');
  addFurnishing(state, 0, 0, 'oscilloscope');

  // Waveguide cluster tile at (2, 0) — 2 tiles east, NOT in reach (reach only extends 1 tile)
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 2, row: 0 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [],
    vacuumPipe: [],
    dataFiber: [],
  };

  const bonuses = findLabNetworkBonuses(state, networkClusters);
  assert(bonuses.rfWaveguide.length === 0, '15: should find 0 rfWaveguide bonuses (out of reach), got ' + bonuses.rfWaveguide.length);
}

// 16. Bonus cap: many furnishings, bonus per entry capped at 0.5
{
  const state = makeState();
  // Large RF Lab room
  for (let c = 0; c < 10; c++) {
    addFloor(state, c, 0, 'labFloor');
    addZone(state, c, 0, 'rfLab');
  }
  addWall(state, 0, 0, 'w');
  addWall(state, 9, 0, 'e');
  for (let c = 0; c < 10; c++) {
    addWall(state, c, 0, 'n');
    addWall(state, c, 0, 's');
  }
  // 10 network analyzers = 10 * 0.10 = 1.0, should cap at 0.5
  for (let c = 0; c < 10; c++) {
    addFurnishing(state, c, 0, 'networkAnalyzer'); // zoneOutput: 0.10 each
  }

  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 10, row: 0 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [],
    vacuumPipe: [],
    dataFiber: [],
  };

  const bonuses = findLabNetworkBonuses(state, networkClusters);
  assert(bonuses.rfWaveguide.length === 1, '16: should find 1 rfWaveguide bonus');
  assert(Math.abs(bonuses.rfWaveguide[0].bonus - 0.5) < 0.001,
    '16: bonus should be capped at 0.5, got ' + bonuses.rfWaveguide[0].bonus);
}

// === Integration Test: Full Pipeline ===
console.log('\n=== Integration Test: Lab Bonus → Network Quality Pipeline ===');

import { Networks } from '../src/networks/networks.js';

// 17. End-to-end: room detection → lab connectivity → network quality → physics integration
{
  const state = makeState();

  // Row 0: Beam hall — 5 concrete tiles, walled
  for (let c = 0; c < 5; c++) {
    addFloor(state, c, 0, 'concrete');
    addWall(state, c, 0, 'n');
    addWall(state, c, 0, 's');
  }
  addWall(state, 0, 0, 'w');
  addWall(state, 4, 0, 'e');
  // Beamline node (RF cavity) inside beam hall
  state.beamline.push({ id: 'rfCavity1', type: 'rfCavity', col: 2, row: 0, tiles: [{ col: 2, row: 0 }] });

  // Row 1: Hallway — 3 hallway tiles (cols 0-2), no walls (open corridor)
  for (let c = 0; c < 3; c++) {
    addFloor(state, c, 1, 'hallway');
  }

  // Row 2: RF Lab — 3 labFloor tiles, walled, zone=rfLab
  for (let c = 0; c < 3; c++) {
    addFloor(state, c, 2, 'labFloor');
    addZone(state, c, 2, 'rfLab');
    addWall(state, c, 2, 'n');
    addWall(state, c, 2, 's');
  }
  addWall(state, 0, 2, 'w');
  addWall(state, 2, 2, 'e');
  // Furnishing: oscilloscope (zoneOutput: 0.05)
  addFurnishing(state, 1, 2, 'oscilloscope');

  // Detect rooms
  const rooms = detectRooms(state);

  // Assertion 1: 3 rooms (beam hall, hallway, RF lab)
  assert(rooms.length === 3, '17a: should find 3 rooms, got ' + rooms.length);

  // Assertion 2: One room is beamHall
  const beamHall = rooms.find(r => r.roomType === 'beamHall');
  assert(!!beamHall, '17b: should have a beamHall room');

  // Assertion 3: One room has zoneTypes containing 'rfLab'
  const rfLab = rooms.find(r => r.zoneTypes && r.zoneTypes.indexOf('rfLab') !== -1);
  assert(!!rfLab, '17c: should have a room with rfLab zoneType');

  // RF waveguide network cluster: tiles in hallway (0,1) and beam hall (0,0)
  const networkClusters = {
    rfWaveguide: [{ tiles: [{ col: 0, row: 1 }, { col: 0, row: 0 }], equipment: [], beamlineNodes: [] }],
    coolingWater: [],
    vacuumPipe: [],
    dataFiber: [],
  };

  // Find lab network bonuses
  const bonuses = findLabNetworkBonuses(state, networkClusters);

  // Assertion 4: RF Lab found the waveguide
  assert(bonuses.rfWaveguide.length === 1,
    '17d: should find 1 rfWaveguide bonus, got ' + bonuses.rfWaveguide.length);

  // Assertion 5: Bonus is 0.05 (oscilloscope zoneOutput)
  assert(bonuses.rfWaveguide.length > 0 && Math.abs(bonuses.rfWaveguide[0].bonus - 0.05) < 0.001,
    '17e: bonus should be 0.05, got ' + (bonuses.rfWaveguide.length > 0 ? bonuses.rfWaveguide[0].bonus : 'N/A'));

  // Assertion 6: computeNetworkQuality with no RF source (capacity=0, demand=100) + lab bonus
  const quality = Networks.computeNetworkQuality(0, 100, bonuses.rfWaveguide);
  assert(Math.abs(quality - 0.05) < 0.001,
    '17f: network quality should be ~0.05, got ' + quality);
}

console.log('\nPassed: ' + passed + '  Failed: ' + failed);
if (failed > 0) {
  console.log('\n=== TESTS FAILED ===');
  process.exit(1);
} else {
  console.log('\n=== ALL TESTS PASSED ===');
}
