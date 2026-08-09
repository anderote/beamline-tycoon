// test/test-solve-caching.js — topology-dirty caching in
// src/utility/solve-runner.js + the unconnected-sink cache in
// src/game/utility-gate.js.
//
// Discovery (union-find over lines/ports) only depends on topology, so
// SolveRunner caches its output and re-runs it only when markTopologyDirty()
// bumped topologyRevision since the last pass. Per-network solve() still runs
// every pass. The gate's findUnconnectedSinks report rides the same revision.
//
// Scenarios:
//   1. Same-topology passes reuse discovery (stats.discoveries stays at 1)
//      while solve() runs every pass.
//   2. markTopologyDirty() after a line add/remove re-runs discovery and the
//      network set reflects the change.
//   3. Persistent (reservoir) state survives a re-discovery: unrelated
//      topology change → same content-hashed network id → same reservoir.
//   4. UtilityGate recomputes unconnected sinks only on revision change
//      (asserted by counting getPorts calls), and recomputes every tick when
//      the injected solveRunner has no topologyRevision (test-fake fallback).

import { SolveRunner } from '../src/utility/solve-runner.js';
import { UtilityGate } from '../src/game/utility-gate.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixtures (mirrors test-utility-solve-runner.js).
// ---------------------------------------------------------------------------

function makeLookup(specs) {
  const lookup = function (pid, name) {
    const entry = specs[pid];
    return (entry && entry[name]) || null;
  };
  lookup.listPorts = function (pid) {
    const entry = specs[pid];
    if (!entry) return [];
    return Object.entries(entry).map(([name, spec]) => ({ name, spec }));
  };
  return lookup;
}

// Distinct paths per line so the spatial (shared-subtile) union never merges
// lines that are only meant to be separate networks.
let nextPathRow = 0;
function makeLine(id, utilityType, aId, aPort, bId, bPort) {
  const row = nextPathRow++;
  return {
    id, utilityType,
    start: { placeableId: aId, portName: aPort },
    end:   { placeableId: bId, portName: bPort },
    path:  [{ col: 0, row: row * 10 }, { col: 1, row: row * 10 }],
    subL:  4,
  };
}

function makeState(linesArr) {
  const lines = new Map();
  for (const l of linesArr) lines.set(l.id, l);
  return { utilityLines: lines, utilityNetworkState: new Map() };
}

const SPECS = {
  src:  { out: { utility: 'fake', side: 'right', role: 'source', params: { capacity: 100 } } },
  dst:  { in:  { utility: 'fake', side: 'left',  role: 'sink',   params: { demand:  50 } } },
  src2: { out: { utility: 'fake', side: 'right', role: 'source', params: { capacity: 10 } } },
  dst2: { in:  { utility: 'fake', side: 'left',  role: 'sink',   params: { demand:   5 } } },
};

function makeRunner(state, descriptor) {
  return new SolveRunner({
    state,
    registry: { types: { fake: descriptor }, list: ['fake'] },
    portLookup: makeLookup(SPECS),
  });
}

// ==========================================================================
// Test 1: same-topology passes reuse cached discovery; solve() runs each pass.
// ==========================================================================
console.log('\n--- Test 1: same-topology passes reuse discovery ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  let solveCalls = 0;
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: {},
    solve() { solveCalls++; return { flowState: { ok: 1 }, nextPersistentState: {}, errors: [] }; },
  };
  const runner = makeRunner(state, descriptor);

  runner.runSolve();
  runner.runSolve();
  runner.runSolve();

  assert(runner.stats.discoveries === 1,
    `discovery ran once across 3 passes (got ${runner.stats.discoveries})`);
  assert(runner.stats.solvePasses === 3, `3 solve passes (got ${runner.stats.solvePasses})`);
  assert(solveCalls === 3, `descriptor.solve ran every pass (got ${solveCalls})`);
  assert(state.utilityNetworkData.get('fake').size === 1, 'flow data still published from cache');
  assert(state.utilityNetworks.get('fake').length === 1, 'networks still published from cache');
}

// ==========================================================================
// Test 2: markTopologyDirty after line add/remove re-runs discovery.
// ==========================================================================
console.log('\n--- Test 2: line add/remove invalidates ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: {},
    solve() { return { flowState: {}, nextPersistentState: {}, errors: [] }; },
  };
  const runner = makeRunner(state, descriptor);

  runner.runSolve();
  assert(state.utilityNetworks.get('fake').length === 1, '1 network before add');

  // Add a second, disjoint line — without markTopologyDirty the cache is
  // (deliberately) stale; with it, discovery sees the new network.
  const l2 = makeLine('L2', 'fake', 'src2', 'out', 'dst2', 'in');
  state.utilityLines.set(l2.id, l2);
  runner.runSolve();
  assert(state.utilityNetworks.get('fake').length === 1,
    'no invalidation → cache reused (stale by design until the seam fires)');
  runner.markTopologyDirty();
  runner.runSolve();
  assert(runner.stats.discoveries === 2, `add re-discovered (got ${runner.stats.discoveries})`);
  assert(state.utilityNetworks.get('fake').length === 2, '2 networks after add');

  // Remove it again.
  state.utilityLines.delete('L2');
  runner.markTopologyDirty();
  runner.runSolve();
  assert(runner.stats.discoveries === 3, `remove re-discovered (got ${runner.stats.discoveries})`);
  assert(state.utilityNetworks.get('fake').length === 1, '1 network after remove');
}

// ==========================================================================
// Test 3: reservoir state persists across re-discovery (content-hashed ids).
// ==========================================================================
console.log('\n--- Test 3: persistent state survives re-discovery ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: { reservoir: 0 },
    solve(network, persistent) {
      return {
        flowState: { reservoir: persistent.reservoir + 1 },
        nextPersistentState: { reservoir: persistent.reservoir + 1 },
        errors: [],
      };
    },
  };
  const runner = makeRunner(state, descriptor);

  runner.runSolve();
  runner.runSolve();
  const idBefore = state.utilityNetworks.get('fake')[0].id;
  assert(state.utilityNetworkState.get(idBefore).reservoir === 2,
    `reservoir accumulated to 2 (got ${state.utilityNetworkState.get(idBefore)?.reservoir})`);

  // Unrelated topology change (disjoint second network) forces re-discovery.
  const l2 = makeLine('L2', 'fake', 'src2', 'out', 'dst2', 'in');
  state.utilityLines.set(l2.id, l2);
  runner.markTopologyDirty();
  runner.runSolve();

  const nets = state.utilityNetworks.get('fake');
  const same = nets.find(n => n.id === idBefore);
  assert(!!same, 'untouched network re-discovers to the identical content-hashed id');
  assert(state.utilityNetworkState.get(idBefore).reservoir === 3,
    `reservoir continued across re-discovery (got ${state.utilityNetworkState.get(idBefore)?.reservoir})`);
}

// ==========================================================================
// Test 4: gate's unconnected-sink report rides the topology revision.
// ==========================================================================
console.log('\n--- Test 4: gate unconnected-sink cache ---');
{
  const gateState = {
    tick: 0,
    placeables: [{ id: 'p1', type: 'dipole', category: 'beamline' }],
    utilityLines: new Map(),
    staffMembers: [{
      role: 'operator', status: 'working', mood: 'content',
      assignment: { zoneId: 'controlRoom' }, needs: { fatigue: 0.1 },
    }],
    utilityNetworkState: new Map(),
  };
  let portsCalls = 0;
  const getPorts = (type) => {
    portsCalls++;
    return type === 'dipole'
      ? { pwr_in: { utility: 'powerCable', role: 'sink', params: { demand: 10 } } }
      : {};
  };
  // Real SolveRunner (empty registry) so the gate sees a live topologyRevision.
  const solveRunner = new SolveRunner({
    state: gateState,
    registry: { types: {}, list: [] },
    portLookup: makeLookup({}),
  });
  const gate = new UtilityGate({ state: gateState, solveRunner, getPorts, rng: () => 0.99 });

  gate.run();
  const callsAfterFirst = portsCalls;
  assert(callsAfterFirst > 0, 'first run computes unconnected sinks');
  assert(gateState.infraBlockers.some(b => b.code === 'power_unconnected'),
    'unconnected power sink reported');

  gate.run();
  gate.run();
  assert(portsCalls === callsAfterFirst,
    `same-topology runs reuse the cached report (got ${portsCalls}, want ${callsAfterFirst})`);
  assert(gateState.infraBlockers.some(b => b.code === 'power_unconnected'),
    'cached report still surfaces the blocker each tick');

  // Connect the sink and bump the revision → recompute clears the blocker.
  gateState.utilityLines.set('L1', {
    id: 'L1', utilityType: 'powerCable',
    start: { placeableId: 'srcX', portName: 'out' },
    end:   { placeableId: 'p1', portName: 'pwr_in' },
    path: [{ col: 0, row: 0 }],
  });
  solveRunner.markTopologyDirty();
  gate.run();
  assert(portsCalls > callsAfterFirst, 'revision bump recomputes the report');
  assert(!gateState.infraBlockers.some(b => b.code === 'power_unconnected'),
    'connected sink no longer flagged after invalidation');
}
{
  // Fallback: a solveRunner without topologyRevision (test fakes) recomputes
  // every run — no caching without a revision to key on.
  const gateState = {
    tick: 0,
    placeables: [{ id: 'p1', type: 'dipole', category: 'beamline' }],
    utilityLines: new Map(),
    staffMembers: [],
  };
  let portsCalls = 0;
  const getPorts = () => { portsCalls++; return {}; };
  const gate = new UtilityGate({
    state: gateState,
    solveRunner: { runSolve: () => ({ errors: [] }) },
    getPorts,
    rng: () => 0.99,
  });
  gate.run();
  const first = portsCalls;
  gate.run();
  assert(portsCalls > first, 'revision-less solveRunner recomputes every run');
}

// ---------------------------------------------------------------------------
// 5. UtilityInspector reads the published discovery instead of redoing it.
// ---------------------------------------------------------------------------

console.log('\n--- 5. Inspector reuses state.utilityNetworks ---');
{
  const { UtilityInspector } = await import('../src/ui/UtilityInspector.js');
  const reconstruct = UtilityInspector.prototype._reconstructNetwork;

  // Cache hit: the network exists only in state.utilityNetworks (there are no
  // lines to rediscover it from), so returning it proves the cache was used.
  const cached = { id: 'net_powerCable_cached', utilityType: 'powerCable', sources: [], sinks: [] };
  const state = {
    utilityLines: new Map(),
    utilityNetworks: new Map([['powerCable', [cached]]]),
  };
  assert(reconstruct.call({}, state, 'powerCable', 'net_powerCable_cached') === cached,
    'cached network returned without re-running discovery');

  // Fallback: no cache yet (pre-first-solve) → fresh discovery still answers.
  const line = makeLine('L9', 'powerCable', 'srcA', 'out', 'sinkA', 'in');
  const fresh = { utilityLines: new Map([['L9', line]]), utilityNetworks: null };
  const lookup = makeDefaultPortLookup({ placeables: [] });
  const discovered = discoverNetworks('powerCable', fresh.utilityLines, lookup);
  assert(discovered.length === 1, 'fixture yields one network');
  const got = reconstruct.call({}, fresh, 'powerCable', discovered[0].id);
  assert(got && got.id === discovered[0].id, 'falls back to discovery when the cache is empty');

  // Stale cache (line added since the last solve) → falls back too.
  const stale = { utilityLines: fresh.utilityLines, utilityNetworks: new Map([['powerCable', []]]) };
  const gotStale = reconstruct.call({}, stale, 'powerCable', discovered[0].id);
  assert(gotStale && gotStale.id === discovered[0].id, 'falls back when the cache is stale');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
