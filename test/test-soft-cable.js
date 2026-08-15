// Flexible cord/hose geometry is pure and independent of Three.js.

import {
  SOFT_CABLE_TYPES,
  FREEFORM_TOPOLOGY_TYPES,
  SOFT_CABLE_MAX_POINTS,
  cablePathLengthSubUnits,
  sanitizeCablePath,
  softCableControlPoints,
} from '../src/utility/soft-cable.js';

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('PASS ', message); }
  else { failed++; console.log('FAIL ', message); }
}

assert(SOFT_CABLE_TYPES.join(',') === 'powerCable,hvCable,coolingWater',
  'Power, HV and cooling water use flexible drawn geometry');
assert(FREEFORM_TOPOLOGY_TYPES.join(',') === 'coolingWater',
  'only cooling uses its visible freehand route as network topology');
assert(SOFT_CABLE_MAX_POINTS === 1024,
  'detailed freehand runs retain up to 1024 samples');

const trace = sanitizeCablePath([
  { col: 0, row: 0 },
  { col: 1.13, row: 1.37 },
  { col: 2.41, row: -0.83 },
  { col: 4, row: 0 },
]);
assert(trace.length === 4 && trace[1].col === 1.13,
  'freeform trace retains non-grid S-curve samples');
assert(cablePathLengthSubUnits(trace) > 16,
  'an S-curve costs more cable than the four-tile straight chord');

const short = softCableControlPoints(
  [{ col: 0, row: 0 }, { col: 2, row: 0 }],
  { start: { x: 0, y: 1, z: 0 }, end: { x: 4, y: 1, z: 0 }, groundY: 0.03 },
);
const shortMiddle = short[Math.floor(short.length / 2)];
assert(short[0].y === 1 && short[short.length - 1].y === 1,
  'cable terminates at both true 3D plug heights');
assert(shortMiddle.y < 1 && shortMiddle.y > 0.03,
  'a short span bows under gravity without falling through the floor');

const pooled = softCableControlPoints(trace, {
  start: { x: 0, y: 0.8, z: 0 },
  end: { x: 8, y: 0.8, z: 0 },
  groundY: 0.03,
});
assert(pooled.filter(point => Math.abs(point.y - 0.03) < 1e-9).length >= 3,
  'added slack lays a visible length of cable on the ground');
assert(pooled.every(point => point.y >= 0.03),
  'gravity never puts a cable control point below the ground');
assert(Math.min(...pooled.map(point => point.z)) < 0
    && Math.max(...pooled.map(point => point.z)) > 0,
  'the pooled 3D centreline follows both bends of the drawn S');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
