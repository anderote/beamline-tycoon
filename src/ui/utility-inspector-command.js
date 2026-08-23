// Public command for opening a line-specific inspector on its solved network.
// The published discovery is authoritative; fresh discovery is only an
// identity fallback during the short interval before the next solve pass.

import { discoverNetworks, makeDefaultPortLookup } from '../utility/network-discovery.js';
import { UtilityInspector } from './UtilityInspector.js';

/** Find the network identity for a committed utility line. */
export function utilityNetworkForLine(state, lineId) {
  const lines = state?.utilityLines;
  if (!lines || typeof lines.get !== 'function') return null;
  const line = lines.get(lineId);
  if (!line?.utilityType) return null;

  const published = state.utilityNetworks?.get?.(line.utilityType) || [];
  let network = published.find(candidate => (candidate.lineIds || []).includes(lineId));

  // A topology mutation marks the solver dirty, but the next published solve
  // occurs on the tick. Discovery here supplies only the stable network id so
  // the window can open immediately; capacity, demand, quality, and errors
  // still come exclusively from state.utilityNetworkData in UtilityInspector.
  if (!network) {
    const lookup = makeDefaultPortLookup(state);
    network = discoverNetworks(line.utilityType, lines, lookup)
      .find(candidate => (candidate.lineIds || []).includes(lineId));
  }

  return network ? { line, network } : null;
}

/** Open or focus the UtilityInspector for a committed utility line. */
export function openUtilityInspectorForLine(game, lineId, createInspector = null) {
  const resolved = utilityNetworkForLine(game?.state, lineId);
  if (!resolved) return false;
  const open = createInspector
    || ((utilityType, networkId) => new UtilityInspector(game, utilityType, networkId));
  open(resolved.line.utilityType, resolved.network.id, lineId);
  return true;
}
