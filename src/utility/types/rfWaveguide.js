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
//
// Alongside the 0-1 quality, this publishes `perSinkPower` in WATTS OF PEAK
// power. That is what actually sets a cavity's gradient — E_acc goes as
// sqrt(P) (see beam_physics/srf.py), so the old linear rfQuality derate had
// the wrong exponent as well as the wrong units.
//
// DUTY FACTOR reconciles the game's kilowatt-scale RF ladder with the megawatt
// peak power a normal-conducting structure needs. Pulsed sources deliver their
// average power in short bursts: a 50 kW pulsed klystron at 0.1% duty is
// 50 MW peak. This makes pulsed and CW genuinely different engineering
// choices rather than flavour text — pulsed buys peak gradient (brightness
// machines), CW buys average current (power machines).

// Fraction of a bucket's capacity that reaches a sink, in watts of peak power.
// Capacity is quoted in kW; sinks share it in proportion to their declared
// demand so an oversubscribed bucket starves everything on it proportionally
// rather than picking winners by iteration order.
function distributePower(sinks, capKw, demandTotal, peakFactor) {
  const out = {};
  const capW = capKw * 1000 * peakFactor;
  for (const s of sinks) {
    const share = demandTotal > 0 ? (s.demand || 0) / demandTotal : 1 / sinks.length;
    out[s.portKey] = capW * share;
  }
  return out;
}

export default {
  type: 'rfWaveguide',
  displayName: 'RF Waveguide',
  color: '#cc4444',
  geometryStyle: 'rectWaveguide',
  pipeRadiusMeters: 0.05,
  capacityUnit: 'kW',
  // $7,200/tile — brazed precision copper. waveguideManifold ($160k) beats
  // individual runs at about four sinks. Ladder: powerCable.js.
  costPerSubUnit: 1800,
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const byFreqSource = new Map();
    const byFreqSink = new Map();
    let broadbandPool = 0;
    // Capacity-weighted mean duty factor across the sources feeding this
    // network. A network mixing pulsed and CW sources delivers something in
    // between, weighted by how much each contributes.
    let dutyWeighted = 0, dutyTotalCap = 0;
    for (const s of network.sources) {
      const cap = s.capacity || 0;
      const duty = (s.params && s.params.dutyFactor) || 1.0;
      dutyWeighted += cap * duty;
      dutyTotalCap += cap;
      if (s.params && s.params.broadband) {
        broadbandPool += cap;
        continue;
      }
      const f = (s.params && s.params.frequency) || 0;
      byFreqSource.set(f, (byFreqSource.get(f) || 0) + cap);
    }
    const meanDuty = dutyTotalCap > 0 ? dutyWeighted / dutyTotalCap : 1.0;
    // Peak power is average divided by duty. Clamped so a pathological duty
    // cannot mint unbounded gradient.
    const peakFactor = Math.min(1 / Math.max(meanDuty, 1e-4), 10000);
    for (const sink of network.sinks) {
      const f = (sink.params && sink.params.frequency) || 0;
      if (!byFreqSink.has(f)) byFreqSink.set(f, []);
      byFreqSink.get(f).push(sink);
    }

    const errors = [];
    const perSinkQuality = {};
    const perSinkPower = {};
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
        for (const s of sinks) {
          perSinkQuality[s.portKey] = 0;
          perSinkPower[s.portKey] = 0;
        }
        errors.push({
          severity: 'soft',
          code: 'rf_frequency_mismatch',
          message: `No RF source at ${freq} Hz.`,
          location: { networkId: network.id },
        });
      } else if (cap > 0 && demand > 0) {
        const q = Math.min(1, cap / demand);
        for (const s of sinks) perSinkQuality[s.portKey] = q;
        Object.assign(perSinkPower,
          distributePower(sinks, cap, demand, peakFactor));
        if (demand > cap) {
          errors.push({
            severity: 'soft',
            code: 'rf_overload',
            message: `RF overload at ${freq} Hz (${demand}/${cap} kW).`,
            location: { networkId: network.id },
          });
        }
      } else {
        // demand === 0 — nothing to quality, but the cavity is still connected
        // to whatever the bucket can supply.
        for (const s of sinks) perSinkQuality[s.portKey] = 1;
        Object.assign(perSinkPower,
          distributePower(sinks, cap, 0, peakFactor));
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
        meanDuty,
        peakFactor,
        perSegmentLoad: [],
        perSinkQuality,
        perSinkPower,
        errors: [...errors],
      },
      nextPersistentState: persistent,
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
