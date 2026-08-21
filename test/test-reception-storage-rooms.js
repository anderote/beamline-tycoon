import assert from 'node:assert/strict';
import test from 'node:test';

import { ZONES, ZONE_FURNISHINGS, itemMatchesZone } from '../src/data/facility.js';
import { MODES } from '../src/data/modes.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { buildPaletteIndex, primaryFacilityZone } from '../src/ui/palette-search.js';

const RECEPTION_FURNISHINGS = [
  'waitingBench',
  'visitorKiosk',
  'brochureRack',
  'coatRack',
];

const STORAGE_FURNISHINGS = [
  'utilityShelving',
  'palletRack',
  'partsBinRack',
  'lockerBank',
  'packingTable',
  'supplyCart',
];

const SHARED_AVAILABILITY = {
  filingCabinet: ['officeSpace', 'reception', 'storageRoom'],
  pottedPlant: ['officeSpace', 'meetingRoom', 'reception'],
  receptionDesk: ['officeSpace', 'reception'],
  coffeeTable: ['officeSpace', 'meetingRoom', 'reception'],
  loungeTable: ['officeSpace', 'meetingRoom', 'reception'],
  couch: ['officeSpace', 'reception'],
  waterCooler: ['cafeteria', 'officeSpace', 'reception', 'storageRoom'],
  cafeteriaRefrigerator: ['cafeteria', 'storageRoom'],
  wasteStation: ['cafeteria', 'reception', 'storageRoom'],
  officeChair: ['officeSpace', 'reception'],
  meetingChair: ['meetingRoom', 'reception'],
};

test('Reception and Storage are complete Facility room-zone definitions', () => {
  assert.deepEqual(
    {
      name: ZONES.reception.name,
      requiredFloor: ZONES.reception.requiredFloor,
      subsection: ZONES.reception.subsection,
    },
    { name: 'Reception', requiredFloor: 'officeFloor', subsection: 'operations' },
  );
  assert.deepEqual(
    {
      name: ZONES.storageRoom.name,
      requiredFloor: ZONES.storageRoom.requiredFloor,
      subsection: ZONES.storageRoom.subsection,
    },
    { name: 'Storage Room', requiredFloor: 'concrete', subsection: 'industrial' },
  );

  for (const id of ['reception', 'storageRoom']) {
    const category = MODES.facility.categories[id];
    assert.ok(category, `${id} has a Facility palette tab`);
    assert.equal(category.isZoneTab, true);
    assert.equal(category.zoneType, id);
    assert.equal(category.group, 'rooms');
    assert.ok(ZONES[id].desc?.length > 0, `${id} has palette copy`);
  }
});

test('new Reception and Storage furnishings are authored placeables', () => {
  for (const id of [...RECEPTION_FURNISHINGS, ...STORAGE_FURNISHINGS]) {
    const def = PLACEABLES[id];
    assert.ok(def, `${id} is registered`);
    assert.equal(def.kind, 'furnishing');
    assert.ok(ZONE_FURNISHINGS[id], `${id} is visible to the Facility palette`);
    assert.ok(def.cost?.funding > 0, `${id} has a funding cost`);
    assert.ok(def.desc?.length > 0, `${id} has palette copy`);
    assert.ok(Array.isArray(def.parts) && def.parts.length > 0,
      `${id} has authored 3D geometry`);
  }

  for (const id of RECEPTION_FURNISHINGS) {
    assert.equal(itemMatchesZone(PLACEABLES[id], 'reception'), true,
      `${id} is available in Reception`);
  }
  for (const id of STORAGE_FURNISHINGS) {
    assert.equal(itemMatchesZone(PLACEABLES[id], 'storageRoom'), true,
      `${id} is available in Storage`);
  }

  assert.equal(itemMatchesZone(PLACEABLES.visitorKiosk, 'storageRoom'), false);
  assert.equal(itemMatchesZone(PLACEABLES.palletRack, 'reception'), false);
});

test('general-purpose furnishings remain visible in every compatible room', () => {
  for (const [id, zoneTypes] of Object.entries(SHARED_AVAILABILITY)) {
    for (const zoneType of zoneTypes) {
      assert.equal(itemMatchesZone(PLACEABLES[id], zoneType), true,
        `${id} is available in ${zoneType}`);
    }
  }
});

test('shared furnishings keep one stable home in build-menu search', () => {
  const index = buildPaletteIndex(null);

  for (const [id, zoneTypes] of Object.entries(SHARED_AVAILABILITY)) {
    const def = PLACEABLES[id];
    const results = index.filter(item => item.source === 'facility' && item.id === id);
    assert.equal(results.length, 1, `${id} appears once in global search`);
    assert.equal(primaryFacilityZone(def), zoneTypes[0],
      `${id} uses its first compatible room as the stable search home`);
    assert.equal(results[0].category, zoneTypes[0]);
  }
});
