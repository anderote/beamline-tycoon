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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
