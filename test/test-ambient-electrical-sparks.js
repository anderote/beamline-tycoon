import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AmbientElectricalSparkScheduler,
  DISTRIBUTOR_MAX_SPARK_RATE_PER_SECOND,
  HV_CONNECTION_SPARK_RATE_PER_SECOND,
  LOOSE_HV_SPARK_RATE_PER_SECOND,
  LOOSE_POWER_SPARK_RATE_PER_SECOND,
  ambientElectricalSparkCandidates,
  chooseAmbientElectricalSpark,
} from '../src/renderer3d/ambient-electrical-sparks.js';
import {
  ambientDistributorSparkProfile,
  ambientHvConnectionSparkProfile,
  ambientLooseHvSparkProfile,
  ambientLoosePowerSparkProfile,
  looseElectricalCableSparkAnchor,
  looseHvCableSparkAnchor,
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
    id: 'hv-net', lineIds: ['hv-live', 'hv-open'],
    ports: [
      { placeableId: 'source', portName: 'hv_out' },
      { placeableId: 'panel-1', portName: 'hv_in' },
    ],
  };
  const powerNetwork = {
    id: 'power-net', lineIds: ['power-open', 'power-complete'],
    ports: [
      { placeableId: 'panel-1', portName: 'power_out' },
      { placeableId: 'load', portName: 'pwr_in' },
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
        cablePath: [{ col: 2, row: 3 }, { col: 4.5, row: 3.75 }],
      }],
      ['hv-buried', {
        id: 'hv-buried', utilityType: 'hvCable', buried: true,
        start: { placeableId: 'source', portName: 'hv_out_3' },
        end: { placeableId: 'vault', portName: 'hv_in' },
      }],
      ['power-open', {
        id: 'power-open', utilityType: 'powerCable',
        start: { placeableId: 'panel-1', portName: 'power_out_2' }, end: null,
        cablePath: [{ col: 6, row: 2 }, { col: 7.25, row: 4 }],
      }],
      ['power-complete', {
        id: 'power-complete', utilityType: 'powerCable',
        start: { placeableId: 'panel-1', portName: 'power_out' },
        end: { placeableId: 'load', portName: 'pwr_in' },
        cablePath: [{ col: 6, row: 2 }, { col: 8, row: 2 }],
      }],
    ]),
    utilityNetworks: new Map([
      ['hvCable', [hvNetwork]],
      ['powerCable', [powerNetwork]],
    ]),
    utilityNetworkData: new Map([
      ['hvCable', new Map([['hv-net', { totalCapacity: 100, totalDemand: 50 }]])],
      ['powerCable', new Map([['power-net', { totalCapacity: 80, totalDemand: 30 }]])],
    ]),
    electricalSinkDemands: new Map([['panel-1:hv_in', 50]]),
    placeables: [
      { id: 'panel-1', type: 'panel' },
      { id: 'xfmr-1', type: 'transformer' },
    ],
    powerReliability: { devices: { 'panel-1': { breakerTripped: false } } },
    ...overrides,
  };
}

test('above-ground energized HV connections and live loose ends are ambient emitters', () => {
  const candidates = ambientElectricalSparkCandidates(state(), type => defs[type]);
  const hv = candidates.filter(candidate => candidate.kind === 'hvConnection');
  assert.deepEqual(hv.map(candidate => candidate.id), ['hv:hv-live:start', 'hv:hv-live:end']);
  assert.equal(hv.reduce((sum, candidate) => sum + candidate.ratePerSecond, 0),
    HV_CONNECTION_SPARK_RATE_PER_SECOND);
  const loose = candidates.find(candidate => candidate.utilityType === 'hvCable'
    && candidate.kind === 'looseHvEnd');
  assert.equal(loose?.id, 'hv:hv-open:loose-end');
  assert.equal(loose?.ratePerSecond, LOOSE_HV_SPARK_RATE_PER_SECOND);
  assert.equal(loose?.position.x, 9);
  assert.ok(Math.abs(loose?.position.y - 0.06) < 1e-9);
  assert.equal(loose?.position.z, 7.5);
  assert.ok(loose?.normal.x > 0 && loose?.normal.z > 0,
    'sparks launch outward along the exposed conductor');

  const unenergized = state({
    utilityNetworkData: new Map([['hvCable', new Map([
      ['hv-net', { totalCapacity: 0, totalDemand: 50 }],
    ])]]),
  });
  assert.equal(ambientElectricalSparkCandidates(unenergized, type => defs[type]).length, 0);
});

test('live loose power cords spark less often than live loose HV cables', () => {
  const candidates = ambientElectricalSparkCandidates(state(), type => defs[type]);
  const hv = candidates.find(candidate => candidate.utilityType === 'hvCable');
  const power = candidates.find(candidate => candidate.utilityType === 'powerCable');
  assert.equal(power?.id, 'power:power-open:loose-end');
  assert.equal(power?.kind, 'loosePowerEnd');
  assert.equal(power?.ratePerSecond, LOOSE_POWER_SPARK_RATE_PER_SECOND);
  assert.ok(power.ratePerSecond < hv.ratePerSecond);
  assert.equal(power.position.x, 14.5);
  assert.equal(power.position.z, 8);
  assert.equal(candidates.some(candidate => candidate.lineId === 'power-complete'), false,
    'complete ordinary power cords do not gain an ambient connector effect');

  const powerDead = state();
  powerDead.utilityNetworkData.get('powerCable').get('power-net').totalCapacity = 0;
  assert.equal(ambientElectricalSparkCandidates(powerDead, type => defs[type])
    .some(candidate => candidate.utilityType === 'powerCable'), false);
});

test('only exactly one-ended, above-ground electrical cables resolve a loose-tip anchor', () => {
  const liveOpen = state().utilityLines.get('hv-open');
  assert.equal(looseElectricalCableSparkAnchor(liveOpen)?.looseEnd, 'end');
  assert.equal(looseHvCableSparkAnchor(liveOpen)?.looseEnd, 'end');
  assert.equal(looseHvCableSparkAnchor(state().utilityLines.get('power-open')), null);
  assert.equal(looseElectricalCableSparkAnchor(
    state().utilityLines.get('power-open'))?.looseEnd, 'end');
  const startLoose = looseElectricalCableSparkAnchor({
    ...liveOpen,
    start: null,
    end: { placeableId: 'load', portName: 'hv_in' },
  });
  assert.equal(startLoose?.looseEnd, 'start');
  assert.equal(startLoose?.position.x, 4);
  assert.equal(startLoose?.position.z, 6);
  assert.ok(startLoose?.normal.x < 0 && startLoose?.normal.z < 0);
  assert.equal(looseElectricalCableSparkAnchor({ ...liveOpen, start: null }), null);
  assert.equal(looseElectricalCableSparkAnchor({
    ...liveOpen, end: { placeableId: 'load', portName: 'hv_in' },
  }), null);
  assert.equal(looseElectricalCableSparkAnchor({ ...liveOpen, buried: true }), null);
  assert.equal(looseElectricalCableSparkAnchor({
    ...liveOpen, utilityType: 'dataFiber',
  }), null);
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
  const looseHv = ambientLooseHvSparkProfile();
  const loosePower = ambientLoosePowerSparkProfile();
  const low = ambientDistributorSparkProfile(0.1);
  const high = ambientDistributorSparkProfile(1);
  assert.equal(hv.count, 4);
  assert.ok(looseHv.count > hv.count && looseHv.count < 16,
    'exposed conductors are legible without becoming hookup showers');
  assert.ok(loosePower.count < looseHv.count
    && loosePower.speedMax < looseHv.speedMax
    && loosePower.size < looseHv.size,
  'ordinary power arcs remain visibly less energetic than HV arcs');
  assert.ok(low.count < high.count && high.count <= 5);
  assert.ok(hv.lifetimeMax < 1, 'ambient connection pixels vanish quickly');
});
