import assert from 'node:assert/strict';
import test from 'node:test';

import { ZONES, itemMatchesZone } from '../src/data/facility.js';
import { MODES, ROOM_FURNITURE_GROUPS } from '../src/data/modes.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { floorSupportsZone } from '../src/data/structure.js';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';

const BATHROOM_FURNISHINGS = [
  'toilet', 'urinal', 'sinkVanity', 'bathroomMirror',
  'handDryer', 'toiletStall', 'toiletStallWall', 'toiletStallDoor', 'paperTowelBin',
];

test('bathroom is a tile-floor Facility room zone', () => {
  assert.equal(ZONES.bathroom?.requiredFloor, 'terrazzoFloor');
  assert.equal(MODES.facility.categories.bathroom?.zoneType, 'bathroom');
  assert.equal(MODES.facility.categories.bathroom?.group, 'rooms');
  assert.equal(floorSupportsZone('terrazzoFloor', ZONES.bathroom.requiredFloor), true);
  assert.equal(floorSupportsZone('officeFloor', ZONES.bathroom.requiredFloor), false);
  assert.equal(ZONES.bathroom.wallPaintable, false);
});

test('bathroom walls retain their fixed finish and cubicle fixtures are not paint targets', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 91 });
  game.state.resources.funding = 1e6;
  assert.equal(game.placeFacilityZoneBrushTile(8, 8, 'bathroom'), true);
  assert.equal(game.placeWall(8, 8, 'n', 'interiorWall'), true);
  assert.equal(game.paintWallFace(8, 8, 'n', 'labBlue'), false,
    'bathroom-facing wall rejects paint');
  assert.equal(game.paintWallFace(8, 7, 's', 'labBlue'), false,
    'the mirrored face of a bathroom wall also rejects paint');

  const wallId = game.placePlaceable({ type: 'toiletStallWall', col: 8, row: 8, subCol: 1, subRow: 0 });
  assert.ok(wallId);
  assert.equal(game.state.wallOccupied['8,8,n'], 'interiorWall',
    'cubicle wall stays a fixed-finish furnishing, not a paintable building wall');
});

test('bathroom stall walls and doors have authored cubicle geometry', () => {
  const partition = PLACEABLES.toiletStall;
  const wall = PLACEABLES.toiletStallWall;
  const door = PLACEABLES.toiletStallDoor;
  const part = (def, name) => def.parts.find(candidate => candidate.name === name);
  const bottomMeters = authoredPart => authoredPart.y * 0.5;
  const topMeters = authoredPart => (authoredPart.y + authoredPart.h) * 0.5;
  for (const [def, panelName] of [
    [partition, 'partition'], [wall, 'panel'], [door, 'doorLeaf'],
  ]) {
    const panel = part(def, panelName);
    assert.equal(bottomMeters(panel), 0.25,
      `${def.id} leaves a realistic privacy-panel floor gap`);
    assert.equal(topMeters(panel), 1.85,
      `${def.id} privacy panel stays below ordinary room partitions`);
  }
  assert.equal(topMeters(part(wall, 'frontPost')), 1.9,
    'stall posts terminate at the top rail instead of extending toward the ceiling');
  assert.ok(Math.abs(topMeters(part(door, 'topRail')) - 1.9) < 1e-9,
    'stall door rail aligns with the wall posts');
  assert.ok(door.parts.some(part => part.name === 'latch'));
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
