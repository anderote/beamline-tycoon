// test/test-utility-adjacency.js — adjacency bridging.
//
// Components that physically touch can share selected utilities with no line
// between them: bolt a turbo onto a roughing pump and they are one pumping
// stack. Electrical and HV connections remain explicit. What the rule has
// to get right is where it STOPS:
//   1. Geometry: flush (or one sub-unit shy) counts, a tile apart does not, and
//      corner contact is not adjacency.
//   2. Only clusters a line actually reaches light up — adjacency spreads a
//      supply, it never invents one.
//   3. Per-utility opt-in: RF and cryo still need a real run.
//   4. A component declaring both a source and a sink of one utility is a
//      boundary and never bridges it, or its own output would feed its own
//      input.
//   5. findUnconnectedSinks agrees with discoverNetworks, or the gate would
//      trip the beam on components the solver is demonstrably feeding.

import {
  computeAdjacency,
  discoverNetworks,
  findUnconnectedSinks,
  ADJ_MAX_GAP_SUB,
} from '../src/utility/network-discovery.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// --- fixtures --------------------------------------------------------------
//
// Fake component types, so the rules are pinned independent of the real
// catalogue. Footprints are 2x2 sub-units (half a tile square).
const PORTS = {
  rack:      { vac_in: { utility: 'vacuumPipe', role: 'sink', side: 'left', params: { demand: 10 } } },
  feeder:    { vac_out: { utility: 'vacuumPipe', role: 'source', side: 'right', params: { capacity: 100 } } },
  cryostat:  { cryo_in: { utility: 'cryoTransfer', role: 'sink', side: 'left', params: { demand: 5 } } },
  cryoPlant: { cryo_out: { utility: 'cryoTransfer', role: 'source', side: 'right', params: { capacity: 50 } } },
  // Declares both directions of one utility: a converter, and therefore a
  // boundary that must not bridge.
  repeater:  {
    data_in: { utility: 'dataFiber', role: 'sink', side: 'left', params: { demand: 1 } },
    data_out: { utility: 'dataFiber', role: 'source', side: 'right', params: { capacity: 10 } },
  },
  // Carries no utility at all — bridging must not route through it.
  crate: {},
};
const DEFS = Object.fromEntries(Object.keys(PORTS).map(t => [t, { subL: 2, subW: 2, ports: PORTS[t] }]));

const getDef = t => DEFS[t];
const getPorts = t => (DEFS[t] && DEFS[t].ports) || {};

// Positions are in sub-units so the fixtures read as "flush", "one shy",
// "a tile apart" without tile/sub arithmetic at every call site.
function at(id, type, subCol, subRow) {
  return { id, type, col: 0, row: 0, subCol, subRow, dir: 0 };
}

function lookupFor(endpoints) {
  const byId = new Map(endpoints.map(e => [e.id, e]));
  const adjacency = computeAdjacency(endpoints, getDef);
  const lookup = (pid, portName) => {
    const e = byId.get(pid);
    return (e && getPorts(e.type)[portName]) || null;
  };
  lookup.listPorts = (pid) => {
    const e = byId.get(pid);
    if (!e) return [];
    return Object.entries(getPorts(e.type)).map(([name, spec]) => ({ name, spec }));
  };
  lookup.busTargets = () => [];
  lookup.neighbors = (pid) => adjacency.get(pid) || [];
  return lookup;
}

// A line from the feeder's port into whatever id/port is named.
function feedLine(utilityType, start, end) {
  return {
    id: 'ul_1', utilityType, start, end,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  };
}

function networkFor(utilityType, endpoints, lines) {
  const nets = discoverNetworks(utilityType, lines, lookupFor(endpoints));
  return nets.find(n => n.sinks.length > 0 || n.sources.length > 0) || null;
}

console.log('\n--- 1. What counts as touching ---');
{
  const a = at('a', 'rack', 0, 0);            // occupies sub cols 0..2
  const flush = at('b', 'rack', 2, 0);        // starts exactly where a ends
  const shy = at('c', 'rack', 3, 0);          // one sub-unit gap
  const far = at('d', 'rack', 6, 0);          // a full tile away
  const corner = at('e', 'rack', 2, 2);       // meets a only at its corner
  const adj = computeAdjacency([a, flush, shy, far, corner], getDef);
  const near = adj.get('a') || [];
  assert(near.includes('b'), 'flush footprints are adjacent');
  assert(ADJ_MAX_GAP_SUB === 1 && near.includes('c'),
    'a one-sub-unit gap still reads as next to it');
  assert(!near.includes('d'), 'a tile of clear floor is not adjacency');
  assert(!near.includes('e'), 'corner contact alone is not adjacency');
  assert((adj.get('b') || []).includes('a'), 'adjacency is symmetric');
}

console.log('\n--- 1b. Electrical connections stay explicit ---');
{
  assert(UTILITY_TYPES.powerCable.bridgesAdjacent === false
      && UTILITY_TYPES.hvCable.bridgesAdjacent === false,
  'power and HV never bridge merely because equipment touches');
}

console.log('\n--- 2. An adjacency-enabled line into one component feeds the string ---');
{
  //  feeder ][ rack1 ][ rack2 ][ rack3      all flush, one line into rack1
  const eps = [
    at('src', 'feeder', 0, 0),
    at('r1', 'rack', 2, 0),
    at('r2', 'rack', 4, 0),
    at('r3', 'rack', 6, 0),
  ];
  const lines = [feedLine('vacuumPipe',
    { placeableId: 'src', portName: 'vac_out' },
    { placeableId: 'r1', portName: 'vac_in' })];
  const net = networkFor('vacuumPipe', eps, lines);
  assert(net && net.sinks.length === 3,
    `one line serves all three racks (got ${net ? net.sinks.length : 0})`);
  assert(net && net.sources.length === 1, 'off the one feeder');
  assert(net && net.sinks.reduce((a, s) => a + s.demand, 0) === 30,
    'and the bridged sinks bring their demand with them');

  const report = findUnconnectedSinks(eps, lines, getPorts, ['vacuumPipe']);
  assert(report.length === 0,
    `the gate agrees nothing is unconnected (got ${JSON.stringify(report.map(r => r.placeableId))})`);
}

{
  // Break the string: r3 is a tile clear of r2 and stays dark.
  const eps = [
    at('src', 'feeder', 0, 0),
    at('r1', 'rack', 2, 0),
    at('r2', 'rack', 4, 0),
    at('r3', 'rack', 10, 0),
  ];
  const lines = [feedLine('vacuumPipe',
    { placeableId: 'src', portName: 'vac_out' },
    { placeableId: 'r1', portName: 'vac_in' })];
  const net = networkFor('vacuumPipe', eps, lines);
  assert(net && net.sinks.length === 2,
    `the bridge stops at the gap (got ${net ? net.sinks.length : 0} sinks)`);
  const report = findUnconnectedSinks(eps, lines, getPorts, ['vacuumPipe']);
  assert(report.length === 1 && report[0].placeableId === 'r3',
    `and the detached rack is still reported (got ${JSON.stringify(report.map(r => r.placeableId))})`);
}

{
  // A component carrying none of this utility does not pass it along.
  const eps = [
    at('src', 'feeder', 0, 0),
    at('r1', 'rack', 2, 0),
    at('box', 'crate', 4, 0),
    at('r2', 'rack', 6, 0),
  ];
  const lines = [feedLine('vacuumPipe',
    { placeableId: 'src', portName: 'vac_out' },
    { placeableId: 'r1', portName: 'vac_in' })];
  const net = networkFor('vacuumPipe', eps, lines);
  assert(net && net.sinks.length === 1,
    `bridging does not route through an unrelated component (got ${net ? net.sinks.length : 0})`);
}

console.log('\n--- 3. An unwired cluster stays unwired ---');
{
  // Three racks bolted together, no line anywhere near them.
  const eps = [at('r1', 'rack', 0, 0), at('r2', 'rack', 2, 0), at('r3', 'rack', 4, 0)];
  const nets = discoverNetworks('vacuumPipe', [], lookupFor(eps));
  assert(nets.length === 0, `touching alone builds no network (got ${nets.length})`);
  const report = findUnconnectedSinks(eps, [], getPorts, ['vacuumPipe']);
  assert(report.length === 3,
    `all three are still reported unconnected (got ${report.length})`);
}

console.log('\n--- 4. RF and cryo do not bridge ---');
{
  const eps = [
    at('plant', 'cryoPlant', 0, 0),
    at('c1', 'cryostat', 2, 0),
    at('c2', 'cryostat', 4, 0),
  ];
  const lines = [feedLine('cryoTransfer',
    { placeableId: 'plant', portName: 'cryo_out' },
    { placeableId: 'c1', portName: 'cryo_in' })];
  const net = networkFor('cryoTransfer', eps, lines);
  assert(net && net.sinks.length === 1,
    `a cryo line reaches only what it is drawn to (got ${net ? net.sinks.length : 0})`);
  const report = findUnconnectedSinks(eps, lines, getPorts, ['cryoTransfer']);
  assert(report.length === 1 && report[0].placeableId === 'c2',
    'and the touching cryostat is still reported unconnected');
}

console.log('\n--- 5. A converter is a boundary ---');
{
  // Two repeaters bolted together. Each declares data_in AND data_out, so
  // bridging them would let either one answer its own demand.
  const eps = [at('rp1', 'repeater', 0, 0), at('rp2', 'repeater', 2, 0)];
  const lines = [{
    id: 'ul_x', utilityType: 'dataFiber',
    start: null, end: { placeableId: 'rp1', portName: 'data_in' },
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  }];
  const net = networkFor('dataFiber', eps, lines);
  const keys = net ? net.ports.map(p => `${p.placeableId}:${p.portName}`) : [];
  assert(!keys.includes('rp1:data_out'),
    `a converter's own output stays out of its input's network (got ${keys.join(',')})`);
  assert(!keys.some(k => k.startsWith('rp2:')),
    'and it does not bridge into the device bolted to it');
  const report = findUnconnectedSinks(eps, lines, getPorts, ['dataFiber']);
  assert(report.length === 1 && report[0].placeableId === 'rp2',
    `the neighbour is still reported unconnected (got ${JSON.stringify(report.map(r => r.placeableId))})`);
}

console.log('\n--- 6. Bridging is stable and does not double-count ---');
{
  // The same cluster reached by two lines is ONE network, whichever order the
  // lines come in — network ids hash the port-key set, so an order-dependent
  // grouping would make the id flicker every tick.
  const eps = [
    at('src', 'feeder', 0, 0),
    at('r1', 'rack', 2, 0),
    at('r2', 'rack', 4, 0),
  ];
  const l1 = feedLine('vacuumPipe',
    { placeableId: 'src', portName: 'vac_out' }, { placeableId: 'r1', portName: 'vac_in' });
  const l2 = {
    ...feedLine('vacuumPipe',
      { placeableId: 'src', portName: 'vac_out' }, { placeableId: 'r2', portName: 'vac_in' }),
    id: 'ul_2',
    path: [{ col: 0, row: 2 }, { col: 2, row: 2 }],
  };
  const forward = discoverNetworks('vacuumPipe', [l1, l2], lookupFor(eps));
  const reverse = discoverNetworks('vacuumPipe', [l2, l1], lookupFor(eps));
  assert(forward.length === 1, `two lines into one cluster make one network (got ${forward.length})`);
  assert(forward.length === 1 && forward[0].sinks.length === 2,
    'with each sink counted once');
  assert(forward.map(n => n.id).join() === reverse.map(n => n.id).join(),
    'and the network id does not depend on line order');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
