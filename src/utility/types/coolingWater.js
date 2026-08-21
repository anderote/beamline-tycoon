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

export const EVAP_PER_KW_PER_TICK = 0.02;
// Compatibility export for callers that mean the original LCW-skid / make-up
// tank capacity. Actual network capacity is now summed from connected ports.
export const RESERVOIR_MAX_L = COOLING_WATER_INVENTORY.waterTank.storageCapacityL;
export const WATER_COST_PER_L = 12;

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

export function waterInventoryForNetwork(network) {
  const sources = network?.sources || [];
  return {
    supplyRateLPerTick: sources.reduce(
      (sum, source) => sum + positive(source.params?.supplyRateLPerTick), 0),
    storageCapacityL: sources.reduce(
      (sum, source) => sum + positive(source.params?.storageCapacityL), 0),
  };
}

export function boundCoolingWaterPersistentState(persistent, network) {
  const { storageCapacityL } = waterInventoryForNetwork(network);
  const rawVolume = persistent?.reservoirVolumeL;
  const reservoirVolumeL = Number.isFinite(rawVolume)
    ? Math.max(0, Math.min(storageCapacityL, rawVolume))
    // A newly commissioned standalone loop starts with its authored tanks
    // full. Once numeric state exists, topology migration carries the actual
    // contents and newly-added empty capacity is never filled for free.
    : storageCapacityL;
  return {
    ...(persistent || {}),
    reservoirVolumeL,
    reservoirCapacityL: storageCapacityL,
  };
}

export default {
  type: 'coolingWater',
  displayName: 'Cooling Water',
  color: '#4488ff',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.04,
  // Capacity and heatLoad are both kW of heat moved (packageChiller 5 →
  // lcwSkid 25 → dualCircuitChiller 175 → chiller 300 →
  // dryCoolerBank 500 → coolingTower 800); litres only track the reservoir
  // level.
  capacityUnit: 'kW',
  // Pipework: tees and manifolds, same as vacuum.
  allowsTap: true,
  fansOut: true,
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
    const capacity = positive(persistent?.reservoirCapacityL);
    const current = Math.max(0, Math.min(
      capacity,
      Number.isFinite(persistent?.reservoirVolumeL) ? persistent.reservoirVolumeL : 0,
    ));
    const missing = capacity - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * WATER_COST_PER_L) };
  },
  refilledPersistentState(persistent) {
    const capacity = positive(persistent?.reservoirCapacityL);
    return { ...(persistent || {}), reservoirVolumeL: capacity };
  },
  boundPersistentState: boundCoolingWaterPersistentState,
};
