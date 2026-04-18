// test/test-utility-ports-v2.js — tests for src/data/utility-ports-v2.js.
//
// getUtilityPortsV2(id) returns new-schema port specs with:
//   - utility: one of the six utility types
//   - side: 'back' | 'front' | 'left' | 'right'
//   - offsetAlong: number in [0.1, 0.9]
//   - role: 'sink' | 'source' | 'pass'
//   - params: utility-specific defaults (non-empty for sink/source)

import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// ==========================================================================
// Test 1: source — single pwr_in sink.
// ==========================================================================
console.log('\n--- Test 1: source ---');
{
  const ports = getUtilityPortsV2('source');
  assert(ports && typeof ports === 'object', 'returns an object');
  assert('pwr_in' in ports, 'has pwr_in');
  const p = ports.pwr_in;
  assert(p.utility === 'powerCable', `pwr_in.utility === 'powerCable' (got ${p.utility})`);
  assert(p.role === 'sink', `pwr_in.role === 'sink' (got ${p.role})`);
  assert(['back', 'front', 'left', 'right'].includes(p.side), `pwr_in.side valid (got ${p.side})`);
  assert(p.offsetAlong >= 0.1 && p.offsetAlong <= 0.9, `offsetAlong in range (got ${p.offsetAlong})`);
  assert(p.params && p.params.demand > 0, `pwr_in.params.demand > 0 (got ${p.params && p.params.demand})`);
}

// ==========================================================================
// Test 2: dipole — pwr_in + cool_in, both sinks.
// ==========================================================================
console.log('\n--- Test 2: dipole ---');
{
  const ports = getUtilityPortsV2('dipole');
  assert('pwr_in' in ports, 'has pwr_in');
  assert('cool_in' in ports, 'has cool_in');
  assert(ports.pwr_in.role === 'sink', 'pwr_in is sink');
  assert(ports.cool_in.role === 'sink', 'cool_in is sink');
  assert(ports.pwr_in.utility === 'powerCable', 'pwr_in is powerCable');
  assert(ports.cool_in.utility === 'coolingWater', 'cool_in is coolingWater');
  assert(ports.cool_in.params.heatLoad > 0, 'cool_in.params.heatLoad > 0');
}

// ==========================================================================
// Test 3: ellipticalSrfCavity — pwr_in + cryo_in + rf_in.
// ==========================================================================
console.log('\n--- Test 3: ellipticalSrfCavity ---');
{
  const ports = getUtilityPortsV2('ellipticalSrfCavity');
  assert('pwr_in' in ports, 'has pwr_in');
  assert('cryo_in' in ports, 'has cryo_in');
  assert('rf_in' in ports, 'has rf_in');

  assert(ports.cryo_in.utility === 'cryoTransfer', 'cryo_in is cryoTransfer');
  assert(ports.cryo_in.params.srfHeatW === 18,
    `cryo_in.params.srfHeatW === 18 (got ${ports.cryo_in.params.srfHeatW})`);

  assert(ports.rf_in.utility === 'rfWaveguide', 'rf_in is rfWaveguide');
  assert(ports.rf_in.params.frequency > 0,
    `rf_in.params.frequency > 0 (got ${ports.rf_in.params.frequency})`);
  // Elliptical SRF raw: rfFrequency: 1300 MHz → 1.3e9 Hz.
  assert(ports.rf_in.params.frequency === 1300 * 1e6,
    `rf_in.params.frequency === 1.3e9 Hz (got ${ports.rf_in.params.frequency})`);
  assert(ports.rf_in.params.demand > 0, 'rf_in.params.demand > 0');
}

// ==========================================================================
// Test 4: chiller — cool_out source.
// ==========================================================================
console.log('\n--- Test 4: chiller ---');
{
  const ports = getUtilityPortsV2('chiller');
  assert('cool_out' in ports, 'has cool_out');
  assert(ports.cool_out.utility === 'coolingWater', 'cool_out is coolingWater');
  assert(ports.cool_out.role === 'source', `cool_out.role === 'source' (got ${ports.cool_out.role})`);
  assert(ports.cool_out.params.capacity > 0,
    `cool_out.params.capacity > 0 (got ${ports.cool_out.params.capacity})`);
}

// ==========================================================================
// Test 5: turboPump — vac_out with pumpSpeed.
// ==========================================================================
console.log('\n--- Test 5: turboPump ---');
{
  const ports = getUtilityPortsV2('turboPump');
  assert('vac_out' in ports, 'has vac_out');
  assert(ports.vac_out.utility === 'vacuumPipe', 'vac_out is vacuumPipe');
  assert(ports.vac_out.role === 'source', 'vac_out is source');
  assert(ports.vac_out.params.pumpSpeed > 0,
    `vac_out.params.pumpSpeed > 0 (got ${ports.vac_out.params.pumpSpeed})`);
}

// ==========================================================================
// Test 6: unknown id — empty object.
// ==========================================================================
console.log('\n--- Test 6: unknown id ---');
{
  const ports = getUtilityPortsV2('unknown_id');
  assert(ports && typeof ports === 'object', 'returns an object');
  assert(Object.keys(ports).length === 0, `empty (got ${Object.keys(ports).length} keys)`);
}

// ==========================================================================
// Test 7: RF-source infra — rf_out with frequency (from raw) and capacity.
// ==========================================================================
console.log('\n--- Test 7: pulsedKlystron rf_out ---');
{
  const ports = getUtilityPortsV2('pulsedKlystron');
  assert('rf_out' in ports, 'has rf_out');
  assert(ports.rf_out.utility === 'rfWaveguide', 'rf_out is rfWaveguide');
  assert(ports.rf_out.role === 'source', 'rf_out is source');
  assert(ports.rf_out.params.capacity > 0, 'rf_out.params.capacity > 0');
  // Pulsed klystron raw: rfFrequency: 2856 MHz.
  assert(ports.rf_out.params.frequency === 2856 * 1e6,
    `rf_out.params.frequency === 2.856e9 Hz (got ${ports.rf_out.params.frequency})`);
}

// ==========================================================================
// Summary.
// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
