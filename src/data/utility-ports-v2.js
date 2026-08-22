// src/data/utility-ports-v2.js
//
// NEW-schema utility port assignments. Used by the v2 utility network system.
//
// Port spec shape (see src/utility/ports.js):
//   {
//     utility:     'powerCable' | 'coolingWater' | 'waterSupplyPipe' | 'cryoTransfer' |
//                  'rfWaveguide' | 'vacuumPipe' | 'dataFiber',
//     side:        'back' | 'front' | 'left' | 'right',
//     offsetAlong: number in [0.1, 0.9],
//     role:        'source' | 'sink' | 'pass',
//     autoConnectClass: optional assisted-routing circuit class,
//     params:      { /* utility-specific, declared per component */ },
//   }
//
// `offsetAlong` is how far along its face the port sits, counted CLOCKWISE
// around the footprint seen from above (so 0.2 on the `right` face and 0.2 on
// the `left` face sit at opposite ends of the machine, the way they would if
// you walked round it). 0.5 is the face midpoint. Two ports on one face need
// their offsets a good way apart to route independently: line paths quantise
// to 0.5 m, so on a 1 m face the fittings draw apart but the pipes still leave
// one point. See portWorldPosition in src/utility/ports.js.
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
//   - RF demand is per-cavity at the sink's own frequency; a source drives it
//     if it covers that frequency's BAND (see utility/types/rfWaveguide).
//   - Cooling heat loads roughly track wall-plug power for resistive magnets
//     and NC RF; SRF cavities instead load the cryo plant in watts, with a
//     cryomodule's load dwarfing a single warm-bore cavity's.
//   - Vacuum outgassing scales with interior volume; one roughing pump keeps
//     a starter chain alive at mediocre quality, turbo/ion pumps make it good.
//   - Data is Gbps; sources share their capacity proportionally across sinks.

import { BEAMLINE_COMPONENTS_RAW } from './beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from './infrastructure.raw.js';
import { COOLING_AUTO_CONNECT_CLASS } from './cooling-auto-connect-classes.js';
import { COOLING_WATER_INVENTORY } from './cooling-water-inventory.js';
import { HV_LOAD_TAP_IDS } from './hv-load-taps.js';
import { bandForFrequencyHz } from './rf-bands.js';
import { RF_PORT_STANDARDS } from './rf-port-standards.js';

const STANDARD_RF_FEED = RF_PORT_STANDARDS.standardFeed.placement;
const SINGLE_RF_OUTPUT = RF_PORT_STANDARDS.singleOutput.placement;

// ---------------------------------------------------------------------------
// Per-utility fallback params (safety net only — ports declare their own).
// ---------------------------------------------------------------------------

// RF frequency in Hz. The raw components store MHz as numbers (e.g. 1300 for
// L-band, 2856 for S-band). Only SINKS carry a frequency: a cavity is cut to
// one, a tube is built for a band. Sources carry `rfBands` instead.
const DEFAULT_RF_FREQ_HZ = 1.3e9;

function rawRfFrequency(id) {
  const raw = BEAMLINE_COMPONENTS_RAW[id] || INFRASTRUCTURE_RAW[id];
  return raw ? raw.rfFrequency : undefined;
}

function rawRfBands(id) {
  const raw = BEAMLINE_COMPONENTS_RAW[id] || INFRASTRUCTURE_RAW[id];
  return raw ? raw.rfBands : undefined;
}

const SINK_DEFAULTS = {
  powerCable:   { demand: 10 },
  coolingWater: { heatLoad: 10 },
  waterSupplyPipe: { heatLoad: 10 },
  cryoTransfer: { srfHeatW: 20 },
  rfWaveguide:  { demand: 10 },
  vacuumPipe:   { outgassing: 5e-7 },
  dataFiber:    { demand: 1 },
};

const SOURCE_DEFAULTS = {
  powerCable:   { capacity: 100 },
  coolingWater: { capacity: 100 },
  waterSupplyPipe: { capacity: 100 },
  // Cryogenic source ports carry several independent plant capabilities
  // (storage, cold production, heat rejection, recovery). Defaulting every
  // source to a 500 W cold box made a passive tank or recovery header create
  // refrigeration merely by acquiring a port, so cryo fails closed instead.
  cryoTransfer: { coldCapacityW: 0 },
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
  dcPhotoGun: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.25, role: 'sink', params: { demand: 35 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.75, role: 'sink', params: { demand: 3 } },
  },
  ncRfGun: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 70 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.35, role: 'sink', params: { heatLoad: 70 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.65, role: 'sink', params: { demand: 12 } },
    data_in: { utility: 'dataFiber',    side: 'left',  offsetAlong: 0.8, role: 'sink', params: { demand: 4 } },
  },
  srfGun: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 110 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.3, role: 'sink', params: { srfHeatW: 120 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.62, role: 'sink', params: { demand: 18 } },
    data_in: { utility: 'dataFiber',    side: 'left',  offsetAlong: 0.8, role: 'sink', params: { demand: 5 } },
  },
  penningIonSource: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 22 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 14 } },
  },
  // Duoplasmatron: filament + arc + extraction supplies; magnet needs water.
  ionSource: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 30 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 20 } },
  },
  // ECR: mirror solenoids draw serious power; the 2.45 GHz feed is sized for
  // the source control's 6 kW high-current setting.
  ecrIonSource: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 60 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 40 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'left', offsetAlong: 0.66, role: 'sink', params: { demand: 6 } },
  },
  // The default 750 kV stage adds up to 300 kW of beam power at the ECR's
  // 400 mA design current. The electrical sink is intentionally substation-
  // scale; the cooling loop carries column, lens, and intercepted-halo heat.
  dcInjector: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 400 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 150 } },
  },

  // ── Compound machines ─────────────────────────────────────────────
  // Source + acceleration + extraction in one crate. Their utility profiles
  // are where the tiers separate: the tier-1 pair ask for almost nothing,
  // the cyclotrons ask for a substation and a cooling tower, and the LWFA
  // asks for both while conspicuously wanting no RF and no cryo at all.

  // The cheapest working accelerator in the game, and the only one with a
  // single utility. A belt in an SF6 tank has nothing to cool: 6 kW of beam
  // and ~24 kW of column and vacuum losses go to the room. One power panel
  // (40 kW) covers it exactly, which is the intended tick-1 shopping list.
  vanDeGraaff: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 30 } },
  },
  // 750 kV cascade plus a duoplasmatron in the terminal: 22 kW of beam and a
  // rectifier stack that needs the heat taken off it.
  cockcroftWalton: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 45 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.6, role: 'sink', params: { heatLoad: 25 } },
  },
  // A cyclotron is a water heater that occasionally emits protons. 10 kW of
  // extracted beam against ~140 kW at the wall — RF, main coil, and the
  // fraction of the internal beam that never makes it to the stripper all
  // end up in the loop. It needs a direct HV feeder, and one lcwSkid (25 kW)
  // is exactly not enough cooling.
  cyclotron30: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 140 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 115 } },
  },
  // Same physics, four times the machine: past a single switchgear feed and
  // past a single cooling tower, so it forces distribution planning.
  cyclotron70: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 380 } },
    cool_in: { utility: 'waterSupplyPipe', side: 'right', offsetAlong: 0.35, role: 'sink', params: { heatLoad: 310, waterCircuit: 'cold' } },
    hot_out: { utility: 'waterSupplyPipe', side: 'right', offsetAlong: 0.65, role: 'sink', params: { heatLoad: 310, waterCircuit: 'hot' } },
  },
  // RFQ + low-beta SRF front end delivered as one commissioned tunnel sector.
  // Unlike a cyclotron it exposes both RF and cryogenic plant to the player.
  protonLinacFrontEnd: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.15, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 600 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.35, role: 'sink', params: { heatLoad: 420 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.62, role: 'sink', params: { srfHeatW: 500 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'left',  offsetAlong: 0.82, role: 'sink', params: { demand: 80 } },
  },
  // The extreme case of "a cyclotron is a water heater that occasionally emits
  // protons", and the one machine where the joke is arithmetic: 230 MeV at the
  // nameplate microamp is a QUARTER OF A WATT of beam against 420 kW at the
  // wall. Nothing goes into the product — it all goes into the loop. Roughly
  // half is the room-temperature main coil holding a 2 T field in 220 tonnes of
  // iron, most of the rest is the 106 MHz RF, and the ~30% of the internal beam
  // the electrostatic deflector fails to extract lands on copper inside the
  // vacuum chamber. Past a single tower and a single switchgear feed, same as
  // the 70 MeV machine, so it forces the same distribution planning.
  cyclotron230: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 420 } },
    cool_in: { utility: 'waterSupplyPipe', side: 'right', offsetAlong: 0.35, role: 'sink', params: { heatLoad: 400, waterCircuit: 'cold' } },
    hot_out: { utility: 'waterSupplyPipe', side: 'right', offsetAlong: 0.65, role: 'sink', params: { heatLoad: 400, waterCircuit: 'hot' } },
  },
  // NO rf_in and NO cryo_in — the absence is the design. A plasma stage has
  // no cavity to drive and nothing to keep at 2 K. What it has instead is a
  // titanium-sapphire chain at a few tenths of a percent wall-plug
  // efficiency, so a kilowatt of laser costs hundreds of kilowatts of
  // electricity and gives essentially all of it back as heat. The fibre is
  // the femtosecond timing link to petawattLaser: laser-to-plasma jitter is
  // what sets the energy jitter of every bunch this thing makes.
  lwfaStation: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 420 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 400 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 8 } },
  },
  // The only compound machine that asks for a waveguide, and the reason is
  // that its capture section is a genuine S-band linac rather than something
  // folded into the crate. The power and cooling are the drive beam: a
  // tungsten target absorbing hundreds of kilowatts of shower, in a shielded
  // block that has to survive it, plus the klystron plant behind the capture
  // structure. Almost none of the energy that goes in comes out as positrons.
  positronSource: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 800 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 760 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 60 } },
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
  // Low-field focusing coil, so a modest draw; the water is for the coil pack.
  solenoid: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 6 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 5 } },
  },
  // No power: the jaws are motor-positioned and then sit still. The water is
  // the point — a collimator absorbs the halo it scrapes off, and on a
  // high-power machine that is a real thermal load.
  collimator: {
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 18 } },
  },
  // Bend plus gradient in one yoke, so it draws like a dipole rather than
  // like a quad.
  combinedFunctionMagnet: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 30 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 24 } },
  },
  // Four dipoles on one girder — priced as such.
  chicane: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 45 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 36 } },
  },
  // Permanent-magnet poles need no excitation current; the draw is the gap
  // drive and the cooling is for the intercepted radiation power.
  undulator: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 12 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 20 } },
  },
  injectionSeptum: {
    pwr_in:  { utility: 'powerCable',   side: 'front', offsetAlong: 0.3, role: 'sink', params: { demand: 40 } },
    cool_in: { utility: 'coolingWater', side: 'front', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 25 } },
  },
  // Septum-class draw, and for the same reason: the integrated field is small
  // but the PFN has to slam it up in 50 ns and hold flat-top, which is a
  // supply built for dI/dt rather than for amps. The fibre is the injection
  // trigger — a kicker firing at a moment nobody chose scrapes the stored beam.
  fastKicker: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 35 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.6, role: 'sink', params: { heatLoad: 28 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.85, role: 'sink', params: { demand: 4 } },
  },
  // Superconducting, so no water loop at all: the load is a helium one. Two
  // strong quads in one cryostat sit between ellipticalSrfCavity (40 W) and a
  // full cryomodule (250 W) — a magnet has no RF wall losses, only static
  // heat leak plus the current leads.
  finalFocusDoublet: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 20 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.6, role: 'sink', params: { srfHeatW: 90 } },
  },
  // A dozen small dipoles and their quads around a 6 m bypass — heavier than
  // the four-dipole chicane it is filed next to, lighter than a cryomodule.
  recirculationArc: {
    hv_in:   { utility: 'hvCable',      side: 'right', offsetAlong: 0.3, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 70 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 56 } },
  },
  // Four analysing dipoles on one girder, so it draws like a chicane. The
  // water is for those dipoles and NOT for the wedge: a therapy beam is a
  // fraction of a watt, and the block that stops 99% of it barely warms up.
  // That inversion is worth knowing — this is the one intercepting device in
  // the catalogue whose cooling has nothing to do with the beam it absorbs.
  energyDegrader: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 30 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 24 } },
  },
  // Small magnets, dipole-class draw: the integrated field is tiny but the
  // supplies have to slew it across the full scan range hundreds of times a
  // second, and a supply built for dI/dt is not a cheap supply. The fibre is
  // the scan pattern coming down from the control room and the dose signal
  // going back up — without it this is a magnet pointing a beam somewhere
  // nobody is checking.
  scanningMagnet: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 35 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.6, role: 'sink', params: { heatLoad: 28 } },
    data_in: { utility: 'dataFiber',    side: 'front', offsetAlong: 0.8, role: 'sink', params: { demand: 6 } },
  },
  velocitySelector: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink', params: { demand: 15 } },
  },
  emittanceFilter: {
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.5, role: 'sink', params: { demand: 2 } },
  },

  // ── RF — normal conducting ────────────────────────────────────────
  // RF demand mirrors raw rfPowerRequired; frequency comes from raw
  // rfFrequency (MHz → Hz) via getUtilityPortsV2. Electrical demand is
  // only the cavity's local auxiliaries (tuners, controls, pumps): the RF
  // source already draws and is billed for the wall-plug power that becomes
  // rf_in. Including rfPowerRequired here as well charges the power network
  // for the same conversion twice.
  buncher: {
    pwr_in: { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 1 } },
    rf_in:  { utility: 'rfWaveguide', ...STANDARD_RF_FEED, role: 'sink', params: { demand: 2 } },
  },
  rfq: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 6 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 60 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'left', offsetAlong: 0.76, role: 'sink', params: { demand: 25 } },
  },
  dtl: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 22 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 140 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'left', offsetAlong: 0.76, role: 'sink', params: { demand: 45 } },
  },
  pillboxCavity: {
    pwr_in: { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 3 } },
    rf_in:  { utility: 'rfWaveguide', ...STANDARD_RF_FEED, role: 'sink', params: { demand: 5 } },
  },
  // Copper structures guzzle RF and dump most of it into the water loop.
  rfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 20 } },
    // Reserve the face midpoint for the standard RF flange. Cooling stays on
    // the same service side but moves forward so the two fittings remain
    // independently routable.
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.8, role: 'sink', params: { heatLoad: 120 } },
    rf_in:   { utility: 'rfWaveguide',  ...STANDARD_RF_FEED, role: 'sink', params: { demand: 40 } },
  },
  sbandStructure: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 15 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 100 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 45 } },
  },
  // The high-gradient copper rungs. RF demand and heat both climb faster than
  // energy gain does: dissipation goes as the square of the gradient, so a
  // C-band structure at 40 MV/m asks for more than twice an S-band's RF to
  // deliver twice its energy, and an X-band at 100 MV/m more than twice again.
  // That is the real RF-source and cooling cost of compactness; the cavity's
  // direct power feed remains its separately billed auxiliary load.
  cbandStructure: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 45 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 220 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'left', offsetAlong: 0.90, role: 'sink', params: { demand: 110 } },
  },
  xbandStructure: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 90 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 480 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'back', offsetAlong: 0.50, role: 'sink', params: { demand: 240 } },
  },
  // Five CLIC modules' worth of hardware, but the waveguide demand is the ONE
  // number that does not scale with the energy: the drive beam carries the
  // power to the main line, so what comes down the guide is the drive-beam
  // injector's share. The wall power and the water are where the real cost of
  // 6 GeV lands.
  twoBeamModule: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 120 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 780 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.10, role: 'sink', params: { demand: 400 } },
  },
  // NO rf_in and NO cryo_in, exactly like lwfaStation — the absence is the
  // design. There is no cavity to drive and nothing to hold at 2 K. What
  // there is instead is a titanium-sapphire chain at a few tenths of a
  // percent wall-plug efficiency, which gives essentially all of that power
  // straight back as heat, plus the femtosecond timing fibre that keeps the
  // laser and the bunch in step.
  plasmaAfterburner: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 1400 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 1350 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 10 } },
  },
  // Same three-port shape as the afterburner and no rf_in for the same
  // reason, but the balance between them inverts. There is no drive laser and
  // no plasma: the accelerating field costs nothing to make. What the power
  // goes on is the goniometer and the cryostat holding a wafer at microradian
  // alignment while a TeV-scale beam deposits into it, and nearly all of that
  // comes straight back out through the water. The fibre is the heaviest data
  // load on any beamline component in the catalogue because it is not
  // telemetry — it is the alignment interferometer running closed-loop, and
  // losing it means the crystal stops channeling and starts scattering.
  crystalChannelStage: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 2400 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 2300 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 60 } },
  },
  // A third of an S-band structure's length, so roughly a third of its loads.
  // It is a self-contained industrial skid, which is why the water demand is
  // proportionally the heaviest part: this thing runs all shift.
  industrialLinac: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 8 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.8, role: 'sink', params: { heatLoad: 45 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'left', offsetAlong: 0.68, role: 'sink', params: { demand: 20 } },
  },

  // ── RF — superconducting (pwr + cryo + rf) ────────────────────────
  // Near-zero wall losses: modest electric draw, tiny RF drive, but a
  // per-cavity heat load in watts on the cryo plant.
  halfWaveResonator: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 4 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 15 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 3 } },
  },
  spokeCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 5 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 25 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 8 } },
  },
  ellipticalSrfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 3 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 40 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 5 } },
  },
  // Eight cavities in one cryostat: its cryo load dwarfs a single cavity's.
  cryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 12 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 250 } },
    // The rendered TESLA fundamental-power-coupler row is on local -X.
    rf_in:   { utility: 'rfWaveguide',  side: 'left', offsetAlong: 0.55, role: 'sink', params: { demand: 40 } },
  },
  // The SRF ladder above the TESLA cryomodule. Cryo load scales with the
  // number of modules the placement stands for, NOT with its energy gain —
  // that is the whole difference between the two axes this ladder trades on.
  // The proton pair are duty-cycle honest: a 650 MHz medium-beta string runs
  // CW into a heavy beam load, so it asks for more RF than an electron
  // cryomodule of similar size and less cold.
  srf650Cryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 8 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 180 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 60 } },
  },
  srf805Cryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 14 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 380 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 120 } },
  },
  // Three modules at CW duty. Continuous operation is what makes the cold
  // expensive: there is no pulse gap for the helium to catch up in, so this
  // asks for more cryogenics than the six-module Nb3Sn sector below it does
  // at 4.5 K.
  cwCryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 16 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 900 } },
    // Each rendered fundamental-power coupler is a real hookup. Split the
    // placement's existing 100 kW demand across the three windows so adding
    // physical ports does not rebalance the sector.
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.500, role: 'sink', params: { demand: 100 / 3 } },
    rf_in_2: { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.356, role: 'sink', params: { demand: 100 / 3 } },
    rf_in_3: { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.644, role: 'sink', params: { demand: 100 / 3 } },
    vac_in:   { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.644, role: 'sink', params: { outgassing: 6e-6 / 3 } },
    vac_in_2: { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.356, role: 'sink', params: { outgassing: 6e-6 / 3 } },
    vac_in_3: { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.500, role: 'sink', params: { outgassing: 6e-6 / 3 } },
  },
  // Six modules, but at 4.5 K rather than 2 K — which is the entire point of
  // Nb3Sn. Twice the modules of the CW sector for less than the cold, because
  // 4.5 K helium is roughly three times cheaper per watt than superfluid.
  nbSnCryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 20 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 700 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.608, role: 'sink', params: { demand: 100 } },
    rf_in_2: { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.392, role: 'sink', params: { demand: 100 } },
    vac_in:   { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.608, role: 'sink', params: { outgassing: 3e-6 } },
    vac_in_2: { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.392, role: 'sink', params: { outgassing: 3e-6 } },
  },
  // Seventeen cryomodules on one string. The cryo number is the reason a
  // sector is a sector: no single coldBox2K (800 W) covers it, so a collider
  // arm is a cryoplant-planning problem before it is anything else.
  srfLinacSector: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 45 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 4200 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.500, role: 'sink', params: { demand: 200 } },
    rf_in_2: { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.293, role: 'sink', params: { demand: 200 } },
    rf_in_3: { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.707, role: 'sink', params: { demand: 200 } },
    vac_in:   { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.707, role: 'sink', params: { outgassing: 8e-6 / 3 } },
    vac_in_2: { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.293, role: 'sink', params: { outgassing: 8e-6 / 3 } },
    vac_in_3: { utility: 'vacuumPipe', side: 'left', offsetAlong: 0.500, role: 'sink', params: { outgassing: 8e-6 / 3 } },
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
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.15, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 120 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.45, role: 'sink', params: { heatLoad: 60 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.75, role: 'sink', params: { demand: 40 } },
  },
  target: {
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.3, role: 'sink', params: { heatLoad: 40 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 5 } },
  },
  // Purpose-built endpoints.  These are real facility loads, rather than
  // decorative end caps: the utility requirements on the component definitions
  // are backed by ports that players can route to.
  materialsTestStation: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 4 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 3 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 1 } },
  },
  xRayConverterStation: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 18 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.6, role: 'sink', params: { heatLoad: 90 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 4 } },
  },
  eBeamIrradiationVault: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 35 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 120 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 2 } },
  },
  isotopeProductionTarget: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 12 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 100 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 2 } },
  },
  radiationEffectsStation: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 25 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 75 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 3 } },
  },
  protonTherapyGantry: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 180 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 120 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 5 } },
  },
  spallationNeutronTarget: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 450 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 1000 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 12 } },
  },
  photonScienceHutch: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 90 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 60 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 10 } },
  },
  xfelEndstation: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 220 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 180 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 25 } },
  },
  euvCollector: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.2, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 600 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 700 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 8 } },
  },
  collisionPoint: {
    // Beam ports occupy back+front (entryA/entryB) — utilities enter from the sides.
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.5, role: 'sink', params: { demand: 20 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 10 } },
  },
  // Same side-entry constraint as collisionPoint — entryA/entryB take back and
  // front — but three orders of magnitude more of everything, because this is
  // not a bare crossing point: it is a 4-pi vessel with its own final focus,
  // its own shielding and a debris load a 500 TeV collision actually makes.
  blackHoleChamber: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.25, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 600 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.65, role: 'sink', params: { heatLoad: 900 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5,  role: 'sink', params: { demand: 300 } },
  },
  // The heaviest data sink in the game and by a wide margin, which is the
  // whole identity: it earns nothing, it measures a spectrum, and the fibre is
  // the product. Power and water are a hermetic calorimeter's front-end
  // electronics — large, but nothing next to the readout.
  hawkingDetector: {
    hv_in:   { utility: 'hvCable',      side: 'left',  offsetAlong: 0.15, role: 'sink', connectionKind: 'hvLoadIn', params: { demand: 380 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.45, role: 'sink', params: { heatLoad: 340 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.75, role: 'sink', params: { demand: 900 } },
  },
};

// Outgassing (mbar·L/s).
//
// Real vacuum systems are dominated by SURFACE AREA — Q = q_specific × A, and
// for a pipe A = 2πrL, so length is the whole story. This table used to be
// flat per-component constants with `drift` and `bellows` missing from the
// port table entirely, which meant the vac_in injection loop below never
// reached them: a player could draw 500 m of beam pipe and add exactly zero
// gas load. The loop's own comment claimed "every segment of beam pipe needs
// vacuum" while beam pipe was precisely what it missed.
//
// Specific outgassing rates, mbar·L/(s·cm²), for stainless steel:
//   unbaked, ~10 h pumping   1e-10
//   baked UHV                1e-12
// At the game's 0.06 m pipe radius that is 3770 cm² per metre, so one metre of
// unbaked pipe outgasses ~3.8e-7 — about as much as an entire component used
// to. A 100 m line on one 100 L/s pump lands at quality 0.61; baked, ~1.00.
// Long machines therefore need distributed pumping, and `bakeoutSystem`
// (already in the tree with no gameplay effect) becomes a real 100x upgrade.
export const Q_SPECIFIC_UNBAKED = 1e-10;
export const Q_SPECIFIC_BAKED = 1e-12;
const PIPE_RADIUS_M = 0.06;
const SUB_UNIT_M = 0.5;

/** Internal surface area, cm², of `metres` of beam pipe. */
export function pipeSurfaceAreaCm2(metres) {
  return 2 * Math.PI * PIPE_RADIUS_M * metres * 1e4;
}

/** Unbaked outgassing load, mbar·L/s, for a component `subL` sub-units long. */
export function outgassingForLength(subL) {
  return Q_SPECIFIC_UNBAKED * pipeSurfaceAreaCm2((subL || 0) * SUB_UNIT_M);
}

// Anything not listed gets VACUUM_OUTGASSING_DEFAULT. ECR runs a deliberate
// gas feed into its plasma chamber, so it outgasses far above its size class.
const VACUUM_OUTGASSING_DEFAULT = 5e-7;
const VACUUM_OUTGASSING = {
  // tiny (diagnostics, thin elements)
  bpm: 2e-7, ict: 2e-7, screen: 2e-7, wireScanner: 2e-7, faradayCup: 2e-7,
  // medium modules
  source: 1e-6, dcPhotoGun: 1e-6, ncRfGun: 2e-6, srfGun: 2e-6,
  penningIonSource: 1e-6, ionSource: 1e-6, dcInjector: 2e-6, pillboxCavity: 1e-6, spokeCavity: 1e-6,
  ellipticalSrfCavity: 1e-6, rfq: 1e-6, dtl: 1.5e-6, target: 1e-6, industrialLinac: 1e-6,
  // large vessels / gas-loaded
  ecrIonSource: 5e-6, rfCavity: 2e-6, sbandStructure: 2e-6,
  cryomodule: 4e-6, detector: 5e-6,
  // Bigger vessels than `detector`, with more surface and more feedthroughs.
  blackHoleChamber: 8e-6, hawkingDetector: 9e-6,
  // The RF ladder. The copper structures track length and bore; the SRF
  // sectors track how many cryomodules the placement stands for. The one
  // outlier is plasmaAfterburner, which like lwfaStation ADMITS gas on
  // purpose — a hydrogen capillary IS the accelerating medium, so it is the
  // worst gas load on any beamline that has one and wants its own pumping.
  cbandStructure: 2e-6, xbandStructure: 2e-6, twoBeamModule: 4e-6,
  plasmaAfterburner: 8e-6,
  // The opposite outlier to plasmaAfterburner. There is no gas: the
  // accelerating medium is a solid held cold, and a cryogenic surface in the
  // bore is a distributed pump. This is the lowest gas load of any ten-metre
  // module in the catalogue, and it has to be — nothing else on the line
  // survives a 200-tile run at ordinary pressure.
  crystalChannelStage: 4e-7,
  srf650Cryomodule: 5e-6, srf805Cryomodule: 6e-6,
  cwCryomodule: 6e-6, nbSnCryomodule: 6e-6, srfLinacSector: 8e-6,
  recirculationArc: 2e-6,
  // Compound machines. The electrostatic pair are large but dry columns; the
  // cyclotrons are big vessels with an internal gas-fed ion source; the LWFA
  // deliberately admits gas — a hydrogen or helium jet or capillary IS the
  // accelerating medium, so it is the worst gas load in the catalogue and
  // wants its own pumping rather than a share of the beamline's.
  vanDeGraaff: 1.5e-6, cockcroftWalton: 2e-6,
  cyclotron30: 3e-6, cyclotron70: 5e-6,
  lwfaStation: 8e-6,
};

// Equipment-level cooling is a real supply-and-return pair. Ordinary magnets,
// warm cavities and diagnostics retain flexible hoses; only the explicitly
// high-flow machines above use fabricated waterSupplyPipe ports directly.
// Keep the existing `cool_in` identity for save compatibility and add one
// independently connectable hot outlet carrying the same thermal load.
for (const ports of Object.values(BEAMLINE_UTILITY_PORTS)) {
  const cold = ports?.cool_in;
  if (cold?.utility !== 'coolingWater' || cold.role !== 'sink') continue;
  cold.params = { ...(cold.params || {}), waterCircuit: 'cold' };
  if (!ports.hot_out) {
    ports.hot_out = {
      utility: 'coolingWater',
      side: cold.side,
      offsetAlong: (cold.offsetAlong ?? 0.5) <= 0.5
        ? Math.min(0.9, (cold.offsetAlong ?? 0.5) + 0.25)
        : Math.max(0.1, (cold.offsetAlong ?? 0.5) - 0.25),
      role: 'sink',
      params: {
        heatLoad: cold.params.heatLoad,
        waterCircuit: 'hot',
      },
    };
  }
}

// Inject vacuum sinks for all beamline modules that lack one — every segment
// of beam pipe needs vacuum, so the utility solver can trip the beam via
// vacuum_no_pump when no pump is connected. Keep existing vac_in if present.
//
// Driven off COMPONENTS rather than this table's own keys: iterating
// BEAMLINE_UTILITY_PORTS meant a component with no OTHER utility port never
// got a vacuum sink either, which is how `bellows` ended up contributing no
// gas load at all.
//
// `drift` is deliberately excluded. It is a drawn connection — the beam pipe
// itself — and never exists as a placeable, so a port declared on it could
// never be discovered into a network and its outgassing would be silently
// dropped. Beam-pipe surface area is instead added directly by the vacuum
// solver, which can see state.beamPipes and knows which pumps serve them.
// Length-scaled outgassing is the dominant term on any real machine, so it
// has to be counted somewhere that actually runs.
//
// Keep the per-component sink even for tiny inline hardware. It is not merely
// a drawing convenience: utility-gate hard-gates each declared sink, and the
// vacuum solver uses those sink records to associate continuous beam-pipe ids
// with their volume and surface outgassing. Removing "redundant-looking"
// fittings would therefore make hardware run at atmosphere and can drop pipe
// surface area from the solve. Presentation places every generated CF flange
// on the 1 m beam-axis service band; a future topology aggregation must first
// introduce an explicit pipe-section vacuum endpoint and quality fan-out.
for (const [id, comp] of Object.entries(BEAMLINE_COMPONENTS_RAW)) {
  if (comp.isDrawnConnection) continue;
  if (!BEAMLINE_UTILITY_PORTS[id]) BEAMLINE_UTILITY_PORTS[id] = {};
  if (BEAMLINE_UTILITY_PORTS[id].vac_in) continue;
  const outgassing = id === 'bellows'
    ? outgassingForLength(comp.subL)
    : (VACUUM_OUTGASSING[id] ?? VACUUM_OUTGASSING_DEFAULT);
  BEAMLINE_UTILITY_PORTS[id].vac_in = {
    utility: 'vacuumPipe', side: 'left', offsetAlong: 0.7, role: 'sink',
    params: { outgassing },
  };
}

// ---------------------------------------------------------------------------
// Infrastructure (sources). Capacity ladders per utility:
//
//   power   (kW):   padMount 150 → facilityTransformer 400 → hvTransformer
//                   1500 → gridIntertieTransformer 6000. Those are the ONLY
//                   capacity sources; switchgear, panels, MCCs, buses and UPS
//                   units distribute an upstream feed without creating power.
//   rf      (kW):   magnetron 5 @S → wideband driver 5 @all
//                   → low-band buncher SSA 10 @VHF/UHF → TWT 20 @all
//                   → slac5045Klystron 25 @S → SSA 35 @VHF/UHF
//                   → pulsedKlystron 50 @S/C / cwKlystron 50 @UHF/L
//                   → IOT 80 @UHF/L → MBK 200 @S/C → highPowerSSA 300
//                   @VHF/UHF/L → gyrotron 1000 @C/X
//   process cooling (kW): packageChiller 5 → lcwSkid 25
//                         → dualCircuitChiller 175 → chiller 300
//   heat rejection (kW): fanCoilCooler 50 → dryCoolerBank 500
//                        → coolingTower 800
//   cryo    (W):    coldBox4K 500 → coldBox2K 800
//   vacuum  (L/s):  roughing 15 → turbo 300 → tiSub 400 → NEG 500 → ion 600
//   data: directionless peer topology; there are no source capacities.
//
// RF sources: `bands` is filled from the raw `rfBands` array — a source has no
// frequency of its own, only coverage (see types/rfWaveguide.js).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Distribution buses.
//
// ONE UTILITY PER BUS. A bus could plausibly have carried several utilities in
// one cabinet, but that collapses the decision: a single "service module" next
// to the pipe would answer power, cooling, vacuum, RF and cryo at once and the
// only remaining question would be "did I place it". One utility per bus keeps
// each utility's reach, cost and placement an independent call — the RF
// manifold wants to sit near the klystron gallery, the valve box near the cold
// box, and neither wants to be where the power feeder lands. It also matches
// the hardware: nobody builds a box that is simultaneously a busway, a water
// header and a vacuum-jacketed cryo distribution box.
//
// A bus declares four `pass` ports, one per side, so a feed can approach from
// any direction (portMatchesApproach keys off the port's outward side) and so
// a trunk can run through it. discoverNetworks already unions same-utility
// pass ports on one placeable, which is what makes the four behave as one node.
//
// `bus: true` is the marker computeBusService (src/utility/network-discovery.js)
// looks for; `params.serviceRadius` is its reach in GRID CELLS (1 cell = 2 m)
// and is the knob that decides "how many buses and where". Reach ladder, from
// the physics each one is standing in for:
//   fiber 12 (low-loss, cheap) > power 10 (busway) > cooling 8 (headered LCW)
//   > RF 6 / cryo 6 (lossy waveguide, expensive vacuum-jacketed line)
//   > vacuum 5 (conductance dies down a long manifold)
// A bus adds NO capacity — it only changes how many lines the player draws.
// ---------------------------------------------------------------------------

const BUS_PORT_SIDES = { bus_back: 'back', bus_front: 'front', bus_left: 'left', bus_right: 'right' };

function busPorts(utility, serviceRadius, autoConnectClass = null) {
  const out = {};
  for (const [name, side] of Object.entries(BUS_PORT_SIDES)) {
    out[name] = {
      utility, side, offsetAlong: 0.5, role: 'pass',
      ...(autoConnectClass ? { autoConnectClass } : {}),
      bus: true, params: { serviceRadius },
    };
  }
  return out;
}

/**
 * Vacuum combiner: one common header connection and a finite bank of pump
 * branches. All fittings are pass-throughs, so pump speed still comes only
 * from the pumps connected to them; the manifold merely joins those sources
 * into one network. The left/right legacy names preserve the connectors used
 * by older authored layouts.
 */
function vacuumManifoldPorts(branchCount, serviceRadius) {
  const out = {
    bus_back: {
      utility: 'vacuumPipe', side: 'back', offsetAlong: 0.5,
      role: 'pass', bus: true, params: { serviceRadius },
    },
  };
  const perSide = branchCount / 2;
  for (let i = 0; i < branchCount; i++) {
    const sideIndex = i % perSide;
    const name = i === 0 ? 'bus_left' : i === perSide ? 'bus_right' : `vac_branch_${i + 1}`;
    out[name] = {
      utility: 'vacuumPipe', side: i < perSide ? 'left' : 'right',
      offsetAlong: (sideIndex + 1) / (perSide + 1),
      role: 'pass', bus: true, params: { serviceRadius },
    };
  }
  return out;
}

// Sides used by compact field boxes. Permanent cabinets and transformers put
// their terminals on a deliberate front/rear service plane instead.
const OUTLET_SIDES = ['right', 'front', 'left', 'back'];

/** A supply: `count` HV outlets sharing `capacity` kW. */
function supplyPorts(capacity, count) {
  const out = {};
  for (let i = 0; i < count; i++) {
    out[`hv_out_${i + 1}`] = {
      utility: 'hvCable',
      // Transformer secondary terminals are grouped on the operator-facing
      // cable side. Presentation anchors arrange high-count banks in rows;
      // these unique fractions keep the routing endpoints independently
      // approachable at subtile resolution.
      side: 'front',
      offsetAlong: (i + 1) / (count + 1),
      role: 'source',
      connectionKind: 'hvSupplyOut',
      // capacity/N per outlet, for the same reason distribution splits its
      // rating: discovery unites a device's source ports into one busbar, so
      // the outlets add back up to the supply's actual rating rather than
      // multiplying it by the number of feeders it can run.
      params: { capacity: capacity / count },
    };
  }
  return out;
}

/** A transformer consumes a rated upstream HV feeder before exposing its HV outputs. */
function transformerPorts(capacity, count) {
  return {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5, role: 'sink',
      connectionKind: 'hvLoadIn',
      params: { demand: capacity, tracksDownstreamDemand: true },
    },
    ...supplyPorts(capacity, count),
  };
}

/**
 * HV distribution: one roof tap on an HV trunk feeds `count` protected
 * outgoing feeders. The tap accepts the incoming and continuing trunk cable,
 * while remaining a demand-tracking sink; the outputs are separate sources
 * gated by that input's hvQuality. This keeps the electrical graph radial
 * while letting one HV distributor feed several downstream panels or loads.
 */
function hvDistributionPorts(rating, count) {
  const out = {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'sink', connectionKind: 'hvDistributionTap',
      omnidirectional: true, maxConnections: 2, tensionsCable: true,
      params: { demand: rating, tracksDownstreamDemand: true },
    },
  };
  for (let i = 0; i < count; i++) {
    out[`hv_out_${i + 1}`] = {
      utility: 'hvCable',
      side: 'front', offsetAlong: (i + 1) / (count + 1),
      role: 'source', connectionKind: 'hvDistributionOut',
      params: { capacity: rating / count },
    };
  }
  return out;
}

/**
 * A distribution device: one HV inlet drawing its connected downstream load,
 * capped at `rating`, and `count` branch outlets. The panel is transparent to
 * the facility's power budget: it adds no capacity or intrinsic demand.
 */
function distributionPorts(rating, count, {
  outletSide = null,
  branchCapacity = rating / count,
  hvCount = 0,
  hvOutputCapacity = 300,
  trunkTap = false,
} = {}) {
  const out = {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'sink', connectionKind: trunkTap ? 'hvDistributionTap' : 'hvDistributionIn',
      ...(trunkTap ? {
        omnidirectional: true, maxConnections: 2, tensionsCable: true,
      } : {}),
      params: { demand: rating, tracksDownstreamDemand: true },
    },
  };
  for (let i = 0; i < count; i++) {
    out[`pwr_out_${i + 1}`] = {
      utility: 'powerCable',
      side: outletSide || OUTLET_SIDES[i % OUTLET_SIDES.length],
      // Keep footprint-level route endpoints evenly spread along the face so
      // every branch remains independently approachable. Presentation anchors
      // arrange the visible cable ends on front-mounted terminal banks.
      // Other field equipment keeps spreading outlets around its footprint.
      offsetAlong: outletSide
        ? (i + 1) / (count + 1)
        : 0.25 + 0.5 * (Math.floor(i / OUTLET_SIDES.length) % 2),
      role: 'source',
      connectionKind: 'powerDistributionOut',
      // Same-utility outlets are one busbar in discovery. Compact panels put
      // their full rating into this green bank; hybrid section/main panels
      // split the nameplate rating between this bank and their HV bank below.
      params: { capacity: branchCapacity },
    };
  }
  for (let i = 0; i < hvCount; i++) {
    out[`hv_out_${i + 1}`] = {
      utility: 'hvCable',
      side: outletSide || 'front',
      offsetAlong: (i + 1) / (hvCount + 1),
      role: 'source', connectionKind: 'hvDistributionOut',
      params: { capacity: hvOutputCapacity },
    };
  }
  return out;
}

/**
 * A field box is passive copper, not another source. Its one feed port can
 * only accept a panel branch circuit; its outlets only leave toward loads.
 * Discovery unites pass ports on one device, so all attached loads stay on
 * the original panel's network and capacity is never duplicated. The field
 * rating is a real bottleneck in powerCable.solve, not decorative metadata.
 */
function fieldDistributionPorts(count, {
  capacity, serviceRadius = null, feedSide = 'back', interchangeable = false,
} = {}) {
  const fieldKind = interchangeable ? 'powerFieldPort' : null;
  const out = {
    pwr_in: {
      utility: 'powerCable', side: feedSide, offsetAlong: 0.5,
      role: 'pass', connectionKind: fieldKind || 'powerFieldIn',
      ...(serviceRadius == null ? {} : { bus: true }),
      params: { fieldCapacity: capacity, ...(serviceRadius == null ? {} : { serviceRadius }) },
    },
  };
  for (let i = 0; i < count; i++) {
    out[`pwr_out_${i + 1}`] = {
      // Field taps leave all sides of the small box/raceway. This keeps a
      // dense set of real circuits routable without overlapping every run in
      // the first cable tray outside the device.
      utility: 'powerCable', side: OUTLET_SIDES[i % OUTLET_SIDES.length],
      offsetAlong: 0.25 + 0.5 * (Math.floor(i / OUTLET_SIDES.length) % 2),
      role: 'pass', connectionKind: fieldKind || 'powerFieldOut',
      ...(serviceRadius == null ? {} : { bus: true }),
      params: { fieldCapacity: capacity, ...(serviceRadius == null ? {} : { serviceRadius }) },
    };
  }
  return out;
}

/** Long busway: feeder enters one end, four tap boxes line each long edge. */
function buswayPorts(capacity, serviceRadius) {
  const out = {
    pwr_in: {
      utility: 'powerCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'powerFieldIn', bus: true,
      params: { fieldCapacity: capacity, serviceRadius },
    },
  };
  for (let i = 0; i < 8; i++) {
    const bankIndex = Math.floor(i / 2);
    out[`pwr_out_${i + 1}`] = {
      utility: 'powerCable', side: i % 2 === 0 ? 'right' : 'left',
      offsetAlong: 0.2 + bankIndex * 0.2,
      role: 'pass', connectionKind: 'powerFieldOut', bus: true,
      params: { fieldCapacity: capacity, serviceRadius },
    };
  }
  return out;
}

// Control-room electronics put both service connectors on the panel opposite
// their visible screens, faceplates and status LEDs. Most detailed control
// furniture faces local -Z and therefore uses local +Z (`front` in the utility
// side vocabulary) as its rear. The simple decal-built compute cabinets face
// +Z and pass `rearSide: 'back'` instead. Capture gateways retain the authored
// data_out socket name, but data fiber is a directionless peer fabric: the
// socket is a pass port, not a source. Downstream cabinets retain data_in sink
// ports so their required-connection and delivery-quality contracts remain
// visible to topology checks.
function controlElectronicsPorts({
  powerDemand, dataPeer = false, rearSide = 'front',
}) {
  return {
    pwr_in: {
      utility: 'powerCable', side: rearSide, offsetAlong: 0.3,
      role: 'sink', params: { demand: powerDemand },
    },
    [dataPeer ? 'data_out' : 'data_in']: {
      utility: 'dataFiber', side: rearSide, offsetAlong: 0.7,
      role: dataPeer ? 'pass' : 'sink',
      params: {},
    },
  };
}

/** Eight interchangeable Ethernet sockets on one internal switching fabric. */
function networkSwitchPorts() {
  const out = {
    pwr_in: {
      utility: 'powerCable', side: 'left', offsetAlong: 0.5,
      role: 'sink', params: { demand: 0.2 },
    },
  };
  const sides = ['back', 'front', 'left', 'right'];
  for (let i = 0; i < 8; i++) {
    out[`data_${i + 1}`] = {
      utility: 'dataFiber', side: sides[Math.floor(i / 2)],
      offsetAlong: i % 2 === 0 ? 0.3 : 0.7,
      role: 'pass', maxConnections: 1, params: {},
    };
  }
  return out;
}

// Cooling plant uses a consistent, mirrorable header layout. Process chillers
// expose four load branches on the primary (+X/right) header and two plant or
// distribution links opposite. Storage and make-up equipment uses the same
// physical 4+2 layout but classifies all six sockets as plant links. Heat
// rejectors only need their physical supply/return pair, together on one face.
//
// All sockets on one source are internally united by network discovery, so a
// numeric nameplate must be divided across them. The parts add back to the
// same plant rating; adding routing choices never mints cooling capacity.
const COOLING_PRIMARY_OFFSETS = [0.14, 0.38, 0.62, 0.86];
const COOLING_SECONDARY_OFFSETS = [0.33, 0.67];

function coolingPlantPorts(params, names = [
  'cool_out', 'cool_out_2', 'cool_out_3',
  'cool_out_4', 'cool_out_5', 'cool_out_6',
], {
  primaryClass = COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH,
  secondaryClass = COOLING_AUTO_CONNECT_CLASS.PLANT_LINK,
} = {}) {
  const out = {};
  const splitParams = { ...params };
  for (const key of [
    'capacity', 'heatRejectionCapacity', 'supplyRateLPerTick', 'storageCapacityL',
  ]) {
    if (typeof splitParams[key] === 'number') splitParams[key] /= names.length;
  }
  names.forEach((name, i) => {
    const primary = i < COOLING_PRIMARY_OFFSETS.length;
    const waterCircuit = primary ? 'cold' : 'hot';
    const circuitCount = primary
      ? Math.min(names.length, COOLING_PRIMARY_OFFSETS.length)
      : Math.max(1, names.length - COOLING_PRIMARY_OFFSETS.length);
    const circuitParams = {
      waterCircuit,
      ...(primary && typeof params.capacity === 'number'
        ? { capacity: params.capacity / circuitCount } : {}),
      ...(!primary && typeof params.heatRejectionCapacity === 'number'
        ? { heatRejectionCapacity: params.heatRejectionCapacity / circuitCount } : {}),
    };
    out[name] = {
      utility: 'coolingWater',
      side: primary ? 'right' : 'left',
      offsetAlong: primary
        ? COOLING_PRIMARY_OFFSETS[i]
        : COOLING_SECONDARY_OFFSETS[i - COOLING_PRIMARY_OFFSETS.length],
      role: 'source',
      autoConnectClass: primary ? primaryClass : secondaryClass,
      params: primary
        ? { ...splitParams, ...circuitParams, heatRejectionCapacity: 0 }
        : { ...splitParams, ...circuitParams, capacity: 0 },
    };
  });
  return out;
}

function heatRejectorPorts(heatRejectionCapacity, side = 'right') {
  // A rejector does not create chilled water; it only disposes of heat moved
  // by a chiller. Declare capacity:0 explicitly so the generic source fallback
  // cannot make a tower satisfy both plant roles by itself.
  const params = {
    capacity: 0,
    heatRejectionCapacity: heatRejectionCapacity / 2,
  };
  return {
    supply_hot_1: {
      utility: 'waterSupplyPipe', side, offsetAlong: 0.33,
      role: 'source',
      params: { heatRejectionCapacity: heatRejectionCapacity / 2, waterCircuit: 'hot' },
    },
    supply_hot_2: {
      utility: 'waterSupplyPipe', side, offsetAlong: 0.67,
      role: 'source',
      params: { heatRejectionCapacity: heatRejectionCapacity / 2, waterCircuit: 'hot' },
    },
  };
}

function centralChillerPorts(capacity) {
  const out = {};
  const names = ['cool_out', 'cool_out_2', 'cool_out_3', 'cool_out_4'];
  for (let i = 0; i < 4; i++) {
    out[names[i]] = {
      utility: 'coolingWater', side: 'right',
      offsetAlong: COOLING_PRIMARY_OFFSETS[i], role: 'source',
      autoConnectClass: COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH,
      params: { capacity: capacity / 4, waterCircuit: 'cold' },
    };
  }
  out.water_in = {
    utility: 'waterSupplyPipe', side: 'left', offsetAlong: 0.33,
    role: 'pass', params: { waterCircuit: 'hot' },
  };
  out.supply_cold_out = {
    utility: 'waterSupplyPipe', side: 'left', offsetAlong: 0.67,
    role: 'source', params: { capacity, waterCircuit: 'cold' },
  };
  return out;
}

function waterInventoryPorts(params) {
  return {
    ...coolingPlantPorts({ capacity: 0, ...params }, undefined, {
      primaryClass: COOLING_AUTO_CONNECT_CLASS.PLANT_LINK,
    }),
    water_supply_out: {
      utility: 'waterSupplyPipe', side: 'left', offsetAlong: 0.5,
      role: 'source', params: {
        capacity: 0, ...params, waterCircuit: 'hot',
      },
    },
  };
}

function waterDistributorPorts(flexibleCount, supplyCount) {
  const out = {};
  const branchOffsets = flexibleCount === 2
    ? [0.2, 0.8]
    : flexibleCount === 4
      ? [0.1, 0.35, 0.65, 0.9]
      : Array.from({ length: flexibleCount }, (_, i) => (i + 1) / (flexibleCount + 1));
  for (let i = 0; i < flexibleCount; i++) {
    out[`water_line_${i + 1}`] = {
      utility: 'coolingWater', side: 'right',
      offsetAlong: branchOffsets[i],
      role: 'pass', autoConnectClass: COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH,
      params: {},
    };
  }
  for (let i = 0; i < supplyCount; i++) {
    out[`supply_pipe_${i + 1}`] = {
      utility: 'waterSupplyPipe', side: 'left',
      offsetAlong: (i + 1) / (supplyCount + 1), role: 'pass', params: {},
    };
  }
  return out;
}

function lcwManifoldPorts() {
  // Eight fittings share the long branch face. Fill its usable span evenly so
  // the 0.22 m placement markers do not overlap at normal game scale.
  const branchOffsets = Array.from({ length: 8 }, (_, index) =>
    0.1 + (index * 0.8) / 7);
  const out = {
    supply_cold: {
      utility: 'waterSupplyPipe', side: 'left', offsetAlong: 0.73,
      role: 'pass', params: { waterCircuit: 'cold' },
    },
    supply_hot: {
      utility: 'waterSupplyPipe', side: 'left', offsetAlong: 0.27,
      role: 'pass', params: { waterCircuit: 'hot' },
    },
  };
  for (const [circuit, offsetIndex] of [['cold', 0], ['hot', 4]]) {
    for (let index = 1; index <= 4; index++) {
      out[`${circuit}_${index}`] = {
        utility: 'coolingWater', side: 'right',
        offsetAlong: branchOffsets[offsetIndex + index - 1],
        role: 'source', autoConnectClass: COOLING_AUTO_CONNECT_CLASS.LOAD_BRANCH,
        params: { waterCircuit: circuit },
      };
    }
  }
  return out;
}

const INFRA_UTILITY_PORTS = {
  // Field distribution is deliberately physical: a finite set of real
  // sockets, not a service-radius shortcut, and it cannot bridge another
  // field distributor. A busway keeps a designated feeder end; a portable
  // spider box has four equivalent sockets, so whichever one the panel reaches
  // becomes the feed and the remaining three can serve loads.
  powerBus:            buswayPorts(160, 10),
  spiderBox:           fieldDistributionPorts(3, { capacity: 30, interchangeable: true }),
  // Wall feedthroughs split one physical crossing into two terminated cable
  // runs. Pass roles make the terminals continuous inside the fitting without
  // inventing supply or demand; the dedicated connection kinds preserve the
  // radial electrical hierarchy across one or several walls.
  powerWallPassThrough: {
    pwr_in: {
      utility: 'powerCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'powerPassThroughIn', params: {},
    },
    pwr_out: {
      utility: 'powerCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'powerPassThroughOut', params: {},
    },
  },
  coldWaterLineWallPassThrough: {
    water_front: { utility: 'coolingWater', side: 'front', role: 'pass', autoConnectClass: COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION, params: { waterCircuit: 'cold' } },
    water_back: { utility: 'coolingWater', side: 'back', role: 'pass', autoConnectClass: COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION, params: { waterCircuit: 'cold' } },
  },
  hotWaterLineWallPassThrough: {
    water_front: { utility: 'coolingWater', side: 'front', role: 'pass', autoConnectClass: COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION, params: { waterCircuit: 'hot' } },
    water_back: { utility: 'coolingWater', side: 'back', role: 'pass', autoConnectClass: COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION, params: { waterCircuit: 'hot' } },
  },
  coldWaterSupplyWallPassThrough: {
    supply_front: { utility: 'waterSupplyPipe', side: 'front', role: 'pass', params: { waterCircuit: 'cold' } },
    supply_back: { utility: 'waterSupplyPipe', side: 'back', role: 'pass', params: { waterCircuit: 'cold' } },
  },
  hotWaterSupplyWallPassThrough: {
    supply_front: { utility: 'waterSupplyPipe', side: 'front', role: 'pass', params: { waterCircuit: 'hot' } },
    supply_back: { utility: 'waterSupplyPipe', side: 'back', role: 'pass', params: { waterCircuit: 'hot' } },
  },
  waterSupplyWallPassThrough1x1: {
    supply_front: { utility: 'waterSupplyPipe', side: 'front', offsetAlong: 0.5, role: 'pass', params: {} },
    supply_back: { utility: 'waterSupplyPipe', side: 'back', offsetAlong: 0.5, role: 'pass', params: {} },
  },
  waterSupplyWallPassThrough2x2: {
    supply_front_1: { utility: 'waterSupplyPipe', side: 'front', offsetAlong: 0.33, role: 'pass', params: {} },
    supply_back_1: { utility: 'waterSupplyPipe', side: 'back', offsetAlong: 0.33, role: 'pass', params: {} },
    supply_front_2: { utility: 'waterSupplyPipe', side: 'front', offsetAlong: 0.67, role: 'pass', params: {} },
    supply_back_2: { utility: 'waterSupplyPipe', side: 'back', offsetAlong: 0.67, role: 'pass', params: {} },
  },
  meterMain: {
    pwr_in: {
      utility: 'powerCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'powerPassThroughIn',
      params: { fieldCapacity: 100 },
    },
    pwr_out: {
      utility: 'powerCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'powerPassThroughOut',
      params: { fieldCapacity: 100 },
    },
  },
  hvWallPassThrough: {
    hv_in: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThrough', omnidirectional: true, params: {},
    },
    hv_out: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThrough', omnidirectional: true, params: {},
    },
  },
  hvWallPassThrough4x4: Object.fromEntries([
    [1, 0.125], [2, 0.375], [3, 0.625], [4, 0.875],
  ].flatMap(([index, offsetAlong]) => [
    [`hv_in_${index}`, {
      utility: 'hvCable', side: 'front', offsetAlong, role: 'pass',
      connectionKind: 'hvPassThrough', omnidirectional: true, params: {},
    }],
    [`hv_out_${index}`, {
      utility: 'hvCable', side: 'back', offsetAlong, role: 'pass',
      connectionKind: 'hvPassThrough', omnidirectional: true, params: {},
    }],
  ])),
  dataFiberWallPassThrough: {
    fiber_front: { utility: 'dataFiber', side: 'front', role: 'pass', params: {} },
    fiber_back: { utility: 'dataFiber', side: 'back', role: 'pass', params: {} },
  },
  cryoWallPassThrough: {
    cryo_front: { utility: 'cryoTransfer', side: 'front', role: 'pass', params: {} },
    cryo_back: { utility: 'cryoTransfer', side: 'back', role: 'pass', params: {} },
  },
  rfWallPassThrough: {
    rf_front: { utility: 'rfWaveguide', side: 'front', role: 'pass', params: {} },
    rf_back: { utility: 'rfWaveguide', side: 'back', role: 'pass', params: {} },
  },
  vacuumWallPassThrough: {
    vacuum_front: { utility: 'vacuumPipe', side: 'front', role: 'pass', params: {} },
    vacuum_back: { utility: 'vacuumPipe', side: 'back', role: 'pass', params: {} },
  },
  indoorHvCableRack: {
    ...Object.fromEntries([
      [1, 0.20], [2, 0.40], [3, 0.60], [4, 0.80],
    ].map(([index, offsetAlong]) => [`hv_${index}`, {
      utility: 'hvCable', side: 'front', offsetAlong,
      role: 'pass', omnidirectional: true, maxConnections: 2, params: {},
    }])),
    hv_tap_left: {
      utility: 'hvCable', side: 'left', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvDistributionTap',
      omnidirectional: true, maxConnections: 1, params: {},
    },
    hv_tap_right: {
      utility: 'hvCable', side: 'right', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvDistributionTap',
      omnidirectional: true, maxConnections: 1, params: {},
    },
  },
  indoorHvCableRack1Way: {
    hv_1: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', omnidirectional: true, maxConnections: 2, params: {},
    },
  },
  indoorHvCableRack2Way: {
    ...Object.fromEntries([
      [1, 0.40], [2, 0.80],
    ].map(([index, offsetAlong]) => [`hv_${index}`, {
      utility: 'hvCable', side: 'front', offsetAlong,
      role: 'pass', omnidirectional: true, maxConnections: 2, params: {},
    }])),
    hv_tap_left: {
      utility: 'hvCable', side: 'left', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvDistributionTap',
      omnidirectional: true, maxConnections: 1, params: {},
    },
  },
  indoorHvCableCornerRack: Object.fromEntries([
    [1, 'back', 0.125], [2, 'back', 0.375],
    [3, 'front', 0.625], [4, 'front', 0.875],
  ].map(([index, side, offsetAlong]) => [`hv_${index}`, {
    utility: 'hvCable', side, offsetAlong,
    role: 'pass', omnidirectional: true, maxConnections: 2, params: {},
  }])),
  disconnectSwitch: {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughIn', params: {},
    },
    hv_out: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughOut', params: {},
    },
  },
  hvDuctBankVault: {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughIn',
      params: { fieldCapacity: 400 },
    },
    hv_out: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughOut',
      params: { fieldCapacity: 400 },
    },
  },
  // One passive, two-wire connector per visible overhead insulator plus one
  // single-feeder pole-transformer tap. Wood-pole electricalGroups bus their
  // terminals; the transmission tower keeps six isolated conductors.
  utilityPole2Way: {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughIn', omnidirectional: true,
      maxConnections: 2, params: {},
    },
    hv_out: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughOut', omnidirectional: true,
      maxConnections: 2, params: {},
    },
    hv_tap: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvDistributionTap',
      omnidirectional: true, maxConnections: 1, params: {},
    },
  },
  utilityPole: {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughIn', omnidirectional: true,
      maxConnections: 2, params: {},
    },
    hv_out: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughOut', omnidirectional: true,
      maxConnections: 2, params: {},
    },
    hv_3: { utility: 'hvCable', side: 'back', offsetAlong: 0.5, role: 'pass', omnidirectional: true, maxConnections: 2, params: {} },
    hv_4: { utility: 'hvCable', side: 'front', offsetAlong: 0.5, role: 'pass', omnidirectional: true, maxConnections: 2, params: {} },
    hv_tap: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvDistributionTap',
      omnidirectional: true, maxConnections: 1, params: {},
    },
  },
  transmissionTower: {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughIn', omnidirectional: true,
      maxConnections: 2, params: {},
    },
    hv_out: {
      utility: 'hvCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'hvPassThroughOut', omnidirectional: true,
      maxConnections: 2, params: {},
    },
    hv_3: { utility: 'hvCable', side: 'back', offsetAlong: 0.5, role: 'pass', omnidirectional: true, maxConnections: 2, params: {} },
    hv_4: { utility: 'hvCable', side: 'front', offsetAlong: 0.5, role: 'pass', omnidirectional: true, maxConnections: 2, params: {} },
    hv_5: { utility: 'hvCable', side: 'back', offsetAlong: 0.5, role: 'pass', omnidirectional: true, maxConnections: 2, params: {} },
    hv_6: { utility: 'hvCable', side: 'front', offsetAlong: 0.5, role: 'pass', omnidirectional: true, maxConnections: 2, params: {} },
  },
  cableTray: {
    pwr_in_1: { utility: 'powerCable', side: 'back', offsetAlong: 0.20, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_in_2: { utility: 'powerCable', side: 'back', offsetAlong: 0.40, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_in_3: { utility: 'powerCable', side: 'back', offsetAlong: 0.60, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_in_4: { utility: 'powerCable', side: 'back', offsetAlong: 0.80, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_out_1: { utility: 'powerCable', side: 'front', offsetAlong: 0.20, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    pwr_out_2: { utility: 'powerCable', side: 'front', offsetAlong: 0.40, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    pwr_out_3: { utility: 'powerCable', side: 'front', offsetAlong: 0.60, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    pwr_out_4: { utility: 'powerCable', side: 'front', offsetAlong: 0.80, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
  },
  elevatedWireTray: {
    pwr_in_1: { utility: 'powerCable', side: 'back', offsetAlong: 0.15, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_in_2: { utility: 'powerCable', side: 'back', offsetAlong: 0.32, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_in_3: { utility: 'powerCable', side: 'back', offsetAlong: 0.49, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    pwr_in_4: { utility: 'powerCable', side: 'back', offsetAlong: 0.66, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 160 } },
    data_in: { utility: 'dataFiber', side: 'back', offsetAlong: 0.84, role: 'pass', connectionKind: 'dataTrayPassThrough', params: {} },
    pwr_out_1: { utility: 'powerCable', side: 'front', offsetAlong: 0.15, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    pwr_out_2: { utility: 'powerCable', side: 'front', offsetAlong: 0.32, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    pwr_out_3: { utility: 'powerCable', side: 'front', offsetAlong: 0.49, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    pwr_out_4: { utility: 'powerCable', side: 'front', offsetAlong: 0.66, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 160 } },
    data_out: { utility: 'dataFiber', side: 'front', offsetAlong: 0.84, role: 'pass', connectionKind: 'dataTrayPassThrough', params: {} },
  },
  cableRiser: {
    pwr_in_1: { utility: 'powerCable', side: 'back', offsetAlong: 0.33, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 80 } },
    pwr_in_2: { utility: 'powerCable', side: 'back', offsetAlong: 0.67, role: 'pass', connectionKind: 'powerPassThroughIn', params: { fieldCapacity: 80 } },
    pwr_out_1: { utility: 'powerCable', side: 'front', offsetAlong: 0.33, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 80 } },
    pwr_out_2: { utility: 'powerCable', side: 'front', offsetAlong: 0.67, role: 'pass', connectionKind: 'powerPassThroughOut', params: { fieldCapacity: 80 } },
  },
  automaticTransferSwitch: {
    normal_in: {
      utility: 'powerCable', side: 'back', offsetAlong: 0.25,
      role: 'pass', connectionKind: 'powerTransferNormalIn',
      params: { fieldCapacity: 250 },
    },
    backup_in: {
      utility: 'powerCable', side: 'back', offsetAlong: 0.75,
      role: 'pass', connectionKind: 'powerTransferBackupIn',
      params: { fieldCapacity: 250 },
    },
    pwr_out: {
      utility: 'powerCable', side: 'front', offsetAlong: 0.5,
      role: 'pass', connectionKind: 'powerTransferOut',
      params: { fieldCapacity: 250 },
    },
  },
  coolingManifold: lcwManifoldPorts(),
  waterDistributor2: waterDistributorPorts(2, 1),
  waterDistributor4: waterDistributorPorts(4, 2),
  vacuumManifold:      vacuumManifoldPorts(4, 5),
  vacuumManifold8:     vacuumManifoldPorts(8, 7),
  waveguideManifold:   busPorts('rfWaveguide',   6),
  cryoValveBox:        busPorts('cryoTransfer',  6),
  fiberBus:            busPorts('dataFiber',    12),
  // --- power: supply -> HV feeder -> distribution -> branch circuits --------
  //
  // SUPPLY holds all the capacity and exposes HV outlets. Outlet count is how
  // many distribution points one supply can serve; capacity is how much they
  // can draw between them.
  //
  // DISTRIBUTION takes one HV feeder and hands out branch circuits. It adds NO
  // capacity — the same rule the distribution buses already follow — so no
  // arrangement of panels increases what the facility can draw. What a panel
  // buys is OUTLETS and REACH: a cable is point to point (powerCable.fansOut =
  // false), so a 4-way panel feeds four machines and the fifth needs another
  // panel, somewhere near what it serves.
  //
  // A distribution device's hv_in draws its connected downstream load, capped
  // by its rating. Buying a larger panel adds outlets and headroom; it does not
  // consume unused electrical capacity.
  gridServicePoint:         supplyPorts(3000, 2),
  gridServicePointHighCapacity: supplyPorts(6000, 4),
  padMountTransformer:      transformerPorts(150, 1),
  facilityTransformer:      transformerPorts(400, 2),
  hvTransformer:            transformerPorts(1500, 4),
  gridIntertieTransformer:  transformerPorts(6000, 6),
  compactHvDistributor:     hvDistributionPorts(600, 2),
  // Logical sides keep coarse routing endpoints independently approachable;
  // presentation anchors land the cable tails on visible front terminals.
  powerPanel: distributionPorts(40, 4, {
    outletSide: 'front', branchCapacity: 10, trunkTap: true,
  }),
  sectionDistributionPanel: distributionPorts(600, 6, {
    outletSide: 'front', branchCapacity: 50, hvCount: 1, trunkTap: true,
  }),
  mainDistributionPanel: distributionPorts(1200, 12, {
    outletSide: 'front', branchCapacity: 50, hvCount: 2, trunkTap: true,
  }),
  poleMountTransformer: distributionPorts(100, 4, { outletSide: 'front' }),
  mcc:                 distributionPorts(250, 8, { outletSide: 'front' }),
  // Two outlets: the UPS's identity is that only the critical circuits go on
  // it. Make it wide and it becomes a strictly better panel.
  ups:                 distributionPorts(100, 2, { outletSide: 'front' }),
  backupGenerator: {
    pwr_out: {
      utility: 'powerCable', side: 'front', offsetAlong: 0.5,
      role: 'source', connectionKind: 'powerAlternateSourceOut',
      params: { capacity: 250 },
    },
  },
  // rf (capacity kW = raw params.power)
  magnetron:           { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 5, dutyFactor: 0.01 } } },
  widebandDriverAmp:   { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 5, dutyFactor: 1.0 } } },
  // A single clean 10 kW output: enough for the first VHF buncher/pillbox
  // network, while the 35 kW rack below earns its four independently flanged
  // outputs when a real front end begins to fan out.
  lowBandBuncherAmp:   { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 10, dutyFactor: 1.0 } } },
  // Four independently flanged 8.75 kW outputs. They are one 35 kW combiner
  // internally (discovery unites same-device source ports), but keeping each
  // client on its own port avoids an unnecessary tee and its VSWR penalty.
  solidStateAmp:       {
    rf_out_1: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.20, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
    rf_out_2: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.40, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
    rf_out_3: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.60, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
    rf_out_4: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.80, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
  },
  twt:                 { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 20, dutyFactor: 0.05 } } },
  // The beginner rung into pulsed peak power. At $10,000/kW it matches the
  // magnetron and undercuts the Pulsed Klystron's $30,000/kW threefold, but it
  // is worse per tile (4.2 vs 6.25 kW) and covers S-band alone, so it never
  // makes the bigger tube redundant.
  slac5045Klystron:    { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 25, dutyFactor: 0.001 } } },
  pulsedKlystron:      { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 50, dutyFactor: 0.001 } } },
  cwKlystron:          { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 50, dutyFactor: 1.0 } } },
  iot:                 { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 80, dutyFactor: 1.0 } } },
  multibeamKlystron:   { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 200, dutyFactor: 0.005 } } },
  highPowerSSA:        { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 300, dutyFactor: 1.0 } } },
  gyrotron:            { rf_out:   { utility: 'rfWaveguide', ...SINGLE_RF_OUTPUT, role: 'source', params: { capacity: 1000, dutyFactor: 1.0 } } },
  // Legacy compact plant retains its flexible-water header for compatibility.
  // Central plant uses separate hot and cold circuits connected by rigid
  // supply pipe, with flexible water lines reserved for local equipment runs.
  // The compact 5/25 kW packages buy an affordable start; the 175/300 kW
  // central chillers buy scale but need separate storage and heat rejection.
  // Water inventory is two independent capabilities. The make-up tank has a
  // small float-valve feed plus storage, the replenishment plant has a larger
  // feed and no storage, and the bulk tanks have storage but never generate water.
  // Explicit process capacity:0 keeps every one out of the cooling ladder.
  waterTank:             waterInventoryPorts(COOLING_WATER_INVENTORY.waterTank),
  facilityWaterSupply:   waterInventoryPorts(COOLING_WATER_INVENTORY.facilityWaterSupply),
  bulkWaterTank:         waterInventoryPorts(COOLING_WATER_INVENTORY.bulkWaterTank),
  // These authored faces follow the visible pipe pairs on each model.
  fanCoilCooler:         heatRejectorPorts(50, 'back'),
  dryCoolerBank:         heatRejectorPorts(500, 'back'),
  coolingTower:          heatRejectorPorts(800, 'right'),
  // Keep all three historical package-chiller names so existing lines remain
  // attached after loading. The former front outlet now joins the two-port
  // secondary header opposite the four primary branches.
  packageChiller:        coolingPlantPorts(
    {
      capacity: 5, heatRejectionCapacity: 5,
      ...COOLING_WATER_INVENTORY.packageChiller,
      displayLabel: 'Cooling capacity',
    },
    [
      'cool_out_a', 'cool_out_b', 'cool_out_c', 'cool_out_d',
      'cool_out_side', 'cool_out_side_2',
    ],
    { secondaryClass: COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED },
  ),
  // Preserve the legacy `cool_out` and three previously added branch names;
  // discovery unites all same-device sources into one internal header.
  lcwSkid:               coolingPlantPorts({
    capacity: 25, heatRejectionCapacity: 25,
    ...COOLING_WATER_INVENTORY.lcwSkid,
  }, undefined, {
    secondaryClass: COOLING_AUTO_CONNECT_CLASS.DISTRIBUTION_FEED,
  }),
  dualCircuitChiller:    centralChillerPorts(175),
  chiller:               centralChillerPorts(300),
  // cryo — storage, refrigeration, warm-end heat rejection and recovery are
  // separate network capabilities, mirroring cooling water's tank/chiller/
  // rejector model. Every buildable cryogenic plant item has a real bayonet;
  // merely placing it elsewhere in the facility contributes nothing.
  ln2Dewar: {
    cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 0, ln2Reservoir: true } },
  },
  cryocooler: {
    cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source',
      params: {
        coldCapacityW: 90, heatRejectionCapacityW: 90,
        storageCapacityL: 50, sealedInventory: true, designTempK: 4.5,
      } },
  },
  ln2Precooler: {
    cryo_out: { utility: 'cryoTransfer', side: 'front', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 0, preCoolingFraction: 0.15 } },
  },
  heCompressor: {
    cryo_out: { utility: 'cryoTransfer', side: 'front', offsetAlong: 0.75, role: 'source',
      params: { coldCapacityW: 0, heatRejectionCapacityW: 800 } },
  },
  coldBox4K: {
    cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 500, designTempK: 4.5 } },
  },
  coldBox2K: {
    cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 800, designTempK: 2.0 } },
  },
  cryomoduleHousing: {
    cryo_out: { utility: 'cryoTransfer', side: 'front', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 0, staticHeatReductionFraction: 0.05 } },
  },
  heRecovery: {
    cryo_out: { utility: 'cryoTransfer', side: 'front', offsetAlong: 0.6, role: 'source',
      params: { coldCapacityW: 0, storageCapacityL: 2000, recoveryStorage: true } },
  },
  heRecoveryHeader: {
    cryo_out: { utility: 'cryoTransfer', side: 'front', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 0, recoveryContribution: 0.25 } },
  },
  heGasBag: {
    cryo_out: { utility: 'cryoTransfer', side: 'back', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 0, recoveryContribution: 0.15 } },
  },
  hePurifier: {
    cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source',
      params: { coldCapacityW: 0, recoveryContribution: 0.20 } },
  },
  heLiquefier: {
    cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.75, role: 'source',
      params: { coldCapacityW: 0, recoveryContribution: 0.30, liquefactionRateLPerTick: 1 } },
  },
  // vacuum
  roughingPump:        { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 15, roughingSpeed: 15, vacuumStage: 'rough', ultimatePressure: 1e-3 } } },
  roughingPumpCart:    { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 60, roughingSpeed: 60, vacuumStage: 'rough', ultimatePressure: 1e-3 } } },
  turboPump:           { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 300, highVacSpeed: 300, backingDemand: 15, vacuumStage: 'high', ultimatePressure: 1e-8 } } },
  turboPumpCart:       { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 1200, highVacSpeed: 1200, backingDemand: 60, vacuumStage: 'high', ultimatePressure: 1e-8 } } },
  vacuumCart:          { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 330, roughingSpeed: 30, highVacSpeed: 300, integratedBacking: true, vacuumStage: 'integrated', ultimatePressure: 1e-8 } } },
  highCapacityVacuumStation: { vac_out: { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 3000, roughingSpeed: 150, highVacSpeed: 3000, integratedBacking: true, vacuumStage: 'integrated', ultimatePressure: 1e-8 } } },
  ionPump:             { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 600, uhvSpeed: 600, vacuumStage: 'uhv', requiresHighVac: true, ultimatePressure: 1e-11 } } },
  negPump:             { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 500, uhvSpeed: 500, vacuumStage: 'uhv', requiresHighVac: true, ultimatePressure: 1e-11 } } },
  tiSubPump:           { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 400, uhvSpeed: 400, vacuumStage: 'uhv', requiresHighVac: true, ultimatePressure: 1e-11 } } },
  // Bakeout adds no pumping speed — it heats the pipe walls so adsorbed gas
  // desorbs and gets pumped away once, after which the surface outgasses ~100x
  // less (vacuumPipe.js BAKEOUT_FACTOR). It still needs a vacuum PORT: the
  // solver decides a network is baked by looking for this component among the
  // network's members, and a component with no vacuumPipe port can never BE a
  // member. Declared `source` rather than `sink` deliberately — a sink would
  // put it under HARD_REQUIRED_UTILS, so an unwired bakeout rig would trip the
  // beam, and an optional upgrade must never do that.
  bakeoutSystem:       { vac_out:  { utility: 'vacuumPipe', side: 'right', offsetAlong: 0.5, role: 'source', params: { pumpSpeed: 0 } } },
  // data
  rackIoc:             { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  timingSystem:        { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  networkSwitch:       networkSwitchPorts(),
  archiver:            { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  bpmElectronics:      { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  blmReadout:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  llrfController:      { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  patchPanel:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'pass', params: {} } },
  // Control-room and diagnostics capture gateways terminate experimental
  // fiber. Their touching storage, compute, display and console cabinets join
  // the same physical backbone through the data adjacency bridge.
  monitorBank:         controlElectronicsPorts({ powerDemand: 0.8 }),
  dataAppliance:       controlElectronicsPorts({ powerDemand: 1.2, dataPeer: true, rearSide: 'back' }),
  serverRack:          controlElectronicsPorts({ powerDemand: 3, dataPeer: true }),
  dataStorageRack:     controlElectronicsPorts({ powerDemand: 4, rearSide: 'back' }),
  cpuComputeRack:      controlElectronicsPorts({ powerDemand: 9, rearSide: 'back' }),
  gpuComputeRack:      controlElectronicsPorts({ powerDemand: 16, rearSide: 'back' }),
  operatorConsole:     controlElectronicsPorts({ powerDemand: 0.5 }),
  alarmPanel:          controlElectronicsPorts({ powerDemand: 0.1 }),
  daqRack:             controlElectronicsPorts({ powerDemand: 1.5, dataPeer: true }),
  serverCluster:       controlElectronicsPorts({ powerDemand: 5, dataPeer: true, rearSide: 'back' }),
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
  // Large, dedicated loads land directly on the facility HV service. Most are
  // terminal loads; selected cabinet/plant roof bushings specialize this shape
  // below so the same physical terminal can continue one feeder segment.
  hvCable:      { name: 'hv_in',   side: 'left',  offsetAlong: 0.3, param: 'demand', connectionKind: 'hvLoadIn' },
  powerCable:   { name: 'pwr_in',  side: 'left',  offsetAlong: 0.3, param: 'demand' },
  coolingWater: { name: 'cool_in', side: 'front', offsetAlong: 0.5, param: 'heatLoad' },
  dataFiber:    { name: 'data_in', side: 'back',  offsetAlong: 0.5, param: 'demand' },
};

// A load tap is still a sink and retains its ordinary demand. It differs only
// in connection geometry: one arriving plus one continuing HV cable may claim
// the same omnidirectional insulated terminal.
const HV_LOAD_TAP_SHAPE = Object.freeze({
  connectionKind: 'hvLoadTap',
  omnidirectional: true,
  maxConnections: 2,
});

const INFRA_SINK_SHAPE_OVERRIDES = Object.fromEntries(
  HV_LOAD_TAP_IDS.map(id => [id, { hvCable: {
    ...HV_LOAD_TAP_SHAPE,
    // Preserve the SSA's historical simulation-side datum. Its exact roof
    // terminal position is presentation-only in utility-port-anchors.js.
    ...(id === 'solidStateAmp' ? { side: 'right', offsetAlong: 0.80 } : {}),
  } }]),
);

// Loads not implied by energyCost. beamDump absorbs beam power, not wall
// power; heCompressor dumps its compression heat into the water loop.
// Small control devices use a 1 Gbps management load; high-rate endpoints
// declare their acquisition stream explicitly above.
const INFRA_SINK_LOAD_OVERRIDES = {
  beamDump:     { coolingWater: 50 },
  heCompressor: { coolingWater: 20 },
};

function buildInfraSinkPorts() {
  const out = {};
  for (const [id, def] of Object.entries(INFRASTRUCTURE_RAW)) {
    const required = Array.isArray(def.requiredConnections) ? def.requiredConnections : [];
    for (const utility of required) {
      const baseShape = INFRA_SINK_SHAPE[utility];
      if (!baseShape) continue;
      const shape = {
        ...baseShape,
        ...((INFRA_SINK_SHAPE_OVERRIDES[id] || {})[utility] || {}),
      };
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
        ...(shape.connectionKind ? { connectionKind: shape.connectionKind } : {}),
        ...(shape.omnidirectional ? { omnidirectional: true } : {}),
        ...(Number.isInteger(shape.maxConnections)
          ? { maxConnections: shape.maxConnections } : {}),
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
 * RF ports are the asymmetric case. A SINK gets `frequency` from the raw
 * component's `rfFrequency` (MHz → Hz), falling back to L-band 1.3 GHz, plus
 * the `band` that frequency lands in. A SOURCE gets `bands` from the raw
 * `rfBands` array and no frequency at all — a tube is built for a band, and
 * the solver matches on band membership. Declared params always win.
 */
export function getUtilityPortsV2(id) {
  const src = BEAMLINE_UTILITY_PORTS[id] || INFRA_UTILITY_PORTS[id];
  if (!src) return {};
  const out = {};
  for (const [name, spec] of Object.entries(src)) {
    // A 'pass' port carries no load of its own — it must not inherit the sink
    // demand default, or a distribution bus would bill itself for the traffic
    // flowing through it.
    const table = spec.role === 'pass'
      ? {}
      : (spec.role === 'source' ? SOURCE_DEFAULTS : SINK_DEFAULTS);
    const params = { ...(table[spec.utility] || {}), ...(spec.params || {}) };
    if (spec.utility === 'rfWaveguide' && spec.role === 'source') {
      // Bands, not a frequency: a source that declares no coverage at all
      // would silently power nothing, so the empty array is left visible
      // rather than papered over with a default.
      if (params.bands === undefined) params.bands = rawRfBands(id) || [];
    } else if (spec.utility === 'rfWaveguide' && spec.role !== 'pass') {
      if (params.frequency === undefined) {
        const rawFreq = rawRfFrequency(id);
        params.frequency = (typeof rawFreq === 'number' && rawFreq > 0)
          ? rawFreq * 1e6 // MHz → Hz
          : DEFAULT_RF_FREQ_HZ;
      }
      // A frequency outside every band would leave the sink unservable by any
      // source; the DEFAULT_RF_FREQ_HZ fallback above keeps that from happening
      // for missing data, and this catches a declared-but-absurd frequency.
      if (params.band === undefined) {
        params.band = bandForFrequencyHz(params.frequency);
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
