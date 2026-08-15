import assert from 'node:assert/strict';
import { FACILITY_ROOM_FURNISHINGS_RAW } from '../src/data/facility-room-furnishings.raw.js';

for (const id of ['pottedPlant', 'floorPlant']) {
  const def = FACILITY_ROOM_FURNISHINGS_RAW[id];
  assert(def, `${id} exists`);
  assert.equal(def.baseMaterial, null,
    `${id} uses its authored colors without a dark shared texture`);
  assert(def.parts.some(part => /leaf|canopy/.test(part.name)),
    `${id} contains foliage parts`);
}

console.log('Plant material tests passed.');
