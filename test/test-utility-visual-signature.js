import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  utilityErrorVisualSignature,
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

test('combined line signature covers topology and visible fault state only', () => {
  assert.equal(utilityLineVisualSignature({}), null);
  const healthy = utilityLineVisualSignature(state());
  assert.notEqual(healthy, utilityLineVisualSignature(state([], { lineIds: ['a', 'b', 'new-run'] })));
  assert.notEqual(healthy, utilityLineVisualSignature(state([{ severity: 'soft' }])));
  assert.equal(
    utilityLineVisualSignature(state([{ severity: 'hard', message: 'first copy' }])),
    utilityLineVisualSignature(state([{ severity: 'hard', message: 'different copy' }])),
  );
});
