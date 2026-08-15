// EquipmentWindow.js — Context window for placed facility equipment

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { utilityStatRows } from './utility-supply.js';

export class EquipmentWindow {
  /**
   * @param {object} game   - Game instance
   * @param {object} equip  - Equipment entry { id, type, col, row }
   */
  constructor(game, equip, selectionActions = {}) {
    this.game = game;
    this.equip = equip;
    this.selectionActions = selectionActions;
    // This window is also the compact info menu for selected furnishings,
    // decorations, and infrastructure. Equipment remains the common case,
    // so retain the name and public entry point.
    this.comp = COMPONENTS[equip.type] || PLACEABLES[equip.type];
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

    this._autoConnectPlan = this.selectionActions.getAutoConnectPlan?.(equip.id) || null;
    this.ctx.onTabRender('info', (container) => this._renderInfo(container));
    this._updateActions();
    this._updateTitle();
  }

  _updateActions() {
    const selectionCount = this.selectionActions.getSelectionCount?.(this.equip.id) || 1;
    const actions = [
      {
        label: 'Place',
        title: 'Pick up the selection and place it together',
        onClick: () => this.selectionActions.onPlace?.(this.equip.id),
      },
      {
        label: 'Copy',
        title: 'Copy the selection and its internal utility connections',
        onClick: () => this.selectionActions.onCopy?.(this.equip.id),
      },
      { label: 'Demolish (50% refund)', variant: 'danger', onClick: () => {
        if (this.selectionActions.onDemolish) {
          const removedIds = this.selectionActions.onDemolish(this.equip.id) || [];
          for (const id of removedIds) ContextWindow.getWindow('equip-' + id)?.close();
        } else {
          this.game.demolishTarget({ kind: this.equip.kind || 'equipment', id: this.equip.id });
          this.ctx.close();
        }
      }},
    ];
    if (selectionCount > 1) {
      actions.splice(2, 0,
        {
          label: 'Rotate group',
          title: 'Pick up the selection rotated 90°; F rotates again while placing',
          onClick: () => this.selectionActions.onRotate?.(this.equip.id),
        },
        {
          label: 'Mirror group',
          title: 'Pick up and mirror the selection; M mirrors again while placing',
          onClick: () => this.selectionActions.onMirror?.(this.equip.id),
        },
      );
    }
    if (this.comp.autoConnectRadius > 0) {
      const plan = this._autoConnectPlan;
      const count = plan?.stubs?.length || 0;
      const funding = plan?.cost?.funding || 0;
      actions.unshift({
        label: count > 0
          ? `Auto-connect ${count} ($${funding.toLocaleString()})`
          : 'Auto-connect nearby',
        title: count > 0
          ? `Draw ${count} power cable${count === 1 ? '' : 's'} to free plugs inside the panel radius`
          : 'No routable unconnected power plugs are currently in range',
        disabled: count === 0,
        onClick: () => {
          this.selectionActions.onAutoConnect?.(this.equip.id);
          this.refresh();
        },
      });
    }
    this.ctx.setActions(actions);
  }

  _updateTitle() {
    const count = this.selectionActions.getSelectionCount?.(this.equip.id) || 1;
    this.ctx?.setTitle(count > 1 ? `${count} Items Selected` : this.comp.name);
  }

  _renderInfo(container) {
    const comp = this.comp;
    const equip = this.equip;

    let html = '<div class="equipment-details">';
    html += `<div class="equipment-name">${comp.name}</div>`;
    html += `<div class="equipment-meta">Category: ${equip.category || comp.category || 'general'}</div>`;

    if (comp.cost) {
      const cost = typeof comp.cost === 'object' ? comp.cost.funding || 0 : comp.cost;
      html += `<div class="equipment-meta">Cost: $${cost.toLocaleString()}</div>`;
    }
    for (const r of utilityStatRows(comp)) {
      html += `<div class="equipment-utility">${r.label}: ${r.value}</div>`;
    }
    const selectionCount = this.selectionActions.getSelectionCount?.(this.equip.id) || 1;
    if (selectionCount > 1) {
      html += '<div class="equipment-utility">Formation slots: Ctrl+1…9 save · Shift+1…9 recall</div>';
    }
    if (comp.autoConnectRadius > 0) {
      const ready = this._autoConnectPlan?.stubs?.length || 0;
      html += `<div class="equipment-utility">Auto-connect radius: ${comp.autoConnectRadius} tiles</div>`;
      html += `<div class="equipment-utility">Ready power plugs: ${ready}</div>`;
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
    this._autoConnectPlan = this.selectionActions.getAutoConnectPlan?.(this.equip.id) || null;
    this._updateTitle();
    this._updateActions();
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
