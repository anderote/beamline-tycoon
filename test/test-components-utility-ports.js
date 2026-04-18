// test/test-components-utility-ports.js
//
// Regression-plus-integration tests for src/data/components.js after utility
// ports are merged into COMPONENTS[id].ports. Verifies:
//   1. Beam-pipe ports (entry/exit) survive the merge.
//   2. Utility ports are present and correctly shaped.
//   3. Infra sources expose `role: 'source'` ports.
//   4. Components without declared utility ports are unchanged.

import { COMPONENTS } from '../src/data/components.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ==========================================================================
// Test 1: dipole retains beam-pipe ports after merge.
// ==========================================================================
console.log('\n--- Test 1: dipole beam-pipe ports survive merge ---');
{
  const d = COMPONENTS.dipole;
  assert(d && d.ports, 'dipole has ports');
  assert('entry' in d.ports, "dipole.ports.entry present");
  assert(d.ports.entry.side === 'back', `entry.side === 'back' (got ${d.ports.entry.side})`);
  assert('exit' in d.ports, 'dipole.ports.exit present');
  assert(d.ports.exit.side === 'left', `exit.side === 'left' (got ${d.ports.exit.side})`);
  // Beam-pipe ports must NOT have a `utility` field.
  assert(!d.ports.entry.utility, 'entry has no utility field');
  assert(!d.ports.exit.utility, 'exit has no utility field');
}

// ==========================================================================
// Test 2: dipole has new utility ports with correct shape.
// ==========================================================================
console.log('\n--- Test 2: dipole utility ports merged in ---');
{
  const d = COMPONENTS.dipole;
  assert('pwr_in' in d.ports, 'dipole.ports.pwr_in present');
  assert(d.ports.pwr_in.utility === 'powerCable', 'pwr_in.utility === powerCable');
  assert(d.ports.pwr_in.role === 'sink', 'pwr_in.role === sink');
  assert(d.ports.pwr_in.side === 'left', 'pwr_in.side === left');
  assert(typeof d.ports.pwr_in.offsetAlong === 'number', 'pwr_in.offsetAlong is a number');
  assert(d.ports.pwr_in.params && d.ports.pwr_in.params.demand > 0,
    'pwr_in.params.demand > 0');

  assert('cool_in' in d.ports, 'dipole.ports.cool_in present');
  assert(d.ports.cool_in.utility === 'coolingWater', 'cool_in.utility === coolingWater');
  assert(d.ports.cool_in.role === 'sink', 'cool_in.role === sink');
}

// ==========================================================================
// Test 3: chiller is a cooling-water source.
// ==========================================================================
console.log('\n--- Test 3: chiller cool_out source ---');
{
  const c = COMPONENTS.chiller;
  assert(c && c.ports, 'chiller has ports');
  assert('cool_out' in c.ports, 'chiller.ports.cool_out present');
  assert(c.ports.cool_out.utility === 'coolingWater', 'cool_out.utility === coolingWater');
  assert(c.ports.cool_out.role === 'source', `cool_out.role === 'source' (got ${c.ports.cool_out.role})`);
  assert(c.ports.cool_out.params && c.ports.cool_out.params.capacity > 0,
    'cool_out.params.capacity > 0');
}

// ==========================================================================
// Test 4: source retains exit beam port AND has pwr_in utility port.
// ==========================================================================
console.log('\n--- Test 4: source — exit + pwr_in ---');
{
  const s = COMPONENTS.source;
  assert('exit' in s.ports, 'source.ports.exit present');
  assert(s.ports.exit.side === 'front', 'exit.side === front');
  assert(!s.ports.exit.utility, 'exit has no utility field');
  assert('pwr_in' in s.ports, 'source.ports.pwr_in present');
  assert(s.ports.pwr_in.utility === 'powerCable', 'pwr_in.utility === powerCable');
}

// ==========================================================================
// Test 5: ellipticalSrfCavity — entry/exit + pwr_in + cryo_in + rf_in.
// ==========================================================================
console.log('\n--- Test 5: ellipticalSrfCavity — beam + 3 utility ports ---');
{
  const s = COMPONENTS.ellipticalSrfCavity;
  assert(s && s.ports, 'ellipticalSrfCavity has ports');
  assert('entry' in s.ports && 'exit' in s.ports, 'beam-pipe ports present');
  assert('pwr_in' in s.ports, 'pwr_in present');
  assert('cryo_in' in s.ports, 'cryo_in present');
  assert('rf_in' in s.ports, 'rf_in present');
  assert(s.ports.cryo_in.utility === 'cryoTransfer', 'cryo_in is cryoTransfer');
  assert(s.ports.rf_in.params.frequency === 1300 * 1e6,
    `rf_in.params.frequency === 1.3e9 (got ${s.ports.rf_in.params.frequency})`);
}

// ==========================================================================
// Test 6: components with no declared utility ports are unchanged.
// ==========================================================================
console.log('\n--- Test 6: drift / bellows unchanged ---');
{
  const drift = COMPONENTS.drift;
  assert(drift && drift.ports, 'drift has ports');
  // drift is a drawn connection with entry+exit and no utility ports.
  assert('entry' in drift.ports && 'exit' in drift.ports, 'drift has entry + exit');
  const keys = Object.keys(drift.ports).sort();
  assert(JSON.stringify(keys) === JSON.stringify(['entry', 'exit']),
    `drift.ports keys are exactly [entry, exit] (got ${JSON.stringify(keys)})`);
}

// ==========================================================================
// Test 7: injectionSeptum beam ports are preserved (3 beam ports, none utility).
// ==========================================================================
console.log('\n--- Test 7: injectionSeptum beam ports intact ---');
{
  const sep = COMPONENTS.injectionSeptum;
  assert(sep && sep.ports, 'injectionSeptum has ports');
  assert('linacEntry' in sep.ports, 'linacEntry present');
  assert('ringEntry' in sep.ports, 'ringEntry present');
  assert('ringExit' in sep.ports, 'ringExit present');
  // injectionSeptum is NOT in the utility-port map, so no utility ports added.
  for (const [name, spec] of Object.entries(sep.ports)) {
    assert(!spec.utility, `${name} has no utility field`);
  }
}

// ==========================================================================
// Summary.
// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
