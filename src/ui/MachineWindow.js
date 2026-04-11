// MachineWindow.js — Draggable context window for a standalone machine instance

import { ContextWindow } from './ContextWindow.js';
import { MACHINES } from '../data/machines.js';

export class MachineWindow {
  /**
   * @param {object} game              - Game instance
   * @param {string} machineInstanceId - machine.id from game.state.machines
   */
  constructor(game, machineInstanceId) {
    this.game = game;
    this.machineId = machineInstanceId;

    const machine = game.state.machines.find(m => m.id === machineInstanceId);
    if (!machine) return;
    this.machine = machine;

    const def = MACHINES[machine.type];
    if (!def) return;
    this.def = def;

    // Reuse existing window if open
    const existing = ContextWindow.getWindow('mach-' + machineInstanceId);
    if (existing) {
      existing.focus();
      this.ctx = existing;
      return;
    }

    const ctx = new ContextWindow({
      id: 'mach-' + machineInstanceId,
      title: def.name,
      icon: def.icon || '',
      accentColor: '#5a3a1f',
      tabs: [
        { key: 'overview',  label: 'Overview'  },
        { key: 'upgrades',  label: 'Upgrades'  },
        { key: 'settings',  label: 'Settings'  },
        { key: 'finance',   label: 'Finance'   },
      ],
    });
    this.ctx = ctx;

    ctx.onTabRender('overview',  el => this._renderOverview(el));
    ctx.onTabRender('upgrades',  el => this._renderUpgrades(el));
    ctx.onTabRender('settings',  el => this._renderSettings(el));
    ctx.onTabRender('finance',   el => this._renderFinance(el));

    this._updateStatus();
    this._updateActions();
  }

  // ---------------------------------------------------------------------------
  // Status + actions
  // ---------------------------------------------------------------------------

  _updateStatus() {
    if (!this.ctx || !this.machine) return;
    if (this.machine.active) {
      this.ctx.setStatus('ACTIVE', '#44dd66');
    } else {
      this.ctx.setStatus('PAUSED', '#888');
    }
  }

  _updateActions() {
    if (!this.ctx || !this.machine) return;
    const machine = this.machine;
    const repairCost = this._repairCost();

    const actions = [];

    // Pause / Resume
    if (machine.active) {
      actions.push({
        label: 'Pause',
        onClick: () => {
          this.game.toggleMachine(this.machineId);
          this.refresh();
        },
      });
    } else {
      actions.push({
        label: 'Resume',
        style: 'color:#44dd66',
        onClick: () => {
          this.game.toggleMachine(this.machineId);
          this.refresh();
        },
      });
    }

    // Repair
    if (machine.health < 100) {
      actions.push({
        label: `Repair ($${repairCost.toLocaleString()})`,
        style: 'color:#f84',
        onClick: () => {
          this.game.repairMachine(this.machineId);
          this.refresh();
        },
      });
    }

    // Demolish — 50% refund. Routes through unified delete path.
    actions.push({
      label: 'Demolish (50% refund)',
      style: 'color:#f88',
      onClick: () => {
        this.game.demolishTarget({ kind: 'machine', id: this.machineId });
        this.ctx.close();
      },
    });

    this.ctx.setActions(actions);
  }

  _repairCost() {
    const def = this.def;
    const machine = this.machine;
    return Math.ceil(def.cost.funding * 0.3 * (100 - machine.health) / 100);
  }

  // ---------------------------------------------------------------------------
  // Tab: Overview
  // ---------------------------------------------------------------------------

  _renderOverview(el) {
    const machine = this.machine;
    const def = this.def;
    const perf = this.game.getMachinePerformance(machine);

    const funding = (def.baseFunding * perf.fundingMult).toFixed(2);
    const data = (def.baseData * perf.dataMult).toFixed(2);
    const energy = (def.energyCost * perf.energyMult).toFixed(1);
    const mode = machine.operatingMode || (def.operatingModes?.[0]) || '—';

    el.innerHTML = `
      <div style="text-align:center;font-size:2.5em;margin:8px 0 4px">${def.icon || '?'}</div>
      <div style="text-align:center;color:#aaa;margin-bottom:10px;font-size:0.85em">${def.desc || ''}</div>
      <div class="ctx-stats-grid">
        <div class="ctx-stat">
          <div class="ctx-stat-label">Mode</div>
          <div class="ctx-stat-val">${mode}</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Health</div>
          <div class="ctx-stat-val" style="color:${this._healthColor(machine.health)}">${machine.health}%</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">$/tick</div>
          <div class="ctx-stat-val">$${funding}</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Data/tick</div>
          <div class="ctx-stat-val">${data} dp</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Energy</div>
          <div class="ctx-stat-val">${energy} kW</div>
        </div>
      </div>
    `;
  }

  _healthColor(health) {
    if (health > 60) return '#44dd66';
    if (health > 25) return '#ddaa22';
    return '#ff4444';
  }

  // ---------------------------------------------------------------------------
  // Tab: Upgrades
  // ---------------------------------------------------------------------------

  _renderUpgrades(el) {
    const machine = this.machine;
    const def = this.def;
    const upgrades = def.upgrades || {};

    if (Object.keys(upgrades).length === 0) {
      el.innerHTML = '<div style="color:#888;padding:12px">No upgrades available.</div>';
      return;
    }

    let html = '<div style="display:flex;flex-direction:column;gap:10px;padding:4px">';
    for (const [key, upg] of Object.entries(upgrades)) {
      const currentLvl = machine.upgrades?.[key] ?? 0;
      const levels = upg.levels || [];
      const currentLabel = levels[currentLvl]?.label || `Level ${currentLvl}`;
      const nextLevel = levels[currentLvl + 1];

      let nextHtml;
      if (!nextLevel) {
        nextHtml = '<span style="color:#aaf">MAX</span>';
      } else {
        const costs = [];
        if (nextLevel.cost?.funding) costs.push(`$${nextLevel.cost.funding.toLocaleString()}`);
        if (nextLevel.cost?.data) costs.push(`${nextLevel.cost.data} dp`);
        const costStr = costs.length ? ` — ${costs.join(', ')}` : '';
        nextHtml = `<span style="color:#fa8">${nextLevel.label}${costStr}</span>`;
      }

      html += `
        <div style="background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:8px">
          <div style="color:#ccc;font-size:0.9em;margin-bottom:4px">${upg.name}</div>
          <div style="font-size:0.85em">
            <span style="color:#6f6">Current: ${currentLabel}</span>
          </div>
          <div style="font-size:0.85em;margin-top:2px">Next: ${nextHtml}</div>
        </div>
      `;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Tab: Settings
  // ---------------------------------------------------------------------------

  _renderSettings(el) {
    const machine = this.machine;
    const def = this.def;
    const modes = def.operatingModes;

    if (!modes || modes.length === 0) {
      el.innerHTML = '<div style="color:#888;padding:12px">No configurable operating modes.</div>';
      return;
    }

    const currentMode = machine.operatingMode || modes[0];

    let html = '<div style="padding:4px"><div style="color:#888;font-size:0.85em;margin-bottom:8px">Operating Mode</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px">';
    for (const mode of modes) {
      const isActive = mode === currentMode;
      const mults = def.modeMultipliers?.[mode];
      let desc = '';
      if (mults) {
        desc = ` — ×${mults.fundingMult} $, ×${mults.dataMult} data`;
      }
      html += `<div class="ctx-mode-option${isActive ? ' active' : ''}"
                    data-mode="${mode}"
                    style="cursor:pointer;padding:7px 10px;border-radius:4px;border:1px solid ${isActive ? '#8a6' : '#333'};background:${isActive ? '#1a2d1a' : '#111'};color:${isActive ? '#8f8' : '#ccc'}">
                <strong>${mode}</strong><span style="color:#888;font-size:0.82em">${desc}</span>
              </div>`;
    }
    html += '</div></div>';
    el.innerHTML = html;

    // Bind click events
    el.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.game.setMachineMode(this.machineId, mode);
        this.refresh();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Tab: Finance
  // ---------------------------------------------------------------------------

  _renderFinance(el) {
    const machine = this.machine;
    const def = this.def;
    const perf = this.game.getMachinePerformance(machine);

    const funding = (def.baseFunding * perf.fundingMult).toFixed(2);
    const data = (def.baseData * perf.dataMult).toFixed(2);
    const energy = (def.energyCost * perf.energyMult).toFixed(1);
    const buildCost = def.cost?.funding
      ? `$${def.cost.funding.toLocaleString()}`
      : '—';

    el.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat">
          <div class="ctx-stat-label">Build Cost</div>
          <div class="ctx-stat-val">${buildCost}</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Energy Draw</div>
          <div class="ctx-stat-val">${energy} kW</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Funding/tick</div>
          <div class="ctx-stat-val">$${funding}</div>
        </div>
        <div class="ctx-stat">
          <div class="ctx-stat-label">Data/tick</div>
          <div class="ctx-stat-val">${data} dp</div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Public: refresh
  // ---------------------------------------------------------------------------

  refresh() {
    // Re-read the live machine object in case it was mutated
    const m = this.game.state.machines.find(m => m.id === this.machineId);
    if (m) this.machine = m;

    this._updateStatus();
    this._updateActions();
    if (this.ctx) this.ctx.update();
  }
}
