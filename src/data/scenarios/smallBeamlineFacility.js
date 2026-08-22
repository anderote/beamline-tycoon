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
  const addFurn = (type, col, row, dir = 0, subCol = 1, subRow = 1) => placeables.push({ id: `fn_${nextId++}`, type, col, row, subCol, subRow, dir, kind: 'furnishing' });

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
  // Balance fix round 4: a diningTable is `seated: 'required'` (facility-
  // room-furnishings.raw.js) and only resolves a working `eat` StationRef
  // when a chair sits at the EXACT subtile each of its four anchors
  // declares (stations.js's seat-matching) — every OTHER piece of furniture
  // in this file is a single-anchor placeable where addFurn's flat
  // subCol:1/subRow:1 is a perfectly fine, arbitrary-but-valid position, but
  // a chair a whole TILE away from its table (the previous two lines here)
  // never matches any anchor at all. getStationIndex(state).byJob.eat was
  // EMPTY for this scenario — every player's staff has been permanently
  // unserviced from ~tick 160 since staff-professions-3's stations system
  // shipped; invisible until the balance fix's round-3 coverage-cap ruling
  // made an unserviced operator's beam coverage pay for it. Same anchor-
  // offset recipe test-staff-economy.js's own placeDiningTable helper uses,
  // verified against the real station index — all four seats, not two, so
  // this is a complete, working cafeteria table rather than a half one.
  const cafeTableCol = cafeRect.x0 + 1, cafeTableRow = cafeRect.y0 + 1;
  addFurn('diningTable', cafeTableCol, cafeTableRow, 0, 0, 0);
  addFurn('cafeteriaChair', cafeTableCol, cafeTableRow, 0, 0, 3);
  addFurn('cafeteriaChair', cafeTableCol, cafeTableRow - 1, 2, 1, 2);
  addFurn('cafeteriaChair', cafeTableCol - 1, cafeTableRow, 1, 2, 0);
  addFurn('cafeteriaChair', cafeTableCol, cafeTableRow, 3, 3, 1);
  addFurn('vendingMachine', cafeRect.x1, cafeRect.y0, 3);
  // toolChest (station.jobs: ['rest'], seated: 'never' — facility-lab-
  // furnishings.raw.js): a single free-standing anchor, no seat-matching
  // needed, so addFurn's own flat subCol:1/subRow:1 works here same as
  // every other single-anchor item in this file. The scenario shipped with
  // NO rest station of any kind before this fix — fatigue was permanently
  // unserviceable for every staffer, same bug class as the missing seats.
  addFurn('toolChest', cafeRect.x0 + 4, cafeRect.y0, 0);
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

  // Service row (north). The ordinary branch loads total 102 kW — gun 50,
  // cavities 30, quad 10, buncher 5, cup + BPM 2 and support gear 5. The RF
  // amplifier is a separate 70 kW HV feeder, so this uses the 1.5 MW service
  // transformer tier and its matching main distribution panel rather than the
  // 150 kW pad-mount starter.
  // RF: the buncher and the three pillbox cavities are all 162.5 MHz, so they
  // share one network — which is the point of the low-band consolidation. Only
  // the SSA and the TWT cover VHF, and the SSA (35 kW against 17 kW of demand)
  // is the one with the power.
  const servicePoint = game.placePlaceable({ type: 'gridServicePoint', col: -26, row: -1, free: true, silent: true });
  const xfmr = game.placePlaceable({ type: 'hvTransformer', col: -8, row: -1, free: true, silent: true });
  const mainPanel = game.placePlaceable({ type: 'mainDistributionPanel', col: -5, row: -1, free: true, silent: true });
  const roomPanel = game.placePlaceable({ type: 'powerPanel', col: -8, row: 4, free: true, silent: true });
  const skid = game.placePlaceable({ type: 'lcwSkid', col: -3, row: -1, free: true, silent: true });
  // Rigid waveguide needs a service lane of its own rather than sharing the
  // beamline's north edge. Put the amplifier against the outer wall so its
  // four west-facing launchers open into that lane.
  const ssa  = game.placePlaceable({ type: 'solidStateAmp', col: -2, row: -3, free: true, silent: true });
  const ioc  = game.placePlaceable({ type: 'rackIoc', col: 3, row: -1, free: true, silent: true });
  const operatorConsole = game.state.placeables.find(p => p.type === 'operatorConsole')?.id;
  const monitorBank = game.state.placeables.find(p => p.type === 'monitorBank')?.id;
  const captureRack = game.state.placeables.find(p => p.type === 'serverRack')?.id;
  // Vacuum: the six on-pipe chambers outgas ~4.2e-6 on top of the junctions'
  // 1.2e-6, and pressure is total outgassing over total pump speed — a 15 L/s
  // roughing pump alone lands at 3.6e-7 mbar, i.e. every component on the pipe
  // running at 0.61 vacuum quality. The turbo (300 L/s, roughing-pump-backed,
  // as in the real thing) takes the whole line to ~1.7e-8.
  const pump = game.placePlaceable({ type: 'roughingPump', col: 4, row: -1, free: true, silent: true });

  // Distribution row (south). The busway's eight real tap boxes cover the
  // nearby on-pipe loads; vacuum manifolds only reach 5, so the run needs two.
  const pwrBus  = game.placePlaceable({ type: 'powerBus', col: 0, row: 1, free: true, silent: true });
  const vacW    = game.placePlaceable({ type: 'vacuumManifold', col: -3, row: 1, free: true, silent: true });
  const vacE    = game.placePlaceable({ type: 'vacuumManifold', col: 3, row: 1, free: true, silent: true });
  // A dedicated north-wall RF lane leaves room for real straight flange
  // launches and swept elbows without colliding with beam hardware below.
  const wgBus   = game.placePlaceable({ type: 'waveguideManifold', col: -4, row: -3, free: true, silent: true });
  // Turbo sits on the distribution row and taps the east manifold's spare
  // port: a sink/pass port takes ONE line, and the roughing pump already
  // holds every bus_left.
  const turbo   = game.placePlaceable({ type: 'turboPump', col: 5, row: 1, free: true, silent: true });
  // The SSA sits outside the beam-hall north wall. Its dedicated HV feeder is
  // therefore two terminated cable runs joined by a rated wall bushing.
  const ssaFeedthrough = game.placePlaceable({
    type: 'hvWallPassThrough', col: -2, row: -1,
    wallMount: { col: -2, row: -1, edge: 'n', off: 1 },
    free: true, silent: true,
  });

  const wire = (util, from, to) => wireUtility(game, util, from, to);

  // The transformer is fed by the map-edge utility service. Its secondary
  // feeders are live only after this rated primary connection is present. The
  // scenario's substation row has a deliberate service entrance opening in
  // the west wall, matching the off-map feeder corridor.
  delete game.state.wallOccupied['-8,-1,w'];
  delete game.state.wallOccupied['-8,-2,w'];
  if (servicePoint && xfmr) wire('hvCable', { id: servicePoint, port: 'hv_out_1' }, { id: xfmr, port: 'hv_in' });

  // Power runs supply → main distribution → branches.
  //
  // The transformer can carry up to its 1.5 MW nameplate. The matching main
  // panel turns one HV feeder into eight 50 kW branch circuits; it adds no
  // capacity and draws only the load connected to those branches.
  if (xfmr && mainPanel) wire('hvCable', { id: xfmr, port: 'hv_out_1' }, { id: mainPanel, port: 'hv_in' });
  // RF sources are dedicated high-voltage loads, not branch-circuit loads.
  if (xfmr && ssa && ssaFeedthrough) {
    wire('hvCable', { id: xfmr, port: 'hv_out_2' }, { id: ssaFeedthrough, port: 'hv_in' });
    wire('hvCable', { id: ssaFeedthrough, port: 'hv_out' }, { id: ssa, port: 'hv_in' });
  }
  if (xfmr && roomPanel) wire('hvCable', { id: xfmr, port: 'hv_out_3' }, { id: roomPanel, port: 'hv_in' });
  if (mainPanel) {
    // Six support loads plus the busway use seven of the panel's eight circuits.
    const loads = [[src, 'pwr_in'], [cup, 'pwr_in'], [skid, 'pwr_in'],
      [ioc, 'pwr_in'], [pump, 'pwr_in'], [turbo, 'pwr_in'],
      [pwrBus, 'pwr_in']];
    loads.forEach(([id, port], i) => {
      if (id) wire('powerCable', { id: mainPanel, port: `pwr_out_${i + 1}` }, { id, port });
    });
  }
  if (roomPanel) {
    [operatorConsole, monitorBank, captureRack].forEach((id, i) => {
      if (id) wire('powerCable', { id: roomPanel, port: `pwr_out_${i + 1}` }, { id, port: 'pwr_in' });
    });
  }

  // Both pumps land on the one vacuum network — pump speed sums across a
  // network, so the turbo backs the whole line, not just the cup.
  // Give the east pump its short manifold branch before the west pump's
  // three-way fanout occupies the shared service lanes.
  if (turbo && vacE) wire('vacuumPipe', { id: turbo, port: 'vac_out' }, { id: vacE, port: 'bus_right' });
  if (pump) {
    // Install the west-manifold trunk first so it owns the long service aisle;
    // the two short junction branches can then leave the pump on either side.
    // If the source branch is routed first it naturally occupies that aisle,
    // boxing the later trunk against the beam-mounted equipment now that its
    // physical (rather than shifted logical) footprint is authoritative.
    for (const [id, port] of [[vacW, 'bus_left'], [src, 'vac_in'],
      [cup, 'vac_in']]) {
      if (id) wire('vacuumPipe', { id: pump, port: 'vac_out' }, { id, port });
    }
  }

  // RF: one waveguide run into the manifold feeds the buncher and all three
  // cavities.
  if (ssa && wgBus) wire('rfWaveguide', { id: ssa, port: 'rf_out_1' }, { id: wgBus, port: 'bus_left' });

  // Cooling: gun collector heat plus the one quadrupole. A single magnet does
  // not earn a header, so it gets a stub. The starter LCW skid is a complete
  // package: its tank, pump and air-cooled rejection live in the enclosure.
  if (skid) {
    if (src) wire('coolingWater', { id: skid, port: 'cool_out' }, { id: src, port: 'cool_in' });
    if (quad) wire('coolingWater', { id: skid, port: 'cool_out' }, { id: quad, port: 'cool_in' });
  }

  // Data: soft-gated, but an unwired diagnostic still derates data income.
  if (captureRack) {
    // Science streams terminate at the Control Room DAQ gateway. The IOC
    // remains the machine-controls source, but it is not raw-data capture.
    if (cup) wire('dataFiber', { id: captureRack, port: 'data_out' }, { id: cup, port: 'data_in' });
    if (bpm) wire('dataFiber', { id: captureRack, port: 'data_out' }, { id: bpm, port: 'data_in' });
    if (operatorConsole) wire('dataFiber', { id: captureRack, port: 'data_out' }, { id: operatorConsole, port: 'data_in' });
    if (monitorBank) wire('dataFiber', { id: captureRack, port: 'data_out' }, { id: monitorBank, port: 'data_in' });
  }

  game.state.resources.funding = funding0;
  game.recalcAllBeamlines();
}
