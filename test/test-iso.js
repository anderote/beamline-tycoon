// === Isometric Coordinate Conversion Tests ===

const TILE_W = 64;
const TILE_H = 32;

function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

function isoToGrid(screenX, screenY) {
  return {
    col: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    row: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  };
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

console.log('--- gridToIso tests ---');

// (0,0) -> screen (0,0)
let r = gridToIso(0, 0);
assert(r.x === 0 && r.y === 0, '(0,0) -> screen (0, 0)');

// (1,0) -> screen (32, 16)
r = gridToIso(1, 0);
assert(r.x === 32 && r.y === 16, '(1,0) -> screen (32, 16)');

// (0,1) -> screen (-32, 16)
r = gridToIso(0, 1);
assert(r.x === -32 && r.y === 16, '(0,1) -> screen (-32, 16)');

console.log('\n--- Round-trip tests (gridToIso -> isoToGrid) ---');

const testCoords = [
  [0, 0],
  [3, 5],
  [10, 2],
  [7, 7],
];

for (const [col, row] of testCoords) {
  const iso = gridToIso(col, row);
  const back = isoToGrid(iso.x, iso.y);
  assert(
    back.col === col && back.row === row,
    `round-trip (${col},${row}) -> (${iso.x},${iso.y}) -> (${back.col},${back.row})`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
