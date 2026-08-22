import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discoverNetworks,
  makeDefaultPortLookup,
} from '../src/utility/network-discovery.js';
import { computeLineOrientations } from '../src/utility/line-orientation.js';

function ref(placeableId, portName) {
  return { placeableId, portName };
}

function line(id, utilityType, start, end, row) {
  return {
    id,
    utilityType,
    start,
    end,
    path: [{ col: 0, row }, { col: 4, row }],
  };
}

function orientationsFor(utilityType, lines, lookup) {
  const result = new Map();
  for (const network of discoverNetworks(utilityType, lines, lookup)) {
    for (const [lineId, reversed] of computeLineOrientations(network, lines)) {
      result.set(lineId, reversed);
    }
  }
  return result;
}

test('directionless data buses never derive source-to-sink line orientation', () => {
  const network = {
    utilityType: 'dataFiber', lineIds: ['fiber'],
    sources: [{ portKey: 'a:data_out' }],
  };
  const lines = new Map([['fiber', line(
    'fiber', 'dataFiber', ref('a', 'data_out'), ref('b', 'data_in'), 0,
  )]]);
  assert.equal(computeLineOrientations(network, lines).size, 0,
    'data activity is bidirectional rather than oriented from a legacy source label');
});

test('authored electrical hierarchy flows supply -> distribution -> loads', () => {
  const state = {
    placeables: [
      { id: 'supply', type: 'hvTransformer', col: 0, row: 0 },
      { id: 'hv_dist', type: 'switchgear', col: 8, row: 0 },
      { id: 'panel', type: 'powerPanel', col: 16, row: 0 },
      { id: 'rf_source', type: 'magnetron', col: 16, row: 8 },
      { id: 'pump', type: 'turboPump', col: 24, row: 0 },
    ],
    beamPipes: [],
  };
  const lookup = makeDefaultPortLookup(state);

  // Deliberately draw every cable load-first. Animation direction must come
  // from the authored source/sink roles, never from this click order.
  const hvLines = new Map([
    ['supply_to_dist', line(
      'supply_to_dist', 'hvCable',
      ref('hv_dist', 'hv_in'), ref('supply', 'hv_out_1'), 0,
    )],
    ['dist_to_panel', line(
      'dist_to_panel', 'hvCable',
      ref('panel', 'hv_in'), ref('hv_dist', 'hv_out_1'), 2,
    )],
    ['dist_to_rf', line(
      'dist_to_rf', 'hvCable',
      ref('rf_source', 'hv_in'), ref('hv_dist', 'hv_out_2'), 4,
    )],
  ]);
  const hvNetworks = discoverNetworks('hvCable', hvLines, lookup);
  assert.equal(hvNetworks.length, 2,
    'the distributor input and outputs remain separate upstream/downstream networks');

  const hvOrientations = orientationsFor('hvCable', hvLines, lookup);
  assert.equal(hvOrientations.get('supply_to_dist'), true,
    'HV enters the distributor from the transformer');
  assert.equal(hvOrientations.get('dist_to_panel'), true,
    'HV leaves the distributor toward a branch panel');
  assert.equal(hvOrientations.get('dist_to_rf'), true,
    'HV leaves the distributor toward an RF source load');

  const branchLines = new Map([
    ['panel_to_pump', line(
      'panel_to_pump', 'powerCable',
      ref('pump', 'pwr_in'), ref('panel', 'pwr_out_1'), 6,
    )],
  ]);
  const branchOrientations = orientationsFor('powerCable', branchLines, lookup);
  assert.equal(branchOrientations.get('panel_to_pump'), true,
    'branch power leaves the panel toward ordinary equipment');
});
