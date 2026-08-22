import assert from 'node:assert/strict';
import test from 'node:test';

import { ZONES, itemMatchesZone } from '../src/data/facility.js';
import { MODES, ROOM_FURNITURE_GROUPS } from '../src/data/modes.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { floorSupportsZone } from '../src/data/structure.js';

const BATHROOM_FURNISHINGS = [
  'toilet', 'urinal', 'sinkVanity', 'bathroomMirror',
  'handDryer', 'toiletStall', 'paperTowelBin',
];

test('bathroom is a tile-floor Facility room zone', () => {
  assert.equal(ZONES.bathroom?.requiredFloor, 'terrazzoFloor');
  assert.equal(MODES.facility.categories.bathroom?.zoneType, 'bathroom');
  assert.equal(MODES.facility.categories.bathroom?.group, 'rooms');
  assert.equal(floorSupportsZone('terrazzoFloor', ZONES.bathroom.requiredFloor), true);
  assert.equal(floorSupportsZone('officeFloor', ZONES.bathroom.requiredFloor), false);
});

test('bathroom fixture catalogue is complete, registered, and zone-scoped', () => {
  assert.ok(ROOM_FURNITURE_GROUPS.hygiene);
  for (const id of BATHROOM_FURNISHINGS) {
    const def = PLACEABLES[id];
    assert.ok(def, `${id} is registered`);
    assert.equal(def.kind, 'furnishing');
    assert.equal(def.furnitureGroup, 'hygiene');
    assert.equal(itemMatchesZone(def, 'bathroom'), true);
    assert.equal(typeof def.cost?.funding, 'number');
    assert.ok(def.cost.funding > 0);
    assert.ok(def.desc?.length > 0);
    assert.ok(Array.isArray(def.parts) && def.parts.length > 0);
  }
});
