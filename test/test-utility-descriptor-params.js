// test/test-utility-descriptor-params.js — every descriptor names the port
// params it actually aggregates.
//
// The Utility Inspector renders its per-source / per-sink rows from
// `params[desc.capacityParam]` / `params[desc.demandParam]` and its header
// from flowState.totalCapacity / totalDemand. Those two must agree.
//
// Regression: the inspector hard-coded params.capacity / params.demand (with
// a heatLoad special case), so cryoTransfer (coldCapacityW / srfHeatW) and
// vacuumPipe (pumpSpeed / outgassing) rendered every port as a literal 0
// beside a correct header total.
//
// The check: feed each descriptor one source and one sink carrying values
// under its DECLARED param names, and require the solve to see them.

import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../src/utility/registry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const CAP = 7;
const DEM = 3;
// Extra params some descriptors need before they aggregate at all. RF is the
// asymmetric one: a sink declares the frequency it is cut for, a source
// declares the bands it can produce, and capacity only counts if they meet.
const EXTRA_SOURCE = {
  rfWaveguide: { bands: ['lband'] },
  // Staged cooling publishes usable capacity only for a complete plant.
  coolingWater: { storageCapacityL: 500, heatRejectionCapacity: CAP },
  // Cryogenic chilling likewise needs physical inventory and warm-end heat
  // rejection. This synthetic integrated source declares all three roles.
  cryoTransfer: { storageCapacityL: 500, heatRejectionCapacityW: CAP },
};
const EXTRA_SINK = { rfWaveguide: { frequency: 1300e6 } };

for (const type of UTILITY_TYPE_LIST) {
  const desc = UTILITY_TYPES[type];
  console.log(`\n--- ${type} ---`);

  if (desc.topologyOnly) {
    const flow = desc.solve({
      id: `net_${type}_test`, utilityType: type, lineIds: ['line'],
      ports: [
        { placeableId: 'p1', portName: 'peer_1' },
        { placeableId: 'p2', portName: 'peer_2' },
      ],
      sources: [], sinks: [],
    }, {}, {}).flowState;
    assert(flow.connectedNodeCount === 2 && flow.totalCapacity === 1 && flow.totalDemand === 0,
      `${type} publishes peer topology instead of capacity/demand params`);
    continue;
  }

  const capParam = desc.capacityParam || 'capacity';
  const demParam = desc.demandParam || 'demand';
  assert(typeof capParam === 'string' && typeof demParam === 'string',
    `${type} declares capacity/demand param names (${capParam} / ${demParam})`);

  const srcParams = { ...(EXTRA_SOURCE[type] || {}), [capParam]: CAP };
  // Cooling is staged: an integrated source needs reservoir, chilling, and
  // rejection roles before its effective network capacity is non-zero.
  if (type === 'coolingWater') {
    srcParams.storageCapacityL = 500;
    srcParams.heatRejectionCapacity = CAP;
  }
  const sinkParams = { ...(EXTRA_SINK[type] || {}), [demParam]: DEM };
  const network = {
    id: `net_${type}_test`,
    utilityType: type,
    lineIds: [],
    ports: [],
    // network-discovery mirrors params.capacity / params.demand onto the port
    // itself; descriptors may read either, so populate both the way it does.
    sources: [{
      portKey: 's1', placeableId: 'p1', portName: 'out',
      params: srcParams, capacity: srcParams.capacity || 0,
    }],
    sinks: [{
      portKey: 'k1', placeableId: 'p2', portName: 'in',
      params: sinkParams, demand: sinkParams.demand || 0,
    }],
  };

  const persistent = desc.persistentStateDefaults
    ? JSON.parse(JSON.stringify(desc.persistentStateDefaults)) : {};
  const flow = (desc.solve(network, persistent, {}) || {}).flowState || {};
  assert(flow.totalCapacity === CAP,
    `${type} header capacity comes from params.${capParam} (got ${flow.totalCapacity})`);
  assert(flow.totalDemand === DEM,
    `${type} header demand comes from params.${demParam} (got ${flow.totalDemand})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
