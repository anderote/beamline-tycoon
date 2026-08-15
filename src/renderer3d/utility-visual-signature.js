// The only utility-line visual state that can change without a topology event
// is each solved network's error severity. Geometry and source/sink orientation
// are topology-owned and already refresh on their mutation events.

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
