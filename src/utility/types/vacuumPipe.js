// src/utility/types/vacuumPipe.js
//
// Vacuum pipe utility descriptor. v1 physics: aggregate pressure = total
// outgassing / total pump speed. Map log-pressure to quality. Hard error when
// no pump serves sinks; soft error when pressure is merely poor. Fleshed out
// in Task 10.

export default {
  type: 'vacuumPipe',
  displayName: 'Vacuum Pipe',
  color: '#888888',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.06,
  capacityUnit: 'mbar\u00b7L/s',
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
