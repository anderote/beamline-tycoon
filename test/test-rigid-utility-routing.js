// test/test-rigid-utility-routing.js — shared subtile routing and 3D clearance rules.

import {
  expandPath,
  findObstacleAwareRoute,
  hasMinimumBendClearance,
} from '../src/utility/line-geometry.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { buildUtilityRouteObstacles } from '../src/utility/route-obstacles.js';
import {
  routeHeightForLine,
  routeHeightsConflict,
} from '../src/utility/route-elevation.js';
import { UTILITY_TYPES, UTILITY_TYPE_LIST, utilityLineHeight } from '../src/utility/registry.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { gridToIso } from '../src/renderer/grid.js';
import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../src/utility/routing-contract.js';
import { setUtilityCollisionProvider } from '../src/utility/utility-collision.js';

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function pointKey(point) {
  return `${Math.round(point.col * 4)}:${Math.round(point.row * 4)}`;
}

console.log('\n--- 1. Utility services use fixed utility elevations ---');
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
  assert(crossed.ok
      && crossed.line.routeHeightMeters === utilityLineHeight('vacuumPipe')
      && crossed.line.routeHeightMeters > routeHeightForLine(state.utilityLines.get('rf')),
    `vacuum crosses RF on its fixed datum (${crossed.line.routeHeightMeters} m)`);

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
  for (const utilityType of ['vacuumPipe', 'rfWaveguide', 'cryoTransfer']) {
    const stateWithTrunk = {
      placeables: [], beamPipes: [],
      utilityLines: new Map([['trunk', {
        id: 'trunk', utilityType, start: null, end: null,
        path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
      }]]),
    };
    const crossing = validateDrawLine(stateWithTrunk, {
      utilityType, start: null, end: null,
      path: [{ col: 2, row: -2 }, { col: 2, row: 2 }],
    });
    const sharedTrunk = validateDrawLine(stateWithTrunk, {
      utilityType, start: null, end: null,
      path: [{ col: 1, row: 0 }, { col: 3, row: 0 }],
    });
    assert(crossing.ok && sharedTrunk.ok,
      `${utilityType} accepts crossing and collinear contact as automatic joins`);
  }
  const tee = validateDrawLine(vacuumState, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 2, row: 0 }, { col: 2, row: 2 }],
    tapLineIds: { start: 'trunk' },
  });
  assert(tee.ok && tee.line.tapLineIds?.start === 'trunk'
      && tee.line.routeHeightMeters === routeHeightForLine(vacuumState.utilityLines.get('trunk')),
    'a named perpendicular vacuum tee inherits its trunk height and persists the join');
  const sharedHeader = validateDrawLine(vacuumState, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 2, row: 0 }, { col: 3, row: 0 }],
    tapLineIds: { start: 'trunk' },
  });
  assert(sharedHeader.ok,
    'a vacuum branch may reuse a collinear stretch of its installed header');

  const portLed = validateDrawLine({
    placeables: [], beamPipes: [], utilityLines: new Map(),
  }, {
    utilityType: 'cryoTransfer', start: null, end: null,
    path: [{ col: 0, row: 8 }, { col: 4, row: 8 }],
  });
  assert(portLed.ok && portLed.line.routeHeightMeters === utilityLineHeight('cryoTransfer'),
    'cryo always resolves to its fixed service datum');

  const vacuumPortLed = validateDrawLine({
    placeables: [], beamPipes: [], utilityLines: new Map(),
  }, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 0, row: 10 }, { col: 4, row: 10 }],
  });
  assert(vacuumPortLed.ok
      && vacuumPortLed.line.routeHeightMeters === utilityLineHeight('vacuumPipe'),
    'vacuum always resolves to its fixed service datum');

  const stackPath = [{ col: 0, row: 4 }, { col: 4, row: 4 }];
  const stackedLines = new Map();
  const stackedState = { placeables: [], beamPipes: [], utilityLines: stackedLines };
  const services = [
    ['cryoTransfer', null],
    ['waterSupplyPipe', 'cold'],
    ['waterSupplyPipe', 'lukewarm'],
    ['waterSupplyPipe', 'hot'],
    ['rfWaveguide', null],
    ['vacuumPipe', null],
  ];
  let allAccepted = true;
  for (let index = 0; index < services.length; index++) {
    const [utilityType, waterCircuit] = services[index];
    const checked = validateDrawLine(stackedState, {
      utilityType, waterCircuit, start: null, end: null, path: stackPath,
    });
    allAccepted &&= checked.ok;
    if (checked.ok) stackedLines.set(`stack-${index}`, {
      id: `stack-${index}`, ...checked.line,
    });
  }
  assert(allAccepted && stackedLines.size === services.length,
    'cryo, cold/lukewarm/hot water, RF, and vacuum share one parallel X/Z route');
  const stacked = [...stackedLines.values()];
  assert(stacked.every((line, index) => stacked.slice(index + 1).every(other => {
    const pairedWater = line.utilityType === 'waterSupplyPipe'
      && other.utilityType === 'waterSupplyPipe'
      && new Set([line.waterCircuit, other.waterCircuit]).size === 2
      && [line.waterCircuit, other.waterCircuit].every(circuit => ['cold', 'hot'].includes(circuit));
    return pairedWater || !routeHeightsConflict(
      line.utilityType, routeHeightForLine(line),
      other.utilityType, routeHeightForLine(other));
  })), 'every stacked service has clearance except the intentional side-by-side water twin');
}

console.log('\n--- 1b. Water equipment clearance follows the selected circuit height ---');
{
  const state = {
    defs: { blocker: { subW: 4, subL: 8, ports: {} } },
    placeables: [{ id: 'machine', type: 'blocker', col: 2, row: -1, dir: 0 }],
    beamPipes: [], utilityLines: new Map(),
  };
  const coldY = UTILITY_TYPES.waterSupplyPipe.runHeightsByWaterCircuit.cold;
  setUtilityCollisionProvider((type, envelope) => type === 'blocker'
    && envelope.minY < coldY && envelope.maxY > coldY);
  const cold = validateDrawLine(state, {
    utilityType: 'waterSupplyPipe', waterCircuit: 'cold', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  });
  const hot = validateDrawLine(state, {
    utilityType: 'waterSupplyPipe', waterCircuit: 'hot', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  });
  const lukewarm = validateDrawLine(state, {
    utilityType: 'waterSupplyPipe', waterCircuit: 'lukewarm', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  });
  assert(!cold.ok && cold.reason === 'blocked_by_equipment'
      && !hot.ok && hot.reason === 'blocked_by_equipment' && lukewarm.ok,
  'equipment at the twin datum blocks cold and hot while a clear lukewarm header passes above');
  setUtilityCollisionProvider(null);
}

console.log('\n--- 2. Same-service runs are joinable route space, not obstacles ---');
{
  const state = {
    placeables: [], beamPipes: [],
    utilityLines: new Map([['pipe', {
      id: 'pipe', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 2, row: -1 }, { col: 2, row: 1 }],
    }]]),
  };
  const obstacles = buildUtilityRouteObstacles(state, 'vacuumPipe');
  const route = findObstacleAwareRoute(
    { col: 0, row: 0 }, null,
    { col: 4, row: 0 }, null,
    { blocked: obstacles.isBlocked, bendPenalty: 1.5 },
  );
  assert(route && route.length === 2,
    `the router may cross an installed same-utility service (${JSON.stringify(route)})`);
  assert(route && expandPath(route).some(point => point.col === 2 && point.row === 0),
    'the direct route uses the shared coordinate as an automatic junction');
  const committed = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: route,
  });
  assert(committed.ok, `the pathfinder result is commit-valid (${committed.reason || 'ok'})`);
}

console.log('\n--- 3. Footprints are a broad phase; measured 3D geometry decides ---');
{
  const state = {
    defs: { blocker: { subW: 4, subL: 8, ports: {} } },
    placeables: [{ id: 'machine', type: 'blocker', col: 2, row: -1, dir: 0 }],
    beamPipes: [], utilityLines: new Map(),
  };
  const direct = [{ col: 0, row: 0 }, { col: 5, row: 0 }];
  let geometryLookups = 0;
  setUtilityCollisionProvider((type, envelope) => {
    geometryLookups++;
    return type === 'blocker'
      && envelope.minY < utilityLineHeight('vacuumPipe')
      && envelope.maxY > utilityLineHeight('vacuumPipe');
  });
  const refused = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: direct,
  });
  assert(!refused.ok && refused.reason === 'blocked_by_equipment',
    `a route intersecting measured component geometry is refused (${refused.reason})`);
  assert(geometryLookups > 0,
    'the footprint broad phase invokes the local 3D-envelope lookup');

  const obstacles = buildUtilityRouteObstacles(state, 'vacuumPipe');
  const route = findObstacleAwareRoute(
    direct[0], null, direct[1], null,
    { blocked: obstacles.isBlocked, bendPenalty: 1.5 },
  );
  assert(route && new Set(route.map(pointKey)).size === route.length,
    `equipment detour is simple and non-self-crossing (${JSON.stringify(route)})`);
  assert(route && validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: route,
  }).ok, 'equipment detour validates');

  setUtilityCollisionProvider(() => false);
  const underneath = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null, path: direct,
  });
  assert(underneath.ok,
    `the identical 2D route passes beneath a model when its 3D envelope is clear (${underneath.reason || 'ok'})`);
  setUtilityCollisionProvider(null);
}

console.log('\n--- 3a. Loose cable ignores equipment geometry; cooling hose does not ---');
{
  const state = {
    defs: { blocker: { subW: 4, subL: 8, ports: {} } },
    placeables: [{ id: 'machine', type: 'blocker', col: 2, row: -1, dir: 0 }],
    beamPipes: [], utilityLines: new Map(),
  };
  let geometryLookups = 0;
  setUtilityCollisionProvider(type => {
    geometryLookups++;
    return type === 'blocker';
  });
  for (const utilityType of ['powerCable', 'hvCable', 'dataFiber']) {
    const permissive = validateDrawLine(state, {
      utilityType, start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
      cablePath: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
    });
    const obstacles = buildUtilityRouteObstacles(state, utilityType);
    assert(permissive.ok && !obstacles.isBlocked(3, 0),
      `${utilityType} may be laid through equipment without a forced detour`);
  }
  assert(geometryLookups === 0,
    'permissive cable routing does not spend time querying model triangles');

  const visibleDetour = validateDrawLine(state, {
    utilityType: 'coolingWater', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
    cablePath: [
      { col: 0, row: 0 }, { col: 0, row: 3 },
      { col: 5, row: 3 }, { col: 5, row: 0 },
    ],
  });
  assert(visibleDetour.ok,
    `a cooling hose may visibly wrap around solid equipment (${visibleDetour.reason || 'ok'})`);

  const visibleCollision = validateDrawLine(state, {
    utilityType: 'coolingWater', start: null, end: null,
    path: [{ col: 0, row: 3 }, { col: 5, row: 3 }],
    cablePath: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  });
  assert(!visibleCollision.ok && visibleCollision.reason === 'blocked_by_equipment',
    'a cooling hose through solid equipment cannot be hidden by a clear compatibility path');
  setUtilityCollisionProvider(null);
}

console.log('\n--- 3b. On-pipe equipment blocks where its model is rendered ---');
{
  // Beam-pipe path coordinates are tile-centre indices: the renderer places
  // this buncher at world (5, 1), or utility-route tile (2.5, 0.5). The
  // synthesized endpoint record deliberately uses a different logical origin
  // for solver footprint arithmetic, which must not shift physical obstacles.
  const state = {
    placeables: [],
    beamPipes: [{
      id: 'beam', subL: 16,
      path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
      placements: [{ id: 'buncher', type: 'buncher', position: 0.4375, subL: 2 }],
    }],
    utilityLines: new Map(),
  };
  setUtilityCollisionProvider(() => false);
  const underModel = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 0, row: 0.5 }, { col: 5, row: 0.5 }],
  });
  assert(underModel.ok,
    `a route can cross the rendered footprint where measured 3D space is empty (${underModel.reason || 'ok'})`);

  setUtilityCollisionProvider(type => type === 'buncher');
  const clearBesideModel = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 5, row: 0 }],
  });
  assert(clearBesideModel.ok,
    `a route beside the rendered attachment clears its old phantom footprint (${clearBesideModel.reason || 'ok'})`);

  const throughModel = validateDrawLine(state, {
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 0, row: 0.5 }, { col: 5, row: 0.5 }],
  });
  assert(!throughModel.ok && throughModel.reason === 'blocked_by_equipment',
    `a route through the attachment's measured body is refused (${throughModel.reason || 'ok'})`);
  setUtilityCollisionProvider(null);
}

console.log('\n--- 3c. The ordinary drag controller accepts an automatic join ---');
{
  const state = {
    placeables: [], beamPipes: [],
    utilityLines: new Map([['pipe', {
      id: 'pipe', utilityType: 'vacuumPipe', start: null, end: null,
      path: [{ col: 2, row: -1 }, { col: 2, row: 1 }],
    }]]),
  };
  const ctrl = new UtilityLineInputController({ game: { state }, renderer: {} });
  ctrl._utilityType = 'vacuumPipe';
  ctrl._drawStart = { open: true, worldPos: { x: 0, z: 0 } };
  const cursor = gridToIso(4, 0);
  const geometry = ctrl._dragGeometry(cursor.x, cursor.y, null);
  assert(geometry.path?.length === 2 && ctrl.dragReject === null,
    `one normal drag crosses and joins an installed vacuum run (${JSON.stringify(geometry.path)})`);
  assert(geometry.routeHeightMeters === utilityLineHeight('vacuumPipe'),
    `the joined route stays on the fixed vacuum datum (${geometry.routeHeightMeters} m)`);
}

console.log('\n--- 3d. Obsolete saved lane values canonicalize on read ---');
{
  const lower = {
    id: 'lower', utilityType: 'vacuumPipe', start: null, end: null,
    routeHeightMeters: 0.24,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  };
  const upper = { ...lower, id: 'upper', routeHeightMeters: 0.84 };
  assert(routeHeightForLine(lower) === utilityLineHeight('vacuumPipe')
      && routeHeightForLine(upper) === utilityLineHeight('vacuumPipe'),
    'retired saved lane values cannot move vacuum runs off their standard datum');
}

console.log('\n--- 4. Every utility publishes the shared flexible subtile contract ---');
{
  const rf = UTILITY_TYPES.rfWaveguide;
  const cryo = UTILITY_TYPES.cryoTransfer;
  assert(UTILITY_TYPE_LIST.every(type =>
    UTILITY_TYPES[type].routingProfile === FLEXIBLE_SUBTILE_ROUTING_PROFILE),
  'all utilities publish the same flexible subtile routing profile');
  assert(UTILITY_TYPE_LIST.every(type => !Object.hasOwn(UTILITY_TYPES[type], 'portClearance')),
    'no utility declares a port-clearance exception');
  assert(['vacuumPipe', 'rfWaveguide', 'cryoTransfer', 'waterSupplyPipe'].every(type =>
    UTILITY_TYPES[type].joinsOnContact === true),
  'all fabricated pipe services publish automatic contact joins');
  assert(rf.bendStyle === 'mitered' && rf.miterLengthMeters > rf.pipeRadiusMeters,
    'RF publishes a compact mitered-elbow presentation contract');
  assert(rf.fixedRouteHeight && cryo.fixedRouteHeight,
    'RF and cryo publish mandatory fixed route elevations');
  const tight = [
    { col: 0, row: 0 },
    { col: 0.25, row: 0 },
    { col: 0.25, row: 2 },
  ];
  assert(hasMinimumBendClearance(tight, 0),
    'a compact quarter-tile elbow is valid shared utility geometry');
  for (const utilityType of ['rfWaveguide', 'cryoTransfer']) {
    const compact = validateDrawLine({ placeables: [], beamPipes: [], utilityLines: new Map() }, {
      utilityType, start: null, end: null, path: tight,
    });
    assert(compact.ok, `${utilityType} accepts the compact 90-degree route`);
    const diagonal = validateDrawLine({ placeables: [], beamPipes: [], utilityLines: new Map() }, {
      utilityType, start: null, end: null,
      path: [{ col: 0, row: 0 }, { col: 1, row: 1 }],
    });
    assert(!diagonal.ok && diagonal.reason === 'not_manhattan',
      `${utilityType} still rejects diagonal routing`);
  }

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
  assert(wrongWay.ok, 'waveguide may leave a fitting in any subtile direction');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
