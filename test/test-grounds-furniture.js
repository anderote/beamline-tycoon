import assert from 'node:assert/strict';
import { DECORATIONS } from '../src/data/decorations.js';
import { MODES } from '../src/data/modes.js';

const furnitureIds = [
  'trashCan', 'recyclingBin', 'infoSign', 'directionSign', 'flagpole',
];

assert.ok(MODES.grounds.categories.furniture?.isDecorationTab,
  'Grounds keeps one Furniture decoration tab');
assert.equal(MODES.grounds.categories.bins, undefined,
  'Grounds has no separate Bins & Signs tab');
for (const id of furnitureIds) {
  assert.equal(DECORATIONS[id]?.category, 'furniture',
    `${DECORATIONS[id]?.name || id} appears in Grounds Furniture`);
}

console.log('grounds furniture organization contract passed');
