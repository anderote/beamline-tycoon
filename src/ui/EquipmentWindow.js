// EquipmentWindow.js — Context window for placed facility equipment

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';

export class EquipmentWindow {
  /**
   * @param {object} game   - Game instance
   * @param {object} equip  - Equipment entry { id, type, col, row }
   */
  constructor(game, equip) {
    this.game = game;
    this.equip = equip;
    this.comp = COMPONENTS[equip.type];
    if (!this.comp) return;

    this.ctx = new ContextWindow({
      id: 'equip-' + equip.id,
      title: this.comp.name,
      icon: '',
      accentColor: '#246',
      tabs: [
        { key: 'info', label: 'Info' },
      ],
      onClose: () => {},
    });

    // If a duplicate was returned, just focus it
    if (this.ctx.id !== 'equip-' + equip.id) return;

    this.ctx.onTabRender('info', (container) => this._renderInfo(container));

    this.ctx.setActions([
      { label: 'Demolish (50% refund)', style: 'color:#f88', onClick: () => {
        this.game.demolishTarget({ kind: 'equipment', id: equip.id });
        this.ctx.close();
      }},
    ]);
  }

  _renderInfo(container) {
    const comp = this.comp;
    const equip = this.equip;

    let html = '<div style="display:flex;flex-direction:column;gap:4px;font-size:11px;">';
    html += `<div style="color:#8af;">${comp.name}</div>`;
    html += `<div style="color:#888;">Category: ${comp.category || 'general'}</div>`;

    if (comp.cost) {
      const cost = typeof comp.cost === 'object' ? comp.cost.funding || 0 : comp.cost;
      html += `<div style="color:#888;">Cost: $${cost.toLocaleString()}</div>`;
    }
    if (comp.energyCost) {
      html += `<div style="color:#cc8;">Energy: ${comp.energyCost} kW</div>`;
    }

    // Stats / effects
    if (comp.effects) {
      html += '<div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;">';
      for (const [key, val] of Object.entries(comp.effects)) {
        const sign = val > 0 ? '+' : '';
        html += `<div style="color:#8f8;">${_effectLabel(key)}: ${sign}${_fmtEffect(key, val)}</div>`;
      }
      html += '</div>';
    }

    // System stats contribution
    if (comp.systemStats) {
      html += '<div style="margin-top:4px;border-top:1px solid #333;padding-top:4px;color:#aaa;">System contribution:</div>';
      for (const [key, val] of Object.entries(comp.systemStats)) {
        html += `<div style="color:#aaf;">${_effectLabel(key)}: ${val}</div>`;
      }
    }

    html += `<div style="margin-top:4px;color:#666;">Position: (${equip.col}, ${equip.row})</div>`;
    html += '</div>';
    container.innerHTML = html;
  }

  refresh() {
    this.ctx.update();
  }
}

function _effectLabel(key) {
  const labels = {
    zoneOutput: 'Zone Output',
    morale: 'Morale',
    research: 'Research',
    rfPower: 'RF Power',
    vacuumCapacity: 'Vacuum',
    coolingCapacity: 'Cooling',
    cryoCapacity: 'Cryo',
    powerCapacity: 'Power',
    dataCapacity: 'Data',
    energyCost: 'Energy Cost',
    emittanceReduction: 'Emittance Reduction',
    diagnosticAccuracy: 'Diagnostic Accuracy',
  };
  return labels[key] || key;
}

function _fmtEffect(key, val) {
  if (key === 'morale') return String(val);
  if (typeof val === 'number' && Math.abs(val) < 1) return (val * 100).toFixed(0) + '%';
  return String(val);
}
