// src/utility/types/powerCable.js
//
// Power cable utility descriptor. v1 physics: sum source capacity vs sum sink
// demand. Per-sink quality uniform (capacity/demand clamped to 1). Soft errors
// for overload and starvation. Fleshed out in Task 9.

export default {
  type: 'powerCable',
  displayName: 'Power Cable',
  color: '#44cc44',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.02,
  capacityUnit: 'kW',
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity: 0,
        totalDemand: 0,
        utilization: 0,
        perSegmentLoad: [],
        perSinkQuality: {},
        errors: [],
      },
      nextPersistentState: persistent,
      errors: [],
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
