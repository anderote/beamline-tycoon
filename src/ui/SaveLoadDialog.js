// src/ui/SaveLoadDialog.js — named save / load slots dialog.
// One dialog, two modes ('save' | 'load'), opened via Menu > Save Game /
// Load Game. Styled to match the welcome/guide dialog (pixel bevel panel,
// Press Start 2P headers, gold accents); draggable by its header.

import { SaveSlots } from '../game/SaveSlots.js';
import { CloudSaves, CloudAuthError } from '../game/CloudSaves.js';
import { makeDraggable } from './draggable.js';
import { pushEscHandler } from './esc-stack.js';
import { fmtMoney, escapeHtml as esc } from './format.js';

const CLOUD_SLOT_COUNT = 3;
// DTW's sign-in entry is /signup (it handles both sign-in and sign-up),
// with `redirect` as its return-path param.
const SIGNIN_URL = '/signup?redirect=%2Fbeamline-tycoon';

function fmtDate(ms) {
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class SaveLoadDialog {
  constructor(game) {
    this.game = game;
    this.mode = 'save';
    this.el = null;
    // Cloud-mode state, rebuilt each time the dialog opens in cloud mode:
    // { phase: 'loading'|'ready'|'signin'|'error', slots, busy, error }
    // slots: { [slot]: { slot, name, meta, updatedAt } }, busy: { slot, label }.
    this._cloud = null;
  }

  // Cloud slots are used when the DTW cloud-save API was detected at boot.
  // Local dev (no API) keeps the original localStorage slot UI untouched.
  _cloudActive() {
    return !!this.game.cloud?.available;
  }

  open(mode) {
    this.mode = mode === 'load' ? 'load' : 'save';
    if (!this.el) this._build();
    if (this._cloudActive()) {
      this._cloud = { phase: 'loading', slots: null, busy: null, error: null };
      this._syncHeaderUser();
      this._renderCloud();
      this._cloudRefresh();
    } else {
      this._cloud = null;
      this._syncHeaderUser();
      this._render();
    }
    this.el.classList.remove('hidden');
    // Esc closes: pushed on open / released on close, so whatever opened
    // most recently owns the key (single Esc owner — see esc-stack.js).
    if (!this._escUnsub) {
      this._escUnsub = pushEscHandler(() => {
        this.close();
        return true;
      });
    }
    if (this.mode === 'save' && !this._cloud) {
      const input = this.el.querySelector('.sl-name-input');
      if (input) { input.focus(); input.select(); }
    }
  }

  // "Signed in as <name>" in the header — cloud mode only.
  _syncHeaderUser() {
    const header = this.el.querySelector('.sl-header');
    let span = header.querySelector('.sl-cloud-user');
    const name = this._cloud && this.game.cloud?.user?.name;
    if (name) {
      if (!span) {
        span = document.createElement('span');
        span.className = 'sl-cloud-user';
        header.insertBefore(span, header.querySelector('.sl-close'));
      }
      span.textContent = `Signed in as ${name}`;
    } else if (span) {
      span.remove();
    }
  }

  close() {
    if (this.el) this.el.classList.add('hidden');
    this._escUnsub?.();
    this._escUnsub = null;
  }

  // Small state summary stored alongside each slot for the list UI.
  _buildMeta() {
    const s = this.game.state;
    return {
      funding: Math.floor(s.resources?.funding ?? 0),
      staff: (s.staffMembers || []).length,
      // Decorations (trees etc. from map gen) aren't "components" — skip them.
      components: (s.placeables || []).filter(p => p.category !== 'decoration').length,
      tick: s.tick || 0,
    };
  }

  _defaultName() {
    return `Save ${SaveSlots.list().length + 1}`;
  }

  _metaLine(slot) {
    const m = slot.meta || {};
    const bits = [];
    if (m.funding != null) bits.push(fmtMoney(m.funding));
    if (m.staff != null) bits.push(`${m.staff} staff`);
    if (m.components != null) bits.push(`${m.components} components`);
    return bits.join(' · ');
  }

  _render() {
    const save = this.mode === 'save';
    this.el.querySelector('.sl-title').textContent = save ? 'Save Game' : 'Load Game';

    const slots = SaveSlots.list();
    let rows = '';

    if (save) {
      rows += `
        <div class="sl-row sl-row-new" data-act="new">
          <div class="sl-row-name">+ NEW SLOT</div>
          <div class="sl-row-sub">save to a fresh slot</div>
        </div>`;
    }

    if (slots.length === 0 && !save) {
      rows += `
        <div class="sl-empty">
          No saved games yet.<br>
          Build something great, then Menu &gt; Save Game.
        </div>`;
    } else {
      for (const slot of slots) {
        rows += `
          <div class="sl-row" data-id="${esc(slot.id)}">
            <div class="sl-row-main">
              <div class="sl-row-name">${esc(slot.name)}</div>
              <div class="sl-row-sub">${fmtDate(slot.savedAt)}${this._metaLine(slot) ? ' &nbsp;·&nbsp; ' + this._metaLine(slot) : ''}</div>
            </div>
            <button class="sl-row-del" data-del="${esc(slot.id)}" title="Delete slot">✕</button>
          </div>`;
      }
      if (slots.length === 0 && save) {
        rows += `<div class="sl-empty">No existing slots — this will be your first.</div>`;
      }
    }

    const body = this.el.querySelector('.sl-body');
    body.innerHTML = `
      ${save ? `
        <div class="sl-name-block">
          <div class="sl-label">Save name</div>
          <input class="sl-name-input" type="text" maxlength="40" value="${esc(this._defaultName())}">
        </div>
        <div class="sl-label">${slots.length ? 'Slots — click one to overwrite' : 'Slots'}</div>` : `
        <div class="sl-label">Click a save to load it</div>`}
      <div class="sl-list">${rows}</div>
    `;

    const footer = this.el.querySelector('.sl-footer');
    footer.innerHTML = save
      ? `<button class="sl-btn sl-btn-primary" data-act="save-new">SAVE</button>
         <button class="sl-btn" data-act="cancel">CANCEL</button>`
      : `<button class="sl-btn" data-act="cancel">CANCEL</button>`;
  }

  _doSave(slotId, name) {
    const id = SaveSlots.saveTo(slotId, name, this.game.serialize(), this._buildMeta());
    // Keep the autosave/active key fresh too — matches the old quick-save feel.
    this.game.save();
    this.game.log('Game saved.', 'good');
    this.close();
    return id;
  }

  _doLoad(slotId) {
    const slot = SaveSlots.list().find(s => s.id === slotId);
    if (!slot) return;
    if (!confirm(`Load "${slot.name}"? Unsaved progress will be lost.`)) return;
    if (!SaveSlots.loadIntoActive(slotId)) {
      this.game.log('Save slot is missing or corrupted.', 'bad');
      return;
    }
    sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
    location.reload();
  }

  // ---------------------------------------------------------------- cloud --

  _cloudDefaultName() {
    const used = Object.keys(this._cloud?.slots || {}).length;
    return `Save ${used + 1}`;
  }

  // Fetch the slot list and move to 'ready' (or 'signin'/'error').
  async _cloudRefresh() {
    if (this.game.cloud?.signedIn === false) {
      this._cloud.phase = 'signin';
      this._renderCloud();
      return;
    }
    try {
      const saves = await CloudSaves.list();
      const slots = {};
      for (const s of saves) slots[s.slot] = s;
      this._cloud.slots = slots;
      this._cloud.phase = 'ready';
    } catch (err) {
      this._cloudFail(err, 'Could not reach cloud saves.');
    }
    this._renderCloud();
  }

  _cloudFail(err, fallbackMsg) {
    if (err instanceof CloudAuthError) {
      // Session expired mid-flight — flip the boot flag so reopening the
      // dialog goes straight to the sign-in state too.
      if (this.game.cloud) this.game.cloud.signedIn = false;
      this._cloud.phase = 'signin';
    } else {
      this._cloud.error = err?.status === 400
        ? 'Save rejected by the server — it may exceed the 2 MB cloud limit.'
        : (fallbackMsg || 'Cloud save request failed. Try again.');
      if (this._cloud.phase === 'loading') this._cloud.phase = 'error';
    }
  }

  _gotoSignin() {
    // We run inside an iframe on deep-tech-week.com; navigate the top-level
    // page to the sign-in flow. Cross-origin guards just in case.
    try { window.top.location.href = SIGNIN_URL; }
    catch (_) { try { window.location.href = SIGNIN_URL; } catch (_) {} }
  }

  async _cloudSave(slot) {
    const c = this._cloud;
    const existing = c.slots[slot];
    const input = this.el.querySelector('.sl-name-input');
    const name = ((input?.value || '').trim() || this._cloudDefaultName()).slice(0, 60);
    if (existing && !confirm(`Overwrite "${existing.name}" in SLOT ${slot}?`)) return;
    c.busy = { slot, label: 'SAVING…' };
    c.error = null;
    this._renderCloud();
    try {
      await CloudSaves.save(slot, name, this.game.serialize(), this._buildMeta());
      // Keep the local autosave/active key fresh too — autosave stays
      // local-only in both modes; cloud slots are explicit saves.
      this.game.save();
      this.game.log(`Game saved to cloud slot ${slot}.`, 'good');
      this.close();
      return;
    } catch (err) {
      this._cloudFail(err, 'Cloud save failed. Try again.');
    }
    c.busy = null;
    this._renderCloud();
  }

  async _cloudLoad(slot) {
    const c = this._cloud;
    const entry = c.slots[slot];
    if (!entry) return;
    if (!confirm(`Load "${entry.name}"? Unsaved progress will be lost.`)) return;
    c.busy = { slot, label: 'LOADING…' };
    c.error = null;
    this._renderCloud();
    try {
      const rec = await CloudSaves.load(slot);
      if (!rec || typeof rec.payload !== 'string' || !rec.payload) {
        throw new Error('empty payload');
      }
      // Mirror the local flow: write into the active key and reload.
      localStorage.setItem('beamlineTycoon', rec.payload);
      sessionStorage.setItem('beamlineTycoon.skipTitle', '1');
      location.reload();
      return;
    } catch (err) {
      this._cloudFail(err, 'Could not load that cloud save.');
    }
    c.busy = null;
    this._renderCloud();
  }

  async _cloudDelete(slot) {
    const c = this._cloud;
    const entry = c.slots[slot];
    if (!entry) return;
    if (!confirm(`Delete "${entry.name}" from SLOT ${slot}? This can't be undone.`)) return;
    c.busy = { slot, label: 'DELETING…' };
    c.error = null;
    this._renderCloud();
    try {
      await CloudSaves.remove(slot);
      delete c.slots[slot];
    } catch (err) {
      this._cloudFail(err, 'Could not delete that cloud save.');
    }
    c.busy = null;
    this._renderCloud();
  }

  _renderCloud() {
    const c = this._cloud;
    if (!c) return;
    const save = this.mode === 'save';
    this.el.querySelector('.sl-title').textContent = save ? 'Save Game' : 'Load Game';
    const body = this.el.querySelector('.sl-body');
    const footer = this.el.querySelector('.sl-footer');

    if (c.phase === 'signin') {
      body.innerHTML = `
        <div class="sl-empty">
          Session expired — sign in again<br>to use cloud saves.
        </div>`;
      footer.innerHTML = `
        <button class="sl-btn sl-btn-primary" data-act="cloud-signin">SIGN IN</button>
        <button class="sl-btn" data-act="cancel">CANCEL</button>`;
      return;
    }

    if (c.phase === 'loading') {
      body.innerHTML = `<div class="sl-empty">Loading cloud slots…</div>`;
      footer.innerHTML = `<button class="sl-btn" data-act="cancel">CANCEL</button>`;
      return;
    }

    if (c.phase === 'error') {
      body.innerHTML = `<div class="sl-empty sl-error">${esc(c.error || 'Cloud saves unavailable.')}</div>`;
      footer.innerHTML = `<button class="sl-btn" data-act="cancel">CANCEL</button>`;
      return;
    }

    // phase 'ready' — the 3 fixed slots.
    const busy = c.busy;
    let rows = '';
    for (let slot = 1; slot <= CLOUD_SLOT_COUNT; slot++) {
      const entry = c.slots[slot];
      const isBusy = busy && busy.slot === slot;
      if (entry) {
        const metaLine = this._metaLine(entry);
        const when = fmtDate(new Date(entry.updatedAt).getTime());
        rows += `
          <div class="sl-row${busy ? ' sl-row-disabled' : ''}" data-cslot="${slot}">
            <div class="sl-row-main">
              <div class="sl-row-name"><span class="sl-slotnum">SLOT ${slot}</span>${esc(entry.name)}</div>
              <div class="sl-row-sub">${isBusy ? esc(busy.label) : when + (metaLine ? ' &nbsp;·&nbsp; ' + metaLine : '')}</div>
            </div>
            <button class="sl-row-del" data-cdel="${slot}" title="Delete slot" ${busy ? 'disabled' : ''}>✕</button>
          </div>`;
      } else {
        rows += `
          <div class="sl-row sl-row-emptyslot${busy ? ' sl-row-disabled' : ''}"${save ? ` data-cslot="${slot}"` : ''}>
            <div class="sl-row-main">
              <div class="sl-row-name"><span class="sl-slotnum">SLOT ${slot}</span><span class="sl-slot-empty">EMPTY</span></div>
              <div class="sl-row-sub">${isBusy ? esc(busy.label) : (save ? 'click to save here' : 'no save in this slot')}</div>
            </div>
          </div>`;
      }
    }

    // Preserve any name the player already typed across re-renders.
    const prevInput = this.el.querySelector('.sl-name-input');
    const nameValue = prevInput ? prevInput.value : this._cloudDefaultName();

    body.innerHTML = `
      ${save ? `
        <div class="sl-name-block">
          <div class="sl-label">Save name</div>
          <input class="sl-name-input" type="text" maxlength="60" value="${esc(nameValue)}" ${busy ? 'disabled' : ''}>
        </div>
        <div class="sl-label">Cloud slots — click one to save</div>` : `
        <div class="sl-label">Click a cloud save to load it</div>`}
      <div class="sl-list">${rows}</div>
      ${c.error ? `<div class="sl-error">${esc(c.error)}</div>` : ''}
    `;
    footer.innerHTML = `<button class="sl-btn" data-act="cancel" ${busy ? 'disabled' : ''}>CANCEL</button>`;

    if (save && !busy) {
      const input = this.el.querySelector('.sl-name-input');
      if (input && !prevInput) { input.focus(); input.select(); }
    }
  }

  _onCloudClick(e) {
    const c = this._cloud;
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'cancel') { this.close(); return; }
      if (act === 'cloud-signin') { this._gotoSignin(); return; }
    }
    if (c.phase !== 'ready' || c.busy) return;

    const delBtn = e.target.closest('.sl-row-del[data-cdel]');
    if (delBtn) {
      this._cloudDelete(Number(delBtn.dataset.cdel));
      return;
    }
    const row = e.target.closest('.sl-row[data-cslot]');
    if (row) {
      const slot = Number(row.dataset.cslot);
      if (this.mode === 'save') this._cloudSave(slot);
      else this._cloudLoad(slot);
    }
  }

  // ---------------------------------------------------------------- build --

  _build() {
    const el = document.createElement('div');
    el.id = 'saveload-dialog';
    el.classList.add('hidden');
    el.innerHTML = `
      <div class="sl-header">
        <span class="sl-title">Save Game</span>
        <button class="sl-close" title="Close">×</button>
      </div>
      <div class="sl-body"></div>
      <div class="sl-footer"></div>
    `;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector('.sl-close').addEventListener('click', () => this.close());

    el.addEventListener('click', (e) => {
      // Cloud mode routes to its own handler; local behavior is unchanged.
      if (this._cloud) { this._onCloudClick(e); return; }

      // Delete button (both modes)
      const delBtn = e.target.closest('.sl-row-del');
      if (delBtn) {
        const id = delBtn.dataset.del;
        const slot = SaveSlots.list().find(s => s.id === id);
        if (slot && confirm(`Delete "${slot.name}"? This can't be undone.`)) {
          SaveSlots.remove(id);
          this._render();
        }
        return;
      }

      // Footer buttons
      const btn = e.target.closest('[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'cancel') { this.close(); return; }
        if (act === 'save-new' || act === 'new') {
          const input = this.el.querySelector('.sl-name-input');
          const name = (input?.value || '').trim() || this._defaultName();
          this._doSave(null, name);
          return;
        }
      }

      // Slot rows
      const row = e.target.closest('.sl-row[data-id]');
      if (row) {
        const id = row.dataset.id;
        if (this.mode === 'save') {
          const slot = SaveSlots.list().find(s => s.id === id);
          if (slot && confirm(`Overwrite "${slot.name}"?`)) {
            this._doSave(id, slot.name);
          }
        } else {
          this._doLoad(id);
        }
      }
    });

    // Enter in the name input = save to new slot.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList?.contains('sl-name-input')) {
        if (this._cloud) {
          // Cloud mode: Enter saves to the first empty slot, if any.
          if (this._cloud.phase === 'ready' && !this._cloud.busy) {
            for (let slot = 1; slot <= CLOUD_SLOT_COUNT; slot++) {
              if (!this._cloud.slots[slot]) { this._cloudSave(slot); break; }
            }
          }
        } else {
          const name = e.target.value.trim() || this._defaultName();
          this._doSave(null, name);
        }
      }
      // (Esc-to-close lives on the global esc-stack, pushed in open().)
    });

    // Draggable by header (same pattern as WelcomeDialog).
    makeDraggable(el, el.querySelector('.sl-header'), {
      exclude: '.sl-close',
      freezeTransform: true,
      grabCursor: true,
    });
  }
}
