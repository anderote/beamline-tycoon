// test/test-steady-workers.js — temporary no-break gameplay mode

import { StaffMember } from '../src/game/staff/StaffMember.js';
import { STAFF_BREAKS_ENABLED, tickStaffMember } from '../src/game/staff/staffSystem.js';
import { assignJobs } from '../src/game/staff/jobRunner.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

console.log('\n=== Workers stay productive while breaks are disabled ===\n');

assert(STAFF_BREAKS_ENABLED === false, 'the live gameplay switch disables staff breaks');

{
  const member = new StaffMember({
    id: 'steady-worker', profession: 'operator', traits: [], rng: () => 0.5,
  });
  member.status = 'resting';
  member._restTimer = 20;
  member.needs = { fatigue: 1, hunger: 1, morale: 0.05 };
  member.unservicedPenalty = true;
  member.job = { jobType: 'runBeam', phase: 'work', progress: 0 };
  const skillBefore = member.skills[member.primarySkill];

  const changed = tickStaffMember(member, {
    isNight: false, cafeteriaTier: 0, zoneTier: 0, rng: () => 0,
    breaksEnabled: STAFF_BREAKS_ENABLED,
  });

  assert(changed && member.status === 'working', 'a worker already on a break returns to working immediately');
  assert(member._restTimer === null, 'the old break timer is cleared');
  assert(member.needs.fatigue === 0 && member.needs.hunger === 0,
    'hunger and fatigue no longer accumulate or linger');
  assert(member.needs.morale >= 0.6 && member.unservicedPenalty === false,
    'old stress and unserviced-needs penalties are cleared');
  assert(member.stats.ticksWorked === 1 && member.skills[member.primarySkill] > skillBefore,
    'an active work job still counts as productive work and grants normal skill progress');
}

{
  const member = new StaffMember({
    id: 'mid-meal-worker', profession: 'operator', traits: [], rng: () => 0.5,
  });
  member.needs = { fatigue: 1, hunger: 1, morale: 0.6 };
  member.job = {
    jobType: 'eat', target: null, specialty: null, stationKey: 'table:0',
    destNode: null, phase: 'work', progress: 5,
  };
  const state = {
    infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeableIndex: {}, placeables: [], zoneOccupied: {}, zoneConnectivity: {},
    stationReservations: { 'table:0': member.id }, staffMembers: [member],
    resources: { funding: 0, reputation: 0, data: 0, spares: 0 }, navRevision: 0,
  };
  const game = { state, registry: { getAll: () => [] } };

  assignJobs(game, { breaksEnabled: STAFF_BREAKS_ENABLED });

  assert(member.job === null, 'an in-progress eat/rest job is removed instead of continuing the break');
  assert(state.stationReservations['table:0'] == null, 'its station reservation is released');
  assert(member.unservicedPenalty === false, 'high legacy needs do not reapply a work penalty');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
