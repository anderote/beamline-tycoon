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
import { bandForFrequencyHz } from './rf-bands.js';

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
  dcPhotoGun: {
    pwr_in:  { utility: 'powerCable', side: 'left',  offsetAlong: 0.25, role: 'sink', params: { demand: 35 } },
    data_in: { utility: 'dataFiber',  side: 'right', offsetAlong: 0.75, role: 'sink', params: { demand: 3 } },
  },
  ncRfGun: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 70 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.35, role: 'sink', params: { heatLoad: 70 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.65, role: 'sink', params: { demand: 12 } },
    data_in: { utility: 'dataFiber',    side: 'left',  offsetAlong: 0.8, role: 'sink', params: { demand: 4 } },
  },
  srfGun: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 110 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 60 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 40 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 6 } },
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
  // end up in the loop. One padMountTransformer (150 kW) is exactly enough
  // and one lcwSkid (25 kW) is exactly not.
  cyclotron30: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 140 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 115 } },
  },
  // Same physics, four times the machine: past a single switchgear feed and
  // past a single cooling tower, so it forces distribution planning.
  cyclotron70: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 380 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 310 } },
  },
  // RFQ + low-beta SRF front end delivered as one commissioned tunnel sector.
  // Unlike a cyclotron it exposes both RF and cryogenic plant to the player.
  protonLinacFrontEnd: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.15, role: 'sink', params: { demand: 600 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 420 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 400 } },
  },
  // NO rf_in and NO cryo_in — the absence is the design. A plasma stage has
  // no cavity to drive and nothing to keep at 2 K. What it has instead is a
  // titanium-sapphire chain at a few tenths of a percent wall-plug
  // efficiency, so a kilowatt of laser costs hundreds of kilowatts of
  // electricity and gives essentially all of it back as heat. The fibre is
  // the femtosecond timing link to petawattLaser: laser-to-plasma jitter is
  // what sets the energy jitter of every bunch this thing makes.
  lwfaStation: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 420 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 800 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'right', offsetAlong: 0.3, role: 'sink', params: { demand: 70 } },
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
    rf_in:  { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 2 } },
  },
  rfq: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 6 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 60 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 25 } },
  },
  pillboxCavity: {
    pwr_in: { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 3 } },
    rf_in:  { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.7, role: 'sink', params: { demand: 5 } },
  },
  // Copper structures guzzle RF and dump most of it into the water loop.
  rfCavity: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 20 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 120 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 40 } },
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
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 110 } },
  },
  xbandStructure: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 90 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 480 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 240 } },
  },
  // Five CLIC modules' worth of hardware, but the waveguide demand is the ONE
  // number that does not scale with the energy: the drive beam carries the
  // power to the main line, so what comes down the guide is the drive-beam
  // injector's share. The wall power and the water are where the real cost of
  // 6 GeV lands.
  twoBeamModule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 120 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 780 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 400 } },
  },
  // NO rf_in and NO cryo_in, exactly like lwfaStation — the absence is the
  // design. There is no cavity to drive and nothing to hold at 2 K. What
  // there is instead is a titanium-sapphire chain at a few tenths of a
  // percent wall-plug efficiency, which gives essentially all of that power
  // straight back as heat, plus the femtosecond timing fibre that keeps the
  // laser and the bunch in step.
  plasmaAfterburner: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 1400 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 2400 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 2300 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 60 } },
  },
  // A third of an S-band structure's length, so roughly a third of its loads.
  // It is a self-contained industrial skid, which is why the water demand is
  // proportionally the heaviest part: this thing runs all shift.
  industrialLinac: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 8 } },
    cool_in: { utility: 'coolingWater', side: 'right', offsetAlong: 0.5, role: 'sink', params: { heatLoad: 45 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 20 } },
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
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 40 } },
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
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 100 } },
  },
  // Six modules, but at 4.5 K rather than 2 K — which is the entire point of
  // Nb3Sn. Twice the modules of the CW sector for less than the cold, because
  // 4.5 K helium is roughly three times cheaper per watt than superfluid.
  nbSnCryomodule: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 20 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 700 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 200 } },
  },
  // Seventeen cryomodules on one string. The cryo number is the reason a
  // sector is a sector: no single coldBox2K (800 W) covers it, so a collider
  // arm is a cryoplant-planning problem before it is anything else.
  srfLinacSector: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 45 } },
    cryo_in: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'sink', params: { srfHeatW: 4200 } },
    rf_in:   { utility: 'rfWaveguide',  side: 'right', offsetAlong: 0.8, role: 'sink', params: { demand: 600 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 180 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 120 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 5 } },
  },
  spallationNeutronTarget: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 450 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 1000 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 12 } },
  },
  photonScienceHutch: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 90 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 60 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 10 } },
  },
  xfelEndstation: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 220 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.55, role: 'sink', params: { heatLoad: 180 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5, role: 'sink', params: { demand: 25 } },
  },
  euvCollector: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.2, role: 'sink', params: { demand: 600 } },
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
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.25, role: 'sink', params: { demand: 600 } },
    cool_in: { utility: 'coolingWater', side: 'left',  offsetAlong: 0.65, role: 'sink', params: { heatLoad: 900 } },
    data_in: { utility: 'dataFiber',    side: 'right', offsetAlong: 0.5,  role: 'sink', params: { demand: 300 } },
  },
  // The heaviest data sink in the game and by a wide margin, which is the
  // whole identity: it earns nothing, it measures a spectrum, and the fibre is
  // the product. Power and water are a hermetic calorimeter's front-end
  // electronics — large, but nothing next to the readout.
  hawkingDetector: {
    pwr_in:  { utility: 'powerCable',   side: 'left',  offsetAlong: 0.15, role: 'sink', params: { demand: 380 } },
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
  penningIonSource: 1e-6, ionSource: 1e-6, pillboxCavity: 1e-6, spokeCavity: 1e-6,
  ellipticalSrfCavity: 1e-6, rfq: 1e-6, target: 1e-6, industrialLinac: 1e-6,
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
//                   1200 → gridIntertieTransformer 3000. Those are the ONLY
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
//   data    (Gbps): patchPanel 2 → timing 5 → rackIoc 10 → archiver 20
//                   → networkSwitch 40
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

function busPorts(utility, serviceRadius) {
  const out = {};
  for (const [name, side] of Object.entries(BUS_PORT_SIDES)) {
    out[name] = {
      utility, side, offsetAlong: 0.5, role: 'pass',
      bus: true, params: { serviceRadius },
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

/**
 * HV distribution: one protected incoming feeder feeds `count` protected
 * outgoing feeders. It is deliberately split into separate HV networks: the
 * input is a sink, the outputs are sources gated by that input's hvQuality.
 * This keeps the electrical graph radial while letting one HV distributor
 * feed several downstream panels or dedicated HV loads.
 */
function hvDistributionPorts(rating, count) {
  const out = {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'sink', connectionKind: 'hvDistributionIn', params: { demand: rating },
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
 * A distribution device: one HV inlet drawing `rating` kW, and `count` branch
 * outlets. The outlets declare the rating as their capacity, but the panel is
 * transparent to the facility's power budget — the SUPPLY still has to cover
 * every panel it feeds, because each panel's hv_in demands its full rating.
 */
function distributionPorts(rating, count, { outletSide = null } = {}) {
  const out = {
    hv_in: {
      utility: 'hvCable', side: 'back', offsetAlong: 0.5,
      role: 'sink', connectionKind: 'hvDistributionIn', params: { demand: rating },
    },
  };
  for (let i = 0; i < count; i++) {
    out[`pwr_out_${i + 1}`] = {
      utility: 'powerCable',
      side: outletSide || OUTLET_SIDES[i % OUTLET_SIDES.length],
      // A face-mounted panel presents its sockets as one evenly spaced row.
      // Other distribution equipment keeps spreading outlets around its
      // footprint, including the second row used by 8-way cabinets.
      offsetAlong: outletSide
        ? (i + 1) / (count + 1)
        : 0.25 + 0.5 * (Math.floor(i / OUTLET_SIDES.length) % 2),
      role: 'source',
      connectionKind: 'powerDistributionOut',
      // rating/N per outlet: discovery unites a device's outlets into one
      // busbar, so these add back up to exactly the panel's rating no matter
      // how many of them are in use. Declaring the full rating on each would
      // make a 4-way panel four full-rating supplies.
      params: { capacity: rating / count },
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

// Cooling plant uses a consistent, mirrorable header layout. Process-water
// suppliers and reservoirs expose four branches on the primary (+X/right)
// header and two on the opposite header. Heat rejectors only need their
// physical supply/return pair, kept together on one authored face.
//
// All sockets on one source are internally united by network discovery, so a
// numeric nameplate must be divided across them. The parts add back to the
// same plant rating; adding routing choices never mints cooling capacity.
const COOLING_PRIMARY_OFFSETS = [0.14, 0.38, 0.62, 0.86];
const COOLING_SECONDARY_OFFSETS = [0.33, 0.67];

function coolingPlantPorts(params, names = [
  'cool_out', 'cool_out_2', 'cool_out_3',
  'cool_out_4', 'cool_out_5', 'cool_out_6',
]) {
  const out = {};
  const splitParams = { ...params };
  for (const key of ['capacity', 'heatRejectionCapacity']) {
    if (typeof splitParams[key] === 'number') splitParams[key] /= names.length;
  }
  names.forEach((name, i) => {
    const primary = i < COOLING_PRIMARY_OFFSETS.length;
    out[name] = {
      utility: 'coolingWater',
      side: primary ? 'right' : 'left',
      offsetAlong: primary
        ? COOLING_PRIMARY_OFFSETS[i]
        : COOLING_SECONDARY_OFFSETS[i - COOLING_PRIMARY_OFFSETS.length],
      role: 'source',
      params: { ...splitParams },
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
    cool_out: {
      utility: 'coolingWater', side, offsetAlong: 0.33,
      role: 'source', params: { ...params },
    },
    cool_out_2: {
      utility: 'coolingWater', side, offsetAlong: 0.67,
      role: 'source', params: { ...params },
    },
  };
}

const INFRA_UTILITY_PORTS = {
  // Field distribution is deliberately physical: a finite set of real
  // sockets, not a service-radius shortcut, and it cannot bridge another
  // field distributor. A busway keeps a designated feeder end; a portable
  // spider box has four equivalent sockets, so whichever one the panel reaches
  // becomes the feed and the remaining three can serve loads.
  powerBus:            buswayPorts(160, 10),
  spiderBox:           fieldDistributionPorts(3, { capacity: 30, interchangeable: true }),
  coolingManifold:     busPorts('coolingWater',  8),
  vacuumManifold:      busPorts('vacuumPipe',    5),
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
  // A distribution device's hv_in demand is its own rating, not its live draw:
  // you size the feeder for the panel. That keeps the HV solve local and makes
  // an oversized panel cost something instead of being a free upgrade.
  padMountTransformer:      supplyPorts(150, 1),
  facilityTransformer:      supplyPorts(400, 2),
  hvTransformer:            supplyPorts(1200, 4),
  gridIntertieTransformer:  supplyPorts(3000, 6),
  // UI name: HV Distributor Box. The stable id remains `switchgear` so older
  // saves retain the same placed object and utility-line endpoint ids.
  switchgear:               hvDistributionPorts(400, 4),
  // This cabinet is only 0.5 m wide, so four outlets on its front collapse
  // into two routing cells. Spread the logical connectors around the cabinet
  // so every branch remains independently wireable.
  // Face-mounted circuit breakers and sockets all live on the front face.
  // `offsetAlong` gives every visible fitting an independent, evenly-spaced
  // anchor, so a cable leaves the socket it appears to be plugged into.
  powerPanel:          distributionPorts(40, 4, { outletSide: 'front' }),
  sectionDistributionPanel: distributionPorts(150, 6, { outletSide: 'front' }),
  mainDistributionPanel: distributionPorts(400, 8, { outletSide: 'front' }),
  mcc:                 distributionPorts(250, 8, { outletSide: 'front' }),
  // Two outlets: the UPS's identity is that only the critical circuits go on
  // it. Make it wide and it becomes a strictly better panel.
  ups:                 distributionPorts(100, 2, { outletSide: 'front' }),
  // rf (capacity kW = raw params.power)
  magnetron:           { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 5, dutyFactor: 0.01 } } },
  widebandDriverAmp:   { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 5, dutyFactor: 1.0 } } },
  // A single clean 10 kW output: enough for the first VHF buncher/pillbox
  // network, while the 35 kW rack below earns its four independently flanged
  // outputs when a real front end begins to fan out.
  lowBandBuncherAmp:   { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 10, dutyFactor: 1.0 } } },
  // Four independently flanged 8.75 kW outputs. They are one 35 kW combiner
  // internally (discovery unites same-device source ports), but keeping each
  // client on its own port avoids an unnecessary tee and its VSWR penalty.
  solidStateAmp:       {
    rf_out_1: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.20, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
    rf_out_2: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.40, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
    rf_out_3: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.60, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
    rf_out_4: { utility: 'rfWaveguide', side: 'left', offsetAlong: 0.80, role: 'source', params: { capacity: 35 / 4, dutyFactor: 1.0 } },
  },
  twt:                 { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 20, dutyFactor: 0.05 } } },
  // The beginner rung into pulsed peak power. At $10,000/kW it matches the
  // magnetron and undercuts the Pulsed Klystron's $30,000/kW threefold, but it
  // is worse per tile (4.2 vs 6.25 kW) and covers S-band alone, so it never
  // makes the bigger tube redundant.
  slac5045Klystron:    { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 25, dutyFactor: 0.001 } } },
  pulsedKlystron:      { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 50, dutyFactor: 0.001 } } },
  cwKlystron:          { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 50, dutyFactor: 1.0 } } },
  iot:                 { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 80, dutyFactor: 1.0 } } },
  multibeamKlystron:   { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 200, dutyFactor: 0.005 } } },
  highPowerSSA:        { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 300, dutyFactor: 1.0 } } },
  gyrotron:            { rf_out:   { utility: 'rfWaveguide', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 1000, dutyFactor: 1.0 } } },
  // One cooling-water network carries plant and process water. A working loop
  // contains a reservoir, chiller, and heat rejector; compact units carry all
  // three roles on their shared six-connection header.
  // $/kW falls monotonically up the ladder (7000 → 6500 → 6000 → 5143 → 4000
  // → 3100 → 2500), so a bigger plant is always the better deal once you can
  // afford one. The 175 and 500 kW rungs exist so growing past a skid or a
  // chiller does not mean buying 3x the capacity you actually need.
  // A reservoir stores water but does not chill it. Explicit zero prevents the
  // generic source fallback from turning the tank into a phantom chiller.
  waterTank:             coolingPlantPorts({
    reservoir: true, capacity: 0,
  }),
  // These authored faces follow the visible pipe pairs on each model.
  fanCoilCooler:         heatRejectorPorts(50, 'back'),
  dryCoolerBank:         heatRejectorPorts(500, 'back'),
  coolingTower:          heatRejectorPorts(800, 'right'),
  // Keep all three historical package-chiller names so existing lines remain
  // attached after loading. The former front outlet now joins the two-port
  // secondary header opposite the four primary branches.
  packageChiller:        coolingPlantPorts(
    {
      reservoir: true, capacity: 5, heatRejectionCapacity: 5,
      displayLabel: 'Cooling capacity',
    },
    [
      'cool_out_a', 'cool_out_b', 'cool_out_c', 'cool_out_d',
      'cool_out_side', 'cool_out_side_2',
    ],
  ),
  // Preserve the legacy `cool_out` and three previously added branch names;
  // discovery unites all same-device sources into one internal header.
  lcwSkid:               coolingPlantPorts({
    reservoir: true, capacity: 25, heatRejectionCapacity: 25,
  }),
  dualCircuitChiller:    coolingPlantPorts({ capacity: 175 }),
  chiller:               coolingPlantPorts({ capacity: 300 }),
  // cryo
  coldBox4K:           { cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source', params: { coldCapacityW: 500 } } },
  coldBox2K:           { cryo_out: { utility: 'cryoTransfer', side: 'right', offsetAlong: 0.5, role: 'source', params: { coldCapacityW: 800 } } },
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
  rackIoc:             { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 10 } } },
  timingSystem:        { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 5 } } },
  networkSwitch:       { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 40 } } },
  archiver:            { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 20 } } },
  bpmElectronics:      { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 8 } } },
  blmReadout:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 8 } } },
  llrfController:      { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 4 } } },
  patchPanel:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 2 } } },
  // Control-room and diagnostics capture gateways terminate experimental
  // fiber. Storage and compute racks sit behind that gateway on the room's
  // internal fabric, so they deliberately expose no facility-fiber source:
  // wiring a detector straight to a disk shelf must not create a DAQ path.
  dataAppliance:       { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 4 } } },
  serverRack:          { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 8 } } },
  daqRack:             { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 40 } } },
  serverCluster:       { data_out: { utility: 'dataFiber', side: 'right', offsetAlong: 0.5, role: 'source', params: { capacity: 12 } } },
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
  // Large, dedicated loads land directly on the facility HV service. They
  // remain terminal loads: only distribution gear exposes an HV output.
  hvCable:      { name: 'hv_in',   side: 'left',  offsetAlong: 0.3, param: 'demand', connectionKind: 'hvLoadIn' },
  powerCable:   { name: 'pwr_in',  side: 'left',  offsetAlong: 0.3, param: 'demand' },
  coolingWater: { name: 'cool_in', side: 'front', offsetAlong: 0.5, param: 'heatLoad' },
  dataFiber:    { name: 'data_in', side: 'back',  offsetAlong: 0.5, param: 'demand' },
};

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
        ...(shape.connectionKind ? { connectionKind: shape.connectionKind } : {}),
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
