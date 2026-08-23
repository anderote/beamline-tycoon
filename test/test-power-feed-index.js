// Topology-indexed electrical feed lookup.
//
// Every powered vacuum, RF, water, and cryogenic source asks which branch or
// HV network feeds it. This must be one topology build plus O(1) lookups, not
// one full placeable/network scan per source on every simulation tick.

import assert from 'node:assert/strict';

import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { powerFeedFactor } from '../src/utility/power-feed.js';
import { SolveRunner } from '../src/utility/solve-runner.js';

function fixture(count) {
  const rawPlaceables = [];
  const specs = {};
  const lines = new Map();
  for (let i = 0; i < count; i++) {
    const sourceId = `source_${i}`;
    const pumpId = `pump_${i}`;
    rawPlaceables.push({ id: sourceId, type: 'utilityServicePoint' });
    rawPlaceables.push({ id: pumpId, type: 'roughingPump' });
    specs[sourceId] = {
      out: { utility: 'powerCable', role: 'source', params: { capacity: 100 } },
    };
    specs[pumpId] = {
      pwr_in: { utility: 'powerCable', role: 'sink', params: { demand: 5 } },
    };
    lines.set(`line_${i}`, {
      id: `line_${i}`,
      utilityType: 'powerCable',
      start: { placeableId: sourceId, portName: 'out' },
      end: { placeableId: pumpId, portName: 'pwr_in' },
      path: [{ col: 0, row: i * 2 }, { col: 1, row: i * 2 }],
    });
  }
  rawPlaceables.push({ id: 'unwired_pump', type: 'roughingPump' });
  specs.unwired_pump = {
    pwr_in: { utility: 'powerCable', role: 'sink', params: { demand: 5 } },
  };

  let placeableIterations = 0;
  const placeables = new Proxy(rawPlaceables, {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) {
        placeableIterations++;
        return target[Symbol.iterator].bind(target);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const lookup = (placeableId, portName) => specs[placeableId]?.[portName] || null;
  lookup.listPorts = placeableId => Object.entries(specs[placeableId] || {})
    .map(([name, spec]) => ({ name, spec }));

  const descriptor = {
    persistentStateDefaults: {},
    solve(network, persistent) {
      const perSinkQuality = {};
      for (const sink of network.sinks) perSinkQuality[sink.portKey] = 1;
      return { flowState: { perSinkQuality }, nextPersistentState: persistent, errors: [] };
    },
  };
  const state = { placeables, beamPipes: [], utilityLines: lines, utilityNetworkState: new Map() };
  const runner = new SolveRunner({
    state,
    registry: { types: { powerCable: descriptor }, list: ['powerCable'] },
    portLookup: lookup,
  });
  return { state, runner, placeableIterations: () => placeableIterations };
}

const { state, runner, placeableIterations } = fixture(200);
runner.runSolve(state);
assert.ok(state.utilityPowerFeedIndex, 'solve publishes the topology-derived lookup');
const iterationsAfterBuild = placeableIterations();

for (let pass = 0; pass < 5; pass++) {
  for (let i = 0; i < 200; i++) {
    assert.equal(powerFeedFactor(state, `pump_${i}`), 1);
  }
  assert.equal(powerFeedFactor(state, 'unwired_pump'), 0);
}
assert.equal(
  placeableIterations(), iterationsAfterBuild,
  'connected and unwired source lookups do not rescan the placeable collection',
);

const originalIndex = state.utilityPowerFeedIndex;
runner.markTopologyDirty();
assert.equal(state.utilityPowerFeedIndex, null, 'topology invalidation drops the lookup immediately');
runner.runSolve(state);
assert.ok(state.utilityPowerFeedIndex);
assert.notEqual(state.utilityPowerFeedIndex, originalIndex, 'the next solve rebuilds the lookup');

// A changed placeable collection cannot accidentally reuse an older index,
// even before the normal topology-dirty seam has run.
state.placeables.push({ id: 'late_pump', type: 'roughingPump' });
assert.equal(powerFeedFactor(state, 'late_pump'), 0, 'shape mismatch takes the safe scan fallback');

console.log('power-feed topology index tests passed');
