// test/test-rigid-utility-routing.js — physical routing rules for vacuum/RF.

import {
  expandPath,
  findObstacleAwareRoute,
  hasMinimumBendClearance,
} from '../src/utility/line-geometry.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { buildRigidRouteObstacles } from '../src/utility/route-obstacles.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { gridToIso } from '../src/renderer/grid.js';

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function pointKey(point) {
  return `${Math.round(point.col * 4)}:${Math.round(point.row * 4)}`;
}

console.log('\n--- 1. Installed rigid services cannot cross ---');
{
  const state = {
    placeables: [], beamPipes: [],
    utilityLines: new Map([['rf', {
      id: 'rf', utilityType: 'rfWaveguide', start: null, end: null,
      path: [{ col: 2, row: -2 }, { col: 2, row: 2 }],
    }]]),
  };
  const crossed = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  });
  assert(!crossed.ok && crossed.reason === 'overlap_rigid_service',
    `vacuum refuses to pass through waveguide (${crossed.reason})`);

  const cable = validateDrawLine(state, {
    utilityType: 'powerCable', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  });
  assert(cable.ok, 'a loose power cord keeps its independent crossing behavior');

  const vacuumState = {
    placeables: [], beamPipes: [],
    utilityLines: new Map([['trunk', {
      id: 'trunk', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
    }]]),
  };
  const tee = validateDrawLine(vacuumState, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 2, row: 0 }, { col: 2, row: 2 }],
    tapLineIds: { start: 'trunk' },
  });
  assert(tee.ok && tee.line.tapLineIds?.start === 'trunk',
    'a named perpendicular vacuum tee clears its fitting envelope and persists the join');
  const hiddenDuplicate = validateDrawLine(vacuumState, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 2, row: 0 }, { col: 3, row: 0 }],
    tapLineIds: { start: 'trunk' },
  });
  assert(!hiddenDuplicate.ok, 'a tap cannot license a collinear pipe hidden inside its trunk');
}

console.log('\n--- 2. Board-aware search finds the service aisle around a blocker ---');
{
  const state = {
    placeables: [], beamPipes: [],
    utilityLines: new Map([['guide', {
      id: 'guide', utilityType: 'rfWaveguide', start: null, end: null,
      path: [{ col: 2, row: -1 }, { col: 2, row: 1 }],
    }]]),
  };
  const obstacles = buildRigidRouteObstacles(state, 'vacuumPipe');
  const route = findObstacleAwareRoute(
    { col: 0, row: 0 }, null,
    { col: 4, row: 0 }, null,
    { portClearance: false, blocked: obstacles.isBlocked, bendPenalty: 1.5 },
  );
  assert(route && route.length >= 4, `a detour was found (${JSON.stringify(route)})`);
  assert(route && expandPath(route).every(point => !obstacles.isBlocked(point.col, point.row)),
    'every detour centreline point clears the installed guide');
  const committed = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: route,
  });
  assert(committed.ok, `the pathfinder result is commit-valid (${committed.reason || 'ok'})`);
}

console.log('\n--- 3. Equipment footprints are solid to rigid routes ---');
{
  const state = {
    defs: { blocker: { subW: 4, subL: 8, ports: {} } },
    placeables: [{ id: 'machine', type: 'blocker', col: 2, row: -1, dir: 0 }],
    beamPipes: [], utilityLines: new Map(),
  };
  const direct = [{ col: 0, row: 0 }, { col: 5, row: 0 }];
  const refused = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: direct,
  });
  assert(!refused.ok && refused.reason === 'blocked_by_equipment',
    `a pipe does not pass under the machine (${refused.reason})`);

  const obstacles = buildRigidRouteObstacles(state, 'vacuumPipe');
  const route = findObstacleAwareRoute(
    direct[0], null, direct[1], null,
    { portClearance: false, blocked: obstacles.isBlocked, bendPenalty: 1.5 },
  );
  assert(route && new Set(route.map(pointKey)).size === route.length,
    `equipment detour is simple and non-self-crossing (${JSON.stringify(route)})`);
  assert(route && validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: route,
  }).ok, 'equipment detour validates');
}

console.log('\n--- 3b. The ordinary drag controller invokes the detour search ---');
{
  const state = {
    placeables: [], beamPipes: [],
    utilityLines: new Map([['guide', {
      id: 'guide', utilityType: 'rfWaveguide', start: null, end: null,
      path: [{ col: 2, row: -1 }, { col: 2, row: 1 }],
    }]]),
  };
  const ctrl = new UtilityLineInputController({ game: { state }, renderer: {} });
  ctrl._utilityType = 'vacuumPipe';
  ctrl._drawStart = { open: true, worldPos: { x: 0, z: 0 } };
  const cursor = gridToIso(4, 0);
  const geometry = ctrl._dragGeometry(cursor.x, cursor.y, null);
  assert(geometry.path?.length >= 4 && ctrl.dragReject === null,
    `one normal drag previews a valid routed detour (${JSON.stringify(geometry.path)})`);
  assert(expandPath(geometry.path).every(point => !(point.col === 2 && Math.abs(point.row) <= 1)),
    'the controller preview does not cross the installed guide');
}

console.log('\n--- 4. Waveguide owns a larger, directional bend envelope ---');
{
  const rf = UTILITY_TYPES.rfWaveguide;
  const vacuum = UTILITY_TYPES.vacuumPipe;
  assert(rf.minStraightTiles > 0 && rf.portTailTiles >= rf.minStraightTiles,
    'waveguide reserves straight launch and elbow legs');
  assert(rf.routeClearanceTiles > vacuum.routeClearanceTiles,
    'waveguide keeps a wider service aisle than vacuum');
  const tight = [
    { col: 0, row: 0 },
    { col: 0.25, row: 0 },
    { col: 0.25, row: 2 },
  ];
  assert(!hasMinimumBendClearance(tight, rf.minStraightTiles),
    'a quarter-tile RF elbow is geometrically too tight');
  assert(hasMinimumBendClearance(tight, 0),
    'the same compact elbow remains valid vacuum geometry');

  const defs = {
    amp: { subW: 2, subL: 2, ports: {
      rf_out: { utility: 'rfWaveguide', role: 'source', side: 'right' },
    } },
    cavity: { subW: 2, subL: 2, ports: {
      rf_in: { utility: 'rfWaveguide', role: 'sink', side: 'left' },
    } },
  };
  const amp = { id: 'amp', type: 'amp', col: 0, row: 0, dir: 0 };
  const cavity = { id: 'cavity', type: 'cavity', col: 4, row: 0, dir: 0 };
  const startWorld = portWorldPosition(amp, defs.amp, 'rf_out');
  const endWorld = portWorldPosition(cavity, defs.cavity, 'rf_in');
  const start = { col: startWorld.x / 2, row: startWorld.z / 2 };
  const end = { col: endWorld.x / 2, row: endWorld.z / 2 };
  const state = { defs, placeables: [amp, cavity], beamPipes: [], utilityLines: new Map() };
  const aligned = validateDrawLine(state, {
    utilityType: 'rfWaveguide',
    start: { placeableId: 'amp', portName: 'rf_out' },
    end: { placeableId: 'cavity', portName: 'rf_in' },
    path: [start, end],
  });
  assert(aligned.ok, 'a straight guide aligned with both launchers validates');
  const wrongWay = validateDrawLine(state, {
    utilityType: 'rfWaveguide',
    start: { placeableId: 'amp', portName: 'rf_out' }, end: null,
    path: [start, { col: start.col - 2, row: start.row }],
  });
  assert(!wrongWay.ok && wrongWay.reason === 'port_mismatch_start',
    'waveguide cannot fold backward through its launcher');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
