import { makeDefaultBeamState } from '../src/beamline/BeamlineRegistry.js';
import { computeDataSystemCapacity, tickDataSystems } from '../src/game/data-systems.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const entry = id => ({ id, beamState: makeDefaultBeamState('linac') });

console.log('\n=== Facility data systems ===\n');

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
