import {
  buildFloorTileWallPath,
  buildInteriorWallBoundary,
  buildFloorRegionPerimeter,
  buildFloorInterfaceRun,
  buildSmartFloorWallPath,
} from '../src/input/floor-wall-paths.js';

let passed = 0;
let failed = 0;

function assertOk(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.log('  FAIL:', message);
  }
}

function has(path, col, row, edge) {
  return path.some(point => point.col === col && point.row === row && point.edge === edge);
}

console.log('\n=== smart floor wall geometry ===\n');

{
  const path = buildFloorTileWallPath({ col: 3, row: 5 });
  assertOk(path.length === 4, 'one selected floor tile exposes four candidate wall faces');
  assertOk(has(path, 3, 5, 'n') && has(path, 3, 5, 'e')
    && has(path, 3, 5, 's') && has(path, 3, 5, 'w'),
  'each candidate face is expressed from the selected tile');
}

{
  const occ = { '0,0': 'labFloor', '1,0': 'labFloor' };
  const walls = {
    '0,0,n': 'officeWall', '0,0,e': 'officeWall',
    '0,0,s': 'officeWall', '0,0,w': 'officeWall',
    '1,0,n': 'officeWall', '1,0,e': 'officeWall', '1,0,s': 'officeWall',
  };
  const result = buildInteriorWallBoundary(occ, walls, { col: 0, row: 0 });
  assertOk(result.mode === 'interior' && result.tileCount === 1,
    'an interior paint fill stops at a partition even when both rooms share flooring');
  assertOk(result.path.length === 4 && has(result.path, 0, 0, 'e'),
    'the selected room includes its inward-facing partition surface');
  assertOk(!has(result.path, 1, 0, 'e'),
    'the selected room excludes the adjoining room\'s outer wall surfaces');
}

{
  const occ = {
    '0,0': 'labFloor', '1,0': 'labFloor', '2,0': 'labFloor',
    '0,1': 'labFloor', '1,1': 'labFloor', '2,1': 'labFloor',
  };
  const walls = {
    '1,0,e': 'officeWall',
    '0,0,n': 'officeWall', '1,0,n': 'officeWall', '2,0,n': 'officeWall',
  };
  const result = buildInteriorWallBoundary(occ, walls, { col: 0, row: 0 });
  assertOk(result.path.filter(point => point.col === 1 && point.edge === 'e').length === 1,
    'a reconnecting floor region emits a partial partition only once');
}

{
  const occ = { '0,0': 'labFloor', '1,0': 'officeFloor' };
  const walls = {
    '0,0,n': 'officeWall', '0,0,s': 'officeWall', '0,0,w': 'officeWall',
    '1,0,n': 'officeWall', '1,0,e': 'officeWall', '1,0,s': 'officeWall',
  };
  const result = buildInteriorWallBoundary(occ, walls, { col: 0, row: 0 });
  assertOk(result.tileCount === 2,
    'an interior paint fill crosses flooring changes when no wall divides them');
  assertOk(result.path.length === 6 && has(result.path, 1, 0, 'e'),
    'the mixed-floor interior resolves one complete inward-facing boundary');
}

{
  const occ = {
    '0,0': 'labFloor', '1,0': 'labFloor',
    '0,1': 'labFloor', '1,1': 'labFloor',
  };
  const result = buildFloorRegionPerimeter(occ, { col: 0, row: 0, edge: 'n' });
  assertOk(result.mode === 'perimeter', 'a floor hover selects perimeter mode');
  assertOk(result.tileCount === 4, 'the flood fill includes all four connected tiles');
  assertOk(result.path.length === 8, 'a 2x2 floor produces its eight-edge outer perimeter');
  assertOk(!has(result.path, 0, 0, 'e'), 'shared internal edges are excluded');
}

{
  const occ = {
    '0,0': 'officeCarpet',
    '1,0': 'officeCarpet',
    '0,1': 'officeCarpet',
    '8,8': 'officeCarpet',
  };
  const result = buildFloorRegionPerimeter(occ, { col: 0, row: 0, edge: 'n' });
  assertOk(result.tileCount === 3, 'disconnected tiles of the same type are not included');
  assertOk(result.path.length === 8, 'an L-shaped three-tile region has eight exposed edges');
}

{
  const occ = {};
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) occ[`${col},${row}`] = 'labFloor';
  }
  occ['1,1'] = 'officeCarpet';
  const result = buildFloorRegionPerimeter(occ, { col: 0, row: 0, edge: 'n' });
  assertOk(result.tileCount === 8, 'a different floor type is excluded from the region');
  assertOk(result.path.length === 16, 'the perimeter includes both the outer edge and inner floor-type border');
  assertOk(has(result.path, 1, 0, 's'), 'the inner border above a different floor is included');
}

{
  const occ = {};
  for (let row = 0; row < 3; row++) {
    occ[`0,${row}`] = 'labFloor';
    occ[`1,${row}`] = 'officeCarpet';
  }
  const edge = { col: 0, row: 1, edge: 'e', dist: 0.05 };
  const run = buildFloorInterfaceRun(occ, edge);
  assertOk(run.mode === 'interface', 'different floor types form an interface run');
  assertOk(run.path.length === 3, 'the interface expands straight through matching floor pairs');
  assertOk(run.path.every(point => point.col === 0 && point.edge === 'e'), 'the interface stays on one edge axis');

  const near = buildSmartFloorWallPath(occ, edge);
  assertOk(near.mode === 'interface', 'hovering near the mixed-floor edge prefers its straight run');

  const interior = buildSmartFloorWallPath(occ, { ...edge, dist: 0.45 });
  assertOk(interior.mode === 'perimeter', 'hovering inside the tile prefers the whole same-floor perimeter');
  assertOk(interior.floorType === 'labFloor' && interior.tileCount === 3,
    'the interior selection does not cross into the other floor material');
  assertOk(interior.path.length === 8, 'the three-tile strip has an eight-edge perimeter');
}

{
  const occ = { '0,0': 'concrete' };
  const result = buildFloorRegionPerimeter(occ, { col: 1, row: 0, edge: 'w' });
  assertOk(result.floorType === 'concrete' && result.tileCount === 1,
    'an edge approached from an empty tile resolves the floor on its other side');
  assertOk(result.path.length === 4, 'the resolved single floor tile gets a complete perimeter');

  const empty = buildSmartFloorWallPath({}, { col: 4, row: 4, edge: 'n', dist: 0.1 });
  assertOk(empty.mode === 'free' && empty.path.length === 0,
    'empty ground leaves Shift available for a free drag without inventing a fill');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
