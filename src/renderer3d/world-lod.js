// General-world detail policy. While object LOD is enabled (the default), zoom
// alone controls whether authored geometry or the cached type-specific
// silhouettes are shown. A facility-size gate made the same object occupy the
// same number of screen pixels but render differently merely because unrelated
// objects had been added elsewhere in the world.

export const WORLD_DETAIL_ZOOM_ENTER = 2.15;
export const WORLD_DETAIL_ZOOM_EXIT = 1.85;

export function worldDetailForZoom(zoom, previous = true) {
  const z = Number.isFinite(zoom) ? zoom : 1;
  return previous === false
    ? z >= WORLD_DETAIL_ZOOM_ENTER
    : z >= WORLD_DETAIL_ZOOM_EXIT;
}
