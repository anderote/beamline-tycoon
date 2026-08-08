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

export class UtilityInspector {
  /**
   * Open an inspector window for a specific (utilityType, networkId).
   * Call from the input layer when a utility line is clicked with no tool armed.
   */
  constructor(game, utilityType, networkId) {
    this.game = game;
    this.utilityType = utilityType;
    this.networkId = networkId;

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

    const ctx = new ContextWindow({
      id: winId,
      title: displayName,
      icon,
      accentColor: accent,
      tabs: [{ key: 'overview', label: 'Overview' }],
      onClose: () => this._cleanup(),
    });
    this.ctx = ctx;

    ctx.onTabRender('overview', (el) => this._renderOverview(el));

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

  _renderOverview(el) {
    const game = this.game;
    const state = game.state;
    const desc = UTILITY_TYPES[this.utilityType];
    if (!desc) {
      el.innerHTML = `<div style="padding:12px;color:#888;font-size:11px">Unknown utility type.</div>`;
      return;
    }

    const perType = state.utilityNetworkData && state.utilityNetworkData.get
      ? state.utilityNetworkData.get(this.utilityType)
      : null;
    const flow = perType && perType.get ? perType.get(this.networkId) : null;

    if (!flow) {
      el.innerHTML = `<div style="padding:12px;color:#888;font-size:11px">
        Network not solved yet or no longer exists.<br/>
        <span style="opacity:0.7">${escapeHtml(this.networkId)}</span>
      </div>`;
      return;
    }

    const network = this._reconstructNetwork(state, this.utilityType, this.networkId);
    if (!network) {
      el.innerHTML = `<div style="padding:12px;color:#888;font-size:11px">Network not found.</div>`;
      return;
    }

    const persistent = (state.utilityNetworkState && state.utilityNetworkState.get)
      ? (state.utilityNetworkState.get(this.networkId) || {})
      : {};

    const totalCapacity = flow.totalCapacity || 0;
    const totalDemand = flow.totalDemand || 0;
    const util = totalCapacity > 0 ? Math.min(1, totalDemand / totalCapacity) : (totalDemand > 0 ? 1 : 0);

    let html = `<div style="padding:4px 2px;font-size:12px;line-height:1.5">`;
    html += `<div style="font-size:10px;opacity:0.6;word-break:break-all"><strong>Network ID:</strong> ${escapeHtml(this.networkId)}</div>`;
    html += `<div><strong>Capacity:</strong> ${totalCapacity.toFixed(1)} ${escapeHtml(desc.capacityUnit || '')}</div>`;
    html += `<div><strong>Demand:</strong> ${totalDemand.toFixed(1)} ${escapeHtml(desc.demandUnit || desc.capacityUnit || '')}</div>`;
    html += `<div style="margin-top:6px">${pctBar(util, 180)}</div>`;

    // Sources
    if (network.sources && network.sources.length) {
      html += `<hr style="margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,0.1)"/>`;
      html += `<div><strong>Sources (${network.sources.length}):</strong></div>`;
      // Descriptors name their own per-port params (cryo carries capacity as
      // coldCapacityW, vacuum as pumpSpeed, ...); network-discovery only
      // mirrors params.capacity/params.demand onto the port, so reading those
      // alone rendered a literal 0 next to correct header totals.
      const capParam = desc.capacityParam || 'capacity';
      for (const s of network.sources) {
        const cap = (s.params && s.params[capParam]) != null ? s.params[capParam] : s.capacity;
        html += `<div style="font-size:11px;opacity:0.85;padding:1px 0">
          &bull; ${escapeHtml(this._placeableLabel(s.placeableId))}
          <span style="opacity:0.6">· ${escapeHtml(s.portName)}</span>
          <span style="opacity:0.7">· ${cap != null ? cap : 0} ${escapeHtml(desc.capacityUnit || '')}</span>
        </div>`;
      }
    }

    // Sinks
    if (network.sinks && network.sinks.length) {
      html += `<hr style="margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,0.1)"/>`;
      html += `<div><strong>Sinks (${network.sinks.length}):</strong></div>`;
      const demParam = desc.demandParam || 'demand';
      for (const s of network.sinks) {
        const dem = (s.params && s.params[demParam] != null ? s.params[demParam] : s.demand) || 0;
        const q = flow.perSinkQuality ? flow.perSinkQuality[s.portKey] : undefined;
        const qStr = (q !== undefined)
          ? ` <span style="color:${qualityColor(q)}">(${(q * 100).toFixed(0)}%)</span>`
          : '';
        html += `<div style="font-size:11px;opacity:0.85;padding:1px 0">
          &bull; ${escapeHtml(this._placeableLabel(s.placeableId))}
          <span style="opacity:0.6">· ${escapeHtml(s.portName)}</span>
          <span style="opacity:0.7">· ${dem} ${escapeHtml(desc.demandUnit || desc.capacityUnit || '')}</span>${qStr}
        </div>`;
      }
    }

    // Errors
    if (flow.errors && flow.errors.length) {
      html += `<hr style="margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,0.1)"/>`;
      html += `<div><strong>Issues:</strong></div>`;
      for (const e of flow.errors) {
        const color = e.severity === 'hard' ? '#ff4444' : '#ddaa22';
        html += `<div style="color:${color};font-size:11px;padding:1px 0">
          ${escapeHtml((e.severity || 'info').toUpperCase())}: ${escapeHtml(e.message || e.code || '')}
        </div>`;
      }
    }

    // Descriptor-specific inner section
    if (typeof desc.renderInspector === 'function') {
      try {
        const inner = desc.renderInspector(network, flow, persistent);
        if (inner) {
          html += `<hr style="margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,0.1)"/>`;
          html += inner;
        }
      } catch (err) {
        html += `<div style="color:#ff4444;font-size:11px">renderInspector threw: ${escapeHtml((err && err.message) || String(err))}</div>`;
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
        html += `<hr style="margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,0.1)"/>`;
        html += `<div style="margin-top:2px">
          <button data-refill-btn="1"
            style="padding:6px 12px;background:${afford ? '#2a4a7f' : '#444'};color:#fff;border:0;border-radius:4px;cursor:${afford ? 'pointer' : 'not-allowed'};font-size:12px">
            Refill for $${Number(cost.funding).toLocaleString()}
          </button>
        </div>`;
      }
    }

    html += `</div>`;
    el.innerHTML = html;

    if (hasRefill) {
      const btn = el.querySelector('[data-refill-btn="1"]');
      if (btn) btn.onclick = () => this._handleRefill();
    }
  }

  _handleRefill() {
    const game = this.game;
    const desc = UTILITY_TYPES[this.utilityType];
    if (!desc || typeof desc.refillCost !== 'function') return;
    const state = game.state;
    const persistent = (state.utilityNetworkState && state.utilityNetworkState.get)
      ? (state.utilityNetworkState.get(this.networkId) || {})
      : {};
    let cost = null;
    try { cost = desc.refillCost(persistent); } catch (_) { cost = null; }
    if (!cost) return;

    if (typeof game.canAfford === 'function' && !game.canAfford(cost)) {
      if (typeof game.log === 'function') game.log('Cannot afford refill', 'bad');
      return;
    }
    if (typeof game.spend === 'function') game.spend(cost);

    // Reset reservoir fields from descriptor defaults. `persistentStateDefaults`
    // is the authoritative "full" state for a given utility type.
    const defaults = desc.persistentStateDefaults || {};
    const resetState = { ...persistent, ...defaults };
    if (state.utilityNetworkState && typeof state.utilityNetworkState.set === 'function') {
      state.utilityNetworkState.set(this.networkId, resetState);
    }

    if (typeof game.log === 'function') {
      game.log(`${desc.displayName} refilled`, 'good');
    }

    if (this.ctx && this.ctx._el) this.ctx.update();
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
