// Minor Lab — a compact, editable starter for scenario authors.
//
// This deliberately begins with a working control nook rather than a prebuilt
// accelerator. It gives authors a small, powered facility to reshape, then
// Scenario Admin's Save + Playtest loop can turn their revision into a local
// sandbox starting situation without changing this stock baseline.

import { wireUtility } from './scenario-wiring.js';

export function generateMinorLab() {
  const floors = [];
  const zones = [];
  const placeables = [];
  let nextId = 1;
  const addFloor = (type, col, row) => floors.push({ type, col, row });
  const addZone = (type, col, row) => zones.push({ type, col, row });
  const addFurn = (type, col, row, subCol = 1, subRow = 1, dir = 0) => {
    placeables.push({ id: `fn_${nextId++}`, type, col, row, subCol, subRow, dir, kind: 'furnishing' });
  };

  // A 6 × 5 finished footprint: compact enough to remake quickly while
  // retaining a staffed control room and the normal staff-care stations.
  for (let col = -3; col <= 2; col++) {
    for (let row = -2; row <= 2; row++) addFloor('officeFloor', col, row);
  }
  for (let col = -3; col <= -1; col++) {
    for (let row = -2; row <= 0; row++) addZone('controlRoom', col, row);
  }
  for (let col = -3; col <= 2; col++) addFloor('hallway', col, 1);

  addFurn('operatorConsole', -2, -1, 1, 1, 1);
  addFurn('monitorBank', -1, -1, 0, 0, 0);
  addFurn('operatorChair', -2, 0, 0, 0, 0);
  addFurn('serverRack', 0, -1, 0, 0, 2);

  // A complete four-seat table supplies valid eat stations; the tool chest
  // supplies a rest station. Both make an immediately playtestable baseline.
  addFurn('diningTable', 0, 0, 0, 0, 0);
  addFurn('cafeteriaChair', 0, 0, 0, 3, 0);
  addFurn('cafeteriaChair', 0, -1, 1, 2, 2);
  addFurn('cafeteriaChair', -1, 0, 2, 0, 1);
  addFurn('cafeteriaChair', 0, 0, 3, 1, 3);
  addFurn('toolChest', 2, 0, 1, 1, 0);

  return {
    floors, zones, walls: [], doors: [], placeables,
    placeableNextId: nextId,
    cornerHeights: new Map(),
    infraBlockers: [],
  };
}

// Bring the initially placed control equipment up through the ordinary utility
// APIs. The stock layout is free to load, so restore the player's normal
// starting funding after constructing the service infrastructure.
export function setupMinorLab(game) {
  const funding0 = game.state.resources.funding;
  const servicePoint = game.placePlaceable({ type: 'gridServicePoint', col: -26, row: 0, free: true, silent: true });
  const transformer = game.placePlaceable({ type: 'padMountTransformer', col: -6, row: 0, free: true, silent: true });
  const panel = game.placePlaceable({ type: 'powerPanel', col: -4, row: 0, free: true, silent: true });
  const consoleId = game.state.placeables.find(p => p.type === 'operatorConsole')?.id;
  const monitorId = game.state.placeables.find(p => p.type === 'monitorBank')?.id;
  const captureId = game.state.placeables.find(p => p.type === 'serverRack')?.id;
  const wire = (utilityType, from, to) => wireUtility(game, utilityType, from, to);

  if (servicePoint && transformer) wire('hvCable', { id: servicePoint, role: 'source' }, { id: transformer, role: 'sink' });
  if (transformer && panel) wire('hvCable', { id: transformer, role: 'source' }, { id: panel, role: 'sink' });
  for (const [index, id] of [consoleId, monitorId, captureId].entries()) {
    if (panel && id) wire('powerCable', { id: panel, role: 'source', index }, { id, role: 'sink' });
  }
  if (captureId) {
    for (const id of [consoleId, monitorId]) {
      if (id) wire('dataFiber', { id: captureId, role: 'pass' }, { id, role: 'sink' });
    }
  }
  game.state.resources.funding = funding0;
}
