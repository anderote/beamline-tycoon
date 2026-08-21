import assert from 'node:assert/strict';
import { findRoofRegion } from '../src/game/roofing.js';
import { detectRooms } from '../src/networks/rooms.js';

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
  return { infraOccupied, wallOccupied, doorOccupied: {} };
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

console.log('roof region selection passes');
