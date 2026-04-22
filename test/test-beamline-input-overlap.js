// test/test-beamline-input-overlap.js — tests for
// BeamlineInputController._isOverlappingAtPosition.
//
// The helper is a pure predicate on (pipe, position, subL). It reports whether
// a placement of width `subL/pipe.subL` starting at `position` overlaps any of
// the pipe's existing placements. Shared edges don't count as overlap (EPS).

import { BeamlineInputController } from '../src/input/BeamlineInputController.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeController() {
  return new BeamlineInputController({
    game: { state: { beamPipes: [] } },
    renderer: {},
    inputHandler: {},
  });
}

function makePipe(subL, placements = []) {
  return { id: 'bp_1', subL, placements };
}

console.log('\n--- Test: empty pipe never overlaps ---');
{
  const c = makeController();
  const pipe = makePipe(20, []);
  assert(c._isOverlappingAtPosition(pipe, 0, 2) === false, 'start of empty pipe');
  assert(c._isOverlappingAtPosition(pipe, 0.5, 2) === false, 'mid of empty pipe');
  assert(c._isOverlappingAtPosition(pipe, 0.9, 2) === false, 'end of empty pipe');
}

console.log('\n--- Test: exact overlap flagged ---');
{
  const c = makeController();
  // Placement at position 0.3 with subL=2 on pipe subL=20 occupies [0.3, 0.4].
  const pipe = makePipe(20, [{ position: 0.3, subL: 2 }]);
  assert(c._isOverlappingAtPosition(pipe, 0.3, 2) === true, 'same interval overlaps');
  assert(c._isOverlappingAtPosition(pipe, 0.35, 2) === true, 'center inside existing overlaps');
}

console.log('\n--- Test: partial overlap flagged ---');
{
  const c = makeController();
  const pipe = makePipe(20, [{ position: 0.3, subL: 2 }]);
  // New placement at 0.25 with subL=2 occupies [0.25, 0.35] — partial overlap.
  assert(c._isOverlappingAtPosition(pipe, 0.25, 2) === true, 'left partial overlap');
  // New placement at 0.35 with subL=2 occupies [0.35, 0.45] — partial overlap.
  assert(c._isOverlappingAtPosition(pipe, 0.35, 2) === true, 'right partial overlap');
}

console.log('\n--- Test: shared edges are NOT overlap ---');
{
  const c = makeController();
  const pipe = makePipe(20, [{ position: 0.3, subL: 2 }]);
  // Existing ends at 0.4; new starting at 0.4 shares the edge only.
  assert(c._isOverlappingAtPosition(pipe, 0.4, 2) === false, 'touches right edge');
  // New placement [0.2, 0.3] shares left edge with existing [0.3, 0.4].
  assert(c._isOverlappingAtPosition(pipe, 0.2, 2) === false, 'touches left edge');
}

console.log('\n--- Test: gap between two placements ---');
{
  const c = makeController();
  const pipe = makePipe(20, [
    { position: 0.1, subL: 2 }, // [0.1, 0.2]
    { position: 0.6, subL: 2 }, // [0.6, 0.7]
  ]);
  assert(c._isOverlappingAtPosition(pipe, 0.3, 2) === false, 'in gap between placements');
  assert(c._isOverlappingAtPosition(pipe, 0.15, 2) === true, 'overlaps first');
  assert(c._isOverlappingAtPosition(pipe, 0.65, 2) === true, 'overlaps second');
}

console.log('\n--- Test: invalid pipe.subL returns false ---');
{
  const c = makeController();
  const pipe = { id: 'bad', subL: 0, placements: [{ position: 0.3, subL: 2 }] };
  assert(c._isOverlappingAtPosition(pipe, 0.3, 2) === false, 'subL=0 treated as no overlap');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
