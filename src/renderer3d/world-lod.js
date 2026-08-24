// General-world detail policy. Small and ordinary facilities keep the full
// authored presentation at every zoom. Once the complete modeled world reaches
// a genuinely large-game scale, zoomed-out views switch to cheap but
// type-specific silhouettes so the GPU cost follows what is actually visible.
//
// This used to count pipe attachments alone. That made the policy blind to the
// dominant content in ordinary authored maps: Minor Lab has ~1,450 modeled
// placeables (including ~1,200 trees), but only a dozen pipe attachments. The
// far meshes were built and then never shown.

export const LARGE_WORLD_OBJECT_THRESHOLD = 1000;
export const WORLD_DETAIL_ZOOM_ENTER = 2.15;
export const WORLD_DETAIL_ZOOM_EXIT = 1.85;

/** Count the modeled placeables whose authored geometry participates in LOD. */
export function modeledWorldObjectCount(snapshot) {
  return (snapshot?.components?.length || 0)
    + (snapshot?.pipeAttachments?.length || 0)
    + (snapshot?.equipment?.length || 0)
    + (snapshot?.furnishings?.length || 0)
    + (snapshot?.decorations?.length || 0);
}

export function worldDetailForZoom(zoom, modeledObjectCount, previous = true) {
  if ((modeledObjectCount || 0) < LARGE_WORLD_OBJECT_THRESHOLD) return true;
  const z = Number.isFinite(zoom) ? zoom : 1;
  return previous === false
    ? z >= WORLD_DETAIL_ZOOM_ENTER
    : z >= WORLD_DETAIL_ZOOM_EXIT;
}
