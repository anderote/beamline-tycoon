// Shared zoom policy for utility-line presentation. Utilities retain their
// coloured route silhouette at every distance; only fittings, supports,
// ambient effects, and flexible-route tessellation cross this LOD boundary.

// Minor Lab contains hundreds of service runs. Restoring every fitting,
// support, jacket and high-tessellation flexible cable at the same zoom as
// the main object silhouettes raises the visible scene by thousands of draw
// submissions and can saturate Chrome's WebGPU queue while the camera moves.
// Keep the merged route silhouette through the ordinary object-detail band;
// restore construction detail only once the tighter camera frustum makes it
// useful and naturally culls most of the facility.
export const UTILITY_DETAIL_ENTER_ZOOM = 3.0;
export const UTILITY_DETAIL_EXIT_ZOOM = 2.65;

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
