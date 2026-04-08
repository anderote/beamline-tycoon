// BeamlineWindow.js — Context window for a specific beamline

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { formatEnergy } from '../data/units.js';

// Utility type keys to display in the utilities tab
const UTILITY_TYPES = [
  { key: 'powerCable',   label: 'Power' },
  { key: 'rfWaveguide',  label: 'RF' },
  { key: 'vacuumPipe',   label: 'Vacuum' },
  { key: 'coolingWater', label: 'Cooling' },
  { key: 'cryoTransfer', label: 'Cryo' },
  { key: 'dataFiber',    label: 'Data' },
];

// Component color palette for schematic blocks
const COMP_COLORS = {
  source: '#4af',
  dipole: '#f84',
  quad: '#4f8',
  sext: '#f4a',
  cavity: '#fa4',
  undulator: '#af4',
  wiggler: '#4fa',
  diagnostic: '#aaf',
  collimator: '#faa',
  default: '#888',
};

function _compColor(type) {
  const comp = COMPONENTS[type];
  if (!comp) return COMP_COLORS.default;
  const cat = comp.category || '';
  if (comp.isSource) return COMP_COLORS.source;
  if (cat === 'bending')     return COMP_COLORS.dipole;
  if (cat === 'focusing')    return COMP_COLORS.quad;
  if (cat === 'rf')          return COMP_COLORS.cavity;
  if (cat === 'insertion')   return COMP_COLORS.undulator;
  if (cat === 'diagnostics') return COMP_COLORS.diagnostic;
  if (cat === 'collimators') return COMP_COLORS.collimator;
  return COMP_COLORS[cat] || COMP_COLORS.default;
}

export class BeamlineWindow {
  /**
   * @param {object} game        - Game instance
   * @param {string} beamlineId  - Registry ID (e.g. 'bl-1')
   */
  constructor(game, beamlineId) {
    this.game = game;
    this.beamlineId = beamlineId;

    const entry = game.registry.get(beamlineId);
    if (!entry) {
      console.warn('BeamlineWindow: no entry for', beamlineId);
      return;
    }

    // Return existing window if already open
    const existing = ContextWindow.getWindow('bl-' + beamlineId);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    const ctx = new ContextWindow({
      id: 'bl-' + beamlineId,
      title: entry.name,
      icon: '⚡',
      accentColor: '#2a4a7f',
      tabs: [
        { key: 'overview',    label: 'Overview' },
        { key: 'stats',       label: 'Stats' },
        { key: 'components',  label: 'Components' },
        { key: 'settings',    label: 'Settings' },
        { key: 'finance',     label: 'Finance' },
        { key: 'utilities',   label: 'Utilities' },
      ],
    });
    this.ctx = ctx;

    // Register tab renderers
    ctx.onTabRender('overview',   (el) => this._renderOverview(el));
    ctx.onTabRender('stats',      (el) => this._renderStats(el));
    ctx.onTabRender('components', (el) => this._renderComponents(el));
    ctx.onTabRender('settings',   (el) => this._renderSettings(el));
    ctx.onTabRender('finance',    (el) => this._renderFinance(el));
    ctx.onTabRender('utilities',  (el) => this._renderUtilities(el));

    this._updateStatus();
    this._updateActions();
    ctx.update();
  }

  // ---------------------------------------------------------------------------
  // Status & Actions
  // ---------------------------------------------------------------------------

  _updateStatus() {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry || !this.ctx) return;
    const status = entry.status;
    let color = '#888';
    if (status === 'running') color = '#4d4';
    else if (status === 'faulted') color = '#f44';
    this.ctx.setStatus(status ? status.toUpperCase() : '?', color);
  }

  _updateActions() {
    if (!this.ctx) return;
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) return;

    const isRunning = entry.status === 'running';
    this.ctx.setActions([
      {
        label: isRunning ? 'Stop Beam' : 'Start Beam',
        style: isRunning ? 'color:#f88' : 'color:#8f8',
        onClick: () => {
          this.game.toggleBeam(this.beamlineId);
          this._updateStatus();
          this._updateActions();
          this.ctx.update();
        },
      },
      {
        label: 'Edit',
        onClick: () => {
          if (this.game.editingBeamlineId === this.beamlineId) {
            this.game.editingBeamlineId = null;
          } else {
            this.game.editingBeamlineId = this.beamlineId;
            this.game.selectedBeamlineId = this.beamlineId;
          }
        },
      },
      {
        label: 'Rename',
        onClick: () => {
          const newName = prompt('Enter new name:', entry.name);
          if (newName && newName.trim()) {
            entry.name = newName.trim();
            this.ctx.setTitle(entry.name);
          }
        },
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Tab renderers
  // ---------------------------------------------------------------------------

  _renderOverview(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div style="padding:12px;color:#888">Beamline not found.</div>'; return; }
    const bs = entry.beamState;

    // Schematic preview
    const ordered = entry.beamline.getOrderedComponents();
    let schematic = '<div class="ctx-schematic">';
    if (ordered.length === 0) {
      schematic += '<span style="color:#555;font-size:11px">No components placed</span>';
    } else {
      for (let i = 0; i < ordered.length; i++) {
        const node = ordered[i];
        const comp = COMPONENTS[node.type];
        const color = _compColor(node.type);
        const label = comp ? (comp.abbr || comp.name.slice(0, 3)) : '?';
        schematic += `<span class="ctx-schem-node" style="background:${color}22;border-color:${color};color:${color}" title="${comp ? comp.name : node.type}">${label}</span>`;
        if (i < ordered.length - 1) {
          schematic += '<span class="ctx-schem-arrow">→</span>';
        }
      }
    }
    schematic += '</div>';

    // Quick stats grid
    const e = bs.beamEnergy ? formatEnergy(bs.beamEnergy) : { val: '0.0', unit: 'MeV' };
    const uptime = bs.uptimeFraction != null ? (bs.uptimeFraction * 100).toFixed(1) + '%' : '--';
    const machineType = bs.machineType || '--';

    const grid = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Energy</div><div class="ctx-stat-val">${e.val} ${e.unit}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Current</div><div class="ctx-stat-val">${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Quality</div><div class="ctx-stat-val">${bs.beamQuality ? bs.beamQuality.toFixed(2) : '--'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Data/s</div><div class="ctx-stat-val">${bs.dataRate ? bs.dataRate.toFixed(1) : '0'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Uptime</div><div class="ctx-stat-val">${uptime}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Type</div><div class="ctx-stat-val">${machineType}</div></div>
      </div>
    `;

    el.innerHTML = `<div class="ctx-preview">${schematic}${grid}</div>`;
  }

  _renderStats(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div style="padding:12px;color:#888">Beamline not found.</div>'; return; }
    const bs = entry.beamState;

    const e = bs.beamEnergy ? formatEnergy(bs.beamEnergy) : { val: '0.0', unit: 'MeV' };
    const uptime = bs.uptimeFraction != null ? (bs.uptimeFraction * 100).toFixed(1) + '%' : '--';
    const lossFraction = bs.totalLossFraction != null ? (bs.totalLossFraction * 100).toFixed(2) + '%' : '--';
    const discoveryCh = bs.discoveryChance != null ? (bs.discoveryChance * 100).toFixed(1) + '%' : '--';

    const row = (label, val) =>
      `<div class="ctx-stat" style="grid-column:span 2"><div class="ctx-stat-label">${label}</div><div class="ctx-stat-val">${val}</div></div>`;

    el.innerHTML = `
      <div class="ctx-stats-grid" style="grid-template-columns:1fr 1fr">
        ${row('Beam Energy', `${e.val} ${e.unit}`)}
        ${row('Beam Current', `${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA`)}
        ${row('Beam Quality', bs.beamQuality ? bs.beamQuality.toFixed(3) : '--')}
        ${row('Data Rate', `${bs.dataRate ? bs.dataRate.toFixed(2) : '0'} /s`)}
        ${row('Total Data', bs.totalDataCollected ? Math.floor(bs.totalDataCollected).toLocaleString() : '0')}
        ${row('Uptime', uptime)}
        ${row('Beam Hours', bs.totalBeamHours ? bs.totalBeamHours.toFixed(1) : '0')}
        ${row('Photon Rate', bs.photonRate ? bs.photonRate.toExponential(2) : '0')}
        ${row('Discovery %', discoveryCh)}
        ${row('Loss Fraction', lossFraction)}
      </div>
    `;
  }

  _renderComponents(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div style="padding:12px;color:#888">Beamline not found.</div>'; return; }

    const ordered = entry.beamline.getOrderedComponents();
    if (ordered.length === 0) {
      el.innerHTML = '<div style="padding:12px;color:#555;font-size:12px">No components placed.</div>';
      return;
    }

    const compHealth = (entry.beamState.componentHealth) || {};

    let html = '<div style="padding:6px;overflow-y:auto;max-height:300px">';
    for (const node of ordered) {
      const comp = COMPONENTS[node.type];
      const name = comp ? comp.name : node.type;
      const health = compHealth[node.id] != null ? compHealth[node.id] : 100;
      const healthColor = health > 60 ? '#4d4' : health > 25 ? '#da4' : '#f44';
      const healthPct = Math.max(0, Math.min(100, health));
      html += `
        <div style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#ccc;margin-bottom:2px">
            <span>${name}</span>
            <span style="color:${healthColor}">${healthPct.toFixed(0)}%</span>
          </div>
          <div style="background:#1a1a2a;border-radius:2px;height:5px">
            <div style="background:${healthColor};width:${healthPct}%;height:100%;border-radius:2px;transition:width 0.3s"></div>
          </div>
        </div>
      `;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  _renderSettings(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div style="padding:12px;color:#888">Beamline not found.</div>'; return; }
    const bs = entry.beamState;
    const nodeCount = entry.beamline.getAllNodes().length;

    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Machine Type</div><div class="ctx-stat-val">${bs.machineType || '--'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Status</div><div class="ctx-stat-val">${entry.status ? entry.status.toUpperCase() : '--'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Components</div><div class="ctx-stat-val">${nodeCount}</div></div>
      </div>
    `;
  }

  _renderFinance(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div style="padding:12px;color:#888">Beamline not found.</div>'; return; }
    const bs = entry.beamState;

    // Compute build cost from components
    const nodes = entry.beamline.getAllNodes();
    const buildCost = nodes.reduce((sum, n) => {
      const comp = COMPONENTS[n.type];
      return sum + (comp ? (comp.cost || 0) : 0);
    }, 0);

    const energyDraw = bs.totalEnergyCost || 0;
    const dataRateTick = bs.dataRate || 0;

    // Estimate user fees per tick (data rate * some rate — placeholder)
    const feePerTick = dataRateTick * 0.1;

    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Build Cost</div><div class="ctx-stat-val">$${buildCost.toLocaleString()}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Energy Draw</div><div class="ctx-stat-val">${energyDraw.toFixed(0)} kW</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">User Fees/tick</div><div class="ctx-stat-val">$${feePerTick.toFixed(2)}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Data Rate/tick</div><div class="ctx-stat-val">${dataRateTick.toFixed(2)}</div></div>
      </div>
    `;
  }

  _renderUtilities(el) {
    const nd = this.game.state.networkData;
    if (!nd) {
      el.innerHTML = '<div style="padding:12px;color:#555;font-size:12px">Network data not available.</div>';
      return;
    }

    // For each utility type, check if any network's beamlineNodes includes a node on this beamline
    const entry = this.game.registry.get(this.beamlineId);
    const myNodeIds = entry
      ? new Set(entry.beamline.getAllNodes().map(n => n.id))
      : new Set();

    let html = '<div style="padding:8px">';
    for (const { key, label } of UTILITY_TYPES) {
      const networks = nd[key] || [];
      let connected = false;
      for (const net of networks) {
        if (net.beamlineNodes && net.beamlineNodes.some(n => myNodeIds.has(n.id))) {
          connected = true;
          break;
        }
      }
      const color = connected ? '#4d4' : '#555';
      const icon = connected ? '●' : '○';
      const text = connected ? 'Connected' : 'Not connected';
      html += `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid #1a1a2a">
          <span style="color:${color};font-size:14px">${icon}</span>
          <span style="color:#aaa;width:70px">${label}</span>
          <span style="color:${color}">${text}</span>
        </div>
      `;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Refresh (called each tick)
  // ---------------------------------------------------------------------------

  refresh() {
    if (!this.ctx || !this.ctx._el) return;
    this._updateStatus();
    this._updateActions();
    this.ctx.update();
  }
}
