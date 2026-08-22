// src/ui/UtilityInspector.js
//
// Context window for inspecting a single utility network (new-system, Phase 5).
// Opens when a utility line or port is clicked in the 3D scene while no
// utility-line tool is armed. Shows capacity/demand, sources, sinks, errors,
// descriptor-specific content, and a Refill button when the descriptor
// provides a refillCost.
//
// Mirrors the shape of NetworkWindow.js: registers a tick listener on the
// game, re-renders on utilityLinesChanged, and unregisters via
// ContextWindow's onClose hook.

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { discoverNetworks, makeDefaultPortLookup } from '../utility/network-discovery.js';
import { findUtilityEndpoint } from '../utility/utility-endpoints.js';
import { escapeHtml } from './format.js';
import { renderRfSpectrum } from './rf-spectrum.js';
import { DEFAULT_VACUUM_HISTORY_RANGE_TICKS } from '../utility/types/vacuumPipe.js';
import { bindVacuumPressureRangeControls } from './vacuum-pressure-controls.js';

// Titlebar accent derives from the utility's registry color (the single
// source of truth for utility hues), darkened so the title gradient stays
// legible behind the header text.
function accentColor(utilityType) {
  const hex = UTILITY_TYPES[utilityType]?.color;
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return '#333';
  const n = parseInt(hex.slice(1), 16);
  const dk = (c) => Math.round(c * 0.55).toString(16).padStart(2, '0');
  return '#' + dk((n >> 16) & 255) + dk((n >> 8) & 255) + dk(n & 255);
}

const ICONS = {
  powerCable:   '\u26A1',
  coolingWater: '\uD83D\uDCA7',
  waterSupplyPipe: '\uD83D\uDCA7',
  cryoTransfer: '\u2744\uFE0F',
  rfWaveguide:  '\uD83D\uDCE1',
  vacuumPipe:   '\uD83C\uDF00',
  dataFiber:    '\uD83D\uDD17',
};

function qualityColor(q) {
  if (q >= 0.9) return '#44dd66';
  if (q >= 0.5) return '#ddaa22';
  return '#ff4444';
}

function bar(label, pct, color, width) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="utility-meter" style="--utility-meter-color:${color}">
    <span class="utility-meter-label">${label}</span>
    <div class="utility-meter-track" style="--utility-meter-max:${width || 140}px">
      <div class="utility-meter-fill" style="width:${p}%"></div>
    </div>
    <span class="utility-meter-value">${p.toFixed(0)}%</span>
  </div>`;
}

// Load = demand/capacity. HIGH is BAD — same polarity as the HUD's power
// utilization readout (hud.js). This bar used to run on a high=green scale,
// so a saturated or overloaded network showed full green and a comfortable
// one showed red.
function loadBar(ratio, width) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const color = pct >= 90 ? '#ff4444' : pct >= 70 ? '#ddaa22' : '#44dd66';
  return bar('Load', pct, color, width);
}

// Delivered quality across the network's sinks (worst case). HIGH is GOOD,
// matching qualityColor and the per-sink percentages listed below.
function qualityBar(q, width) {
  return bar('Delivered', q * 100, qualityColor(q), width);
}

// Utility magnitudes span many decades (vacuum outgassing is ~1e-6 mbar·L/s;
// power is ~1e2 kW). A flat toFixed(1) printed real vacuum loads as "0.0".
function fmtQty(v) {
  if (!isFinite(v)) return '--';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.1 && a < 1e6) return v.toFixed(1);
  return v.toExponential(2);
}

export function utilityInspectorTabs(utilityType) {
  return utilityType === 'rfWaveguide'
    ? [{ key: 'spectrum', label: 'Spectrum' }, { key: 'overview', label: 'Overview' }]
    : [{ key: 'overview', label: 'Overview' }];
}

export class UtilityInspector {
  /**
   * Open an inspector window for a specific (utilityType, networkId).
   * Call from the input layer when a utility line is clicked with no tool armed.
   */
  constructor(game, utilityType, networkId) {
    this.game = game;
    this.utilityType = utilityType;
    this.networkId = networkId;
    this._vacuumHistoryRangeTicks = DEFAULT_VACUUM_HISTORY_RANGE_TICKS;

    const winId = 'util-' + utilityType + '-' + networkId;
    const existing = ContextWindow.getWindow(winId);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    const desc = UTILITY_TYPES[utilityType];
    const accent = accentColor(utilityType);
    const icon = ICONS[utilityType] || '';
    const displayName = desc ? desc.displayName : utilityType;

    const tabs = utilityInspectorTabs(utilityType);
    const ctx = new ContextWindow({
      id: winId,
      title: displayName,
      icon,
      accentColor: accent,
      tabs,
      onClose: () => this._cleanup(),
    });
    this.ctx = ctx;

    ctx.onTabRender('overview', (el) => this._renderOverview(el));
    if (utilityType === 'rfWaveguide') {
      ctx.onTabRender('spectrum', (el) => this._renderSpectrum(el));
    }

    // Auto-refresh on tick / utilityLinesChanged using the game's single
    // listener channel (same pattern as NetworkWindow).
    this._listener = (event) => {
      if (event !== 'tick' && event !== 'utilityLinesChanged') return;
      if (this.ctx && this.ctx._el) this.ctx.update();
    };
    this._off = (typeof this.game.on === 'function') ? this.game.on(this._listener) : null;

    ctx.update();
  }

  _cleanup() {
    if (this._off) this._off();
    this._off = null;
    this._listener = null;
  }

  _renderSpectrum(el) {
    const perType = this.game.state.utilityNetworkData?.get?.(this.utilityType);
    const flow = perType?.get?.(this.networkId);
    el.innerHTML = renderRfSpectrum(flow);
  }

  _renderOverview(el) {
    const game = this.game;
    const state = game.state;
    const desc = UTILITY_TYPES[this.utilityType];
    if (!desc) {
      el.innerHTML = `<div class="ui-empty-state">Unknown utility type.</div>`;
      return;
    }

    const perType = state.utilityNetworkData && state.utilityNetworkData.get
      ? state.utilityNetworkData.get(this.utilityType)
      : null;
    const flow = perType && perType.get ? perType.get(this.networkId) : null;

    if (!flow) {
      el.innerHTML = `<div class="ui-empty-state">
        Network not solved yet or no longer exists.<br/>
        <span class="ui-text-faint">${escapeHtml(this.networkId)}</span>
      </div>`;
      return;
    }

    const network = this._reconstructNetwork(state, this.utilityType, this.networkId);
    if (!network) {
      el.innerHTML = `<div class="ui-empty-state">Network not found.</div>`;
      return;
    }

    const persistent = (state.utilityNetworkState && state.utilityNetworkState.get)
      ? (state.utilityNetworkState.get(this.networkId) || {})
      : {};

    const totalCapacity = flow.totalCapacity || 0;
    const totalDemand = flow.totalDemand || 0;
    const topologyOnly = desc.topologyOnly === true;
    // Only meaningful when capacity and demand are the same physical
    // quantity. vacuumPipe measures capacity in L/s and demand in mbar·L/s,
    // so their ratio is a pressure, not a fraction — rendering it as a
    // percentage was dimensionally meaningless (a healthy vacuum network
    // always read ~0%, a pumpless one read 100%).
    const comparable = !desc.demandUnit || desc.demandUnit === desc.capacityUnit;
    const util = totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity) : (totalDemand > 0 ? 1 : 0);
    // Worst delivered quality across sinks — the health number that IS
    // meaningful for every utility.
    let worstQuality = null;
    for (const q of Object.values(flow.perSinkQuality || {})) {
      if (typeof q !== 'number') continue;
      worstQuality = worstQuality === null ? q : Math.min(worstQuality, q);
    }

    let html = `<div class="utility-inspector">`;
    html += `<div class="utility-inspector-identity">
      <span>Network ID</span>
      <code>${escapeHtml(this.networkId)}</code>
      <span class="utility-live-badge">LIVE</span>
    </div>`;
    if (topologyOnly) {
      const connected = (flow.connectedNodeCount || 0) >= 2;
      html += `<div class="utility-summary-grid">
        <div class="utility-summary-stat"><span>Devices</span><strong>${flow.connectedNodeCount || 0}</strong><small>peers</small></div>
        <div class="utility-summary-stat"><span>Links</span><strong>${flow.connectedLinkCount || 0}</strong><small>fiber runs</small></div>
        <div class="utility-summary-stat"><span>Topology</span><strong>Bus</strong><small>bidirectional</small></div>
        <div class="utility-summary-stat"><span>Status</span><strong>${connected ? 'Connected' : 'Isolated'}</strong><small>${connected ? 'shared fabric' : 'needs a peer'}</small></div>
      </div>`;
    } else {
      html += `<div class="utility-summary-grid">
        <div class="utility-summary-stat"><span>Capacity</span><strong>${fmtQty(totalCapacity)}</strong><small>${escapeHtml(desc.capacityUnit || '')}</small></div>
        <div class="utility-summary-stat"><span>Demand</span><strong>${fmtQty(totalDemand)}</strong><small>${escapeHtml(desc.demandUnit || desc.capacityUnit || '')}</small></div>
        <div class="utility-summary-stat"><span>Sources</span><strong>${network.sources?.length || 0}</strong><small>connected</small></div>
        <div class="utility-summary-stat"><span>Sinks</span><strong>${network.sinks?.length || 0}</strong><small>connected</small></div>
      </div>`;
    }
    if (!topologyOnly && (comparable || worstQuality !== null)) {
      html += '<div class="utility-health-grid">';
      if (comparable) html += `<div>${loadBar(util, 160)}</div>`;
      if (worstQuality !== null) html += `<div>${qualityBar(worstQuality, 160)}</div>`;
      html += '</div>';
    }

    if (topologyOnly && network.peers && network.peers.length) {
      html += `<section class="utility-inspector-section">
        <div class="utility-section-heading"><strong>Peer ports</strong><span>${network.peers.length}</span></div>
        <div class="utility-endpoint-list">`;
      for (const peer of network.peers) {
        html += `<div class="utility-endpoint-row">
          <div class="utility-endpoint-name"><strong>${escapeHtml(this._placeableLabel(peer.placeableId))}</strong><span>data port</span></div>
          <span class="utility-endpoint-value">peer</span>
        </div>`;
      }
      html += '</div></section>';
    }

    // Sources
    if (!topologyOnly && network.sources && network.sources.length) {
      html += `<section class="utility-inspector-section">
        <div class="utility-section-heading"><strong>Sources</strong><span>${network.sources.length}</span></div>
        <div class="utility-endpoint-list">`;
      // Descriptors name their own per-port params (cryo carries capacity as
      // coldCapacityW, vacuum as pumpSpeed, ...); network-discovery only
      // mirrors params.capacity/params.demand onto the port, so reading those
      // alone rendered a literal 0 next to correct header totals.
      const capParam = desc.capacityParam || 'capacity';
      for (const s of network.sources) {
        let cap = (s.params && s.params[capParam]) != null ? s.params[capParam] : s.capacity;
        let sourceUnit = desc.capacityUnit || '';
        if (network.utilityType === 'coolingWater' && !(cap > 0)
          && s.params?.heatRejectionCapacity > 0) {
          cap = s.params.heatRejectionCapacity;
        } else if (network.utilityType === 'waterSupplyPipe' && !(cap > 0)
          && s.params?.processReturnCapacity > 0) {
          cap = s.params.processReturnCapacity;
          sourceUnit = 'kW process return';
        } else if (network.utilityType === 'coolingWater' && !(cap > 0)
          && s.params?.supplyRateLPerTick > 0) {
          cap = s.params.supplyRateLPerTick;
          sourceUnit = 'L/tick supply';
        } else if (network.utilityType === 'coolingWater' && !(cap > 0)
          && s.params?.storageCapacityL > 0) {
          cap = s.params.storageCapacityL;
          sourceUnit = 'L storage';
        } else if (network.utilityType === 'cryoTransfer' && !(cap > 0)
          && s.params?.heatRejectionCapacityW > 0) {
          cap = s.params.heatRejectionCapacityW;
          sourceUnit = 'W heat rejection';
        } else if (network.utilityType === 'cryoTransfer' && !(cap > 0)
          && s.params?.storageCapacityL > 0) {
          cap = s.params.storageCapacityL;
          sourceUnit = 'L LHe storage';
        } else if (network.utilityType === 'cryoTransfer' && !(cap > 0)
          && s.params?.recoveryContribution > 0) {
          cap = s.params.recoveryContribution * 100;
          sourceUnit = '% recovery stage';
        } else if (network.utilityType === 'cryoTransfer' && !(cap > 0)
          && s.params?.preCoolingFraction > 0) {
          cap = s.params.preCoolingFraction * 100;
          sourceUnit = '% pre-cooling';
        } else if (network.utilityType === 'cryoTransfer' && !(cap > 0)
          && s.params?.staticHeatReductionFraction > 0) {
          cap = s.params.staticHeatReductionFraction * 100;
          sourceUnit = '% heat-leak reduction';
        } else if (network.utilityType === 'cryoTransfer' && !(cap > 0)
          && s.params?.ln2Reservoir) {
          cap = 1;
          sourceUnit = 'LN2 pre-cooling reservoir';
        }
        html += `<div class="utility-endpoint-row">
          <div class="utility-endpoint-name"><strong>${escapeHtml(this._placeableLabel(s.placeableId))}</strong><span>${escapeHtml(s.portName)}</span></div>
          <span class="utility-endpoint-value">${fmtQty(cap != null ? cap : 0)} ${escapeHtml(sourceUnit)}</span>
        </div>`;
      }
      html += '</div></section>';
    }

    // Sinks
    if (!topologyOnly && network.sinks && network.sinks.length) {
      html += `<section class="utility-inspector-section">
        <div class="utility-section-heading"><strong>Sinks</strong><span>${network.sinks.length}</span></div>
        <div class="utility-endpoint-list">`;
      const demParam = desc.demandParam || 'demand';
      for (const s of network.sinks) {
        const dem = (s.params && s.params[demParam] != null ? s.params[demParam] : s.demand) || 0;
        const q = flow.perSinkQuality ? flow.perSinkQuality[s.portKey] : undefined;
        const qStr = (q !== undefined)
          ? `<span class="utility-endpoint-quality" style="--utility-quality-color:${qualityColor(q)}">${(q * 100).toFixed(0)}%</span>`
          : '';
        html += `<div class="utility-endpoint-row">
          <div class="utility-endpoint-name"><strong>${escapeHtml(this._placeableLabel(s.placeableId))}</strong><span>${escapeHtml(s.portName)}</span></div>
          <span class="utility-endpoint-value">${fmtQty(dem)} ${escapeHtml(desc.demandUnit || desc.capacityUnit || '')}</span>${qStr}
        </div>`;
      }
      html += '</div></section>';
    }

    // Errors
    if (flow.errors && flow.errors.length) {
      const rfBandMismatch = this.utilityType === 'rfWaveguide'
        && flow.errors.some(e => e.code === 'rf_frequency_split' || e.code === 'rf_frequency_mismatch');
      html += `<section class="utility-inspector-section utility-issues-section">`;
      if (rfBandMismatch) {
        html += '<div class="utility-rf-band-alert utility-rf-band-alert-inspector">⚠ RF BAND MISMATCH — SPLIT THIS WAVEGUIDE NETWORK</div>';
      }
      html += `<div class="utility-section-heading"><strong>Issues</strong><span>${flow.errors.length}</span></div>`;
      for (const e of flow.errors) {
        const color = e.severity === 'hard' ? '#ff4444' : '#ddaa22';
        html += `<div class="utility-issue" style="--utility-issue-color:${color}">
          <strong>${escapeHtml((e.severity || 'info').toUpperCase())}</strong><span>${escapeHtml(e.message || e.code || '')}</span>
        </div>`;
      }
      html += '</section>';
    }

    // Descriptor-specific inner section
    if (typeof desc.renderInspector === 'function') {
      try {
        const inner = desc.renderInspector(network, flow, persistent, {
          vacuumHistoryRangeTicks: this._vacuumHistoryRangeTicks,
        });
        if (inner) {
          html += `<section class="utility-inspector-section utility-details-section">
            <div class="utility-section-heading"><strong>Network details</strong></div>
            ${inner}
          </section>`;
        }
      } catch (err) {
        html += `<div class="utility-issue utility-issue-error">renderInspector threw: ${escapeHtml((err && err.message) || String(err))}</div>`;
      }
    }

    // Refill action — guarded by descriptor.refillCost returning non-null.
    let hasRefill = false;
    if (typeof desc.refillCost === 'function') {
      let cost = null;
      try { cost = desc.refillCost(persistent); } catch (_) { cost = null; }
      if (cost && cost.funding) {
        hasRefill = true;
        const afford = (typeof game.canAfford === 'function') ? game.canAfford(cost) : true;
        html += `<hr class="ui-divider"/>`;
        html += `<div class="utility-refill-wrap">
          <button type="button" class="ui-button ui-button-primary utility-refill" data-refill-btn="1"${afford ? '' : ' disabled'}>
            Refill for $${Number(cost.funding).toLocaleString()}
          </button>
        </div>`;
      }
    }

    html += `</div>`;
    el.innerHTML = html;

    bindVacuumPressureRangeControls(el, rangeTicks => {
      if (rangeTicks === this._vacuumHistoryRangeTicks) return;
      this._vacuumHistoryRangeTicks = rangeTicks;
      if (this.ctx && this.ctx._el) this.ctx.update();
    });

    if (hasRefill) {
      const btn = el.querySelector('[data-refill-btn="1"]');
      if (btn) btn.onclick = () => this._handleRefill();
    }
  }

  _handleRefill() {
    const result = this.game.refillUtilityNetwork?.(this.utilityType, this.networkId);
    if (result?.ok && this.ctx && this.ctx._el) this.ctx.update();
  }

  _placeableLabel(id) {
    // Endpoints, not placeables: a network member can be a component carried
    // on a beam pipe (see utility/utility-endpoints.js).
    const placeable = findUtilityEndpoint(this.game.state, id);
    if (!placeable) return id;
    const def = COMPONENTS[placeable.type];
    return (def && def.name) ? def.name : placeable.type;
  }

  /**
   * The network object for this window. SolveRunner publishes the full
   * discovery result as state.utilityNetworks on every solve pass, so read
   * that first: re-running discoverNetworks here costs O(all same-type lines
   * × path length) — the spatial join expands every path into subtiles — and
   * this method runs on every 'tick' for every open inspector.
   *
   * Falls back to a fresh discovery when the cache can't answer: it is null
   * before the first solve, and one pass stale on 'utilityLinesChanged'.
   */
  _reconstructNetwork(state, utilityType, networkId) {
    const cached = state.utilityNetworks && state.utilityNetworks.get
      ? state.utilityNetworks.get(utilityType)
      : null;
    const hit = cached ? cached.find(n => n.id === networkId) : null;
    if (hit) return hit;
    const lookup = makeDefaultPortLookup(state);
    const nets = discoverNetworks(utilityType, state.utilityLines || new Map(), lookup);
    return nets.find(n => n.id === networkId) || null;
  }
}

export default UtilityInspector;
