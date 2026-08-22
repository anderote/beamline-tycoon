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

function rfState(totalCapacity) {
  return {
    utilityNetworks: new Map([['rfWaveguide', [{
      id: 'rf-net', lineIds: ['rf-b', 'rf-a'], sources: [{ portKey: 'amp:rf_out' }],
    }]]]),
    utilityNetworkData: new Map([['rfWaveguide', new Map([[
      'rf-net', { totalCapacity, errors: [] },
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

test('combined line signature covers topology, fault state, and RF flow state', () => {
  assert.equal(utilityLineVisualSignature({}), null);
  const healthy = utilityLineVisualSignature(state());
  assert.notEqual(healthy, utilityLineVisualSignature(state([], { lineIds: ['a', 'b', 'new-run'] })));
  assert.notEqual(healthy, utilityLineVisualSignature(state([{ severity: 'soft' }])));
  assert.equal(
    utilityLineVisualSignature(state([{ severity: 'hard', message: 'first copy' }])),
    utilityLineVisualSignature(state([{ severity: 'hard', message: 'different copy' }])),
  );
});

test('flow signature changes when solved RF power turns on or off', () => {
  assert.equal(utilityFlowVisualSignature({}), null);
  assert.equal(utilityFlowVisualSignature(state()), '');
  assert.equal(utilityFlowVisualSignature(rfState(0)), '');
  assert.equal(utilityFlowVisualSignature(rfState(300)), 'rf-a,rf-b');
  assert.notEqual(
    utilityLineVisualSignature(rfState(0)),
    utilityLineVisualSignature(rfState(300)),
    'the renderer invalidates cached RF materials when forward power changes',
  );
});
