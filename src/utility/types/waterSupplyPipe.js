// Rigid fabricated water header for high-flow plant and large equipment.
// The physical construction follows cryogenic transfer pipe (fixed-diameter
// formed runs, elbows, tees and supports), while every committed run is tagged
// as cold supply, lukewarm plant transfer, or hot return.

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
  WATER_CIRCUIT_LUKEWARM,
  lineWaterCircuit,
  portWaterCircuit,
} from '../water-circuits.js';
import {
  EVAP_PER_KW_PER_TICK,
  WATER_COST_PER_L,
  boundWaterPersistentState,
  waterInventoryForNetwork,
  waterReservoirLevel,
} from '../water-inventory.js';

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

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
  lukewarmColor: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_LUKEWARM],
  hotColor: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_HOT],
  markerColor: '#64b9ef',
  geometryStyle: 'jacketedCylinder',
  routingProfile: FLEXIBLE_SUBTILE_ROUTING_PROFILE,
  pipeRadiusMeters: 0.065,
  capacityUnit: 'kW thermal',
  capacityParam: 'capacity',
  demandParam: 'heatLoad',
  allowsTap: true,
  // Hot, cold, and plant-transfer headers are often laid in parallel. A
  // quarter-tile-plus halo still makes an intentional tee easy to acquire but
  // does not magnetize the adjacent routing lane.
  tapSnapRadiusTiles: 0.3,
  joinsOnContact: true,
  fansOut: true,
  bridgesAdjacent: false,
  requiresWallPassThrough: true,
  runHeightMeters: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeCold,
  runHeightsByWaterCircuit: Object.freeze({
    [WATER_CIRCUIT_COLD]: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeCold,
    [WATER_CIRCUIT_LUKEWARM]: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeRoom,
    [WATER_CIRCUIT_HOT]: RIGID_UTILITY_SERVICE_HEIGHTS.waterSupplyPipeHot,
  }),
  fixedRouteHeight: true,
  supportSpacingMeters: RIGID_UTILITY_SUPPORT_SPACING_METERS,
  supportMinimumRunMeters: RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  bendRadiusMeters: 0.28,
  fittingStyle: 'waterSupplyFlange',
  costPerSubUnit: 72,
  persistentStateDefaults: { reservoirVolumeL: null, reservoirCapacityL: 0 },

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
    const inventoryEnabled = circuit === WATER_CIRCUIT_LUKEWARM;
    const { supplyRateLPerTick, storageCapacityL } = inventoryEnabled
      ? waterInventoryForNetwork(network)
      : { supplyRateLPerTick: 0, storageCapacityL: 0 };
    const boundedPersistent = boundWaterPersistentState(persistent, network);
    const currentReservoir = boundedPersistent.reservoirVolumeL;
    const requestedEvaporationL = inventoryEnabled
      ? EVAP_PER_KW_PER_TICK * totalDemand
      : 0;
    const dry = inventoryEnabled && storageCapacityL > 0
      && currentReservoir <= 0
      && supplyRateLPerTick < requestedEvaporationL
      && network.sinks.length > 0;

    let quality = totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1;
    if (dry) {
      quality = 0;
      errors.push({
        severity: 'hard', code: 'water_reservoir_dry',
        message: 'Lukewarm water reservoir is empty.',
        location: { networkId: network.id },
      });
    } else if (circuit === 'mixed') {
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
          : circuit === WATER_CIRCUIT_LUKEWARM
            ? 'water_transfer_unserved'
            : 'water_supply_unserved',
        message: circuit === WATER_CIRCUIT_HOT
          ? 'Hot-water return has no heat rejection capacity.'
          : circuit === WATER_CIRCUIT_LUKEWARM
            ? 'Lukewarm transfer has no heat-rejection capacity.'
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
    const evaporationL = dry ? 0 : requestedEvaporationL;
    const suppliedWaterL = Math.min(
      supplyRateLPerTick,
      Math.max(0, storageCapacityL - currentReservoir + evaporationL),
    );
    const nextReservoir = Math.max(
      0,
      Math.min(storageCapacityL, currentReservoir + suppliedWaterL - evaporationL),
    );

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        waterCircuit: circuit,
        totalCapacity,
        totalDemand,
        supplyRateLPerTick,
        suppliedWaterL,
        storageCapacityL,
        reservoirVolumeL: currentReservoir,
        evaporationL,
        utilization: totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity) : (totalDemand > 0 ? 1 : 0),
        perSinkQuality,
        perSegmentLoad: [],
        errors: [...errors],
      },
      nextPersistentState: {
        ...boundedPersistent,
        reservoirVolumeL: nextReservoir,
        reservoirCapacityL: storageCapacityL,
      },
      errors,
    };
  },
  renderInspector(_network, flow, persistent) {
    const capacity = positive(flow?.storageCapacityL ?? persistent?.reservoirCapacityL);
    if (!(capacity > 0)) return '';
    const current = Math.max(0, Math.min(
      capacity,
      Number.isFinite(persistent?.reservoirVolumeL) ? persistent.reservoirVolumeL : capacity,
    ));
    const pct = current / capacity * 100;
    return `<div><strong>Lukewarm-water inventory:</strong> ${current.toFixed(1)} / ${capacity.toFixed(1)} L (${pct.toFixed(0)}%)</div>`
      + `<div><strong>Make-up flow:</strong> ${positive(flow?.supplyRateLPerTick).toFixed(1)} L/tick</div>`
      + `<div><strong>Evaporation:</strong> ${positive(flow?.evaporationL).toFixed(1)} L/tick</div>`;
  },
  refillCost(persistent) {
    const { current, capacity } = waterReservoirLevel(persistent);
    const missing = capacity - current;
    return missing < 1 ? null : { funding: Math.ceil(missing * WATER_COST_PER_L) };
  },
  refilledPersistentState(persistent) {
    const capacity = positive(persistent?.reservoirCapacityL);
    return { ...(persistent || {}), reservoirVolumeL: capacity };
  },
  reservoirLevel: waterReservoirLevel,
  boundPersistentState: boundWaterPersistentState,
};
