import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeableOperationalStatus } from '../src/ui/operational-status.js';

const entry = { id: 'panel', type: 'powerPanel', category: 'infrastructure' };

function connectedState(quality = 1, errors = []) {
  const input = {
    portKey: 'panel:hv_in', placeableId: 'panel', portName: 'hv_in',
  };
  const output = {
    portKey: 'panel:pwr_out_1', placeableId: 'panel', portName: 'pwr_out_1',
  };
  return {
    placeables: [entry],
    unwiredSinks: {},
    utilityNetworks: new Map([
      ['hvCable', [{ id: 'hv', ports: [input], sinks: [input] }]],
      ['powerCable', [{ id: 'power', ports: [output], sources: [output] }]],
    ]),
    utilityNetworkData: new Map([
      ['hvCable', new Map([['hv', {
        perSinkQuality: { 'panel:hv_in': quality }, errors,
      }]])],
      ['powerCable', new Map([['power', {
        perSinkQuality: { 'load:pwr_in': 1 }, errors: [],
      }]])],
    ]),
  };
}

test('fully served equipment and its connected port groups are green', () => {
  const result = placeableOperationalStatus(connectedState(), entry, { health: 100 });
  assert.equal(result.tone, 'healthy');
  assert.equal(result.groups['hvCable:sink'].tone, 'healthy');
  assert.equal(result.groups['powerCable:source'].tone, 'healthy');
});

test('partial service is yellow and zero or missing required service is red', () => {
  const partial = placeableOperationalStatus(connectedState(0.6), entry);
  assert.equal(partial.tone, 'warning');
  assert.equal(partial.groups['hvCable:sink'].tone, 'warning');

  const zero = placeableOperationalStatus(connectedState(0), entry);
  assert.equal(zero.tone, 'critical');
  assert.equal(zero.groups['hvCable:sink'].tone, 'critical');

  const missing = connectedState();
  missing.utilityNetworks.set('hvCable', []);
  missing.unwiredSinks = { panel: { hvCable: true } };
  assert.equal(placeableOperationalStatus(missing, entry).tone, 'critical');
});

test('component wear is yellow while an actual failure is red', () => {
  assert.equal(placeableOperationalStatus(connectedState(), entry, { health: 75 }).tone, 'warning');
  assert.equal(placeableOperationalStatus(connectedState(), entry, { health: 0 }).tone, 'critical');

  const tripped = connectedState();
  tripped.powerReliability = { devices: { panel: { breakerTripped: true } } };
  assert.equal(placeableOperationalStatus(tripped, entry, { health: 100 }).tone, 'critical');
});

test('device-wide faults do not masquerade as utility connection faults', () => {
  const commissioning = { ...entry, needsCommissioning: true };
  const result = placeableOperationalStatus(connectedState(), commissioning, { health: 80 });

  assert.equal(result.tone, 'critical', 'commissioning still controls the overall device status');
  assert.equal(result.detail, 'Commissioning required');
  assert.equal(result.groups['hvCable:sink'].tone, 'healthy');
  assert.equal(result.groups['hvCable:sink'].detail, 'Connected');
  assert.equal(result.groups['powerCable:source'].tone, 'healthy');
  assert.equal(result.groups['powerCable:source'].detail, 'Connected');
});

test('an unused supply is yellow rather than falsely reported as broken', () => {
  const state = connectedState();
  state.utilityNetworks.set('powerCable', []);
  const result = placeableOperationalStatus(state, entry);
  assert.equal(result.groups['powerCable:source'].tone, 'warning');
  assert.match(result.groups['powerCable:source'].detail, /available but not connected/);
});
