// Dense-scene finishing policy. Emissive materials, animated effects,
// sun/ambient lighting, and painted fixture pools are independent of this
// decision; it controls only composed bloom and the analytic local-light rig.

export const DENSE_POST_PROCESSING_OBJECT_LIMIT = 800;

export function postProcessingObjectCount(snapshot = {}) {
  return [
    snapshot.components,
    snapshot.equipment,
    snapshot.furnishings,
    snapshot.decorations,
    snapshot.utilityLines,
    snapshot.pipeAttachments,
  ].reduce((sum, records) => sum + (records?.length || 0), 0);
}

export function shouldSuppressDensePostProcessing(snapshot, {
  limit = DENSE_POST_PROCESSING_OBJECT_LIMIT,
} = {}) {
  return postProcessingObjectCount(snapshot) >= limit;
}
