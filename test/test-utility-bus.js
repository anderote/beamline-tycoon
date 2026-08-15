// test/test-utility-bus.js — distribution buses.
//
// On-pipe components are wired individually (the high-fidelity model), which
// makes a FODO cell a dozen identical stub drags. A distribution bus is the
// bulk affordance: one line to the bus serves every on-pipe sink of that
// utility it covers, on ONE pipe segment, within its declared reach.
//
//   1. A bus + one line feeds every covered placement on its segment.
//   2. Placements on a DIFFERENT segment are unaffected, even in range.
//   3. An unwired bus does nothing; removing the bus re-opens the blockers.
//   4. Reach is bounded — a placement past serviceRadius stays unserved.
//   5. Reservoir persistent state survives a bus being added (id re-hashes,
//      contents carry over via __portKeys overlap).

import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { listUtilityEndpoints } from '../src/utility/utility-endpoints.js';
import {
  discoverNetworks,
  findUnconnectedSinks,
  makeDefaultPortLookup,
  computeBusService,
} from '../src/utility/network-discovery.js';
import { SolveRunner } from '../src/utility/solve-runner.js';
import { UtilityRegistry } from '../src/utility/registry.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const HARD_UTILS = ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer'];

// Two parallel straight pipes four cells apart, three quads on the near one
// and two on the far one at matching positions. The bus sits between them but
// nearer the first pipe, so both pipes' quads are inside its 10-cell reach and
// only the segment tie-break can separate them.
function makeState() {
  const quad = (id, position) => ({ id, type: 'quadrupole', position, subL: 2, params: {} });
  return {
    placeables: [
      { id: 'src_1', type: 'powerPanel', kind: 'infrastructure', category: 'infrastructure',
        col: 3, row: 6, subCol: 0, subRow: 0, dir: 0 },
      { id: 'bus_1', type: 'powerBus', kind: 'infrastructure', category: 'infrastructure',
        col: 3, row: 1, subCol: 0, subRow: 0, dir: 0 },
    ],
    beamPipes: [
      { id: 'bp_1', subL: 48, path: [{ col: 0, row: 0 }, { col: 12, row: 0 }],
        placements: [quad('q1', 0.1), quad('q2', 0.3), quad('q3', 0.5)] },
      { id: 'bp_2', subL: 48, path: [{ col: 0, row: 4 }, { col: 12, row: 4 }],
        placements: [quad('q4', 0.1), quad('q5', 0.3)] },
    ],
    utilityLines: new Map(),
  };
}

function wireBus(state) {
  state.utilityLines.set('ul_1', {
    id: 'ul_1', utilityType: 'powerCable',
    start: { placeableId: 'src_1', portName: 'pwr_out_1' },
    end: { placeableId: 'bus_1', portName: 'pwr_in' },
    path: [{ col: 3, row: 6 }, { col: 3, row: 1 }],
  });
}

function unconnectedIds(state) {
  return findUnconnectedSinks(
    listUtilityEndpoints(state), state.utilityLines, getUtilityPortsV2, HARD_UTILS,
  ).filter(r => r.utility === 'powerCable').map(r => r.placeableId).sort();
}

console.log('\n--- 1. One line to a bus feeds every covered placement ---');
{
  const state = makeState();
  wireBus(state);
  const nets = discoverNetworks('powerCable', state.utilityLines, makeDefaultPortLookup(state));
  assert(nets.length === 1, `one powerCable network (got ${nets.length})`);
  const net = nets[0];
  // The panel's four outlets are one busbar behind the faceplate: discovery
  // unites them, and each declares rating/4, so they add back up to the panel's
  // rating no matter how many are in use.
  const panelOutlets = net.sources.filter(s => s.placeableId === 'src_1');
  assert(panelOutlets.length === net.sources.length && panelOutlets.length === 4,
    `the panel is the only supply, across its four outlets (got ${net.sources.length})`);
  const panelCapacity = panelOutlets.reduce((a, s) => a + s.capacity, 0);
  assert(panelCapacity === 40,
    `and they sum to the panel's rating, not four times it (got ${panelCapacity} kW)`);
  const sinkIds = net.sinks.map(s => s.placeableId).sort();
  assert(JSON.stringify(sinkIds) === JSON.stringify(['q1', 'q2', 'q3']),
    `all three quads on the bus's segment are sinks (got ${JSON.stringify(sinkIds)})`);
  const totalDemand = net.sinks.reduce((a, s) => a + s.demand, 0);
  assert(totalDemand === 30, `their demand reaches the source (got ${totalDemand} kW)`);

  assert(JSON.stringify(unconnectedIds(state)) === JSON.stringify(['q4', 'q5']),
    'the gate stops reporting them as unconnected');
}

console.log('\n--- 2. A different pipe segment is unaffected ---');
{
  const state = makeState();
  wireBus(state);
  const service = computeBusService(listUtilityEndpoints(state), getUtilityPortsV2);
  const served = service.get('bus_1').get('powerCable');
  assert(served.every(k => k.startsWith('q1:') || k.startsWith('q2:') || k.startsWith('q3:')),
    `coverage stays on one segment (got ${JSON.stringify(served)})`);
  assert(!served.some(k => k.startsWith('q4:') || k.startsWith('q5:')),
    'bp_2 quads are in reach but on another segment, so not covered');

  // Move the bus across to bp_2 and coverage flips wholesale — never merges.
  const moved = makeState();
  wireBus(moved);
  moved.placeables.find(p => p.id === 'bus_1').row = 5;
  const flipped = computeBusService(listUtilityEndpoints(moved), getUtilityPortsV2)
    .get('bus_1').get('powerCable').map(k => k.split(':')[0]).sort();
  assert(JSON.stringify(flipped) === JSON.stringify(['q4', 'q5']),
    `moving the bus flips it to the other segment (got ${JSON.stringify(flipped)})`);
}

console.log('\n--- 3. The bus must be present AND wired ---');
{
  // Unwired: the bus is placed but no line reaches it.
  const unwired = makeState();
  assert(JSON.stringify(unconnectedIds(unwired)) === JSON.stringify(['q1', 'q2', 'q3', 'q4', 'q5']),
    'an unwired bus serves nothing');
  const nets = discoverNetworks('powerCable', unwired.utilityLines, makeDefaultPortLookup(unwired));
  assert(nets.length === 0, `and produces no network on its own (got ${nets.length})`);

  // Removed: demolishing the bus nulls the line endpoint (what Game does).
  const removed = makeState();
  wireBus(removed);
  removed.placeables = removed.placeables.filter(p => p.id !== 'bus_1');
  removed.utilityLines.get('ul_1').end = null;
  assert(JSON.stringify(unconnectedIds(removed)) === JSON.stringify(['q1', 'q2', 'q3', 'q4', 'q5']),
    'removing the bus re-opens every blocker it was answering');
  const after = discoverNetworks('powerCable', removed.utilityLines, makeDefaultPortLookup(removed));
  assert(after.length === 1 && after[0].sinks.length === 0,
    'the orphaned line network carries no sinks');
}

console.log('\n--- 4. Reach is bounded ---');
{
  // powerBus declares serviceRadius 10 cells. Park a fourth quad at the far
  // end of bp_1 (col ~11.5), 8.4 cells past the bus, and it stays unserved.
  const state = makeState();
  const far = { id: 'q6', type: 'quadrupole', position: 0.95, subL: 2, params: {} };
  state.beamPipes[0].placements.push(far);
  state.placeables.find(p => p.id === 'bus_1').col = 0;
  wireBus(state);
  const served = computeBusService(listUtilityEndpoints(state), getUtilityPortsV2)
    .get('bus_1').get('powerCable').map(k => k.split(':')[0]).sort();
  assert(!served.includes('q6'),
    `a placement past serviceRadius stays unserved (covered: ${JSON.stringify(served)})`);
  assert(served.includes('q1'), 'the near ones are still covered');
  assert(unconnectedIds(state).includes('q6'), 'and it still raises its blocker');
}

console.log('\n--- 5. Reservoir state survives a bus being added ---');
{
  // A partly depleted cooling loop must keep its inventory when the network
  // re-hashes because a bus widened its membership. Seed a distinctive level
  // so a reset to the 500 L default cannot masquerade as a successful carry.
  const state = makeState();
  state.placeables.push(
    { id: 'skid_1', type: 'lcwSkid', kind: 'infrastructure', category: 'infrastructure',
      col: 8, row: 6, subCol: 0, subRow: 0, dir: 0 },
    { id: 'cbus_1', type: 'coolingManifold', kind: 'infrastructure', category: 'infrastructure',
      col: 3, row: 1, subCol: 0, subRow: 0, dir: 0 },
  );
  state.utilityNetworkState = new Map();
  // Phase A: one hand-drawn stub, skid → q1.
  state.utilityLines.set('cl_1', {
    id: 'cl_1', utilityType: 'coolingWater',
    start: { placeableId: 'skid_1', portName: 'cool_out' },
    end: { placeableId: 'q1', portName: 'cool_in' },
    path: [{ col: 8, row: 6 }, { col: 8, row: 0 }],
  });
  const runner = new SolveRunner({ state, registry: UtilityRegistry });
  runner.runSolve({ tick: 0 });

  const idsBefore = [...state.utilityNetworkState.keys()].filter(k => k.startsWith('net_coolingWater_'));
  assert(idsBefore.length === 1, `one cooling network before the bus (got ${idsBefore.length})`);
  const seededVolume = 123;
  state.utilityNetworkState.get(idsBefore[0]).reservoirVolumeL = seededVolume;

  // Phase B: add the bus and a second run off the same source port.
  state.utilityLines.set('cl_2', {
    id: 'cl_2', utilityType: 'coolingWater',
    start: { placeableId: 'skid_1', portName: 'cool_out' },
    end: { placeableId: 'cbus_1', portName: 'bus_right' },
    path: [{ col: 8, row: 6 }, { col: 8, row: 1 }, { col: 3, row: 1 }],
  });
  runner.markTopologyDirty();
  runner.runSolve({ tick: 1 });

  const idsAfter = [...state.utilityNetworkState.keys()].filter(k => k.startsWith('net_coolingWater_'));
  assert(idsAfter.length === 1, `still exactly one cooling network (got ${idsAfter.length})`);
  assert(idsAfter[0] !== idsBefore[0], 'its id re-hashed — port membership grew');
  const carried = state.utilityNetworkState.get(idsAfter[0]).reservoirVolumeL;
  assert(carried >= seededVolume && carried < seededVolume + 1,
    `the seeded reservoir carried over rather than resetting (${carried.toFixed(2)} L vs ${seededVolume.toFixed(2)} L)`);

  const cooled = state.utilityNetworks.get('coolingWater')[0].sinks.map(s => s.placeableId).sort();
  assert(JSON.stringify(cooled) === JSON.stringify(['q1', 'q2', 'q3']),
    `the bus added the rest of the segment to the loop (got ${JSON.stringify(cooled)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
