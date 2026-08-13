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
// wire it so it comes up GREEN under utility gating (an operator pawn is
// seeded by Game itself). Runs through the normal Game APIs after
// applyScenario(). The facility is pre-built, so the player's starting funding
// is restored afterwards.
//
// Every ON-PIPE component (buncher, cavities, quad, BPM) declares its own
// power / vacuum / RF / cooling sinks and each one is gated individually, so
// the starter layout has to demonstrate the two ways of feeding them:
// distribution buses where a whole run shares one utility (power, vacuum, RF)
// and point-to-point stubs where a single component needs a single feed
// (the quad's cooling, the BPM's fiber).
export function setupSmallBeamlineFacility(game) {
  const funding0 = game.state.resources.funding;

  // Beam hall interior: rows -1..1, cols -7..8 (see generator above).
  // Beamline runs west→east along row 0; row -1 is the service row for
  // sources, row 1 the distribution row for buses.
  const src = game.beamline.placeJunction({ type: 'source', col: -6, row: 0, dir: 3, free: true, silent: true });
  const cup = game.beamline.placeJunction({ type: 'faradayCup', col: 6, row: 0, dir: 3, free: true, silent: true });
  if (!src || !cup) { console.warn('[scenario] smallBeamlineFacility: junction placement failed'); return; }

  const pipe = game.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: cup, portName: 'entry' },
    [{ col: -6, row: 0 }, { col: 6, row: 0 }],
  );
  // Snapped centres, west→east: buncher -4.79, cavities -2.75 / -0.95 / 0.85,
  // quad 2.89, BPM 4.69. Bus reaches below are checked against those.
  let placements = [];
  if (pipe) {
    placements = [
      ['buncher',       0.08],
      ['pillboxCavity', 0.25],
      ['pillboxCavity', 0.40],
      ['pillboxCavity', 0.55],
      ['quadrupole',    0.72],
      ['bpm',           0.88],
    ].map(([type, position]) =>
      game.beamline.placeOnPipe(pipe, { type, position, mode: 'snap', free: true }));
  }
  // Only the two stub-wired components are named; the rest are bus-fed.
  const quad = placements[4];
  const bpm = placements[5];

  // Service row (north). Power: 172 kW total draw — gun 50, cavities 30,
  // quad 10, buncher 5, cup + BPM 2, support gear 5, and the amplifier's 70 —
  // so the feed is a 400 kW switchgear cabinet, not a 150 kW pad-mount.
  // RF: the buncher and the three pillbox cavities are all 162.5 MHz, so they
  // share one network — which is the point of the low-band consolidation. Only
  // the SSA and the TWT cover VHF, and the SSA (35 kW against 17 kW of demand)
  // is the one with the power.
  const gear = game.placePlaceable({ type: 'switchgear', col: -5, row: -1, free: true, silent: true });
  const skid = game.placePlaceable({ type: 'lcwSkid', col: -3, row: -1, free: true, silent: true });
  const ssa  = game.placePlaceable({ type: 'solidStateAmp', col: 0, row: -1, free: true, silent: true });
  const ioc  = game.placePlaceable({ type: 'rackIoc', col: 3, row: -1, free: true, silent: true });
  // Vacuum: the six on-pipe chambers outgas ~4.2e-6 on top of the junctions'
  // 1.2e-6, and pressure is total outgassing over total pump speed — a 15 L/s
  // roughing pump alone lands at 3.6e-7 mbar, i.e. every component on the pipe
  // running at 0.61 vacuum quality. The turbo (300 L/s, roughing-pump-backed,
  // as in the real thing) takes the whole line to ~1.7e-8.
  const pump = game.placePlaceable({ type: 'roughingPump', col: 4, row: -1, free: true, silent: true });

  // Distribution row (south). One power bus (reach 10) spans the whole run;
  // vacuum manifolds only reach 5, so the run needs two.
  const pwrBus  = game.placePlaceable({ type: 'powerBus', col: 0, row: 1, free: true, silent: true });
  const vacW    = game.placePlaceable({ type: 'vacuumManifold', col: -3, row: 1, free: true, silent: true });
  const vacE    = game.placePlaceable({ type: 'vacuumManifold', col: 3, row: 1, free: true, silent: true });
  const wgBus   = game.placePlaceable({ type: 'waveguideManifold', col: -2, row: 1, free: true, silent: true });
  // Turbo sits on the distribution row and taps the east manifold's spare
  // port: a sink/pass port takes ONE line, and the roughing pump already
  // holds every bus_left.
  const turbo   = game.placePlaceable({ type: 'turboPump', col: 5, row: 1, free: true, silent: true });

  const wire = (util, from, to) => wireUtility(game, util, from, to);

  // Power: junctions and the support gear take their own feeds; every on-pipe
  // sink comes in through the bus (one line instead of six).
  if (gear) {
    for (const [id, port] of [[src, 'pwr_in'], [cup, 'pwr_in'], [skid, 'pwr_in'],
      [ssa, 'pwr_in'], [ioc, 'pwr_in'], [pump, 'pwr_in'], [turbo, 'pwr_in'],
      [pwrBus, 'bus_left']]) {
      if (id) wire('powerCable', { id: gear, port: 'pwr_out' }, { id, port });
    }
  }

  // Both pumps land on the one vacuum network — pump speed sums across a
  // network, so the turbo backs the whole line, not just the cup.
  if (pump) {
    for (const [id, port] of [[src, 'vac_in'], [cup, 'vac_in'],
      [vacW, 'bus_left'], [vacE, 'bus_left']]) {
      if (id) wire('vacuumPipe', { id: pump, port: 'vac_out' }, { id, port });
    }
  }
  if (turbo && vacE) wire('vacuumPipe', { id: turbo, port: 'vac_out' }, { id: vacE, port: 'bus_right' });

  // RF: one waveguide run into the manifold feeds the buncher and all three
  // cavities.
  if (ssa && wgBus) wire('rfWaveguide', { id: ssa, port: 'rf_out' }, { id: wgBus, port: 'bus_left' });

  // Cooling: gun collector heat plus the one quadrupole. A single magnet does
  // not earn a header, so it gets a stub. Gives the starter facility a live
  // water reservoir (a recurring refill cost).
  if (skid) {
    if (src) wire('coolingWater', { id: skid, port: 'cool_out' }, { id: src, port: 'cool_in' });
    if (quad) wire('coolingWater', { id: skid, port: 'cool_out' }, { id: quad, port: 'cool_in' });
  }

  // Data: soft-gated, but an unwired diagnostic still derates data income.
  if (ioc) {
    if (cup) wire('dataFiber', { id: ioc, port: 'data_out' }, { id: cup, port: 'data_in' });
    if (bpm) wire('dataFiber', { id: ioc, port: 'data_out' }, { id: bpm, port: 'data_in' });
  }

  game.state.resources.funding = funding0;
  game.recalcAllBeamlines();
}
