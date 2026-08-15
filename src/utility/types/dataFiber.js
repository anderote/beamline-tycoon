// src/utility/types/dataFiber.js
//
// Data fiber utility descriptor. v1 physics: binary connectivity. If the
// network has ≥1 source, every sink is "connected" (quality 1); otherwise the
// sinks are orphaned (quality 0) and a soft data_disconnected error is raised.

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
  solve(network, persistent, worldState) {
    const poweredSources = network.sources.filter(s => powerFeedFactor(worldState, s.placeableId) > 0);
    const hasSource = poweredSources.length > 0;
    // The physics is binary connectivity, but the flow totals are display
    // fields tagged with capacityUnit — publish real Gbps like every other
    // descriptor, not port counts (the inspector showed "1.0 Gbps" above
    // rows reading "40 Gbps").
    const totalCapacity = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.capacity) || 0)
        * powerFeedFactor(worldState, s.placeableId), 0);
    const totalDemand = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.demand) || 0), 0);
    const perSinkQuality = {};
    const errors = [];
    if (hasSource) {
      for (const s of network.sinks) perSinkQuality[s.portKey] = 1;
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
