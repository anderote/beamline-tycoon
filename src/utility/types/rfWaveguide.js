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

import { powerFeedFactor } from '../power-feed.js';
import { expandPath } from '../line-geometry.js';
import { RF_BANDS, bandForFrequencyHz } from '../../data/rf-bands.js';

// Compatibility export for existing UI and tests. New data-layer consumers
// should import the neutral module directly.
export { RF_BANDS, bandForFrequencyHz } from '../../data/rf-bands.js';
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

// A waveguide tee is not transparent: each unmatched branch is an impedance
// discontinuity. Count real T-junctions (a line end landing on another line's
// interior) plus any source connector used by more than one run. Dedicated
// multi-output hardware, such as the four-output solid-state amplifier, has
// one line per port and therefore does not pay this penalty.
function branchTopology(network, worldState) {
  const lineMap = worldState?.utilityLines;
  const ids = new Set(network.lineIds || []);
  if (!lineMap || ids.size === 0) return { taps: 0, sourceFanouts: 0, count: 0 };
  const getLine = id => typeof lineMap.get === 'function'
    ? lineMap.get(id)
    : (Array.isArray(lineMap) ? lineMap.find(line => line?.id === id) : lineMap[id]);
  const pointKey = point => `${Math.round(point.col * 4)}:${Math.round(point.row * 4)}`;
  const interiorAt = new Map();
  const endsAt = new Map();
  const sourceKeys = new Set((network.sources || []).map(source => source.portKey));
  const sourceUses = new Map();

  for (const id of ids) {
    const line = getLine(id);
    if (!line || line.utilityType !== 'rfWaveguide') continue;
    const path = expandPath(line.path || []);
    if (path.length < 2) continue;
    for (let i = 1; i < path.length - 1; i++) {
      const key = pointKey(path[i]);
      let lines = interiorAt.get(key);
      if (!lines) { lines = new Set(); interiorAt.set(key, lines); }
      lines.add(id);
    }
    for (const [index, ref] of [[0, line.start], [path.length - 1, line.end]]) {
      const key = pointKey(path[index]);
      let lines = endsAt.get(key);
      if (!lines) { lines = new Set(); endsAt.set(key, lines); }
      lines.add(id);
      if (ref) {
        const portKey = `${ref.placeableId}:${ref.portName}`;
        if (sourceKeys.has(portKey)) sourceUses.set(portKey, (sourceUses.get(portKey) || 0) + 1);
      }
    }
  }

  let taps = 0;
  for (const [key, endLines] of endsAt) {
    const interiors = interiorAt.get(key);
    if (interiors && [...endLines].some(id => !interiors.has(id))) taps++;
  }
  let sourceFanouts = 0;
  for (const uses of sourceUses.values()) sourceFanouts += Math.max(0, uses - 1);
  return { taps, sourceFanouts, count: taps + sourceFanouts };
}

export const RF_BRANCH_REFLECTION_PER_JUNCTION = 0.04;

function branchReflectionFraction(branches) {
  return 1 - Math.pow(1 - RF_BRANCH_REFLECTION_PER_JUNCTION, branches);
}

// Publish a display-ready discrete spectrum from the same quantities that
// drive cavity quality. The UI must not rediscover frequencies or reconstruct
// delivered power from endpoints: this is the solver-owned contract for RF
// instrumentation views.
function buildRfSpectrum(freqs, byFreq, served, servedBand, perSinkQuality,
  perSinkPower, capacity, nameplateCapacity, meanDuty, peakFactor,
  branchReflection, vswr) {
  const bins = freqs.map((frequencyHz) => {
    const sinks = byFreq.get(frequencyHz) || [];
    let demandAveragePowerKw = 0;
    let deliveredPeakPowerW = 0;
    let quality = null;
    for (const sink of sinks) {
      demandAveragePowerKw += sink.demand || 0;
      deliveredPeakPowerW += perSinkPower[sink.portKey] || 0;
      const sinkQuality = perSinkQuality[sink.portKey];
      if (typeof sinkQuality === 'number') {
        quality = quality === null ? sinkQuality : Math.min(quality, sinkQuality);
      }
    }
    return {
      frequencyHz,
      band: bandForFrequencyHz(frequencyHz),
      sinkCount: sinks.length,
      demandAveragePowerKw,
      deliveredPeakPowerW,
      quality,
      status: frequencyHz === served ? 'carried' : 'rejected',
    };
  });

  return {
    carrierFrequencyHz: served,
    carrierBand: servedBand,
    forwardAveragePowerKw: capacity,
    forwardPeakPowerW: capacity * 1000 * peakFactor,
    reflectedAveragePowerKw: Math.max(0, nameplateCapacity - capacity),
    reflectionFraction: branchReflection,
    meanDuty,
    vswr,
    bins,
  };
}

export default {
  type: 'rfWaveguide',
  displayName: 'RF Waveguide',
  color: '#cc4444',
  geometryStyle: 'rectWaveguide',
  pipeRadiusMeters: 0.05,
  // A routed guide rides on low steel saddles rather than clipping into the
  // slab. High equipment ports use a short horizontal launch and a sloped
  // dogleg down to this deck height; the renderer derives the exact drop from
  // the measured connector, so authored/model misalignments remain harmless.
  runHeightMeters: 0.22,
  dropLaunchMeters: 0.28,
  dropMinRampMeters: 0.35,
  dropMaxRampMeters: 1.35,
  dropRunPerRise: 1,
  supportSpacingMeters: 3,
  supportMinimumRunMeters: 3,
  verticalRouteLanes: true,
  routeLaneSpacingMeters: 0.30,
  routeVerticalClearanceMeters: 0.06,
  maxRouteHeightMeters: 3.0,
  // Keep waveguide routing readable without making gallery layout a puzzle:
  // paths stay rectilinear, but may turn immediately at a fitting and cross
  // equipment/other services like the existing cryogenic transfer-line
  // contract. Network topology still decides what is electrically connected.
  routingProfile: 'rectilinear',
  portClearance: false,
  // Presentation only: use a compact 45-degree miter body at each 90-degree
  // turn. The renderer trims it to fit short legs; it does not impose a
  // minimum straight run or reject a compact route.
  bendStyle: 'mitered',
  miterLengthMeters: 0.16,
  fittingStyle: 'waveguideFlange',
  couplerSpacingMeters: 3,
  capacityUnit: 'kW',
  // Waveguide may tee, but every tee introduces a modeled impedance mismatch.
  // Extra branches show up as reflected power and worse VSWR in the RF panel.
  allowsTap: true,
  // A fabricated guide is broad enough to merit a wider pickup halo than the
  // thin hose/cable default. The committed tee still lands on the shared
  // quarter-tile topology grid.
  tapSnapRadiusTiles: 0.65,
  // Ports still fan out, though. Socket-counting is a POWER mechanic — it is
  // what makes distribution panels a decision — and applying it here would
  // mean re-authoring every amplifier and IOC with a port per client for no
  // gameplay gained. Tapping and fanning are separate axes.
  fansOut: true,
  // No adjacency bridging: RF has to be guided. Pushing two klystrons together
  // does not make a waveguide, so every RF sink is wired explicitly.
  bridgesAdjacent: false,
  // $288/tile — brazed precision copper, still well below the RF hardware it
  // connects. Ladder: powerCable.js.
  costPerSubUnit: 72,
  persistentStateDefaults: {},
  solve(network, persistent, worldState, context = {}) {
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
    let nameplateCapacity = 0, dutyWeighted = 0, dutyTotalCap = 0;
    for (const s of network.sources) {
      const bands = (s.params && s.params.bands) || [];
      if (!servedBand || !bands.includes(servedBand)) continue;
      const cap = (s.capacity || 0)
        * powerFeedFactor(worldState, s.placeableId, context.getDefinition);
      nameplateCapacity += cap;
      dutyWeighted += cap * ((s.params && s.params.dutyFactor) || 1.0);
      dutyTotalCap += cap;
    }
    const topology = branchTopology(network, worldState);
    const branchReflection = branchReflectionFraction(topology.count);
    const capacity = nameplateCapacity * (1 - branchReflection);
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

    if (topology.count > 0) {
      errors.push({
        severity: 'soft',
        code: 'rf_branch_mismatch',
        message: `RF network has ${topology.count} waveguide branch${topology.count === 1 ? '' : 'es'}; `
          + `${Math.round(branchReflection * 100)}% is reflected at the tee${topology.count === 1 ? '' : 's'}.`,
        location: { networkId: network.id },
      });
    }

    const vswr = branchReflection > 0
      ? (1 + Math.sqrt(branchReflection)) / (1 - Math.sqrt(branchReflection))
      : 1;
    const rfSpectrum = buildRfSpectrum(
      freqs,
      byFreq,
      served,
      servedBand,
      perSinkQuality,
      perSinkPower,
      capacity,
      nameplateCapacity,
      meanDuty,
      peakFactor,
      branchReflection,
      vswr,
    );

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        // Eligible delivered capacity only. An out-of-band klystron parked on this
        // network is not headroom, and reporting it as such would show a
        // healthy utilisation bar over a network delivering zero watts.
        totalCapacity: capacity,
        nameplateCapacity,
        totalDemand,
        utilization: capacity > 0
          ? Math.min(1, totalDemand / capacity)
          : (totalDemand > 0 ? 1 : 0),
        meanDuty,
        peakFactor,
        branchCount: topology.count,
        branchTapCount: topology.taps,
        branchSourceFanouts: topology.sourceFanouts,
        branchReflectionFraction: branchReflection,
        vswr,
        rfSpectrum,
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
