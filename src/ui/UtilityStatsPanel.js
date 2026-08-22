// UtilityStatsPanel.js — facility-wide, topology-separated utility overview.
//
// The solver publishes two complementary views of the same utility state:
//   state.utilityNetworks    — discovered connected components and membership
//   state.utilityNetworkData — solved capacity, demand, quality, and errors
//
// This window only joins those published records for display. It never infers
// connectivity or recomputes a utility quantity. Every disconnected component
// gets its own row; aggregating by utility type would hide isolated or
// overloaded networks behind healthy ones.

import { ContextWindow } from './ContextWindow.js';
import { UtilityInspector } from './UtilityInspector.js';
import { escapeHtml } from './format.js';
import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { waterCircuitLabel } from '../utility/water-circuits.js';

const WINDOW_ID = 'networks-overview';

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function formatUtilityQuantity(value) {
  if (!Number.isFinite(value)) return '--';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 0.1 && magnitude < 1e6) return value.toFixed(1);
  return value.toExponential(2);
}

function circuitLabel(value) {
  if (!value) return null;
  if (value === 'mixed') return 'Mixed circuits';
  return waterCircuitLabel(value).replace(/^./, c => c.toUpperCase());
}

/**
 * Build the display model from published topology and solve snapshots.
 * Network ordinals are stable while their content-hashed ids are stable.
 */
export function utilityNetworkOverview(state) {
  const discovered = state?.utilityNetworks;
  const solved = state?.utilityNetworkData;
  const groups = [];

  for (const utilityType of UTILITY_TYPE_LIST) {
    const descriptor = UTILITY_TYPES[utilityType];
    const networks = discovered?.get?.(utilityType);
    if (!descriptor || !Array.isArray(networks) || networks.length === 0) continue;

    const ordered = [...networks].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const flows = solved?.get?.(utilityType);
    const rows = ordered.map((network, index) => {
      const flow = flows?.get?.(network.id) || null;
      const errors = Array.isArray(flow?.errors) ? flow.errors : [];
      const hardErrorCount = errors.filter(error => error?.severity === 'hard').length;
      const softErrorCount = errors.filter(error => error?.severity === 'soft').length;
      const sourceCount = Array.isArray(network.sources) ? network.sources.length : 0;
      const loadCount = Array.isArray(network.sinks) ? network.sinks.length : 0;
      const portCount = Array.isArray(network.ports) ? network.ports.length : 0;
      const lineCount = Array.isArray(network.lineIds) ? network.lineIds.length : 0;

      return {
        utilityType,
        networkId: network.id,
        ordinal: index + 1,
        displayName: descriptor.displayName || utilityType,
        color: descriptor.color || '#888888',
        topologyOnly: descriptor.topologyOnly === true,
        topologyLabel: descriptor.topology === 'bus' ? 'Bus' : 'Connected',
        circuitLabel: circuitLabel(flow?.waterCircuit),
        capacityUnit: descriptor.capacityUnit || '',
        demandUnit: descriptor.demandUnit || descriptor.capacityUnit || '',
        totalCapacity: finiteOrNull(flow?.totalCapacity),
        totalDemand: finiteOrNull(flow?.totalDemand),
        sourceCount,
        loadCount,
        portCount,
        lineCount,
        connectedNodeCount: finiteOrNull(flow?.connectedNodeCount),
        connectedLinkCount: finiteOrNull(flow?.connectedLinkCount),
        solved: flow !== null,
        hardErrorCount,
        softErrorCount,
      };
    });

    groups.push({
      utilityType,
      displayName: descriptor.displayName || utilityType,
      color: descriptor.color || '#888888',
      rows,
    });
  }

  return groups;
}

function rowStatus(row) {
  if (!row.solved) return { label: 'Pending solve', kind: 'pending' };
  if (row.hardErrorCount > 0) {
    return {
      label: `${row.hardErrorCount} fault${row.hardErrorCount === 1 ? '' : 's'}`,
      kind: 'hard',
    };
  }
  if (row.softErrorCount > 0) {
    return {
      label: `${row.softErrorCount} warning${row.softErrorCount === 1 ? '' : 's'}`,
      kind: 'soft',
    };
  }
  return { label: 'Healthy', kind: 'good' };
}

function renderRow(row) {
  const status = rowStatus(row);
  const topology = row.circuitLabel || row.topologyLabel;
  const topologyMeta = `${row.lineCount} run${row.lineCount === 1 ? '' : 's'} · ${row.portCount} port${row.portCount === 1 ? '' : 's'}`;

  let metrics;
  if (row.topologyOnly) {
    const devices = row.connectedNodeCount ?? row.portCount;
    const links = row.connectedLinkCount ?? row.lineCount;
    metrics = `
      <span><small>Devices</small><strong>${devices}</strong></span>
      <span><small>Links</small><strong>${links}</strong></span>
      <span><small>Topology</small><strong>${escapeHtml(row.topologyLabel)}</strong></span>`;
  } else {
    metrics = `
      <span><small>Capacity</small><strong>${formatUtilityQuantity(row.totalCapacity)} <em>${escapeHtml(row.capacityUnit)}</em></strong></span>
      <span><small>Load</small><strong>${formatUtilityQuantity(row.totalDemand)} <em>${escapeHtml(row.demandUnit)}</em></strong></span>
      <span><small>Sources / loads</small><strong>${row.sourceCount} / ${row.loadCount}</strong></span>`;
  }

  return `<button type="button" class="utility-network-row"
      data-utility-type="${escapeHtml(row.utilityType)}"
      data-network-id="${escapeHtml(row.networkId)}"
      aria-label="Open ${escapeHtml(row.displayName)} network ${row.ordinal}">
    <span class="utility-network-row-main">
      <span class="utility-network-index">#${row.ordinal}</span>
      <span class="utility-network-topology"><strong>${escapeHtml(topology)}</strong><small>${escapeHtml(topologyMeta)}</small></span>
      <span class="utility-network-status utility-network-status-${status.kind}">${escapeHtml(status.label)}</span>
    </span>
    <span class="utility-network-metrics">${metrics}</span>
  </button>`;
}

export function renderUtilityNetworkOverview(groups) {
  if (!groups.length) {
    return `<div class="ui-empty-state utility-networks-empty">
      No utility networks yet.<br/>
      <span class="ui-text-faint">Connect a utility line between ports to create one.</span>
    </div>`;
  }

  return `<div class="utility-networks-overview">
    <div class="utility-networks-help">Disconnected topologies are listed separately. Select a network for sources, loads, capacity, quality, and faults.</div>
    ${groups.map(group => `<section class="utility-network-group">
      <div class="utility-network-group-heading">
        <span class="utility-network-swatch" style="--utility-color:${escapeHtml(group.color)}"></span>
        <strong>${escapeHtml(group.displayName)}</strong>
        <span>${group.rows.length} network${group.rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="utility-network-list">${group.rows.map(renderRow).join('')}</div>
    </section>`).join('')}
  </div>`;
}

export class UtilityStatsPanel {
  static toggle(game) {
    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) { existing.close(); return null; }
    return new UtilityStatsPanel(game);
  }

  constructor(game) {
    this.game = game;

    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    this.ctx = new ContextWindow({
      id: WINDOW_ID,
      title: 'Utility Networks',
      icon: '⚡',
      accentColor: '#34506f',
      tabs: [{ key: 'networks', label: 'Networks' }],
      onClose: () => this._cleanup(),
    });
    this.ctx.onTabRender('networks', element => this._render(element));

    this._off = typeof game.on === 'function' ? game.on(event => {
      if (event === 'tick' || event === 'utilityLinesChanged' || event === 'loaded') {
        this.ctx?.update();
      }
    }) : null;

    this.ctx.update();
  }

  _render(element) {
    const groups = utilityNetworkOverview(this.game.state);
    element.innerHTML = renderUtilityNetworkOverview(groups);
    element.querySelectorAll('[data-network-id]').forEach(button => {
      button.addEventListener('click', () => {
        const utilityType = button.dataset.utilityType;
        const networkId = button.dataset.networkId;
        if (utilityType && networkId) new UtilityInspector(this.game, utilityType, networkId);
      });
    });
  }

  _cleanup() {
    this._off?.();
    this._off = null;
  }
}

export default UtilityStatsPanel;
