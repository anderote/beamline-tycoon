// Resolve a drawn beam pipe to the beamline metadata entry that owns it.
//
// Junction beamlineId fields are authoritative for current saves. The graph
// fallback keeps legacy/scenario-authored pipes inspectable when those fields
// are absent by finding the registry source in the same connected component.

function pipeById(state, pipeId) {
  return (state?.beamPipes || []).find(pipe => pipe?.id === pipeId) || null;
}

function endpointIds(pipe) {
  return [pipe?.start?.junctionId, pipe?.end?.junctionId].filter(Boolean);
}

export function beamlineForPipe(state, registry, pipeId) {
  const pipe = pipeById(state, pipeId);
  if (!pipe || !registry) return null;

  const placeables = state?.placeables || [];
  const placeableById = new Map(placeables.map(placeable => [placeable.id, placeable]));
  for (const junctionId of endpointIds(pipe)) {
    const beamlineId = placeableById.get(junctionId)?.beamlineId;
    const entry = beamlineId ? registry.get?.(beamlineId) : null;
    if (entry) return entry;
  }

  const pipesByJunction = new Map();
  for (const candidate of state?.beamPipes || []) {
    for (const junctionId of endpointIds(candidate)) {
      const connected = pipesByJunction.get(junctionId) || [];
      connected.push(candidate);
      pipesByJunction.set(junctionId, connected);
    }
  }

  for (const entry of registry.getAll?.() || []) {
    if (!entry?.sourceId) continue;
    const pendingJunctions = [entry.sourceId];
    const visitedJunctions = new Set();
    const visitedPipes = new Set();
    while (pendingJunctions.length > 0) {
      const junctionId = pendingJunctions.pop();
      if (!junctionId || visitedJunctions.has(junctionId)) continue;
      visitedJunctions.add(junctionId);
      for (const candidate of pipesByJunction.get(junctionId) || []) {
        if (visitedPipes.has(candidate.id)) continue;
        if (candidate.id === pipeId) return entry;
        visitedPipes.add(candidate.id);
        for (const nextId of endpointIds(candidate)) {
          if (!visitedJunctions.has(nextId)) pendingJunctions.push(nextId);
        }
      }
    }
  }
  return null;
}
