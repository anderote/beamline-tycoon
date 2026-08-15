// src/utility/types/coolingWater.js
//
// Cooling water utility descriptor. v1 physics: chiller capacity vs sink heat
// load; reservoir decrements by EVAP_PER_KW_PER_TICK × totalHeatKW. Packaged
// plants can supply slow automatic make-up water; ordinary plant reservoirs
// emit hard cooling_dry when empty. Soft cooling_starved means demand has no
// chiller. refillCost: WATER_COST_PER_L per missing litre.
//
// Balance (Phase 7, scripts/balance-sim.mjs): a 30 kW starter loop drinks
// 0.6 L/tick — a ~$5k refill every ~700 ticks; a 60 kW detector loop refills
// about twice as often. Visible recurring cost, not a death spiral.

import { powerFeedFactor } from '../power-feed.js';

export const EVAP_PER_KW_PER_TICK = 0.02;
export const RESERVOIR_MAX_L = 500;
export const WATER_COST_PER_L = 12;

// Temperature rise, in kelvin, at a sink whose heat is not being removed.
// MAX_DELTA_T is what a fully starved loop reaches; a partially served loop
// scales in between. This drives thermal detuning of normal-conducting
// cavities (beam_physics/srf.py detune_coupling) — an undercooled cavity does
// not fade gracefully, it walks off resonance and reflects power back at the
// klystron, which is what the VSWR readout reports.
export const MAX_DELTA_T = 40;

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
  persistentStateDefaults: { reservoirVolumeL: RESERVOIR_MAX_L },
  solve(network, persistent, worldState) {
    const reservoirs = network.sources.filter(s => s.params?.reservoir);
    const chillers = network.sources.filter(s => (s.params?.capacity || 0) > 0);
    const rejectors = network.sources.filter(s => (s.params?.heatRejectionCapacity || 0) > 0);
    const chillerCapacity = chillers.reduce(
      (a, s) => a + ((s.params && s.params.capacity) || 0)
        * powerFeedFactor(worldState, s.placeableId), 0);
    const rejectionCapacity = rejectors.reduce(
      (a, s) => a + ((s.params && s.params.heatRejectionCapacity) || 0)
        * powerFeedFactor(worldState, s.placeableId), 0);
    const plantComplete = reservoirs.length > 0 && chillers.length > 0 && rejectors.length > 0;
    const totalCapacity = plantComplete ? Math.min(chillerCapacity, rejectionCapacity) : 0;
    const totalDemand = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.heatLoad) || 0), 0);
    const currentReservoir = (persistent && persistent.reservoirVolumeL) || 0;
    // Packaged cooling units carry a small automatic mains make-up valve.
    // Apply it before the dry check so a depleted package restarts on its own
    // instead of emitting a one-tick cooling_dry trip every solve. The rate is
    // intentionally slow (nameplate evaporation only), so spare make-up
    // restores inventory over time rather than snapping the reservoir full.
    const makeupWaterLPerTick = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.makeupWaterLPerTick) || 0), 0);
    const replenishedReservoir = Math.min(
      RESERVOIR_MAX_L,
      currentReservoir + makeupWaterLPerTick,
    );
    const errors = [];
    const perSinkQuality = {};

    const dry = replenishedReservoir <= 0 && network.sinks.length > 0;
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
        message: 'Cooling network needs a reservoir, chiller, and heat rejector.',
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

    const evap = dry ? 0 : EVAP_PER_KW_PER_TICK * totalDemand;
    const nextReservoir = Math.max(0, replenishedReservoir - evap);

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity,
        chillerCapacity,
        rejectionCapacity,
        plantComplete,
        totalDemand,
        makeupWaterLPerTick,
        utilization: totalCapacity > 0
          ? Math.min(1, totalDemand / totalCapacity)
          : (totalDemand > 0 ? 1 : 0),
        deltaT,
        perSegmentLoad: [],
        perSinkQuality,
        perSinkDeltaT,
        errors: [...errors],
      },
      nextPersistentState: { ...persistent, reservoirVolumeL: nextReservoir },
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost(persistent) {
    const current = (persistent && persistent.reservoirVolumeL) || 0;
    const missing = RESERVOIR_MAX_L - current;
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * WATER_COST_PER_L) };
  },
};
