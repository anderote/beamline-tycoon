// test/test-utility-solve-rfWaveguide.js — tests for rfWaveguide.solve().
//
// Physics: a network carries ONE frequency — the one with the most demand on
// it. Sinks at any other frequency are starved with a soft rf_frequency_split
// telling the player to run a second network. Capacity comes from sources whose
// declared `bands` include the served frequency's band; none of them means a
// soft rf_frequency_mismatch, too few of them means a soft rf_overload.

import desc, { RF_BANDS, bandForFrequencyHz, RF_BRANCH_REFLECTION_PER_JUNCTION } from '../src/utility/types/rfWaveguide.js';
import { renderRfSpectrum } from '../src/ui/rf-spectrum.js';
import { utilityInspectorTabs } from '../src/ui/UtilityInspector.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

function mkNetwork(overrides) {
  return {
    id: 'net_x',
    utilityType: 'rfWaveguide',
    lineIds: [],
    ports: [],
    sources: [],
    sinks: [],
    ...overrides,
  };
}

let splitFlow = null;

// ==========================================================================
// Test 1: empty.
// ==========================================================================
console.log('\n--- Test 1: empty ---');
{
  const r = desc.solve(mkNetwork({}), {}, {});
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(Object.keys(r.flowState.perSinkQuality).length === 0, 'perSinkQuality empty');
}

console.log('\n--- Band match: one source feeds many same-frequency sinks ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['lband'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'k1', demand: 40, params: { frequency: 1300e6, band: 'lband' } },
      { portKey: 'k2', demand: 40, params: { frequency: 1300e6, band: 'lband' } },
      { portKey: 'k3', demand: 40, params: { frequency: 1300e6, band: 'lband' } },
    ],
  });
  const r = desc.solve(net, {}, {});
  for (const k of ['k1', 'k2', 'k3']) {
    assert(r.flowState.perSinkQuality[k] === 1, `${k} quality 1`);
  }
  assert(r.errors.length === 0, `no errors (got ${r.errors.length})`);
  assert(r.flowState.totalCapacity === 300, 'totalCapacity 300');
  assert(r.flowState.totalDemand === 120, 'totalDemand 120');
  assert(r.flowState.rfSpectrum.carrierFrequencyHz === 1300e6,
    'spectrum publishes the selected carrier');
  assert(r.flowState.rfSpectrum.bins.length === 1
      && r.flowState.rfSpectrum.bins[0].deliveredPeakPowerW === 300e3,
    'spectrum publishes one 300 kW peak at the carried frequency');
}

console.log('\n--- Band match: source out of band ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['sband'], dutyFactor: 1 } }],
    sinks:   [{ portKey: 'k1', demand: 40, params: { frequency: 1300e6, band: 'lband' } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.k1 === 0, 'k1 quality 0');
  assert(r.errors.some(e => e.code === 'rf_frequency_mismatch'), 'rf_frequency_mismatch raised');
  assert(r.flowState.totalCapacity === 0, 'out-of-band capacity does not count');
}

console.log('\n--- Same band, two frequencies: network splits ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['vhf'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'k1', demand: 50, params: { frequency: 162.5e6, band: 'vhf' } },
      { portKey: 'k2', demand: 10, params: { frequency: 325e6,   band: 'vhf' } },
    ],
  });
  const r = desc.solve(net, {}, {});
  splitFlow = r.flowState;
  assert(r.flowState.perSinkQuality.k1 === 1, 'dominant frequency served');
  assert(r.flowState.perSinkQuality.k2 === 0, 'minority frequency starved');
  const split = r.errors.filter(e => e.code === 'rf_frequency_split');
  assert(split.length === 1, `1 split error (got ${split.length})`);
  assert(split[0].severity === 'soft', 'split severity soft');
  assert(r.flowState.totalDemand === 60, 'totalDemand counts the split-off sink too');
  assert(r.flowState.rfSpectrum.bins.length === 2,
    'frequency distribution publishes both requested frequencies');
  assert(r.flowState.rfSpectrum.bins[0].status === 'carried'
      && r.flowState.rfSpectrum.bins[0].deliveredPeakPowerW === 300e3,
    'dominant frequency is the powered spectral line');
  assert(r.flowState.rfSpectrum.bins[1].status === 'rejected'
      && r.flowState.rfSpectrum.bins[1].deliveredPeakPowerW === 0,
    'minority frequency is published as a rejected spectral line');
}

console.log('\n--- Spectrum inspector markup ---');
{
  const html = renderRfSpectrum(splitFlow);
  assert(utilityInspectorTabs('rfWaveguide')[0].key === 'spectrum',
    'clicking an RF network opens on the Spectrum tab');
  assert(utilityInspectorTabs('powerCable').length === 1
      && utilityInspectorTabs('powerCable')[0].key === 'overview',
    'other utility inspectors still open on Overview');
  assert(html.includes('RF POWER SPECTRUM'), 'inspector identifies the spectrum view');
  assert(html.includes('162.5 MHz') && html.includes('325 MHz'),
    'inspector labels every requested frequency');
  assert(html.includes('CARRIED') && html.includes('REJECTED'),
    'inspector distinguishes delivered and rejected spectral lines');
}

console.log('\n--- Pulsed source spectrum uses peak power ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 50, params: { bands: ['lband'], dutyFactor: 0.001 } }],
    sinks: [{ portKey: 'k1', demand: 40, params: { frequency: 1300e6, band: 'lband' } }],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.rfSpectrum.forwardPeakPowerW === 50e6,
    '50 kW at 0.1% duty publishes 50 MW peak forward power');
  assert(r.flowState.rfSpectrum.bins[0].deliveredPeakPowerW === 50e6,
    'carried spectral line uses delivered peak power');
  assert(renderRfSpectrum(r.flowState).includes('50 MW'),
    'inspector formats the pulsed peak in megawatts');
}

console.log('\n--- Split tie broken by ascending frequency ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 300, params: { bands: ['vhf'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'kHi', demand: 25, params: { frequency: 325e6,   band: 'vhf' } },
      { portKey: 'kLo', demand: 25, params: { frequency: 162.5e6, band: 'vhf' } },
    ],
  });
  const r = desc.solve(net, {}, {});
  assert(r.flowState.perSinkQuality.kLo === 1, 'lower frequency wins the tie');
  assert(r.flowState.perSinkQuality.kHi === 0, 'higher frequency starved on tie');
}

console.log('\n--- Splitting into two networks clears the diagnostic ---');
{
  const mk = (freq, key) => mkNetwork({
    id: 'net_' + key,
    sources: [{ portKey: 's_' + key, capacity: 300, params: { bands: ['vhf'], dutyFactor: 1 } }],
    sinks:   [{ portKey: key, demand: 50, params: { frequency: freq, band: 'vhf' } }],
  });
  const a = desc.solve(mk(162.5e6, 'k1'), {}, {});
  const b = desc.solve(mk(325e6, 'k2'), {}, {});
  assert(a.flowState.perSinkQuality.k1 === 1 && b.flowState.perSinkQuality.k2 === 1,
    'both networks fully served');
  assert(a.errors.length === 0 && b.errors.length === 0, 'no errors on either network');
}

console.log('\n--- Overload still works ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', capacity: 30, params: { bands: ['lband'], dutyFactor: 1 } }],
    sinks:   [{ portKey: 'k1', demand: 60, params: { frequency: 1300e6, band: 'lband' } }],
  });
  const r = desc.solve(net, {}, {});
  assert(approx(r.flowState.perSinkQuality.k1, 0.5), 'quality 0.5 under 2x overload');
  assert(r.errors.some(e => e.code === 'rf_overload'), 'rf_overload raised');
}

// ==========================================================================
// Test 6: purity.
// ==========================================================================
console.log('\n--- Test 6: purity ---');
{
  const net = mkNetwork({
    sources: [{ portKey: 's1', placeableId: 'p1', portName: 'rf', capacity: 100, params: { bands: ['lband'] } }],
    sinks:   [{ portKey: 'k1', placeableId: 'p2', portName: 'rf', demand: 40,    params: { frequency: 1.3e9 } }],
  });
  const snap = JSON.stringify(net);
  const persistent = { x: 1 };
  const pSnap = JSON.stringify(persistent);
  const r = desc.solve(net, persistent, {});
  assert(JSON.stringify(net) === snap, 'network not mutated');
  assert(JSON.stringify(persistent) === pSnap, 'persistent not mutated');
  assert(r.nextPersistentState === persistent, 'nextPersistentState identity');
}

console.log('\n--- Band table ---');
{
  assert(RF_BANDS.length === 6, `6 bands (got ${RF_BANDS.length})`);
  const ids = RF_BANDS.map(b => b.id);
  assert(ids.join(',') === 'vhf,uhf,lband,sband,cband,xband', `band order (got ${ids.join(',')})`);
  // Ascending, non-overlapping, no gaps.
  for (let i = 1; i < RF_BANDS.length; i++) {
    assert(RF_BANDS[i].loMHz === RF_BANDS[i - 1].hiMHz,
      `${RF_BANDS[i].id} starts where ${RF_BANDS[i - 1].id} ends`);
  }
  assert(bandForFrequencyHz(162.5e6) === 'vhf', '162.5 MHz -> vhf');
  assert(bandForFrequencyHz(650e6) === 'uhf', '650 MHz -> uhf');
  assert(bandForFrequencyHz(1300e6) === 'lband', '1300 MHz -> lband');
  assert(bandForFrequencyHz(2856e6) === 'sband', '2856 MHz -> sband');
  assert(bandForFrequencyHz(5712e6) === 'cband', '5712 MHz -> cband');
  assert(bandForFrequencyHz(11424e6) === 'xband', '11424 MHz -> xband');
  assert(bandForFrequencyHz(20e6) === null, 'below vhf -> null');
  assert(bandForFrequencyHz(99e9) === null, 'above xband -> null');
}

// ==========================================================================
// Test 7: a branch into a waveguide trunk creates a reflected-power penalty.
// ==========================================================================
console.log('\n--- Test 7: RF tee mismatch ---');
{
  const net = mkNetwork({
    id: 'rf-tee', lineIds: ['trunk', 'branch'],
    sources: [{ portKey: 'amp:rf_out', placeableId: 'amp', portName: 'rf_out', capacity: 100, params: { bands: ['lband'], dutyFactor: 1 } }],
    sinks: [
      { portKey: 'a:rf_in', placeableId: 'a', portName: 'rf_in', demand: 30, params: { frequency: 1.3e9 } },
      { portKey: 'b:rf_in', placeableId: 'b', portName: 'rf_in', demand: 30, params: { frequency: 1.3e9 } },
    ],
  });
  const state = { utilityLines: new Map([
    ['trunk', { id: 'trunk', utilityType: 'rfWaveguide', start: { placeableId: 'amp', portName: 'rf_out' }, end: { placeableId: 'a', portName: 'rf_in' }, path: [{ col: 0, row: 0 }, { col: 4, row: 0 }] }],
    ['branch', { id: 'branch', utilityType: 'rfWaveguide', start: null, end: { placeableId: 'b', portName: 'rf_in' }, path: [{ col: 2, row: 0 }, { col: 2, row: 2 }] }],
  ]) };
  const r = desc.solve(net, {}, state);
  assert(r.flowState.branchCount === 1, `one tee branch (got ${r.flowState.branchCount})`);
  assert(approx(r.flowState.branchReflectionFraction, RF_BRANCH_REFLECTION_PER_JUNCTION),
    `tee reflects ${RF_BRANCH_REFLECTION_PER_JUNCTION} (got ${r.flowState.branchReflectionFraction})`);
  assert(r.flowState.totalCapacity < 100, `tee lowers delivered capacity (got ${r.flowState.totalCapacity})`);
  assert(approx(r.flowState.rfSpectrum.reflectedAveragePowerKw, 4),
    `spectrum publishes 4 kW reflected at one tee (got ${r.flowState.rfSpectrum.reflectedAveragePowerKw})`);
  assert(r.errors.some(e => e.code === 'rf_branch_mismatch'), 'tee reports RF mismatch / reflected power');

  const crossingState = { utilityLines: new Map([
    ['trunk', state.utilityLines.get('trunk')],
    ['branch', {
      ...state.utilityLines.get('branch'),
      path: [{ col: 2, row: -2 }, { col: 2, row: 2 }],
    }],
  ]) };
  const crossing = desc.solve(net, {}, crossingState);
  assert(crossing.flowState.branchCount === 1,
    `an automatic interior RF crossing carries one junction penalty (got ${crossing.flowState.branchCount})`);
}

// ==========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
