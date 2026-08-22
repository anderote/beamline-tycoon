// Solver-backed next-component suggestions for Beamline Designer stackups.
//
// This is intentionally a planner, not another physics implementation. The
// caller supplies the same evaluator used by Designer previews; this module
// only builds legal candidates, scores the published result against the
// selected mission, and explains the trade-off.

import { COMPONENTS } from '../data/components.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { seedComponentParams } from './component-params.js';
import { summarizeDesignerOptimization } from './designer-optimizer.js';

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_CANDIDATES = 120;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function midpointBand(band) {
  if (!Array.isArray(band) || band.length < 2) return null;
  const [lo, hi] = band;
  if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2;
  return Number.isFinite(lo) ? lo : hi;
}

function bandFit(value, band, logScale = false) {
  if (!Number.isFinite(value) || !Array.isArray(band) || band.length < 2) return null;
  const [lo, hi] = band;
  if (Number.isFinite(lo) && value < lo) {
    return logScale && value > 0
      ? clamp01(value / lo)
      : clamp01(1 - (lo - value) / Math.max(Math.abs(lo), 1e-9));
  }
  if (Number.isFinite(hi) && value > hi) {
    return logScale && value > 0
      ? clamp01(hi / value)
      : clamp01(1 - (value - hi) / Math.max(Math.abs(hi), 1e-9));
  }
  return 1;
}

function nodeLengthM(node) {
  const def = COMPONENTS[node?.type];
  return Math.max(0.5, finite(node?.subL, finite(def?.subL, 4)) * 0.5);
}

function endpointIndex(nodes) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (COMPONENTS[nodes[i]?.type]?.category === 'endpoint') return i;
  }
  return -1;
}

function boundaryS(nodes, nodeIndex, position) {
  let s = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (i === nodeIndex && position === 'before') return s;
    s += nodeLengthM(nodes[i]);
    if (i === nodeIndex && position === 'after') return s;
  }
  return s;
}

function candidateUtilityRequirements(type) {
  const ports = getUtilityPortsV2(type);
  return [...new Set(Object.values(ports || {})
    .filter(port => port?.role === 'sink' && port.utility)
    .map(port => port.utility))];
}

function isStackupCandidate(def) {
  return !!def
    && (def.placement === 'module' || def.placement === 'attachment')
    && !def.isSource
    && !def.isDrawnConnection
    && def.category !== 'endpoint'
    && typeof def.physicsType === 'string'
    && def.id !== 'drift'
    && def.id !== 'bellows';
}

/** Return every currently placeable linear-stack component, mission-filtered. */
export function stackupCandidateTypes({
  typeId = null,
  isUnlocked = () => true,
} = {}) {
  const mission = getBeamlineType(typeId);
  return Object.entries(COMPONENTS)
    .filter(([, def]) => isStackupCandidate(def))
    .filter(([, def]) => isUnlocked(def))
    .filter(([type, def]) => {
      if (Array.isArray(def.beamlineTypes) && typeId && !def.beamlineTypes.includes(typeId)) {
        return false;
      }
      return !(mission?.excludes || []).includes(type);
    })
    .map(([type, def]) => type);
}

function preferredBoundaries(nodes, hints = []) {
  const out = [];
  const seen = new Set();
  const add = (nodeIndex, position, reason) => {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) return;
    const key = `${nodeIndex}:${position}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ nodeIndex, position, reason, s: boundaryS(nodes, nodeIndex, position) });
  };

  // Existing typed hints are the best available locations, without inventing
  // a second longitudinal model. Keep one location per hint boundary.
  for (const hint of hints) add(hint.nodeIndex, hint.position || 'after', 'physics hotspot');

  const endpoint = endpointIndex(nodes);
  if (endpoint >= 0) add(endpoint, 'before', 'before endpoint');
  const source = nodes.findIndex(node => COMPONENTS[node?.type]?.isSource);
  if (source >= 0) add(source, 'after', 'source-side insertion');
  if (out.length === 0 && nodes.length > 0) add(nodes.length - 1, 'after', 'line end');
  return out;
}

function makeCandidate(nodes, type, boundary) {
  const def = COMPONENTS[type];
  const inserted = {
    type,
    subL: def.subL,
    params: seedComponentParams(type),
  };
  const index = boundary.position === 'before' ? boundary.nodeIndex : boundary.nodeIndex + 1;
  const candidateNodes = nodes.slice();
  candidateNodes.splice(index, 0, inserted);
  return {
    id: `${type}:${boundary.nodeIndex}:${boundary.position}`,
    type,
    label: def.name || type,
    nodeIndex: boundary.nodeIndex,
    position: boundary.position,
    s: boundary.s,
    params: inserted.params,
    nodes: candidateNodes,
    utilityRequirements: candidateUtilityRequirements(type),
  };
}

function missionScore(metrics, mission) {
  if (!metrics || metrics.beamAlive === false) return 0;
  const spec = mission?.spec || {};
  const energy = bandFit(metrics.energy, spec.energyGeV, true);
  const current = bandFit(metrics.current, spec.currentMA, true);
  const spot = bandFit(metrics.beamSize * 1e3, spec.spotSizeMm, true);
  const fits = [];
  if (energy != null) fits.push({ value: energy, weight: 3 });
  if (current != null) fits.push({ value: current, weight: 2 });
  if (spot != null) fits.push({ value: spot, weight: 2 });
  const bandScore = fits.length
    ? fits.reduce((sum, item) => sum + item.value * item.weight, 0)
      / fits.reduce((sum, item) => sum + item.weight, 0)
    : 0.5;

  // Mission-independent physical health keeps a technically in-band but lost
  // or badly mismatched line from winning on a single target band.
  const health = 0.45 * clamp01(metrics.transmission)
    + 0.3 * clamp01(metrics.quality)
    + 0.25 * clamp01(metrics.aperture);
  const fom = mission?.fom || '';
  const emphasis = fom === 'fluence' || fom === 'doseAvailability'
    ? 0.65 * bandScore + 0.35 * health
    : fom === 'brilliance' || fom === 'luminosity'
      ? 0.7 * health + 0.3 * bandScore
      : 0.55 * bandScore + 0.45 * health;
  return clamp01(emphasis);
}

function explain(metrics, baseline, mission, candidate) {
  const spec = mission?.spec || {};
  const reasons = [];
  const energyFit = bandFit(metrics.energy, spec.energyGeV, true);
  if (energyFit != null && energyFit > bandFit(baseline.energy, spec.energyGeV, true)) {
    reasons.push('moves output energy toward the mission band');
  }
  if (metrics.transmission > baseline.transmission + 0.01) {
    reasons.push(`raises predicted transmission to ${Math.round(metrics.transmission * 100)}%`);
  }
  if (metrics.quality > baseline.quality + 0.01) reasons.push('improves beam quality');
  if (metrics.aperture > baseline.aperture + 0.01) reasons.push('restores aperture margin');
  if (candidate.utilityRequirements.length) {
    reasons.push(`needs ${candidate.utilityRequirements.join(', ')}`);
  }
  return reasons.length ? reasons.join(' · ') : 'best available mission score at this location';
}

/**
 * Rank one-step additions by complete-stack physics and mission fit.
 * `evaluate(nodes)` must return the authoritative Designer physics result.
 */
export async function rankStackupSuggestions({
  nodes = [],
  baselineResult,
  typeId = null,
  hints = [],
  isUnlocked = () => true,
  evaluate,
  maxResults = DEFAULT_MAX_RESULTS,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
} = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate is required');
  const baseline = summarizeDesignerOptimization(baselineResult);
  if (!baseline) return { baseline: null, suggestions: [], evaluated: 0 };
  const mission = getBeamlineType(typeId);
  const boundaries = preferredBoundaries(nodes, hints);
  const candidates = [];
  for (const type of stackupCandidateTypes({ typeId, isUnlocked })) {
    for (const boundary of boundaries) {
      candidates.push(makeCandidate(nodes, type, boundary));
      if (candidates.length >= maxCandidates) break;
    }
    if (candidates.length >= maxCandidates) break;
  }

  const baselineScore = missionScore(baseline, mission);
  const ranked = [];
  for (const candidate of candidates) {
    const result = await evaluate(candidate.nodes);
    const metrics = summarizeDesignerOptimization(result);
    if (!metrics || !metrics.beamAlive) continue;
    const score = missionScore(metrics, mission);
    ranked.push({
      ...candidate,
      score,
      improvement: score - baselineScore,
      metrics,
      reason: explain(metrics, baseline, mission, candidate),
      confidence: score >= baselineScore + 0.08 ? 'high'
        : score >= baselineScore + 0.02 ? 'medium' : 'low',
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.improvement - a.improvement
    || a.s - b.s || a.type.localeCompare(b.type));
  return {
    baseline,
    baselineScore,
    suggestions: ranked.slice(0, Math.max(0, maxResults)),
    evaluated: candidates.length,
    candidateTypes: stackupCandidateTypes({ typeId, isUnlocked }),
  };
}

export const STACKUP_PLANNER_CONSTANTS = Object.freeze({
  defaultMaxResults: DEFAULT_MAX_RESULTS,
  defaultMaxCandidates: DEFAULT_MAX_CANDIDATES,
});
