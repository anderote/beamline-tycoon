// Pure event-to-renderer invalidation policy. Keeping this out of
// ThreeRenderer makes the performance contract directly testable without a
// browser or graphics device.

import { isScopedPlaceableMutation } from '../game/placeable-events.js';
import { worldChangeFromPayload } from '../game/world-change-set.js';

const EMPTY = Object.freeze({});

const LEGACY_PLACEABLE = Object.freeze({
  equipment: true,
  decorations: true,
  components: true,
  pipeAttachments: true,
  utilityLines: true,
  utilityIssues: 'force',
  portFittings: true,
  physicsBodies: true,
});

const LEGACY_FACILITY = Object.freeze({
  equipment: true,
  components: true,
  physicsBodies: true,
});

const LEGACY_ZONES = Object.freeze({
  terrain: true,
  zones: true,
  decorations: true,
  palette: true,
});

const SCOPED_ZONE_FOLLOWUP = Object.freeze({ palette: true });

function scopedPlaceablePlan(data) {
  const terrain = data.terrainChanged === true;
  switch (data.kind) {
    case 'furnishing':
      return { terrain, equipment: true, physicsBodies: true };
    case 'equipment':
      return {
        terrain,
        equipment: true,
        utilityLines: true,
        utilityIssues: 'force',
        portFittings: true,
        physicsBodies: true,
      };
    case 'decoration':
      return { terrain, decorations: true, physicsBodies: true };
    case 'infrastructure':
      return {
        terrain,
        components: true,
        utilityLines: true,
        utilityIssues: 'force',
        portFittings: true,
        physicsBodies: true,
      };
    case 'beamline':
      return {
        terrain,
        components: true,
        utilityLines: true,
        utilityIssues: 'force',
        portFittings: true,
        physicsBodies: true,
      };
    default:
      return LEGACY_PLACEABLE;
  }
}

function mergeFlags(target, incoming) {
  for (const [key, value] of Object.entries(incoming || {})) {
    if (key === 'utilityIssues') {
      if (value === 'force' || !target.utilityIssues) target.utilityIssues = value;
    } else if (value) {
      target[key] = true;
    }
  }
  return target;
}

function canonicalPlaceablePlan(data) {
  const changeSet = worldChangeFromPayload(data);
  if (!changeSet) return null;
  const plan = {};
  if (changeSet.domains.has('terrain')) plan.terrain = true;
  for (const change of changeSet.placeables.values()) {
    mergeFlags(plan, scopedPlaceablePlan({
      kind: change.kind,
      terrainChanged: false,
    }));
  }
  return plan;
}

export function placeableRefreshPlan(event, data) {
  const canonical = canonicalPlaceablePlan(data);
  const scoped = canonical || isScopedPlaceableMutation(data);
  if (event === 'placeableChanged') {
    if (canonical) return canonical;
    return scoped ? scopedPlaceablePlan(data) : LEGACY_PLACEABLE;
  }
  if (event === 'facilityChanged') {
    // Scoped equipment placement was fully handled by placeableChanged. This
    // compatibility event still reaches UI listeners but costs no second 3D
    // rebuild.
    return scoped ? EMPTY : LEGACY_FACILITY;
  }
  if (event === 'zonesChanged') {
    // Furnishing placement does not mutate zone paint or room boundaries.
    // Preserve the palette refresh expected by UI consumers without walking
    // terrain, zones, decorations, and light pools again.
    return scoped ? SCOPED_ZONE_FOLLOWUP : LEGACY_ZONES;
  }
  return null;
}
