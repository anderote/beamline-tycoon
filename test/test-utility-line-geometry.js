// test/test-utility-line-geometry.js — tests for src/utility/line-geometry.js
//
// Utility lines differ from beam pipes by supporting 90° Manhattan bends.
// Tests:
//   1. Horizontal straight path: returns 2-point waypoint list.
//   2. L-shaped path, default opts: horizontal-first corner.
//   3. L-shaped path, preferVerticalFirst: vertical-first corner.
//   4. Zero-length path: returns null.
//   5. pathLengthSubUnits on straight: 3 * 4 = 12.
//   6. pathLengthSubUnits on L-bend: 12 + 16 = 28.
//   7. expandPath: 0.25-step expansion from 2.0 to 5.0 = 13 points.

import {
  buildManhattanPath,
  pathLengthSubUnits,
  expandPath,
} from '../src/utility/line-geometry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);
}

// ==========================================================================
// Test 1: Horizontal straight path.
// ==========================================================================
console.log('\n--- Test 1: buildManhattanPath horizontal ---');
{
  const path = buildManhattanPath({ col: 2, row: 3 }, { col: 5, row: 3 });
  assertEq(path, [{ col: 2, row: 3 }, { col: 5, row: 3 }],
    'horizontal straight returns 2-point waypoint');
}

// ==========================================================================
// Test 2: L-shaped, default opts (horizontal-first).
// ==========================================================================
console.log('\n--- Test 2: buildManhattanPath L-shape (horizontal-first) ---');
{
  const path = buildManhattanPath({ col: 2, row: 3 }, { col: 5, row: 7 });
  assertEq(path, [{ col: 2, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 7 }],
    'default L uses horizontal-first corner at (5,3)');
}

// ==========================================================================
// Test 3: L-shaped, preferVerticalFirst=true.
// ==========================================================================
console.log('\n--- Test 3: buildManhattanPath L-shape (vertical-first) ---');
{
  const path = buildManhattanPath(
    { col: 2, row: 3 },
    { col: 5, row: 7 },
    { preferVerticalFirst: true },
  );
  assertEq(path, [{ col: 2, row: 3 }, { col: 2, row: 7 }, { col: 5, row: 7 }],
    'preferVerticalFirst uses vertical-first corner at (2,7)');
}

// ==========================================================================
// Test 4: Zero-length path rejected.
// ==========================================================================
console.log('\n--- Test 4: buildManhattanPath zero-length rejected ---');
{
  const path = buildManhattanPath({ col: 2, row: 3 }, { col: 2, row: 3 });
  assert(path === null, `zero-length returns null (got ${JSON.stringify(path)})`);
}

// ==========================================================================
// Test 5: pathLengthSubUnits on straight.
// ==========================================================================
console.log('\n--- Test 5: pathLengthSubUnits straight ---');
{
  const len = pathLengthSubUnits([{ col: 2, row: 3 }, { col: 5, row: 3 }]);
  assert(len === 12, `3 tiles * 4 = 12 sub-units (got ${len})`);
}

// ==========================================================================
// Test 6: pathLengthSubUnits on L-bend.
// ==========================================================================
console.log('\n--- Test 6: pathLengthSubUnits L-bend ---');
{
  const len = pathLengthSubUnits([
    { col: 2, row: 3 },
    { col: 5, row: 3 },
    { col: 5, row: 7 },
  ]);
  assert(len === 28, `12 + 16 = 28 sub-units (got ${len})`);
}

// ==========================================================================
// Test 7: expandPath — 0.25 step from 2.0 to 5.0 inclusive = 13 points.
// ==========================================================================
console.log('\n--- Test 7: expandPath dense ---');
{
  const expanded = expandPath([{ col: 2, row: 3 }, { col: 5, row: 3 }]);
  assert(expanded.length === 13, `13 points (got ${expanded.length})`);
  assertEq(expanded[0], { col: 2, row: 3 }, 'first point (2,3)');
  assertEq(expanded[12], { col: 5, row: 3 }, 'last point (5,3)');
  assertEq(expanded[4], { col: 3, row: 3 }, 'index 4 is (3,3)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
