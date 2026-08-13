// src/data/wiki/cavity-performance.js
//
// Real numbers for every cavity in the game, produced by calling the same
// functions the beam solve calls — q0/eAccMax/pDiss out of cavity-specs.js,
// which is itself the mirror of beam_physics/srf.py. Nothing here restates a
// figure from a doc; if the spec table changes, these pages change with it.
//
// The two stories worth telling on a cavity page:
//
//   SRF — gradient is cheap and cold is expensive. A cryomodule reaches its
//   25 MV/m on tens of watts per cavity at 2.0 K, and the same cavity at 4.5 K
//   needs ~35x the RF and dumps kilowatts into a plant rated in hundreds of
//   watts. Q0(T) is the whole game.
//
//   NC — duty factor is everything. 40 kW of average power is 0.86 MV/m if it
//   arrives continuously and 27 MV/m if it arrives in 0.1%-duty pulses,
//   because E_acc goes as sqrt(P) and peak power is average / duty.

import { COMPONENTS } from '../components.js';
import { getUtilityPortsV2 } from '../utility-ports-v2.js';
import {
  CAVITY_SPECS, T_CRITICAL, Q0_COPPER, q0, eAccMax, pDiss,
} from '../../beamline/cavity-specs.js';
import { PARAM_DEFS } from '../../beamline/component-physics.js';
import { T_SUPERFLUID, T_NORMAL } from '../../utility/types/cryoTransfer.js';
import { UTILITY_LADDERS } from './utility-model.js';
import { bandForFrequencyHz } from '../../utility/types/rfWaveguide.js';

// Reference bath temperatures for the two operating points the plants offer,
// plus the 4.2 K of a plain atmospheric-pressure LHe bath for contrast.
const T_POINTS = [T_SUPERFLUID, 4.2, T_NORMAL];

const round = (n, digits = 2) => {
  if (!isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Sig-fig rounding, for quantities spanning decades (Q0, dissipation, power). */
function sig(n, digits = 3) {
  if (!isFinite(n) || n === 0) return n;
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const f = 10 ** (digits - 1 - mag);
  return Math.round(n * f) / f;
}

/** Sig-fig number for interpolation into prose — never 0.00000121. */
function num(n, digits = 3) {
  if (!isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return sig(n, digits).toExponential(digits - 1);
  return String(sig(n, digits));
}

/** Watts rescaled to the unit a human would quote. */
function watts(w) {
  if (Math.abs(w) >= 1e6) return { value: sig(w / 1e6), unit: 'MW' };
  if (Math.abs(w) >= 2e3) return { value: sig(w / 1e3), unit: 'kW' };
  return { value: sig(w), unit: 'W' };
}

const kelvin = (t) => t.toFixed(1);

/** RF power, watts per cavity, needed to reach `eAcc` MV/m at `tempK`. */
export function powerForGradient(eAccMvM, spec, tempK) {
  const volts = eAccMvM * 1e6 * spec.l_active;
  if (spec.kind === 'srf') return volts * volts / (spec.r_over_q * q0(tempK, spec));
  return volts * volts / (spec.r_shunt * spec.l_active);
}

/**
 * The highest gradient the player can ASK for — the top of the tunable range,
 * or the catalogue value when the cavity has no slider. The beam solve takes
 * min(demanded, achievable), so quoting a bare RF ceiling of 900 MV/m would be
 * arithmetic rather than information: on a well-fed SRF cavity this number is
 * what binds, not the RF.
 */
export function maxDemandableGradient(componentId) {
  const defs = PARAM_DEFS[componentId];
  if (defs?.gradient && !defs.gradient.derived) return defs.gradient.max;
  const comp = COMPONENTS[componentId];
  return comp?.stats?.gradient ?? comp?.params?.gradient ?? Infinity;
}

/** The component's declared RF drive, in kW total and watts per cavity. */
function declaredDrive(componentId, spec) {
  const ports = getUtilityPortsV2(componentId);
  const rf = Object.values(ports).find(p => p.utility === 'rfWaveguide' && p.role === 'sink');
  const kW = rf ? (rf.params.demand || 0) : 0;
  return {
    kW,
    frequencyHz: rf ? rf.params.frequency : undefined,
    perCavityW: spec.n_cav ? (kW * 1000) / spec.n_cav : 0,
  };
}

/**
 * RF sources that can actually drive this cavity: any source whose declared
 * bands include the one this frequency falls in. Ranked by peak power, because
 * peak is what sets gradient.
 */
export function compatibleRfSources(frequencyHz) {
  const band = bandForFrequencyHz(frequencyHz ?? 0);
  return UTILITY_LADDERS.rfWaveguide
    .filter(s => band && (s.bands || []).includes(band))
    .map(s => ({ ...s, peakKw: s.capacity / Math.max(s.dutyFactor ?? 1, 1e-4) }))
    .sort((a, b) => b.peakKw - a.peakKw);
}

function gradientCurve(spec, tempK, maxGradient, title, note) {
  const pMax = powerForGradient(maxGradient, spec, tempK);
  const points = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const p = (pMax * i) / N;
    points.push([sig(p, 4), round(eAccMax(p, spec, tempK), 3)]);
  }
  return {
    title,
    xLabel: 'RF power per cavity (W)',
    yLabel: 'Accelerating gradient (MV/m)',
    points,
    note,
  };
}

function q0Curve(spec) {
  const points = [];
  for (let t = 1.6; t <= 6.0001; t += 0.1) {
    points.push([round(t, 1), sig(q0(t, spec), 3)]);
  }
  return {
    title: 'Q₀ vs bath temperature',
    xLabel: 'Bath temperature (K)',
    yLabel: 'Unloaded Q₀',
    points,
    note: `BCS surface resistance falls exponentially with 1/T, so Q₀ climbs by `
      + `roughly ${Math.round(q0(T_SUPERFLUID, spec) / q0(T_NORMAL, spec))}× between `
      + `${T_NORMAL} K and ${T_SUPERFLUID} K. Above ${T_CRITICAL} K the niobium is `
      + `normal-conducting and Q₀ drops to the copper value, ${sig(Q0_COPPER)}.`,
  };
}

function dissipationCurve(spec, tempK, maxGradient) {
  const points = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const e = (maxGradient * i) / N;
    points.push([round(e, 2), sig(pDiss(e, spec, tempK) * spec.n_cav, 4)]);
  }
  return {
    title: `Wall dissipation vs gradient (${kelvin(tempK)} K)`,
    xLabel: 'Accelerating gradient (MV/m)',
    yLabel: `Heat into the bath (W, all ${spec.n_cav} cavit${spec.n_cav === 1 ? 'y' : 'ies'})`,
    points,
    note: 'This is the load the cold box has to remove. It goes as E², and the '
      + '1/Q₀ prefactor climbs as the bath warms — which is why an overloaded '
      + 'plant runs away instead of settling.',
  };
}

// ---------------------------------------------------------------------------

function srfPerformance(id, spec, design) {
  const drive = declaredDrive(id, spec);
  const ports = getUtilityPortsV2(id);
  const cryo = Object.values(ports).find(p => p.utility === 'cryoTransfer');
  const staticW = cryo ? (cryo.params.srfHeatW || 0) : 0;

  const perf = [
    { label: 'Cavity count', value: spec.n_cav, unit: '',
      note: `${round(spec.l_active, 3)} m of active length each, at ${spec.f_ghz * 1000} MHz.` },
    { label: 'R/Q', value: spec.r_over_q, unit: 'Ω',
      note: 'Geometry factor. Gradient goes as sqrt(P × R/Q × Q₀) / L.' },
  ];

  for (const t of T_POINTS) {
    const qq = q0(t, spec);
    perf.push({
      label: `Q₀ at ${kelvin(t)} K`, value: sig(qq), unit: '',
      note: `Surface resistance ${num(spec.G / qq)} Ω, of which `
        + `${num(spec.r_res, 2)} Ω is the temperature-independent residual floor.`,
    });
  }

  const cap = maxDemandableGradient(id);
  for (const t of [T_SUPERFLUID, T_NORMAL]) {
    const ceiling = eAccMax(drive.perCavityW, spec, t);
    perf.push({
      label: `Gradient ceiling at ${kelvin(t)} K`,
      value: round(Math.min(ceiling, cap), 1), unit: 'MV/m',
      note: `On the declared ${drive.kW} kW drive — ${num(drive.perCavityW)} W per `
        + `cavity. ${ceiling > cap
          ? `RF alone would allow ${round(ceiling, 1)} MV/m, so the binding limit is `
            + `the cavity's own ${cap} MV/m ceiling, not the amplifier. SRF wants cold, `
            + 'not watts.'
          : `The RF is what binds here — the cavity would take ${cap} MV/m if fed.`}`,
    });
    const need = powerForGradient(design, spec, t);
    perf.push({
      label: `RF to reach ${design} MV/m at ${kelvin(t)} K`,
      value: sig(need), unit: 'W/cavity',
      note: 'Wall losses only; beam loading is on top of this.',
    });
    const diss = watts(pDiss(design, spec, t) * spec.n_cav);
    perf.push({
      label: `Heat load at ${design} MV/m, ${kelvin(t)} K`,
      value: diss.value, unit: diss.unit,
      note: `All ${spec.n_cav} cavit${spec.n_cav === 1 ? 'y' : 'ies'}, plus ${staticW} W `
        + 'declared static load. '
        + (t === T_NORMAL
          ? 'A 4K Cold Box is rated 500 W, so this operating point is out of reach '
            + 'unless the gradient comes down.'
          : 'Cold boxes on the ladder are rated 500 W (4K) and 800 W (2K).'),
    });
  }

  perf.push({
    label: 'Quench temperature', value: T_CRITICAL, unit: 'K',
    note: 'The bath warms whenever dissipation exceeds plant capacity, and warming '
      + 'raises dissipation, so the approach accelerates. At Tc the element is '
      + 'replaced by a drift for the rest of the run.',
  });

  const curves = [
    gradientCurve(spec, T_SUPERFLUID, design * 1.5,
      `Gradient vs RF power (${kelvin(T_SUPERFLUID)} K)`,
      'sqrt(P), not linear in P: the last few MV/m cost four times what the first '
      + `did. Declared drive is ${num(drive.perCavityW)} W per cavity.`),
    gradientCurve(spec, T_NORMAL, design * 1.5,
      `Gradient vs RF power (${kelvin(T_NORMAL)} K)`,
      `The same curve with Q₀ ~${Math.round(q0(T_SUPERFLUID, spec) / q0(T_NORMAL, spec))}× `
      + `lower, so every gradient costs ~that much more RF.`),
    q0Curve(spec),
    dissipationCurve(spec, T_SUPERFLUID, design * 1.5),
  ];

  return { performance: perf, curves };
}

function ncPerformance(id, spec, design) {
  const drive = declaredDrive(id, spec);
  const ports = getUtilityPortsV2(id);
  const cool = Object.values(ports).find(p => p.utility === 'coolingWater');
  const sources = compatibleRfSources(drive.frequencyHz);
  const best = sources[0];

  const cwGradient = eAccMax(drive.perCavityW, spec, null);
  const perf = [
    { label: 'Shunt impedance', value: sig(spec.r_shunt / 1e6), unit: 'MΩ/m',
      note: `Over ${round(spec.l_active, 2)} m of active structure at `
        + `${round(spec.f_ghz * 1000, 0)} MHz. Gradient = sqrt(P × R_shunt × L) / L.` },
    { label: 'Q₀ (copper)', value: sig(Q0_COPPER), unit: '',
      note: 'Fixed. A normal-conducting cavity has no useful temperature '
        + 'dependence — cooling keeps it on resonance, it does not buy gradient.' },
    { label: 'Gradient on CW drive', value: round(cwGradient, 2), unit: 'MV/m',
      note: `${drive.kW} kW delivered continuously. Catalogue design gradient is `
        + `${design} MV/m, so continuous power alone `
        + `${cwGradient >= design ? 'reaches' : 'falls short of'} it.` },
  ];

  if (best) {
    // Alone on its network a sink takes the whole bucket: the solver hands it
    // capacity x (demand/demandTotal) x 1/duty, and its share is 1.
    const peakW = (best.capacity * 1000) / Math.max(best.dutyFactor ?? 1, 1e-4);
    const peakPerCavity = spec.n_cav ? peakW / spec.n_cav : 0;
    perf.push({
      label: `Gradient on one ${best.name}`,
      value: round(eAccMax(peakPerCavity, spec, null), 1), unit: 'MV/m',
      note: `${best.capacity} kW at ${round((best.dutyFactor ?? 1) * 100, 3)}% duty is `
        + `${num(peakW / 1e6)} MW peak, and a cavity alone on the network receives the `
        + 'whole bucket. Peak power is what a pulsed structure accelerates on — which '
        + 'is why an RF source\'s duty factor matters more than its nameplate kilowatts.',
    });
  }

  const dissDesign = watts(pDiss(design, spec, null) * spec.n_cav);
  perf.push({
    label: `Wall dissipation at ${design} MV/m`,
    value: dissDesign.value, unit: dissDesign.unit,
    note: cool
      ? `Peak, inside the pulse. The declared cooling sink removes ${cool.params.heatLoad} kW `
        + 'of average heat, which is the duty-averaged version of this number.'
      : 'Peak, inside the pulse.',
  });
  perf.push({
    label: 'Detune sensitivity', value: round(20 * (spec.f_ghz / 2.856), 1), unit: 'kHz/K',
    note: 'A starved cooling loop runs up to 40 K hot; the resonance walks off by '
      + 'this much per kelvin and the cavity reflects rather than absorbs, following '
      + 'coupling = 1 / (1 + (2·Q_L·Δf/f)²).',
  });

  const curves = [
    gradientCurve(spec, null, design * 2,
      'Gradient vs peak RF power',
      'Peak power, not average. Divide a pulsed source\'s rating by its duty '
      + 'factor to find where it lands on this curve.'),
  ];

  return { performance: perf, curves };
}

/**
 * `{ performance, curves }` for a cavity component, or null if it has no
 * device model. Callable for any id — CAVITY_SPECS is the gate.
 */
export function cavityPerformance(componentId) {
  const spec = CAVITY_SPECS[componentId];
  if (!spec) return null;
  const comp = COMPONENTS[componentId];
  const design = comp?.stats?.gradient || comp?.params?.gradient || 1;
  return spec.kind === 'srf'
    ? srfPerformance(componentId, spec, design)
    : ncPerformance(componentId, spec, design);
}

/**
 * Cavities with a spec but no placeable component. Documented so the wiki can
 * say "modelled, not yet buildable" instead of silently omitting them.
 */
export const SPECCED_NOT_PLACEABLE = Object.keys(CAVITY_SPECS)
  .filter(id => !COMPONENTS[id]);
