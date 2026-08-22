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

test('utility-line snapshots preserve water circuits for hose and rigid-pipe rendering', () => {
  const game = makeGame();
  game.activeLevel = 0;
  game.state.utilityLines = new Map([
    ['hot-hose', {
      id: 'hot-hose',
      utilityType: 'coolingWater',
      waterCircuit: 'hot',
      path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    }],
    ['hot-pipe', {
      id: 'hot-pipe',
      utilityType: 'waterSupplyPipe',
      waterCircuit: 'hot',
      path: [{ col: 0, row: 1 }, { col: 1, row: 1 }],
    }],
    ['cold-pipe', {
      id: 'cold-pipe',
      utilityType: 'waterSupplyPipe',
      waterCircuit: 'cold',
      path: [{ col: 0, row: 2 }, { col: 1, row: 2 }],
    }],
  ]);

  const snapshot = buildWorldSnapshot(game, { only: ['utilityLines'] });
  const byId = new Map(snapshot.utilityLines.map(line => [line.id, line]));
  assert.equal(byId.get('hot-hose').waterCircuit, 'hot',
    'a hot flexible cooling-water hose reaches the renderer as hot');
  assert.equal(byId.get('hot-pipe').waterCircuit, 'hot',
    'a hot rigid water-supply pipe reaches the renderer as hot');
  assert.equal(byId.get('cold-pipe').waterCircuit, 'cold',
    'cold circuit identity remains distinct from hot');
});
