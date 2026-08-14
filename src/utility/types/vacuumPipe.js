// src/utility/types/vacuumPipe.js
//
// Vacuum pipe utility descriptor. Aggregate pressure = total outgassing /
// total pump speed (the real steady-state relation P = Q/S), mapped
// log-linearly to quality between 1e-8 (ideal) and 1e-4 (unusable). Hard error
// when sinks are present but no pump; soft error when pressure is merely poor
// (> 1e-5).
//
// The pressure computed here is now published per-sink and drives the beam
// directly through beam_physics/modules/beam_gas.py: residual gas scatters the
// beam, growing emittance and knocking particles out. Before that module
// existed, vacuum reached the beam only by narrowing the effective aperture,
// which fed aperture_loss — and aperture_loss only scales current, never the
// covariance matrix, so vacuum could not move beam quality at all.
//
// BAKEOUT: a network with a bakeoutSystem among its sources drops specific
// outgassing 100x (1e-10 -> 1e-12 mbar·L/s/cm²). That is what makes long
// machines viable, and it is the only reason to buy the component.

import {
  Q_SPECIFIC_UNBAKED, Q_SPECIFIC_BAKED, outgassingForLength,
} from '../../data/utility-ports-v2.js';
import { endpointsById } from '../endpoint-lookup.js';

export const BAKEOUT_FACTOR = Q_SPECIFIC_BAKED / Q_SPECIFIC_UNBAKED;

/** True when a bakeout system sits on this network. */
function isBaked(network, byId) {
  for (const src of network.sources) {
    const rec = byId.get(src.placeableId);
    if (rec && rec.type === 'bakeoutSystem') return true;
  }
  for (const port of (network.ports || [])) {
    const rec = byId.get(port.placeableId);
    if (rec && rec.type === 'bakeoutSystem') return true;
  }
  return false;
}

/**
 * Outgassing from the BEAM PIPE this network's sinks are mounted on.
 *
 * This is the dominant term on any real machine and used to be missing
 * entirely: outgassing was a per-component constant table, and the beam pipe
 * itself — a drawn connection, never a placeable — appeared nowhere in it. A
 * player could draw 500 m of pipe and add exactly zero gas load, so one pump
 * served any length and long machines were free.
 *
 * A pipe is pumped by whatever pumps serve the components mounted on it, so
 * every pipe carrying a sink on this network is charged here, once.
 */
function beamPipeOutgassing(network, byId, worldState) {
  const pipeIds = new Set();
  for (const sink of network.sinks) {
    const rec = byId.get(sink.placeableId);
    if (rec && rec.pipeId) pipeIds.add(rec.pipeId);
  }
  if (pipeIds.size === 0) return 0;

  let total = 0;
  for (const pipe of (worldState?.beamPipes || [])) {
    if (!pipeIds.has(pipe.id)) continue;
    total += outgassingForLength(pipe.subL || 0);
  }
  return total;
}

export default {
  type: 'vacuumPipe',
  displayName: 'Vacuum Pipe',
  color: '#888888',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.06,
  // Capacity is aggregate pump speed (L/s); demand is total outgassing
  // (mbar\u00b7L/s) \u2014 different physical quantities, hence the two units.
  capacityUnit: 'L/s',
  // Pipework: you tee into a run with a fitting, and a manifold feeds several
  // branches off one outlet.
  allowsTap: true,
  fansOut: true,
  // Adjacency bridging: touching components share the vacuum — a turbo mounted
  // on a roughing pump is one pumping stack, not two separate runs.
  bridgesAdjacent: true,
  demandUnit: 'mbar\u00b7L/s',
  capacityParam: 'pumpSpeed',
  demandParam: 'outgassing',
  // $5,600/tile — UHV-clean beam pipe, the second priciest run.
  // vacuumManifold ($120k) beats individual runs at about four sinks.
  // Ladder: powerCable.js.
  costPerSubUnit: 1400,
  persistentStateDefaults: {},
  solve(network, persistent, worldState) {
    const totalPumpSpeed = network.sources.reduce(
      (a, s) => a + ((s.params && s.params.pumpSpeed) || 0), 0);
    const byId = endpointsById(worldState);
    const baked = isBaked(network, byId);
    const componentOutgas = network.sinks.reduce(
      (a, s) => a + ((s.params && s.params.outgassing) || 0), 0);
    const pipeOutgas = beamPipeOutgassing(network, byId, worldState);
    const rawOutgas = componentOutgas + pipeOutgas;
    const totalOutgas = baked ? rawOutgas * BAKEOUT_FACTOR : rawOutgas;

    let pressure;
    if (totalPumpSpeed === 0 && totalOutgas === 0) pressure = 0;
    else if (totalPumpSpeed === 0) pressure = Infinity;
    else pressure = totalOutgas / totalPumpSpeed;

    let quality = 1;
    if (!isFinite(pressure)) quality = 0;
    else if (pressure <= 1e-8) quality = 1;
    else if (pressure >= 1e-4) quality = 0;
    else quality = 1 - (Math.log10(pressure) - (-8)) / ((-4) - (-8));

    const perSinkQuality = {};
    const perSinkPressure = {};
    // An unpumped network is at atmosphere, not at "infinity" — the beam_gas
    // module needs a real number to scatter against.
    const reportedPressure = isFinite(pressure) ? pressure : 1013;
    for (const s of network.sinks) {
      perSinkQuality[s.portKey] = quality;
      perSinkPressure[s.portKey] = reportedPressure;
    }

    const errors = [];
    if (totalPumpSpeed === 0 && network.sinks.length > 0) {
      errors.push({
        severity: 'hard',
        code: 'vacuum_no_pump',
        message: 'Vacuum network has no pump.',
        location: { networkId: network.id },
      });
    } else if (isFinite(pressure) && pressure > 1e-5) {
      errors.push({
        severity: 'soft',
        code: 'vacuum_poor',
        message: `Vacuum pressure high (${pressure.toExponential(2)} mbar).`,
        location: { networkId: network.id },
      });
    }

    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity: totalPumpSpeed,
        totalDemand: totalOutgas,
        utilization: totalPumpSpeed > 0
          ? Math.min(1, totalOutgas / totalPumpSpeed)
          : (network.sinks.length > 0 ? 1 : 0),
        pressure: reportedPressure,
        baked,
        componentOutgas,
        pipeOutgas,
        perSegmentLoad: [],
        perSinkQuality,
        perSinkPressure,
        errors: [...errors],
      },
      nextPersistentState: persistent,
      errors,
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
