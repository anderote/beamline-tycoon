// Clicked utility runs get their own identity/details model and plot only the
// bounded network telemetry published by SolveRunner.

import {
  renderUtilityLineDetails,
  renderUtilityPerformance,
  utilityLineDetailsModel,
  utilityPerformanceModel,
} from '../src/ui/utility-line-details.js';
import {
  appendUtilityPerformanceSample,
  UTILITY_PERFORMANCE_HISTORY_MAX,
} from '../src/utility/performance-history.js';
import { utilityInspectorTabs } from '../src/ui/UtilityInspector.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.error('  FAIL:', message); }
}

console.log('\n--- Utility run details and performance ---');

const line = {
  id: 'line_power_detail',
  utilityType: 'powerCable',
  start: { placeableId: 'grid', portName: 'power_out' },
  end: { placeableId: 'load', portName: 'power_in' },
  path: [{ col: 0, row: 0 }, { col: 2, row: 0 }, { col: 2, row: 1 }],
  cablePath: [{ col: 0, row: 0 }, { col: 1, row: 0.2 }, { col: 2, row: 1 }],
  subL: 12,
  attachments: [{ id: 'meter_1' }],
};
const network = {
  id: 'net_power_detail',
  utilityType: 'powerCable',
  lineIds: [line.id, 'line_branch'],
  ports: [{}, {}, {}],
};
const flow = {
  totalCapacity: 100,
  totalDemand: 75,
  utilization: 0.75,
  perSinkQuality: { 'load:power_in': 0.9 },
  errors: [{ severity: 'soft', code: 'test_warning' }],
};
const state = {
  placeables: [
    { id: 'grid', type: 'testGrid' },
    { id: 'load', type: 'testLoad' },
  ],
  beamPipes: [],
  utilityLines: new Map([[line.id, line]]),
  utilityNetworks: new Map([['powerCable', [network]]]),
  utilityNetworkData: new Map([['powerCable', new Map([[network.id, flow]])]]),
};

const details = utilityLineDetailsModel(state, line.id, network.id);
assert(details?.lineId === line.id && details?.networkId === network.id,
  'clicked run identity stays distinct from its connected network identity');
assert(details?.lengthMeters === 6 && details?.bendCount === 1,
  'details publish installed physical length and stored route bends');
assert(details?.networkRunCount === 2 && details?.networkPortCount === 3,
  'details report exact published network membership');
assert(details?.attachmentCount === 1 && details?.softErrorCount === 1,
  'run attachments and solver warning status reach the details model');

const detailsHtml = renderUtilityLineDetails(details);
assert(detailsHtml.includes(line.id) && detailsHtml.includes('6.0 m')
    && detailsHtml.includes('power_out') && detailsHtml.includes('power_in'),
  'run window renders identity, length, and both physical endpoints');

let history = [];
history = appendUtilityPerformanceSample(history, flow, 10);
history = appendUtilityPerformanceSample(history, {
  ...flow, totalDemand: 90, utilization: 0.9, perSinkQuality: { sink: 0.8 },
}, 11);
history = appendUtilityPerformanceSample(history, {
  ...flow, totalDemand: 95, utilization: 0.95, perSinkQuality: { sink: 0.7 },
}, 11);
assert(history.length === 2 && history[1].totalDemand === 95,
  'same-tick re-solves replace the latest telemetry sample instead of advancing time');
assert(history[1].deliveredQuality === 0.7 && history[1].softErrorCount === 1,
  'samples preserve solver-owned delivered quality and fault counts');

for (let tick = 12; tick < 12 + UTILITY_PERFORMANCE_HISTORY_MAX + 5; tick++) {
  history = appendUtilityPerformanceSample(history, flow, tick);
}
assert(history.length === UTILITY_PERFORMANCE_HISTORY_MAX,
  'utility performance history remains at its fixed memory bound');

state.utilityPerformanceHistory = new Map([
  ['powerCable', new Map([[network.id, history]])],
]);
const performance = utilityPerformanceModel(state, 'powerCable', network.id);
const performanceHtml = renderUtilityPerformance(performance);
assert(performance.history === history && performance.current.tick === history.at(-1).tick,
  'performance model reads the exact solver-published history without recomputing it');
assert((performanceHtml.match(/class="utility-performance-plot"/g) || []).length === 2
    && performanceHtml.includes('Demand and capacity')
    && performanceHtml.includes('Worst delivered quality'),
  'performance tab renders load/capacity and delivered-quality history plots');
assert(performanceHtml.includes('Every run in this topology shares these live values'),
  'plot copy makes the network-wide scope of line performance explicit');

const lineTabs = utilityInspectorTabs('powerCable', line.id);
assert(lineTabs[0]?.key === 'run'
    && lineTabs.some(tab => tab.key === 'performance')
    && lineTabs.some(tab => tab.key === 'topology')
    && lineTabs.some(tab => tab.key === 'overview'),
  'a clicked line opens Run Details, Performance, Topology, and Network tabs');

const dataHistory = appendUtilityPerformanceSample([], {
  connectedNodeCount: 3, connectedLinkCount: 2, perSinkQuality: {}, errors: [],
}, 20);
const dataState = { utilityPerformanceHistory: new Map([
  ['dataFiber', new Map([['net_data', dataHistory]])],
]) };
const dataHtml = renderUtilityPerformance(utilityPerformanceModel(dataState, 'dataFiber', 'net_data'));
assert(dataHistory[0].connectivity === 1 && dataHtml.includes('Connected fabric')
    && dataHtml.includes('Connection health') && dataHtml.includes('100%'),
  'topology-only fiber plots devices, links, and binary connection health');

const vacuumHistory = appendUtilityPerformanceSample([], {
  totalCapacity: 240, totalDemand: 2e-6, effectivePumpSpeed: 240,
  networkPressure: 8e-8, perSinkQuality: { chamber: 0.9 },
  stageCapacities: {
    rough: { powered: 15 }, high: { backed: 300 }, uhv: { powered: 600 },
  },
  volumeL: 325,
  volumeBreakdown: { beamPipeL: 100, servicePipeL: 25, componentChambersL: 200 },
  errors: [],
}, 30);
const vacuumState = { utilityPerformanceHistory: new Map([
  ['vacuumPipe', new Map([['net_vacuum', vacuumHistory]])],
]) };
const vacuumHtml = renderUtilityPerformance(
  utilityPerformanceModel(vacuumState, 'vacuumPipe', 'net_vacuum'),
);
assert(vacuumHistory[0].roughingCapacity === 15
    && vacuumHistory[0].highVacCapacity === 300
    && vacuumHistory[0].componentChamberVolumeL === 200,
  'vacuum telemetry copies solver-published stage capacity and volume sources');
assert((vacuumHtml.match(/class="utility-performance-plot"/g) || []).length === 3
    && vacuumHtml.includes('Pumping capacity by stage')
    && vacuumHtml.includes('325.0 L evacuated · utility pipe 25.0 · beamline pipe 100.0 · beamline components 200.0'),
  'vacuum performance tab plots stage capacities and captions the volume breakdown');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
