// BeamlineWindow.js — Context window for a specific beamline

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { formatEnergy } from '../data/units.js';
import { CANONICAL_ACCENTS } from '../beamline/accent-colors.js';
import { flattenPath } from '../beamline/flattener.js';
import { hardwareNodes } from '../game/aggregates.js';
import { dataFeeIncome } from '../game/economy.js';
import { endpointsById } from '../utility/endpoint-lookup.js';
// Imported, not re-declared: this map IS the utility-type -> quality-field
// contract, and a hand-copied local one drifts from the table the gate wrote.
import { UTILITY_TO_QUALITY_FIELD } from '../game/utility-gate.js';
import { getCavitySpec } from '../beamline/cavity-specs.js';
import { beamlineRfOperatingInfo } from './hover-info.js';

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
          // Same gesture as the Space-key toggle (InputHandler), so it takes
          // the same undo entry — otherwise undo would silently revert a beam
          // started here without ever having recorded the start.
          this.game._withUndo(() => this.game.toggleBeam(this.beamlineId));
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
        variant: 'danger',
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
      ? hardwareNodes(flattenPath(this.game.state, entry.sourceId))
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
    const rf = beamlineRfOperatingInfo(ordered, COMPONENTS);
    const quality = bs.beamQuality ? bs.beamQuality.toFixed(2) : '--';
    const qualityClass = bs.beamQuality > 0.7 ? '' : bs.beamQuality > 0.4 ? ' warn' : ' bad';

    el.innerHTML = `
      <div class="ctx-preview">${schematic}</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Energy</div><div class="ctx-stat-val">${e.val} ${e.unit}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Current</div><div class="ctx-stat-val">${bs.beamCurrent ? bs.beamCurrent.toFixed(2) : '--'} mA</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Quality</div><div class="ctx-stat-val${qualityClass}">${quality}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">RF Band</div><div class="ctx-stat-val neutral">${rf ? rf.display : '--'}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Uptime</div><div class="ctx-stat-val">${uptime}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Type</div><div class="ctx-stat-val neutral">${machineType}</div></div>
      </div>
      <div class="ctx-section-label">Components: ${ordered.length}</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Data Rate</div><div class="ctx-stat-val">${bs.dataRate ? bs.dataRate.toFixed(1) : '0'} /s</div></div>
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
      ? hardwareNodes(flattenPath(this.game.state, entry.sourceId))
      : [];
    if (ordered.length === 0) {
      el.innerHTML = '<div class="ctx-empty">No components placed.</div>';
      return;
    }

    const compHealth = (entry.beamState.componentHealth) || {};
    const byId = endpointsById(this.game.state);

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
      html += this._cavityRow(byId.get(node.id));
    }
    html += '</div>';
    el.innerHTML = html;
  }

  /**
   * Gradient sub-row for a cavity: what the operator asked for, what the
   * hardware actually delivered, and which resource is binding.
   *
   * The `gradient` slider is a DEMAND, not a setting — achievable gradient
   * comes from the RF power and cryogenic temperature the cavity is
   * provisioned with (beam_physics/srf.py). Without this readout a player
   * whose cavity is capped has no way to see it, let alone see whether the
   * fix is more RF or more cold.
   */
  _cavityRow(inst) {
    if (!inst || typeof inst.gradientAchieved !== 'number') return '';
    if (!getCavitySpec(inst.type)) return '';

    if (inst.quenched) {
      return `<div class="ctx-comp-row" style="padding-left:24px">
        <span style="color:#ff4444;font-size:8px;flex:1">QUENCHED — not accelerating</span>
      </div>`;
    }

    const demanded = inst.gradientDemanded || 0;
    const achieved = inst.gradientAchieved || 0;
    const achievable = inst.gradientAchievable || 0;
    const atDemand = demanded > 0 && achieved >= demanded - 1e-6;

    // What is holding it back. Cryo only binds on superconducting cavities;
    // for normal-conducting ones a shortfall is always RF (or detuning, which
    // shows up as reflected power).
    let limit = 'at demand', limitColor = '#44dd66';
    if (!atDemand) {
      const spec = getCavitySpec(inst.type);
      const warm = typeof inst.cavityQ0 === 'number' && spec.kind === 'srf'
        && inst.cavityQ0 < 1e9;
      if (warm) { limit = 'cryo-limited'; limitColor = '#ff8844'; }
      else if ((inst.reflectedFraction || 0) > 0.1) {
        limit = 'detuned'; limitColor = '#ff8844';
      } else { limit = 'RF-limited'; limitColor = '#ddaa22'; }
    }

    const pct = demanded > 0
      ? Math.max(0, Math.min(100, (achieved / demanded) * 100)) : 0;

    return `<div class="ctx-comp-row" style="padding-left:24px">
      <span style="color:#8888aa;font-size:8px;flex:1">
        ${achieved.toFixed(1)} / ${demanded.toFixed(1)} MV/m
        ${achievable > 0 && !atDemand ? `<span style="color:#666">(max ${achievable.toFixed(1)})</span>` : ''}
      </span>
      <div class="ctx-comp-health-bar" style="max-width:120px">
        <div class="ctx-comp-health-fill" style="background:${limitColor};width:${pct}%"></div>
      </div>
      <span style="color:${limitColor};font-size:8px;width:64px;text-align:right">${limit}</span>
    </div>`;
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
    // effectiveDataRate, not dataRate: the tick derates by data-fiber
    // connectivity and credits/bills that value, so a cut fiber must read as
    // zero science and zero fees here rather than as income nobody is paid.
    const dataRateTick = bs.effectiveDataRate ?? 0;
    const feePerTick = dataFeeIncome(dataRateTick);
    const serviceRevenue = bs.serviceRevenue || 0;
    const contract = bs.serviceContract || 'No endpoint contract';
    const rawStored = bs.rawDataStored || 0;

    el.innerHTML = `
      <div class="ctx-section-label">Capital</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><div class="ctx-stat-label">Build Cost</div><div class="ctx-stat-val">$${buildCost.toLocaleString()}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Components</div><div class="ctx-stat-val neutral">${nodes.length}</div></div>
      </div>
      <div class="ctx-section-label">Operating</div>
      <div class="ctx-stats-grid three-col">
        <div class="ctx-stat"><div class="ctx-stat-label">Energy</div><div class="ctx-stat-val warn">${energyDraw.toFixed(0)} kW</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Endpoint Revenue</div><div class="ctx-stat-val">$${serviceRevenue.toFixed(2)}/t</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Contract</div><div class="ctx-stat-val neutral">${contract}</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Data Fees</div><div class="ctx-stat-val">$${feePerTick.toFixed(2)}/t</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Data Out</div><div class="ctx-stat-val">${dataRateTick.toFixed(2)}/t</div></div>
        <div class="ctx-stat"><div class="ctx-stat-label">Raw Stored</div><div class="ctx-stat-val">${rawStored.toFixed(1)}</div></div>
      </div>
    `;
  }

  /**
   * Per-utility wiring status for this beamline.
   *
   * Two independent facts decide the row, and conflating them was a bug: a
   * component's presence in `nodeQualities` says it DECLARES a sink for that
   * utility (the gate floors every declared sink to 0 so an unwired one can
   * never read as the 1.0 that an absent field means), while
   * `state.unwiredSinks` says whether a line actually reaches it. Reading
   * definedness alone made every declared sink report "Connected" — an
   * isolated electron gun with nothing plugged in claimed power, vacuum and
   * cooling while the HUD next to it counted 3 unwired sinks.
   *
   * Returns one of: 'unused' (declares no such sink), 'unwired', 'partial'
   * (some nodes wired, some not), 'connected'.
   */
  _utilityStatus(utilityKey, nodeIds) {
    const qualityField = UTILITY_TO_QUALITY_FIELD[utilityKey];
    if (!qualityField) return 'unused';
    const nodeQualities = this.game.state.nodeQualities || {};
    const unwiredSinks = this.game.state.unwiredSinks || {};
    let declared = 0;
    let unwired = 0;
    for (const nodeId of nodeIds) {
      const nq = nodeQualities[nodeId];
      if (!nq || nq[qualityField] === undefined) continue;
      declared++;
      if (unwiredSinks[nodeId] && unwiredSinks[nodeId][utilityKey]) unwired++;
    }
    if (declared === 0) return 'unused';
    if (unwired === 0) return 'connected';
    if (unwired === declared) return 'unwired';
    return 'partial';
  }

  _renderUtilities(el) {
    const entry = this.game.registry.get(this.beamlineId);
    // The flattened path, not `placeables.filter(beamlineId)` — components with
    // role 'placement' (cavities, quads, BPMs, cryomodules) live in
    // pipe.placements and never appear in placeables, so the old filter judged
    // connectivity from the endpoint hardware alone and ignored every sink on
    // the pipe between them.
    const myNodeIds = entry && entry.sourceId
      ? hardwareNodes(flattenPath(this.game.state, entry.sourceId)).map(n => n.id)
      : [];

    const PRESENTATION = {
      connected: { color: '#44dd66', icon: '●', text: 'Connected' },
      partial:   { color: '#ddaa33', icon: '◐', text: 'Partially wired' },
      unwired:   { color: '#dd4444', icon: '○', text: 'Not connected' },
      unused:    { color: '#556',    icon: '·', text: 'Not required' },
    };

    let requiredCount = 0;
    let connectedCount = 0;
    let html = '<div class="ctx-section-label">Utility Connections</div>';
    for (const { key, label } of UTILITY_TYPES) {
      const status = this._utilityStatus(key, myNodeIds);
      if (status !== 'unused') requiredCount++;
      if (status === 'connected') connectedCount++;
      const { color, icon, text } = PRESENTATION[status];
      html += `
        <div class="ctx-utility-row">
          <span class="ctx-utility-dot" style="color:${color}">${icon}</span>
          <span class="ctx-utility-label">${label}</span>
          <span class="ctx-utility-status" style="color:${color}">${text}</span>
        </div>
      `;
    }
    // Coverage is over the utilities this beamline actually NEEDS, not all six.
    // A source that wants three and has none is at 0%, not the 50% a fixed
    // denominator reported for having declared them.
    const coverage = requiredCount > 0
      ? `${(connectedCount / requiredCount * 100).toFixed(0)}%` : '—';
    html += `
      <div style="margin-top:12px">
        <div class="ctx-stats-grid">
          <div class="ctx-stat"><div class="ctx-stat-label">Connected</div><div class="ctx-stat-val">${connectedCount} / ${requiredCount}</div></div>
          <div class="ctx-stat"><div class="ctx-stat-label">Coverage</div><div class="ctx-stat-val">${coverage}</div></div>
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
