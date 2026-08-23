// src/utility/types/vacuumPipe.js
//
// Dynamic staged-vacuum solver. The state variable is gas inventory (mbar·L),
// not an abstract quality scalar: pipe volume determines pump-down time,
// internal surface area creates the outgassing load, and line conductance
// limits the speed a remote molecular pump can deliver to the chamber.

import {
  Q_SPECIFIC_UNBAKED, Q_SPECIFIC_BAKED, outgassingForLength,
} from '../../data/utility-ports-v2.js';
import { endpointsById } from '../endpoint-lookup.js';
import { utilityAttachmentPose } from '../line-attachments.js';
import { powerFeedFactor } from '../power-feed.js';
import {
  RIGID_UTILITY_SERVICE_HEIGHTS,
  RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  RIGID_UTILITY_SUPPORT_SPACING_METERS,
} from '../service-heights.js';
import { FLEXIBLE_SUBTILE_ROUTING_PROFILE } from '../routing-contract.js';

export const BAKEOUT_FACTOR = Q_SPECIFIC_BAKED / Q_SPECIFIC_UNBAKED;
export const VACUUM_TEMPERATURE_K = 300;
export const BOLTZMANN_J_PER_K = 1.380649e-23;
export const MBAR_TO_PA = 100;
export const BEAM_PIPE_RADIUS_M = 0.06;
export const TURBO_START_PRESSURE_MBAR = 1;
export const UHV_START_PRESSURE_MBAR = 1e-5;
export const ROUGH_ULTIMATE_PRESSURE_MBAR = 1e-3;
export const HIGH_ULTIMATE_PRESSURE_MBAR = 1e-8;
export const UHV_ULTIMATE_PRESSURE_MBAR = 1e-11;
export const VACUUM_TICKS_PER_DAY = 240;
export const VACUUM_HISTORY_RANGES = Object.freeze([
  Object.freeze({ ticks: VACUUM_TICKS_PER_DAY, label: '1d', startLabel: '-1d', midLabel: '-12h' }),
  Object.freeze({ ticks: VACUUM_TICKS_PER_DAY * 2, label: '2d', startLabel: '-2d', midLabel: '-1d' }),
  Object.freeze({ ticks: VACUUM_TICKS_PER_DAY * 10, label: '10d', startLabel: '-10d', midLabel: '-5d' }),
]);
export const VACUUM_HISTORY_TICKS = VACUUM_HISTORY_RANGES.at(-1).ticks;
export const DEFAULT_VACUUM_HISTORY_RANGE_TICKS = VACUUM_HISTORY_TICKS;
export const VACUUM_HISTORY_SAMPLE_TICKS = 5; // half an in-game hour

const SUB_UNIT_M = 0.5;
const GRID_CELL_M = 2;
const ATMOSPHERE_MBAR = 1013;
const VACUUM_LINE_DIAMETER_CM = BEAM_PIPE_RADIUS_M * 2 * 100;
const GAUGE_TYPES = new Set(['piraniGauge', 'coldCathodeGauge', 'baGauge']);

const GAUGE_INFO = {
  piraniGauge:       { label: 'Pirani',       min: 1e-3,  max: 1e3, color: '#f2c14e' },
  coldCathodeGauge:  { label: 'Cold cathode', min: 1e-9,  max: 1e-2, color: '#5bc0eb' },
  baGauge:           { label: 'BA',           min: 1e-12, max: 1e-4, color: '#9b7ede' },
};

export function numberDensityFromPressure(pressureMbar, temperatureK = VACUUM_TEMPERATURE_K) {
  if (!(pressureMbar >= 0) || !(temperatureK > 0)) return 0;
  return pressureMbar * MBAR_TO_PA / (BOLTZMANN_J_PER_K * temperatureK);
}

export function circularPipeVolumeLitres(lengthM, radiusM = BEAM_PIPE_RADIUS_M) {
  return Math.PI * radiusM * radiusM * Math.max(0, lengthM) * 1000;
}

/** Molecular-flow conductance of a long circular tube for air near 20 °C. */
export function molecularConductanceLps(lengthM, diameterCm = VACUUM_LINE_DIAMETER_CM) {
  if (!(lengthM > 0)) return Infinity;
  return 12.1 * Math.pow(diameterCm, 3) / (lengthM * 100);
}

export function effectivePumpSpeedLps(pumpSpeed, conductance) {
  if (!(pumpSpeed > 0)) return 0;
  if (!isFinite(conductance)) return pumpSpeed;
  if (!(conductance > 0)) return 0;
  return pumpSpeed * conductance / (pumpSpeed + conductance);
}

function isBaked(network, byId) {
  for (const source of (network.sources || [])) {
    if (byId.get(source.placeableId)?.type === 'bakeoutSystem') return true;
  }
  for (const port of (network.ports || [])) {
    if (byId.get(port.placeableId)?.type === 'bakeoutSystem') return true;
  }
  return false;
}

function lineLengthM(line) {
  let length = 0;
  const path = line?.path || [];
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i].col - path[i - 1].col, path[i].row - path[i - 1].row)
      * GRID_CELL_M;
  }
  return length;
}

function networkLines(network, worldState) {
  const out = [];
  const lines = worldState?.utilityLines;
  for (const id of (network.lineIds || [])) {
    const line = lines?.get?.(id) || lines?.[id];
    if (line) out.push(line);
  }
  return out;
}

function beamPipeStats(network, byId, worldState) {
  const pipeIds = new Set();
  for (const sink of (network.sinks || [])) {
    const rec = byId.get(sink.placeableId);
    if (rec?.pipeId) pipeIds.add(rec.pipeId);
  }
  let lengthM = 0;
  let unbakedOutgas = 0;
  for (const pipe of (worldState?.beamPipes || [])) {
    if (!pipeIds.has(pipe.id)) continue;
    const subL = pipe.subL || 0;
    lengthM += subL * SUB_UNIT_M;
    unbakedOutgas += outgassingForLength(subL);
  }
  return {
    pipeIds,
    lengthM,
    volumeL: circularPipeVolumeLitres(lengthM),
    unbakedOutgas,
  };
}

function endpointPoint(rec) {
  if (!rec) return null;
  if (Number.isFinite(rec.worldX) && Number.isFinite(rec.worldZ)) {
    return { x: rec.worldX, z: rec.worldZ };
  }
  if (!Number.isFinite(rec.col) || !Number.isFinite(rec.row)) return null;
  return {
    x: (rec.col + (rec.subCol || 0) * 0.25) * GRID_CELL_M,
    z: (rec.row + (rec.subRow || 0) * 0.25) * GRID_CELL_M,
  };
}

function pumpInventory(network, worldState, getDefinition) {
  const pumps = [];
  const byId = endpointsById(worldState);
  for (const source of (network.sources || [])) {
    const p = source.params || {};
    if (!(p.pumpSpeed > 0)) continue;
    const power = powerFeedFactor(worldState, source.placeableId, getDefinition);
    // Descriptor-level callers and old saves may carry only `pumpSpeed`.
    // Treat that legacy shape as a roughing source; every real catalogue pump
    // now declares an explicit stage.
    const staged = p.roughingSpeed != null || p.highVacSpeed != null || p.uhvSpeed != null;
    const legacyRoughing = staged ? 0 : p.pumpSpeed;
    pumps.push({
      source,
      power,
      point: endpointPoint(byId.get(source.placeableId)),
      nominalSpeed: p.pumpSpeed * power,
      legacy: !staged,
      roughingSpeed: (p.roughingSpeed || legacyRoughing) * power,
      highVacSpeed: (p.highVacSpeed || 0) * power,
      uhvSpeed: (p.uhvSpeed || 0) * power,
      backingDemand: (p.backingDemand || 0) * power,
      integratedBacking: p.integratedBacking === true,
    });
  }
  return pumps;
}

function activePumpStack(pumps, previousPressure) {
  const roughExternal = pumps.reduce(
    (sum, p) => sum + (p.integratedBacking ? 0 : p.roughingSpeed), 0);
  const integratedRough = pumps.reduce(
    (sum, p) => sum + (p.integratedBacking ? p.roughingSpeed : 0), 0);
  const backingDemand = pumps.reduce((sum, p) => sum + p.backingDemand, 0);
  const backingFactor = backingDemand > 0
    ? Math.min(1, roughExternal / backingDemand)
    : 1;
  const highReady = previousPressure <= TURBO_START_PRESSURE_MBAR;
  const uhvReady = previousPressure <= UHV_START_PRESSURE_MBAR;
  const active = [];

  for (const p of pumps) {
    if (p.legacy && p.nominalSpeed > 0) {
      active.push({ ...p, speed: p.nominalSpeed, stage: 'legacy' });
    }
  }

  if (!highReady) {
    for (const p of pumps) {
      if (p.legacy) continue;
      if (p.roughingSpeed > 0) active.push({ ...p, speed: p.roughingSpeed, stage: 'rough' });
    }
  } else {
    for (const p of pumps) {
      if (p.legacy) continue;
      if (p.highVacSpeed > 0) {
        const factor = p.integratedBacking ? 1 : backingFactor;
        if (factor > 0) active.push({ ...p, speed: p.highVacSpeed * factor, stage: 'high' });
      }
    }
    // A rough-only network stays alive after crossing the turbo threshold.
    if (!active.some(p => p.stage === 'high')) {
      for (const p of pumps) {
        if (p.legacy) continue;
        if (p.roughingSpeed > 0) active.push({ ...p, speed: p.roughingSpeed, stage: 'rough' });
      }
    }
    if (uhvReady && active.some(p => p.stage === 'high')) {
      for (const p of pumps) {
        if (p.legacy) continue;
        if (p.uhvSpeed > 0) active.push({ ...p, speed: p.uhvSpeed, stage: 'uhv' });
      }
    }
  }

  let stage = 'none';
  let ultimatePressure = ATMOSPHERE_MBAR;
  if (active.some(p => p.stage === 'legacy')) {
    stage = 'legacy';
    ultimatePressure = 0;
  }
  if (active.some(p => p.stage === 'rough')) {
    stage = 'rough';
    ultimatePressure = ROUGH_ULTIMATE_PRESSURE_MBAR;
  }
  if (active.some(p => p.stage === 'high')) {
    stage = 'high';
    ultimatePressure = HIGH_ULTIMATE_PRESSURE_MBAR;
  }
  if (active.some(p => p.stage === 'uhv')) {
    stage = 'uhv';
    ultimatePressure = UHV_ULTIMATE_PRESSURE_MBAR;
  }
  return {
    active, stage, ultimatePressure, roughExternal, integratedRough,
    backingDemand, backingFactor, highReady, uhvReady,
  };
}

function sourceConnectionLengthM(pump, lines) {
  let best = Infinity;
  for (const line of lines) {
    const touches = line?.start?.placeableId === pump.source.placeableId
      || line?.end?.placeableId === pump.source.placeableId;
    if (!touches) continue;
    best = Math.min(best, lineLengthM(line));
  }
  return best;
}

function conductanceLimitedSpeed(active, lines, stage) {
  const nominal = active.reduce((sum, p) => sum + p.speed, 0);
  if (!(nominal > 0) || stage === 'rough') return nominal;
  let total = 0;
  for (const pump of active) {
    const connectionLength = sourceConnectionLengthM(pump, lines);
    total += isFinite(connectionLength)
      ? effectivePumpSpeedLps(pump.speed, molecularConductanceLps(Math.max(0.1, connectionLength)))
      : pump.speed; // adjacency-mounted stack: no service tube between stages
  }
  return total;
}

function localEffectiveSpeed(active, target, stage) {
  if (stage === 'rough' || !target) return active.reduce((sum, p) => sum + p.speed, 0);
  let total = 0;
  for (const pump of active) {
    if (!pump.point) { total += pump.speed; continue; }
    const distance = Math.max(0.1, Math.hypot(
      target.x - pump.point.x, target.z - pump.point.z,
    ));
    total += effectivePumpSpeedLps(pump.speed, molecularConductanceLps(distance));
  }
  return total;
}

function qualityFromPressure(pressure) {
  if (!isFinite(pressure)) return 0;
  if (pressure <= 1.000001e-8) return 1;
  if (pressure >= 1e-2) return 0;
  return 1 - (Math.log10(pressure) - (-8)) / 6;
}

function gaugeReading(type, pressure, powered) {
  const info = GAUGE_INFO[type];
  if (!info || !powered) return { reading: null, status: powered ? 'unknown' : 'offline' };
  if (pressure > info.max) return { reading: info.max, status: 'above_range' };
  if (pressure < info.min) return { reading: info.min, status: 'below_range' };
  return { reading: pressure, status: 'ok' };
}

function collectGauges(
  lines, active, stage, totalOutgas, networkPressure, ultimatePressure,
  worldState, getDefinition,
) {
  const gauges = [];
  for (const line of lines) {
    for (const att of (line.attachments || [])) {
      if (!GAUGE_TYPES.has(att.type)) continue;
      const pose = utilityAttachmentPose(line, att);
      const target = pose ? { x: pose.worldX, z: pose.worldZ } : null;
      const speed = localEffectiveSpeed(active, target, stage);
      const equilibrium = speed > 0 ? totalOutgas / speed + ultimatePressure : ATMOSPHERE_MBAR;
      const localPressure = Math.min(ATMOSPHERE_MBAR, Math.max(networkPressure, equilibrium));
      const powered = att.type === 'piraniGauge'
        || powerFeedFactor(worldState, att.id, getDefinition) > 0;
      const measured = gaugeReading(att.type, localPressure, powered);
      gauges.push({
        id: att.id,
        type: att.type,
        label: GAUGE_INFO[att.type].label,
        color: GAUGE_INFO[att.type].color,
        pressure: localPressure,
        reading: measured.reading,
        status: measured.status,
      });
    }
  }
  return gauges;
}

function nextHistory(previous, gauges, tick, networkPressure) {
  const history = Array.isArray(previous) ? previous.slice() : [];
  const lastTick = history.length ? history[history.length - 1].tick : -Infinity;
  if (Number.isFinite(tick) && tick - lastTick >= VACUUM_HISTORY_SAMPLE_TICKS) {
    const readings = {};
    for (const g of gauges) readings[g.id] = g.reading;
    history.push({ tick, pressure: networkPressure, readings });
  }
  const cutoff = (Number.isFinite(tick) ? tick : 0) - VACUUM_HISTORY_TICKS;
  return history.filter(sample => sample && sample.tick >= cutoff);
}

function fmtPressure(value) {
  return Number.isFinite(value) ? `${value.toExponential(2)} mbar` : '--';
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function vacuumHistoryRange(rangeTicks) {
  return VACUUM_HISTORY_RANGES.find(range => range.ticks === Number(rangeTicks))
    || VACUUM_HISTORY_RANGES.at(-1);
}

// Shared by the single-network inspector and the beamline overview. Keeping
// the plotter here means both windows use the same selectable ranges, gauge
// status rules, log scale, and series styling.
export function renderVacuumPressureGraph(
  flow,
  rangeTicks = DEFAULT_VACUUM_HISTORY_RANGE_TICKS,
) {
  const gauges = flow.gauges || [];
  const history = flow.pressureHistory || [];
  const range = vacuumHistoryRange(rangeTicks);
  // Leave enough room for the right-anchored "now" label. With an 8 px
  // margin its final glyph sat outside the SVG viewBox and was clipped in
  // both inspectors.
  const W = 360, H = 150, left = 42, right = 18, top = 8, bottom = 24;
  const x0 = left, x1 = W - right, y0 = top, y1 = H - bottom;
  const now = Number.isFinite(flow.tick) ? flow.tick : 0;
  const start = now - range.ticks;
  const logMax = 3, logMin = -12;
  const x = tick => x0 + (Math.max(start, Math.min(now, tick)) - start)
    / range.ticks * (x1 - x0);
  const y = pressure => {
    const log = Math.max(logMin, Math.min(logMax, Math.log10(Math.max(1e-12, pressure))));
    return y0 + (logMax - log) / (logMax - logMin) * (y1 - y0);
  };
  let svg = `<svg class="vacuum-pressure-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vacuum pressure over the last ${range.label} of in-game time">`;
  for (const decade of [3, 0, -3, -6, -9, -12]) {
    const py = y(Math.pow(10, decade));
    svg += `<line x1="${x0}" y1="${py}" x2="${x1}" y2="${py}" stroke="#ffffff18"/>`;
    svg += `<text x="${x0 - 4}" y="${py + 3}" fill="#aaa" font-size="9" text-anchor="end">1e${decade}</text>`;
  }
  for (const [tick, label] of [[start, range.startLabel], [start + range.ticks / 2, range.midLabel], [now, 'now']]) {
    const px = x(tick);
    svg += `<line x1="${px}" y1="${y0}" x2="${px}" y2="${y1}" stroke="#ffffff12"/>`;
    svg += `<text x="${px}" y="${H - 7}" fill="#aaa" font-size="9" text-anchor="middle">${label}</text>`;
  }
  const networkPressure = Number.isFinite(flow.networkPressure)
    ? flow.networkPressure : flow.pressure;
  const series = [{
    id: null,
    label: 'Network',
    color: '#d7e5ff',
    reading: networkPressure,
    status: 'ok',
    pressureAt: sample => sample.pressure,
  }, ...gauges.map(gauge => ({
    ...gauge,
    pressureAt: sample => sample.readings?.[gauge.id],
  }))];
  for (const trace of series) {
    const points = [];
    for (const sample of history) {
      if (!Number.isFinite(sample?.tick) || sample.tick < start || sample.tick > now) continue;
      const pressure = trace.pressureAt(sample);
      if (!(pressure > 0)) continue;
      points.push(`${x(sample.tick).toFixed(1)},${y(pressure).toFixed(1)}`);
    }
    // Newly loaded legacy saves have gauge-only history until their first
    // post-load sample. Keep the network series visible immediately.
    if (trace.id === null && points.length === 0 && networkPressure > 0) {
      points.push(`${x(now).toFixed(1)},${y(networkPressure).toFixed(1)}`);
    }
    if (points.length === 1) {
      const [px, py] = points[0].split(',');
      svg += `<circle cx="${px}" cy="${py}" r="2.5" fill="${trace.color}"/>`;
    } else if (points.length > 1) {
      svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${trace.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }
  }
  svg += '</svg>';
  let legend = '<div class="vacuum-pressure-legend">';
  for (const trace of series) {
    const status = trace.status === 'ok' ? fmtPressure(trace.reading)
      : trace.status === 'offline' ? 'offline'
        : trace.status === 'above_range' ? `>${fmtPressure(trace.reading)}`
          : `<${fmtPressure(trace.reading)}`;
    const detail = trace.id ? `${trace.id} · ${status}` : status;
    legend += `<div><span style="color:${trace.color}">●</span> ${escape(trace.label)} <span class="ui-text-faint">${escape(detail)}</span></div>`;
  }
  legend += '</div>';
  const controls = VACUUM_HISTORY_RANGES.map(option => {
    const selected = option.ticks === range.ticks;
    return `<button type="button" class="vacuum-pressure-range-btn${selected ? ' is-active' : ''}" data-vacuum-range-ticks="${option.ticks}" aria-pressed="${selected ? 'true' : 'false'}">${option.label}</button>`;
  }).join('');
  return `<div class="vacuum-pressure-plot">
    <div class="vacuum-pressure-heading">
      <div><strong>Pressure history</strong><span class="vacuum-pressure-caption">mbar · log scale</span></div>
      <div class="vacuum-pressure-range" role="group" aria-label="Pressure history range">${controls}</div>
    </div>
    ${svg}${legend}
  </div>`;
}

export default {
  type: 'vacuumPipe',
  displayName: 'Vacuum Pipe',
  color: '#888888',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: BEAM_PIPE_RADIUS_M,
  // Every long vacuum run uses one facility-wide service datum. Equipment
  // fittings at other heights receive a short local transition at the port.
  runHeightMeters: RIGID_UTILITY_SERVICE_HEIGHTS.vacuumPipe,
  supportSpacingMeters: RIGID_UTILITY_SUPPORT_SPACING_METERS,
  supportMinimumRunMeters: RIGID_UTILITY_SUPPORT_MINIMUM_RUN_METERS,
  fixedRouteHeight: true,
  // Fabricated pipe continues through structural walls as one ordinary run.
  requiresWallPassThrough: false,
  routeVerticalClearanceMeters: 0.06,
  // Vacuum shares the same quarter-tile routing freedom as every utility.
  // Its actual body radius still participates in measured 3D collisions; a
  // component's broad 2D footprint alone never blocks the pipe.
  routingProfile: FLEXIBLE_SUBTILE_ROUTING_PROFILE,
  bendRadiusMeters: 0.20,
  // Keep all routed bends as formed stainless tube. Inline beamline bellows
  // remain their own authored component; automatic corrugations multiplied
  // geometry rapidly on ordinary service transitions.
  bendPenalty: 1.5,
  fittingStyle: 'vacuumFlange',
  couplerSpacingMeters: 4,
  capacityUnit: 'L/s',
  allowsTap: true,
  // Same-datum vacuum pipe that touches an installed run is fabricated into
  // that header automatically. The player never has to hunt for a special tap
  // gesture or route around an otherwise compatible pipe.
  joinsOnContact: true,
  fansOut: true,
  bridgesAdjacent: true,
  demandUnit: 'mbar·L/s',
  capacityParam: 'pumpSpeed',
  demandParam: 'outgassing',
  costPerSubUnit: 56,
  // null means a newly-created network starts at atmosphere once its actual
  // volume is known. Storing gas inventory (an extensive quantity) lets the
  // generic split/join reconciler conserve gas across topology edits.
  persistentStateDefaults: { gasInventoryMbarL: null, pressureHistory: [] },
  solve(network, persistent, worldState, context = {}) {
    const byId = endpointsById(worldState);
    const baked = isBaked(network, byId);
    const pipe = beamPipeStats(network, byId, worldState);
    const lines = networkLines(network, worldState);
    const serviceLengthM = lines.reduce((sum, line) => sum + lineLengthM(line), 0);
    const serviceVolumeL = circularPipeVolumeLitres(serviceLengthM);
    const volumeL = pipe.volumeL + serviceVolumeL;
    const componentOutgas = (network.sinks || []).reduce(
      (sum, sink) => sum + (sink.params?.outgassing || 0), 0);
    const rawOutgas = componentOutgas + pipe.unbakedOutgas;
    const totalOutgas = baked ? rawOutgas * BAKEOUT_FACTOR : rawOutgas;

    const storedInventory = persistent?.gasInventoryMbarL;
    const previousPressure = volumeL > 0 && Number.isFinite(storedInventory)
      ? Math.max(0, storedInventory / volumeL)
      : ATMOSPHERE_MBAR;
    const pumps = pumpInventory(network, worldState, context.getDefinition);
    const stack = activePumpStack(pumps, previousPressure);
    const effectiveSpeed = conductanceLimitedSpeed(stack.active, lines, stack.stage);
    const equilibriumPressure = effectiveSpeed > 0
      ? totalOutgas / effectiveSpeed + stack.ultimatePressure
      : ATMOSPHERE_MBAR;

    let pressure;
    if (!(volumeL > 0)) {
      // Synthetic/headless networks without geometry retain the steady-state
      // behavior expected by descriptor-level tests.
      pressure = equilibriumPressure;
    } else if (effectiveSpeed > 0) {
      const decay = Math.exp(-effectiveSpeed / volumeL); // dt = one sim second
      pressure = equilibriumPressure + (previousPressure - equilibriumPressure) * decay;
    } else {
      pressure = previousPressure + totalOutgas / volumeL;
    }
    pressure = Math.max(0, Math.min(ATMOSPHERE_MBAR, pressure));

    const perSinkQuality = {};
    const perSinkPressure = {};
    const perSinkNumberDensity = {};
    for (const sink of (network.sinks || [])) {
      const target = endpointPoint(byId.get(sink.placeableId));
      const localSpeed = localEffectiveSpeed(stack.active, target, stack.stage);
      const localEquilibrium = localSpeed > 0
        ? totalOutgas / localSpeed + stack.ultimatePressure
        : ATMOSPHERE_MBAR;
      const localPressure = Math.min(ATMOSPHERE_MBAR, Math.max(pressure, localEquilibrium));
      perSinkPressure[sink.portKey] = localPressure;
      perSinkNumberDensity[sink.portKey] = numberDensityFromPressure(localPressure);
      perSinkQuality[sink.portKey] = qualityFromPressure(localPressure);
    }
    const sinkPressures = Object.values(perSinkPressure);
    const reportedPressure = sinkPressures.length > 0
      ? Math.max(pressure, ...sinkPressures)
      : pressure;

    const gauges = collectGauges(
      lines, stack.active, stack.stage, totalOutgas, pressure,
      stack.ultimatePressure, worldState, context.getDefinition,
    );
    const tick = Number.isFinite(worldState?.tick) ? worldState.tick : 0;
    const pressureHistory = nextHistory(
      persistent?.pressureHistory, gauges, tick, pressure,
    );
    const errors = [];
    const hasSinks = (network.sinks || []).length > 0;
    const nominalPumpSpeed = pumps.reduce((sum, p) => sum + p.nominalSpeed, 0);
    if (hasSinks && !(effectiveSpeed > 0)) {
      errors.push({
        severity: 'hard', code: nominalPumpSpeed > 0 ? 'vacuum_no_active_pump' : 'vacuum_no_pump',
        message: nominalPumpSpeed > 0
          ? 'Vacuum network has pumps, but no valid pumping stage is active.'
          : 'Vacuum network has no pump.',
        location: { networkId: network.id },
      });
    }
    if (stack.backingDemand > 0 && stack.backingFactor < 1) {
      errors.push({
        severity: stack.backingFactor === 0 ? 'hard' : 'soft',
        code: 'vacuum_turbo_unbacked',
        message: `Turbo backing is ${stack.roughExternal.toFixed(1)} / ${stack.backingDemand.toFixed(1)} L/s. Add roughing capacity.`,
        location: { networkId: network.id },
      });
    }
    const hasUhv = pumps.some(p => p.uhvSpeed > 0);
    const hasHigh = pumps.some(p => p.highVacSpeed > 0);
    if (hasUhv && !hasHigh) {
      errors.push({
        severity: 'soft', code: 'vacuum_uhv_needs_high_stage',
        message: 'Ion/NEG/Ti-sub pumping needs a backed turbo stage on this network.',
        location: { networkId: network.id },
      });
    }
    if (hasSinks && effectiveSpeed > 0 && reportedPressure > 1e-4) {
      errors.push({
        severity: 'soft', code: 'vacuum_poor',
        message: `Vacuum pressure high (${reportedPressure.toExponential(2)} mbar).`,
        location: { networkId: network.id },
      });
    }

    const numberDensity = numberDensityFromPressure(reportedPressure);
    const networkNumberDensity = numberDensityFromPressure(pressure);
    const flowState = {
      networkId: network.id,
      utilityType: network.utilityType,
      totalCapacity: effectiveSpeed,
      nominalPumpSpeed,
      totalDemand: totalOutgas,
      utilization: effectiveSpeed > 0 ? Math.min(1, totalOutgas / effectiveSpeed) : (hasSinks ? 1 : 0),
      pressure: reportedPressure,
      networkPressure: pressure,
      numberDensity,
      moleculeCount: networkNumberDensity * volumeL / 1000,
      gasInventoryMbarL: pressure * volumeL,
      volumeL,
      beamPipeLengthM: pipe.lengthM,
      serviceLineLengthM: serviceLengthM,
      effectivePumpSpeed: effectiveSpeed,
      equilibriumPressure,
      ultimatePressure: stack.ultimatePressure,
      vacuumStage: stack.stage,
      roughingSpeed: stack.roughExternal + stack.integratedRough,
      backingDemand: stack.backingDemand,
      backingFactor: stack.backingFactor,
      baked,
      gasSpecies: baked ? 'H₂-dominated' : 'H₂O-equivalent',
      componentOutgas,
      pipeOutgas: baked ? pipe.unbakedOutgas * BAKEOUT_FACTOR : pipe.unbakedOutgas,
      perSegmentLoad: [],
      perSinkQuality,
      perSinkPressure,
      perSinkNumberDensity,
      gauges,
      pressureHistory,
      tick,
      errors: [...errors],
    };
    return {
      flowState,
      nextPersistentState: {
        ...persistent,
        gasInventoryMbarL: flowState.gasInventoryMbarL,
        pressureHistory,
      },
      errors,
    };
  },
  renderInspector(network, flow, _persistent, viewOptions = {}) {
    const stage = flow.vacuumStage === 'uhv' ? 'UHV'
      : flow.vacuumStage === 'high' ? 'High vacuum'
        : flow.vacuumStage === 'rough' ? 'Roughing' : 'Inactive';
    return `<div class="vacuum-network-physics">
      <div class="vacuum-physics-grid">
        <div class="vacuum-physics-stat vacuum-physics-stat-primary"><span>Pressure</span><strong>${escape(fmtPressure(flow.pressure))}</strong></div>
        <div class="vacuum-physics-stat"><span>Active stage</span><strong>${escape(stage)}</strong></div>
        <div class="vacuum-physics-stat"><span>Evacuated volume</span><strong>${escape((flow.volumeL || 0).toFixed(1))} L</strong></div>
        <div class="vacuum-physics-stat"><span>Effective pumping</span><strong>${escape((flow.effectivePumpSpeed || 0).toFixed(1))} L/s</strong><small>${escape((flow.nominalPumpSpeed || 0).toFixed(1))} L/s nominal</small></div>
        <div class="vacuum-physics-stat"><span>Gas density</span><strong>${escape((flow.numberDensity || 0).toExponential(2))} m⁻³</strong></div>
        <div class="vacuum-physics-stat"><span>Gas inventory</span><strong>${escape((flow.moleculeCount || 0).toExponential(2))} molecules</strong></div>
      </div>
      <div class="vacuum-physics-footnote"><span>${escape(flow.gasSpecies || '--')}</span><span>${escape((flow.beamPipeLengthM || 0).toFixed(1))} m beam pipe</span><span>${escape((flow.serviceLineLengthM || 0).toFixed(1))} m service line</span></div>
      ${renderVacuumPressureGraph(flow, viewOptions.vacuumHistoryRangeTicks)}
    </div>`;
  },
  refillCost() { return null; },
};
