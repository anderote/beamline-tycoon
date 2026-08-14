// EquipmentWindow.js — Context window for placed facility equipment

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { utilityStatRows } from './utility-supply.js';

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
      { label: 'Demolish (50% refund)', variant: 'danger', onClick: () => {
        this.game.demolishTarget({ kind: 'equipment', id: equip.id });
        this.ctx.close();
      }},
    ]);
  }

  _renderInfo(container) {
    const comp = this.comp;
    const equip = this.equip;

    let html = '<div class="equipment-details">';
    html += `<div class="equipment-name">${comp.name}</div>`;
    html += `<div class="equipment-meta">Category: ${comp.category || 'general'}</div>`;

    if (comp.cost) {
      const cost = typeof comp.cost === 'object' ? comp.cost.funding || 0 : comp.cost;
      html += `<div class="equipment-meta">Cost: $${cost.toLocaleString()}</div>`;
    }
    for (const r of utilityStatRows(comp)) {
      html += `<div class="equipment-utility">${r.label}: ${r.value}</div>`;
    }

    // Stats / effects
    if (comp.effects) {
      html += '<div class="equipment-section">';
      for (const [key, val] of Object.entries(comp.effects)) {
        const sign = val > 0 ? '+' : '';
        html += `<div class="equipment-effect">${_effectLabel(key)}: ${sign}${_fmtEffect(key, val)}</div>`;
      }
      html += '</div>';
    }

    // System stats contribution
    if (comp.systemStats) {
      html += '<div class="equipment-section equipment-section-label">System contribution:</div>';
      for (const [key, val] of Object.entries(comp.systemStats)) {
        html += `<div class="equipment-system-stat">${_effectLabel(key)}: ${val}</div>`;
      }
    }

    html += `<div class="equipment-position">Position: (${equip.col}, ${equip.row})</div>`;
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
