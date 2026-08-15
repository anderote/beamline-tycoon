// One-pipe cooling plant: reservoir + rejector + chiller + process loads.

import assert from 'node:assert/strict';
import coolingWater from '../src/utility/types/coolingWater.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';

const plantNetwork = {
  id: 'plant-1', utilityType: 'coolingWater', ports: [], lineIds: [],
  sources: [
    { portKey: 'tank:cool_out', placeableId: 'tank', portName: 'cool_out', params: { reservoir: true } },
    { portKey: 'tower:cool_out', placeableId: 'tower', portName: 'cool_out', params: { heatRejectionCapacity: 100 } },
    { portKey: 'chiller:cool_out', placeableId: 'chiller', portName: 'cool_out', params: { capacity: 100 } },
  ],
  sinks: [{ portKey: 'magnet:cool_in', placeableId: 'magnet', portName: 'cool_in', params: { heatLoad: 80 } }],
};
const state = {
  placeables: [{ id: 'chiller', type: 'chiller' }, { id: 'tower', type: 'coolingTower' }, { id: 'tank', type: 'waterTank' }],
  utilityNetworks: new Map([
    ['powerCable', [{ id: 'power-1', ports: [{ placeableId: 'tower', portName: 'pwr_in' }, { placeableId: 'chiller', portName: 'pwr_in' }] }]],
  ]),
  utilityNetworkData: new Map([['powerCable', new Map([['power-1', { perSinkQuality: { 'tower:pwr_in': 1, 'chiller:pwr_in': 1 } }]])]]),
};

const process = coolingWater.solve(plantNetwork, { reservoirVolumeL: 500 }, state);
assert.equal(process.flowState.totalCapacity, 100, 'complete one-pipe plant supplies process water');
assert.equal(process.flowState.perSinkQuality['magnet:cool_in'], 1, 'one-pipe loop cools load');

// The rejector has an inlet and outlet, but is one hydraulic stage. Discovery
// must unite those explicitly-marked through ports into one ordered plant.
const topology = {
  placeables: [
    { id: 'tank', type: 'waterTank', col: 0, row: 0 },
    { id: 'tower', type: 'coolingTower', col: 3, row: 0 },
    { id: 'chiller', type: 'chiller', col: 6, row: 0 },
  ],
  utilityLines: new Map([
    ['tank-tower', { id: 'tank-tower', utilityType: 'coolingWater', start: { placeableId: 'tank', portName: 'cool_out' }, end: { placeableId: 'tower', portName: 'cool_out' }, path: [{ col: 0, row: 0 }, { col: 3, row: 0 }] }],
    ['tower-chiller', { id: 'tower-chiller', utilityType: 'coolingWater', start: { placeableId: 'tower', portName: 'cool_out' }, end: { placeableId: 'chiller', portName: 'cool_out' }, path: [{ col: 3, row: 0 }, { col: 6, row: 0 }] }],
  ]),
};
const discovered = discoverNetworks('coolingWater', topology.utilityLines, makeDefaultPortLookup(topology));
assert.equal(discovered.length, 1, 'tank, rejector and chiller form one Cooling Water network');

const noTank = coolingWater.solve({ ...plantNetwork, sources: plantNetwork.sources.slice(1) }, { reservoirVolumeL: 500 }, state);
assert.equal(noTank.flowState.totalCapacity, 0, 'missing reservoir takes the plant offline');
assert(noTank.errors.some(e => e.code === 'cooling_plant_offline'), 'missing plant role is reported');

// An integrated package exposes three physical outlets. Discovery joins those
// same-device sources into one header without tripling its 5 kW nameplate.
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
assert.equal(packageProcessNetworks[0].sources.length, 3, 'all three package outlets join the shared header');
assert.equal(packageProcessNetworks[0].sources.reduce((sum, source) => sum + source.params.capacity, 0), 5,
  'three package outlets still total exactly 5 kW');
assert.equal(packageProcessNetworks[0].sources.reduce(
  (sum, source) => sum + source.params.heatRejectionCapacity, 0), 5,
  'three package outlets do not duplicate integrated heat rejection');

console.log('cooling plant chain: PASS');
