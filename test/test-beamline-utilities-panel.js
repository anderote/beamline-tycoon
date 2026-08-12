// test/test-beamline-utilities-panel.js — the Utilities tab's per-utility
// status logic (BeamlineWindow._utilityStatus).
//
// The panel reads two independent facts and used to conflate them:
//
//   nodeQualities[id][field] defined  ->  this component NEEDS that utility
//   unwiredSinks[id][utility]         ->  no line reaches it
//
// Every declared sink is always defined, because the gate floors it to 0 so
// that forgetting to wire something can never score better than wiring it
// badly. Treating definedness as connectivity therefore reported every sink a
// component declares as "Connected" — an isolated electron gun with nothing
// plugged in showed Power, Vacuum and Cooling all green while the fault HUD
// beside it counted 3 unwired sinks.
//
// _utilityStatus is called off the prototype with a stub `this`: it reads only
// this.game.state, so the tab's status logic is testable without a DOM.

import { BeamlineWindow } from '../src/ui/BeamlineWindow.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const statusOf = (state, utility, ids) =>
  BeamlineWindow.prototype._utilityStatus.call({ game: { state } }, utility, ids);

// ==========================================================================
// Test 1: the reported bug — one source, nothing wired.
// ==========================================================================
console.log('\n--- Test 1: isolated source reads as unwired, not connected ---');
{
  // Exactly what the gate leaves behind for a lone electron gun: three
  // declared sinks, all floored, all listed as unwired.
  const state = {
    nodeQualities: {
      gun: {
        powerQuality: 0, vacuumQuality: 0, coolingQuality: 0,
        vacuumPressure: 1013, coolingDeltaT: 100,
      },
    },
    unwiredSinks: {
      gun: { powerCable: true, vacuumPipe: true, coolingWater: true },
    },
  };
  const ids = ['gun'];

  assert(statusOf(state, 'powerCable', ids) === 'unwired', 'power reads unwired');
  assert(statusOf(state, 'vacuumPipe', ids) === 'unwired', 'vacuum reads unwired');
  assert(statusOf(state, 'coolingWater', ids) === 'unwired', 'cooling reads unwired');

  // The three it never declared must stay distinct from the three it declared
  // and never wired: "Not required" is not a fault the player has to fix.
  assert(statusOf(state, 'rfWaveguide', ids) === 'unused', 'RF is not required');
  assert(statusOf(state, 'cryoTransfer', ids) === 'unused', 'cryo is not required');
  assert(statusOf(state, 'dataFiber', ids) === 'unused', 'data is not required');
}

// ==========================================================================
// Test 2: wired sinks, including a wired-but-starved one.
// ==========================================================================
console.log('\n--- Test 2: wired reads connected, even when quality is poor ---');
{
  const state = {
    nodeQualities: { gun: { powerQuality: 1, vacuumQuality: 0.4 } },
    unwiredSinks: {},
  };
  assert(statusOf(state, 'powerCable', ['gun']) === 'connected', 'wired power is connected');
  // A wired line that delivers badly is a supply problem, not a wiring one.
  // Reporting it as "Not connected" would send the player hunting for a pipe
  // that is already there.
  assert(statusOf(state, 'vacuumPipe', ['gun']) === 'connected',
    'a wired but under-served sink is still connected');
}

// ==========================================================================
// Test 3: partial coverage across a multi-component beamline.
// ==========================================================================
console.log('\n--- Test 3: partial wiring ---');
{
  const state = {
    nodeQualities: {
      gun:  { powerQuality: 1 },
      cav:  { powerQuality: 0 },
      quad: { powerQuality: 1 },
    },
    unwiredSinks: { cav: { powerCable: true } },
  };
  const ids = ['gun', 'cav', 'quad'];
  assert(statusOf(state, 'powerCable', ids) === 'partial',
    'one unwired node out of three reads partial');

  // All three unwired is a different message from some of them.
  const allBad = {
    nodeQualities: state.nodeQualities,
    unwiredSinks: {
      gun: { powerCable: true }, cav: { powerCable: true }, quad: { powerCable: true },
    },
  };
  assert(statusOf(allBad, 'powerCable', ids) === 'unwired', 'all nodes unwired reads unwired');
}

// ==========================================================================
// Test 4: degenerate inputs — before the first gate pass, and empty beamlines.
// ==========================================================================
console.log('\n--- Test 4: missing state ---');
{
  // The gate has not run yet: nothing is known to be declared, so nothing is
  // claimed. Reporting "Connected" here is the failure mode being fixed.
  const empty = {};
  assert(statusOf(empty, 'powerCable', ['gun']) === 'unused',
    'no nodeQualities yet → not required, never connected');

  const noNodes = { nodeQualities: { gun: { powerQuality: 0 } }, unwiredSinks: {} };
  assert(statusOf(noNodes, 'powerCable', []) === 'unused', 'a beamline with no nodes needs nothing');

  // unwiredSinks absent but qualities present (e.g. a save loaded mid-flight):
  // fall back to the qualities' own verdict rather than inventing a green dot.
  const noWiringMap = { nodeQualities: { gun: { powerQuality: 0 } } };
  assert(statusOf(noWiringMap, 'powerCable', ['gun']) === 'connected',
    'without a wiring map the sink is assumed wired (quality then tells the story)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
