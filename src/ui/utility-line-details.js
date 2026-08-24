// Pure display models and markup for a clicked utility run. All operating
// quantities come from SolveRunner's published network snapshots/history.

import { COMPONENTS } from '../data/components.js';
import { pathLengthSubUnits, simplifyPath } from '../utility/line-geometry.js';
import { cablePathLengthSubUnits } from '../utility/soft-cable.js';
import { findUtilityEndpoint } from '../utility/utility-endpoints.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { waterCircuitLabel } from '../utility/water-circuits.js';
import {
  DEFAULT_VACUUM_HISTORY_RANGE_TICKS,
  renderVacuumPressureGraph,
} from '../utility/types/vacuumPipe.js';
import { sparklinePoints } from './control-room-model.js';
import { escapeHtml } from './format.js';
import { renderRfNyquist, renderRfSpectrum } from './rf-spectrum.js';

const PLOT_WIDTH = 520;
const PLOT_HEIGHT = 88;

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function endpointModel(state, endpoint) {
  if (!endpoint) return { connected: false, label: 'Open end', portName: 'not connected' };
  const placed = findUtilityEndpoint(state, endpoint.placeableId);
  const def = placed ? COMPONENTS[placed.type] : null;
  return {
    connected: true,
    placeableId: endpoint.placeableId,
    portName: endpoint.portName || 'port',
    label: def?.name || placed?.type || endpoint.placeableId,
  };
}

function routeLengthSubUnits(line) {
  if (Number.isFinite(line?.subL)) return Math.max(0, line.subL);
  if (Array.isArray(line?.cablePath) && line.cablePath.length >= 2) {
    return cablePathLengthSubUnits(line.cablePath);
  }
  return pathLengthSubUnits(line?.path || []);
}

function circuitLabel(value) {
  if (!value) return null;
  if (value === 'mixed') return 'Mixed circuits';
  return waterCircuitLabel(value).replace(/^./, char => char.toUpperCase());
}

/** Join one stored line to its published topology without re-solving it. */
export function utilityLineDetailsModel(state, lineId, networkId = null) {
  const line = state?.utilityLines?.get?.(lineId);
  if (!line) return null;
  const descriptor = UTILITY_TYPES[line.utilityType] || {};
  const networks = state?.utilityNetworks?.get?.(line.utilityType) || [];
  const network = networks.find(candidate => candidate.id === networkId)
    || networks.find(candidate => (candidate.lineIds || []).includes(lineId))
    || null;
  const flow = network ? state?.utilityNetworkData?.get?.(line.utilityType)?.get?.(network.id) : null;
  const route = simplifyPath(line.path || []);
  const errors = Array.isArray(flow?.errors) ? flow.errors : [];
  const lengthSubUnits = routeLengthSubUnits(line);

  return {
    lineId,
    utilityType: line.utilityType,
    displayName: descriptor.displayName || line.utilityType,
    color: descriptor.color || '#888888',
    start: endpointModel(state, line.start),
    end: endpointModel(state, line.end),
    connected: !!line.start && !!line.end,
    lengthMeters: lengthSubUnits * 0.5,
    installedSubUnits: lengthSubUnits,
    bendCount: Math.max(0, route.length - 2),
    routeSampleCount: Array.isArray(line.cablePath) ? line.cablePath.length : route.length,
    routeHeightMeters: finiteOrNull(line.routeHeightMeters),
    buried: line.buried === true,
    attachmentCount: Array.isArray(line.attachments) ? line.attachments.length : 0,
    manifold: line.manifold?.type || null,
    circuitLabel: circuitLabel(flow?.waterCircuit || line.waterCircuit),
    networkId: network?.id || networkId,
    networkRunCount: network?.lineIds?.length || 0,
    networkPortCount: network?.ports?.length || 0,
    solved: !!flow,
    hardErrorCount: errors.filter(error => error?.severity === 'hard').length,
    softErrorCount: errors.filter(error => error?.severity === 'soft').length,
  };
}

export function renderUtilityLineDetails(model) {
  if (!model) {
    return '<div class="ui-empty-state">This utility run no longer exists.</div>';
  }
  const status = !model.connected ? 'Open run'
    : model.hardErrorCount ? 'Fault'
      : model.softErrorCount ? 'Warning'
        : model.solved ? 'Healthy' : 'Pending solve';
  const statusKind = !model.connected || model.hardErrorCount ? 'hard'
    : model.softErrorCount ? 'soft'
      : model.solved ? 'good' : 'pending';
  const routeKind = model.buried ? 'Buried'
    : model.routeHeightMeters !== null ? `${model.routeHeightMeters.toFixed(2)} m elevation`
      : 'Standard service datum';

  const endpoint = (label, value) => `<div class="utility-line-endpoint">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value.label)}</strong>
    <small>${escapeHtml(value.connected ? value.portName : 'not connected')}</small>
  </div>`;

  return `<div class="utility-line-detail">
    <div class="utility-line-identity">
      <span class="utility-network-swatch" style="--utility-color:${escapeHtml(model.color)}"></span>
      <div><small>Selected utility run</small><code>${escapeHtml(model.lineId)}</code></div>
      <span class="utility-network-status utility-network-status-${statusKind}">${escapeHtml(status)}</span>
    </div>
    <div class="utility-line-endpoints">
      ${endpoint('Start', model.start)}
      <span class="utility-line-direction" aria-hidden="true">───</span>
      ${endpoint('End', model.end)}
    </div>
    <div class="utility-line-metrics">
      <span><small>Installed length</small><strong>${model.lengthMeters.toFixed(1)} m</strong></span>
      <span><small>Route bends</small><strong>${model.bendCount}</strong></span>
      <span><small>Route samples</small><strong>${model.routeSampleCount}</strong></span>
      <span><small>Attachments</small><strong>${model.attachmentCount}</strong></span>
    </div>
    <dl class="utility-line-readout">
      <div><dt>Service</dt><dd>${escapeHtml(model.displayName)}</dd></div>
      <div><dt>Physical route</dt><dd>${escapeHtml(routeKind)}</dd></div>
      ${model.circuitLabel ? `<div><dt>Circuit</dt><dd>${escapeHtml(model.circuitLabel)}</dd></div>` : ''}
      ${model.manifold ? `<div><dt>Carrier</dt><dd>${escapeHtml(model.manifold)}</dd></div>` : ''}
      <div><dt>Connected network</dt><dd>${escapeHtml(model.networkId || 'Pending discovery')}</dd></div>
      <div><dt>Network membership</dt><dd>${model.networkRunCount} runs · ${model.networkPortCount} ports</dd></div>
    </dl>
  </div>`;
}

/** Published performance model for the network containing a selected run. */
export function utilityPerformanceModel(state, utilityType, networkId) {
  const descriptor = UTILITY_TYPES[utilityType] || {};
  const history = state?.utilityPerformanceHistory?.get?.(utilityType)?.get?.(networkId) || [];
  const current = history[history.length - 1] || null;
  const flow = state?.utilityNetworkData?.get?.(utilityType)?.get?.(networkId) || null;
  return {
    utilityType,
    networkId,
    displayName: descriptor.displayName || utilityType,
    color: descriptor.color || '#69a7e8',
    capacityUnit: descriptor.capacityUnit || '',
    demandUnit: descriptor.demandUnit || descriptor.capacityUnit || '',
    topologyOnly: descriptor.topologyOnly === true,
    comparableLoad: !descriptor.demandUnit || descriptor.demandUnit === descriptor.capacityUnit,
    history,
    current,
    flow,
  };
}

function fmt(value, digits = 1) {
  if (!Number.isFinite(value)) return '--';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 0.1 && magnitude < 1e5) return value.toFixed(digits);
  return value.toExponential(2);
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '--';
}

function trace(values, color, options = {}) {
  const finiteValues = (values || []).filter(Number.isFinite);
  const points = sparklinePoints(finiteValues, PLOT_WIDTH, PLOT_HEIGHT, options);
  return points
    ? `<polyline points="${points}" style="--utility-plot-color:${escapeHtml(color)}"></polyline>`
    : '';
}

function performancePlot(title, value, caption, traces, legend = '') {
  return `<figure class="utility-performance-plot utility-instrument-panel">
    <figcaption><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(caption)}</small></span><em>${escapeHtml(value)}</em></figcaption>
    <div class="utility-performance-chart">
      <svg viewBox="0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}" role="img" aria-label="${escapeHtml(title)} recent history">
        <path class="utility-performance-grid" d="M0 22H${PLOT_WIDTH}M0 44H${PLOT_WIDTH}M0 66H${PLOT_WIDTH}M130 0V${PLOT_HEIGHT}M260 0V${PLOT_HEIGHT}M390 0V${PLOT_HEIGHT}"></path>
        ${traces}
      </svg>
      <div class="utility-plot-time-scale"><span>HISTORY</span><span>LIVE</span></div>
    </div>
    ${legend}
  </figure>`;
}

function legend(items) {
  return `<div class="utility-performance-legend">${items.map(item =>
    `<span style="--utility-plot-color:${escapeHtml(item.color)}"><i></i>${escapeHtml(item.label)}</span>`).join('')}</div>`;
}

function rangeMax(...series) {
  return Math.max(1, ...series.flat().filter(Number.isFinite));
}

function loadCapacityPlot(model, title, caption = 'Shared scale · network total') {
  const history = model.history;
  const current = model.current;
  const capacities = history.map(sample => sample.totalCapacity);
  const demands = history.map(sample => sample.totalDemand);
  const max = rangeMax(capacities, demands);
  return performancePlot(
    title, `${fmt(current.totalDemand)} ${model.demandUnit}`, caption,
    trace(capacities, '#69d2ff', { min: 0, max })
      + trace(demands, '#ffb14e', { min: 0, max }),
    legend([
      { label: `Capacity (${model.capacityUnit})`, color: '#69d2ff' },
      { label: `Demand (${model.demandUnit})`, color: '#ffb14e' },
    ]),
  );
}

function qualityPlot(model, title = 'Worst delivered quality') {
  const history = model.history;
  const current = model.current;
  const quality = history.map(sample => model.topologyOnly
    ? sample.connectivity : sample.deliveredQuality);
  const fault = current.hardErrorCount > 0 ? `${current.hardErrorCount} faults`
    : current.softErrorCount > 0 ? `${current.softErrorCount} warnings` : 'No active faults';
  return performancePlot(
    title, percent(model.topologyOnly ? current.connectivity : current.deliveredQuality), fault,
    trace(quality, current.hardErrorCount ? '#ff5b55' : '#55e38a', { min: 0, max: 1 }),
  );
}

function inventoryPlot(model, title, caption) {
  const volumes = model.history.map(sample => sample.reservoirVolumeL);
  const capacities = model.history.map(sample => sample.storageCapacityL);
  const max = rangeMax(volumes, capacities);
  return performancePlot(
    title, `${fmt(model.current.reservoirVolumeL)} L`, caption,
    trace(capacities, '#55708c', { min: 0, max })
      + trace(volumes, '#59d3ff', { min: 0, max }),
    legend([
      { label: 'Storage capacity', color: '#55708c' },
      { label: 'Inventory', color: '#59d3ff' },
    ]),
  );
}

function vacuumZoneBalance(flow, labelFor = value => value) {
  const zones = Array.isArray(flow?.vacuumZones) ? flow.vacuumZones : [];
  if (!zones.length) {
    return `<section class="vacuum-zone-panel utility-instrument-panel">
      <div class="utility-instrument-heading"><strong>PRESSURE-ZONE BALANCE</strong></div>
      <div class="ui-empty-state">Zone telemetry is waiting for the next vacuum solve.</div>
    </section>`;
  }
  const maxOutgassing = Math.max(0, ...zones.map(zone => zone.outgassingMbarLps || 0));
  const maxPumping = Math.max(0, ...zones.map(zone => zone.pumpingSpeedLps || 0));
  const rows = zones.map(zone => {
    const label = zone.placeableId ? (labelFor(zone.placeableId) || zone.placeableId) : 'Network pipework';
    const outgassing = Number.isFinite(zone.outgassingMbarLps) ? zone.outgassingMbarLps : 0;
    const pumping = Number.isFinite(zone.pumpingSpeedLps) ? zone.pumpingSpeedLps : 0;
    const outgasPct = maxOutgassing > 0 ? outgassing / maxOutgassing * 100 : 0;
    const pumpPct = maxPumping > 0 ? pumping / maxPumping * 100 : 0;
    return `<article class="vacuum-zone-row">
      <header><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(zone.portName || zone.id)}</small></span>
        <em>${escapeHtml(zone.pressureRegime || '--')} · ${fmt(zone.pressureMbar)} mbar</em></header>
      <div class="vacuum-zone-bar is-outgassing"><span>Outgassing</span><i><b style="width:${outgasPct.toFixed(2)}%"></b></i><em>${fmt(outgassing)} mbar·L/s</em></div>
      <div class="vacuum-zone-bar is-pumping"><span>Header pumping</span><i><b style="width:${pumpPct.toFixed(2)}%"></b></i><em>${fmt(pumping)} L/s</em></div>
    </article>`;
  }).join('');
  return `<section class="vacuum-zone-panel utility-instrument-panel">
    <div class="utility-instrument-heading"><span><strong>PRESSURE-ZONE BALANCE</strong><small>Bars normalize each quantity independently across zones</small></span><em>${zones.length} zone${zones.length === 1 ? '' : 's'}</em></div>
    <div class="vacuum-zone-list">${rows}</div>
  </section>`;
}

function renderDistinctPlots(model, options) {
  const { history, current, utilityType, flow } = model;
  if (utilityType === 'rfWaveguide') {
    return `<div class="utility-rf-plots">${renderRfSpectrum(flow)}${renderRfNyquist(flow)}</div>`;
  }
  if (utilityType === 'vacuumPipe') {
    return `<div class="utility-vacuum-plots">
      ${renderVacuumPressureGraph(flow || {}, options.vacuumHistoryRangeTicks)}
      ${vacuumZoneBalance(flow, options.labelFor)}
    </div>`;
  }
  if (!history.length || !current) return '';

  if (model.topologyOnly) {
    const nodes = history.map(sample => sample.connectedNodeCount);
    const links = history.map(sample => sample.connectedLinkCount);
    const max = rangeMax(nodes, links);
    return performancePlot(
      'Connected fabric', `${fmt(current.connectedNodeCount, 0)} devices`,
      'Solver-published network membership',
      trace(nodes, '#69d2ff', { min: 0, max }) + trace(links, '#d7d9e0', { min: 0, max }),
      legend([{ label: 'Devices', color: '#69d2ff' }, { label: 'Links', color: '#d7d9e0' }]),
    ) + qualityPlot(model, 'Connection health');
  }
  if (utilityType === 'coolingWater') {
    const deltaT = history.map(sample => sample.deltaT);
    return loadCapacityPlot(model, 'Thermal load and heat removal')
      + performancePlot('Loop temperature rise', `${fmt(current.deltaT)} K`,
        'Solver-published worst-case ΔT', trace(deltaT, '#ff8f72', { min: 0, max: 40 }))
      + inventoryPlot(model, 'Cooling-water inventory', 'Usable loop reservoir');
  }
  if (utilityType === 'waterSupplyPipe') {
    const supplied = history.map(sample => sample.suppliedWaterL);
    const evaporation = history.map(sample => sample.evaporationL);
    const max = rangeMax(supplied, evaporation);
    return loadCapacityPlot(model, 'Process-water thermal transfer')
      + inventoryPlot(model, 'Water inventory', 'Lukewarm circuit storage')
      + performancePlot('Make-up and evaporation', `${fmt(current.evaporationL)} L/tick evaporated`,
        'Network inventory flows',
        trace(supplied, '#59d3ff', { min: 0, max }) + trace(evaporation, '#ffb14e', { min: 0, max }),
        legend([{ label: 'Make-up', color: '#59d3ff' }, { label: 'Evaporation', color: '#ffb14e' }]));
  }
  if (utilityType === 'cryoTransfer') {
    const temperatures = history.map(sample => sample.tempK);
    const design = history.map(sample => sample.designTempK);
    const tempMax = rangeMax(temperatures, design);
    const boiloff = history.map(sample => sample.boiloffL);
    const recovered = history.map(sample => sample.recoveredL);
    const flowMax = rangeMax(boiloff, recovered);
    return loadCapacityPlot(model, 'Cryogenic heat balance')
      + performancePlot('Helium bath temperature', `${fmt(current.tempK, 2)} K`,
        `Design ${fmt(current.designTempK, 2)} K`,
        trace(design, '#55708c', { min: 0, max: tempMax })
          + trace(temperatures, '#ba8cff', { min: 0, max: tempMax }),
        legend([{ label: 'Design', color: '#55708c' }, { label: 'Bath', color: '#ba8cff' }]))
      + inventoryPlot(model, 'Liquid-helium inventory', 'Cryogenic storage')
      + performancePlot('Boil-off and recovery', `${fmt(current.netLheLossL)} L/tick net loss`,
        'Inventory flow per tick',
        trace(boiloff, '#ffb14e', { min: 0, max: flowMax })
          + trace(recovered, '#55e38a', { min: 0, max: flowMax }),
        legend([{ label: 'Boil-off', color: '#ffb14e' }, { label: 'Recovered', color: '#55e38a' }]));
  }
  if (utilityType === 'hvCable') {
    return loadCapacityPlot(model, 'High-voltage load profile')
      + qualityPlot(model, 'HV field regulation');
  }
  if (utilityType === 'powerCable') {
    return loadCapacityPlot(model, 'Electrical load profile')
      + qualityPlot(model, 'Delivered voltage quality');
  }
  return loadCapacityPlot(model, 'Demand and capacity',
    model.comparableLoad ? 'Shared scale · network total' : 'Published solver quantities')
    + qualityPlot(model);
}

export function renderUtilityPerformance(model, options = {}) {
  const history = model?.history || [];
  const current = model?.current;
  const canRenderLive = model?.utilityType === 'rfWaveguide' || model?.utilityType === 'vacuumPipe';
  if ((!history.length || !current) && !canRenderLive) {
    return `<div class="ui-empty-state">Performance telemetry is waiting for the next utility solve.<br/>
      <span class="ui-text-faint">The chart begins recording as the simulation advances.</span></div>`;
  }
  const plots = renderDistinctPlots(model, {
    vacuumHistoryRangeTicks: options.vacuumHistoryRangeTicks
      ?? DEFAULT_VACUUM_HISTORY_RANGE_TICKS,
    labelFor: options.labelFor || (value => value),
  });

  return `<div class="utility-performance" style="--utility-accent:${escapeHtml(model.color)}">
    <div class="utility-performance-heading">
      <i class="utility-performance-swatch" aria-hidden="true"></i>
      <div><small>Network telemetry</small><strong>${escapeHtml(model.displayName)}</strong><code>${escapeHtml(model.networkId)}</code></div>
      <span class="utility-plot-live"><i></i>LIVE</span>
    </div>
    <div class="utility-performance-scope"><span>CONNECTED NETWORK</span><p>Every run in this topology shares these solver-published values.</p><em>${history.length} sample${history.length === 1 ? '' : 's'}</em></div>
    <div class="utility-performance-plots utility-performance-plots-${escapeHtml(model.utilityType)}">${plots}</div>
  </div>`;
}
