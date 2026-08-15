// Shared gate for a device that turns an upstream HV feeder into downstream
// capacity. A transformer has no hv_in and is a genuine source; switchgear,
// panels, MCCs and UPSs do, so they must contribute exactly zero until their
// own feeder is live. Keeping this here makes the two hops (HV -> HV and
// HV -> branch power) obey the same fail-closed rule.

import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';

function typeForId(worldState, placeableId) {
  for (const p of (worldState?.placeables || [])) {
    if (p?.id === placeableId) return p.type;
  }
  return null;
}

function hvInputNetwork(worldState, placeableId) {
  const networks = worldState?.utilityNetworks?.get?.('hvCable') || [];
  const inputKey = `${placeableId}:hv_in`;
  return networks.find(network => (network.ports || [])
    .some(port => `${port.placeableId}:${port.portName}` === inputKey)) || null;
}

function powerInputNetwork(worldState, placeableId) {
  const networks = worldState?.utilityNetworks?.get?.('powerCable') || [];
  const inputKey = `${placeableId}:pwr_in`;
  return networks.find(network => (network.ports || [])
    .some(port => `${port.placeableId}:${port.portName}` === inputKey)) || null;
}

// Evaluate a feeder tree directly from discovered topology. `hvCable` runs
// before branch power, but one hvCable network can itself feed another through
// main switchgear. Reading last tick's nodeQualities made that chain take an
// extra tick to wake up; worse, a player clicking Start in that window saw a
// healthy facility but a rejected start. This recursive read has the current
// topology for every HV network already published by SolveRunner, so a radial
// transformer -> switchgear -> panel chain is live in the same solve pass.
function hvNetworkQuality(worldState, network, visiting) {
  if (!network || visiting.has(network.id)) return 0;
  visiting.add(network.id);
  const totalCapacity = (network.sources || []).reduce(
    (sum, source) => sum + (source.capacity || 0)
      * hvFeedFactor(worldState, source.placeableId, visiting), 0);
  const totalDemand = (network.sinks || []).reduce((sum, sink) => sum + (sink.demand || 0), 0);
  visiting.delete(network.id);
  if (totalDemand <= 0) return totalCapacity > 0 ? 1 : 0;
  return totalCapacity <= 0 ? 0 : Math.min(1, totalCapacity / totalDemand);
}

export function hvFeedFactor(worldState, placeableId, visiting = new Set()) {
  // Small descriptor-only tests do not carry a live world. Preserve their
  // source semantics instead of guessing a type from an opaque id.
  if (!worldState) return 1;
  const type = typeForId(worldState, placeableId);
  if (!type || !getUtilityPortsV2(type).hv_in) return 1;
  const upstream = hvInputNetwork(worldState, placeableId);
  // A declared HV input with no network is unwired, not "probably powered".
  return upstream ? hvNetworkQuality(worldState, upstream, visiting) : 0;
}

/**
 * Whether a powered utility source is actually energized.
 *
 * The power solver runs before every ordinary utility solver, so its
 * per-sink result is available here during the same tick. A device without a
 * `pwr_in` is deliberately treated as self-powered: this keeps passive
 * fittings and genuine grid/HV sources out of an invented wall-power loop.
 * A powered device with no reachable `pwr_in`, on the other hand, contributes
 * zero capacity to vacuum, cooling, RF, cryo, and data networks.
 */
export function powerFeedFactor(worldState, placeableId) {
  // Descriptor-only unit tests often use opaque ids without a world model.
  if (!worldState) return 1;
  const type = typeForId(worldState, placeableId);
  if (!type || !getUtilityPortsV2(type).pwr_in) return 1;
  const network = powerInputNetwork(worldState, placeableId);
  const flow = network && worldState.utilityNetworkData?.get?.('powerCable')?.get?.(network.id);
  const quality = flow?.perSinkQuality?.[`${placeableId}:pwr_in`];
  return typeof quality === 'number' ? Math.max(0, Math.min(1, quality)) : 0;
}
