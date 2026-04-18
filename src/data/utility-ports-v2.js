// src/data/utility-ports-v2.js
//
// NEW-schema utility port assignments. Used by the v2 utility network system.
// Coexists with the legacy src/data/utility-ports.js (arrays, old-schema) which
// still feeds the current renderer; Phase 6 removes the legacy file.
//
// Port spec shape (see src/utility/ports.js):
//   {
//     utility:     'powerCable' | 'coolingWater' | 'cryoTransfer' |
//                  'rfWaveguide' | 'vacuumPipe' | 'dataFiber',
//     side:        'back' | 'front' | 'left' | 'right',
//     offsetAlong: number in [0.1, 0.9],
//     role:        'source' | 'sink' | 'pass',
//     params:      { /* utility-specific, populated from defaults */ },
//   }
//
// Defaults are tuned to reasonable v1 starter values; tune later without
// code changes to the utility core.

import { BEAMLINE_COMPONENTS_RAW } from './beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from './infrastructure.raw.js';

// ---------------------------------------------------------------------------
// Per-utility default params.
// ---------------------------------------------------------------------------

// RF frequency in Hz. The raw components store MHz as numbers (e.g. 1300 for
// L-band, 2856 for S-band) or the string 'broadband' for wideband sources.
const DEFAULT_RF_FREQ_HZ = 1.3e9;

function rfFrequencyHz(id, raws) {
  const raw = raws[id];
  if (!raw) return DEFAULT_RF_FREQ_HZ;
  const f = raw.rfFrequency;
  if (typeof f === 'number' && f > 0) return f * 1e6; // MHz → Hz
  return DEFAULT_RF_FREQ_HZ;
}

const SINK_DEFAULTS = {
  powerCable:   () => ({ demand: 50 }),
  coolingWater: () => ({ heatLoad: 30 }),
  cryoTransfer: () => ({ srfHeatW: 18 }),
  rfWaveguide:  (freq) => ({ demand: 100, frequency: freq || DEFAULT_RF_FREQ_HZ }),
  vacuumPipe:   () => ({ outgassing: 1e-7 }),
  dataFiber:    () => ({ demand: 1 }),
};

const SOURCE_DEFAULTS = {
  powerCable:   () => ({ capacity: 500 }),
  coolingWater: () => ({ capacity: 200 }),
  cryoTransfer: () => ({ coldCapacityW: 2000 }),
  rfWaveguide:  (freq) => ({ capacity: 500, frequency: freq || DEFAULT_RF_FREQ_HZ }),
  vacuumPipe:   () => ({ pumpSpeed: 100 }),
  dataFiber:    () => ({ capacity: 10 }),
};

// ---------------------------------------------------------------------------
// Beamline components (sinks). Mirrors legacy BEAMLINE_PORTS but in new schema.
// ---------------------------------------------------------------------------

const BEAMLINE_UTILITY_PORTS = {
  source: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.3, role: 'sink' },
  },
  dipole: {
    pwr_in:  { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  quadrupole: {
    pwr_in:  { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  sextupole: {
    pwr_in:  { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  velocitySelector: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink' },
  },
  emittanceFilter: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink' },
  },

  // RF — normal conducting (pwr + cool + rf)
  rfq: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },
  pillboxCavity: {
    pwr_in: { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink' },
    rf_in:  { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  rfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },
  sbandStructure: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },

  // RF — superconducting (pwr + cryo + rf)
  halfWaveResonator: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },
  spokeCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },
  ellipticalSrfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },
  cryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink' },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink' },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink' },
  },

  // Diagnostics (pwr + data)
  bpm: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink' },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  screen: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink' },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  ict: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink' },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  wireScanner: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink' },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink' },
  },

  // Endpoints
  faradayCup: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink' },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
  beamStop: {
    cool_in: { utility: 'coolingWater', side: 'left', offsetAlong: 0.5, role: 'sink' },
  },
  detector: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.15, role: 'sink' },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.45, role: 'sink' },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.75, role: 'sink' },
  },
  target: {
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.3, role: 'sink' },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.7, role: 'sink' },
  },
};

// ---------------------------------------------------------------------------
// Infrastructure (sources).
// ---------------------------------------------------------------------------

const INFRA_UTILITY_PORTS = {
  hvTransformer:       { pwr_out:  { utility: 'powerCable',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  padMountTransformer: { pwr_out:  { utility: 'powerCable',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  switchgear:          { pwr_out:  { utility: 'powerCable',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  powerPanel:          { pwr_out:  { utility: 'powerCable',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  mcc:                 { pwr_out:  { utility: 'powerCable',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  ups:                 { pwr_out:  { utility: 'powerCable',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  magnetron:           { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  solidStateAmp:       { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  twt:                 { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  pulsedKlystron:      { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  cwKlystron:          { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  iot:                 { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  multibeamKlystron:   { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  highPowerSSA:        { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  gyrotron:            { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source' } },
  lcwSkid:             { cool_out: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'source' } },
  chiller:             { cool_out: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'source' } },
  coolingTower:        { cool_out: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'source' } },
  coldBox4K:           { cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source' } },
  coldBox2K:           { cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source' } },
  roughingPump:        { vac_out:  { utility: 'vacuumPipe',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  turboPump:           { vac_out:  { utility: 'vacuumPipe',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  ionPump:             { vac_out:  { utility: 'vacuumPipe',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  negPump:             { vac_out:  { utility: 'vacuumPipe',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  tiSubPump:           { vac_out:  { utility: 'vacuumPipe',  side: 'right', offsetAlong: 0.5, role: 'source' } },
  rackIoc:             { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  timingSystem:        { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  networkSwitch:       { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  archiver:            { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  bpmElectronics:      { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  blmReadout:          { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  llrfController:      { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
  patchPanel:          { data_out: { utility: 'dataFiber',   side: 'right', offsetAlong: 0.5, role: 'source' } },
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Return the new-schema utility ports for a given component id, with `params`
 * filled in from defaults. Returns an object; empty if no ports declared.
 *
 * RF sinks/sources pull their frequency hint from the raw component's
 * `rfFrequency` field (MHz) when available; otherwise fall back to L-band.
 */
export function getUtilityPortsV2(id) {
  const src = BEAMLINE_UTILITY_PORTS[id] || INFRA_UTILITY_PORTS[id];
  if (!src) return {};
  const out = {};
  for (const [name, spec] of Object.entries(src)) {
    const table = spec.role === 'source' ? SOURCE_DEFAULTS : SINK_DEFAULTS;
    const defFn = table[spec.utility];
    let params;
    if (defFn) {
      if (spec.utility === 'rfWaveguide') {
        const freq = rfFrequencyHz(id, { ...BEAMLINE_COMPONENTS_RAW, ...INFRASTRUCTURE_RAW });
        params = defFn(freq);
      } else {
        params = defFn();
      }
    } else {
      params = {};
    }
    out[name] = { ...spec, params };
  }
  return out;
}

export const UTILITY_PORTS_V2_BY_ID = {
  ...BEAMLINE_UTILITY_PORTS,
  ...INFRA_UTILITY_PORTS,
};
