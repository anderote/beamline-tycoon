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
// Test 7: RF-source infra — rf_out with bands (from raw) and capacity.
// ==========================================================================
console.log('\n--- Test 7: pulsedKlystron rf_out ---');
{
  const ports = getUtilityPortsV2('pulsedKlystron');
  assert('rf_out' in ports, 'has rf_out');
  assert(ports.rf_out.utility === 'rfWaveguide', 'rf_out is rfWaveguide');
  assert(ports.rf_out.role === 'source', 'rf_out is source');
  assert(ports.rf_out.params.capacity > 0, 'rf_out.params.capacity > 0');
  // Pulsed klystron raw: rfBands: ['sband', 'cband'].
  assert(ports.rf_out.params.bands.join(',') === 'sband,cband',
    `rf_out.params.bands === sband,cband (got ${ports.rf_out.params.bands.join(',')})`);
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
// Test 9: RF sources — a source matches on the BANDS it covers, never on a
// frequency, so no source port carries one. Capacity ladder still ascends.
// ==========================================================================
console.log('\n--- Test 9: RF source bands & ladder ---');
{
  const mag = getUtilityPortsV2('magnetron');
  assert(mag.rf_out.params.bands.join(',') === 'sband',
    `magnetron covers sband only (got ${mag.rf_out.params.bands.join(',')})`);
  assert(mag.rf_out.params.frequency === undefined,
    'a source carries no frequency — bands are the matching key');

  const ecr = getUtilityPortsV2('ecrIonSource');
  assert(ecr.rf_in.params.frequency === 2450 * 1e6,
    `ecrIonSource rf_in frequency === 2.45e9 Hz (got ${ecr.rf_in.params.frequency})`);
  assert(ecr.rf_in.params.band === 'sband',
    `ecrIonSource rf_in lands in sband (got ${ecr.rf_in.params.band})`);

  const ssa = getUtilityPortsV2('solidStateAmp');
  const ssaOutlets = Object.values(ssa).filter(port => port.role === 'source'
    && port.utility === 'rfWaveguide');
  assert(ssaOutlets.length === 4 && ssaOutlets.every(port => port.params.bands.join(',') === 'vhf,uhf'),
    `solidStateAmp's four outputs cover vhf,uhf (got ${ssaOutlets.map(port => port.params.bands.join(',')).join(';')})`);

  const gyro = getUtilityPortsV2('gyrotron');
  const ssaCapacity = ssaOutlets.reduce((sum, port) => sum + port.params.capacity, 0);
  assert(mag.rf_out.params.capacity < ssaCapacity
      && ssaCapacity < gyro.rf_out.params.capacity,
    'RF capacity ladder ascends magnetron < SSA < gyrotron');
}

// ==========================================================================
console.log('\n--- RF band injection ---');
{
  const cryo = getUtilityPortsV2('cryomodule');
  assert(cryo.rf_in.params.band === 'lband',
    `cryomodule rf_in band lband (got ${cryo.rf_in.params.band})`);
  assert(cryo.rf_in.params.frequency === 1300e6, 'cryomodule rf_in 1.3 GHz');

  const gy = getUtilityPortsV2('gyrotron');
  assert(Array.isArray(gy.rf_out.params.bands), 'gyrotron rf_out has bands array');
  assert(gy.rf_out.params.bands.join(',') === 'cband,xband',
    `gyrotron covers cband,xband (got ${gy.rf_out.params.bands.join(',')})`);
  assert(gy.rf_out.params.broadband === undefined, 'broadband flag is gone');

  const iot = getUtilityPortsV2('iot');
  assert(iot.rf_out.params.bands.join(',') === 'uhf,lband',
    `iot covers uhf,lband (got ${iot.rf_out.params.bands.join(',')})`);
}

// ==========================================================================
// Test 10: source capacity ladders per utility.
// ==========================================================================
console.log('\n--- Test 10: infrastructure capacity ladders ---');
{
  // Power comes in two tiers now: SUPPLY holds the capacity and hands out HV
  // feeders, DISTRIBUTION takes one feeder and hands out branch circuits. The
  // ladder is therefore over the supplies; a panel's rating is what it draws,
  // not what it makes.
  const pad = getUtilityPortsV2('padMountTransformer');
  const facility = getUtilityPortsV2('facilityTransformer');
  const hv = getUtilityPortsV2('hvTransformer');
  const grid = getUtilityPortsV2('gridIntertieTransformer');
  const hvOutlets = ports => Object.values(ports)
    .filter(port => port.utility === 'hvCable' && port.role === 'source');
  assert([pad, facility, hv, grid].map(ports => hvOutlets(ports).length).join(',') === '1,2,4,6',
    'larger HV sources expose progressively more physical feeder outlets (1, 2, 4, 6)');
  assert([pad, facility, hv, grid].map(ports => hvOutlets(ports)
    .reduce((sum, port) => sum + port.params.capacity, 0)).join(',') === '150,400,1200,3000',
    'split outlet ratings add back to each transformer nameplate capacity');
  assert(pad.hv_out_1.params.capacity < facility.hv_out_1.params.capacity
      && facility.hv_out_1.params.capacity < hv.hv_out_1.params.capacity
      && hv.hv_out_1.params.capacity < grid.hv_out_1.params.capacity,
    'HV supply ladder: pad-mount < facility < HV < grid intertie');

  const gear = getUtilityPortsV2('switchgear');
  assert(gear.hv_in?.connectionKind === 'hvDistributionIn'
      && Object.values(gear).filter(p => p.connectionKind === 'hvDistributionOut').length === 4,
    'main switchgear has one HV input and four protected downstream feeders');

  const panel = getUtilityPortsV2('powerPanel');
  const section = getUtilityPortsV2('sectionDistributionPanel');
  const main = getUtilityPortsV2('mainDistributionPanel');
  assert(panel.hv_in.params.demand < section.hv_in.params.demand
      && section.hv_in.params.demand < main.hv_in.params.demand,
    'distribution ladder: compact < section < main panel');
  const outlets = (t) => Object.keys(getUtilityPortsV2(t))
    .filter(n => n.startsWith('pwr_out')).length;
  assert(outlets('powerPanel') < outlets('sectionDistributionPanel')
      && outlets('sectionDistributionPanel') < outlets('mainDistributionPanel'),
    `outlet counts rise with the panel size (panel ${outlets('powerPanel')}, `
    + `section ${outlets('sectionDistributionPanel')}, main ${outlets('mainDistributionPanel')})`);
  const panelOutputs = Object.entries(panel)
    .filter(([name]) => name.startsWith('pwr_out'))
    .map(([, spec]) => spec);
  assert(panelOutputs.length === 4
      && panelOutputs.every(spec => spec.side === 'front')
      && new Set(panelOutputs.map(spec => spec.offsetAlong)).size === 4,
    'power panel exposes four evenly spaced front-face branch sockets');
  assert(panel.hv_in.side === 'back', 'power panel HV feeder enters through the rear');
  const bus = getUtilityPortsV2('powerBus');
  const spider = getUtilityPortsV2('spiderBox');
  assert(bus.pwr_in?.connectionKind === 'powerFieldIn'
      && Object.values(bus).filter(p => p.connectionKind === 'powerFieldOut').length === 8
      && bus.pwr_in.params.fieldCapacity === 160,
    'beamline busway has one feeder input, eight field taps, and a 160 kW rating');
  const busTaps = Object.entries(bus)
    .filter(([name]) => name.startsWith('pwr_out_'))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  assert(busTaps.every(([, p], i) => p.side === (i % 2 === 0 ? 'right' : 'left'))
      && new Set(busTaps.map(([, p]) => p.offsetAlong)).size === 4,
    'busway taps form four matched pairs along its left and right edges');
  assert(spider.pwr_in?.connectionKind === 'powerFieldIn'
      && Object.values(spider).filter(p => p.connectionKind === 'powerFieldOut').length === 3
      && spider.pwr_in.params.fieldCapacity === 30,
    'spider box has one feeder input, three local taps, and a 30 kW rating');
  assert(outlets('hvTransformer') === 0,
    'a supply hands out no branch circuits — everything goes through distribution');

  const lcw = getUtilityPortsV2('lcwSkid');
  const packageChiller = getUtilityPortsV2('packageChiller');
  const solidStateAmp = getUtilityPortsV2('solidStateAmp');
  const tower = getUtilityPortsV2('coolingTower');
  const tank = getUtilityPortsV2('waterTank');
  assert(lcw.cool_out.params.capacity === 25 && lcw.cool_out.params.reservoir
      && lcw.cool_out.params.heatRejectionCapacity === 25,
  'LCW skid is a self-contained 25 kW cooling plant');
  const packageOutlets = Object.entries(packageChiller)
    .filter(([, port]) => port.utility === 'coolingWater' && port.role === 'source');
  assert(packageOutlets.length === 3
      && packageOutlets.reduce((sum, [, port]) => sum + port.params.capacity, 0) === 5
      && packageOutlets.reduce((sum, [, port]) => sum + port.params.heatRejectionCapacity, 0) === 5
      && packageOutlets.every(([, port]) => port.params.reservoir),
  'package chiller has three outlets sharing one self-contained 5 kW plant');
  const ssaOutputs = Object.entries(solidStateAmp)
    .filter(([, port]) => port.utility === 'rfWaveguide' && port.role === 'source');
  assert(ssaOutputs.length === 4
      && ssaOutputs.every(([, port]) => port.side === 'left')
      && ssaOutputs.reduce((sum, [, port]) => sum + port.params.capacity, 0) === 35,
  'solid-state amplifier exposes four left-side RF outputs totaling 35 kW');
  assert(tower.cool_out.params.heatRejectionCapacity === 800,
    'cooling tower provides heat rejection on Cooling Water');
  assert(tank.cool_out?.utility === 'coolingWater' && tank.cool_out.params.reservoir,
    'make-up tank provides the Cooling Water reservoir role');

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
  assert(gyro.hv_in && gyro.hv_in.role === 'sink'
      && gyro.hv_in.connectionKind === 'hvLoadIn'
      && gyro.hv_in.params.demand === INFRASTRUCTURE_RAW.gyrotron.energyCost,
    `gyrotron hv_in demand tracks its energyCost (got ${gyro.hv_in && gyro.hv_in.params.demand})`);
  assert(gyro.rf_out && gyro.rf_out.role === 'source',
    'the hand-authored source port survives the merge');

  const cavity = getUtilityPortsV2('pillboxCavity');
  assert(cavity.pwr_in?.utility === 'powerCable' && !cavity.hv_in,
    'RF cavities remain ordinary branch-power loads');

  const dump = getUtilityPortsV2('beamDump');
  assert(dump.cool_in && dump.cool_in.params.heatLoad > 0,
    'beamDump gets its overridden cooling load, not its (zero) energyCost');
}

// ==========================================================================
// Distribution cabinets: terminals live together on the modeled front face.
// ==========================================================================
console.log('\n--- Distribution cabinet port layout ---');
{
  for (const [id, count] of [['powerPanel', 4], ['sectionDistributionPanel', 6], ['mainDistributionPanel', 8]]) {
    const ports = getUtilityPortsV2(id);
    const outlets = Object.entries(ports)
      .filter(([name]) => name.startsWith('pwr_out_'))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    assert(outlets.length === count, `${id} exposes ${count} real branch outlets`);
    assert(outlets.every(([, p]) => p.side === 'front'),
      `${id} branch outlets all occupy its front face`);
    assert(new Set(outlets.map(([, p]) => p.offsetAlong)).size === count,
      `${id} branch outlets are spaced to distinct positions`);
    assert(ports.hv_in.side === 'back', `${id} HV feed enters through the rear`);
  }
}

// ==========================================================================
// Summary.
// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
