// src/utility/types/coolingWater.js
//
// Cooling water utility descriptor. v1 physics: chiller capacity vs sink heat
// load; reservoir decrements by EVAP_PER_KW_PER_TICK × totalHeatKW. Hard
// cooling_dry when the reservoir empties; soft cooling_starved when there is
// demand but no chiller. refillCost: $10 per missing litre, up to 500L.

export const EVAP_PER_KW_PER_TICK = 0.001;
export const RESERVOIR_MAX_L = 500;

export default {
  type: 'coolingWater',
  displayName: 'Cooling Water',
  color: '#4488ff',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.04,
  capacityUnit: 'L/min',
  persistentStateDefaults: { reservoirVolumeL: RESERVOIR_MAX_L },
  solve(network, persistent, worldState) {
    const totalCapacity = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.capacity) || 0), 0);
    const totalDemand = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.heatLoad) || 0), 0);
    const currentReservoir = (persistent && persistent.reservoirVolumeL) || 0;
    const errors = [];
    const perSinkQuality = {};

    const dry = currentReservoir <= 0 && network.sinks.length > 0;
    let quality;
    if (dry) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: 'cooling_dry',
        message: 'Cooling reservoir is empty.',
        location: { networkId: network.id },
      });
    } else if (totalCapacity === 0 && totalDemand > 0) {
      quality = 0;
      errors.push({
        severity: 'soft',
        code: 'cooling_starved',
        message: 'Cooling network has no chiller capacity.',
        location: { networkId: network.id },
      });
    } else {
      quality = totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1;
    }

    for (const s of network.sinks) perSinkQuality[s.portKey] = quality;

    const evap = dry ? 0 : EVAP_PER_KW_PER_TICK * totalDemand;
    const nextReservoir = Math.max(0, currentReservoir - evap);

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity,
        totalDemand,
        utilization: totalCapacity > 0
          ? Math.min(1, totalDemand / totalCapacity)
          : (totalDemand > 0 ? 1 : 0),
        perSegmentLoad: [],
        perSinkQuality,
        errors: [...errors],
      },
      nextPersistentState: { ...persistent, reservoirVolumeL: nextReservoir },
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost(persistent) {
    const current = (persistent && persistent.reservoirVolumeL) || 0;
    const missing = RESERVOIR_MAX_L - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * 10) };
  },
};
