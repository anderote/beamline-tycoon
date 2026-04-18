// test/test-utility-line-drawing.js — tests for src/utility/line-drawing.js
//
// Pure validator for drawing a utility line between two ports. The state
// consumed here is minimal and hand-rolled:
//   state.placeables: Array of placeables with { id, type, col, row, dir, ... }
//   state.utilityLines: Map<id, line> (or iterable) with existing lines.
//   state.defs: optional Map<type, def> — test injector for component defs.
//     (production code consults COMPONENTS via ports.js wrappers; for the
//      validator we inject defs directly via state.defs so tests stay isolated
//      from src/data/components.js.)
//
// Expected reason codes: invalid_path, not_manhattan, overlap_same_type,
// invalid_start, invalid_end, port_type_mismatch, port_taken,
// port_mismatch_start, port_mismatch_end.

import { validateDrawLine } from '../src/utility/line-drawing.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixtures: two fake defs, "source_rack" (powerOut on right=E) and
// "sink_rack"  (powerIn on left=W), each 2x2.
// ---------------------------------------------------------------------------

const SRC_DEF = {
  subL: 2, subW: 2,
  ports: {
    powerOut: { side: 'right', utility: 'powerCable' },
    dataOut:  { side: 'back',  utility: 'dataCable'  },
  },
};

const SINK_DEF = {
  subL: 2, subW: 2,
  ports: {
    powerIn: { side: 'left', utility: 'powerCable' },
  },
};

function placeable(id, type, col, row, dir = 0) {
  return {
    id, type,
    category: 'beamline',
    col, row, subCol: 0, subRow: 0, dir,
  };
}

function makeState({ placeables = [], lines = [], defs } = {}) {
  const defMap = defs || { source_rack: SRC_DEF, sink_rack: SINK_DEF };
  const linesMap = new Map();
  let i = 1;
  for (const l of lines) {
    const id = l.id || `ul_${i++}`;
    linesMap.set(id, { id, ...l });
  }
  return {
    placeables,
    utilityLines: linesMap,
    defs: defMap,
  };
}

// ==========================================================================
// Test 1: Valid L-shaped path from source's powerOut (E) to sink's powerIn (W).
// Source at (2,3), Sink at (8,7). Port positions are on the east edge of
// source, west edge of sink — a +col start segment and a +col final segment.
// To make a REAL L we put them off-axis: Source(2,3) powerOut faces east
// (first seg must be +col), Sink(8,7) powerIn faces west (last seg must be
// +col). Default horizontal-first from (2,3) to (8,7) gives path:
//   (2,3) → (8,3) → (8,7). First seg +col (OK for source east port).
//   Last seg +row (FAIL — sink's west port needs +col approach).
// So we hand-build a path that ends with a +col segment:
//   (2,3) → (2,7) → (8,7). First seg +row → FAILS source east port.
// A valid path must start +col AND end +col:
//   (2,3) → (5,3) → (5,7) → (8,7) — first +col, middle +row, last +col: L+L.
// ==========================================================================
console.log('\n--- Test 1: valid L-shaped path ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 7, 0),
    ],
  });
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   { placeableId: 'r2', portName: 'powerIn'  },
    path:  [{ col: 2, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 7 }, { col: 8, row: 7 }],
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.line.utilityType === 'powerCable', 'line.utilityType = powerCable');
    assert(res.line.start && res.line.start.placeableId === 'r1', 'line.start set');
    assert(res.line.end && res.line.end.placeableId === 'r2', 'line.end set');
    // 3 tiles + 4 tiles + 3 tiles = 10 tiles → subL = 40.
    assert(res.line.subL === 40, `subL = 40 (got ${res.line.subL})`);
    // Defensive copy: different array identity, same contents.
    assert(Array.isArray(res.line.path) && res.line.path.length === 4, 'path preserved');
    assert(res.line.id === undefined || res.line.id === null,
      'line has no id yet (caller assigns)');
  }
}

// ==========================================================================
// Test 2: Non-Manhattan (diagonal) segment → not_manhattan.
// ==========================================================================
console.log('\n--- Test 2: diagonal segment rejected ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 7, 0),
    ],
  });
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   { placeableId: 'r2', portName: 'powerIn'  },
    path:  [{ col: 2, row: 3 }, { col: 8, row: 7 }], // diagonal
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'not_manhattan', `reason=not_manhattan (got ${res.reason})`);
}

// ==========================================================================
// Test 3: Zero-length / invalid path → invalid_path.
// ==========================================================================
console.log('\n--- Test 3: invalid path ---');
{
  const state = makeState({
    placeables: [placeable('r1', 'source_rack', 2, 3, 0)],
  });
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   null,
    path:  [{ col: 2, row: 3 }], // single-point path
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'invalid_path', `reason=invalid_path (got ${res.reason})`);
}

// ==========================================================================
// Test 4: Path overlaps existing SAME-TYPE line → overlap_same_type.
// ==========================================================================
console.log('\n--- Test 4: overlap_same_type ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 3, 0),  // sink east of source
      placeable('r3', 'source_rack', 2, 7, 0),
    ],
    lines: [
      {
        utilityType: 'powerCable',
        start: { placeableId: 'r1', portName: 'powerOut' },
        end:   { placeableId: 'r2', portName: 'powerIn'  },
        path:  [{ col: 2, row: 3 }, { col: 8, row: 3 }],
        subL: 24,
      },
    ],
  });
  // New line tries to pass through (5,3) — overlaps existing.
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r3', portName: 'powerOut' },
    end:   null,
    // Start port is E (+col); path must begin +col. Route it so it crosses (5,3).
    path:  [{ col: 2, row: 7 }, { col: 5, row: 7 }, { col: 5, row: 3 }],
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'overlap_same_type', `reason=overlap_same_type (got ${res.reason})`);
}

// ==========================================================================
// Test 5: Path crosses DIFFERENT-type line — still OK.
// ==========================================================================
console.log('\n--- Test 5: different-type line does not block ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 3, 0),
      placeable('r3', 'source_rack', 2, 7, 0),
    ],
    lines: [
      {
        utilityType: 'dataCable', // different type
        start: null, end: null,
        path: [{ col: 2, row: 3 }, { col: 8, row: 3 }],
        subL: 24,
      },
    ],
  });
  // Valid line: start r3 powerOut (E), no end, simple +col path.
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r3', portName: 'powerOut' },
    end:   null,
    path:  [{ col: 2, row: 7 }, { col: 5, row: 7 }, { col: 5, row: 3 }],
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
}

// ==========================================================================
// Test 6: Start placeable missing → invalid_start.
// ==========================================================================
console.log('\n--- Test 6: invalid_start ---');
{
  const state = makeState({ placeables: [] });
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'missing', portName: 'powerOut' },
    end:   null,
    path:  [{ col: 0, row: 0 }, { col: 3, row: 0 }],
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'invalid_start', `reason=invalid_start (got ${res.reason})`);
}

// ==========================================================================
// Test 7: End placeable missing → invalid_end.
// ==========================================================================
console.log('\n--- Test 7: invalid_end ---');
{
  const state = makeState({
    placeables: [placeable('r1', 'source_rack', 2, 3, 0)],
  });
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   { placeableId: 'missing', portName: 'powerIn' },
    path:  [{ col: 2, row: 3 }, { col: 5, row: 3 }],
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'invalid_end', `reason=invalid_end (got ${res.reason})`);
}

// ==========================================================================
// Test 8: Start port's utility ≠ the requested utility type → port_type_mismatch.
// ==========================================================================
console.log('\n--- Test 8: port_type_mismatch ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 3, 0),
    ],
  });
  // r1.dataOut is a dataCable port; asking for powerCable should fail.
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'dataOut' },
    end:   null,
    // dataOut is on 'back' (N) → start seg must be -row.
    path:  [{ col: 2, row: 3 }, { col: 2, row: 0 }],
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'port_type_mismatch', `reason=port_type_mismatch (got ${res.reason})`);
}

// ==========================================================================
// Test 9: Start port already connected → port_taken.
// ==========================================================================
console.log('\n--- Test 9: port_taken ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 3, 0),
      placeable('r3', 'sink_rack',  14, 3, 0),
    ],
    lines: [
      {
        utilityType: 'powerCable',
        start: { placeableId: 'r1', portName: 'powerOut' },
        end:   { placeableId: 'r2', portName: 'powerIn'  },
        path:  [{ col: 2, row: 3 }, { col: 8, row: 3 }],
        subL: 24,
      },
    ],
  });
  // Try to reuse r1.powerOut on a separate path (shifted off the existing one).
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   null,
    path:  [{ col: 2, row: 3 }, { col: 2, row: 10 }],
  });
  assert(res && res.ok === false, 'ok=false');
  // Expect port_taken. Note: path starts +col? Actually path is +row, which
  // also mismatches the port direction. To isolate port_taken, use a +col path:
  const res2 = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   null,
    // Off-axis so it doesn't overlap the existing line either.
    path:  [{ col: 2, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 10 }],
  });
  assert(res2 && res2.ok === false, 'port_taken isolated: ok=false');
  assert(res2.reason === 'port_taken', `reason=port_taken (got ${res2.reason})`);
}

// ==========================================================================
// Test 10: First segment doesn't align with start port's side → port_mismatch_start.
// ==========================================================================
console.log('\n--- Test 10: port_mismatch_start ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 3, 0),
    ],
  });
  // powerOut faces E (+col). Start with a -col segment instead.
  const res = validateDrawLine(state, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   null,
    path:  [{ col: 2, row: 3 }, { col: 0, row: 3 }],
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'port_mismatch_start', `reason=port_mismatch_start (got ${res.reason})`);
}

// ==========================================================================
// Test 11: Last segment inverse doesn't align with end port's side → port_mismatch_end.
// ==========================================================================
console.log('\n--- Test 11: port_mismatch_end ---');
{
  const state = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 3, 0),
    ],
  });
  // powerIn on r2 faces W; last segment must be +col. Approach from below (+row).
  // That would fail the end match. Build a valid +col start, bend, then +row end:
  //   (2,3) → (5,3) → (5,7) → (8,7)? but r2 is at row=3. Put r2 at (8,7).
  const state2 = makeState({
    placeables: [
      placeable('r1', 'source_rack', 2, 3, 0),
      placeable('r2', 'sink_rack',   8, 7, 0),
    ],
  });
  // First seg +col (OK for source east), last seg +row (mismatch for sink west).
  const res = validateDrawLine(state2, {
    utilityType: 'powerCable',
    start: { placeableId: 'r1', portName: 'powerOut' },
    end:   { placeableId: 'r2', portName: 'powerIn'  },
    path:  [{ col: 2, row: 3 }, { col: 8, row: 3 }, { col: 8, row: 7 }],
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'port_mismatch_end', `reason=port_mismatch_end (got ${res.reason})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
