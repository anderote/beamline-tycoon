import { expandPipePath, findPipeAtTile, pipeDirectionAtTile, positionToPoint } from '../src/beamline/pipe-geometry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

// expandPipePath now produces sub-tile (0.25-step) entries.
console.log('expandPipePath');
{
  const result = expandPipePath([{col:0,row:0},{col:3,row:0}]);
  assert(result.length === 13, `straight horizontal: 13 sub-tile entries (got ${result.length})`);
  assertEq(result[0], {col:0,row:0}, 'straight horizontal: starts at (0,0)');
  assertEq(result[12], {col:3,row:0}, 'straight horizontal: ends at (3,0)');
  assertEq(result[4], {col:1,row:0}, 'straight horizontal: index 4 is (1,0)');
}
{
  const result = expandPipePath([{col:0,row:0},{col:0,row:2},{col:2,row:2}]);
  // 0→2 vertical = 8 steps + 2→2 horizontal = 8 steps = 16 steps + 1 start = 17
  assert(result.length === 17, `L-bend: 17 entries (got ${result.length})`);
  assertEq(result[0], {col:0,row:0}, 'L-bend: starts at (0,0)');
  assertEq(result[8], {col:0,row:2}, 'L-bend: corner at (0,2)');
  assertEq(result[16], {col:2,row:2}, 'L-bend: ends at (2,2)');
}
assertEq(
  expandPipePath([{col:5,row:5}]),
  [{col:5,row:5}],
  'single waypoint'
);
// Dense 0.25-step input should pass through unchanged
{
  const dense = [{col:0,row:0},{col:0.25,row:0},{col:0.5,row:0},{col:0.75,row:0},{col:1,row:0}];
  const result = expandPipePath(dense);
  assertEq(result, dense, 'already-dense path passes through unchanged');
}

console.log('findPipeAtTile');
const pipes = [
  { id: 'bp_1', path: [{col:0,row:0},{col:5,row:0}] },
  { id: 'bp_2', path: [{col:10,row:0},{col:10,row:5}] },
];
// With 0.25-step expansion, index for col=3 is 3/0.25 = 12
const hit = findPipeAtTile(pipes, 3, 0);
assert(hit && hit.pipe.id === 'bp_1' && hit.tileIndex === 12, `finds bp_1 at (3,0) with index 12 (got idx=${hit?.tileIndex})`);
assert(findPipeAtTile(pipes, 7, 0) === null, 'no pipe at (7,0)');
// Index for row=3 is 3/0.25 = 12
const hit2 = findPipeAtTile(pipes, 10, 3);
assert(hit2 && hit2.pipe.id === 'bp_2' && hit2.tileIndex === 12, `finds bp_2 at (10,3) with index 12 (got idx=${hit2?.tileIndex})`);

console.log('pipeDirectionAtTile');
const straight = { path: [{col:0,row:0},{col:5,row:0}] };
// Index 8 is at col=2, middle of the pipe
assertEq(pipeDirectionAtTile(straight, 8), {dCol:1,dRow:0}, 'horizontal direction at middle');
assertEq(pipeDirectionAtTile(straight, 0), null, 'start endpoint returns null');
// Final endpoint is at index 20 (5/0.25)
assertEq(pipeDirectionAtTile(straight, 20), null, 'final endpoint returns null');

// L-bend: 0→2 vertical then 0→2 horizontal. Corner at index 8 ({0,2}).
const lBend = { path: [{col:0,row:0},{col:0,row:2},{col:2,row:2}] };
// Index 8 is the corner: prev={0,1.75}, next={0.25,2}. Both axes non-zero → null.
assertEq(pipeDirectionAtTile(lBend, 8), null, 'corner returns null');
// Index 4 is in the vertical segment (row=1)
assertEq(pipeDirectionAtTile(lBend, 4), {dCol:0,dRow:1}, 'straight before corner');
// Index 12 is in the horizontal segment (col=1)
assertEq(pipeDirectionAtTile(lBend, 12), {dCol:1,dRow:0}, 'straight after corner');

console.log('positionToPoint');
{
  const pipe = { path: [{col:0,row:0},{col:5,row:0}], subL: 10 };
  const p0 = positionToPoint(pipe, 0);
  assert(p0 && Math.abs(p0.col - 0) < 1e-6 && Math.abs(p0.row - 0) < 1e-6, 'fraction 0 → pipe start');
  const p1 = positionToPoint(pipe, 1);
  assert(p1 && Math.abs(p1.col - 5) < 1e-6 && Math.abs(p1.row - 0) < 1e-6, 'fraction 1 → pipe end');
  const pMid = positionToPoint(pipe, 0.5);
  assert(pMid && Math.abs(pMid.col - 2.5) < 1e-6 && Math.abs(pMid.row - 0) < 1e-6, 'fraction 0.5 → midpoint');
  assert(pMid && pMid.dir === 1, 'horizontal +col pipe → dir=1 (SE)');
}
{
  // L-bend: vertical then horizontal. Equal world lengths (5 each), total=10.
  const pipe = { path: [{col:0,row:0},{col:0,row:5},{col:5,row:5}], subL: 20 };
  const pCorner = positionToPoint(pipe, 0.5);
  assert(pCorner && Math.abs(pCorner.col - 0) < 1e-6 && Math.abs(pCorner.row - 5) < 1e-6, 'L-bend fraction 0.5 → corner');
  const pQuarter = positionToPoint(pipe, 0.25);
  assert(pQuarter && Math.abs(pQuarter.col - 0) < 1e-6 && Math.abs(pQuarter.row - 2.5) < 1e-6, 'L-bend fraction 0.25 → vertical middle');
  assert(pQuarter && pQuarter.dir === 2, 'vertical +row segment → dir=2 (SW)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
