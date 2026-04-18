// test/test-utility-network-discovery.js — tests for src/utility/network-discovery.js
//
// discoverNetworks(utilityType, lines, portLookup) runs union-find over
// port keys (`${placeableId}:${portName}`) to compute connected-component
// networks. Network IDs are deterministic FNV-1a hashes of sorted port-key
// lists.
//
// Tests inject a trivial portLookup built from a fixture map so we don't need
// the real COMPONENTS registry or Phase 3 utility-port fields.
//
// Test scenarios:
//   1. Empty lines → empty networks array.
//   2. One line source→sink → single network, 2 ports, 1 source, 1 sink.
//   3. Two disjoint lines → two separate networks.
//   4. Chain A→B, B→C, C→D via pass-through ports on B and C → one network.
//   5. Branch: s1→a, s1→b → one network, 3 ports, 1 source, 2 sinks.
//   6. Mixed utility types filter: only matching utilityType contributes.
//   7. Stable IDs: same topology → same id across invocations.
//   8. Merge: adding a bridging line unites previously-disjoint networks;
//      the unified network's id matches a from-scratch run on the combined input.

import {
  discoverNetworks,
  discoverAll,
} from '../src/utility/network-discovery.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixtures: trivial portLookup built from a Map<placeableId, {type, ports:{name→spec}}>.
// ---------------------------------------------------------------------------

function makeLookup(placeableSpecs) {
  // placeableSpecs: { [placeableId]: { [portName]: PortSpec } }
  const lookup = function (placeableId, portName) {
    const entry = placeableSpecs[placeableId];
    if (!entry) return null;
    return entry[portName] || null;
  };
  lookup.listPorts = function (placeableId) {
    const entry = placeableSpecs[placeableId];
    if (!entry) return [];
    return Object.entries(entry).map(([name, spec]) => ({ name, spec }));
  };
  return lookup;
}

function makeLine(id, utilityType, start, end, path) {
  // Default path uses a row derived from the id so every call gets a
  // distinct path and the spatial-union discovery pass doesn't merge tests
  // that expect disjoint networks. Pass `path` to override.
  const rowSeed = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0) % 100;
  return {
    id,
    utilityType,
    start,
    end,
    path: path || [{ col: 0, row: rowSeed }, { col: 1, row: rowSeed }],
    subL: 4,
  };
}

// ==========================================================================
// Test 1: Empty lines → empty networks array.
// ==========================================================================
console.log('\n--- Test 1: empty lines → empty networks ---');
{
  const lookup = makeLookup({});
  const nets = discoverNetworks('powerCable', [], lookup);
  assert(Array.isArray(nets), 'returns an array');
  assert(nets.length === 0, `empty (got ${nets.length})`);
}

// ==========================================================================
// Test 2: Single line source→sink.
// ==========================================================================
console.log('\n--- Test 2: one line source→sink ---');
{
  const lookup = makeLookup({
    src1: {
      out: { utility: 'powerCable', side: 'right', role: 'source',
             params: { capacity: 100 } },
    },
    sink1: {
      in: { utility: 'powerCable', side: 'left', role: 'sink',
            params: { demand: 50 } },
    },
  });
  const lines = [
    makeLine('ul_1', 'powerCable',
      { placeableId: 'src1', portName: 'out' },
      { placeableId: 'sink1', portName: 'in' }),
  ];
  const nets = discoverNetworks('powerCable', lines, lookup);
  assert(nets.length === 1, `one network (got ${nets.length})`);
  const net = nets[0];
  assert(net.utilityType === 'powerCable', 'utilityType stored');
  assert(Array.isArray(net.lineIds) && net.lineIds.length === 1, 'one lineId');
  assert(net.lineIds[0] === 'ul_1', `lineId ul_1 (got ${net.lineIds[0]})`);
  assert(net.ports.length === 2, `2 ports (got ${net.ports.length})`);
  assert(net.sources.length === 1, `1 source (got ${net.sources.length})`);
  assert(net.sinks.length === 1, `1 sink (got ${net.sinks.length})`);
  assert(net.sources[0].capacity === 100, `source capacity=100 (got ${net.sources[0].capacity})`);
  assert(net.sinks[0].demand === 50, `sink demand=50 (got ${net.sinks[0].demand})`);
  assert(typeof net.id === 'string' && net.id.startsWith('net_powerCable_'),
    `id prefixed (got ${net.id})`);
}

// ==========================================================================
// Test 3: Two disjoint lines → two networks.
// ==========================================================================
console.log('\n--- Test 3: two disjoint lines → two networks ---');
{
  const lookup = makeLookup({
    a: { o: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 10 } } },
    b: { i: { utility: 'powerCable', side: 'left',  role: 'sink',   params: { demand:   5 } } },
    c: { o: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 20 } } },
    d: { i: { utility: 'powerCable', side: 'left',  role: 'sink',   params: { demand:  15 } } },
  });
  const lines = [
    makeLine('L1', 'powerCable',
      { placeableId: 'a', portName: 'o' },
      { placeableId: 'b', portName: 'i' }),
    makeLine('L2', 'powerCable',
      { placeableId: 'c', portName: 'o' },
      { placeableId: 'd', portName: 'i' }),
  ];
  const nets = discoverNetworks('powerCable', lines, lookup);
  assert(nets.length === 2, `two networks (got ${nets.length})`);
  // Each should have exactly one line, 2 ports.
  for (const n of nets) {
    assert(n.lineIds.length === 1, `one line per net (got ${n.lineIds.length})`);
    assert(n.ports.length === 2, `two ports per net (got ${n.ports.length})`);
  }
  // Each net id should differ.
  assert(nets[0].id !== nets[1].id, `distinct ids (got ${nets[0].id}, ${nets[1].id})`);
}

// ==========================================================================
// Test 4: Chain A→B, B→C, C→D via pass-through ports → one network.
// ==========================================================================
console.log('\n--- Test 4: chain a→b→c→d, pass-through ports ---');
{
  const lookup = makeLookup({
    a: { o: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 100 } } },
    b: {
      bi: { utility: 'powerCable', side: 'left',  role: 'pass' },
      bo: { utility: 'powerCable', side: 'right', role: 'pass' },
    },
    c: {
      ci: { utility: 'powerCable', side: 'left',  role: 'pass' },
      co: { utility: 'powerCable', side: 'right', role: 'pass' },
    },
    d: { i: { utility: 'powerCable', side: 'left', role: 'sink', params: { demand: 70 } } },
  });
  const lines = [
    makeLine('L1', 'powerCable',
      { placeableId: 'a', portName: 'o'  },
      { placeableId: 'b', portName: 'bi' }),
    makeLine('L2', 'powerCable',
      { placeableId: 'b', portName: 'bo' },
      { placeableId: 'c', portName: 'ci' }),
    makeLine('L3', 'powerCable',
      { placeableId: 'c', portName: 'co' },
      { placeableId: 'd', portName: 'i'  }),
  ];
  const nets = discoverNetworks('powerCable', lines, lookup);
  assert(nets.length === 1, `one network (got ${nets.length})`);
  const net = nets[0];
  assert(net.ports.length === 6, `6 ports (got ${net.ports.length})`);
  assert(net.lineIds.length === 3, `3 lines (got ${net.lineIds.length})`);
  assert(net.sources.length === 1, `1 source (got ${net.sources.length})`);
  assert(net.sinks.length === 1, `1 sink (got ${net.sinks.length})`);
}

// ==========================================================================
// Test 5: Branch from a single source port → one network, 3 ports, 2 sinks.
// ==========================================================================
console.log('\n--- Test 5: branch s1→a, s1→b ---');
{
  const lookup = makeLookup({
    s1: { out: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 200 } } },
    a:  { i:   { utility: 'powerCable', side: 'left',  role: 'sink',   params: { demand:  30 } } },
    b:  { i:   { utility: 'powerCable', side: 'left',  role: 'sink',   params: { demand:  40 } } },
  });
  const lines = [
    makeLine('L1', 'powerCable',
      { placeableId: 's1', portName: 'out' },
      { placeableId: 'a',  portName: 'i'   }),
    makeLine('L2', 'powerCable',
      { placeableId: 's1', portName: 'out' },
      { placeableId: 'b',  portName: 'i'   }),
  ];
  const nets = discoverNetworks('powerCable', lines, lookup);
  assert(nets.length === 1, `one network (got ${nets.length})`);
  const net = nets[0];
  assert(net.ports.length === 3, `3 ports (got ${net.ports.length})`);
  assert(net.sources.length === 1, `1 source (got ${net.sources.length})`);
  assert(net.sinks.length === 2, `2 sinks (got ${net.sinks.length})`);
  assert(net.lineIds.length === 2, `2 lines (got ${net.lineIds.length})`);
}

// ==========================================================================
// Test 6: Filter by utility type.
// ==========================================================================
console.log('\n--- Test 6: filter by utility type ---');
{
  const lookup = makeLookup({
    a: {
      pOut: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 100 } },
      dOut: { utility: 'dataCable',  side: 'back',  role: 'source', params: { frequency: 1 } },
    },
    b: {
      pIn: { utility: 'powerCable', side: 'left', role: 'sink', params: { demand: 50 } },
      dIn: { utility: 'dataCable',  side: 'front', role: 'sink', params: { frequency: 1 } },
    },
  });
  const lines = [
    makeLine('Lp', 'powerCable',
      { placeableId: 'a', portName: 'pOut' },
      { placeableId: 'b', portName: 'pIn'  }),
    makeLine('Ld', 'dataCable',
      { placeableId: 'a', portName: 'dOut' },
      { placeableId: 'b', portName: 'dIn'  }),
  ];
  const powerNets = discoverNetworks('powerCable', lines, lookup);
  assert(powerNets.length === 1, `one powerCable network (got ${powerNets.length})`);
  assert(powerNets[0].lineIds.length === 1, `1 power line (got ${powerNets[0].lineIds.length})`);
  assert(powerNets[0].lineIds[0] === 'Lp', `powerCable line is Lp (got ${powerNets[0].lineIds[0]})`);
  const dataNets = discoverNetworks('dataCable', lines, lookup);
  assert(dataNets.length === 1, `one dataCable network (got ${dataNets.length})`);
  assert(dataNets[0].lineIds[0] === 'Ld', `dataCable line is Ld (got ${dataNets[0].lineIds[0]})`);

  // discoverAll returns a Map from utilityType to array.
  const all = discoverAll(lines, lookup, ['powerCable', 'dataCable']);
  assert(all instanceof Map, 'discoverAll returns Map');
  assert(all.get('powerCable').length === 1, 'discoverAll powerCable=1');
  assert(all.get('dataCable').length === 1, 'discoverAll dataCable=1');
}

// ==========================================================================
// Test 7: Stable IDs — same topology ⇒ same id across calls.
// ==========================================================================
console.log('\n--- Test 7: stable ids ---');
{
  const lookup = makeLookup({
    a: { o: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 5 } } },
    b: { i: { utility: 'powerCable', side: 'left',  role: 'sink',   params: { demand:   5 } } },
  });
  const lines = [
    makeLine('L1', 'powerCable',
      { placeableId: 'a', portName: 'o' },
      { placeableId: 'b', portName: 'i' }),
  ];
  const n1 = discoverNetworks('powerCable', lines, lookup);
  const n2 = discoverNetworks('powerCable', lines, lookup);
  assert(n1[0].id === n2[0].id, `stable id across calls (got ${n1[0].id} vs ${n2[0].id})`);

  // Swapping line order should not change id either (same port-key set).
  const lines2 = [
    // Same line but with start/end swapped — port-key set is identical.
    makeLine('L1', 'powerCable',
      { placeableId: 'b', portName: 'i' },
      { placeableId: 'a', portName: 'o' }),
  ];
  const n3 = discoverNetworks('powerCable', lines2, lookup);
  assert(n1[0].id === n3[0].id, `id stable across endpoint ordering (got ${n1[0].id} vs ${n3[0].id})`);
}

// ==========================================================================
// Test 8: Merge — bridging line unites previously-disjoint nets.
// ==========================================================================
console.log('\n--- Test 8: merge via bridge line ---');
{
  const lookup = makeLookup({
    a: { o: { utility: 'powerCable', side: 'right', role: 'source', params: { capacity: 10 } } },
    b: {
      bi: { utility: 'powerCable', side: 'left',  role: 'pass' },
      bo: { utility: 'powerCable', side: 'right', role: 'pass' },
    },
    c: { i: { utility: 'powerCable', side: 'left',  role: 'sink',   params: { demand: 5 } } },
  });
  const linesDisjoint = [
    makeLine('L1', 'powerCable',
      { placeableId: 'a', portName: 'o' },
      { placeableId: 'b', portName: 'bi' }),
    // L2 dangles on b.bo's side to a fourth placeable we don't connect.
  ];
  const linesBridged = [
    makeLine('L1', 'powerCable',
      { placeableId: 'a', portName: 'o' },
      { placeableId: 'b', portName: 'bi' }),
    makeLine('L2', 'powerCable',
      { placeableId: 'b', portName: 'bo' },
      { placeableId: 'c', portName: 'i' }),
  ];
  const before = discoverNetworks('powerCable', linesDisjoint, lookup);
  const after = discoverNetworks('powerCable', linesBridged, lookup);
  assert(before.length === 1, `before: 1 net (got ${before.length})`);
  assert(after.length === 1, `after: 1 net (got ${after.length})`);
  // Pass-through ports on `b` (bi+bo) are auto-united once either is touched,
  // so the before-network already contains 3 port keys {a:o, b:bi, b:bo}.
  assert(before[0].ports.length === 3, `before: 3 ports (got ${before[0].ports.length})`);
  // After: all 4 port keys (a:o, b:bi, b:bo, c:i) are present.
  assert(after[0].ports.length === 4, `after: 4 ports (got ${after[0].ports.length})`);
  // Id should change because port-key set grew.
  assert(before[0].id !== after[0].id, `id changed after merge (got ${before[0].id} vs ${after[0].id})`);

  // Recompute after[0].id from the combined port-key set by running a second
  // time; must match (determinism already covered in test 7, this is the
  // "merge produces the expected id" check).
  const afterAgain = discoverNetworks('powerCable', linesBridged, lookup);
  assert(after[0].id === afterAgain[0].id, 'merged id is deterministic');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
