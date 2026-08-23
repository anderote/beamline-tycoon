// Contextual construction guidance for multi-part cooling-water and cryogenic
// plants. Completion is intentionally read from the solver-published flow for
// ONE connected network: owning the right equipment elsewhere in the facility
// is useful guidance, but it cannot make this loop operational.

import { COMPONENTS } from '../data/components.js';
import { listUtilityEndpoints } from './utility-endpoints.js';

export const PLANT_GUIDE_TYPES = Object.freeze({
  coolingWater: Object.freeze({
    title: 'Cooling Water Plant',
    shortTitle: 'Water plant',
    lineName: 'Cooling Water',
    accent: '#5aa7ff',
    requirements: Object.freeze([
      Object.freeze({
        id: 'storage',
        label: 'Water storage connected',
        missing: 'Build a Water Tank or an integrated chiller package.',
        raw: params => positive(params.storageCapacityL) > 0,
        solved: flow => positive(flow?.storageCapacityL) > 0,
      }),
      Object.freeze({
        id: 'refrigeration',
        label: 'Chiller connected and powered',
        missing: 'Build a chiller or compact LCW skid.',
        raw: params => positive(params.capacity) > 0,
        solved: flow => positive(flow?.chillerCapacity) > 0,
        connectedHint: 'Connected, but it still needs a working electrical feed.',
      }),
      Object.freeze({
        id: 'rejection',
        label: 'Heat rejector connected and powered',
        missing: 'Build a fan-coil cooler, dry cooler, cooling tower, or integrated package.',
        raw: params => positive(params.heatRejectionCapacity) > 0,
        solved: flow => positive(flow?.rejectionCapacity) > 0,
        connectedHint: 'Connected, but its fans or pumps still need power.',
      }),
    ]),
    loadLabel: 'Cooling load connected',
    loadMissing: 'Connect the loop to a magnet, warm RF source, target, or other heat load.',
    onlineHint: 'Power the plant stages and make sure the connected loop has usable capacity.',
  }),
  cryoTransfer: Object.freeze({
    title: 'Cryogenic Plant',
    shortTitle: 'Cryo plant',
    lineName: 'Cryo Transfer',
    accent: '#62d8df',
    requirements: Object.freeze([
      Object.freeze({
        id: 'storage',
        label: 'Helium storage connected',
        missing: 'Build a Helium Tank, or use a sealed Compact Cryogenic Supply.',
        raw: params => positive(params.storageCapacityL) > 0,
        solved: flow => positive(flow?.storageCapacityL) > 0,
      }),
      Object.freeze({
        id: 'refrigeration',
        label: 'Cold source connected and powered',
        missing: 'Build a 4 K/2 K Cryogenic Supply, or use a sealed Compact Cryogenic Supply.',
        raw: params => positive(params.coldCapacityW) > 0,
        solved: flow => positive(flow?.coldCapacityW) > 0,
        connectedHint: 'Connected, but the cold source still needs a working electrical feed.',
      }),
      Object.freeze({
        id: 'rejection',
        label: 'Warm-end heat rejection online',
        missing: 'Build Helium Refrigeration, or use a sealed Compact Cryogenic Supply.',
        raw: params => positive(params.heatRejectionCapacityW) > 0,
        solved: flow => positive(flow?.heatRejectionCapacityW) > 0,
        connectedHint: 'Connected, but it is not ready: power Helium Refrigeration and give it working Cooling Water.',
      }),
    ]),
    loadLabel: 'Superconducting load connected',
    loadMissing: 'Connect Cryo Transfer to an SRF cavity, cryomodule, or superconducting magnet.',
    onlineHint: 'Power the cold equipment; Helium Refrigeration also requires a working Cooling Water loop.',
    sourceRaw: params => params?.ln2Reservoir === true,
  }),
});

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function sourcePortsForDefinition(def, utilityType) {
  return Object.values(def?.ports || {}).filter(
    port => port?.utility === utilityType && port.role === 'source',
  );
}

function endpointDefinition(endpoint) {
  return endpoint?.type ? COMPONENTS[endpoint.type] : null;
}

function endpointHasRequirement(endpoint, utilityType, requirement) {
  return sourcePortsForDefinition(endpointDefinition(endpoint), utilityType)
    .some(port => requirement.raw(port.params || {}));
}

function networkHasRequirement(network, requirement) {
  return (network?.sources || []).some(source => requirement.raw(source.params || {}));
}

function networkForAnchor(state, utilityType, anchorId) {
  const networks = state?.utilityNetworks?.get?.(utilityType) || [];
  const matches = networks.filter(network => (network.ports || [])
    .some(port => port.placeableId === anchorId));
  if (matches.length < 2) return matches[0] || null;
  // A component with independently-routable ports can briefly touch more than
  // one network. Follow the most assembled one so the guide does not jump to a
  // dangling branch when a useful loop already exists.
  return matches.sort((a, b) => (
    (b.sources?.length || 0) + (b.sinks?.length || 0)
    - (a.sources?.length || 0) - (a.sinks?.length || 0)
  ))[0];
}

function rowStatus({ complete, connected, placed }) {
  if (complete) return 'complete';
  if (connected) return 'connected';
  if (placed) return 'placed';
  return 'missing';
}

function rowDetail(requirement, status) {
  if (status === 'complete') return 'Connected to this network.';
  if (status === 'connected') return requirement.connectedHint || 'Connected, but not yet online.';
  if (status === 'placed') return 'Built elsewhere — connect it to this network.';
  return requirement.missing;
}

/**
 * Returns the plant utility represented by a placed item, or null. Only
 * source-side plant hardware triggers a guide; ordinary loads and passive
 * distribution manifolds do not.
 */
export function plantGuideTypeForPlaceable(placeable) {
  const def = endpointDefinition(placeable);
  if (!def || def.plantGuide === false) return null;
  for (const [utilityType, config] of Object.entries(PLANT_GUIDE_TYPES)) {
    const startsPlant = sourcePortsForDefinition(def, utilityType).some(port =>
      config.requirements.some(requirement => requirement.raw(port.params || {}))
        || config.sourceRaw?.(port.params || {}));
    if (startsPlant) return utilityType;
  }
  return null;
}

export function plantGuideAnchorCandidates(state, utilityType) {
  return (state?.placeables || []).filter(
    placeable => plantGuideTypeForPlaceable(placeable) === utilityType,
  );
}

/**
 * Build the UI-ready checklist for the network containing `anchorId`.
 * Solver quantities are displayed/compared exactly as published; this module
 * does not reproduce plant capacity, power-feed, or thermal calculations.
 */
export function utilityPlantChecklist(state, utilityType, anchorId) {
  const config = PLANT_GUIDE_TYPES[utilityType];
  if (!config) return null;
  const endpoints = listUtilityEndpoints(state || {});
  const anchor = endpoints.find(endpoint => endpoint.id === anchorId) || null;
  if (!anchor || plantGuideTypeForPlaceable(anchor) !== utilityType) return null;

  const network = networkForAnchor(state, utilityType, anchorId);
  const flow = network
    ? state?.utilityNetworkData?.get?.(utilityType)?.get?.(network.id) || null
    : null;
  const rows = [];

  rows.push({
    id: 'network',
    label: `${config.lineName} network started`,
    complete: !!network,
    status: network ? 'complete' : 'missing',
    detail: network
      ? 'The first plant component is attached to this network.'
      : `Draw ${config.lineName} from ${COMPONENTS[anchor.type]?.name || 'this component'}.`,
  });

  for (const requirement of config.requirements) {
    const placed = endpoints.some(endpoint => endpointHasRequirement(
      endpoint, utilityType, requirement,
    ));
    const connected = networkHasRequirement(network, requirement);
    const complete = connected && requirement.solved(flow);
    const status = rowStatus({ complete, connected, placed });
    rows.push({
      id: requirement.id,
      label: requirement.label,
      complete,
      status,
      detail: rowDetail(requirement, status),
    });
  }

  const loadConnected = !!network && (network.sinks || []).length > 0;
  rows.push({
    id: 'load',
    label: config.loadLabel,
    complete: loadConnected,
    status: loadConnected ? 'complete' : 'missing',
    detail: loadConnected ? 'A real equipment load is on this network.' : config.loadMissing,
  });

  const qualities = Object.values(flow?.perSinkQuality || {});
  const online = flow?.plantComplete === true
    && positive(flow?.totalCapacity) > 0
    && qualities.length > 0
    && qualities.every(quality => positive(quality) > 0);
  rows.push({
    id: 'online',
    label: 'Plant online',
    complete: online,
    status: online ? 'complete' : 'missing',
    detail: online ? 'Every required stage is connected and serving the loop.' : config.onlineHint,
  });

  return {
    utilityType,
    config,
    anchorId,
    anchorName: COMPONENTS[anchor.type]?.name || anchor.type,
    networkId: network?.id || null,
    rows,
    completed: rows.every(row => row.complete),
    completeCount: rows.filter(row => row.complete).length,
  };
}
