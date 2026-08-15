// src/utility/types/powerCable.js
//
// Power cable utility descriptor. v1 physics: sum source capacity vs sum sink
// demand. Hard error when sinks exist but no capacity (trips beam via
// infraCanRun), soft error for overload.

import { hvFeedFactor } from '../power-feed.js';

export default {
  type: 'powerCable',
  displayName: 'Power Cable',
  color: '#44cc44',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.02,
  capacityUnit: 'kW',
  // A cable is point to point: terminated at both ends, one plug per socket.
  // You do not cut one open mid-run to add a machine — you go back to a
  // distribution panel. Together these two make outlet count the resource that
  // decides how much distribution gear a facility needs and where it sits.
  allowsTap: false,
  fansOut: false,
  // Adjacency bridging: components whose footprints touch share this utility
  // with no line between them (network-discovery.computeAdjacency). Bolting a
  // rack onto the one beside it is how a real hall distributes power.
  bridgesAdjacent: true,
  // ---- Phase 12: utility lines have a price. ------------------------------
  // `costPerSubUnit` is dollars per sub-unit of drawn path; a sub-unit is a
  // quarter tile (line-geometry.SUB_PER_TILE = 4), so multiply by 4 for the
  // per-tile figure. utility-run-wiring.runWiringCost reads it; a descriptor
  // that declares none is free.
  //
  // Sized so that wiring a whole beamline is a real budget line and never the
  // dominant one: measured on the sim's reference line (scripts/balance-
  // playthrough beamlineWiringCost), $458k of wire against $3.25M of hardware
  // — 14%, and the line's true price is $3.83M rather than its catalogue.
  //
  // These rates bind on BOTH commit paths — the run-wiring drag and the
  // ordinary single-line draw (UtilityLineInputController). They have to: the
  // break-even below compares a bus against individual runs, and free single
  // runs would make every bus in the catalogue a strictly worse buy.
  //
  // The ladder across the six utilities, per sub-unit / per tile:
  //   dataFiber      300 /  1,200   fibre is cheap to pull
  //   powerCable     600 /  2,400
  //   coolingWater   900 /  3,600   pumped loop, insulated
  //   vacuumPipe   1,400 /  5,600   UHV-clean beam pipe
  //   rfWaveguide  1,800 /  7,200   precision copper, brazed flanges
  //   cryoTransfer 4,000 / 16,000   vacuum-jacketed LHe line, the outlier
  //
  // Each rate is also set against its distribution component so a bus stays
  // clearly cheaper than N individual runs. A bus replaces (N-1) full
  // source→sink paths (~10 tiles) with (N-1) short stubs (~2 tiles), saving
  // (N-1) x 32 sub-units; at $600 a powerBus ($90k) pays for itself at six
  // sinks, and the tighter utilities (cooling/vacuum/RF) at four.
  costPerSubUnit: 600,
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    // A distribution panel delivers only what its own feeder gives it.
    //
    // The HV network and this branch network are separate networks of separate
    // types, so the coupling has to be explicit: scale each outlet's capacity
    // by the quality the owning device's hv_in last solved to. No feeder, or a
    // starved one, and the outlets deliver nothing — which then trips the
    // existing power_starved hard error on the branch, the correct reading
    // (the machines on that panel are dead).
    //
    // hvCable is registered BEFORE powerCable, so this reads the same tick's
    // result rather than the previous one. A device with no hv_in at all
    // defaults to 1: it is a supply in its own right, not a panel.
    const totalCapacity = network.sources.reduce(
      (a, s) => a + (s.capacity || 0) * hvFeedFactor(worldState, s.placeableId), 0);
    const totalDemand   = network.sinks.reduce((a, s) => a + (s.demand || 0), 0);
    const errors = [];
    const perSinkQuality = {};
    let utilization = 0;

    if (totalDemand === 0) {
      utilization = 0;
    } else if (totalCapacity === 0) {
      utilization = 1;
      errors.push({
        severity: 'hard',
        code: 'power_starved',
        message: 'Power network has no capacity.',
        location: { networkId: network.id },
      });
      for (const s of network.sinks) perSinkQuality[s.portKey] = 0;
    } else {
      utilization = totalDemand / totalCapacity;
      const q = Math.min(1, totalCapacity / totalDemand);
      for (const s of network.sinks) perSinkQuality[s.portKey] = q;
      if (utilization > 1) {
        errors.push({
          severity: 'soft',
          code: 'power_overload',
          message: `Power network overloaded (${Math.round(utilization * 100)}%).`,
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
