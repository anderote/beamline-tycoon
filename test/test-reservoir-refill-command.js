import test from 'node:test';
import assert from 'node:assert/strict';

import {
  refillEmptyReservoirForPlaceable,
  refillUtilityNetwork,
} from '../src/game/reservoir-refill.js';
import { WATER_COST_PER_L } from '../src/utility/types/coolingWater.js';
import { LHE_COST_PER_L } from '../src/utility/types/cryoTransfer.js';
import { InputHandler } from '../src/input/InputHandler.js';

function reservoirState({
  placeableId,
  type,
  utilityType,
  networkId,
  capacity,
  persistent,
}) {
  return {
    placeables: [{
      id: placeableId, type, kind: 'infrastructure',
      col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
    }],
    utilityNetworks: new Map([[utilityType, [{
      id: networkId,
      sources: [{ placeableId, params: { storageCapacityL: capacity } }],
      sinks: [],
    }]]]),
    utilityNetworkState: new Map([[networkId, persistent]]),
  };
}

test('click command refills an empty cooling-water reservoir and charges its full cost', () => {
  const state = reservoirState({
    placeableId: 'tank',
    type: 'waterTank',
    utilityType: 'coolingWater',
    networkId: 'water-net',
    capacity: 500,
    persistent: { reservoirVolumeL: 0, reservoirCapacityL: 500 },
  });
  let charged = null;

  const result = refillEmptyReservoirForPlaceable(state, 'tank', {
    canAfford: () => true,
    charge: cost => { charged = cost; },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(charged, { funding: 500 * WATER_COST_PER_L });
  assert.equal(state.utilityNetworkState.get('water-net').reservoirVolumeL, 500);
});

test('click command leaves a partially full reservoir alone', () => {
  const state = reservoirState({
    placeableId: 'tank',
    type: 'waterTank',
    utilityType: 'coolingWater',
    networkId: 'water-net',
    capacity: 500,
    persistent: { reservoirVolumeL: 1, reservoirCapacityL: 500 },
  });
  let chargeCount = 0;

  const result = refillEmptyReservoirForPlaceable(state, 'tank', {
    canAfford: () => true,
    charge: () => { chargeCount++; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_empty');
  assert.equal(chargeCount, 0);
  assert.equal(state.utilityNetworkState.get('water-net').reservoirVolumeL, 1);
});

test('the manual network command still tops up a partial reservoir', () => {
  const state = reservoirState({
    placeableId: 'tank',
    type: 'waterTank',
    utilityType: 'coolingWater',
    networkId: 'water-net',
    capacity: 500,
    persistent: { reservoirVolumeL: 100, reservoirCapacityL: 500 },
  });
  let charged = null;

  const result = refillUtilityNetwork(state, 'coolingWater', 'water-net', {
    canAfford: () => true,
    charge: cost => { charged = cost; },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(charged, { funding: 400 * WATER_COST_PER_L });
  assert.equal(state.utilityNetworkState.get('water-net').reservoirVolumeL, 500);
});

test('empty liquid-helium storage uses the same click transaction', () => {
  const state = reservoirState({
    placeableId: 'recovery',
    type: 'heRecovery',
    utilityType: 'cryoTransfer',
    networkId: 'cryo-net',
    capacity: 2000,
    persistent: { lheVolumeL: 0, reservoirCapacityL: 2000 },
  });
  let charged = null;

  const result = refillEmptyReservoirForPlaceable(state, 'recovery', {
    canAfford: () => true,
    charge: cost => { charged = cost; },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(charged, { funding: 2000 * LHE_COST_PER_L });
  assert.equal(state.utilityNetworkState.get('cryo-net').lheVolumeL, 2000);
});

test('an unaffordable click never mutates or charges the empty reservoir', () => {
  const state = reservoirState({
    placeableId: 'tank',
    type: 'waterTank',
    utilityType: 'coolingWater',
    networkId: 'water-net',
    capacity: 500,
    persistent: { reservoirVolumeL: 0, reservoirCapacityL: 500 },
  });
  let chargeCount = 0;

  const result = refillEmptyReservoirForPlaceable(state, 'tank', {
    canAfford: () => false,
    charge: () => { chargeCount++; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unaffordable');
  assert.equal(chargeCount, 0);
  assert.equal(state.utilityNetworkState.get('water-net').reservoirVolumeL, 0);
});

test('normal placeable clicks request auto-refill while Shift-click remains selection-only', () => {
  const entry = {
    id: 'tank', type: 'waterTank', kind: 'infrastructure',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  let refillCount = 0;
  let selectionCount = 0;
  const input = {
    _mouseSelectionCategories: new Set(['infra']),
    renderer: {
      raycastScreen: () => ({}),
      identifyHit: () => ({ nodeId: entry.id, rootObj: {} }),
    },
    game: {
      state: { placeables: [entry] },
      getPlaceable: () => entry,
      refillEmptyReservoirForPlaceable: () => { refillCount++; },
    },
    _selectPlaceable: () => { selectionCount++; return true; },
  };

  InputHandler.prototype._selectPlaceableAt.call(
    input, {}, { col: 0, row: 0 }, 20, 20, { additive: false },
  );
  InputHandler.prototype._selectPlaceableAt.call(
    input, {}, { col: 0, row: 0 }, 20, 20, { additive: true },
  );

  assert.equal(refillCount, 1);
  assert.equal(selectionCount, 2);
});

test('the legacy footprint click fallback also requests an empty-only refill', () => {
  const entry = {
    id: 'tank', type: 'waterTank', kind: 'infrastructure',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
  };
  let refillCount = 0;
  let openedCount = 0;
  const input = {
    _suppressNextClick: false,
    activeTool: null,
    renderer: {
      screenToWorld: () => ({ x: 0, y: 0 }),
      raycastStaffScreen: () => null,
      raycastUtilityLine: () => null,
      showNetworkOverlay: () => {},
      openEquipmentWindow: () => { openedCount++; },
    },
    game: {
      state: {
        facilityGrid: { '0,0': entry.id },
        facilityEquipment: [entry],
      },
      refillEmptyReservoirForPlaceable: () => { refillCount++; },
    },
    _toolConsumed: () => false,
    _selectPlaceableAt: () => false,
  };

  InputHandler.prototype._handleClick.call(input, 20, 20);
  InputHandler.prototype._handleClick.call(input, 20, 20, { shiftKey: true });

  assert.equal(refillCount, 1);
  assert.equal(openedCount, 2);
});
