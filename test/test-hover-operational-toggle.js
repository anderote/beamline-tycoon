import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hoveredOperationalTarget,
  toggleHoveredOperationalTarget,
} from '../src/input/hover-operational-toggle.js';
import { InputHandler } from '../src/input/InputHandler.js';

function gameWith(entry, actions = []) {
  const calls = [];
  const game = {
    state: { placeables: [entry] },
    registry: {
      getBySourceId(id) {
        return id === entry.id && entry.legacyBeamlineId
          ? { id: entry.legacyBeamlineId }
          : null;
      },
    },
    getPlaceable(id) { return this.state.placeables.find(item => item.id === id); },
    getPowerDeviceActions() { return actions; },
    runUndoableMutation(mutate) { calls.push(['undo']); return mutate(); },
    toggleBeam(id) { calls.push(['beam', id]); return true; },
    dispatchPowerDeviceAction(id, actionId) {
      calls.push(['device', id, actionId]);
      return { ok: true };
    },
  };
  return { game, calls };
}

test('hovering a beamline source toggles that source’s beamline', () => {
  const { game, calls } = gameWith({
    id: 'source_1', type: 'source', beamlineId: 'bl-7',
  });

  const outcome = toggleHoveredOperationalTarget(game, 'placeable:source_1');

  assert.equal(outcome.handled, true);
  assert.deepEqual(outcome.target, {
    kind: 'beamline', id: 'bl-7', placeableId: 'source_1',
  });
  assert.deepEqual(calls, [['undo'], ['beam', 'bl-7']]);
});

test('legacy source records resolve their beamline through the registry', () => {
  const { game } = gameWith({
    id: 'source_old', type: 'source', legacyBeamlineId: 'bl-old',
  });

  assert.equal(
    hoveredOperationalTarget(game, 'placeable:source_old')?.id,
    'bl-old',
  );
});

test('hover Space chooses only true electrical on/off actions', () => {
  const { game, calls } = gameWith(
    { id: 'disconnect_1', type: 'disconnectSwitch' },
    [
      { id: 'resetBreaker', label: 'Reset breaker' },
      { id: 'toggleSwitch', label: 'Open switch' },
    ],
  );

  const outcome = toggleHoveredOperationalTarget(game, 'equip:disconnect_1');

  assert.equal(outcome.handled, true);
  assert.deepEqual(calls, [['undo'], ['device', 'disconnect_1', 'toggleSwitch']]);
});

test('generator enable/disable is available but maintenance actions are not', () => {
  const { game } = gameWith(
    { id: 'generator_1', type: 'backupGenerator' },
    [
      { id: 'refuelGenerator', label: 'Refuel' },
      { id: 'toggleGenerator', label: 'Disable standby' },
    ],
  );
  assert.equal(
    hoveredOperationalTarget(game, 'placeable:generator_1')?.actionId,
    'toggleGenerator',
  );

  game.getPowerDeviceActions = () => [{ id: 'refuelGenerator' }];
  assert.equal(hoveredOperationalTarget(game, 'placeable:generator_1'), null);
});

test('non-toggleable objects and non-placeable hover targets are ignored', () => {
  const { game } = gameWith({ id: 'quad_1', type: 'quadrupole' });
  assert.equal(hoveredOperationalTarget(game, 'placeable:quad_1'), null);
  assert.equal(hoveredOperationalTarget(game, 'utility:line_1'), null);
  assert.equal(toggleHoveredOperationalTarget(game, 'staff:staff_1').handled, false);
});

test('the input boundary consumes one Space press and ignores key repeat', () => {
  const { game, calls } = gameWith({
    id: 'source_1', type: 'source', beamlineId: 'bl-1',
  });
  let prevented = 0;
  let refreshed = 0;
  const input = {
    game,
    renderer: { refreshContextWindows() { refreshed++; } },
    _hoverTooltipTarget: 'placeable:source_1',
  };

  const handled = InputHandler.prototype.handleHoverOperationalToggleKey.call(input, {
    key: ' ', repeat: false, preventDefault() { prevented++; },
  });
  const repeated = InputHandler.prototype.handleHoverOperationalToggleKey.call(input, {
    key: ' ', repeat: true, preventDefault() { prevented++; },
  });

  assert.equal(handled, true);
  assert.equal(repeated, true);
  assert.equal(prevented, 2);
  assert.equal(refreshed, 1);
  assert.deepEqual(calls, [['undo'], ['beam', 'bl-1']]);
});
