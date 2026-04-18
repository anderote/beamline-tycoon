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

const ACCENT_COLORS = {
  powerCable:   '#2a6630',
  coolingWater: '#2a4a7f',
  cryoTransfer: '#2a6a7f',
  rfWaveguide:  '#7f2a2a',
  vacuumPipe:   '#4a4a4a',
  dataFiber:    '#6a6a6a',
};

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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    const accent = ACCENT_COLORS[utilityType] || '#333';
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
    if (typeof this.game.on === 'function') this.game.on(this._listener);

    ctx.update();
  }

  _cleanup() {
    if (this._listener && this.game && Array.isArray(this.game.listeners)) {
      const idx = this.game.listeners.indexOf(this._listener);
      if (idx !== -1) this.game.listeners.splice(idx, 1);
    }
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
    html += `<div><strong>Demand:</strong> ${totalDemand.toFixed(1)} ${escapeHtml(desc.capacityUnit || '')}</div>`;
    html += `<div style="margin-top:6px">${pctBar(util, 180)}</div>`;

    // Sources
    if (network.sources && network.sources.length) {
      html += `<hr style="margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,0.1)"/>`;
      html += `<div><strong>Sources (${network.sources.length}):</strong></div>`;
      for (const s of network.sources) {
        const cap = (s.params && s.params.capacity) != null ? s.params.capacity : s.capacity;
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
      for (const s of network.sinks) {
        const dem = (s.params && (s.params.demand != null ? s.params.demand : s.params.heatLoad)) || s.demand || 0;
        const q = flow.perSinkQuality ? flow.perSinkQuality[s.portKey] : undefined;
        const qStr = (q !== undefined)
          ? ` <span style="color:${qualityColor(q)}">(${(q * 100).toFixed(0)}%)</span>`
          : '';
        html += `<div style="font-size:11px;opacity:0.85;padding:1px 0">
          &bull; ${escapeHtml(this._placeableLabel(s.placeableId))}
          <span style="opacity:0.6">· ${escapeHtml(s.portName)}</span>
          <span style="opacity:0.7">· ${dem} ${escapeHtml(desc.capacityUnit || '')}</span>${qStr}
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
    const placeable = this.game.state.placeables.find(p => p.id === id);
    if (!placeable) return id;
    const def = COMPONENTS[placeable.type];
    return (def && def.name) ? def.name : placeable.type;
  }

  /**
   * Rebuild the network object on demand using network-discovery.
   * Cheap enough for per-render — the cost is O(lines + ports), and the
   * inspector only renders a handful of times per tick.
   */
  _reconstructNetwork(state, utilityType, networkId) {
    const lookup = makeDefaultPortLookup(state);
    const nets = discoverNetworks(utilityType, state.utilityLines || new Map(), lookup);
    return nets.find(n => n.id === networkId) || null;
  }
}

export default UtilityInspector;
