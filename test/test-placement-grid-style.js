import {
  PLACEMENT_GRID_STYLE,
  appendPlacementGridRibbon,
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

console.log('\n=== Major line ribbon geometry ===\n');

const buffers = { positions: [], colors: [], indices: [] };
appendPlacementGridRibbon(
  buffers,
  { x: 0, y: 2, z: 0 },
  { x: 2, y: 4, z: 0 },
  0.1,
  0.6,
  0.2,
);

assertOk(buffers.positions.length === 12 && buffers.indices.length === 6,
  'one major segment becomes a two-triangle ribbon');
assertOk(approx(buffers.positions[2], 0.05)
    && approx(buffers.positions[5], -0.05),
  'ribbon width is centred on the logical grid line');
assertOk(buffers.positions[1] === 2 && buffers.positions[7] === 4,
  'each endpoint preserves its terrain-draped height');
assertOk(approx(buffers.colors[3], 0.6)
    && approx(buffers.colors[11], 0.2),
  'endpoint opacity is carried into vertex colors for smooth interpolation');

const before = buffers.positions.length;
appendPlacementGridRibbon(
  buffers,
  { x: 1, y: 0, z: 1 },
  { x: 1, y: 0, z: 1 },
  0.1,
  1,
  1,
);
assertOk(buffers.positions.length === before,
  'zero-length segments do not add invalid ribbon geometry');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
