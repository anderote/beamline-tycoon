// Plant-water loop: make-up tank -> heat rejector -> chiller condenser.
//
// This is deliberately separate from coolingWater, the low-conductivity
// process loop that reaches beamline equipment. Keeping the stages on two
// pipe types makes it impossible for a cooling tower to masquerade as a
// direct supply to a magnet.

import { powerFeedFactor } from '../power-feed.js';

export default {
  type: 'plantWater',
  displayName: 'Heat Rejection Water',
  color: '#277a9c',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.055,
  capacityUnit: 'kW thermal',
  demandUnit: 'kW thermal',
  capacityParam: 'rejectionCapacity',
  demandParam: 'rejectionDemand',
  allowsTap: true,
  fansOut: true,
  bridgesAdjacent: false,
  costPerSubUnit: 700,
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const tanks = network.sources.filter(s => s.params?.waterSupply);
    const rejectors = network.sources.filter(s => s.params?.rejectionCapacity > 0);
    const totalCapacity = rejectors.reduce((sum, s) => sum + s.params.rejectionCapacity
      * powerFeedFactor(worldState, s.placeableId), 0);
    const chillerSinks = network.sinks.filter(s => s.params?.rejectionDemand > 0);
    const totalDemand = chillerSinks.reduce((sum, s) => sum + s.params.rejectionDemand, 0);
    const hasWater = tanks.length > 0;
    const quality = hasWater && totalCapacity > 0
      ? (totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1)
      : 0;
    const perSinkQuality = {};
    for (const sink of chillerSinks) perSinkQuality[sink.portKey] = quality;
    const errors = [];
    if (chillerSinks.length && !hasWater) errors.push({ severity: 'hard', code: 'plant_water_missing', message: 'Heat-rejection loop has no make-up water tank.', location: { networkId: network.id } });
    if (chillerSinks.length && totalCapacity <= 0) errors.push({ severity: 'hard', code: 'heat_rejection_missing', message: 'Chiller has no powered heat-rejection capacity.', location: { networkId: network.id } });
    else if (chillerSinks.length && quality < 1) errors.push({ severity: 'soft', code: 'heat_rejection_overload', message: 'Heat-rejection plant is undersized for its chillers.', location: { networkId: network.id } });
    return { flowState: { networkId: network.id, utilityType: network.utilityType, totalCapacity, totalDemand, utilization: totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity) : (totalDemand ? 1 : 0), perSegmentLoad: [], perSinkQuality, errors: [...errors] }, nextPersistentState: persistent, errors };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
