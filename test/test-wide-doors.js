import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { DOOR_TYPES } from '../src/data/structure.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { isBlocked } from '../src/networks/rooms.js';
import {
  doorRecordCoversEdge, doorRecordEdges, doorTileSpan, normalizeDoorSpanPath,
} from '../src/game/edge-keys.js';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

let passed = 0;
let failed = 0;
function assertOk(condition, message) {
  if (condition) { passed++; console.log(`  PASS: ${message}`); }
  else { failed++; console.error(`  FAIL: ${message}`); }
}

function richGame(seed = 711) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 100000;
  return game;
}

function horizontalWalls(game, startCol, row, count) {
  for (let i = 0; i < count; i++) game.placeWall(startCol + i, row, 'n', 'structuralWall');
}

console.log('\n=== wide-door catalogue contract ===\n');
{
  const expected = { hangarDoor3: 3, hangarDoor4: 4, hangarDoor6: 6 };
  for (const [id, span] of Object.entries(expected)) {
    const def = DOOR_TYPES[id];
    assertOk(def?.tileSpan === span && doorTileSpan(def) === span,
      `${id} is authored as one ${span}×1 door`);
    assertOk(def?.doorWidth === 'double' && def?.leafCount === 2,
      `${id} is a full-depth paired blast door`);
  }
}

console.log('\n=== fixed-span path normalization ===\n');
{
  const def = DOOR_TYPES.hangarDoor3;
  const reverse = normalizeDoorSpanPath([
    { col: 7, row: 4, edge: 's' },
    { col: 6, row: 4, edge: 's' },
    { col: 5, row: 4, edge: 's' },
  ], def);
  assertOk(reverse?.map(p => `${p.col},${p.row},${p.edge}`).join('|')
    === '5,5,n|6,5,n|7,5,n',
  'a reverse drag from the far face becomes one canonical increasing run');
  assertOk(normalizeDoorSpanPath(reverse.slice(0, 2), def) === null,
    'a short run cannot masquerade as a 3×1 door');
}

console.log('\n=== placement is atomic across every host wall ===\n');
{
  const game = richGame();
  horizontalWalls(game, 10, 10, 2);
  const before = game.state.resources.funding;
  assertOk(!game.placeDoor(10, 10, 'n', 'hangarDoor3'),
    'placement fails when any host wall segment is missing');
  assertOk(game.state.doors.length === 0 && game.state.resources.funding === before,
    'failed placement writes no record and spends no funding');
}

console.log('\n=== one record opens, bills, and removes the whole span ===\n');
{
  const game = richGame();
  horizontalWalls(game, 10, 10, 3);
  const before = game.state.resources.funding;
  assertOk(game.placeDoor(10, 9, 's', 'hangarDoor3'),
    'the 3×1 door places from the wall\'s far face');
  assertOk(game.state.doors.length === 1,
    'three open edges are represented by one atomic door record');
  assertOk(game.state.resources.funding === before - DOOR_TYPES.hangarDoor3.cost,
    'the complete door is charged exactly once');
  assertOk([10, 11, 12].every(col => game.state.doorOccupied[`${col},10,n`] === 'hangarDoor3'),
    'every covered physical edge is indexed as passable');
  assertOk([10, 11, 12].every(col => !isBlocked(col, 10, 'n', game.state)),
    'room and staff navigation see the entire opening');

  const record = game.state.doors[0];
  assertOk(doorRecordEdges(record, DOOR_TYPES[record.type]).length === 3
    && doorRecordCoversEdge(record, DOOR_TYPES[record.type], 11, 9, 's'),
  'the record resolves every segment through either edge spelling');

  const snapshot = buildWorldSnapshot(game, { only: ['doors'] });
  assertOk(snapshot.doors[0].tileSpan === 3 && snapshot.doors[0].segments.length === 3,
    'the renderer snapshot publishes span and all covered edges');

  assertOk(game.removeDoor(11, 9, 's'), 'clicking the middle segment removes the whole door');
  assertOk(game.state.doors.length === 0
    && [10, 11, 12].every(col => !game.state.doorOccupied[`${col},10,n`]),
  'whole-door demolition clears every occupancy key');
  assertOk(game.state.resources.funding === before - Math.ceil(DOOR_TYPES.hangarDoor3.cost / 2),
    'whole-door demolition applies one standard half-cost refund');
}

console.log('\n=== topology-changing edits cannot orphan wide-door segments ===\n');
{
  const game = richGame();
  horizontalWalls(game, 20, 20, 4);
  game.placeDoorPath([
    { col: 23, row: 20, edge: 'n' },
    { col: 22, row: 20, edge: 'n' },
    { col: 21, row: 20, edge: 'n' },
    { col: 20, row: 20, edge: 'n' },
  ], 'hangarDoor4');
  assertOk(game.state.doors.length === 1, 'a reverse 4-edge drag places one 4×1 door');
  assertOk(game.removeWall(22, 20, 'n'), 'a host wall in the middle can be demolished');
  assertOk(game.state.doors.length === 0
    && Object.values(game.state.doorOccupied).every(type => type !== 'hangarDoor4'),
  'removing any host wall removes the complete dependent door');
}

console.log('\n=== saved wide doors rebuild every derived occupancy edge ===\n');
{
  const game = richGame(712);
  horizontalWalls(game, 30, 30, 6);
  game.placeDoor(30, 30, 'n', 'hangarDoor6');
  localStorage.setItem('beamlineTycoon', game.serialize());
  const loaded = richGame(713);
  loaded.load();
  assertOk(loaded.state.doors.length === 1
    && loaded.state.doors[0].segments.length === 6,
  'the one 6×1 record survives serialization');
  assertOk([30, 31, 32, 33, 34, 35].every(
    col => loaded.state.doorOccupied[`${col},30,n`] === 'hangarDoor6'
  ), 'load rebuilds all six passability keys from the saved record');
  assertOk(loaded.removeDoor(35, 29, 's'),
    'the loaded door remains removable from any covered far-face edge');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
