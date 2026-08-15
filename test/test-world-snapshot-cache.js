import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';

function makeGame() {
  return {
    state: {
      mapHalfExtent: 2,
      terrainBlobs: [{ cx: 0, cy: 0, sx: 2, sy: 2, angle: 0, brightness: 0.5 }],
      cornerHeights: new Map(),
      cornerHeightsRevision: 0,
      infraOccupied: {},
      zoneOccupied: {},
      floors: [],
    },
  };
}

test('terrain base cache still reflects occupancy, height revisions, and blob replacement', () => {
  const game = makeGame();
  const first = buildWorldSnapshot(game, { only: ['terrain', 'cliffs'] });
  const origin = first.terrain.find(tile => tile.col === 0 && tile.row === 0);
  assert.ok(origin);

  game.state.infraOccupied['0,0'] = 'concrete';
  const occupied = buildWorldSnapshot(game, { only: ['terrain', 'cliffs'] });
  assert.equal(occupied.terrain.some(tile => tile.col === 0 && tile.row === 0), false,
    'frequent occupancy changes filter the cached base');

  delete game.state.infraOccupied['0,0'];
  game.state.cornerHeights.set('0,0', [1, 1, 1, 1]);
  game.state.cornerHeightsRevision++;
  const raised = buildWorldSnapshot(game, { only: ['terrain', 'cliffs'] });
  assert.equal(raised.terrain.find(tile => tile.col === 0 && tile.row === 0).cornersY.nw, 0.5,
    'terrain revision invalidates cached corner samples');

  game.state.terrainBlobs = [];
  const unpatched = buildWorldSnapshot(game, { only: ['terrain'] });
  assert.equal(unpatched.terrain.find(tile => tile.col === 0 && tile.row === 0).brightness, 0,
    'replacing the authored blob set invalidates cached brightness');
});
