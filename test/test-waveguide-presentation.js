// test/test-waveguide-presentation.js — adaptive RF connector drops and
// automatic support layout stay deterministic for arbitrary measured anchors.

import * as THREE_NS from 'three';
import {
  utilitySupportFrames,
  waveguideDropProfile,
  waveguideSupportFrames,
  waveguideTransitionPoints,
} from '../src/renderer3d/waveguide-presentation.js';

globalThis.THREE = THREE_NS;

const { COMPONENTS } = await import('../src/data/components.js');
const { RF_PORT_STANDARDS } = await import('../src/data/rf-port-standards.js');
const {
  portAnchor3D,
  setModelBoundsProvider,
  setShellMeasureProvider,
} = await import('../src/utility/port-anchors.js');
const { portWorldPosition } = await import('../src/utility/ports.js');
const { utilityLineHeight } = await import('../src/utility/registry.js');
const { buildWorldPoints, default: UtilityLineBuilderV2 } = await import(
  '../src/renderer3d/utility-line-builder-v2.js');

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function near(a, b, tolerance = 1e-6) { return Math.abs(a - b) <= tolerance; }
function finitePoints(points) {
  return points.every(point => Number.isFinite(point.x)
    && Number.isFinite(point.y) && Number.isFinite(point.z));
}

console.log('\n--- 1. High side ports receive a clear, sloped dogleg ---');
{
  const anchor = {
    x: 4, y: 1.2, z: -2,
    out: { x: 1, z: 0 }, standoff: 0.06,
  };
  const floorY = 0.22;
  const profile = waveguideDropProfile(anchor, floorY);
  const points = waveguideTransitionPoints(anchor, floorY, {
    x: profile.landing.x, y: floorY, z: profile.landing.z,
  });
  assert(profile.tip.x > anchor.x && profile.upper.x > profile.tip.x,
    'the guide leaves the flange outward before changing elevation');
  assert(profile.landing.x > profile.upper.x && near(profile.landing.y, floorY),
    'the sloped section continues away from the machine and lands on the deck run');
  assert(points.length === 3,
    `an already-aligned route needs only landing, slope and launch (${points.length} points)`);
  const slope = points[1];
  assert(!near(points[0].x, slope.x) && !near(points[0].y, slope.y),
    'the transition contains an actual diagonal segment instead of a vertical riser');
}

console.log('\n--- 2. Legacy and misaligned endpoints reconcile on the deck ---');
{
  const anchor = {
    x: 1.1, y: 0.95, z: 3.7,
    out: { x: 0, z: -2 }, standoff: 0.08,
  };
  const points = waveguideTransitionPoints(anchor, 0.22, { x: -0.6, y: 0.22, z: 5.4 });
  assert(points.length >= 4 && finitePoints(points),
    'an arbitrary finite endpoint always produces a finite connected transition');
  const floor = points.slice(0, -2);
  assert(floor.every((point, index) => index === 0
    || near(point.x, floor[index - 1].x) || near(point.z, floor[index - 1].z)),
  'every pre-ramp correction changes one plan axis at a time');
  assert(near(points.at(-1).x, anchor.x)
    && near(points.at(-1).z, anchor.z + anchor.out.z / 2 * anchor.standoff),
  'the last point lands on the measured fitting tip even with a non-unit port vector');
}

console.log('\n--- 3. Long bent deck runs receive evenly-spaced supports ---');
{
  const points = [
    { x: 0, y: 0.22, z: 0 },
    { x: 8, y: 0.22, z: 0 },
    { x: 8, y: 0.22, z: 4 },
    { x: 9, y: 1.0, z: 4 }, // slope ends the supported deck chain
  ];
  const frames = waveguideSupportFrames(points, {
    floorY: 0.22, spacingMeters: 3, minimumRunMeters: 5,
  });
  assert(frames.length === 4, `12 m of deck run receives four supports (${frames.length})`);
  assert(frames.every(frame => near(frame.point.y, 0.22)
    && near(Math.hypot(frame.direction.x, frame.direction.z), 1)),
  'every support is on the deck with a normalized local run direction');
  assert(frames.some(frame => near(frame.direction.z, 1)),
    'support orientation follows the second leg after the Manhattan corner');
  assert(waveguideSupportFrames(points.slice(0, 2), {
    floorY: 0.22, spacingMeters: 3, minimumRunMeters: 9,
  }).length === 0, 'short runs remain uncluttered');
  assert(utilitySupportFrames === waveguideSupportFrames,
    'the compatibility RF name exposes the shared utility support layout');
}

console.log('\n--- 4. The committed builder uses drops and physical support groups ---');
{
  const klystron = {
    id: 'kly', type: 'pulsedKlystron', category: 'infrastructure',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const def = COMPONENTS.pulsedKlystron;
  const logical = portWorldPosition(klystron, def, 'rf_out');
  const floorY = utilityLineHeight('rfWaveguide');
  const line = {
    id: 'rf-long', utilityType: 'rfWaveguide',
    start: { placeableId: klystron.id, portName: 'rf_out' }, end: null,
    path: [
      { col: logical.x / 2, row: logical.z / 2 },
      { col: logical.x / 2 + 4, row: logical.z / 2 },
    ],
  };
  const endpoints = new Map([[klystron.id, klystron]]);
  const worldPoints = buildWorldPoints(line, endpoints);
  assert(near(worldPoints[0].y, 1.2) && worldPoints.some((point, index) => index > 0
    && !near(point.y, worldPoints[index - 1].y)
    && (!near(point.x, worldPoints[index - 1].x)
      || !near(point.z, worldPoints[index - 1].z))),
  'committed RF geometry starts at the authored klystron height and includes a slope');
  assert(worldPoints.some(point => near(point.y, floorY)),
    'the committed route settles onto the descriptor deck height');

  const parent = new THREE_NS.Group();
  const builder = new UtilityLineBuilderV2();
  builder.build(new Map([[line.id, line]]), endpoints, parent);
  let supports = 0;
  parent.traverse(object => { if (object.userData?.isUtilitySupport) supports++; });
  assert(supports > 0, `the long committed guide owns support frames (${supports})`);
  builder.dispose(parent);
}

console.log('\n--- 5. Common RF ports use predictable standard placements ---');
{
  for (const type of RF_PORT_STANDARDS.standardFeed.types) {
    const standard = RF_PORT_STANDARDS.standardFeed;
    const spec = COMPONENTS[type]?.ports?.[standard.portName];
    const anchor = portAnchor3D({
      id: type, type, col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
    }, COMPONENTS[type], standard.portName);
    assert(spec?.side === standard.placement.side
      && near(spec?.offsetAlong, standard.placement.offsetAlong)
      && near(anchor?.y, standard.heightMeters),
    `${type} uses the centred ${standard.heightMeters} m standard RF feed`);
  }
  for (const type of RF_PORT_STANDARDS.singleOutput.types) {
    const standard = RF_PORT_STANDARDS.singleOutput;
    const spec = COMPONENTS[type]?.ports?.[standard.portName];
    assert(spec?.side === standard.placement.side
      && near(spec?.offsetAlong, standard.placement.offsetAlong),
    `${type} uses the centred single-output RF placement`);
  }
  assert(COMPONENTS.sbandStructure.ports.rf_in.offsetAlong === 0.8
      && COMPONENTS.cryomodule.ports.rf_in.offsetAlong === 0.8,
    'long warm structures and cryomodules retain their end-mounted couplers');
}

console.log('\n--- 6. An aligned klystron and NC cavity build one straight guide ---');
{
  // Model-bound anchors sit inboard of the logical footprint edge. Exercise
  // that renderer-backed shape here: it was the two-point case that used to
  // retain both old endpoints and visibly double back through its launchers.
  setModelBoundsProvider(() => ({
    minX: -0.5, maxX: 0.5, minY: 0, maxY: 2,
    minZ: -1.4, maxZ: 1.4,
  }));
  setShellMeasureProvider((_type, requests) => new Map(
    requests.map(request => [request.key, 0.35]),
  ));
  const klystron = {
    id: 'aligned-kly', type: 'pulsedKlystron',
    worldX: 0, worldZ: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const cavity = {
    id: 'aligned-cavity', type: 'rfCavity',
    worldX: 3, worldZ: 0, subCol: 0, subRow: 0, dir: 0,
    portsFlipped: true,
  };
  const klyDef = COMPONENTS[klystron.type];
  const cavityDef = COMPONENTS[cavity.type];
  const start = portWorldPosition(klystron, klyDef, 'rf_out');
  const end = portWorldPosition(cavity, cavityDef, 'rf_in');
  const startAnchor = portAnchor3D(klystron, klyDef, 'rf_out');
  const endAnchor = portAnchor3D(cavity, cavityDef, 'rf_in');
  assert(near(start.z, end.z) && near(startAnchor.y, endAnchor.y)
      && near(startAnchor.y, RF_PORT_STANDARDS.standardFeed.heightMeters),
    'tile-aligned endpoints share a plan centerline and connector height');

  const line = {
    id: 'rf-aligned', utilityType: 'rfWaveguide',
    start: { placeableId: klystron.id, portName: 'rf_out' },
    end: { placeableId: cavity.id, portName: 'rf_in' },
    path: [
      { col: start.x / 2, row: start.z / 2 },
      { col: end.x / 2, row: end.z / 2 },
    ],
    routeHeightMeters: RF_PORT_STANDARDS.standardFeed.heightMeters,
  };
  const points = buildWorldPoints(line, new Map([
    [klystron.id, klystron], [cavity.id, cavity],
  ]));
  assert(points.length >= 4
      && points.every(point => near(point.y, startAnchor.y) && near(point.z, start.z)),
    'the complete launcher-to-launcher guide stays level on one plan axis');
  assert(points.every((point, index) => index === 0 || point.x >= points[index - 1].x - 1e-6),
    'the straight two-point route never doubles back through either launcher');
  setModelBoundsProvider(null);
  setShellMeasureProvider(null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
