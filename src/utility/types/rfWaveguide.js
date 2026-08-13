// src/utility/types/rfWaveguide.js
//
// RF waveguide utility descriptor.
//
// MATCHING IS BY BAND, ROUTING IS BY NETWORK. Those are the two halves of the
// model and they pull in opposite directions on purpose.
//
// Generous half: a source declares `params.bands` — the bands its hardware can
// physically produce — and drives any sink at any frequency inside one of them.
// A klystron is built for S-band, not for one number on a dial, so demanding an
// exact frequency match was bookkeeping rather than a decision, and it left
// whole rungs of the accelerating ladder with no source that could feed them.
//
// Strict half: ONE NETWORK CARRIES ONE FREQUENCY. A waveguide run is a resonant
// structure; you cannot put 162.5 MHz and 325 MHz down the same copper and have
// both arrive. So the network serves the frequency with the most demand on it
// (ties to the lower frequency, for stability across rebuilds) and everything
// else on that network is starved with a soft rf_frequency_split naming both
// frequencies — the fix is always "run a second network", never "buy a
// different tube". That is what keeps RF a layout problem.
//
// A served frequency with no in-band source gets quality 0 and a soft
// rf_frequency_mismatch; too little in-band capacity gets a soft rf_overload.
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

// Band table. Ranges are half-open [loMHz, hiMHz) and contiguous: every
// frequency between 50 MHz and 16 GHz lands in exactly one band, so a
// component can never fall between two.
//
// A source powers anything in a band it covers, at any frequency in that
// band — that is the "generous" half of the rule. The strict half lives in
// solve(): one network carries one frequency, so two frequencies in the same
// band still need two networks and two source instances.
export const RF_BANDS = [
  { id: 'vhf',   loMHz:    50, hiMHz:   500, label: 'VHF',     tier: 'beginner' },
  { id: 'uhf',   loMHz:   500, hiMHz:  1000, label: 'UHF',     tier: 'proton SRF' },
  { id: 'lband', loMHz:  1000, hiMHz:  2000, label: 'L-band',  tier: 'SRF workhorse' },
  { id: 'sband', loMHz:  2000, hiMHz:  4000, label: 'S-band',  tier: 'mid NC' },
  { id: 'cband', loMHz:  4000, hiMHz:  8000, label: 'C-band',  tier: 'high-gradient NC' },
  { id: 'xband', loMHz:  8000, hiMHz: 16000, label: 'X-band',  tier: 'expert NC' },
];

/** Band id for a frequency in HERTZ, or null if outside every band. */
export function bandForFrequencyHz(hz) {
  const mhz = hz / 1e6;
  for (const b of RF_BANDS) {
    if (mhz >= b.loMHz && mhz < b.hiMHz) return b.id;
  }
  return null;
}

// Fraction of the network's capacity that reaches a sink, in watts of peak
// power. Capacity is quoted in kW; sinks share it in proportion to their
// declared demand so an oversubscribed network starves everything on it
// proportionally rather than picking winners by iteration order.
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
  // No adjacency bridging: RF has to be guided. Pushing two klystrons together
  // does not make a waveguide, so every RF sink is wired explicitly.
  bridgesAdjacent: false,
  // $7,200/tile — brazed precision copper. waveguideManifold ($160k) beats
  // individual runs at about four sinks. Ladder: powerCable.js.
  costPerSubUnit: 1800,
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const errors = [];
    const perSinkQuality = {};
    const perSinkPower = {};

    // 1. Group sinks by frequency; the largest-demand frequency is the one
    //    this network carries. Ties go to the lower frequency so the result
    //    is stable across rebuilds.
    const byFreq = new Map();
    let totalDemand = 0;
    for (const sink of network.sinks) {
      const f = (sink.params && sink.params.frequency) || 0;
      if (!byFreq.has(f)) byFreq.set(f, []);
      byFreq.get(f).push(sink);
      totalDemand += sink.demand || 0;
    }
    const freqs = [...byFreq.keys()].sort((a, b) => a - b);
    const demandAt = (f) => byFreq.get(f).reduce((a, s) => a + (s.demand || 0), 0);
    let served = null;
    for (const f of freqs) {
      if (served === null || demandAt(f) > demandAt(served)) served = f;
    }

    // 2. Capacity-weighted mean duty factor across the sources that can
    //    actually feed the served band. A network mixing pulsed and CW sources
    //    delivers something in between, weighted by how much each contributes;
    //    a source that cannot reach this band contributes neither watts nor
    //    duty, or an out-of-band CW tube would flatten a pulsed network's peak.
    const servedBand = served === null ? null : bandForFrequencyHz(served);
    let capacity = 0, dutyWeighted = 0, dutyTotalCap = 0;
    for (const s of network.sources) {
      const bands = (s.params && s.params.bands) || [];
      if (!servedBand || !bands.includes(servedBand)) continue;
      const cap = s.capacity || 0;
      capacity += cap;
      dutyWeighted += cap * ((s.params && s.params.dutyFactor) || 1.0);
      dutyTotalCap += cap;
    }
    const meanDuty = dutyTotalCap > 0 ? dutyWeighted / dutyTotalCap : 1.0;
    // Peak power is average divided by duty. Clamped so a pathological duty
    // cannot mint unbounded gradient.
    const peakFactor = Math.min(1 / Math.max(meanDuty, 1e-4), 10000);

    if (served !== null) {
      // 3. Everything not on the served frequency is starved, with a diagnostic
      //    naming both sides so the fix ("run a second network") is obvious.
      for (const f of freqs) {
        if (f === served) continue;
        for (const s of byFreq.get(f)) {
          perSinkQuality[s.portKey] = 0;
          perSinkPower[s.portKey] = 0;
        }
        errors.push({
          severity: 'soft',
          code: 'rf_frequency_split',
          message: `This network carries ${(served / 1e6).toFixed(1)} MHz; `
            + `${(f / 1e6).toFixed(1)} MHz needs its own network and source.`,
          location: { networkId: network.id },
        });
      }

      const sinks = byFreq.get(served);
      const demand = demandAt(served);

      if (capacity === 0 && demand > 0) {
        for (const s of sinks) { perSinkQuality[s.portKey] = 0; perSinkPower[s.portKey] = 0; }
        errors.push({
          severity: 'soft',
          code: 'rf_frequency_mismatch',
          message: `No RF source covering ${servedBand || 'this frequency'} `
            + `(${(served / 1e6).toFixed(1)} MHz).`,
          location: { networkId: network.id },
        });
      } else {
        // demand === 0 lands here too: the cavity is connected to whatever the
        // network can supply, which is the honest answer for an idle sink.
        const q = demand > 0 ? Math.min(1, capacity / demand) : 1;
        for (const s of sinks) perSinkQuality[s.portKey] = q;
        Object.assign(perSinkPower,
          distributePower(sinks, capacity, demand, peakFactor));
        if (demand > capacity) {
          errors.push({
            severity: 'soft',
            code: 'rf_overload',
            message: `RF overload at ${(served / 1e6).toFixed(1)} MHz `
              + `(${demand}/${capacity} kW).`,
            location: { networkId: network.id },
          });
        }
      }
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        // Eligible capacity only. An out-of-band klystron parked on this
        // network is not headroom, and reporting it as such would show a
        // healthy utilisation bar over a network delivering zero watts.
        totalCapacity: capacity,
        totalDemand,
        utilization: capacity > 0
          ? Math.min(1, totalDemand / capacity)
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
