// src/utility/types/hvCable.js
//
// High-voltage feeders: the runs from an HV supply or main switchgear to a
// distribution device (switchgear, panel, MCC, UPS). Nothing else uses them.
//
// Why a seventh utility rather than "powerCable at a different point in the
// chain": with one type, nothing stops a player cabling a magnet straight to
// the transformer and skipping distribution entirely, so the two-stage chain
// would be a suggestion rather than a rule. Splitting it puts the rule in the
// port tables — a supply exposes only hv_out, a machine exposes only pwr_in,
// and the only thing that has both is a distribution device.
//
// It is also the one place capacity comes from. Distribution adds none (same
// principle the distribution buses already follow), so total facility capacity
// is exactly the sum of the supplies wired to something, and "how big a grid
// connection, and how many distribution points" is the decision.

import { hvFeedFactor } from '../power-feed.js';

export default {
  type: 'hvCable',
  displayName: 'HV Feeder',
  // Black, and thicker than a branch cable. The trunk has to look like trunk
  // at a glance or the split reads as two interchangeable tools.
  color: '#141418',
  // What the INTERACTIVE bits are drawn in — the available-port dots, the hover
  // highlight, the tap ring. Those are UI, and a black dot on a dark machine is
  // no dot at all. The cable itself stays black; only the things you are meant
  // to aim at get lifted to something visible.
  markerColor: '#8fa0b8',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.05,
  capacityUnit: 'kW',
  // Terminated at both ends into switchgear, and one feeder per outlet: a
  // supply's HV outlet count is how many distribution points it can serve.
  allowsTap: false,
  fansOut: false,
  // Bolting two panels together does not make an HV tie.
  bridgesAdjacent: false,
  // Dearer per metre than a branch circuit (armoured, higher insulation class)
  // but still inexpensive compared with equipment: $192 per tile.
  // Sized so that running one feeder to a well-placed panel beats running
  // several long branch circuits back to the transformer, which is the whole
  // reason to buy distribution gear.
  costPerSubUnit: 48,
  persistentStateDefaults: {},

  /**
   * Supply capacity against the connected distribution devices' draw.
   *
   * A distribution device declares `demand` on its hv_in equal to its own
   * rating: you size the feeder for the panel, not for whatever happens to be
   * plugged into it today. That keeps this solve local — no cross-network
   * coupling — and makes an oversized panel a real cost rather than a free
   * upgrade.
   */
  solve(network, persistent, worldState) {
    // A main switchgear cabinet is a downstream distributor, not a second
    // grid connection. Its HV outputs inherit the quality of its one HV input;
    // actual transformers have no hv_in and retain factor 1.
    const totalCapacity = network.sources.reduce(
      (a, s) => a + (s.capacity || 0) * hvFeedFactor(worldState, s.placeableId), 0);
    const totalDemand = network.sinks.reduce((a, s) => a + (s.demand || 0), 0);
    const errors = [];
    const perSinkQuality = {};
    let utilization = 0;

    if (totalDemand === 0) {
      utilization = 0;
    } else if (totalCapacity === 0) {
      utilization = 1;
      errors.push({
        severity: 'hard',
        code: 'hv_starved',
        message: 'HV feeder has no supply behind it.',
        location: { networkId: network.id },
      });
      for (const s of network.sinks) perSinkQuality[s.portKey] = 0;
    } else {
      utilization = totalDemand / totalCapacity;
      // Everything on an over-subscribed feeder is derated together — the
      // downstream panels then pass that quality on to their own outlets, so a
      // starved supply dims the whole tree rather than picking winners.
      const q = Math.min(1, totalCapacity / totalDemand);
      for (const s of network.sinks) perSinkQuality[s.portKey] = q;
      if (utilization > 1) {
        errors.push({
          severity: 'soft',
          code: 'hv_overload',
          message: `HV supply oversubscribed (${Math.round(utilization * 100)}%).`,
          location: { networkId: network.id },
        });
      }
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity,
        totalDemand,
        utilization: Math.min(1, utilization),
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
