// Pure injector commissioning analysis and magnet-search coordinator.
//
// Physics remains authoritative: this module never propagates a beam or
// invents an optics result. It scores already-published envelope snapshots and
// asks an injected evaluator (the Designer's normal worker-backed physics
// path) to solve candidate magnet settings. Keeping the search here makes it
// testable without reaching through BeamlineDesigner private methods.

import { PARAM_DEFS } from './component-physics.js';

const INJECTOR_HANDOFF_GEV = 0.005;
const MAGNET_TYPES = new Set(['solenoid', 'quadrupole', 'scQuad']);
const QUAD_TYPES = new Set(['quadrupole', 'scQuad']);
const SEARCH_FACTORS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function snapshotAtOrBefore(envelope, targetS) {
  if (!Array.isArray(envelope) || envelope.length === 0) return null;
  let best = envelope[0];
  for (const datum of envelope) {
    if (finite(datum?.s) > targetS) break;
    best = datum;
  }
  return best;
}

function average(a, b) {
  const values = [a, b].filter(value => Number.isFinite(value) && value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** The natural end of an injector: the first solved point at or above 5 MeV. */
export function inferInjectorTargetS(envelope, handoffGeV = INJECTOR_HANDOFF_GEV) {
  if (!Array.isArray(envelope) || envelope.length === 0) return 0;
  const firstS = finite(envelope[0]?.s);
  const handoff = envelope.find(datum =>
    finite(datum?.s) > firstS && finite(datum?.energy) >= handoffGeV);
  return finite((handoff || envelope[envelope.length - 1])?.s);
}

/** Summarise the source-to-target section using solver-published values. */
export function commissioningReport(envelope, { targetS = null } = {}) {
  if (!Array.isArray(envelope) || envelope.length === 0) return null;
  const resolvedTarget = Number.isFinite(targetS) ? targetS : inferInjectorTargetS(envelope);
  const section = envelope.filter(datum => finite(datum?.s) <= resolvedTarget);
  const start = section[0] || envelope[0];
  const end = snapshotAtOrBefore(envelope, resolvedTarget) || envelope[envelope.length - 1];
  const capture = section.find(datum => Number.isFinite(datum?.rf_capture_efficiency));

  const startCurrent = Math.max(0, finite(start?.current));
  const endCurrent = Math.max(0, finite(end?.current));
  const transmission = startCurrent > 0 ? clamp01(endCurrent / startCurrent) : 0;
  const startEmit = average(start?.emit_nx, start?.emit_ny);
  const endEmit = average(end?.emit_nx, end?.emit_ny);
  const emittancePreservation = startEmit && endEmit
    ? clamp01(startEmit / endEmit)
    : 0;
  const margins = section.map(datum => datum?.focus_margin).filter(Number.isFinite);
  const minFocusMargin = margins.length ? Math.min(...margins) : 0;
  // A 50% radius margin is comfortably commissioned; negative means the RMS
  // envelope itself has already crossed the authored aperture.
  const apertureScore = clamp01((minFocusMargin + 0.05) / 0.55);
  const sx = Math.max(0, finite(end?.sigma_x));
  const sy = Math.max(0, finite(end?.sigma_y));
  const roundness = Math.max(sx, sy) > 0
    ? clamp01(Math.min(sx, sy) / Math.max(sx, sy))
    : 0;
  const score = clamp01(
    transmission * 0.40
    + emittancePreservation * 0.30
    + apertureScore * 0.20
    + roundness * 0.10,
  );

  return {
    targetS: resolvedTarget,
    startEnergy: finite(start?.energy),
    endEnergy: finite(end?.energy),
    startCurrent,
    endCurrent,
    captureEfficiency: Number.isFinite(capture?.rf_capture_efficiency)
      ? clamp01(capture.rf_capture_efficiency)
      : null,
    transmission,
    emittancePreservation,
    minFocusMargin,
    roundness,
    bunchFrequency: finite(end?.bunch_frequency),
    bunchLength: Number.isFinite(end?.bunch_length) ? end.bunch_length : null,
    peakCurrent: Number.isFinite(end?.peak_current) ? end.peak_current : null,
    relBeta: Number.isFinite(end?.rel_beta) ? end.rel_beta : null,
    score,
  };
}

function nodeLengthM(node) {
  return Math.max(0, finite(node?.subL, 0)) * 0.5;
}

function magnetGroups(nodes, targetS) {
  const eligible = [];
  let s = 0;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const length = nodeLengthM(node);
    const midpoint = s + length / 2;
    if (MAGNET_TYPES.has(node?.type) && midpoint <= targetS + 1e-9) {
      eligible.push(index);
    }
    s += length;
  }

  const groups = [];
  let pendingQuad = null;
  for (const index of eligible) {
    const type = nodes[index]?.type;
    if (!QUAD_TYPES.has(type)) {
      if (pendingQuad != null) groups.push([pendingQuad]);
      pendingQuad = null;
      groups.push([index]);
      continue;
    }
    if (pendingQuad == null) pendingQuad = index;
    else {
      groups.push([pendingQuad, index]);
      pendingQuad = null;
    }
  }
  if (pendingQuad != null) groups.push([pendingQuad]);
  return groups;
}

function parameterFor(node) {
  return node?.type === 'solenoid' ? 'fieldStrength' : 'gradient';
}

function roundedAndClamped(value, def = {}) {
  let out = finite(value, finite(def.default));
  if (Number.isFinite(def.min)) out = Math.max(def.min, out);
  if (Number.isFinite(def.max)) out = Math.min(def.max, out);
  if (Number.isFinite(def.step) && def.step > 0) {
    const origin = Number.isFinite(def.min) ? def.min : 0;
    out = origin + Math.round((out - origin) / def.step) * def.step;
    if (Number.isFinite(def.min)) out = Math.max(def.min, out);
    if (Number.isFinite(def.max)) out = Math.min(def.max, out);
  }
  return Number(out.toFixed(12));
}

function cloneNodes(nodes) {
  return nodes.map(node => ({ ...node, params: { ...(node?.params || {}) } }));
}

function applyFactor(nodes, group, bases, factor) {
  const candidate = cloneNodes(nodes);
  for (let i = 0; i < group.length; i++) {
    const index = group[i];
    const node = candidate[index];
    const key = parameterFor(node);
    const def = PARAM_DEFS[node.type]?.[key] || {};
    node.params[key] = roundedAndClamped(bases[i] * factor, def);
  }
  return candidate;
}

/**
 * Coordinate-search the existing low-energy magnets using real physics solves.
 * Quadrupoles are scanned in beamline-order pairs when available, preserving
 * each pole setting so a FODO-like optical unit moves together. A final
 * unpaired quad remains tunable instead of silently falling outside the scan.
 */
export async function optimizeInjectorMagnets({
  nodes = [],
  initialEnvelope = [],
  targetS = null,
  evaluate,
  onProgress = null,
  passes = 2,
} = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate is required');
  const resolvedTarget = Number.isFinite(targetS)
    ? targetS
    : inferInjectorTargetS(initialEnvelope);
  const before = commissioningReport(initialEnvelope, { targetS: resolvedTarget });
  let bestNodes = cloneNodes(nodes);
  let bestEnvelope = initialEnvelope;
  let bestReport = before;
  let evaluations = 0;
  const groups = magnetGroups(nodes, resolvedTarget);
  const total = Math.max(1, groups.length * SEARCH_FACTORS.length * Math.max(1, passes));

  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    for (const group of groups) {
      const bases = group.map(index => {
        const node = bestNodes[index];
        const key = parameterFor(node);
        const def = PARAM_DEFS[node.type]?.[key] || {};
        return finite(node.params?.[key], finite(def.default, finite(def.min, 0)));
      });
      let groupBestNodes = bestNodes;
      let groupBestEnvelope = bestEnvelope;
      let groupBestReport = bestReport;

      for (const factor of SEARCH_FACTORS) {
        const candidate = applyFactor(bestNodes, group, bases, factor);
        const result = await evaluate(candidate);
        evaluations++;
        onProgress?.({ evaluations, total, pass, group: [...group] });
        const report = commissioningReport(result?.envelope || [], { targetS: resolvedTarget });
        if (!report) continue;
        if (!groupBestReport || report.score > groupBestReport.score + 1e-9) {
          groupBestNodes = candidate;
          groupBestEnvelope = result.envelope;
          groupBestReport = report;
        }
      }
      bestNodes = groupBestNodes;
      bestEnvelope = groupBestEnvelope;
      bestReport = groupBestReport;
    }
  }

  const updates = [];
  for (let index = 0; index < nodes.length; index++) {
    const beforeParams = nodes[index]?.params || {};
    const afterParams = bestNodes[index]?.params || {};
    const changed = {};
    for (const [key, value] of Object.entries(afterParams)) {
      if (!Object.is(beforeParams[key], value)) changed[key] = value;
    }
    if (Object.keys(changed).length) updates.push({ index, params: changed });
  }

  return {
    nodes: bestNodes,
    envelope: bestEnvelope,
    before,
    after: bestReport,
    updates,
    evaluations,
    targetS: resolvedTarget,
    managedGroups: groups.map(group => [...group]),
  };
}
