// Presentation model for spotlighting the exact utility topology containing a
// clicked run. Published discovery owns network membership; callers may pass a
// freshly discovered network only for the short pre-solve interval after a
// topology edit.

function endpointIds(network) {
  const ids = new Set();
  for (const collection of [
    network?.ports,
    network?.sources,
    network?.sinks,
    network?.peers,
  ]) {
    for (const endpoint of collection || []) {
      if (endpoint?.placeableId) ids.add(endpoint.placeableId);
    }
  }
  return ids;
}

/** Expand one selected utility run to its connected network presentation. */
export function selectedUtilityNetworkFocusModel(state, lineId, networkHint = null) {
  const line = state?.utilityLines?.get?.(lineId);
  if (!line?.utilityType) return null;

  const published = state?.utilityNetworks?.get?.(line.utilityType) || [];
  const hintedId = typeof networkHint === 'string' ? networkHint : networkHint?.id;
  const network = published.find(candidate => candidate.id === hintedId)
    || published.find(candidate => (candidate.lineIds || []).includes(lineId))
    || (typeof networkHint === 'object' ? networkHint : null);

  const utilityLineIds = new Set(network?.lineIds || [lineId]);
  utilityLineIds.add(lineId);
  const connectedEndpointIds = endpointIds(network);
  for (const endpoint of [line.start, line.end]) {
    if (endpoint?.placeableId) connectedEndpointIds.add(endpoint.placeableId);
  }

  return {
    lineId,
    utilityType: line.utilityType,
    networkId: network?.id || null,
    utilityLineIds,
    connectedEndpointIds,
  };
}
