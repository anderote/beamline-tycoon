// src/utility/types/dataFiber.js
//
// Data fiber utility descriptor. v1 physics: binary — if there's a source in
// the network, sinks get quality 1; otherwise quality 0 with data_disconnected
// soft error. Fleshed out in Task 14.

export default {
  type: 'dataFiber',
  displayName: 'Data Fiber',
  color: '#eeeeee',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.01,
  capacityUnit: 'Gbps',
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
