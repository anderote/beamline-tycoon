// test/test-terrain-placement.js — integration test for auto-flatten on
// Placeable placement. Placing any Placeable over non-flat terrain must
// flatten all its footprint tiles to zero. Neighboring tiles outside the
// footprint are left alone, and failed placements do not mutate the
// heightmap.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { setTileCorners, getTileCorners } from '../src/game/terrain.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

function makeGame() {
  const registry = new BeamlineRegistry();
  const g = new Game(registry);
  g.state.resources.funding = 1e9;
  return g;
}

function cornersEqual(c, { nw, ne, se, sw }) {
  return c.nw === nw && c.ne === ne && c.se === se && c.sw === sw;
}

// ---------------------------------------------------------------------------
// Test 1: 1x1-tile Placeable (source, subW=4 subL=4) at (5,5) flattens tile
// (5,5) to zero, and neighbor (6,5) is untouched.
// ---------------------------------------------------------------------------
{
  const g = makeGame();

  // Seed the target tile with non-flat corners (within invariant: max-min <= 1).
  setTileCorners(g.state, 5, 5, { nw: 1, ne: 1, se: 1, sw: 0 });
  // Seed a neighbor that must NOT be touched.
  setTileCorners(g.state, 6, 5, { nw: 1, ne: 0, se: 0, sw: 0 });

  const before5 = getTileCorners(g.state, 5, 5);
  assert(!cornersEqual(before5, { nw: 0, ne: 0, se: 0, sw: 0 }),
    '1x1: target tile is non-flat before placement');

  const id = g.placePlaceable({ type: 'source', col: 5, row: 5, subCol: 0, subRow: 0, dir: 0 });
  assert(id, '1x1: source placed successfully');

  const after5 = getTileCorners(g.state, 5, 5);
  assert(cornersEqual(after5, { nw: 0, ne: 0, se: 0, sw: 0 }),
    `1x1: target tile flattened to zero (got ${JSON.stringify(after5)})`);

  const after6 = getTileCorners(g.state, 6, 5);
  assert(cornersEqual(after6, { nw: 1, ne: 0, se: 0, sw: 0 }),
    `1x1: neighbor tile (6,5) untouched (got ${JSON.stringify(after6)})`);
}

// ---------------------------------------------------------------------------
// Test 2: 2x2-tile footprint — source placed at subCol=2, subRow=2 spans
// four tiles: (5,5), (6,5), (5,6), (6,6). All four must flatten.
// ---------------------------------------------------------------------------
{
  const g = makeGame();

  // Seed all 4 target tiles with non-flat corners.
  setTileCorners(g.state, 5, 5, { nw: 1, ne: 0, se: 0, sw: 0 });
  setTileCorners(g.state, 6, 5, { nw: 0, ne: 1, se: 0, sw: 0 });
  setTileCorners(g.state, 5, 6, { nw: 0, ne: 0, se: 1, sw: 0 });
  setTileCorners(g.state, 6, 6, { nw: 0, ne: 0, se: 0, sw: 1 });
  // Seed an outside neighbor that must NOT flatten.
  setTileCorners(g.state, 7, 5, { nw: 1, ne: 1, se: 1, sw: 0 });

  // subCol=2, subRow=2 with subW=4/subL=4 straddles the tile boundary and
  // produces footprint cells across cols 5..6 and rows 5..6 — 4 tiles.
  const id = g.placePlaceable({ type: 'source', col: 5, row: 5, subCol: 2, subRow: 2, dir: 0 });
  assert(id, '2x2: source placed successfully at subCol=2/subRow=2');

  for (const [c, r] of [[5, 5], [6, 5], [5, 6], [6, 6]]) {
    const after = getTileCorners(g.state, c, r);
    assert(cornersEqual(after, { nw: 0, ne: 0, se: 0, sw: 0 }),
      `2x2: tile (${c},${r}) flattened to zero (got ${JSON.stringify(after)})`);
  }

  const afterNeighbor = getTileCorners(g.state, 7, 5);
  assert(cornersEqual(afterNeighbor, { nw: 1, ne: 1, se: 1, sw: 0 }),
    `2x2: outside neighbor (7,5) untouched (got ${JSON.stringify(afterNeighbor)})`);
}

// ---------------------------------------------------------------------------
// Test 3: Failed placement (collision) leaves the heightmap untouched.
// Place a source at (5,5) first, then seed (5,5) with non-flat corners
// (which is allowed because setTileCorners bypasses the placement path),
// then attempt to place another source at the same tile — it must fail
// and the seeded corners must be preserved.
// ---------------------------------------------------------------------------
{
  const g = makeGame();

  // First, place a source that occupies (5,5). This will auto-flatten (5,5).
  const firstId = g.placePlaceable({ type: 'source', col: 5, row: 5, subCol: 0, subRow: 0, dir: 0 });
  assert(firstId, 'fail: initial source placed');

  // Now re-seed (5,5) with non-flat corners via direct terrain API. (In real
  // play a user can't do this while the tile is occupied, but the test is
  // probing the code path: if the *second* placement is rejected, its
  // auto-flatten block must never run.)
  setTileCorners(g.state, 5, 5, { nw: 1, ne: 1, se: 1, sw: 0 });
  const seededCorners = getTileCorners(g.state, 5, 5);
  assert(cornersEqual(seededCorners, { nw: 1, ne: 1, se: 1, sw: 0 }),
    'fail: heightmap seeded with non-flat corners on occupied tile');

  // Attempt to place a second source at the same tile — must fail due to
  // subgrid collision.
  const secondId = g.placePlaceable({ type: 'source', col: 5, row: 5, subCol: 0, subRow: 0, dir: 0 });
  assert(!secondId, 'fail: second (colliding) placement returns falsy');

  const afterFail = getTileCorners(g.state, 5, 5);
  assert(cornersEqual(afterFail, { nw: 1, ne: 1, se: 1, sw: 0 }),
    `fail: heightmap untouched after failed placement (got ${JSON.stringify(afterFail)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
