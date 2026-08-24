// UtilityStatsPanel.js — facility-wide utility category dashboard.
//
// The solver publishes two complementary views of the same utility state:
//   state.utilityNetworks    — discovered connected components and membership
//   state.utilityNetworkData — solved capacity, demand, quality, and errors
//
// This window only joins those published records for display. It never infers
// connectivity or recomputes a utility quantity. The first level summarizes
// infrastructure families; a selected family preserves every disconnected
// component as its own inspector row so an unhealthy topology cannot disappear
// behind a healthy sibling.

import { ContextWindow } from './ContextWindow.js';
import { UtilityInspector } from './UtilityInspector.js';
import { escapeHtml } from './format.js';
import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { waterCircuitLabel } from '../utility/water-circuits.js';

const WINDOW_ID = 'networks-overview';

// These are presentation families, not solver types. Each solver type appears
// exactly once so the overview remains exhaustive as well as compact.
const UTILITY_CATEGORIES = [
  {
    key: 'electrical',
    name: 'Electrical',
    shortLabel: 'ELEC',
    description: 'Grid feeders and branch power distribution',
    color: '#44cc44',
    utilityTypes: ['hvCable', 'powerCable'],
  },
  {
    key: 'rf',
    name: 'RF Power',
    shortLabel: 'RF',
    description: 'High-power RF generation and delivery',
    color: '#cc4444',
    utilityTypes: ['rfWaveguide'],
  },
  {
    key: 'vacuum',
    name: 'Vacuum',
    shortLabel: 'VAC',
    description: 'Beamline pumping and vacuum transport',
    color: '#999999',
    utilityTypes: ['vacuumPipe'],
  },
  {
    key: 'cooling',
    name: 'Cooling & Cryogenics',
    shortLabel: 'THERM',
    description: 'Water supply, process cooling, and cryogenic transfer',
    color: '#4488cc',
    utilityTypes: ['waterSupplyPipe', 'coolingWater', 'cryoTransfer'],
  },
  {
    key: 'controls',
    name: 'Data & Controls',
    shortLabel: 'DATA',
    description: 'Facility controls and data connectivity',
    color: '#eeeeee',
    utilityTypes: ['dataFiber'],
  },
];

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
      const topologyDiagnostics = flow?.topology?.diagnostics || {};

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
        deadBranchCount: finiteOrNull(topologyDiagnostics.deadBranches) || 0,
        constrainedNodeCount: finiteOrNull(topologyDiagnostics.constrainedNodes) || 0,
        deenergizedNodeCount: finiteOrNull(topologyDiagnostics.deenergizedNodes) || 0,
        idleNodeCount: finiteOrNull(topologyDiagnostics.idleNodes) || 0,
      };
    });

    groups.push({
      utilityType,
      displayName: descriptor.displayName || utilityType,
      color: descriptor.color || '#888888',
      topologyOnly: descriptor.topologyOnly === true,
      capacityUnit: descriptor.capacityUnit || '',
      demandUnit: descriptor.demandUnit || descriptor.capacityUnit || '',
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
  if (row.deenergizedNodeCount > 0) {
    return {
      label: `${row.deenergizedNodeCount} de-energized`,
      kind: 'hard',
    };
  }
  if (row.constrainedNodeCount > 0) {
    return {
      label: `${row.constrainedNodeCount} constrained`,
      kind: 'soft',
    };
  }
  if (row.softErrorCount > 0) {
    return {
      label: `${row.softErrorCount} warning${row.softErrorCount === 1 ? '' : 's'}`,
      kind: 'soft',
    };
  }
  if (row.deadBranchCount > 0) {
    return {
      label: `${row.deadBranchCount} dead branch${row.deadBranchCount === 1 ? '' : 'es'}`,
      kind: 'soft',
    };
  }
  if (row.idleNodeCount > 0) {
    return {
      label: `${row.idleNodeCount} idle`,
      kind: 'pending',
    };
  }
  return { label: 'Healthy', kind: 'good' };
}

function summarizeRows(rows) {
  const statuses = rows.map(rowStatus);
  const hardNetworkCount = statuses.filter(status => status.kind === 'hard').length;
  const warningNetworkCount = statuses.filter(status => status.kind === 'soft').length;
  const pendingNetworkCount = statuses.filter(status => status.kind === 'pending').length;
  const healthyNetworkCount = statuses.filter(status => status.kind === 'good').length;

  return {
    networkCount: rows.length,
    lineCount: rows.reduce((sum, row) => sum + row.lineCount, 0),
    portCount: rows.reduce((sum, row) => sum + row.portCount, 0),
    sourceCount: rows.reduce((sum, row) => sum + row.sourceCount, 0),
    loadCount: rows.reduce((sum, row) => sum + row.loadCount, 0),
    hardNetworkCount,
    warningNetworkCount,
    pendingNetworkCount,
    healthyNetworkCount,
  };
}

function categoryStatus(summary) {
  if (summary.networkCount === 0) return { label: 'Not connected', kind: 'inactive' };
  if (summary.hardNetworkCount > 0) {
    const count = summary.hardNetworkCount;
    return { label: `${count} faulted network${count === 1 ? '' : 's'}`, kind: 'hard' };
  }
  if (summary.warningNetworkCount > 0) {
    const count = summary.warningNetworkCount;
    return { label: `${count} network warning${count === 1 ? '' : 's'}`, kind: 'soft' };
  }
  if (summary.pendingNetworkCount > 0) {
    const count = summary.pendingNetworkCount;
    return { label: `${count} network pending`, kind: 'pending' };
  }
  return { label: 'All networks healthy', kind: 'good' };
}

function summarizeUtilityGroup(group) {
  const summary = summarizeRows(group.rows);
  const allQuantitiesPublished = group.rows.length > 0
    && group.rows.every(row => Number.isFinite(row.totalCapacity) && Number.isFinite(row.totalDemand));
  const allTopologyCountsPublished = group.rows.length > 0
    && group.rows.every(row => Number.isFinite(row.connectedNodeCount)
      && Number.isFinite(row.connectedLinkCount));

  return {
    ...group,
    ...summary,
    totalCapacity: allQuantitiesPublished
      ? group.rows.reduce((sum, row) => sum + row.totalCapacity, 0)
      : null,
    totalDemand: allQuantitiesPublished
      ? group.rows.reduce((sum, row) => sum + row.totalDemand, 0)
      : null,
    connectedNodeCount: allTopologyCountsPublished
      ? group.rows.reduce((sum, row) => sum + row.connectedNodeCount, 0)
      : null,
    connectedLinkCount: allTopologyCountsPublished
      ? group.rows.reduce((sum, row) => sum + row.connectedLinkCount, 0)
      : null,
  };
}

/** Build the compact first-level infrastructure families from network groups. */
export function utilityCategoryOverview(groups) {
  const byType = new Map(groups.map(group => [group.utilityType, group]));

  return UTILITY_CATEGORIES.map(definition => {
    const utilityGroups = definition.utilityTypes.map(utilityType => {
      const descriptor = UTILITY_TYPES[utilityType];
      const group = byType.get(utilityType) || {
        utilityType,
        displayName: descriptor?.displayName || utilityType,
        color: descriptor?.color || '#888888',
        topologyOnly: descriptor?.topologyOnly === true,
        capacityUnit: descriptor?.capacityUnit || '',
        demandUnit: descriptor?.demandUnit || descriptor?.capacityUnit || '',
        rows: [],
      };
      return summarizeUtilityGroup(group);
    });
    const rows = utilityGroups.flatMap(group => group.rows);
    const summary = summarizeRows(rows);

    return {
      ...definition,
      utilityGroups,
      ...summary,
      status: categoryStatus(summary),
    };
  });
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

function renderTypeSummary(group) {
  let detail;
  if (group.networkCount === 0) {
    detail = 'No networks';
  } else if (group.topologyOnly) {
    const devices = group.connectedNodeCount ?? group.portCount;
    const links = group.connectedLinkCount ?? group.lineCount;
    detail = `${devices} device${devices === 1 ? '' : 's'} · ${links} link${links === 1 ? '' : 's'}`;
  } else if (group.totalCapacity !== null && group.totalDemand !== null) {
    detail = `${formatUtilityQuantity(group.totalDemand)} ${escapeHtml(group.demandUnit)} load · ${formatUtilityQuantity(group.totalCapacity)} ${escapeHtml(group.capacityUnit)} capacity`;
  } else {
    detail = 'Waiting for solver data';
  }

  return `<span class="utility-category-type">
    <span class="utility-network-swatch" style="--utility-color:${escapeHtml(group.color)}"></span>
    <span><strong>${escapeHtml(group.displayName)}</strong><small>${detail}</small></span>
  </span>`;
}

function renderCategoryCard(category) {
  const networkLabel = `${category.networkCount} network${category.networkCount === 1 ? '' : 's'}`;
  return `<button type="button" class="utility-category-card"
      data-utility-category="${escapeHtml(category.key)}"
      aria-label="Open ${escapeHtml(category.name)} utility networks">
    <span class="utility-category-card-heading">
      <span class="utility-category-monogram" style="--utility-color:${escapeHtml(category.color)}">${escapeHtml(category.shortLabel)}</span>
      <span class="utility-category-title"><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description)}</small></span>
      <span class="utility-category-status utility-network-status-${category.status.kind}">${escapeHtml(category.status.label)}</span>
    </span>
    <span class="utility-category-metrics">
      <span><small>Networks</small><strong>${category.networkCount}</strong></span>
      <span><small>Runs</small><strong>${category.lineCount}</strong></span>
      <span><small>Ports</small><strong>${category.portCount}</strong></span>
      <span><small>Sources / loads</small><strong>${category.sourceCount} / ${category.loadCount}</strong></span>
    </span>
    <span class="utility-category-types">${category.utilityGroups.map(renderTypeSummary).join('')}</span>
    <span class="utility-category-open">${networkLabel} <span aria-hidden="true">›</span></span>
  </button>`;
}

function renderDashboard(categories) {
  const networkCount = categories.reduce((sum, category) => sum + category.networkCount, 0);
  const runCount = categories.reduce((sum, category) => sum + category.lineCount, 0);
  const attentionCount = categories.reduce(
    (sum, category) => sum + category.hardNetworkCount + category.warningNetworkCount, 0,
  );
  const activeCategoryCount = categories.filter(category => category.networkCount > 0).length;

  return `<div class="utility-networks-overview utility-category-dashboard">
    <div class="utility-overview-heading">
      <span><strong>Facility infrastructure</strong><small>Select a category to inspect its individual networks.</small></span>
      <span class="utility-overview-totals">
        <span><strong>${activeCategoryCount}</strong><small>Active systems</small></span>
        <span><strong>${networkCount}</strong><small>Networks</small></span>
        <span><strong>${runCount}</strong><small>Runs</small></span>
        <span class="${attentionCount > 0 ? 'has-attention' : ''}"><strong>${attentionCount}</strong><small>Need attention</small></span>
      </span>
    </div>
    <div class="utility-category-grid">${categories.map(renderCategoryCard).join('')}</div>
  </div>`;
}

function renderCategoryDetail(category) {
  const activeGroups = category.utilityGroups.filter(group => group.rows.length > 0);
  const networkSections = activeGroups.map(group => `<section class="utility-network-group">
      <div class="utility-network-group-heading">
        <span class="utility-network-swatch" style="--utility-color:${escapeHtml(group.color)}"></span>
        <strong>${escapeHtml(group.displayName)}</strong>
        <span>${group.rows.length} network${group.rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="utility-network-list">${group.rows.map(renderRow).join('')}</div>
    </section>`).join('');

  return `<div class="utility-networks-overview utility-category-detail">
    <button type="button" class="utility-category-back" data-utility-overview-back>‹ All utilities</button>
    <div class="utility-category-detail-heading">
      <span class="utility-category-monogram" style="--utility-color:${escapeHtml(category.color)}">${escapeHtml(category.shortLabel)}</span>
      <span><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description)}</small></span>
      <span class="utility-category-status utility-network-status-${category.status.kind}">${escapeHtml(category.status.label)}</span>
    </div>
    <div class="utility-category-metrics utility-category-detail-metrics">
      <span><small>Networks</small><strong>${category.networkCount}</strong></span>
      <span><small>Runs</small><strong>${category.lineCount}</strong></span>
      <span><small>Ports</small><strong>${category.portCount}</strong></span>
      <span><small>Sources / loads</small><strong>${category.sourceCount} / ${category.loadCount}</strong></span>
    </div>
    <div class="utility-category-rollups">${category.utilityGroups.map(renderTypeSummary).join('')}</div>
    ${networkSections || `<div class="ui-empty-state utility-networks-empty">
      No ${escapeHtml(category.name.toLowerCase())} networks yet.<br/>
      <span class="ui-text-faint">Connect a utility line between ports to create one.</span>
    </div>`}
    ${networkSections ? '<div class="utility-networks-help">Each disconnected topology stays separate. Select a network for its live graph, branch flow, capacity, and faults.</div>' : ''}
  </div>`;
}

export function renderUtilityNetworkOverview(groups, selectedCategoryKey = null) {
  const categories = utilityCategoryOverview(groups);
  const selected = categories.find(category => category.key === selectedCategoryKey);
  return selected ? renderCategoryDetail(selected) : renderDashboard(categories);
}

export class UtilityStatsPanel {
  static toggle(game) {
    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) { existing.close(); return null; }
    return new UtilityStatsPanel(game);
  }

  constructor(game) {
    this.game = game;
    this._selectedCategory = null;

    const existing = ContextWindow.getWindow(WINDOW_ID);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    this.ctx = new ContextWindow({
      id: WINDOW_ID,
      title: 'Utilities',
      icon: '⚡',
      accentColor: '#34506f',
      tabs: [{ key: 'overview', label: 'Infrastructure Overview' }],
      onClose: () => this._cleanup(),
    });
    this.ctx.onTabRender('overview', element => this._render(element));

    this._off = typeof game.on === 'function' ? game.on(event => {
      if (event === 'tick' || event === 'utilityLinesChanged' || event === 'loaded') {
        this.ctx?.update();
      }
    }) : null;

    this.ctx.update();
  }

  _render(element) {
    const groups = utilityNetworkOverview(this.game.state);
    element.innerHTML = renderUtilityNetworkOverview(groups, this._selectedCategory);
    element.querySelectorAll('[data-utility-category]').forEach(button => {
      button.addEventListener('click', () => {
        this._selectedCategory = button.dataset.utilityCategory || null;
        this.ctx?.update();
      });
    });
    element.querySelector('[data-utility-overview-back]')?.addEventListener('click', () => {
      this._selectedCategory = null;
      this.ctx?.update();
    });
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
