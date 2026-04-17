// src/ui/MusicPlayer.js — Simple music player with shuffle, auto-advance, and persistent state

export class MusicPlayer {
  constructor() {
    this.themes = {};          // { themeName: [file, ...] }
    this.themeNames = [];      // sorted theme names
    this.currentTheme = null;
    this.tracks = [];
    this.currentIndex = -1;
    this.audio = new Audio();
    this.audio.volume = 0.4;
    this.isPlaying = false;
    this.shuffled = false;
    this.shuffleOrder = [];
    this._pendingResumeTime = 0;
    this._lastPositionSave = 0;

    // DOM references
    this.el = document.getElementById('music-player');
    this.trackNameEl = this.el.querySelector('.mp-track-name');
    this.playBtn = this.el.querySelector('.mp-play');
    this.prevBtn = this.el.querySelector('.mp-prev');
    this.nextBtn = this.el.querySelector('.mp-next');
    this.shuffleBtn = this.el.querySelector('.mp-shuffle');
    this.volumeSlider = this.el.querySelector('.mp-volume');
    this.themeSelect = this.el.querySelector('.mp-theme');
    this.minimizeBtn = this.el.querySelector('.mp-minimize');
    this.minimized = false;

    this._bindEvents();
    this._loadTracks();
  }

  async _loadTracks() {
    try {
      const resp = await fetch('/music/tracks.json');
      this.themes = await resp.json();
    } catch {
      this.themes = {};
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

    let theme = saved?.selectedTheme;
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
      if (typeof saved.currentIndex === 'number' && saved.currentIndex < this.tracks.length) {
        this.currentIndex = saved.currentIndex;
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

    if (this.currentIndex < 0) this.currentIndex = 0;
    this._updateTrackDisplay();

    // Restore playback position + autoplay
    if (saved && typeof saved.currentTime === 'number' && saved.currentTime > 0) {
      this._pendingResumeTime = saved.currentTime;
    }
    this.audio.src = this.tracks[this.currentIndex].url;
    this._tryAutoplay();
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
      url: `/music/${encodeURIComponent(this.currentTheme)}/${encodeURIComponent(f)}`,
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

    this.audio.addEventListener('pause', () => this._saveState());
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
      this._saveState();
    }).catch(() => {
      // Autoplay blocked — start on first user interaction
      this.isPlaying = false;
      this._updatePlayButton();
      const resume = () => {
        document.removeEventListener('pointerdown', resume, true);
        document.removeEventListener('keydown', resume, true);
        this.audio.play().then(() => {
          this.isPlaying = true;
          this._updatePlayButton();
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
    this.trackNameEl.title = name;
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
    try {
      const t = this.audio.currentTime;
      localStorage.setItem('beamlineTycoon.music', JSON.stringify({
        selectedTheme: this.currentTheme,
        currentIndex: this.currentIndex,
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
      return JSON.parse(localStorage.getItem('beamlineTycoon.music'));
    } catch {
      return null;
    }
  }
}
