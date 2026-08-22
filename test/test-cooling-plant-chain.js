// One-pipe cooling plant: reservoir + rejector + chiller + process loads.

import assert from 'node:assert/strict';
import coolingWater from '../src/utility/types/coolingWater.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';

const plantNetwork = {
  id: 'plant-1', utilityType: 'coolingWater', ports: [], lineIds: [],
  sources: [
    { portKey: 'tank:cool_out', placeableId: 'tank', portName: 'cool_out',
      params: { storageCapacityL: 500, supplyRateLPerTick: 1 } },
    { portKey: 'tower:cool_out', placeableId: 'tower', portName: 'cool_out', params: { heatRejectionCapacity: 100 } },
    { portKey: 'chiller:cool_out', placeableId: 'chiller', portName: 'cool_out', params: { capacity: 100 } },
  ],
  sinks: [{ portKey: 'magnet:cool_in', placeableId: 'magnet', portName: 'cool_in', params: { heatLoad: 80 } }],
};
const state = {
  placeables: [{ id: 'chiller', type: 'chiller' }, { id: 'tower', type: 'coolingTower' }, { id: 'tank', type: 'waterTank' }],
  utilityNetworks: new Map([
    ['hvCable', [{ id: 'hv-1', ports: [{ placeableId: 'tower', portName: 'hv_in' }, { placeableId: 'chiller', portName: 'hv_in' }] }]],
  ]),
  utilityNetworkData: new Map([['hvCable', new Map([['hv-1', { perSinkQuality: { 'tower:hv_in': 1, 'chiller:hv_in': 1 } }]])]]),
};

const process = coolingWater.solve(plantNetwork, { reservoirVolumeL: 500 }, state);
assert.equal(process.flowState.totalCapacity, 100, 'complete one-pipe plant supplies process water');
assert.equal(process.flowState.perSinkQuality['magnet:cool_in'], 1, 'one-pipe loop cools load');
assert.equal(process.flowState.storageCapacityL, 500, 'tank contributes finite network storage');
assert.equal(process.flowState.supplyRateLPerTick, 1, 'tank contributes its authored make-up flow');

// New construction keeps cold flexible supply, hot flexible return, and the
// rigid rejection header as three explicit pieces. The distributor converts
// the hot hose to pipe without joining it to the cold circuit.
const topology = {
  placeables: [
    { id: 'chiller', type: 'chiller', col: 0, row: 0 },
    { id: 'load', type: 'source', col: 3, row: 0 },
    { id: 'dist', type: 'waterDistributor2', col: 6, row: 0 },
    { id: 'tower', type: 'coolingTower', col: 9, row: 0 },
  ],
  utilityLines: new Map([
    ['cold', { id: 'cold', utilityType: 'coolingWater', waterCircuit: 'cold', start: { placeableId: 'chiller', portName: 'cool_out' }, end: { placeableId: 'load', portName: 'cool_in' }, path: [{ col: 0, row: 0 }, { col: 3, row: 0 }] }],
    ['hot', { id: 'hot', utilityType: 'coolingWater', waterCircuit: 'hot', start: { placeableId: 'load', portName: 'hot_out' }, end: { placeableId: 'dist', portName: 'water_line_1' }, path: [{ col: 3, row: 1 }, { col: 6, row: 1 }] }],
    ['header', { id: 'header', utilityType: 'waterSupplyPipe', waterCircuit: 'hot', start: { placeableId: 'tower', portName: 'supply_hot_1' }, end: { placeableId: 'dist', portName: 'supply_pipe_1' }, path: [{ col: 6, row: 2 }, { col: 9, row: 2 }] }],
  ]),
};
const discovered = discoverNetworks('coolingWater', topology.utilityLines, makeDefaultPortLookup(topology));
assert.equal(discovered.length, 2, 'cold supply and hot return remain separate water-line networks');
assert.equal(discoverNetworks('waterSupplyPipe', topology.utilityLines,
  makeDefaultPortLookup(topology)).length, 1, 'heat rejection travels on one rigid hot-water header');

const noTank = coolingWater.solve({ ...plantNetwork, sources: plantNetwork.sources.slice(1) }, { reservoirVolumeL: 500 }, state);
assert.equal(noTank.flowState.totalCapacity, 0, 'missing reservoir takes the plant offline');
assert(noTank.errors.some(e => e.code === 'cooling_plant_offline'), 'missing plant role is reported');

// An integrated package exposes four cold outlets plus two independent hot
// return connections. Discovery joins only the cold source group without
// multiplying its 5 kW nameplate.
const fanoutTopology = {
  placeables: [
    { id: 'package', type: 'packageChiller', col: 0, row: 0 },
    { id: 'magnet', type: 'dipole', col: 3, row: 0 },
  ],
  utilityLines: new Map([
    ['package-magnet', {
      id: 'package-magnet', utilityType: 'coolingWater',
      start: { placeableId: 'package', portName: 'cool_out_a' },
      end: { placeableId: 'magnet', portName: 'cool_in' },
      path: [{ col: 0, row: 0 }, { col: 3, row: 0 }],
    }],
  ]),
};
const packageProcessNetworks = discoverNetworks(
  'coolingWater', fanoutTopology.utilityLines, makeDefaultPortLookup(fanoutTopology));
assert.equal(packageProcessNetworks.length, 1, 'package chiller outlets are one cooling-water network');
assert.equal(packageProcessNetworks[0].sources.length, 4, 'the four cold package connections join the shared header');
assert(Math.abs(packageProcessNetworks[0].sources.reduce(
  (sum, source) => sum + source.params.capacity, 0) - 5) < 1e-9,
  'four cold package connections still total exactly 5 kW');
assert(Math.abs(packageProcessNetworks[0].sources.reduce(
  (sum, source) => sum + source.params.heatRejectionCapacity, 0)) < 1e-9,
  'cold package connections do not leak hot-return rejection capacity');
assert(Math.abs(packageProcessNetworks[0].sources.reduce(
  (sum, source) => sum + source.params.storageCapacityL, 0) - (100 * 4 / 6)) < 1e-9,
  'cold package connections retain their circuit share of finite storage');
assert(Math.abs(packageProcessNetworks[0].sources.reduce(
  (sum, source) => sum + source.params.supplyRateLPerTick, 0) - (0.1 * 4 / 6)) < 1e-9,
  'cold package connections retain their circuit share of make-up feed');

console.log('cooling plant chain: PASS');
