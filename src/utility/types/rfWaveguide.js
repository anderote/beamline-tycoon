// src/utility/types/rfWaveguide.js
//
// RF waveguide utility descriptor. v1 physics: sources and sinks are bucketed
// by params.frequency. Each bucket is solved independently: sinks whose
// frequency is not produced by any source in the network get quality 0 and a
// soft rf_frequency_mismatch; overloaded buckets get soft rf_overload.

export default {
  type: 'rfWaveguide',
  displayName: 'RF Waveguide',
  color: '#cc4444',
  geometryStyle: 'rectWaveguide',
  pipeRadiusMeters: 0.05,
  capacityUnit: 'kW',
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const byFreqSource = new Map();
    const byFreqSink = new Map();
    for (const s of network.sources) {
      const f = (s.params && s.params.frequency) || 0;
      byFreqSource.set(f, (byFreqSource.get(f) || 0) + (s.capacity || 0));
    }
    for (const sink of network.sinks) {
      const f = (sink.params && sink.params.frequency) || 0;
      if (!byFreqSink.has(f)) byFreqSink.set(f, []);
      byFreqSink.get(f).push(sink);
    }

    const errors = [];
    const perSinkQuality = {};
    let totalCapacity = 0;
    let totalDemand = 0;

    for (const cap of byFreqSource.values()) totalCapacity += cap;

    for (const [freq, sinks] of byFreqSink) {
      const demand = sinks.reduce((a, s) => a + (s.demand || 0), 0);
      totalDemand += demand;
      const cap = byFreqSource.get(freq) || 0;
      if (cap === 0 && demand > 0) {
        for (const s of sinks) perSinkQuality[s.portKey] = 0;
        errors.push({
          severity: 'soft',
          code: 'rf_frequency_mismatch',
          message: `No RF source at ${freq} Hz.`,
          location: { networkId: network.id },
        });
      } else if (cap > 0 && demand > 0) {
        const q = Math.min(1, cap / demand);
        for (const s of sinks) perSinkQuality[s.portKey] = q;
        if (demand > cap) {
          errors.push({
            severity: 'soft',
            code: 'rf_overload',
            message: `RF overload at ${freq} Hz (${demand}/${cap} kW).`,
            location: { networkId: network.id },
          });
        }
      } else {
        // demand === 0 — nothing to quality.
        for (const s of sinks) perSinkQuality[s.portKey] = 1;
      }
    }

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
      nextPersistentState: persistent,
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
