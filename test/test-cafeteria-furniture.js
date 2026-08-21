import assert from 'node:assert/strict';
import test from 'node:test';

import { FACILITY_ROOM_FURNISHINGS_RAW } from '../src/data/facility-room-furnishings.raw.js';
import { itemMatchesZone } from '../src/data/facility.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { buildStationIndex } from '../src/game/staff/stations.js';

const NEW_CAFETERIA_IDS = [
  'cafeTable',
  'breakfastBar',
  'barStool',
  'cafeteriaRefrigerator',
  'sinkCounter',
  'condimentStation',
  'wasteStation',
];

function place(type, col, row, subCol = 0, subRow = 0, dir = 0, id = type) {
  const def = PLACEABLES[type];
  return {
    id, type, kind: def.kind, col, row, subCol, subRow, dir,
    cells: def.footprintCells(col, row, subCol, subRow, dir),
  };
}

test('new cafeteria furniture is registered, described, and visibly authored', () => {
  for (const id of NEW_CAFETERIA_IDS) {
    const raw = FACILITY_ROOM_FURNISHINGS_RAW[id];
    const def = PLACEABLES[id];

    assert.ok(raw, `${id} is authored in the room-furnishing registry`);
    assert.ok(def, `${id} is exposed through PLACEABLES`);
    assert.equal(def.kind, 'furnishing');
    assert.equal(itemMatchesZone(def, 'cafeteria'), true);
    assert.equal(typeof def.cost?.funding, 'number');
    assert.ok(def.cost.funding > 0);
    assert.ok(Array.isArray(def.parts) && def.parts.length > 0,
      `${id} has authored 3D geometry instead of a fallback box`);
    assert.ok(def.desc?.length > 0, `${id} has a palette description`);
  }
});

test('two-seat cafe table exposes two real eating slots with chairs', () => {
  const table = place('cafeTable', 4, 4, 0, 0, 0, 'table');
  const northChair = place('cafeteriaChair', 4, 4, 0, 3, 0, 'north-chair');
  const southChair = place('cafeteriaChair', 4, 3, 0, 2, 2, 'south-chair');
  const state = {
    placeables: [table, northChair, southChair],
    zoneOccupied: {},
  };

  const refs = buildStationIndex(state).byJob.eat || [];
  assert.equal(refs.length, 2);
  assert.deepEqual(new Set(refs.map(ref => ref.seatPlaceableId)),
    new Set(['north-chair', 'south-chair']));
  assert.ok(refs.every(ref => ref.defId === 'cafeTable' && ref.seated));
});

test('breakfast bar exposes three real eating slots with bar stools', () => {
  const bar = place('breakfastBar', 6, 6, 0, 0, 0, 'bar');
  const stools = [0, 1, 2].map(subCol =>
    place('barStool', 6, 6, subCol, 2, 0, `stool-${subCol}`));
  const state = {
    placeables: [bar, ...stools],
    zoneOccupied: {},
  };

  const refs = buildStationIndex(state).byJob.eat || [];
  assert.equal(refs.length, 3);
  assert.deepEqual(new Set(refs.map(ref => ref.seatPlaceableId)),
    new Set(['stool-0', 'stool-1', 'stool-2']));
  assert.ok(refs.every(ref => ref.defId === 'breakfastBar' && ref.seated));
});
