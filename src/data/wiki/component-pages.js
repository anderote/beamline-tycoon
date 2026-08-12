// src/data/wiki/component-pages.js
//
// One wiki page per placeable, generated from the live registries. Nothing in
// here is transcribed: costs, footprints and catalogue stats come from
// COMPONENTS, sink/source loads from getUtilityPortsV2, tunable ranges from
// PARAM_DEFS, unlocks from RESEARCH_NODES, and the cavity numbers from the
// functions the beam solve itself calls. Rename a component or retune a port
// and its page follows on the next reload.
//
// Pages are built on demand and memoised — 140 components x a dozen prose
// strings is not work worth doing at module load for a screen the player may
// never open.

import { COMPONENTS } from '../components.js';
import {
  getUtilityPortsV2, outgassingForLength, pipeSurfaceAreaCm2,
  Q_SPECIFIC_BAKED, Q_SPECIFIC_UNBAKED,
} from '../utility-ports-v2.js';
import { UNITS } from '../units.js';
import { RESEARCH } from '../research.js';
import { PARAM_DEFS } from '../../beamline/component-physics.js';
import { CAVITY_SPECS, pDiss, eAccMax } from '../../beamline/cavity-specs.js';
import { capacityAt, T_SUPERFLUID, T_NORMAL } from '../../utility/types/cryoTransfer.js';
import { MAX_DELTA_T } from '../../utility/types/coolingWater.js';
import { cavityPerformance, maxDemandableGradient } from './cavity-performance.js';
import {
  UTILITY_META, utilityInfo, utilityRow, ladderPosition, UTILITY_LADDERS,
} from './utility-model.js';
import { relatedArticlesFor } from './links.js';

const SUB_UNIT_M = 0.5;

const round = (n, d = 2) => (isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n);

function sig(n, digits = 3) {
  if (!isFinite(n) || n === 0) return n;
  const mag = Math.floor(Math.log10(Math.abs(n)));
  return Math.round(n * 10 ** (digits - 1 - mag)) / 10 ** (digits - 1 - mag);
}

function num(n, digits = 3) {
  if (!isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return sig(n, digits).toExponential(digits - 1);
  return String(sig(n, digits));
}

// ---------------------------------------------------------------------------
// Classification — the model treats these five families differently.
// ---------------------------------------------------------------------------

const MAGNET_PHYSICS = new Set([
  'quadrupole', 'dipole', 'sextupole', 'octupole', 'solenoid', 'septum', 'kicker',
]);

export function componentClass(id) {
  const comp = COMPONENTS[id];
  if (!comp) return 'other';
  const spec = CAVITY_SPECS[id];
  if (spec) return spec.kind === 'srf' ? 'srfCavity' : 'ncCavity';
  if (MAGNET_PHYSICS.has(comp.physicsType) || (comp.category === 'optics' && comp.stats?.focusStrength)) {
    return 'magnet';
  }
  if (comp.category === 'optics') return 'magnet';
  if (comp.category === 'diagnostic') return 'diagnostic';
  if (comp.category === 'source' && !comp.isDrawnConnection) return 'particleSource';
  return 'other';
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const RESEARCH_BY_UNLOCK = (() => {
  const map = {};
  for (const node of Object.values(RESEARCH)) {
    for (const id of node.unlocks || []) map[id] = node;
  }
  return map;
})();

function buildStats(id) {
  const c = COMPONENTS[id];
  const out = [];
  const push = (label, value, unit = '', note = '') => {
    if (value === undefined || value === null || value === '') return;
    out.push(note ? { label, value, unit, note } : { label, value, unit });
  };

  push('Cost', c.cost?.funding ?? 0, '$');
  if (c.energyCost) push('Electricity', c.energyCost, 'kW');

  if (c.subW && c.subL) {
    push('Footprint', `${c.subW} × ${c.subL}`, 'sub-units',
      `${round(c.subW * SUB_UNIT_M)} m × ${round(c.subL * SUB_UNIT_M)} m on the ground.`);
  }
  if (c.subL && c.kind === 'beamline') {
    push('Beamline length', round(c.subL * SUB_UNIT_M), 'm',
      'Physics length. Energy gain and every per-metre effect scale with it.');
  }
  if (c.interiorVolume) push('Interior volume', c.interiorVolume, 'L');
  if (c.rfFrequency !== undefined) {
    push('RF frequency', c.rfFrequency, typeof c.rfFrequency === 'number' ? 'MHz' : '',
      c.rfBand ? `${c.rfBand} band.` : '');
  }
  if (c.placement === 'attachment') {
    push('Placement', 'On beam pipe', '',
      'Attaches to a drawn beam-pipe run rather than standing on its own tile.');
  }

  for (const [k, v] of Object.entries(c.stats || {})) {
    push(label(k), typeof v === 'number' ? round(v, 4) : v, UNITS[k] || '');
  }
  for (const [k, v] of Object.entries(c.params || {})) {
    if (k === 'rfFrequency') continue; // already listed
    push(label(k), typeof v === 'number' ? round(v, 4) : v, UNITS[k] || '');
  }
  for (const [k, v] of Object.entries(c.effects || {})) {
    push(label(k), typeof v === 'number' ? round(v, 4) : v, UNITS[k] || '');
  }
  if (Array.isArray(c.zoneTypes) && c.zoneTypes.length) {
    push('Lab types', c.zoneTypes.map(label).join(', '), '',
      'Counts toward the output bonus of these lab zones.');
  }

  const unlock = RESEARCH_BY_UNLOCK[id];
  push('Unlocked by', unlock ? unlock.name : 'Available from the start', '',
    unlock ? `${unlock.category} research.` : '');

  // Tunables the player can actually turn, with their ranges.
  const defs = PARAM_DEFS[id];
  if (defs) {
    for (const [k, d] of Object.entries(defs)) {
      if (d.derived) continue;
      push(`${label(k)} (tunable)`, `${d.min} – ${d.max}`, d.unit || '',
        `Default ${d.default}${d.unit ? ` ${d.unit}` : ''}, step ${d.step}.`);
    }
  }
  return out;
}

/** camelCase → Title Case, without a lookup table nobody will maintain. */
function label(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, s => s.toUpperCase());
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function buildUtilities(id, klass) {
  const ports = Object.values(getUtilityPortsV2(id));
  const seen = new Map(); // one row per utility+role — a bus declares four identical pass ports
  for (const p of ports) {
    const key = `${p.utility}:${p.role}`;
    if (!seen.has(key)) seen.set(key, utilityRow(id, p.utility, p.role, p.params, klass));
  }
  return [...seen.values()].map(row => ({ ...row, article: UTILITY_META[row.utility]?.article }));
}

// ---------------------------------------------------------------------------
// Performance — non-cavity families
// ---------------------------------------------------------------------------

/** Vacuum quality the solver would report at a given pressure. */
function vacuumQuality(pressure) {
  if (!(pressure > 0)) return 1;
  if (pressure <= 1e-8) return 1;
  if (pressure >= 1e-4) return 0;
  return 1 - (Math.log10(pressure) + 8) / 4;
}

function magnetPerformance(id) {
  const defs = PARAM_DEFS[id] || {};
  const knob = defs.gradient || defs.fieldStrength;
  const unit = knob?.unit || '';
  const setting = knob?.default;
  const perf = [];

  if (setting !== undefined) {
    perf.push({
      label: 'Field at full power', value: setting, unit,
      note: `Range ${knob.min}–${knob.max} ${unit}. Coil field goes as supply `
        + 'current, which goes as supply power, so the derate is exactly linear.',
    });
    for (const q of [0.75, 0.5, 0.25]) {
      perf.push({
        label: `Field at ${q * 100}% power quality`, value: round(setting * q, 3), unit,
        note: `A network drawing ${round(1 / q, 2)}× its capacity serves every sink at `
          + `${q * 100}%. Focus strength follows straight down.`,
      });
    }
  }
  perf.push({
    label: 'Cooling response', value: 'Gate only', unit: '',
    note: 'A magnet with a cooling sink and no chiller capacity trips the beam. '
      + 'Between "some" and "enough" there is no graded penalty — coolingDegradation '
      + 'is computed in gameplay.py and no consumer reads it.',
  });

  const curves = setting === undefined ? [] : [{
    title: 'Field vs power quality',
    xLabel: 'Power network quality (capacity / demand)',
    yLabel: `Effective field (${unit})`,
    points: Array.from({ length: 11 }, (_, i) => [round(i / 10, 1), round(setting * i / 10, 3)]),
    note: 'Linear, unlike a cavity. Under-powering a magnet string costs focusing '
      + 'in direct proportion, which shows up as a growing beam envelope rather '
      + 'than a trip.',
  }];

  return { performance: perf, curves };
}

function vacuumSourcePerformance(id) {
  const port = Object.values(getUtilityPortsV2(id))
    .find(p => p.utility === 'vacuumPipe' && p.role === 'source');
  const S = port?.params.pumpSpeed || 0;
  const perf = [];
  const points = [];

  for (const metres of [10, 25, 50, 100, 200]) {
    const Q = outgassingForLength(metres / SUB_UNIT_M);
    const P = S > 0 ? Q / S : Infinity;
    const q = vacuumQuality(P);
    if ([25, 100].includes(metres)) {
      perf.push({
        label: `Pressure over ${metres} m of unbaked pipe`,
        value: num(P), unit: 'mbar',
        note: `P = Q / S with Q = ${num(Q)} mbar·L/s from ${metres} m of beam pipe `
          + `and S = ${S} L/s. Vacuum quality ${round(q, 2)}.`,
      });
    }
    points.push([metres, sig(S > 0 ? outgassingForLength(metres / SUB_UNIT_M) / S : 0, 3)]);
  }

  perf.push({
    label: 'Longest run held at quality 1.0', value: (() => {
      // Quality saturates at 1e-8 mbar; solve Q(L)/S = 1e-8 for L.
      const perMetre = outgassingForLength(1 / SUB_UNIT_M);
      return perMetre > 0 ? round((1e-8 * S) / perMetre, 1) : 0;
    })(), unit: 'm',
    note: 'Beyond this the pressure starts costing emittance. A bakeout system '
      + `drops specific outgassing from ${num(Q_SPECIFIC_UNBAKED)} to `
      + `${num(Q_SPECIFIC_BAKED)} mbar·L/(s·cm²) — a straight 100× on this number.`,
  });

  const curves = [{
    title: 'Pressure vs beamline length (this pump alone)',
    xLabel: 'Unbaked beam pipe (m)',
    yLabel: 'Pressure (mbar)',
    points,
    note: 'Gas load is surface area, so pressure rises linearly with length while '
      + 'pump speed stays put. Long machines need distributed pumping, not a '
      + 'bigger pump at one end.',
  }];
  return { performance: perf, curves };
}

/**
 * Beam pipe is drawn, not placed, so it carries no ports at all — the vacuum
 * solver reads state.beamPipes and charges its surface area directly. Without
 * this the page would claim a run of pipe costs nothing, which is exactly the
 * bug that let a player draw 500 m and add zero gas load.
 */
function beamPipePerformance() {
  const perMetre = outgassingForLength(1 / SUB_UNIT_M);
  const perf = [{
    label: 'Gas load per metre', value: num(perMetre), unit: 'mbar·L/s',
    note: `Q = q × A with A = ${Math.round(pipeSurfaceAreaCm2(1))} cm² of wall per metre `
      + `and q = ${num(Q_SPECIFIC_UNBAKED)} mbar·L/(s·cm²) unbaked. One metre of pipe `
      + 'outgasses about as much as a whole component used to.',
  }];

  for (const [pumpId, length] of [['roughingPump', 25], ['turboPump', 100]]) {
    const S = Object.values(getUtilityPortsV2(pumpId))
      .find(p => p.utility === 'vacuumPipe')?.params.pumpSpeed || 1;
    const P = (perMetre * length) / S;
    perf.push({
      label: `${length} m on one ${COMPONENTS[pumpId].name}`,
      value: num(P), unit: 'mbar',
      note: `Vacuum quality ${round(vacuumQuality(P), 2)}. Length is the whole story `
        + 'here: pump speed is fixed and gas load is not, so long machines need '
        + 'pumps distributed along them rather than one big pump at the end.',
    });
  }

  perf.push({
    label: 'Effect of a bakeout', value: '100×', unit: '',
    note: `Baking drops specific outgassing from ${num(Q_SPECIFIC_UNBAKED)} to `
      + `${num(Q_SPECIFIC_BAKED)} mbar·L/(s·cm²), which is two decades of pressure `
      + 'and turns a marginal long beamline into a clean one.',
  });

  const curves = [{
    title: 'Pressure vs run length',
    xLabel: 'Beam pipe (m)',
    yLabel: 'Pressure on one Turbo Pump (mbar)',
    points: [10, 25, 50, 100, 200, 400].map(L => [L, sig((perMetre * L) / 300, 3)]),
    note: 'Straight line: gas load is proportional to length, pump speed is not.',
  }];

  return { performance: perf, curves };
}

const REPRESENTATIVE_SINK = {
  powerCable: { id: 'quadrupole', param: 'demand' },
  coolingWater: { id: 'dipole', param: 'heatLoad' },
  dataFiber: { id: 'bpm', param: 'demand' },
};

function sourcePerformance(id, utility) {
  if (utility === 'vacuumPipe') return vacuumSourcePerformance(id);

  const port = Object.values(getUtilityPortsV2(id))
    .find(p => p.utility === utility && p.role === 'source');
  const cap = port?.params[UTILITY_META[utility].capacityParam] || 0;
  const info = utilityInfo(utility);
  const pos = ladderPosition(utility, id);
  const perf = [{
    label: 'Capacity', value: cap, unit: info.capacityUnit,
    note: pos ? `Rung ${pos.rung} of ${pos.rungs}: `
      + UTILITY_LADDERS[utility].map(r => `${r.name} ${r.capacity}`).join(' → ') : '',
  }];

  if (utility === 'rfWaveguide') return rfSourcePerformance(id, port, perf);

  if (utility === 'cryoTransfer') {
    const spec = CAVITY_SPECS.cryomodule;
    // The plant's own design temperature — a 2 K box run at 4.5 K delivers
    // MORE than its rating, which is the whole reason 4 K operation is cheap.
    const designT = COMPONENTS[id].params?.temperature ?? T_NORMAL;
    for (const t of [T_SUPERFLUID, T_NORMAL]) {
      const available = capacityAt(t, cap, designT);
      // Largest cryomodule gradient this plant can hold, ignoring static load.
      let hold = 0;
      for (let e = 0; e <= 40; e += 0.1) {
        if (pDiss(e, spec, t) * spec.n_cav > available) break;
        hold = e;
      }
      perf.push({
        label: `Cryomodule gradient it can hold at ${t.toFixed(1)} K`,
        value: round(hold, 1), unit: 'MV/m',
        note: `${round(available)} W of useful lift (rated ${cap} W at its own `
          + `${designT} K design point) against 8 cavities' wall losses. Push past `
          + 'this and the bath warms, Q₀ falls, dissipation climbs, and the run '
          + 'ends in a quench.',
      });
    }
    return { performance: perf, curves: [] };
  }

  const rep = REPRESENTATIVE_SINK[utility];
  if (rep && COMPONENTS[rep.id]) {
    const sinkPort = Object.values(getUtilityPortsV2(rep.id))
      .find(p => p.utility === utility && p.role === 'sink');
    const load = sinkPort?.params[rep.param] || 0;
    if (load > 0) {
      perf.push({
        label: `Equivalent ${COMPONENTS[rep.id].name}s`, value: Math.floor(cap / load), unit: '',
        note: `At ${load} ${info.loadUnit} each. Capacity is per network — two `
          + 'sources with no line between them are two separate budgets.',
      });
    }
  }
  if (utility === 'coolingWater') {
    perf.push({
      label: 'Loop ΔT when starved', value: MAX_DELTA_T, unit: 'K',
      note: 'Scaled by (1 − quality). Only normal-conducting cavities respond to '
        + 'it, by detuning off resonance and reflecting power.',
    });
  }
  return { performance: perf, curves: [] };
}

function rfSourcePerformance(id, port, perf) {
  const duty = port?.params.dutyFactor ?? 1;
  const cap = port?.params.capacity || 0;
  const peakW = (cap * 1000) / Math.max(duty, 1e-4);
  perf.push({
    label: 'Duty factor', value: round(duty * 100, 3), unit: '%',
    note: duty >= 1 ? 'Continuous wave. Average power is peak power.'
      : 'Pulsed. The solver divides average by duty to get peak, and peak is what '
        + 'sets gradient.',
  });
  perf.push({
    label: 'Peak power', value: round(peakW / 1e6, 3), unit: 'MW',
    note: 'What a cavity alone on this network receives. Several cavities in the '
      + 'same frequency bucket split it in proportion to their declared demand.',
  });

  const freq = port?.params.frequency;
  const broadband = port?.params.broadband === true;
  const drivable = Object.keys(CAVITY_SPECS)
    .filter(cid => COMPONENTS[cid])
    .filter((cid) => {
      const sink = Object.values(getUtilityPortsV2(cid))
        .find(p => p.utility === 'rfWaveguide' && p.role === 'sink');
      return sink && (broadband || sink.params.frequency === freq);
    });

  perf.push({
    label: 'Cavities it can drive',
    value: drivable.length ? drivable.map(cid => COMPONENTS[cid].name).join(', ') : 'None',
    unit: '',
    note: broadband
      ? 'Broadband, so it tops up any frequency bucket with unmet demand.'
      : `Fixed at ${round((freq || 0) / 1e6)} MHz. Cavities in any other bucket see `
        + 'zero watts from it, however much capacity it has.',
  });

  // What that peak power is actually worth, per cavity type. Rows rather than
  // a curve: the x axis here is a list of cavities, not a number, and every
  // entry in `curves` is numeric so the UI can plot them all the same way.
  for (const cid of drivable.slice(0, 6)) {
    const spec = CAVITY_SPECS[cid];
    const t = spec.kind === 'srf' ? T_SUPERFLUID : null;
    const ceiling = eAccMax(peakW / spec.n_cav, spec, t);
    const cap = maxDemandableGradient(cid);
    perf.push({
      label: `Gradient it gives a ${COMPONENTS[cid].name}`,
      value: round(Math.min(ceiling, cap), 1), unit: 'MV/m',
      note: `Alone on the network, so it takes the whole ${round(peakW / 1e6, 3)} MW`
        + `${spec.n_cav > 1 ? ` across ${spec.n_cav} cavities` : ''}`
        + `${t ? `, at a ${t.toFixed(1)} K bath` : ''}. `
        + (ceiling > cap
          ? `More than enough — the cavity tops out at ${cap} MV/m long before the RF does.`
          : `RF-limited: the cavity would take ${cap} MV/m with a bigger source.`),
    });
  }

  return { performance: perf, curves: [] };
}

/** Which utilities gate this component, and which merely derate it. */
function gatingPerformance(id, utilities) {
  const comp = COMPONENTS[id];
  const sinks = utilities.filter(u => u.role === 'sink');
  const hard = sinks.filter(u => UTILITY_META[u.utility]?.hardGate).map(u => utilityInfo(u.utility).name);
  const soft = sinks.filter(u => !UTILITY_META[u.utility]?.hardGate).map(u => utilityInfo(u.utility).name);
  const klass = componentClass(id);
  // Only beam-graph elements are handed to the physics pass, so only they can
  // be derated. A half-fed pump still pumps at its full rated speed.
  const onBeam = comp.kind === 'beamline' || comp.placement === 'attachment';

  const graded = [];
  if (onBeam && sinks.some(u => u.utility === 'powerCable')) {
    graded.push(klass === 'magnet' ? 'Power (field scales linearly)'
      : klass === 'srfCavity' || klass === 'ncCavity' ? null
        : 'Power (legacy linear derate on energy gain)');
  }
  if (onBeam && sinks.some(u => u.utility === 'vacuumPipe')) {
    graded.push('Vacuum (emittance growth and current loss)');
  }
  if (klass === 'ncCavity' && sinks.some(u => u.utility === 'coolingWater')) graded.push('Cooling (thermal detuning)');
  if (klass === 'srfCavity') graded.push('Cryo (bath temperature sets Q₀, and Q₀ sets gradient)');
  if (sinks.some(u => u.utility === 'rfWaveguide')) graded.push('RF (delivered peak watts, as sqrt(P))');

  const out = [];
  if (comp.isDrawnConnection) {
    // No ports, but very much gated: the vacuum solver charges drawn pipe by
    // surface area and the beam trips when nothing pumps it.
    return [
      {
        label: 'Hard gates', value: 'Vacuum', unit: '',
        note: 'Beam pipe declares no port — it is drawn, not placed — so the vacuum '
          + 'solver reads state.beamPipes and adds its surface area to whichever '
          + 'network pumps it. A run with no pump on it still trips the beam.',
      },
      {
        label: 'Graded response', value: 'Vacuum (emittance growth and current loss)',
        unit: '',
        note: 'Pressure reaches the beam through beam_gas: scattering grows '
          + 'emittance as 1/(βγ)² and removes current as exp(−L/λ). Length hurts '
          + 'twice — more gas load, and more metres to scatter in.',
      },
    ];
  }
  if (!onBeam && utilities.some(u => u.role === 'source')) {
    out.push({
      label: 'Output vs its own supply', value: 'Not coupled', unit: '',
      note: 'An under-powered source still publishes its full rated capacity — the '
        + 'solvers do not chain one network\'s quality into another\'s. Its power '
        + 'sink is a hard gate on the beam, not a throttle on its output.',
    });
  }
  out.push({
    label: 'Hard gates', value: hard.length ? hard.join(', ') : 'None', unit: '',
    note: hard.length
      ? 'Each of these trips the beam outright if the sink is unconnected or the '
        + 'network has zero capacity. There is no partial credit for an unwired sink '
        + '— it fails closed at quality 0.'
      : 'Nothing about this component can stop the beam.',
  });
  out.push({
    label: 'Graded response', value: graded.filter(Boolean).join('; ') || 'None', unit: '',
    note: graded.filter(Boolean).length
      ? 'Between "connected" and "fully served" these change what the hardware does.'
      : 'Once its gates are satisfied this component performs at catalogue values; '
        + 'partial supply neither helps nor hurts.',
  });
  if (soft.length) {
    out.push({
      label: 'Soft only', value: soft.join(', '), unit: '',
      note: 'Costs money or science output when unserved, never stops the beam.',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

const CATEGORY_LABEL = {
  source: 'Beam Sources', optics: 'Magnets & Optics', rf: 'RF Cavities',
  diagnostic: 'Diagnostics', endpoint: 'Endpoints & Targets',
  power: 'Electrical Power', vacuum: 'Vacuum', rfPower: 'RF Power',
  cooling: 'Cooling & Cryogenics', dataControls: 'Data, Controls & Safety',
  ops: 'Operations & Safety', equipment: 'Lab Equipment',
};

export function categoryOf(id) {
  const c = COMPONENTS[id];
  return c?.category || (c?.kind === 'equipment' ? 'equipment' : 'other');
}

export function categoryTitle(category) {
  return CATEGORY_LABEL[category] || label(category);
}

const cache = new Map();

export function buildComponentPage(id) {
  const c = COMPONENTS[id];
  if (!c) return null;

  const klass = componentClass(id);
  const utilities = buildUtilities(id, klass);

  let performance = [];
  let curves = [];

  const cav = cavityPerformance(id);
  if (cav) {
    performance = cav.performance;
    curves = cav.curves;
  } else if (c.isDrawnConnection) {
    const bp = beamPipePerformance();
    performance = bp.performance;
    curves = bp.curves;
  } else if (klass === 'magnet') {
    const m = magnetPerformance(id);
    performance = m.performance;
    curves = m.curves;
  } else {
    const sourceUtility = utilities.find(u => u.role === 'source')?.utility;
    if (sourceUtility) {
      const s = sourcePerformance(id, sourceUtility);
      performance = s.performance;
      curves = s.curves;
    }
  }
  performance = [...performance, ...gatingPerformance(id, utilities)];

  return {
    id,
    name: c.name || id,
    category: categoryOf(id),
    subsection: c.subsection || (c.kind === 'equipment' ? 'labEquipment' : 'general'),
    summary: c.desc || '',
    stats: buildStats(id),
    utilities,
    performance,
    curves,
    relatedArticles: relatedArticlesFor(id, utilities),
  };
}

export function getComponentPage(id) {
  if (!COMPONENTS[id]) return null;
  if (!cache.has(id)) cache.set(id, buildComponentPage(id));
  return cache.get(id);
}
