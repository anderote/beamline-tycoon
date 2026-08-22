// test/test-utility-ports-v2.js — tests for src/data/utility-ports-v2.js.
//
// getUtilityPortsV2(id) returns new-schema port specs with:
//   - utility: one of the six utility types
//   - side: 'back' | 'front' | 'left' | 'right'
//   - offsetAlong: number in [0.1, 0.9]
//   - role: 'sink' | 'source' | 'pass'
//   - params: utility-specific defaults (non-empty for sink/source)

import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import {
  COOLING_AUTO_CONNECT_CLASS,
  coolingAutoConnectClass,
} from '../src/data/cooling-auto-connect-classes.js';
import { INFRASTRUCTURE_RAW } from '../src/data/infrastructure.raw.js';
import { HV_LOAD_TAP_IDS } from '../src/data/hv-load-taps.js';
import { portSide } from '../src/utility/ports.js';

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
  assert(p.params?.demand === 50,
    `exactly 50 kW remains on powerCable (got ${p.params && p.params.demand})`);
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
  const names = ['cool_out', 'cool_out_2', 'cool_out_3', 'cool_out_4'];
  assert(names.every(name => ports[name].autoConnectClass
      === COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH),
  'the four primary chiller sockets are assisted-wiring load branches');
  assert(ports.room_in.utility === 'waterSupplyPipe'
      && ports.supply_cold_out.utility === 'waterSupplyPipe',
  'the opposite chiller side exposes rigid room-temperature inlet and cold-supply outlet ports');
  assert(coolingAutoConnectClass(getUtilityPortsV2('dipole').cool_in)
      === COOLING_AUTO_CONNECT_CLASS.LOAD,
  'an ordinary cooling sink derives the load target class');
}

// ==========================================================================
// Test 5: turboPump — vac_out with pumpSpeed.
// ==========================================================================
console.log('\n--- Test 5: turboPump ---');
{
  const cart = getUtilityPortsV2('roughingPumpCart');
  const ports = getUtilityPortsV2('turboPump');
  const turboCart = getUtilityPortsV2('turboPumpCart');
  assert(cart.vac_out.params.roughingSpeed === 60,
    'four-pump cart supplies 60 L/s of roughing and backing speed');
  assert(cart.vac_out.params.vacuumStage === 'rough',
    'four-pump cart is a rough stage, not a high-vacuum shortcut');
  assert('vac_out' in ports, 'has vac_out');
  assert(ports.vac_out.utility === 'vacuumPipe', 'vac_out is vacuumPipe');
  assert(ports.vac_out.role === 'source', 'vac_out is source');
  assert(ports.vac_out.params.pumpSpeed > 0,
    `vac_out.params.pumpSpeed > 0 (got ${ports.vac_out.params.pumpSpeed})`);
  assert(turboCart.vac_out.params.highVacSpeed === 1200,
    'turbo cart supplies four times the single-turbo high-vac speed');
  assert(turboCart.vac_out.params.backingDemand === cart.vac_out.params.roughingSpeed,
    'one roughing cart exactly backs one turbo cart');
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
  assert(dip.pwr_in.params.demand < det.hv_in.params.demand,
    `dipole demand (${dip.pwr_in.params.demand}) < detector demand (${det.hv_in.params.demand})`);
  assert(det.hv_in.utility === 'hvCable' && !det.pwr_in,
    'a detector drawing more than 50 kW uses a direct HV input');

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

  const wideband = getUtilityPortsV2('widebandDriverAmp');
  assert(wideband.rf_out?.params.capacity === 5
      && wideband.rf_out.params.dutyFactor === 1.0
      && wideband.rf_out.params.bands.join(',') === 'vhf,uhf,lband,sband,cband,xband',
  'wideband driver provides 5 kW CW across every RF band');
  assert(wideband.hv_in?.utility === 'hvCable'
      && wideband.hv_in.params.demand === 13,
  'wideband driver exposes its 13 kW HV input');

  const buncherAmp = getUtilityPortsV2('lowBandBuncherAmp');
  assert(buncherAmp.rf_out?.params.capacity === 10
      && buncherAmp.rf_out.params.dutyFactor === 1.0
      && buncherAmp.rf_out.params.bands.join(',') === 'vhf,uhf',
  'starter buncher amplifier provides 10 kW CW across VHF/UHF');
  assert(buncherAmp.hv_in?.utility === 'hvCable'
      && buncherAmp.hv_in.params.demand === 18,
  'starter buncher amplifier exposes its 18 kW HV input');

  const ecr = getUtilityPortsV2('ecrIonSource');
  assert(ecr.rf_in.params.frequency === 2450 * 1e6,
    `ecrIonSource rf_in frequency === 2.45e9 Hz (got ${ecr.rf_in.params.frequency})`);
  assert(ecr.rf_in.params.band === 'sband',
    `ecrIonSource rf_in lands in sband (got ${ecr.rf_in.params.band})`);
  assert(ecr.rf_in.params.demand === 6,
    `ecrIonSource rf_in is sized for its 6 kW high-current setting (got ${ecr.rf_in.params.demand})`);

  const ssa = getUtilityPortsV2('solidStateAmp');
  const ssaOutlets = Object.values(ssa).filter(port => port.role === 'source'
    && port.utility === 'rfWaveguide');
  assert(ssaOutlets.length === 4 && ssaOutlets.every(port => port.params.bands.join(',') === 'vhf,uhf'),
    `solidStateAmp's four outputs cover vhf,uhf (got ${ssaOutlets.map(port => port.params.bands.join(',')).join(';')})`);
  assert(ssa.hv_in?.utility === 'hvCable'
      && ssa.hv_in.role === 'sink'
      && ssa.hv_in.side === 'right'
      && ssa.hv_in.connectionKind === 'hvLoadTap'
      && ssa.hv_in.maxConnections === 2
      && ssa.hv_in.params.demand === 70,
    'solid-state RF source exposes its required 70 kW HV input opposite its RF outputs');

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

// Sector-scale SRF placements render banks of fundamental-power couplers.
// Every visible sector coupler is a distinct routable sink, while splitting
// the old aggregate loads keeps catalogue balance unchanged. Vacuum gets the
// same distributed hookup treatment on the opposite service side.
console.log('\n--- SRF sector multi-port banks ---');
{
  const sectors = [
    ['cwCryomodule', 3, 100, 6e-6],
    ['nbSnCryomodule', 2, 200, 6e-6],
    ['srfLinacSector', 3, 600, 8e-6],
  ];
  for (const [id, count, rfDemand, outgassing] of sectors) {
    const ports = getUtilityPortsV2(id);
    const rf = Object.entries(ports)
      .filter(([, port]) => port.utility === 'rfWaveguide' && port.role === 'sink');
    const vacuum = Object.entries(ports)
      .filter(([, port]) => port.utility === 'vacuumPipe' && port.role === 'sink');
    assert(rf.length === count,
      `${id} exposes all ${count} rendered RF couplers (got ${rf.map(([name]) => name).join(',')})`);
    assert(vacuum.length === count,
      `${id} exposes ${count} distributed vacuum hookups (got ${vacuum.map(([name]) => name).join(',')})`);
    assert(Math.abs(rf.reduce((sum, [, port]) => sum + port.params.demand, 0) - rfDemand) < 1e-9,
      `${id} preserves its ${rfDemand} kW total RF demand`);
    assert(Math.abs(vacuum.reduce((sum, [, port]) => sum + port.params.outgassing, 0) - outgassing) < 1e-15,
      `${id} preserves its ${outgassing} mbar·L/s total outgassing`);
    assert(new Set(rf.map(([, port]) => port.offsetAlong)).size === count,
      `${id} RF ports occupy distinct routable positions`);
    assert(new Set(vacuum.map(([, port]) => port.offsetAlong)).size === count,
      `${id} vacuum ports occupy distinct routable positions`);
  }
}

// ==========================================================================
// Test 10: source capacity ladders per utility.
// ==========================================================================
console.log('\n--- Test 10: infrastructure capacity ladders ---');
{
  // Power comes in two tiers now: SUPPLY holds the capacity and hands out HV
  // feeders, DISTRIBUTION takes one feeder and hands out branch circuits. The
  // ladder is therefore over the supplies; a panel's rating caps its live
  // downstream draw rather than adding capacity.
  const pad = getUtilityPortsV2('padMountTransformer');
  const facility = getUtilityPortsV2('facilityTransformer');
  const hv = getUtilityPortsV2('hvTransformer');
  const grid = getUtilityPortsV2('gridIntertieTransformer');
  const service = getUtilityPortsV2('gridServicePoint');
  const highService = getUtilityPortsV2('gridServicePointHighCapacity');
  const hvOutlets = ports => Object.values(ports)
    .filter(port => port.utility === 'hvCable' && port.role === 'source');
  assert([service, highService].map(ports => hvOutlets(ports).length).join(',') === '2,4',
    'utility service tiers expose two and four physical HV feeder outlets');
  assert([service, highService].map(ports => hvOutlets(ports)
    .reduce((sum, port) => sum + port.params.capacity, 0)).join(',') === '3000,6000',
    'utility service tiers provide 3 MW and 6 MW nameplate capacity');
  assert([pad, facility, hv, grid].map(ports => hvOutlets(ports).length).join(',') === '1,2,4,6',
    'transformer tiers expose one, two, four, and six downstream HV outlets');
  assert([pad, facility, hv, grid].map(ports => hvOutlets(ports)
    .reduce((sum, port) => sum + port.params.capacity, 0)).join(',') === '150,400,1500,6000',
    'split outlet ratings add back to each transformer nameplate capacity');
  assert(hv.hv_in.connectionKind === 'hvLoadIn'
      && grid.hv_in.connectionKind === 'hvLoadIn'
      && hv.hv_in.params.demand === 1500
      && grid.hv_in.params.demand === 6000
      && hv.hv_in.params.tracksDownstreamDemand === true
      && grid.hv_in.params.tracksDownstreamDemand === true,
    'large transformer inputs track downstream demand up to their nameplate ratings');
  assert(pad.hv_out_1.params.capacity < facility.hv_out_1.params.capacity
      && facility.hv_out_1.params.capacity < hv.hv_out_1.params.capacity
      && hv.hv_out_1.params.capacity < grid.hv_out_1.params.capacity,
    'HV transformer ladder: pad-mount < facility < 1.5 MW < 6 MW');

  const compactGear = getUtilityPortsV2('compactHvDistributor');
  const compactHvDistributorOutputs = Object.values(compactGear)
    .filter(p => p.connectionKind === 'hvDistributionOut');
  assert(compactGear.hv_in?.connectionKind === 'hvDistributionTap'
      && compactGear.hv_in.role === 'sink'
      && compactGear.hv_in.omnidirectional === true
      && compactGear.hv_in.maxConnections === 2
      && compactGear.hv_in.params.demand === 600
      && compactGear.hv_in.params.tracksDownstreamDemand === true
      && compactHvDistributorOutputs.length === 2
      && compactHvDistributorOutputs.every(p => p.params.capacity === 300),
    'Compact HV Distributor taps a two-wire trunk into two protected 300 kW outputs');
  assert(INFRASTRUCTURE_RAW.compactHvDistributor.electricalControl?.breaker?.rating === 600,
    'Compact HV Distributor breaker matches its 600 kW feeder rating');

  const gear = getUtilityPortsV2('switchgear');
  const hvDistributorOutputs = Object.values(gear)
    .filter(p => p.connectionKind === 'hvDistributionOut');
  assert(gear.hv_in?.connectionKind === 'hvDistributionTap'
      && gear.hv_in.role === 'sink'
      && gear.hv_in.omnidirectional === true
      && gear.hv_in.maxConnections === 2
      && gear.hv_in.params.demand === 1200
      && gear.hv_in.params.tracksDownstreamDemand === true
      && hvDistributorOutputs.length === 4
      && hvDistributorOutputs.every(p => p.params.capacity === 300),
    'HV Distributor Box taps a two-wire trunk into four protected 300 kW outputs');
  assert(INFRASTRUCTURE_RAW.switchgear.electricalControl?.breaker?.rating === 1200,
    'HV Distributor Box breaker matches its 1,200 kW feeder rating');
  assert(compactHvDistributorOutputs.length < hvDistributorOutputs.length
      && compactGear.hv_in.params.demand < gear.hv_in.params.demand,
    'compact HV distribution is the smaller 1-to-2 rung below the 1-to-4 box');

  const panel = getUtilityPortsV2('powerPanel');
  const section = getUtilityPortsV2('sectionDistributionPanel');
  const main = getUtilityPortsV2('mainDistributionPanel');
  assert(panel.hv_in.params.demand < section.hv_in.params.demand
      && section.hv_in.params.demand < main.hv_in.params.demand
      && [panel, section, main].every(ports => ports.hv_in.params.tracksDownstreamDemand === true),
    'distribution ladder ratings cap dynamic draw: compact < section < main panel');
  const outlets = (t) => Object.keys(getUtilityPortsV2(t))
    .filter(n => n.startsWith('pwr_out')).length;
  assert([outlets('powerPanel'), outlets('sectionDistributionPanel'), outlets('mainDistributionPanel')]
    .join(',') === '4,8,8',
  'compact, section, and main panels expose 4, 8, and 8 physical outlets');
  const sectionOutputs = Object.entries(section)
    .filter(([name]) => name.startsWith('pwr_out'))
    .map(([, spec]) => spec);
  assert(section.hv_in.params.demand === 200
      && sectionOutputs.every(spec => spec.params.capacity === 25)
      && INFRASTRUCTURE_RAW.sectionDistributionPanel.electricalControl?.breaker?.rating === 200,
  'section panel has eight 25 kW circuits behind one 200 kW feeder breaker');
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
  const spiderPorts = Object.values(spider);
  assert(spiderPorts.length === 4
      && spiderPorts.every(p => p.role === 'pass'
        && p.connectionKind === 'powerFieldPort'
        && p.params.fieldCapacity === 30),
    'spider box has four interchangeable pass-through sockets sharing one 30 kW rating');
  assert(outlets('hvTransformer') === 0,
    'a supply hands out no branch circuits — everything goes through distribution');

  const lcw = getUtilityPortsV2('lcwSkid');
  const packageChiller = getUtilityPortsV2('packageChiller');
  const solidStateAmp = getUtilityPortsV2('solidStateAmp');
  const tower = getUtilityPortsV2('coolingTower');
  const tank = getUtilityPortsV2('waterTank');
  const replenishmentPlant = getUtilityPortsV2('facilityWaterSupply');
  const bulkTank = getUtilityPortsV2('bulkWaterTank');
  const coolingSources = ports => Object.entries(ports)
    .filter(([, port]) => port.utility === 'coolingWater' && port.role === 'source');
  const total = (ports, param) => coolingSources(ports)
    .reduce((sum, [, port]) => sum + (port.params?.[param] || 0), 0);
  const totalSources = (ports, param) => Object.values(ports)
    .filter(port => port.role === 'source')
    .reduce((sum, port) => sum + (port.params?.[param] || 0), 0);
  const hasPlantLayout = ports => {
    const sources = coolingSources(ports);
    return sources.length === 6
      && sources.filter(([, port]) => port.side === 'right').length === 4
      && sources.filter(([, port]) => port.side === 'left').length === 2
      && new Set(sources.filter(([, port]) => port.side === 'right')
        .map(([, port]) => port.offsetAlong)).size === 4
      && new Set(sources.filter(([, port]) => port.side === 'left')
        .map(([, port]) => port.offsetAlong)).size === 2;
  };
  const hasRejectorLayout = ports => {
    const sources = Object.entries(ports)
      .filter(([, port]) => port.utility === 'waterSupplyPipe'
        && port.role === 'source');
    return sources.length === 2
      && new Set(sources.map(([, port]) => port.side)).size === 1
      && new Set(sources.map(([, port]) => port.offsetAlong)).size === 2;
  };
  const lcwOutlets = Object.entries(lcw)
    .filter(([, port]) => port.utility === 'coolingWater' && port.role === 'source');
  assert(hasPlantLayout(lcw)
      && Math.abs(total(lcw, 'storageCapacityL') - 500) < 1e-9
      && Math.abs(total(lcw, 'supplyRateLPerTick') - 0.5) < 1e-9
      && Math.abs(total(lcw, 'capacity') - 25) < 1e-9
      && Math.abs(total(lcw, 'heatRejectionCapacity') - 25) < 1e-9,
  'LCW skid has a 4+2 header sharing one self-contained 25 kW plant and 0.5 L/tick make-up');
  const lcwDef = { ports: lcw };
  assert(lcwOutlets.filter(([name]) => portSide(lcwDef, name, 0, false) === 'E').length === 4
      && lcwOutlets.filter(([name]) => portSide(lcwDef, name, 0, true) === 'W').length === 4
      && lcwOutlets.filter(([name]) => portSide(lcwDef, name, 1, false) === 'S').length === 4,
  'the 4+2 header mirrors with M and rotates with F');
  const packageOutlets = Object.entries(packageChiller)
    .filter(([, port]) => port.utility === 'coolingWater' && port.role === 'source');
  assert(hasPlantLayout(packageChiller)
      && Math.abs(total(packageChiller, 'capacity') - 5) < 1e-9
      && Math.abs(total(packageChiller, 'heatRejectionCapacity') - 5) < 1e-9
      && Math.abs(total(packageChiller, 'storageCapacityL') - 100) < 1e-9
      && Math.abs(total(packageChiller, 'supplyRateLPerTick') - 0.1) < 1e-9,
  'package chiller has a 4+2 header sharing one self-contained 5 kW plant and 0.1 L/tick make-up');
  for (const type of ['waterTank', 'facilityWaterSupply', 'bulkWaterTank']) {
    assert(hasPlantLayout(getUtilityPortsV2(type)),
      `${type} exposes four primary-side and two opposite-side connections`);
  }
  for (const type of ['dualCircuitChiller', 'chiller']) {
    const ports = getUtilityPortsV2(type);
    const flexible = coolingSources(ports);
    const rigid = Object.entries(ports)
      .filter(([, port]) => port.utility === 'waterSupplyPipe');
    assert(flexible.length === 4
        && flexible.every(([, port]) => port.params.waterCircuit === 'cold')
        && rigid.length === 2
        && ports.room_in.params.waterCircuit === 'room'
        && ports.room_in.role === 'sink'
        && ports.supply_cold_out.params.waterCircuit === 'cold',
    `${type} exposes four cold-water lines plus room-in and cold-out supply pipe ports`);
  }
  assert(total(tank, 'capacity') === 0,
    'make-up tank stores cooling water without supplying process-cooling capacity');
  assert(Math.abs(total(tank, 'supplyRateLPerTick') - 1) < 1e-9
      && Math.abs(total(tank, 'storageCapacityL') - 500) < 1e-9,
    'make-up tank authors independent 1 L/tick supply and 500 L storage');
  assert(INFRASTRUCTURE_RAW.facilityWaterSupply.name === 'Water Replenishment Plant'
      && INFRASTRUCTURE_RAW.facilityWaterSupply.subsection === 'waterSupply',
    'the dedicated replenishment building is discoverable under Water Supply');
  assert(total(replenishmentPlant, 'capacity') === 0
      && Math.abs(total(replenishmentPlant, 'supplyRateLPerTick') - 20) < 1e-9
      && total(replenishmentPlant, 'storageCapacityL') === 0,
    'water replenishment plant adds make-up flow without cooling or storage');
  assert(total(bulkTank, 'capacity') === 0
      && total(bulkTank, 'supplyRateLPerTick') === 0
      && Math.abs(total(bulkTank, 'storageCapacityL') - 5000) < 1e-9,
    'bulk tanks provide large passive storage and generate no water');
  for (const type of ['fanCoilCooler', 'dryCoolerBank', 'coolingTower']) {
    assert(hasRejectorLayout(getUtilityPortsV2(type)),
      `${type} exposes its two heat-rejection connections on one side`);
  }
  assert(hasRejectorLayout(getUtilityPortsV2('heatExchanger')),
    'the lab heat exchanger exposes one hot inlet and one room-temperature outlet');
  const labChiller = getUtilityPortsV2('chillerUnit');
  assert(labChiller.room_in.params.waterCircuit === 'room'
      && labChiller.room_in.role === 'sink'
      && labChiller.cold_out.params.waterCircuit === 'cold'
      && labChiller.cold_out.role === 'source',
  'the lab chiller exposes one room-temperature inlet and one cold outlet');
  const ssaOutputs = Object.entries(solidStateAmp)
    .filter(([, port]) => port.utility === 'rfWaveguide' && port.role === 'source');
  assert(ssaOutputs.length === 4
      && ssaOutputs.every(([, port]) => port.side === 'left')
      && ssaOutputs.reduce((sum, [, port]) => sum + port.params.capacity, 0) === 35,
  'solid-state amplifier exposes four left-side RF outputs totaling 35 kW');
  assert(solidStateAmp.hv_in.side === 'right',
    'solid-state amplifier keeps its HV input on the side opposite its RF outputs');
  const invalidLoadTaps = HV_LOAD_TAP_IDS.filter((type) => {
    const port = getUtilityPortsV2(type).hv_in;
    return port?.utility !== 'hvCable' || port.role !== 'sink'
      || port.connectionKind !== 'hvLoadTap'
      || port.omnidirectional !== true || port.maxConnections !== 2
      || !(port.params.demand > 0);
  });
  assert(invalidLoadTaps.length === 0,
    `cooling and cabinet RF roof taps remain two-cable HV loads (${invalidLoadTaps.join(',') || 'all covered'})`);
  for (const type of ['widebandDriverAmp', 'slac5045Klystron', 'pulsedKlystron',
    'cwKlystron', 'iot', 'multibeamKlystron', 'gyrotron']) {
    const hv = getUtilityPortsV2(type).hv_in;
    assert(hv.connectionKind === 'hvLoadIn' && hv.maxConnections == null,
      `${type} keeps its single-ended tube-source HV inlet`);
  }
  assert(Math.abs(totalSources(tower, 'heatRejectionCapacity') - 800) < 1e-9,
    'cooling tower provides heat rejection on hot Water Supply Pipe');
  assert(coolingSources(tank).every(([, port]) => port.params.storageCapacityL > 0
      && port.params.supplyRateLPerTick > 0),
    'every make-up tank header branch carries its share of both water capabilities');

  const rough = getUtilityPortsV2('roughingPump');
  const roughCart = getUtilityPortsV2('roughingPumpCart');
  const turbo = getUtilityPortsV2('turboPump');
  const turboCart = getUtilityPortsV2('turboPumpCart');
  const ion = getUtilityPortsV2('ionPump');
  assert(rough.vac_out.params.pumpSpeed < roughCart.vac_out.params.pumpSpeed
      && roughCart.vac_out.params.pumpSpeed < turbo.vac_out.params.pumpSpeed
      && turbo.vac_out.params.pumpSpeed < ion.vac_out.params.pumpSpeed,
    'vacuum ladder: single roughing < roughing cart < turbo < ion');
  assert(turboCart.vac_out.params.highVacSpeed === turbo.vac_out.params.highVacSpeed * 4,
    'turbo cart is a four-stage bank, not an integrated roughing shortcut');

  const cb4 = getUtilityPortsV2('coldBox4K');
  const cb2 = getUtilityPortsV2('coldBox2K');
  assert(cb4.cryo_out.params.coldCapacityW < cb2.cryo_out.params.coldCapacityW,
    'cryo ladder: coldBox4K < coldBox2K');

  const realisticPlantLoads = [
    ['heCompressor', 20],
    ['dualCircuitChiller', 35],
    ['chiller', 60],
    ['coldBox4K', 125],
    ['coldBox2K', 600],
    ['coolingTower', 20],
  ];
  for (const [id, demand] of realisticPlantLoads) {
    const ports = getUtilityPortsV2(id);
    assert(ports.hv_in?.utility === 'hvCable'
        && ports.hv_in.role === 'sink'
        && ports.hv_in.connectionKind === 'hvLoadTap'
        && ports.hv_in.maxConnections === 2
        && ports.hv_in.params.demand === demand
        && !ports.pwr_in,
      `${id}: ${demand} kW plant demand stays on one two-cable HV load tap`);
  }
  assert(cb4.hv_in.params.demand === cb4.cryo_out.params.coldCapacityW * 250 / 1000,
    '4 K cold-box draw applies the published 250 W_wall/W_cold penalty');
  assert(cb2.hv_in.params.demand === cb2.cryo_out.params.coldCapacityW * 750 / 1000,
    '2 K cold-box draw applies the published 750 W_wall/W_cold penalty');
  assert(getUtilityPortsV2('lcwSkid').pwr_in.params.demand === 5
      && !getUtilityPortsV2('lcwSkid').hv_in,
    '25 kW LCW skid stays a 5 kW branch load at COP 5');

  for (const id of ['packageChiller', 'lcwSkid']) {
    const coolingSources = Object.values(getUtilityPortsV2(id))
      .filter(port => port.utility === 'coolingWater' && port.role === 'source');
    assert(coolingSources.slice(0, 4).every(port => port.autoConnectClass
        === COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH)
        && coolingSources.slice(4).every(port => port.autoConnectClass
          === COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED),
    `${id} reserves four load branches and two distribution feeds`);
  }
  for (const id of ['waterTank', 'facilityWaterSupply', 'bulkWaterTank']) {
    const coolingSources = Object.values(getUtilityPortsV2(id))
      .filter(port => port.utility === 'coolingWater' && port.role === 'source');
    assert(coolingSources.length > 0 && coolingSources.every(port => port.autoConnectClass
        === COOLING_AUTO_CONNECT_CLASS.PLANT_LINK),
    `${id} exposes only plant-side assisted-wiring connections`);
  }
  for (const id of ['fanCoilCooler', 'dryCoolerBank', 'coolingTower']) {
    const pipeSources = Object.values(getUtilityPortsV2(id))
      .filter(port => port.utility === 'waterSupplyPipe' && port.role === 'source');
    assert(pipeSources.length === 2
        && pipeSources.filter(port => port.params.waterCircuit === 'hot').length === 1
        && pipeSources.filter(port => port.params.waterCircuit === 'room').length === 1,
    `${id} exposes one hot inlet and one room-temperature outlet`);
  }
  const manifoldPorts = Object.values(getUtilityPortsV2('coolingManifold'));
  const manifoldRigid = manifoldPorts.filter(port => port.utility === 'waterSupplyPipe');
  const manifoldFlexible = manifoldPorts.filter(port => port.utility === 'coolingWater');
  assert(manifoldRigid.length === 2
      && manifoldRigid.filter(port => port.params.waterCircuit === 'cold').length === 1
      && manifoldRigid.filter(port => port.params.waterCircuit === 'hot').length === 1,
  'the LCW manifold has one rigid cold header and one rigid hot header');
  assert(manifoldFlexible.length === 8
      && manifoldFlexible.filter(port => port.params.waterCircuit === 'cold').length === 4
      && manifoldFlexible.filter(port => port.params.waterCircuit === 'hot').length === 4
      && manifoldFlexible.every(port => port.autoConnectClass
        === COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH),
  'the LCW manifold exposes four blue and four red flexible load branches');
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
// Logical approach points remain spread over cabinet faces. Presentation
// anchors independently move the physical connectors onto the roof hardware.
// ==========================================================================
console.log('\n--- Distribution cabinet port layout ---');
{
  for (const [id, count] of [['powerPanel', 4], ['sectionDistributionPanel', 8], ['mainDistributionPanel', 8]]) {
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
