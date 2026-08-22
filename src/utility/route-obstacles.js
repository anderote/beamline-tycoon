// src/utility/route-obstacles.js
//
// Board-aware obstacle map for rigid utility services. The generic orthogonal
// router in line-geometry.js intentionally knows nothing about game state;
// this module translates installed equipment and any services that truly need
// plan-view separation into the simple `blocked(col,row)` predicate it consumes.

import { COMPONENTS } from '../data/components.js';
import { expandPath } from './line-geometry.js';
import { placeableCenterWorld, footprintHalfExtents } from './ports.js';
import { UTILITY_TYPES } from './registry.js';
import { listUtilityEndpoints } from './utility-endpoints.js';

const SUB_PER_TILE = 4;

function q(v) { return Math.round(v * SUB_PER_TILE); }
function key(x, y) { return `${x}:${y}`; }

function lookupDef(state, type) {
  if (state?.defs) {
    if (typeof state.defs.get === 'function') return state.defs.get(type) || null;
    return state.defs[type] || null;
  }
  return COMPONENTS[type] || null;
}

export function isRigidRoutedUtility(utilityType) {
  return UTILITY_TYPES[utilityType]?.routingProfile === 'rigid';
}

/** Whether two installed service centre-lines must not cross or overlap. */
export function rigidUtilitiesConflict(a, b) {
  const da = UTILITY_TYPES[a];
  const db = UTILITY_TYPES[b];
  return !!(da?.avoidRigidIntersections && db?.avoidRigidIntersections);
}

function addClearanceDisk(out, x, y, radiusSteps) {
  for (let dx = -radiusSteps; dx <= radiusSteps; dx++) {
    for (let dy = -radiusSteps; dy <= radiusSteps; dy++) {
      // Match line-drawing's axis-aligned fitting envelope exactly. A diamond
      // here would let A* choose the diagonal corner of another rigid run's
      // clearance square, only for the commit validator to reject that route.
      out.add(key(x + dx, y + dy));
    }
  }
}

function addLineObstacles(out, state, utilityType, opts) {
  const candidate = UTILITY_TYPES[utilityType] || {};
  const sharedClearances = [];
  const iter = state?.utilityLines && typeof state.utilityLines.values === 'function'
    ? state.utilityLines.values() : (state?.utilityLines || []);
  for (const line of iter) {
    if (!line || !rigidUtilitiesConflict(utilityType, line.utilityType)) continue;
    const other = UTILITY_TYPES[line.utilityType] || {};
    const clearanceTiles = Math.max(
      candidate.routeClearanceTiles || 0,
      other.routeClearanceTiles || 0,
    );
    const radiusSteps = Math.max(0, Math.ceil(clearanceTiles * SUB_PER_TILE - 1e-6));
    const expanded = expandPath(line.path || []);
    for (const point of expanded) {
      addClearanceDisk(out, q(point.col), q(point.row), radiusSteps);
    }
    // A reusable rigid source is a real manifold junction. Reserve the same
    // fitting envelope the overlap validator allows, so A* can leave a source
    // that already has a run instead of finding itself boxed inside that run's
    // clearance halo.
    for (const newRef of [opts.startRef, opts.endRef]) {
      if (!newRef) continue;
      for (const [lineRef, lineIndex] of [[line.start, 0], [line.end, expanded.length - 1]]) {
        if (!lineRef || lineRef.placeableId !== newRef.placeableId) continue;
        const point = expanded[lineIndex];
        if (point) sharedClearances.push({ x: q(point.col), y: q(point.row), radiusSteps });
      }
    }
  }
  for (const shared of sharedClearances) {
    for (let dx = -shared.radiusSteps; dx <= shared.radiusSteps; dx++) {
      for (let dy = -shared.radiusSteps; dy <= shared.radiusSteps; dy++) {
        out.delete(key(shared.x + dx, shared.y + dy));
      }
    }
  }
}

function rotatedHalfExtentsTiles(placeable, def) {
  const half = footprintHalfExtents(def);
  const turn = (((placeable?.dir || 0) % 4) + 4) % 4;
  const swap = turn === 1 || turn === 3;
  return {
    col: (swap ? half.z : half.x) / 2,
    row: (swap ? half.x : half.z) / 2,
  };
}

/**
 * Physical X/Z centre of an endpoint's rendered model.
 *
 * Ordinary placeables use a top-left footprint origin, so
 * placeableCenterWorld is already authoritative. Beam-pipe placements are the
 * exception: their synthesized utility record keeps negative subtile offsets
 * for solver footprint arithmetic, while `col`/`row` identify a beam-pipe
 * tile centre rendered at `col * 2 + 1`, `row * 2 + 1`. Treating that logical
 * record as an ordinary placeable shifts its obstacle one metre north-west —
 * rejecting clear routes beside the model and permitting routes through its
 * opposite edge.
 */
function physicalEndpointCenterWorld(placeable, def) {
  if (placeable?.pipeId
      && !(Number.isFinite(placeable.worldX) && Number.isFinite(placeable.worldZ))) {
    return {
      x: (placeable.col || 0) * 2 + 1,
      z: (placeable.row || 0) * 2 + 1,
    };
  }
  return placeableCenterWorld(placeable, def);
}

function addEquipmentObstacles(out, state, utilityType, ignoredPlaceableIds) {
  const descriptor = UTILITY_TYPES[utilityType] || {};
  const clearance = Math.max(0, descriptor.equipmentClearanceTiles || 0);
  for (const placeable of listUtilityEndpoints(state || {})) {
    if (!placeable?.id || ignoredPlaceableIds.has(placeable.id)) continue;
    const def = lookupDef(state, placeable.type);
    if (!def) continue;
    const center = physicalEndpointCenterWorld(placeable, def);
    if (!center) continue;
    const half = rotatedHalfExtentsTiles(placeable, def);
    const centerCol = center.x / 2;
    const centerRow = center.z / 2;
    const minX = Math.ceil((centerCol - half.col - clearance) * SUB_PER_TILE - 1e-6);
    const maxX = Math.floor((centerCol + half.col + clearance) * SUB_PER_TILE + 1e-6);
    const minY = Math.ceil((centerRow - half.row - clearance) * SUB_PER_TILE - 1e-6);
    const maxY = Math.floor((centerRow + half.row + clearance) * SUB_PER_TILE + 1e-6);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) out.add(key(x, y));
    }
  }
}

/**
 * Build a reusable obstacle predicate for one drag/validation pass.
 *
 * The source and destination machines are omitted: their connector and riser
 * geometry own the transition through their footprint. Every other placeable
 * is solid. Fabricated vacuum, cryogenic, and RF runs do not become 2D
 * obstacles to one another: commit validation assigns a clear support-rack
 * elevation when their plan routes meet.
 */
export function buildRigidRouteObstacles(state, utilityType, opts = {}) {
  const blocked = new Set();
  const ignored = new Set([
    opts.startRef?.placeableId,
    opts.endRef?.placeableId,
  ].filter(Boolean));
  if (opts.includeLines !== false) addLineObstacles(blocked, state, utilityType, opts);
  if (opts.includeEquipment !== false) addEquipmentObstacles(blocked, state, utilityType, ignored);
  return {
    blocked,
    isBlocked(col, row) { return blocked.has(key(q(col), q(row))); },
  };
}
