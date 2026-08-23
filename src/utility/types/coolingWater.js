// src/utility/types/coolingWater.js
//
// Cooling water utility descriptor. Process cooling, heat rejection, make-up
// flow and stored inventory are separate network capabilities. Heat load
// evaporates inventory; authored water sources replace it at a capped flow
// rate; authored tanks set the maximum inventory. A water source without a
// tank cannot act as storage, and a tank with no source never creates water.
//
// Balance (Phase 7, scripts/balance-sim.mjs): a 30 kW starter loop drinks
// 0.6 L/tick — a ~$5k refill every ~700 ticks; a 60 kW detector loop refills
// about twice as often. Visible recurring cost, not a death spiral.

import { powerFeedFactor } from '../power-feed.js';
import { COOLING_WATER_INVENTORY } from '../../data/cooling-water-inventory.js';
import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../routing-contract.js';
import { endpointsById } from '../endpoint-lookup.js';
import {
  lineWaterCircuit,
  portWaterCircuit,
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_COLORS,
  WATER_CIRCUIT_HOT,
} from '../water-circuits.js';
import {
  EVAP_PER_KW_PER_TICK,
  WATER_COST_PER_L,
  boundWaterPersistentState,
  waterInventoryForNetwork,
  waterReservoirLevel,
} from '../water-inventory.js';

export { EVAP_PER_KW_PER_TICK, WATER_COST_PER_L, waterInventoryForNetwork };
// Compatibility export for callers that mean the original LCW-skid / make-up
// tank capacity. Actual network capacity is now summed from connected ports.
export const RESERVOIR_MAX_L = COOLING_WATER_INVENTORY.waterTank.storageCapacityL;

// Temperature rise, in kelvin, at a sink whose heat is not being removed.
// MAX_DELTA_T is what a fully starved loop reaches; a partially served loop
// scales in between. This drives thermal detuning of normal-conducting
// cavities (beam_physics/srf.py detune_coupling) — an undercooled cavity does
// not fade gracefully, it walks off resonance and reflects power back at the
// klystron, which is what the VSWR readout reports.
export const MAX_DELTA_T = 40;

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export const boundCoolingWaterPersistentState = boundWaterPersistentState;

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

function convertedSupplyCapacity(network, circuit, worldState, context) {
  const pipeNetworks = context.networksByType?.get?.('waterSupplyPipe') || [];
  const pipeFlows = worldState?.utilityNetworkData?.get?.('waterSupplyPipe');
  const endpointMap = context.endpointIndex || endpointsById(worldState);
  const used = new Set();
  let capacity = 0;
  for (const port of network?.ports || []) {
    const endpoint = endpointMap.get(port.placeableId);
    const def = context.getDefinition?.(endpoint?.type);
    for (const group of def?.waterConverterGroups || []) {
      if (!(group.waterLinePorts || []).includes(port.portName)) continue;
      for (const supplyName of group.supplyPipePorts || []) {
        const key = `${port.placeableId}:${supplyName}`;
        const pipeNetwork = pipeNetworks.find(candidate =>
          candidate.ports?.some(p => `${p.placeableId}:${p.portName}` === key));
        if (!pipeNetwork || used.has(pipeNetwork.id)) continue;
        const flow = pipeFlows?.get?.(pipeNetwork.id);
        if (flow?.waterCircuit !== circuit) continue;
        used.add(pipeNetwork.id);
        capacity += positive(flow.totalCapacity) * Math.max(0, Math.min(1,
          flow.totalDemand > 0 ? flow.totalCapacity / flow.totalDemand : 1));
      }
    }
  }
  return capacity;
}

export default {
  type: 'coolingWater',
  displayName: 'Water Line',
  color: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_COLD],
  hotColor: WATER_CIRCUIT_COLORS[WATER_CIRCUIT_HOT],
  geometryStyle: 'cylinder',
  routingProfile: FLEXIBLE_SUBTILE_ROUTING_PROFILE,
  pipeRadiusMeters: 0.04,
  // Capacity and heatLoad are both kW of heat moved (packageChiller 5 →
  // lcwSkid 25 → dualCircuitChiller 175 → chiller 300 →
  // dryCoolerBank 500 → coolingTower 800); litres only track the reservoir
  // level.
  capacityUnit: 'kW',
  // Player-drawn hoses terminate on authored equipment/manifold ports. Keep
  // authored/scenario tap topology compatible, but never expose a nearby hose
  // or utility rack as an interactive draw endpoint.
  allowsTap: true,
  portToPortDrawing: true,
  fansOut: true,
  // Flexible water lines are equipment hoses. They never pass directly through
  // a slab; the input coordinator installs a circuit-colored wall sleeve and
  // terminates the hose on each face.
  requiresWallPassThrough: true,
  // Adjacency bridging: touching components share the loop — a skid manifolds
  // straight into the unit bolted next to it.
  bridgesAdjacent: true,
  // Per-port param names the inspector reads for its source/sink rows.
  capacityParam: 'capacity',
  demandParam: 'heatLoad',
  // $144/tile — pumped, insulated loop; equipment, not pipe routing, carries
  // the capital cost. Ladder: powerCable.js.
  costPerSubUnit: 36,
  // null distinguishes a brand-new network from a genuinely drained one.
  // The first solve resolves it against the network's authored storage.
  persistentStateDefaults: { reservoirVolumeL: null, reservoirCapacityL: 0 },
  solve(network, persistent, worldState, context = {}) {
    const waterCircuit = circuitForNetwork(network, worldState);
    if (waterCircuit) {
      const capacityParam = waterCircuit === WATER_CIRCUIT_HOT
        ? 'heatRejectionCapacity' : 'capacity';
      const localCapacity = network.sources.reduce(
        (sum, source) => sum + positive(source.params?.[capacityParam])
          * powerFeedFactor(worldState, source.placeableId, context.getDefinition), 0);
      const importedCapacity = waterCircuit === 'mixed'
        ? 0 : convertedSupplyCapacity(network, waterCircuit, worldState, context);
      const totalCapacity = localCapacity + importedCapacity;
      const totalDemand = network.sinks.reduce(
        (sum, sink) => sum + positive(sink.params?.heatLoad), 0);
      let quality = totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1;
      const errors = [];
      if (waterCircuit === 'mixed') {
        quality = 0;
        errors.push({ severity: 'hard', code: 'water_line_circuit_mixed',
          message: 'Hot and cold flexible water lines are joined together.',
          location: { networkId: network.id } });
      } else if (totalDemand > 0 && totalCapacity <= 0) {
        errors.push({ severity: 'hard',
          code: waterCircuit === WATER_CIRCUIT_HOT
            ? 'cooling_return_unserved' : 'cooling_supply_unserved',
          message: waterCircuit === WATER_CIRCUIT_HOT
            ? 'Hot-water lines have no route to heat rejection.'
            : 'Cold-water lines have no route to a chiller.',
          location: { networkId: network.id } });
      } else if (totalDemand > totalCapacity && totalCapacity > 0) {
        errors.push({ severity: 'soft', code: 'cooling_overload',
          message: `Cooling circuit overloaded (${Math.round(totalDemand / totalCapacity * 100)}%).`,
          location: { networkId: network.id } });
      }
      const perSinkQuality = {};
      const perSinkDeltaT = {};
      for (const sink of network.sinks) {
        perSinkQuality[sink.portKey] = quality;
        perSinkDeltaT[sink.portKey] = waterCircuit === WATER_CIRCUIT_COLD
          ? MAX_DELTA_T * (1 - quality) : 0;
      }
      return {
        flowState: {
          networkId: network.id, utilityType: network.utilityType,
          waterCircuit, totalCapacity, localCapacity, importedCapacity,
          totalDemand,
          utilization: totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity) : (totalDemand > 0 ? 1 : 0),
          deltaT: waterCircuit === WATER_CIRCUIT_COLD ? MAX_DELTA_T * (1 - quality) : 0,
          perSegmentLoad: [], perSinkQuality, perSinkDeltaT,
          errors: [...errors],
        },
        nextPersistentState: persistent || {},
        errors,
      };
    }
    const chillers = network.sources.filter(s => (s.params?.capacity || 0) > 0);
    const rejectors = network.sources.filter(s => (s.params?.heatRejectionCapacity || 0) > 0);
    const chillerCapacity = chillers.reduce(
      (a, s) => a + ((s.params && s.params.capacity) || 0)
        * powerFeedFactor(worldState, s.placeableId, context.getDefinition), 0);
    const rejectionCapacity = rejectors.reduce(
      (a, s) => a + ((s.params && s.params.heatRejectionCapacity) || 0)
        * powerFeedFactor(worldState, s.placeableId, context.getDefinition), 0);
    const { supplyRateLPerTick, storageCapacityL } = waterInventoryForNetwork(network);
    const plantComplete = storageCapacityL > 0 && chillers.length > 0 && rejectors.length > 0;
    const totalCapacity = plantComplete ? Math.min(chillerCapacity, rejectionCapacity) : 0;
    const totalDemand = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.heatLoad) || 0), 0);
    const boundedPersistent = boundCoolingWaterPersistentState(persistent, network);
    const currentReservoir = boundedPersistent.reservoirVolumeL;
    const errors = [];
    const perSinkQuality = {};

    const requestedEvaporationL = EVAP_PER_KW_PER_TICK * totalDemand;
    // A sufficiently large live source can carry one tick's loss even when
    // the tank is sitting at zero. A smaller source must first rebuild a
    // usable buffer; this keeps its flow rating mechanically meaningful.
    const dry = plantComplete
      && currentReservoir <= 0
      && supplyRateLPerTick < requestedEvaporationL
      && network.sinks.length > 0;
    let quality;
    if (dry) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: 'cooling_dry',
        message: 'Cooling reservoir is empty.',
        location: { networkId: network.id },
      });
    } else if (!plantComplete && totalDemand > 0) {
      quality = 0;
      errors.push({
        severity: 'hard',
        code: 'cooling_plant_offline',
        message: 'Cooling network needs water storage, a chiller, and a heat rejector.',
        location: { networkId: network.id },
      });
    } else {
      quality = totalDemand > 0 ? Math.min(1, totalCapacity / totalDemand) : 1;
    }

    // Unremoved heat becomes a temperature rise at the sink. Quality 1 means
    // the loop keeps up and the component sits at design temperature.
    const deltaT = MAX_DELTA_T * (1 - quality);
    const perSinkDeltaT = {};
    for (const s of network.sinks) {
      perSinkQuality[s.portKey] = quality;
      perSinkDeltaT[s.portKey] = deltaT;
    }

    const evaporationL = (!plantComplete || dry) ? 0 : requestedEvaporationL;
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
        totalCapacity,
        chillerCapacity,
        rejectionCapacity,
        plantComplete,
        supplyRateLPerTick,
        suppliedWaterL,
        storageCapacityL,
        reservoirVolumeL: currentReservoir,
        evaporationL,
        totalDemand,
        utilization: totalCapacity > 0
          ? Math.min(1, totalDemand / totalCapacity)
          : (totalDemand > 0 ? 1 : 0),
        deltaT,
        perSegmentLoad: [],
        perSinkQuality,
        perSinkDeltaT,
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
    const current = Math.max(0, Math.min(
      capacity,
      Number.isFinite(persistent?.reservoirVolumeL) ? persistent.reservoirVolumeL : capacity,
    ));
    const pct = capacity > 0 ? (current / capacity) * 100 : 0;
    const supplied = positive(flow?.supplyRateLPerTick);
    const evaporation = positive(flow?.evaporationL);
    return `<div><strong>Water inventory:</strong> ${current.toFixed(1)} / ${capacity.toFixed(1)} L (${pct.toFixed(0)}%)</div>`
      + `<div><strong>Make-up flow:</strong> ${supplied.toFixed(1)} L/tick</div>`
      + `<div><strong>Evaporation:</strong> ${evaporation.toFixed(1)} L/tick</div>`;
  },
  refillCost(persistent) {
    const { current, capacity } = waterReservoirLevel(persistent);
    const missing = capacity - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * WATER_COST_PER_L) };
  },
  refilledPersistentState(persistent) {
    const capacity = positive(persistent?.reservoirCapacityL);
    return { ...(persistent || {}), reservoirVolumeL: capacity };
  },
  reservoirLevel: waterReservoirLevel,
  boundPersistentState: boundCoolingWaterPersistentState,
};
