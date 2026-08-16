// Pure presentation model for the utility connectors shown in a component's
// info window. Values come from getUtilityPortsV2 so solver defaults, derived
// RF metadata, and utility-specific parameter names stay authoritative.

import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { UTILITY_TYPES } from '../utility/registry.js';

const ROLE_LABELS = {
  sink: 'Input',
  source: 'Output',
  pass: 'Pass-through',
};

const SOURCE_METRICS = {
  coolingWater: [
    ['capacity', 'Cooling capacity', 'kW'],
    ['heatRejectionCapacity', 'Heat rejection', 'kW'],
    ['supplyRateLPerTick', 'Water supply', 'L/tick'],
    ['storageCapacityL', 'Water storage', 'L'],
  ],
};

function rounded(value) {
  return Math.round(value * 1e6) / 1e6;
}

function formatNumber(value) {
  if (value !== 0 && Math.abs(value) < 0.01) return value.toExponential(1);
  const shown = rounded(value);
  if (Math.abs(shown) >= 1000) return Math.round(shown).toLocaleString();
  return String(shown);
}

function formatDutyPercent(dutyFactor) {
  const pct = Math.round(dutyFactor * 1000) / 10;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct}%`;
}

function metricSpecs(utilityType, role, descriptor) {
  if (role === 'source') {
    return SOURCE_METRICS[utilityType] || [[
      descriptor?.capacityParam || 'capacity',
      'Capacity',
      descriptor?.capacityUnit || '',
    ]];
  }
  if (role === 'sink') {
    return [[
      descriptor?.demandParam || 'demand',
      'Demand',
      descriptor?.demandUnit || descriptor?.capacityUnit || '',
    ]];
  }
  if (role === 'pass') {
    return [['fieldCapacity', 'Rating', descriptor?.capacityUnit || '']];
  }
  return [];
}

function groupMetrics(group, descriptor) {
  const metrics = [];
  const specs = metricSpecs(group.utilityType, group.role, descriptor);
  for (const [param, label, unit] of specs) {
    const values = group.ports
      .map(({ port }) => Number(port.params?.[param]))
      .filter(Number.isFinite);
    if (!values.length) continue;

    // Pass ports repeat one bus rating on every connector. Summing it would
    // turn a 160 kW nine-port bus into a fictitious 1,440 kW source.
    const total = group.role === 'pass'
      ? Math.min(...values)
      : values.reduce((sum, value) => sum + value, 0);
    const positiveAlternative = metrics.some(metric => metric.total > 0)
      || specs.some(([otherParam]) =>
        otherParam !== param && group.ports.some(({ port }) => Number(port.params?.[otherParam]) > 0));
    if (total === 0 && positiveAlternative) continue;

    const samePerPort = group.role !== 'pass'
      && values.length === group.ports.length
      && values.every(value => rounded(value) === rounded(values[0]));
    const isRfSource = group.utilityType === 'rfWaveguide' && group.role === 'source';
    let value = `${formatNumber(total)}${unit ? ` ${unit}` : ''}`;
    if (group.ports.length > 1 && group.role !== 'pass') value += ' total';
    if (samePerPort && group.ports.length > 1) {
      value += ` · ${formatNumber(values[0])}${unit ? ` ${unit}` : ''} each`;
    }
    if (isRfSource) {
      const duty = group.ports.map(({ port }) => port.params?.dutyFactor).find(Number.isFinite);
      if (Number.isFinite(duty)) value += ` · ${formatDutyPercent(duty)} duty`;
    }
    metrics.push({ label: isRfSource ? 'Peak capacity' : label, value, total });
  }
  return metrics.map(({ label, value }) => ({ label, value }));
}

/**
 * Group a component's resolved connectors by utility and direction.
 * Connector names remain available so a player can match the panel to the
 * physical fittings while repeated outlet banks stay compact.
 */
export function componentUtilityPortGroups(typeId) {
  const groups = new Map();
  for (const [portName, port] of Object.entries(getUtilityPortsV2(typeId))) {
    if (!port?.utility || !ROLE_LABELS[port.role]) continue;
    const key = `${port.utility}:${port.role}`;
    const descriptor = UTILITY_TYPES[port.utility] || {};
    const group = groups.get(key) || {
      utilityType: port.utility,
      utilityLabel: descriptor.displayName || port.utility,
      color: descriptor.markerColor || descriptor.color || '#cccccc',
      role: port.role,
      roleLabel: ROLE_LABELS[port.role],
      ports: [],
    };
    group.ports.push({ name: portName, port });
    groups.set(key, group);
  }

  return [...groups.values()].map(group => {
    const descriptor = UTILITY_TYPES[group.utilityType] || {};
    return {
      utilityType: group.utilityType,
      utilityLabel: group.utilityLabel,
      color: group.color,
      role: group.role,
      roleLabel: group.roleLabel,
      count: group.ports.length,
      portNames: group.ports.map(({ name }) => name),
      metrics: groupMetrics(group, descriptor),
    };
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

/** Render the complete ports section for a single-component info window. */
export function componentUtilityPortSectionHtml(typeId) {
  const groups = componentUtilityPortGroups(typeId);
  if (!groups.length) return '';

  let html = '<section class="equipment-port-section">'
    + '<div class="equipment-port-heading">Connection ports</div>'
    + '<div class="equipment-port-list">';
  for (const group of groups) {
    const roleLabel = group.count > 1
      ? `${group.roleLabel}${group.roleLabel === 'Pass-through' ? '' : 's'}`
      : group.roleLabel;
    html += `<div class="equipment-port-row" style="--equipment-port-color:${escapeHtml(group.color)}">`
      + '<div class="equipment-port-title">'
      + `<span class="equipment-port-dot"></span><strong>${escapeHtml(group.utilityLabel)}</strong>`
      + `<span class="equipment-port-role">${escapeHtml(roleLabel)}${group.count > 1 ? ` ×${group.count}` : ''}</span>`
      + '</div>'
      + `<div class="equipment-port-names">${group.portNames.map(escapeHtml).join(' · ')}</div>`;
    if (group.metrics.length) {
      html += '<div class="equipment-port-metrics">'
        + group.metrics.map(metric => `<span><strong>${escapeHtml(metric.label)}:</strong> ${escapeHtml(metric.value)}</span>`).join('')
        + '</div>';
    }
    html += '</div>';
  }
  return html + '</div></section>';
}
