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
  buildPortRoutedPaths,
  pathLengthSubUnits,
  expandPath,
} from '../src/utility/line-geometry.js';
import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../src/utility/registry.js';
import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../src/utility/routing-contract.js';

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

// ======================================================================
// Test 8: adjacent, facing ports use the direct one-subtile connection.
// ======================================================================
console.log('\n--- Test 8: adjacent facing ports route directly ---');
{
  const path = buildPortRoutedPaths(
    { col: 0, row: 0 }, { dCol: 1, dRow: 0 },
    { col: 0.25, row: 0 }, { dCol: -1, dRow: 0 },
  )[0];
  assertEq(path, [{ col: 0, row: 0 }, { col: 0.25, row: 0 }],
    'opposing ports one subtile apart get one direct segment, not a detour');
  assert(pathLengthSubUnits(path) === 1,
    `adjacent port run costs one sub-unit (got ${pathLengthSubUnits(path)})`);
}

// ======================================================================
// Test 9: no utility requires a minimum straight run at a port.
// ======================================================================
console.log('\n--- Test 9: ports have no minimum clearance ---');
{
  const adjacent = buildPortRoutedPaths(
    { col: 0, row: 0 }, { dCol: 1, dRow: 0 },
    { col: 0.25, row: 0 }, { dCol: 1, dRow: 0 },
  );
  assertEq(adjacent[0], [{ col: 0, row: 0 }, { col: 0.25, row: 0 }],
    'same-facing adjacent ports connect directly without clearance tails');

  assert(UTILITY_TYPE_LIST.every(utilityType => !Object.hasOwn(UTILITY_TYPES[utilityType], 'portClearance')),
    'no registered utility declares a port-clearance exception');
  assert(UTILITY_TYPE_LIST.every(utilityType =>
    UTILITY_TYPES[utilityType].routingProfile === FLEXIBLE_SUBTILE_ROUTING_PROFILE),
  'all registered utilities publish the same flexible subtile routing profile');
  const freeRoute = buildPortRoutedPaths(
    { col: 0.25, row: 0 }, null,
    { col: 0.25, row: 0.25 }, null,
  )[0];
  assertEq(freeRoute, [{ col: 0.25, row: 0 }, { col: 0.25, row: 0.25 }],
    'an ordinary utility run can use adjacent subtiles freely');
}

// ======================================================================
// Test 10: authored port normals produce a perimeter wrap when useful.
// ======================================================================
console.log('\n--- Test 10: same-facing ports get a tidy outward wrap ---');
{
  const path = buildPortRoutedPaths(
    { col: 0, row: 0 }, { dCol: 1, dRow: 0 },
    { col: 2, row: 0 }, { dCol: 1, dRow: 0 },
  )[0];
  const first = path[1];
  const beforeEnd = path[path.length - 2];
  assert(first.col > path[0].col && first.row === path[0].row,
    'route first leaves the source in its outward direction');
  assert(beforeEnd.col > path.at(-1).col && beforeEnd.row === path.at(-1).row,
    'route returns to the destination from outside its face');
  assert(path.every(point => point.col * 4 === Math.round(point.col * 4)
      && point.row * 4 === Math.round(point.row * 4)),
    'the full wrap stays on quarter-tile service coordinates');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
