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

export function selectionActionAvailability(entries, clipboardCount = 0) {
  const selected = entries || [];
  const copyable = selected.filter(
    target => target.selectionCategory !== 'beamline',
  );
  const movable = copyable.filter(target => target.targetKind === 'placeable');
  return {
    selectedCount: selected.length,
    copyableCount: copyable.length,
    movableCount: movable.length,
    copyExcludedCount: selected.length - copyable.length,
    moveExcludedCount: selected.length - movable.length,
    clipboardCount: Number(clipboardCount) || 0,
    hasBeamline: selected.some(target => target.selectionCategory === 'beamline'),
  };
}

function compatibleActionTitle(action, included, excluded) {
  const base = action === 'copy'
    ? `Copy ${included} compatible item${included === 1 ? '' : 's'} to the formation clipboard`
    : `${action} ${included} movable item${included === 1 ? '' : 's'}`;
  return excluded > 0
    ? `${base}; ${excluded} incompatible selected item${excluded === 1 ? '' : 's'} will be excluded`
    : base;
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
    const availability = selectionActionAvailability(this._selected());
    const slotGrid = container.querySelector('.selection-panel-slots');
    for (let slot = 1; slot <= 9; slot++) {
      const savedCount = Number(slots[slot]) || 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'selection-panel-slot';
      button.disabled = availability.copyableCount === 0;
      button.title = compatibleActionTitle(
        'copy', availability.copyableCount, availability.copyExcludedCount,
      );
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
    const clipboardCount = this.selectionActions.getClipboardCount?.() || 0;
    const availability = selectionActionAvailability(entries, clipboardCount);
    const {
      selectedCount, copyableCount, movableCount, copyExcludedCount,
      moveExcludedCount,
    } = availability;
    this.ctx.setActions([
      {
        label: moveExcludedCount > 0 && movableCount > 0
          ? `Move compatible (${movableCount})`
          : 'Move selection',
        title: compatibleActionTitle('Move', movableCount, moveExcludedCount),
        disabled: movableCount === 0,
        onClick: () => this.selectionActions.onPlace?.(),
      },
      {
        label: copyExcludedCount > 0 && copyableCount > 0
          ? `Copy compatible (${copyableCount})`
          : 'Copy',
        title: copyableCount === 0 && availability.hasBeamline
          ? 'Beamline hardware copies through the Designer'
          : compatibleActionTitle('copy', copyableCount, copyExcludedCount),
        disabled: copyableCount === 0,
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
        title: compatibleActionTitle('Rotate', movableCount, moveExcludedCount),
        disabled: movableCount === 0,
        onClick: () => this.selectionActions.onRotate?.(),
      },
      {
        label: 'Mirror group',
        title: compatibleActionTitle('Mirror', movableCount, moveExcludedCount),
        disabled: movableCount === 0,
        onClick: () => this.selectionActions.onMirror?.(),
      },
      {
        label: this.game?.sandboxMode ? 'Demolish active (no refund)' : 'Demolish active (50% refund)',
        variant: 'danger',
        disabled: selectedCount === 0 || availability.hasBeamline,
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
