// test/test-utility-gate.js — tests for src/game/utility-gate.js +
// findUnconnectedSinks in src/utility/network-discovery.js.
//
// The gate runs the utility solve, synthesizes unconnected-sink and staffing
// hard errors, and derives state.infraBlockers / infraCanRun / nodeQualities.
// Tests inject a fake solveRunner + port table so no descriptor modules load.
//
// Scenarios:
//   1. Unconnected power sink on a beamline placeable → power_unconnected
//      hard error with fromUnconnectedCheck, infraCanRun false.
//   2. Connected sinks (power + vacuum lines present) → no unconnected
//      errors, infraCanRun true (with a healthy operator).
//   3. Staffing gate: stressed operator trips deterministically under a
//      seeded rng (mulberry32) — same seed, same beam_unstaffed sequence.
//   4. nodeQualities aggregation: perSinkQuality → min per placeable.

import { UtilityGate } from '../src/game/utility-gate.js';
import { findUnconnectedSinks } from '../src/utility/network-discovery.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Same PRNG as Game.js — only the seed is shared between runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

// One beamline module with a power sink and a vacuum sink.
const PORT_TABLES = {
  dipole: {
    pwr_in: { utility: 'powerCable', role: 'sink', params: { demand: 10 } },
    vac_in: { utility: 'vacuumPipe', role: 'sink', params: { demand: 1 } },
  },
};
const getPorts = type => PORT_TABLES[type] || {};

function makeLine(id, utilityType, endRef) {
  return {
    id, utilityType,
    start: { placeableId: 'src1', portName: 'out' },
    end: endRef,
    path: [{ col: 0, row: 0 }],
  };
}

function workingOperator(overrides = {}) {
  return {
    role: 'operator', status: 'working', mood: 'content',
    assignment: { zoneId: 'controlRoom' },
    needs: { fatigue: 0.1 },
    ...overrides,
  };
}

function makeState({ lines = [], staff = [workingOperator()] } = {}) {
  const utilityLines = new Map();
  for (const l of lines) utilityLines.set(l.id, l);
  return {
    tick: 0,
    placeables: [{ id: 'p1', type: 'dipole', category: 'beamline' }],
    utilityLines,
    staffMembers: staff,
    infraBlockers: [],
    infraCanRun: true,
  };
}

const okSolveRunner = { runSolve: () => ({ errors: [] }) };

function makeGate(state, { rng = () => 0.99, solveRunner = okSolveRunner } = {}) {
  return new UtilityGate({ state, solveRunner, getPorts, rng });
}

const CONNECT_BOTH = [
  makeLine('L1', 'powerCable', { placeableId: 'p1', portName: 'pwr_in' }),
  makeLine('L2', 'vacuumPipe', { placeableId: 'p1', portName: 'vac_in' }),
];

// ==========================================================================
// Test 1: unconnected sink produces the hard error.
// ==========================================================================
console.log('\n--- Test 1: unconnected sink → hard error ---');
{
  // Vacuum connected, power not.
  const state = makeState({ lines: [CONNECT_BOTH[1]] });
  makeGate(state).run();

  const blockers = state.infraBlockers;
  const pw = blockers.filter(b => b.code === 'power_unconnected');
  assert(pw.length === 1, `one power_unconnected blocker (got ${blockers.map(b => b.code).join(',')})`);
  assert(pw[0]?.fromUnconnectedCheck === true, 'blocker has fromUnconnectedCheck flag');
  assert(pw[0]?.severity === 'hard', 'blocker severity is hard');
  assert(pw[0]?.location?.placeableId === 'p1' && pw[0]?.location?.portName === 'pwr_in',
    'blocker location names the placeable + port');
  assert(pw[0]?.message === 'dipole pwr_in not connected to powerCable',
    `message shape unchanged (got "${pw[0]?.message}")`);
  assert(state.infraCanRun === false, 'infraCanRun false');
  assert(!blockers.some(b => b.code === 'vacuum_unconnected'), 'connected vacuum sink not flagged');

  // Direct discovery-report check: findUnconnectedSinks sees only the power sink.
  const reports = findUnconnectedSinks(state.placeables, state.utilityLines, getPorts,
    ['powerCable', 'vacuumPipe']);
  assert(reports.length === 1 && reports[0].utility === 'powerCable' && reports[0].portName === 'pwr_in',
    `findUnconnectedSinks reports the power sink only (got ${JSON.stringify(reports)})`);
}

// ==========================================================================
// Test 2: connected sinks produce no unconnected errors.
// ==========================================================================
console.log('\n--- Test 2: connected sinks → no error ---');
{
  const state = makeState({ lines: CONNECT_BOTH });
  makeGate(state).run();

  assert(state.infraBlockers.length === 0, `no blockers (got ${JSON.stringify(state.infraBlockers)})`);
  assert(state.infraCanRun === true, 'infraCanRun true');
}

// ==========================================================================
// Test 3: staffing gate fires deterministically with a seeded rng.
// ==========================================================================
console.log('\n--- Test 3: unstaffed beam gating, seeded rng ---');
{
  // No operator at all → always trips.
  const state = makeState({ lines: CONNECT_BOTH, staff: [] });
  makeGate(state).run();
  const b = state.infraBlockers.find(x => x.code === 'beam_unstaffed');
  assert(!!b, 'no operator → beam_unstaffed');
  assert(b?.fromStaffingCheck === true, 'blocker has fromStaffingCheck flag');
  assert(state.infraCanRun === false, 'infraCanRun false when unstaffed');
}
{
  // Stressed operator: predicate rolls rng() < 0.3 → trip. Two gates with the
  // same seed must produce the identical trip sequence over many ticks.
  const runSequence = seed => {
    const state = makeState({ lines: CONNECT_BOTH, staff: [workingOperator({ mood: 'stressed' })] });
    const gate = makeGate(state, { rng: mulberry32(seed) });
    const seq = [];
    for (let t = 0; t < 50; t++) { gate.run(); seq.push(state.infraCanRun ? 1 : 0); }
    return seq.join('');
  };
  const a = runSequence(1234);
  const b2 = runSequence(1234);
  const c = runSequence(99);
  assert(a === b2, 'same seed → identical trip sequence');
  assert(a.includes('0') && a.includes('1'), `stressed operator both trips and runs over 50 ticks (${a})`);
  assert(a !== c, 'different seed → different sequence (probabilistic sanity)');
}
{
  // Healthy operator never rolls the rng — rng that would always trip must not fire.
  const state = makeState({ lines: CONNECT_BOTH });
  makeGate(state, { rng: () => 0.0 }).run();
  assert(!state.infraBlockers.some(x => x.code === 'beam_unstaffed'),
    'healthy operator ignores rng entirely');
}

// ==========================================================================
// Test 4: nodeQualities aggregation (min across networks, cryo quench flag).
// ==========================================================================
console.log('\n--- Test 4: nodeQualities aggregation ---');
{
  const state = makeState({ lines: CONNECT_BOTH });
  const solveRunner = {
    runSolve() {
      state.utilityNetworkData = new Map([
        ['powerCable', new Map([
          ['netA', { perSinkQuality: { 'p1:pwr_in': 0.8 } }],
          ['netB', { perSinkQuality: { 'p1:pwr_in': 0.5 } }],
        ])],
        ['cryoTransfer', new Map([
          ['netC', { quenched: true, perSinkQuality: { 'p1:cryo_in': 0.2 } }],
        ])],
      ]);
      return { errors: [] };
    },
  };
  makeGate(state, { solveRunner }).run();

  const nq = state.nodeQualities?.p1;
  assert(nq?.powerQuality === 0.5, `min across networks wins (got ${nq?.powerQuality})`);
  assert(nq?.cryoQuality === 0.2, 'cryo quality mapped');
  assert(nq?.cryoQuenched === true, 'quench flag exposed');
}

// ==========================================================================
// Test 5: quench flag with the REAL cryoTransfer descriptor output —
// regression for flowState.quenched being absent from production solves
// (the fabricated flow in Test 4 used to be the only shape that worked).
// ==========================================================================
console.log('\n--- Test 5: production cryoTransfer flow shape drives quench ---');
{
  const cryoDesc = (await import('../src/utility/types/cryoTransfer.js')).default;
  const state = makeState({ lines: CONNECT_BOTH });
  const net = {
    id: 'netQ', utilityType: 'cryoTransfer', lineIds: [],
    ports: [],
    sources: [],
    sinks: [{ portKey: 'p1:cryo_in', placeableId: 'p1', portName: 'cryo_in', params: { srfHeatW: 18 } }],
  };
  const solveRunner = {
    runSolve() {
      const r = cryoDesc.solve(net, { lheVolumeL: 5 }, {});
      state.utilityNetworkData = new Map([
        ['cryoTransfer', new Map([['netQ', r.flowState]])],
      ]);
      return { errors: r.errors };
    },
  };
  makeGate(state, { solveRunner }).run();
  assert(state.nodeQualities?.p1?.cryoQuenched === true,
    'production flowState sets cryoQuenched on the sink placeable');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
