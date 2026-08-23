import test from 'node:test';
import assert from 'node:assert/strict';

import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { GRID_SERVICE_HV_OUTPUT_MOUNTS } from '../src/data/utility-port-anchors.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { Game } from '../src/game/Game.js';
import {
  PLACE_MAP_EDGE,
  canPlace,
  previewPlacement,
} from '../src/game/placement.js';
import { mapEdgeServiceLeadPaths } from '../src/renderer3d/map-edge-service-lead.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { PORT_ANCHOR_BASE_STANDOFF } from '../src/utility/port-anchors.js';

function emptyPlacementGame(mapHalfExtent = 30) {
  return {
    state: {
      mapHalfExtent,
      subgridOccupied: {},
      wallOccupied: {},
    },
    canAfford: () => true,
  };
}

function clearGeneratedPlaceables(game) {
  game.state.placeables = [];
  game.state.placeableIndex = {};
  game.state.subgridOccupied = {};
  game.state.placeableNextId = 1;
}

test('3 MW grid service is an edge-fed 4×4 wood utility pole', () => {
  const def = PLACEABLES.gridServicePoint;
  const spec = def.mapEdgeConnection;
  assert.equal(spec.maxDistanceTiles, 4);
  assert.equal(spec.conductorCount, 4);
  assert.equal(def.subW, PLACEABLES.utilityPole.subW);
  assert.equal(def.subL, PLACEABLES.utilityPole.subL);
  assert.equal(def.subH, PLACEABLES.utilityPole.subH);
  assert.match(def.desc, /within four tiles/i);
});

test('6 MW grid service is an edge-fed transmission tower with two three-phase circuits', () => {
  const def = PLACEABLES.gridServicePointHighCapacity;
  const spec = def.mapEdgeConnection;
  assert.equal(spec.maxDistanceTiles, 4);
  assert.equal(spec.conductorCount, 6);
  assert.equal(def.subW, PLACEABLES.transmissionTower.subW);
  assert.equal(def.subL, PLACEABLES.transmissionTower.subL);
  assert.equal(def.subH, PLACEABLES.transmissionTower.subH);

  const paths = mapEdgeServiceLeadPaths({
    ...spec,
    insideMap: true,
    edge: 'west',
    startWorld: { x: -52, y: spec.leadHeightMeters, z: 1 },
    endWorld: { x: -60, y: spec.leadHeightMeters, z: 1 },
  });
  assert.equal(paths.length, 6);
  assert.equal(new Set(paths.map(path => path.world.start.z)).size, 6,
    'each incoming conductor occupies a distinct station');
});

test('placement accepts the four-tile boundary band and rejects the interior or off-map', () => {
  const game = emptyPlacementGame();
  const def = PLACEABLES.gridServicePoint;
  const check = (col, row, subCol = 0, subRow = 0, dir = 0) =>
    canPlace(game, def, col, row, subCol, subRow, dir);

  assert.equal(check(-26, 0).ok, true, 'west footprint edge is exactly four tiles in');
  assert.equal(check(27, 0).ok, true, 'east footprint edge is inside the four-tile band');
  assert.equal(check(0, -26).ok, true, 'north footprint edge is exactly four tiles in');
  assert.equal(check(0, 27).ok, true, 'south footprint edge is inside the four-tile band');

  const interior = previewPlacement(game, def, 0, 0, 0, 0, 0);
  assert.equal(interior.ok, false);
  assert.equal(interior.mapEdgeBlocked, true);
  assert.equal(interior.reason, PLACE_MAP_EDGE);
  assert.equal(check(-31, 0).ok, false, 'the complete footprint must remain on-map');
});

test('Game enforces the edge rule for both construction and movement', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 912 });
  clearGeneratedPlaceables(game);

  const rejected = game.placePlaceable({
    type: 'gridServicePoint', col: 0, row: 0, subCol: 0, subRow: 0, free: true,
  });
  assert.equal(rejected, false);
  assert.match(game.state.log[0]?.msg || '', /within 4 tiles of the map edge/i);

  const id = game.placePlaceable({
    type: 'gridServicePoint', col: -26, row: 0, subCol: 0, subRow: 0, free: true,
  });
  assert.ok(id);
  assert.equal(game.movePlaceable(id, {
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  }), false);
  assert.equal(game.getPlaceable(id).col, -26, 'a rejected move is atomic');
});

test('incoming conductors join the actual pole terminals and end at the map boundary', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 913 });
  clearGeneratedPlaceables(game);
  const id = game.placePlaceable({
    type: 'gridServicePoint', col: -26, row: 0, subCol: 0, subRow: 0, free: true,
  });
  assert.ok(id);

  const snapshot = buildWorldSnapshot(game, { only: ['components'] });
  const service = snapshot.components.find(entry => entry.id === id);
  const connection = service.mapEdgeConnection;
  assert.equal(connection.edge, 'west');
  assert.equal(connection.endWorld.x, -60, 'tile -30 begins at world x=-60');
  assert.deepEqual(connection.terminalPointsLocal,
    GRID_SERVICE_HV_OUTPUT_MOUNTS.gridServicePoint.map(mount => ({
      x: mount.localX + mount.normal.x * PORT_ANCHOR_BASE_STANDOFF,
      y: mount.y + mount.normal.y * PORT_ANCHOR_BASE_STANDOFF,
      z: mount.localZ + mount.normal.z * PORT_ANCHOR_BASE_STANDOFF,
    })));
  const pose = { x: -51.5, y: 0, z: 0.5, rotY: 0 };
  const paths = mapEdgeServiceLeadPaths(connection, pose);
  assert.equal(paths.length, 4);
  assert.deepEqual(paths.map(path => path.world.start),
    connection.terminalPointsLocal.map(point => ({
      x: pose.x + point.x, y: point.y, z: pose.z + point.z,
    })), 'every incoming lead starts on the exact player cable terminal');
  assert.ok(paths.every(path => path.world.end.x === -60));
  assert.ok(paths.every(path => path.world.end.y === path.world.start.y
    && path.world.end.z === path.world.start.z),
  'each off-map span preserves its terminal height and lateral station');
});

test('land expansion republishes the service and extends its leads to the new edge', () => {
  const game = new Game(new BeamlineRegistry(), { seed: 914 });
  clearGeneratedPlaceables(game);
  game.state.resources.funding = 1e12;
  const id = game.placePlaceable({
    type: 'gridServicePoint', col: -26, row: 0, subCol: 0, subRow: 0, free: true,
  });
  const events = [];
  game.on((event, payload) => events.push({ event, payload }));

  const result = game.buyLand();
  assert.equal(result.ok, true);
  assert.equal(game.state.mapHalfExtent, 60);
  assert.ok(events.some(({ event, payload }) =>
    event === 'placeableChanged' && payload?.placeableId === id));

  const service = buildWorldSnapshot(game, { only: ['components'] })
    .components.find(entry => entry.id === id);
  assert.equal(service.mapEdgeConnection.endWorld.x, -120);
  assert.equal(service.mapEdgeConnection.insideMap, true);
  assert.equal(service.mapEdgeConnection.withinRange, false,
    'the historical placement is retained even though the boundary moved');
  assert.equal(mapEdgeServiceLeadPaths(service.mapEdgeConnection).length, 4,
    'presentation persists and reaches the expanded boundary');
});
