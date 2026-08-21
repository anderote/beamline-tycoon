// Category-aware context panel for mixed marquee selections.

import { ContextWindow } from './ContextWindow.js';
import {
  SELECTION_CATEGORIES,
  selectionTargetPosition,
} from '../game/selection-targets.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function selectionCategoryRows(candidates, selectedKeys) {
  const selected = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || []);
  return SELECTION_CATEGORIES.map(category => {
    const targets = (candidates || []).filter(
      target => target.selectionCategory === category.key,
    );
    const selectedCount = targets.filter(target => selected.has(target.key)).length;
    return {
      ...category,
      count: targets.length,
      selectedCount,
      enabled: targets.length > 0 && selectedCount > 0,
      targets,
    };
  });
}

export class SelectionWindow {
  constructor(game, anchor, selectionActions = {}) {
    this.game = game;
    this.anchor = anchor;
    this.selectionActions = selectionActions;
    this.ctx = new ContextWindow({
      id: 'selection-group',
      title: 'Selection',
      accentColor: '#315f86',
      tabs: [{ key: 'selection', label: 'Selection' }],
      onClose: () => {},
    });
    if (this.ctx.id !== 'selection-group') return;
    this.ctx._el?.classList.add('selection-group-window');
    this.ctx.onTabRender('selection', container => this._render(container));
    this.refresh();
  }

  _candidates() {
    return this.selectionActions.getCandidates?.() || [];
  }

  _selected() {
    return this.selectionActions.getSelectionEntries?.() || [];
  }

  _selectedKeys() {
    return new Set(this._selected().map(target => target.key));
  }

  _render(container) {
    const candidates = this._candidates();
    const selectedKeys = this._selectedKeys();
    const rows = selectionCategoryRows(candidates, selectedKeys);
    container.innerHTML = '<div class="selection-panel">'
      + '<div class="selection-panel-heading">Include categories</div>'
      + '<div class="selection-category-list" role="group" aria-label="Selection categories"></div>'
      + '<div class="selection-panel-heading selection-panel-items-heading">Selected objects</div>'
      + '<div class="selection-panel-list"></div>'
      + '<div class="selection-panel-heading selection-panel-save-heading">Save selection</div>'
      + '<div class="selection-panel-slots" aria-label="Save selection to slot"></div>'
      + '<div class="selection-panel-help">Click a category to include/exclude it · Ctrl+1…9 saves · Shift+1…9 recalls</div>'
      + '</div>';

    const categories = container.querySelector('.selection-category-list');
    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `selection-category${row.enabled ? ' active' : ''}`;
      button.disabled = row.count === 0;
      button.dataset.selectionCategory = row.key;
      button.setAttribute('aria-pressed', row.enabled ? 'true' : 'false');
      button.innerHTML = `<span class="selection-category-check">${row.enabled ? '✓' : ''}</span>`
        + `<span class="selection-category-name">${escapeHtml(row.label)}</span>`
        + `<span class="selection-category-count">${row.selectedCount}/${row.count}</span>`;
      button.addEventListener('click', () => {
        this.selectionActions.onToggleCategory?.(row.key);
        this.refresh();
      });
      categories.appendChild(button);
    }

    const list = container.querySelector('.selection-panel-list');
    for (const row of rows) {
      if (!row.count) continue;
      const heading = document.createElement('div');
      heading.className = `selection-panel-category-heading${row.enabled ? '' : ' disabled'}`;
      heading.textContent = `${row.label} · ${row.selectedCount} selected`;
      list.appendChild(heading);
      for (const target of row.targets) {
        const item = document.createElement('div');
        const active = selectedKeys.has(target.key);
        item.className = `selection-panel-item${active ? '' : ' excluded'}`;
        item.innerHTML = `<span class="selection-panel-item-name">${escapeHtml(target.name)}</span>`
          + `<span class="selection-panel-item-kind">${escapeHtml(target.targetKind)}</span>`
          + `<span class="selection-panel-item-position">${escapeHtml(selectionTargetPosition(target))}</span>`;
        list.appendChild(item);
      }
    }

    const slots = this.selectionActions.getSelectionSlots?.() || {};
    const slotGrid = container.querySelector('.selection-panel-slots');
    for (let slot = 1; slot <= 9; slot++) {
      const savedCount = Number(slots[slot]) || 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'selection-panel-slot';
      button.disabled = selectedKeys.size === 0;
      button.innerHTML = `<span class="selection-panel-slot-key">${slot}</span>`
        + `<span>${savedCount ? `${savedCount} saved` : 'empty'}</span>`;
      button.addEventListener('click', () => {
        this.selectionActions.onSaveSlot?.(String(slot));
        this.refresh();
      });
      slotGrid.appendChild(button);
    }
  }

  _updateActions() {
    const entries = this._selected();
    const count = entries.length;
    const clipboardCount = this.selectionActions.getClipboardCount?.() || 0;
    const hasBeamline = entries.some(target => target.selectionCategory === 'beamline');
    const placeablesOnly = count > 0 && entries.every(target => target.targetKind === 'placeable');
    this.ctx.setActions([
      {
        label: 'Move selection',
        title: placeablesOnly ? 'Pick up the active categories together' : 'Walls and floors cannot be moved',
        disabled: !placeablesOnly || hasBeamline,
        onClick: () => this.selectionActions.onPlace?.(),
      },
      {
        label: 'Copy',
        title: hasBeamline
          ? 'Deselect Beamline first; beamline hardware copies through the Designer'
          : 'Copy only the active categories to the formation clipboard',
        disabled: count === 0 || hasBeamline,
        onClick: () => {
          this.selectionActions.onCopyToClipboard?.();
          this.refresh();
        },
      },
      {
        label: clipboardCount ? `Paste (${clipboardCount})` : 'Paste',
        disabled: clipboardCount === 0,
        onClick: () => this.selectionActions.onPaste?.(),
      },
      {
        label: 'Rotate group',
        disabled: !placeablesOnly || hasBeamline,
        onClick: () => this.selectionActions.onRotate?.(),
      },
      {
        label: 'Mirror group',
        disabled: !placeablesOnly || hasBeamline,
        onClick: () => this.selectionActions.onMirror?.(),
      },
      {
        label: this.game?.sandboxMode ? 'Demolish active (no refund)' : 'Demolish active (50% refund)',
        variant: 'danger',
        disabled: count === 0 || hasBeamline,
        onClick: () => {
          const removed = this.selectionActions.onDemolish?.() || [];
          if (removed.length) this.ctx.close();
        },
      },
    ]);
  }

  refresh(anchor = null) {
    if (anchor) this.anchor = anchor;
    const selected = this._selected().length;
    const total = this._candidates().length;
    this.ctx.setTitle(total === selected
      ? `${selected} Item${selected === 1 ? '' : 's'} Selected`
      : `${selected} of ${total} Items Selected`);
    this._updateActions();
    this.ctx.update();
  }
}
