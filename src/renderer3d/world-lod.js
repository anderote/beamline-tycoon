// General-world detail policy. Small and ordinary facilities keep the full
// authored presentation at every zoom. Once pipe-mounted hardware reaches a
// genuinely large-game scale, zoomed-out views switch to cheap but
// type-specific silhouettes so the GPU cost follows what is actually visible.

export const LARGE_WORLD_ATTACHMENT_THRESHOLD = 1000;
export const WORLD_DETAIL_ZOOM_ENTER = 2.15;
export const WORLD_DETAIL_ZOOM_EXIT = 1.85;

export function worldDetailForZoom(zoom, attachmentCount, previous = true) {
  if ((attachmentCount || 0) < LARGE_WORLD_ATTACHMENT_THRESHOLD) return true;
  const z = Number.isFinite(zoom) ? zoom : 1;
  return previous === false
    ? z >= WORLD_DETAIL_ZOOM_ENTER
    : z >= WORLD_DETAIL_ZOOM_EXIT;
}
