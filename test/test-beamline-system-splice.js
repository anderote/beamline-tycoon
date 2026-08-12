// test/test-beamline-system-splice.js — BeamlineSystem.splitPipe / mergePipes /
// trimPipe, the mutation half of src/beamline/pipe-splice.js.
//
// The validators are covered by test/test-pipe-splice.js; what is under test
// here is everything the facade owns and the validators cannot:
//   - state.beamPipes actually changes, in the right place, with fresh pipe ids
//   - PLACEMENT ids survive a reshape. Placements are utility endpoints
//     (utility/utility-endpoints.js), so reissuing one silently orphans every
//     line wired to that hardware — in state and in every save.
//   - a rejected op is a no-op: null returned, state byte-identical, and the
//     player told in English rather than shown a reason code
//   - trim refunds through pipeRefund(), the same function the demolish hover
//     tooltip quotes from
//
// Fixture geometry throughout: vertical runs at col 2, 4 sub-units per tile.

import { BeamlineSystem, pipeCost, pipeRefund } from '../src/beamline/BeamlineSystem.js';

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

function pl(id, type, position, subL) {
  return { id, type, position, subL, params: {} };
}
function ref(junctionId, portName) { return { junctionId, portName }; }

/**
 * A system wired to a hand-built pipe list. Fresh ids use an 'np_' prefix so a
 * generated id can never collide with a fixture id — an accidental collision
 * would make "the split produced new pipes" pass for the wrong reason.
 */
function mockSystem(pipes, funding = 1000000) {
  const state = { placeables: [], beamPipes: pipes, resources: { funding } };
  const events = [];
  const logs = [];
  const releasedPlacements = [];
  let ctr = 0;
  const system = new BeamlineSystem({
    state,
    emit: (ev, data) => events.push({ ev, data }),
    log: (msg, type) => logs.push({ msg, type }),
    spend: (c) => { for (const [r, a] of Object.entries(c)) state.resources[r] -= a; },
    canAfford: (c) => Object.entries(c).every(([r, a]) => (state.resources[r] || 0) >= a),
    onPlacementRemoved: (id) => releasedPlacements.push(id),
    nextPipeId: () => 'np_' + (++ctr),
    nextPlacementId: () => 'npl_' + (++ctr),
  });
  return { system, state, events, logs, releasedPlacements };
}

const snap = (state) => JSON.stringify(state);

// A pipe running col 2, row 4 → row 12: 8 tiles, subL 32.
function longPipe(overrides = {}) {
  return {
    id: 'bp_1',
    start: overrides.start !== undefined ? overrides.start : ref('src_1', 'exit'),
    end: overrides.end !== undefined ? overrides.end : ref('end_1', 'entry'),
    path: [{ col: 2, row: 4 }, { col: 2, row: 12 }],
    subL: 32,
    placements: overrides.placements || [],
  };
}
// An unrelated run elsewhere on the map: nothing may touch it.
function bystanderPipe() {
  return {
    id: 'bp_other', start: null, end: null,
    path: [{ col: 20, row: 4 }, { col: 20, row: 8 }], subL: 16, placements: [],
  };
}

// ==========================================================================
// SPLIT
// ==========================================================================

console.log('\n--- Split 1: happy path replaces one pipe with two ---');
{
  // Placements at sub-units 4..8 and 20..24. Cut at 12/32 with a 4-sub gap →
  // head 12 (rows 4..7), hole rows 7..8, tail 16 (rows 8..12).
  const original = longPipe({
    placements: [pl('pl_a', 'quadrupole', 0.125, 4), pl('pl_b', 'bpm', 0.625, 4)],
  });
  const { system, state, events, releasedPlacements } =
    mockSystem([original, bystanderPipe()]);

  events.length = 0;
  const res = system.splitPipe('bp_1', 0.375, 4);

  assert(res && typeof res === 'object', `returns an object (got ${JSON.stringify(res)})`);
  assert(state.beamPipes.length === 3,
    `one pipe became two, bystander intact (got ${state.beamPipes.length})`);
  assert(!state.beamPipes.some(p => p.id === 'bp_1'), 'original pipe id is gone');

  const head = state.beamPipes.find(p => p.id === res.headPipeId);
  const tail = state.beamPipes.find(p => p.id === res.tailPipeId);
  assert(!!head && !!tail, 'both stubs are in state.beamPipes');

  // Ordering: the stubs take the original's slot, ahead of the bystander.
  assert(state.beamPipes[0].id === res.headPipeId
      && state.beamPipes[1].id === res.tailPipeId
      && state.beamPipes[2].id === 'bp_other',
    'stubs spliced into the original pipe\'s position in state.beamPipes');

  // --- id freshness ---
  assert(res.headPipeId !== 'bp_1' && res.tailPipeId !== 'bp_1',
    `both stub ids are fresh (got ${res.headPipeId} / ${res.tailPipeId})`);
  assert(res.headPipeId !== res.tailPipeId, 'the two stubs have distinct ids');

  // --- geometry ---
  assert(head.subL === 12, `head subL === 12 (got ${head.subL})`);
  assert(tail.subL === 16, `tail subL === 16 (got ${tail.subL})`);
  assertPoint(head.path[0], 2, 4, 'head path[0]');
  assertPoint(head.path[1], 2, 7, 'head path[1]');
  assertPoint(tail.path[0], 2, 8, 'tail path[0]');
  assertPoint(tail.path[1], 2, 12, 'tail path[1]');
  assertPoint(res.gapCenter, 2, 7.5, 'gapCenter (where the junction goes)');

  // --- endpoint references ---
  assert(head.start && head.start.junctionId === 'src_1', 'head inherits the original start');
  assert(head.end === null, 'head inner end is open for the new junction');
  assert(tail.start === null, 'tail inner end is open for the new junction');
  assert(tail.end && tail.end.junctionId === 'end_1', 'tail inherits the original end');

  // --- placement ids survive, positions remapped ---
  assert(head.placements.length === 1 && head.placements[0].id === 'pl_a',
    'pl_a keeps its id on the head stub');
  assert(tail.placements.length === 1 && tail.placements[0].id === 'pl_b',
    'pl_b keeps its id on the tail stub');
  assertApprox(head.placements[0].position * head.subL, 4,
    'pl_a still 4 sub-units from the run head (absolute position preserved)');
  assertApprox(tail.placements[0].position * tail.subL + 12 + 4, 20,
    'pl_b still 20 sub-units from the original head (absolute position preserved)');
  assert(head.placements[0].type === 'quadrupole' && tail.placements[0].type === 'bpm',
    'placement types carried across');

  // Nothing was dropped, so nothing may be released: a spurious release would
  // tear down utility lines on hardware that is still standing.
  assert(releasedPlacements.length === 0,
    `no placement released (got ${JSON.stringify(releasedPlacements)})`);
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
}

console.log('\n--- Split 2: rejection leaves state untouched ---');
{
  // pl_b occupies sub-units 20..24; a gap at 18..22 lands on top of it.
  const { system, state, logs, events } =
    mockSystem([longPipe({ placements: [pl('pl_b', 'bpm', 0.625, 4)] })]);
  const before = snap(state);

  logs.length = 0; events.length = 0;
  const res = system.splitPipe('bp_1', 18 / 32, 4);

  assert(res === null, `placement_in_gap → null (got ${JSON.stringify(res)})`);
  assert(snap(state) === before, 'state unchanged after placement_in_gap');
  assert(events.length === 0, 'no event emitted on rejection');
  assert(logs.length === 1 && logs[0].type === 'bad', 'logged once as bad');
  assert(!/placement_in_gap/.test(logs[0].msg),
    `log reads as English, not a reason code (got "${logs[0].msg}")`);
}

console.log('\n--- Split 3: other rejections are no-ops too ---');
{
  const { system, state, logs } = mockSystem([longPipe()]);
  const before = snap(state);

  for (const [label, args] of [
    ['unknown pipe', ['nope', 0.5, 4]],
    ['cut at the very start', ['bp_1', 0, 4]],
    ['gap wider than the pipe', ['bp_1', 0.5, 40]],
    ['fractional gap', ['bp_1', 0.5, 2.5]],
  ]) {
    logs.length = 0;
    const res = system.splitPipe(...args);
    assert(res === null, `${label} → null (got ${JSON.stringify(res)})`);
    assert(snap(state) === before, `${label} → state unchanged`);
    assert(logs.length === 1 && logs[0].type === 'bad' && !/_/.test(logs[0].msg.split(': ')[1] || ''),
      `${label} → one English 'bad' log (got "${logs.length ? logs[0].msg : 'none'}")`);
  }
}

// ==========================================================================
// MERGE
// ==========================================================================

// bp_a: rows 4..8 (subL 16), ending at junction j1.
// bp_b: rows 9..13 (subL 16), starting at j1. The 1-tile hole between them is
// j1's footprint, which the merged run swallows → merged subL 36.
function mergeFixture() {
  return [
    {
      id: 'bp_a', start: ref('src_1', 'exit'), end: ref('j1', 'entry'),
      path: [{ col: 2, row: 4 }, { col: 2, row: 8 }], subL: 16,
      placements: [pl('pl_a', 'quadrupole', 0.5, 4)],
    },
    {
      id: 'bp_b', start: ref('j1', 'exit'), end: ref('end_1', 'entry'),
      path: [{ col: 2, row: 9 }, { col: 2, row: 13 }], subL: 16,
      placements: [pl('pl_b', 'bpm', 0.25, 4)],
    },
  ];
}

console.log('\n--- Merge 1: happy path collapses two pipes into A ---');
{
  const { system, state, events, releasedPlacements } =
    mockSystem([...mergeFixture(), bystanderPipe()]);

  events.length = 0;
  const id = system.mergePipes('bp_a', 'bp_b');

  // Id reuse is the documented contract: merge is extendPipe's sibling, so the
  // pipe reference the caller already holds keeps resolving.
  assert(id === 'bp_a', `returns the A-side id (got ${id})`);
  assert(state.beamPipes.length === 2,
    `two pipes became one, bystander intact (got ${state.beamPipes.length})`);
  assert(!state.beamPipes.some(p => p.id === 'bp_b'), 'bp_b is gone');

  const merged = state.beamPipes.find(p => p.id === 'bp_a');
  assert(merged.subL === 36,
    `merged subL === 36 — 9 tiles incl. the junction hole (got ${merged.subL})`);
  assertPoint(merged.path[0], 2, 4, 'merged path[0]');
  assertPoint(merged.path[1], 2, 13, 'merged path[1]');
  assert(merged.start && merged.start.junctionId === 'src_1', 'merged start = A\'s free end');
  assert(merged.end && merged.end.junctionId === 'end_1', 'merged end = B\'s free end');

  // --- placement ids survive from BOTH pipes ---
  const ids = merged.placements.map(p => p.id);
  assert(ids.length === 2 && ids.includes('pl_a') && ids.includes('pl_b'),
    `both placement ids preserved (got ${JSON.stringify(ids)})`);
  const remA = merged.placements.find(p => p.id === 'pl_a');
  const remB = merged.placements.find(p => p.id === 'pl_b');
  assertApprox(remA.position * merged.subL, 8, 'pl_a still 8 sub-units along the run');
  assertApprox(remB.position * merged.subL, 24, 'pl_b still 24 sub-units along the run');

  assert(releasedPlacements.length === 0,
    `no placement released by a merge (got ${JSON.stringify(releasedPlacements)})`);
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
}

console.log('\n--- Merge 2: B before A in state.beamPipes still drops the right pipe ---');
{
  // Reversed array order: filtering by a stale index would delete the merged
  // pipe instead of the absorbed one.
  const [a, b] = mergeFixture();
  const { system, state } = mockSystem([b, a]);
  const id = system.mergePipes('bp_a', 'bp_b');
  assert(id === 'bp_a', `returns bp_a (got ${id})`);
  assert(state.beamPipes.length === 1 && state.beamPipes[0].id === 'bp_a',
    `only the merged bp_a remains (got ${JSON.stringify(state.beamPipes.map(p => p.id))})`);
  assert(state.beamPipes[0].subL === 36, `merged geometry written (got ${state.beamPipes[0].subL})`);
}

console.log('\n--- Merge 3: rejection leaves state untouched ---');
{
  const a = {
    id: 'bp_a', start: null, end: null,
    path: [{ col: 2, row: 4 }, { col: 2, row: 8 }], subL: 16, placements: [],
  };
  const far = {
    id: 'bp_far', start: null, end: null,
    path: [{ col: 2, row: 20 }, { col: 2, row: 24 }], subL: 16, placements: [],
  };
  const perp = {
    id: 'bp_perp', start: null, end: null,
    path: [{ col: 3, row: 9 }, { col: 7, row: 9 }], subL: 16, placements: [],
  };
  const { system, state, logs, events } = mockSystem([a, far, perp]);
  const before = snap(state);

  for (const [label, args] of [
    ['collinear but disjoint', ['bp_a', 'bp_far']],
    ['perpendicular', ['bp_a', 'bp_perp']],
    ['unknown pipe', ['bp_a', 'nope']],
    ['a pipe with itself', ['bp_a', 'bp_a']],
  ]) {
    logs.length = 0; events.length = 0;
    const res = system.mergePipes(...args);
    assert(res === null, `${label} → null (got ${res})`);
    assert(snap(state) === before, `${label} → state unchanged`);
    assert(events.length === 0, `${label} → no event emitted`);
    assert(logs.length === 1 && logs[0].type === 'bad' && !/_/.test(logs[0].msg.split(': ')[1] || ''),
      `${label} → one English 'bad' log (got "${logs.length ? logs[0].msg : 'none'}")`);
  }
}

// ==========================================================================
// TRIM
// ==========================================================================

console.log('\n--- Trim 1: happy path from the open end, refunded at pipeRefund\'s rate ---');
{
  const { system, state, events } =
    mockSystem([longPipe({ end: null, placements: [pl('pl_x', 'bpm', 0.5, 4)] })], 500000);
  const fundingBefore = state.resources.funding;

  events.length = 0;
  const id = system.trimPipe('bp_1', 24);

  assert(id === 'bp_1', `returns the pipe id (got ${id})`);
  const pipe = state.beamPipes[0];
  assert(pipe.subL === 24, `subL === 24 (got ${pipe.subL})`);
  assertPoint(pipe.path[0], 2, 4, 'path[0] unchanged (head is anchored)');
  assertPoint(pipe.path[1], 2, 10, 'path[1] pulled back 2 tiles');
  assert(pipe.start && pipe.start.junctionId === 'src_1', 'start ref untouched');
  assert(pipe.end === null, 'open end stays open');

  assert(pipe.placements.length === 1 && pipe.placements[0].id === 'pl_x',
    'surviving placement keeps its id');
  assertApprox(pipe.placements[0].position * pipe.subL, 16,
    'placement still 16 sub-units from the head (absolute position preserved)');

  // The refund is the demolish quote for the 2 tiles that went away — same
  // function InputHandler._updateDemolishHover shows the player.
  const expected = pipeRefund({ path: [{ col: 2, row: 10 }, { col: 2, row: 12 }] });
  const credited = state.resources.funding - fundingBefore;
  assert(credited === expected,
    `credited pipeRefund of the offcut (got ${credited}, want ${expected})`);
  assert(credited === Math.floor(pipeCost(2).funding * 0.5),
    `refund is 50% of the 2-tile build cost (got ${credited})`);
  assert(credited > 0, `refund is non-zero (got ${credited})`);
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
}

console.log('\n--- Trim 2: trimming the open START shifts path[0] and still refunds ---');
{
  const { system, state } =
    mockSystem([longPipe({ start: null, placements: [pl('pl_y', 'bpm', 0.5, 4)] })], 500000);
  const fundingBefore = state.resources.funding;

  const id = system.trimPipe('bp_1', 24);
  assert(id === 'bp_1', `returns the pipe id (got ${id})`);
  const pipe = state.beamPipes[0];
  assertPoint(pipe.path[0], 2, 6, 'path[0] pushed forward 2 tiles');
  assertPoint(pipe.path[1], 2, 12, 'path[1] unchanged (tail is anchored)');
  assertApprox(pipe.placements[0].position * pipe.subL + 8, 16,
    'placement still 16 sub-units from the ORIGINAL head');
  assert(state.resources.funding - fundingBefore
      === pipeRefund({ path: [{ col: 2, row: 4 }, { col: 2, row: 6 }] }),
    'head-side offcut refunded at the same rate');
}

console.log('\n--- Trim 3: rejection leaves state and the ledger untouched ---');
{
  // Both ends attached → no_open_end; plus the length guards; plus a placement
  // sitting in the section that would be cut away.
  const { system, state, logs, events } = mockSystem([
    longPipe(),
    { ...longPipe({ end: null, placements: [pl('pl_x', 'bpm', 0.5, 4)] }), id: 'bp_open' },
  ], 500000);
  const before = snap(state);

  for (const [label, args] of [
    ['both ends attached', ['bp_1', 16]],
    ['unknown pipe', ['nope', 16]],
    ['longer than the pipe', ['bp_open', 40]],
    ['zero length', ['bp_open', 0]],
    ['fractional length', ['bp_open', 8.5]],
    ['placement in the offcut', ['bp_open', 16]],
  ]) {
    logs.length = 0; events.length = 0;
    const res = system.trimPipe(...args);
    assert(res === null, `${label} → null (got ${res})`);
    assert(snap(state) === before, `${label} → state and funding unchanged`);
    assert(events.length === 0, `${label} → no event emitted`);
    assert(logs.length === 1 && logs[0].type === 'bad' && !/_/.test(logs[0].msg.split(': ')[1] || ''),
      `${label} → one English 'bad' log (got "${logs.length ? logs[0].msg : 'none'}")`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
