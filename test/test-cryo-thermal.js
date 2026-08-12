// test/test-cryo-thermal.js — the cryogenic thermal feedback loop.
//
// This is the mechanic the whole utility-physics rework hangs on: cavity
// dissipation depends on Q0, Q0 depends on bath temperature, and bath
// temperature depends on dissipation. Over-drive a cavity and the loop runs
// away into a quench; back off and the plant pulls it back down.
//
// The properties pinned here are the ones a balance change could quietly
// break: that a correctly provisioned plant holds its design temperature
// forever, that an over-driven one warms and then accelerates, and that
// recovery works.
import desc, {
  capacityAt, dynamicLoadAt, T_SUPERFLUID, T_NORMAL, THERMAL_MASS,
} from '../src/utility/types/cryoTransfer.js';
import { CAVITY_SPECS, T_CRITICAL } from '../src/beamline/cavity-specs.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const TESLA = CAVITY_SPECS.cryomodule;

// A world with one cryomodule on one pipe, plus a cold box, wired together.
function makeWorld({ gradient, plant = 'coldBox2K' }) {
  return {
    placeables: [{ id: 'plant1', type: plant }],
    beamPipes: [{
      id: 'pipe1',
      subL: 40,
      placements: [{ id: 'cav1', type: 'cryomodule', gradientAchieved: gradient }],
    }],
  };
}

function makeNetwork(capacityW, staticW) {
  return {
    id: 'n1',
    utilityType: 'cryoTransfer',
    ports: [],
    sources: [{ portKey: 'plant1:cryo_out', placeableId: 'plant1', portName: 'cryo_out',
                params: { coldCapacityW: capacityW } }],
    sinks: [{ portKey: 'cav1:cryo_in', placeableId: 'cav1', portName: 'cryo_in',
              params: { srfHeatW: staticW } }],
  };
}

/** Run the solver `n` times, feeding persistent state forward. */
function runTicks(net, world, n, persistent = { lheVolumeL: 500, tempK: T_SUPERFLUID }) {
  let p = persistent;
  let last = null;
  for (let i = 0; i < n; i++) {
    last = desc.solve(net, p, world);
    p = last.nextPersistentState;
  }
  return { flow: last.flowState, persistent: p };
}

// --- Design temperature ---------------------------------------------------
console.log('\n--- Design temperature comes from the plant hardware ---');
{
  const net = makeNetwork(800, 10);
  const cold = desc.solve(net, { lheVolumeL: 500 },
    makeWorld({ gradient: 0, plant: 'coldBox2K' }));
  const warm = desc.solve(net, { lheVolumeL: 500 },
    makeWorld({ gradient: 0, plant: 'coldBox4K' }));
  assert(cold.flowState.designTempK === T_SUPERFLUID,
    `2 K sub-cooler gives a 2 K bath (got ${cold.flowState.designTempK})`);
  assert(warm.flowState.designTempK === T_NORMAL,
    `4 K cold box gives a 4.5 K bath (got ${warm.flowState.designTempK})`);
}

// --- Well provisioned: holds forever --------------------------------------
console.log('\n--- Adequate plant holds design temperature ---');
{
  // 15 MV/m over 8 cavities at 2 K is ~240 W; an 800 W box covers it easily.
  const net = makeNetwork(800, 10);
  const world = makeWorld({ gradient: 15 });
  const { flow } = runTicks(net, world, 200);
  assert(Math.abs(flow.tempK - T_SUPERFLUID) < 1e-9,
    `bath still at 2 K after 200 ticks (got ${flow.tempK.toFixed(4)})`);
  assert(flow.quenched === false, 'no quench');
  assert(flow.warming === false, 'not flagged as warming');
  assert(flow.dynamicLoad > 0, `dynamic load is real (${flow.dynamicLoad.toFixed(0)} W)`);
}

// --- Over-driven: warms, accelerates, quenches ----------------------------
console.log('\n--- Over-driven cavity runs away and quenches ---');
{
  // 25 MV/m over 8 cavities at 2 K is ~670 W against a 300 W box.
  const net = makeNetwork(300, 10);
  const world = makeWorld({ gradient: 25 });

  const t10 = runTicks(net, world, 10).flow.tempK;
  const t20 = runTicks(net, world, 20).flow.tempK;
  const t40 = runTicks(net, world, 40).flow.tempK;

  assert(t10 > T_SUPERFLUID, `bath warms by tick 10 (${t10.toFixed(3)} K)`);
  assert(t20 > t10, `still climbing at tick 20 (${t20.toFixed(3)} K)`);
  // Runaway, not linear drift: Q0 collapses as it warms, so each step is
  // bigger than the last. This is what makes the failure mode dramatic.
  assert((t20 - t10) < (t40 - t20),
    `warming accelerates (${(t20 - t10).toFixed(3)} then ${(t40 - t20).toFixed(3)} K)`);

  const end = runTicks(net, world, 200).flow;
  assert(end.tempK >= T_CRITICAL, `reaches Tc (${end.tempK.toFixed(2)} K)`);
  assert(end.quenched === true, 'quenches');
  assert(end.errors.some(e => e.code === 'cryo_thermal_quench'),
    'raises cryo_thermal_quench');
}

// --- Warming is visible before it is fatal --------------------------------
console.log('\n--- Player gets warning before quench ---');
{
  const net = makeNetwork(300, 10);
  const world = makeWorld({ gradient: 25 });
  let firstWarn = -1, firstQuench = -1;
  let p = { lheVolumeL: 500, tempK: T_SUPERFLUID };
  for (let i = 0; i < 300; i++) {
    const r = desc.solve(net, p, world);
    p = r.nextPersistentState;
    if (firstWarn < 0 && r.flowState.warming) firstWarn = i;
    if (firstQuench < 0 && r.flowState.quenched) { firstQuench = i; break; }
  }
  assert(firstWarn >= 0, `warning raised (tick ${firstWarn})`);
  assert(firstQuench > firstWarn, `quench comes later (tick ${firstQuench})`);
  assert(firstQuench - firstWarn >= 10,
    `at least 10 ticks of warning (got ${firstQuench - firstWarn})`);
}

// --- Recovery -------------------------------------------------------------
console.log('\n--- Backing off in time cools the bath again ---');
{
  const net = makeNetwork(300, 10);
  const hot = runTicks(net, makeWorld({ gradient: 25 }), 10);
  assert(hot.flow.tempK > T_SUPERFLUID + 0.05,
    `bath warmed to ${hot.flow.tempK.toFixed(3)} K`);
  assert(hot.flow.quenched === false, 'not quenched yet — still recoverable');

  // Operator throttles back hard; plant pulls the bath down again.
  // The cut has to be a real one: Q0 is already degraded at the warmer
  // temperature, so holding anything near the original gradient just keeps
  // warming. Recovering from 3 K needs roughly a 3x gradient cut, since
  // dissipation goes as the square of the field.
  const cooled = runTicks(net, makeWorld({ gradient: 5 }), 40, hot.persistent);
  assert(cooled.flow.tempK < hot.flow.tempK,
    `cools after backing off (${cooled.flow.tempK.toFixed(3)} K)`);
  assert(cooled.flow.tempK >= T_SUPERFLUID - 1e-9,
    'never goes below the plant design point');
}

console.log('\n--- A quench is recoverable once the RF interlock drops ---');
{
  // Without the interlock the quench LATCHES: Q0 falls to the copper value,
  // dissipation goes to megawatts, and no player action can ever bring the
  // bath back.
  const net = makeNetwork(300, 10);
  const dead = runTicks(net, makeWorld({ gradient: 25 }), 200);
  assert(dead.flow.quenched === true, 'quenched');

  const recovered = runTicks(net, makeWorld({ gradient: 0 }), 60, dead.persistent);
  assert(recovered.flow.tempK < T_CRITICAL,
    `bath recovers with RF off (${recovered.flow.tempK.toFixed(2)} K)`);
  assert(recovered.flow.quenched === false, 'no longer quenched');
}

// --- Idle machine still leaks ---------------------------------------------
console.log('\n--- Static load is billed even with the beam off ---');
{
  const net = makeNetwork(800, 40);
  const { flow } = runTicks(net, makeWorld({ gradient: 0 }), 5);
  assert(flow.dynamicLoad === 0, 'no dynamic load with no gradient');
  assert(flow.staticLoad === 40, `static load still counted (${flow.staticLoad} W)`);
  assert(flow.totalDemand === 40, 'total demand is the static load');
}

// --- LHe quench remains independent ---------------------------------------
console.log('\n--- Dry reservoir still quenches regardless of temperature ---');
{
  const net = makeNetwork(800, 10);
  const r = desc.solve(net, { lheVolumeL: 5, tempK: T_SUPERFLUID },
    makeWorld({ gradient: 5 }));
  assert(r.flowState.quenched === true, 'dry reservoir quenches');
  assert(r.errors.some(e => e.code === 'cryo_quench'), 'raises cryo_quench');
}

// --- Per-sink temperature is published ------------------------------------
console.log('\n--- Bath temperature reaches the sinks ---');
{
  const net = makeNetwork(800, 10);
  const { flow } = runTicks(net, makeWorld({ gradient: 10 }), 5);
  assert(flow.perSinkTemp['cav1:cryo_in'] === flow.tempK,
    'perSinkTemp carries the bath temperature');
}

// --- Helper units ---------------------------------------------------------
console.log('\n--- Capacity and load helpers ---');
{
  assert(capacityAt(2.0, 800, 2.0) === 800, 'plant delivers its rating at design temp');
  assert(capacityAt(4.5, 800, 2.0) > 800, 'same plant run warm delivers more');
  assert(capacityAt(2.0, 800, 4.5) < 800, 'a 4.5 K box asked for 2 K delivers less');
  assert(capacityAt(2.0, 0, 2.0) === 0, 'no plant, no capacity');

  const cavs = [{ spec: TESLA, gradient: 20 }];
  assert(dynamicLoadAt(4.2, cavs) > dynamicLoadAt(2.0, cavs) * 30,
    'dissipation explodes as the bath warms');
  assert(dynamicLoadAt(2.0, [{ spec: TESLA, gradient: 0 }]) === 0,
    'an unpowered cavity dissipates nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
