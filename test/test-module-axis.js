import { moduleBeamAxis, axisMatchesDirection } from '../src/beamline/module-axis.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

const twoPortDef = { ports: { entry: { side: 'back' }, exit: { side: 'front' } } };
const sourceDef = { ports: { exit: { side: 'front' } } };

console.log('moduleBeamAxis — two-port module');
assertEq(moduleBeamAxis(twoPortDef, 0), { dCol: 0, dRow: 1 },  'dir=0 → +row');
assertEq(moduleBeamAxis(twoPortDef, 1), { dCol: -1, dRow: 0 }, 'dir=1 → -col');
assertEq(moduleBeamAxis(twoPortDef, 2), { dCol: 0, dRow: -1 }, 'dir=2 → -row');
assertEq(moduleBeamAxis(twoPortDef, 3), { dCol: 1, dRow: 0 },  'dir=3 → +col');

console.log('moduleBeamAxis — single-port source');
assert(moduleBeamAxis(sourceDef, 0) === null, 'source has no through-axis');

console.log('axisMatchesDirection');
assert(axisMatchesDirection({dCol:1,dRow:0}, {dCol:1,dRow:0}), 'same direction matches');
assert(axisMatchesDirection({dCol:1,dRow:0}, {dCol:-1,dRow:0}), 'opposite matches (pipes are undirected)');
assert(!axisMatchesDirection({dCol:1,dRow:0}, {dCol:0,dRow:1}), 'perpendicular does not match');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
