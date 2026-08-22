import { wireUtility } from './scenario-wiring.js';

export function generateRealLab() {
  const floors = [];
  const zones = [];
  const walls = [];
  const doors = [];
  const placeables = [];
  let nextId = 1;
  const cornerHeights = new Map(); // flat: all z=0, no cliffs
  const addFloor = (type, col, row, variant = 0) => floors.push({ type, col, row, variant });
  const addZone = (type, col, row) => zones.push({ type, col, row });
  const addWall = (col, row, edge, type) => walls.push({ col, row, edge, type });
  const addDoor = (col, row, edge, type = 'officeDoor') => doors.push({ col, row, edge, type });
  const addFurn = (type, col, row, subCol = 1, subRow = 1, dir = 0) => {
    placeables.push({ id: `fn_${nextId++}`, type, col, row, subCol, subRow, dir, kind: 'furnishing' });
  };
  const originCol = -6, originRow = -2;
  const W = 14, H = 10;
  for (let c = originCol; c < originCol + W; c++) {
    for (let r = originRow; r < originRow + H; r++) {
      addFloor('concrete', c, r);
    }
  }
  const hallRow = originRow + 4;
  for (let c = originCol; c < originCol + W; c++) {
    addFloor('hallway', c, hallRow);
  }
  const rfLabRect = { x0: originCol + 1, y0: originRow + 1, x1: originCol + 5, y1: hallRow - 1 };
  for (let c = rfLabRect.x0; c <= rfLabRect.x1; c++) {
    for (let r = rfLabRect.y0; r <= rfLabRect.y1; r++) addFloor('labFloor', c, r);
  }
  for (let c = rfLabRect.x0; c <= rfLabRect.x1; c++) {
    for (let r = rfLabRect.y0; r <= rfLabRect.y1; r++) addZone('rfLab', c, r);
  }
  const vacuumRect = { x0: originCol + 7, y0: originRow + 1, x1: originCol + 11, y1: hallRow - 1 };
  for (let c = vacuumRect.x0; c <= vacuumRect.x1; c++) {
    for (let r = vacuumRect.y0; r <= vacuumRect.y1; r++) addFloor('labFloor', c, r);
  }
  for (let c = vacuumRect.x0; c <= vacuumRect.x1; c++) {
    for (let r = vacuumRect.y0; r <= vacuumRect.y1; r++) addZone('vacuumLab', c, r);
  }
  const ctrlRect = { x0: originCol + 1, y0: hallRow + 2, x1: originCol + 5, y1: originRow + H - 1 };
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) {
    for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addFloor('officeFloor', c, r);
  }
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) {
    for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addZone('controlRoom', c, r);
  }
  const cafeRect = { x0: originCol + 7, y0: hallRow + 2, x1: originCol + 11, y1: originRow + H - 1 };
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) {
    for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addFloor('officeFloor', c, r);
  }
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) {
    for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addZone('cafeteria', c, r);
  }
  for (let c = originCol; c < originCol + W; c++) {
    addWall(c, originRow, 'n', 'interiorWall');
    addWall(c, originRow + H - 1, 's', 'interiorWall');
  }
  for (let r = originRow; r < originRow + H; r++) {
    addWall(originCol, r, 'w', 'interiorWall');
    addWall(originCol + W - 1, r, 'e', 'interiorWall');
  }
  addDoor(originCol + 3, hallRow, 's', 'officeDoor');
  addDoor(originCol + 9, hallRow, 's', 'officeDoor');
  addDoor(originCol + 3, hallRow, 'n', 'labDoor');
  addDoor(originCol + 9, hallRow, 'n', 'labDoor');
  addDoor(originCol + W - 1, hallRow, 'e', 'officeDoor');
  addFurn('operatorConsole', ctrlRect.x0 + 1, ctrlRect.y0 + 1, 1, 1, 1);
  addFurn('monitorBank', ctrlRect.x0 + 2, ctrlRect.y0 + 1, 0, 0, 0);
  addFurn('operatorChair', ctrlRect.x0 + 1, ctrlRect.y0 + 2, 0, 0, 0);
  addFurn('serverRack', ctrlRect.x1, ctrlRect.y0 + 1, 0, 0, 2);
  // Balance fix round 4: a diningTable is `seated: 'required'` (facility-
  // room-furnishings.raw.js) and only resolves a working `eat` StationRef
  // when a chair sits at the EXACT subtile each of its four anchors
  // declares (stations.js's seat-matching) — a chair a whole TILE away from
  // its table (the previous two lines here) never matches any anchor at
  // all, so getStationIndex(state).byJob.eat was EMPTY for this scenario;
  // every player's staff has been permanently unserviced from ~tick 160
  // since staff-professions-3's stations system shipped. Same anchor-offset
  // recipe test-staff-economy.js's own placeDiningTable helper uses,
  // verified against the real station index — all four seats, not two.
  const cafeTableCol = cafeRect.x0 + 1, cafeTableRow = cafeRect.y0 + 1;
  addFurn('diningTable', cafeTableCol, cafeTableRow, 0, 0, 0);
  addFurn('cafeteriaChair', cafeTableCol, cafeTableRow, 0, 3, 0);
  addFurn('cafeteriaChair', cafeTableCol, cafeTableRow - 1, 1, 2, 2);
  addFurn('cafeteriaChair', cafeTableCol - 1, cafeTableRow, 2, 0, 1);
  addFurn('cafeteriaChair', cafeTableCol, cafeTableRow, 3, 1, 3);
  addFurn('vendingMachine', cafeRect.x1, cafeRect.y0 + 1, 0, 0, 3);
  // toolChest (station.jobs: ['rest'], seated: 'never' — facility-lab-
  // furnishings.raw.js): a single free-standing anchor, no seat-matching
  // needed, so the file's own default subCol:1/subRow:1 works here same as
  // every other single-anchor item. This scenario shipped with NO rest
  // station of any kind before this fix — fatigue was permanently
  // unserviceable for every staffer, same bug class as the missing seats.
  addFurn('toolChest', cafeRect.x1 - 1, cafeRect.y1 - 1, 1, 1, 0);
  addFurn('labBench', rfLabRect.x0 + 1, rfLabRect.y0 + 1, 1, 0, 1);
  addFurn('labBench', vacuumRect.x0 + 1, vacuumRect.y0 + 1, 1, 0, 1);
  return { floors, zones, walls, doors, placeables, placeableNextId: nextId, cornerHeights, infraBlockers: [] };
}

// Bring the furnished control room up on real services. The small pad-mount
// supply stays outside the west wall, so its HV feeder terminates on a rated
// wall bushing before a second cable continues to the panel inside.
export function setupRealLab(game) {
  const funding0 = game.state.resources.funding;
  const pad = game.placePlaceable({
    type: 'padMountTransformer', col: -8, row: 4, free: true, silent: true,
  });
  const panel = game.placePlaceable({
    type: 'powerPanel', col: -6, row: 4, free: true, silent: true,
  });
  const hvFeedthrough = game.placePlaceable({
    type: 'hvWallPassThrough', col: -6, row: 4,
    wallMount: { col: -6, row: 4, edge: 'w', off: 2 },
    // On a west wall the default input faces into the room. Reverse the two
    // terminals so the supply lands outdoors and the output lands indoors.
    portsFlipped: true,
    free: true, silent: true,
  });
  const consoleId = game.state.placeables.find(p => p.type === 'operatorConsole')?.id;
  const monitorId = game.state.placeables.find(p => p.type === 'monitorBank')?.id;
  const captureId = game.state.placeables.find(p => p.type === 'serverRack')?.id;
  const wire = (utilityType, from, to) => wireUtility(game, utilityType, from, to);

  if (pad && panel && hvFeedthrough) {
    wire('hvCable', { id: pad, port: 'hv_out_1' }, { id: hvFeedthrough, port: 'hv_in' });
    wire('hvCable', { id: hvFeedthrough, port: 'hv_out' }, { id: panel, port: 'hv_in' });
  }
  for (const [index, id] of [consoleId, monitorId, captureId].entries()) {
    if (panel && id) {
      wire('powerCable', { id: panel, port: `pwr_out_${index + 1}` }, { id, port: 'pwr_in' });
    }
  }
  if (captureId) {
    for (const id of [consoleId, monitorId]) {
      if (id) wire('dataFiber', { id: captureId, port: 'data_out' }, { id, port: 'data_in' });
    }
  }
  game.state.resources.funding = funding0;
}
