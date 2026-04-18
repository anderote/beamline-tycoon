// src/utility/types/dataFiber.js
//
// Data fiber utility descriptor. v1 physics: binary connectivity. If the
// network has ≥1 source, every sink is "connected" (quality 1); otherwise the
// sinks are orphaned (quality 0) and a soft data_disconnected error is raised.

export default {
  type: 'dataFiber',
  displayName: 'Data Fiber',
  color: '#eeeeee',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.01,
  capacityUnit: 'Gbps',
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const hasSource = network.sources.length > 0;
    const perSinkQuality = {};
    const errors = [];
    if (hasSource) {
      for (const s of network.sinks) perSinkQuality[s.portKey] = 1;
    } else if (network.sinks.length > 0) {
      for (const s of network.sinks) perSinkQuality[s.portKey] = 0;
      errors.push({
        severity: 'soft',
        code: 'data_disconnected',
        message: 'Data network has no source.',
        location: { networkId: network.id },
      });
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity: network.sources.length,
        totalDemand: network.sinks.length,
        utilization: hasSource ? 0 : (network.sinks.length > 0 ? 1 : 0),
        perSegmentLoad: [],
        perSinkQuality,
        errors: [...errors],
      },
      nextPersistentState: persistent,
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
