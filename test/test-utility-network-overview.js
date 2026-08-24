// The facility utility overview is a view over published discovery/solve
// snapshots. Disconnected connected-components must stay separate all the way
// to the row that opens their inspector.

import {
  renderUtilityNetworkOverview,
  utilityCategoryOverview,
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
        errors: [],
        topology: { diagnostics: { deadBranches: 1, constrainedNodes: 1 } },
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
assert(powerGroup?.rows[1].constrainedNodeCount === 1
    && powerGroup?.rows[1].deadBranchCount === 1,
  'topology diagnostics on one network are not hidden by a healthy sibling');

const dataRow = groups.find(group => group.utilityType === 'dataFiber')?.rows[0];
assert(dataRow?.topologyOnly === true && dataRow?.topologyLabel === 'Bus',
  'directionless data networks are identified as bus topology');
assert(dataRow?.connectedNodeCount === 3 && dataRow?.connectedLinkCount === 2,
  'topology-only networks publish devices and links instead of invented capacity');

const waterRow = groups.find(group => group.utilityType === 'waterSupplyPipe')?.rows[0];
assert(waterRow?.circuitLabel === 'Hot return',
  'water topology exposes its published temperature circuit identity');

const categories = utilityCategoryOverview(groups);
assert(categories.length === 5
    && categories.map(category => category.key).join(',')
      === 'electrical,rf,vacuum,cooling,controls',
  'the first level always exposes the five infrastructure families');

const electrical = categories.find(category => category.key === 'electrical');
assert(electrical?.networkCount === 2
    && electrical?.lineCount === 3
    && electrical?.sourceCount === 2
    && electrical?.loadCount === 3,
  'category cards aggregate high-level membership from their published networks');
assert(electrical?.status.kind === 'soft'
    && electrical?.status.label === '1 network warning',
  'a category summary surfaces an unhealthy network instead of masking it');

const powerSummary = electrical?.utilityGroups.find(group => group.utilityType === 'powerCable');
assert(powerSummary?.totalCapacity === 140 && powerSummary?.totalDemand === 130,
  'per-type dashboard totals join only published capacity and demand values');
assert(powerSummary?.capacityUnit === 'kW' && powerSummary?.demandUnit === 'kW',
  'dashboard totals retain the registry-published display units');

const controls = categories.find(category => category.key === 'controls');
const dataSummary = controls?.utilityGroups.find(group => group.utilityType === 'dataFiber');
assert(dataSummary?.topologyOnly === true
    && dataSummary?.connectedNodeCount === 3
    && dataSummary?.connectedLinkCount === 2,
  'topology-only dashboard summaries use published device and link counts');

const vacuum = categories.find(category => category.key === 'vacuum');
assert(vacuum?.networkCount === 0 && vacuum?.status.kind === 'inactive',
  'unused infrastructure remains discoverable as an inactive category');

const dashboardHtml = renderUtilityNetworkOverview(groups);
assert(dashboardHtml.includes('Facility infrastructure')
    && dashboardHtml.includes('data-utility-category="electrical"')
    && dashboardHtml.includes('data-utility-category="vacuum"'),
  'default rendering is the compact category dashboard');
assert(dashboardHtml.includes('130.0 kW load · 140.0 kW capacity')
    && dashboardHtml.includes('3 devices · 2 links'),
  'dashboard cards display high-level capacity and topology summaries');
assert(!dashboardHtml.includes('data-network-id='),
  'the dashboard does not render the full list of individual networks');

const electricalHtml = renderUtilityNetworkOverview(groups, 'electrical');
assert(electricalHtml.includes(`data-network-id="${powerA.id}"`)
    && electricalHtml.includes(`data-network-id="${powerB.id}"`),
  'category detail keeps each topology exact network id on its inspector button');
assert(electricalHtml.includes('Sources / loads')
    && electricalHtml.includes('Capacity')
    && electricalHtml.includes('Load'),
  'category detail exposes capacity, source, and load fields for each network');
assert(electricalHtml.includes('1 constrained'),
  'category detail surfaces graph diagnostics before a network is opened');

const vacuumNetwork = {
  id: 'net_vacuum_breakdown', utilityType: 'vacuumPipe', lineIds: ['vac_1'],
  ports: [{}, {}, {}], sources: [{ portKey: 'turbo:out' }],
  sinks: [{ portKey: 'chamber:in' }],
};
const vacuumState = {
  utilityNetworks: new Map([['vacuumPipe', [vacuumNetwork]]]),
  utilityNetworkData: new Map([['vacuumPipe', new Map([[vacuumNetwork.id, {
    totalCapacity: 240, totalDemand: 2e-6, pressure: 8e-8,
    vacuumStage: 'high', effectivePumpSpeed: 240, volumeL: 325,
    stageCapacities: {
      rough: { powered: 15 }, high: { backed: 300 }, uhv: { powered: 0 },
    },
    volumeBreakdown: { beamPipeL: 100, servicePipeL: 25, componentChambersL: 200 },
    errors: [],
  }]])]]),
};
const vacuumGroups = utilityNetworkOverview(vacuumState);
const vacuumRow = vacuumGroups.find(group => group.utilityType === 'vacuumPipe')?.rows[0];
assert(vacuumRow?.pressure === 8e-8
    && vacuumRow?.stageCapacities?.high?.backed === 300
    && vacuumRow?.volumeBreakdown?.componentChambersL === 200,
  'vacuum overview keeps solver-published stage capacity and volume sources');
const vacuumHtml = renderUtilityNetworkOverview(vacuumGroups, 'vacuum');
assert(vacuumHtml.includes('Pressure / stage')
    && vacuumHtml.includes('R 15.0 · H 300.0')
    && vacuumHtml.includes('240.0 L/s · 325.0 L'),
  'vacuum network row replaces generic capacity/load with pressure-stage and volume metrics');
const vacuumDashboard = renderUtilityNetworkOverview(vacuumGroups);
assert(vacuumDashboard.includes('8.00e-8 mbar worst · 325.0 L evacuated'),
  'vacuum dashboard summarizes worst pressure and evacuated volume');

const emptyHtml = renderUtilityNetworkOverview([]);
assert(emptyHtml.includes('Electrical')
    && emptyHtml.includes('Vacuum')
    && emptyHtml.includes('Data &amp; Controls')
    && emptyHtml.includes('Not connected'),
  'an empty facility still presents infrastructure categories instead of a blank state');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
