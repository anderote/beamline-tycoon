// src/ui/OptionsDialog.js — Options dialog (Menu > Options).
// Styled to match the welcome/guide + save/load dialogs (pixel bevel panel,
// Press Start 2P gold header); draggable by its header, Esc/✕ closes.
//
// Only settings wired to real, working code appear here:
//  - Music: volume / play-pause / theme — driven through the MusicPlayer's own
//    controls (we dispatch events on its slider/select) so its persistence
//    (localStorage 'beamlineTycoon.music') stays in one place.
//  - View: zone overlay (O) and zone labels (L) — session flags on the
//    3D renderer, same as the hotkeys; intentionally not persisted. Glow &
//    dynamic lighting is the exception in this section: it IS persisted
//    (localStorage 'beamlineTycoon.glow'), same convention as devMode/
//    sandboxMode below, so the renderer can read it back at construction.
//  - Gameplay: dev mode — game.setDevMode() persists it itself.

import { makeDraggable } from './draggable.js';
import { pushEscHandler } from './esc-stack.js';
import { openWikiWindow } from './WikiWindow.js';
import { SELECTION_CATEGORIES } from '../game/selection-targets.js';

export class OptionsDialog {
  constructor({ game, renderer, musicPlayer, inputHandler = null }) {
    this.game = game;
    this.renderer = renderer;
    this.musicPlayer = musicPlayer;
    this.inputHandler = inputHandler;
    this.el = null;
  }

  open() {
    if (!this.el) this._build();
    this._sync();
    this.el.classList.remove('hidden');
    // Esc closes: pushed on open / released on close, so whatever opened
    // most recently owns the key (single Esc owner — see esc-stack.js).
    if (!this._escUnsub) {
      this._escUnsub = pushEscHandler(() => {
        this.close();
        return true;
      });
    }
  }

  close() {
    if (this.el) this.el.classList.add('hidden');
    this._escUnsub?.();
    this._escUnsub = null;
  }

  get isOpen() {
    return !!this.el && !this.el.classList.contains('hidden');
  }

  // Refresh every control from live game/renderer/player state.
  _sync() {
    const mp = this.musicPlayer;

    const vol = this.el.querySelector('#opt-music-vol');
    vol.value = mp.audio.volume;
    this._updateVolReadout();

    this.el.querySelector('#opt-music-play').checked = mp.isPlaying;

    // Theme list loads async (fetch of tracks.json) — rebuild on every open.
    const themeSel = this.el.querySelector('#opt-music-theme');
    themeSel.innerHTML = '';
    if (mp.themeNames.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No music found';
      themeSel.appendChild(opt);
      themeSel.disabled = true;
    } else {
      for (const name of mp.themeNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        themeSel.appendChild(opt);
      }
      themeSel.disabled = false;
      if (mp.currentTheme) themeSel.value = mp.currentTheme;
    }

    this.el.querySelector('#opt-zone-overlay').checked =
      this.renderer.zoneOverlayVisible !== false;
    this.el.querySelector('#opt-zone-labels').checked =
      this.renderer.showZoneLabels !== false;
    this.el.querySelector('#opt-glow').checked = this.renderer.glowEnabled;
    this.el.querySelector('#opt-volumetric').checked = this.renderer.volumetricEnabled;
    this.el.querySelector('#opt-lighting-quality').value = this.renderer.lightingQuality;

    this.el.querySelector('#opt-dev-mode').checked = !!this.game.devMode;
    this.el.querySelector('#opt-sandbox-mode').checked = !!this.game.sandboxMode;
    const selectionCategories = this.inputHandler?.mouseSelectionCategories?.() || new Set();
    for (const category of SELECTION_CATEGORIES) {
      const control = this.el.querySelector(`[data-mouse-selection-category="${category.key}"]`);
      if (control) control.checked = selectionCategories.has(category.key);
    }
  }

  _updateVolReadout() {
    const vol = this.el.querySelector('#opt-music-vol');
    this.el.querySelector('.opt-vol-readout').textContent =
      Math.round(parseFloat(vol.value) * 100) + '%';
  }

  _build() {
    const selectionRows = SELECTION_CATEGORIES.map(category => `
      <div class="opt-row">
        <label class="opt-label" for="opt-select-${category.key}">${category.label}</label>
        <input type="checkbox" id="opt-select-${category.key}" class="opt-check"
          data-mouse-selection-category="${category.key}">
      </div>
    `).join('');
    const el = document.createElement('div');
    el.id = 'options-dialog';
    el.classList.add('hidden');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'options-dialog-title');
    el.innerHTML = `
      <div class="opt-header">
        <span class="opt-title" id="options-dialog-title">Options</span>
        <button type="button" class="opt-close" title="Close" aria-label="Close">×</button>
      </div>
      <div class="opt-body">
        <div class="opt-section-title">Music</div>
        <div class="opt-row">
          <label class="opt-label" for="opt-music-vol">Volume</label>
          <span class="opt-control">
            <input type="range" id="opt-music-vol" class="opt-slider" min="0" max="1" step="0.05">
            <span class="opt-vol-readout">0%</span>
          </span>
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-music-play">Music playing</label>
          <input type="checkbox" id="opt-music-play" class="opt-check">
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-music-theme">Soundtrack theme</label>
          <select id="opt-music-theme" class="opt-select"></select>
        </div>

        <div class="opt-section-title">View</div>
        <div class="opt-row">
          <label class="opt-label" for="opt-zone-overlay">Zone overlay <span class="opt-kbd">O</span></label>
          <input type="checkbox" id="opt-zone-overlay" class="opt-check">
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-zone-labels">Zone labels <span class="opt-kbd">L</span></label>
          <input type="checkbox" id="opt-zone-labels" class="opt-check">
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-glow">Glow &amp; dynamic lighting</label>
          <input type="checkbox" id="opt-glow" class="opt-check">
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-volumetric">Volumetric atmosphere</label>
          <input type="checkbox" id="opt-volumetric" class="opt-check">
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-lighting-quality">Lighting quality</label>
          <select id="opt-lighting-quality" class="opt-select">
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select>
        </div>

        <div class="opt-section-title">Gameplay</div>
        <div class="opt-row">
          <label class="opt-label" for="opt-dev-mode">Dev Mode (unlimited funding)</label>
          <input type="checkbox" id="opt-dev-mode" class="opt-check">
        </div>
        <div class="opt-row">
          <label class="opt-label" for="opt-sandbox-mode">Balance sandbox (free build, live income/upkeep)</label>
          <input type="checkbox" id="opt-sandbox-mode" class="opt-check">
        </div>

        <div class="opt-section-title">Mouse selection</div>
        <div class="opt-section-note">Categories selected by clicks and new drag boxes</div>
        ${selectionRows}

        <div class="opt-section-title">Help</div>
        <div class="opt-row">
          <span class="opt-label">Operator Manual <span class="opt-kbd">F1</span></span>
          <button id="opt-open-wiki" class="opt-btn">Open Manual</button>
        </div>

        <div class="opt-note">Settings apply immediately.</div>
      </div>
    `;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector('.opt-close').addEventListener('click', () => this.close());

    const mp = this.musicPlayer;

    // Volume — forward through the music player's own slider so its handler
    // (set audio.volume + persist) stays the single source of truth.
    el.querySelector('#opt-music-vol').addEventListener('input', (e) => {
      mp.volumeSlider.value = e.target.value;
      mp.volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
      this._updateVolReadout();
    });

    // Play / pause
    el.querySelector('#opt-music-play').addEventListener('change', (e) => {
      if (e.target.checked !== mp.isPlaying) mp.togglePlay();
    });
    // Keep the checkbox honest if playback changes elsewhere (player UI,
    // track-end autoplay, autoplay-blocked resume).
    const syncPlay = () => {
      if (this.el) this.el.querySelector('#opt-music-play').checked = mp.isPlaying;
    };
    mp.audio.addEventListener('play', syncPlay);
    mp.audio.addEventListener('pause', syncPlay);

    // Theme — forward through the player's own select for the same reason.
    el.querySelector('#opt-music-theme').addEventListener('change', (e) => {
      if (!mp.themeSelect) return;
      mp.themeSelect.value = e.target.value;
      mp.themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // View flags — session-only, matching the O / L hotkeys.
    el.querySelector('#opt-zone-overlay').addEventListener('change', (e) => {
      if (e.target.checked !== (this.renderer.zoneOverlayVisible !== false)) {
        this.renderer.toggleZoneOverlay();
      }
    });
    el.querySelector('#opt-zone-labels').addEventListener('change', (e) => {
      if (e.target.checked !== (this.renderer.showZoneLabels !== false)) {
        this.renderer.toggleZoneLabels();
      }
    });
    // Glow, unlike the two flags above, persists — same convention as
    // devMode/sandboxMode below (localStorage '1'/'0').
    el.querySelector('#opt-glow').addEventListener('change', (e) => {
      this.renderer.setGlowEnabled(e.target.checked);
      try { localStorage.setItem('beamlineTycoon.glow', e.target.checked ? '1' : '0'); } catch (_) {}
    });
    el.querySelector('#opt-volumetric').addEventListener('change', (e) => {
      this.renderer.setVolumetricEnabled(e.target.checked);
      try { localStorage.setItem('beamlineTycoon.volumetricLighting', e.target.checked ? '1' : '0'); } catch (_) {}
    });
    el.querySelector('#opt-lighting-quality').addEventListener('change', (e) => {
      this.renderer.setLightingQuality(e.target.value);
      try { localStorage.setItem('beamlineTycoon.lightingQuality', e.target.value); } catch (_) {}
    });

    // Manual — same window the HUD "?" button and F1 open. Closing the
    // dialog first keeps the manual from opening behind it.
    el.querySelector('#opt-open-wiki').addEventListener('click', () => {
      this.close();
      openWikiWindow();
    });

    // Dev mode — setDevMode persists to localStorage itself.
    el.querySelector('#opt-dev-mode').addEventListener('change', (e) => {
      this.game.setDevMode(e.target.checked);
    });

    // Sandbox: unlike dev mode this leaves the balance real, so the player can
    // still read what the facility earns while building without the capital
    // grind. Prices stay on screen; they just are not charged.
    el.querySelector('#opt-sandbox-mode').addEventListener('change', (e) => {
      this.game.setSandboxMode(e.target.checked);
    });

    for (const control of el.querySelectorAll('[data-mouse-selection-category]')) {
      control.addEventListener('change', (e) => {
        this.inputHandler?.setMouseSelectionCategory?.(
          e.target.dataset.mouseSelectionCategory,
          e.target.checked,
        );
      });
    }

    // Draggable by header (same pattern as WelcomeDialog / SaveLoadDialog).
    makeDraggable(el, el.querySelector('.opt-header'), {
      exclude: '.opt-close',
      freezeTransform: true,
      grabCursor: true,
    });
  }
}
