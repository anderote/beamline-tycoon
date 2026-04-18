// src/ui/UtilityStatsPanel.js
//
// Infra-mode side panel summarising the state of every utility network type.
// Mounted below the music player while the player is in infra mode; removed
// when mode changes. One row per utility type with:
//   color swatch · display name · # networks · totalCap/totalDem · err badges
// Click a row → open UtilityInspector for the first network of that type.

import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { UtilityInspector } from './UtilityInspector.js';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class UtilityStatsPanel {
  /**
   * @param {Game} game
   * @param {HTMLElement} container - parent element to append the panel to
   */
  constructor(game, container) {
    this.game = game;
    this.container = container;

    this.el = document.createElement('div');
    this.el.className = 'utility-stats-panel';
    this.el.style.cssText = [
      'padding:10px',
      'background:rgba(20,20,30,0.82)',
      'color:#eee',
      'font-size:12px',
      'border-radius:6px',
      'margin-top:8px',
      'min-width:240px',
      'pointer-events:auto',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    ].join(';');
    container.appendChild(this.el);

    // Listener uses the game.on single-channel pattern (event, data) callbacks.
    this._listener = (event) => {
      if (event !== 'tick' && event !== 'utilityLinesChanged') return;
      this.render();
    };
    if (typeof game.on === 'function') game.on(this._listener);

    this.render();
  }

  render() {
    const state = this.game.state;
    const data = state.utilityNetworkData;

    let html = `<div style="font-weight:600;margin-bottom:6px;font-size:12px;letter-spacing:0.5px">UTILITY NETWORKS</div>`;

    for (const type of UTILITY_TYPE_LIST) {
      const desc = UTILITY_TYPES[type];
      if (!desc) continue;
      const perType = (data && typeof data.get === 'function') ? data.get(type) : null;
      const flows = perType ? Array.from(perType.values()) : [];

      let totalCap = 0;
      let totalDem = 0;
      let hardErr = 0;
      let softErr = 0;
      for (const flow of flows) {
        totalCap += flow.totalCapacity || 0;
        totalDem += flow.totalDemand || 0;
        for (const e of (flow.errors || [])) {
          if (e.severity === 'hard') hardErr++;
          else if (e.severity === 'soft') softErr++;
        }
      }

      const rowId = `util-stats-row-${type}`;
      const hasNetworks = flows.length > 0;
      const rowOpacity = hasNetworks ? '1' : '0.5';
      const cursor = hasNetworks ? 'pointer' : 'default';

      html += `<div id="${rowId}" style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:${cursor};border-bottom:1px solid rgba(255,255,255,0.06);opacity:${rowOpacity}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeHtml(desc.color)};flex:0 0 auto"></span>
        <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(desc.displayName)}</span>
        <span style="opacity:0.6;font-size:11px;flex:0 0 auto">${flows.length} net</span>
        <span style="opacity:0.8;font-size:11px;flex:0 0 auto">${totalCap.toFixed(0)}/${totalDem.toFixed(0)}</span>
        ${hardErr > 0 ? `<span style="background:#ff4444;color:#000;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">${hardErr}</span>` : ''}
        ${softErr > 0 ? `<span style="background:#ddaa22;color:#000;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">${softErr}</span>` : ''}
      </div>`;
    }

    this.el.innerHTML = html;

    // Wire row clicks
    for (const type of UTILITY_TYPE_LIST) {
      const row = document.getElementById(`util-stats-row-${type}`);
      if (!row) continue;
      row.onclick = () => {
        const perType = (state.utilityNetworkData && typeof state.utilityNetworkData.get === 'function')
          ? state.utilityNetworkData.get(type)
          : null;
        if (!perType || perType.size === 0) return;
        const firstId = perType.keys().next().value;
        new UtilityInspector(this.game, type, firstId);
      };
    }
  }

  destroy() {
    if (this._listener && this.game && Array.isArray(this.game.listeners)) {
      const idx = this.game.listeners.indexOf(this._listener);
      if (idx !== -1) this.game.listeners.splice(idx, 1);
    }
    this._listener = null;
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.el = null;
  }
}

export default UtilityStatsPanel;
