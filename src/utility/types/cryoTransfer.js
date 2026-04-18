// src/utility/types/cryoTransfer.js
//
// Cryogenic LHe transfer line descriptor. Analogous to coolingWater but with
// boil-off scaled to heat in watts, a quench threshold, and $50/L refill.
// Fleshed out in Task 13.

export default {
  type: 'cryoTransfer',
  displayName: 'Cryo Transfer',
  color: '#44aacc',
  geometryStyle: 'jacketedCylinder',
  pipeRadiusMeters: 0.06,
  capacityUnit: 'W@4K',
  persistentStateDefaults: { lheVolumeL: 500 },
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
