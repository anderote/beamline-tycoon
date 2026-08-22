import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utilityPortIssues } from '../src/utility/port-issues.js';

const endpointIndex = new Map([
  ['unwired', { id: 'unwired', type: 'device' }],
  ['partial', { id: 'partial', type: 'device' }],
  ['zero', { id: 'zero', type: 'device' }],
  ['healthy', { id: 'healthy', type: 'device' }],
  ['hard', { id: 'hard', type: 'device' }],
  ['multi', { id: 'multi', type: 'multiDevice' }],
]);

const ports = {
  device: {
    pwr_in: { utility: 'powerCable', role: 'sink' },
    data_in: { utility: 'dataFiber', role: 'sink' },
  },
  multiDevice: {
    rf_in: { utility: 'rfWaveguide', role: 'sink' },
    rf_in_2: { utility: 'rfWaveguide', role: 'sink' },
    rf_in_3: { utility: 'rfWaveguide', role: 'sink' },
  },
};

function flowState(qualities, errors = []) {
  const sinks = Object.keys(qualities).map(portKey => {
    const [placeableId, portName] = portKey.split(':');
    return { portKey, placeableId, portName };
  });
  return {
    utilityNetworks: new Map([['powerCable', [{ id: 'net', sinks }]]]),
    utilityNetworkData: new Map([['powerCable', new Map([['net', {
      perSinkQuality: qualities,
      errors,
    }]])]]),
  };
}

test('unwired sink ports are critical, including soft-gated data', () => {
  const issues = utilityPortIssues({
    unwiredSinks: { unwired: { powerCable: true, dataFiber: true } },
  }, endpointIndex, type => ports[type]);

  assert.deepEqual(issues, [
    {
      placeableId: 'unwired',
      portName: 'data_in',
      utilityType: 'dataFiber',
      severity: 'critical',
    },
    {
      placeableId: 'unwired',
      portName: 'pwr_in',
      utilityType: 'powerCable',
      severity: 'critical',
    },
  ]);
});

test('partial service is warning, zero service is critical, and healthy ports are quiet', () => {
  const state = flowState({
    'partial:pwr_in': 0.6,
    'zero:pwr_in': 0,
    'healthy:pwr_in': 1,
  }, [{ severity: 'soft', code: 'power_overload' }]);

  assert.deepEqual(utilityPortIssues(state, endpointIndex, type => ports[type]), [
    {
      placeableId: 'partial',
      portName: 'pwr_in',
      utilityType: 'powerCable',
      severity: 'warning',
    },
    {
      placeableId: 'zero',
      portName: 'pwr_in',
      utilityType: 'powerCable',
      severity: 'critical',
    },
  ]);
});

test('a satisfied port clears independently when same-utility sibling ports remain unwired', () => {
  const network = {
    id: 'rf-net',
    sinks: [{
      portKey: 'multi:rf_in', placeableId: 'multi', portName: 'rf_in',
    }],
  };
  const state = {
    // The gate's public summary intentionally stays coarse: at least one RF
    // port on this component is still unwired.
    unwiredSinks: { multi: { rfWaveguide: true } },
    utilityNetworks: new Map([['rfWaveguide', [network]]]),
    utilityNetworkData: new Map([['rfWaveguide', new Map([['rf-net', {
      perSinkQuality: { 'multi:rf_in': 1 },
      errors: [],
    }]])]]),
  };

  assert.deepEqual(utilityPortIssues(state, endpointIndex, type => ports[type]), [
    {
      placeableId: 'multi',
      portName: 'rf_in_2',
      utilityType: 'rfWaveguide',
      severity: 'critical',
    },
    {
      placeableId: 'multi',
      portName: 'rf_in_3',
      utilityType: 'rfWaveguide',
      severity: 'critical',
    },
  ]);
});

test('a hard network failure promotes every affected sink to critical', () => {
  const state = flowState({ 'hard:pwr_in': 0.8 }, [
    { severity: 'hard', code: 'power_starved' },
  ]);
  assert.equal(
    utilityPortIssues(state, endpointIndex, type => ports[type])[0]?.severity,
    'critical',
  );
});
