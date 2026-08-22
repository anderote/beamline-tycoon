// Fixed elevations for fabricated utility services.
//
// Routing and pricing remain two-dimensional: a saved line still owns one
// Manhattan X/Z path. Vacuum pipe, cryogenic transfer line, and RF waveguide
// each own one facility-wide Y datum. Different fixed-height utilities may therefore
// share plan routes. Vacuum, cryogenic, and RF runs on their own datum join
// automatically wherever their exact plan routes touch.

import { UTILITY_TYPES, utilityLineHeight } from './registry.js';

const EPS = 1e-6;
const DEFAULT_VERTICAL_CLEARANCE_METERS = 0.06;

function finite(value) { return Number.isFinite(value); }

/** Whether this utility owns one mandatory facility-wide route elevation. */
export function usesFixedRouteHeight(utilityType) {
  return UTILITY_TYPES[utilityType]?.fixedRouteHeight === true;
}

/** Physical line height; fixed services ignore obsolete saved lane values. */
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
  if (!usesFixedRouteHeight(typeA) || !usesFixedRouteHeight(typeB)) return true;
  const descriptorA = UTILITY_TYPES[typeA] || {};
  const descriptorB = UTILITY_TYPES[typeB] || {};
  const clearance = Math.max(
    descriptorA.routeVerticalClearanceMeters ?? DEFAULT_VERTICAL_CLEARANCE_METERS,
    descriptorB.routeVerticalClearanceMeters ?? DEFAULT_VERTICAL_CLEARANCE_METERS,
  );
  const needed = routeBodyHalfHeight(typeA) + routeBodyHalfHeight(typeB) + clearance;
  return Math.abs(heightA - heightB) < needed - EPS;
}
