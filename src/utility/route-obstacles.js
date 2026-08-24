// src/utility/route-obstacles.js
//
// Board-aware obstacle map for every utility service. The generic orthogonal
// router knows nothing about game state; this module performs a cheap footprint
// broad phase, then asks the renderer's measured model lookup whether the line
// body at its actual Y datum intersects real 3D geometry.

import { COMPONENTS } from '../data/components.js';
import { expandPath } from './line-geometry.js';
import { placeableCenterWorld, footprintHalfExtents, rotateLocalOffset } from './ports.js';
import { UTILITY_TYPES, utilityLineHeight } from './registry.js';
import { routeBodyHalfHeight, usesFixedRouteHeight } from './route-elevation.js';
import { cableSkipsEquipmentCollision } from './soft-cable.js';
import {
  hasUtilityCollisionProvider,
  utilityModelEnvelopeIntersects,
} from './utility-collision.js';
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

/** Whether an installed same-type line remains an obstacle to this router. */
function fixedHeightUtilitiesConflict(a, b) {
  return a === b
    && UTILITY_TYPES[a]?.joinsOnContact !== true
    && usesFixedRouteHeight(a)
    && usesFixedRouteHeight(b);
}

function addClearanceDiskWithFittings(out, x, y, radiusSteps, sharedFittings) {
  for (let dx = -radiusSteps; dx <= radiusSteps; dx++) {
    for (let dy = -radiusSteps; dy <= radiusSteps; dy++) {
      const candidateX = x + dx;
      const candidateY = y + dy;
      const insideSharedFitting = sharedFittings.some(shared =>
        Math.max(Math.abs(x - shared.x), Math.abs(y - shared.y)) <= shared.radiusSteps
        && Math.max(
          Math.abs(candidateX - shared.x),
          Math.abs(candidateY - shared.y),
        ) <= shared.radiusSteps);
      if (!insideSharedFitting) out.add(key(candidateX, candidateY));
    }
  }
}

function addLineObstacles(out, state, utilityType, opts) {
  const candidate = UTILITY_TYPES[utilityType] || {};
  const iter = state?.utilityLines && typeof state.utilityLines.values === 'function'
    ? state.utilityLines.values() : (state?.utilityLines || []);
  for (const line of iter) {
    if (!line || !fixedHeightUtilitiesConflict(utilityType, line.utilityType)) continue;
    const other = UTILITY_TYPES[line.utilityType] || {};
    const clearanceTiles = Math.max(
      candidate.routeClearanceTiles || 0.25,
      other.routeClearanceTiles || 0.25,
    );
    const radiusSteps = Math.max(0, Math.ceil(clearanceTiles * SUB_PER_TILE - 1e-6));
    const expanded = expandPath(line.path || []);
    // A reusable rigid source is a real manifold junction. Reserve the same
    // fitting envelope the overlap validator allows, so A* can leave a source
    // that already has a run instead of finding itself boxed inside that run's
    // clearance halo.
    const sharedFittings = [];
    for (const newRef of [opts.startRef, opts.endRef]) {
      if (!newRef) continue;
      for (const [lineRef, lineIndex] of [[line.start, 0], [line.end, expanded.length - 1]]) {
        if (!lineRef || lineRef.placeableId !== newRef.placeableId) continue;
        const point = expanded[lineIndex];
        if (point) sharedFittings.push({
          x: q(point.col),
          y: q(point.row),
          // The physical multi-branch fitting owns twice the ordinary line
          // clearance so several runs can fan out before their aisles separate.
          radiusSteps: radiusSteps * 2,
        });
      }
    }
    for (const point of expanded) {
      const x = q(point.col);
      const y = q(point.row);
      // Exempt a raster cell only when both it and the installed centreline
      // point belong to the same shared fitting. This mirrors validation's
      // pairwise exemption exactly; deleting the whole fitting square would
      // also erase the halo of pipe just outside it.
      addClearanceDiskWithFittings(out, x, y, radiusSteps, sharedFittings);
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

function addEquipmentObstacles(
  out, state, utilityType, ignoredPlaceableIds, equipmentPoints = null,
  routeHeightMeters = null,
) {
  // Loose power, HV and data cable is intentionally player-friendly: its
  // topology and wall rules still apply, but arbitrary model triangles do not
  // force fiddly detours or reject a freehand gesture. Fabricated services and
  // cooling hose retain measured physical clearance.
  if (cableSkipsEquipmentCollision(utilityType)) return;
  if (!hasUtilityCollisionProvider()) return;
  const descriptor = UTILITY_TYPES[utilityType] || {};
  const clearance = 0;
  // Water supply pipe owns two fixed datums. Routing and commit validation
  // must test the circuit's actual elevation; falling back to the descriptor's
  // cold datum makes a clear hot return detour around cold-level equipment.
  const runY = utilityLineHeight(utilityType, routeHeightMeters);
  const bodyHalfHeight = routeBodyHalfHeight(utilityType);
  const radius = descriptor.pipeRadiusMeters || 0.02;
  const bodyHalfWidth = descriptor.geometryStyle === 'jacketedCylinder'
    ? radius * 1.6 : radius;
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
    const testPoint = (x, y, pointCol = x / SUB_PER_TILE, pointRow = y / SUB_PER_TILE) => {
      const worldX = pointCol * 2;
      const worldZ = pointRow * 2;
      const inverseDir = (4 - (((placeable.dir || 0) % 4) + 4) % 4) % 4;
      const local = rotateLocalOffset({
        x: worldX - center.x,
        z: worldZ - center.z,
      }, inverseDir);
      const baseY = (Number.isFinite(placeable.placeY) ? placeable.placeY : 0) * 0.5;
      if (utilityModelEnvelopeIntersects(placeable.type, {
        minX: local.x - bodyHalfWidth,
        maxX: local.x + bodyHalfWidth,
        minY: runY - baseY - bodyHalfHeight,
        maxY: runY - baseY + bodyHalfHeight,
        minZ: local.z - bodyHalfWidth,
        maxZ: local.z + bodyHalfWidth,
      })) out.add(key(x, y));
    };
    if (equipmentPoints) {
      // Commit validation already knows the candidate path. Use those cells as
      // the first lookup and touch model triangles only where both it and this
      // footprint agree, instead of filling every footprint six times per
      // mousemove while the controller walks ranked candidates.
      for (const point of equipmentPoints) {
        const x = q(point.col);
        const y = q(point.row);
        if (point.col >= centerCol - half.col - clearance - 1e-6
            && point.col <= centerCol + half.col + clearance + 1e-6
            && point.row >= centerRow - half.row - clearance - 1e-6
            && point.row <= centerRow + half.row + clearance + 1e-6) {
          // Preserve the player's exact freehand coordinate for the measured
          // 3D envelope. The quantized key is only how the caller asks whether
          // this already-tested sample was blocked.
          testPoint(x, y, point.col, point.row);
        }
      }
    } else {
      // A* needs a reusable board map because it has no candidate path yet.
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) testPoint(x, y);
      }
    }
  }
}

/**
 * Build a reusable obstacle predicate for one drag/validation pass.
 *
 * The source and destination machines are omitted: their connector/perimeter
 * transition owns the local wrap. For collision-participating services, other
 * placeables block only at grid points where the measured model geometry
 * intersects the utility body's 3D envelope. Loose power/HV/data cable ignores
 * equipment geometry entirely.
 * With no renderer provider, no footprint-only equipment obstacles are added.
 */
export function buildUtilityRouteObstacles(state, utilityType, opts = {}) {
  const blocked = new Set();
  const ignored = new Set([
    opts.startRef?.placeableId,
    opts.endRef?.placeableId,
  ].filter(Boolean));
  if (opts.includeLines !== false) addLineObstacles(blocked, state, utilityType, opts);
  if (opts.includeEquipment !== false) {
    addEquipmentObstacles(
      blocked, state, utilityType, ignored, opts.equipmentPoints || null,
      opts.routeHeightMeters ?? null);
  }
  return {
    blocked,
    isBlocked(col, row) { return blocked.has(key(q(col), q(row))); },
  };
}
