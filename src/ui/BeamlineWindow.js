// BeamlineWindow.js — Context window for a specific beamline

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { formatEnergy } from '../data/units.js';
import { CANONICAL_ACCENTS } from '../beamline/accent-colors.js';
import { flattenPath } from '../beamline/flattener.js';

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
  if (cat === 'optics')      return COMP_COLORS.quad;
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
        label: 'Designer',
        onClick: () => {
          this.game._openDesignerForBeamline(this.beamlineId);
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
      {
        label: 'Demolish (50% refund)',
        style: 'color:#f88',
        onClick: () => {
          this.game.demolishTarget({ kind: 'beamlineWhole', beamlineId: this.beamlineId });
          this.ctx.close();
        },
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Tab renderers
  // ---------------------------------------------------------------------------

  _renderOverview(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div class="ctx-empty">Beamline not found.</div>'; return; }
    const bs = entry.beamState;

    // Schematic preview via flattenPath
    const ordered = entry.sourceId
      ? flattenPath(this.game.state, entry.sourceId).filter(e => e.kind !== 'drift')
      : [];
    let schematic = '<div class="ctx-schematic">';
    if (ordered.length === 0) {
      schematic += '<span style="color:#556">No components placed</span>';
    } else {
      for (let i = 0; i < ordered.length; i++) {
        const node = ordered[i];
        const comp = COMPONENTS[node.type];
        const color = _compColor(node.type);
        const label = comp ? (comp.abbr || comp.name.slice(0, 3)) : '?';
        schematic += `<span class="ctx-schem-node" style="background:${color}15;border-color:${color}88;color:${color}" title="${comp ? comp.name : node.type}">${label}</span>`;
        if (i < ordered.length - 1) {
          schematic += '<span class="ctx-schem-arrow">→</span>';
        }
      }
    }
    schematic += '</div>';

    // Quick stats
    const e = bs.beamEnergy ? formatEnergy(bs.beamEnergy) : { val: '0.0', unit: 'MeV' };
    const uptime = bs.uptimeFraction != null ? (bs.uptimeFraction * 100).toFixed(1) + '%' : '--';
    const machineType = bs.machineType || '--';
    const quality = bs.beamQuality ? bs.beamQuality.toFixed(2) : '--';
    const qualityClass = bs.beamQuality > 0.7 ? '' : bs.beamQuality > 0.4 ? ' warn' : ' bad';

    el.innerHTML = `
      <div class="ctx-preview">${schematic}</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Energy</div><div class="ctx-stat-val">${e.val} ${e.unit}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Current</div><div class="ctx-stat-val">${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Quality</div><div class="ctx-stat-val${qualityClass}">${quality}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Data Rate</div><div class="ctx-stat-val">${bs.dataRate ? bs.dataRate.toFixed(1) : '0'} /s</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Uptime</div><div class="ctx-stat-val">${uptime}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Type</div><div class="ctx-stat-val neutral">${machineType}</div></div>
      </div>
      <div class="ctx-section-label">Components: ${ordered.length}</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Photon Rate</div><div class="ctx-stat-val">${bs.photonRate ? bs.photonRate.toExponential(1) : '0'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Discovery</div><div class="ctx-stat-val">${bs.discoveryChance ? (bs.discoveryChance * 100).toFixed(1) + '%' : '--'}</div></div>
      </div>
    `;
  }

  _renderStats(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div class="ctx-empty">Beamline not found.</div>'; return; }
    const bs = entry.beamState;

    const e = bs.beamEnergy ? formatEnergy(bs.beamEnergy) : { val: '0.0', unit: 'MeV' };
    const uptime = bs.uptimeFraction != null ? (bs.uptimeFraction * 100).toFixed(1) + '%' : '--';
    const lossFraction = bs.totalLossFraction != null ? (bs.totalLossFraction * 100).toFixed(2) + '%' : '--';
    const lossClass = bs.totalLossFraction > 0.1 ? ' bad' : bs.totalLossFraction > 0.03 ? ' warn' : '';
    const discoveryCh = bs.discoveryChance != null ? (bs.discoveryChance * 100).toFixed(1) + '%' : '--';

    el.innerHTML = `
      <div class="ctx-section-label">Beam Parameters</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Energy</div><div class="ctx-stat-val">${e.val} ${e.unit}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Current</div><div class="ctx-stat-val">${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Quality</div><div class="ctx-stat-val">${bs.beamQuality ? bs.beamQuality.toFixed(3) : '--'}</div></div>
      </div>
      <div class="ctx-section-label">Output</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Data Rate</div><div class="ctx-stat-val">${bs.dataRate ? bs.dataRate.toFixed(2) : '0'} /s</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Total Data</div><div class="ctx-stat-val">${bs.totalDataCollected ? Math.floor(bs.totalDataCollected).toLocaleString() : '0'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Photon Rate</div><div class="ctx-stat-val">${bs.photonRate ? bs.photonRate.toExponential(2) : '0'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Discovery</div><div class="ctx-stat-val">${discoveryCh}</div></div>
      </div>
      <div class="ctx-section-label">Performance</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Uptime</div><div class="ctx-stat-val">${uptime}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Beam Hours</div><div class="ctx-stat-val">${bs.totalBeamHours ? bs.totalBeamHours.toFixed(1) : '0'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Losses</div><div class="ctx-stat-val${lossClass}">${lossFraction}</div></div>
      </div>
    `;
  }

  _renderComponents(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div class="ctx-empty">Beamline not found.</div>'; return; }

    const ordered = entry.sourceId
      ? flattenPath(this.game.state, entry.sourceId).filter(e => e.kind !== 'drift')
      : [];
    if (ordered.length === 0) {
      el.innerHTML = '<div class="ctx-empty">No components placed.</div>';
      return;
    }

    const compHealth = (entry.beamState.componentHealth) || {};

    let html = '<div style="overflow-y:auto">';
    for (const node of ordered) {
      const comp = COMPONENTS[node.type];
      const name = comp ? comp.name : node.type;
      const color = _compColor(node.type);
      const health = compHealth[node.id] != null ? compHealth[node.id] : 100;
      const healthColor = health > 60 ? '#44dd66' : health > 25 ? '#ddaa22' : '#ff4444';
      const healthPct = Math.max(0, Math.min(100, health));
      html += `
        <div class="ctx-comp-row">
          <span style="color:${color};font-size:10px;width:12px;text-align:center">●</span>
          <span style="color:#aaaacc;font-size:8px;flex:1">${name}</span>
          <div class="ctx-comp-health-bar" style="max-width:120px">
            <div class="ctx-comp-health-fill" style="background:${healthColor};width:${healthPct}%"></div>
          </div>
          <span style="color:${healthColor};font-size:8px;width:32px;text-align:right">${healthPct.toFixed(0)}%</span>
        </div>
      `;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  _renderSettings(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div class="ctx-empty">Beamline not found.</div>'; return; }
    const bs = entry.beamState;
    const blPlaceables = this.game.state.placeables.filter(p => p.beamlineId === this.beamlineId);
    const nodeCount = blPlaceables.length;
    const statusColor = entry.status === 'running' ? '#44dd66'
      : entry.status === 'faulted' ? '#ff4444'
      : '#8888aa';

    const swatchHtml = CANONICAL_ACCENTS.map((sw, i) => {
      const hexStr = '#' + sw.hex.toString(16).padStart(6, '0');
      const selected = entry.accentColor === sw.hex ? ' selected' : '';
      return `<button class="beamline-accent-swatch${selected}" data-hex="${sw.hex}" title="${sw.name}" style="background:${hexStr}"></button>`;
    }).join('');

    const currentHex = '#' + (entry.accentColor || 0xc62828).toString(16).padStart(6, '0');

    el.innerHTML = `
      <div class="ctx-section-label">Configuration</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Machine Type</div><div class="ctx-stat-val neutral">${bs.machineType || '--'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Status</div><div class="ctx-stat-val" style="color:${statusColor}">${entry.status ? entry.status.toUpperCase() : '--'}</div></div>
      </div>
      <div class="ctx-section-label">Accent Color</div>
      <div class="beamline-accent-row">
        ${swatchHtml}
        <label class="beamline-accent-custom" title="Custom color">
          <input type="color" value="${currentHex}" data-role="accent-custom">
          <span>+</span>
        </label>
      </div>
      <div class="ctx-section-label">Layout</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Components</div><div class="ctx-stat-val neutral">${nodeCount}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Sources</div><div class="ctx-stat-val neutral">${blPlaceables.filter(n => COMPONENTS[n.type]?.isSource).length}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Tiles</div><div class="ctx-stat-val neutral">${blPlaceables.reduce((s, n) => s + (n.cells ? n.cells.length : 0), 0)}</div></div>
      </div>
    `;

    // Wire up swatch clicks and custom picker.
    // rerender: true for swatch clicks (to move the selected outline);
    // false for live color-picker drags (so we don't destroy the input
    // mid-drag — the native picker keeps firing events into a detached DOM).
    const applyAccent = (hex, rerender) => {
      entry.accentColor = hex;
      if (this.game.renderer && typeof this.game.renderer.updateBeamlineAccent === 'function') {
        this.game.renderer.updateBeamlineAccent(this.beamlineId, hex);
      }
      if (rerender) this._renderSettings(el);
    };

    el.querySelectorAll('.beamline-accent-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const hex = parseInt(btn.dataset.hex, 10);
        if (!Number.isNaN(hex)) applyAccent(hex, true);
      });
    });

    const customInput = el.querySelector('input[data-role="accent-custom"]');
    if (customInput) {
      customInput.addEventListener('input', (e) => {
        const hex = parseInt(e.target.value.slice(1), 16);
        if (!Number.isNaN(hex)) applyAccent(hex, false);
      });
      // Re-render once the picker closes so the "selected" outline clears.
      customInput.addEventListener('change', (e) => {
        const hex = parseInt(e.target.value.slice(1), 16);
        if (!Number.isNaN(hex)) applyAccent(hex, true);
      });
    }
  }

  _renderFinance(el) {
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { el.innerHTML = '<div class="ctx-empty">Beamline not found.</div>'; return; }
    const bs = entry.beamState;

    const nodes = this.game.state.placeables.filter(p => p.beamlineId === this.beamlineId);
    const buildCost = nodes.reduce((sum, n) => {
      const comp = COMPONENTS[n.type];
      return sum + (comp ? (comp.cost || 0) : 0);
    }, 0);

    const energyDraw = bs.totalEnergyCost || 0;
    const dataRateTick = bs.dataRate || 0;
    const feePerTick = dataRateTick * 0.1;

    el.innerHTML = `
      <div class="ctx-section-label">Capital</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Build Cost</div><div class="ctx-stat-val">$${buildCost.toLocaleString()}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Components</div><div class="ctx-stat-val neutral">${nodes.length}</div></div>
      </div>
      <div class="ctx-section-label">Operating</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Energy</div><div class="ctx-stat-val warn">${energyDraw.toFixed(0)} kW</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">User Fees</div><div class="ctx-stat-val">$${feePerTick.toFixed(2)}/t</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Data Out</div><div class="ctx-stat-val">${dataRateTick.toFixed(2)}/t</div></div>
      </div>
    `;
  }

  _renderUtilities(el) {
    // Phase 6: connectivity is inferred from state.nodeQualities, which the
    // tick loop populates from perSinkQuality. A beamline node is "connected"
    // for a utility type iff any node in this beamline has that utility's
    // quality field set (non-undefined) in nodeQualities.
    const UTILITY_TO_QUALITY_FIELD = {
      powerCable:   'powerQuality',
      rfWaveguide:  'rfQuality',
      coolingWater: 'coolingQuality',
      cryoTransfer: 'cryoQuality',
      vacuumPipe:   'vacuumQuality',
      dataFiber:    'dataQuality',
    };
    const nodeQualities = this.game.state.nodeQualities || {};
    const entry = this.game.registry.get(this.beamlineId);
    const myNodeIds = entry
      ? new Set(this.game.state.placeables.filter(p => p.beamlineId === entry.id).map(p => p.id))
      : new Set();

    let connectedCount = 0;
    let html = '<div class="ctx-section-label">Utility Connections</div>';
    for (const { key, label } of UTILITY_TYPES) {
      const qualityField = UTILITY_TO_QUALITY_FIELD[key];
      let connected = false;
      if (qualityField) {
        for (const nodeId of myNodeIds) {
          const nq = nodeQualities[nodeId];
          if (nq && nq[qualityField] !== undefined) { connected = true; break; }
        }
      }
      if (connected) connectedCount++;
      const color = connected ? '#44dd66' : '#556';
      const icon = connected ? '●' : '○';
      const text = connected ? 'Connected' : 'Not connected';
      html += `
        <div class="ctx-utility-row">
          <span class="ctx-utility-dot" style="color:${color}">${icon}</span>
          <span class="ctx-utility-label">${label}</span>
          <span class="ctx-utility-status" style="color:${color}">${text}</span>
        </div>
      `;
    }
    html += `
      <div style="margin-top:12px">
        <div class="ctx-stats-grid">
          <div class="ctx-stat"><div class="ctx-stat-label">Connected</div><div class="ctx-stat-val">${connectedCount} / ${UTILITY_TYPES.length}</div></div>
          <div class="ctx-stat"><div class="ctx-stat-label">Coverage</div><div class="ctx-stat-val">${(connectedCount / UTILITY_TYPES.length * 100).toFixed(0)}%</div></div>
        </div>
      </div>
    `;
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
