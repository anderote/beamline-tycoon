import {
  PLACEMENT_GRID_STYLE,
  appendPlacementGridDots,
  placementGridAlphaAt,
} from '../src/renderer3d/placement-grid-style.js';

let passed = 0;
let failed = 0;

function assertOk(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

function approx(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance;
}

console.log('\n=== Placement grid falloff ===\n');

assertOk(PLACEMENT_GRID_STYLE.colorHex === 0xffffff,
  'placement grid dots use pure white without a tint');

const centerMajor = placementGridAlphaAt('major', 0, 0, 0, 0);
const middleMajor = placementGridAlphaAt('major', 1.5, 0, 0, 0);
const edgeMajor = placementGridAlphaAt('major', 3, 0, 0, 0);
const outsideMajor = placementGridAlphaAt('major', 30, 0, 0, 0);
const centerSubgrid = placementGridAlphaAt('subgrid', 0, 0, 0, 0);
const edgeSubgrid = placementGridAlphaAt('subgrid', 3, 0, 0, 0);

assertOk(approx(centerMajor, PLACEMENT_GRID_STYLE.majorOpacityNear),
  'major tile lines use their strongest opacity at the cursor');
assertOk(centerMajor > middleMajor && middleMajor > edgeMajor,
  'major tile visibility falls smoothly with distance');
assertOk(approx(edgeMajor, PLACEMENT_GRID_STYLE.majorOpacityFar)
    && approx(outsideMajor, PLACEMENT_GRID_STYLE.majorOpacityFar),
  'the outer edge clamps to a quiet opacity without going negative');
assertOk(centerSubgrid < centerMajor && edgeSubgrid < edgeMajor,
  'subgrid lines remain subtler than major tile lines throughout the fade');
assertOk(approx(
  placementGridAlphaAt('major', 1.5, 1.5, 0, 0),
  middleMajor,
), 'falloff reaches each edge of the square preview evenly');

console.log('\n=== Blueprint dot geometry ===\n');

const buffers = { positions: [], colors: [] };
appendPlacementGridDots(
  buffers,
  { x: 0, y: 2, z: 0 },
  { x: 2, y: 4, z: 0 },
  { spacing: 0.5, dotLength: 0.1, startAlpha: 0.6, endAlpha: 0.2 },
);

assertOk(buffers.positions.length === 30 && buffers.colors.length === 40,
  'a two-unit line becomes five short, evenly spaced linelets');
assertOk(approx(buffers.positions[0], 0)
    && approx(buffers.positions[3], 0.05)
    && approx(buffers.positions[24], 1.95)
    && approx(buffers.positions[27], 2),
  'endpoint dots are clipped cleanly to the logical line');
assertOk(approx(buffers.positions[1], 2)
    && approx(buffers.positions[4], 2.05)
    && approx(buffers.positions[28], 4),
  'dotted endpoints preserve terrain-draped height interpolation');
assertOk(approx(buffers.colors[3], 0.6)
    && approx(buffers.colors[39], 0.2),
  'opacity fades across the dotted segment');

const continuous = { positions: [], colors: [] };
appendPlacementGridDots(
  continuous,
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { spacing: 0.5, dotLength: 0.1 },
);
appendPlacementGridDots(
  continuous,
  { x: 1, y: 0, z: 0 },
  { x: 2, y: 1, z: 0 },
  { spacing: 0.5, dotLength: 0.1, patternOffsetWorld: 1 },
);
assertOk(approx(continuous.positions[continuous.positions.length - 6], 1.95)
    && approx(continuous.positions[continuous.positions.length - 3], 2),
  'pattern offsets keep dots aligned across a terrain fold');

const before = buffers.positions.length;
appendPlacementGridDots(
  buffers,
  { x: 1, y: 0, z: 1 },
  { x: 1, y: 0, z: 1 },
  { spacing: 0.5, dotLength: 0.1 },
);
assertOk(buffers.positions.length === before,
  'zero-length segments do not add invalid dot geometry');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
