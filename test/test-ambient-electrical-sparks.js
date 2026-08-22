import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AmbientElectricalSparkScheduler,
  DISTRIBUTOR_MAX_SPARK_RATE_PER_SECOND,
  HV_CONNECTION_SPARK_RATE_PER_SECOND,
  ambientElectricalSparkCandidates,
  chooseAmbientElectricalSpark,
} from '../src/renderer3d/ambient-electrical-sparks.js';
import {
  ambientDistributorSparkProfile,
  ambientHvConnectionSparkProfile,
} from '../src/renderer3d/spark-presentation.js';

const defs = {
  panel: {
    category: 'power', subsection: 'distribution',
    electricalControl: { breaker: { utility: 'powerCable', rating: 100 } },
  },
  transformer: {
    category: 'power', subsection: 'transformers',
    electricalControl: { breaker: { utility: 'hvCable', rating: 100 } },
  },
};

function state(overrides = {}) {
  const hvNetwork = {
    id: 'hv-net', lineIds: ['hv-live'],
    ports: [
      { placeableId: 'source', portName: 'hv_out' },
      { placeableId: 'panel-1', portName: 'hv_in' },
    ],
  };
  return {
    utilityLines: new Map([
      ['hv-live', {
        id: 'hv-live', utilityType: 'hvCable',
        start: { placeableId: 'source', portName: 'hv_out' },
        end: { placeableId: 'panel-1', portName: 'hv_in' },
      }],
      ['hv-open', {
        id: 'hv-open', utilityType: 'hvCable',
        start: { placeableId: 'source', portName: 'hv_out_2' }, end: null,
      }],
      ['hv-buried', {
        id: 'hv-buried', utilityType: 'hvCable', buried: true,
        start: { placeableId: 'source', portName: 'hv_out_3' },
        end: { placeableId: 'vault', portName: 'hv_in' },
      }],
    ]),
    utilityNetworks: new Map([['hvCable', [hvNetwork]]]),
    utilityNetworkData: new Map([['hvCable', new Map([
      ['hv-net', { totalCapacity: 100, totalDemand: 50 }],
    ])]]),
    electricalSinkDemands: new Map([['panel-1:hv_in', 50]]),
    placeables: [
      { id: 'panel-1', type: 'panel' },
      { id: 'xfmr-1', type: 'transformer' },
    ],
    powerReliability: { devices: { 'panel-1': { breakerTripped: false } } },
    ...overrides,
  };
}

test('only complete, above-ground, energized HV connections are ambient emitters', () => {
  const candidates = ambientElectricalSparkCandidates(state(), type => defs[type]);
  const hv = candidates.filter(candidate => candidate.kind === 'hvConnection');
  assert.deepEqual(hv.map(candidate => candidate.id), ['hv:hv-live:start', 'hv:hv-live:end']);
  assert.equal(hv.reduce((sum, candidate) => sum + candidate.ratePerSecond, 0),
    HV_CONNECTION_SPARK_RATE_PER_SECOND);

  const unenergized = state({
    utilityNetworkData: new Map([['hvCable', new Map([
      ['hv-net', { totalCapacity: 0, totalDemand: 50 }],
    ])]]),
  });
  assert.equal(ambientElectricalSparkCandidates(unenergized, type => defs[type]).length, 0);
});

test('distribution spark rate follows published downstream demand over nameplate rating', () => {
  const half = ambientElectricalSparkCandidates(state(), type => defs[type])
    .find(candidate => candidate.kind === 'distributor');
  assert.equal(half.utilization, 0.5);
  assert.equal(half.ratePerSecond, DISTRIBUTOR_MAX_SPARK_RATE_PER_SECOND * 0.5);

  const fullState = state({ electricalSinkDemands: new Map([['panel-1:hv_in', 100]]) });
  const full = ambientElectricalSparkCandidates(fullState, type => defs[type])
    .find(candidate => candidate.kind === 'distributor');
  assert.equal(full.utilization, 1);
  assert.equal(full.ratePerSecond, DISTRIBUTOR_MAX_SPARK_RATE_PER_SECOND);

  const trippedState = state({
    powerReliability: { devices: { 'panel-1': { breakerTripped: true } } },
  });
  assert.equal(ambientElectricalSparkCandidates(trippedState, type => defs[type])
    .some(candidate => candidate.kind === 'distributor'), false);
});

test('scheduler makes a bounded, frame-rate-independent weighted choice', () => {
  const candidates = [
    { id: 'slow', ratePerSecond: 0.01 },
    { id: 'fast', ratePerSecond: 0.09 },
  ];
  const rolls = [0, 0.5];
  const chosen = chooseAmbientElectricalSpark(candidates, 1, () => rolls.shift());
  assert.equal(chosen.id, 'fast');
  assert.equal(chooseAmbientElectricalSpark(candidates, 1, () => 1), null);

  const scheduler = new AmbientElectricalSparkScheduler({ random: () => 1 });
  assert.equal(scheduler.update(0.4, state(), type => defs[type]), null);
  assert.equal(scheduler.update(0.4, state(), type => defs[type]), null);
  assert.equal(scheduler.update(0.4, state(), type => defs[type]), null,
    'the first whole second performs one trial, whose controlled roll misses');
  assert.ok(scheduler.elapsed < 1, 'scheduler retains only sub-interval remainder');
});

test('ambient profiles stay much smaller than hookup showers', () => {
  const hv = ambientHvConnectionSparkProfile();
  const low = ambientDistributorSparkProfile(0.1);
  const high = ambientDistributorSparkProfile(1);
  assert.equal(hv.count, 4);
  assert.ok(low.count < high.count && high.count <= 5);
  assert.ok(hv.lifetimeMax < 1, 'ambient connection pixels vanish quickly');
});

