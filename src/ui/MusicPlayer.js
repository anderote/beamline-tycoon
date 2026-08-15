// src/ui/MusicPlayer.js — Simple music player with shuffle, auto-advance, and persistent state

import { makeDraggable } from './draggable.js';

// The welcome/title screen always opens on this track (matched on its name):
// "01 - Russian Doomer music Vol 1 (Night Drive)".
const WELCOME_TRACK_MATCH = 'night drive';
const MUSIC_STATE_KEY = 'beamlineTycoon.music';

/** A filename survives manifest reordering and server rebuilds; currentIndex
 *  remains as a legacy fallback for music state saved by earlier versions. */
export function resolveSavedTrackIndex(tracks, saved) {
  if (!Array.isArray(tracks) || !saved) return -1;
  if (typeof saved.currentTrackFile === 'string') {
    const byFile = tracks.findIndex(track => track.file === saved.currentTrackFile);
    if (byFile >= 0) return byFile;
  }
  return Number.isInteger(saved.currentIndex)
    && saved.currentIndex >= 0
    && saved.currentIndex < tracks.length
    ? saved.currentIndex
    : -1;
}

export function hasSavedPlayback(saved) {
  return !!saved
    && typeof saved.selectedTheme === 'string'
    && (typeof saved.currentTrackFile === 'string'
      || (Number.isInteger(saved.currentIndex) && saved.currentIndex >= 0));
}

export class MusicPlayer {
  constructor() {
    this.themes = {};          // { themeName: [file, ...] }
    this.themeNames = [];      // sorted theme names
    this.currentTheme = null;
    this.tracks = [];
    this.currentIndex = -1;
    this.audio = new Audio();
    this.audio.volume = 0.4;
    // Start silently unless the player explicitly enables soundtrack audio.
    this.audio.muted = true;
    // Global handle so lightweight UI (e.g. the title-screen mute toggle) can
    // reach the player without threading a reference through every screen.
    try { window.__blMusic = this; } catch { /* no window */ }
    this.isPlaying = false;
    this.shuffled = false;
    this.shuffleOrder = [];
    this._pendingResumeTime = 0;
    this._lastPositionSave = 0;
    this._stateReady = false;

    // DOM references
    this.el = document.getElementById('music-player');
    this.trackNameWrap = this.el.querySelector('.mp-track-name-wrap');
    this.trackNameBtn = this.el.querySelector('.mp-track-name');
    this.trackNameEl = this.el.querySelector('.mp-track-name-inner');
    this.trackListEl = this.el.querySelector('.mp-track-list');
    this.trackListOpen = false;
    this.playBtn = this.el.querySelector('.mp-play');
    this.prevBtn = this.el.querySelector('.mp-prev');
    this.nextBtn = this.el.querySelector('.mp-next');
    this.shuffleBtn = this.el.querySelector('.mp-shuffle');
    this.volumeSlider = this.el.querySelector('.mp-volume');
    this.themeSelect = this.el.querySelector('.mp-theme');
    this.minimizeBtn = this.el.querySelector('.mp-minimize');
    this.minimized = false;
    this._embedded = !!this.el.closest('#top-buttons');

    // Drag / position state
    this._customPos = null;      // { left, top } once the user has dragged the player
    this._suppressClick = false; // swallow the click that follows a drag

    this._bindEvents();
    // The in-game player lives with the top-bar actions. Keep the
    // draggable positioning support for any standalone embedding, but never
    // let a saved floating position tear the HUD layout apart.
    if (!this._embedded) {
      this._initPosition();
      this._initDrag();
    }
    this._loadTracks();
  }

  // === Positioning ===

  static POS_KEY = 'beamlineTycoon.musicPlayerPos';

  _initPosition() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(MusicPlayer.POS_KEY));
    } catch {}
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      this._setPosition(saved.left, saved.top);
    } else {
      this._applyDefaultPosition();
    }

    // Keep the default position below the top bar even as the bar's height
    // changes (staff portraits load, buttons wrap at narrow widths).
    const topBar = document.getElementById('top-bar');
    if (topBar && typeof ResizeObserver !== 'undefined') {
      this._topBarObserver = new ResizeObserver(() => {
        if (!this._customPos) this._applyDefaultPosition();
      });
      this._topBarObserver.observe(topBar);
    }

    window.addEventListener('resize', () => {
      if (this._customPos) {
        // Re-clamp a dragged position so the player can't be lost off-screen
        this._setPosition(this._customPos.left, this._customPos.top);
        this._savePosition();
      } else {
        this._applyDefaultPosition();
      }
    });
  }

  // Default: right-aligned (CSS `right: 12px`), just below the top bar
  _applyDefaultPosition() {
    const topBar = document.getElementById('top-bar');
    const barBottom = topBar ? topBar.getBoundingClientRect().bottom : 48;
    this.el.style.left = '';
    this.el.style.right = '';
    this.el.style.top = Math.max(0, Math.round(barBottom + 8)) + 'px';
  }

  _setPosition(left, top) {
    const rect = this.el.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const clampedLeft = Math.min(Math.max(0, Math.round(left)), maxLeft);
    const clampedTop = Math.min(Math.max(0, Math.round(top)), maxTop);
    this.el.style.left = clampedLeft + 'px';
    this.el.style.top = clampedTop + 'px';
    this.el.style.right = 'auto';
    this._customPos = { left: clampedLeft, top: clampedTop };
  }

  _savePosition() {
    if (!this._customPos) return;
    try {
      localStorage.setItem(MusicPlayer.POS_KEY, JSON.stringify(this._customPos));
    } catch {}
  }

  _initDrag() {
    makeDraggable(this.el, this.el, {
      button: 0,
      // Only drag from the bar background / track-name area — not the
      // buttons, theme select, volume slider, or the open track list.
      exclude: '.mp-btn, .mp-theme, .mp-volume, .mp-track-list',
      // Small threshold so a plain click on the track name still opens the list
      threshold: 4,
      onStart: () => {
        const r = this.el.getBoundingClientRect();
        return { ox: r.left, oy: r.top };
      },
      onMove: (e, dx, dy, s) => {
        this.el.style.cursor = 'grabbing';
        this._setPosition(s.ox + dx, s.oy + dy);
      },
      onEnd: (e, moved) => {
        this.el.style.cursor = '';
        if (moved) {
          this._suppressClick = true;
          setTimeout(() => { this._suppressClick = false; }, 0);
          this._savePosition();
        }
      },
    });
  }

  async _loadTracks() {
    // Prefer the object-storage soundtrack in development so a checkout does
    // not need the large, personal music library. The web build relocates that
    // manifest to music/tracks.json, so retain the bundled-manifest fallback.
    // Relative paths keep the game working when deployed under a subpath.
    let manifest = null;
    let manifestDir = 'music';
    for (const path of ['music-web/tracks.json', 'music/tracks.json']) {
      try {
        const resp = await fetch(path);
        if (!resp.ok) continue;
        manifest = await resp.json();
        manifestDir = path.replace(/\/tracks\.json$/, '');
        break;
      } catch {
        /* try the next path */
      }
    }
    // Two manifest shapes: plain { theme: [files] } (local dev scan), or
    // { baseUrl, themes } when tracks are hosted on object storage (the
    // deployed site streams from Supabase Storage instead of bundling).
    if (manifest && manifest.themes && typeof manifest.baseUrl === 'string') {
      this.baseUrl = manifest.baseUrl.replace(/\/$/, '');
      this.themes = manifest.themes;
    } else {
      this.baseUrl = manifestDir;
      this.themes = manifest || {};
    }

    this.themeNames = Object.keys(this.themes).sort();

    if (this.themeNames.length === 0) {
      this.tracks = [];
      this.trackNameEl.textContent = 'No tracks';
      this.playBtn.disabled = true;
      this.prevBtn.disabled = true;
      this.nextBtn.disabled = true;
      if (this.themeSelect) this.themeSelect.disabled = true;
      return;
    }

    this._populateThemeSelect();

    // Pull saved state (including selectedTheme) before picking a theme
    const saved = this._readSavedState();

    // On the welcome/title screen we always open on a specific track from the
    // start (not the saved resume). TitleScreen sets window.__blWelcomeMusic
    // when it mounts. Once in the game, normal save/resume takes over.
    // The welcome track is a first-run default, not a reload override. The old
    // unconditional flag made the otherwise-persisted song and time unreachable
    // on every ordinary title-screen boot.
    const forceWelcome = typeof window !== 'undefined'
      && window.__blWelcomeMusic
      && !hasSavedPlayback(saved);
    let welcomeTheme = null;
    if (forceWelcome) {
      for (const th of this.themeNames) {
        if ((this.themes[th] || []).some((f) => String(f).toLowerCase().includes(WELCOME_TRACK_MATCH))) {
          welcomeTheme = th;
          break;
        }
      }
    }

    let theme = welcomeTheme || saved?.selectedTheme;
    if (!theme || !this.themes[theme]) {
      theme = this.themes['sovietcore'] ? 'sovietcore' : this.themeNames[0];
    }
    this.currentTheme = theme;
    if (this.themeSelect) this.themeSelect.value = theme;
    this._buildTracksForCurrentTheme();

    // Restore volume + shuffle (they're global, not per-theme)
    if (saved) {
      if (typeof saved.volume === 'number') {
        this.audio.volume = saved.volume;
        this.volumeSlider.value = saved.volume;
      }
      if (saved.shuffled) {
        this.shuffled = true;
        this.shuffleBtn.classList.add('active');
        this._generateShuffleOrder();
      }
      // Saved track only applies when NOT forcing the welcome track.
      if (!welcomeTheme && saved.selectedTheme === this.currentTheme) {
        const restoredIndex = resolveSavedTrackIndex(this.tracks, saved);
        if (restoredIndex >= 0) this.currentIndex = restoredIndex;
      }
      if (saved.minimized) this._setMinimized(true);
    }

    if (this.tracks.length === 0) {
      this.trackNameEl.textContent = 'No tracks';
      this.playBtn.disabled = true;
      this.prevBtn.disabled = true;
      this.nextBtn.disabled = true;
      return;
    }

    if (welcomeTheme) {
      const wi = this.tracks.findIndex((t) =>
        String(t.name).toLowerCase().includes(WELCOME_TRACK_MATCH)
      );
      this.currentIndex = wi >= 0 ? wi : 0;
      this._pendingResumeTime = 0; // welcome track always starts from the top
    }

    if (this.currentIndex < 0) this.currentIndex = 0;
    this._updateTrackDisplay();

    // Restore playback position (skipped for the forced welcome track) + autoplay
    if (!welcomeTheme && saved && typeof saved.currentTime === 'number' && saved.currentTime > 0) {
      this._pendingResumeTime = saved.currentTime;
    }
    this.audio.src = this.tracks[this.currentIndex].url;
    this._stateReady = true;

    // A deliberate pause survives reload too. Legacy state without
    // `wasPlaying` retains the original autoplay behavior.
    if (!welcomeTheme && saved?.wasPlaying === false) {
      this.isPlaying = false;
      this._updatePlayButton();
    } else {
      this._tryAutoplay();
    }
  }

  _populateThemeSelect() {
    if (!this.themeSelect) return;
    this.themeSelect.innerHTML = '';
    for (const name of this.themeNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      this.themeSelect.appendChild(opt);
    }
    this.themeSelect.disabled = false;
  }

  _buildTracksForCurrentTheme() {
    const files = this.themes[this.currentTheme] || [];
    this.tracks = files.map(f => ({
      url: `${this.baseUrl || 'music'}/${encodeURIComponent(this.currentTheme)}/${encodeURIComponent(f)}`,
      file: String(f),
      name: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    }));
  }

  _setTheme(name) {
    if (!this.themes[name] || name === this.currentTheme) return;
    const wasPlaying = this.isPlaying;
    this.audio.pause();
    this.isPlaying = false;

    this.currentTheme = name;
    this._buildTracksForCurrentTheme();
    this.currentIndex = 0;
    if (this.shuffled) this._generateShuffleOrder();
    this._setTrackListOpen(false);

    const hasTracks = this.tracks.length > 0;
    this.playBtn.disabled = !hasTracks;
    this.prevBtn.disabled = !hasTracks;
    this.nextBtn.disabled = !hasTracks;

    if (hasTracks) {
      this._updateTrackDisplay();
      if (wasPlaying) {
        this._playTrack(this.currentIndex);
      } else {
        this._updatePlayButton();
      }
    } else {
      this.trackNameEl.textContent = 'No tracks';
      this._updatePlayButton();
    }

    this._saveState();
  }

  _bindEvents() {
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
    this.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
    this.volumeSlider.addEventListener('input', (e) => {
      this.audio.volume = parseFloat(e.target.value);
      this._saveState();
    });
    if (this.themeSelect) {
      this.themeSelect.addEventListener('change', (e) => this._setTheme(e.target.value));
    }
    if (this.minimizeBtn) {
      this.minimizeBtn.addEventListener('click', () => this._setMinimized(!this.minimized));
    }
    if (this.trackNameBtn) {
      this.trackNameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._suppressClick) return; // the click that ends a drag
        this._toggleTrackList();
      });
    }
    document.addEventListener('pointerdown', (e) => {
      if (!this.trackListOpen) return;
      if (this.trackNameWrap && !this.trackNameWrap.contains(e.target)) {
        this._setTrackListOpen(false);
      }
    });

    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => {
      // Skip broken tracks
      if (this.tracks.length > 1) this.next();
    });

    // Apply a pending resume position once the track's metadata is known
    this.audio.addEventListener('loadedmetadata', () => {
      if (this._pendingResumeTime > 0 && isFinite(this.audio.duration)) {
        if (this._pendingResumeTime < this.audio.duration - 1) {
          try { this.audio.currentTime = this._pendingResumeTime; } catch {}
        }
        this._pendingResumeTime = 0;
        this._saveState();
      }
    });

    // Persist playback position while playing (throttled to ~2s)
    this.audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - this._lastPositionSave > 2000) {
        this._lastPositionSave = now;
        this._saveState();
      }
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._updatePlayButton();
      this._saveState();
    });
    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this._updatePlayButton();
      this._saveState();
    });

    // timeupdate is deliberately throttled; pagehide captures the exact final
    // position before a reload or Vite/server rebuild replaces the document.
    window.addEventListener('pagehide', () => this._saveState());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._saveState();
    });
  }

  /**
   * Force the welcome track from the top. Used when (re)entering the title
   * screen mid-session (the first-load case is handled in _loadTracks via the
   * window.__blWelcomeMusic flag). No-op until tracks have loaded.
   */
  playWelcomeTrack() {
    // Returning to the title screen must not erase an in-progress soundtrack.
    // With no prior state this still supplies the intended first-run track.
    if (hasSavedPlayback(this._readSavedState())) return;
    if (!this.tracks || this.themeNames.length === 0) return;
    let theme = null;
    for (const th of this.themeNames) {
      if ((this.themes[th] || []).some((f) => String(f).toLowerCase().includes(WELCOME_TRACK_MATCH))) {
        theme = th;
        break;
      }
    }
    if (!theme) return;
    if (theme !== this.currentTheme) {
      this.currentTheme = theme;
      if (this.themeSelect) this.themeSelect.value = theme;
      this._buildTracksForCurrentTheme();
    }
    const wi = this.tracks.findIndex((t) => String(t.name).toLowerCase().includes(WELCOME_TRACK_MATCH));
    this.currentIndex = wi >= 0 ? wi : 0;
    this._pendingResumeTime = 0;
    this._updateTrackDisplay();
    this.audio.src = this.tracks[this.currentIndex].url;
    try { this.audio.currentTime = 0; } catch {}
    this._tryAutoplay();
  }

  _tryAutoplay() {
    const p = this.audio.play();
    if (!p || typeof p.then !== 'function') {
      this.isPlaying = !this.audio.paused;
      this._updatePlayButton();
      return;
    }
    p.then(() => {
      this.isPlaying = true;
      this._updatePlayButton();
      this.playBtn.classList.remove('mp-attention');
      this._saveState();
    }).catch(() => {
      // Autoplay blocked — start on the NEXT user interaction. On slow
      // cold boots (the web deploy) the user's first clicks can precede
      // this point, so also pulse the play button as a visible invitation
      // in case no further interaction ever arrives.
      this.isPlaying = false;
      this._updatePlayButton();
      this.playBtn.classList.add('mp-attention');
      const resume = () => {
        document.removeEventListener('pointerdown', resume, true);
        document.removeEventListener('keydown', resume, true);
        this.audio.play().then(() => {
          this.isPlaying = true;
          this._updatePlayButton();
          this.playBtn.classList.remove('mp-attention');
          this._saveState();
        }).catch(() => {});
      };
      document.addEventListener('pointerdown', resume, { capture: true, once: true });
      document.addEventListener('keydown', resume, { capture: true, once: true });
    });
  }

  togglePlay() {
    if (this.tracks.length === 0) return;
    if (this.isPlaying) {
      this.audio.pause();
      this.isPlaying = false;
    } else {
      this._playTrack(this.currentIndex);
    }
    this._updatePlayButton();
    this._saveState();
  }

  next() {
    if (this.tracks.length === 0) return;
    const order = this.shuffled ? this.shuffleOrder : this.tracks.map((_, i) => i);
    const posInOrder = order.indexOf(this.currentIndex);
    const nextPos = (posInOrder + 1) % order.length;
    this._playTrack(order[nextPos]);
  }

  prev() {
    if (this.tracks.length === 0) return;
    // If more than 3 seconds in, restart current track
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    const order = this.shuffled ? this.shuffleOrder : this.tracks.map((_, i) => i);
    const posInOrder = order.indexOf(this.currentIndex);
    const prevPos = (posInOrder - 1 + order.length) % order.length;
    this._playTrack(order[prevPos]);
  }

  toggleShuffle() {
    this.shuffled = !this.shuffled;
    this.shuffleBtn.classList.toggle('active', this.shuffled);
    if (this.shuffled) this._generateShuffleOrder();
    this._saveState();
  }

  _playTrack(index) {
    this.currentIndex = index;
    const targetUrl = this.tracks[index].url;
    const resolved = new URL(targetUrl, location.href).href;
    if (this.audio.src !== resolved) {
      this.audio.src = targetUrl;
    }
    this.audio.play().catch(() => {});
    this.isPlaying = true;
    this._updateTrackDisplay();
    this._updatePlayButton();
    this._saveState();
  }

  _updateTrackDisplay() {
    if (this.currentIndex < 0 || this.currentIndex >= this.tracks.length) return;
    const name = this.tracks[this.currentIndex].name;
    this.trackNameEl.textContent = name;
    if (this.trackNameBtn) this.trackNameBtn.title = name;
    this._updateScrollAnimation();
    this._updateCurrentListItem();
  }

  _updateScrollAnimation() {
    if (!this.trackNameWrap || !this.trackNameEl) return;
    // Reset first so measurements reflect natural widths
    this.trackNameWrap.classList.remove('mp-scrolling');
    requestAnimationFrame(() => {
      const inner = this.trackNameEl;
      const btn = this.trackNameBtn;
      if (!inner || !btn) return;
      const overflow = inner.scrollWidth - btn.clientWidth;
      if (overflow > 2) {
        // Slow scroll: ~40px per second of travel, round-trip animation with pauses
        const travelSec = Math.max(6, overflow / 20);
        const totalSec = travelSec * 2 + 3;
        this.trackNameWrap.style.setProperty('--mp-scroll-end', `-${overflow}px`);
        this.trackNameWrap.style.setProperty('--mp-scroll-duration', `${totalSec}s`);
        this.trackNameWrap.classList.add('mp-scrolling');
      } else {
        this.trackNameWrap.style.removeProperty('--mp-scroll-end');
        this.trackNameWrap.style.removeProperty('--mp-scroll-duration');
      }
    });
  }

  _toggleTrackList() {
    this._setTrackListOpen(!this.trackListOpen);
  }

  _setTrackListOpen(open) {
    if (!this.trackListEl) return;
    this.trackListOpen = open;
    if (open) {
      this._renderTrackList();
      this.trackListEl.hidden = false;
    } else {
      this.trackListEl.hidden = true;
    }
  }

  _renderTrackList() {
    if (!this.trackListEl) return;
    this.trackListEl.innerHTML = '';
    if (this.tracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mp-track-list-item';
      empty.textContent = 'No tracks';
      empty.style.cursor = 'default';
      this.trackListEl.appendChild(empty);
      return;
    }
    this.tracks.forEach((track, i) => {
      const item = document.createElement('button');
      item.className = 'mp-track-list-item';
      if (i === this.currentIndex) item.classList.add('current');
      item.textContent = track.name;
      item.title = track.name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this._playTrack(i);
        this._setTrackListOpen(false);
      });
      this.trackListEl.appendChild(item);
    });
  }

  _updateCurrentListItem() {
    if (!this.trackListEl || this.trackListEl.hidden) return;
    const items = this.trackListEl.querySelectorAll('.mp-track-list-item');
    items.forEach((item, i) => {
      item.classList.toggle('current', i === this.currentIndex);
    });
  }

  _updatePlayButton() {
    // ▶ / ❚❚ using simple text
    this.playBtn.textContent = this.isPlaying ? '||' : '>';
  }

  _generateShuffleOrder() {
    this.shuffleOrder = this.tracks.map((_, i) => i);
    // Fisher-Yates shuffle
    for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
    }
  }

  _setMinimized(minimized) {
    this.minimized = minimized;
    this.el.classList.toggle('minimized', minimized);
    if (this.minimizeBtn) {
      this.minimizeBtn.textContent = minimized ? '+' : '_';
      this.minimizeBtn.title = minimized ? 'Expand' : 'Minimize';
    }
    this._saveState();
  }

  _saveState() {
    if (!this._stateReady) return;
    try {
      const t = this.audio.currentTime;
      localStorage.setItem(MUSIC_STATE_KEY, JSON.stringify({
        selectedTheme: this.currentTheme,
        currentIndex: this.currentIndex,
        currentTrackFile: this.tracks[this.currentIndex]?.file || null,
        currentTime: (typeof t === 'number' && isFinite(t)) ? t : 0,
        wasPlaying: this.isPlaying,
        volume: this.audio.volume,
        shuffled: this.shuffled,
        minimized: this.minimized,
      }));
    } catch {}
  }

  _readSavedState() {
    try {
      return JSON.parse(localStorage.getItem(MUSIC_STATE_KEY));
    } catch {
      return null;
    }
  }
}
