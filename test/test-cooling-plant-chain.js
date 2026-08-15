// Cooling plant integration: tank -> rejector -> chiller -> process loop.

import assert from 'node:assert/strict';
import plantWater from '../src/utility/types/plantWater.js';
import coolingWater from '../src/utility/types/coolingWater.js';
import { heatRejectionFeedFactor } from '../src/utility/power-feed.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';

const plantNetwork = {
  id: 'plant-1', utilityType: 'plantWater', ports: [{ placeableId: 'chiller', portName: 'reject_in' }], lineIds: [],
  sources: [
    { portKey: 'tank:water_out', placeableId: 'tank', portName: 'water_out', params: { waterSupply: true } },
    { portKey: 'tower:reject_out', placeableId: 'tower', portName: 'reject_out', params: { rejectionCapacity: 100 } },
  ],
  sinks: [{ portKey: 'chiller:reject_in', placeableId: 'chiller', portName: 'reject_in', params: { rejectionDemand: 100 } }],
};
const state = {
  placeables: [{ id: 'chiller', type: 'chiller' }, { id: 'tower', type: 'coolingTower' }, { id: 'tank', type: 'waterTank' }],
  utilityNetworks: new Map([
    ['plantWater', [plantNetwork]],
    ['powerCable', [{ id: 'power-1', ports: [{ placeableId: 'tower', portName: 'pwr_in' }, { placeableId: 'chiller', portName: 'pwr_in' }] }]],
  ]),
  utilityNetworkData: new Map([['powerCable', new Map([['power-1', { perSinkQuality: { 'tower:pwr_in': 1, 'chiller:pwr_in': 1 } }]])]]),
};

const live = plantWater.solve(plantNetwork, {}, state);
state.utilityNetworkData.set('plantWater', new Map([['plant-1', live.flowState]]));
assert.equal(live.flowState.perSinkQuality['chiller:reject_in'], 1, 'complete plant chain enables chiller');
assert.equal(heatRejectionFeedFactor(state, 'chiller'), 1, 'chiller reads current plant-water quality');

const processNetwork = {
  id: 'process-1', utilityType: 'coolingWater', ports: [], lineIds: [],
  sources: [{ portKey: 'chiller:cool_out', placeableId: 'chiller', portName: 'cool_out', params: { capacity: 100 } }],
  sinks: [{ portKey: 'magnet:cool_in', placeableId: 'magnet', portName: 'cool_in', params: { heatLoad: 80 } }],
};
const process = coolingWater.solve(processNetwork, { reservoirVolumeL: 500 }, state);
assert.equal(process.flowState.totalCapacity, 100, 'live chiller supplies process water');
assert.equal(process.flowState.perSinkQuality['magnet:cool_in'], 1, 'process loop cools load');

// The rejector has an inlet and outlet, but is one hydraulic stage. Discovery
// must unite those explicitly-marked through ports into one ordered plant.
const topology = {
  placeables: [
    { id: 'tank', type: 'waterTank', col: 0, row: 0 },
    { id: 'tower', type: 'coolingTower', col: 3, row: 0 },
    { id: 'chiller', type: 'chiller', col: 6, row: 0 },
  ],
  utilityLines: new Map([
    ['tank-tower', { id: 'tank-tower', utilityType: 'plantWater', start: { placeableId: 'tank', portName: 'water_out' }, end: { placeableId: 'tower', portName: 'plant_in' }, path: [{ col: 0, row: 0 }, { col: 3, row: 0 }] }],
    ['tower-chiller', { id: 'tower-chiller', utilityType: 'plantWater', start: { placeableId: 'tower', portName: 'reject_out' }, end: { placeableId: 'chiller', portName: 'reject_in' }, path: [{ col: 3, row: 0 }, { col: 6, row: 0 }] }],
  ]),
};
const discovered = discoverNetworks('plantWater', topology.utilityLines, makeDefaultPortLookup(topology));
assert.equal(discovered.length, 1, 'tank, rejector and chiller form one plant-water network');
assert.equal(discovered[0].sinks.filter(s => s.portName === 'reject_in').length, 1, 'chiller is the plant-water load');

const noTank = plantWater.solve({ ...plantNetwork, sources: [plantNetwork.sources[1]] }, {}, state);
assert.equal(noTank.flowState.perSinkQuality['chiller:reject_in'], 0, 'rejector without tank cannot enable chiller');
assert(noTank.errors.some(e => e.code === 'plant_water_missing'), 'missing tank is reported');
state.utilityNetworkData.set('plantWater', new Map([['plant-1', noTank.flowState]]));
const offline = coolingWater.solve(processNetwork, { reservoirVolumeL: 500 }, state);
assert.equal(offline.flowState.totalCapacity, 0, 'offline plant removes chiller process capacity');
assert(offline.errors.some(e => e.code === 'cooling_plant_offline'), 'process loop reports offline plant');

console.log('cooling plant chain: PASS');
