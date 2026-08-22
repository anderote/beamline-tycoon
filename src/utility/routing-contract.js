// One construction contract shared by every utility type.
//
// Routes live on the quarter-tile service grid: one step is one 0.5 m subtile.
// Fittings may turn immediately, and their authored normals are preferences
// used to rank attractive perimeter wraps rather than placement constraints.

export const FLEXIBLE_SUBTILE_ROUTING_PROFILE = 'flexibleSubtile';
export const UTILITY_ROUTE_STEP_TILES = 0.25;
export const UTILITY_PORT_LEAD_TILES = UTILITY_ROUTE_STEP_TILES;

const EPS = 1e-6;

export function snapUtilityRouteCoordinate(value) {
  return Math.round(value / UTILITY_ROUTE_STEP_TILES) * UTILITY_ROUTE_STEP_TILES;
}

export function isUtilityRouteCoordinate(value) {
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - snapUtilityRouteCoordinate(value)) <= EPS;
}

export function usesFlexibleSubtileRouting(descriptor) {
  return descriptor?.routingProfile === FLEXIBLE_SUBTILE_ROUTING_PROFILE;
}
