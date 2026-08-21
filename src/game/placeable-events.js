// Metadata shared by Game's placeable mutation seam and renderer consumers.
// The event name remains stable for every existing listener; the payload lets
// expensive consumers invalidate only the world sections the mutation can
// actually affect.

export const PLACEABLE_MUTATION_EVENT_SOURCE = 'placeable-mutation';

export function placeableMutationEvent(entry, action, { terrainChanged = false } = {}) {
  return {
    source: PLACEABLE_MUTATION_EVENT_SOURCE,
    action,
    placeableId: entry?.id ?? null,
    kind: entry?.kind ?? entry?.category ?? null,
    terrainChanged: terrainChanged === true,
  };
}

export function isScopedPlaceableMutation(data) {
  return data?.source === PLACEABLE_MUTATION_EVENT_SOURCE
    && typeof data.kind === 'string';
}
