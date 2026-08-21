// Staff MVP contracts: simulation-owned motion, soft downtime, explicit
// profession hiring, and job-specific presentation poses.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import { assignJobs, tickJobs, STAFF_DOWNTIME_TICKS } from '../src/game/staff/jobRunner.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { PROFESSIONS } from '../src/data/professions.js';
import { staffPoseFor } from '../src/renderer3d/staff-pose.js';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function makeState() {
  return {
    tick: 10,
    mapHalfExtent: 20,
    infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeableIndex: {}, placeables: [], zoneOccupied: {}, zoneConnectivity: {},
    stationReservations: {}, staffMembers: [], navRevision: 0,
    resources: { funding: 100000, reputation: 0, data: 0, spares: 10 },
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow) {
  for (let col = minCol; col <= maxCol; col++) {
    for (let row = minRow; row <= maxRow; row++) {
      state.infraOccupied[`${col},${row}`] = 'concrete';
    }
  }
}

let nextPlaceableId = 1;
function placeItem(state, type, col, row, subCol = 0, subRow = 0, dir = 0) {
  const def = PLACEABLES[type];
  const id = `${type}_${nextPlaceableId++}`;
  const cells = def.footprintCells(col, row, subCol, subRow, dir);
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const cell of cells) {
    state.subgridOccupied[`${cell.col},${cell.row},${cell.subCol},${cell.subRow}`] = {
      id, kind: def.kind,
    };
  }
  return entry;
}

console.log('\n=== Six-role hiring stays controllable ===\n');
{
  const game = new Game(new BeamlineRegistry(), { seed: 123 });
  const roles = game.state.staffCandidates.map(candidate => candidate.profession);
  assert(roles.length === Object.keys(PROFESSIONS).length,
    `the pool has one slot per profession (${roles.length})`);
  assert(new Set(roles).size === Object.keys(PROFESSIONS).length,
    'every profession appears exactly once');

  const index = roles.indexOf('scientist');
  const candidate = game.state.staffCandidates[index];
  const hired = game.hireStaffMember(candidate.id);
  const replacement = game.state.staffCandidates[index];
  assert(hired?.profession === 'scientist', 'the selected profession is hired');
  assert(replacement?.profession === 'scientist' && replacement.id !== candidate.id,
    'the hired role is immediately replenished with a fresh candidate');
}

console.log('\n=== Finite work -> cafeteria -> wander -> work is a safe soft routine ===\n');
{
  const state = makeState();
  floorRect(state, 0, 12, 0, 12);
  placeItem(state, 'desk', 2, 2);
  const table = placeItem(state, 'diningTable', 8, 8);
  placeItem(state, 'cafeteriaChair', table.col, table.row, 0, 3);
  state.navRevision++;

  const admin = new StaffMember({
    id: 'admin_1', profession: 'admin', traits: [],
    skills: { operating: 5, technical: 5, research: 5, construction: 5, admin: 5 },
    rng: () => 0.5,
  });
  state.staffMembers = [admin];
  const game = { state, registry: { getAll: () => [] }, rng: () => 0.42 };

  assignJobs(game, { breaksEnabled: false, routinesEnabled: true });
  assert(admin.job?.jobType === 'paperwork', 'the admin first takes productive desk work');

  // This test starts at the completion boundary; movement itself is already
  // covered by jobRunner's long-walk integration and scenario tests.
  admin.job.phase = 'work';
  admin.job.progress = 80;
  tickJobs(game, { routinesEnabled: true });
  assert(admin.job === null && admin.routineUntil === state.tick + STAFF_DOWNTIME_TICKS,
    'finite work schedules a bounded downtime window');

  assignJobs(game, { breaksEnabled: false, routinesEnabled: true });
  assert(admin.job?.jobType === 'eat' && admin.job.routine === true,
    'downtime uses a reachable cafeteria when one exists');

  let mealCompleted = false;
  for (let i = 0; i < STAFF_DOWNTIME_TICKS && !mealCompleted; i++) {
    state.tick++;
    tickJobs(game, { routinesEnabled: true });
    mealCompleted = admin.job === null;
  }
  assert(mealCompleted, 'the cafeteria visit completes within the downtime window');

  const afterMeal = { ...admin.fromNode };
  for (let i = 0; i < 8 && state.tick < admin.routineUntil; i++) {
    state.tick++;
    assignJobs(game, { breaksEnabled: false, routinesEnabled: true });
    tickJobs(game, { routinesEnabled: true });
  }
  assert(admin.job === null && admin.idleReason === 'Taking a short break.',
    'remaining downtime stays non-blocking and legible');
  assert(JSON.stringify(admin.fromNode) !== JSON.stringify(afterMeal),
    'jobless downtime advances ambient wandering in the simulation');

  while (state.tick <= admin.routineUntil) {
    state.tick++;
    assignJobs(game, { breaksEnabled: false, routinesEnabled: true });
    tickJobs(game, { routinesEnabled: true });
  }
  assignJobs(game, { breaksEnabled: false, routinesEnabled: true });
  assert(admin.job?.jobType === 'paperwork', 'the admin returns to productive work afterward');
}

console.log('\n=== Staff position/routine state survives save-load without path caches ===\n');
{
  const member = new StaffMember({
    id: 'save_1', profession: 'operator', traits: [], rng: () => 0.5,
    fromNode: { col: 3, row: 4, subCol: 1, subRow: 2 },
    routineUntil: 77, routineMealTaken: true,
    job: {
      jobType: 'runBeam', phase: 'travel', progress: 0,
      travelPath: [{ col: 0, row: 0, subCol: 0, subRow: 0 }],
      travelPathIndex: 1, travelPathRevision: 2,
    },
  });
  member._staffPresentation = {
    sequence: 3,
    nodes: [{ col: 3, row: 4, subCol: 2, subRow: 2 }],
  };
  const json = member.toJSON();
  const loaded = StaffMember.fromJSON(json);
  assert(JSON.stringify(loaded.fromNode) === JSON.stringify(member.fromNode),
    'authoritative position round-trips');
  assert(loaded.routineUntil === 77 && loaded.routineMealTaken === true,
    'soft routine state round-trips');
  assert(!('travelPath' in json.job)
      && !('_staffPresentation' in json)
      && loaded._staffMotion === null
      && loaded._staffPresentation === null,
    'transient path and presentation caches are not serialized');
}

console.log('\n=== Visible poses distinguish desks, seats, benches and walking ===\n');
{
  assert(staffPoseFor({ mode: 'working', seated: true, jobType: 'runBeam' }) === 'deskWork',
    'seated console work uses deskWork');
  assert(staffPoseFor({ mode: 'working', seated: true, jobType: 'eat' }) === 'sit',
    'cafeteria activity uses the ordinary seated pose');
  assert(staffPoseFor({ mode: 'working', seated: false, jobType: 'repair' }) === 'benchWork',
    'standing technical work uses benchWork');
  assert(staffPoseFor({ mode: 'pathWalk', seated: true, jobType: 'paperwork' }) === 'walk',
    'travel always uses the walk pose');
  assert(staffPoseFor({ mode: 'simTravel', seated: false, jobType: 'repair' }) === 'walk',
    'simulation-published travel uses the same walking pose');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
