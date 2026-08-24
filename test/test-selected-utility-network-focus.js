import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InputHandler } from '../src/input/InputHandler.js';
import { selectedUtilityNetworkFocusModel } from '../src/renderer3d/selected-utility-network-focus.js';

function fixture() {
  const selectedLine = {
    id: 'power_trunk',
    utilityType: 'powerCable',
    start: { placeableId: 'source', portName: 'out' },
    end: { placeableId: 'panel', portName: 'in' },
  };
  const branchLine = {
    id: 'power_branch',
    utilityType: 'powerCable',
    start: { placeableId: 'panel', portName: 'out' },
    end: { placeableId: 'load', portName: 'in' },
  };
  const unrelatedLine = {
    id: 'power_other',
    utilityType: 'powerCable',
    start: { placeableId: 'other_source', portName: 'out' },
    end: { placeableId: 'other_load', portName: 'in' },
  };
  const selectedNetwork = {
    id: 'net_selected',
    utilityType: 'powerCable',
    lineIds: [selectedLine.id, branchLine.id],
    ports: [
      { placeableId: 'source', portName: 'out' },
      { placeableId: 'panel', portName: 'in' },
      { placeableId: 'panel', portName: 'out' },
      { placeableId: 'load', portName: 'in' },
    ],
  };
  const unrelatedNetwork = {
    id: 'net_other',
    utilityType: 'powerCable',
    lineIds: [unrelatedLine.id],
    ports: [
      { placeableId: 'other_source', portName: 'out' },
      { placeableId: 'other_load', portName: 'in' },
    ],
  };
  return {
    selectedLine,
    branchLine,
    unrelatedLine,
    selectedNetwork,
    state: {
      utilityLines: new Map([
        [selectedLine.id, selectedLine],
        [branchLine.id, branchLine],
        [unrelatedLine.id, unrelatedLine],
      ]),
      utilityNetworks: new Map([[
        'powerCable', [selectedNetwork, unrelatedNetwork],
      ]]),
    },
  };
}

test('selected utility focus contains the exact connected runs and endpoints', () => {
  const { state, selectedLine } = fixture();
  const model = selectedUtilityNetworkFocusModel(state, selectedLine.id);

  assert.deepEqual([...model.utilityLineIds].sort(), ['power_branch', 'power_trunk']);
  assert.deepEqual([...model.connectedEndpointIds].sort(), ['load', 'panel', 'source']);
  assert.equal(model.networkId, 'net_selected');
  assert.equal(model.utilityType, 'powerCable');
});

test('selected utility focus falls back to the clicked run before discovery publishes', () => {
  const { selectedLine } = fixture();
  const state = {
    utilityLines: new Map([[selectedLine.id, selectedLine]]),
    utilityNetworks: new Map(),
  };
  const model = selectedUtilityNetworkFocusModel(state, selectedLine.id);

  assert.deepEqual([...model.utilityLineIds], [selectedLine.id]);
  assert.deepEqual([...model.connectedEndpointIds].sort(), ['panel', 'source']);
  assert.equal(model.networkId, null);
});

test('the input click command applies focus and opens the existing BLT inspector', () => {
  const { state, selectedLine } = fixture();
  let cleared = 0;
  let focused = null;
  let opened = null;
  const input = {
    game: { state },
    renderer: {
      setSelectedUtilityNetworkFocus(model) { focused = model; },
    },
    _clearSelection() { cleared++; this.selectedUtilityLineId = null; },
    selectedUtilityLineId: null,
  };

  const result = InputHandler.prototype.openUtilityInspectorForLine.call(
    input,
    selectedLine.id,
    (utilityType, networkId, lineId) => { opened = { utilityType, networkId, lineId }; },
  );

  assert.equal(result, true);
  assert.equal(cleared, 1);
  assert.equal(input.selectedUtilityLineId, selectedLine.id);
  assert.deepEqual([...focused.utilityLineIds].sort(), ['power_branch', 'power_trunk']);
  assert.deepEqual(opened, {
    utilityType: 'powerCable', networkId: 'net_selected', lineId: selectedLine.id,
  });
});
