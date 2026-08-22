// Rigid fabricated water header for high-flow plant and large equipment.
// The physical construction follows cryogenic transfer pipe (fixed-diameter
// formed runs, elbows, tees and supports), while every committed run is tagged
// as cold supply, room-temperature plant transfer, or hot return.

import { powerFeedFactor } from '../power-feed.js';
import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../routing-contract.js';
import {
  RIGID_UTILITY_SERVICE_HEIGHTS,
  RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  RIGID_UTILITY_SUPPORT_SPACING_METERS,
} from '../service-heights.js';
import {
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_COLORS,
  WATER_CIRCUIT_HOT,
  WATER_CIRCUIT_ROOM,
  lineWaterCircuit,
  portWaterCircuit,
} from '../water-circuits.js';

function circuitForNetwork(network, worldState) {
  const circuits = new Set();
  for (const port of network?.ports || []) {
    const circuit = portWaterCircuit(port);
    if (circuit) circuits.add(circuit);
  }
  for (const lineId of network?.lineIds || []) {
    const circuit = lineWaterCircuit(worldState?.utilityLines?.get?.(lineId));
    if (circuit) circuits.add(circuit);
  }
  return circuits.size === 1 ? [...circuits][0] : (circuits.size > 1 ? 'mixed' : null);
}

export default {
  type: 'waterSupplyPipe',
  displayName: 'Water Supply Pipe',
  color: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_COLD],
  roomColor: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_ROOM],
  hotColor: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_HOT],
  markerColor: '#64b9ef',
  geometryStyle: 'jacketedCylinder',
  routingProfile: FLEXIBLE_SUBTILE_ROUTING_PROFILE,
  pipeRadiusMeters: 0.065,
  capacityUnit: 'kW thermal',
  capacityParam: 'capacity',
  demandParam: 'heatLoad',
  allowsTap: true,
  joinsOnContact: true,
  fansOut: true,
  bridgesAdjacent: false,
  requiresWallPassThrough: true,
  runHeightMeters: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeCold,
  runHeightsByWaterCircuit: Object.freeze({
    [WATER_CIRCUIT_COLD]: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeCold,
    [WATER_CIRCUIT_ROOM]: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeRoom,
    [WATER_CIRCUIT_HOT]: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeHot,
  }),
  fixedRouteHeight: true,
  supportSpacingMeters: RIGID_UTILITY_SUPPORT_SPACING_METERS,
  supportMinimumRunMeters: RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  bendRadiusMeters: 0.28,
  fittingStyle: 'waterSupplyFlange',
  costPerSubUnit: 72,
  persistentStateDefaults: {},

  solve(network, persistent, worldState, context = {}) {
    const circuit = circuitForNetwork(network, worldState);
    const errors = [];
    const perSinkQuality = {};
    const capacityParam = circuit === WATER_CIRCUIT_HOT
      ? 'heatRejectionCapacity'
      : 'capacity';
    const demandParam = 'heatLoad';
    const totalCapacity = network.sources.reduce((sum, source) =>
      sum + (Number(source.params?.[capacityParam]) || 0)
        * powerFeedFactor(worldState, source.placeableId, context.getDefinition), 0);
    const totalDemand = network.sinks.reduce(
      (sum, sink) => sum + (Number(sink.params?.[demandParam]) || 0), 0);

    let quality = totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1;
    if (circuit === 'mixed') {
      quality = 0;
      errors.push({
        severity: 'hard', code: 'water_circuit_mixed',
        message: 'Different water-temperature circuits are joined together.',
        location: { networkId: network.id },
      });
    } else if (totalDemand > 0 && totalCapacity <= 0) {
      errors.push({
        severity: 'hard', code: circuit === WATER_CIRCUIT_HOT
          ? 'water_return_unserved'
          : circuit === WATER_CIRCUIT_ROOM
            ? 'water_transfer_unserved'
            : 'water_supply_unserved',
        message: circuit === WATER_CIRCUIT_HOT
          ? 'Hot-water return has no heat rejection capacity.'
          : circuit === WATER_CIRCUIT_ROOM
            ? 'Room-temperature transfer has no heat-rejection capacity.'
            : 'Cold-water supply has no chiller capacity.',
        location: { networkId: network.id },
      });
    } else if (totalDemand > totalCapacity && totalCapacity > 0) {
      errors.push({
        severity: 'soft', code: 'water_supply_overload',
        message: `Water supply pipe is overloaded (${Math.round(totalDemand / totalCapacity * 100)}%).`,
        location: { networkId: network.id },
      });
    }
    for (const sink of network.sinks) perSinkQuality[sink.portKey] = quality;

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        waterCircuit: circuit,
        totalCapacity,
        totalDemand,
        utilization: totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity) : (totalDemand > 0 ? 1 : 0),
        perSinkQuality,
        perSegmentLoad: [],
        errors: [...errors],
      },
      nextPersistentState: persistent || {},
      errors,
    };
  },
};
