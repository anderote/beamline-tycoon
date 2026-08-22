// Shared zoom policy for utility-line presentation. Utilities retain their
// coloured route silhouette at every distance; only fittings, supports,
// ambient effects, and flexible-route tessellation cross this LOD boundary.

export const UTILITY_DETAIL_ENTER_ZOOM = 2.0;
export const UTILITY_DETAIL_EXIT_ZOOM = 1.7;

/**
 * Resolve the next utility detail state with hysteresis, preventing repeated
 * visibility/geometry swaps when wheel input settles near one threshold.
 */
export function utilityDetailForZoom(zoom, currentDetail = undefined) {
  const value = Number(zoom);
  if (!Number.isFinite(value)) return currentDetail !== false;
  if (currentDetail === true) return value > UTILITY_DETAIL_EXIT_ZOOM;
  if (currentDetail === false) return value >= UTILITY_DETAIL_ENTER_ZOOM;
  return value >= UTILITY_DETAIL_ENTER_ZOOM;
}
