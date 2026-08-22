import { makeDefaultBeamState } from '../src/beamline/BeamlineRegistry.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { Game } from '../src/game/Game.js';
import { computeDataSystemCapacity, tickDataSystems } from '../src/game/data-systems.js';
import { itemMatchesZone, matchingZoneForPlacement, ZONE_FURNISHINGS } from '../src/data/facility.js';
import { MODES } from '../src/data/modes.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const entry = id => ({ id, beamState: makeDefaultBeamState('linac') });

function publishLiveNetworks(state, dataPortIds, poweredIds = dataPortIds) {
  const powerNetwork = {
    id: 'power-net',
    ports: poweredIds.map(placeableId => ({ placeableId, portName: 'pwr_in' })),
  };
  state.utilityNetworks = new Map([
    ['dataFiber', dataPortIds.length ? [{
      id: 'data-net',
      ports: dataPortIds.map(placeableId => ({
        placeableId,
        portName: getUtilityPortsV2(state.placeables.find(p => p.id === placeableId)?.type).data_out
          ? 'data_out' : 'data_in',
      })),
    }] : []],
    ['powerCable', [powerNetwork]],
  ]);
  state.utilityNetworkData = new Map([['powerCable', new Map([[
    powerNetwork.id,
    { perSinkQuality: Object.fromEntries(poweredIds.map(id => [`${id}:pwr_in`, 1])) },
  ]])]]);
}

console.log('\n=== Facility data systems ===\n');

{
  const switchDef = PLACEABLES.networkSwitch;
  const switchPorts = getUtilityPortsV2('networkSwitch');
  const dataPorts = Object.values(switchPorts).filter(port => port.utility === 'dataFiber');
  const dataDescriptor = UTILITY_TYPES.dataFiber;
  assert(switchDef.category === 'dataControls'
      && itemMatchesZone(switchDef, 'controlRoom')
      && ZONE_FURNISHINGS.networkSwitch === switchDef,
  'the same Network Switch appears in Data & Controls and the Control Room catalogue');
  assert(dataPorts.length === 8 && dataPorts.every(port => port.role === 'pass'),
    'the Network Switch exposes eight interchangeable peer ports');
  assert(dataDescriptor.topology === 'bus' && dataDescriptor.directional === false
      && dataDescriptor.allowsTap === true && dataDescriptor.defaultPortMaxConnections === 4,
    'data remains a directionless tappable peer bus with four attachments per port');
  assert(!switchDef.requiredConnections.includes('dataFiber'),
    'the switch needs power but no fictional upstream data source');

  const state = {
    placeables: [
      { id: 'switch', type: 'networkSwitch', col: 0, row: 0 },
      { id: 'display', type: 'monitorBank', col: 2, row: 0 },
      { id: 'console', type: 'operatorConsole', col: 0, row: 2 },
    ],
  };
  const lines = [
    {
      id: 'fiber_b', utilityType: 'dataFiber',
      start: { placeableId: 'console', portName: 'data_in' },
      end: { placeableId: 'switch', portName: 'data_5' },
      path: [{ col: 0, row: 0 }, { col: 0, row: 2 }],
    },
    {
      id: 'fiber_a', utilityType: 'dataFiber',
      start: { placeableId: 'display', portName: 'data_in' },
      end: { placeableId: 'switch', portName: 'data_1' },
      path: [{ col: 2, row: 0 }, { col: 0, row: 0 }],
    },
  ];
  const networks = discoverNetworks('dataFiber', lines, makeDefaultPortLookup(state));
  assert(networks.length === 1 && networks[0].sources.length === 0
      && networks[0].peers.every(port => port.role === 'peer')
      && ['switch', 'display', 'console'].every(id =>
        networks[0].ports.some(port => port.placeableId === id)),
  'reversed draw order still joins every attached device into one directionless peer fabric');
}

{
  const cells = [{ col: 4, row: 4 }, { col: 5, row: 4 }];
  const placed = { id: 'cluster', type: 'serverCluster', col: 4, row: 4, cells };
  const partial = { zoneOccupied: { [`${cells[0].col},${cells[0].row}`]: 'controlRoom' } };
  assert(matchingZoneForPlacement(PLACEABLES.serverCluster, placed, partial.zoneOccupied) === null,
    'a partly enclosed data rack receives no room bonus');
  const complete = { zoneOccupied: Object.fromEntries(
    cells.map(cell => [`${cell.col},${cell.row}`, 'controlRoom']),
  ) };
  assert(matchingZoneForPlacement(PLACEABLES.serverCluster, placed, complete.zoneOccupied) === 'controlRoom',
    'a fully enclosed data rack resolves its bonus room');
  const upperOccupied = Object.fromEntries(
    cells.map(cell => [`1|${cell.col},${cell.row}`, 'controlRoom']),
  );
  assert(matchingZoneForPlacement(
    PLACEABLES.serverCluster, { ...placed, level: 1 }, upperOccupied,
    (cell, entry) => `${entry.level}|${cell.col},${cell.row}`,
  ) === 'controlRoom', 'a caller-provided tile identity resolves an upper-floor bonus room');
}

{
  const game = new Game(new BeamlineRegistry(), { seed: 707 });
  game.state.resources.funding = 1e9;
  const placed = game.placePlaceable({
    type: 'dataAppliance', col: 12, row: -18, subCol: 0, subRow: 0,
    dir: 0, free: true, silent: true,
  });
  assert(placed, 'a capture appliance can be placed with no Control Room zone');
}

{
  const state = {
    placeables: [
      { type: 'dataAppliance' }, { type: 'dataStorageRack' },
      { type: 'cpuComputeRack' }, { type: 'gpuComputeRack' },
    ],
  };
  const c = computeDataSystemCapacity(state);
  assert(c.ingest === 4, 'compact capture appliance contributes starter ingest');
  assert(c.storage === 3060, 'standalone storage adds to appliance memory');
  assert(c.cpu === 42, 'standalone CPU rack adds general processing');
  assert(c.gpu === 66, 'standalone GPU rack adds accelerated processing');
}

{
  const state = {
    placeables: [
      { id: 'gateway', type: 'serverRack', col: 1, row: 1 },
      { id: 'buffer', type: 'dataStorageRack', col: 2, row: 1 },
      { id: 'wrong-room', type: 'gpuComputeRack', col: 8, row: 8 },
    ],
    zoneOccupied: { '1,1': 'controlRoom', '2,1': 'controlRoom', '8,8': 'officeSpace' },
  };
  publishLiveNetworks(state, ['gateway', 'buffer', 'wrong-room']);
  const c = computeDataSystemCapacity(state);
  assert(c.gateways === 1, 'a fiber-connected ingest rack activates its physical data backbone');
  assert(c.ingest === 8 && c.storage === 3240, 'the connected backbone activates capture and raw storage');
  assert(c.gpu === 68, 'connected GPU hardware works outside its preferred bonus room');
  assert(c.inactive.noGateway === 0 && !Object.hasOwn(c.inactive, 'wrongZone'),
    'room placement never marks functional data hardware inactive');
}

{
  const state = {
    placeables: [
      { id: 'gateway', type: 'serverRack', col: 1, row: 1 },
      { id: 'buffer', type: 'dataStorageRack', col: 2, row: 1 },
    ],
    zoneOccupied: { '1,1': 'controlRoom', '2,1': 'controlRoom' },
  };
  publishLiveNetworks(state, [], ['gateway', 'buffer']);
  const c = computeDataSystemCapacity(state);
  assert(c.ingest === 0 && c.storage === 0, 'an unwired cabinet group has no active data capacity');
  assert(c.inactive.noGateway === 2, 'unwired data hardware is reported as waiting for a gateway');
}

{
  const state = {
    placeables: [
      { id: 'gateway', type: 'serverRack', col: 0, row: 0, subCol: 0, subRow: 0, dir: 0 },
      { id: 'buffer', type: 'dataStorageRack', col: 0, row: 0, subCol: 1, subRow: 0, dir: 0 },
      { id: 'cpu', type: 'cpuComputeRack', col: 0, row: 0, subCol: 2, subRow: 0, dir: 0 },
    ],
  };
  const lines = [{
    id: 'fiber', utilityType: 'dataFiber',
    start: { placeableId: 'gateway', portName: 'data_out' }, end: null,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  }];
  const networks = discoverNetworks('dataFiber', lines, makeDefaultPortLookup(state));
  const keys = new Set((networks[0]?.ports || [])
    .map(port => `${port.placeableId}:${port.portName}`));
  assert(networks.length === 1 && keys.has('gateway:data_out')
    && keys.has('buffer:data_in') && keys.has('cpu:data_in'),
  'touching control-room cabinets share the wired gateway data backbone');
}

{
  const state = {
    placeables: [{ id: 'gateway', type: 'serverRack', col: 1, row: 1 }],
  };
  publishLiveNetworks(state, ['gateway'], []);
  const c = computeDataSystemCapacity(state);
  assert(c.ingest === 0 && c.gateways === 0 && c.inactive.noPower === 1,
    'fiber-connected data hardware stays offline until its explicit power input is fed');
}

{
  const state = {
    placeables: [{ id: 'gateway', type: 'serverRack', col: 1, row: 1 }],
    zoneOccupied: { '1,1': 'controlRoom' },
    utilityNetworks: null,
  };
  const c = computeDataSystemCapacity(state);
  assert(c.ingest === 0 && c.inactive.noGateway === 1,
    'a live game fails closed until fiber topology confirms its capture gateway');
}

{
  assert(!PLACEABLES.archiver.effects?.dataSystem,
    'the process-variable archiver is not experimental raw storage');
  assert(getUtilityPortsV2('dataStorageRack').data_in?.role === 'sink'
    && getUtilityPortsV2('cpuComputeRack').data_in?.role === 'sink'
    && getUtilityPortsV2('gpuComputeRack').data_in?.role === 'sink',
  'storage and compute racks expose physical data inputs without masquerading as sources');
  assert(getUtilityPortsV2('serverRack').data_out?.utility === 'dataFiber',
    'the all-in-one capture rack remains a physical data peer');
  const expectedRearSides = {
    monitorBank: 'front', serverRack: 'front', operatorConsole: 'front',
    alarmPanel: 'front', daqRack: 'front',
    dataAppliance: 'back', dataStorageRack: 'back', cpuComputeRack: 'back',
    gpuComputeRack: 'back', serverCluster: 'back',
  };
  assert(Object.entries(expectedRearSides).every(([type, side]) => {
      const ports = getUtilityPortsV2(type);
      return ports.pwr_in?.side === side
        && (ports.data_in || ports.data_out)?.side === side;
    }), 'control-room electronics put both connectors on each model\'s physical rear panel');
  const activeControlRoomItems = Object.values(PLACEABLES)
    .filter(def => (def.zoneType === 'controlRoom' || def.zoneTypes?.includes('controlRoom'))
      && def.energyCost > 0);
  assert(activeControlRoomItems.every(def => {
    const ports = getUtilityPortsV2(def.id);
    return ports.pwr_in?.utility === 'powerCable'
      && Object.values(ports).some(port => port.utility === 'dataFiber');
  }), 'every powered Control Room catalogue item exposes rear power and data ports');
  assert(MODES.facility.categories.controlRoom.utilityLineTools.join(',') === 'dataFiber,powerCable',
    'the Control Room palette exposes Data Fiber and Power Cable tools');
}

{
  const game = new Game(new BeamlineRegistry(), { seed: 708 });
  game.state.zoneItems = [{
    id: 'gpu', type: 'gpuComputeRack', col: 4, row: 4,
    cells: [{ col: 4, row: 4 }, { col: 4, row: 5 }],
  }];
  game.state.zoneOccupied = { '4,4': 'officeSpace', '4,5': 'officeSpace' };
  assert(game.computeZoneFurnishingBonuses().research.controlRoom === undefined,
    'an out-of-room GPU rack contributes no Control Room research bonus');
  game.state.zoneOccupied = { '4,4': 'controlRoom', '4,5': 'controlRoom' };
  assert(near(game.computeZoneFurnishingBonuses().research.controlRoom, 0.03),
    'the same rack contributes its research bonus when fully inside the Control Room');
}

{
  const e = entry('bl-1');
  const state = {
    placeables: [{ type: 'serverRack' }],
    resources: { data: 0 }, staffDataEfficiency: 0,
  };
  const first = tickDataSystems(state, [e], [{ entry: e, rate: 6, workload: 'cpu' }]);
  assert(first.ingested === 6 && first.processed === 0, 'all-in-one capture rack keeps raw data before a scientist can process it');
  assert(e.beamState.rawDataStored === 6, 'unprocessed data persists in storage');

  state.staffDataEfficiency = 1;
  const second = tickDataSystems(state, [e], []);
  assert(second.processed > 0, 'a Take Data scientist activates installed compute');
  assert(near(state.resources.data, second.processed), 'processed output becomes existing research data points');
  assert(e.beamState.rawDataStored < 6, 'processing drains the raw buffer');
}

{
  const e = entry('bl-2');
  const state = {
    placeables: [{ type: 'dataAppliance' }],
    resources: { data: 0 }, staffDataEfficiency: 0,
  };
  const s = tickDataSystems(state, [e], [{ entry: e, rate: 10, workload: 'gpu' }]);
  assert(s.ingested === 4, 'DAQ ingest caps an oversized endpoint stream');
  assert(s.dropped === 6, 'data above ingest capacity is reported as dropped');
  assert(s.bottleneck === 'DAQ ingest', 'the snapshot names ingest as the limiting stage');
}

{
  const e = entry('bl-3');
  e.beamState.rawDataStored = 100;
  const state = { placeables: [], resources: { data: 0 }, staffDataEfficiency: 1 };
  const s = tickDataSystems(state, [e], []);
  assert(e.beamState.rawDataStored === 0, 'removing storage drops buffers that no longer fit');
  assert(s.dropped === 100, 'storage-loss drop is visible in the pipeline snapshot');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
