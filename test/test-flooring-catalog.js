import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { FLOORS, floorRequirementLabel, floorSupportsZone } from '../src/data/structure.js';
import { Game } from '../src/game/Game.js';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const FINISH_FAMILIES = [
  'carpetFloor', 'hardwoodFloor', 'resilientFloor', 'terrazzoFloor', 'rubberFloor',
];
const MATERIAL_CATALOG_SOURCE = readFileSync('src/renderer3d/materials/tiled.js', 'utf8');

function makeGame(seed = 7501) {
  const game = new Game(new BeamlineRegistry(), { seed });
  game.state.resources.funding = 1e9;
  return game;
}

function prepareFloor(game, col, row, type, variant = 0) {
  assert.equal(game.placeInfraTile(col, row, 'concrete'), true);
  assert.equal(game.placeInfraTile(col, row, type, variant), true);
}

test('indoor finish families expose complete priced texture catalogs', () => {
  for (const id of FINISH_FAMILIES) {
    const floor = FLOORS[id];
    assert.ok(floor, `${id} is registered`);
    assert.equal(floor.structureFloor, true, `${id} is shown in Structure > Flooring`);
    assert.equal(floor.requiresFoundation, 'concrete');
    assert.ok(floor.variants.length >= 6, `${id} has a meaningful finish range`);
    assert.equal(floor.variantTextures.length, floor.variants.length);
    assert.equal(floor.variantTints.length, floor.variants.length);
    assert.equal(floor.variantPreviewColors.length, floor.variants.length);
    assert.equal(floor.variantCosts.length, floor.variants.length);

    for (const texture of new Set(floor.variantTextures)) {
      assert.equal(
        existsSync(`assets/textures/materials/${texture}.png`), true,
        `${id} texture ${texture} exists`,
      );
      assert.match(
        MATERIAL_CATALOG_SOURCE,
        new RegExp(`\\b${texture}\\s*:`),
        `${id} texture ${texture} is registered with the 3D material catalog`,
      );
    }
  }
});

test('floor compatibility distinguishes office, lab, shared, and industrial finishes', () => {
  assert.equal(floorSupportsZone('carpetFloor', 'officeFloor'), true);
  assert.equal(floorSupportsZone('carpetFloor', 'labFloor'), false);
  assert.equal(floorSupportsZone('rubberFloor', 'labFloor'), true);
  assert.equal(floorSupportsZone('rubberFloor', 'officeFloor'), false);
  assert.equal(floorSupportsZone('terrazzoFloor', 'officeFloor'), true);
  assert.equal(floorSupportsZone('terrazzoFloor', 'labFloor'), true);
  assert.equal(floorSupportsZone('concrete', 'concrete'), true);
  assert.equal(floorRequirementLabel('officeFloor'), 'Office-compatible flooring');
  assert.equal(floorRequirementLabel('labFloor'), 'Lab-compatible flooring');
});

test('Facility zones accept compatible finishes and reject incompatible ones', () => {
  const game = makeGame();
  prepareFloor(game, 8, 8, 'carpetFloor', 3);
  prepareFloor(game, 9, 8, 'rubberFloor', 1);
  prepareFloor(game, 10, 8, 'terrazzoFloor', 2);

  assert.equal(game.placeZoneTile(8, 8, 'controlRoom'), true);
  assert.equal(game.placeZoneTile(9, 8, 'controlRoom'), false);
  assert.equal(game.placeZoneTile(9, 8, 'rfLab'), true);
  assert.equal(game.placeZoneTile(10, 8, 'meetingRoom'), true);
});

test('compatible finish replacement preserves a zone; incompatible replacement evicts it', () => {
  const game = makeGame(7502);
  prepareFloor(game, 12, 12, 'carpetFloor', 0);
  assert.equal(game.placeZoneTile(12, 12, 'officeSpace'), true);

  assert.equal(game.placeInfraTile(12, 12, 'hardwoodFloor', 3), true);
  assert.equal(game.state.zoneOccupied['12,12'], 'officeSpace');

  assert.equal(game.placeInfraTile(12, 12, 'rubberFloor', 0), true);
  assert.equal(game.state.zoneOccupied['12,12'], undefined);
  assert.equal(game.state.zones.some(zone => zone.col === 12 && zone.row === 12), false);
});

test('Facility brush keeps an already-compatible custom finish and charges no replacement', () => {
  const game = makeGame(7503);
  prepareFloor(game, 14, 14, 'resilientFloor', 4);
  const fundingBefore = game.state.resources.funding;

  assert.deepEqual(
    game.computeFacilityBrushCost(14, 14, 14, 14, 'controlRoom'),
    { newTiles: 1, totalCost: 0 },
  );
  assert.equal(game.placeFacilityZoneBrushTile(14, 14, 'controlRoom'), true);
  assert.equal(game.state.infraOccupied['14,14'], 'resilientFloor');
  assert.equal(game.state.resources.funding, fundingBefore);
});
