// test/test-vacuum-length.js — vacuum load scales with beam-pipe length.
//
// Outgassing used to be a per-component constant table, and the beam pipe
// itself appeared nowhere in it: a player could draw 500 m of pipe and add
// exactly zero gas load, so one pump served any length and long machines were
// free. Real vacuum systems are dominated by surface area (Q = q x A,
// A = 2(pi)rL), so length is the whole story.
//
// The quality figures pinned here are the design targets from the spec.
import desc from '../src/utility/types/vacuumPipe.js';
import {
  outgassingForLength, pipeSurfaceAreaCm2,
  Q_SPECIFIC_UNBAKED, Q_SPECIFIC_BAKED, getUtilityPortsV2,
} from '../src/data/utility-ports-v2.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function close(a, b, rel, msg) {
  assert(Math.abs(a - b) <= Math.abs(b) * rel, `${msg} (got ${a}, want ~${b})`);
}

const SUB_PER_M = 2; // 1 sub-unit = 0.5 m

/** World: one beam pipe `metres` long with one component on it, plus pumps. */
function makeWorld(metres, { baked = false } = {}) {
  const placeables = [{ id: 'pump1', type: 'turboPump' }];
  if (baked) placeables.push({ id: 'bake1', type: 'bakeoutSystem' });
  return {
    placeables,
    beamPipes: [{
      id: 'pipe1',
      subL: metres * SUB_PER_M,
      placements: [{ id: 'bpm1', type: 'bpm' }],
    }],
  };
}

// Build source entries the way network-discovery does: from the component's
// DECLARED ports. Hand-writing them hid a real defect — bakeoutSystem had no
// vacuum port at all, so it could never join a vacuum network and `isBaked()`
// could never fire in real play, while this test happily fabricated the port
// the registry lacked and passed.
function sourceFor(id, type) {
  const spec = getUtilityPortsV2(type)?.vac_out;
  if (!spec) throw new Error(`${type} declares no vac_out port — it can never join a vacuum network`);
  return { portKey: `${id}:vac_out`, placeableId: id, portName: 'vac_out', params: spec.params };
}

function makeNetwork(pumpSpeed, { baked = false } = {}) {
  const sources = [{
    portKey: 'pump1:vac_out', placeableId: 'pump1', portName: 'vac_out',
    params: { pumpSpeed },
  }];
  if (baked) sources.push(sourceFor('bake1', 'bakeoutSystem'));
  return {
    id: 'n1', utilityType: 'vacuumPipe', ports: [],
    sources,
    // Component outgassing set to zero so the test isolates the pipe term.
    sinks: [{
      portKey: 'bpm1:vac_in', placeableId: 'bpm1', portName: 'vac_in',
      params: { outgassing: 0 },
    }],
  };
}

function solve(metres, pumpSpeed, opts = {}) {
  return desc.solve(makeNetwork(pumpSpeed, opts), {}, makeWorld(metres, opts)).flowState;
}

// --- Geometry -------------------------------------------------------------
console.log('\n--- Surface area and specific outgassing ---');
{
  close(pipeSurfaceAreaCm2(1), 3770, 0.01, '1 m of 0.06 m-radius pipe is ~3770 cm^2');
  close(outgassingForLength(SUB_PER_M), 3.77e-7, 0.01,
    '1 m of unbaked pipe outgasses ~3.8e-7 mbar.L/s');
  assert(outgassingForLength(0) === 0, 'zero length outgasses nothing');
  close(outgassingForLength(200), 100 * outgassingForLength(2), 1e-9,
    'outgassing is linear in length');
  assert(Q_SPECIFIC_BAKED === Q_SPECIFIC_UNBAKED / 100,
    'bakeout is a 100x improvement');
}

// --- The spec's calibration table -----------------------------------------
console.log('\n--- Pressure and quality vs length and pumping ---');
{
  const CASES = [
    // metres, pumpSpeed L/s, expected quality
    [20, 100, 0.78],
    [20, 400, 0.93],
    [100, 100, 0.61],
    [100, 400, 0.76],
    [300, 100, 0.49],
    [300, 400, 0.64],
  ];
  for (const [m, s, q] of CASES) {
    const flow = solve(m, s);
    close(flow.perSinkQuality['bpm1:vac_in'], q, 0.03,
      `${m} m on ${s} L/s gives quality ~${q}`);
  }
}

// --- Length actually costs something --------------------------------------
console.log('\n--- Longer pipe is worse, and needs more pumping ---');
{
  const short = solve(20, 100);
  const long = solve(300, 100);
  assert(long.pressure > short.pressure,
    `300 m is at higher pressure than 20 m (${long.pressure.toExponential(2)} vs ${short.pressure.toExponential(2)})`);
  assert(long.perSinkQuality['bpm1:vac_in'] < short.perSinkQuality['bpm1:vac_in'],
    'longer pipe means worse vacuum quality');

  // Distributed pumping is the answer, which is how real machines are built.
  const pumped = solve(300, 1600);
  assert(pumped.perSinkQuality['bpm1:vac_in'] > long.perSinkQuality['bpm1:vac_in'],
    'adding pumps recovers a long machine');
}

// --- Bakeout --------------------------------------------------------------
console.log('\n--- Bakeout is worth buying ---');
{
  const raw = solve(300, 100);
  const baked = solve(300, 100, { baked: true });
  assert(baked.baked === true, 'network reports itself as baked');
  assert(baked.perSinkQuality['bpm1:vac_in'] > 0.98,
    `baked 300 m line reaches ~0.99 quality (got ${baked.perSinkQuality['bpm1:vac_in'].toFixed(3)})`);
  assert(raw.perSinkQuality['bpm1:vac_in'] < 0.55,
    'the same line unbaked is marginal');
}

// --- Pressure is published for the beam -----------------------------------
console.log('\n--- Pressure reaches the sinks ---');
{
  const flow = solve(100, 100);
  assert(flow.perSinkPressure['bpm1:vac_in'] === flow.pressure,
    'perSinkPressure carries the network pressure');
  close(flow.pressure, 3.77e-7, 0.02, '100 m on 100 L/s sits at ~3.8e-7 mbar');

  // An unpumped network is at atmosphere, not Infinity — beam_gas needs a
  // real number to scatter against.
  const dead = desc.solve(makeNetwork(0), {}, makeWorld(100)).flowState;
  assert(dead.perSinkPressure['bpm1:vac_in'] === 1013,
    `unpumped network reports atmosphere (got ${dead.perSinkPressure['bpm1:vac_in']})`);
}

// --- Pipe term is separable ----------------------------------------------
console.log('\n--- Component and pipe loads are reported separately ---');
{
  const flow = solve(100, 100);
  assert(flow.pipeOutgas > 0, 'pipe contributes outgassing');
  assert(flow.componentOutgas === 0, 'component term is zero in this fixture');
  close(flow.totalDemand, flow.pipeOutgas + flow.componentOutgas, 1e-9,
    'total demand is the sum of both terms');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
