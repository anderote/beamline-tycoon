// NetworkWindow.js — Context window for a network cluster

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { Networks } from '../networks/networks.js';

// Accent colors per network type (CSS hex strings)
const ACCENT_COLORS = {
  powerCable:   '#2a6630',
  coolingWater: '#2a4a7f',
  cryoTransfer: '#2a6a7f',
  rfWaveguide:  '#7f2a2a',
  vacuumPipe:   '#4a4a4a',
  dataFiber:    '#6a6a6a',
};

// Icons per network type
const ICONS = {
  powerCable:   '\u26A1',
  coolingWater: '\uD83D\uDCA7',
  cryoTransfer: '\u2744\uFE0F',
  rfWaveguide:  '\uD83D\uDCE1',
  vacuumPipe:   '\uD83C\uDF00',
  dataFiber:    '\uD83D\uDD17',
};

function hexColor(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

function pctBar(ratio, width) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  let color;
  if (pct >= 90) color = '#44dd66';
  else if (pct >= 60) color = '#ddaa22';
  else color = '#ff4444';
  return `<div style="display:flex;align-items:center;gap:6px">
    <div style="flex:1;max-width:${width || 140}px;height:8px;background:#222;border-radius:4px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div>
    </div>
    <span style="color:${color};font-size:11px;min-width:36px;text-align:right">${pct.toFixed(0)}%</span>
  </div>`;
}

export class NetworkWindow {
  constructor(game, networkType, clusterIndex) {
    this.game = game;
    this.networkType = networkType;
    this.clusterIndex = clusterIndex;

    const winId = 'net-' + networkType + '-' + clusterIndex;

    // Return existing window if already open
    const existing = ContextWindow.getWindow(winId);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    const connDef = CONNECTION_TYPES[networkType] || {};
    const accent = ACCENT_COLORS[networkType] || '#333';
    const icon = ICONS[networkType] || '';

    const ctx = new ContextWindow({
      id: winId,
      title: connDef.name || networkType,
      icon: icon,
      accentColor: accent,
      tabs: [
        { key: 'overview',  label: 'Overview' },
        { key: 'equipment', label: 'Equipment' },
      ],
      onClose: () => this._cleanup(),
    });
    this.ctx = ctx;

    ctx.onTabRender('overview',  (el) => this._renderOverview(el));
    ctx.onTabRender('equipment', (el) => this._renderEquipment(el));

    // Auto-refresh on tick
    this._tickHandler = () => {
      if (this.ctx && this.ctx._el) {
        this.ctx.update();
      }
    };
    this.game.on('tick', this._tickHandler);

    ctx.update();
  }

  _cleanup() {
    if (this._tickHandler) {
      this.game.off('tick', this._tickHandler);
      this._tickHandler = null;
    }
  }

  _getCluster() {
    const allNetworks = this.game.state.networkData || {};
    const clusters = allNetworks[this.networkType] || [];
    return clusters[this.clusterIndex] || null;
  }

  _validate(cluster) {
    if (!cluster) return {};
    switch (this.networkType) {
      case 'powerCable':   return Networks.validatePowerNetwork(cluster);
      case 'coolingWater':  return Networks.validateCoolingNetwork(cluster);
      case 'cryoTransfer':  return Networks.validateCryoNetwork(cluster);
      case 'rfWaveguide':   return Networks.validateRfNetwork(cluster);
      case 'vacuumPipe':    return Networks.validateVacuumNetwork(cluster, this.game.state.beamline || []);
      default: return {};
    }
  }

  _renderOverview(el) {
    const cluster = this._getCluster();
    if (!cluster) {
      el.innerHTML = '<div style="color:#888;padding:8px;font-size:11px">Network cluster not found.</div>';
      return;
    }

    const connDef = CONNECTION_TYPES[this.networkType] || {};
    const color = connDef.color != null ? hexColor(connDef.color) : '#aaa';
    const stats = this._validate(cluster);

    // Base ratio
    const baseRatio = stats.quality != null ? stats.quality : 0;

    // Lab bonuses for this cluster
    const labBonuses = this.game.state.labBonuses || {};
    const bonusesForType = labBonuses[this.networkType] || [];
    const clusterBonuses = bonusesForType.filter(b => b.clusterIndex === this.clusterIndex);
    let totalLabBonus = 0;
    for (const b of clusterBonuses) {
      totalLabBonus += b.bonus || 0;
    }

    // Effective quality
    const effectiveQuality = Math.min(1.0, baseRatio + totalLabBonus);

    // Capacity / demand display varies by type
    let capacityHtml = '';
    if (this.networkType === 'powerCable') {
      capacityHtml = `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:2px">
          <span>Capacity: ${stats.capacity || 0} kW</span>
          <span>Draw: ${stats.draw || 0} kW</span>
        </div>`;
    } else if (this.networkType === 'coolingWater' || this.networkType === 'cryoTransfer') {
      capacityHtml = `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:2px">
          <span>Capacity: ${stats.capacity || 0} W</span>
          <span>Heat Load: ${(stats.heatLoad || 0).toFixed(1)} W</span>
        </div>`;
    } else if (this.networkType === 'rfWaveguide') {
      capacityHtml = `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:2px">
          <span>Forward: ${(stats.forwardPower || 0).toFixed(0)} kW</span>
          <span>Demand: ${(stats.totalDemand || 0).toFixed(0)} kW</span>
        </div>`;
    } else if (this.networkType === 'vacuumPipe') {
      const pressure = stats.avgPressure != null && isFinite(stats.avgPressure)
        ? stats.avgPressure.toExponential(1) + ' mbar'
        : '--';
      capacityHtml = `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:2px">
          <span>Pressure: ${pressure}</span>
          <span>Quality: ${stats.pressureQuality || '--'}</span>
        </div>`;
    }

    // Lab bonus rows
    let labBonusHtml = '';
    if (clusterBonuses.length > 0) {
      labBonusHtml = '<div style="margin-top:6px">';
      for (const b of clusterBonuses) {
        labBonusHtml += `<div style="font-size:11px;color:#8c8;padding:1px 0">
          + ${(b.bonus * 100).toFixed(0)}% from ${b.zoneType} lab</div>`;
      }
      labBonusHtml += '</div>';
    }

    // Status indicator
    const statusOk = stats.ok;
    const statusColor = statusOk ? '#44dd66' : '#ff4444';
    const statusText = statusOk ? 'OK' : 'INSUFFICIENT';

    // Effect summary
    let effectSummary = '';
    if (this.networkType === 'powerCable') {
      effectSummary = effectiveQuality >= 1.0
        ? 'Full power delivery to all consumers.'
        : 'Reduced power may cause component underperformance.';
    } else if (this.networkType === 'coolingWater') {
      effectSummary = effectiveQuality >= 1.0
        ? 'Adequate cooling for all heat loads.'
        : 'Insufficient cooling may cause thermal derating.';
    } else if (this.networkType === 'cryoTransfer') {
      effectSummary = stats.quenched
        ? 'Cryo failure risk - SRF components may quench!'
        : effectiveQuality >= 1.0
          ? 'Cryogenic systems operating normally.'
          : 'Reduced cryo capacity may affect SRF performance.';
    } else if (this.networkType === 'rfWaveguide') {
      effectSummary = stats.missingModulator
        ? 'Missing modulator for pulsed klystron!'
        : effectiveQuality >= 1.0
          ? 'RF power meets cavity demand.'
          : 'Insufficient RF power reduces accelerating gradient.';
    } else if (this.networkType === 'vacuumPipe') {
      effectSummary = effectiveQuality >= 0.85
        ? 'Vacuum quality supports beam operations.'
        : 'Poor vacuum increases beam losses.';
    }

    el.innerHTML = `
      <div style="padding:2px 0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="color:${color};font-size:13px;font-weight:600">${connDef.name || this.networkType}</span>
          <span style="color:${statusColor};font-size:10px;font-weight:600">${statusText}</span>
        </div>
        ${capacityHtml}
        ${pctBar(baseRatio, 160)}
        <div style="font-size:10px;color:#999;margin-top:4px">
          Base ratio: ${(baseRatio * 100).toFixed(1)}%
        </div>
        ${labBonusHtml}
        <div style="margin-top:8px;padding:6px 8px;background:#181828;border-radius:4px">
          <div style="font-size:11px;color:#ccc;margin-bottom:2px">Effective Quality</div>
          ${pctBar(effectiveQuality, 160)}
          <div style="font-size:10px;color:#999;margin-top:2px">${(effectiveQuality * 100).toFixed(1)}%</div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#aaa;font-style:italic">${effectSummary}</div>
        <div style="margin-top:6px;font-size:10px;color:#666">
          Tiles: ${cluster.tiles.length} | Equipment: ${cluster.equipment.length} | Components: ${cluster.beamlineNodes.length}
        </div>
      </div>
    `;
  }

  _renderEquipment(el) {
    const cluster = this._getCluster();
    if (!cluster) {
      el.innerHTML = '<div style="color:#888;padding:8px;font-size:11px">Network cluster not found.</div>';
      return;
    }

    let html = '';

    // Facility equipment
    html += '<div style="font-size:11px;color:#999;font-weight:600;margin-bottom:4px">Facility Equipment</div>';
    if (cluster.equipment.length === 0) {
      html += '<div style="font-size:11px;color:#556;padding:2px 0">None</div>';
    } else {
      for (const eq of cluster.equipment) {
        const comp = COMPONENTS[eq.type];
        const name = comp ? comp.name : eq.type;
        html += `<div style="font-size:11px;color:#aaa;padding:2px 0;display:flex;align-items:center;gap:4px">
          <span style="color:#666">-</span> ${name}
          <span style="color:#556;font-size:9px">(${eq.col},${eq.row})</span>
        </div>`;
      }
    }

    // Beamline components
    html += '<div style="font-size:11px;color:#999;font-weight:600;margin-top:10px;margin-bottom:4px">Beamline Components</div>';
    if (cluster.beamlineNodes.length === 0) {
      html += '<div style="font-size:11px;color:#556;padding:2px 0">None</div>';
    } else {
      for (const node of cluster.beamlineNodes) {
        const comp = COMPONENTS[node.type];
        const name = comp ? comp.name : node.type;
        html += `<div style="font-size:11px;color:#aaa;padding:2px 0;display:flex;align-items:center;gap:4px">
          <span style="color:#666">-</span> ${name}
          <span style="color:#556;font-size:9px">${node.id}</span>
        </div>`;
      }
    }

    el.innerHTML = html;
  }
}
