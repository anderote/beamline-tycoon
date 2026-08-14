// test/test-beam-staffing-gate.js — the beam gate moves to seated operators
// (src/game/utility-gate.js: operatorCoverage, _unstaffedMessage, the
// beam_unstaffed blocker condition).
//
// Task 4 of the staff-professions-3 (jobs-and-gates) plan. The OLD gate
// asked "does ANY working operator exist anywhere in the facility" (plus a
// hidden mood==='stressed' && rng() < 0.3 coin flip). The new gate asks "is
// there an operator actually SEATED AT A CONSOLE, phase:'work' on a runBeam
// job, with enough combined coverage for how many beamlines this facility
// has" — deterministically, no rng anywhere.
//
// Scenarios (see task-4-brief.md's own list):
//   1. No operator at all -> blocked, message names hiring.
//   2. Operator hired, no Operator Console anywhere -> blocked, message
//      names the console.
//   3. Operator seated and working, one beamline -> not blocked.
//   4. Two beamlines, one green (skill 0) operator -> blocked, message names
//      the capacity shortfall with both numbers ("1 operator(s) cover(s) 2
//      beamline(s)").
//   5. Two beamlines, one operator with skills.operating >= 4 (coverage 2)
//      -> not blocked.
//   6. Operator's runBeam job is still phase:'travel' -> blocked, message
//      says they're on the way (not an error).
//   7. Operator eating/resting (the modern equivalent of the deleted
//      onBreak status) -> blocked, message names the break.
//   8. A real Operator Console sealed in a walled room with no door,
//      operator's fromNode outside it -> blocked, message names
//      reachability.
//   9. Determinism: the same state run through the gate twice (or many
//      times) produces byte-identical blockers — no Math.random anywhere in
//      the staffing path.

import { UtilityGate, operatorCoverage } from '../src/game/utility-gate.js';
import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ---------------------------------------------------------------------------
// Fixture plumbing — mirrors test-staff-stations.js / test-staff-nav.js's
// own hand-built-state pattern (plain objects shaped like Game.state, not a
// full Game instance).
// ---------------------------------------------------------------------------

function makeState(extra = {}) {
  return {
    tick: 0,
    infraOccupied: {}, wallOccupied: {}, doorOccupied: {}, subgridOccupied: {},
    placeableIndex: {}, placeables: [], zoneOccupied: {},
    stationReservations: {}, staffMembers: [], navRevision: 0,
    beamPipes: [], utilityLines: new Map(),
    infraBlockers: [], infraCanRun: true,
    ...extra,
  };
}

function floorRect(state, minCol, maxCol, minRow, maxRow, type = 'concrete') {
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) state.infraOccupied[`${c},${r}`] = type;
  }
}

// Walls the full perimeter of tile rectangle [c0,c1]x[r0,r1] — no door, so
// nothing inside is reachable from outside it. Same edge convention
// test-staff-nav.js's own sealed-chamber scenario uses.
function wallPerimeter(state, c0, c1, r0, r1) {
  const wall = (col, row, edge) => { state.wallOccupied[`${col},${row},${edge}`] = 'officeWall'; };
  for (let c = c0; c <= c1; c++) { wall(c, r0, 'n'); wall(c, r1, 's'); }
  for (let r = r0; r <= r1; r++) { wall(c0, r, 'w'); wall(c1, r, 'e'); }
}

let _nextId = 1;
function placeItem(state, type, col, row, subCol = 0, subRow = 0, dir = 0) {
  const def = PLACEABLES[type];
  const id = `${type}_${_nextId++}`;
  const cells = def.footprintCells(col, row, subCol, subRow, dir);
  const entry = { id, type, kind: def.kind, col, row, subCol, subRow, dir, cells };
  state.placeableIndex[id] = state.placeables.length;
  state.placeables.push(entry);
  for (const c of cells) {
    state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`] = { id, kind: def.kind };
  }
  return entry;
}

// A "beamline" for operatorCoverage's purposes: one source junction. Real
// component id ('source' — beamline-components.raw.js, isSource:true), but
// pushed as a bare record — no footprint/nav machinery needed since
// countBeamlines only reads `.type`.
function addBeamline(state, id) {
  state.placeables.push({ id, type: 'source', category: 'beamline' });
}

function makeOperator(overrides = {}) {
  return {
    id: overrides.id || 'op1',
    profession: 'operator',
    status: 'working',
    mood: 'content',
    skills: { operating: 0 },
    needs: { fatigue: 0.1, hunger: 0.1, morale: 0.6 },
    stats: {},
    job: null,
    ...overrides,
  };
}

const noopSolveRunner = { runSolve: () => ({ errors: [] }) };
const noopPorts = () => ({});

function makeGate(state) {
  return new UtilityGate({ state, solveRunner: noopSolveRunner, getPorts: noopPorts, rng: () => 0.99 });
}

function beamUnstaffed(state) {
  return (state.infraBlockers || []).find(b => b.code === 'beam_unstaffed');
}

// ==========================================================================
// 1. No operator at all.
// ==========================================================================
console.log('\n=== 1. No operator hired -> blocked, names hiring ===\n');
{
  const state = makeState();
  addBeamline(state, 'bl1');
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires with zero operators');
  assert(state.infraCanRun === false, 'infraCanRun false');
  assert(/hire/i.test(b?.message || ''), `message names hiring (got "${b?.message}")`);
}

// ==========================================================================
// 2. Operator hired, no console anywhere.
// ==========================================================================
console.log('\n=== 2. Operator hired but no console -> blocked, names the console ===\n');
{
  const state = makeState({ staffMembers: [makeOperator()] });
  addBeamline(state, 'bl1');
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires with no console built');
  assert(/console/i.test(b?.message || ''), `message names the console (got "${b?.message}")`);
}

// ==========================================================================
// 3. Operator seated and working, one beamline -> not blocked.
// ==========================================================================
console.log('\n=== 3. Operator seated + working, one beamline -> not blocked ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  assert(!beamUnstaffed(state), `no beam_unstaffed blocker (blockers: ${state.infraBlockers.map(b => b.code).join(',')})`);
  assert(state.infraCanRun === true, 'infraCanRun true');

  const cov = operatorCoverage(state);
  assert(cov.covered === true, 'operatorCoverage reports covered');
  assert(cov.capacity === 1, `a green operator's coverage is 1 (got ${cov.capacity})`);
}

// ==========================================================================
// 4/5. Two beamlines: undercovered (green operator) vs covered (skilled).
// ==========================================================================
console.log('\n=== 4. Two beamlines, one green operator -> blocked, names the shortfall ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  const op = makeOperator({
    skills: { operating: 0 },
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires: 1 unit of coverage against 2 beamlines');
  assert(/\b1\b/.test(b?.message || '') && /\b2\b/.test(b?.message || ''),
    `message names both numbers (got "${b?.message}")`);
  assert(/cover/i.test(b?.message || ''), `message uses "cover" (got "${b?.message}")`);
}

console.log('\n=== 5. Two beamlines, one operator with operating>=4 -> not blocked ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  addBeamline(state, 'bl2');
  const op = makeOperator({
    skills: { operating: 4 },
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'work', progress: 0,
    },
  });
  state.staffMembers = [op];
  const cov = operatorCoverage(state);
  assert(cov.capacity === 2, `1 + floor(4/4) = 2 (got ${cov.capacity})`);
  makeGate(state).run();
  assert(!beamUnstaffed(state), `no beam_unstaffed blocker (blockers: ${state.infraBlockers.map(b => b.code).join(',')})`);
  assert(state.infraCanRun === true, 'infraCanRun true');
}

// ==========================================================================
// 6. Operator's runBeam job is still phase:'travel'.
// ==========================================================================
console.log("\n=== 6. Operator in phase:'travel' -> blocked, says on the way ===\n");
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  const console_ = placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    fromNode: { col: 0, row: 0, subCol: 0, subRow: 0 },
    job: {
      jobType: 'runBeam', target: null, specialty: null,
      stationKey: `${console_.id}:0`, destNode: { col: 2, row: 1, subCol: 1, subRow: 3 },
      phase: 'travel', progress: 0,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires while still travelling');
  assert(/on (the |their )?way/i.test(b?.message || ''), `message says they're on the way (got "${b?.message}")`);
  assert(!/error/i.test(b?.message || ''), 'message does not read as an error');
}

// ==========================================================================
// 7. Operator eating/resting — the modern equivalent of the deleted onBreak
// status (task-4-brief.md's carry-forward item 1/2).
// ==========================================================================
console.log('\n=== 7. Operator eating/resting -> blocked, names the break ===\n');
{
  const state = makeState();
  floorRect(state, 0, 8, 0, 8);
  placeItem(state, 'operatorConsole', 2, 2, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    needs: { fatigue: 0.1, hunger: 0.9, morale: 0.5 },
    job: {
      jobType: 'eat', target: null, specialty: null,
      stationKey: 'cafeteria1:0', destNode: { col: 0, row: 0, subCol: 0, subRow: 0 },
      phase: 'work', progress: 10,
    },
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires while the only operator eats');
  assert(/eat|break|rest/i.test(b?.message || ''), `message names the break (got "${b?.message}")`);

  // An operator on an eat/rest job does NOT count as active coverage — this
  // is the deliberate behavior change from the old status==='working' check
  // (see task-4-brief.md's carry-forward item 2).
  const cov = operatorCoverage(state);
  assert(cov.capacity === 0, 'an eating operator contributes zero coverage');
}

// ==========================================================================
// 8. A real console, sealed in a walled room with no door.
// ==========================================================================
console.log('\n=== 8. Console walled off with no door -> blocked, names reachability ===\n');
{
  const state = makeState();
  // A 4x4 sealed chamber (cols 0-3, rows 0-3), no door anywhere on its
  // perimeter. Operator console anchored inside it; its work node
  // ({col:1,row:0,subCol:1,subRow:3} — hand-derived the same way
  // test-staff-stations.js's own scenario 1 derives it) lands inside the
  // chamber too.
  floorRect(state, 0, 8, 0, 8);
  wallPerimeter(state, 0, 3, 0, 3);
  placeItem(state, 'operatorConsole', 1, 1, 0, 0, 0);
  addBeamline(state, 'bl1');
  const op = makeOperator({
    fromNode: { col: 6, row: 1, subCol: 0, subRow: 0 }, // well outside the sealed chamber
    job: null,
  });
  state.staffMembers = [op];
  makeGate(state).run();
  const b = beamUnstaffed(state);
  assert(!!b, 'beam_unstaffed fires: console exists but nothing can reach it');
  assert(/reach/i.test(b?.message || ''), `message names reachability (got "${b?.message}")`);
}

// ==========================================================================
// 9. Determinism — no Math.random anywhere in the staffing path.
// ==========================================================================
console.log('\n=== 9. Determinism: identical blockers on repeated runs ===\n');
{
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return originalRandom(); };
  try {
    const state = makeState({ staffMembers: [makeOperator()] });
    addBeamline(state, 'bl1');
    addBeamline(state, 'bl2');
    const gate = makeGate(state);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      gate.run();
      runs.push(JSON.stringify(state.infraBlockers.map(b => ({ code: b.code, message: b.message }))));
    }
    assert(runs.every(r => r === runs[0]), 'five runs of the same state produce byte-identical blockers');
    assert(calls === 0, `the staffing gate never calls Math.random (calls: ${calls})`);
  } finally {
    Math.random = originalRandom;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
