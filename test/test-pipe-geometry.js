import { expandPipePath, findPipeAtTile, pipeDirectionAtTile } from '../src/beamline/pipe-geometry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

console.log('expandPipePath');
assertEq(
  expandPipePath([{col:0,row:0},{col:3,row:0}]),
  [{col:0,row:0},{col:1,row:0},{col:2,row:0},{col:3,row:0}],
  'straight horizontal 4 tiles'
);
assertEq(
  expandPipePath([{col:0,row:0},{col:0,row:2},{col:2,row:2}]),
  [{col:0,row:0},{col:0,row:1},{col:0,row:2},{col:1,row:2},{col:2,row:2}],
  'L-bend'
);
assertEq(
  expandPipePath([{col:5,row:5}]),
  [{col:5,row:5}],
  'single waypoint'
);

console.log('findPipeAtTile');
const pipes = [
  { id: 'bp_1', path: [{col:0,row:0},{col:5,row:0}] },
  { id: 'bp_2', path: [{col:10,row:0},{col:10,row:5}] },
];
const hit = findPipeAtTile(pipes, 3, 0);
assert(hit && hit.pipe.id === 'bp_1' && hit.tileIndex === 3, 'finds bp_1 at (3,0) with index 3');
assert(findPipeAtTile(pipes, 7, 0) === null, 'no pipe at (7,0)');
const hit2 = findPipeAtTile(pipes, 10, 3);
assert(hit2 && hit2.pipe.id === 'bp_2' && hit2.tileIndex === 3, 'finds bp_2 at (10,3)');

console.log('pipeDirectionAtTile');
const straight = { path: [{col:0,row:0},{col:5,row:0}] };
assertEq(pipeDirectionAtTile(straight, 2), {dCol:1,dRow:0}, 'horizontal direction at middle');
assertEq(pipeDirectionAtTile(straight, 0), null, 'endpoint returns null');
assertEq(pipeDirectionAtTile(straight, 5), null, 'final endpoint returns null');
const lBend = { path: [{col:0,row:0},{col:0,row:2},{col:2,row:2}] };
assertEq(pipeDirectionAtTile(lBend, 2), null, 'corner returns null');
assertEq(pipeDirectionAtTile(lBend, 1), {dCol:0,dRow:1}, 'straight before corner');
assertEq(pipeDirectionAtTile(lBend, 3), {dCol:1,dRow:0}, 'straight after corner');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
