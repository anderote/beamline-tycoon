// test/test-beamline-system.js — integration tests for src/beamline/BeamlineSystem.js
//
// BeamlineSystem is a thin facade over the pure validators in junctions.js,
// pipe-drawing.js, and pipe-placements.js. It mutates state and emits events
// on success; logs and returns null on failure.
//
// Test cases:
//   1. placeJunction({type:'source', ...}) → junction in state.placeables.
//   2. drawPipe(start, null, path) → pipe in state.beamPipes w/ correct refs.
//   3. placeOnPipe(pipeId, {buncher, 0.5, 'snap'}) → placement on pipe.
//   4. Flattener walks: source → pipe (w/ buncher) → open end; flat includes buncher.
//   5. removeJunction(srcId) → pipe stays, pipe.start === null, placement intact.
//   6. removePipe(pipeId) → pipe gone, placements gone.
//   7. drawPipe rejects a corner path (delegates to pipe-drawing).
//   8. placeOnPipe('insert') against a full pipe returns null (delegates).

import { BeamlineSystem } from '../src/beamline/BeamlineSystem.js';
import { flattenPath } from '../src/beamline/flattener.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Mock Game.js environment.
//
// placePlaceable is the callback Game.js supplies: it handles footprint and
// collision checks. For tests we just append a stub placeable with the id and
// required fields, matching the junction call shape.
// ---------------------------------------------------------------------------
function mockSystem() {
  const state = { placeables: [], beamPipes: [] };
  let pipeCtr = 0, plCtr = 0, placeableCtr = 0;
  const events = [];
  const logs = [];

  const emit = (ev, data) => { events.push({ ev, data }); };
  const log = (msg, type) => { logs.push({ msg, type }); };
  const placePlaceable = (opts) => {
    const id = 'j_' + (++placeableCtr);
    state.placeables.push({
      id,
      type: opts.type,
      category: 'beamline',
      col: opts.col || 0,
      row: opts.row || 0,
      subCol: opts.subCol || 0,
      subRow: opts.subRow || 0,
      dir: opts.dir || 0,
      params: opts.params || {},
      cells: [],
    });
    return id;
  };
  const removePlaceable = (id) => {
    const before = state.placeables.length;
    state.placeables = state.placeables.filter(p => p.id !== id);
    return state.placeables.length < before;
  };

  const system = new BeamlineSystem({
    state,
    emit,
    log,
    spend: () => {},
    placePlaceable,
    removePlaceable,
    nextPipeId: () => 'bp_' + (++pipeCtr),
    nextPlacementId: () => 'pl_' + (++plCtr),
    canAfford: () => true,
  });
  return { system, state, events, logs };
}

// ==========================================================================
// Test 1: placeJunction appends a junction placeable.
// ==========================================================================
console.log('\n--- Test 1: placeJunction registers a source ---');
{
  const { system, state, events } = mockSystem();
  const id = system.placeJunction({
    type: 'source', col: 2, row: 2, subCol: 0, subRow: 0, dir: 0,
  });
  assert(typeof id === 'string' && id.length > 0, `id returned (got ${id})`);
  assert(state.placeables.length === 1, `one placeable (got ${state.placeables.length})`);
  assert(state.placeables[0].id === id, 'placeable id matches');
  assert(state.placeables[0].type === 'source', 'placeable.type === source');
  assert(state.placeables[0].col === 2 && state.placeables[0].row === 2,
    'col/row stored');
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
  assert(events.some(e => e.ev === 'placeableChanged'), 'emits placeableChanged');
}

// ==========================================================================
// Test 2: drawPipe adds pipe to state.beamPipes with correct refs.
// ==========================================================================
console.log('\n--- Test 2: drawPipe with open end ---');
{
  const { system, state, events } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });

  events.length = 0;
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' },
    null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }]
  );

  assert(typeof pipeId === 'string' && pipeId.length > 0,
    `pipeId returned (got ${pipeId})`);
  assert(state.beamPipes.length === 1, `one pipe (got ${state.beamPipes.length})`);
  const pipe = state.beamPipes[0];
  assert(pipe.id === pipeId, 'pipe.id matches returned id');
  assert(pipe.start && pipe.start.junctionId === srcId && pipe.start.portName === 'exit',
    'pipe.start ref correct');
  assert(pipe.end === null, 'pipe.end === null');
  assert(Array.isArray(pipe.path) && pipe.path.length === 2, 'path preserved');
  assert(pipe.subL === 16, `subL === 16 (got ${pipe.subL})`);
  assert(Array.isArray(pipe.placements) && pipe.placements.length === 0,
    'placements === []');
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
}

// ==========================================================================
// Test 3: placeOnPipe adds placement in snap mode.
// ==========================================================================
console.log('\n--- Test 3: placeOnPipe snap adds buncher ---');
{
  const { system, state, events } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }]
  );

  events.length = 0;
  const plId = system.placeOnPipe(pipeId, {
    type: 'buncher', position: 0.5, mode: 'snap',
  });

  assert(typeof plId === 'string' && plId.length > 0,
    `plId returned (got ${plId})`);
  const pipe = state.beamPipes.find(p => p.id === pipeId);
  assert(pipe.placements.length === 1, `one placement (got ${pipe.placements.length})`);
  const pl = pipe.placements[0];
  assert(pl.id === plId, 'placement.id === returned id');
  assert(pl.type === 'buncher', 'type === buncher');
  assert(Math.abs(pl.position - 0.5) < 1e-9, `position === 0.5 (got ${pl.position})`);
  assert(pl.subL === 2, `subL defaults to COMPONENTS.buncher.subL (got ${pl.subL})`);
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
}

// ==========================================================================
// Test 4: flattener walks source → pipe (w/ buncher) → open end.
// ==========================================================================
console.log('\n--- Test 4: flattener sees placement from system-built graph ---');
{
  const { system, state } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }]
  );
  system.placeOnPipe(pipeId, { type: 'buncher', position: 0.5, mode: 'snap' });

  const flat = flattenPath(state, srcId);
  // Expected: source (module) → drift → buncher (placement) → drift.
  assert(flat.length >= 3, `flat length >=3 (got ${flat.length})`);
  assert(flat[0].kind === 'module' && flat[0].id === srcId,
    '[0] module = source');
  const hasBuncher = flat.some(e => e.kind === 'placement' && e.type === 'buncher');
  assert(hasBuncher, 'flat includes buncher placement');
  // Drifts on either side of the buncher (open end stops the walk after tail drift).
  const drifts = flat.filter(e => e.kind === 'drift');
  assert(drifts.length >= 2, `at least 2 drifts (got ${drifts.length})`);
}

// ==========================================================================
// Test 5: removeJunction opens pipe, preserves pipe + placements.
// ==========================================================================
console.log('\n--- Test 5: removeJunction opens pipe end ---');
{
  const { system, state } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }]
  );
  const plId = system.placeOnPipe(pipeId, {
    type: 'buncher', position: 0.5, mode: 'snap',
  });

  system.removeJunction(srcId);

  assert(!state.placeables.some(p => p.id === srcId),
    'source removed from placeables');
  assert(state.beamPipes.length === 1, 'pipe still exists');
  const pipe = state.beamPipes[0];
  assert(pipe.start === null, 'pipe.start === null after junction removal');
  assert(pipe.placements.length === 1 && pipe.placements[0].id === plId,
    'placement preserved');
}

// ==========================================================================
// Test 6: removePipe drops pipe + placements.
// ==========================================================================
console.log('\n--- Test 6: removePipe drops pipe + placements ---');
{
  const { system, state, events } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }]
  );
  system.placeOnPipe(pipeId, { type: 'buncher', position: 0.5, mode: 'snap' });

  events.length = 0;
  system.removePipe(pipeId);

  assert(state.beamPipes.length === 0, 'pipe gone');
  assert(events.some(e => e.ev === 'beamlineChanged'), 'emits beamlineChanged');
  // Source should remain.
  assert(state.placeables.some(p => p.id === srcId), 'source remains');
}

// ==========================================================================
// Test 7: drawPipe rejects a corner path (delegates to pipe-drawing).
// ==========================================================================
console.log('\n--- Test 7: drawPipe rejects corner path ---');
{
  const { system, logs } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });

  logs.length = 0;
  const result = system.drawPipe(
    { junctionId: srcId, portName: 'exit' },
    null,
    [{ col: 2, row: 4 }, { col: 2, row: 8 }, { col: 6, row: 8 }]
  );

  assert(result === null, `returns null (got ${result})`);
  assert(logs.length >= 1 && logs[0].type === 'bad',
    `log called with 'bad' type (got ${logs.length ? logs[0].type : 'no logs'})`);
}

// ==========================================================================
// Test 8: placeOnPipe 'insert' on a full pipe returns null.
// ==========================================================================
console.log('\n--- Test 8: placeOnPipe insert on full pipe returns null ---');
{
  const { system, state, logs } = mockSystem();
  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  // Short pipe (subL=4 → exactly 1 m in length fractions: 2+2 = full).
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 5 }]  // dist=1 tile → subL=4
  );
  assert(pipeId != null, 'pipe created');
  const pipe = state.beamPipes.find(p => p.id === pipeId);
  assert(pipe && pipe.subL === 4, `pipe.subL === 4 (got ${pipe && pipe.subL})`);

  // Fill with two buncher subL=2 placements to max out capacity.
  const a = system.placeOnPipe(pipeId, { type: 'buncher', position: 0.0, mode: 'snap' });
  const b = system.placeOnPipe(pipeId, { type: 'buncher', position: 0.5, mode: 'snap' });
  assert(a != null && b != null, 'pipe filled with two subL=2 placements');

  logs.length = 0;
  const result = system.placeOnPipe(pipeId, {
    type: 'buncher', position: 0.5, mode: 'insert',
  });

  assert(result === null, `returns null (got ${result})`);
  assert(logs.length >= 1 && logs[0].type === 'bad',
    `log called with 'bad' (got ${logs.length ? logs[0].type : 'no logs'})`);
}

// ==========================================================================
// Test 9: drawPipe charges funding and rejects when unaffordable.
// ==========================================================================
console.log('\n--- Test 9: drawPipe charges cost and rejects when unaffordable ---');
{
  // Mirror mockSystem but wire up canAfford/spend against a real funding ledger.
  // Budget = drift cost × 2 = 20000 — enough for one 1-tile pipe, not two.
  const DRIFT_COST = 10000;
  const state = { placeables: [], beamPipes: [], resources: { funding: DRIFT_COST * 2 } };
  let pipeCtr = 0, plCtr = 0, placeableCtr = 0;
  const logs = [];
  const placePlaceable = (opts) => {
    const id = 'j_' + (++placeableCtr);
    state.placeables.push({
      id, type: opts.type, category: 'beamline',
      col: opts.col || 0, row: opts.row || 0,
      subCol: opts.subCol || 0, subRow: opts.subRow || 0,
      dir: opts.dir || 0, params: opts.params || {}, cells: [],
    });
    return id;
  };
  const system = new BeamlineSystem({
    state,
    emit: () => {},
    log: (msg, type) => logs.push({ msg, type }),
    spend: (c) => { for (const [r, a] of Object.entries(c)) state.resources[r] -= a; },
    canAfford: (c) => Object.entries(c).every(([r, a]) => (state.resources[r] || 0) >= a),
    placePlaceable,
    nextPipeId: () => 'bp_' + (++pipeCtr),
    nextPlacementId: () => 'pl_' + (++plCtr),
  });

  // Two independent sources so the second draw doesn't hit port_taken.
  const srcA = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  const srcB = system.placeJunction({ type: 'source', col: 10, row: 10, dir: 0 });

  // First pipe: 1 tile long → cost = DRIFT_COST × 1 = 10000. Should succeed.
  const startFunding = state.resources.funding;
  const pipeA = system.drawPipe(
    { junctionId: srcA, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 5 }],
  );
  assert(pipeA != null, `first pipe drawn (got ${pipeA})`);
  assert(state.resources.funding === startFunding - DRIFT_COST,
    `funding dropped by drift cost (got ${state.resources.funding}, expected ${startFunding - DRIFT_COST})`);

  // Second pipe: 2 tiles long → cost = DRIFT_COST × 2 = 20000, but we only have
  // 10000 left. Should reject with a "Can't afford" log and not mutate state.
  logs.length = 0;
  const fundingBefore = state.resources.funding;
  const pipesBefore = state.beamPipes.length;
  const pipeB = system.drawPipe(
    { junctionId: srcB, portName: 'exit' }, null,
    [{ col: 10, row: 12 }, { col: 10, row: 14 }],
  );
  assert(pipeB === null, `second pipe rejected (got ${pipeB})`);
  assert(state.resources.funding === fundingBefore, 'funding unchanged on rejection');
  assert(state.beamPipes.length === pipesBefore, 'pipe count unchanged on rejection');
  assert(logs.some(l => l.type === 'bad' && /afford/i.test(l.msg)),
    `afford rejection logged (got ${JSON.stringify(logs)})`);
}

// ==========================================================================
// Test 10: extendPipe charges only the added length, not the merged pipe.
// ==========================================================================
console.log('\n--- Test 10: extendPipe charges only the added length ---');
{
  const DRIFT_COST = 10000;
  const state = { placeables: [], beamPipes: [], resources: { funding: DRIFT_COST * 10 } };
  let pipeCtr = 0, plCtr = 0, placeableCtr = 0;
  const placePlaceable = (opts) => {
    const id = 'j_' + (++placeableCtr);
    state.placeables.push({
      id, type: opts.type, category: 'beamline',
      col: opts.col || 0, row: opts.row || 0,
      subCol: opts.subCol || 0, subRow: opts.subRow || 0,
      dir: opts.dir || 0, params: opts.params || {}, cells: [],
    });
    return id;
  };
  const system = new BeamlineSystem({
    state,
    emit: () => {},
    log: () => {},
    spend: (c) => { for (const [r, a] of Object.entries(c)) state.resources[r] -= a; },
    canAfford: (c) => Object.entries(c).every(([r, a]) => (state.resources[r] || 0) >= a),
    placePlaceable,
    nextPipeId: () => 'bp_' + (++pipeCtr),
    nextPlacementId: () => 'pl_' + (++plCtr),
  });

  const srcId = system.placeJunction({ type: 'source', col: 2, row: 2, dir: 0 });
  const fundingAtStart = state.resources.funding;
  const pipeId = system.drawPipe(
    { junctionId: srcId, portName: 'exit' }, null,
    [{ col: 2, row: 4 }, { col: 2, row: 5 }],
  );
  assert(pipeId != null, 'base pipe drawn');
  const fundingAfterDraw = state.resources.funding;
  assert(fundingAtStart - fundingAfterDraw === DRIFT_COST, 'initial 1-tile pipe charged 1× drift');

  // Extend by 2 more tiles → should cost 2× drift, not 3× (the merged length).
  const extended = system.extendPipe(pipeId, [{ col: 2, row: 5 }, { col: 2, row: 7 }]);
  assert(extended != null, 'extend succeeded');
  assert(fundingAfterDraw - state.resources.funding === DRIFT_COST * 2,
    `extend charged 2× drift only (got delta ${fundingAfterDraw - state.resources.funding})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
