import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { findRoofRegion, isRoofedRegion, roofProfileForRegion } from '../src/game/roofing.js';
import { detectRooms } from '../src/networks/rooms.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { roofVisibleForWallMode } from '../src/renderer3d/roof-visibility.js';
import { FLOORS, WALL_TYPES } from '../src/data/structure.js';

function enclosedState(width = 2, height = 2) {
  const infraOccupied = {};
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) infraOccupied[`${col},${row}`] = 'concrete';
  }
  const wallOccupied = {};
  for (let col = 0; col < width; col++) {
    wallOccupied[`${col},0,n`] = 'exteriorWall';
    wallOccupied[`${col},${height - 1},s`] = 'exteriorWall';
  }
  for (let row = 0; row < height; row++) {
    wallOccupied[`0,${row},w`] = 'exteriorWall';
    wallOccupied[`${width - 1},${row},e`] = 'exteriorWall';
  }
  return { infraOccupied, wallOccupied, doorOccupied: {}, cornerHeights: new Map() };
}

const state = enclosedState();
assert.deepEqual(findRoofRegion(state, 0, 0), [
  { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 },
]);
state.roofs = [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 }];
assert.equal(detectRooms(state)[0].roofed, true, 'a fully covered enclosed room is roofed');
state.roofs.pop();
assert.equal(detectRooms(state)[0].roofed, false, 'a partially covered room is not roofed');

const open = enclosedState();
delete open.wallOccupied['1,1,e'];
assert.deepEqual(findRoofRegion(open, 0, 0), [], 'an open wall boundary is not roofable');

const outside = enclosedState();
outside.infraOccupied['2,0'] = 'concrete';
delete outside.wallOccupied['1,0,e'];
assert.deepEqual(findRoofRegion(outside, 0, 0), [], 'a floor connection to an unbounded patch is not roofable');

const mixed = enclosedState();
mixed.wallOccupied['0,0,n'] = 'officeWall';
mixed.wallOccupied['1,0,n'] = 'hallwayWall';
mixed.wallOccupied['1,1,e'] = 'cinderblockWall';
assert.equal(findRoofRegion(mixed, 0, 0).length, 4,
  'different building-wall types form one valid roof boundary');

const doored = enclosedState(2, 1);
doored.wallOccupied['0,0,e'] = 'officeWall';
doored.doorOccupied['0,0,e'] = 'officeDoor';
assert.deepEqual(findRoofRegion(doored, 0, 0), [{ col: 0, row: 0 }],
  'a doorway separates adjacent roof regions instead of joining an entire facility');
assert.deepEqual(findRoofRegion(doored, 1, 0), [{ col: 1, row: 0 }],
  'the room on the other side of a doorway remains independently roofable');

const exteriorDoor = enclosedState(1, 1);
exteriorDoor.doorOccupied['0,0,n'] = 'officeDoor';
assert.equal(findRoofRegion(exteriorDoor, 0, 0).length, 1,
  'an exterior door in a complete wall still encloses its room for roofing');

const fenced = enclosedState(1, 1);
fenced.wallOccupied['0,0,n'] = 'chainLinkFence';
assert.deepEqual(findRoofRegion(fenced, 0, 0), [],
  'landscape fencing does not masquerade as a roof-bearing building wall');

const largeRoom = enclosedState(501, 1);
assert.equal(findRoofRegion(largeRoom, 0, 0).length, 501,
  'large enclosed high-bay rooms are not rejected by an arbitrary tile cap');

const highBay = enclosedState(1, 1);
for (const key of Object.keys(highBay.wallOccupied)) highBay.wallOccupied[key] = 'structuralWall';
assert.equal(roofProfileForRegion(highBay, findRoofRegion(highBay, 0, 0)).id, 'highBay',
  'a structural-wall-only room receives the high-bay roof profile');
highBay.wallOccupied['0,0,n'] = 'officeWall';
assert.equal(roofProfileForRegion(highBay, findRoofRegion(highBay, 0, 0)).id, 'dropCeiling',
  'mixing an interior wall into the boundary selects a suspended ceiling');

const upper = {
  infraOccupied: { '1|0,0': 'officeFloor' },
  wallOccupied: {
    '1|0,0,n': 'officeWall', '1|0,0,e': 'officeWall',
    '1|0,0,s': 'officeWall', '1|0,0,w': 'officeWall',
  },
  roofs: [{ col: 0, row: 0, level: 1, type: 'roof' }],
};
assert.deepEqual(findRoofRegion(upper, 0, 0, 1), [{ col: 0, row: 0, level: 1 }],
  'upper-storey enclosure uses level-aware floor and wall indexes');
assert.deepEqual(findRoofRegion(upper, 0, 0, 0), [],
  'an upper room does not appear on the ground floor');
assert.equal(isRoofedRegion(upper, findRoofRegion(upper, 0, 0, 1)), true,
  'upper roof tiles satisfy their own room');

highBay.roofs = [{ col: 0, row: 0, type: 'roof' }];
const roofSnapshot = buildWorldSnapshot({ state: highBay }, { only: ['roofs'] }).roofs[0];
assert.equal(roofSnapshot.profile, 'dropCeiling', 'the roof snapshot publishes the room profile');
assert.equal(roofSnapshot.texture, 'ceiling_acoustic_tile', 'the snapshot publishes the ceiling texture');
assert.equal(roofSnapshot.y, 2.68, 'the suspended ceiling sits at its lower authored height');

assert.equal(roofVisibleForWallMode('roof'), true, 'the new roof mode shows roofs');
for (const mode of ['up', 'cutaway', 'transparent', 'down']) {
  assert.equal(roofVisibleForWallMode(mode), false, `${mode} remains a roof-hidden wall mode`);
}
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('data-wall-mode="roof"') < html.indexOf('data-wall-mode="up"'),
  'the triangular roof button sits immediately to the left of Walls Up');

assert.equal(WALL_TYPES.officeWall.texture, 'wall_office', 'office walls have their own default texture');
assert.equal(WALL_TYPES.hallwayWall.texture, 'wall_hallway', 'hallway walls have their own default texture');
assert.equal(WALL_TYPES.labWall.texture, 'wall_lab', 'laboratory walls are available with a sealed-panel texture');
for (const texture of [
  WALL_TYPES.officeWall.texture,
  WALL_TYPES.hallwayWall.texture,
  WALL_TYPES.labWall.texture,
  FLOORS.roof.roofProfiles.dropCeiling.texture,
  FLOORS.roof.roofProfiles.highBay.texture,
]) {
  assert.ok(existsSync(new URL(`../assets/textures/materials/${texture}.png`, import.meta.url)),
    `${texture} has a generated material asset`);
}

console.log('roof region selection passes');
