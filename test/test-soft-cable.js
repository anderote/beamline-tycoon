// Flexible cord/hose geometry is pure and independent of Three.js.

import {
  SOFT_CABLE_TYPES,
  FREEFORM_TOPOLOGY_TYPES,
  SOFT_CABLE_MAX_POINTS,
  SOFT_CABLE_BEND_RADIUS_METERS,
  cablePathLengthSubUnits,
  draggedCablePath,
  isHvCableTensionSpan,
  roundedCablePlanarPoints,
  relaxedCableControlPoints,
  sanitizeCablePath,
  softCableControlPoints,
  tautCableControlPoints,
} from '../src/utility/soft-cable.js';

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('PASS ', message); }
  else { failed++; console.log('FAIL ', message); }
}

assert(SOFT_CABLE_TYPES.join(',') === 'powerCable,hvCable,coolingWater,dataFiber',
  'Power, HV, cooling water and data use flexible drawn geometry');
assert(FREEFORM_TOPOLOGY_TYPES.join(',') === 'coolingWater',
  'only cooling uses its visible freehand route as network topology');
assert(SOFT_CABLE_MAX_POINTS === 1024,
  'detailed freehand runs retain up to 1024 samples');
assert(SOFT_CABLE_BEND_RADIUS_METERS.powerCable
    < SOFT_CABLE_BEND_RADIUS_METERS.dataFiber
    && SOFT_CABLE_BEND_RADIUS_METERS.dataFiber
    < SOFT_CABLE_BEND_RADIUS_METERS.coolingWater
    && SOFT_CABLE_BEND_RADIUS_METERS.coolingWater
      < SOFT_CABLE_BEND_RADIUS_METERS.hvCable,
  'power bends tightest, then data, cooling and HV');

const hvSupport = { ports: { hv: { utility: 'hvCable', tensionsCable: true } } };
const ordinaryHvPlug = { ports: { hv: { utility: 'hvCable' } } };
assert(isHvCableTensionSpan([
  { def: hvSupport, portName: 'hv' }, { def: hvSupport, portName: 'hv' },
]), 'two HV mechanical anchors tension their shared span');
assert(!isHvCableTensionSpan([
  { def: hvSupport, portName: 'hv' }, { def: ordinaryHvPlug, portName: 'hv' },
]), 'one ordinary HV plug keeps the whole span loose');
assert(!isHvCableTensionSpan([
  { def: hvSupport, portName: 'hv' }, { def: null, portName: null },
]), 'an open cursor end keeps an HV preview loose');

const rightAngle = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 4 },
];
const turnStarts = {};
for (const [utilityType, radius] of Object.entries(SOFT_CABLE_BEND_RADIUS_METERS)) {
  const rounded = roundedCablePlanarPoints(rightAngle, radius);
  turnStarts[utilityType] = Math.max(...rounded.filter(point => Math.abs(point.z) < 1e-9)
    .map(point => point.x));
  assert(rounded[0].x === 0 && rounded[0].z === 0
      && rounded[rounded.length - 1].x === 4 && rounded[rounded.length - 1].z === 4,
    `${utilityType} rounding preserves both connection endpoints`);
}
assert(turnStarts.powerCable > turnStarts.dataFiber
    && turnStarts.dataFiber > turnStarts.coolingWater
    && turnStarts.coolingWater > turnStarts.hvCable,
  `larger bend radii begin turning sooner (${JSON.stringify(turnStarts)})`);

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

const taut = tautCableControlPoints(
  { x: -1, y: 6.4, z: 2 },
  { x: 7, y: 1.45, z: -3 },
);
assert(taut.length >= 8 && taut.every((point, index) => {
  const t = index / (taut.length - 1);
  return Math.abs(point.x - (-1 + 8 * t)) < 1e-9
    && Math.abs(point.z - (2 - 5 * t)) < 1e-9;
}), 'tension supports discard drawn slack and follow the direct planar chord');
const tautMiddleIndex = Math.floor(taut.length / 2);
const tautMiddleT = tautMiddleIndex / (taut.length - 1);
const tautMiddleChordY = 6.4 + (1.45 - 6.4) * tautMiddleT;
assert(Math.abs(taut[0].y - 6.4) < 1e-9
    && Math.abs(taut[taut.length - 1].y - 1.45) < 1e-9
    && taut[tautMiddleIndex].y < tautMiddleChordY
    && taut[tautMiddleIndex].y > tautMiddleChordY - 0.66,
  'a tensioned suspended span keeps its supports pinned with only shallow sag');

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

const pulledTrace = draggedCablePath([
  { col: 0, row: 0 }, { col: 1, row: 1 }, { col: 3, row: 1 }, { col: 4, row: 0 },
], { start: { col: 0, row: 2 } });
assert(pulledTrace[0].row === 2 && pulledTrace.at(-1).row === 0,
  'dragged cable pins the carried plug and the opposite plug');
assert(pulledTrace[1].row > 1 && pulledTrace[2].row > 1,
  'dragged cable distributes the pull through its slack instead of stretching one segment');

const kinked = [
  { x: 0, y: 1.8, z: 0 },
  { x: 0.6, y: 1.45, z: 0 },
  { x: 1.35, y: 1.2, z: 0.8 },
  { x: 2.0, y: 0.7, z: 0.15 },
  { x: 2.5, y: 0.03, z: 0 },
  { x: 3.0, y: 0.03, z: 0 },
];
const relaxed = relaxedCableControlPoints(kinked, { floorY: 0.03 });
assert(JSON.stringify(relaxed[0]) === JSON.stringify(kinked[0])
    && JSON.stringify(relaxed[relaxed.length - 1]) === JSON.stringify(kinked[kinked.length - 1]),
  'relaxation keeps both terminal points pinned');
assert(JSON.stringify(relaxed[4]) === JSON.stringify(kinked[4]),
  'relaxation preserves an existing floor-contact point');
assert(relaxed.every(point => point.y >= 0.03 - 1e-9),
  'relaxation never pulls the line below the floor');
const floatingTurn = (path, i) => {
  const a = path[i - 1], b = path[i], c = path[i + 1];
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const lengths = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  return Math.acos(Math.max(-1, Math.min(1,
    (u.x * v.x + u.y * v.y + u.z * v.z) / lengths)));
};
assert(floatingTurn(relaxed, 2) < floatingTurn(kinked, 2),
  `floating kink relaxes (${floatingTurn(kinked, 2)} -> ${floatingTurn(relaxed, 2)})`);
assert(Math.max(...relaxed.slice(1, 4).map(point => Math.abs(point.z)))
    < Math.max(...kinked.slice(1, 4).map(point => Math.abs(point.z))) * 0.3,
  'suspended lateral elbow is pulled into the natural hanging span');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
