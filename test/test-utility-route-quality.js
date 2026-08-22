// test/test-utility-route-quality.js — route QUALITY tests for the utility router
//
// Utility routes may turn immediately at a fitting. Authored port normals rank
// tidy one-subtile leads and perimeter wraps but never make another route
// illegal. This file owns route shape: paths stay Manhattan, reversal-free,
// ranked, and spatially diverse.
//
// Tests:
//   1. Full sweep: 4x4 port-normal pairs x 13 relative offsets x both
//      preferVerticalFirst values — every route must be reversal-free.
//   2. The regression case (source faces N, sink 3 tiles south faces S), which
//      used to route (8,6)->(8,5.75)->(8,9.25)->(8,9): two 180° hairpins.
//   3. Every swept route is Manhattan regardless of port normals.
//   4. simplifyPath drops coincident and collinear vertices and leaves an
//      already-minimal 2-point path alone.

import {
  buildPortRoutedPath,
  buildPortRoutedPaths,
  simplifyPath,
  pathReversals,
} from '../src/utility/line-geometry.js';

const EPS = 1e-6;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function assertEq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);
}

const fmt = (path) => (path ? path.map(p => `(${p.col},${p.row})`).join('->') : 'null');

// Outward normals, named the way the port specs name their sides.
const VECS = {
  N: { dCol: 0, dRow: -1 },
  S: { dCol: 0, dRow: 1 },
  E: { dCol: 1, dRow: 0 },
  W: { dCol: -1, dRow: 0 },
};

// Axis-aligned in both directions, diagonals in all four quadrants, a
// near-coincident pair, and the same tile approached on the other axis — the
// shapes that made the single-L router hairpin.
const OFFSETS = [
  [0, 3], [0, -3], [3, 0], [-3, 0],
  [3, 3], [-3, 3], [3, -3], [-3, -3],
  [0, 1], [1, 0], [1, 1], [0, 0.5], [5, 1],
];

function isManhattan(path) {
  for (let i = 0; i < path.length - 1; i++) {
    const dc = path[i + 1].col - path[i].col;
    const dr = path[i + 1].row - path[i].row;
    if (Math.abs(dc) > EPS && Math.abs(dr) > EPS) return false;
  }
  return true;
}

function direction(a, b) {
  return {
    dCol: Math.sign(b.col - a.col),
    dRow: Math.sign(b.row - a.row),
  };
}

function portPenalty(path, startVec, endVec) {
  const first = direction(path[0], path[1]);
  const last = direction(path[path.length - 2], path[path.length - 1]);
  return Number(first.dCol !== startVec.dCol || first.dRow !== startVec.dRow)
    + Number(last.dCol !== -endVec.dCol || last.dRow !== -endVec.dRow);
}

// ==========================================================================
// Test 1-3: the sweep. Every combination has to route cleanly and stay
// Manhattan regardless of both ports' approach directions.
// ==========================================================================
console.log('\n--- Test 1: reversal-free sweep over all port-normal pairs ---');
{
  let cases = 0;
  const reversing = [];
  const nonManhattan = [];
  const nullPath = [];

  for (const [sName, sVec] of Object.entries(VECS)) {
    for (const [eName, eVec] of Object.entries(VECS)) {
      for (const [dCol, dRow] of OFFSETS) {
        for (const vf of [false, true]) {
          cases++;
          const start = { col: 8, row: 6 };
          const end = { col: 8 + dCol, row: 6 + dRow };
          const path = buildPortRoutedPath(start, sVec, end, eVec, { preferVerticalFirst: vf });
          const label = `${sName}->${eName} d(${dCol},${dRow}) vf=${vf}`;
          if (!path || path.length < 2) { nullPath.push(`${label}: ${fmt(path)}`); continue; }
          if (pathReversals(path) > 0) reversing.push(`${label}: ${fmt(path)}`);
          if (!isManhattan(path)) nonManhattan.push(`${label}: ${fmt(path)}`);
        }
      }
    }
  }

  for (const [list, what] of [
    [nullPath, 'produced no path'],
    [reversing, 'contain a 180° reversal'],
    [nonManhattan, 'are not Manhattan'],
  ]) {
    if (list.length) {
      console.log(`    ${list.length} route(s) ${what}:`);
      for (const line of list.slice(0, 12)) console.log(`      ${line}`);
      if (list.length > 12) console.log(`      ... and ${list.length - 12} more`);
    }
  }

  assert(cases === 4 * 4 * OFFSETS.length * 2, `swept ${cases} routes`);
  assert(nullPath.length === 0, `every swept case produced a path (${nullPath.length} did not)`);
  assert(reversing.length === 0, `no swept route doubles back (${reversing.length} did)`);
  assert(nonManhattan.length === 0, `every swept route is Manhattan (${nonManhattan.length} were not)`);
}

// ==========================================================================
// Test 2: the specific regression — two ports facing away from each other,
// three tiles apart on the axis they both face along.
// ==========================================================================
console.log('\n--- Test 2: srcN / sinkS three tiles apart (the reported hairpin) ---');
{
  for (const vf of [false, true]) {
    const path = buildPortRoutedPath(
      { col: 8, row: 6 }, VECS.N,
      { col: 8, row: 9 }, VECS.S,
      { preferVerticalFirst: vf },
    );
    assert(pathReversals(path) === 0,
      `vf=${vf} routes without doubling back: ${fmt(path)}`);
    assert(path.length > 2
        && direction(path[0], path[1]).dRow === -1
        && direction(path[path.length - 2], path[path.length - 1]).dRow === -1,
    `vf=${vf} prefers the tidy outward fitting wrap: ${fmt(path)}`);
  }
}

// ==========================================================================
// Test 3: two ports facing the SAME way — the case the ±lane candidates exist
// for. Neither bend order of a single L can serve it.
// ==========================================================================
console.log('\n--- Test 3: both ports facing north, sink three tiles north ---');
{
  for (const vf of [false, true]) {
    const path = buildPortRoutedPath(
      { col: 8, row: 6 }, VECS.N,
      { col: 8, row: 3 }, VECS.N,
      { preferVerticalFirst: vf },
    );
    assert(pathReversals(path) === 0, `vf=${vf} routes without doubling back: ${fmt(path)}`);
    assert(path.length > 2
        && direction(path[0], path[1]).dRow === -1
        && direction(path[path.length - 2], path[path.length - 1]).dRow === 1,
    `vf=${vf} wraps outside both north-facing fittings: ${fmt(path)}`);
  }
}

// ==========================================================================
// Test 4: simplifyPath.
// ==========================================================================
console.log('\n--- Test 4: simplifyPath ---');
{
  assertEq(
    simplifyPath([{ col: 2, row: 3 }, { col: 5, row: 3 }]),
    [{ col: 2, row: 3 }, { col: 5, row: 3 }],
    'a 2-point straight path is left untouched',
  );
  assertEq(
    simplifyPath([{ col: 2, row: 3 }, { col: 3, row: 3 }, { col: 5, row: 3 }]),
    [{ col: 2, row: 3 }, { col: 5, row: 3 }],
    'a collinear midpoint is dropped',
  );
  assertEq(
    simplifyPath([{ col: 2, row: 3 }, { col: 2, row: 3 }, { col: 5, row: 3 }]),
    [{ col: 2, row: 3 }, { col: 5, row: 3 }],
    'a coincident duplicate is dropped',
  );
  assertEq(
    simplifyPath([
      { col: 8, row: 6 }, { col: 8, row: 5.75 }, { col: 8, row: 4 },
      { col: 8, row: 4 }, { col: 11, row: 4 }, { col: 12, row: 4 },
    ]),
    [{ col: 8, row: 6 }, { col: 8, row: 4 }, { col: 12, row: 4 }],
    'a stub merges into the leg that continues straight',
  );
  assertEq(
    simplifyPath([{ col: 8, row: 6 }, { col: 8, row: 4 }, { col: 8, row: 5 }]),
    [{ col: 8, row: 6 }, { col: 8, row: 4 }, { col: 8, row: 5 }],
    'a 180° reversal is NOT merged away (it is a real turn, and a bad one)',
  );
  assert(pathReversals([{ col: 8, row: 6 }, { col: 8, row: 4 }, { col: 8, row: 5 }]) === 1,
    'pathReversals counts that reversal');
  assert(pathReversals([{ col: 8, row: 6 }, { col: 8, row: 4 }, { col: 9, row: 4 }]) === 0,
    'pathReversals ignores an ordinary 90° corner');
}

// ==========================================================================
// Test 5: the ranked list. The drag controller walks it looking for a route the
// board accepts, so every entry has to be a route it would be willing to
// commit, and no two entries may be the same geometry.
// ==========================================================================
console.log('\n--- Test 5: buildPortRoutedPaths ranking ---');
{
  const start = { col: 8, row: 6 };
  const end = { col: 12, row: 10 };
  const all = buildPortRoutedPaths(start, VECS.E, end, VECS.N, { preferVerticalFirst: false });

  assert(all.length > 1, `an ordinary drag offers alternatives to fall back on (got ${all.length})`);
  assertEq(all[0], buildPortRoutedPath(start, VECS.E, end, VECS.N, { preferVerticalFirst: false }),
    'the singular form is the head of the list');

  const keys = all.map(p => p.map(q => `${q.col},${q.row}`).join(';'));
  assert(new Set(keys).size === keys.length,
    `no two candidates are the same geometry (${keys.length} paths, ${new Set(keys).size} distinct)`);

  let allSound = true;
  for (const p of all) {
    if (pathReversals(p) > 0 || !isManhattan(p)) {
      allSound = false;
      console.log(`    unusable candidate: ${fmt(p)}`);
    }
  }
  assert(allSound, 'every candidate is one the drag would be willing to commit');

  // Port match ranks first, then corners and length. A tidy fitting wrap may
  // intentionally outrank a shorter off-side route, while fallbacks within a
  // quality tier still get progressively less attractive.
  let ordered = true;
  for (let i = 1; i < all.length; i++) {
    const previous = [
      portPenalty(all[i - 1], VECS.E, VECS.N),
      all[i - 1].length - 2,
    ];
    const current = [portPenalty(all[i], VECS.E, VECS.N), all[i].length - 2];
    if (current[0] < previous[0]
        || (current[0] === previous[0] && current[1] < previous[1])) {
      ordered = false;
      break;
    }
  }
  assert(ordered, 'the list is ordered by fitting match, then corner count');

  // The fallback walk is only worth anything if the alternatives run somewhere
  // ELSE. Near-duplicates that hug the same corridor would all be blocked by
  // the same existing cable, so the interior waypoints have to spread out.
  const interior = new Set();
  for (const p of all) {
    for (const q of p.slice(1, -1)) interior.add(`${q.col},${q.row}`);
  }
  assert(interior.size >= 4,
    `the alternatives turn in genuinely different places (${interior.size} distinct interior waypoints)`);

  // And no single subtile is on every candidate: blocking one point of the
  // board must never take the whole ranking down with it.
  const onEvery = [...interior].filter(k => all.every(
    p => p.slice(1, -1).some(q => `${q.col},${q.row}` === k)));
  assert(onEvery.length === 0,
    `no interior waypoint is common to every candidate (${onEvery.join(' ') || 'none'})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
