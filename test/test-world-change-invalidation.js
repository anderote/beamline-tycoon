import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Game } from '../src/game/Game.js';
import {
  addPlaceableChange,
  createWorldChangeSet,
  mergeWorldChangeSets,
  placeableWorldChange,
} from '../src/game/world-change-set.js';
import { placeableMutationEvent } from '../src/game/placeable-events.js';
import { updateWorldSnapshot, buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { WorldInvalidationScheduler } from '../src/renderer3d/world-invalidation-scheduler.js';
import { worldRefreshPlan } from '../src/renderer3d/world-refresh-plan.js';

function emptyPlacementState(game) {
  game.state.placeables = [];
  game.state.placeableIndex = {};
  game.state.subgridOccupied = {};
  game.state.zoneFurnishings = [];
  game.state.facilityEquipment = [];
  game.state.cornerHeights = new Map();
  game.state.cornerHeightsRevision = 0;
}

test('world change-sets merge entity transitions to their net transaction result', () => {
  const first = createWorldChangeSet({ reason: 'first', domains: ['terrain'] });
  addPlaceableChange(first, { id: 'a', kind: 'equipment', action: 'added' });
  addPlaceableChange(first, { id: 'b', kind: 'furnishing', action: 'updated' });

  const second = createWorldChangeSet({ reason: 'second' });
  addPlaceableChange(second, { id: 'a', kind: 'equipment', action: 'removed' });
  addPlaceableChange(second, { id: 'b', kind: 'furnishing', action: 'removed' });
  addPlaceableChange(second, { id: 'c', kind: 'beamline', action: 'removed' });
  addPlaceableChange(second, { id: 'c', kind: 'beamline', action: 'added' });

  const merged = mergeWorldChangeSets(first, second);
  assert.equal(merged.placeables.has('a'), false, 'add then remove cancels');
  assert.equal(merged.placeables.get('b').action, 'removed');
  assert.equal(merged.placeables.get('c').action, 'updated', 'remove then add is replacement');
  assert.deepEqual([...merged.reasons], ['first', 'second']);
  assert.deepEqual([...merged.domains], ['terrain']);
});

test('Game event batches retain every exact placeable mutation', () => {
  const game = new Game(29);
  emptyPlacementState(game);
  const events = [];
  const worldEvents = [];
  game.on((event, data) => {
    if (event === 'placeableChanged') events.push(data);
    if (event === 'worldChanged') worldEvents.push(data);
  });

  game.batchEvents(() => {
    assert.ok(game.placePlaceable({
      type: 'diningTable', col: 0, row: 0, free: true, silent: true,
    }));
    assert.ok(game.placePlaceable({
      type: 'diningTable', col: 4, row: 0, free: true, silent: true,
    }));
  });

  assert.equal(events.length, 1, 'one compatibility event leaves the transaction');
  assert.equal(events[0].changeSet.placeables.size, 2,
    'last-data-wins batching no longer drops the first placement');
  assert.deepEqual(
    [...events[0].changeSet.placeables.values()].map(change => change.action),
    ['added', 'added'],
  );
  assert.equal(worldEvents.length, 1, 'all world domains share one canonical batch event');
  assert.equal(worldEvents[0].changeSet.placeables.size, 2);
  assert.equal(worldEvents[0].changeSet.domains.has('placeables'), true);
  assert.equal(worldEvents[0].changeSet.domains.has('palette'), true,
    'the furnishing compatibility follow-up contributes only its UI domain');
});

test('the frame scheduler unions compatibility events and applies once', () => {
  const entry = { id: 'fn_1', kind: 'furnishing' };
  const payload = placeableMutationEvent(entry, 'placed');
  const applied = [];
  const scheduler = new WorldInvalidationScheduler(plan => applied.push(plan));

  scheduler.enqueue(worldRefreshPlan('placeableChanged', payload));
  scheduler.enqueue(worldRefreshPlan('zonesChanged', payload));
  assert.equal(applied.length, 0, 'world work waits for the frame boundary');
  const plan = scheduler.flush();

  assert.equal(applied.length, 1);
  assert.equal(plan.equipment, true);
  assert.equal(plan.physicsBodies, true);
  assert.equal(plan.palette, true);
  assert.equal(plan.terrain, undefined);
  assert.equal(plan.changeSet.placeables.size, 1,
    'the compatibility follow-up does not duplicate the entity patch');
  assert.equal(scheduler.flush(), null, 'a second drain does no work');
});

test('legacy world events share the central conservative policy', () => {
  assert.deepEqual(
    Object.keys(worldRefreshPlan('wallsChanged')).sort(),
    ['changeSet', 'physicsBodies', 'walls'],
  );
  const beamline = worldRefreshPlan('beamlineChanged');
  assert.equal(beamline.components, true);
  assert.equal(beamline.pipeAttachments, true);
  assert.equal(beamline.beamPipes, true);
  assert.equal(beamline.utilityIssues, 'force');
  assert.equal(worldRefreshPlan('resourcesChanged'), null);
  assert.equal(worldRefreshPlan('loaded').full, true);
});

test('stable-id snapshot patches preserve untouched equipment and furnishings', () => {
  const equipment = {
    id: 'eq_1', kind: 'equipment', category: 'equipment', type: 'oscilloscope',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const furnishing = {
    id: 'fn_1', kind: 'furnishing', category: 'furnishing', type: 'diningTable',
    col: 2, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const game = {
    state: {
      placeables: [equipment, furnishing],
      placeableIndex: { eq_1: 0, fn_1: 1 },
      zoneFurnishings: [furnishing],
      cornerHeightsRevision: 0,
    },
    editingBeamlineId: null,
    registry: { get: () => null },
  };
  const current = buildWorldSnapshot(game, { only: ['equipment', 'furnishings'] });
  const untouchedEquipment = current.equipment[0];
  const moved = { ...furnishing, col: 3 };
  game.state.placeables[1] = moved;
  game.state.zoneFurnishings = [moved];
  const changeSet = placeableWorldChange(moved, 'moved');

  const partial = updateWorldSnapshot(game, current, {
    only: ['equipment', 'furnishings'], changeSet,
  });
  assert.strictEqual(partial.equipment[0], untouchedEquipment,
    'an unrelated equipment snapshot entry is not remapped');
  assert.equal(partial.furnishings[0].col, 3);
});

test('decoration snapshot patches preserve untouched entries until shared context changes', () => {
  const first = {
    id: 'dec_1', kind: 'decoration', category: 'outdoor', type: 'parkBench',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const second = {
    id: 'dec_2', kind: 'decoration', category: 'outdoor', type: 'parkBench',
    col: 2, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  const game = {
    state: {
      placeables: [first, second],
      placeableIndex: { dec_1: 0, dec_2: 1 },
      cornerHeights: new Map(),
      cornerHeightsRevision: 0,
      wallOccupied: {},
      zoneOccupied: {},
    },
  };
  const current = buildWorldSnapshot(game, { only: ['decorations'] });
  const untouched = current.decorations.find(entry => entry.id === 'dec_2');
  const moved = { ...first, col: 1 };
  game.state.placeables[0] = moved;
  const exact = placeableWorldChange(moved, 'moved');
  const partial = updateWorldSnapshot(game, current, {
    only: ['decorations'], changeSet: exact,
  });
  assert.strictEqual(
    partial.decorations.find(entry => entry.id === 'dec_2'),
    untouched,
    'an exact decoration move does not remap unrelated entries',
  );
  assert.equal(partial.decorations.find(entry => entry.id === 'dec_1').col, 1);

  exact.domains.add('terrain');
  const contextual = updateWorldSnapshot(game, current, {
    only: ['decorations'], changeSet: exact,
  });
  assert.notStrictEqual(
    contextual.decorations.find(entry => entry.id === 'dec_2'),
    untouched,
    'terrain/room/wall context retains the safe full-section fallback',
  );
});
