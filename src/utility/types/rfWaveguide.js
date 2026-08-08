// src/utility/types/rfWaveguide.js
//
// RF waveguide utility descriptor. Physics: sinks are bucketed by
// params.frequency and each bucket is solved independently. Sources come in
// two kinds:
//   - fixed-frequency (params.frequency): capacity counts only toward the
//     matching bucket (a 2856 MHz klystron cannot drive a 1300 MHz cavity);
//   - broadband (params.broadband: true): capacity is a shared pool,
//     allocated across buckets after fixed sources, in ascending-frequency
//     order (deterministic), each bucket taking only its unmet demand.
// Sinks in buckets with zero effective capacity get quality 0 and a soft
// rf_frequency_mismatch; overloaded buckets get soft rf_overload.

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
    let broadbandPool = 0;
    for (const s of network.sources) {
      const cap = s.capacity || 0;
      if (s.params && s.params.broadband) {
        broadbandPool += cap;
        continue;
      }
      const f = (s.params && s.params.frequency) || 0;
      byFreqSource.set(f, (byFreqSource.get(f) || 0) + cap);
    }
    for (const sink of network.sinks) {
      const f = (sink.params && sink.params.frequency) || 0;
      if (!byFreqSink.has(f)) byFreqSink.set(f, []);
      byFreqSink.get(f).push(sink);
    }

    const errors = [];
    const perSinkQuality = {};
    let totalCapacity = broadbandPool;
    let totalDemand = 0;

    for (const cap of byFreqSource.values()) totalCapacity += cap;

    // Deterministic bucket order: ascending frequency.
    const buckets = [...byFreqSink.entries()].sort((a, b) => a[0] - b[0]);

    for (const [freq, sinks] of buckets) {
      const demand = sinks.reduce((a, s) => a + (s.demand || 0), 0);
      totalDemand += demand;
      let cap = byFreqSource.get(freq) || 0;
      // Broadband pool tops up unmet demand in this bucket.
      if (demand > cap && broadbandPool > 0) {
        const take = Math.min(broadbandPool, demand - cap);
        cap += take;
        broadbandPool -= take;
      }
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
