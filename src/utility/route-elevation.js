// Height lanes for fabricated rigid utility services.
//
// Routing and pricing remain two-dimensional: a saved line still owns one
// Manhattan X/Z path. Vacuum pipe, cryogenic transfer line, and RF
// waveguide may additionally store `routeHeightMeters`, which lets two
// independent services share that path without occupying the same volume.
// Topology considers the height when deciding whether an endpoint-on-line
// contact is a real fitting. This module is dependency-neutral with respect
// to rendering; validation, discovery, input, and rendering share the contract.

import { UTILITY_TYPES, utilityLineHeight } from './registry.js';

const EPS = 1e-6;
const DEFAULT_LANE_SPACING_METERS = 0.30;
const DEFAULT_MAX_ROUTE_HEIGHT_METERS = 3.0;
const DEFAULT_VERTICAL_CLEARANCE_METERS = 0.06;

function finite(value) { return Number.isFinite(value); }

function roundedHeight(value) {
  return Math.round(value * 1000) / 1000;
}

function lineIterable(lines) {
  if (lines && typeof lines.values === 'function') return lines.values();
  return lines || [];
}

/** Whether this utility may resolve 2D route conflicts by using another Y lane. */
export function usesVerticalRouteLanes(utilityType) {
  return UTILITY_TYPES[utilityType]?.verticalRouteLanes === true;
}

/** Stored line height, falling back to the descriptor's original deck height. */
export function routeHeightForLine(line) {
  if (!line) return 0;
  return utilityLineHeight(line.utilityType, line.routeHeightMeters);
}

/** Half-height of the service body around its routed centreline. */
export function routeBodyHalfHeight(utilityType) {
  const descriptor = UTILITY_TYPES[utilityType] || {};
  const radius = finite(descriptor.pipeRadiusMeters) ? descriptor.pipeRadiusMeters : 0.05;
  if (descriptor.geometryStyle === 'jacketedCylinder') return radius * 1.6;
  if (descriptor.geometryStyle === 'rectWaveguide') return radius * 0.7;
  return radius;
}

/** True when two centreline elevations still make their service bodies collide. */
export function routeHeightsConflict(typeA, heightA, typeB, heightB) {
  if (!usesVerticalRouteLanes(typeA) || !usesVerticalRouteLanes(typeB)) return true;
  const descriptorA = UTILITY_TYPES[typeA] || {};
  const descriptorB = UTILITY_TYPES[typeB] || {};
  const clearance = Math.max(
    descriptorA.routeVerticalClearanceMeters ?? DEFAULT_VERTICAL_CLEARANCE_METERS,
    descriptorB.routeVerticalClearanceMeters ?? DEFAULT_VERTICAL_CLEARANCE_METERS,
  );
  const needed = routeBodyHalfHeight(typeA) + routeBodyHalfHeight(typeB) + clearance;
  return Math.abs(heightA - heightB) < needed - EPS;
}

/**
 * Candidate lanes ordered from the start connector's preferred height upward.
 * Rigid services stay on supportable racks; the router never silently sends a
 * run under another service or below its descriptor's original deck height.
 */
export function routeHeightCandidates(utilityType, preferredHeight) {
  const descriptor = UTILITY_TYPES[utilityType] || {};
  const base = utilityLineHeight(utilityType);
  const spacing = Math.max(
    0.05,
    descriptor.routeLaneSpacingMeters ?? DEFAULT_LANE_SPACING_METERS,
  );
  // Some fabricated services own a fixed low rack and use endpoint risers to
  // reach fittings at arbitrary authored heights. Keep that policy here, at
  // the lane authority, so ordinary drags, bulk wiring, copying, and headless
  // callers cannot accidentally invent a different ladder from port Y.
  const requested = descriptor.routeAtBaseHeight
    ? base
    : (finite(preferredHeight) ? preferredHeight : base);
  // An authored connector above the ordinary rack search limit still owns its
  // first lane. The limit caps automatic stacking; it must not pull a route
  // downward from the physical port that starts it.
  const maxHeight = Math.max(
    base,
    requested,
    descriptor.maxRouteHeightMeters ?? DEFAULT_MAX_ROUTE_HEIGHT_METERS,
  );
  const first = roundedHeight(Math.max(base, requested));
  const out = [first];
  for (let height = first + spacing; height <= maxHeight + EPS; height += spacing) {
    out.push(roundedHeight(Math.min(height, maxHeight)));
  }
  return [...new Set(out)];
}

/**
 * Resolve the elevation of explicitly tapped trunks. A branch is a physical
 * tee and must meet its trunk on the same lane; two requested trunks on
 * different lanes cannot be joined by an implicit vertical fitting.
 */
export function tappedRouteHeight(lines, tapLineIds, utilityType) {
  const wanted = new Set([tapLineIds?.start, tapLineIds?.end].filter(Boolean));
  if (wanted.size === 0) return { height: null, mismatch: false };
  const heights = [];
  for (const line of lineIterable(lines)) {
    if (!line?.id || !wanted.has(line.id) || line.utilityType !== utilityType) continue;
    heights.push(routeHeightForLine(line));
  }
  if (heights.length === 0) return { height: null, mismatch: false };
  const first = heights[0];
  return {
    height: first,
    mismatch: heights.some(height => Math.abs(height - first) > EPS),
  };
}
