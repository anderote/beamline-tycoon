// src/utility/types/coolingWater.js
//
// Cooling water utility descriptor. v1 physics: chiller capacity vs sink heat
// load; reservoir decrements by EVAP_PER_KW_PER_TICK × totalHeatKW. Hard
// cooling_dry when the reservoir empties; soft cooling_starved when there is
// demand but no chiller. refillCost: WATER_COST_PER_L per missing litre.
//
// Balance (Phase 7, scripts/balance-sim.mjs): a 30 kW starter loop drinks
// 0.6 L/tick — a ~$5k refill every ~700 ticks; a 60 kW detector loop refills
// about twice as often. Visible recurring cost, not a death spiral.

export const EVAP_PER_KW_PER_TICK = 0.02;
export const RESERVOIR_MAX_L = 500;
export const WATER_COST_PER_L = 12;

export default {
  type: 'coolingWater',
  displayName: 'Cooling Water',
  color: '#4488ff',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.04,
  // Capacity and heatLoad are both kW of heat moved (Phase 7 tuning:
  // lcwSkid 100 → chiller 300 → coolingTower 800); litres only track the
  // reservoir level.
  capacityUnit: 'kW',
  // Per-port param names the inspector reads for its source/sink rows.
  capacityParam: 'capacity',
  demandParam: 'heatLoad',
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
    return { funding: Math.ceil(missing * WATER_COST_PER_L) };
  },
};
