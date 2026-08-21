// src/ui/ApplyPreviewDialog.js — "here is what Apply will do" modal.
//
// The last gate before the Beamline Designer commits a plan to the map.
// `open(summary)` resolves 'apply' or 'back'; nothing here touches game state.
//
// The summary comes from designer-plan.js and is already GROUPED — one row per
// component type with a count, not one row per operation. That grouping is the
// point: a plan that appends four metres of pipe and an S-band structure emits
// half a dozen ops (extend, split, place, bind), and listing them would read as
// a machine's changelog rather than an answer to "what am I buying?".
//
// The moved-modules and utility-rewiring lines are hidden when zero rather than
// printed as "0 modules moved": those two lines exist to warn, and a warning
// that is always present stops being read.

import { COMPONENTS } from '../data/components.js';
import { escapeHtml as esc } from './format.js';
import { pushEscHandler } from './esc-stack.js';
import { makeDraggable } from './draggable.js';

function displayName(type) {
  const def = COMPONENTS[type];
  return (def && def.name) || type;
}

// Exact dollars, not fmtMoney's 1.8M rounding: this is the number about to
// leave the player's account, and the economy panel quotes it in full too.
function money(n) {
  const v = Math.round(n || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString();
}

export class ApplyPreviewDialog {
  constructor() {
    this.el = null;
    this._resolve = null;
    this._escUnsub = null;
  }

  /**
   * @param {Object} summary  planDesignerApply().summary
   * @param {{name?: string, title?: string, applyLabel?: string,
   *          backLabel?: string, freeConstruction?: boolean}} [opts]
   * @returns {Promise<'apply'|'back'>}
   */
  open(summary, opts = {}) {
    if (!this.el) this._build();
    this._render(summary || {}, opts);
    this.el.classList.remove('hidden');
    if (!this._escUnsub) {
      // Esc is "back to editing", never "apply" — the draft survives either
      // way, so the destructive-looking answer is the safe one to bind.
      this._escUnsub = pushEscHandler(() => { this._close('back'); return true; });
    }
    const applyBtn = this.el.querySelector('[data-act="apply"]');
    if (applyBtn) applyBtn.focus();
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  _close(answer) {
    if (this.el) this.el.classList.add('hidden');
    this._escUnsub?.();
    this._escUnsub = null;
    const resolve = this._resolve;
    this._resolve = null;
    if (resolve) resolve(answer);
  }

  _build() {
    // The root lives in index.html so the dialog has a stable place in the DOM
    // (and in the stylesheet) rather than materialising on first use; fall back
    // to creating it for hosts that load the module without the markup.
    let el = document.getElementById('apply-preview-dialog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'apply-preview-dialog';
      el.classList.add('hidden');
      el.innerHTML = `
        <div class="apv-header">
          <span class="apv-title">Apply Changes</span>
          <button class="apv-close" title="Back to editing">&times;</button>
        </div>
        <div class="apv-body"></div>
        <div class="apv-footer">
          <button class="apv-btn apv-btn-primary" data-act="apply">Apply</button>
          <button class="apv-btn" data-act="back">Back to editing</button>
        </div>`;
      document.body.appendChild(el);
    }
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'apply-preview-dialog-title');
    const title = el.querySelector('.apv-title');
    if (title) title.id = 'apply-preview-dialog-title';
    const close = el.querySelector('.apv-close');
    if (close) {
      close.type = 'button';
      close.setAttribute('aria-label', 'Back to editing');
    }
    this.el = el;

    el.querySelector('.apv-close')?.addEventListener('click', () => this._close('back'));
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this._close(btn.dataset.act === 'apply' ? 'apply' : 'back');
    });
    const header = el.querySelector('.apv-header');
    // freezeTransform because the panel is centred with a translate(-50%,-50%):
    // without it the first drag snaps the dialog half its size up and left.
    if (header) {
      makeDraggable(el, header, {
        exclude: '.apv-close',
        freezeTransform: true,
        grabCursor: true,
      });
    }
  }

  _render(summary, opts) {
    const title = this.el.querySelector('.apv-title');
    if (title) {
      title.textContent = opts.title || (opts.name
        ? `Apply changes to ${opts.name}`
        : 'Apply changes');
    }

    const applyBtn = this.el.querySelector('[data-act="apply"]');
    const backBtn = this.el.querySelector('[data-act="back"]');
    const closeBtn = this.el.querySelector('.apv-close');
    const applyLabel = opts.applyLabel || 'Apply';
    const backLabel = opts.backLabel || 'Back to editing';
    if (applyBtn) applyBtn.textContent = applyLabel;
    if (backBtn) backBtn.textContent = backLabel;
    if (closeBtn) {
      closeBtn.title = backLabel;
      closeBtn.setAttribute('aria-label', backLabel);
    }

    const additions = [];
    for (const add of summary.adds || []) {
      additions.push(this._row('+', 'apv-add', this._label(add), money(add.cost)));
    }
    const deletions = [];
    for (const rm of summary.removes || []) {
      deletions.push(this._row('−', 'apv-remove', this._label(rm),
        opts.freeConstruction ? 'destroyed · no sandbox refund' : `+${money(rm.refund)} refund`));
    }
    const notices = [];
    if (opts.freeConstruction) {
      notices.push(this._row('◇', 'apv-move',
        'Free construction is on — the quoted price will not be charged', ''));
    }
    if (summary.movedCount > 0) {
      const d = summary.movedDistanceM;
      notices.push(this._row('↕', 'apv-move',
        `${summary.movedCount} module${summary.movedCount === 1 ? '' : 's'} shift downstream`
        + (d ? ` ${Number(d).toFixed(1)} m` : ''), ''));
    }
    if (summary.danglingLineCount > 0) {
      notices.push(this._row('⚡', 'apv-warn',
        `${summary.danglingLineCount} utility line`
        + `${summary.danglingLineCount === 1 ? '' : 's'} need rewiring`, ''));
    }
    for (const warning of summary.warnings || []) {
      notices.push(this._row('⚠', 'apv-warn', esc(warning.label || warning),
        warning.value || ''));
    }

    const total = summary.totalCost || 0;
    const totalText = total >= 0 ? money(total) : `${money(-total)} back`;
    const body = this.el.querySelector('.apv-body');
    body.innerHTML = `
      ${this._section('New', additions)}
      ${this._section('Deleted', deletions)}
      ${notices.length ? this._section('Other changes', notices, '') : ''}
      <div class="apv-total">
        <span class="apv-total-label">${opts.freeConstruction ? 'Nominal net cost' : 'Net cost'}</span>
        <span class="apv-total-value ${total > 0 ? 'apv-cost' : 'apv-credit'}">${esc(totalText)}</span>
      </div>`;
  }

  // "3 × Quad" / "Beam Pipe 4.0 m" — the metres come off the drift row only,
  // where a count of "3" would describe three extend ops rather than length.
  _label(row) {
    if (row.label) {
      const name = esc(row.label);
      if (row.metres) return `${name} ${Number(row.metres).toFixed(1)} m`;
      return row.count > 1 ? `${row.count} × ${name}` : name;
    }
    const name = displayName(row.type);
    if (row.metres) return `${esc(name)} ${Number(row.metres).toFixed(1)} m`;
    return row.count > 1 ? `${row.count} × ${esc(name)}` : esc(name);
  }

  _section(title, rows, emptyText = 'None') {
    const content = rows.length
      ? `<div class="apv-rows">${rows.join('')}</div>`
      : `<div class="apv-section-empty">${esc(emptyText)}</div>`;
    return `<section class="apv-section">`
      + `<div class="apv-section-title">${esc(title)}</div>`
      + content
      + '</section>';
  }

  _row(sign, cls, label, value) {
    return `<div class="apv-row ${cls}">`
      + `<span class="apv-sign">${sign}</span>`
      + `<span class="apv-label">${label}</span>`
      + `<span class="apv-value">${esc(value)}</span>`
      + '</div>';
  }
}

// One instance per session: the dialog is modal, so a second concurrent open
// is not a thing that can happen.
export const applyPreviewDialog = new ApplyPreviewDialog();

export default applyPreviewDialog;
