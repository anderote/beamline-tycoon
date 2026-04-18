// test/test-utility-solve-runner.js — tests for src/utility/solve-runner.js
//
// SolveRunner iterates the registry per tick: for each utility type, discover
// networks, call descriptor.solve(network, persistentState, worldState). Writes
// state.utilityNetworkData (per-type → per-network → flow) and
// state.utilityNetworkState (per-network persistent blob). Descriptor throws
// are trapped and surfaced as errors[{severity:'hard', code:'solve_threw',...}].
//
// Tests use a fake descriptor + an injected portLookup so we don't depend on
// Phase 2/3 modules.
//
// Scenarios:
//   1. Fake descriptor returns {flowState, nextPersistentState, errors:[]} →
//      state.utilityNetworkData.get('fake').get(netId) === flowState;
//      state.utilityNetworkState.get(netId) === nextPersistentState.
//   2. First tick: persistent state pulled from descriptor.persistentStateDefaults.
//   3. Second tick: persistent state pulled from prior tick's write.
//   4. Descriptor that throws: runSolve() completes; errors[] contains
//      {severity:'hard', code:'solve_threw', ...}.
//   5. Multiple descriptors: iterates in registry.list order.
//   6. Errors returned by descriptors are aggregated into returned errors[].

import { SolveRunner } from '../src/utility/solve-runner.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixtures.
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

function makeLine(id, utilityType, aId, aPort, bId, bPort) {
  return {
    id, utilityType,
    start: { placeableId: aId, portName: aPort },
    end:   { placeableId: bId, portName: bPort },
    path:  [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    subL:  4,
  };
}

function makeState(linesArr) {
  const lines = new Map();
  for (const l of linesArr) lines.set(l.id, l);
  return {
    utilityLines: lines,
    utilityNetworkState: new Map(),
  };
}

// A minimal single-source/single-sink fake powerCable topology.
const FAKE_SPECS = {
  src: { out: { utility: 'fake', side: 'right', role: 'source', params: { capacity: 100 } } },
  dst: { in:  { utility: 'fake', side: 'left',  role: 'sink',   params: { demand:  50 } } },
};

// ==========================================================================
// Test 1: happy path — flowState and nextPersistentState stored.
// ==========================================================================
console.log('\n--- Test 1: happy path writes flow + persistent state ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const calls = [];
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: { reservoir: 0 },
    solve(network, persistent, worldState) {
      calls.push({ networkId: network.id, persistent, worldState });
      return {
        flowState: { delivered: 42 },
        nextPersistentState: { reservoir: 7 },
        errors: [],
      };
    },
  };
  const registry = { types: { fake: descriptor }, list: ['fake'] };
  const runner = new SolveRunner({
    state, registry, portLookup: makeLookup(FAKE_SPECS),
  });

  const result = runner.runSolve({ dt: 0.016 });
  assert(Array.isArray(result.errors) && result.errors.length === 0,
    `no errors (got ${JSON.stringify(result.errors)})`);
  assert(state.utilityNetworkData instanceof Map, 'utilityNetworkData is a Map');
  const perType = state.utilityNetworkData.get('fake');
  assert(perType instanceof Map, 'per-type map exists');
  assert(perType.size === 1, `1 network (got ${perType.size})`);
  const [networkId] = Array.from(perType.keys());
  const flow = perType.get(networkId);
  assert(flow && flow.delivered === 42, `flow.delivered=42 (got ${JSON.stringify(flow)})`);
  const persisted = state.utilityNetworkState.get(networkId);
  assert(persisted && persisted.reservoir === 7, `persisted.reservoir=7 (got ${JSON.stringify(persisted)})`);
  assert(calls.length === 1, '1 solve call');
  assert(calls[0].worldState && calls[0].worldState.dt === 0.016, 'worldState passed through');
}

// ==========================================================================
// Test 2: first tick pulls persistent defaults (deep copy, not aliased).
// ==========================================================================
console.log('\n--- Test 2: first tick uses descriptor defaults ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const defaults = { reservoir: 1000, cumulativeHeat: 0 };
  const seen = [];
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: defaults,
    solve(network, persistent) {
      seen.push(persistent);
      // Don't mutate → verify pass-through.
      return { flowState: {}, nextPersistentState: persistent, errors: [] };
    },
  };
  const registry = { types: { fake: descriptor }, list: ['fake'] };
  const runner = new SolveRunner({
    state, registry, portLookup: makeLookup(FAKE_SPECS),
  });
  runner.runSolve();

  assert(seen.length === 1, '1 solve');
  assert(seen[0].reservoir === 1000, `reservoir=1000 (got ${seen[0].reservoir})`);
  // Must be a COPY — mutating defaults post-tick must not affect downstream
  // reads. Verify by mutating the default blob and re-running:
  defaults.reservoir = -999;
  const seen2 = [];
  descriptor.solve = (network, persistent) => {
    seen2.push(persistent);
    return { flowState: {}, nextPersistentState: persistent, errors: [] };
  };
  // Reset state so the next runSolve pulls defaults again (simulate new net).
  state.utilityNetworkState = new Map();
  runner.runSolve();
  assert(seen2[0].reservoir === -999,
    `second run sees fresh copy of mutated default (got ${seen2[0].reservoir})`);
}

// ==========================================================================
// Test 3: second tick pulls the prior tick's write.
// ==========================================================================
console.log('\n--- Test 3: second tick uses prior tick persistent ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const seen = [];
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: { tick: 0 },
    solve(network, persistent) {
      seen.push(persistent.tick);
      return {
        flowState: {},
        nextPersistentState: { tick: persistent.tick + 1 },
        errors: [],
      };
    },
  };
  const registry = { types: { fake: descriptor }, list: ['fake'] };
  const runner = new SolveRunner({
    state, registry, portLookup: makeLookup(FAKE_SPECS),
  });

  runner.runSolve();
  runner.runSolve();
  runner.runSolve();

  assert(seen.length === 3, `3 ticks (got ${seen.length})`);
  assert(seen[0] === 0, `tick0 saw 0 (got ${seen[0]})`);
  assert(seen[1] === 1, `tick1 saw 1 (got ${seen[1]})`);
  assert(seen[2] === 2, `tick2 saw 2 (got ${seen[2]})`);
}

// ==========================================================================
// Test 4: descriptor that throws → run completes, error emitted.
// ==========================================================================
console.log('\n--- Test 4: descriptor throws ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: {},
    solve() { throw new Error('boom'); },
  };
  const registry = { types: { fake: descriptor }, list: ['fake'] };
  const runner = new SolveRunner({
    state, registry, portLookup: makeLookup(FAKE_SPECS),
  });

  const result = runner.runSolve();
  assert(Array.isArray(result.errors) && result.errors.length === 1,
    `1 error (got ${result.errors.length})`);
  const err = result.errors[0];
  assert(err.severity === 'hard', `severity=hard (got ${err.severity})`);
  assert(err.code === 'solve_threw', `code=solve_threw (got ${err.code})`);
  assert(typeof err.message === 'string' && err.message.includes('boom'),
    `message includes 'boom' (got ${err.message})`);
  assert(err.location && typeof err.location.networkId === 'string',
    'error carries networkId');
}

// ==========================================================================
// Test 5: multiple descriptors iterate in registry.list order.
// ==========================================================================
console.log('\n--- Test 5: multiple descriptors in list order ---');
{
  const specs = {
    ...FAKE_SPECS,
    src2: { out: { utility: 'other', side: 'right', role: 'source', params: { capacity: 10 } } },
    dst2: { in:  { utility: 'other', side: 'left',  role: 'sink',   params: { demand:   5 } } },
  };
  const state = makeState([
    makeLine('Lf', 'fake',  'src',  'out', 'dst',  'in'),
    makeLine('Lo', 'other', 'src2', 'out', 'dst2', 'in'),
  ]);
  const order = [];
  const descFake = {
    type: 'fake',
    persistentStateDefaults: {},
    solve(n) { order.push('fake'); return { flowState: {f:1}, nextPersistentState: {}, errors: [] }; },
  };
  const descOther = {
    type: 'other',
    persistentStateDefaults: {},
    solve(n) { order.push('other'); return { flowState: {o:1}, nextPersistentState: {}, errors: [] }; },
  };
  const registry = {
    types: { fake: descFake, other: descOther },
    list: ['fake', 'other'],
  };
  const runner = new SolveRunner({ state, registry, portLookup: makeLookup(specs) });
  runner.runSolve();
  assert(order.length === 2, `2 calls (got ${order.length})`);
  assert(order[0] === 'fake' && order[1] === 'other',
    `list-order preserved (got ${order.join(',')})`);
  assert(state.utilityNetworkData.get('fake').size === 1, 'fake data stored');
  assert(state.utilityNetworkData.get('other').size === 1, 'other data stored');

  // Reverse registry.list order and re-run → order flips.
  order.length = 0;
  const registry2 = {
    types: { fake: descFake, other: descOther },
    list: ['other', 'fake'],
  };
  const runner2 = new SolveRunner({ state, registry: registry2, portLookup: makeLookup(specs) });
  runner2.runSolve();
  assert(order[0] === 'other' && order[1] === 'fake',
    `reversed order (got ${order.join(',')})`);
}

// ==========================================================================
// Test 6: descriptor-returned errors are aggregated.
// ==========================================================================
console.log('\n--- Test 6: aggregated descriptor errors ---');
{
  const state = makeState([ makeLine('L1', 'fake', 'src', 'out', 'dst', 'in') ]);
  const descriptor = {
    type: 'fake',
    persistentStateDefaults: {},
    solve(network) {
      return {
        flowState: {},
        nextPersistentState: {},
        errors: [
          { severity: 'soft', code: 'over_demand', message: 'too much' },
          { severity: 'hard', code: 'no_supply',   message: 'no source' },
        ],
      };
    },
  };
  const registry = { types: { fake: descriptor }, list: ['fake'] };
  const runner = new SolveRunner({
    state, registry, portLookup: makeLookup(FAKE_SPECS),
  });

  const result = runner.runSolve();
  assert(result.errors.length === 2, `2 errors (got ${result.errors.length})`);
  const codes = result.errors.map(e => e.code).sort();
  assert(codes[0] === 'no_supply' && codes[1] === 'over_demand',
    `codes preserved (got ${codes.join(',')})`);
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
