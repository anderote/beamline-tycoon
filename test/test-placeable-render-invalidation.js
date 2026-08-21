// Placement should invalidate only the renderer sections its kind can change.
// This is a performance contract: rebuilding detailed beamline geometry or
// every light pool when a table is placed makes a single click visibly stall.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Game } from '../src/game/Game.js';
import { setTileCorners } from '../src/game/terrain.js';
import { placeableRefreshPlan } from '../src/renderer3d/placeable-refresh-plan.js';

function emptyPlacementState(game) {
  game.state.placeables = [];
  game.state.placeableIndex = {};
  game.state.subgridOccupied = {};
  game.state.zoneFurnishings = [];
  game.state.facilityEquipment = [];
  game.state.cornerHeights = new Map();
  game.state.cornerHeightsRevision = 0;
}

function placementEvents(game, type) {
  const events = [];
  game.on((event, data) => {
    if (['placeableChanged', 'facilityChanged', 'zonesChanged'].includes(event)) {
      events.push({ event, data });
    }
  });
  const id = game.placePlaceable({
    type, col: 0, row: 0, subCol: 0, subRow: 0, free: true, silent: true,
  });
  assert.ok(id, `${type} placement succeeds`);
  return events;
}

test('flat-ground table placement publishes a scoped, idempotent mutation', () => {
  const game = new Game(17);
  emptyPlacementState(game);

  const events = placementEvents(game, 'diningTable');
  assert.deepEqual(events.map(({ event }) => event), ['placeableChanged', 'zonesChanged']);
  assert.equal(events[0].data.source, 'placeable-mutation');
  assert.equal(events[0].data.kind, 'furnishing');
  assert.equal(events[0].data.action, 'placed');
  assert.equal(events[0].data.terrainChanged, false,
    'already-flat ground must not invalidate the full terrain cache');
  assert.equal(game.state.cornerHeightsRevision, 0,
    'idempotent flattening must not bump the terrain revision');
  assert.strictEqual(events[1].data, events[0].data,
    'the compatibility follow-up shares the scoped mutation payload');
});

test('sloped-ground placement still requests the necessary terrain rebuild', () => {
  const game = new Game(18);
  emptyPlacementState(game);
  setTileCorners(game.state, 0, 0, { nw: 1, ne: 1, se: 1, sw: 1 });
  const revisionBefore = game.state.cornerHeightsRevision;

  const events = placementEvents(game, 'diningTable');
  assert.equal(events[0].data.terrainChanged, true);
  assert.ok(game.state.cornerHeightsRevision > revisionBefore);
});

test('furnishing placement avoids unrelated geometry and duplicate zone rebuilds', () => {
  const mutation = {
    source: 'placeable-mutation', action: 'placed', kind: 'furnishing',
    placeableId: 'fn_1', terrainChanged: false,
  };
  assert.deepEqual(placeableRefreshPlan('placeableChanged', mutation), {
    terrain: false,
    equipment: true,
    physicsBodies: true,
  });
  assert.deepEqual(placeableRefreshPlan('zonesChanged', mutation), { palette: true });
});

test('equipment placement refreshes its utilities without rebuilding beamline models', () => {
  const game = new Game(19);
  emptyPlacementState(game);
  const events = placementEvents(game, 'oscilloscope');
  assert.deepEqual(events.map(({ event }) => event), ['placeableChanged', 'facilityChanged']);

  const plan = placeableRefreshPlan('placeableChanged', events[0].data);
  assert.equal(plan.equipment, true);
  assert.equal(plan.utilityLines, true);
  assert.equal(plan.utilityIssues, 'force');
  assert.equal(plan.portFittings, true);
  assert.equal(plan.components, undefined);
  assert.equal(plan.decorations, undefined);
  assert.deepEqual(placeableRefreshPlan('facilityChanged', events[1].data), {});
});

test('unscoped legacy mutations retain the conservative full refresh', () => {
  const plan = placeableRefreshPlan('placeableChanged');
  assert.equal(plan.equipment, true);
  assert.equal(plan.decorations, true);
  assert.equal(plan.components, true);
  assert.equal(plan.utilityLines, true);
  assert.equal(plan.portFittings, true);
  assert.equal(plan.physicsBodies, true);
});
