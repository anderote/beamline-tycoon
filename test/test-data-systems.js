import { makeDefaultBeamState } from '../src/beamline/BeamlineRegistry.js';
import { computeDataSystemCapacity, dataSystemHomeZone, tickDataSystems } from '../src/game/data-systems.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const entry = id => ({ id, beamState: makeDefaultBeamState('linac') });

console.log('\n=== Facility data systems ===\n');

{
  const cells = [{ col: 4, row: 4 }, { col: 5, row: 4 }];
  const placed = { id: 'cluster', type: 'serverCluster', col: 4, row: 4, cells };
  const partial = { zoneOccupied: { [`${cells[0].col},${cells[0].row}`]: 'controlRoom' } };
  assert(dataSystemHomeZone(partial, placed) === null,
    'a data rack is inactive when any footprint tile falls outside its room');
  const complete = { zoneOccupied: Object.fromEntries(
    cells.map(cell => [`${cell.col},${cell.row}`, 'controlRoom']),
  ) };
  assert(dataSystemHomeZone(complete, placed) === 'controlRoom',
    'a data rack resolves its home when its full footprint is in the room');
}

{
  const state = {
    placeables: [
      { type: 'dataAppliance' }, { type: 'dataStorageRack' },
      { type: 'cpuComputeRack' }, { type: 'gpuComputeRack' },
    ],
  };
  const c = computeDataSystemCapacity(state);
  assert(c.ingest === 4, 'compact appliance contributes starter ingest');
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
    utilityNetworks: new Map([['dataFiber', [{
      ports: [{ placeableId: 'gateway', portName: 'data_out' }],
    }]]]),
  };
  const c = computeDataSystemCapacity(state);
  assert(c.gateways === 1, 'a fiber-connected ingest rack activates the Control Room pipeline');
  assert(c.ingest === 8 && c.storage === 3240, 'the gateway activates shared Control Room capture and raw storage');
  assert(c.gpu === 3, 'data hardware in the wrong room contributes no processing capacity');
  assert(c.inactive.wrongZone === 1, 'wrong-room data hardware is reported inactive');
}

{
  const state = {
    placeables: [
      { id: 'gateway', type: 'serverRack', col: 1, row: 1 },
      { id: 'buffer', type: 'dataStorageRack', col: 2, row: 1 },
    ],
    zoneOccupied: { '1,1': 'controlRoom', '2,1': 'controlRoom' },
    utilityNetworks: new Map([['dataFiber', []]]),
  };
  const c = computeDataSystemCapacity(state);
  assert(c.ingest === 0 && c.storage === 0, 'an unwired Control Room has no active data capacity');
  assert(c.inactive.noGateway === 2, 'unwired room hardware is reported as waiting for a gateway');
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
  assert(getUtilityPortsV2('dataStorageRack').data_out === undefined
    && getUtilityPortsV2('cpuComputeRack').data_out === undefined
    && getUtilityPortsV2('gpuComputeRack').data_out === undefined,
  'storage and compute racks cannot masquerade as detector-fiber sources');
  assert(getUtilityPortsV2('serverRack').data_out?.role === 'source',
    'the all-in-one capture rack remains a real capture gateway');
}

{
  const e = entry('bl-1');
  const state = {
    placeables: [{ type: 'serverRack' }],
    resources: { data: 0 }, staffDataEfficiency: 0,
  };
  const first = tickDataSystems(state, [e], [{ entry: e, rate: 6, workload: 'cpu' }]);
  assert(first.ingested === 6 && first.processed === 0, 'without a scientist, raw data is ingested but not processed');
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
