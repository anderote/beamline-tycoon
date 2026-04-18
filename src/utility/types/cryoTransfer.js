// src/utility/types/cryoTransfer.js
//
// Cryogenic LHe transfer line descriptor. Analogous to coolingWater but sized
// for watts of static heat and litres of LHe. Boil-off scales with total heat
// in watts. Hard cryo_quench if lheVolumeL drops below the quench threshold.
// refillCost: $50 per missing litre, capped at 500L.

export const BOILOFF_PER_W_PER_TICK = 0.0005;
export const RESERVOIR_MAX_L = 500;
export const QUENCH_THRESHOLD_L = 20;

export default {
  type: 'cryoTransfer',
  displayName: 'Cryo Transfer',
  color: '#44aacc',
  geometryStyle: 'jacketedCylinder',
  pipeRadiusMeters: 0.06,
  capacityUnit: 'W@4K',
  persistentStateDefaults: { lheVolumeL: RESERVOIR_MAX_L },
  solve(network, persistent, worldState) {
    const totalCapacity = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.coldCapacityW) || 0), 0);
    const totalDemand = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.srfHeatW) || 0), 0);
    const currentLhe = (persistent && persistent.lheVolumeL) || 0;
    const errors = [];
    const perSinkQuality = {};

    const quenched = currentLhe < QUENCH_THRESHOLD_L && network.sinks.length > 0;
    let quality;
    if (quenched) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: 'cryo_quench',
        message: `LHe reservoir below quench threshold (${currentLhe.toFixed(1)} L < ${QUENCH_THRESHOLD_L} L).`,
        location: { networkId: network.id },
      });
    } else if (totalCapacity === 0 && totalDemand > 0) {
      quality = 0;
      errors.push({
        severity: 'soft',
        code: 'cryo_starved',
        message: 'Cryo network has no cold-box capacity.',
        location: { networkId: network.id },
      });
    } else {
      quality = totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1;
    }

    for (const s of network.sinks) perSinkQuality[s.portKey] = quality;

    const boiloff = quenched ? 0 : BOILOFF_PER_W_PER_TICK * totalDemand;
    const nextLhe = Math.max(0, currentLhe - boiloff);

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
      nextPersistentState: { ...persistent, lheVolumeL: nextLhe },
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost(persistent) {
    const current = (persistent && persistent.lheVolumeL) || 0;
    const missing = RESERVOIR_MAX_L - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * 50) };
  },
};
