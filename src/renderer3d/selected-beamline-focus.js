// Presentation model for spotlighting one selected beamline and the utility
// plant that actually serves it. Utility membership is read from the solver's
// published networks; this module never performs a second topology discovery.

import { flattenPath } from '../beamline/flattener.js';
import { beamVisualPath } from './beam-visual-path.js';
import { listUtilityEndpoints } from '../utility/utility-endpoints.js';

function registryEntries(registry) {
  return registry?.getAll?.() || [];
}

function flattenedBeamline(state, entry) {
  return entry?.sourceId ? flattenPath(state, entry.sourceId) : [];
}

function beamlineForTarget(state, registry, target) {
  const explicitId = target?.entry?.beamlineId;
  if (explicitId) return registry?.get?.(explicitId) || null;
  if (!target?.id) return null;
  for (const entry of registryEntries(registry)) {
    if (flattenedBeamline(state, entry).some(node => node.id === target.id)) return entry;
  }
  return null;
}

/**
 * Follow published utility networks outward from the selected beamline.
 * Infrastructure endpoints may seed their other networks (a branch panel can
 * reveal its HV feeder, for example), while another beamline sharing one bus
 * is deliberately not allowed to pull its own services into this spotlight.
 */
function connectedUtilityGraph(state, selectedNodeIds) {
  const infrastructureById = new Map(
    listUtilityEndpoints(state)
      .filter(endpoint => (endpoint.kind || endpoint.category) === 'infrastructure')
      .map(endpoint => [endpoint.id, endpoint]),
  );
  const publishedNetworks = state?.utilityNetworks;
  if (!publishedNetworks || typeof publishedNetworks.values !== 'function') {
    return { topologyAvailable: false, infrastructureIds: new Set(), utilityLineIds: null };
  }
  const networks = [];
  for (const perType of publishedNetworks.values()) {
    for (const network of perType || []) networks.push(network);
  }

  const reachedEndpoints = new Set(selectedNodeIds);
  const infrastructureIds = new Set();
  const utilityLineIds = new Set();
  const visitedNetworks = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const network of networks) {
      const key = `${network.utilityType || ''}:${network.id || ''}`;
      if (visitedNetworks.has(key)) continue;
      const portIds = new Set((network.ports || []).map(port => port.placeableId));
      if (![...portIds].some(id => reachedEndpoints.has(id))) continue;
      visitedNetworks.add(key);
      for (const lineId of network.lineIds || []) utilityLineIds.add(lineId);
      for (const id of portIds) {
        if (!infrastructureById.has(id) || infrastructureIds.has(id)) continue;
        infrastructureIds.add(id);
        reachedEndpoints.add(id);
        changed = true;
      }
    }
  }

  return { topologyAvailable: true, infrastructureIds, utilityLineIds };
}

export function selectedBeamlineFocusModel(state, registry, target) {
  if (!state || !target || target.selectionCategory !== 'beamline') return null;
  const entry = beamlineForTarget(state, registry, target);
  if (!entry) return null;
  const flat = flattenedBeamline(state, entry);
  const beamlineNodeIds = new Set(
    flat.filter(node => node.kind !== 'drift').map(node => node.id),
  );
  const beamlinePipeIds = new Set(
    flat.map(node => node.pipeId).filter(Boolean),
  );
  const { topologyAvailable, infrastructureIds, utilityLineIds } = connectedUtilityGraph(
    state, beamlineNodeIds,
  );
  return {
    beamlineId: entry.id,
    status: entry.status || 'stopped',
    anchor: { col: target.col || 0, row: target.row || 0 },
    routePoints: beamVisualPath(flat, state.beamPipes || []),
    beamlineNodeIds,
    beamlinePipeIds,
    infrastructureIds,
    utilityLineIds,
    focusedComponentIds: topologyAvailable
      ? new Set([...beamlineNodeIds, ...infrastructureIds])
      : null,
  };
}

export function beamlineStatusPresentation(status) {
  if (status === 'running') return { label: 'BEAM ON', color: 0x35e86b };
  if (status === 'faulted') return { label: 'BEAM FAULT', color: 0xff9f1a };
  return { label: 'BEAM OFF', color: 0xff453a };
}
