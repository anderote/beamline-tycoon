// test/test-utility-solve-vacuumPipe.js — tests for vacuumPipe.solve() v1.
//
// Physics: pressure = totalOutgas / totalPumpSpeed, mapped to quality on a log
// scale between 1e-8 (q=1) and 1e-2 (q=0). Hard vacuum_no_pump if sinks exist
// without a pump; soft vacuum_poor when pressure > 1e-5.

import desc, {
  circularPipeVolumeLitres, numberDensityFromPressure,
  ROUGH_ULTIMATE_PRESSURE_MBAR, HIGH_ULTIMATE_PRESSURE_MBAR,
  UHV_ULTIMATE_PRESSURE_MBAR, VACUUM_HISTORY_TICKS,
  VACUUM_HISTORY_RANGES, VACUUM_TICKS_PER_DAY,
  DEFAULT_VACUUM_HISTORY_RANGE_TICKS, renderVacuumPressureGraph,
} from '../src/utility/types/vacuumPipe.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'vacuumPipe',
    lineIds: [],
    ports: [],
    sources: [],
    sinks: [],
    ...overrides,
  };
}

// ==========================================================================
// Test 1: empty network.
// ==========================================================================
console.log('\n--- Test 1: no sources, no sinks ---');
{
  const r = desc.solve(mkNetwork({}), {}, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(Object.keys(r.flowState.perSinkQuality).length === 0, 'perSinkQuality empty');
}

// ==========================================================================
// Test 2: pump 100 L/s, outgas 1e-8 → pressure 1e-10 ≤ 1e-8 → quality 1.
// ==========================================================================
console.log('\n--- Test 2: pump 100, outgas 1e-8 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-8 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 1), `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 3: pump 100, outgas 1e-6 → pressure 1e-8 = threshold → quality 1, no error.
// ==========================================================================
console.log('\n--- Test 3: pump 100, outgas 1e-6 → p=1e-8 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-6 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 1), `k1 quality 1 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
}

// ==========================================================================
// Test 4: no pump, one sink → hard vacuum_no_pump.
// ==========================================================================
console.log('\n--- Test 4: no pump, one sink ---');
{
  const net = mkNetwork({
    sinks: [{ portKey: 'k1', placeableId: 'p2', portName: 'vac', params: { outgassing: 1e-6 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, `k1 quality 0 (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'hard', `severity hard (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'vacuum_no_pump', `code vacuum_no_pump (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 5: pump 1 L/s, outgas 1e-3 → rough but usable vacuum + warning.
// ==========================================================================
console.log('\n--- Test 5: pump 1, outgas 1e-3 → p=1e-3 ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 1 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-3 } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 > 0 && r.flowState.perSinkQuality.k1 < 0.2,
    `1e-3 mbar remains a low but nonzero quality (got ${r.flowState.perSinkQuality.k1})`);
  assert(r.errors.length === 1, `1 error (got ${r.errors.length})`);
  assert(r.errors[0].severity === 'soft', `severity soft (got ${r.errors[0].severity})`);
  assert(r.errors[0].code === 'vacuum_poor', `code vacuum_poor (got ${r.errors[0].code})`);
}

// ==========================================================================
// Test 6: purity + persistent pass-through.
// ==========================================================================
console.log('\n--- Test 6: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'pump', params: { pumpSpeed: 100 } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'vac',  params: { outgassing: 1e-7 } }],
  });
  const netSnap = JSON.stringify(net);
  const persistent = { foo: 1 };
  const persistSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === netSnap, 'network not mutated');
  assert(JSON.stringify(persistent) === persistSnap, 'persistent not mutated');
  assert(r.nextPersistentState !== persistent && r.nextPersistentState.gasInventoryMbarL === 0,
    'dynamic gas inventory is returned without mutating the input state');
}

// ==========================================================================
// Test 7: a powered pump contributes only when its power sink is live.
// ==========================================================================
console.log('\n--- Test 7: powered pump is fail-closed ---');
{
  const powerNetwork = {
    id: 'net_power', ports: [{ placeableId: 'pump_1', portName: 'pwr_in' }],
  };
  const world = {
    placeables: [{ id: 'pump_1', type: 'roughingPump' }],
    utilityNetworks: new Map([['powerCable', [powerNetwork]]]),
    utilityNetworkData: new Map([['powerCable', new Map([['net_power', {
      perSinkQuality: { 'pump_1:pwr_in': 0.5 },
    }]])]]),
  };
  const net = mkNetwork({
    sources: [{ portKey: 'pump_1:vac_out', placeableId: 'pump_1', portName: 'vac_out', params: { pumpSpeed: 100 } }],
  });
  const halfPowered = desc.solve(net, {}, world);
  assert(halfPowered.flowState.totalCapacity === 50,
    `a partly served power inlet derates pump speed (got ${halfPowered.flowState.totalCapacity})`);

  world.utilityNetworkData = new Map();
  const unpowered = desc.solve(net, {}, world);
  assert(unpowered.flowState.totalCapacity === 0,
    'an unwired power inlet contributes no pumping capacity');
}

// ==========================================================================
console.log('\n--- Test 8: staged pumping and gas inventory ---');
{
  const sink = {
    portKey: 'load_1:vac_in', placeableId: 'load_1', portName: 'vac_in',
    params: { outgassing: 1e-6 },
  };
  const source = (id, params) => ({
    portKey: `${id}:vac_out`, placeableId: id, portName: 'vac_out', params,
  });
  const pipeVolume = circularPipeVolumeLitres(1);
  const world = (pumpTypes, line = null, tick = 0) => ({
    tick,
    placeables: Object.entries(pumpTypes).map(([id, type]) => ({ id, type, col: 0, row: 0 })),
    beamPipes: [{ id: 'bp_1', subL: 2, placements: [{ id: 'load_1', type: 'bpm' }] }],
    utilityLines: new Map(line ? [[line.id, line]] : []),
  });
  const lowInventory = { gasInventoryMbarL: 1e-4 * pipeVolume, pressureHistory: [] };

  const roughParams = {
    pumpSpeed: 15, roughingSpeed: 15, vacuumStage: 'rough', ultimatePressure: 1e-3,
  };
  const turboParams = {
    pumpSpeed: 300, highVacSpeed: 300, backingDemand: 15,
    vacuumStage: 'high', ultimatePressure: 1e-8,
  };
  const roughCartParams = {
    pumpSpeed: 60, roughingSpeed: 60, vacuumStage: 'rough', ultimatePressure: 1e-3,
  };
  const turboCartParams = {
    pumpSpeed: 1200, highVacSpeed: 1200, backingDemand: 60,
    vacuumStage: 'high', ultimatePressure: 1e-8,
  };
  const ionParams = {
    pumpSpeed: 600, uhvSpeed: 600, requiresHighVac: true,
    vacuumStage: 'uhv', ultimatePressure: 1e-11,
  };

  const roughOnly = desc.solve(mkNetwork({
    sources: [source('rough_1', roughParams)], sinks: [sink],
  }), {}, world({ rough_1: 'roughingPump' })).flowState;
  assert(roughOnly.vacuumStage === 'rough'
      && roughOnly.equilibriumPressure >= ROUGH_ULTIMATE_PRESSURE_MBAR,
    'a roughing pump has a real rough-vacuum floor');
  assert(roughOnly.networkPressure < 1013,
    'gas inventory falls on the first pump-down tick');

  const unbacked = desc.solve(mkNetwork({
    sources: [source('turbo_1', turboParams)], sinks: [sink],
  }), lowInventory, world({ turbo_1: 'turboPump' }));
  assert(unbacked.flowState.totalCapacity === 0
      && unbacked.errors.some(e => e.code === 'vacuum_turbo_unbacked'),
    'a turbo contributes nothing without rough backing');

  const backed = desc.solve(mkNetwork({
    sources: [source('rough_1', roughParams), source('turbo_1', turboParams)], sinks: [sink],
  }), lowInventory, world({ rough_1: 'roughingPump', turbo_1: 'turboPump' })).flowState;
  assert(backed.vacuumStage === 'high' && backed.backingFactor === 1,
    '15 L/s of roughing capacity fully backs one turbo');
  assert(backed.equilibriumPressure >= HIGH_ULTIMATE_PRESSURE_MBAR
      && backed.equilibriumPressure < ROUGH_ULTIMATE_PRESSURE_MBAR,
    'a complete rough-plus-turbo stack reaches high vacuum');

  const backedCart = desc.solve(mkNetwork({
    sources: [
      source('rough_cart', roughCartParams),
      source('turbo_cart', turboCartParams),
    ],
    sinks: [sink],
  }), lowInventory, world({
    rough_cart: 'roughingPumpCart', turbo_cart: 'turboPumpCart',
  })).flowState;
  assert(backedCart.vacuumStage === 'high'
      && backedCart.backingFactor === 1
      && backedCart.totalCapacity === 1200,
    'one 60 L/s roughing cart fully backs the 1,200 L/s turbo cart');

  const uhvInventory = { gasInventoryMbarL: 1e-6 * pipeVolume, pressureHistory: [] };
  const uhv = desc.solve(mkNetwork({
    sources: [
      source('rough_1', roughParams), source('turbo_1', turboParams),
      source('ion_1', ionParams),
    ],
    sinks: [sink],
  }), uhvInventory, world({
    rough_1: 'roughingPump', turbo_1: 'turboPump', ion_1: 'ionPump',
  })).flowState;
  assert(uhv.vacuumStage === 'uhv' && uhv.ultimatePressure === UHV_ULTIMATE_PRESSURE_MBAR,
    'an ion pump upgrades a live rough-plus-turbo stack to UHV');

  assert(approx(numberDensityFromPressure(1e-8), 2.4143235e14, 1e8),
    `1e-8 mbar at 300 K becomes physical molecular density (${numberDensityFromPressure(1e-8)})`);
  assert(uhv.perSinkNumberDensity['load_1:vac_in'] > 0,
    'the solver publishes density at every vacuum sink');
}

// ==========================================================================
console.log('\n--- Test 9: shared-header capacity and gauge history ---');
{
  const line = {
    id: 'vac_line', utilityType: 'vacuumPipe',
    path: [{ col: 0, row: 0 }, { col: 20, row: 0 }],
    start: { placeableId: 'turbo_1', portName: 'vac_out' }, end: null,
    attachments: [{ id: 'gauge_1', type: 'piraniGauge', position: 0.75 }],
  };
  const volume = circularPipeVolumeLitres(1) + circularPipeVolumeLitres(40);
  const net = mkNetwork({
    lineIds: [line.id],
    sources: [
      { portKey: 'rough_1:vac_out', placeableId: 'rough_1', portName: 'vac_out', params: {
        pumpSpeed: 15, roughingSpeed: 15, vacuumStage: 'rough',
      } },
      { portKey: 'turbo_1:vac_out', placeableId: 'turbo_1', portName: 'vac_out', params: {
        pumpSpeed: 300, highVacSpeed: 300, backingDemand: 15, vacuumStage: 'high',
      } },
    ],
    sinks: [{
      portKey: 'load_1:vac_in', placeableId: 'load_1', portName: 'vac_in',
      params: { outgassing: 1e-6 },
    }],
  });
  const world = {
    tick: 10,
    placeables: [
      { id: 'rough_1', type: 'roughingPump', col: 0, row: 0 },
      { id: 'turbo_1', type: 'turboPump', col: 0, row: 0 },
    ],
    beamPipes: [{ id: 'bp_1', subL: 2, placements: [{ id: 'load_1', type: 'bpm' }] }],
    utilityLines: new Map([[line.id, line]]),
  };
  const result = desc.solve(net, {
    gasInventoryMbarL: 1e-4 * volume, pressureHistory: [],
  }, world);
  assert(result.flowState.effectivePumpSpeed === 300,
    `a 300 L/s turbo contributes its full capacity anywhere on the connected header (${result.flowState.effectivePumpSpeed.toFixed(1)} L/s)`);
  assert(result.flowState.gauges.length === 1
      && result.flowState.gauges[0].type === 'piraniGauge',
    'line-mounted gauges sample the shared network vacuum');
  assert(result.flowState.pressureHistory.length === 1
      && result.flowState.pressureHistory[0].pressure === result.flowState.networkPressure
      && result.flowState.pressureHistory[0].readings.gauge_1 > 0,
    'network and gauge pressure are recorded into the rolling history');
  const pipeZone = result.flowState.vacuumZones.find(zone => zone.id === 'network-pipework');
  const loadZone = result.flowState.vacuumZones.find(zone => zone.id === 'load_1:vac_in');
  assert(pipeZone?.outgassingMbarLps === result.flowState.pipeOutgas
      && pipeZone?.pumpingSpeedLps === result.flowState.effectivePumpSpeed
      && loadZone?.outgassingMbarLps === 1e-6
      && loadZone?.pumpingSpeedLps === result.flowState.effectivePumpSpeed
      && loadZone?.pressureMbar === result.flowState.perSinkPressure['load_1:vac_in'],
    'every plotted vacuum zone receives the shared header pumping and pressure');

  const reversed = desc.solve({
    ...net,
    sources: [...net.sources].reverse(),
    sinks: [...net.sinks, {
      portKey: 'load_2:vac_in', placeableId: 'load_2', portName: 'vac_in',
      params: { outgassing: 2e-6 },
    }],
  }, {
    gasInventoryMbarL: 1e-4 * volume, pressureHistory: [],
  }, {
    ...world,
    beamPipes: [{
      id: 'bp_1', subL: 2,
      placements: [
        { id: 'load_1', type: 'bpm' },
        { id: 'load_2', type: 'bpm', worldX: 1000, worldZ: 1000 },
      ],
    }],
  });
  assert(reversed.flowState.effectivePumpSpeed === 300
      && reversed.flowState.perSinkPressure['load_1:vac_in']
        === reversed.flowState.perSinkPressure['load_2:vac_in'],
    'source order and sink distance do not change shared-header capacity or pressure');
  const html = desc.renderInspector(net, result.flowState, result.nextPersistentState);
  assert(VACUUM_HISTORY_TICKS === VACUUM_TICKS_PER_DAY * 10
      && DEFAULT_VACUUM_HISTORY_RANGE_TICKS === VACUUM_HISTORY_TICKS,
    'vacuum history retains ten days and defaults to the widest range');
  assert(VACUUM_HISTORY_RANGES.map(range => range.label).join(',') === '1d,2d,10d'
      && html.includes(`data-vacuum-range-ticks="${VACUUM_HISTORY_TICKS}" aria-pressed="true"`)
      && html.includes('-10d') && html.includes('-5d')
      && html.includes('Network') && html.includes('<svg'),
    'the vacuum network inspector renders 1d/2d/10d controls with 10d selected');
  const oneDayHtml = renderVacuumPressureGraph(result.flowState, VACUUM_TICKS_PER_DAY);
  assert(oneDayHtml.includes(`data-vacuum-range-ticks="${VACUUM_TICKS_PER_DAY}" aria-pressed="true"`)
      && oneDayHtml.includes('-1d') && oneDayHtml.includes('-12h'),
    'the pressure graph renders the selected one-day axis and control state');

  world.tick = VACUUM_HISTORY_TICKS + 10;
  const trimmed = desc.solve(net, {
    gasInventoryMbarL: result.nextPersistentState.gasInventoryMbarL,
    pressureHistory: [
      { tick: 9, pressure: 1e-3, readings: { gauge_1: 1e-3 } },
      { tick: 10, pressure: 1e-4, readings: { gauge_1: 1e-4 } },
    ],
  }, world);
  assert(trimmed.flowState.pressureHistory.length === 2
      && trimmed.flowState.pressureHistory[0].tick === 10
      && trimmed.flowState.pressureHistory[1].tick === world.tick,
    'pressure history retains exactly the latest 10 in-game days');
}

// ==========================================================================
console.log('\n--- Test 10: ungauged network history ---');
{
  const line = {
    id: 'bare_vac_line', utilityType: 'vacuumPipe',
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    start: null, end: null, attachments: [],
  };
  const net = mkNetwork({ lineIds: [line.id] });
  const world = { tick: 25, utilityLines: new Map([[line.id, line]]) };
  const result = desc.solve(net, { pressureHistory: [] }, world);
  const html = desc.renderInspector(net, result.flowState, result.nextPersistentState);
  assert(result.flowState.gauges.length === 0
      && result.flowState.pressureHistory[0].pressure === result.flowState.networkPressure,
    'an ungauged vacuum run still records its published network pressure');
  assert(html.includes('vacuum-pressure-chart') && html.includes('Network')
      && !html.includes('Mount a Pirani'),
    'an ungauged vacuum run still renders its network pressure plot');
}

// ==========================================================================
console.log('\n--- Test 11: published stage capacity and evacuated-volume breakdown ---');
{
  const line = {
    id: 'vac_breakdown_line', utilityType: 'vacuumPipe',
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    start: { placeableId: 'cart_1', portName: 'vac_out' }, end: null,
  };
  const net = mkNetwork({
    lineIds: [line.id],
    sources: [{
      portKey: 'cart_1:vac_out', placeableId: 'cart_1', portName: 'vac_out',
      params: {
        pumpSpeed: 330, roughingSpeed: 30, highVacSpeed: 300,
        integratedBacking: true, vacuumStage: 'integrated',
      },
    }],
    sinks: [{
      portKey: 'chamber_1:vac_in', placeableId: 'chamber_1', portName: 'vac_in',
      params: { outgassing: 1e-6 },
    }],
  });
  const world = {
    placeables: [{ id: 'cart_1', type: 'vacuumCart', col: 0, row: 0 }],
    beamPipes: [{
      id: 'bp_breakdown', subL: 4,
      placements: [{ id: 'chamber_1', type: 'testChamber', subL: 2, position: 0 }],
    }],
    utilityLines: new Map([[line.id, line]]),
  };
  const result = desc.solve(net, {}, world, {
    getDefinition: type => type === 'testChamber'
      ? { subL: 2, interiorVolume: 100 } : null,
  });
  const flow = result.flowState;
  const expectedBeamPipe = circularPipeVolumeLitres(1);
  const expectedServicePipe = circularPipeVolumeLitres(2);
  assert(approx(flow.volumeBreakdown.beamPipeL, expectedBeamPipe)
      && approx(flow.volumeBreakdown.servicePipeL, expectedServicePipe)
      && flow.volumeBreakdown.componentChambersL === 100,
    'evacuated volume separates open beam pipe, service pipe, and authored chamber volume');
  assert(approx(flow.volumeL, expectedBeamPipe + expectedServicePipe + 100)
      && result.nextPersistentState.evacuatedVolumeL === flow.volumeL,
    'published and persistent volume equal the sum of the displayed breakdown');
  assert(flow.stageCapacities.rough.installed === 30
      && flow.stageCapacities.rough.active === 30
      && flow.stageCapacities.high.installed === 300
      && flow.stageCapacities.high.backed === 300
      && flow.stageCapacities.high.active === 0,
    'capacity is published independently for roughing and backed high-vacuum stages');
  const html = desc.renderInspector(net, flow, result.nextPersistentState);
  assert(html.includes('Capacity by pressure stage')
      && html.includes('Utility pipe')
      && html.includes('Beamline pipe')
      && html.includes('Beamline components')
      && html.includes('300.0 L/s backed'),
    'vacuum inspector renders stage capacity and volume-source breakdowns');
}

// ==========================================================================
console.log('\n--- Test 12: newly connected volume begins at atmosphere ---');
{
  const line = {
    id: 'vac_expansion_line', utilityType: 'vacuumPipe',
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    start: null, end: null, attachments: [],
  };
  const net = mkNetwork({ lineIds: [line.id] });
  const world = { utilityLines: new Map([[line.id, line]]) };
  const measured = desc.solve(net, {}, world);
  const currentVolume = measured.flowState.volumeL;
  const oldVolume = currentVolume / 2;
  const oldPressure = 1e-6;
  const expanded = desc.solve(net, {
    gasInventoryMbarL: oldVolume * oldPressure,
    evacuatedVolumeL: oldVolume,
    pressureHistory: [],
  }, world);
  const expectedPressure = (
    oldVolume * oldPressure + (currentVolume - oldVolume) * 1013
  ) / currentVolume;
  assert(approx(expanded.flowState.networkPressure, expectedPressure)
      && expanded.nextPersistentState.evacuatedVolumeL === currentVolume,
    'added volume contributes atmospheric gas instead of improving the stored vacuum');
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
