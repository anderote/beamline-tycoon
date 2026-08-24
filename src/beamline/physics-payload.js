// src/beamline/physics-payload.js
//
// The one place that turns flattener output into the element array the Python
// physics engine eats (beam_physics/lattice.py's `elements`, via
// BeamPhysics.compute). It used to live inline in Game._recalcSingleBeamline,
// which made it invisible to tests: the payload is a cross-language contract —
// every field here is read by name on the Python side — but nothing pinned its
// shape, so a rename or a dropped field only showed up as physics that
// silently stopped responding to something.
//
// Three things this does that are easy to get wrong, and why:
//
//   * Drift entries. The flattener emits bare pipe metres as `kind: 'drift'`
//     with NO `type` field. They are still real machine length, so they are
//     passed through as `type: 'drift'` rather than skipped — dropping them
//     shortens the lattice's s-axis and misplaces every element after the gap.
//     Same treatment _deriveBeamGraph gives them.
//
//   * computeStats overlay. A component's static `stats` in COMPONENTS is the
//     nominal spec; once the player has parameters on it (PARAM_DEFS[type]),
//     component-physics.js recomputes the stats those parameters actually
//     imply. The computed values overlay the static ones rather than replacing
//     them, so keys computeStats doesn't produce keep their catalogue value.
//     `extractionEnergy` is lifted out of the stats blob because the backend
//     reads it as a top-level element field, computed value winning over the
//     type's default.
//
//   * infraQuality fails CLOSED. On the consumer side an ABSENT quality field
//     means "this component doesn't consume that utility" and defaults to 1.0.
//     So a component that declares a sink but has no solved quality — never
//     wired, therefore present in no network — must be stamped 0, not left
//     absent, or ignoring infrastructure entirely outscores wiring it badly.
//     declaredSinkQualityFloor supplies exactly the utilities the type
//     declares a sink for (nothing else, so unconsumed utilities stay absent =
//     not applicable), and the solved qualities from the gate overlay it. The
//     floor applies even before the gate's first pass has written
//     nodeQualities at all.
//
// The designer has a separate draft payload because it models unsaved edits.
// The main-map aggregate no longer has a second Python payload: it derives its
// facility summary from these authoritative per-beamline results.

import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS, computeStats } from './component-physics.js';
import { declaredSinkQualityFloor } from '../game/utility-gate.js';
import {
  componentActsAsBeamPipe,
  derateStatsForHealth,
} from './component-operation.js';

// Task 6 (staff-professions-3, jobs-and-gates): an uncommissioned component
// (placed after this task, not yet signed off by a matching-specialty
// engineer's 'commission' job — see src/game/staff/jobEffects/commission.js)
// contributes at this fraction of its rated stats. Applied here, not in the
// flattener or the job system, because this is the ONE place every numeric
// stat a component can carry — energyGain, dataRate, beamQuality, whatever a
// future component adds — funnels through on the way to BOTH the real
// physics engine and the Node fallback (_fallbackStatsForBeamline), so
// there is exactly one implementation to keep in sync with COMPONENTS'
// growing stat vocabulary, not one per physics path.
const COMMISSIONING_DERATE = 0.7;

/**
 * Build the physics element array for one beamline.
 *
 * @param {Array} orderedNodes  flattenPath() output: entries carrying
 *   { kind, id, type, params, subL } — `kind: 'drift'` entries have no `type`.
 * @param {Object} ctx
 * @param {Object} [ctx.nodeQualities]  state.nodeQualities, the gate's
 *   per-placeable solved utility qualities keyed by node id. May be absent
 *   (before the first gate pass); declared sinks still get their 0 floor.
 * @returns {Array} elements: { id?, type, subL, stats, params,
 *   betaAcceptance?, apertureRadius?, extractionEnergy?, rfFrequency?,
 *   sourceBeamRadiusMm?, sourceSpaceChargeCompensation?, infraQuality? }
 */
function _buildPhysicsElements(orderedNodes, {
  componentHealth,
  nodeQualities,
  includeInfrastructure = true,
  applyCommissioning = true,
} = {}) {
  return orderedNodes.map(el => {
    const t = COMPONENTS[el.type];
    if (!t) {
      return {
        type: 'drift',
        subL: el.subL || 4,
        stats: {},
        params: el.params || {},
      };
    }
    const effectiveStats = { ...(t.stats || {}) };
    const params = el.params || {};
    let computed = null;
    if (PARAM_DEFS[el.type] && params) {
      computed = computeStats(el.type, params);
    }
    if (computed) {
      Object.assign(effectiveStats, computed);
    }
    if (applyCommissioning && el.needsCommissioning) {
      for (const k of Object.keys(effectiveStats)) {
        if (typeof effectiveStats[k] === 'number') effectiveStats[k] *= COMMISSIONING_DERATE;
      }
    }
    Object.assign(
      effectiveStats,
      derateStatsForHealth(effectiveStats, el.id, componentHealth),
    );
    const physEl = {
      // `id` round-trips so per-cavity physics results (achieved gradient,
      // wall dissipation) can be written back onto the placeable, where the
      // cryogenic solver reads them for next tick's heat load.
      id: el.id,
      type: el.type,
      // Zero is intentional for inline point-slot attachments: they are thin
      // beam elements even though their authored `t.subL` still sizes the mesh.
      subL: el.subL ?? t.subL ?? 4,
      stats: effectiveStats,
      params,
    };
    if (Number.isFinite(t.activeLengthM) && t.activeLengthM >= 0) {
      physEl.activeLengthM = t.activeLengthM;
    }
    if (t.betaAcceptance) {
      physEl.betaAcceptance = { ...t.betaAcceptance };
    }
    if (Number.isFinite(t.rfFrequency) && t.rfFrequency > 0) {
      physEl.rfFrequency = t.rfFrequency;
    }
    if (Number.isFinite(t.sourceBeamRadiusMm) && t.sourceBeamRadiusMm > 0) {
      physEl.sourceBeamRadiusMm = t.sourceBeamRadiusMm;
    }
    if (Number.isFinite(t.sourceSpaceChargeCompensation)) {
      physEl.sourceSpaceChargeCompensation = Math.max(
        0, Math.min(0.999, t.sourceSpaceChargeCompensation));
    }
    // Authored physical half-aperture, in millimetres. gameplay.py converts it
    // to metres before the aperture-loss module runs. Omitting this field makes
    // every component silently inherit the old 50 mm global default, defeating
    // both the authored aperture ladder and any placement preview of beam loss.
    if (Number.isFinite(t.apertureRadius) && t.apertureRadius > 0) {
      physEl.apertureRadius = t.apertureRadius;
    }
    if (computed && computed.extractionEnergy !== undefined) {
      physEl.extractionEnergy = computed.extractionEnergy;
    } else if (t.extractionEnergy !== undefined) {
      physEl.extractionEnergy = t.extractionEnergy;
    }
    if (includeInfrastructure) {
      const nq = nodeQualities?.[el.id];
      const floor = declaredSinkQualityFloor(el.type);
      if (floor || nq) {
        physEl.infraQuality = floor ? { ...floor, ...nq } : nq;
      }
    }
    // Switching out or fully losing a downstream element does not break the
    // physical beam path. Preserve its occupied length (and vacuum service,
    // when present) but remove every active field by handing the solver a
    // drift element. The source is deliberately exempt: its failure is the
    // run gate, not a way to conjure beam from a drift.
    if (componentActsAsBeamPipe(el, componentHealth)) {
      const passive = {
        id: physEl.id,
        type: 'drift',
        subL: physEl.subL,
        stats: {},
        params: {},
      };
      if (physEl.infraQuality?.vacuumQuality !== undefined
          || physEl.infraQuality?.vacuumPressure !== undefined) {
        passive.infraQuality = {};
        if (physEl.infraQuality.vacuumQuality !== undefined) {
          passive.infraQuality.vacuumQuality = physEl.infraQuality.vacuumQuality;
        }
        if (physEl.infraQuality.vacuumPressure !== undefined) {
          passive.infraQuality.vacuumPressure = physEl.infraQuality.vacuumPressure;
        }
      }
      return passive;
    }
    return physEl;
  });
}

export function buildPhysicsElements(orderedNodes, ctx = {}) {
  return _buildPhysicsElements(orderedNodes, {
    componentHealth: ctx.componentHealth,
    nodeQualities: ctx.nodeQualities,
    includeInfrastructure: ctx.includeInfrastructure !== false,
    applyCommissioning: ctx.applyCommissioning !== false,
  });
}

/**
 * Build an ideal-services payload for an unsaved Beamline Designer draft.
 * Draft nodes have no map utility endpoints yet, so applying the production
 * fail-closed utility floor would report every hovered component as unpowered.
 * All catalogue/parameter physics fields still go through the same builder as
 * the live game, including beta acceptance and physical aperture.
 */
export function buildDesignerPhysicsElements(draftNodes) {
  return _buildPhysicsElements(draftNodes, {
    componentHealth: null,
    includeInfrastructure: false,
    applyCommissioning: false,
  });
}
