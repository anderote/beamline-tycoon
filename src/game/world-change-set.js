// Canonical description of a world mutation. Domain code publishes facts
// here; renderers and other consumers decide which derived caches those facts
// invalidate. Sets/Maps are intentional: a transaction can merge hundreds of
// tile or entity edits without duplicating work or losing the first edit when
// Game batches events by name.

export const WORLD_CHANGE_SET_SOURCE = 'world-change-set';
export const WORLD_CHANGED_EVENT = 'worldChanged';

const LEGACY_EVENT_DOMAINS = Object.freeze({
  beamlineChanged: ['beamline'],
  infrastructureChanged: ['terrain', 'infrastructure'],
  decorationsChanged: ['terrain', 'decorations'],
  wallsChanged: ['walls'],
  doorsChanged: ['walls'],
  windowsChanged: ['walls'],
  connectionsChanged: ['connections'],
  utilityLinesChanged: ['utilityLines'],
});

const ACTION_ALIASES = Object.freeze({
  placed: 'added',
  added: 'added',
  moved: 'updated',
  changed: 'updated',
  updated: 'updated',
  removed: 'removed',
  lifted: 'removed',
});

function normalizedAction(action) {
  return ACTION_ALIASES[action] || 'updated';
}

export function createWorldChangeSet({
  full = false,
  reason = null,
  domains = [],
  terrainTiles = [],
  placeables = [],
} = {}) {
  const changeSet = {
    source: WORLD_CHANGE_SET_SOURCE,
    full: full === true,
    reasons: new Set(),
    domains: new Set(domains),
    terrainTiles: new Set(terrainTiles),
    placeables: new Map(),
  };
  if (reason) changeSet.reasons.add(reason);
  for (const change of placeables) addPlaceableChange(changeSet, change);
  return changeSet;
}

export function isWorldChangeSet(value) {
  return value?.source === WORLD_CHANGE_SET_SOURCE
    && value.reasons instanceof Set
    && value.domains instanceof Set
    && value.terrainTiles instanceof Set
    && value.placeables instanceof Map;
}

/**
 * Merge one placeable transition into a change-set. The transition table
 * preserves the net result of a transaction: add+update stays added,
 * add+remove cancels, update+remove becomes removed, and remove+add is a
 * replacement update of an existing stable id.
 */
export function addPlaceableChange(changeSet, {
  id,
  kind = null,
  action = 'updated',
} = {}) {
  if (!isWorldChangeSet(changeSet) || id == null) return changeSet;
  const incoming = normalizedAction(action);
  const previous = changeSet.placeables.get(id);
  if (!previous) {
    changeSet.placeables.set(id, { id, kind, action: incoming });
    return changeSet;
  }

  const previousAction = previous.action;
  let nextAction = incoming;
  if (previousAction === 'added') {
    if (incoming === 'removed') {
      changeSet.placeables.delete(id);
      return changeSet;
    }
    nextAction = 'added';
  } else if (previousAction === 'removed' && incoming === 'added') {
    nextAction = 'updated';
  } else if (previousAction === 'updated' && incoming === 'removed') {
    nextAction = 'removed';
  }
  changeSet.placeables.set(id, {
    id,
    kind: kind ?? previous.kind,
    action: nextAction,
  });
  return changeSet;
}

export function mergeWorldChangeSets(...values) {
  const merged = createWorldChangeSet();
  for (const value of values) {
    if (!isWorldChangeSet(value)) continue;
    merged.full ||= value.full;
    for (const reason of value.reasons) merged.reasons.add(reason);
    for (const domain of value.domains) merged.domains.add(domain);
    for (const tile of value.terrainTiles) merged.terrainTiles.add(tile);
    for (const change of value.placeables.values()) addPlaceableChange(merged, change);
  }
  return merged;
}

export function placeableWorldChange(entry, action, {
  terrainChanged = false,
  affectedEntries = [],
} = {}) {
  const changeSet = createWorldChangeSet({ reason: `placeable:${action}` });
  changeSet.domains.add('placeables');
  addPlaceableChange(changeSet, {
    id: entry?.id,
    kind: entry?.kind ?? entry?.category ?? null,
    action,
  });
  for (const affected of affectedEntries) {
    addPlaceableChange(changeSet, {
      id: affected?.id,
      kind: affected?.kind ?? affected?.category ?? null,
      action: 'updated',
    });
  }
  if (terrainChanged) changeSet.domains.add('terrain');
  return changeSet;
}

export function worldChangePayload(changeSet, metadata = {}) {
  return { ...metadata, changeSet };
}

export function worldChangeFromPayload(payload) {
  if (isWorldChangeSet(payload)) return payload;
  return isWorldChangeSet(payload?.changeSet) ? payload.changeSet : null;
}

/**
 * Adapt the existing public event vocabulary to the canonical world stream.
 * Exact placeable payloads keep their entity patches; older callers receive a
 * conservative domain fact until they migrate to exact IDs.
 */
export function worldChangeForEvent(event, payload) {
  if (event === WORLD_CHANGED_EVENT) return worldChangeFromPayload(payload);
  if (event === 'loaded' || event === 'restored') {
    return createWorldChangeSet({ full: true, reason: event });
  }

  const existing = worldChangeFromPayload(payload);
  const isPlaceableCompatibility = event === 'placeableChanged'
    || event === 'facilityChanged'
    || event === 'zonesChanged';
  const domains = LEGACY_EVENT_DOMAINS[event];
  if (!isPlaceableCompatibility && !domains) return null;

  const changeSet = existing
    ? mergeWorldChangeSets(existing)
    : createWorldChangeSet({ reason: `legacy:${event}` });

  if (event === 'placeableChanged') {
    changeSet.domains.add(existing ? 'placeables' : 'legacyPlaceables');
    return changeSet;
  }
  if (event === 'facilityChanged') {
    if (existing) return null; // exact placeableChanged already carries it
    changeSet.domains.add('facility');
    return changeSet;
  }
  if (event === 'zonesChanged') {
    changeSet.domains.add(existing ? 'palette' : 'zones');
    return changeSet;
  }

  for (const domain of domains) changeSet.domains.add(domain);
  return changeSet;
}

/** Preserve metadata while combining the canonical portion of batched data. */
export function mergeWorldChangePayloads(previous, incoming) {
  const previousChange = worldChangeFromPayload(previous);
  const incomingChange = worldChangeFromPayload(incoming);
  if (!previousChange || !incomingChange) return incoming;
  return {
    ...(previous && typeof previous === 'object' ? previous : {}),
    ...(incoming && typeof incoming === 'object' ? incoming : {}),
    changeSet: mergeWorldChangeSets(previousChange, incomingChange),
  };
}
