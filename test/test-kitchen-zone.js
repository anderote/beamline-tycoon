import assert from 'node:assert/strict';
import test from 'node:test';

import { ZONES, itemMatchesZone } from '../src/data/facility.js';
import { MODES, ROOM_FURNITURE_GROUPS } from '../src/data/modes.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

const KITCHEN_FURNISHINGS = [
  'dishwasher', 'warmingCabinet', 'plateStation', 'servingCounter',
  'vendingMachine', 'microwave', 'waterCooler', 'cafeteriaRefrigerator',
  'sinkCounter', 'condimentStation', 'wasteStation',
];

test('Kitchen is a Facility room zone with the room palette contract', () => {
  const zone = ZONES.kitchen;
  const category = MODES.facility.categories.kitchen;

  assert.ok(zone);
  assert.equal(zone.name, 'Kitchen');
  assert.equal(zone.requiredFloor, 'officeFloor');
  assert.equal(zone.subsection, 'operations');
  assert.equal(category?.isZoneTab, true);
  assert.equal(category?.zoneType, 'kitchen');
  assert.equal(category?.group, 'rooms');
  assert.equal(category?.furnitureGroups, ROOM_FURNITURE_GROUPS);
});

test('Kitchen offers food-preparation furnishings, not cafeteria seating', () => {
  for (const id of KITCHEN_FURNISHINGS) {
    const def = PLACEABLES[id];
    assert.equal(def?.kind, 'furnishing', `${id} is a furnishing`);
    assert.equal(itemMatchesZone(def, 'kitchen'), true, `${id} is available in kitchens`);
  }

  assert.equal(itemMatchesZone(PLACEABLES.diningTable, 'kitchen'), false);
  assert.equal(itemMatchesZone(PLACEABLES.cafeteriaChair, 'kitchen'), false);
});
