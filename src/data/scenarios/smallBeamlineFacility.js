import { wireUtility } from './scenario-wiring.js';

export function generateSmallBeamlineFacility() {
  const floors = [];
  const zones = [];
  const walls = [];
  const doors = [];
  const placeables = [];
  let nextId = 1;
  const cornerHeights = new Map();
  const addFloor = (type, col, row) => floors.push({ type, col, row, variant: 0 });
  const addZone = (type, col, row) => zones.push({ type, col, row });
  const addWall = (col, row, edge, type) => walls.push({ col, row, edge, type });
  const addDoor = (col, row, edge, type) => doors.push({ col, row, edge, type });
  const addFurn = (type, col, row, dir = 0) => placeables.push({ id: `fn_${nextId++}`, type, col, row, subCol: 1, subRow: 1, dir, kind: 'furnishing' });

  const B0col = -8, B0row = -3, BW = 18, BH = 10;
  for (let c = B0col; c < B0col + BW; c++) for (let r = B0row; r < B0row + BH; r++) addFloor('concrete', c, r);

  const beamHall = { x0: B0col + 1, y0: B0row + 2, x1: B0col + BW - 2, y1: B0row + 4 };
  for (let c = beamHall.x0; c <= beamHall.x1; c++) for (let r = beamHall.y0; r <= beamHall.y1; r++) addFloor('concrete', c, r);

  const hallRow = B0row + 6;
  for (let c = B0col + 1; c < B0col + BW - 1; c++) addFloor('hallway', c, hallRow);

  const ctrlRect = { x0: B0col + 1, y0: hallRow + 1, x1: B0col + 6, y1: B0row + BH - 2 };
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addFloor('officeFloor', c, r);
  for (let c = ctrlRect.x0; c <= ctrlRect.x1; c++) for (let r = ctrlRect.y0; r <= ctrlRect.y1; r++) addZone('controlRoom', c, r);

  const cafeRect = { x0: B0col + 9, y0: hallRow + 1, x1: B0col + BW - 2, y1: B0row + BH - 2 };
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addFloor('officeFloor', c, r);
  for (let c = cafeRect.x0; c <= cafeRect.x1; c++) for (let r = cafeRect.y0; r <= cafeRect.y1; r++) addZone('cafeteria', c, r);

  const rfRect = { x0: B0col + 1, y0: B0row + 1, x1: B0col + 6, y1: beamHall.y0 - 1 };
  for (let c = rfRect.x0; c <= rfRect.x1; c++) for (let r = rfRect.y0; r <= rfRect.y1; r++) addFloor('labFloor', c, r);
  for (let c = rfRect.x0; c <= rfRect.x1; c++) for (let r = rfRect.y0; r <= rfRect.y1; r++) addZone('rfLab', c, r);

  const vacRect = { x0: B0col + 10, y0: B0row + 1, x1: B0col + 15, y1: beamHall.y0 - 1 };
  for (let c = vacRect.x0; c <= vacRect.x1; c++) for (let r = vacRect.y0; r <= vacRect.y1; r++) addFloor('labFloor', c, r);
  for (let c = vacRect.x0; c <= vacRect.x1; c++) for (let r = vacRect.y0; r <= vacRect.y1; r++) addZone('vacuumLab', c, r);

  for (let c = B0col; c < B0col + BW; c++) {
    addWall(c, B0row, 'n', 'structuralWall');
    addWall(c, B0row + BH - 1, 's', 'structuralWall');
  }
  for (let r = B0row; r < B0row + BH; r++) {
    addWall(B0col, r, 'w', 'structuralWall');
    addWall(B0col + BW - 1, r, 'e', 'structuralWall');
  }
  for (let c = beamHall.x0; c <= beamHall.x1; c++) {
    addWall(c, beamHall.y0, 'n', 'structuralWall');
    addWall(c, beamHall.y1, 's', 'structuralWall');
  }
  addWall(beamHall.x0, beamHall.y0, 'w', 'structuralWall');
  addWall(beamHall.x1, beamHall.y0, 'e', 'structuralWall');
  addWall(beamHall.x0, beamHall.y1, 'w', 'structuralWall');
  addWall(beamHall.x1, beamHall.y1, 'e', 'structuralWall');

  addDoor(B0col + 3, hallRow, 'n', 'labDoor');
  addDoor(B0col + 11, hallRow, 'n', 'labDoor');
  addDoor(B0col + 3, hallRow, 's', 'officeDoor');
  addDoor(B0col + 11, hallRow, 's', 'officeDoor');
  addDoor(beamHall.x0 + 3, beamHall.y1, 's', 'labDoor');
  addDoor(beamHall.x1 - 3, beamHall.y1, 's', 'labDoor');
  addDoor(B0col + BW - 1, hallRow, 'e', 'officeDoor');

  addFurn('operatorConsole', ctrlRect.x0 + 1, ctrlRect.y0 + 1, 1);
  addFurn('monitorBank', ctrlRect.x0 + 3, ctrlRect.y0, 0);
  addFurn('operatorChair', ctrlRect.x0 + 1, ctrlRect.y0 + 2, 0);
  addFurn('serverRack', ctrlRect.x1 - 1, ctrlRect.y0 + 1, 2);
  addFurn('diningTable', cafeRect.x0 + 1, cafeRect.y0 + 1, 0);
  addFurn('cafeteriaChair', cafeRect.x0, cafeRect.y0 + 1, 0);
  addFurn('cafeteriaChair', cafeRect.x0 + 2, cafeRect.y0 + 1, 0);
  addFurn('vendingMachine', cafeRect.x1, cafeRect.y0, 3);
  addFurn('labBench', rfRect.x0 + 1, rfRect.y0, 1);
  addFurn('labBench', vacRect.x0 + 1, vacRect.y0, 1);

  return { floors, zones, walls, doors, placeables, placeableNextId: nextId, cornerHeights, infraBlockers: [] };
}

// Post-apply setup: build the promised beamline inside the shielded hall and
// wire it so it comes up GREEN under utility gating (junction power + vacuum
// sinks are hard-required; an operator pawn is seeded by Game itself).
// Runs through the normal Game APIs after applyScenario(). The facility is
// pre-built, so the player's starting funding is restored afterwards.
export function setupSmallBeamlineFacility(game) {
  const funding0 = game.state.resources.funding;

  // Beam hall interior: rows -1..1, cols -7..8 (see generator above).
  // Beamline runs west→east along row 0.
  const src = game.beamline.placeJunction({ type: 'source', col: -6, row: 0, dir: 3, free: true, silent: true });
  const cup = game.beamline.placeJunction({ type: 'faradayCup', col: 6, row: 0, dir: 3, free: true, silent: true });
  if (!src || !cup) { console.warn('[scenario] smallBeamlineFacility: junction placement failed'); return; }

  const pipe = game.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: cup, portName: 'entry' },
    [{ col: -6, row: 0 }, { col: 6, row: 0 }],
  );
  if (pipe) {
    game.beamline.placeOnPipe(pipe, { type: 'buncher',       position: 0.08, mode: 'snap' });
    game.beamline.placeOnPipe(pipe, { type: 'pillboxCavity', position: 0.25, mode: 'snap' });
    game.beamline.placeOnPipe(pipe, { type: 'pillboxCavity', position: 0.40, mode: 'snap' });
    game.beamline.placeOnPipe(pipe, { type: 'pillboxCavity', position: 0.55, mode: 'snap' });
    game.beamline.placeOnPipe(pipe, { type: 'quadrupole',    position: 0.72, mode: 'snap' });
    game.beamline.placeOnPipe(pipe, { type: 'bpm',           position: 0.88, mode: 'snap' });
  }

  // Support gear along the hall's north row: a 150 kW pad-mount transformer
  // (source 50 + cup 1 kW leaves headroom for expansion), a roughing pump
  // (15 L/s vs ~1.2e-6 mbar·L/s outgassing), and an IOC rack for the cup's
  // data feed.
  const xfmr = game.placePlaceable({ type: 'padMountTransformer', col: -5, row: -1, free: true, silent: true });
  const pump = game.placePlaceable({ type: 'roughingPump', col: 4, row: -1, free: true, silent: true });
  const ioc  = game.placePlaceable({ type: 'rackIoc', col: 3, row: -1, free: true, silent: true });
  const skid = game.placePlaceable({ type: 'lcwSkid', col: -3, row: -1, free: true, silent: true });

  // Hard-required hookups: power + vacuum to every junction (fanout from one
  // source port is allowed and merges into a single network).
  if (xfmr) {
    wireUtility(game, 'powerCable', { id: xfmr, port: 'pwr_out' }, { id: src, port: 'pwr_in' });
    wireUtility(game, 'powerCable', { id: xfmr, port: 'pwr_out' }, { id: cup, port: 'pwr_in' });
  }
  if (pump) {
    wireUtility(game, 'vacuumPipe', { id: pump, port: 'vac_out' }, { id: src, port: 'vac_in' });
    wireUtility(game, 'vacuumPipe', { id: pump, port: 'vac_out' }, { id: cup, port: 'vac_in' });
  }
  if (ioc) {
    wireUtility(game, 'dataFiber', { id: ioc, port: 'data_out' }, { id: cup, port: 'data_in' });
  }
  // Soft-required cooling loop: gun collector heat into an LCW skid. Gives
  // the starter facility a live water reservoir (a recurring refill cost).
  if (skid) {
    wireUtility(game, 'coolingWater', { id: skid, port: 'cool_out' }, { id: src, port: 'cool_in' });
  }

  game.state.resources.funding = funding0;
  game.recalcAllBeamlines();
}
