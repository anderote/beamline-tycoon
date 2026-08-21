// Solver-backed optimization for Beamline Designer drafts.
//
// This module owns search and scoring, but never propagates a beam itself.
// Callers inject the same evaluator used for ordinary Designer previews, so
// every candidate is measured by the authoritative worker physics path. The
// UI owns presentation and the eventual draft mutation/undo transaction.

import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS } from './component-physics.js';

export const DESIGNER_OPTIMIZER_SCOPES = Object.freeze({
  SELECTED: 'selected',
  SAME_TYPE: 'same-type',
  OPTICS: 'optics',
  RF: 'rf',
  SOURCES: 'sources',
  ALL: 'all',
});

export const DESIGNER_OPTIMIZER_PRESETS = Object.freeze({
  balanced: ['transmission', 'quality', 'aperture', 'emittance'],
  focus: ['transmission', 'aperture', 'beamSize', 'emittance'],
  bunch: ['transmission', 'bunchLength', 'peakCurrent', 'energySpread'],
  energy: ['transmission', 'quality', 'energy'],
});

export const DESIGNER_OPTIMIZER_TARGETS = Object.freeze({
  transmission: {
    label: 'Transmission', goal: 'maximize', bounded: true,
    description: 'Keep more of the injected beam alive to the end of the line.',
  },
  quality: {
    label: 'Beam quality', goal: 'maximize', bounded: true,
    description: 'Preserve transverse emittance through the complete lattice.',
  },
  aperture: {
    label: 'Aperture margin', goal: 'maximize', bounded: true,
    description: 'Keep the RMS beam envelope away from the tightest aperture.',
  },
  emittance: {
    label: 'Emittance preservation', goal: 'maximize', bounded: true,
    description: 'Limit normalized-emittance growth from source to endpoint.',
  },
  beamSize: {
    label: 'Final beam size', goal: 'minimize', scale: 1e-3,
    description: 'Minimize the larger final RMS transverse beam radius.',
  },
  bunchLength: {
    label: 'Final bunch length', goal: 'minimize', scale: 1e-12,
    description: 'Compress the final RMS bunch duration.',
  },
  peakCurrent: {
    label: 'Peak current', goal: 'maximize', scale: 0.001,
    description: 'Raise the final peak bunch current.',
  },
  energySpread: {
    label: 'Energy spread', goal: 'minimize', scale: 1e-5,
    description: 'Reduce the final relative energy spread.',
  },
  energy: {
    label: 'Output energy', goal: 'target', scale: 0.001,
    description: 'Reach a requested final kinetic energy.',
  },
  current: {
    label: 'Output current', goal: 'maximize', scale: 0.001,
    description: 'Maximize average beam current delivered at the endpoint.',
  },
});

const SOURCE_TYPES = new Set(['source']);
const RF_TYPES = new Set(['rfCavity', 'cryomodule']);
const RF_CONTROL_KEYS = new Set([
  'gradient', 'voltage', 'peakField', 'intervaneVoltage', 'rfPhase',
]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function averagePositive(a, b) {
  const values = [a, b].filter(value => Number.isFinite(value) && value > 0);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function lastEnvelopeSample(envelope) {
  if (!Array.isArray(envelope) || envelope.length === 0) return null;
  return envelope[envelope.length - 1] || null;
}

/** Metrics published to both the objective function and the before/after UI. */
export function summarizeDesignerOptimization(result) {
  const envelope = result?.envelope;
  if (!Array.isArray(envelope) || envelope.length === 0) return null;
  const start = envelope[0];
  const end = lastEnvelopeSample(envelope);
  const startCurrent = Math.max(0, finite(start?.current));
  const endCurrent = Math.max(0, finite(end?.current, finite(result?.beamCurrent)));
  const transmission = startCurrent > 0
    ? clamp01(endCurrent / startCurrent)
    : clamp01(1 - finite(result?.totalLossFraction, 1));
  const startEmit = averagePositive(start?.emit_nx, start?.emit_ny);
  const endEmit = averagePositive(end?.emit_nx, end?.emit_ny)
    || averagePositive(result?.finalNormEmittanceX, result?.finalNormEmittanceY);
  const margins = envelope.map(sample => sample?.focus_margin).filter(Number.isFinite);
  const apertureMargin = margins.length ? Math.min(...margins) : null;
  const beamSize = Math.max(
    0,
    finite(end?.sigma_x, finite(result?.finalBeamSizeX)),
    finite(end?.sigma_y, finite(result?.finalBeamSizeY)),
  );

  return {
    beamAlive: result?.beamAlive !== false && end?.alive !== false,
    transmission,
    quality: clamp01(result?.beamQuality),
    aperture: apertureMargin == null ? null : clamp01((apertureMargin + 0.05) / 0.55),
    apertureMargin,
    emittance: startEmit && endEmit ? clamp01(startEmit / endEmit) : null,
    finalNormEmittance: endEmit,
    beamSize,
    bunchLength: Number.isFinite(end?.bunch_length)
      ? Math.max(0, end.bunch_length)
      : (Number.isFinite(result?.finalBunchLength) ? Math.max(0, result.finalBunchLength) : null),
    peakCurrent: Number.isFinite(end?.peak_current) ? Math.max(0, end.peak_current) : null,
    energySpread: Number.isFinite(end?.energy_spread)
      ? Math.max(0, end.energy_spread)
      : (Number.isFinite(result?.finalEnergySpread) ? Math.max(0, result.finalEnergySpread) : null),
    energy: Math.max(0, finite(result?.beamEnergy, finite(end?.energy))),
    current: Math.max(0, finite(result?.beamCurrent, endCurrent)),
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 1e-12) return `${(seconds * 1e15).toFixed(1)} fs`;
  if (seconds < 1e-9) return `${(seconds * 1e12).toFixed(1)} ps`;
  return `${(seconds * 1e9).toFixed(2)} ns`;
}

export function formatDesignerOptimizationMetric(key, metrics) {
  if (!metrics) return '--';
  const value = metrics[key];
  if (!Number.isFinite(value)) return '--';
  switch (key) {
    case 'transmission':
    case 'quality':
    case 'emittance':
      return `${Math.round(value * 100)}%`;
    case 'aperture':
      return Number.isFinite(metrics.apertureMargin)
        ? `${Math.round(metrics.apertureMargin * 100)}%`
        : '--';
    case 'beamSize':
      return `${(value * 1e3).toFixed(value < 1e-3 ? 3 : 2)} mm`;
    case 'bunchLength':
      return formatDuration(value);
    case 'peakCurrent':
      return value >= 1 ? `${value.toFixed(2)} A` : `${(value * 1e3).toFixed(2)} mA`;
    case 'energySpread':
      return `${(value * 100).toFixed(3)}%`;
    case 'energy':
      if (value < 0.001) return `${(value * 1e6).toFixed(1)} keV`;
      if (value < 1) return `${(value * 1e3).toFixed(2)} MeV`;
      return `${value.toFixed(3)} GeV`;
    case 'current':
      return `${value.toFixed(value < 1 ? 3 : 2)} mA`;
    default:
      return String(value);
  }
}

function optimizerParamAllowed(type, key) {
  const comp = COMPONENTS[type];
  if (!comp) return false;
  const physicsType = comp.physicsType;
  if (SOURCE_TYPES.has(physicsType)) return true;
  if (physicsType === 'quadrupole') return key === 'gradient' || key === 'polarity';
  if (physicsType === 'solenoid') return key === 'fieldStrength';
  if (physicsType === 'combined_function') return key === 'quadGradient';
  if (RF_TYPES.has(physicsType)) {
    return RF_CONTROL_KEYS.has(key) || (type === 'energyDegrader' && key === 'outputEnergy');
  }
  if (physicsType === 'undulator') return key === 'gap' || key === 'polarizationMode';
  if (type === 'scanningMagnet') return key === 'scanFieldMm';
  return false;
}

/** Numeric, non-derived controls that actually reach the production solver. */
export function designerOptimizableParams(nodeOrType) {
  const type = typeof nodeOrType === 'string' ? nodeOrType : nodeOrType?.type;
  const defs = PARAM_DEFS[type] || {};
  return Object.entries(defs)
    .filter(([key, def]) => !def?.derived
      && Number.isFinite(def?.min) && Number.isFinite(def?.max)
      && optimizerParamAllowed(type, key))
    .map(([key]) => key);
}

function isOptimizable(node) {
  return designerOptimizableParams(node).length > 0;
}

function scopeMatches(node, scope, selectedType) {
  const comp = COMPONENTS[node?.type];
  if (!comp || !isOptimizable(node)) return false;
  if (scope === DESIGNER_OPTIMIZER_SCOPES.SAME_TYPE) return node.type === selectedType;
  if (scope === DESIGNER_OPTIMIZER_SCOPES.OPTICS) return comp.category === 'optics';
  if (scope === DESIGNER_OPTIMIZER_SCOPES.RF) {
    // energyDegrader deliberately reuses the RF acceleration backend so it can
    // carry a signed energy change, but it is optics hardware, not an RF
    // device. The authored category preserves the user-facing distinction.
    return comp.category === 'rf' || designerOptimizableParams(node).includes('rfPhase');
  }
  if (scope === DESIGNER_OPTIMIZER_SCOPES.SOURCES) return SOURCE_TYPES.has(comp.physicsType);
  return scope === DESIGNER_OPTIMIZER_SCOPES.ALL;
}

export function resolveDesignerOptimizerScope({
  nodes = [], scope = DESIGNER_OPTIMIZER_SCOPES.ALL, selectedIndex = -1,
} = {}) {
  if (scope === DESIGNER_OPTIMIZER_SCOPES.SELECTED) {
    return selectedIndex >= 0 && selectedIndex < nodes.length && isOptimizable(nodes[selectedIndex])
      ? [selectedIndex]
      : [];
  }
  const selectedType = nodes[selectedIndex]?.type;
  const indices = [];
  for (let index = 0; index < nodes.length; index++) {
    if (scopeMatches(nodes[index], scope, selectedType)) indices.push(index);
  }
  return indices;
}

export function describeDesignerOptimizerScopes({ nodes = [], selectedIndex = -1 } = {}) {
  const selected = nodes[selectedIndex];
  const selectedName = COMPONENTS[selected?.type]?.name || selected?.type || 'component';
  const specs = [
    [DESIGNER_OPTIMIZER_SCOPES.SELECTED, `Selected: ${selectedName}`],
    [DESIGNER_OPTIMIZER_SCOPES.SAME_TYPE, `All ${selectedName} components`],
    [DESIGNER_OPTIMIZER_SCOPES.OPTICS, 'All optics'],
    [DESIGNER_OPTIMIZER_SCOPES.RF, 'All RF & bunching'],
    [DESIGNER_OPTIMIZER_SCOPES.SOURCES, 'All sources'],
    [DESIGNER_OPTIMIZER_SCOPES.ALL, 'All tunable components'],
  ];
  return specs.map(([id, label]) => {
    const indices = resolveDesignerOptimizerScope({ nodes, scope: id, selectedIndex });
    const controls = indices.reduce(
      (sum, index) => sum + designerOptimizableParams(nodes[index]).length,
      0,
    );
    return { id, label, count: indices.length, controls, disabled: controls === 0 };
  });
}

function normalizeTargets(targets) {
  const input = Array.isArray(targets) && targets.length
    ? targets
    : DESIGNER_OPTIMIZER_PRESETS.balanced;
  const normalized = [];
  for (const target of input) {
    const entry = typeof target === 'string' ? { key: target } : { ...target };
    if (!DESIGNER_OPTIMIZER_TARGETS[entry.key]) continue;
    normalized.push({
      key: entry.key,
      value: Number.isFinite(entry.value) ? entry.value : null,
      weight: Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 1,
    });
  }
  return normalized;
}

function relativeUtility(value, reference, goal, scale) {
  if (!Number.isFinite(value)) return null;
  const magnitude = Math.max(Math.abs(finite(reference)), finite(scale, 1e-9), 1e-12);
  if (goal === 'minimize') return magnitude / (magnitude + Math.max(0, value));
  return Math.max(0, value) / (Math.max(0, value) + magnitude);
}

export function scoreDesignerOptimization(metrics, targets, baseline = metrics) {
  if (!metrics) return -Infinity;
  const activeTargets = normalizeTargets(targets);
  let weighted = 0;
  let weights = 0;
  for (const target of activeTargets) {
    const def = DESIGNER_OPTIMIZER_TARGETS[target.key];
    const value = metrics[target.key];
    if (!Number.isFinite(value)) continue;
    let utility;
    if (def.goal === 'target') {
      if (!Number.isFinite(target.value)) continue;
      const tolerance = Math.max(Math.abs(target.value) * 0.05, def.scale || 1e-9);
      utility = 1 / (1 + Math.abs(value - target.value) / tolerance);
    } else if (def.bounded) {
      utility = clamp01(value);
    } else {
      utility = relativeUtility(value, baseline?.[target.key], def.goal, def.scale);
    }
    weighted += utility * target.weight;
    weights += target.weight;
  }
  if (weights === 0) return -Infinity;

  // A zero-size, zero-spread lost beam is not an optimum. Preserve at least
  // the baseline survival while still allowing a small trade for another
  // explicitly selected objective.
  const baselineTransmission = Math.max(finite(baseline?.transmission), 1e-9);
  const survival = clamp01(finite(metrics.transmission) / baselineTransmission);
  const aliveGuard = metrics.beamAlive ? 1 : 0;
  return (weighted / weights) * (0.25 + 0.75 * survival) * aliveGuard;
}

function roundedAndClamped(value, def) {
  let out = finite(value, finite(def?.default));
  if (Number.isFinite(def?.min)) out = Math.max(def.min, out);
  if (Number.isFinite(def?.max)) out = Math.min(def.max, out);
  if (Number.isFinite(def?.step) && def.step > 0) {
    const origin = Number.isFinite(def.min) ? def.min : 0;
    out = origin + Math.round((out - origin) / def.step) * def.step;
    out = Math.max(def.min, Math.min(def.max, out));
  }
  return Number(out.toFixed(12));
}

function uniqueValues(values, current) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!Number.isFinite(value) || Object.is(value, current)) continue;
    const sig = String(value);
    if (seen.has(sig)) continue;
    seen.add(sig);
    output.push(value);
  }
  return output;
}

function candidateValues(def, current, pass) {
  const min = def.min;
  const max = def.max;
  const steps = Number.isFinite(def.step) && def.step > 0
    ? Math.round((max - min) / def.step)
    : Infinity;
  if (steps <= 8) {
    const values = [];
    for (let i = 0; i <= steps; i++) values.push(roundedAndClamped(min + i * def.step, def));
    return uniqueValues(values, current);
  }
  const range = max - min;
  if (pass === 0) {
    return uniqueValues([
      min,
      roundedAndClamped(min + range * 0.25, def),
      roundedAndClamped(min + range * 0.5, def),
      roundedAndClamped(min + range * 0.75, def),
      max,
    ], current);
  }
  return uniqueValues([
    roundedAndClamped(current - range * 0.125, def),
    roundedAndClamped(current - range * 0.04, def),
    roundedAndClamped(current + range * 0.04, def),
    roundedAndClamped(current + range * 0.125, def),
  ], current);
}

function candidateCapacity(def, pass) {
  const steps = Number.isFinite(def.step) && def.step > 0
    ? Math.round((def.max - def.min) / def.step)
    : Infinity;
  if (steps <= 8) return Math.max(1, steps);
  return pass === 0 ? 5 : 4;
}

function cloneNodes(nodes) {
  return nodes.map(node => ({ ...node, params: { ...(node?.params || {}) } }));
}

export function buildDesignerOptimizerKnobs({
  nodes = [], scope = DESIGNER_OPTIMIZER_SCOPES.ALL, selectedIndex = -1,
} = {}) {
  const knobs = [];
  for (const index of resolveDesignerOptimizerScope({ nodes, scope, selectedIndex })) {
    for (const key of designerOptimizableParams(nodes[index])) {
      knobs.push({
        index,
        type: nodes[index].type,
        componentName: COMPONENTS[nodes[index].type]?.name || nodes[index].type,
        key,
        def: PARAM_DEFS[nodes[index].type][key],
      });
    }
  }
  return knobs;
}

function collectUpdates(beforeNodes, afterNodes) {
  const updates = [];
  for (let index = 0; index < beforeNodes.length; index++) {
    const before = beforeNodes[index]?.params || {};
    const after = afterNodes[index]?.params || {};
    const params = {};
    for (const [key, value] of Object.entries(after)) {
      if (!Object.is(before[key], value)) params[key] = value;
    }
    if (Object.keys(params).length) updates.push({ index, params });
  }
  return updates;
}

/**
 * Coordinate-sweep every selected control through real solver evaluations.
 * The first pass samples the full authored range; later passes revisit each
 * control around the best setting found so far. This is deterministic, keeps
 * every candidate inside its slider contract, and reports enough progress for
 * the Designer to make a potentially expensive run legible.
 */
export async function optimizeDesignerBeamline({
  nodes = [],
  initialResult = null,
  scope = DESIGNER_OPTIMIZER_SCOPES.ALL,
  selectedIndex = -1,
  targets = DESIGNER_OPTIMIZER_PRESETS.balanced,
  evaluate,
  onProgress = null,
  shouldContinue = () => true,
  passes = 2,
} = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate is required');
  const before = summarizeDesignerOptimization(initialResult);
  if (!before) throw new Error('A solved beam is required before optimization');
  const activeTargets = normalizeTargets(targets);
  if (activeTargets.length === 0) throw new Error('At least one optimization target is required');
  const knobs = buildDesignerOptimizerKnobs({ nodes, scope, selectedIndex });
  if (knobs.length === 0) throw new Error('The selected scope has no solver-backed controls');

  let bestNodes = cloneNodes(nodes);
  let bestResult = initialResult;
  let bestMetrics = before;
  let bestScore = scoreDesignerOptimization(before, activeTargets, before);
  let evaluations = 0;
  const requestedPasses = Math.max(1, Math.min(3, Math.floor(finite(passes, 2))));
  let total = 0;
  for (let pass = 0; pass < requestedPasses; pass++) {
    total += knobs.reduce((sum, knob) => sum + candidateCapacity(knob.def, pass), 0);
  }

  for (let pass = 0; pass < requestedPasses; pass++) {
    for (let knobIndex = 0; knobIndex < knobs.length; knobIndex++) {
      if (!shouldContinue()) {
        return {
          canceled: true, nodes: bestNodes, result: bestResult,
          before, after: bestMetrics, scoreBefore: scoreDesignerOptimization(before, activeTargets, before),
          scoreAfter: bestScore, updates: collectUpdates(nodes, bestNodes),
          evaluations, total, knobs, targets: activeTargets,
        };
      }
      const knob = knobs[knobIndex];
      const current = roundedAndClamped(
        bestNodes[knob.index]?.params?.[knob.key],
        knob.def,
      );
      const values = candidateValues(knob.def, current, pass);
      let localNodes = bestNodes;
      let localResult = bestResult;
      let localMetrics = bestMetrics;
      let localScore = bestScore;

      for (const value of values) {
        if (!shouldContinue()) break;
        const candidate = cloneNodes(bestNodes);
        candidate[knob.index].params[knob.key] = value;
        const result = await evaluate(candidate);
        evaluations++;
        const metrics = summarizeDesignerOptimization(result);
        const score = scoreDesignerOptimization(metrics, activeTargets, before);
        onProgress?.({
          evaluations, total, pass: pass + 1, passes: requestedPasses,
          knob: { ...knob }, value, bestScore: localScore,
        });
        if (score > localScore + 1e-9) {
          localNodes = candidate;
          localResult = result;
          localMetrics = metrics;
          localScore = score;
        }
      }
      bestNodes = localNodes;
      bestResult = localResult;
      bestMetrics = localMetrics;
      bestScore = localScore;
    }
  }

  return {
    canceled: false,
    nodes: bestNodes,
    result: bestResult,
    before,
    after: bestMetrics,
    scoreBefore: scoreDesignerOptimization(before, activeTargets, before),
    scoreAfter: bestScore,
    updates: collectUpdates(nodes, bestNodes),
    evaluations,
    total,
    knobs,
    targets: activeTargets,
    scopeIndices: resolveDesignerOptimizerScope({ nodes, scope, selectedIndex }),
  };
}
