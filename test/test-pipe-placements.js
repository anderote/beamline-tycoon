// test/test-pipe-placements.js — tests for src/beamline/pipe-placements.js
//
// Pure slot-finding helper for pipe placements. Tests:
//   1. Snap on empty pipe: one placement at 0.5 → placements = [{pos=0.5}].
//   2. Snap finds free drift: existing [0.2..0.3]; new subL=2 at 0.5 → ok, ordered.
//   3. Snap rejects overlap: new at 0.25 (over existing) but really-cramped → rejects.
//   4. Replace swaps: buncher subL=2 at 0.5 → pillboxCavity subL=2 → same pos, swapped type.
//   5. Replace with larger length: buncher subL=2 → rfCavity subL=6 at 0.5, neighbor shifts.
//   6. Insert shifts neighbors: subL=40 pipe, [0.2 subL=2, 0.6 subL=2]; insert subL=4 @ 0.4.
//   7. Insert rejects when full: subL=4 pipe full with two subL=2 placements.
//   8. Order preserved by position.
//
// Placement interval on a pipe of length pipe.subL:
//     [ position, position + placement.subL / pipe.subL ]
// Two placements collide iff their intervals overlap.

import { findSlot } from '../src/beamline/pipe-placements.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

let idCounter = 0;
function idGen() { idCounter++; return 'pl_test_' + idCounter; }

function makePipe(subL, placements = []) {
  return {
    id: 'bp_1',
    start: null,
    end: null,
    path: [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    subL,
    placements,
  };
}

// ==========================================================================
// Test 1: snap on empty pipe.
// ==========================================================================
console.log('\n--- Test 1: snap on empty pipe ---');
{
  const pipe = makePipe(20, []);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.5,
    subL: 2,
    mode: 'snap',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 1, `one placement (got ${res.placements.length})`);
    assert(approx(res.placements[0].position, 0.5),
      `position=0.5 (got ${res.placements[0].position})`);
    assert(res.placements[0].type === 'buncher', 'type=buncher');
    assert(res.placements[0].subL === 2, 'subL=2');
    assert(typeof res.placements[0].id === 'string', 'id assigned');
    // Caller's pipe.placements unchanged (purity).
    assert(pipe.placements.length === 0, 'input pipe.placements not mutated');
  }
}

// ==========================================================================
// Test 2: snap finds a free drift past an existing placement.
// ==========================================================================
console.log('\n--- Test 2: snap finds free drift at 0.5 ---');
{
  // Pipe length subL=20 → existing at position 0.2 subL=2 occupies [0.2..0.3].
  const pipe = makePipe(20, [
    { id: 'p0', type: 'bpm', position: 0.2, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.5,
    subL: 2,
    mode: 'snap',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 2, `two placements (got ${res.placements.length})`);
    assert(approx(res.placements[0].position, 0.2),
      `first pos 0.2 (got ${res.placements[0].position})`);
    assert(res.placements[0].id === 'p0', 'existing placement preserved');
    assert(approx(res.placements[1].position, 0.5),
      `second pos 0.5 (got ${res.placements[1].position})`);
    assert(res.placements[1].type === 'buncher', 'new type=buncher');
  }
}

// ==========================================================================
// Test 3: snap rejects when request overlaps and no free slot fits.
// ==========================================================================
console.log('\n--- Test 3: snap rejects overlap when no room ---');
{
  // Pipe fully filled with two subL=2 placements. Pipe subL=4 → capacity 4.
  const pipe = makePipe(4, [
    { id: 'p0', type: 'bpm', position: 0.0,  subL: 2, params: {} }, // [0..0.5]
    { id: 'p1', type: 'bpm', position: 0.5,  subL: 2, params: {} }, // [0.5..1.0]
  ]);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.25,
    subL: 2,
    mode: 'snap',
    idGenerator: idGen,
  });
  assert(res && res.ok === false, `ok=false (got ${JSON.stringify(res)})`);
  assert(res.reason === 'overlap' || res.reason === 'full',
    `reason=overlap/full (got ${res.reason})`);
}

// ==========================================================================
// Test 4: replace swaps type at same position (equal subL).
// ==========================================================================
console.log('\n--- Test 4: replace buncher with pillboxCavity (same subL) ---');
{
  const pipe = makePipe(20, [
    { id: 'p0', type: 'buncher', position: 0.5, subL: 2, params: { phase: 0.5 } },
  ]);
  const res = findSlot(pipe, {
    type: 'pillboxCavity',
    requestedPosition: 0.5,   // any position inside [0.5..0.6]
    subL: 2,
    mode: 'replace',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 1, `one placement (got ${res.placements.length})`);
    assert(res.placements[0].type === 'pillboxCavity', 'type replaced');
    assert(approx(res.placements[0].position, 0.5),
      `position preserved 0.5 (got ${res.placements[0].position})`);
    assert(res.placements[0].id !== 'p0', 'fresh id assigned');
    assert(res.placements[0].subL === 2, 'subL=2');
  }
}

// ==========================================================================
// Test 5: replace with larger subL shifts neighbors if possible.
// ==========================================================================
console.log('\n--- Test 5: replace buncher subL=2 with rfCavity subL=6 ---');
{
  // pipe.subL = 40 → interval fraction per sub-unit = 1/40 = 0.025.
  // existing placements: buncher [0.5..0.55] (subL=2); no neighbors close by.
  // New rfCavity subL=6 → fraction 6/40 = 0.15.
  // Centered at buncher's center (0.525) → new interval
  //   [0.525 - 0.075, 0.525 + 0.075] = [0.45, 0.60]. Fits inside [0,1], no neighbors.
  const pipe = makePipe(40, [
    { id: 'p_bunch', type: 'buncher', position: 0.5, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'rfCavity',
    requestedPosition: 0.52,  // anywhere inside the buncher interval
    subL: 6,
    mode: 'replace',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 1, `one placement (got ${res.placements.length})`);
    assert(res.placements[0].type === 'rfCavity', 'type=rfCavity');
    assert(res.placements[0].subL === 6, 'subL=6');
    // Replacement kept centered on the old center (0.5 + 2/80 = 0.525), so
    // new position = 0.525 - 6/80 = 0.45.
    assert(approx(res.placements[0].position, 0.45),
      `position=0.45 (got ${res.placements[0].position})`);
  }
}

// Replace with larger, neighbor in the way, need shift.
console.log('--- Test 5b: replace with larger; neighbor nudges ---');
{
  // pipe.subL = 20, fraction per sub-unit = 0.05.
  // existing: [ buncher @0.50 subL=2 (→[0.50..0.60]), bpm @0.62 subL=2 (→[0.62..0.72]) ].
  // Replacing buncher with rfCavity subL=6 centered at 0.55 → new interval
  //   [0.55 - 0.15, 0.55 + 0.15] = [0.40, 0.70] overlaps bpm (0.62..0.72).
  // Neighbor bpm must shift right to 0.70 (interval 0.70..0.80).
  const pipe = makePipe(20, [
    { id: 'p_b', type: 'buncher', position: 0.50, subL: 2, params: {} },
    { id: 'p_m', type: 'bpm',     position: 0.62, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'rfCavity',
    requestedPosition: 0.55,
    subL: 6,
    mode: 'replace',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true after neighbor shift (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 2, `two placements (got ${res.placements.length})`);
    const rf = res.placements.find(p => p.type === 'rfCavity');
    const bpm = res.placements.find(p => p.type === 'bpm');
    assert(!!rf && !!bpm, 'both present');
    if (rf && bpm) {
      assert(approx(rf.position, 0.40),
        `rfCavity pos=0.40 (got ${rf.position})`);
      assert(bpm.position >= 0.70 - 1e-6,
        `bpm shifted right ≥0.70 (got ${bpm.position})`);
    }
  }
}

// ==========================================================================
// Test 6: insert shifts neighbors outward to make room.
// ==========================================================================
console.log('\n--- Test 6: insert shifts neighbors outward ---');
{
  // pipe.subL = 40. fraction per sub-unit = 1/40 = 0.025.
  // existing: [bpm@0.2 subL=2 (→[0.2..0.25]), bpm@0.6 subL=2 (→[0.6..0.65])].
  // insert new subL=4 at center 0.4 → half-width = 4/(2*40) = 0.05.
  // new interval = [0.35 .. 0.45]. Does not collide yet, but "insert" shifts
  // outward regardless. Left neighbor (0.2..0.25) has right edge 0.25 <
  // new left edge 0.35, so it is safe. Right neighbor starts at 0.6, safe.
  // Expected order: [left, new, right]; left should still be at 0.2, right at 0.6
  // (no shift needed in this particular layout).
  const pipe = makePipe(40, [
    { id: 'p_l', type: 'bpm', position: 0.2, subL: 2, params: {} },
    { id: 'p_r', type: 'bpm', position: 0.6, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.4,
    subL: 4,
    mode: 'insert',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 3, `three placements (got ${res.placements.length})`);
    // Order by position: left, new, right.
    const sorted = [...res.placements].sort((a, b) => a.position - b.position);
    assert(sorted[0].type === 'bpm' && sorted[0].id === 'p_l',
      `first = left bpm (got ${sorted[0].type}/${sorted[0].id})`);
    assert(sorted[1].type === 'buncher',
      `middle = new buncher (got ${sorted[1].type})`);
    assert(sorted[2].type === 'bpm' && sorted[2].id === 'p_r',
      `last = right bpm (got ${sorted[2].type}/${sorted[2].id})`);
    // Middle is centered on requestedPosition: its interval centered on 0.4
    //   → position = 0.4 - 4/(2*40) = 0.35.
    assert(approx(sorted[1].position, 0.35),
      `new pos=0.35 (got ${sorted[1].position})`);
  }
}

// Insert with tight layout that forces neighbor shift.
console.log('--- Test 6b: insert forces neighbor shift ---');
{
  // pipe.subL = 20. fraction per sub-unit = 0.05.
  // existing: [bpm@0.40 subL=2 (→[0.40..0.50]), bpm@0.50 subL=2 (→[0.50..0.60])].
  // Insert new subL=2 at 0.50 → half-width = 0.05; new interval [0.45..0.55].
  // Overlaps both neighbors. Shift outward by 2/20 = 0.1: left bpm @ 0.30,
  // right bpm @ 0.60. New placement at 0.45..0.55.
  const pipe = makePipe(20, [
    { id: 'p_l', type: 'bpm', position: 0.40, subL: 2, params: {} },
    { id: 'p_r', type: 'bpm', position: 0.50, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.50,
    subL: 2,
    mode: 'insert',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true shift (got ${JSON.stringify(res)})`);
  if (res.ok) {
    assert(res.placements.length === 3, `three placements (got ${res.placements.length})`);
    const sorted = [...res.placements].sort((a, b) => a.position - b.position);
    assert(sorted[0].id === 'p_l', 'first = left');
    assert(sorted[1].type === 'buncher', 'middle = new');
    assert(sorted[2].id === 'p_r', 'last = right');
    assert(sorted[0].position <= 0.35 + 1e-6,
      `left ≤0.35 (got ${sorted[0].position})`);
    assert(sorted[2].position >= 0.55 - 1e-6,
      `right ≥0.55 (got ${sorted[2].position})`);
  }
}

// ==========================================================================
// Test 7: insert rejects when no room.
// ==========================================================================
console.log('\n--- Test 7: insert rejects when pipe full ---');
{
  // pipe.subL=4, two subL=2 placements fill it completely.
  const pipe = makePipe(4, [
    { id: 'p0', type: 'bpm', position: 0.0, subL: 2, params: {} },
    { id: 'p1', type: 'bpm', position: 0.5, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.5,
    subL: 2,
    mode: 'insert',
    idGenerator: idGen,
  });
  assert(res && res.ok === false, `ok=false (got ${JSON.stringify(res)})`);
  assert(res.reason === 'full' || res.reason === 'overlap',
    `reason=full/overlap (got ${res.reason})`);
}

// ==========================================================================
// Test 8: order preserved by position.
// ==========================================================================
console.log('\n--- Test 8: result is always sorted by position ---');
{
  // Insert a placement somewhere that requires snap; result must be sorted.
  const pipe = makePipe(40, [
    { id: 'p_a', type: 'bpm', position: 0.8, subL: 2, params: {} },
    { id: 'p_b', type: 'bpm', position: 0.1, subL: 2, params: {} },
  ]);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.4,
    subL: 2,
    mode: 'snap',
    idGenerator: idGen,
  });
  assert(res && res.ok === true, `ok=true`);
  if (res.ok) {
    assert(res.placements.length === 3, 'three placements');
    for (let i = 0; i + 1 < res.placements.length; i++) {
      assert(res.placements[i].position <= res.placements[i + 1].position,
        `pos[${i}] ≤ pos[${i + 1}]`);
    }
  }
}

// Replace with nothing at requestedPosition → nothing_to_replace.
console.log('\n--- Extra: replace mode with nothing at position ---');
{
  const pipe = makePipe(20, []);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.5,
    subL: 2,
    mode: 'replace',
    idGenerator: idGen,
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'nothing_to_replace',
    `reason=nothing_to_replace (got ${res.reason})`);
}

// Invalid mode → invalid_mode.
console.log('\n--- Extra: invalid mode ---');
{
  const pipe = makePipe(20, []);
  const res = findSlot(pipe, {
    type: 'buncher',
    requestedPosition: 0.5,
    subL: 2,
    mode: 'bogus',
    idGenerator: idGen,
  });
  assert(res && res.ok === false, 'ok=false');
  assert(res.reason === 'invalid_mode',
    `reason=invalid_mode (got ${res.reason})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
