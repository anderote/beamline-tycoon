// Beamline component operating state and source-only run readiness.
//
// A running source and an active downstream component are different controls:
// the source owns the beamline's run state, while every other component may be
// switched out of service and behave as passive beam pipe.  Keep the lookup
// and readiness policy here so Game.js remains a coordinator and input code
// never mutates beamline records directly.

import { COMPONENTS } from '../data/components.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { UTILITY_TO_QUALITY_FIELD } from '../game/utility-gate.js';

const HARD_SOURCE_UTILITIES = new Set([
  'hvCable', 'powerCable', 'vacuumPipe', 'rfWaveguide',
  'waterSupplyPipe', 'coolingWater', 'cryoTransfer',
]);

const HEALTH_SCALED_STATS = new Set([
  'beamCurrent', 'energyGain', 'focusStrength', 'bendAngle', 'field',
  'fieldStrength', 'dataRate', 'collisionRate', 'photonRate', 'beamQuality',
  'kParameter', 'spaceChargeCompensation',
]);

export function beamlineComponentEnabled(component) {
  return component?.beamlineEnabled !== false;
}

/** Find the mutable, canonical record for a module or on-pipe placement. */
export function findBeamlineComponent(state, componentId) {
  if (!componentId) return null;
  for (const component of state?.placeables || []) {
    if (component?.id === componentId && COMPONENTS[component.type]) return component;
  }
  for (const pipe of state?.beamPipes || []) {
    for (const component of pipe?.placements || []) {
      if (component?.id === componentId && COMPONENTS[component.type]) return component;
    }
  }
  return null;
}

/**
 * Toggle a non-source beamline component. Sources are controlled by the
 * beamline run command, so treating one as a downstream bypass is rejected.
 */
export function toggleBeamlineComponentState(state, componentId) {
  const component = findBeamlineComponent(state, componentId);
  const def = component && COMPONENTS[component.type];
  if (!component || !def || def.isSource) return null;
  component.beamlineEnabled = !beamlineComponentEnabled(component);
  return { component, enabled: component.beamlineEnabled };
}

export function componentHealthFraction(componentId, componentHealth) {
  const health = componentHealth?.[componentId];
  if (!Number.isFinite(health)) return 1;
  return Math.max(0, Math.min(1, health / 100));
}

/** Zero-health and deliberately switched-off downstream hardware is pipe. */
export function componentActsAsBeamPipe(node, componentHealth) {
  if (COMPONENTS[node?.type]?.isSource) return false;
  return !beamlineComponentEnabled(node)
    || componentHealthFraction(node?.id, componentHealth) <= 0;
}

/** Scale only active output/field terms; geometry and physical limits remain. */
export function derateStatsForHealth(stats, componentId, componentHealth) {
  const factor = componentHealthFraction(componentId, componentHealth);
  if (factor >= 1) return stats;
  const out = { ...stats };
  for (const key of HEALTH_SCALED_STATS) {
    if (Number.isFinite(out[key])) out[key] *= factor;
  }
  // Damaged cathodes/sources produce a dirtier beam as well as less current.
  if (Number.isFinite(out.emittance) && out.emittance > 0 && factor > 0) {
    out.emittance /= factor;
  }
  return out;
}

/**
 * Whether this beamline's source can emit right now. Downstream faults are
 * intentionally absent: they belong in the physics result, not this gate.
 */
export function beamlineRunReadiness(state, entry, orderedNodes = []) {
  const source = orderedNodes.find(node => COMPONENTS[node?.type]?.isSource)
    || findBeamlineComponent(state, entry?.sourceId);
  if (!source || !COMPONENTS[source.type]?.isSource) {
    return { canRun: false, code: 'source_missing', reason: 'Need a working source.' };
  }
  if (!beamlineComponentEnabled(source)) {
    return { canRun: false, code: 'source_off', reason: 'The source is switched off.' };
  }

  const health = componentHealthFraction(source.id, entry?.beamState?.componentHealth);
  if (health <= 0) {
    return { canRun: false, code: 'source_failed', reason: 'The source is broken.' };
  }

  const staffBlocker = (state?.infraBlockers || []).find(
    blocker => blocker?.code === 'beam_unstaffed',
  );
  if (staffBlocker) {
    return {
      canRun: false,
      code: 'beam_unstaffed',
      reason: staffBlocker.reason || staffBlocker.message || 'An operator is required.',
    };
  }

  const qualities = state?.nodeQualities?.[source.id];
  // An entry for this source means the utility gate has published its
  // fail-closed floor. If the entire entry is absent (small unit fixtures or
  // a game without a UtilityGate), preserve the historical unconstrained
  // fallback rather than inventing a failure.
  if (qualities) {
    const requiredUtilities = new Set(COMPONENTS[source.type]?.requiredConnections || []);
    for (const port of Object.values(getUtilityPortsV2(source.type) || {})) {
      if (port?.role !== 'sink'
        || !HARD_SOURCE_UTILITIES.has(port.utility)
        || !requiredUtilities.has(port.utility)) continue;
      const field = UTILITY_TO_QUALITY_FIELD[port.utility];
      if (field && !(qualities[field] > 0)) {
        return {
          canRun: false,
          code: `${port.utility}_source_unavailable`,
          reason: `The source has no ${port.utility} service.`,
        };
      }
    }
  }

  return { canRun: true, code: null, reason: null };
}
