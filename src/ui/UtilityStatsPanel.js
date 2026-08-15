// src/ui/UtilityStatsPanel.js
//
// Infra-mode side panel summarising the state of every utility network type.
// Mounted below the music player while the player is in infra mode; removed
// when mode changes. One row per utility type with:
//   color swatch · display name · # networks · totalCap/totalDem · err badges
// Click a row → open UtilityInspector for the first network of that type.

import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { UtilityInspector } from './UtilityInspector.js';
import { escapeHtml } from './format.js';

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
    container.appendChild(this.el);

    // Listener uses the game.on single-channel pattern (event, data) callbacks.
    this._listener = (event) => {
      if (event !== 'tick' && event !== 'utilityLinesChanged') return;
      this.render();
    };
    this._off = (typeof game.on === 'function') ? game.on(this._listener) : null;

    this.render();
  }

  render() {
    const state = this.game.state;
    const data = state.utilityNetworkData;

    let html = `<div class="utility-stats-title">UTILITY NETWORKS</div>`;

    for (const type of UTILITY_TYPE_LIST) {
      const desc = UTILITY_TYPES[type];
      if (!desc) continue;
      const perType = (data && typeof data.get === 'function') ? data.get(type) : null;
      const flows = perType ? Array.from(perType.values()) : [];

      let totalCap = 0;
      let totalDem = 0;
      let hardErr = 0;
      let softErr = 0;
      let rfBandMismatch = false;
      for (const flow of flows) {
        totalCap += flow.totalCapacity || 0;
        totalDem += flow.totalDemand || 0;
        for (const e of (flow.errors || [])) {
          if (e.severity === 'hard') hardErr++;
          else if (e.severity === 'soft') softErr++;
          if (type === 'rfWaveguide'
            && (e.code === 'rf_frequency_split' || e.code === 'rf_frequency_mismatch')) {
            rfBandMismatch = true;
          }
        }
      }

      const rowId = `util-stats-row-${type}`;
      const hasNetworks = flows.length > 0;
      html += `<button type="button" id="${rowId}" class="utility-stats-row"${hasNetworks ? '' : ' disabled'}>
        <span class="utility-stats-swatch" style="--utility-color:${escapeHtml(desc.color)}"></span>
        <span class="utility-stats-name">${escapeHtml(desc.displayName)}</span>
        <span class="utility-stats-count">${flows.length} net</span>
        <span class="utility-stats-flow">${totalCap.toFixed(0)}/${totalDem.toFixed(0)}</span>
        ${hardErr > 0 ? `<span class="utility-stats-badge utility-stats-badge-hard">${hardErr}</span>` : ''}
        ${softErr > 0 ? `<span class="utility-stats-badge utility-stats-badge-soft">${softErr}</span>` : ''}
        ${rfBandMismatch ? '<span class="utility-rf-band-alert">⚠ BAND MISMATCH</span>' : ''}
      </button>`;
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
    if (this._off) this._off();
    this._off = null;
    this._listener = null;
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.el = null;
  }
}

export default UtilityStatsPanel;
