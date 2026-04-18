// src/utility/types/rfWaveguide.js
//
// RF waveguide utility descriptor. v1 physics: group sources & sinks by
// params.frequency. Frequency groups are independent: sinks in a group with no
// matching source get quality 0; overloaded groups emit soft rf_overload.
// Fleshed out in Task 11.

export default {
  type: 'rfWaveguide',
  displayName: 'RF Waveguide',
  color: '#cc4444',
  geometryStyle: 'rectWaveguide',
  pipeRadiusMeters: 0.05,
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
