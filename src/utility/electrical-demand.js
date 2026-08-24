// Resolve the live upstream draw of electrical distribution equipment from
// the loads connected to its output networks. This is a topology prepass: it
// does not depend on solve order or quality, so HV can still solve before
// branch power and publish same-tick feeder quality.

function networksSuppliedByDevice(networks) {
  const byDevice = new Map();
  for (const network of networks || []) {
    const owners = new Set((network.sources || []).map(source => source.placeableId));
    for (const placeableId of owners) {
      let deviceNetworks = byDevice.get(placeableId);
      if (!deviceNetworks) {
        deviceNetworks = new Map();
        byDevice.set(placeableId, deviceNetworks);
      }
      deviceNetworks.set(network.id, network);
    }
  }
  return byDevice;
}

function authoredDemand(sink) {
  return Number.isFinite(sink?.demand) && sink.demand > 0 ? sink.demand : 0;
}

/**
 * Map dynamic HV sink port keys to their actual connected downstream demand.
 * Each tracked inlet remains capped by its authored nameplate demand.
 */
export function computeElectricalSinkDemands(networksByType, worldState = null) {
  const hvNetworks = networksByType?.get?.('hvCable') || [];
  const powerNetworks = networksByType?.get?.('powerCable') || [];
  const hvBySource = networksSuppliedByDevice(hvNetworks);
  const powerBySource = networksSuppliedByDevice(powerNetworks);
  const demandByPort = new Map();
  const memo = new Map();

  const networkDemand = (network, visiting) => (network?.sinks || []).reduce(
    (sum, sink) => sum + sinkDemand(sink, visiting), 0,
  );

  const deviceDemand = (placeableId, visiting = new Set()) => {
    if (memo.has(placeableId)) return memo.get(placeableId);
    if (visiting.has(placeableId)) return 0;
    // An open or tripped device cannot draw its downstream load through the
    // upstream feeder. Without this isolation, its outputs correctly went
    // dark while the parent cable still appeared to carry the old load.
    const live = worldState?.powerReliability?.devices?.[placeableId];
    if (live?.breakerTripped === true || live?.breakerOpen === true) {
      memo.set(placeableId, 0);
      return 0;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(placeableId);
    let demand = 0;
    for (const network of powerBySource.get(placeableId)?.values() || []) {
      demand += networkDemand(network, nextVisiting);
    }
    for (const network of hvBySource.get(placeableId)?.values() || []) {
      demand += networkDemand(network, nextVisiting);
    }
    memo.set(placeableId, demand);
    return demand;
  };

  const sinkDemand = (sink, visiting = new Set()) => {
    const cap = authoredDemand(sink);
    if (sink?.params?.tracksDownstreamDemand !== true) return cap;
    const demand = Math.min(cap, deviceDemand(sink.placeableId, visiting));
    if (sink.portKey) demandByPort.set(sink.portKey, demand);
    return demand;
  };

  // Resolve every tracked inlet, including an energized but currently idle
  // distributor whose output ports do not participate in any network.
  for (const network of hvNetworks) {
    for (const sink of network.sinks || []) sinkDemand(sink);
  }
  return demandByPort;
}

export function resolvedElectricalSinkDemand(worldState, sink) {
  const resolved = worldState?.electricalSinkDemands?.get?.(sink?.portKey);
  return Number.isFinite(resolved) ? resolved : authoredDemand(sink);
}
