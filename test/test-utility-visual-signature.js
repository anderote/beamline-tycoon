import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utilityErrorVisualSignature } from '../src/renderer3d/utility-visual-signature.js';

function state(errors = []) {
  return {
    utilityNetworks: new Map([['powerCable', [{ id: 'net', lineIds: ['b', 'a'] }]]]),
    utilityNetworkData: new Map([['powerCable', new Map([['net', { errors }]])]]),
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
