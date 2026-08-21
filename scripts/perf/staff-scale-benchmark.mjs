import { performance } from 'node:perf_hooks';
import { StaffMember } from '../../src/game/staff/StaffMember.js';
import {
  STAFF_ROUTE_STARTS_PER_TICK,
  tickJobs,
} from '../../src/game/staff/jobRunner.js';

function nodeAt(index, side, reverse = false) {
  const tileCount = side * side;
  const tile = reverse
    ? tileCount - 1 - (index % tileCount)
    : index % tileCount;
  return {
    col: tile % side,
    row: Math.floor(tile / side),
    subCol: reverse ? 3 : 0,
    subRow: reverse ? 3 : 0,
  };
}

function makeFixture(staffCount, side = 18) {
  const infraOccupied = {};
  for (let col = 0; col < side; col++) {
    for (let row = 0; row < side; row++) {
      infraOccupied[`${col},${row}`] = 'concrete';
    }
  }

  const staffMembers = Array.from({ length: staffCount }, (_, index) => {
    const fromNode = nodeAt(index, side, false);
    const destNode = nodeAt(index, side, true);
    return new StaffMember({
      id: `scale_staff_${index}`,
      firstName: 'Scale',
      lastName: String(index),
      profession: 'admin',
      traits: [],
      shift: 'flex',
      fromNode,
      rng: () => 0.5,
      job: {
        jobType: 'paperwork',
        target: null,
        specialty: null,
        stationKey: null,
        destNode,
        phase: 'travel',
        progress: 0,
      },
    });
  });

  const state = {
    tick: 0,
    speed: 1,
    mapHalfExtent: side,
    navRevision: 1,
    infraOccupied,
    wallOccupied: {},
    doorOccupied: {},
    subgridOccupied: {},
    placeables: [],
    placeableIndex: {},
    zoneOccupied: {},
    zoneConnectivity: {},
    stationReservations: {},
    staffMembers,
    cornerHeights: new Map(),
  };
  return {
    state,
    registry: { getAll: () => [] },
    rng: () => 0.5,
  };
}

export function runOneStaffScaleBenchmark(staffCount, {
  side = 18,
  maxTicks = 160,
} = {}) {
  const game = makeFixture(staffCount, side);
  const tickTimes = [];
  let peakRouteStarts = 0;

  while (game.state.tick < maxTicks
      && game.state.staffMembers.some(member => member.job?.phase === 'travel')) {
    game.state.tick++;
    const started = performance.now();
    const result = tickJobs(game, { routinesEnabled: false });
    tickTimes.push(performance.now() - started);
    peakRouteStarts = Math.max(peakRouteStarts, result?.routeStarts || 0);
  }

  const arrived = game.state.staffMembers.filter(member => member.job?.phase === 'work').length;
  const totalMs = tickTimes.reduce((sum, value) => sum + value, 0);
  return {
    staffCount,
    ticks: game.state.tick,
    arrived,
    allArrived: arrived === staffCount,
    peakRouteStarts,
    routeStartBudget: STAFF_ROUTE_STARTS_PER_TICK,
    totalMs,
    meanTickMs: tickTimes.length ? totalMs / tickTimes.length : 0,
    maxTickMs: tickTimes.length ? Math.max(...tickTimes) : 0,
    presentationSnapshots: game.state.staffMembers
      .filter(member => member._staffPresentation?.sequence > 0).length,
  };
}

export function runStaffScaleBenchmark({ counts = [25, 50, 100] } = {}) {
  return counts.map(count => runOneStaffScaleBenchmark(count));
}
