// Physics-aware parameter matching for the Beamline Designer's opt-in auto
// mode. This module is deliberately pure: it plans parameter patches from a
// draft and its already-published envelope; BeamlineDesigner owns mutation,
// undo, recomputation, and presentation.

import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS } from './component-physics.js';
import {
  beamMomentumGeV,
  recommendedQuadrupoleGradient,
} from './designer-placement-hints.js';

const QUAD_TYPES = new Set(['quadrupole', 'scQuad']);
const RF_PHYSICS_TYPES = new Set(['rfCavity', 'cryomodule']);
const RF_AMPLITUDE_KEYS = ['gradient', 'voltage', 'peakField', 'intervaneVoltage'];
const SOLENOID_FIELD_TO_K = 0.2998;
const DEFAULT_SOLENOID_PHASE_ADVANCE = 0.8;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function nodeLengthM(node) {
  const comp = node ? COMPONENTS[node.type] : null;
  const subL = node && Number.isFinite(node.subL) && node.subL > 0
    ? node.subL
    : (comp?.subL || 4);
  return subL * 0.5;
}

function roundedAndClamped(value, def) {
  let out = Number.isFinite(value) ? value : finite(def?.default);
  if (Number.isFinite(def?.min)) out = Math.max(def.min, out);
  if (Number.isFinite(def?.max)) out = Math.min(def.max, out);
  if (Number.isFinite(def?.step) && def.step > 0) {
    const origin = Number.isFinite(def?.min) ? def.min : 0;
    out = origin + Math.round((out - origin) / def.step) * def.step;
    if (Number.isFinite(def?.min)) out = Math.max(def.min, out);
    if (Number.isFinite(def?.max)) out = Math.min(def.max, out);
  }
  return Number(out.toFixed(12));
}

/** Beam state immediately upstream of a draft node (or the closest surviving
 * state when a bad setting already lost the beam before that node). */
function envelopeBeforeNode(envelope, nodeIndex) {
  if (!Array.isArray(envelope) || envelope.length === 0) return null;
  let before = null;
  let at = null;
  for (const datum of envelope) {
    if (!Number.isInteger(datum?.index)) continue;
    if (datum.index < nodeIndex) before = datum;
    else if (datum.index === nodeIndex && !at) at = datum;
    else if (datum.index > nodeIndex) break;
  }
  return before || at || envelope[envelope.length - 1] || envelope[0];
}

/** A gentle two-plane solenoid match at the local rigidity.
 *
 * The engine uses k = 0.2998 B / (2p). Holding kL near 0.8 rad gives useful
 * front-end focusing without driving the beam through a quarter-wave waist.
 */
export function recommendedSolenoidField({
  kineticEnergyGeV,
  particle = 'e-',
  lengthM = 1,
  min = 0.001,
  max = 0.5,
  step = 0.001,
  phaseAdvance = DEFAULT_SOLENOID_PHASE_ADVANCE,
} = {}) {
  const momentum = beamMomentumGeV(kineticEnergyGeV, particle);
  const length = Math.max(finite(lengthM, 1), 1e-9);
  const phase = Math.max(finite(phaseAdvance, DEFAULT_SOLENOID_PHASE_ADVANCE), 0);
  const raw = momentum > 0
    ? (2 * momentum * phase) / (SOLENOID_FIELD_TO_K * length)
    : min;
  return roundedAndClamped(raw, { min, max, step, default: min });
}

function isRfHardware(type) {
  const comp = COMPONENTS[type];
  if (!comp) return false;
  return RF_PHYSICS_TYPES.has(comp.physicsType)
    ? (Number.isFinite(comp.rfFrequency)
      || Number.isFinite(comp.params?.rfFrequency)
      || comp.requiredConnections?.includes('rfWaveguide')
      || !!PARAM_DEFS[type]?.rfPhase)
    : Number.isFinite(comp.rfFrequency);
}

function rfPhaseTarget(type) {
  const def = PARAM_DEFS[type]?.rfPhase;
  if (Number.isFinite(def?.default)) return roundedAndClamped(def.default, def);
  const authored = COMPONENTS[type]?.params?.rfPhase;
  if (Number.isFinite(authored)) return authored;
  // Fixed-frequency accelerating hardware without a dedicated phase control is
  // matched on crest. Special longitudinal devices all declare a type-specific
  // default above (buncher -90, RFQ/gun negative, harmonic linearizer 180).
  return RF_PHYSICS_TYPES.has(COMPONENTS[type]?.physicsType) ? 0 : null;
}

function rfFrequencyTarget(type) {
  const comp = COMPONENTS[type];
  if (Number.isFinite(comp?.rfFrequency)) return comp.rfFrequency;
  if (Number.isFinite(comp?.params?.rfFrequency)) return comp.params.rfFrequency;
  return null;
}

/** Controls which auto mode owns continuously. Amplitudes remain player knobs:
 * the matcher only repairs/clamps invalid amplitudes, so their sliders stay
 * enabled while phase/frequency and focusing controls are locked. */
export function isDesignerAutoManagedParam(type, key) {
  if (QUAD_TYPES.has(type)) return key === 'gradient' || key === 'polarity';
  if (type === 'solenoid') return key === 'fieldStrength';
  if (type === 'combinedFunctionMagnet') return key === 'quadGradient';
  return isRfHardware(type) && (key === 'rfPhase' || key === 'rfFrequency');
}

function setPatch(patch, params, key, value) {
  if (value === null || value === undefined || Object.is(params?.[key], value)) return false;
  patch[key] = value;
  return true;
}

function firstQuadPolarity(nodes, envelope) {
  const index = nodes.findIndex(node => QUAD_TYPES.has(node.type));
  if (index < 0) return 0;
  const datum = envelopeBeforeNode(envelope, index);
  if (Number.isFinite(datum?.sigma_x) && Number.isFinite(datum?.sigma_y)
      && datum.sigma_y > datum.sigma_x) return 1;
  const existing = nodes[index]?.params?.polarity;
  return existing === 1 ? 1 : 0;
}

/**
 * Plan all parameter patches for one auto-tune pass.
 *
 * The caller recomputes physics after applying a non-empty plan and may run a
 * second pass: RF phase changes alter downstream energy, which alters the
 * rigidity-matched magnet strengths.
 */
export function planDesignerAutoTune({ nodes = [], envelope = [], particle = 'e-' } = {}) {
  const updates = [];
  let managedMagnets = 0;
  let managedRf = 0;
  let nextQuadPolarity = firstQuadPolarity(nodes, envelope);

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const comp = COMPONENTS[node?.type];
    if (!node || !comp) continue;
    const params = node.params || {};
    const patch = {};
    const datum = envelopeBeforeNode(envelope, index);
    const kineticEnergyGeV = finite(datum?.energy);

    if (datum && QUAD_TYPES.has(node.type)) {
      const gradientDef = PARAM_DEFS[node.type]?.gradient;
      if (gradientDef) {
        const gradient = recommendedQuadrupoleGradient({
          kineticEnergyGeV,
          particle,
          lengthM: nodeLengthM(node),
          min: gradientDef.min,
          max: gradientDef.max,
          step: gradientDef.step,
        });
        setPatch(patch, params, 'gradient', gradient);
        setPatch(patch, params, 'polarity', nextQuadPolarity);
        managedMagnets++;
        nextQuadPolarity = nextQuadPolarity === 0 ? 1 : 0;
      }
    } else if (datum && node.type === 'solenoid') {
      const fieldDef = PARAM_DEFS.solenoid?.fieldStrength;
      if (fieldDef) {
        setPatch(patch, params, 'fieldStrength', recommendedSolenoidField({
          kineticEnergyGeV,
          particle,
          lengthM: nodeLengthM(node),
          min: fieldDef.min,
          max: fieldDef.max,
          step: fieldDef.step,
        }));
        managedMagnets++;
      }
    } else if (datum && node.type === 'combinedFunctionMagnet') {
      const gradientDef = PARAM_DEFS.combinedFunctionMagnet?.quadGradient;
      if (gradientDef) {
        setPatch(patch, params, 'quadGradient', recommendedQuadrupoleGradient({
          kineticEnergyGeV,
          particle,
          lengthM: nodeLengthM(node),
          min: gradientDef.min,
          max: gradientDef.max,
          step: gradientDef.step,
        }));
        managedMagnets++;
      }
    }

    if (isRfHardware(node.type)) {
      managedRf++;
      setPatch(patch, params, 'rfFrequency', rfFrequencyTarget(node.type));
      setPatch(patch, params, 'rfPhase', rfPhaseTarget(node.type));

      // Keep valid player-selected acceleration amplitudes. Only stale/corrupt
      // values are repaired to the current slider contract.
      for (const key of RF_AMPLITUDE_KEYS) {
        const def = PARAM_DEFS[node.type]?.[key];
        if (def) {
          setPatch(patch, params, key, roundedAndClamped(params[key], def));
        } else if (key in (comp.params || {}) && !Number.isFinite(params[key])) {
          setPatch(patch, params, key, comp.params[key]);
        }
      }
    }

    const keys = Object.keys(patch);
    if (keys.length > 0) updates.push({ index, params: patch });
  }

  return {
    updates,
    managedMagnets,
    managedRf,
    changedNodes: updates.length,
    changedParams: updates.reduce((sum, update) => sum + Object.keys(update.params).length, 0),
  };
}
