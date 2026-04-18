// src/utility/types/coolingWater.js
//
// Cooling water utility descriptor. v1 physics: source capacity vs sink heat
// load; reservoir decrements by EVAP_PER_KW_PER_TICK * totalHeatKW per tick.
// Hard cooling_dry error when empty; refillable at $10/L. Fleshed out in
// Task 12.

export default {
  type: 'coolingWater',
  displayName: 'Cooling Water',
  color: '#4488ff',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.04,
  capacityUnit: 'L/min',
  persistentStateDefaults: { reservoirVolumeL: 500 },
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
