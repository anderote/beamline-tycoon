// src/utility/types/dataFiber.js
//
// Data fiber utility descriptor. Capacity is shared by every sink on a
// network: a 40 Gbps switch serving 50 Gbps of endpoints delivers 80% to each.
// Missing sources still fail closed with a soft data_disconnected warning.

import { powerFeedFactor } from '../power-feed.js';

export default {
  type: 'dataFiber',
  displayName: 'Data Fiber',
  color: '#eeeeee',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.01,
  capacityUnit: 'Gbps',
  // Fibre is terminated at both ends and patched at a panel, never spliced
  // mid-run by the player.
  allowsTap: false,
  // Ports still fan out, though. Socket-counting is a POWER mechanic — it is
  // what makes distribution panels a decision — and applying it here would
  // mean re-authoring every amplifier and IOC with a port per client for no
  // gameplay gained. Tapping and fanning are separate axes.
  fansOut: true,
  // Adjacency bridging: touching components share the link, as a rack's
  // backplane does. Most data devices declare BOTH data_in and data_out, and
  // discovery treats such a converter as a boundary that never bridges, so in
  // practice this reaches read-only sinks parked against a wired device.
  bridgesAdjacent: true,
  // $48/tile — the cheapest run to pull. Ladder: powerCable.js.
  costPerSubUnit: 12,
  persistentStateDefaults: {},
  solve(network, persistent, worldState, context = {}) {
    const poweredSources = network.sources.filter(s =>
      powerFeedFactor(worldState, s.placeableId, context.getDefinition) > 0);
    const hasSource = poweredSources.length > 0;
    const totalCapacity = poweredSources.reduce(
      (a, s) => a + ((s.params && s.params.capacity) || 0)
        * powerFeedFactor(worldState, s.placeableId, context.getDefinition), 0);
    const totalDemand = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.demand) || 0), 0);
    const perSinkQuality = {};
    const errors = [];
    if (hasSource) {
      // Opaque descriptor tests historically omit params; retain their simple
      // connectivity meaning while all authored game ports use real Gbps.
      const quality = totalCapacity <= 0 && poweredSources.every(s => !s.params)
        ? 1
        : (totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1);
      for (const s of network.sinks) perSinkQuality[s.portKey] = quality;
      if (quality < 1) {
        errors.push({
          severity: 'soft',
          code: 'data_overloaded',
          message: `Data network overloaded (${totalDemand.toFixed(1)} Gbps demand / ${totalCapacity.toFixed(1)} Gbps capacity).`,
          location: { networkId: network.id },
        });
      }
    } else if (network.sinks.length > 0) {
      for (const s of network.sinks) perSinkQuality[s.portKey] = 0;
      errors.push({
        severity: 'soft',
        code: 'data_disconnected',
        message: 'Data network has no source.',
        location: { networkId: network.id },
      });
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity,
        totalDemand,
        utilization: totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity)
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
