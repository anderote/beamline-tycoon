// test/test-flattener.js — tests for src/beamline/flattener.js
//
// Cycle-aware pipe-graph walker. Tests:
//   1. Source → pipe → endpoint (linear)
//   2. Source → pipe → (open end)
//   3. Source → pipe(placements=[buncher, bpm]) → endpoint
//   4. Ring: injection septum + 4 dipoles, walk returns to septum
//   5. Multi-port routing: splitter picks first fraction:1.0 entry
//
// Tests construct state objects directly; they do not instantiate Game.
import { flattenPath } from '../src/beamline/flattener.js';
import { COMPONENTS } from '../src/data/components.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Helper: make a placeable stub. Only the fields the flattener reads are needed.
function placeable(id, type, extra = {}) {
  return {
    id,
    type,
    category: 'beamline',
    col: 0, row: 0, dir: 0,
    params: {},
    cells: [],
    ...extra,
  };
}

// Helper: make a pipe with the new shape.
function makePipe(id, start, end, path, subL, placements = []) {
  return { id, start, end, path, subL, placements };
}

// ==========================================================================
// Test 1: Linear source → pipe → endpoint
// ==========================================================================
console.log('\n--- Test 1: Linear source → pipe → endpoint ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source', { col: 2, row: 2 }),
      placeable('end_1', 'faradayCup', { col: 2, row: 14 }),
    ],
    beamPipes: [
      makePipe('bp_1',
        { junctionId: 'src_1', portName: 'exit' },
        { junctionId: 'end_1', portName: 'entry' },
        [{ col: 2, row: 4 }, { col: 2, row: 12 }],
        32, []),
    ],
  };

  const flat = flattenPath(state, 'src_1');

  assert(flat.length === 3, `linear: 3 entries (got ${flat.length})`);
  assert(flat[0].kind === 'module' && flat[0].id === 'src_1', 'linear: [0] module source');
  assert(flat[1].kind === 'drift' && flat[1].pipeId === 'bp_1', 'linear: [1] drift in bp_1');
  assert(flat[2].kind === 'module' && flat[2].id === 'end_1', 'linear: [2] module endpoint');

  // Physics contract: beamStart of entry i == sum(prev subL) * 0.5
  let acc = 0;
  for (let i = 0; i < flat.length; i++) {
    assert(Math.abs(flat[i].beamStart - acc) < 1e-9,
      `linear: [${i}] beamStart=${flat[i].beamStart} matches accumulator ${acc}`);
    acc += flat[i].subL * 0.5;
  }

  // Drift subL equals pipe subL (no placements inside).
  assert(flat[1].subL === 32, `linear: drift subL === 32 (got ${flat[1].subL})`);
}

// ==========================================================================
// Test 2: Source → pipe → (open end) — stop at open end
// ==========================================================================
console.log('\n--- Test 2: Source → pipe → (open end) ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source'),
    ],
    beamPipes: [
      makePipe('bp_1',
        { junctionId: 'src_1', portName: 'exit' },
        null,
        [{ col: 2, row: 4 }, { col: 2, row: 12 }],
        32, []),
    ],
  };

  const flat = flattenPath(state, 'src_1');

  assert(flat.length === 2, `open-end: 2 entries (got ${flat.length})`);
  assert(flat[0].kind === 'module' && flat[0].id === 'src_1', 'open-end: [0] source');
  assert(flat[1].kind === 'drift' && flat[1].pipeId === 'bp_1', 'open-end: [1] trailing drift');
  assert(flat[1].subL === 32, `open-end: drift subL === 32 (got ${flat[1].subL})`);
}

// ==========================================================================
// Test 3: Source → pipe(placements=[buncher, bpm]) → endpoint
// ==========================================================================
console.log('\n--- Test 3: Placements emit drift/placement/drift ---');
{
  // buncher subL=2 per COMPONENTS. bpm subL=1 (but we pass explicit subL on placement).
  const state = {
    placeables: [
      placeable('src_1', 'source'),
      placeable('end_1', 'faradayCup'),
    ],
    beamPipes: [
      makePipe('bp_1',
        { junctionId: 'src_1', portName: 'exit' },
        { junctionId: 'end_1', portName: 'entry' },
        [{ col: 2, row: 4 }, { col: 2, row: 20 }],
        32,
        [
          { id: 'pl_1', type: 'buncher', position: 0.25, subL: 2, params: {} },
          { id: 'pl_2', type: 'bpm',     position: 0.75, subL: 1, params: {} },
        ]),
    ],
  };

  const flat = flattenPath(state, 'src_1');

  // Expected: module(src), drift, placement(buncher), drift, placement(bpm), drift, module(end)
  assert(flat.length === 7, `placements: 7 entries (got ${flat.length})`);
  assert(flat[0].kind === 'module' && flat[0].id === 'src_1', 'placements: [0] source');
  assert(flat[1].kind === 'drift', 'placements: [1] drift');
  assert(flat[2].kind === 'placement' && flat[2].id === 'pl_1', 'placements: [2] buncher placement');
  assert(flat[3].kind === 'drift', 'placements: [3] drift');
  assert(flat[4].kind === 'placement' && flat[4].id === 'pl_2', 'placements: [4] bpm placement');
  assert(flat[5].kind === 'drift', 'placements: [5] drift');
  assert(flat[6].kind === 'module' && flat[6].id === 'end_1', 'placements: [6] endpoint');

  // Sorted by position: buncher (0.25) first, bpm (0.75) second.
  assert(flat[2].beamStart < flat[4].beamStart, 'placements: sorted by position');

  // Physics contract cumulative check.
  let acc = 0;
  for (let i = 0; i < flat.length; i++) {
    assert(Math.abs(flat[i].beamStart - acc) < 1e-6,
      `placements: [${i}] beamStart=${flat[i].beamStart.toFixed(3)} matches acc=${acc.toFixed(3)}`);
    acc += flat[i].subL * 0.5;
  }

  // Sum of drift + placement subL entries inside the pipe equals pipe subL.
  const inPipe = flat.filter(e => e.pipeId === 'bp_1' || (e.kind === 'placement' && flat.indexOf(e) > 0 && flat.indexOf(e) < flat.length - 1));
  const pipeSubLSum = flat.slice(1, 6).reduce((s, e) => s + e.subL, 0);
  assert(pipeSubLSum === 32, `placements: pipe internal subL sum === 32 (got ${pipeSubLSum})`);
}

// ==========================================================================
// Test 4: Ring — injection septum + 4 dipoles, walk cycles and stops.
// ==========================================================================
console.log('\n--- Test 4: Ring with injection septum + 4 dipoles ---');
{
  // Ring layout (schematic):
  //   src --pipe_linac--> septum --pipe_r1--> d1 --pipe_r2--> d2
  //                         ^                                   |
  //                         |                                  pipe_r3
  //                       pipe_r5                               v
  //                         |                                   d3
  //                         +----pipe_r4---- d4 <--pipe_r3'---- (via d3 exit)
  //
  // We encode this as: septum.ringExit -> d1.entry (pipe_r1)
  //                    d1.exit         -> d2.entry (pipe_r2)
  //                    d2.exit         -> d3.entry (pipe_r3)
  //                    d3.exit         -> d4.entry (pipe_r4)
  //                    d4.exit         -> septum.ringEntry (pipe_r5)
  //                    src.exit        -> septum.linacEntry (pipe_linac)
  const state = {
    placeables: [
      placeable('src_1',  'source'),
      placeable('sep_1',  'injectionSeptum'),
      placeable('d1',     'dipole'),
      placeable('d2',     'dipole'),
      placeable('d3',     'dipole'),
      placeable('d4',     'dipole'),
    ],
    beamPipes: [
      makePipe('pipe_linac',
        { junctionId: 'src_1', portName: 'exit' },
        { junctionId: 'sep_1', portName: 'linacEntry' },
        [{ col: 2, row: 4 }, { col: 2, row: 10 }], 12, []),
      makePipe('pipe_r1',
        { junctionId: 'sep_1', portName: 'ringExit' },
        { junctionId: 'd1',    portName: 'entry' },
        [{ col: 4, row: 10 }, { col: 12, row: 10 }], 16, []),
      makePipe('pipe_r2',
        { junctionId: 'd1',    portName: 'exit' },
        { junctionId: 'd2',    portName: 'entry' },
        [{ col: 12, row: 10 }, { col: 12, row: 18 }], 16, []),
      makePipe('pipe_r3',
        { junctionId: 'd2',    portName: 'exit' },
        { junctionId: 'd3',    portName: 'entry' },
        [{ col: 12, row: 18 }, { col: 4, row: 18 }], 16, []),
      makePipe('pipe_r4',
        { junctionId: 'd3',    portName: 'exit' },
        { junctionId: 'd4',    portName: 'entry' },
        [{ col: 4, row: 18 }, { col: 4, row: 12 }], 12, []),
      makePipe('pipe_r5',
        { junctionId: 'd4',    portName: 'exit' },
        { junctionId: 'sep_1', portName: 'ringEntry' },
        [{ col: 4, row: 12 }, { col: 4, row: 10 }], 4, []),
    ],
  };

  const flat = flattenPath(state, 'src_1');

  // Modules in order: src, sep, d1, d2, d3, d4, sep (second visit) then stop.
  const modules = flat.filter(e => e.kind === 'module').map(e => e.id);
  assert(modules.length === 7, `ring: 7 module entries (got ${modules.length}: [${modules.join(',')}])`);
  assert(modules[0] === 'src_1', 'ring: [0] src_1');
  assert(modules[1] === 'sep_1', 'ring: [1] sep_1 (first visit via linacEntry)');
  assert(modules[2] === 'd1',    'ring: [2] d1');
  assert(modules[3] === 'd2',    'ring: [3] d2');
  assert(modules[4] === 'd3',    'ring: [4] d3');
  assert(modules[5] === 'd4',    'ring: [5] d4');
  assert(modules[6] === 'sep_1', 'ring: [6] sep_1 (second visit via ringEntry — cycle exit)');

  // Drift count: 6 pipes, each contributes exactly one drift (no placements).
  const drifts = flat.filter(e => e.kind === 'drift');
  assert(drifts.length === 6, `ring: 6 drifts (got ${drifts.length})`);
  const driftPipeIds = drifts.map(d => d.pipeId);
  assert(driftPipeIds[0] === 'pipe_linac', 'ring: drift[0] pipe_linac');
  assert(driftPipeIds[1] === 'pipe_r1', 'ring: drift[1] pipe_r1');
  assert(driftPipeIds[5] === 'pipe_r5', 'ring: drift[5] pipe_r5');
}

// ==========================================================================
// Test 5: Multi-port routing — splitter picks first fraction:1.0 entry.
// ==========================================================================
console.log('\n--- Test 5: Splitter routing picks first fraction:1.0 ---');
{
  // We synthesize a splitter stub junction at runtime since no splitter exists
  // in COMPONENTS yet. The flattener looks up routing via COMPONENTS[type].
  // To avoid mutating COMPONENTS, we use a test-only type name.
  const SPLITTER_TYPE = '__test_splitter__';
  const prev = COMPONENTS[SPLITTER_TYPE];
  COMPONENTS[SPLITTER_TYPE] = {
    id: SPLITTER_TYPE,
    placement: 'module',
    role: 'junction',
    subL: 2,
    ports: {
      entry:  { side: 'back' },
      exitA:  { side: 'front' },
      exitB:  { side: 'left' },
    },
    routing: [
      { from: 'entry', to: 'exitA', fraction: 0.3 },
      { from: 'entry', to: 'exitB', fraction: 1.0 },
    ],
  };

  try {
    const state = {
      placeables: [
        placeable('src_1', 'source'),
        placeable('sp_1',  SPLITTER_TYPE),
        placeable('endA',  'faradayCup'),
        placeable('endB',  'faradayCup'),
      ],
      beamPipes: [
        makePipe('bp_in',
          { junctionId: 'src_1', portName: 'exit' },
          { junctionId: 'sp_1',  portName: 'entry' },
          [{ col: 2, row: 4 }, { col: 2, row: 10 }], 12, []),
        makePipe('bp_a',
          { junctionId: 'sp_1', portName: 'exitA' },
          { junctionId: 'endA', portName: 'entry' },
          [{ col: 2, row: 12 }, { col: 10, row: 12 }], 16, []),
        makePipe('bp_b',
          { junctionId: 'sp_1', portName: 'exitB' },
          { junctionId: 'endB', portName: 'entry' },
          [{ col: 0, row: 12 }, { col: 0, row: 20 }], 16, []),
      ],
    };

    const flat = flattenPath(state, 'src_1');
    const modules = flat.filter(e => e.kind === 'module').map(e => e.id);
    assert(modules.length === 3, `splitter: 3 modules (got ${modules.length}: [${modules.join(',')}])`);
    assert(modules[0] === 'src_1', 'splitter: [0] src_1');
    assert(modules[1] === 'sp_1',  'splitter: [1] sp_1');
    assert(modules[2] === 'endB',  'splitter: [2] endB (fraction=1.0 wins)');

    // bp_a should NOT appear in the trail.
    const pipeIds = flat.filter(e => e.pipeId).map(e => e.pipeId);
    assert(!pipeIds.includes('bp_a'), 'splitter: bp_a (non-dominant branch) not walked');
    assert(pipeIds.includes('bp_b'), 'splitter: bp_b (dominant branch) walked');
  } finally {
    if (prev === undefined) delete COMPONENTS[SPLITTER_TYPE];
    else COMPONENTS[SPLITTER_TYPE] = prev;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
