// Power topology is radial by design: an upstream supply may feed a
// distributor, a distributor may feed a field box/load, but two live outputs
// may never be tied together. These are validator rules, not UI conventions.

import { COMPONENTS } from '../src/data/components.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { buildPortRoutedPath } from '../src/utility/line-geometry.js';
import { portApproachVec, portWorldPosition } from '../src/utility/ports.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import powerCable from '../src/utility/types/powerCable.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`PASS  ${msg}`); }
  else { failed++; console.log(`FAIL  ${msg}`); }
}

const placeables = [
  ['xfmr', 'facilityTransformer', 0, 0],
  ['compactGear', 'compactHvDistributor', 8, 8],
  ['gear', 'switchgear', 8, 0],
  ['panelA', 'powerPanel', 16, 0],
  ['panelB', 'powerPanel', 16, 8],
  ['bus', 'powerBus', 24, 0],
  ['spider', 'spiderBox', 24, 8],
  ['load', 'quadrupole', 32, 0],
  ['rfSource', 'gyrotron', 32, 8],
  ['dryCooler', 'dryCoolerBank', 40, 8],
].map(([id, type, col, row]) => ({ id, type, col, row, subCol: 0, subRow: 0, dir: 0 }));
const state = { placeables, beamPipes: [], utilityLines: new Map() };

function ref(placeableId, portName) { return { placeableId, portName }; }
function endpoint(r) { return placeables.find(p => p.id === r.placeableId); }
function candidate(utilityType, start, end) {
  const a = endpoint(start), b = endpoint(end);
  const da = COMPONENTS[a.type], db = COMPONENTS[b.type];
  const pa = portWorldPosition(a, da, start.portName);
  const pb = portWorldPosition(b, db, end.portName);
  return validateDrawLine(state, {
    utilityType, start, end,
    path: buildPortRoutedPath(
      { col: pa.x / 2, row: pa.z / 2 }, portApproachVec(a, da, start.portName),
      { col: pb.x / 2, row: pb.z / 2 }, portApproachVec(b, db, end.portName),
    ),
  });
}

console.log('\n--- HV hierarchy ---');
assert(candidate('hvCable', ref('xfmr', 'hv_out_1'), ref('gear', 'hv_in')).ok,
  'transformer -> HV Distributor Box is a valid HV feeder');
assert(candidate('hvCable', ref('xfmr', 'hv_out_2'), ref('compactGear', 'hv_in')).ok,
  'transformer -> Compact HV Distributor is a valid HV feeder');
assert(candidate('hvCable', ref('compactGear', 'hv_out_1'), ref('panelA', 'hv_in')).ok,
  'Compact HV Distributor -> panel is a valid protected downstream feeder');
assert(candidate('hvCable', ref('compactGear', 'hv_out_2'), ref('rfSource', 'hv_in')).ok,
  'the compact distributor exposes a second independent HV output');
assert(candidate('hvCable', ref('gear', 'hv_out_1'), ref('panelA', 'hv_in')).ok,
  'HV Distributor Box -> panel is a valid protected downstream feeder');
assert(candidate('hvCable', ref('xfmr', 'hv_out_1'), ref('xfmr', 'hv_out_2')).reason === 'invalid_port_pair',
  'two HV supply outputs cannot be tied together');
assert(candidate('hvCable', ref('xfmr', 'hv_out_1'), ref('rfSource', 'hv_in')).ok,
  'transformer -> RF source is a valid dedicated HV feeder');
assert(candidate('hvCable', ref('gear', 'hv_out_1'), ref('dryCooler', 'hv_in')).ok,
  'HV Distributor Box -> dry cooler bank is a valid dedicated HV feeder');
assert(candidate('hvCable', ref('gear', 'hv_out_2'), ref('rfSource', 'hv_in')).ok,
  'a separate HV Distributor Box output can feed an RF source');

console.log('\n--- Branch hierarchy ---');
assert(candidate('powerCable', ref('panelA', 'pwr_out_1'), ref('bus', 'pwr_in')).ok,
  'panel -> busway feeder input is valid');
assert(candidate('powerCable', ref('bus', 'pwr_out_1'), ref('load', 'pwr_in')).ok,
  'busway tap -> equipment load is valid');
assert(candidate('powerCable', ref('panelA', 'pwr_out_2'), ref('spider', 'pwr_in')).ok,
  'panel -> spider box feeder input is valid');
for (const portName of ['pwr_in', 'pwr_out_1', 'pwr_out_2', 'pwr_out_3']) {
  assert(candidate('powerCable', ref('panelA', 'pwr_out_2'), ref('spider', portName)).ok,
    `panel may feed spider box through ${portName}`);
  assert(candidate('powerCable', ref('spider', portName), ref('load', 'pwr_in')).ok,
    `spider box ${portName} may feed a load`);
}
assert(candidate('powerCable', ref('load', 'pwr_in'), ref('spider', 'pwr_out_3')).ok,
  'the player may draw from a load back to any spider-box socket too');
assert(candidate('powerCable', ref('bus', 'pwr_out_2'), ref('spider', 'pwr_in')).reason === 'invalid_port_pair',
  'a field distributor cannot feed another field distributor');
assert(validateDrawLine(state, {
  utilityType: 'powerCable',
  start: ref('spider', 'pwr_in'), end: ref('spider', 'pwr_out_1'),
  path: [{ col: 24, row: 8 }, { col: 25, row: 8 }],
}).reason === 'invalid_port_pair',
  'a spider box cannot loop one of its own sockets back into another');
assert(candidate('powerCable', ref('panelA', 'pwr_out_3'), ref('panelB', 'pwr_out_1')).reason === 'invalid_port_pair',
  'two distribution outputs cannot be tied together');
assert(candidate('powerCable', ref('panelA', 'pwr_out_4'), ref('bus', 'pwr_out_2')).reason === 'invalid_port_pair',
  'a panel can only enter the designated busway feeder port');

console.log('\n--- Omnidirectional spider-box solve ---');
{
  const wired = {
    ...state,
    utilityLines: new Map([
      ['feed', {
        id: 'feed', utilityType: 'powerCable',
        // Store both lines opposite the conceptual flow direction to prove
        // that endpoint order and legacy input/output names do not matter.
        start: ref('spider', 'pwr_out_2'), end: ref('panelA', 'pwr_out_1'),
        path: [{ col: 20, row: 8 }, { col: 16, row: 8 }],
      }],
      ['branch', {
        id: 'branch', utilityType: 'powerCable',
        start: ref('load', 'pwr_in'), end: ref('spider', 'pwr_in'),
        path: [{ col: 32, row: 0 }, { col: 24, row: 0 }],
      }],
    ]),
  };
  const networks = discoverNetworks('powerCable', wired.utilityLines, makeDefaultPortLookup(wired));
  assert(networks.length === 1, `feed and branch form one network (got ${networks.length})`);
  const network = networks[0];
  assert(network.ports.filter(p => p.placeableId === 'spider').length === 4,
    'touching any two spider sockets unites all four sockets inside the box');
  assert(network.sinks.some(s => s.placeableId === 'load'),
    'the load is downstream regardless of which spider sockets and draw directions were used');
  const solved = powerCable.solve(network, {}, null).flowState;
  assert(solved.totalCapacity === 30 && solved.perSinkQuality['load:pwr_in'] === 1,
    `the arbitrary-port network keeps the spider box's 30 kW cap (got ${solved.totalCapacity} kW)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
