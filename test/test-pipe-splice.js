// test/test-pipe-splice.js — tests for src/beamline/pipe-splice.js
//
// Pure validators for reshaping existing pipes. The load-bearing assertion in
// almost every happy-path case is PLACEMENT POSITION REMAPPING: `position` is a
// fraction of the pipe it lives on, so any change to a pipe's length or to
// where its path[0] sits has to be pushed through every placement or the
// hardware silently slides along the beamline. Each happy path therefore
// asserts both the new fraction and the absolute sub-unit offset it implies.
//
// Fixture geometry throughout: vertical runs at col 2, 4 sub-units per tile.
//
//   validateSplitPipe:  pipe_not_found, invalid_position, gap_too_large,
//                       placement_in_gap, stub_too_short, invalid_pipe, happy
//   validateMergePipes: pipe_not_found, not_collinear, not_adjacent, happy
//                       (forward and reversed second pipe)
//   validateTrimPipe:   pipe_not_found, no_open_end, invalid_length,
//                       placement_beyond_new_end, happy (both ends)
//   validateRemovePipeSection:
//                       pipe_not_found, invalid_pipe, invalid_section,
//                       placement_in_gap, and one happy path per action —
//                       removeAll / trim (each end, detach and not) / split

import {
  validateSplitPipe,
  validateMergePipes,
  validateTrimPipe,
  validateRemovePipeSection,
  MIN_STUB_SUBL,
} from '../src/beamline/pipe-splice.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) {
  return typeof a === 'number' && Math.abs(a - b) < eps;
}
function assertApprox(actual, expected, msg, eps = 1e-6) {
  assert(approx(actual, expected, eps), `${msg} (got ${actual}, want ${expected})`);
}
function assertPoint(pt, col, row, msg) {
  assert(pt && approx(pt.col, col) && approx(pt.row, row),
    `${msg} === (${col},${row}) (got ${pt ? `(${pt.col},${pt.row})` : pt})`);
}

function makePipe(id, start, end, path, subL, placements = []) {
  return { id, start, end, path, subL, placements };
}
function pl(id, type, position, subL) {
  return { id, type, position, subL, params: {} };
}
function ref(junctionId, portName) { return { junctionId, portName }; }

// A pipe running col 2, row 4 → row 12: 8 tiles, subL 32.
function longPipe(overrides = {}) {
  return makePipe(
    'bp_1',
    overrides.start !== undefined ? overrides.start : ref('src_1', 'exit'),
    overrides.end !== undefined ? overrides.end : ref('end_1', 'entry'),
    [{ col: 2, row: 4 }, { col: 2, row: 12 }],
    32,
    overrides.placements || []
  );
}
function stateWith(...pipes) {
  return { placeables: [], beamPipes: pipes };
}

// ==========================================================================
// SPLIT
// ==========================================================================

console.log('\n--- Split 1: pipe_not_found ---');
{
  const res = validateSplitPipe(stateWith(longPipe()), 'nope', 0.5, 4);
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'pipe_not_found', `reason=pipe_not_found (got ${res.reason})`);
}

console.log('\n--- Split 2: invalid_position ---');
{
  const state = stateWith(longPipe());
  const cases = [
    ['atPosition > 1', 1.5, 4],
    ['atPosition < 0', -0.25, 4],
    ['atPosition NaN', NaN, 4],
    ['atPosition undefined', undefined, 4],
    ['gapSubL zero', 0.5, 0],
    ['gapSubL negative', 0.5, -4],
    ['gapSubL fractional', 0.5, 2.5],
  ];
  for (const [label, at, gap] of cases) {
    const res = validateSplitPipe(state, 'bp_1', at, gap);
    assert(res.ok === false && res.reason === 'invalid_position',
      `${label} → invalid_position (got ${res.ok ? 'ok' : res.reason})`);
  }
}

console.log('\n--- Split 3: gap_too_large ---');
{
  const state = stateWith(longPipe());
  // subL 32; a gap needs room for two MIN_STUB_SUBL stubs as well.
  const res = validateSplitPipe(state, 'bp_1', 0.5, 40);
  assert(res.ok === false && res.reason === 'gap_too_large',
    `gap 40 > subL 32 → gap_too_large (got ${res.ok ? 'ok' : res.reason})`);

  const tight = validateSplitPipe(state, 'bp_1', 0.5, 32 - 2 * MIN_STUB_SUBL + 1);
  assert(tight.ok === false && tight.reason === 'gap_too_large',
    `gap leaving < 2 min stubs → gap_too_large (got ${tight.ok ? 'ok' : tight.reason})`);

  // The widest gap that DOES fit anywhere is not rejected as too large.
  const widest = validateSplitPipe(state, 'bp_1', MIN_STUB_SUBL / 32, 32 - 2 * MIN_STUB_SUBL);
  assert(widest.ok === true, `widest legal gap accepted (got ${widest.ok ? 'ok' : widest.reason})`);
}

console.log('\n--- Split 4: stub_too_short ---');
{
  const state = stateWith(longPipe());
  const atStart = validateSplitPipe(state, 'bp_1', 0, 4);
  assert(atStart.ok === false && atStart.reason === 'stub_too_short',
    `cut at 0 → stub_too_short (got ${atStart.ok ? 'ok' : atStart.reason})`);
  const atEnd = validateSplitPipe(state, 'bp_1', 1, 4);
  assert(atEnd.ok === false && atEnd.reason === 'stub_too_short',
    `cut at 1 → stub_too_short (got ${atEnd.ok ? 'ok' : atEnd.reason})`);
  // Gap runs off the end: head 28 + gap 8 > 32.
  const overrun = validateSplitPipe(state, 'bp_1', 0.875, 8);
  assert(overrun.ok === false && overrun.reason === 'stub_too_short',
    `gap overrunning the tail → stub_too_short (got ${overrun.ok ? 'ok' : overrun.reason})`);
}

console.log('\n--- Split 5: placement_in_gap ---');
{
  // pl_b occupies sub-units 20..24. A gap at 18..22 overlaps it.
  const state = stateWith(longPipe({ placements: [pl('pl_b', 'bpm', 0.625, 4)] }));
  const res = validateSplitPipe(state, 'bp_1', 18 / 32, 4);
  assert(res.ok === false && res.reason === 'placement_in_gap',
    `gap over a placement → placement_in_gap (got ${res.ok ? 'ok' : res.reason})`);

  // Butting up against it exactly (gap 16..20) is not an overlap.
  const abutting = validateSplitPipe(state, 'bp_1', 0.5, 4);
  assert(abutting.ok === true,
    `gap abutting a placement is legal (got ${abutting.ok ? 'ok' : abutting.reason})`);
}

console.log('\n--- Split 6: invalid_pipe (bent / degenerate path) ---');
{
  const bent = makePipe('bp_bent', null, null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }, { col: 6, row: 8 }], 32, []);
  const res = validateSplitPipe(stateWith(bent), 'bp_bent', 0.5, 4);
  assert(res.ok === false && res.reason === 'invalid_pipe',
    `bent path → invalid_pipe (got ${res.ok ? 'ok' : res.reason})`);
}

console.log('\n--- Split 7: happy path + placement remapping ---');
{
  // subL 32 over rows 4..12. Placements at sub-units 4..8 and 20..24.
  // Cut at 12/32 with a 4-sub gap → head 12, hole 12..16, tail 16.
  const original = longPipe({
    placements: [pl('pl_a', 'quadrupole', 0.125, 4), pl('pl_b', 'bpm', 0.625, 4)],
  });
  const state = stateWith(original);
  const res = validateSplitPipe(state, 'bp_1', 0.375, 4);

  assert(res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.headSubL === 12, `headSubL === 12 (got ${res.headSubL})`);
    assert(res.tailSubL === 16, `tailSubL === 16 (got ${res.tailSubL})`);
    assert(res.headSubL + res.tailSubL + 4 === 32, 'head + gap + tail === original subL');

    assert(res.headPath.length === 2, `headPath is 2 points (got ${res.headPath.length})`);
    assertPoint(res.headPath[0], 2, 4, 'headPath[0]');
    assertPoint(res.headPath[1], 2, 7, 'headPath[1]');
    assertPoint(res.tailPath[0], 2, 8, 'tailPath[0]');
    assertPoint(res.tailPath[1], 2, 12, 'tailPath[1]');

    assertApprox(res.gapStart, 0.375, 'gapStart');
    assertApprox(res.gapEnd, 0.5, 'gapEnd');
    assertPoint(res.gapCenter, 2, 7.5, 'gapCenter');

    // --- remapping ---
    assert(res.headPlacements.length === 1 && res.headPlacements[0].id === 'pl_a',
      'pl_a lands on the head stub');
    assert(res.tailPlacements.length === 1 && res.tailPlacements[0].id === 'pl_b',
      'pl_b lands on the tail stub');

    const a = res.headPlacements[0];
    assertApprox(a.position, 4 / 12, 'pl_a position remapped into head frame');
    assertApprox(a.position * res.headSubL, 4,
      'pl_a still sits 4 sub-units from the pipe head (absolute preserved)');
    assert(a.subL === 4 && a.type === 'quadrupole', 'pl_a keeps subL/type');

    const b = res.tailPlacements[0];
    assertApprox(b.position, 0.25, 'pl_b position remapped into tail frame');
    assertApprox(b.position * res.tailSubL + res.headSubL + 4, 20,
      'pl_b still sits 20 sub-units from the original head (absolute preserved)');

    // purity
    assertApprox(original.placements[0].position, 0.125, 'source placement untouched');
    assertApprox(original.placements[1].position, 0.625, 'source placement untouched');
    assert(original.path.length === 2 && original.subL === 32, 'source pipe untouched');
  }
}

// ==========================================================================
// MERGE
// ==========================================================================

// bp_a: rows 4..8 (subL 16), ending at junction j1.
// bp_b: rows 9..13 (subL 16), starting at junction j1. The 1-tile hole between
// them is j1's footprint, which the merged run swallows → merged subL 36.
function mergeFixture(bOverrides = {}) {
  const a = makePipe('bp_a', ref('src_1', 'exit'), ref('j1', 'entry'),
    [{ col: 2, row: 4 }, { col: 2, row: 8 }], 16, [pl('pl_a', 'quadrupole', 0.5, 4)]);
  const b = bOverrides.reversed
    ? makePipe('bp_b', ref('end_1', 'entry'), ref('j1', 'exit'),
        [{ col: 2, row: 13 }, { col: 2, row: 9 }], 16, [pl('pl_b', 'bpm', 0.25, 4)])
    : makePipe('bp_b', ref('j1', 'exit'), ref('end_1', 'entry'),
        [{ col: 2, row: 9 }, { col: 2, row: 13 }], 16, [pl('pl_b', 'bpm', 0.25, 4)]);
  return { a, b, state: stateWith(a, b) };
}

console.log('\n--- Merge 1: pipe_not_found ---');
{
  const { state } = mergeFixture();
  assert(validateMergePipes(state, 'bp_a', 'nope').reason === 'pipe_not_found',
    'unknown B → pipe_not_found');
  assert(validateMergePipes(state, 'nope', 'bp_b').reason === 'pipe_not_found',
    'unknown A → pipe_not_found');
}

console.log('\n--- Merge 2: not_collinear ---');
{
  const a = makePipe('bp_a', null, ref('j1', 'entry'),
    [{ col: 2, row: 4 }, { col: 2, row: 8 }], 16, []);
  // Perpendicular run out of the same junction.
  const perp = makePipe('bp_perp', ref('j1', 'exit'), null,
    [{ col: 3, row: 9 }, { col: 7, row: 9 }], 16, []);
  // Parallel but on a different column.
  const offset = makePipe('bp_off', ref('j1', 'exit'), null,
    [{ col: 6, row: 9 }, { col: 6, row: 13 }], 16, []);
  const state = stateWith(a, perp, offset);
  assert(validateMergePipes(state, 'bp_a', 'bp_perp').reason === 'not_collinear',
    'perpendicular → not_collinear');
  assert(validateMergePipes(state, 'bp_a', 'bp_off').reason === 'not_collinear',
    'parallel on another line → not_collinear');
}

console.log('\n--- Merge 3: not_adjacent ---');
{
  const a = makePipe('bp_a', null, null, [{ col: 2, row: 4 }, { col: 2, row: 8 }], 16, []);
  const far = makePipe('bp_far', null, null, [{ col: 2, row: 20 }, { col: 2, row: 24 }], 16, []);
  // Shares the coordinate (2,12) with bp_over but doubles back over it.
  const over1 = makePipe('bp_o1', null, null, [{ col: 2, row: 4 }, { col: 2, row: 12 }], 32, []);
  const over2 = makePipe('bp_o2', null, null, [{ col: 2, row: 12 }, { col: 2, row: 8 }], 16, []);
  const state = stateWith(a, far, over1, over2);

  assert(validateMergePipes(state, 'bp_a', 'bp_far').reason === 'not_adjacent',
    'collinear but disjoint, no shared junction → not_adjacent');
  assert(validateMergePipes(state, 'bp_a', 'bp_a').reason === 'not_adjacent',
    'a pipe merged with itself → not_adjacent');
  assert(validateMergePipes(state, 'bp_o1', 'bp_o2').reason === 'not_adjacent',
    'overlapping runs → not_adjacent');
}

console.log('\n--- Merge 4: happy path + placement remapping ---');
{
  const { a, b, state } = mergeFixture();
  const res = validateMergePipes(state, 'bp_a', 'bp_b');
  assert(res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assertPoint(res.path[0], 2, 4, 'merged path[0]');
    assertPoint(res.path[1], 2, 13, 'merged path[1]');
    assert(res.subL === 36, `merged subL === 36 — 9 tiles incl. the junction hole (got ${res.subL})`);
    assert(res.start && res.start.junctionId === 'src_1', 'merged start = A\'s free end');
    assert(res.end && res.end.junctionId === 'end_1', 'merged end = B\'s free end');

    // --- remapping ---
    assert(res.placements.length === 2, `both placements survive (got ${res.placements.length})`);
    assert(res.placements[0].id === 'pl_a' && res.placements[1].id === 'pl_b',
      'placements sorted by position along the merged run');

    const remA = res.placements[0];
    assertApprox(remA.position, 8 / 36, 'pl_a remapped into the merged frame');
    assertApprox(remA.position * res.subL, 8,
      'pl_a still 8 sub-units (2 tiles, row 6) from the merged head');

    const remB = res.placements[1];
    assertApprox(remB.position, 24 / 36, 'pl_b remapped into the merged frame');
    assertApprox(remB.position * res.subL, 24,
      'pl_b still 24 sub-units (6 tiles, row 10) from the merged head');

    // purity
    assertApprox(a.placements[0].position, 0.5, 'source A placement untouched');
    assertApprox(b.placements[0].position, 0.25, 'source B placement untouched');
    assert(a.subL === 16 && b.subL === 16, 'source pipes untouched');
  }
}

console.log('\n--- Merge 5: second pipe drawn in the opposite direction ---');
{
  // bp_b runs row 13 → row 9, i.e. AGAINST the merged direction. Its placement
  // sits 1 tile from row 13 (rows 12..11), which in the merged frame is 7 tiles
  // from row 4 — a mirror, not just an offset.
  const { state } = mergeFixture({ reversed: true });
  const res = validateMergePipes(state, 'bp_a', 'bp_b');
  assert(res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assertPoint(res.path[0], 2, 4, 'merged path[0]');
    assertPoint(res.path[1], 2, 13, 'merged path[1]');
    assert(res.subL === 36, `merged subL === 36 (got ${res.subL})`);
    assert(res.start && res.start.junctionId === 'src_1', 'merged start = A\'s free end');
    assert(res.end && res.end.junctionId === 'end_1', 'merged end = B\'s free end (reversed)');

    const remB = res.placements.find(p => p.id === 'pl_b');
    assertApprox(remB.position, 28 / 36, 'reversed pipe placement mirrored into merged frame');
    assertApprox(remB.position * res.subL, 28,
      'pl_b leading edge is 28 sub-units (7 tiles, row 11) from the merged head');
    assertApprox(remB.position * res.subL + remB.subL, 32,
      'pl_b trailing edge is 32 sub-units (row 12) from the merged head');
  }
}

console.log('\n--- Merge 6: coordinate-adjacent pipes with no junction ---');
{
  const a = makePipe('bp_a', ref('src_1', 'exit'), null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }], 16, []);
  const b = makePipe('bp_b', null, ref('end_1', 'entry'),
    [{ col: 2, row: 8 }, { col: 2, row: 12 }], 16, [pl('pl_b', 'bpm', 0.5, 4)]);
  const res = validateMergePipes(stateWith(a, b), 'bp_a', 'bp_b');
  assert(res.ok === true, `ok=true (got ${res.ok ? 'ok' : res.reason})`);
  if (res.ok) {
    assert(res.subL === 32, `merged subL === 32, no hole (got ${res.subL})`);
    assertApprox(res.placements[0].position, 24 / 32,
      'pl_b (2 tiles into B) remapped to 6 tiles into the merged run');
  }
}

// ==========================================================================
// TRIM
// ==========================================================================

console.log('\n--- Trim 1: pipe_not_found ---');
{
  const res = validateTrimPipe(stateWith(longPipe({ end: null })), 'nope', 16);
  assert(res.ok === false && res.reason === 'pipe_not_found',
    `reason=pipe_not_found (got ${res.reason})`);
}

console.log('\n--- Trim 2: no_open_end ---');
{
  const res = validateTrimPipe(stateWith(longPipe()), 'bp_1', 16);
  assert(res.ok === false && res.reason === 'no_open_end',
    `both ends attached → no_open_end (got ${res.ok ? 'ok' : res.reason})`);
}

console.log('\n--- Trim 3: invalid_length ---');
{
  const state = stateWith(longPipe({ end: null }));
  for (const [label, n] of [['zero', 0], ['negative', -4], ['equal to current', 32],
                            ['longer than current', 40], ['fractional', 8.5],
                            ['NaN', NaN], ['missing', undefined]]) {
    const res = validateTrimPipe(state, 'bp_1', n);
    assert(res.ok === false && res.reason === 'invalid_length',
      `${label} → invalid_length (got ${res.ok ? 'ok' : res.reason})`);
  }
}

console.log('\n--- Trim 4: placement_beyond_new_end ---');
{
  // Open at the END: placement occupies 16..20, trimming to 16 cuts into it.
  const fromEnd = stateWith(longPipe({ end: null, placements: [pl('pl_x', 'bpm', 0.5, 4)] }));
  const resEnd = validateTrimPipe(fromEnd, 'bp_1', 16);
  assert(resEnd.ok === false && resEnd.reason === 'placement_beyond_new_end',
    `placement in the removed tail → placement_beyond_new_end (got ${resEnd.ok ? 'ok' : resEnd.reason})`);

  // Open at the START: placement occupies 4..8, trimming to 24 removes 0..8.
  const fromStart = stateWith(longPipe({ start: null, placements: [pl('pl_y', 'bpm', 0.125, 4)] }));
  const resStart = validateTrimPipe(fromStart, 'bp_1', 24);
  assert(resStart.ok === false && resStart.reason === 'placement_beyond_new_end',
    `placement in the removed head → placement_beyond_new_end (got ${resStart.ok ? 'ok' : resStart.reason})`);
}

console.log('\n--- Trim 5: happy path from the open END + remapping ---');
{
  const original = longPipe({ end: null, placements: [pl('pl_x', 'bpm', 0.5, 4)] });
  const res = validateTrimPipe(stateWith(original), 'bp_1', 24);
  assert(res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.subL === 24, `subL === 24 (got ${res.subL})`);
    assert(res.trimmedEnd === 'end', `trimmedEnd === 'end' (got ${res.trimmedEnd})`);
    assert(res.removedSubL === 8, `removedSubL === 8 (got ${res.removedSubL})`);
    assertApprox(res.removedTiles, 2, 'removedTiles === 2');
    assertPoint(res.path[0], 2, 4, 'path[0] unchanged (head is anchored)');
    assertPoint(res.path[1], 2, 10, 'path[1] pulled back 2 tiles');

    const x = res.placements[0];
    assertApprox(x.position, 16 / 24, 'placement rescaled against the shorter pipe');
    assertApprox(x.position * res.subL, 16,
      'placement still 16 sub-units from the head (absolute preserved)');
    assertApprox(original.placements[0].position, 0.5, 'source placement untouched');
  }
}

console.log('\n--- Trim 6: happy path from the open START + remapping ---');
{
  const original = longPipe({ start: null, placements: [pl('pl_y', 'bpm', 0.5, 4)] });
  const res = validateTrimPipe(stateWith(original), 'bp_1', 24);
  assert(res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.subL === 24, `subL === 24 (got ${res.subL})`);
    assert(res.trimmedEnd === 'start', `trimmedEnd === 'start' (got ${res.trimmedEnd})`);
    assert(res.removedSubL === 8, `removedSubL === 8 (got ${res.removedSubL})`);
    assertPoint(res.path[0], 2, 6, 'path[0] pushed forward 2 tiles');
    assertPoint(res.path[1], 2, 12, 'path[1] unchanged (tail is anchored)');

    const y = res.placements[0];
    // path[0] moved forward 8 sub-units, so the fraction shifts as well as scales.
    assertApprox(y.position, 8 / 24, 'placement shifted AND rescaled for the moved head');
    assertApprox(y.position * res.subL + res.removedSubL, 16,
      'placement still 16 sub-units from the original head (absolute preserved)');
  }
}

console.log('\n--- Trim 7: open at both ends trims from the end ---');
{
  const res = validateTrimPipe(stateWith(longPipe({ start: null, end: null })), 'bp_1', 20);
  assert(res.ok === true && res.trimmedEnd === 'end',
    `both ends open → trims the tail (got ${res.ok ? res.trimmedEnd : res.reason})`);
  if (res.ok) assertPoint(res.path[1], 2, 9, 'tail pulled back to row 9');
}

// ==========================================================================
// REMOVE SECTION
// ==========================================================================
//
// Section removal is the demolish tool's primitive: "delete sub-units
// [from, to) of this pipe". It is the only splice op that can eat into a
// terminal that is BOUND to a junction, so the `detach` flags are as
// load-bearing here as position remapping is everywhere else — leaving a ref
// on a terminal the pipe no longer reaches would keep a junction port
// occupied by geometry that isn't there.

console.log('\n--- Section 1: pipe_not_found / invalid_pipe ---');
{
  const res = validateRemovePipeSection(stateWith(longPipe()), 'nope', 0, 4);
  assert(res && res.ok === false && res.reason === 'pipe_not_found',
    `reason=pipe_not_found (got ${res.reason})`);

  const bent = makePipe('bp_b', null, null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }, { col: 5, row: 8 }], 28);
  const res2 = validateRemovePipeSection(stateWith(bent), 'bp_b', 0, 4);
  assert(res2.ok === false && res2.reason === 'invalid_pipe',
    `bent pipe → invalid_pipe (got ${res2.reason})`);
}

console.log('\n--- Section 2: invalid_section ---');
{
  const state = stateWith(longPipe());
  const cases = [
    ['from below zero', -1, 4],
    ['to past the end', 28, 33],
    ['empty range', 8, 8],
    ['inverted range', 12, 8],
    ['fractional from', 1.5, 4],
    ['fractional to', 0, 3.5],
  ];
  for (const [label, from, to] of cases) {
    const res = validateRemovePipeSection(state, 'bp_1', from, to);
    assert(res.ok === false && res.reason === 'invalid_section',
      `${label} → invalid_section (got ${res.ok ? 'ok' : res.reason})`);
  }
}

console.log('\n--- Section 3: placement_in_gap ---');
{
  // Placement occupies sub-units 16..20; the cut asks for 18..19.
  const state = stateWith(longPipe({ placements: [pl('pl_a', 'bpm', 0.5, 4)] }));
  const res = validateRemovePipeSection(state, 'bp_1', 18, 19);
  assert(res.ok === false && res.reason === 'placement_in_gap',
    `cut through mounted hardware → placement_in_gap (got ${res.ok ? 'ok' : res.reason})`);

  // Butting up against a placement without overlapping it is legal.
  const ok = validateRemovePipeSection(state, 'bp_1', 12, 16);
  assert(ok.ok === true, `cut ending exactly where hardware starts is legal (got ${ok.reason})`);
}

console.log('\n--- Section 4: whole pipe → removeAll ---');
{
  const res = validateRemovePipeSection(stateWith(longPipe()), 'bp_1', 0, 32);
  assert(res.ok === true && res.action === 'removeAll',
    `[0,subL) → action removeAll (got ${res.ok ? res.action : res.reason})`);
  if (res.ok) {
    assert(res.removedSubL === 32, `removedSubL === 32 (got ${res.removedSubL})`);
    assertPoint(res.removedPath[0], 2, 4, 'removedPath spans the whole run (head)');
    assertPoint(res.removedPath[1], 2, 12, 'removedPath spans the whole run (tail)');
  }
}

console.log('\n--- Section 5: head trim detaches a bound start ---');
{
  // One sub-unit off the head — the finest cut the demolish tool makes.
  const original = longPipe({ placements: [pl('pl_a', 'bpm', 0.5, 4)] });
  const res = validateRemovePipeSection(stateWith(original), 'bp_1', 0, 1);
  assert(res.ok === true && res.action === 'trim',
    `action trim (got ${res.ok ? res.action : res.reason})`);
  if (res.ok) {
    assert(res.trimmedEnd === 'start', `trimmedEnd === 'start' (got ${res.trimmedEnd})`);
    assert(res.detach === true, 'detach === true — start was bound to a junction');
    assert(res.subL === 31, `subL === 31 (got ${res.subL})`);
    assertPoint(res.path[0], 2, 4.25, 'path[0] pushed forward one sub-unit');
    assertPoint(res.path[1], 2, 12, 'path[1] unchanged');
    assertApprox(res.placements[0].position, 15 / 31, 'placement shifted AND rescaled');
    assertApprox(res.placements[0].position * res.subL + res.removedSubL, 16,
      'placement still 16 sub-units from the original head (absolute preserved)');
    assertApprox(original.placements[0].position, 0.5, 'source placement untouched');
  }
}

console.log('\n--- Section 6: tail trim detaches a bound end ---');
{
  const res = validateRemovePipeSection(
    stateWith(longPipe({ placements: [pl('pl_a', 'bpm', 0.5, 4)] })), 'bp_1', 24, 32);
  assert(res.ok === true && res.action === 'trim',
    `action trim (got ${res.ok ? res.action : res.reason})`);
  if (res.ok) {
    assert(res.trimmedEnd === 'end', `trimmedEnd === 'end' (got ${res.trimmedEnd})`);
    assert(res.detach === true, 'detach === true — end was bound to a junction');
    assert(res.subL === 24, `subL === 24 (got ${res.subL})`);
    assertPoint(res.path[1], 2, 10, 'tail pulled back 2 tiles');
    assertApprox(res.placements[0].position, 16 / 24, 'placement rescaled against the shorter pipe');
    assertPoint(res.removedPath[0], 2, 10, 'removedPath starts at the new tail');
    assertPoint(res.removedPath[1], 2, 12, 'removedPath ends at the old tail');
  }
}

console.log('\n--- Section 7: trimming an already-open end does not claim a detach ---');
{
  const res = validateRemovePipeSection(stateWith(longPipe({ end: null })), 'bp_1', 28, 32);
  assert(res.ok === true && res.detach === false,
    `open end → detach false (got ${res.ok ? res.detach : res.reason})`);
}

console.log('\n--- Section 8: mid-run cut splits into two stubs ---');
{
  const original = longPipe({
    placements: [pl('pl_head', 'bpm', 4 / 32, 4), pl('pl_tail', 'bpm', 24 / 32, 4)],
  });
  const res = validateRemovePipeSection(stateWith(original), 'bp_1', 16, 17);
  assert(res.ok === true && res.action === 'split',
    `action split (got ${res.ok ? res.action : res.reason})`);
  if (res.ok) {
    assert(res.headSubL === 16, `headSubL === 16 (got ${res.headSubL})`);
    assert(res.tailSubL === 15, `tailSubL === 15 (got ${res.tailSubL})`);
    assert(res.removedSubL === 1, `removedSubL === 1 (got ${res.removedSubL})`);
    assertPoint(res.headPath[0], 2, 4, 'head starts at the original head');
    assertPoint(res.headPath[1], 2, 8, 'head ends where the cut begins');
    assertPoint(res.tailPath[0], 2, 8.25, 'tail starts where the cut ends');
    assertPoint(res.tailPath[1], 2, 12, 'tail ends at the original tail');

    assert(res.headPlacements.length === 1 && res.headPlacements[0].id === 'pl_head',
      'head keeps the upstream placement, by its own id');
    assert(res.tailPlacements.length === 1 && res.tailPlacements[0].id === 'pl_tail',
      'tail keeps the downstream placement, by its own id');
    assertApprox(res.headPlacements[0].position, 4 / 16, 'head placement rescaled');
    assertApprox(res.tailPlacements[0].position, 7 / 15,
      'tail placement shifted past the cut AND rescaled');
    assertApprox(res.tailPlacements[0].position * res.tailSubL + 17, 24,
      'tail placement still 24 sub-units from the original head');
  }
}

console.log('\n--- Section 9: minimum stubs on both sides of a mid-run cut ---');
{
  // The tightest legal mid-run cut: 1 sub-unit off each end of the removal.
  const res = validateRemovePipeSection(stateWith(longPipe()), 'bp_1', 1, 31);
  assert(res.ok === true && res.action === 'split',
    `1-sub-unit stubs are legal (got ${res.ok ? res.action : res.reason})`);
  if (res.ok) {
    assert(res.headSubL === MIN_STUB_SUBL && res.tailSubL === MIN_STUB_SUBL,
      `both stubs === MIN_STUB_SUBL (got ${res.headSubL}/${res.tailSubL})`);
  }
}

console.log('\n--- Section 10: inline points survive boundary cuts but block interior cuts ---');
{
  const point = { id: 'pl_inline', type: 'bpm', position: 0.5, subL: 1, inline: true, params: {} };
  const state = stateWith(longPipe({ placements: [point] }));

  const boundary = validateRemovePipeSection(state, 'bp_1', 16, 17);
  assert(boundary.ok === true && boundary.action === 'split',
    `cut beginning on the point boundary is legal (got ${boundary.ok ? boundary.action : boundary.reason})`);
  if (boundary.ok) {
    assert(boundary.headPlacements[0]?.id === point.id
      && boundary.headPlacements[0]?.position === 1,
    'the point remains on the head stub endpoint');
  }

  const interior = validateRemovePipeSection(state, 'bp_1', 15, 17);
  assert(interior.ok === false && interior.reason === 'placement_in_gap',
    `a cut whose interior contains the point is rejected (got ${interior.reason})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
