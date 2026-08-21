import { PLACEABLES } from '../src/data/placeables/index.js';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import { assignJobs } from '../src/game/staff/jobRunner.js';
import { buildStationIndex } from '../src/game/staff/stations.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

const state = {
  tick: 0, mapHalfExtent: 12, navRevision: 1,
  infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
  placeableIndex: {}, placeables: [], zoneOccupied: {}, zoneConnectivity: {},
  stationReservations: {}, staffMembers: [],
  resources: { funding: 100000, reputation: 0, data: 0, spares: 10 },
};
for (let col = 0; col <= 9; col++) {
  for (let row = 0; row <= 6; row++) state.infraOccupied[`${col},${row}`] = 'officeFloor';
}

let nextId = 1;
function place(type, col, row, zoneType) {
  const def = PLACEABLES[type];
  const id = `${type}_${nextId++}`;
  const entry = { id, type, kind: def.kind, col, row, subCol: 0, subRow: 0, dir: 0,
    cells: def.footprintCells(col, row, 0, 0, 0) };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  state.zoneOccupied[`${col},${row}`] = zoneType;
  for (const cell of entry.cells) state.subgridOccupied[`${cell.col},${cell.row},${cell.subCol},${cell.subRow}`] = { id, kind: def.kind };
  return entry;
}

const shared = place('sharedDesk', 2, 2, 'officeSpace');
const privateDesk = place('privateOfficeDesk', 6, 2, 'privateOffice');
const privateIndex = buildStationIndex(state);
assert(privateIndex.byJob.officeWork?.some(ref => ref.placeableId === shared.id), 'shared desk publishes an officeWork station');
assert(privateIndex.byJob.privateOfficeWork?.some(ref => ref.placeableId === privateDesk.id), 'private desk publishes a privateOfficeWork station');

const technician = new StaffMember({ id: 'tech', profession: 'technician', traits: [],
  assignment: { zoneId: 'maintenance', beamlineId: null }, rng: () => 0.5 });
const scientist = new StaffMember({ id: 'scientist', profession: 'scientist', traits: [],
  assignment: { zoneId: 'privateOffice', beamlineId: null }, rng: () => 0.5 });
state.staffMembers = [technician, scientist];
const game = { state, registry: { getAll: () => [] }, rng: () => 0.5 };

assignJobs(game, { breaksEnabled: false, routinesEnabled: false });
assert(technician.job?.jobType === 'officeWork', 'a general staff member claims a shared office desk');
assert(scientist.job?.jobType === 'privateOfficeWork', 'a scientist assigned to private office claims its private desk');
assert(Object.values(state.stationReservations).sort().join(',') === 'scientist,tech', 'each employee claims a distinct desk slot');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
