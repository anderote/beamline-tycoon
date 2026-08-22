// Utility-line rendering reads solved topology as well as line geometry. A
// topology mutation event reaches the renderer immediately, but SolveRunner
// publishes the replacement utilityNetworks map on the following solve pass.
// The render invalidation signature therefore has to cover the published topology
// (which controls source -> sink animation direction), fault severity, and
// whether an RF network has forward power to visualize.

function sourceKey(source) {
  return source?.portKey
    || (source?.placeableId != null && source?.portName != null
      ? `${source.placeableId}:${source.portName}`
      : '');
}

export function utilityTopologyVisualSignature(state) {
  const networks = state?.utilityNetworks;
  if (!(networks instanceof Map)) return null;

  const entries = [];
  for (const [utilityType, nets] of networks) {
    for (const network of nets || []) {
      // Direction is rooted at source ports and propagated over the lines in
      // this discovered network. Include exactly that published membership;
      // geometry/path edits are already covered by each line's render hash.
      const lineIds = (network?.lineIds || []).map(String).sort();
      const sources = (network?.sources || []).map(sourceKey).filter(Boolean).sort();
      entries.push([
        String(utilityType),
        String(network?.id ?? ''),
        lineIds.join(','),
        sources.join(','),
      ].join(':'));
    }
  }
  return entries.sort().join('|');
}

export function utilityErrorVisualSignature(state) {
  const data = state?.utilityNetworkData;
  const networks = state?.utilityNetworks;
  if (!(data instanceof Map) || !(networks instanceof Map)) return null;

  const severityByLine = new Map();
  for (const [utilityType, nets] of networks) {
    const perType = data.get(utilityType);
    if (!(perType instanceof Map)) continue;
    for (const net of nets || []) {
      const errors = perType.get(net.id)?.errors || [];
      let severity = 0;
      for (const error of errors) {
        if (error?.severity === 'hard') { severity = 2; break; }
        if (error?.severity === 'soft') severity = Math.max(severity, 1);
      }
      if (!severity) continue;
      for (const lineId of net.lineIds || []) {
        severityByLine.set(lineId, Math.max(severity, severityByLine.get(lineId) || 0));
      }
    }
  }
  return [...severityByLine].sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([id, severity]) => `${id}:${severity}`).join('|');
}

export function utilityFlowVisualSignature(state) {
  const data = state?.utilityNetworkData;
  const networks = state?.utilityNetworks;
  if (!(data instanceof Map) || !(networks instanceof Map)) return null;

  const rfData = data.get('rfWaveguide');
  if (!(rfData instanceof Map)) return '';
  const energizedLineIds = new Set();
  for (const network of networks.get('rfWaveguide') || []) {
    if (!(Number(rfData.get(network.id)?.totalCapacity) > 0)) continue;
    for (const lineId of network.lineIds || []) energizedLineIds.add(String(lineId));
  }
  return [...energizedLineIds].sort().join(',');
}

export function utilityLineVisualSignature(state) {
  const topology = utilityTopologyVisualSignature(state);
  const errors = utilityErrorVisualSignature(state);
  const flow = utilityFlowVisualSignature(state);
  if (topology === null || errors === null || flow === null) return null;
  return `${topology}#${errors}#${flow}`;
}
