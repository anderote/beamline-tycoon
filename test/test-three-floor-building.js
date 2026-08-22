import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { levelOf, tileKey } from '../src/game/storeys.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';

const game = new Game(new BeamlineRegistry(), { seed: 303 });
game.setSandboxMode(true);
game.state.floors = [];
game.state.roofs = [];
game.state.zones = [];
game.state.placeables = [];
game.state.placeableNextId = 1;
game.state.infraOccupied = {};
game.state.zoneOccupied = {};
game._rebuildPlaceableIndex();

assert.equal(
  game.placeInfraTile(0, 0, 'concrete', 0, { level: 1 }),
  false,
  'an upper floor cannot be placed without a roof below',
);

for (const row of [0, 1]) {
  assert.equal(game.placeInfraTile(0, row, 'concrete'), true);
  game.state.roofs.push({ type: 'roof', col: 0, row });
  assert.equal(game.placeInfraTile(0, row, 'concrete', 0, { level: 1 }), true);
}

assert.equal(game.state.infraOccupied[tileKey(0, 0, 1)], 'concrete');
assert.equal(
  game.placePlaceable({ type: 'internalStairs', col: 0, row: 0, level: 0 }),
  'in_1',
  'stairs can be placed when both landings are floored',
);

assert.equal(
  game.placePlaceable({ type: 'internalStairs', col: 0, row: 0, level: 2 }),
  false,
  'stairs cannot connect above the third floor',
);

for (const row of [0, 1]) {
  game.state.roofs.push({ type: 'roof', col: 0, row, level: 1 });
  assert.equal(game.placeInfraTile(0, row, 'concrete', 0, { level: 2 }), true);
}
assert.equal(game.state.floors.filter(tile => levelOf(tile) === 2).length, 2);

const highBay = new Game(new BeamlineRegistry(), { seed: 305 });
highBay.setSandboxMode(true);
highBay.state.floors = [];
highBay.state.roofs = [];
highBay.state.infraOccupied = {};
const bayCol = 8, bayRow = 8;
assert.equal(highBay.placeInfraTile(bayCol, bayRow, 'concrete'), true);
for (const edge of ['n', 'e', 's', 'w']) {
  assert.equal(highBay.placeWall(bayCol, bayRow, edge, 'structuralWall'), true);
}
assert.equal(highBay.placeRoofRegion(bayCol, bayRow), true);
assert.equal(highBay.placeInfraTile(bayCol, bayRow, 'concrete', 0, { level: 1 }), true);
for (const edge of ['n', 'e', 's', 'w']) {
  assert.equal(highBay.placeWall(bayCol, bayRow, edge, 'structuralWall', 0, 1), true);
}
assert.equal(highBay.placeRoofRegion(bayCol, bayRow, 'roof', 0, 1), true);

assert.equal(highBay.removeRoofRegion(bayCol, bayRow), true,
  'the temporary lower roof can be removed after constructing the second storey');
assert.equal(highBay.state.roofs.some(tile => levelOf(tile) === 0), false,
  'the high-bay room has no first-storey roof');
assert.equal(highBay.state.roofs.some(tile => levelOf(tile) === 1), true,
  'the second-storey roof remains over the combined high bay');
assert.equal(highBay.state.infraOccupied[tileKey(bayCol, bayRow, 1)], 'concrete',
  'removing the temporary roof preserves the already-built upper storey');

const saveStore = new Map([['beamlineTycoon', game.serialize()]]);
globalThis.localStorage = {
  getItem: key => saveStore.get(key) ?? null,
  setItem: (key, value) => saveStore.set(key, String(value)),
  removeItem: key => saveStore.delete(key),
};
const loaded = new Game(new BeamlineRegistry(), { seed: 304 });
assert.equal(loaded.load(), true, 'a multi-floor facility loads through the public save contract');
assert.equal(loaded.state.infraOccupied[tileKey(0, 0, 2)], 'concrete');
assert.equal(levelOf(loaded.getPlaceable('in_1')), 0, 'stair connector level survives save/load');

game.setActiveLevel(1);
const secondFloor = buildWorldSnapshot(game, { only: ['floors', 'components'] });
assert.equal(secondFloor.floors.length, 2, 'the snapshot exposes only the active floor');
assert.equal(secondFloor.floors[0].cornersY.nw, 3.35, 'second-floor slabs use the storey datum');
assert.ok(
  secondFloor.components.some(component => component.type === 'internalStairs'),
  'the upper landing view includes stairs authored on the floor below',
);
assert.equal(
  secondFloor.components.find(component => component.type === 'internalStairs').level,
  0,
  'snapshot entries preserve the authored level when a connector reaches upward',
);

const groundContext = buildWorldSnapshot(game, {
  level: 0,
  only: ['floors', 'walls', 'components'],
});
assert.equal(game.activeLevel, 1, 'building lower-storey context does not change the active floor');
assert.equal(groundContext.floors.length, 2, 'an explicit snapshot level exposes the floor below');
assert.ok(
  groundContext.components.some(component => component.type === 'internalStairs'),
  'lower-storey context includes its authored connector geometry',
);

game.setActiveLevel(99);
assert.equal(game.activeLevel, 2, 'the active construction view clamps to the third floor');

console.log('three-floor building contract tests passed');
