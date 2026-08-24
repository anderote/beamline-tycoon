// src/utility/types/dataFiber.js
//
// Data fiber is a bidirectional shared fabric. It has no upstream source,
// downstream sink, or bandwidth budget: every port on one connected component
// is a peer. A required data port is live when its network reaches at least one
// other device and disconnected otherwise.

import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../routing-contract.js';

export default {
  type: 'dataFiber',
  displayName: 'Data Fiber',
  color: '#eeeeee',
  geometryStyle: 'fiberBundle',
  routingProfile: FLEXIBLE_SUBTILE_ROUTING_PROFILE,
  requiresWallPassThrough: true,
  // Ordinary data runs are loose flexible cables, sized to remain legible at
  // normal map zoom. Authored rack anchors can pull a span into the much
  // tighter overhead-bus presentation.
  pipeRadiusMeters: 0.025,
  bundleStrandRadiusMeters: 0.008,
  bundleSpacingMeters: 0.014,
  capacityUnit: 'nodes',
  topologyOnly: true,
  topology: 'bus',
  directional: false,
  // Every data fitting is a small peer hub by default. Individual authored
  // ports may still narrow or widen this with their own maxConnections.
  defaultPortMaxConnections: 4,
  // Data trunks accept tees and every connected port is a peer on the same
  // fabric. A switch supplies physical fan-out, not capacity or direction.
  allowsTap: true,
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
    const nodes = new Set([
      ...(network.ports || []),
      ...(network.sources || []),
      ...(network.sinks || []),
    ].map(port => port?.placeableId).filter(Boolean));
    const connected = nodes.size >= 2;
    const perSinkQuality = {};
    const errors = [];
    for (const sink of network.sinks || []) {
      perSinkQuality[sink.portKey] = connected ? 1 : 0;
    }
    if (!connected && (network.sinks || []).length > 0) {
      errors.push({
        severity: 'soft',
        code: 'data_disconnected',
        message: 'Data node has no connected peer.',
        location: { networkId: network.id },
      });
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        // Retain a binary totalCapacity for generic progression checks that
        // treat a positive value as "this utility network is live". Data has
        // no numeric throughput capacity; connectedNodeCount is authoritative.
        totalCapacity: connected ? 1 : 0,
        totalDemand: 0,
        utilization: connected ? 1 : 0,
        connectedNodeCount: nodes.size,
        connectedLinkCount: (network.lineIds || []).length,
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
