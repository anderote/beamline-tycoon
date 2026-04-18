// src/utility/types/powerCable.js
//
// Power cable utility descriptor. v1 physics: sum source capacity vs sum sink
// demand. Per-sink quality uniform (capacity/demand clamped to 1). Soft errors
// for overload and starvation.

export default {
  type: 'powerCable',
  displayName: 'Power Cable',
  color: '#44cc44',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.02,
  capacityUnit: 'kW',
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const totalCapacity = network.sources.reduce((a, s) => a + (s.capacity || 0), 0);
    const totalDemand   = network.sinks.reduce((a, s) => a + (s.demand || 0), 0);
    const errors = [];
    const perSinkQuality = {};
    let utilization = 0;

    if (totalDemand === 0) {
      utilization = 0;
    } else if (totalCapacity === 0) {
      utilization = 1;
      errors.push({
        severity: 'soft',
        code: 'power_starved',
        message: 'Power network has no capacity.',
        location: { networkId: network.id },
      });
      for (const s of network.sinks) perSinkQuality[s.portKey] = 0;
    } else {
      utilization = totalDemand / totalCapacity;
      const q = Math.min(1, totalCapacity / totalDemand);
      for (const s of network.sinks) perSinkQuality[s.portKey] = q;
      if (utilization > 1) {
        errors.push({
          severity: 'soft',
          code: 'power_overload',
          message: `Power network overloaded (${Math.round(utilization * 100)}%).`,
          location: { networkId: network.id },
        });
      }
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity,
        totalDemand,
        utilization: Math.min(1, utilization),
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
