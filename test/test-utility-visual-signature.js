import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  utilityErrorVisualSignature,
  utilityFlowVisualSignature,
  utilityLineVisualSignature,
  utilityTopologyVisualSignature,
} from '../src/renderer3d/utility-visual-signature.js';

function state(errors = [], {
  lineIds = ['b', 'a'],
  sources = [{ portKey: 'panel:pwr_out_1' }],
  networkId = 'net',
} = {}) {
  return {
    utilityNetworks: new Map([['powerCable', [{
      id: networkId,
      lineIds,
      sources,
    }]]]),
    utilityNetworkData: new Map([['powerCable', new Map([[networkId, { errors }]])]]),
  };
}

function flowState(utilityType, totalCapacity) {
  return {
    utilityNetworks: new Map([[utilityType, [{
      id: 'flow-net', lineIds: ['flow-b', 'flow-a'], sources: [{ portKey: 'source:out' }],
    }]]]),
    utilityNetworkData: new Map([[utilityType, new Map([[
      'flow-net', { totalCapacity, errors: [] },
    ]])]]),
  };
}

test('utility visual signature changes only with line-visible fault severity', () => {
  assert.equal(utilityErrorVisualSignature({}), null);
  assert.equal(utilityErrorVisualSignature(state()), '');
  assert.equal(utilityErrorVisualSignature(state([{ severity: 'soft' }])), 'a:1|b:1');
  assert.equal(utilityErrorVisualSignature(state([{ severity: 'soft' }, { severity: 'hard' }])), 'a:2|b:2');
  assert.equal(
    utilityErrorVisualSignature(state([{ severity: 'hard', message: 'changed copy only' }])),
    'a:2|b:2',
  );
});

test('utility topology signature changes when solved flow direction can change', () => {
  assert.equal(utilityTopologyVisualSignature({}), null);

  const original = utilityTopologyVisualSignature(state());
  assert.equal(
    original,
    utilityTopologyVisualSignature(state([], {
      lineIds: ['a', 'b'],
      sources: [{ placeableId: 'panel', portName: 'pwr_out_1' }],
    })),
    'line/source iteration order and equivalent source shapes are stable',
  );
  assert.notEqual(
    original,
    utilityTopologyVisualSignature(state([], { lineIds: ['a', 'b', 'new-run'] })),
    'a line published one solve after its mutation event invalidates orientation',
  );
  assert.notEqual(
    original,
    utilityTopologyVisualSignature(state([], { sources: [{ portKey: 'backup:pwr_out' }] })),
    'moving the source root invalidates orientation',
  );
});

test('combined line signature covers topology, fault state, and live flow state', () => {
  assert.equal(utilityLineVisualSignature({}), null);
  const healthy = utilityLineVisualSignature(state());
  assert.notEqual(healthy, utilityLineVisualSignature(state([], { lineIds: ['a', 'b', 'new-run'] })));
  assert.notEqual(healthy, utilityLineVisualSignature(state([{ severity: 'soft' }])));
  assert.equal(
    utilityLineVisualSignature(state([{ severity: 'hard', message: 'first copy' }])),
    utilityLineVisualSignature(state([{ severity: 'hard', message: 'different copy' }])),
  );
});

test('flow signature changes when solved RF or cryogenic capacity turns on or off', () => {
  assert.equal(utilityFlowVisualSignature({}), null);
  assert.equal(
    utilityFlowVisualSignature(state()),
    'rfWaveguide:|cryoTransfer:',
  );
  for (const utilityType of ['rfWaveguide', 'cryoTransfer']) {
    assert.equal(
      utilityFlowVisualSignature(flowState(utilityType, 0)),
      'rfWaveguide:|cryoTransfer:',
    );
    assert.match(
      utilityFlowVisualSignature(flowState(utilityType, 300)),
      new RegExp(`${utilityType}:flow-a,flow-b`),
    );
    assert.notEqual(
      utilityLineVisualSignature(flowState(utilityType, 0)),
      utilityLineVisualSignature(flowState(utilityType, 300)),
      `the renderer invalidates cached ${utilityType} materials when capacity changes`,
    );
  }
});
