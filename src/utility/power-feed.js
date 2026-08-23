// Shared gate for a device that turns an upstream HV feeder into downstream
// capacity. A utility service point has no hv_in and is a genuine source;
// transformers, switchgear, panels, MCCs and UPSs do, so they must contribute
// exactly zero until their own feeder is live. Keeping this here makes the two
// hops (service HV -> transformer HV, then HV -> branch power) obey the same
// fail-closed rule.

import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import {
  electricalDeviceState,
  electricalSourceAvailability,
} from './electrical-state.js';
import { resolvedElectricalSinkDemand } from './electrical-demand.js';

/**
 * Build the topology-only indexes used by every powered utility source.
 *
 * A utility solve can ask for a power factor hundreds of times. Walking all
 * placeables and then every electrical network for each source turns that
 * pass quadratic as a facility grows. SolveRunner builds this once whenever
 * discovery changes and publishes it on the derived world state; callers
 * before the first discovery retain the scan fallback below.
 */
export function buildPowerFeedIndex(worldState, networksByType = worldState?.utilityNetworks) {
  const placeables = worldState?.placeables || [];
  const placeablesById = new Map();
  for (const placeable of placeables) {
    if (placeable?.id) placeablesById.set(placeable.id, placeable);
  }

  const networkByPort = new Map();
  for (const utilityType of ['hvCable', 'powerCable']) {
    const perType = new Map();
    for (const network of networksByType?.get?.(utilityType) || []) {
      for (const port of network?.ports || []) {
        if (!port?.placeableId || !port?.portName) continue;
        perType.set(`${port.placeableId}:${port.portName}`, network);
      }
    }
    networkByPort.set(utilityType, perType);
  }

  return {
    placeables,
    placeableCount: placeables.length,
    networksByType,
    placeablesById,
    networkByPort,
  };
}

function livePowerFeedIndex(worldState) {
  const index = worldState?.utilityPowerFeedIndex;
  if (!index) return null;
  if (index.placeables !== worldState.placeables
      || index.placeableCount !== (worldState.placeables || []).length
      || index.networksByType !== worldState.utilityNetworks) return null;
  return index;
}

function placeableForId(worldState, placeableId) {
  const index = livePowerFeedIndex(worldState);
  if (index) return index.placeablesById.get(placeableId) || null;
  for (const p of (worldState?.placeables || [])) {
    if (p?.id === placeableId) return p;
  }
  return null;
}

function hvInputNetwork(worldState, placeableId) {
  const index = livePowerFeedIndex(worldState);
  if (index) {
    return index.networkByPort.get('hvCable')?.get(`${placeableId}:hv_in`) || null;
  }
  const networks = worldState?.utilityNetworks?.get?.('hvCable') || [];
  const inputKey = `${placeableId}:hv_in`;
  return networks.find(network => (network.ports || [])
    .some(port => `${port.placeableId}:${port.portName}` === inputKey)) || null;
}

function powerInputNetwork(worldState, placeableId) {
  const index = livePowerFeedIndex(worldState);
  if (index) {
    return index.networkByPort.get('powerCable')?.get(`${placeableId}:pwr_in`) || null;
  }
  const networks = worldState?.utilityNetworks?.get?.('powerCable') || [];
  const inputKey = `${placeableId}:pwr_in`;
  return networks.find(network => (network.ports || [])
    .some(port => `${port.placeableId}:${port.portName}` === inputKey)) || null;
}

function hvLoadInputNetwork(worldState, placeableId) {
  return hvInputNetwork(worldState, placeableId);
}

// Evaluate a feeder tree directly from discovered topology. `hvCable` runs
// before branch power, but one hvCable network can itself feed another through
// main switchgear. Reading last tick's nodeQualities made that chain take an
// extra tick to wake up; worse, a player clicking Start in that window saw a
// healthy facility but a rejected start. This recursive read has the current
// topology for every HV network already published by SolveRunner, so a radial
// transformer -> switchgear -> panel chain is live in the same solve pass.
function hvNetworkQuality(worldState, network, visiting, getDefinition) {
  if (!network || visiting.has(network.id)) return 0;
  visiting.add(network.id);
  const totalCapacity = (network.sources || []).reduce(
    (sum, source) => sum + (source.capacity || 0)
      * hvFeedFactor(worldState, source.placeableId, visiting, getDefinition), 0);
  const totalDemand = (network.sinks || []).reduce(
    (sum, sink) => sum + resolvedElectricalSinkDemand(worldState, sink), 0);
  visiting.delete(network.id);
  if (totalDemand <= 0) return totalCapacity > 0 ? 1 : 0;
  return totalCapacity <= 0 ? 0 : Math.min(1, totalCapacity / totalDemand);
}

export function hvFeedFactor(
  worldState, placeableId, visiting = new Set(), getDefinition = () => null,
) {
  // Small descriptor-only tests do not carry a live world. Preserve their
  // source semantics instead of guessing a type from an opaque id.
  if (!worldState) return 1;
  const placeable = placeableForId(worldState, placeableId);
  const type = placeable?.type;
  if (!type) return 1;
  const def = getDefinition(type) || {};
  const available = electricalSourceAvailability(worldState, placeable, def);
  if (!(available > 0)) return 0;
  if (!getUtilityPortsV2(type).hv_in) return available;
  const upstream = hvInputNetwork(worldState, placeableId);
  // A declared HV input with no network is unwired, not "probably powered".
  const upstreamQuality = upstream
    ? hvNetworkQuality(worldState, upstream, visiting, getDefinition) : 0;
  // A UPS is the one intentional exception to normal feeder inheritance: its
  // branch outputs remain live while stored battery time remains. The game
  // coordinator owns charge/discharge; the solver only consumes the published
  // saved state here.
  if (!(upstreamQuality > 0) && def.electricalControl?.battery) {
    const live = electricalDeviceState(worldState, placeableId) || {};
    if ((live.batteryChargeTicks || 0) > 0) return available;
  }
  return upstreamQuality * available;
}

/**
 * Whether a powered utility source is actually energized.
 *
 * The power solver runs before every ordinary utility solver, so its
 * per-sink result is available here during the same tick. A device without an
 * electrical input is deliberately treated as self-powered: this keeps passive
 * fittings and genuine grid/HV sources out of an invented wall-power loop.
 * A powered device with no reachable branch or HV input, on the other hand,
 * contributes zero capacity to vacuum, cooling, RF, cryo, and data networks.
 */
export function powerFeedFactor(worldState, placeableId, getDefinition = () => null) {
  // Descriptor-only unit tests often use opaque ids without a world model.
  if (!worldState) return 1;
  // Thermal/physics descriptor tests provide a small world containing the
  // relevant equipment but intentionally no utility solve state. That means
  // "power is outside this model", not "the equipment is unwired". A live
  // Game always publishes utilityNetworks before any descriptor is solved.
  if (!worldState.utilityNetworks || typeof worldState.utilityNetworks.get !== 'function') return 1;
  const placeable = placeableForId(worldState, placeableId);
  const type = placeable?.type;
  const ports = type && getUtilityPortsV2(type);
  if (!ports || (!ports.pwr_in && !ports.hv_in)) return 1;
  const available = electricalSourceAvailability(
    worldState, placeable, getDefinition(type) || {},
  );
  if (!(available > 0)) return 0;
  const isHvLoad = !!ports.hv_in;
  const network = isHvLoad
    ? hvLoadInputNetwork(worldState, placeableId)
    : powerInputNetwork(worldState, placeableId);
  const utilityType = isHvLoad ? 'hvCable' : 'powerCable';
  const portName = isHvLoad ? 'hv_in' : 'pwr_in';
  const flow = network && worldState.utilityNetworkData?.get?.(utilityType)?.get?.(network.id);
  const quality = flow?.perSinkQuality?.[`${placeableId}:${portName}`];
  return typeof quality === 'number'
    ? Math.max(0, Math.min(1, quality)) * available
    : 0;
}
