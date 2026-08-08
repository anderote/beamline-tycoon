// test/test-utility-ports-v2.js — tests for src/data/utility-ports-v2.js.
//
// getUtilityPortsV2(id) returns new-schema port specs with:
//   - utility: one of the six utility types
//   - side: 'back' | 'front' | 'left' | 'right'
//   - offsetAlong: number in [0.1, 0.9]
//   - role: 'sink' | 'source' | 'pass'
//   - params: utility-specific defaults (non-empty for sink/source)

import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';

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
  assert(ports.cryo_in.params.srfHeatW === 40,
    `cryo_in.params.srfHeatW === 40 (got ${ports.cryo_in.params.srfHeatW})`);

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
// Test 8: differentiated demands — a BPM sips power, a cryomodule's cryo
// load dwarfs a single cavity's, a detector out-draws everything small.
// ==========================================================================
console.log('\n--- Test 8: per-component differentiation ---');
{
  const bpm = getUtilityPortsV2('bpm');
  const dip = getUtilityPortsV2('dipole');
  const det = getUtilityPortsV2('detector');
  assert(bpm.pwr_in.params.demand < dip.pwr_in.params.demand,
    `bpm demand (${bpm.pwr_in.params.demand}) < dipole demand (${dip.pwr_in.params.demand})`);
  assert(dip.pwr_in.params.demand < det.pwr_in.params.demand,
    `dipole demand (${dip.pwr_in.params.demand}) < detector demand (${det.pwr_in.params.demand})`);

  const cav = getUtilityPortsV2('ellipticalSrfCavity');
  const cm = getUtilityPortsV2('cryomodule');
  assert(cm.cryo_in.params.srfHeatW > 4 * cav.cryo_in.params.srfHeatW,
    `cryomodule srfHeatW (${cm.cryo_in.params.srfHeatW}) dwarfs single cavity (${cav.cryo_in.params.srfHeatW})`);

  // Vacuum: outgassing scales with size class.
  assert(bpm.vac_in.params.outgassing < det.vac_in.params.outgassing,
    `bpm outgassing (${bpm.vac_in.params.outgassing}) < detector (${det.vac_in.params.outgassing})`);
}

// ==========================================================================
// Test 9: RF sources — magnetron is fixed 2.45 GHz (serves the ECR ion
// source bucket); solid-state amp is broadband; capacity ladder ascends.
// ==========================================================================
console.log('\n--- Test 9: RF source frequencies & ladder ---');
{
  const mag = getUtilityPortsV2('magnetron');
  assert(mag.rf_out.params.frequency === 2450 * 1e6,
    `magnetron frequency === 2.45e9 Hz (got ${mag.rf_out.params.frequency})`);
  assert(!mag.rf_out.params.broadband, 'magnetron is not broadband');

  const ecr = getUtilityPortsV2('ecrIonSource');
  assert(ecr.rf_in.params.frequency === 2450 * 1e6,
    `ecrIonSource rf_in frequency === 2.45e9 Hz (got ${ecr.rf_in.params.frequency})`);

  const ssa = getUtilityPortsV2('solidStateAmp');
  assert(ssa.rf_out.params.broadband === true, 'solidStateAmp is broadband');
  assert(ssa.rf_out.params.frequency === undefined, 'broadband source has no fixed frequency');

  const gyro = getUtilityPortsV2('gyrotron');
  assert(gyro.rf_out.params.broadband === true, 'gyrotron is broadband');
  assert(mag.rf_out.params.capacity < ssa.rf_out.params.capacity
      && ssa.rf_out.params.capacity < gyro.rf_out.params.capacity,
    'RF capacity ladder ascends magnetron < SSA < gyrotron');
}

// ==========================================================================
// Test 10: source capacity ladders per utility.
// ==========================================================================
console.log('\n--- Test 10: infrastructure capacity ladders ---');
{
  const panel = getUtilityPortsV2('powerPanel');
  const pad = getUtilityPortsV2('padMountTransformer');
  const hv = getUtilityPortsV2('hvTransformer');
  assert(panel.pwr_out.params.capacity < pad.pwr_out.params.capacity
      && pad.pwr_out.params.capacity < hv.pwr_out.params.capacity,
    'power ladder: powerPanel < padMount < hvTransformer');

  const lcw = getUtilityPortsV2('lcwSkid');
  const tower = getUtilityPortsV2('coolingTower');
  assert(lcw.cool_out.params.capacity < tower.cool_out.params.capacity,
    'cooling ladder: lcwSkid < coolingTower');

  const rough = getUtilityPortsV2('roughingPump');
  const turbo = getUtilityPortsV2('turboPump');
  const ion = getUtilityPortsV2('ionPump');
  assert(rough.vac_out.params.pumpSpeed < turbo.vac_out.params.pumpSpeed
      && turbo.vac_out.params.pumpSpeed < ion.vac_out.params.pumpSpeed,
    'vacuum ladder: roughing < turbo < ion');

  const cb4 = getUtilityPortsV2('coldBox4K');
  const cb2 = getUtilityPortsV2('coldBox2K');
  assert(cb4.cryo_out.params.coldCapacityW < cb2.cryo_out.params.coldCapacityW,
    'cryo ladder: coldBox4K < coldBox2K');
}

// ==========================================================================
// Test: infrastructure sinks exist for every declared requiredConnection.
//
// Regression: the infra table held only SOURCE ports, so no infrastructure
// component contributed demand to any network — a 40 kW panel could "feed" a
// 2000 kW gyrotron plus every pump with utilization pinned at 0%.
// ==========================================================================
console.log('\n--- Test: infrastructure requiredConnections have sink ports ---');
{
  const missing = [];
  for (const [id, def] of Object.entries(INFRASTRUCTURE_RAW)) {
    const ports = getUtilityPortsV2(id);
    for (const u of def.requiredConnections || []) {
      if (!Object.values(ports).some(p => p.utility === u && p.role === 'sink')) {
        missing.push(`${id}:${u}`);
      }
    }
  }
  assert(missing.length === 0,
    `every infra requiredConnection has a sink port (missing: ${missing.join(', ') || 'none'})`);

  const gyro = getUtilityPortsV2('gyrotron');
  assert(gyro.pwr_in && gyro.pwr_in.role === 'sink'
      && gyro.pwr_in.params.demand === INFRASTRUCTURE_RAW.gyrotron.energyCost,
    `gyrotron pwr_in demand tracks its energyCost (got ${gyro.pwr_in && gyro.pwr_in.params.demand})`);
  assert(gyro.rf_out && gyro.rf_out.role === 'source',
    'the hand-authored source port survives the merge');

  const dump = getUtilityPortsV2('beamDump');
  assert(dump.cool_in && dump.cool_in.params.heatLoad > 0,
    'beamDump gets its overridden cooling load, not its (zero) energyCost');
}

// ==========================================================================
// Summary.
// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
