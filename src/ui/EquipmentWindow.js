// EquipmentWindow.js — Context window for placed facility equipment

import { ContextWindow } from './ContextWindow.js';
import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { utilityStatRows } from './utility-supply.js';
import { componentUtilityPortSectionHtml } from './utility-port-details.js';
import { autoConnectTargetLabel } from './hover-info.js';
import { placeableOperationalStatus } from './operational-status.js';

export function equipmentAutoConnectAction(plan, fallbackUtilityType = 'powerCable') {
  const utilityType = plan?.utilityType || fallbackUtilityType;
  const count = plan?.stubs?.length || 0;
  const inRange = plan?.candidates || 0;
  const funding = plan?.cost?.funding || 0;
  return {
    count,
    inRange,
    funding,
    label: count > 0
      ? `Auto-connect ${count} ($${funding.toLocaleString()}) · Tab`
      : 'Auto-connect nearby · Tab',
    title: inRange > 0
      ? `${inRange} unconnected ${autoConnectTargetLabel(utilityType, inRange)} in range; Tab draws ${count} routable line${count === 1 ? '' : 's'} using free connectors; T removes all utility connections`
      : `No routable ${autoConnectTargetLabel(utilityType, 2)} are currently in range; T removes all utility connections`,
    disabled: count === 0,
  };
}

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
    const selectionCount = this._selectionEntries().length;
    if (selectionCount > 1) {
      const clipboardCount = this.selectionActions.getClipboardCount?.() || 0;
      this.ctx.setActions([
        {
          label: 'Move selection',
          title: 'Pick up the complete selection and place it together',
          onClick: () => this.selectionActions.onPlace?.(this.equip.id),
        },
        {
          label: 'Copy',
          title: 'Copy the selection and its internal utility connections to the formation clipboard',
          onClick: () => {
            this.selectionActions.onCopyToClipboard?.(this.equip.id);
            this.refresh();
          },
        },
        {
          label: clipboardCount > 0 ? `Paste (${clipboardCount})` : 'Paste',
          title: clipboardCount > 0
            ? 'Attach the copied formation to the cursor'
            : 'Copy a selection before pasting it',
          disabled: clipboardCount === 0,
          onClick: () => this.selectionActions.onPaste?.(),
        },
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
        { label: this.game?.sandboxMode ? 'Demolish all (no refund)' : 'Demolish all (50% refund)', variant: 'danger', onClick: () => {
          const removedIds = this.selectionActions.onDemolish?.(this.equip.id) || [];
          for (const id of removedIds) ContextWindow.getWindow('equip-' + id)?.close();
        }},
      ]);
      return;
    }
    const actions = [
      ...(this.game?.getPowerDeviceActions?.(this.equip.id) || []).map(action => ({
        label: action.label,
        title: action.title || 'Change this device’s operating state',
        disabled: !!action.disabled,
        onClick: () => {
          this.game.dispatchPowerDeviceAction?.(this.equip.id, action.id);
          this.refresh();
        },
      })),
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
      { label: this.game?.sandboxMode ? 'Demolish (no refund)' : 'Demolish (50% refund)', variant: 'danger', onClick: () => {
        if (this.selectionActions.onDemolish) {
          const removedIds = this.selectionActions.onDemolish(this.equip.id) || [];
          for (const id of removedIds) ContextWindow.getWindow('equip-' + id)?.close();
        } else {
          this.game.demolishTarget({ kind: this.equip.kind || 'equipment', id: this.equip.id });
          this.ctx.close();
        }
      }},
    ];
    this.ctx.setActions(actions);
  }

  _updateTitle() {
    const count = this._selectionEntries().length;
    this.ctx?._el?.classList.toggle('selection-group-window', count > 1);
    this.ctx?.setTitle(count > 1 ? `${count} Items Selected` : this.comp.name);
    if (count === 1) {
      const operational = EquipmentWindow.prototype._operationalStatus.call(this);
      this.ctx?.setStatus?.(operational.label, operational.color);
    } else {
      this.ctx?.setStatus?.('', '');
    }
  }

  _operationalStatus() {
    return placeableOperationalStatus(this.game?.state, this.equip, {
      health: this.game?.getComponentHealth?.(this.equip.id),
    });
  }

  _selectionEntries() {
    const entries = this.selectionActions.getSelectionEntries?.(this.equip.id);
    return Array.isArray(entries) && entries.length ? entries : [this.equip];
  }

  _renderGroupInfo(container, entries) {
    container.innerHTML = '<div class="selection-panel">'
      + '<div class="selection-panel-heading">Selected items</div>'
      + '<div class="selection-panel-list"></div>'
      + '</div>';

    const list = container.querySelector('.selection-panel-list');
    for (const item of selectionWindowItems(entries)) {
      const row = document.createElement('div');
      row.className = 'selection-panel-item';
      row.innerHTML = `<span class="selection-panel-item-name">${escapeHtml(item.name)}</span>`
        + `<span class="selection-panel-item-kind">${escapeHtml(item.category)}</span>`
        + `<span class="selection-panel-item-position">${item.position}</span>`;
      list.appendChild(row);
    }
  }

  _renderInfo(container) {
    const comp = this.comp;
    const equip = this.equip;
    const selectionEntries = this._selectionEntries();
    if (selectionEntries.length > 1) {
      this._renderGroupInfo(container, selectionEntries);
      return;
    }

    let html = '<div class="equipment-details">';
    html += `<div class="equipment-name">${comp.name}</div>`;
    const autoConnectRadius = Number(this._autoConnectPlan?.radius || comp.autoConnectRadius);
    const autoConnectAction = autoConnectRadius > 0
      ? equipmentAutoConnectAction(
          this._autoConnectPlan,
          comp.autoConnectUtility || 'powerCable',
        )
      : null;
    if (autoConnectAction) {
      html += `<button type="button" class="ctx-action-btn equipment-auto-connect-btn"`
        + `${autoConnectAction.disabled ? ' disabled' : ''}`
        + ` title="${escapeHtml(autoConnectAction.title)}">`
        + `${escapeHtml(autoConnectAction.label)}</button>`;
    }
    html += `<div class="equipment-meta">Category: ${equip.category || comp.category || 'general'}</div>`;

    if (comp.cost) {
      const cost = typeof comp.cost === 'object' ? comp.cost.funding || 0 : comp.cost;
      html += `<div class="equipment-meta">Cost: $${cost.toLocaleString()}</div>`;
    }
    for (const r of utilityStatRows(comp)) {
      html += `<div class="equipment-utility">${r.label}: ${r.value}</div>`;
    }
    const operational = EquipmentWindow.prototype._operationalStatus.call(this);
    html += componentUtilityPortSectionHtml(equip.type, operational.groups);
    const powerStatus = this.game?.getPowerDeviceStatus?.(equip.id);
    if (powerStatus?.rows?.length) {
      html += '<div class="equipment-section equipment-section-label">Electrical status:</div>';
      for (const row of powerStatus.rows) {
        html += `<div class="equipment-utility">${escapeHtml(row.label)}: ${escapeHtml(row.value)}</div>`;
      }
    }
    if (autoConnectRadius > 0) {
      const ready = this._autoConnectPlan?.stubs?.length || 0;
      const inRange = this._autoConnectPlan?.candidates || 0;
      html += `<div class="equipment-utility">Auto-connect radius: ${autoConnectRadius} tiles</div>`;
      const utilityType = this._autoConnectPlan?.utilityType
        || comp.autoConnectUtility || 'powerCable';
      html += `<div class="equipment-utility">Unconnected ${autoConnectTargetLabel(utilityType, inRange)} in range: ${inRange}</div>`;
      html += `<div class="equipment-utility">Routable with free connectors: ${ready}</div>`;
      html += '<div class="equipment-utility">T: remove all utility connections</div>';
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
    const autoConnectButton = container.querySelector?.('.equipment-auto-connect-btn');
    autoConnectButton?.addEventListener?.('click', () => {
      this.selectionActions.onAutoConnect?.(this.equip.id);
      this.refresh();
    });
  }

  refresh() {
    this._autoConnectPlan = this.selectionActions.getAutoConnectPlan?.(this.equip.id) || null;
    this._updateTitle();
    this._updateActions();
    this.ctx.update();
  }
}

export function selectionWindowItems(entries) {
  return (entries || []).map(entry => {
    const def = COMPONENTS[entry?.type] || PLACEABLES[entry?.type] || {};
    return {
      id: entry?.id,
      name: def.name || entry?.type || 'Unknown item',
      category: entry?.category || def.category || 'general',
      position: `(${entry?.col ?? '?'}, ${entry?.row ?? '?'})`,
    };
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
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
