// BeamlinesMenu.js — compact top-bar launcher for every facility beamline.
//
// The menu owns presentation and gestures only. Beamline identity comes from
// BeamlineRegistry, information windows remain UIHost-owned, and opening an
// existing line in Designer remains a Game command.

import { pushEscHandler } from './esc-stack.js';

export function beamlinesMenuModel(registry) {
  return (registry?.getAll?.() || []).map(entry => ({
    id: entry.id,
    name: entry.name || entry.id,
    accentColor: Number.isFinite(entry.accentColor) ? entry.accentColor : 0x888888,
    status: entry.status || 'stopped',
    canOpenDesigner: !!entry.sourceId,
  }));
}

function accentCss(hex) {
  return `#${Math.max(0, hex >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

export class BeamlinesMenu {
  constructor(game, {
    button = globalThis.document?.getElementById('btn-beamlines'),
    menu = globalThis.document?.getElementById('beamlines-dropdown'),
    documentTarget = globalThis.document,
    onOpenInfo = () => {},
    onOpenDesigner = beamlineId => game.openDesignerForBeamline?.(beamlineId),
  } = {}) {
    this.game = game;
    this.button = button;
    this.menu = menu;
    this.documentTarget = documentTarget;
    this.onOpenInfo = onOpenInfo;
    this.onOpenDesigner = onOpenDesigner;
    this._escUnsub = null;

    this._bind();
    this.game?.on?.((event) => {
      if (!this.isOpen()) return;
      if (event === 'beamlineChanged' || event === 'loaded' || event === 'restored') {
        this.render();
      }
    });
  }

  _bind() {
    this.button?.addEventListener('click', (event) => {
      event.stopPropagation?.();
      this.toggle();
    });
    this.menu?.addEventListener('click', (event) => {
      const actionButton = event.target.closest?.('[data-beamline-action]');
      if (!actionButton) return;
      this.activate(actionButton.dataset.beamlineId, actionButton.dataset.beamlineAction);
    });
    this.documentTarget?.addEventListener('click', () => this.close());
  }

  isOpen() {
    return !!this.menu && !this.menu.classList.contains('hidden');
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open() {
    if (!this.menu || !this.button) return;
    this.render();
    this.menu.classList.remove('hidden');
    this.button.setAttribute('aria-expanded', 'true');
    if (!this._escUnsub) {
      this._escUnsub = pushEscHandler(() => {
        this.close();
        return true;
      });
    }
  }

  close() {
    this.menu?.classList.add('hidden');
    this.button?.setAttribute('aria-expanded', 'false');
    this._escUnsub?.();
    this._escUnsub = null;
  }

  activate(beamlineId, action = 'info') {
    const entry = this.game?.registry?.get?.(beamlineId);
    if (!entry) return false;

    if (action === 'designer') {
      if (!entry.sourceId) return false;
      this.onOpenDesigner(beamlineId);
    } else if (action === 'info') {
      this.game.selectedBeamlineId = beamlineId;
      this.game.emit?.('beamlineSelected', beamlineId);
      this.onOpenInfo(beamlineId);
    } else {
      return false;
    }

    this.close();
    return true;
  }

  render() {
    if (!this.menu) return;
    const doc = this.menu.ownerDocument || globalThis.document;
    const entries = beamlinesMenuModel(this.game?.registry);
    this.menu.replaceChildren();

    if (entries.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'beamlines-menu-empty';
      empty.textContent = 'No beamlines yet';
      this.menu.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const row = doc.createElement('div');
      row.className = 'beamlines-menu-row';

      const info = doc.createElement('button');
      info.type = 'button';
      info.className = 'beamlines-menu-info';
      info.dataset.beamlineId = entry.id;
      info.dataset.beamlineAction = 'info';
      info.setAttribute('role', 'menuitem');

      const accent = doc.createElement('span');
      accent.className = 'beamlines-menu-accent';
      accent.style.backgroundColor = accentCss(entry.accentColor);
      accent.setAttribute('aria-hidden', 'true');

      const name = doc.createElement('span');
      name.className = 'beamlines-menu-name';
      name.textContent = entry.name;

      const status = doc.createElement('span');
      status.className = `beamlines-menu-status status-${entry.status}`;
      status.textContent = entry.status;

      info.append(accent, name, status);

      const designer = doc.createElement('button');
      designer.type = 'button';
      designer.className = 'beamlines-menu-designer';
      designer.dataset.beamlineId = entry.id;
      designer.dataset.beamlineAction = 'designer';
      designer.setAttribute('role', 'menuitem');
      designer.textContent = 'Designer';
      designer.title = `Open ${entry.name} in Beamline Designer`;
      designer.disabled = !entry.canOpenDesigner;

      row.append(info, designer);
      this.menu.appendChild(row);
    }
  }
}
