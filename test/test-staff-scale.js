import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStaffScaleBenchmark } from '../scripts/perf/staff-scale-benchmark.mjs';
import { StaffMember } from '../src/game/staff/StaffMember.js';
import {
  assignJobs,
  STAFF_ASSIGNMENT_STARTS_PER_TICK,
} from '../src/game/staff/jobRunner.js';

test('25/50/100 simultaneous staff trips complete within the route-start budget', () => {
  const rows = runStaffScaleBenchmark();
  for (const row of rows) {
    assert.equal(row.allArrived, true,
      `${row.staffCount} staff: only ${row.arrived} arrived in ${row.ticks} ticks`);
    assert.ok(row.peakRouteStarts <= row.routeStartBudget,
      `${row.staffCount} staff started ${row.peakRouteStarts} routes in one tick`);
    assert.equal(row.presentationSnapshots, row.staffCount,
      `${row.staffCount} staff did not all publish presentation movement`);
  }
});

test('a 100-person idle burst rotates through a bounded assignment window', () => {
  const fromNode = { col: 0, row: 0, subCol: 0, subRow: 0 };
  const staffMembers = Array.from({ length: 100 }, (_, index) => new StaffMember({
    id: `idle_${index}`,
    firstName: 'Idle',
    lastName: String(index),
    profession: 'admin',
    traits: [],
    fromNode,
    rng: () => 0.5,
  }));
  const state = {
    tick: 0,
    mapHalfExtent: 2,
    navRevision: 1,
    infraOccupied: { '0,0': 'concrete' },
    wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeables: [], placeableIndex: {}, zoneOccupied: {}, zoneConnectivity: {},
    stationReservations: {}, staffMembers,
    resources: { funding: 0, reputation: 0, data: 0, spares: 0 },
    cornerHeights: new Map(),
  };
  const game = { state, registry: { getAll: () => [] }, rng: () => 0.5 };

  assignJobs(game, { breaksEnabled: false, routinesEnabled: false });
  const inspectedOnFirstTick = staffMembers.filter(
    member => member.idleReason !== 'Waiting for the next assignment pass.',
  ).length;
  assert.equal(inspectedOnFirstTick, STAFF_ASSIGNMENT_STARTS_PER_TICK);

  for (let tick = 1; tick <= 9; tick++) {
    state.tick = tick;
    assignJobs(game, { breaksEnabled: false, routinesEnabled: false });
  }
  assert.ok(staffMembers.every(member => member.idleReason === 'Nothing to do right now.'),
    'the rotating window eventually gives every employee a real assignment scan');
});
