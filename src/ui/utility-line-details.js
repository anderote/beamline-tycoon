// Pure display models and markup for a clicked utility run. All operating
// quantities come from SolveRunner's published network snapshots/history.

import { COMPONENTS } from '../data/components.js';
import { pathLengthSubUnits, simplifyPath } from '../utility/line-geometry.js';
import { cablePathLengthSubUnits } from '../utility/soft-cable.js';
import { findUtilityEndpoint } from '../utility/utility-endpoints.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { waterCircuitLabel } from '../utility/water-circuits.js';
import { sparklinePoints } from './control-room-model.js';
import { escapeHtml } from './format.js';

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
  return `<figure class="utility-performance-plot">
    <figcaption><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(caption)}</small></span><em>${escapeHtml(value)}</em></figcaption>
    <svg viewBox="0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}" role="img" aria-label="${escapeHtml(title)} recent history">
      <path class="utility-performance-grid" d="M0 22H${PLOT_WIDTH}M0 44H${PLOT_WIDTH}M0 66H${PLOT_WIDTH}"></path>
      ${traces}
    </svg>
    ${legend}
  </figure>`;
}

function legend(items) {
  return `<div class="utility-performance-legend">${items.map(item =>
    `<span style="--utility-plot-color:${escapeHtml(item.color)}"><i></i>${escapeHtml(item.label)}</span>`).join('')}</div>`;
}

export function renderUtilityPerformance(model) {
  const history = model?.history || [];
  const current = model?.current;
  if (!history.length || !current) {
    return `<div class="ui-empty-state">Performance telemetry is waiting for the next utility solve.<br/>
      <span class="ui-text-faint">The chart begins recording as the simulation advances.</span></div>`;
  }

  let primary;
  let supplemental = '';
  if (model.topologyOnly) {
    const nodes = history.map(sample => sample.connectedNodeCount);
    const links = history.map(sample => sample.connectedLinkCount);
    const max = Math.max(1, ...nodes.filter(Number.isFinite), ...links.filter(Number.isFinite));
    primary = performancePlot(
      'Connected fabric', `${fmt(current.connectedNodeCount, 0)} devices`,
      'Solver-published network membership',
      trace(nodes, '#69d2ff', { min: 0, max }) + trace(links, '#d7d9e0', { min: 0, max }),
      legend([{ label: 'Devices', color: '#69d2ff' }, { label: 'Links', color: '#d7d9e0' }]),
    );
  } else if (model.utilityType === 'vacuumPipe') {
    const pressures = history.map(sample => sample.networkPressure)
      .filter(value => Number.isFinite(value) && value > 0);
    const logs = pressures.map(value => Math.log10(value));
    primary = performancePlot(
      'Network pressure', `${fmt(current.networkPressure)} mbar`,
      'Log scale · lower is better', trace(logs, model.color),
    );
    const rough = history.map(sample => sample.roughingCapacity);
    const high = history.map(sample => sample.highVacCapacity);
    const uhv = history.map(sample => sample.uhvCapacity);
    const effective = history.map(sample => sample.effectivePumpSpeed);
    const max = Math.max(1,
      ...rough.filter(Number.isFinite), ...high.filter(Number.isFinite),
      ...uhv.filter(Number.isFinite), ...effective.filter(Number.isFinite));
    const volumeCaption = `${fmt(current.evacuatedVolumeL)} L evacuated · utility pipe ${fmt(current.servicePipeVolumeL)} · beamline pipe ${fmt(current.beamPipeVolumeL)} · beamline components ${fmt(current.componentChamberVolumeL)}`;
    supplemental = performancePlot(
      'Pumping capacity by stage', `${fmt(current.effectivePumpSpeed)} L/s effective`,
      volumeCaption,
      trace(rough, '#d7b36a', { min: 0, max })
        + trace(high, '#69d2ff', { min: 0, max })
        + trace(uhv, '#ba8cff', { min: 0, max })
        + trace(effective, '#55e38a', { min: 0, max }),
      legend([
        { label: 'Roughing', color: '#d7b36a' },
        { label: 'High vacuum', color: '#69d2ff' },
        { label: 'UHV', color: '#ba8cff' },
        { label: 'Effective active', color: '#55e38a' },
      ]),
    );
  } else {
    const capacities = history.map(sample => sample.totalCapacity);
    const demands = history.map(sample => sample.totalDemand);
    const max = Math.max(1, ...capacities.filter(Number.isFinite), ...demands.filter(Number.isFinite));
    primary = performancePlot(
      'Demand and capacity', `${fmt(current.totalDemand)} ${model.demandUnit}`,
      model.comparableLoad ? 'Shared scale · network total' : 'Published solver quantities',
      trace(capacities, '#69d2ff', { min: 0, max }) + trace(demands, '#ffb14e', { min: 0, max }),
      legend([
        { label: `Capacity (${model.capacityUnit})`, color: '#69d2ff' },
        { label: `Demand (${model.demandUnit})`, color: '#ffb14e' },
      ]),
    );
  }

  const quality = history.map(sample => model.topologyOnly
    ? sample.connectivity : sample.deliveredQuality);
  const fault = current.hardErrorCount > 0 ? `${current.hardErrorCount} faults`
    : current.softErrorCount > 0 ? `${current.softErrorCount} warnings` : 'No active faults';
  const secondary = performancePlot(
    model.topologyOnly ? 'Connection health' : 'Worst delivered quality',
    percent(model.topologyOnly ? current.connectivity : current.deliveredQuality), fault,
    trace(quality, current.hardErrorCount ? '#ff5b55' : '#55e38a', { min: 0, max: 1 }),
  );

  return `<div class="utility-performance">
    <div class="utility-performance-heading">
      <div><small>Selected run · connected network</small><code>${escapeHtml(model.networkId)}</code></div>
      <span>${history.length} tick${history.length === 1 ? '' : 's'}</span>
    </div>
    <p>Utility performance is solved for the connected network. Every run in this topology shares these live values.</p>
    <div class="utility-performance-plots">${primary}${supplemental}${secondary}</div>
  </div>`;
}
