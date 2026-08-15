// Pure presentation policy for utility sink-port alerts.
//
// Solvers publish a 0..1 quality per sink. A value between zero and one means
// the port is connected but under-served; zero means the connected device is
// receiving nothing. Unwired sinks never enter a discovered network, so the
// gate publishes those separately on state.unwiredSinks.

const ISSUE_RANK = { warning: 1, critical: 2 };

function recordIssue(out, issue) {
  const key = `${issue.placeableId}:${issue.portName}`;
  const prior = out.get(key);
  if (!prior || ISSUE_RANK[issue.severity] > ISSUE_RANK[prior.severity]) {
    out.set(key, issue);
  }
}

/**
 * Return the sink ports that need an in-world alert.
 *
 * @param {object} state game state with published utility solve results
 * @param {Map<string, object>} endpointsById flattened utility endpoint index
 * @param {(type: string) => object} getPorts authoritative port-table lookup
 * @returns {Array<{placeableId:string,portName:string,utilityType:string,severity:'warning'|'critical'}>}
 */
export function utilityPortIssues(state, endpointsById, getPorts) {
  const out = new Map();

  // Unwired sinks have no flow record. Resolve their concrete port names from
  // the authoritative definition rather than guessing a conventional name.
  for (const [placeableId, utilities] of Object.entries(state?.unwiredSinks || {})) {
    const endpoint = endpointsById?.get?.(placeableId);
    if (!endpoint || !utilities) continue;
    for (const [portName, spec] of Object.entries(getPorts?.(endpoint.type) || {})) {
      if (spec?.role !== 'sink' || !utilities[spec.utility]) continue;
      recordIssue(out, {
        placeableId,
        portName,
        utilityType: spec.utility,
        severity: 'critical',
      });
    }
  }

  const data = state?.utilityNetworkData;
  const networks = state?.utilityNetworks;
  if (data instanceof Map && networks instanceof Map) {
    for (const [utilityType, nets] of networks) {
      const perType = data.get(utilityType);
      if (!(perType instanceof Map)) continue;
      for (const network of nets || []) {
        const flow = perType.get(network?.id);
        if (!flow) continue;
        const errors = Array.isArray(flow.errors) ? flow.errors : [];
        const hardFailure = errors.some(error => error?.severity === 'hard');
        const qualities = flow.perSinkQuality || {};
        for (const sink of network?.sinks || []) {
          const rawQuality = qualities[sink.portKey];
          const quality = typeof rawQuality === 'number' ? rawQuality : NaN;
          if (!hardFailure && (!Number.isFinite(quality) || quality >= 1)) continue;
          recordIssue(out, {
            placeableId: sink.placeableId,
            portName: sink.portName,
            utilityType,
            severity: hardFailure || quality <= 0 ? 'critical' : 'warning',
          });
        }
      }
    }
  }

  return [...out.values()].sort((a, b) => {
    const ak = `${a.placeableId}:${a.portName}`;
    const bk = `${b.placeableId}:${b.portName}`;
    return ak < bk ? -1 : (ak > bk ? 1 : 0);
  });
}
