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
  // Flexible conductors cannot be routed through building fabric. A wall
  // crossing is made as two cables terminated on a wall feedthrough.
  requiresWallPassThrough: true,
  // A plug is an explicit port-to-port connection. Distribution is modeled by
  // panels and busways, never by two cabinets merely touching on the floor.
  bridgesAdjacent: false,
  // Utility routing is support infrastructure, not the main capital expense.
  // Rates are per quarter-tile; the current ladder per tile is fibre $48,
  // power $96, cooling $144, HV $192, vacuum $224, RF $288, and cryo $640.
  // Distribution gear remains useful for topology and capacity, rather than
  // being an artificial way to avoid punitive cable prices.
  costPerSubUnit: 24,
  persistentStateDefaults: {},
  solve(network, persistent, worldState, context = {}) {
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
    const suppliedCapacity = network.sources.reduce(
      (a, s) => a + (s.capacity || 0)
        * hvFeedFactor(worldState, s.placeableId, new Set(), context.getDefinition), 0);
    // A field distributor is passive, so it cannot appear as another source
    // without duplicating the upstream panel's capacity. Its rated throughput
    // instead caps the branch network it belongs to. Reading every pass port
    // is intentional: discovery includes all of a box's ports once it is
    // wired, and the same rating is carried on each one.
    const fieldLimits = [...new Set(network.ports
      .map(p => p.params && p.params.fieldCapacity)
      .filter(limit => Number.isFinite(limit) && limit > 0))];
    const fieldCapacity = fieldLimits.length > 0 ? Math.min(...fieldLimits) : Infinity;
    const totalCapacity = Math.min(suppliedCapacity, fieldCapacity);
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
        message: fieldCapacity < suppliedCapacity
          ? `Field distribution is overloaded (${Math.round(utilization * 100)}%).`
          : `Power network overloaded (${Math.round(utilization * 100)}%).`,
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
