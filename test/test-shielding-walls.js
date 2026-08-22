import { Game } from '../src/game/Game.js';
import { WALL_TYPES } from '../src/data/structure.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';

const saveStore = new Map();
globalThis.localStorage = {
  getItem: key => saveStore.get(key) ?? null,
  setItem: (key, value) => saveStore.set(key, String(value)),
  removeItem: key => saveStore.delete(key),
};

let passed = 0;
let failed = 0;
function assertOk(condition, message) {
  if (condition) { passed++; console.log(`  PASS: ${message}`); }
  else { failed++; console.error(`  FAIL: ${message}`); }
}

function richGame() {
  const game = new Game(new BeamlineRegistry(), { seed: 9191 });
  game.state.resources.funding = 100000;
  return game;
}

console.log('\n=== wall paint belongs to an independently selectable face ===\n');
{
  const game = richGame();
  game.placeWall(4, 4, 'n', 'officeWall');
  assertOk(game.paintWallFace(4, 4, 'n', 'labBlue'),
    'painting from the wall record side paints that room-facing face');
  assertOk(game.paintWallFace(4, 3, 's', 'utilityGray'),
    'painting through the mirrored edge paints the opposite face');
  const wall = game.state.walls[0];
  assertOk(wall.facePaint?.inside === 'labBlue' && wall.facePaint?.outside === 'utilityGray',
    'both wall faces retain independent finishes');
  assertOk(game.paintWallFace(4, 3, 's', null) && wall.facePaint?.inside === 'labBlue'
    && !wall.facePaint?.outside,
  'right-click reset clears only the selected face finish');
}

console.log('\n=== shielding walls occupy a one-subtile-deep edge strip ===\n');
{
  assertOk(WALL_TYPES.cinderblockWall.insetSubtiles === 1,
    'cinderblock is authored as one subtile deep');
  assertOk(WALL_TYPES.leadWall.insetSubtiles === 1,
    'lead is authored as one subtile deep');

  const game = richGame();
  assertOk(game.placeWall(10, 10, 'n', 'cinderblockWall'), 'cinderblock wall places');
  const claimed = [0, 1, 2, 3].map(subCol =>
    game.state.subgridOccupied[`10,10,${subCol},0`]
  );
  assertOk(claimed.every(occ => occ?.kind === 'shieldingWall'),
    'all four subtiles along the selected edge are reserved');
  assertOk(!game.state.subgridOccupied['10,9,0,3'],
    'the opposite tile is not consumed');

  game.state.subgridOccupied['11,11,3,2'] = { id: 'equipment:blocked', kind: 'equipment' };
  assertOk(!game.placeWall(11, 11, 'e', 'leadWall'),
    'an inset shielding wall refuses an occupied strip');
  assertOk(!game.state.wallOccupied['11,11,e'], 'the refused wall leaves no edge record');
}

console.log('\n=== doors carve the shielding strip and closing restores it ===\n');
{
  const game = richGame();
  game.placeWall(12, 12, 'n', 'cinderblockWall');
  assertOk(game.placeDoor(12, 12, 'n', 'officeDoor', 0, 1),
    'a door can be cut into an inset shielding wall');
  const remaining = [0, 1, 2, 3].filter(subCol =>
    game.state.subgridOccupied[`12,12,${subCol},0`]
  );
  assertOk(remaining.length === 2 && remaining[0] === 0 && remaining[1] === 3,
    'the two-subtile door opening is clear while its side fills remain occupied');
  assertOk(game.removeDoor(12, 12, 'n'), 'the door can be removed again');
  assertOk([0, 1, 2, 3].every(subCol => game.state.subgridOccupied[`12,12,${subCol},0`]),
    'closing the opening restores the full shielding strip');
}

console.log('\n=== copper sheeting layers onto a host wall ===\n');
{
  assertOk(WALL_TYPES.copperSheeting.wallOverlay === true,
    'copper is authored as a wall overlay');
  const game = richGame();
  assertOk(!game.placeWall(20, 20, 's', 'copperSheeting'),
    'copper cannot stand alone on an empty edge');
  assertOk(game.placeWall(20, 20, 's', 'leadWall'), 'host lead wall places');
  const hostCount = game.state.walls.length;
  assertOk(game.placeWall(20, 20, 's', 'copperSheeting'), 'copper layers onto the host');
  assertOk(game.state.walls.length === hostCount && game.state.wallOccupied['20,20,s'] === 'leadWall',
    'layering copper preserves the structural wall and its occupancy type');
  assertOk(game.state.wallOverlays.length === 1 &&
    game.state.wallOverlayOccupied['20,20,s'] === 'copperSheeting',
    'the copper layer has independent state');

  assertOk(game.removeWall(20, 21, 'n'), 'the copper can be peeled from the far-side alias');
  assertOk(game.state.wallOverlays.length === 0 && game.state.walls.length === 1,
    'the first demolition removes only copper and leaves its host');
  assertOk(game.removeWall(20, 20, 's') && game.state.walls.length === 0,
    'a second demolition removes the structural wall');
}

console.log('\n=== shielding layers and subtile occupancy survive save/load ===\n');
{
  const game = richGame();
  game.placeWall(24, 24, 'w', 'leadWall');
  game.placeWall(24, 24, 'w', 'copperSheeting');
  const loaded = richGame();
  localStorage.setItem('beamlineTycoon', game.serialize());
  assertOk(loaded.load(), 'save containing layered shielding loads');
  assertOk(loaded.state.wallOccupied['24,24,w'] === 'leadWall', 'host index rebuilds');
  assertOk(loaded.state.wallOverlayOccupied['24,24,w'] === 'copperSheeting',
    'overlay index rebuilds');
  assertOk([0, 1, 2, 3].every(subRow => loaded.state.subgridOccupied[`24,24,0,${subRow}`]),
    'the one-subtile wall strip is reclaimed after load');
}

console.log('\n=== generic interior walls accept face finishes ===\n');
{
  assertOk(WALL_TYPES.interiorWall.paintable === true,
    'the generic interior wall is paintable');
  assertOk(WALL_TYPES.cinderblockWall.insetSubtiles === 1 && WALL_TYPES.leadWall.insetSubtiles === 1,
    'shielding walls remain specialized physical construction');
  const game = richGame();
  assertOk(game.placeWall(28, 28, 'n', 'interiorWall'), 'generic interior wall places');
  assertOk(game.paintWallFace(28, 28, 'n', 'paperSubway'),
    'wallpaper applies to the selected interior face');
  assertOk(game.paintWallFace(28, 27, 's', 'labBlue'),
    'paint applies independently to the opposite interior face');
  assertOk(game.placeWall(29, 29, 'n', 'leadWall'), 'shielding wall places');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
