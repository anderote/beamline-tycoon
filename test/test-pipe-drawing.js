// test/test-pipe-drawing.js — tests for src/beamline/pipe-drawing.js
//
// Pure validation helpers for pipe draw / extend operations. Tests:
//   1. Straight +row path with valid source.exit → endpoint.entry.
//   2. Path with a corner → rejected (not_straight).
//   3. Path overlapping an existing pipe → rejected (overlap).
//   4. Open-start (start=null) with valid end → ok, pipe.start === null.
//   5. End on a junction port already connected → rejected (port_taken).
//   6. End on a port whose side doesn't match approach axis → rejected (port_mismatch).
//   7. Extend an existing pipe's open end with a collinear new path → merged.
//   8. Extend missing pipe → rejected (pipe_not_found).
//   9. Extend a pipe with no open end → rejected (no_open_end).
//  10. Extend with non-collinear additionalPath → rejected (not_collinear).

import {
  validateDrawPipe,
  validateExtendPipe,
} from '../src/beamline/pipe-drawing.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function placeable(id, type, extra = {}) {
  return {
    id,
    type,
    category: 'beamline',
    col: 0, row: 0, subCol: 0, subRow: 0, dir: 0,
    params: {},
    cells: [],
    ...extra,
  };
}

function makePipe(id, start, end, path, subL, placements = []) {
  return { id, start, end, path, subL, placements };
}

// ==========================================================================
// Test 1: Straight +row path, source.exit → endpoint.entry → ok.
// ==========================================================================
console.log('\n--- Test 1: straight +row draw (source → faradayCup) ---');
{
  // source dir=0: exit faces S (+row). faradayCup dir=0: entry faces N (-row).
  // Pipe goes from source south-edge to faradayCup north-edge (+row direction).
  const state = {
    placeables: [
      placeable('src_1', 'source',     { col: 2, row: 2, dir: 0 }),
      placeable('end_1', 'faradayCup', { col: 2, row: 10, dir: 0 }),
    ],
    beamPipes: [],
  };

  const res = validateDrawPipe(state, {
    start: { junctionId: 'src_1', portName: 'exit' },
    end:   { junctionId: 'end_1', portName: 'entry' },
    path:  [{ col: 2, row: 4 }, { col: 2, row: 8 }],
  });

  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.pipe.id === null, 'pipe.id === null (caller assigns)');
    assert(res.pipe.start && res.pipe.start.junctionId === 'src_1', 'pipe.start set');
    assert(res.pipe.end && res.pipe.end.junctionId === 'end_1', 'pipe.end set');
    assert(Array.isArray(res.pipe.path) && res.pipe.path.length === 2, 'pipe.path preserved');
    // totalDist = |8 - 4| = 4 tiles → subL = round(4*4) = 16
    assert(res.pipe.subL === 16, `pipe.subL === 16 (got ${res.pipe.subL})`);
    assert(Array.isArray(res.pipe.placements) && res.pipe.placements.length === 0,
      'pipe.placements === []');
  }
}

// ==========================================================================
// Test 2: Path with a corner → rejected.
// ==========================================================================
console.log('\n--- Test 2: corner path rejected ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source', { col: 2, row: 2, dir: 0 }),
      placeable('end_1', 'faradayCup', { col: 10, row: 10, dir: 0 }),
    ],
    beamPipes: [],
  };

  const res = validateDrawPipe(state, {
    start: { junctionId: 'src_1', portName: 'exit' },
    end:   { junctionId: 'end_1', portName: 'entry' },
    path:  [{ col: 2, row: 4 }, { col: 2, row: 8 }, { col: 10, row: 8 }],
  });

  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'not_straight', `reason=not_straight (got ${res.reason})`);
}

// ==========================================================================
// Test 3: Path overlaps an existing pipe → rejected.
// ==========================================================================
console.log('\n--- Test 3: overlap rejected ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source',     { col: 2, row: 2, dir: 0 }),
      placeable('end_1', 'faradayCup', { col: 2, row: 10, dir: 0 }),
      placeable('src_2', 'source',     { col: 6, row: 2, dir: 0 }),
    ],
    beamPipes: [
      makePipe('bp_existing',
        { junctionId: 'src_1', portName: 'exit' },
        { junctionId: 'end_1', portName: 'entry' },
        [{ col: 2, row: 4 }, { col: 2, row: 8 }],
        16, []),
    ],
  };

  // New pipe tries to draw through col=2 rows 4-8 — directly on top of bp_existing.
  // src_2 is at col=6 dir=0; exit at (col=6, row=4ish). We fabricate a path that
  // overlaps the existing one so the overlap check fires.
  const res = validateDrawPipe(state, {
    start: { junctionId: 'src_2', portName: 'exit' },
    end:   null,
    path:  [{ col: 2, row: 4 }, { col: 2, row: 8 }],
  });

  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'overlap', `reason=overlap (got ${res.reason})`);
}

// ==========================================================================
// Test 4: Open-start (start=null) with valid end → ok.
// ==========================================================================
console.log('\n--- Test 4: open-start, connected end ---');
{
  const state = {
    placeables: [
      placeable('end_1', 'faradayCup', { col: 2, row: 10, dir: 0 }),
    ],
    beamPipes: [],
  };

  // Path approaches end_1.entry (port faces N): last-segment direction must be +row
  // (coming from the north).
  const res = validateDrawPipe(state, {
    start: null,
    end:   { junctionId: 'end_1', portName: 'entry' },
    path:  [{ col: 2, row: 4 }, { col: 2, row: 8 }],
  });

  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.pipe.start === null, 'pipe.start === null');
    assert(res.pipe.end && res.pipe.end.junctionId === 'end_1', 'pipe.end set');
    assert(res.pipe.subL === 16, `pipe.subL === 16 (got ${res.pipe.subL})`);
  }
}

// ==========================================================================
// Test 5: End port already connected → rejected.
// ==========================================================================
console.log('\n--- Test 5: port_taken ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source',     { col: 2, row: 2, dir: 0 }),
      placeable('end_1', 'faradayCup', { col: 2, row: 10, dir: 0 }),
      placeable('src_2', 'source',     { col: 6, row: 2, dir: 0 }),
    ],
    beamPipes: [
      makePipe('bp_existing',
        { junctionId: 'src_1', portName: 'exit' },
        { junctionId: 'end_1', portName: 'entry' },
        [{ col: 2, row: 4 }, { col: 2, row: 8 }],
        16, []),
    ],
  };

  // Try to connect src_2 to end_1.entry — already taken.
  const res = validateDrawPipe(state, {
    start: { junctionId: 'src_2', portName: 'exit' },
    end:   { junctionId: 'end_1', portName: 'entry' },
    path:  [{ col: 6, row: 4 }, { col: 6, row: 9 }, { col: 2, row: 9 }],
  });

  // We expect port_taken. If the validator rejects for not_straight first, that
  // would also be a bug (corner above), so we use a straight-ish expectation:
  // construct a path that IS straight and only tests port_taken.
  // Actually the path above is not straight; simplify:
  const res2 = validateDrawPipe(state, {
    start: null,
    end:   { junctionId: 'end_1', portName: 'entry' },
    path:  [{ col: 2, row: 4 }, { col: 2, row: 8 }],
  });

  assert(res2 && res2.ok === false, 'port_taken: ok=false');
  assert(res2.reason === 'port_taken' || res2.reason === 'overlap',
    `reason=port_taken (or overlap) (got ${res2.reason})`);
  // overlap would fire first because path sits on bp_existing; use a different
  // path location to isolate port_taken.
  const res3 = validateDrawPipe(state, {
    start: null,
    end:   { junctionId: 'end_1', portName: 'entry' },
    path:  [{ col: 8, row: 4 }, { col: 8, row: 8 }],
  });
  // Even though path is elsewhere, entry port is taken so should reject.
  assert(res3 && res3.ok === false, 'port_taken isolated: ok=false');
  assert(res3.reason === 'port_taken', `reason=port_taken (got ${res3.reason})`);
}

// ==========================================================================
// Test 6: End port's side doesn't match approach axis → rejected.
// ==========================================================================
console.log('\n--- Test 6: port_mismatch ---');
{
  // faradayCup dir=0 has entry on N (-row). A pipe approaching along +col
  // (east-bound) is perpendicular to the port's side — mismatch.
  const state = {
    placeables: [
      placeable('end_1', 'faradayCup', { col: 10, row: 2, dir: 0 }),
    ],
    beamPipes: [],
  };

  const res = validateDrawPipe(state, {
    start: null,
    end:   { junctionId: 'end_1', portName: 'entry' },
    // pipe approaches from the west, going +col: last dir = (+col, 0) → E.
    // end port faces N; pipe should approach from N going +row. Mismatch.
    path:  [{ col: 2, row: 2 }, { col: 8, row: 2 }],
  });

  assert(res && res.ok === false, 'port_mismatch: ok=false');
  assert(res.reason === 'port_mismatch', `reason=port_mismatch (got ${res.reason})`);
}

// ==========================================================================
// Test 7: Extend a pipe's open end with a collinear new path → merged.
// ==========================================================================
console.log('\n--- Test 7: extend open end (collinear) ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source', { col: 2, row: 2, dir: 0 }),
    ],
    beamPipes: [
      makePipe('bp_1',
        { junctionId: 'src_1', portName: 'exit' },
        null,
        [{ col: 2, row: 4 }, { col: 2, row: 8 }],
        16, []),
    ],
  };

  // Existing last segment goes (2,4)→(2,8): +row. Extending collinear +row.
  const additional = [{ col: 2, row: 8 }, { col: 2, row: 12 }];
  const res = validateExtendPipe(state, 'bp_1', additional);

  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.pipe.id === 'bp_1', 'pipe.id preserved');
    assert(res.pipe.start && res.pipe.start.junctionId === 'src_1', 'pipe.start preserved');
    assert(res.pipe.end === null, 'pipe.end still open');
    // merged path: [(2,4), (2,8), (2,12)] or equivalent collapse [(2,4), (2,12)]
    const p = res.pipe.path;
    assert(Array.isArray(p) && p.length >= 2, `path length >= 2 (got ${p.length})`);
    const first = p[0], last = p[p.length - 1];
    assert(approx(first.col, 2) && approx(first.row, 4),
      `path starts at (2,4) (got (${first.col},${first.row}))`);
    assert(approx(last.col, 2) && approx(last.row, 12),
      `path ends at (2,12) (got (${last.col},${last.row}))`);
    // total dist = 8 tiles → subL = 32
    assert(res.pipe.subL === 32, `subL === 32 (got ${res.pipe.subL})`);
  }
}

// ==========================================================================
// Test 8: extend nonexistent pipe → pipe_not_found.
// ==========================================================================
console.log('\n--- Test 8: extend nonexistent pipe ---');
{
  const state = { placeables: [], beamPipes: [] };
  const res = validateExtendPipe(state, 'nope', [{ col: 0, row: 0 }, { col: 0, row: 4 }]);
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'pipe_not_found', `reason=pipe_not_found (got ${res.reason})`);
}

// ==========================================================================
// Test 9: extend a pipe with no open end → no_open_end.
// ==========================================================================
console.log('\n--- Test 9: extend closed pipe ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source',     { col: 2, row: 2, dir: 0 }),
      placeable('end_1', 'faradayCup', { col: 2, row: 10, dir: 0 }),
    ],
    beamPipes: [
      makePipe('bp_1',
        { junctionId: 'src_1', portName: 'exit' },
        { junctionId: 'end_1', portName: 'entry' },
        [{ col: 2, row: 4 }, { col: 2, row: 8 }],
        16, []),
    ],
  };
  const res = validateExtendPipe(state, 'bp_1', [{ col: 2, row: 8 }, { col: 2, row: 12 }]);
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'no_open_end', `reason=no_open_end (got ${res.reason})`);
}

// ==========================================================================
// Test 10: extend with non-collinear additional path → not_collinear.
// ==========================================================================
console.log('\n--- Test 10: extend non-collinear ---');
{
  const state = {
    placeables: [
      placeable('src_1', 'source', { col: 2, row: 2, dir: 0 }),
    ],
    beamPipes: [
      makePipe('bp_1',
        { junctionId: 'src_1', portName: 'exit' },
        null,
        [{ col: 2, row: 4 }, { col: 2, row: 8 }],
        16, []),
    ],
  };
  // Last segment +row. Extending +col is perpendicular.
  const res = validateExtendPipe(state, 'bp_1', [{ col: 2, row: 8 }, { col: 6, row: 8 }]);
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'not_collinear', `reason=not_collinear (got ${res.reason})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
