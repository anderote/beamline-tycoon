// src/data/utility-ports-v2.js
//
// NEW-schema utility port assignments. Used by the v2 utility network system.
//
// Port spec shape (see src/utility/ports.js):
//   {
//     utility:     'powerCable' | 'coolingWater' | 'cryoTransfer' |
//                  'rfWaveguide' | 'vacuumPipe' | 'dataFiber',
//     side:        'back' | 'front' | 'left' | 'right',
//     offsetAlong: number in [0.1, 0.9],
//     role:        'source' | 'sink' | 'pass',
//     params:      { /* utility-specific, declared per component */ },
//   }
//
// THIS FILE is the single home for per-component utility sink/source numbers.
// Every port declares its own params inline (demand kW, heatLoad kW, srfHeatW,
// pumpSpeed L/s, outgassing mbar·L/s, capacity, ...). The per-utility DEFAULTS
// below are only a safety net for ports that forget to declare something.
//
// Tuning philosophy (Phase 7):
//   - Power demand tiers: tiny 1-3, small 5-25, medium 40-150, large 300+ kW.
//     A mid-tier transformer (150 kW) feeds a starter beamline; a serious
//     facility needs planned distribution across several sources.
//   - RF demand is per-cavity within its frequency bucket; sources either
//     match a bucket exactly or are broadband (see utility/types/rfWaveguide).
//   - Cooling heat loads roughly track wall-plug power for resistive magnets
//     and NC RF; SRF cavities instead load the cryo plant in watts, with a
//     cryomodule's load dwarfing a single warm-bore cavity's.
//   - Vacuum outgassing scales with interior volume; one roughing pump keeps
//     a starter chain alive at mediocre quality, turbo/ion pumps make it good.
//   - Data is flavor-scaled Gbps; the solver is binary connectivity.

import { BEAMLINE_COMPONENTS_RAW } from './beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from './infrastructure.raw.js';

// ---------------------------------------------------------------------------
// Per-utility fallback params (safety net only — ports declare their own).
// ---------------------------------------------------------------------------

// RF frequency in Hz. The raw components store MHz as numbers (e.g. 1300 for
// L-band, 2856 for S-band) or the string 'broadband' for wideband sources.
const DEFAULT_RF_FREQ_HZ = 1.3e9;

function rawRfFrequency(id) {
  const raw = BEAMLINE_COMPONENTS_RAW[id] || INFRASTRUCTURE_RAW[id];
  return raw ? raw.rfFrequency : undefined;
}

const SINK_DEFAULTS = {
  powerCable:   { demand: 10 },
  coolingWater: { heatLoad: 10 },
  cryoTransfer: { srfHeatW: 20 },
  rfWaveguide:  { demand: 10 },
  vacuumPipe:   { outgassing: 5e-7 },
  dataFiber:    { demand: 1 },
};

const SOURCE_DEFAULTS = {
  powerCable:   { capacity: 100 },
  coolingWater: { capacity: 100 },
  cryoTransfer: { coldCapacityW: 500 },
  rfWaveguide:  { capacity: 20 },
  vacuumPipe:   { pumpSpeed: 100 },
  dataFiber:    { capacity: 10 },
};

// ---------------------------------------------------------------------------
// Beamline components (sinks).
// ---------------------------------------------------------------------------

const BEAMLINE_UTILITY_PORTS = {
  // ── Sources ───────────────────────────────────────────────────────
  // Thermionic e-gun: 50 kW wall plug (per its own description); collector +
  // focusing solenoid dump ~30 kW into the water loop. Cooling is soft
  // (degrades quality when starved) — only power+vacuum are hard-gated.
  source: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 50 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 30 } },
  },
  // Duoplasmatron: filament + arc + extraction supplies; magnet needs water.
  ionSource: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 30 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 20 } },
  },
  // ECR: mirror solenoids draw serious power; 2.45 GHz microwave injection.
  ecrIonSource: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 60 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 40 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 2 } },
  },

  // ── Magnets ───────────────────────────────────────────────────────
  dipole: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 25 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 20 } },
  },
  quadrupole: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 10 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 8 } },
  },
  sextupole: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 8 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 6 } },
  },
  injectionSeptum: {
    pwr_in:  { utility: 'powerCable',   side: 'front', offsetAlong: 0.3, role: 'sink', params: { demand: 40 } },
    cool_in: { utility: 'coolingWater', side: 'front', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 25 } },
  },
  velocitySelector: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink', params: { demand: 15 } },
  },
  emittanceFilter: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink', params: { demand: 2 } },
  },

  // ── RF — normal conducting ────────────────────────────────────────
  // RF demand mirrors raw rfPowerRequired; frequency comes from raw
  // rfFrequency (MHz → Hz) via getUtilityPortsV2.
  buncher: {
    pwr_in: { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 5 } },
    rf_in:  { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 2 } },
  },
  rfq: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 40 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 60 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 25 } },
  },
  pillboxCavity: {
    pwr_in: { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 10 } },
    rf_in:  { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 5 } },
  },
  // Copper structures guzzle RF and dump most of it into the water loop.
  rfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 60 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 120 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 40 } },
  },
  sbandStructure: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 60 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 100 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 45 } },
  },

  // ── RF — superconducting (pwr + cryo + rf) ────────────────────────
  // Near-zero wall losses: modest electric draw, tiny RF drive, but a
  // per-cavity heat load in watts on the cryo plant.
  halfWaveResonator: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 8 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 15 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 3 } },
  },
  spokeCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 10 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 25 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 8 } },
  },
  ellipticalSrfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 12 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 40 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 5 } },
  },
  // Eight cavities in one cryostat: its cryo load dwarfs a single cavity's.
  cryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 80 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 250 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 40 } },
  },

  // ── Diagnostics (pwr + data) — draw almost nothing ────────────────
  bpm: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 1 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 1 } },
  },
  screen: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 2 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 4 } },
  },
  ict: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 1 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 1 } },
  },
  wireScanner: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 3 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 2 } },
  },

  // ── Endpoints ─────────────────────────────────────────────────────
  faradayCup: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 1 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 1 } },
  },
  beamStop: {
    cool_in: { utility: 'coolingWater', side: 'left', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 50 } },
  },
  detector: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.15, role: 'sink', params: { demand: 120 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.45, role: 'sink', params: { heatLoad: 60 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.75, role: 'sink', params: { demand: 40 } },
  },
  target: {
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { heatLoad: 40 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 5 } },
  },
  collisionPoint: {
    // Beam ports occupy back+front (entryA/entryB) — utilities enter from the sides.
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.5, role: 'sink', params: { demand: 20 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 10 } },
  },
};

// Per-component outgassing (mbar·L/s), roughly ~1e-7 × interior volume.
// Anything not listed gets VACUUM_OUTGASSING_DEFAULT. ECR runs a deliberate
// gas feed into its plasma chamber, so it outgasses far above its size class.
const VACUUM_OUTGASSING_DEFAULT = 5e-7;
const VACUUM_OUTGASSING = {
  // tiny (diagnostics, thin elements)
  bpm: 2e-7, ict: 2e-7, screen: 2e-7, wireScanner: 2e-7, faradayCup: 2e-7,
  // medium modules
  source: 1e-6, ionSource: 1e-6, pillboxCavity: 1e-6, spokeCavity: 1e-6,
  ellipticalSrfCavity: 1e-6, rfq: 1e-6, target: 1e-6,
  // large vessels / gas-loaded
  ecrIonSource: 5e-6, rfCavity: 2e-6, sbandStructure: 2e-6,
  cryomodule: 4e-6, detector: 5e-6,
};

// Inject vacuum sinks for all beamline modules that lack one — every segment
// of beam pipe needs vacuum, so the utility solver can trip the beam via
// vacuum_no_pump when no pump is connected. Keep existing vac_in if present.
for (const id of Object.keys(BEAMLINE_UTILITY_PORTS)) {
  if (!BEAMLINE_UTILITY_PORTS[id].vac_in) {
    BEAMLINE_UTILITY_PORTS[id].vac_in = {
      utility: 'vacuumPipe', side: 'left', offsetAlong: 0.7, role: 'sink',
      params: { outgassing: VACUUM_OUTGASSING[id] ?? VACUUM_OUTGASSING_DEFAULT },
    };
  }
}

// ---------------------------------------------------------------------------
// Infrastructure (sources). Capacity ladders per utility:
//
//   power   (kW):   powerPanel 40 → padMount 150 → mcc 250 → switchgear 400
//                   → hvTransformer 1200; ups 100 (critical loads)
//   rf      (kW):   magnetron 5 @2.45 GHz → SSA 35 bb → TWT 20 bb
//                   → pulsedKlystron 50 @S / cwKlystron 50 @L → IOT 80 @L
//                   → MBK 200 @S → highPowerSSA 300 bb → gyrotron 1000 bb
//   cooling (kW):   lcwSkid 100 → chiller 300 → coolingTower 800
//   cryo    (W):    coldBox4K 500 → coldBox2K 800
//   vacuum  (L/s):  roughing 15 → turbo 300 → tiSub 400 → NEG 500 → ion 600
//   data    (Gbps): patchPanel 2 → timing 5 → rackIoc 10 → archiver 20
//                   → networkSwitch 40
//
// RF sources: `frequency` is filled from the raw rfFrequency (MHz → Hz);
// 'broadband' raws get `broadband: true` instead (see types/rfWaveguide.js).
// ---------------------------------------------------------------------------

const INFRA_UTILITY_PORTS = {
  // power
  hvTransformer:       { pwr_out:  { utility: 'powerCable', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 1200 } } },
  padMountTransformer: { pwr_out:  { utility: 'powerCable', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 150 } } },
  switchgear:          { pwr_out:  { utility: 'powerCable', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 400 } } },
  powerPanel:          { pwr_out:  { utility: 'powerCable', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 40 } } },
  mcc:                 { pwr_out:  { utility: 'powerCable', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 250 } } },
  ups:                 { pwr_out:  { utility: 'powerCable', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 100 } } },
  // rf (capacity kW = raw params.power)
  magnetron:           { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 5 } } },
  solidStateAmp:       { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 35 } } },
  twt:                 { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 20 } } },
  pulsedKlystron:      { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 50 } } },
  cwKlystron:          { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 50 } } },
  iot:                 { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 80 } } },
  multibeamKlystron:   { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 200 } } },
  highPowerSSA:        { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 300 } } },
  gyrotron:            { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 1000 } } },
  // cooling
  lcwSkid:             { cool_out: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 100 } } },
  chiller:             { cool_out: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 300 } } },
  coolingTower:        { cool_out: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 800 } } },
  // cryo
  coldBox4K:           { cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source', params: { coldCapacityW: 500 } } },
  coldBox2K:           { cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source', params: { coldCapacityW: 800 } } },
  // vacuum
  roughingPump:        { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 15 } } },
  turboPump:           { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 300 } } },
  ionPump:             { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 600 } } },
  negPump:             { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 500 } } },
  tiSubPump:           { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 400 } } },
  // data
  rackIoc:             { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 10 } } },
  timingSystem:        { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 5 } } },
  networkSwitch:       { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 40 } } },
  archiver:            { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 20 } } },
  bpmElectronics:      { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 8 } } },
  blmReadout:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 8 } } },
  llrfController:      { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 4 } } },
  patchPanel:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 2 } } },
};

// ---------------------------------------------------------------------------
// Infrastructure sinks (derived from requiredConnections).
//
// Infrastructure units declare what they need in `requiredConnections`, but
// the table above only ever gave them SOURCE ports — so no infrastructure
// component contributed any demand to any network: a 40 kW panel could "feed"
// a 2000 kW gyrotron plus every pump at 0% utilization, while overlays.js
// still drew a power hookup off requiredConnections that had no port to land
// on. validate.js now enforces the sink-port rule for infrastructure too.
//
// Rather than restate 50 near-identical entries, sinks are generated from the
// raw defs: power demand IS the unit's own energyCost (kW), the same number
// the equipment electricity bill already charges, so the two can't drift.
// Loads that energyCost doesn't imply are declared as overrides below.
// ---------------------------------------------------------------------------

// Port geometry per utility, plus which param carries the load. Sinks sit on
// the opposite side from the source ports above so a unit that both consumes
// and produces doesn't stack two ports on one edge.
const INFRA_SINK_SHAPE = {
  powerCable:   { name: 'pwr_in',  side: 'left',  offsetAlong: 0.3, param: 'demand' },
  coolingWater: { name: 'cool_in', side: 'front', offsetAlong: 0.5, param: 'heatLoad' },
  dataFiber:    { name: 'data_in', side: 'back',  offsetAlong: 0.5, param: 'demand' },
};

// Loads not implied by energyCost. beamDump absorbs beam power, not wall
// power; heCompressor dumps its compression heat into the water loop.
// dataFiber is binary connectivity in the solver, so 1 Gbps is flavor.
const INFRA_SINK_LOAD_OVERRIDES = {
  beamDump:     { coolingWater: 50 },
  heCompressor: { coolingWater: 20 },
};

function buildInfraSinkPorts() {
  const out = {};
  for (const [id, def] of Object.entries(INFRASTRUCTURE_RAW)) {
    const required = Array.isArray(def.requiredConnections) ? def.requiredConnections : [];
    for (const utility of required) {
      const shape = INFRA_SINK_SHAPE[utility];
      if (!shape) continue;
      const existing = INFRA_UTILITY_PORTS[id] || {};
      // Never shadow a hand-authored port for the same utility.
      if (Object.values(existing).some(p => p.utility === utility && p.role === 'sink')) continue;
      const override = (INFRA_SINK_LOAD_OVERRIDES[id] || {})[utility];
      const load = override !== undefined
        ? override
        : (utility === 'dataFiber' ? 1 : Math.max(def.energyCost || 0, 0.1));
      if (!out[id]) out[id] = {};
      out[id][shape.name] = {
        utility,
        side: shape.side,
        offsetAlong: shape.offsetAlong,
        role: 'sink',
        params: { [shape.param]: load },
      };
    }
  }
  return out;
}

const INFRA_SINK_PORTS = buildInfraSinkPorts();

// Merge the derived sinks onto the hand-authored source table.
for (const [id, ports] of Object.entries(INFRA_SINK_PORTS)) {
  INFRA_UTILITY_PORTS[id] = { ...(INFRA_UTILITY_PORTS[id] || {}), ...ports };
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Return the new-schema utility ports for a given component id, with `params`
 * fully populated. Declared per-port params win; the per-utility DEFAULTS
 * fill anything missing.
 *
 * RF ports additionally get their frequency from the raw component's
 * `rfFrequency` field (MHz → Hz). Raw `rfFrequency: 'broadband'` sources get
 * `broadband: true` instead of a frequency; sinks with no usable raw value
 * fall back to L-band 1.3 GHz. An explicitly declared `params.frequency` or
 * `params.broadband` always wins.
 */
export function getUtilityPortsV2(id) {
  const src = BEAMLINE_UTILITY_PORTS[id] || INFRA_UTILITY_PORTS[id];
  if (!src) return {};
  const out = {};
  for (const [name, spec] of Object.entries(src)) {
    const table = spec.role === 'source' ? SOURCE_DEFAULTS : SINK_DEFAULTS;
    const params = { ...(table[spec.utility] || {}), ...(spec.params || {}) };
    if (spec.utility === 'rfWaveguide'
        && params.frequency === undefined && params.broadband === undefined) {
      const rawFreq = rawRfFrequency(id);
      if (typeof rawFreq === 'number' && rawFreq > 0) {
        params.frequency = rawFreq * 1e6; // MHz → Hz
      } else if (rawFreq === 'broadband' && spec.role === 'source') {
        params.broadband = true;
      } else {
        params.frequency = DEFAULT_RF_FREQ_HZ;
      }
    }
    out[name] = { ...spec, params };
  }
  return out;
}

export const UTILITY_PORTS_V2_BY_ID = {
  ...BEAMLINE_UTILITY_PORTS,
  ...INFRA_UTILITY_PORTS,
};
