import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  plantGuideTypeForPlaceable,
  utilityPlantChecklist,
} from '../src/utility/plant-guide.js';

function stateWith({ placeables = [], pipePlacements = [], utilityType, network = null, flow = null }) {
  return {
    placeables,
    beamPipes: pipePlacements.length ? [{ id: 'bp1', placements: pipePlacements }] : [],
    utilityNetworks: new Map([[utilityType, network ? [network] : []]]),
    utilityNetworkData: new Map([[utilityType, new Map(network && flow ? [[network.id, flow]] : [])]]),
  };
}

function endpoint(id, type) {
  return { id, type, category: 'infrastructure', col: 0, row: 0, dir: 0 };
}

test('only source-side plant equipment starts a contextual guide', () => {
  assert.equal(plantGuideTypeForPlaceable(endpoint('pkg', 'packageChiller')), 'coolingWater');
  assert.equal(plantGuideTypeForPlaceable(endpoint('cold', 'coldBox4K')), 'cryoTransfer');
  assert.equal(plantGuideTypeForPlaceable(endpoint('tank', 'ln2Dewar')), 'cryoTransfer');
  assert.equal(plantGuideTypeForPlaceable(endpoint('manifold', 'coolingManifold')), null);
  assert.equal(plantGuideTypeForPlaceable(endpoint('two-line', 'waterDistributor2')), null);
  assert.equal(plantGuideTypeForPlaceable(endpoint('four-line', 'waterDistributor4')), null);
  assert.equal(plantGuideTypeForPlaceable(endpoint('load', 'quadrupole')), null);
});

test('an integrated cooling package shows its bundled roles as built before it is wired', () => {
  const state = stateWith({
    utilityType: 'coolingWater',
    placeables: [endpoint('pkg', 'packageChiller')],
  });
  const guide = utilityPlantChecklist(state, 'coolingWater', 'pkg');
  assert.equal(guide.completed, false);
  assert.equal(guide.rows.find(row => row.id === 'network').status, 'missing');
  assert.equal(guide.rows.find(row => row.id === 'storage').status, 'placed');
  assert.equal(guide.rows.find(row => row.id === 'refrigeration').status, 'placed');
  assert.equal(guide.rows.find(row => row.id === 'rejection').status, 'placed');
});

test('plant stages elsewhere in the facility do not complete the anchored cooling network', () => {
  const placeables = [
    endpoint('tank', 'waterTank'),
    endpoint('chiller', 'chiller'),
    endpoint('rejector', 'fanCoilCooler'),
  ];
  const network = {
    id: 'net-water',
    ports: [{ placeableId: 'tank', portName: 'cool_out' }],
    sources: [{ placeableId: 'tank', params: { storageCapacityL: 500 } }],
    sinks: [],
  };
  const state = stateWith({
    utilityType: 'coolingWater', placeables, network,
    flow: {
      storageCapacityL: 500, chillerCapacity: 0, rejectionCapacity: 0,
      plantComplete: false, totalCapacity: 0, perSinkQuality: {},
    },
  });
  const guide = utilityPlantChecklist(state, 'coolingWater', 'tank');
  assert.equal(guide.rows.find(row => row.id === 'storage').status, 'complete');
  assert.equal(guide.rows.find(row => row.id === 'refrigeration').status, 'placed');
  assert.equal(guide.rows.find(row => row.id === 'rejection').status, 'missing');
  assert.equal(guide.completed, false);
});

test('a powered packaged cooling loop completes only after a real load joins it', () => {
  const placeables = [endpoint('pkg', 'packageChiller'), endpoint('magnet', 'quadrupole')];
  const network = {
    id: 'net-water',
    ports: [
      { placeableId: 'pkg', portName: 'cool_out_a' },
      { placeableId: 'magnet', portName: 'cool_in' },
    ],
    sources: [{
      placeableId: 'pkg',
      params: { storageCapacityL: 500, capacity: 5, heatRejectionCapacity: 5 },
    }],
    sinks: [{ placeableId: 'magnet', portKey: 'magnet:cool_in', params: { heatLoad: 2 } }],
  };
  const state = stateWith({
    utilityType: 'coolingWater', placeables, network,
    flow: {
      storageCapacityL: 500, chillerCapacity: 5, rejectionCapacity: 5,
      plantComplete: true, totalCapacity: 5, totalDemand: 2,
      perSinkQuality: { 'magnet:cool_in': 1 },
    },
  });
  assert.equal(utilityPlantChecklist(state, 'coolingWater', 'pkg').completed, true);
});

test('a central cryogenic loop reports a connected but unready compressor', () => {
  const placeables = [
    endpoint('store', 'heRecovery'),
    endpoint('cold', 'coldBox4K'),
    endpoint('compressor', 'heCompressor'),
  ];
  const network = {
    id: 'net-cryo',
    ports: placeables.map(placeable => ({ placeableId: placeable.id, portName: 'cryo_out' })),
    sources: [
      { placeableId: 'store', params: { storageCapacityL: 2000 } },
      { placeableId: 'cold', params: { coldCapacityW: 500 } },
      { placeableId: 'compressor', params: { heatRejectionCapacityW: 800 } },
    ],
    sinks: [{ placeableId: 'srf', portKey: 'srf:cryo_in', params: { srfHeatW: 20 } }],
  };
  const state = stateWith({
    utilityType: 'cryoTransfer', placeables, network,
    flow: {
      storageCapacityL: 2000, coldCapacityW: 500, heatRejectionCapacityW: 0,
      plantComplete: false, totalCapacity: 0, totalDemand: 20,
      perSinkQuality: { 'srf:cryo_in': 0 },
    },
  });
  const guide = utilityPlantChecklist(state, 'cryoTransfer', 'store');
  const rejection = guide.rows.find(row => row.id === 'rejection');
  assert.equal(rejection.status, 'connected');
  assert.match(rejection.detail, /Cooling Water/);
  assert.equal(guide.completed, false);
});
