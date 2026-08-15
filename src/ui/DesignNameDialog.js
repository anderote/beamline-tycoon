// src/ui/DesignNameDialog.js — in-game naming prompt for saved beamline designs.

import { pushEscHandler } from './esc-stack.js';
import { makeDraggable } from './draggable.js';

export class DesignNameDialog {
  constructor() {
    this.el = null;
    this._resolve = null;
    this._escUnsub = null;
  }

  /**
   * @param {{title?: string, defaultName?: string, componentCount?: number,
   *   lengthM?: number, category?: string}} opts
   * @returns {Promise<string|null>} trimmed name, or null when cancelled
   */
  open(opts = {}) {
    if (!this.el) this._build();

    // Resolve an older request before replacing it. This should never happen
    // through the UI, but it keeps a double-click from stranding a Promise.
    if (this._resolve) this._close(null);

    const title = this.el.querySelector('.dnm-title');
    const input = this.el.querySelector('.dnm-input');
    const meta = this.el.querySelector('.dnm-meta');
    const error = this.el.querySelector('.dnm-error');

    title.textContent = opts.title || 'Save Beamline Design';
    input.value = opts.defaultName || '';
    error.textContent = '';
    input.removeAttribute('aria-invalid');

    const details = [];
    if (Number.isFinite(opts.componentCount)) {
      details.push(`${opts.componentCount} component${opts.componentCount === 1 ? '' : 's'}`);
    }
    if (Number.isFinite(opts.lengthM)) details.push(`${opts.lengthM.toFixed(1)} m`);
    if (opts.category) details.push(opts.category);
    meta.textContent = details.join('  ·  ');
    meta.classList.toggle('hidden', details.length === 0);

    this.el.classList.remove('hidden');
    this._escUnsub = pushEscHandler(() => { this._close(null); return true; });

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    return new Promise((resolve) => { this._resolve = resolve; });
  }

  _submit() {
    const input = this.el.querySelector('.dnm-input');
    const error = this.el.querySelector('.dnm-error');
    const name = input.value.trim();
    if (!name) {
      error.textContent = 'Give this design a name before saving.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    this._close(name);
  }

  _close(answer) {
    this.el?.classList.add('hidden');
    this._escUnsub?.();
    this._escUnsub = null;
    const resolve = this._resolve;
    this._resolve = null;
    if (resolve) resolve(answer);
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'design-name-dialog';
    el.className = 'hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'design-name-dialog-title');
    el.innerHTML = `
      <div class="dnm-header">
        <span class="dnm-title" id="design-name-dialog-title">Save Beamline Design</span>
        <button type="button" class="dnm-close" title="Cancel" aria-label="Cancel">&times;</button>
      </div>
      <form class="dnm-form">
        <label class="dnm-label" for="design-name-input">Design name</label>
        <input id="design-name-input" class="dnm-input" type="text"
          maxlength="64" autocomplete="off" spellcheck="false">
        <div class="dnm-meta"></div>
        <div class="dnm-error" role="alert" aria-live="polite"></div>
        <div class="dnm-footer">
          <button type="submit" class="dnm-btn dnm-btn-primary">Save Design</button>
          <button type="button" class="dnm-btn" data-act="cancel">Cancel</button>
        </div>
      </form>`;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector('.dnm-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit();
    });
    el.querySelector('.dnm-close').addEventListener('click', () => this._close(null));
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => this._close(null));
    el.querySelector('.dnm-input').addEventListener('input', (e) => {
      e.target.removeAttribute('aria-invalid');
      el.querySelector('.dnm-error').textContent = '';
    });

    makeDraggable(el, el.querySelector('.dnm-header'), {
      exclude: '.dnm-close',
      freezeTransform: true,
      grabCursor: true,
    });
  }
}
