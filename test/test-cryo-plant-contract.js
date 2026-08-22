// Contract boundary for buildable cryogenic infrastructure. The player-facing
// catalogue, port schema and solver roles must describe the same plant.

import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPONENTS } from '../src/data/components.js';
import { RESEARCH } from '../src/data/research.js';
import { UtilityRegistry } from '../src/utility/registry.js';
import { SolveRunner } from '../src/utility/solve-runner.js';
import cryoTransfer, { networkHeRecovery } from '../src/utility/types/cryoTransfer.js';

const CRYO_ITEMS = Object.values(COMPONENTS).filter(def =>
  def.category === 'cooling' && def.subsection === 'cryogenics'
  && def.deprecated !== true);

function cryoPorts(def) {
  return Object.values(def.ports || {}).filter(port => port.utility === 'cryoTransfer');
}

function source(id) {
  const [portName, port] = Object.entries(COMPONENTS[id].ports)
    .find(([, spec]) => spec.utility === 'cryoTransfer' && spec.role === 'source');
  return {
    portKey: `${id}:${portName}`,
    placeableId: id,
    portName,
    params: port.params,
  };
}

function network(ids) {
  return {
    id: 'net_cryo_contract', utilityType: 'cryoTransfer', lineIds: [], ports: [],
    sources: ids.map(source),
    sinks: [{
      portKey: 'load:cryo_in', placeableId: 'load', portName: 'cryo_in',
      params: { srfHeatW: 40 },
    }],
  };
}

test('every buildable cryogenic item has a real cryo-network port', () => {
  assert.equal(CRYO_ITEMS.length, 13, 'catalogue growth changes the audit population loudly');
  assert.deepEqual(
    CRYO_ITEMS.filter(def => cryoPorts(def).length === 0).map(def => def.id),
    [],
  );
});

test('every powered cryogenic item declares and exposes its electrical input', () => {
  const missing = [];
  for (const def of CRYO_ITEMS) {
    if (!(def.energyCost > 0)) continue;
    const electrical = Object.values(def.ports || {}).filter(port =>
      (port.utility === 'powerCable' || port.utility === 'hvCable')
      && port.role === 'sink');
    if (electrical.length !== 1
      || !(def.requiredConnections || []).includes(electrical[0].utility)) {
      missing.push(def.id);
    }
  }
  assert.deepEqual(missing, []);
});

test('research-gated cryogenic hardware is reachable from its advertised node', () => {
  const broken = CRYO_ITEMS.filter(def => def.requires
    && !(RESEARCH[def.requires]?.unlocks || []).includes(def.id));
  assert.deepEqual(broken.map(def => def.id), []);
});

test('catalogue exposes storage, refrigeration, heat rejection and refill roles', () => {
  assert.equal(COMPONENTS.heRecovery.ports.cryo_out.params.storageCapacityL, 2000);
  assert.equal(COMPONENTS.coldBox4K.ports.cryo_out.params.coldCapacityW, 500);
  assert.equal(COMPONENTS.heCompressor.ports.cryo_out.params.heatRejectionCapacityW, 800);
  assert.equal(COMPONENTS.heLiquefier.ports.cryo_out.params.liquefactionRateLPerTick, 1);
  const compact = COMPONENTS.cryocooler.ports.cryo_out.params;
  assert.ok(compact.storageCapacityL > 0 && compact.coldCapacityW > 0
    && compact.heatRejectionCapacityW > 0 && compact.sealedInventory);
});

test('central cryo plant fails closed when any required role is missing', () => {
  const cases = [
    ['storage', ['coldBox4K', 'heCompressor']],
    ['refrigeration', ['heRecovery', 'heCompressor']],
    ['heat rejection', ['heRecovery', 'coldBox4K']],
  ];
  for (const [label, ids] of cases) {
    const result = cryoTransfer.solve(network(ids), {}, null);
    assert.equal(result.flowState.plantComplete, false, label);
    assert.equal(result.flowState.perSinkQuality['load:cryo_in'], 0, label);
    assert.ok(result.errors.some(error => error.code === 'cryo_plant_offline'), label);
  }
});

test('complete central plant and integrated cryocooler both serve a load', () => {
  const central = cryoTransfer.solve(
    network(['heRecovery', 'coldBox4K', 'heCompressor']), {}, null,
  );
  assert.equal(central.flowState.plantComplete, true);
  assert.equal(central.flowState.perSinkQuality['load:cryo_in'], 1);
  assert.equal(central.flowState.totalCapacity, 500);

  const compact = cryoTransfer.solve(network(['cryocooler']), {}, null);
  assert.equal(compact.flowState.plantComplete, true);
  assert.equal(compact.flowState.perSinkQuality['load:cryo_in'], 1);
  assert.equal(compact.flowState.heRecoveryFraction, 1,
    'sealed compact loop retains all of its working fluid');
  assert.equal(compact.nextPersistentState.lheVolumeL, 50,
    'sealed integrated inventory is not consumed');

  const opened = cryoTransfer.solve(
    network(['cryocooler', 'heRecovery']), { lheVolumeL: 100 }, null,
  );
  assert.equal(opened.flowState.sealedPlant, false,
    'adding external storage makes the combined network an open central loop');
  assert.ok(opened.nextPersistentState.lheVolumeL < 100,
    'external storage does not inherit the cryocooler sealed-loop exemption');
});

function liveWorld(ids) {
  return {
    placeables: ids.map(id => ({ id, type: id })),
    utilityNetworks: new Map(),
    utilityNetworkData: new Map(),
  };
}

function publishFeed(world, utilityType, portKeys) {
  const id = `net_${utilityType}_feed`;
  world.utilityNetworks.set(utilityType, [{
    id,
    ports: portKeys.map(key => {
      const [placeableId, portName] = key.split(':');
      return { placeableId, portName };
    }),
  }]);
  world.utilityNetworkData.set(utilityType, new Map([[id, {
    perSinkQuality: Object.fromEntries(portKeys.map(key => [key, 1])),
  }]]));
}

test('cold box and compressor capabilities fail closed on their real utility feeds', () => {
  const ids = ['heRecovery', 'coldBox4K', 'heCompressor'];
  const net = network(ids);
  const world = liveWorld(ids);
  const getDefinition = id => COMPONENTS[id];

  const dark = cryoTransfer.solve(net, {}, world, { getDefinition });
  assert.equal(dark.flowState.plantComplete, false, 'unpowered plant stays offline');

  publishFeed(world, 'hvCable', ['coldBox4K:hv_in', 'heCompressor:hv_in']);
  publishFeed(world, 'coolingWater', ['heCompressor:cool_in']);
  const live = cryoTransfer.solve(net, {}, world, { getDefinition });
  assert.equal(live.flowState.plantComplete, true);
  assert.equal(live.flowState.totalCapacity, 500);

  world.utilityNetworkData.get('coolingWater').values().next().value
    .perSinkQuality['heCompressor:cool_in'] = 0;
  const hotCompressor = cryoTransfer.solve(net, {}, world, { getDefinition });
  assert.equal(hotCompressor.flowState.plantComplete, false,
    'compressor without cooling-water heat rejection fails closed');
});

test('powered recovery stages count only on the cryo network they are wired into', () => {
  const ids = ['heRecovery', 'heRecoveryHeader', 'heGasBag', 'hePurifier', 'heLiquefier'];
  const net = network(ids);
  const world = liveWorld([...ids, 'coldBox4K', 'heCompressor']);
  const getDefinition = id => COMPONENTS[id];

  const dark = networkHeRecovery(net, world, getDefinition);
  assert.equal(dark.fraction, 0.40, 'passive header and bag still collect gas');
  assert.equal(dark.ceiling, 0.70, 'unpowered storage controls do not raise the cap');
  assert.equal(dark.liquefactionRateLPerTick, 0, 'unpowered liquefier cannot refill');

  publishFeed(world, 'powerCable', [
    'heRecovery:pwr_in', 'hePurifier:pwr_in', 'heLiquefier:pwr_in',
  ]);
  publishFeed(world, 'hvCable', ['coldBox4K:hv_in', 'heCompressor:hv_in']);
  publishFeed(world, 'coolingWater', ['heCompressor:cool_in']);
  const live = networkHeRecovery(net, world, getDefinition);
  assert.ok(Math.abs(live.fraction - 0.90) < 1e-9);
  assert.equal(live.ceiling, 0.90);
  assert.equal(live.liquefactionRateLPerTick, 1);

  const refilling = cryoTransfer.solve(
    network(['heRecovery', 'coldBox4K', 'heCompressor', ...ids.slice(1)]),
    { lheVolumeL: 1000 }, world, { getDefinition },
  );
  assert.equal(refilling.flowState.makeupL, 1,
    'powered liquefier is the network-local helium make-up stage');
  assert.ok(refilling.nextPersistentState.lheVolumeL > 1000,
    'liquefier replenishes a depleted reservoir');

  const disconnected = networkHeRecovery(
    network(['heRecoveryHeader', 'heGasBag']), world, getDefinition,
  );
  assert.equal(disconnected.fraction, 0.40,
    'powered equipment elsewhere in the facility contributes nothing');
});

test('cryo inventory and bath temperature survive network joins and splits physically', () => {
  const state = { utilityNetworkState: new Map(), tick: 0 };
  const runner = new SolveRunner({ state, registry: UtilityRegistry });
  const joinedId = 'net_cryoTransfer_joined';
  state.utilityNetworkState.set('net_cryoTransfer_a', {
    lheVolumeL: 700, tempK: 3, __portKeys: ['storeA:cryo_out'],
  });
  state.utilityNetworkState.set('net_cryoTransfer_b', {
    lheVolumeL: 700, tempK: 5, __portKeys: ['storeB:cryo_out'],
  });
  runner._reconcilePersistentState(new Map([['cryoTransfer', [{
    id: joinedId,
    ports: [
      { placeableId: 'storeA', portName: 'cryo_out' },
      { placeableId: 'storeB', portName: 'cryo_out' },
    ],
    sources: [
      { placeableId: 'storeA', portName: 'cryo_out', params: { storageCapacityL: 500 } },
      { placeableId: 'storeB', portName: 'cryo_out', params: { storageCapacityL: 500 } },
    ],
  }]]]));
  const joined = state.utilityNetworkState.get(joinedId);
  assert.equal(joined.lheVolumeL, 1000, 'joined inventory clamps to connected tanks');
  assert.equal(joined.reservoirCapacityL, 1000);
  assert.equal(joined.tempK, 5, 'joined baths retain the warmer conservative temperature');

  state.utilityNetworkState.clear();
  state.utilityNetworkState.set('net_cryoTransfer_whole', {
    lheVolumeL: 800, tempK: 6,
    __portKeys: ['storeA:cryo_out', 'storeB:cryo_out'],
  });
  const splitNetworks = ['A', 'B'].map(name => ({
    id: `net_cryoTransfer_split${name}`,
    ports: [{ placeableId: `store${name}`, portName: 'cryo_out' }],
    sources: [{
      placeableId: `store${name}`, portName: 'cryo_out',
      params: { storageCapacityL: 500 },
    }],
  }));
  runner._reconcilePersistentState(new Map([['cryoTransfer', splitNetworks]]));
  for (const net of splitNetworks) {
    const part = state.utilityNetworkState.get(net.id);
    assert.equal(part.lheVolumeL, 400, 'split divides extensive helium inventory');
    assert.equal(part.tempK, 6, 'split does not divide intensive bath temperature');
  }
});
