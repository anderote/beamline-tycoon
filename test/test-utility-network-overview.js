// The facility utility overview is a view over published discovery/solve
// snapshots. Disconnected connected-components must stay separate all the way
// to the row that opens their inspector.

import {
  renderUtilityNetworkOverview,
  utilityNetworkOverview,
} from '../src/ui/UtilityStatsPanel.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

console.log('\n--- Utility network overview topology ---');

const powerA = {
  id: 'net_powerCable_a',
  utilityType: 'powerCable',
  lineIds: ['line_a1', 'line_a2'],
  ports: [{}, {}, {}],
  sources: [{ portKey: 'source_a:out' }],
  sinks: [{ portKey: 'load_a:in' }, { portKey: 'load_b:in' }],
};
const powerB = {
  id: 'net_powerCable_b',
  utilityType: 'powerCable',
  lineIds: ['line_b1'],
  ports: [{}, {}],
  sources: [{ portKey: 'source_b:out' }],
  sinks: [{ portKey: 'load_c:in' }],
};
const data = {
  id: 'net_dataFiber_a',
  utilityType: 'dataFiber',
  lineIds: ['fiber_1', 'fiber_2'],
  ports: [{}, {}, {}],
  peers: [{}, {}, {}],
  sources: [],
  sinks: [],
};
const hotWater = {
  id: 'net_waterSupplyPipe_hot',
  utilityType: 'waterSupplyPipe',
  lineIds: ['hot_1'],
  ports: [{}, {}],
  sources: [{ portKey: 'rejector:hot' }],
  sinks: [{ portKey: 'load:return' }],
};

const state = {
  utilityNetworks: new Map([
    // Reverse input order proves the UI ordinal is stable by content-hashed id.
    ['powerCable', [powerB, powerA]],
    ['dataFiber', [data]],
    ['waterSupplyPipe', [hotWater]],
  ]),
  utilityNetworkData: new Map([
    ['powerCable', new Map([
      [powerA.id, {
        totalCapacity: 100,
        totalDemand: 75,
        errors: [],
      }],
      [powerB.id, {
        totalCapacity: 40,
        totalDemand: 55,
        errors: [{ severity: 'soft', code: 'power_overload' }],
      }],
    ])],
    ['dataFiber', new Map([[data.id, {
      connectedNodeCount: 3,
      connectedLinkCount: 2,
      errors: [],
    }]])],
    ['waterSupplyPipe', new Map([[hotWater.id, {
      waterCircuit: 'hot',
      totalCapacity: 300,
      totalDemand: 250,
      errors: [],
    }]])],
  ]),
};

const groups = utilityNetworkOverview(state);
const powerGroup = groups.find(group => group.utilityType === 'powerCable');
assert(powerGroup?.rows.length === 2,
  'two disconnected power topologies render as two networks');
assert(powerGroup?.rows[0].networkId === powerA.id
    && powerGroup?.rows[1].networkId === powerB.id,
  'network ordinals use stable topology ids rather than discovery iteration order');
assert(powerGroup?.rows[0].totalCapacity === 100
    && powerGroup?.rows[1].totalCapacity === 40,
  'capacity stays scoped to its exact solved network instead of being aggregated');
assert(powerGroup?.rows[0].sourceCount === 1
    && powerGroup?.rows[0].loadCount === 2
    && powerGroup?.rows[0].lineCount === 2,
  'source, load, and run membership comes from the matching published topology');
assert(powerGroup?.rows[1].softErrorCount === 1,
  'a fault on one topology is not hidden by a healthy sibling network');

const dataRow = groups.find(group => group.utilityType === 'dataFiber')?.rows[0];
assert(dataRow?.topologyOnly === true && dataRow?.topologyLabel === 'Bus',
  'directionless data networks are identified as bus topology');
assert(dataRow?.connectedNodeCount === 3 && dataRow?.connectedLinkCount === 2,
  'topology-only networks publish devices and links instead of invented capacity');

const waterRow = groups.find(group => group.utilityType === 'waterSupplyPipe')?.rows[0];
assert(waterRow?.circuitLabel === 'Hot return',
  'water topology exposes its published temperature circuit identity');

const html = renderUtilityNetworkOverview(groups);
assert(html.includes(`data-network-id="${powerA.id}"`)
    && html.includes(`data-network-id="${powerB.id}"`),
  'each topology keeps its exact network id on its inspector button');
assert(html.includes('Sources / loads') && html.includes('Capacity') && html.includes('Load'),
  'overview rows expose the requested capacity, source, and load fields');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
