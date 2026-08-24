// Compact category-and-actions panel for multi-object selections.

import { ContextWindow } from './ContextWindow.js';
import { SELECTION_CATEGORIES } from '../game/selection-targets.js';

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

export function selectionActionAvailability(entries) {
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
    hasBeamline: selected.some(target => target.selectionCategory === 'beamline'),
  };
}

function compatibleActionTitle(action, included, excluded) {
  const base = action === 'copy'
    ? `Duplicate ${included} compatible item${included === 1 ? '' : 's'} and attach the copy to the cursor`
    : `Move ${included} movable item${included === 1 ? '' : 's'} together`;
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
      + '<div class="selection-panel-heading">Included categories</div>'
      + '<div class="selection-category-list" role="group" aria-label="Selection categories"></div>'
      + '</div>';

    const categories = container.querySelector('.selection-category-list');
    for (const row of rows.filter(candidate => candidate.count > 0)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `selection-category${row.enabled ? ' active' : ''}`;
      button.disabled = row.count === 0;
      button.dataset.selectionCategory = row.key;
      button.setAttribute('aria-pressed', row.enabled ? 'true' : 'false');
      button.title = `${row.enabled ? 'Exclude' : 'Include'} ${row.label} items`;
      button.innerHTML = `<span class="selection-category-check">${row.enabled ? '✓' : ''}</span>`
        + `<span class="selection-category-name">${escapeHtml(row.label)}</span>`
        + `<span class="selection-category-count">${row.selectedCount}/${row.count}</span>`;
      button.addEventListener('click', () => {
        this.selectionActions.onToggleCategory?.(row.key);
        this.refresh();
      });
      categories.appendChild(button);
    }
  }

  _updateActions() {
    const entries = this._selected();
    const availability = selectionActionAvailability(entries);
    const {
      selectedCount, copyableCount, movableCount, copyExcludedCount,
      moveExcludedCount,
    } = availability;
    this.ctx.setActions([
      {
        label: 'Copy',
        hotkey: 'C',
        title: copyableCount === 0 && availability.hasBeamline
          ? 'Beamline hardware copies through the Designer'
          : compatibleActionTitle('copy', copyableCount, copyExcludedCount),
        disabled: copyableCount === 0,
        onClick: () => this.selectionActions.onCopy?.(),
      },
      {
        label: 'Move',
        hotkey: 'P',
        title: compatibleActionTitle('move', movableCount, moveExcludedCount),
        disabled: movableCount === 0,
        onClick: () => this.selectionActions.onPlace?.(),
      },
      {
        label: 'Delete',
        hotkey: 'Del',
        variant: 'danger',
        title: availability.hasBeamline
          ? 'Exclude Beamline before deleting; beamline deletion is protected'
          : this.game?.sandboxMode ? 'Delete the active selection with no refund'
            : 'Delete the active selection for a 50% refund',
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
