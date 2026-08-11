// src/ui/TitleScreen.js — RollerCoaster Tycoon-style opening/title screen.
// Full-screen overlay with an animated pixel-art beamline scene rendered on a
// low-res canvas, a chunky 3D-extruded logo, and a beveled pixel-button menu.
// Mounted immediately on construction (covers asset loading); call
// ready({...}) once the game has booted, dismiss() to fade out and remove.

// Registers the <crt-effect> web component (self-contained, shadow-DOM styles).
import 'vault66-crt-effect/element';
import { createCrtWarp, destToSource } from './crtWarp.js';

// ── Rare scene-event timing (seconds) ────────────────────────────────
// Both of these are surprise gags, so every delay is drawn at random from
// [min, max]: the *First pair is the wait before the first occurrence after
// the title screen opens, the *Gap pair the wait between repeats. Tune here
// — nothing else in the file hard-codes these schedules.
const EVENT_TIMING = {
  ufoFirst: [95, 185],     // UFO cow abduction — Easter egg, minutes apart
  ufoGap: [170, 330],
  ranchFirst: [55, 105],   // the whole ranch chain, from car-hits-cow to restock
  ranchGap: [95, 175],
};
const randIn = ([a, b]) => a + Math.random() * (b - a);

// Phase lengths for the abduction (seconds); 'gone' is how long the cow
// stays missing before it quietly turns back up with the herd.
const UFO_DUR = { hover: 1.1, open: 0.55, hold: 0.8, lift: 2.4, close: 0.5, zip: 1.1, gone: 7 };
const UFO_CRUISE_Y = 92;   // saucer altitude: over the hill crests, under the logo

// Phase lengths for the unified ranch chain (seconds). Every phase also has a
// time-based escape, so no single condition can stall the machine.
const RANCH_DUR = {
  lure: 16, tumble: 0.95, burn: 4.2, panic: 2.2, breakout: 2.4, chase: 2.8,
  charge: 0.9, fly: 0.55, down: 1.5, recover: 1.1, aim: 0.6, shotGap: 0.45,
  ghosts: 2.4, return: 4.2, wreckFade: 2.4, restock: 9,
};
const RESTOCK_WAIT = [10, 20];   // s between the guard getting home and new cows
const RANCH_HORIZON = 133;       // foot line replacement cows fade in on

// Hall-doorway transit: a foreground person walking in (or out of) the opening
// climbs from the ~276 walk line up to the sill and fades, so they read as
// receding down the corridor instead of blinking out on the floor.
const DOOR_DUR = 0.9;      // seconds for the whole transit
const DOOR_SILL = 232;     // foot line inside the opening (wall base is y=230)

export class TitleScreen {
  constructor() {
    this._raf = 0;
    this._dismissed = false;
    this._t0 = performance.now();

    // The welcome screen always opens on the doomer "night drive" track. Set
    // the flag for the music player's first load; if it's already loaded
    // (returning to the title mid-session), switch to it immediately.
    try {
      window.__blWelcomeMusic = true;
      window.__blMusic?.playWelcomeTrack?.();
    } catch {
      /* no window */
    }

    // ── DOM ──────────────────────────────────────────────────────────
    // Black backdrop sitting directly under the title screen. The barrel warp
    // pulls the tube's edges inward, and whatever the overscan doesn't cover
    // reads as the bezel around the glass — without this it would be the live
    // game HUD showing through instead of black.
    this.bezelEl = document.createElement('div');
    this.bezelEl.id = 'title-bezel';
    this.bezelEl.style.cssText = 'position:fixed;inset:0;z-index:9499;background:#05060a;pointer-events:none;opacity:1;transition:opacity 0.4s ease;';
    document.body.appendChild(this.bezelEl);

    this.el = document.createElement('div');
    this.el.id = 'title-screen';

    // The scene is drawn to an offscreen buffer at its native low resolution,
    // then warped pixel-by-pixel into the visible canvas (see crtWarp.js), so
    // the tube curvature is identical on every machine regardless of device
    // pixel ratio or browser zoom. `this.ctx` stays the drawing target, so all
    // the scene code below is unaware any of this is happening.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'title-bg';
    this._viewCtx = this.canvas.getContext('2d');
    this._src = document.createElement('canvas');
    this.ctx = this._src.getContext('2d', { willReadFrequently: true });
    this._warp = createCrtWarp();
    this.el.appendChild(this.canvas);

    // Logo — each letter is its own span so it can bob independently
    const logo = document.createElement('div');
    logo.className = 'title-logo';
    const makeLine = (word, cls) => {
      const line = document.createElement('div');
      line.className = `title-logo-line ${cls}`;
      [...word].forEach((ch, i) => {
        const span = document.createElement('span');
        span.textContent = ch;
        span.style.animationDelay = `${(i * 0.12).toFixed(2)}s`;
        line.appendChild(span);
      });
      return line;
    };
    logo.appendChild(makeLine('BEAMLINE', 'title-logo-top'));
    logo.appendChild(makeLine('TYCOON', 'title-logo-bottom'));
    this.el.appendChild(logo);

    // Loading label (replaced by the menu when ready() is called). The
    // click invitation doubles as the autoplay-unlock gesture: the music
    // player arms a first-interaction resume, so clicking here starts the
    // soundtrack while assets are still loading.
    // The menu is gated behind a deliberate "click to continue": the click is
    // also the autoplay-unlock gesture that starts the soundtrack. The
    // Continue/New Game menu only appears once the player has clicked AND the
    // game has booted (ready()), whichever comes second.
    this._userReady = false;
    this._pendingReady = null;

    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'title-loading';
    this.loadingEl.textContent = 'CLICK TO CONTINUE';
    const loadingSub = document.createElement('div');
    loadingSub.className = 'title-loading-sub';
    loadingSub.textContent = 'press to begin · music on';
    this.loadingEl.appendChild(loadingSub);
    this._onLoadingClick = (e) => {
      // The speaker lives inside the picture, so it shares this listener — and
      // must not count as the click-to-continue gesture.
      if (e && this._hitMute(e)) {
        e.stopPropagation();
        this._toggleMute();
        return;
      }
      this._userReady = true;
      this.el.removeEventListener('pointerdown', this._onLoadingClick);
      if (this._pendingReady) {
        this._showMenu(this._pendingReady);
        this._pendingReady = null;
      } else if (this.loadingEl.firstChild?.nodeType === Node.TEXT_NODE) {
        // Booted not yet — fall back to a plain loading state.
        this.loadingEl.firstChild.textContent = 'LOADING...';
        if (loadingSub) loadingSub.textContent = 'loading...';
      }
    };
    this.el.addEventListener('pointerdown', this._onLoadingClick);

    // Once the gate is passed the listener above is gone, so the speaker needs
    // its own click for the rest of the title screen's life.
    this._onMuteClick = (e) => {
      if (!this._hitMute(e)) return;
      e.stopPropagation();
      if (this._userReady) this._toggleMute();
    };
    this.el.addEventListener('pointerdown', this._onMuteClick);

    // Hover feedback — without it a painted glyph reads as scenery, not a control.
    this._onMuteHover = (e) => {
      const hot = this._hitMute(e);
      if (hot === this._muteHot) return;
      this._muteHot = hot;
      this.el.style.cursor = hot ? 'pointer' : '';
    };
    this.el.addEventListener('pointermove', this._onMuteHover);

    this.el.appendChild(this.loadingEl);

    // Menu container (populated in ready())
    this.menuEl = document.createElement('div');
    this.menuEl.className = 'title-menu hidden';
    this.el.appendChild(this.menuEl);

    // CRT effect (vault66-crt-effect) as a full-screen overlay — glare,
    // scanlines, flicker. Decorative only (pointer-events: none) and scoped to
    // the title/welcome screen. Its "curvature" attribute paints a black radial
    // gradient rather than bending anything, so it stays low — all the actual
    // tube curve comes from the geometric barrel warp below.
    this.crtEl = document.createElement('crt-effect');
    const crtAttrs = {
      fill: '',
      'enable-curvature': '',
      'curvature-intensity': '0.43',
      'enable-vignette': '',
      'vignette-intensity': '0.23',
      'enable-glare': '',
      'glare-intensity': '0.14',
      'enable-noise': '',
      'noise-opacity': '0.09',
      'enable-flicker': '',
      'flicker-intensity': '0.08',
      'flicker-speed': '0.8',
      'scanline-thickness': '4',
      'scanline-gap': '3',
      'scanline-opacity': '0.11',
      theme: 'custom',
      'scanline-color': 'rgba(0,0,0,0.42)',
      // The rolling raster bar. enable-sweep is what actually switches it on —
      // without it the component ignores sweep-style/duration entirely.
      'enable-sweep': '',
      'sweep-style': 'soft',
      'sweep-duration': '9',
      'sweep-thickness': '48',
    };
    for (const [k, v] of Object.entries(crtAttrs)) this.crtEl.setAttribute(k, v);
    this.crtEl.style.cssText = 'position:absolute;inset:0;z-index:40;pointer-events:none;';
    this.el.appendChild(this.crtEl);

    // Music mute toggle. Drawn INTO the scene (see _drawMuteIcon) rather than
    // laid over it as a DOM button, so it bends with the glass and takes the
    // scanlines like everything else on the tube. Hit-testing therefore runs
    // through the same warp — see _hitMute.
    this._muted = false;
    this._muteHot = false;

    document.body.appendChild(this.el);

    // ── Scene state ──────────────────────────────────────────────────
    this._stars = [];
    for (let i = 0; i < 46; i++) {
      this._stars.push({
        x: Math.random(),            // fraction of width
        y: Math.random() * 0.5,      // fraction of height (upper half)
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.5,
      });
    }

    // Day/night cycle: one full cycle every CYCLE_LEN seconds.
    // d=0 dawn (sunrise), 0..0.5 sun arc, 0.5 dusk, 0.5..1 night/moon.
    this._cycleLen = 75;
    this._cycleOffset = 0.86 * this._cycleLen; // open on late night, sunrise soon
    this._hexCache = {};

    // Oak tree clusters on the two hill layers (fractions of W, fixed shapes)
    const mkOaks = (n, seed) => {
      const arr = [];
      for (let i = 0; i < n; i++) {
        arr.push({
          f: (i + 0.15 + Math.random() * 0.7) / n,
          w: 4 + ((Math.random() * 5) | 0),
          h: 3 + ((Math.random() * 3) | 0),
          lob: Math.random() * Math.PI * 2,
        });
      }
      return arr;
    };
    this._oaksBack = mkOaks(9);
    this._oaksFront = mkOaks(7);

    // Sparse grass tufts for the facility grounds
    this._tufts = [];
    for (let i = 0; i < 70; i++) {
      this._tufts.push({ x: Math.random(), y: Math.random() });
    }

    // Cows (SLAC shares its land with cattle): a small herd on the ranch
    // band between the hills and the perimeter fence.
    this._cowsFG = [];
    for (let i = 0; i < 4; i++) {
      this._cowsFG.push({
        x: 30 + Math.random() * 220,
        foot: 138 + i * 4,          // 138..150: ranch band above the fence
        dir: Math.random() < 0.5 ? -1 : 1,
        state: i % 2 ? 'graze' : 'idle',
        stateT: Math.random() * 2,
        dur: 3 + Math.random() * 4,
        target: 0,
        seed: (Math.random() * 97) | 0,
        calf: i === 3,              // one calf
        mooOff: 5 + i * 13.7,       // deterministic stagger — no chorus
        flipped: false,
      });
    }

    // Hikers on the dish-hill trail (slow, hill-scale, self-contained)
    this._hikers = [
      { off: 0.15, spd: 0.0065, shirt: '#a04038' },
      { off: 0.70, spd: 0.0055, shirt: '#4c6c8c' },
    ];

    // Clouds — cartoon-cute cumulus (Stardew/Mario style): 10-18px tall,
    // 24-45px wide, built from 3-5 overlapping rounded domes on a flat-ish
    // base. Solid fluffy body, dithered rim only. All puffy — the flat
    // streak variant read as contrails and was cut. Pale by day,
    // Monet-warm at golden hour, faded dark at night.
    this._clouds = [];
    for (let i = 0; i < 4; i++) {
      const puffy = true;
      const domes = [];
      let pw = 0;
      if (puffy) {
        pw = 26 + Math.random() * 18;               // cloud width in px
        const R = 7 + Math.random() * 4;            // central dome radius
        domes.push({ off: 0.5, r: R, lift: 0 });    // big middle dome
        domes.push({ off: 0.2, r: R * (0.55 + Math.random() * 0.15), lift: 0 });
        domes.push({ off: 0.8, r: R * (0.55 + Math.random() * 0.15), lift: 0 });
        if (Math.random() < 0.75) {                 // baby dome peeking on top
          domes.push({
            off: 0.36 + Math.random() * 0.28,
            r: Math.max(3, R * 0.45),
            lift: Math.round(R * 0.8),
          });
        }
      }
      this._clouds.push({
        fy: (i + 0.2 + Math.random() * 0.5) / 4,    // stacked heights
        x0: Math.random(),
        pw,                                          // cumulus width (px)
        len: 0.14 + Math.random() * 0.18,            // streak width (frac of W)
        spd: 0.8 + Math.random() * 1.6,              // px/s drift
        th: 1 + (i % 2),
        seed: (Math.random() * 4) | 0,
        puffy, domes,
      });
    }

    // Gate traffic: cars arrive at the security gate, park, later leave
    this._cars = [];
    this._gate = { open: 0 };
    this._spotBusy = [false, false, false];     // one flag per lot stall
    this._nextCarT = 5 + Math.random() * 6;
    this._roadPrevT = 0;

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();

    // Ambient pixel scientists + slapstick mishap FX
    this._initFx();

    const loop = (now) => {
      if (this._dismissed) return;
      this._draw(now);
      this._warp.edge(this.ctx, this.W, this.H);
      this._warp.apply(this.ctx, this._viewCtx, this.W, this.H, this.W * this.SS, this.H * this.SS);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // ── Public API ─────────────────────────────────────────────────────

  ready(cfg) {
    if (this._dismissed) return;
    // Gate the menu behind the deliberate "click to continue" gesture.
    if (!this._userReady) {
      this._pendingReady = cfg;
      return;
    }
    this._showMenu(cfg);
  }

  _showMenu({ hasSave, onContinue, onNewGame, onScenarios }) {
    if (this._dismissed) return;
    this.loadingEl.classList.add('hidden');
    this.menuEl.innerHTML = '';

    const addBtn = (label, handler) => {
      const btn = document.createElement('button');
      btn.className = 'title-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => handler && handler());
      this.menuEl.appendChild(btn);
      return btn;
    };

    if (hasSave) addBtn('Continue', onContinue);
    addBtn('New Game', onNewGame);
    addBtn('Scenarios', onScenarios);

    this.menuEl.classList.remove('hidden');
  }

  dismiss() {
    if (this._dismissed) return;
    this._dismissed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    if (window.__titleFx === this._fxHook) delete window.__titleFx;
    this.el.classList.add('title-fade-out');
    this.bezelEl.style.opacity = '0';
    setTimeout(() => {
      this.el.remove();
      this.bezelEl.remove();
    }, 450);
  }

  // ── Canvas scene ───────────────────────────────────────────────────

  _resize() {
    // Fixed low internal height; width follows the viewport aspect so the
    // pixels stay square when the canvas is stretched to fill the screen.
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.H = 320;
    this.W = Math.max(360, Math.min(1024, Math.round(this.H * aspect)));
    // The scene is drawn at W x H, but the warp resolves onto a larger buffer
    // so the curved rim is a smooth arc instead of a staircase of scene-sized
    // pixels. Matched roughly to the display so the steps fall below 1px.
    this.SS = Math.max(1, Math.min(4, Math.round(window.innerHeight / this.H)));
    this._src.width = this.W;
    this._src.height = this.H;
    this.canvas.width = this.W * this.SS;
    this.canvas.height = this.H * this.SS;
    this.ctx.imageSmoothingEnabled = false;
    this._viewCtx.imageSmoothingEnabled = false;
  }

  _draw(now) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const t = (now - this._t0) / 1000;

    // ── Day/night palette ──
    const d = (((t + this._cycleOffset) / this._cycleLen) % 1 + 1) % 1;
    const pal = this._palette(d);
    const horizon = 132;   // raised landscape: facility fills the lower 60%

    // ── Sky: chunky vertical gradient bands, enriched to a multi-stop
    //    Monet ramp (violet→mauve→rose→coral→apricot→gold) at dawn/dusk ──
    const duskG = Math.max(0, 1 - Math.abs(d - 0.5) / 0.085);
    const dawnG = Math.max(0, 1 - Math.min(d, 1 - d) / 0.07);
    const glow = Math.max(duskG, dawnG);
    const RAMP = duskG >= dawnG
      ? ['#4a3a72', '#7c4a80', '#b85a76', '#e0795e', '#f2a262', '#f8cc86']   // dusk
      : ['#403a70', '#6a4878', '#a85a80', '#d87a72', '#f0a46e', '#f8d090'];  // dawn
    const NBANDS = 10;
    const bandH = Math.ceil(horizon / NBANDS);
    for (let i = 0; i < NBANDS; i++) {
      const f = i / (NBANDS - 1);
      const [a, b] = f < 0.5 ? [pal.sky[0], pal.sky[1]] : [pal.sky[1], pal.sky[2]];
      const g2 = f < 0.5 ? f * 2 : (f - 0.5) * 2;
      let r = a[0] + (b[0] - a[0]) * g2;
      let gg = a[1] + (b[1] - a[1]) * g2;
      let bb = a[2] + (b[2] - a[2]) * g2;
      if (glow > 0.02) {
        const rc = this._rampRgb(RAMP, f);
        const w = glow * (0.35 + 0.55 * f);          // strongest near horizon
        r += (rc[0] - r) * w; gg += (rc[1] - gg) * w; bb += (rc[2] - bb) * w;
      }
      ctx.fillStyle = `rgb(${r | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(0, i * bandH, W, bandH);
    }
    // sun-side warmth: a soft column of light widening toward the horizon
    if (glow > 0.03) {
      const gx = duskG >= dawnG ? W * 0.92 : W * 0.08;
      ctx.fillStyle = '#ffc27a';
      for (let i = 0; i < NBANDS; i++) {
        const f = i / (NBANDS - 1);
        const spread = W * (0.14 + 0.4 * f);
        ctx.globalAlpha = glow * 0.1 * (0.35 + 0.65 * f);
        ctx.fillRect(Math.floor(gx - spread / 2), i * bandH, Math.floor(spread), bandH);
      }
      ctx.globalAlpha = 1;
    }

    // ── Sun (d in 0..0.5) / moon (d in 0.5..1) on the same arc ──
    // Sky path: steep rise on the far left (beside the logo, above the dish),
    // high traverse across the top band (clears the logo's top edge), steep
    // set on the far right. Rises/sets behind the hill line — natural dawn/dusk.
    const arcPos = (az) => {
      az = Math.min(1, Math.max(0, az));
      let fx, fy;
      if (az < 0.18) {
        const u = az / 0.18;
        fx = 0.05 + 0.11 * u;
        fy = 126 - 106 * u;
      } else if (az < 0.82) {
        const u = (az - 0.18) / 0.64;
        fx = 0.16 + 0.68 * u;
        fy = 20 - 6 * Math.sin(Math.PI * u);
      } else {
        const u = (az - 0.82) / 0.18;
        fx = 0.84 + 0.11 * u;
        fy = 20 + 106 * u;
      }
      return [Math.floor(W * fx), Math.floor(fy)];
    };
    if (d < 0.53) {
      const az = d / 0.5;
      const [sx, sy] = arcPos(az);
      const low = Math.sin(Math.min(1, az) * Math.PI); // 0 at horizon, 1 at noon
      const core = this._lerpHex('#f2a25a', '#ffd77a', low);
      const edge = this._lerpHex('#d97a3e', '#f0be55', low);
      ctx.fillStyle = edge;
      ctx.fillRect(sx - 5, sy - 3, 10, 6);
      ctx.fillRect(sx - 3, sy - 5, 6, 10);
      ctx.fillStyle = core;
      ctx.fillRect(sx - 4, sy - 3, 8, 6);
      ctx.fillRect(sx - 3, sy - 4, 6, 8);
    } else {
      const az = (d - 0.52) / 0.46;
      const [mx, my] = arcPos(az);
      ctx.fillStyle = '#c9cde0';
      ctx.fillRect(mx - 5, my - 3, 10, 6);
      ctx.fillRect(mx - 3, my - 5, 6, 10);
      ctx.fillRect(mx - 4, my - 4, 8, 8);
      ctx.fillStyle = '#e6e9f5';
      ctx.fillRect(mx - 3, my - 3, 5, 5);
      ctx.fillStyle = '#a8adc4'; // craters
      ctx.fillRect(mx + 1, my - 2, 2, 2);
      ctx.fillRect(mx - 3, my + 1, 2, 1);
    }

    // Stars (twinkle) — only at night
    if (pal.stars > 0.03) {
      ctx.globalAlpha = pal.stars;
      for (const s of this._stars) {
        const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
        if (tw < 0.25) continue;
        ctx.fillStyle = tw > 0.75 ? '#cdd6ff' : '#5a628f';
        const sx = Math.floor(s.x * W), sy = Math.floor(s.y * horizon * 0.9);
        ctx.fillRect(sx, sy, 1, 1);
        if (tw > 0.92) { // brief sparkle cross
          ctx.fillRect(sx - 1, sy, 1, 1); ctx.fillRect(sx + 1, sy, 1, 1);
          ctx.fillRect(sx, sy - 1, 1, 1); ctx.fillRect(sx, sy + 1, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ── Wispy cloud streaks: slow horizontal drift, dithered edges.
    //    Pale by day; at golden hour the sun-side end catches warm apricot
    //    light while the far end cools to mauve; near-invisible dark at night ──
    {
      const cloudA = 0.1 + 0.2 * pal.light + 0.38 * glow;
      if (cloudA > 0.06) {
        const sunLeft = dawnG >= duskG;                 // light comes from…
        const dayC = [214, 222, 236], nightC = [26, 28, 48];
        const warm = this._hexRgb('#f6bd82'), mauve = this._hexRgb('#8f6390');
        const mix = (b2, o, w) => `rgb(${(b2[0] + (o[0] - b2[0]) * w) | 0},${
          (b2[1] + (o[1] - b2[1]) * w) | 0},${(b2[2] + (o[2] - b2[2]) * w) | 0})`;
        const base = [0, 1, 2].map((k) => nightC[k] + (dayC[k] - nightC[k]) * pal.light);
        const nearCol = mix(base, warm, glow * 0.9);
        const farCol = mix(base, mauve, glow * 0.8);
        const dash = (xa, xb, y, seed) => {              // dithered 2px dashes
          for (let px = xa + (((xa | 0) + seed) & 3); px < xb; px += 4) {
            ctx.fillRect(Math.floor(px), y, 2, 1);
          }
        };
        for (const cl of this._clouds) {
          const L = cl.puffy ? Math.floor(cl.pw) : Math.floor(cl.len * W);
          const cy = Math.floor(22 + cl.fy * (horizon - 55));
          const x = Math.floor(((cl.x0 * W + t * cl.spd) % (W + L + 40)) - L - 20);
          const mid = x + (L >> 1);
          if (cl.puffy) {
            // cartoon cumulus: solid rounded domes on a flat-ish base;
            // lit half toward the sun, mauve shadow half away from it
            const colAt = (px) => ((sunLeft ? px < mid : px > mid) ? nearCol : farCol);
            const solidA = Math.min(0.92, 0.2 + 0.6 * pal.light + 0.25 * glow);
            const row = (x0, x1, y) => {                 // split-shaded solid row
              const sm = Math.max(x0, Math.min(x1, mid));
              ctx.fillStyle = sunLeft ? nearCol : farCol;
              if (sm > x0) ctx.fillRect(x0, y, sm - x0, 1);
              ctx.fillStyle = sunLeft ? farCol : nearCol;
              if (x1 > sm) ctx.fillRect(sm, y, x1 - sm, 1);
            };
            ctx.globalAlpha = solidA;
            row(x + 2, x + L - 2, cy);                   // flat-ish base
            row(x + 4, x + L - 4, cy + 1);
            for (const dm of cl.domes) {                 // solid dome bodies
              const cx2 = x + Math.floor(dm.off * L);
              for (let dy = 1; dy < dm.r; dy++) {
                const hw = Math.round(Math.sqrt(dm.r * dm.r - dy * dy));
                row(cx2 - hw, cx2 + hw, cy - dm.lift - dy);
              }
              ctx.globalAlpha = solidA * 0.6;            // dithered crown rim
              ctx.fillStyle = colAt(cx2);
              const chw = Math.max(2, Math.round(dm.r * 0.55));
              dash(cx2 - chw, cx2 + chw, cy - dm.lift - Math.ceil(dm.r), cl.seed + (dm.r | 0));
              ctx.globalAlpha = solidA;
            }
            ctx.globalAlpha = solidA * 0.55;             // dithered base ends
            ctx.fillStyle = colAt(x);
            dash(x - 3, x + 4, cy, cl.seed);
            ctx.fillStyle = colAt(x + L);
            dash(x + L - 4, x + L + 3, cy, cl.seed + 1);
            if (glow > 0.1) {                            // golden-hour lit crowns
              ctx.globalAlpha = glow * 0.65;
              ctx.fillStyle = '#ffe0ae';
              for (const dm of cl.domes) {
                const cx2 = x + Math.floor(dm.off * L);
                if (sunLeft ? cx2 <= mid : cx2 >= mid) {
                  const chw = Math.max(2, Math.round(dm.r * 0.6));
                  dash(cx2 - chw, cx2 + chw, cy - dm.lift - Math.ceil(dm.r) + 1, cl.seed);
                }
              }
            }
          } else {
            // thin distant streak
            const nearX = sunLeft ? [x, mid] : [mid, x + L];
            const farX = sunLeft ? [mid, x + L] : [x, mid];
            ctx.globalAlpha = cloudA;
            ctx.fillStyle = nearCol;                     // solid core, two halves
            ctx.fillRect(nearX[0] + 3, cy, nearX[1] - nearX[0] - 3, cl.th);
            ctx.fillStyle = farCol;
            ctx.fillRect(farX[0], cy, farX[1] - farX[0] - 3, cl.th);
            ctx.globalAlpha = cloudA * 0.55;             // dithered soft edges
            ctx.fillStyle = nearCol;
            dash(x + L * 0.15, x + L * 0.68, cy - 1, cl.seed);
            ctx.fillStyle = farCol;
            dash(x + L * 0.3, x + L * 0.92, cy + cl.th, cl.seed + 2);
            dash(x - 6, x + 5, cy, cl.seed + 1);         // tapered dashed ends
            dash(x + L - 5, x + L + 6, cy, cl.seed + 3);
            if (glow > 0.1) {                            // bright sunset rim
              ctx.globalAlpha = glow * 0.55;
              ctx.fillStyle = '#ffe0ae';
              const rim = sunLeft ? [x - 4, x + L * 0.3] : [x + L * 0.7, x + L + 4];
              dash(rim[0], rim[1], cy - 1, cl.seed);
            }
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // ── SLAC-style rolling grassland hills (two layers + oak clusters) ──
    const hillBack = (x) => 16 + 10 * Math.sin(x * 0.011 + 1.7) + 5 * Math.sin(x * 0.033 + 0.5);
    const hillFront = (x) => 9 + 7 * Math.sin(x * 0.017 + 4.1) + 4 * Math.sin(x * 0.05 + 2.2);
    ctx.fillStyle = pal.hillB;
    for (let x = 0; x < W; x += 2) {
      const h = Math.floor(hillBack(x));
      ctx.fillRect(x, horizon - h, 2, h + 2);
    }
    ctx.fillStyle = pal.oakB;
    for (const o of this._oaksBack) {
      const ox = Math.floor(o.f * W);
      const oy = horizon - Math.floor(hillBack(ox));
      ctx.fillRect(ox - (o.w >> 1), oy - o.h, o.w, o.h);
      ctx.fillRect(ox - (o.w >> 1) + 1, oy - o.h - 1, o.w - 2, 1);
    }
    // Stanford Dish landmark on the left hill crest
    {
      const dhx = Math.floor(W * 0.13);
      this._drawDish(ctx, dhx, horizon - Math.floor(hillBack(dhx)), t, pal);
    }
    ctx.fillStyle = pal.hillF;
    for (let x = 0; x < W; x += 2) {
      const h = Math.floor(hillFront(x));
      ctx.fillRect(x, horizon - h, 2, h + 2);
    }
    ctx.fillStyle = pal.oakF;
    for (const o of this._oaksFront) {
      const ox = Math.floor(o.f * W + 11);
      const oy = horizon - Math.floor(hillFront(ox)) + 1;
      ctx.fillRect(ox - (o.w >> 1), oy - o.h, o.w, o.h);
      ctx.fillRect(ox - (o.w >> 1) + 1, oy - o.h - 1, o.w - 2, 1);
      ctx.fillRect(ox, oy, 1, 1); // trunk hint
    }

    // ── Dish Loop trail: dark asphalt S-curve up the dish hill ──
    const trailPt = (s) => [
      Math.floor(W * (0.035 + 0.100 * s + 0.030 * Math.sin(s * Math.PI * 1.7 + 0.4))),
      Math.floor(155 - 45 * s),
    ];
    ctx.fillStyle = this._lerpHex('#131318', '#3f3f46', pal.light);
    for (let i = 0; i <= 22; i++) {
      const [px2, py2] = trailPt(i / 22);
      const tw = Math.max(2, 6 - Math.round((i / 22) * 4.5));  // foreshortened
      ctx.fillRect(px2 - (tw >> 1), py2, tw, 2);
    }
    // occasional tiny hikers on the trail (day only — too dark at night)
    if (pal.light > 0.08) {
      for (const hk of this._hikers) {
        const s = (t * hk.spd + hk.off) % 1.35;
        if (s > 1) continue;
        const [hxp, hyp] = trailPt(s);
        ctx.fillStyle = hk.shirt;
        ctx.fillRect(hxp, hyp - 3, 1, 2);      // shirt
        ctx.fillStyle = '#d8a878';
        ctx.fillRect(hxp, hyp - 4, 1, 1);      // head
        ctx.fillStyle = '#22222c';
        ctx.fillRect(hxp, hyp - 1, 1, 1);      // legs
      }
    }

    // ── Distant lab buildings + water tower along the hill base ──
    ctx.fillStyle = pal.distB;
    const distB = [[0.15, 22, 10], [0.33, 16, 13], [0.70, 26, 9]];
    for (const [f, bw2, bh2] of distB) {
      const bx2 = Math.floor(W * f);
      ctx.fillRect(bx2, horizon - bh2, bw2, bh2);
      ctx.fillRect(bx2 + 2, horizon - bh2 - 2, bw2 - 4, 2); // roof step
    }
    // water tower
    const wtx = Math.floor(W * 0.25);
    ctx.fillRect(wtx - 1, horizon - 10, 1, 10);
    ctx.fillRect(wtx + 3, horizon - 10, 1, 10);
    ctx.fillRect(wtx - 3, horizon - 16, 9, 6);
    ctx.fillRect(wtx - 2, horizon - 17, 7, 1);
    if (pal.stars > 0.5) {                     // a few lit windows at night
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#e8c25a';
      for (const [f] of distB) {
        const bx2 = Math.floor(W * f);
        ctx.fillRect(bx2 + 4, horizon - 6, 1, 1);
        ctx.fillRect(bx2 + 9, horizon - 6, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // ── Site plan: golden ranch outside the fence → green campus inside →
    //    one contiguous concrete machine zone for beamline + support gear ──
    const fenceY = 158;
    // ranch band: dry wheat grass continuous with the hills
    ctx.fillStyle = pal.hillF;
    ctx.fillRect(0, horizon, W, fenceY - horizon);
    // campus lawn: healthier irrigated green inside the perimeter
    ctx.fillStyle = pal.verge;
    ctx.fillRect(0, fenceY, W, H - fenceY);
    // tufts: dry above the fence, lawn-toned inside, none on concrete
    for (const tf of this._tufts) {
      const tx2 = Math.floor(tf.x * W);
      const ty2 = horizon + 3 + Math.floor(tf.y * (H - horizon - 6));
      if (ty2 >= 194 && ty2 <= 303) continue;  // machine pad zone
      ctx.fillStyle = ty2 < fenceY ? pal.hillB : pal.tuft;
      ctx.fillRect(tx2, ty2, 2, 1);
    }

    // ── Facility entrance road + cars (outside segment runs along the
    //    ranch band behind the fence, so it draws before cows/fence) ──
    const gateX = this._roadFrame(ctx, t, W, pal);

    // ── Cows graze the ranch band, strictly outside the fence ──
    // (escaped cows are drawn later by _drawRanchLawn, in front of the fence;
    //  'fade' is the restock arrivals materialising on the horizon line)
    for (const c of this._cowsFG) {
      if (c.escaped) continue;
      ctx.globalAlpha = c.fade ?? 1;
      this._drawCowFG(ctx, c, t, pal);
    }
    ctx.globalAlpha = 1;

    // ── Ranch gag, road layer: skid, tumbling wreck, burning car, frantic
    //    driver — sits on the road/shoulder, so it draws with the cows ──
    this._drawRanchRoad(ctx, t, pal);

    // ── Chain-link perimeter fence, with a gap at the security gate ──
    const gapA = gateX - 14, gapB = gateX + 14;
    ctx.fillStyle = pal.fence;
    ctx.fillRect(0, fenceY - 7, gapA, 1);      // top rail breaks at the gate
    ctx.fillRect(gapB, fenceY - 7, W - gapB, 1);
    for (let x = 3; x < W; x += 14) {
      if (x < gapA - 1 || x > gapB) ctx.fillRect(x, fenceY - 7, 1, 7);
    }
    ctx.globalAlpha = 0.3;                     // faint diamond hatch
    for (let y = fenceY - 6; y < fenceY; y += 2) {
      for (let x = ((y & 2) ? 2 : 0); x < W; x += 4) {
        if (x < gapA || x >= gapB) ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;

    // ── Gate hardware: post + boom + booth standing IN the fence line ──
    this._drawGateHouse(ctx, gateX, t, pal);

    // ── Ranch gag, lawn layer: broken fence + escaped cows + guard + cow
    //    ghosts, in front of the fence line on the campus lawn ──
    this._drawRanchLawn(ctx, gateX, t, pal, W);

    // ── Beamline hall: a poured floor slab meeting the hall's BACK WALL at
    //    y=230. Floor first, so the wall's contact shadow lands on top of it ──
    const padTop = 196;
    this._drawHallFloor(ctx, W, pal);
    this._drawHallWall(ctx, W, pal);

    // ── Central Laboratory: five connected volumes of different heights and
    // depths spanning the old office / control room / cafe footprint. Every
    // base sits directly ON the machine pad's top edge — one continuous ground
    // surface shared with the equipment and beamline.
    const bldGround = padTop - 4;              // building ground line (base = padTop)
    const bldX = Math.floor(W * 0.62);
    // the whole frontage is laid out from the hall door, so the main entrance
    // lands over the doorway and the west end stays clear of the visitor lot
    // (which ends at x≈220).
    this._hallDoorX = bldX + 68;
    const labDoors = this._drawCentralLab(ctx, this._hallDoorX, bldGround, t, pal);
    this._officeDoorX = labDoors.west;         // commuters from the lot head here
    this._ctrlDoorX = labDoors.main;           // ~30% carry on to the main entrance

    // ── Hall doorway, punched through the back wall directly under the
    //    lab's main entrance ──
    this._drawHallDoor(ctx, this._hallDoorX, pal, t);
    // the ONE door foreground people use — they transit the hall opening
    this._doors = [this._hallDoorX];
    this._hallDoor = { x: this._hallDoorX, y: 230 };

    // ── Hall floor props: benches on the open stretch of floor left of the
    //    chip conveyor (which now owns the frontage from x≈330 rightward),
    //    pots beside them, wall-mounted hall lights on the wall face ──
    const benchL = this._hallDoorX - 152, benchR = this._hallDoorX - 96;
    this._drawBench(ctx, benchL, 292);
    this._drawBench(ctx, benchR, 292);
    this._drawFlowerPot(ctx, benchL - 11, 292, 0);
    this._drawFlowerPot(ctx, benchL + 11, 292, 1);
    this._drawFlowerPot(ctx, benchR + 11, 292, 2);
    this._drawWallLight(ctx, Math.floor(W * 0.22), 208, pal);
    this._drawWallLight(ctx, bldX - 18, 208, pal);

    // ── Beamline ──
    const comps = this._drawBeamline(ctx, t, W);

    // ── Scientists, mishaps, ghosts (foreground) ──
    this._fxFrame(ctx, now, t, comps, W);

    // ── UFO abduction: flies over everything, so it draws last ──
    this._drawUfoEvent(ctx, t, pal, W);

    // ── Speaker toggle, inside the glass ──
    this._drawMuteIcon(ctx, W);
  }

  /**
   * Speaker icon in the bottom-right of the SCENE, so the barrel warp bows it
   * with the rest of the picture. Kept well inside the corner: the bulge
   * crops hardest there, and anything closer to the edge loses pixels.
   */
  _muteRect(W) {
    const w = 13, h = 11;
    return { x: W - w - 14, y: this.H - h - 12, w, h };
  }

  _drawMuteIcon(ctx, W) {
    const { x, y, w, h } = this._muteRect(W);
    const lit = this._muteHot ? '#ffffff' : '#c8d4e8';
    const dark = 'rgba(6, 8, 14, 0.55)';

    ctx.save();
    // Slab behind the glyph so it stays legible over the sky or the lawn.
    ctx.fillStyle = dark;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);

    ctx.fillStyle = lit;
    // Speaker body: a 3px stem opening into a 5px cone.
    ctx.fillRect(x, y + 4, 3, 3);
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i, y + 3 - i, 1, 5 + i * 2);

    if (this._muted) {
      // Cross, drawn pixel-by-pixel to keep the diagonals chunky.
      ctx.fillStyle = '#ff8c6b';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(x + 8 + i, y + 3 + i, 1, 1);
        ctx.fillRect(x + 12 - i, y + 3 + i, 1, 1);
      }
    } else {
      // Two arcs of sound, the outer one dimmer.
      ctx.fillRect(x + 8, y + 3, 1, 5);
      ctx.fillRect(x + 9, y + 2, 1, 1);
      ctx.fillRect(x + 9, y + 8, 1, 1);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x + 11, y + 1, 1, 9);
      ctx.fillRect(x + 12, y + 0, 1, 1);
      ctx.fillRect(x + 12, y + 10, 1, 1);
    }
    ctx.restore();
  }

  /**
   * Is a pointer event over the speaker? The event is in screen space, which is
   * the WARPED image, so it has to be pushed back through the same displacement
   * to land in scene coordinates.
   */
  _hitMute(e) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const src = destToSource((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height,
      this._warp.get());
    if (!src) return false;
    const sx = src.x * this.W;
    const sy = src.y * this.H;
    const m = this._muteRect(this.W);
    // Padded: the glyph is ~13px on a 320px-tall scene, a small target once the
    // corner bulge has squeezed it.
    const pad = 5;
    return sx >= m.x - pad && sx <= m.x + m.w + pad
        && sy >= m.y - pad && sy <= m.y + m.h + pad;
  }

  _toggleMute() {
    const m = window.__blMusic;
    if (m && m.audio) {
      m.audio.muted = !m.audio.muted;
      this._muted = m.audio.muted;
    } else {
      this._muted = !this._muted;
    }
  }

  // ── Day/night palette ──────────────────────────────────────────────

  _hexRgb(hex) {
    let c = this._hexCache[hex];
    if (!c) {
      c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      this._hexCache[hex] = c;
    }
    return c;
  }

  _lerpHex(a, b, f) {
    const ca = this._hexRgb(a), cb = this._hexRgb(b);
    const g = Math.min(1, Math.max(0, f));
    return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * g)},${Math.round(ca[1] + (cb[1] - ca[1]) * g)},${Math.round(ca[2] + (cb[2] - ca[2]) * g)})`;
  }

  // Multi-stop ramp sample: hex stop list, f in 0..1 → rgb triple
  _rampRgb(stops, f) {
    const n = stops.length - 1;
    const s = Math.min(n - 1e-6, Math.max(0, f * n));
    const i = Math.floor(s), g = s - i;
    const a = this._hexRgb(stops[i]), b = this._hexRgb(stops[i + 1]);
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g];
  }

  // 3-stop gradient sample (stops = [top, mid, bottom] as rgb triples)
  _lerp3(stops, f) {
    const [a, b] = f < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
    const g = f < 0.5 ? f * 2 : (f - 0.5) * 2;
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * g)},${Math.round(a[1] + (b[1] - a[1]) * g)},${Math.round(a[2] + (b[2] - a[2]) * g)})`;
  }

  _palette(d) {
    const P = TitleScreen._PALS || (TitleScreen._PALS = (() => {
      const mk = (sky, hillB, hillF, oakB, oakF, g1, g2, seam, stars, light, win,
                  verge, lab1, lab2, hall1, hall2, fence, distB, tuft, conc, concT) =>
        ({ skyHex: sky, hillB, hillF, oakB, oakF, g1, g2, seam, stars, light, win,
           verge, lab1, lab2, hall1, hall2, fence, distB, tuft, conc, concT });
      return {
        dawn:  mk(['#242044', '#6e4a5e', '#c98f5e'], '#877050', '#997e58', '#33402c', '#2c3826',
                  '#302c38', '#3a3542', '#282430', 0.15, 0.5, '#e8c25a',
                  '#3a462f', '#59515b', '#5e565f', '#575055', '#5b5459', '#7a5f48', '#4a4038', '#2c3625',
                  '#93806a', '#b8a084'),
        day:   mk(['#3a4a68', '#4d5e7e', '#5d7292'], '#98835c', '#b29a68', '#46523a', '#3c4a30',
                  '#3a3a46', '#44444f', '#333340', 0, 1, '#a8b6c8',
                  '#4e6b3a', '#84848d', '#8b8b94', '#82827e', '#898985', '#6a6055', '#6e6350', '#3c5630',
                  '#d6c6a2', '#f0e4c6'),
        dusk:  mk(['#241a3a', '#623a58', '#b86844'], '#61523f', '#6f5c42', '#2c3626', '#26301f',
                  '#2e2a36', '#383341', '#262230', 0.3, 0.35, '#e8c25a',
                  '#31402a', '#4d4753', '#524c58', '#4c464c', '#504a50', '#6e5240', '#3e3630', '#253020',
                  '#9c7c60', '#c49a76'),
        night: mk(['#0a0a14', '#16162a', '#23243d'], '#12121f', '#0e0e19', '#0e0e18', '#0b0b13',
                  '#23232e', '#2b2b38', '#1e1e29', 1, 0, '#e8c25a',
                  '#0e130f', '#2f2f3a', '#33333e', '#31313d', '#343441', '#232332', '#0d0d17', '#090d0a',
                  '#3a3630', '#4c4740'),
      };
    })());
    // keyframes over the cycle: 0 dawn → day → 0.5 dusk → night → 1 dawn
    const keys = [
      [0.00, P.dawn], [0.09, P.day], [0.41, P.day], [0.50, P.dusk],
      [0.60, P.night], [0.92, P.night], [1.00, P.dawn],
    ];
    let i = 0;
    while (i < keys.length - 2 && d > keys[i + 1][0]) i++;
    const [d0, a] = keys[i], [d1, b] = keys[i + 1];
    const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    return {
      sky: a.skyHex.map((h, k) => {
        const ca = this._hexRgb(h), cb = this._hexRgb(b.skyHex[k]);
        return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
      }),
      hillB: this._lerpHex(a.hillB, b.hillB, f),
      hillF: this._lerpHex(a.hillF, b.hillF, f),
      oakB: this._lerpHex(a.oakB, b.oakB, f),
      oakF: this._lerpHex(a.oakF, b.oakF, f),
      g1: this._lerpHex(a.g1, b.g1, f),
      g2: this._lerpHex(a.g2, b.g2, f),
      seam: this._lerpHex(a.seam, b.seam, f),
      stars: a.stars + (b.stars - a.stars) * f,
      light: a.light + (b.light - a.light) * f,
      win: this._lerpHex(a.win, b.win, f),
      verge: this._lerpHex(a.verge, b.verge, f),
      lab1: this._lerpHex(a.lab1, b.lab1, f),
      lab2: this._lerpHex(a.lab2, b.lab2, f),
      hall1: this._lerpHex(a.hall1, b.hall1, f),
      hall2: this._lerpHex(a.hall2, b.hall2, f),
      fence: this._lerpHex(a.fence, b.fence, f),
      distB: this._lerpHex(a.distB, b.distB, f),
      tuft: this._lerpHex(a.tuft, b.tuft, f),
      conc: this._lerpHex(a.conc, b.conc, f),      // warm pale campus concrete
      concT: this._lerpHex(a.concT, b.concT, f),   // sunlit copings / reveals
    };
  }

  // ── Beamline hall shell: back wall + floor ─────────────────────────
  // Two DIFFERENT planes, so they get different treatments: the wall reads
  // vertical (coping, panel joints, dado, contact shadow) and its joints sit
  // on a grid the floor seams deliberately miss.

  _drawHallWall(ctx, W, pal) {
    const padTop = 196, padMid = 230;
    const wh = padMid - padTop;
    ctx.fillStyle = pal.g1;
    ctx.fillRect(0, padTop, W, wh);                     // wall face
    ctx.fillStyle = '#000';                             // top-lit falloff down the face
    for (let i = 1; i < wh; i++) {
      ctx.globalAlpha = 0.02 + 0.11 * (i / wh);
      ctx.fillRect(0, padTop + i, W, 1);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = this._lerpHex('#2e2e3a', '#56566a', pal.light);
    ctx.fillRect(0, padTop, W, 1);                      // coping along the top
    ctx.fillStyle = pal.seam;
    for (let x = (Math.floor(W / 2) % 48); x < W; x += 48) {
      ctx.fillRect(x, padTop + 1, 1, padMid - padTop - 2); // panel joints, wall only
    }
    ctx.fillStyle = this._lerpHex('#191922', '#2c2c38', pal.light);
    ctx.fillRect(0, padMid - 3, W, 3);                  // dado band along the base
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, padMid, W, 1);                      // contact shadow on the floor
  }

  _drawHallFloor(ctx, W, pal) {
    const padMid = 230, padBot = 302;
    ctx.fillStyle = pal.g2;
    ctx.fillRect(0, padMid, W, padBot - padMid);        // poured slab
    ctx.fillStyle = pal.seam;
    ctx.fillRect(0, padBot - 1, W, 1);                  // front lip of the pour
    for (let x = ((Math.floor(W / 2) + 24) % 48); x < W; x += 48) {
      ctx.fillRect(x, padMid + 1, 1, padBot - padMid - 2); // seams: own 48px grid, +24 offset
    }
  }

  // Hall entrance: a FLAT, face-on doorway in the wall — the same read as the
  // exterior doors on the buildings, just bigger. No perspective anywhere: no
  // receding jambs, no vanishing point, no light fan. Just a cast frame, a
  // dark opening with its leaves folded back, a lit transom and a threshold.
  _drawHallDoor(ctx, x, pal, t) {
    const padTop = 196, padMid = 230;
    const x0 = x - 11, w = 22, y0 = padTop + 4;         // opening: 374..395 at W=512
    const frame = this._lerpHex('#3a3a48', '#6c6c82', pal.light);
    const frameLo = this._lerpHex('#26262f', '#4a4a5c', pal.light);

    // cast concrete surround: 3px jambs and a lintel, standing proud of the wall
    ctx.fillStyle = frame;
    ctx.fillRect(x0 - 3, y0 - 3, w + 6, 3);             // lintel
    ctx.fillRect(x0 - 3, y0, 3, padMid - y0);           // left jamb
    ctx.fillRect(x0 + w, y0, 3, padMid - y0);           // right jamb
    ctx.fillStyle = frameLo;
    ctx.fillRect(x0 - 3, y0 - 3, w + 6, 1);             // top chamfer
    ctx.fillRect(x0 + w + 2, y0, 1, padMid - y0);       // shaded right edge
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0 - 1, y0, 1, padMid - y0);           // reveal shadows into the hole
    ctx.fillRect(x0 + w - 1, y0, 1, padMid - y0);
    ctx.fillRect(x0, y0, w, 1);

    // transom over the door head: lit glass, flat, two mullions
    ctx.fillStyle = '#191924';
    ctx.fillRect(x0, y0, w, 6);
    ctx.fillStyle = '#c8a850';
    ctx.fillRect(x0 + 2, y0 + 1, w - 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(x0 + 2, y0 + 1, w - 4, 1);             // top edge catch
    ctx.fillStyle = '#191924';
    ctx.fillRect(x0 + 8, y0 + 1, 1, 4);                 // mullions
    ctx.fillRect(x0 + 14, y0 + 1, 1, 4);
    ctx.fillStyle = frameLo;
    ctx.fillRect(x0, y0 + 6, w, 2);                     // head rail under the transom

    // the opening itself: flat dark passage, leaves folded back against the
    // jambs, a dim strip of interior floor at the bottom
    const dy = y0 + 8;                                  // door head at y=208
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(x0, dy, w, padMid - dy);
    ctx.fillStyle = '#242434';
    ctx.fillRect(x0 + 4, dy + 1, w - 8, padMid - dy - 4); // dim wall seen inside
    ctx.fillStyle = '#2e2a26';
    ctx.fillRect(x0 + 4, padMid - 4, w - 8, 3);         // interior floor, warm-lit
    ctx.fillStyle = '#3d3630';
    ctx.fillRect(x0 + 4, padMid - 4, w - 8, 1);

    // open leaves: 4px panels stood back against each jamb
    for (const [lx, lit] of [[x0, 1], [x0 + w - 4, 0]]) {
      ctx.fillStyle = lit ? '#4e4e60' : '#33333f';
      ctx.fillRect(lx, dy, 4, padMid - dy);
      ctx.fillStyle = lit ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(lx + (lit ? 0 : 3), dy, 1, padMid - dy);   // leading edge catch
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(lx + (lit ? 3 : 0), dy, 1, padMid - dy);
      ctx.fillStyle = lit ? '#8e8ea2' : '#5c5c6c';
      ctx.fillRect(lx + 1, dy + 8, 2, 1);                     // push bar
      ctx.fillStyle = lit ? '#3a3a48' : '#282833';
      ctx.fillRect(lx, padMid - 6, 4, 2);                     // kick plate
    }
    ctx.fillStyle = Math.sin(t * 1.7) > 0 ? '#54e08a' : '#2a5a3c';
    ctx.fillRect(x0 + w + 1, dy + 3, 1, 1);             // door-interlock status lamp

    // threshold plate at the floor line
    ctx.fillStyle = this._lerpHex('#42424e', '#7a7a90', pal.light);
    ctx.fillRect(x0 - 3, padMid - 1, w + 6, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(x0 - 3, padMid, w + 6, 1);

    // a flat rectangle of warm light on the floor at the threshold — no rays
    ctx.fillStyle = '#ffd98a';
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = (0.11 + 0.07 * pal.stars) * (1 - i / 5);
      ctx.fillRect(x0, padMid + 1 + i, w, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ── Grounds props (mirror the game's decoration vocabulary) ────────

  _drawFlowerPot(ctx, x, baseY, variant) {
    ctx.fillStyle = '#8a4a28';                 // terracotta pot
    ctx.fillRect(x - 2, baseY - 3, 5, 3);
    ctx.fillRect(x - 3, baseY - 4, 7, 1);
    ctx.fillStyle = '#2c2418';                 // soil
    ctx.fillRect(x - 2, baseY - 4, 5, 1);
    ctx.fillStyle = '#3e5a2c';                 // stems
    ctx.fillRect(x - 1, baseY - 6, 1, 2);
    ctx.fillRect(x + 1, baseY - 7, 1, 3);
    ctx.fillStyle = ['#c05a6a', '#d9b53a', '#9a6ac0'][variant % 3]; // blooms
    ctx.fillRect(x - 2, baseY - 7, 2, 2);
    ctx.fillRect(x + 1, baseY - 8, 2, 2);
  }

  _drawBench(ctx, x, baseY) {
    ctx.fillStyle = '#6a4e30';                 // park bench: seat + back
    ctx.fillRect(x - 6, baseY - 4, 13, 2);
    ctx.fillRect(x - 6, baseY - 8, 13, 1);
    ctx.fillStyle = '#7d5c3a';
    ctx.fillRect(x - 6, baseY - 4, 13, 1);
    ctx.fillStyle = '#3a3a44';                 // iron legs
    ctx.fillRect(x - 5, baseY - 2, 1, 2);
    ctx.fillRect(x + 5, baseY - 2, 1, 2);
    ctx.fillRect(x - 6, baseY - 7, 1, 3);
    ctx.fillRect(x + 6, baseY - 7, 1, 3);
  }

  _drawLamppost(ctx, x, baseY, pal) {
    ctx.fillStyle = '#3a3a4c';
    ctx.fillRect(x, baseY - 22, 1, 22);
    ctx.fillRect(x - 1, baseY, 3, 1);          // base plate
    ctx.fillRect(x, baseY - 23, 4, 1);         // arm
    const night = pal.stars > 0.35;
    ctx.fillStyle = night ? '#f5deb0' : '#4a4a5c';
    ctx.fillRect(x + 3, baseY - 22, 2, 2);     // lamp head
    if (night) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#f5deb0';
      ctx.fillRect(x - 1, baseY - 21, 10, 14); // soft light cone
      ctx.globalAlpha = 1;
    }
  }

  // Wall-mounted hall light: a small fixture ON the back wall (no post — a
  // post would plant a foot on a vertical surface), throwing a night-only
  // cone down the wall and out onto the floor.
  _drawWallLight(ctx, x, y, pal) {
    const night = pal.stars > 0.35;
    ctx.fillStyle = this._lerpHex('#2a2a38', '#4a4a5e', pal.light);
    ctx.fillRect(x - 1, y - 3, 3, 1);          // mounting bracket
    ctx.fillRect(x, y - 2, 1, 2);              // stem
    ctx.fillStyle = night ? '#f5deb0' : '#5a5a70';
    ctx.fillRect(x - 2, y, 5, 2);              // lamp face
    ctx.fillStyle = this._lerpHex('#1c1c26', '#3a3a4a', pal.light);
    ctx.fillRect(x - 2, y + 2, 5, 1);          // housing lip
    if (night) {
      ctx.fillStyle = '#f5deb0';
      for (let i = 0; i < 24; i++) {           // cone down the wall, spilling on the floor
        const hw = 2 + Math.round(i * 0.3);
        ctx.globalAlpha = 0.10 * (1 - i / 26);
        ctx.fillRect(x - hw, y + 3 + i, hw * 2 + 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Stanford Dish: static three-quarter view — a tilted ELLIPSE bowl with a
  // two-tone concave interior, feed boom crossing past the upper rim, on an
  // X-braced lattice mount. Reads as a pure silhouette at night.
  _drawDish(ctx, x, baseY, t, pal) {
    const L = pal.light;
    const frame = this._lerpHex('#101018', '#4e5560', L);
    const rimC = this._lerpHex('#171722', '#ccd2da', L);   // elliptical rim ring
    const litC = this._lerpHex('#14141e', '#98a2ae', L);   // concave face
    const backC = this._lerpHex('#10101a', '#565e6a', L);  // shadowed back half
    const cx = x, cy = baseY - 22;                          // bowl centre
    // lattice mount: A-frame legs + X-brace + hub under the bowl
    ctx.fillStyle = frame;
    for (let j = 0; j < 10; j++) {
      ctx.fillRect(x - 6 + Math.round(j * 0.4), baseY - 1 - j, 1, 1);
      ctx.fillRect(x + 6 - Math.round(j * 0.4), baseY - 1 - j, 1, 1);
    }
    for (let j = 0; j < 7; j++) {                           // X-brace
      ctx.fillRect(x - 3 + j, baseY - 2 - j, 1, 1);
      ctx.fillRect(x + 3 - j, baseY - 2 - j, 1, 1);
    }
    ctx.fillRect(x - 4, baseY - 5, 9, 1);                   // cross member
    ctx.fillRect(x - 2, cy + 9, 5, 4);                      // mount hub
    // bowl: rotated ellipse, long axis lower-left → upper-right
    const th = -0.65, ct = Math.cos(th), st = Math.sin(th);
    const a = 11, b = 4.6;
    for (let py = -11; py <= 11; py++) {
      for (let px = -12; px <= 12; px++) {
        const xu = (px * ct + py * st) / a;
        const yu = (-px * st + py * ct) / b;
        const r2 = xu * xu + yu * yu;
        if (r2 > 1) continue;
        let col;
        if (r2 > 0.55) col = rimC;                          // fat rim ring
        else if (yu < 0) col = ((px + py) & 1) ? litC : rimC; // concave face + lattice dither
        else col = backC;                                   // back half in shadow
        ctx.fillStyle = col;
        ctx.fillRect(cx + px, cy + py, 1, 1);
      }
    }
    // feed boom: from the lower rim up across the face, past the upper rim
    ctx.fillStyle = frame;
    for (let i = 0; i <= 12; i++) {
      ctx.fillRect(Math.round(cx - 9 + i * 1.75), Math.round(cy + 7 - i * 1.33), 1, 2);
    }
    ctx.fillRect(cx + 12, cy - 10, 2, 2);                   // feed at the tip
  }

  // ── Foreground cows: amble / graze / idle / moo state machine ──────

  _cowTarget(W) {
    return 16 + Math.random() * (W - 32);
  }

  _cowDecide(c, W) {
    c.stateT = 0;
    c.flipped = false;
    const r = Math.random();
    if (r < 0.45) { c.state = 'graze'; c.dur = 4 + Math.random() * 4; }
    else if (r < 0.72) { c.state = 'idle'; c.dur = 2 + Math.random() * 2.5; }
    else { c.state = 'amble'; c.target = this._cowTarget(W); }
  }

  _updateCow(c, dt, t, W) {
    c.stateT += dt;
    // deterministic staggered moo window (~every 52s per cow)
    if (c.state !== 'moo' && ((t + c.mooOff) % 52) < 1.7) {
      c.state = 'moo';
      c.stateT = 0;
    }
    switch (c.state) {
      case 'amble': {
        const d = c.target - c.x;
        if (Math.abs(d) < 1.5) { this._cowDecide(c, W); break; }
        c.dir = d > 0 ? 1 : -1;
        c.x += c.dir * (c.calf ? 5.5 : 4) * dt;
        break;
      }
      case 'graze':
        if (c.stateT > c.dur) this._cowDecide(c, W);
        break;
      case 'idle':
        if (c.stateT > c.dur * 0.55 && !c.flipped) { c.flipped = true; c.dir *= -1; }
        if (c.stateT > c.dur) this._cowDecide(c, W);
        break;
      case 'moo':
        if (c.stateT > 1.7) { c.state = 'idle'; c.stateT = 0; c.dur = 1.6; c.flipped = true; }
        break;
    }
    c.x = Math.max(10, Math.min(W - 10, c.x));
  }

  _drawCowFG(ctx, c, t, pal) {
    const x = Math.round(c.x), y = Math.round(c.foot);
    const hw = c.calf ? 3 : 4;                 // body half-width (hill-scale)
    const bh = c.calf ? 3 : 4;                 // body height
    const legH = 2;
    const bodyTop = y - legH - bh;
    const body = this._lerpHex('#181820', '#dcdce0', Math.min(1, 0.14 + pal.light));
    const dark = this._lerpHex('#0c0c12', '#2e2e36', pal.light);
    const pink = this._lerpHex('#3a2830', '#c89098', pal.light);
    const walking = c.state === 'amble';
    const frame = walking ? Math.floor(t * 6 + c.seed) % 2 : 0;

    // legs: two pairs, scissor when walking
    ctx.fillStyle = body;
    const sway = frame ? 1 : 0;
    ctx.fillRect(x - hw + 1 + sway, y - legH, 1, legH);
    ctx.fillRect(x - hw + 3 - sway, y - legH, 1, legH);
    ctx.fillRect(x + hw - 3 + sway, y - legH, 1, legH);
    ctx.fillRect(x + hw - 1 - sway, y - legH, 1, legH);
    ctx.fillStyle = dark;                       // hooves
    ctx.fillRect(x - hw + 1 + sway, y - 1, 1, 1);
    ctx.fillRect(x + hw - 1 - sway, y - 1, 1, 1);

    // body (rounded top row)
    ctx.fillStyle = body;
    ctx.fillRect(x - hw, bodyTop + 1, hw * 2, bh - 1);
    ctx.fillRect(x - hw + 1, bodyTop, hw * 2 - 2, 1);
    // seeded holstein patches
    ctx.fillStyle = dark;
    ctx.fillRect(x - hw + 1 + (c.seed % (hw + 1)), bodyTop + 1, 2, 2);
    ctx.fillRect(x - hw + 2 + ((c.seed * 3) % (hw + 2)), bodyTop + bh - 2, 2, 1);
    if (!c.calf) ctx.fillRect(x + hw - 3 - (c.seed % 2), bodyTop + 1, 2, 2);

    // tail at the rear (occasional swish)
    const tx2 = x - c.dir * (hw + 1);
    ctx.fillStyle = body;
    ctx.fillRect(tx2, bodyTop + 1, 1, 3);
    const swish = Math.sin(t * 0.8 + c.seed) > 0.75;
    ctx.fillStyle = dark;
    ctx.fillRect(tx2 + (swish ? -c.dir : 0), bodyTop + 4, 1, 1);   // tail tuft

    // head: up (idle/amble/moo) or down (graze, with chewing jitter)
    const hx = x + c.dir * (hw + 1);
    const grazing = c.state === 'graze';
    const chew = grazing ? Math.floor(t * 3 + c.seed) % 2 : 0;
    const hy = grazing ? y - 2 - chew : bodyTop - 1;
    ctx.fillStyle = body;
    ctx.fillRect(hx - 1, hy, 2, c.calf ? 2 : 3);
    // ear (flicks occasionally)
    if (Math.sin(t * 0.7 + c.seed * 2) < 0.85) {
      ctx.fillStyle = dark;
      ctx.fillRect(hx - c.dir * 2, hy, 1, 1);
    }
    // muzzle + eye
    ctx.fillStyle = pink;
    const mzy = hy + (c.calf ? 1 : 2);
    ctx.fillRect(hx + (c.dir > 0 ? 0 : -1), mzy, 1, 1);
    ctx.fillStyle = '#14141c';
    ctx.fillRect(hx + (c.dir > 0 ? 0 : -1), hy, 1, 1);
    // grass tuft being eaten (vanishes as the cow grazes)
    if (grazing && c.stateT < c.dur * 0.5) {
      ctx.fillStyle = pal.hillB;
      ctx.fillRect(hx + c.dir * 2, y - 1, 2, 1);
    }
    // MOO (small bubble at hill scale)
    if (c.state === 'moo') {
      ctx.fillStyle = pink;                    // open mouth
      ctx.fillRect(hx + (c.dir > 0 ? 0 : -1), mzy, 1, 1);
      this._drawBubble(ctx, x + c.dir * 3, hy - 2, 'moo');
    }
  }

  // ── Facility entrance: road, security gate, guard booth, cars ──────

  // Top edge of the road band. The approach runs level along the OUTSIDE
  // of the perimeter (just behind the fence), drops through the fence gap
  // at the gate, then eases onto the campus service road.
  _roadTopY(x, gateX) {
    if (x <= gateX - 16) return 144;                    // outside, along the fence
    if (x < gateX + 6) {
      return Math.round(144 + 18 * (x - (gateX - 16)) / 22);  // through the gap
    }
    if (x < gateX + 22) {
      return Math.round(162 + 4 * (x - (gateX + 6)) / 16);    // easing onto campus
    }
    return 166;                                         // campus service road
  }

  _makeCar() {
    const colors = ['#b04038', '#3a6ab0', '#c9ccd6', '#3a9a86', '#c09a3a', '#7a4a9a'];
    return {
      x: -28, dir: 1, state: 'in', wait: 0, pt: 0, px: 0, spot: -1, claimed: false,
      color: colors[(Math.random() * colors.length) | 0],
      phase: Math.random() * 7,
      leaveAt: 0, dead: false,
    };
  }

  _roadFrame(ctx, t, W, pal) {
    // Gate sits in the fence line, left of the centered menu column (menu
    // spans ~0.4W..0.6W). The road arrives OUTSIDE the perimeter along the
    // ranch band, punches through the fence gap, and drops to the lot.
    const gateX = Math.floor(W * 0.28);
    const lotX = gateX + 12;              // visitor lot just inside the gate
    const lotW = 65;                      // 3 stalls, 21px pitch
    const roadEnd = lotX + lotW + 4;
    const dt = Math.min(0.1, Math.max(0, t - (this._roadPrevT || t)));
    this._roadPrevT = t;

    // road: asphalt band (wider than the dish trail — it's for cars)
    const asphalt = this._lerpHex('#15151a', '#414149', pal.light);
    const shoulder = this._lerpHex('#101014', '#33333a', pal.light);
    ctx.fillStyle = asphalt;
    for (let x = 0; x < roadEnd; x += 2) {
      ctx.fillRect(x, this._roadTopY(x, gateX), 2, 7);
    }
    ctx.fillStyle = shoulder;
    for (let x = 0; x < roadEnd; x += 2) {
      const y = this._roadTopY(x, gateX);
      ctx.fillRect(x, y, 2, 1);
      ctx.fillRect(x, y + 6, 2, 1);
    }
    ctx.fillStyle = 'rgba(232,206,130,0.5)';           // dashed centerline
    for (let x = 2; x < gateX - 22; x += 9) {          // outside approach only
      ctx.fillRect(x, this._roadTopY(x + 2, gateX) + 3, 4, 1);
    }

    // visitor lot off the road, just inside the gate
    ctx.fillStyle = asphalt;
    ctx.fillRect(lotX, 170, lotW, 22);
    ctx.fillStyle = shoulder;
    ctx.fillRect(lotX, 191, lotW, 1);
    ctx.fillRect(lotX + lotW - 1, 170, 1, 22);
    ctx.fillStyle = 'rgba(232,206,130,0.35)';          // painted stall lines
    for (let k = 0; k <= 3; k++) ctx.fillRect(lotX + 1 + k * 21, 173, 1, 17);
    const spots = [{ x: lotX + 4 }, { x: lotX + 25 }, { x: lotX + 46 }];

    // ── car traffic state machine ──
    if (t >= this._nextCarT) {
      this._nextCarT = t + 11 + Math.random() * 13;
      if (this._cars.length < 5 && this._spotBusy.some((b) => !b)) {
        this._cars.push(this._makeCar());
      }
    }
    const g = this._gate;
    const spd = 17;
    let wantOpen = false;
    for (const c of this._cars) {
      switch (c.state) {
        case 'in':                                     // arrive from the left
          c.x += spd * dt;
          if (c.x >= gateX - 33) { c.x = gateX - 33; c.state = 'gwait'; c.wait = 1 + Math.random(); }
          break;
        case 'gwait':                                  // checked at the gate
          c.wait -= dt;
          if (c.wait <= 0) {
            wantOpen = true;
            if (g.open > 0.85) c.state = c.exiting ? 'exit' : 'enter';
          }
          break;
        case 'enter':
          c.x += spd * dt;
          if (Math.abs(c.x + 7 - gateX) < 24) wantOpen = true;
          if (c.spot < 0 && c.x > gateX + 2) {
            const free = this._spotBusy.findIndex((b) => !b);
            if (free >= 0) { c.spot = free; this._spotBusy[free] = true; }
          }
          if (c.spot >= 0 && c.x >= spots[c.spot].x - 15) {
            c.state = 'park'; c.pt = 0; c.px = c.x;
          } else if (c.spot < 0 && c.x > roadEnd - 16) {  // lot full: turn back
            c.dir = -1; c.state = 'out';
          }
          break;
        case 'park': {                                 // pull into the bay
          c.pt = Math.min(1, c.pt + dt / 1.3);
          c.x = c.px + (spots[c.spot].x - c.px) * c.pt;
          if (c.pt >= 1) {
            c.state = 'parked'; c.leaveAt = t + 25 + Math.random() * 35;
            if (this._commuters && this._commuters.length < 6 && this._officeDoorX) {
              // driver gets out and walks up to the admin block
              this._commuters.push(
                this._makeCommuter(spots[c.spot].x + 8, this._officeDoorX, 1, null));
            }
          }
          break;
        }
        case 'parked':
          if (t >= c.leaveAt) { c.state = 'unpark'; c.pt = 0; c.px = c.x; c.dir = -1; }
          break;
        case 'unpark': {                               // back out onto the road
          c.pt = Math.min(1, c.pt + dt / 1.3);
          c.x = c.px - 14 * c.pt;
          if (c.pt >= 1) { this._spotBusy[c.spot] = false; c.spot = -1; c.state = 'out'; }
          break;
        }
        case 'out':
          c.x -= spd * dt;
          if (c.x <= gateX + 4) { c.x = gateX + 4; c.state = 'gwait'; c.wait = 0.8 + Math.random() * 0.8; c.exiting = true; }
          break;
        case 'exit':
          c.x -= spd * dt;
          if (Math.abs(c.x + 7 - gateX) < 24) wantOpen = true;
          if (c.x < -32) c.dead = true;
          break;
      }
    }
    this._cars = this._cars.filter((c) => !c.dead);
    g.open = Math.min(1, Math.max(0, g.open + (wantOpen ? dt * 1.3 : -dt * 0.9)));

    // draw cars back-to-front (road cars first, lot cars in front)
    const byOf = (c) => {
      if (c.state === 'park') {
        const b0 = this._roadTopY(c.px + 7, gateX) + 6;
        return b0 + (189 - b0) * c.pt;
      }
      if (c.state === 'parked') return 189;
      if (c.state === 'unpark') {
        const b1 = this._roadTopY(c.px - 7, gateX) + 6;   // road re-entry point
        return 189 + (b1 - 189) * c.pt;
      }
      return this._roadTopY(c.x + 7, gateX) + 6;
    };
    const order = this._cars.slice().sort((a, b2) => byOf(a) - byOf(b2));
    for (const c of order) {
      const moving = !(c.state === 'parked' || c.state === 'gwait');
      this._drawCar(ctx, c, Math.round(byOf(c)), moving, t, pal);
    }

    return gateX;      // fence gap position, used by the fence + gatehouse
  }

  // Little side-view car, ~15px long. dir +1 faces right. by = wheel bottom.
  _drawCar(ctx, c, by, moving, t, pal) {
    const x = Math.round(c.x);
    const dim = 0.3 + 0.7 * pal.light;
    const body = this._lerpHex('#191922', c.color, dim);
    const roof = this._lerpHex('#15151d', c.color, dim * 0.75);
    const glass = this._lerpHex('#2a3140', '#a8c4d8', dim);
    const bob = moving ? Math.floor(t * 3.3 + c.phase) % 2 : 0;   // gentle 1px bob
    const front = c.dir > 0 ? x + 13 : x;
    const rear = c.dir > 0 ? x : x + 13;
    ctx.fillStyle = '#101016';                          // wheels
    ctx.fillRect(x + 2, by - 2, 2, 2);
    ctx.fillRect(x + 10, by - 2, 2, 2);
    const wf = moving ? Math.floor(t * 10 + c.phase) % 2 : 0;     // hub spin
    ctx.fillStyle = '#5a5a68';
    ctx.fillRect(x + 2 + wf, by - 1, 1, 1);
    ctx.fillRect(x + 10 + wf, by - 1, 1, 1);
    ctx.fillStyle = body;                               // body
    ctx.fillRect(x, by - 5 - bob, 14, 3);
    ctx.fillStyle = roof;                               // cabin
    ctx.fillRect(x + 3, by - 8 - bob, 8, 3);
    ctx.fillStyle = glass;                              // windows
    ctx.fillRect(x + (c.dir > 0 ? 8 : 4), by - 7 - bob, 2, 2);
    ctx.fillRect(x + (c.dir > 0 ? 4 : 7), by - 7 - bob, 3, 2);
    ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.12 * pal.light})`;
    ctx.fillRect(x + 1, by - 5 - bob, 12, 1);           // paint highlight
    if (pal.light < 0.55) {                             // night lights
      ctx.fillStyle = '#ffeaa8';
      ctx.fillRect(front, by - 4 - bob, 1, 1);
      ctx.fillStyle = '#c03a44';
      ctx.fillRect(rear, by - 4 - bob, 1, 1);
      if (moving) {
        ctx.fillStyle = 'rgba(255,232,170,0.16)';       // headlight beam
        ctx.fillRect(c.dir > 0 ? x + 15 : x - 10, by - 4 - bob, 9, 2);
      }
    }
    if (!moving && c.state === 'gwait') {               // brake light at the gate
      ctx.fillStyle = '#ff5560';
      ctx.fillRect(rear, by - 4, 1, 1);
    }
  }

  // Security gate IN the perimeter fence: the chain-link terminates into a
  // gate post on the left and the guard booth on the right; the boom arm
  // spans the gap between them. Cars cross the perimeter here.
  _drawGateHouse(ctx, gateX, t, pal) {
    const g = this._gate;
    // left gate post — the fence run from the left connects into it
    ctx.fillStyle = this._lerpHex('#3a3a48', '#c8ccd8', pal.light);
    ctx.fillRect(gateX - 14, 146, 3, 12);
    const cyc = g.open > 0.02 && g.open < 0.98;         // beacon while cycling
    ctx.fillStyle = cyc && Math.floor(t * 6) % 2 ? '#ff4a55' : '#5c2228';
    ctx.fillRect(gateX - 14, 144, 3, 2);
    // striped boom arm across the fence gap (pivots up from the post)
    const a = g.open * Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let k = 2; k <= 13; k++) {
      const px = gateX - 12 + Math.round(k * ca);
      const py = 148 - Math.round(k * sa);
      ctx.fillStyle = (k >> 1) % 2 ? '#e8e8f0' : '#d04048';
      ctx.fillRect(px, py, 1, 1);
      if (k === 13) { ctx.fillStyle = '#d04048'; ctx.fillRect(px, py - 1, 1, 1); }
    }
    // guard booth standing IN the fence line — the right fence run connects
    // into its wall, so the booth is part of the perimeter
    const bx = gateX + 3;
    ctx.fillStyle = this._lerpHex('#262a38', '#4c5064', pal.light);
    ctx.fillRect(bx, 146, 11, 12);
    ctx.fillStyle = this._lerpHex('#1c1f2a', '#343848', pal.light);
    ctx.fillRect(bx - 1, 144, 13, 2);                   // roof
    ctx.fillStyle = pal.win;                            // window faces the gap
    ctx.fillRect(bx + 1, 148, 7, 4);
    // guard sits inside the booth, visible through the window — head slides
    // toward the gap when the gate is busy, else idle drift. Hidden while the
    // guard is out on the lawn chasing escaped cows (see _drawRanchLawn).
    const guardOut = this._ranchEvent && this._ranchEvent.guardOut;
    if (!guardOut) {
      const busy = g.open > 0.02;
      const idle = Math.sin(t * 0.35) > 0.6 ? 1 : 0;      // slow glance
      const hx = bx + 3 + (busy ? -1 : idle);
      ctx.fillStyle = '#d8a878';
      ctx.fillRect(hx, 149, 2, 2);                        // head
      ctx.fillStyle = '#252b3d';                          // uniform cap
      ctx.fillRect(hx, 148, 2, 1);
      if (busy && g.open < 0.98) {                        // arm on the gate button
        ctx.fillStyle = '#d8a878';
        ctx.fillRect(hx - 2, 150 + (Math.floor(t * 6) % 2), 1, 1);
      }
    }
    if (pal.light < 0.4) {                              // booth window glow
      ctx.fillStyle = 'rgba(232,194,90,0.12)';
      ctx.fillRect(bx, 147, 9, 6);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(bx, 158, 11, 1);                       // seat on the fence line
  }

  // ── Unified ranch gag ──────────────────────────────────────────────
  // One causal chain, one timer. A cow wanders onto the perimeter road and
  // grazes there; the next arrival can't stop, clips it, and cartwheels onto
  // the grass shoulder where it burns while the driver runs in circles. The
  // bang startles the rest of the herd, which bolts back and forth and then
  // shoves through the perimeter fence onto the campus lawn. The guard bolts
  // out of his booth, a cow charges him and bowls him flat, and once he's
  // back on his feet he draws his sidearm and pops the escapees — cartoon
  // register only: a muzzle puff, the cow blinks out, and a little cow ghost
  // floats off over the fence. He trudges home, the fence repairs, and a
  // while later replacement cows amble down from the horizon.
  //
  //   lure → approach → tumble → burn → panic → breakout → chase → bowled
  //        → down → recover → draw → ghosts → return → restock
  //
  // Advanced purely by elapsed time in _updateRanchEvent (no timers/rAF of
  // its own). Rendering splits across two z-layers: _drawRanchRoad sits with
  // the herd behind the fence, _drawRanchLawn in front of it.

  _startRanchEvent(t, W) {
    if (this._ranchEvent || this._ufo) return false;
    const gateX = Math.floor(W * 0.28);
    const hitX = Math.max(44, gateX - 58);        // on the approach, before the gate
    const breakX = Math.max(26, gateX - 34);      // fence break, left of the gate
    const pool = this._cowsFG.filter((c) => !c.escaped && !c.held);
    if (pool.length < 2) return false;            // need a victim AND a herd to panic
    let cow = pool[0];
    for (const c of pool) if (Math.abs(c.x - hitX) < Math.abs(cow.x - hitX)) cow = c;
    cow.held = true;
    this._ranchEvent = {
      phase: 'lure', t0: t, gateX, hitX, breakX,
      herd0: this._cowsFG.length,                 // restock target
      cow, homeX: cow.x, homeFoot: cow.foot,
      car: null, wreck: null, driver: null, fly: null,
      cowT: -1, cowT0: 0, cowHome: false, puffAt: 0, skid: false,
      settled: false, burning: false, alpha: 1, fadeT0: 0,
      fenceBroken: false, panic: [], cows: [], bully: null,
      hitAt: 0, bowlDir: -1, bowlX0: 0,
      shots: [], nextShotAt: 0, newCows: null, restockAt: 0,
      guardOut: false, mooed: false, bubble: null,
      guard: { x: gateX + 6, foot: 158, dir: -1, pose: 'idle', phase: Math.random() * 6 },
    };
    this._nextRanchAt = t + 1e6;                  // rescheduled when the chain ends
    return true;
  }

  _updateRanchEvent(t, dt, W) {
    const ev = this._ranchEvent;
    if (!ev) return;
    const g = ev.guard;
    const age = t - ev.t0;
    const D = RANCH_DUR;
    const ROAD = 150;         // hoof/wheel line of the outside road lane
    const SHOULDER = 141;     // grass shoulder the wreck cartwheels onto
    const LAND = ROAD - 4;    // where the punted cow touches back down
    const LAWN = 176;         // the guard's foot line out on the campus lawn
    const clamp01 = (p) => Math.max(0, Math.min(1, p));
    const lerp = (a, b, p) => a + (b - a) * clamp01(p);
    // move obj[key] toward target at sp px/s; returns true once arrived
    const approach = (o, k, target, sp) => {
      const d = target - o[k];
      if (Math.abs(d) <= sp * dt) { o[k] = target; return true; }
      o[k] += Math.sign(d) * sp * dt;
      return false;
    };

    // The punted cow runs on its own clock so it can pick itself up and trot
    // home while the wreck is still burning — and it's back with the herd in
    // time to join the panic. Wall-clock, not accumulated dt: dt is capped at
    // 50ms, so on a slow frame the two would drift apart.
    if (ev.cowT0 && !ev.cowHome) {
      const cow = ev.cow;
      ev.cowT = t - ev.cowT0;
      if (ev.cowT < 1.25) {                       // airborne, tumbling
        const p = ev.cowT / 1.25;
        ev.fly.x = ev.fly.x0 + 62 * ev.cowT;           // clears the wreck comfortably
        ev.fly.y = ROAD + (LAND - ROAD) * p - 44 * Math.sin(Math.PI * p);
        ev.fly.q = Math.floor(p * 5);
      } else if (ev.cowT < 1.8) {                 // four-point landing, dazed
        cow.x = ev.fly.x; cow.foot = LAND;
      } else if (ev.cowT < 4.8) {                 // shakes it off, trots home
        if (cow.escaped) { cow.escaped = false; cow.held = true; }
        cow.state = 'amble';
        cow.dir = ev.homeX < cow.x ? -1 : 1;
        approach(cow, 'x', ev.homeX, 15);
        const p = Math.min(1, (ev.cowT - 1.8) / 2.4);
        cow.foot = LAND + (ev.homeFoot - LAND) * p;
      } else {                                    // back with the herd, unharmed
        ev.cowHome = true;
        cow.escaped = false; cow.held = false;
        cow.foot = ev.homeFoot;
        cow.state = 'graze'; cow.stateT = 0; cow.dur = 3; cow.flipped = false;
      }
    }

    // The wreck smokes and the driver paces beside it from the moment he bails
    // until the guard heads home; after that he trudges off to the gate while
    // the whole road layer fades out.
    const w = ev.wreck, d = ev.driver;
    if (w && d) {
      if (ev.burning) {
        if (t - ev.wreckAt > 0.6) {
          d.out = true;
          if (approach(d, 'x', d.goal, 26)) {           // paces back and forth
            d.goal = d.goal < w.x ? w.x + 17 : w.x - 15;
          }
          d.dir = d.goal > d.x ? 1 : -1;
        }
        if (t >= ev.puffAt) {                           // smoke column
          ev.puffAt = t + 0.26;
          this._smoke.push({
            x: w.x + 6 + (Math.random() * 6 - 3), y: w.y - 12,
            t0: t, dur: 1.5 + Math.random() * 0.9, drift: Math.random() * 7 - 3.5,
          });
        }
      } else {
        ev.alpha = Math.max(0, 1 - (t - ev.fadeT0) / D.wreckFade);
        d.dir = 1;
        d.x += 20 * dt;
      }
    }

    switch (ev.phase) {
      case 'lure': {
        const cow = ev.cow;
        cow.state = 'amble';
        cow.dir = ev.hitX < cow.x ? -1 : 1;
        const atX = approach(cow, 'x', ev.hitX, 13);
        const atY = approach(cow, 'foot', ROAD, 9);
        if ((atX && atY) || age > D.lure) {
          cow.x = ev.hitX; cow.foot = ROAD;
          cow.state = 'graze'; cow.stateT = 0; cow.dur = 40;   // head down, oblivious
          const car = this._makeCar();
          car.x = -30;
          this._cars.push(car);
          ev.car = car;
          this._nextCarT = t + 45;                             // no other arrivals
          ev.phase = 'approach'; ev.t0 = t;
        }
        break;
      }
      case 'approach': {
        const car = ev.car;
        if (!car || !this._cars.includes(car)) { this._endRanchEvent(t); break; }
        if (car.x > ev.hitX - 30) ev.skid = true;              // brakes, too late
        if (car.x + 12 >= ev.hitX - 2 || age > 25) {   // escape if the car never lands
          ev.phase = 'tumble'; ev.t0 = t;
          ev.wreck = {
            car: { x: car.x, dir: 1, color: car.color, phase: car.phase, state: 'wreck' },
            x0: car.x, x: car.x, y: ROAD, q: 0,
          };
          this._cars = this._cars.filter((k) => k !== car);
          ev.car = null;
          ev.cow.held = false; ev.cow.escaped = true;          // the event draws it now
          ev.fly = { x0: ev.cow.x, x: ev.cow.x, y: ROAD, q: 0 };
          ev.cowT = 0; ev.cowT0 = t;
          this._nextCarT = t + 30;
        }
        break;
      }
      case 'tumble': {
        const p = Math.min(1, age / D.tumble);
        ev.wreck.x = ev.wreck.x0 + 30 * Math.min(age, D.tumble);
        ev.wreck.y = ROAD + (SHOULDER - ROAD) * p - 22 * Math.sin(Math.PI * p);
        ev.wreck.q = Math.floor(p * 6);                        // 1.5 flips
        if (p >= 1) {
          ev.wreck.x = Math.round(ev.wreck.x); ev.wreck.y = SHOULDER; ev.wreck.q = 2;
          ev.phase = 'burn'; ev.t0 = t;
          ev.settled = true; ev.burning = true; ev.wreckAt = t;
          ev.driver = {
            x: ev.wreck.x + 7, foot: 146, dir: -1, goal: ev.wreck.x - 14,
            phase: Math.random() * 6, out: false,
          };
        }
        break;
      }
      case 'burn': {
        // hold until the punted cow is back on its feet, so it panics too
        if (age >= D.burn && (ev.cowHome || age > D.burn + 4)) {
          // the bang finally registers: every cow still with the herd bolts
          ev.panic = this._cowsFG.filter((c) => !c.escaped && !c.held).map((c) => {
            c.held = true;                        // event drives it, herd pass draws it
            c.state = 'amble'; c.stateT = 0;
            return { ref: c, homeFoot: c.foot, flipAt: t + 0.15 + Math.random() * 0.3 };
          });
          if (!ev.panic.length) { this._endRanchEvent(t); break; }
          ev.phase = 'panic'; ev.t0 = t;
        }
        break;
      }
      case 'panic': {
        for (const p of ev.panic) {
          const c = p.ref;
          c.state = 'amble';
          if (t >= p.flipAt) {                    // skittish direction flips
            p.flipAt = t + 0.22 + Math.random() * 0.32;
            c.dir *= -1;
          }
          c.x += c.dir * 22 * dt;                 // ~5x an amble — this is a bolt
          c.x += Math.sign(ev.breakX - c.x) * 16 * dt;  // net drift toward the break
          c.x = Math.max(12, Math.min(W - 12, c.x));
        }
        if (age >= D.panic) {
          // the 2-3 that ended up nearest the break shove through it
          const rank = ev.panic.slice().sort(
            (a, b) => Math.abs(a.ref.x - ev.breakX) - Math.abs(b.ref.x - ev.breakX));
          const n = Math.min(rank.length, 2 + ((Math.random() * 2) | 0));
          ev.cows = rank.slice(0, n).map((p, i) => {
            const c = p.ref;
            c.held = false; c.escaped = true;     // pulled out of the herd pass
            return {
              ref: c, homeX: c.x, homeFoot: p.homeFoot,
              lawnX: ev.breakX - 6 - i * 14,      // spread out on the lawn
              lawnFoot: 178 + i * 5,              // in front of the fence
              through: 0, gone: 0,
            };
          });
          for (const p of rank.slice(n)) {        // the rest settle back down
            const c = p.ref;
            c.held = false;
            c.state = 'idle'; c.stateT = 0; c.dur = 1.5; c.flipped = false;
          }
          ev.panic = [];
          ev.phase = 'breakout'; ev.t0 = t; ev.fenceBroken = true;
        }
        break;
      }
      case 'breakout': {
        // cows shuffle to the break, then shove through onto the lawn. Driven
        // by arrival, not the clock: dt is capped, so on a slow frame a purely
        // timed drop would dump them onto the lawn short of the hole.
        ev.cows.forEach((cw, i) => {
          const c = cw.ref;
          c.state = 'amble';
          const tx = ev.breakX - 2 - i * 4;
          c.dir = tx < c.x ? -1 : 1;
          if (approach(c, 'x', tx, 26)) cw.through = Math.min(1, cw.through + dt / 0.7);
          c.foot = Math.round(lerp(cw.homeFoot, cw.lawnFoot, cw.through * cw.through));
        });
        if (ev.cows.every((cw) => cw.through >= 1) || age >= D.breakout * 2.5) {
          for (const cw of ev.cows) cw.ref.foot = cw.lawnFoot;
          ev.phase = 'chase'; ev.t0 = t; ev.guardOut = true;
          g.pose = 'run'; g.dir = -1;
        }
        break;
      }
      case 'chase': {
        approach(g, 'foot', 174, 40);                  // step down onto the lawn
        // he overruns the whole cluster to head it off — which is exactly why
        // the cow on the end gets a clear run at him from behind
        const targetX = Math.max(20, Math.min(...ev.cows.map((cw) => cw.lawnX)) - 8);
        g.dir = targetX < g.x ? -1 : 1;
        approach(g, 'x', targetX, 32);
        g.pose = 'run';
        ev.cows.forEach((cw) => {                       // cows scatter to their spots
          const c = cw.ref;
          c.state = 'amble';
          c.dir = cw.lawnX < c.x ? -1 : 1;
          approach(c, 'x', cw.lawnX, 18);
          c.foot = cw.lawnFoot;
        });
        const near = Math.abs(g.x - targetX) < 3;
        if ((near && age > 0.9) || age >= D.chase * 2.5) {
          // the cow that ends up nearest gets the clear run at him
          ev.bully = ev.cows.reduce(
            (a, b) => (Math.abs(a.ref.x - g.x) <= Math.abs(b.ref.x - g.x) ? a : b));
          ev.phase = 'bowled'; ev.t0 = t; ev.hitAt = 0;
          g.pose = 'stand'; g.foot = LAWN;
        }
        break;
      }
      case 'bowled': {
        const c = ev.bully.ref;
        if (!ev.hitAt) {                               // the cow lines up and charges
          c.state = 'amble';
          c.dir = g.x > c.x ? 1 : -1;
          g.dir = -c.dir;                              // guard turns to face it
          approach(c, 'foot', LAWN, 26);               // up onto his line, for contact
          approach(c, 'x', g.x - c.dir * 2, 62);
          if (Math.abs(g.x - c.x) < 6 || age > D.charge) {
            // knocked along the charge, and turned to face the way he's flying
            ev.hitAt = t; ev.bowlDir = c.dir; ev.bowlX0 = g.x;
            g.dir = c.dir; g.pose = 'trip';
          }
        } else {
          const p = clamp01((t - ev.hitAt) / D.fly);
          g.x = Math.max(14, ev.bowlX0 + ev.bowlDir * 26 * p);
          g.foot = LAWN - Math.round(13 * Math.sin(Math.PI * p));
          c.x += ev.bowlDir * 12 * dt;                 // the cow follows through
          if (p >= 1) {
            g.foot = LAWN; g.pose = 'down';
            ev.phase = 'down'; ev.t0 = t;
          }
        }
        break;
      }
      case 'down': {
        g.pose = 'down';
        ev.cows.forEach((cw) => { cw.ref.state = 'graze'; });  // cows graze, smug
        if (age >= D.down) { ev.phase = 'recover'; ev.t0 = t; g.pose = 'getup'; }
        break;
      }
      case 'recover': {
        g.pose = 'getup';
        if (!ev.mooed && age > 0.4) {                  // a triumphant moo
          ev.mooed = true;
          const c = ev.cows[0] && ev.cows[0].ref;
          if (c) { c.state = 'moo'; c.stateT = 0; }
        }
        if (age >= D.recover) {
          ev.phase = 'draw'; ev.t0 = t;
          g.pose = 'stand'; ev.bubble = '!';
          ev.nextShotAt = t + D.aim;
        }
        break;
      }
      case 'draw': {
        const live = ev.cows.filter((cw) => !cw.gone);
        const at = ev.cows[0] ? ev.cows[0].ref.x : g.x;
        g.dir = at < g.x ? -1 : 1;
        if (age < D.aim) { g.pose = 'stand'; break; }
        ev.bubble = null;
        g.pose = 'draw';
        if (live.length && t >= ev.nextShotAt) {
          ev.nextShotAt = t + D.shotGap;
          const cw = live[0], c = cw.ref;
          const mx = Math.round(g.x + g.dir * 8), my = Math.round(g.foot) - 7;   // barrel tip
          ev.shots.push({
            x0: mx, y0: my, x1: Math.round(c.x), y1: Math.round(c.foot) - 5,
            dir: g.dir, t0: t,
          });
          cw.gone = t;                                 // blinks out where it stood
          this._cowGhosts.push({
            x0: c.x, y0: c.foot - 6, dir: c.dir, t0: t, wob: Math.random() * 6.28,
          });
          const k = this._cowsFG.indexOf(c);           // herd is short until restock
          if (k >= 0) this._cowsFG.splice(k, 1);
        }
        if (!live.length || age > D.aim + ev.cows.length * D.shotGap + 3) {
          ev.phase = 'ghosts'; ev.t0 = t;
        }
        break;
      }
      case 'ghosts': {
        g.pose = age < 0.7 ? 'draw' : 'stand';         // sidearm down, watching them go
        if (age >= D.ghosts) {
          ev.phase = 'return'; ev.t0 = t;
          g.pose = 'walk'; g.dir = 1; ev.bubble = null;
          ev.fenceBroken = false;                      // fence patched behind him
          ev.burning = false; ev.fadeT0 = t;           // ...and the wreck fades out
        }
        break;
      }
      case 'return': {
        g.pose = 'walk';
        const homeX = ev.gateX + 6;
        g.dir = homeX > g.x ? 1 : -1;
        const atHome = approach(g, 'x', homeX, 30);
        const inBooth = atHome && approach(g, 'foot', 158, 22);   // step up into it
        ev.cows.forEach((cw, i) => {                   // any survivor wanders home too
          if (cw.gone) return;
          const c = cw.ref;
          c.state = 'amble';
          const tx = ev.breakX - 2 - i * 4;
          c.dir = tx < c.x ? -1 : 1;
          const at = approach(c, 'x', tx, 16);
          if (at) cw.through = Math.max(0, cw.through - dt / 0.7);
          c.foot = Math.round(lerp(cw.homeFoot, cw.lawnFoot, cw.through * cw.through));
        });
        if (inBooth || age >= D.return * 2.5) {
          for (const cw of ev.cows) {                  // hand survivors back
            if (cw.gone) continue;
            const c = cw.ref;
            c.escaped = false; c.held = false; c.foot = cw.homeFoot;
            c.state = 'idle'; c.stateT = 0; c.dur = 1.5; c.flipped = false;
          }
          ev.guardOut = false;
          ev.phase = 'restock'; ev.t0 = t;
          ev.restockAt = t + randIn(RESTOCK_WAIT);
        }
        break;
      }
      case 'restock': {
        if (!ev.newCows) {
          if (t < ev.restockAt) break;
          const need = Math.max(0, ev.herd0 - this._cowsFG.length);
          if (!need) { this._endRanchEvent(t); break; }
          ev.newCows = [];
          for (let i = 0; i < need; i++) {             // fade in on the horizon line
            const c = this._makeHerdCow(40 + Math.random() * (W - 80), RANCH_HORIZON);
            c.held = true; c.fade = 0; c.state = 'amble';
            this._cowsFG.push(c);
            ev.newCows.push({ ref: c, foot: 138 + ((Math.random() * 13) | 0), delay: i * 0.7 });
          }
          ev.t0 = t;
          break;
        }
        let done = true;
        for (const n of ev.newCows) {                  // amble down into the herd band
          const c = n.ref;
          if (age < n.delay) { done = false; continue; }
          c.fade = Math.min(1, (age - n.delay) / 1.4);
          c.x += c.dir * 3 * dt;
          if (!approach(c, 'foot', n.foot, 4.5)) done = false;
        }
        if (done || age > D.restock * 2.5) this._endRanchEvent(t);
        break;
      }
    }
  }

  // Ends the chain from anywhere — normal completion or an early bail-out —
  // and guarantees the herd comes out of it whole: no cow left flagged, none
  // stranded off the ranch band, and the count back to what it started at
  // (restock is the only thing allowed to shrink it, and only temporarily).
  _endRanchEvent(t) {
    const ev = this._ranchEvent;
    this._ranchEvent = null;
    this._nextRanchAt = t + randIn(EVENT_TIMING.ranchGap);
    if (!ev) return;
    const herd = this._cowsFG;
    for (const c of herd) {
      const borrowed = c.escaped || c.held;
      c.escaped = false; c.held = false; c.fade = 1;
      if (!borrowed) continue;
      if (c.foot < 136 || c.foot > 152) c.foot = 138 + ((Math.random() * 13) | 0);
      c.state = 'idle'; c.stateT = 0; c.dur = 1.5; c.flipped = false;
    }
    const back = (c, x, foot) => { if (herd.includes(c)) { c.x = x; c.foot = foot; } };
    if (ev.cow) back(ev.cow, ev.homeX, ev.homeFoot);
    for (const cw of ev.cows) if (!cw.gone) back(cw.ref, cw.homeX, cw.homeFoot);
    for (const n of ev.newCows || []) {              // arrivals settle where they aimed
      n.ref.foot = n.foot;
      n.ref.state = 'graze'; n.ref.stateT = 0; n.ref.dur = 3;
    }
    while (herd.length < ev.herd0) {                 // top the herd back up
      herd.push(this._makeHerdCow(
        30 + Math.random() * ((this.W || 480) - 60), 138 + ((Math.random() * 13) | 0)));
    }
    if (ev.car) this._cars = this._cars.filter((k) => k !== ev.car);
  }

  // A replacement herd cow (restock, and the safety top-up in _endRanchEvent).
  _makeHerdCow(x, foot) {
    return {
      x, foot,
      dir: Math.random() < 0.5 ? -1 : 1,
      state: 'graze', stateT: 0, dur: 3 + Math.random() * 4, target: x,
      seed: (Math.random() * 97) | 0,
      calf: Math.random() < 0.25,
      mooOff: Math.random() * 52,
      flipped: false,
    };
  }

  // Road layer: everything on the tarmac/shoulder, drawn with the herd and
  // behind the fence. Fades out as one with ev.alpha once the wreck clears.
  _drawRanchRoad(ctx, t, pal) {
    const ev = this._ranchEvent;
    if (!ev) return;

    // the startled herd: "!" over about half of them at a time, cycling
    ev.panic.forEach((p, i) => {
      if (Math.floor(t * 2.5 + i) % 2) return;
      this._drawBubble(ctx, Math.round(p.ref.x), Math.round(p.ref.foot) - 9, '!');
    });
    if (ev.alpha <= 0) return;
    ctx.globalAlpha = ev.alpha;

    // skid marks on the tarmac
    if (ev.skid) {
      ctx.fillStyle = 'rgba(10,10,14,0.45)';
      for (let i = 0; i < 9; i++) {
        if (i % 3 === 2) continue;
        ctx.fillRect(ev.hitX - 22 + i * 3, 146, 2, 1);
        ctx.fillRect(ev.hitX - 22 + i * 3, 149, 2, 1);
      }
    }

    // the cow, punted into a spinning arc (drawn here only while airborne —
    // the rest of the time it rides along in the normal herd pass)
    if (ev.fly && ev.cowT >= 0 && ev.cowT < 1.8) {
      const cow = ev.cow;
      cow.x = ev.fly.x;
      cow.foot = ev.fly.y;
      const cx = Math.round(cow.x), cy = Math.round(cow.foot) - 4;
      const spinning = ev.cowT < 1.25;
      cow.state = spinning ? 'amble' : 'idle';
      this._rotQ(ctx, cx, cy, spinning ? ev.fly.q : 0,
        () => this._drawCowFG(ctx, cow, t * 2, pal));
      if (!spinning) {                                   // dust puff on landing
        const s = Math.round((ev.cowT - 1.25) * 9);
        ctx.fillStyle = 'rgba(190,180,150,0.45)';
        ctx.fillRect(cx - 5 - s, Math.round(cow.foot) - 1, 3, 1);
        ctx.fillRect(cx + 3 + s, Math.round(cow.foot) - 1, 3, 1);
      }
      if (ev.cowT > 0.05 && ev.cowT < 1.7) {
        this._drawBubble(ctx, cx, Math.round(cow.foot) - 13, '!');
      }
    }

    // the wreck: quarter-turn tumble, then flat on its roof and burning
    const w = ev.wreck;
    if (w) {
      const wx = Math.round(w.x), wy = Math.round(w.y);
      w.car.x = wx;
      this._rotQ(ctx, wx + 7, wy - 4, w.q, () => this._drawCar(ctx, w.car, wy, false, t, pal));
      if (ev.settled) {
        ctx.fillStyle = 'rgba(58,46,28,0.5)';            // gouged dirt off the road
        ctx.fillRect(wx - 11, 143, 19, 1);
        ctx.fillRect(wx - 6, 142, 13, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';               // seats the wreck
        ctx.fillRect(wx, wy, 14, 1);
        ctx.fillStyle = '#101016';                       // wheel that rolled clear
        ctx.fillRect(wx - 7, wy - 2, 2, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';              // dents / broken glass
        ctx.fillRect(wx + 3, wy - 7, 3, 1);
        const fy = wy - 9;
        this._drawFlame(ctx, wx + 4, fy, t, 0, 1);
        this._drawFlame(ctx, wx + 10, fy, t, 2.4, 0.7);
        if (pal.light < 0.65) {                          // firelight after dark
          const gl = (1 - pal.light) * (0.9 + 0.1 * Math.sin(t * 11));
          for (let k = 0; k < 3; k++) {                  // stepped falloff, not a box
            ctx.fillStyle = `rgba(255,150,60,${(0.07 * gl).toFixed(2)})`;
            ctx.fillRect(wx - 1 - k * 5, fy - 4 - k * 4, 16 + k * 10, 12 + k * 7);
          }
        }
      }
    }

    // the driver, running around waving both arms
    const d = ev.driver;
    if (d && d.out) {
      const dx = Math.round(d.x);
      this._drawDriver(ctx, dx, Math.round(d.foot), d.dir, t, d.phase, ev.wreck.car.color);
      if (Math.floor(t * 1.7) % 2 === 0) this._drawBubble(ctx, dx, Math.round(d.foot) - 15, '!');
    }
    ctx.globalAlpha = 1;
  }

  // Lawn layer: broken fence, escaped cows, the guard and his gunplay — all
  // in front of the fence line. Cow ghosts draw first and unconditionally, so
  // they finish floating even if the chain ends underneath them.
  _drawRanchLawn(ctx, gateX, t, pal, W) {
    for (const gh of this._cowGhosts) this._drawCowGhost(ctx, gh, t);
    const ev = this._ranchEvent;
    if (!ev) return;
    const fenceY = 158;
    // broken fence: repaint the trampled section with ranch grass, then a
    // couple of bent posts. Shown from breakout until the guard heads home.
    if (ev.fenceBroken) {
      const bx = ev.breakX;
      ctx.fillStyle = pal.hillF;                       // grass fills the hole
      ctx.fillRect(bx - 7, fenceY - 7, 14, 7);
      ctx.fillStyle = pal.fence;                       // flattened / bent posts
      ctx.fillRect(bx - 6, fenceY - 3, 1, 3);
      ctx.fillRect(bx - 6, fenceY - 3, 2, 1);
      ctx.fillRect(bx + 5, fenceY - 4, 1, 4);
      ctx.fillRect(bx + 4, fenceY - 4, 1, 1);
      ctx.fillRect(bx - 3, fenceY - 1, 4, 1);          // trampled top rail on the ground
    }
    // escaped cows reuse the herd renderer; a shot one leaves a cartoon poof
    for (const cw of ev.cows) {
      const cx = Math.round(cw.ref.x), cy = Math.round(cw.ref.foot);
      if (!cw.gone) { this._drawCowFG(ctx, cw.ref, t, pal); continue; }
      const p = (t - cw.gone) / 0.22;
      if (p > 1) continue;
      const s = 2 + Math.round(p * 6);
      ctx.fillStyle = `rgba(240,250,255,${(0.7 * (1 - p)).toFixed(2)})`;
      ctx.fillRect(cx - s, cy - 5 - (s >> 1), s * 2, s);
    }
    // the guard, out on the lawn
    if (ev.guardOut) {
      const g = ev.guard;
      const gx = Math.round(g.x), gf = Math.round(g.foot);
      this._drawGuard(ctx, gx, gf, g.dir, g.pose, t, g.phase);
      if (ev.bubble) this._drawBubble(ctx, gx, gf - 13, ev.bubble);
    }
    // muzzle flash + dashed tracer, a handful of frames each
    for (const s of ev.shots) {
      const a = t - s.t0;
      if (a > 0.16) continue;
      const n = Math.max(1, Math.abs(s.x1 - s.x0));
      ctx.fillStyle = a < 0.07 ? '#fff6d0' : 'rgba(255,214,120,0.6)';
      for (let k = 4; k <= n; k += 2) {                 // 1px tracer to the cow
        const f = k / n;
        ctx.fillRect(Math.round(s.x0 + (s.x1 - s.x0) * f),
          Math.round(s.y0 + (s.y1 - s.y0) * f), 1, 1);
      }
      if (a < 0.11) {                                  // chunky muzzle puff
        ctx.fillStyle = '#ffe680';
        ctx.fillRect(s.x0 + (s.dir > 0 ? 0 : -2), s.y0 - 1, 3, 3);
        ctx.fillStyle = '#fff6d0';
        ctx.fillRect(s.x0 + s.dir * 3, s.y0, 2, 1);
      }
    }
  }

  // A cow ghost, in the same register as the ghost-employee gag: white wobbly
  // body, horn nubs, a tail wisp, drifting up over the fence as it fades.
  _drawCowGhost(ctx, g, t) {
    const age = t - g.t0;
    const dur = 3.4;
    const a = age < 0.2 ? age / 0.2 : Math.max(0, 1 - (age - 0.2) / (dur - 0.2));
    if (a <= 0) return;
    const d = g.dir || 1;
    const x = Math.round(g.x0 + Math.sin(age * 2.4 + g.wob) * 3);
    const y = Math.round(g.y0 - age * 16);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = '#e2f2ff';
    ctx.fillRect(x - 4, y - 5, 8, 4);                  // body
    ctx.fillRect(x - 3, y - 6, 6, 1);                  // rounded back
    const hx = x + d * 5;
    ctx.fillRect(hx - 1, y - 7, 3, 3);                 // head
    ctx.fillRect(hx - 1, y - 8, 1, 1);                 // horn nubs
    ctx.fillRect(hx + 1, y - 8, 1, 1);
    for (let i = 0; i < 4; i++) {                      // wavy hem where the legs were
      ctx.fillRect(x - 4 + i * 2, y - 1 + (Math.sin(t * 7 + i * 2.1) > 0 ? 0 : 1), 1, 1);
    }
    const tx = x - d * 5;                              // tail wisp, curling
    ctx.fillRect(tx, y - 4, 1, 2);
    ctx.fillRect(tx - d, y - 2 + (Math.sin(t * 6 + g.wob) > 0 ? 0 : 1), 1, 1);
    ctx.fillStyle = '#3a6a8c';
    ctx.fillRect(hx + (d > 0 ? 1 : -1), y - 6, 1, 1);  // eye
    ctx.globalAlpha = 1;
  }

  // Security guard sprite (~12px), styled like the little scene people but in
  // a navy-capped blue uniform with a gold badge. pose: run | trip | down |
  // getup | stand | walk | draw. dir +1 faces right.
  _drawGuard(ctx, x, footY, dir, pose, t, phase) {
    const dark = '#1a1a22';
    const skin = '#d8a878';
    const shirt = '#4f6fa8';
    const shirtDark = '#3c568a';
    const trouser = '#232838';
    const cap = '#20263c';
    const capBrim = '#151a2c';
    const badge = '#e8c25a';
    const boots = '#12121a';

    if (pose === 'down') {
      // flat on the lawn, cap knocked off, dazed stars circling
      ctx.fillStyle = shirt;
      ctx.fillRect(x - 4, footY - 2, 7, 2);            // torso
      ctx.fillStyle = trouser;                         // legs
      ctx.fillRect(x + (dir > 0 ? -6 : 4), footY - 2, 3, 2);
      ctx.fillStyle = boots;
      ctx.fillRect(x + (dir > 0 ? -6 : 6), footY - 1, 1, 1);
      ctx.fillStyle = skin;                            // head off to the side
      const hxx = x + (dir > 0 ? 3 : -5);
      ctx.fillRect(hxx, footY - 3, 3, 3);
      ctx.fillStyle = dark;                            // dizzy X eye
      ctx.fillRect(hxx + (dir > 0 ? 1 : 1), footY - 2, 1, 1);
      ctx.fillStyle = cap;                             // cap knocked off nearby
      ctx.fillRect(x + (dir > 0 ? 6 : -8), footY - 1, 3, 1);
      ctx.fillStyle = capBrim;
      ctx.fillRect(x + (dir > 0 ? 6 : -8), footY, 3, 1);
      ctx.fillStyle = '#ffe066';                       // circling stars
      for (let i = 0; i < 3; i++) {
        const ang = t * 5 + i * 2.09;
        ctx.fillRect(hxx + 1 + Math.round(Math.cos(ang) * 4),
          footY - 5 + Math.round(Math.sin(ang) * 1.5), 1, 1);
      }
      return;
    }

    if (pose === 'trip') {
      // pitched forward mid-stumble: arms out, legs kicked up behind
      ctx.fillStyle = shirt;
      ctx.fillRect(x - 1, footY - 7, 4, 3);            // torso, low
      ctx.fillRect(x + dir * 2, footY - 6, 3, 3);      // shoulders thrust forward
      ctx.fillStyle = trouser;                         // legs flying up behind
      ctx.fillRect(x - dir * 3, footY - 9, 3, 2);
      ctx.fillRect(x - dir * 4, footY - 11, 2, 2);
      ctx.fillStyle = boots;
      ctx.fillRect(x - dir * 5, footY - 12, 1, 1);
      ctx.fillStyle = skin;                            // head thrown down-forward
      ctx.fillRect(x + dir * 4, footY - 5, 3, 3);
      ctx.fillRect(x + dir * 5, footY - 7, 2, 1);      // outstretched arm
      ctx.fillStyle = cap;                             // cap flying off ahead
      ctx.fillRect(x + dir * 6, footY - 9, 3, 1);
      ctx.fillStyle = capBrim;
      ctx.fillRect(x + dir * 7, footY - 9, 1, 1);
      ctx.fillStyle = '#ffe066';                       // motion sparkles
      ctx.fillRect(x - dir * 6, footY - 8, 1, 1);
      return;
    }

    if (pose === 'getup') {
      // crouched, pushing back up off the ground
      ctx.fillStyle = trouser;
      ctx.fillRect(x - 2, footY - 2, 5, 2);            // folded legs
      ctx.fillStyle = shirt;                           // hunched torso
      ctx.fillRect(x - 2, footY - 7, 5, 5);
      ctx.fillStyle = shirtDark;
      ctx.fillRect(x + dir, footY - 7, 1, 5);
      ctx.fillStyle = badge;
      ctx.fillRect(x + (dir > 0 ? -1 : 1), footY - 6, 1, 1);
      ctx.fillStyle = skin;                            // head, still low
      ctx.fillRect(x - 1, footY - 10, 3, 3);
      ctx.fillRect(x + (dir > 0 ? 3 : -4), footY - 5, 2, 1);  // arm propping up
      ctx.fillStyle = cap;
      ctx.fillRect(x - 1, footY - 11, 3, 1);
      ctx.fillStyle = capBrim;
      ctx.fillRect(x - 2 + (dir > 0 ? 1 : 0), footY - 10, 4, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(x + (dir > 0 ? 1 : -1), footY - 9, 1, 1);  // eye
      return;
    }

    // upright poses: run | walk | stand
    const moving = pose === 'run' || pose === 'walk';
    const spd = pose === 'run' ? 11 : 6;
    const frame = moving ? Math.floor(t * spd + phase) % 2 : 0;

    // legs
    ctx.fillStyle = trouser;
    if (moving) {
      if (frame === 0) { ctx.fillRect(x - 2, footY - 3, 2, 3); ctx.fillRect(x + 1, footY - 3, 2, 3); }
      else { ctx.fillRect(x - 3, footY - 3, 2, 3); ctx.fillRect(x + 2, footY - 3, 2, 3); }  // stride
    } else {
      ctx.fillRect(x - 2, footY - 3, 2, 3); ctx.fillRect(x + 1, footY - 3, 2, 3);
    }
    ctx.fillStyle = boots;                             // boots
    if (moving && frame) { ctx.fillRect(x - 3, footY - 1, 1, 1); ctx.fillRect(x + 3, footY - 1, 1, 1); }
    else { ctx.fillRect(x - 2, footY - 1, 1, 1); ctx.fillRect(x + 2, footY - 1, 1, 1); }

    // torso (leans forward a touch while running)
    const lean = pose === 'run' ? dir : 0;
    ctx.fillStyle = shirt;
    ctx.fillRect(x - 2 + lean, footY - 9, 5, 6);
    ctx.fillStyle = shirtDark;
    ctx.fillRect(x + dir + lean, footY - 9, 1, 6);
    ctx.fillStyle = badge;                             // chest badge
    ctx.fillRect(x + (dir > 0 ? -1 : 1) + lean, footY - 8, 1, 1);

    // arms
    ctx.fillStyle = skin;
    if (moving) {                                      // pumping arm
      ctx.fillRect(x + (dir > 0 ? 3 : -4) + lean, footY - 8 + (frame ? 1 : 0), 1, 2);
    } else if (pose === 'draw') {                      // sidearm out at arm's length
      ctx.fillRect(x + (dir > 0 ? 3 : -5), footY - 7, 3, 1);       // extended arm
      ctx.fillRect(x + (dir > 0 ? -3 : 3), footY - 7, 1, 2);       // trailing arm
      ctx.fillStyle = dark;
      ctx.fillRect(x + (dir > 0 ? 6 : -7), footY - 8, 2, 2);       // pistol
      ctx.fillRect(x + (dir > 0 ? 6 : -6), footY - 6, 1, 1);       // grip
    } else {                                           // hands-on-hips shrug
      ctx.fillRect(x - 3, footY - 7, 1, 2);
      ctx.fillRect(x + 3, footY - 7, 1, 2);
    }

    // head
    const headY = footY - 12;
    ctx.fillStyle = skin;
    ctx.fillRect(x - 1 + lean, headY, 3, 3);
    ctx.fillStyle = dark;
    ctx.fillRect(x + (dir > 0 ? 1 : -1) + lean, headY + 1, 1, 1);   // eye
    ctx.fillStyle = cap;                               // navy cap + forward brim
    ctx.fillRect(x - 1 + lean, headY - 1, 3, 1);
    ctx.fillStyle = capBrim;
    ctx.fillRect(x - 2 + lean + (dir > 0 ? 1 : 0), headY, 4, 1);
  }

  // Run fn() rotated by q quarter-turns about (cx, cy). The transform is an
  // exact integer matrix, so axis-aligned rects stay perfectly crisp — no
  // antialiased pixel mush from ctx.rotate()'s floating-point sin/cos.
  _rotQ(ctx, cx, cy, q, fn) {
    const n = ((Math.round(q) % 4) + 4) % 4;
    if (!n) { fn(); return; }
    const [a, b, c, d] = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]][n];
    ctx.save();
    ctx.transform(a, b, c, d, cx - (a * cx + c * cy), cy - (b * cx + d * cy));
    fn();
    ctx.restore();
  }

  // ── UFO cow abduction (rare Easter egg) ────────────────────────────
  // A saucer drifts in over the hill crests, parks above a cow, drops a
  // banded tractor beam with a glowing pool on the grass, reels the cow up
  // kicking and wobbling, then zips off the way it came. Same time-driven
  // shape as the cow-escape event: phases advance on elapsed time in
  // _updateUfoEvent, everything renders in _drawUfoEvent.

  _startUfoEvent(t, W) {
    if (this._ufo || this._ranchEvent) return false;
    const pool = this._cowsFG.filter((c) => !c.escaped && !c.held);
    if (!pool.length) return false;
    // Take the cow furthest from the screen centre so the saucer and its beam
    // hang clear of the logo/menu column, but dodge the Stanford Dish on the
    // left crest — the two silhouettes read as mush on top of each other.
    const score = (c) => Math.abs(c.x - W / 2) - (Math.abs(c.x - W * 0.13) < 34 ? 80 : 0);
    let cow = pool[0];
    for (const c of pool) if (score(c) > score(cow)) cow = c;
    cow.held = true;
    const fromLeft = cow.x > W / 2;
    this._ufo = {
      phase: 'approach', t0: t, cow,
      homeX: cow.x, homeFoot: cow.foot,
      x: fromLeft ? -34 : W + 34,
      y: UFO_CRUISE_Y,
      targetX: Math.round(cow.x),
      groundY: Math.round(cow.foot),
      dir: fromLeft ? 1 : -1,
      beam: 0, lift: 0, blink: Math.random() * 6,
    };
    this._nextUfoAt = t + 1e6;             // rescheduled when it ends
    return true;
  }

  _updateUfoEvent(t, dt, W) {
    const u = this._ufo;
    if (!u) return;
    const age = t - u.t0;
    const cow = u.cow;
    switch (u.phase) {
      case 'approach': {
        const dx = u.targetX - u.x;
        const sp = Math.max(14, Math.min(150, Math.abs(dx) * 1.15));  // eases in
        if (Math.abs(dx) <= sp * dt) { u.x = u.targetX; u.phase = 'hover'; u.t0 = t; }
        else u.x += Math.sign(dx) * sp * dt;
        cow.state = 'graze';                                   // blissfully unaware
        break;
      }
      case 'hover':
        cow.state = 'idle';                                    // head up: what's that?
        if (age >= UFO_DUR.hover) { u.phase = 'open'; u.t0 = t; }
        break;
      case 'open':
        u.beam = Math.min(1, age / UFO_DUR.open);
        if (age >= UFO_DUR.open) { u.phase = 'hold'; u.t0 = t; cow.state = 'moo'; }
        break;
      case 'hold':
        u.beam = 1;
        if (age >= UFO_DUR.hold) {
          u.phase = 'lift'; u.t0 = t;
          cow.held = false; cow.escaped = true;                // the UFO draws it now
        }
        break;
      case 'lift': {
        const p = Math.min(1, age / UFO_DUR.lift);
        u.lift = p * p * (3 - 2 * p);                          // smoothstep rise
        if (age >= UFO_DUR.lift) { u.lift = 1; u.phase = 'close'; u.t0 = t; }
        break;
      }
      case 'close':
        u.beam = Math.max(0, 1 - age / UFO_DUR.close);
        if (age >= UFO_DUR.close) { u.beam = 0; u.phase = 'zip'; u.t0 = t; }
        break;
      case 'zip': {
        const p = Math.min(1, age / UFO_DUR.zip);
        u.x += u.dir * (60 + 950 * p * p) * dt;
        u.y -= 26 * p * dt;
        if (u.x < -70 || u.x > W + 70) { u.phase = 'gone'; u.t0 = t; }
        break;
      }
      case 'gone':
        // ...and a while later the cow is back with the herd, no questions
        if (age >= UFO_DUR.gone) {
          cow.escaped = false; cow.held = false;
          cow.x = u.homeX; cow.foot = u.homeFoot;
          cow.state = 'idle'; cow.stateT = 0; cow.dur = 2; cow.flipped = false;
          this._ufo = null;
          this._nextUfoAt = t + randIn(EVENT_TIMING.ufoGap);
        }
        break;
    }
  }

  _drawUfoEvent(ctx, t, pal, W) {
    const u = this._ufo;
    if (!u || u.phase === 'gone') return;
    const sx = Math.round(u.x);
    const sy = Math.round(u.y + Math.sin(t * 2.3) * 1.6);
    const groundY = u.groundY;

    // ── tractor beam: cone widening to the ground, bands scrolling down ──
    if (u.beam > 0.02) {
      const top = sy + 4;
      const reach = Math.max(1, groundY - top);
      const bot = top + reach * u.beam;
      for (let y = top; y < bot; y++) {
        const p = (y - top) / reach;
        const hw = Math.round(2 + 10 * p);
        const band = (((y - t * 34) % 9) + 9) % 9;
        const a = (band < 3 ? 0.30 : 0.15) * u.beam;
        ctx.fillStyle = `rgba(140,255,180,${a.toFixed(2)})`;
        ctx.fillRect(sx - hw, y, hw * 2, 1);
        ctx.fillStyle = `rgba(210,255,220,${(a * 1.6).toFixed(2)})`;
        ctx.fillRect(sx - hw, y, 1, 1);                   // bright cone edges
        ctx.fillRect(sx + hw - 1, y, 1, 1);
      }
      // glowing pool on the grass at the foot of the beam
      const pulse = 0.6 + 0.4 * Math.sin(t * 6);
      const gw = Math.max(1, Math.round(12 * u.beam));
      ctx.fillStyle = `rgba(140,255,180,${(0.28 * u.beam * pulse).toFixed(2)})`;
      ctx.fillRect(sx - gw, groundY - 2, gw * 2, 3);
      ctx.fillStyle = `rgba(225,255,230,${(0.34 * u.beam).toFixed(2)})`;
      ctx.fillRect(sx - (gw >> 1), groundY - 1, gw, 1);
    }

    // ── the cow, floating up in the beam, legs kicking ──
    if (u.phase === 'lift') {
      const cow = u.cow;
      cow.state = 'amble';                                 // scissoring legs = kicking
      cow.x = u.targetX + Math.round(Math.sin(t * 4.2) * 2);
      cow.foot = Math.round(groundY + (sy + 9 - groundY) * u.lift);
      // lit by the beam, so it doesn't read as a dark blob at night
      this._drawCowFG(ctx, cow, t * 1.7, { ...pal, light: Math.max(pal.light, 0.6) });
      if (u.lift < 0.55) this._drawBubble(ctx, Math.round(cow.x), cow.foot - 12, '!');
    }

    this._drawSaucer(ctx, sx, sy, t, pal, u);
  }

  // Flying saucer, ~25x12: glass dome on a two-tone hull with a ring of
  // chasing running lights. Reads as a silhouette with lit portholes at
  // night, brushed metal by day.
  _drawSaucer(ctx, x, y, t, pal, u) {
    const L = pal.light;
    const hullHi = this._lerpHex('#3c4258', '#e2e7f0', L);
    const hull = this._lerpHex('#2b2f42', '#b3bacb', L);
    const hullLo = this._lerpHex('#191c29', '#7b8396', L);
    const dome = this._lerpHex('#2b4a54', '#9fe6f2', L);

    if (L < 0.55) {                                   // chunky halo after dark
      for (let k = 0; k < 3; k++) {
        this._blob(ctx, x, y, 9 + k * 5, `rgba(150,255,190,${(0.035 * (1 - L)).toFixed(2)})`);
      }
    }
    ctx.fillStyle = dome;                             // cockpit dome
    ctx.fillRect(x - 3, y - 6, 7, 2);
    ctx.fillRect(x - 4, y - 4, 9, 2);
    ctx.fillStyle = '#eaffff';
    ctx.fillRect(x - 2, y - 6, 2, 1);                 // glass glint
    ctx.fillStyle = hullHi;                           // upper hull
    ctx.fillRect(x - 8, y - 2, 17, 1);
    ctx.fillStyle = hull;                             // widest rim
    ctx.fillRect(x - 12, y - 1, 25, 2);
    ctx.fillStyle = hullLo;                           // underbelly
    ctx.fillRect(x - 9, y + 1, 19, 2);
    ctx.fillRect(x - 5, y + 3, 11, 1);
    // ring of running lights chasing around the rim
    const step = Math.floor(t * 9 + u.blink) % 5;
    for (let i = 0; i < 5; i++) {
      const on = i === step;
      ctx.fillStyle = on ? '#ffe066' : this._lerpHex('#4a3a20', '#8a7a55', L);
      ctx.fillRect(x - 10 + i * 5, y + 1, 2, 1);
    }
    // emitter port glows while the beam is on
    if (u.beam > 0.02) {
      ctx.fillStyle = `rgba(190,255,205,${(0.85 * u.beam).toFixed(2)})`;
      ctx.fillRect(x - 2, y + 3, 4, 2);
    }
    // flash as the cow is swallowed
    if (u.phase === 'close') {
      ctx.fillStyle = `rgba(235,255,240,${(0.55 * (1 - u.beam)).toFixed(2)})`;
      ctx.fillRect(x - 13, y - 7, 27, 12);
    }
  }

  // Chunky 3-tongue flame, hottest at the base. scale shrinks the whole lick.
  _drawFlame(ctx, x, baseY, t, seed, scale) {
    for (let k = 0; k < 3; k++) {
      const h = Math.max(2, Math.round((4 + 3 * Math.sin(t * 9 + k * 2.1 + seed)) * scale));
      const dx = (k - 1) * 2;
      ctx.fillStyle = '#e0451f';
      ctx.fillRect(x + dx - 1, baseY - h, 3, h);
      ctx.fillStyle = '#ff9a30';
      ctx.fillRect(x + dx - 1, baseY - h + 1, 2, h - 1);
      ctx.fillStyle = '#ffe680';
      ctx.fillRect(x + dx, baseY - 2, 1, 2);
    }
  }

  // The driver: same build as the little scene people, shirt in the car's
  // paint colour, both arms flailing over their head.
  _drawDriver(ctx, x, footY, dir, t, phase, shirt) {
    const skin = '#d8a878';
    const frame = Math.floor(t * 9 + phase) % 2;
    ctx.fillStyle = '#2b2f40';                        // legs, mid-scramble
    ctx.fillRect(x - 2 - frame, footY - 3, 2, 3);
    ctx.fillRect(x + 1 + frame, footY - 3, 2, 3);
    ctx.fillStyle = '#14141c';
    ctx.fillRect(x + (frame ? -3 : 2), footY - 1, 2, 1);
    ctx.fillStyle = shirt;                            // torso
    ctx.fillRect(x - 2, footY - 9, 5, 6);
    ctx.fillStyle = skin;                             // arms thrown overhead
    ctx.fillRect(x - 4, footY - 12 + (frame ? 0 : 2), 1, 3);
    ctx.fillRect(x + 4, footY - 12 + (frame ? 2 : 0), 1, 3);
    ctx.fillRect(x - 1, footY - 12, 3, 3);            // head
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(x + (dir > 0 ? 1 : -1), footY - 11, 1, 1);   // eye
    ctx.fillRect(x - 1, footY - 10, 3, 1);            // wide-open mouth
    ctx.fillStyle = '#3a2e28';                        // hair on end
    ctx.fillRect(x - 1, footY - 13, 3, 1);
    ctx.fillRect(x - 1 + frame, footY - 14, 1, 1);
  }

  // ── Buildings (cutaway interiors) ──────────────────────────────────

  // Little interior person (~11px). pose: 'sit' | 'stand'. Facing dir.
  _drawTinyPerson(ctx, x, footY, dir, pose, coat, skin, hair, t, opts = {}) {
    const dark = '#1a1a22';
    if (pose === 'sit') {
      ctx.fillStyle = '#3a3346';                       // chair/stool
      ctx.fillRect(x - 2, footY - 4, 5, 4);
      ctx.fillStyle = coat;                            // torso
      ctx.fillRect(x - 2, footY - 9, 5, 5);
      ctx.fillStyle = skin;                            // head
      ctx.fillRect(x - 1, footY - 12, 3, 3);
      ctx.fillStyle = hair;
      ctx.fillRect(x - 1, footY - 13, 3, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(x + (dir > 0 ? 1 : -1), footY - 11, 1, 1); // eye
      if (opts.typing) {                               // typing arm, jitters
        ctx.fillStyle = skin;
        const jig = Math.floor(t * 8 + (opts.phase || 0)) % 2;
        ctx.fillRect(x + (dir > 0 ? 3 : -3), footY - 7 - jig, 2, 1);
      }
    } else {
      ctx.fillStyle = '#2e3040';                       // legs (2-frame walk)
      if (opts.walk && Math.floor(t * 7 + (opts.phase || 0)) % 2) {
        ctx.fillRect(x - 1, footY - 3, 3, 3);          // stride closed
      } else {
        ctx.fillRect(x - 2, footY - 3, 2, 3);
        ctx.fillRect(x + 1, footY - 3, 2, 3);
      }
      ctx.fillStyle = coat;
      ctx.fillRect(x - 2, footY - 9, 5, 6);
      ctx.fillStyle = skin;
      ctx.fillRect(x - 1, footY - 12, 3, 3);
      ctx.fillStyle = hair;
      ctx.fillRect(x - 1, footY - 13, 3, 1);
      ctx.fillStyle = dark;
      ctx.fillRect(x + (dir > 0 ? 1 : -1), footY - 11, 1, 1);
    }
    if (opts.mug) {                                    // coffee mug + steam
      const sip = opts.sip && Math.sin(t * 0.55 + (opts.phase || 0)) > 0.9;
      const my = sip ? footY - 11 : footY - 8;
      const mx = x + (dir > 0 ? 3 : -4);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillRect(mx, my, 2, 2);
      const sp = Math.floor(t * 3 + (opts.phase || 0)) % 3;
      ctx.fillStyle = 'rgba(220,224,235,0.5)';
      ctx.fillRect(mx + (sp % 2), my - 2 - sp, 1, 1);
    }
  }

  // ── Central Laboratory ─────────────────────────────────────────────
  // Not one slab: five connected volumes of different heights and depths
  // stepping along the frontage, after SLAC's Central Laboratory — warm pale
  // concrete, ribbon glazing, flat roofs behind parapets, cluttered plant.
  //   office wing → control room (tallest) → main entrance (lowest, and the
  //   volume that steps furthest forward) → cafeteria pavilion → services
  // Every x is measured off the hall door, so the main entrance always lands
  // directly over the doorway punched in the wall below.
  _drawCentralLab(ctx, hx, groundY, t, pal) {
    const g = groundY + 4;                        // 196: sits on the hall coping
    const V = {
      off:  { x0: hx - 155, x1: hx - 83,  top: g - 40, base: g },              // 230..302
      ctrl: { x0: hx - 83,  x1: hx - 11,  top: g - 50, base: g + 2, fwd: 1 },  // 302..374
      lob:  { x0: hx - 11,  x1: hx + 11,  top: g - 30, base: g + 3, fwd: 1, cast: 1 },
      cafe: { x0: hx + 11,  x1: hx + 85,  top: g - 36, base: g },              // 396..470
      svc:  { x0: hx + 85,  x1: hx + 117, top: g - 32, base: g },              // 470..502
    };
    this._labRoof(ctx, V, t, pal);                // plant first: parapets crop its feet

    // back plane first, then the two volumes that step toward the camera
    this._labShell(ctx, V.off, pal);
    this._labOfficeWing(ctx, V.off, t, pal);
    this._labShell(ctx, V.cafe, pal);
    this._labCafeteria(ctx, V.cafe, t, pal);
    this._labShell(ctx, V.svc, pal);
    this._labServices(ctx, V.svc, pal);
    this._labShell(ctx, V.ctrl, pal);
    this._labControlRoom(ctx, V.ctrl, t, pal);
    this._labShell(ctx, V.lob, pal);
    this._labLobby(ctx, V.lob, pal);

    // entrances: the west door faces the visitor lot, the main entrance sits
    // directly over the hall doorway. Both are real targets for commuters.
    const westX = V.off.x0 + 13;
    this._labEntrance(ctx, westX, V.off.base, 7, 13, 9, pal, false);
    this._labEntrance(ctx, hx, V.lob.base, 8, 16, 13, pal, true);

    this._labSign(ctx, V.ctrl.x0 + 4, V.ctrl.top - 17, pal);
    this._labCafeSign(ctx, V.cafe.x0 + 22, V.cafe.top - 11);
    return { west: westX, main: hx };
  }

  // One volume: parapet, fascia, wall face, plinth, and — for the volumes that
  // step toward the camera — thicker lit/shaded returns plus a cast shadow on
  // whatever is standing behind them.
  _labShell(ctx, v, pal) {
    const w = v.x1 - v.x0, cap = 4, wh = v.base - v.top - cap;
    const ret = v.fwd ? 2 : 1;
    if (v.cast) {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(v.x1, v.top + 3, 3, v.base - v.top - 3);  // shadow thrown right
    }
    ctx.fillStyle = pal.conc;
    ctx.fillRect(v.x0, v.top + cap, w, wh);       // wall face
    ctx.fillRect(v.x0 - 1, v.top, w + 2, cap);    // parapet, slight overhang
    ctx.fillStyle = pal.concT;
    ctx.fillRect(v.x0 - 1, v.top, w + 2, 1);      // coping catch
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(v.x0 - 1, v.top + cap, w + 2, 1); // parapet shadow on the fascia
    ctx.fillStyle = pal.concT;
    ctx.fillRect(v.x0 + ret, v.top + cap + 1, w - ret * 2, 1); // fascia catch
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(v.x0, v.top + cap, ret, wh);     // lit left return
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(v.x1 - ret, v.top + cap, ret, wh); // shaded right return
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(v.x0, v.base - 3, w, 3);         // plinth, in its own shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(v.x0 - 1, v.base, w + 2, 1);     // seat it on the ground
  }

  // Ribbon glazing frame, laid over a finished interior: the glass runs
  // continuously past 1px mullions, so a band reads as one long window rather
  // than a row of boxed cells.
  _labGlazingFrame(ctx, x0, y0, w, h, pitch, pal, transoms) {
    ctx.fillStyle = 'rgba(9,8,13,0.66)';          // mullions silhouette, 1px, no cells
    for (let x = x0 + pitch; x < x0 + w - 1; x += pitch) ctx.fillRect(x, y0, 1, h);
    for (const ty of transoms || []) ctx.fillRect(x0, ty, w, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, y0, w, 1);                   // head, in the reveal's shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x0 - 1, y0 - 1, w + 2, 1);       // reveal shadow above the head
    ctx.fillStyle = pal.concT;
    ctx.fillRect(x0 - 1, y0 + h, w + 2, 1);       // lit sill
  }

  // Rooftop plant, varied volume to volume so no two roofs repeat: a packaged
  // air handler and duct run over the offices, the antenna mast on the tall
  // control room, kitchen extract over the cafe, stair penthouse on the end.
  _labRoof(ctx, V, t, pal) {
    const L = pal.light;
    const box = (x, y, w, h) => {
      ctx.fillStyle = this._lerpHex('#2c2720', '#9e9482', L);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = this._lerpHex('#3c362c', '#c0b5a0', L);
      ctx.fillRect(x, y, w, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(x + w - 1, y + 1, 1, h - 1);
    };
    const stack = (x, y, w, h) => {
      ctx.fillStyle = this._lerpHex('#3c362c', '#aaa08c', L);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + w - 1, y, 1, h);
    };

    const o = V.off.top;                          // office wing: AHU + duct run
    box(V.off.x0 + 14, o - 11, 20, 13);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    for (let k = 2; k < 10; k += 2) ctx.fillRect(V.off.x0 + 16, o - 11 + k, 9, 1);   // grille
    ctx.fillStyle = this._lerpHex('#4a4438', '#8a8f9c', L);
    ctx.fillRect(V.off.x0 + 28 + (Math.floor(t * 4) % 3), o - 13, 2, 2);             // fan tick
    box(V.off.x0 + 38, o - 6, 15, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = V.off.x0 + 39; x < V.off.x0 + 52; x += 2) ctx.fillRect(x, o - 5, 1, 6); // ribs
    stack(V.off.x0 + 58, o - 9, 4, 11);

    const c = V.ctrl.top;                         // control room: mast, clear of the sign
    ctx.fillStyle = this._lerpHex('#2a2a34', '#6a6a78', L);
    ctx.fillRect(V.ctrl.x0 + 66, c - 18, 2, 20);
    ctx.fillRect(V.ctrl.x0 + 63, c - 12, 8, 1);   // crossarm
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(V.ctrl.x0 + 67, c - 18, 1, 20);
    const blink = Math.sin(t * 2.2) > 0.55;
    ctx.fillStyle = blink ? '#ff4455' : '#571d22';
    ctx.fillRect(V.ctrl.x0 + 65, c - 21, 4, 3);   // aviation light
    if (blink) {
      ctx.fillStyle = 'rgba(255,68,85,0.25)';
      ctx.fillRect(V.ctrl.x0 + 63, c - 23, 8, 7);
    }

    const f = V.cafe.top;                         // cafe: kitchen extract, then a unit
    stack(V.cafe.x0 + 8, f - 12, 4, 14);
    stack(V.cafe.x0 + 14, f - 8, 3, 10);
    box(V.cafe.x0 + 48, f - 10, 18, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    for (let k = 2; k < 9; k += 2) ctx.fillRect(V.cafe.x0 + 50, f - 10 + k, 8, 1);
    stack(V.cafe.x0 + 69, f - 6, 4, 8);

    const s = V.svc.top;                          // end block: stair penthouse
    box(V.svc.x0 + 4, s - 14, 22, 16);
    ctx.fillStyle = this._lerpHex('#3c362c', '#cdc2ac', L);
    ctx.fillRect(V.svc.x0 + 3, s - 14, 24, 1);    // penthouse coping
    ctx.fillStyle = '#1d1a22';
    ctx.fillRect(V.svc.x0 + 14, s - 9, 5, 9);     // roof door
    stack(V.svc.x0 + 27, s - 8, 4, 10);
  }

  // Office wing: two floors of ribbon glazing, west entrance at the near end.
  // The rooms deliberately differ floor to floor — desks, a whiteboard, a
  // filing bank, someone at the copier — so it never reads as repeated cells.
  _labOfficeWing(ctx, v, t, pal) {
    const gx0 = v.x0 + 3, gx1 = v.x1 - 3, w = gx1 - gx0;   // 233..299
    const upY = v.base - 33, fu = v.base - 20;             // upper band 163..176
    const loX = v.x0 + 24, loY = v.base - 17, fl = v.base - 4;  // lower 254..299
    const lw = gx1 - loX;

    const room = (x, y, rw) => {
      ctx.fillStyle = '#171522';                  // office fitout, cooler than the cafe
      ctx.fillRect(x, y, rw, 14);
      ctx.fillStyle = 'rgba(232,214,170,0.07)';   // fluorescent wash
      ctx.fillRect(x, y, rw, 14);
      ctx.fillStyle = '#221e2e';
      ctx.fillRect(x, y + 12, rw, 2);             // floor slab
      for (let cx = x + 3; cx < x + rw - 7; cx += 22) {
        ctx.fillStyle = '#c8b884';
        ctx.fillRect(cx, y + 1, 8, 1);            // ceiling trough
        ctx.fillStyle = '#5a5236';
        ctx.fillRect(cx, y + 2, 8, 1);
      }
    };
    const desk = (dx, fy, coat, skin, hair, ph) => {
      ctx.fillStyle = '#0d0d16';
      ctx.fillRect(dx + 1, fy - 13, 7, 6);        // monitor bezel
      ctx.fillStyle = '#25406e';
      ctx.fillRect(dx + 2, fy - 12, 5, 4);
      ctx.fillStyle = 'rgba(180,210,255,0.55)';
      ctx.fillRect(dx + 2, fy - 12 + (Math.floor(t * 1.3 + ph) % 4), 5, 1);
      ctx.fillStyle = '#4a3f33';                  // desk
      ctx.fillRect(dx, fy - 7, 10, 2);
      ctx.fillStyle = '#332a22';
      ctx.fillRect(dx + 1, fy - 5, 1, 5);
      ctx.fillRect(dx + 8, fy - 5, 1, 5);
      this._drawTinyPerson(ctx, dx + 11, fy, -1, 'sit', coat, skin, hair, t,
        { typing: true, phase: ph });
    };

    // upper floor: open-plan desks, then a whiteboard someone is working at
    room(gx0, upY, w);
    desk(gx0 + 2, fu, '#6a5a48', '#d8a878', '#3a2e28', 0.4);
    desk(gx0 + 18, fu, '#5a6478', '#b0784f', '#6e6e78', 1.9);
    ctx.fillStyle = '#d8d4c4';
    ctx.fillRect(gx0 + 35, upY + 3, 12, 8);       // whiteboard
    ctx.fillStyle = '#3a4a7a';
    ctx.fillRect(gx0 + 37, upY + 5, 8, 1);
    ctx.fillRect(gx0 + 37, upY + 7, 5, 1);
    ctx.fillStyle = '#8a3a44';
    ctx.fillRect(gx0 + 37, upY + 9, 6, 1);
    this._drawTinyPerson(ctx, gx0 + 51, fu, -1, 'stand', '#c6c8d4', '#e8c9a2', '#8a5a2e', t,
      { phase: 2.2 });
    ctx.fillStyle = '#2f4c58';                    // water cooler
    ctx.fillRect(gx0 + 60, fu - 9, 3, 9);
    ctx.fillStyle = '#7fd0e0';
    ctx.fillRect(gx0 + 60, fu - 9, 3, 3);

    // ground floor: a different room again — filing bank, then the copier
    room(loX, loY, lw);
    ctx.fillStyle = '#3a3446';
    ctx.fillRect(loX + 1, fl - 12, 6, 12);
    ctx.fillRect(loX + 9, fl - 12, 6, 12);
    ctx.fillStyle = '#4c4658';
    ctx.fillRect(loX + 1, fl - 12, 6, 1);
    ctx.fillRect(loX + 9, fl - 12, 6, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 3; k < 12; k += 3) {
      ctx.fillRect(loX + 1, fl - 12 + k, 6, 1);   // drawer lines
      ctx.fillRect(loX + 9, fl - 12 + k, 6, 1);
    }
    ctx.fillStyle = '#2e2a3a';                    // copier
    ctx.fillRect(loX + 19, fl - 11, 9, 11);
    ctx.fillStyle = '#3d3950';
    ctx.fillRect(loX + 19, fl - 11, 9, 1);
    ctx.fillStyle = Math.sin(t * 1.7) > 0 ? '#8fe8ff' : '#1e3a44';
    ctx.fillRect(loX + 20, fl - 9, 7, 1);         // scan bar
    ctx.fillStyle = '#d8d4c4';
    ctx.fillRect(loX + 21, fl - 13, 5, 2);        // paper on the lid
    this._drawTinyPerson(ctx, loX + 31, fl, -1, 'stand', '#c9c5b4', '#b0784f', '#1e1e28', t,
      { phase: 5.3 });
    ctx.fillStyle = '#3a5a3a';                    // desk plant
    ctx.fillRect(loX + 39, fl - 5, 3, 3);
    ctx.fillStyle = '#5a4030';
    ctx.fillRect(loX + 39, fl - 2, 3, 2);

    this._labGlazingFrame(ctx, gx0, upY, w, 14, 8, pal, []);
    this._labGlazingFrame(ctx, loX, loY, lw, 14, 11, pal, []);
  }

  // Control room: ONE double-height space. A tight video wall across the back
  // and, on the floor in front of it, a single long console run — monitors
  // packed edge to edge with operators shoulder to shoulder behind, so it
  // reads as a trading desk rather than a stack of cubicles.
  _labControlRoom(ctx, v, t, pal) {
    const gx0 = v.x0 + 3, gx1 = v.x1 - 3, w = gx1 - gx0;   // 305..371
    const ceil = v.top + 8, fy = v.base - 4;               // room 154..194
    const rh = fy - ceil + 1;
    ctx.fillStyle = '#141220';
    ctx.fillRect(gx0, ceil, w, rh);
    ctx.fillStyle = 'rgba(232,194,90,0.05)';      // faint warm room glow
    ctx.fillRect(gx0, ceil, w, rh);
    ctx.fillStyle = '#241f2e';
    ctx.fillRect(gx0, fy - 1, w, 2);              // floor
    for (let cx = gx0 + 5; cx < gx1 - 6; cx += 16) {
      ctx.fillStyle = '#c8b884';
      ctx.fillRect(cx, ceil + 1, 9, 1);           // ceiling troughs
      ctx.fillStyle = '#5a5236';
      ctx.fillRect(cx, ceil + 2, 9, 1);
    }

    // ── video wall: 4×2 of 12×7 screens on a 1px black grid ──
    const vx = gx0 + ((w - 51) >> 1), vy = ceil + 3;
    ctx.fillStyle = 'rgba(120,170,220,0.09)';     // screen glow spilling on the wall
    ctx.fillRect(vx - 4, vy - 4, 59, 23);
    ctx.fillStyle = '#0d0d16';
    ctx.fillRect(vx - 1, vy - 1, 53, 17);
    const kinds = ['grid', 'trace', 'bars', 'sched', 'log', 'grid', 'sched', 'bars'];
    for (let i = 0; i < 8; i++) {
      this._labScreen(ctx, vx + (i % 4) * 13, vy + ((i / 4) | 0) * 8, 12, 7, kinds[i], t, i);
    }

    // status ribbon under the wall: run state at a glance
    ctx.fillStyle = '#0e0c16';
    ctx.fillRect(vx, vy + 19, 51, 4);
    for (let k = 0; k < 12; k++) {
      const h = (Math.imul(k + 5, 2654435761) ^ Math.imul(Math.floor(t * 0.4 + k * 0.3) + 3, 40503)) >>> 0;
      ctx.fillStyle = (h % 10) < 7 ? '#2f9e54' : (h % 10) < 9 ? '#d89a30' : '#c8393f';
      ctx.fillRect(vx + 2 + k * 4, vy + 21, 3, 1);
    }
    ctx.fillStyle = '#1b1826';                    // back wall behind the desk row
    ctx.fillRect(gx0, vy + 24, w, fy - vy - 24);
    ctx.fillStyle = '#8e8a7c';                    // clock, right of the wall
    ctx.fillRect(gx1 - 6, ceil + 6, 4, 4);
    ctx.fillStyle = '#2b2436';
    ctx.fillRect(gx1 - 5, ceil + 7, 1, 2);
    ctx.fillStyle = '#141a26';                    // beam-state annunciator, left
    ctx.fillRect(gx0 + 1, ceil + 5, 5, 8);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = ['#2f9e54', '#d89a30', '#c8393f'][k];
      ctx.globalAlpha = Math.sin(t * 0.9 + k * 2.1) > 0.3 ? 1 : 0.22;
      ctx.fillRect(gx0 + 2, ceil + 6 + k * 2, 3, 1);
    }
    ctx.globalAlpha = 1;

    // ── operators shoulder to shoulder, then the console run in front of them.
    //    Monitors top out below head height, so the row reads as a desk of
    //    people rather than a wall of screens ──
    for (let i = 0; i < 7; i++) {
      const swivel = Math.sin(t * 0.42 + i * 2.7) > 0.93 ? 1 : -1;
      this._drawTinyPerson(ctx, gx0 + 7 + i * 9, fy, swivel, 'sit',
        ['#c6c8d4', '#b7bcca', '#c9c5b4'][i % 3], ['#d8a878', '#b0784f', '#e8c9a2'][i % 3],
        ['#3a2e28', '#6e6e78', '#8a5a2e'][(i + 1) % 3], t,
        { typing: swivel < 0, phase: i * 2.1 });
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(gx0 + 3, fy - 9, w - 6, 1);      // desk shadow across the torsos
    ctx.fillStyle = '#0d0d16';                    // monitor row, edge to edge
    ctx.fillRect(gx0 + 3, fy - 8, w - 6, 6);
    for (let i = 0; i < 7; i++) {
      const mk = ['bars', 'grid', 'sched', 'trace', 'log', 'bars', 'grid'][i];
      this._labScreen(ctx, gx0 + 4 + i * 9, fy - 7, 8, 4, mk, t, i + 3);
      ctx.fillStyle = Math.sin(t * 3.1 + i * 2.2) > 0.2 ? '#54e08a' : '#8a3a44';
      ctx.fillRect(gx0 + 4 + i * 9, fy - 3, 1, 1);   // bezel status pixel
    }
    ctx.fillStyle = '#4a4458';
    ctx.fillRect(gx0 + 1, fy - 2, w - 2, 1);      // desk edge catching the screens
    ctx.fillStyle = '#2e2a3a';
    ctx.fillRect(gx0 + 1, fy - 1, w - 2, 2);      // desk front

    this._labGlazingFrame(ctx, gx0, ceil, w, rh, 11, pal, [ceil + 20]);  // tall glazing, one transom
  }

  // Entrance link: the lowest volume and the one that steps furthest forward.
  // Just a lit clerestory over the canopy — the door assembly fills the rest.
  _labLobby(ctx, v, pal) {
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(v.x0, v.top + 4, 3, v.base - v.top - 4);  // the tall block's shadow
    const gx0 = v.x0 + 3, w = v.x1 - v.x0 - 6, cy = v.top + 6;   // clerestory 172..178
    ctx.fillStyle = '#100e14';
    ctx.fillRect(gx0, cy, w, 7);
    ctx.fillStyle = pal.stars > 0.35 ? 'rgba(232,194,90,0.42)' : 'rgba(214,222,236,0.26)';
    ctx.fillRect(gx0, cy + 1, w, 6);              // lobby ceiling beyond
    ctx.fillStyle = '#b2382f';                    // hanging facility banner, SLAC red
    ctx.fillRect(gx0 + 6, cy + 1, 4, 6);
    ctx.fillStyle = '#efe4cc';
    ctx.fillRect(gx0 + 6, cy + 4, 4, 1);
    this._labGlazingFrame(ctx, gx0, cy, w, 7, 5, pal, []);
  }

  // Cafeteria pavilion: one wide open room behind a single tall window band —
  // counter at the near end, then tables, so the eye reads across it in one go.
  _labCafeteria(ctx, v, t, pal) {
    const gx0 = v.x0 + 3, gx1 = v.x1 - 3, w = gx1 - gx0;   // 399..467
    const ceil = v.base - 28, fy = v.base - 4;             // room 168..192
    ctx.fillStyle = '#171225';
    ctx.fillRect(gx0, ceil, w, 25);
    ctx.fillStyle = 'rgba(232,178,90,0.10)';      // cozy glow
    ctx.fillRect(gx0, ceil, w, 25);
    ctx.fillStyle = '#282034';
    ctx.fillRect(gx0, fy - 1, w, 2);              // floor
    for (let i = 0; i < 4; i++) {                 // pendant lamps
      const lx = gx0 + 16 + i * 16;
      ctx.fillStyle = '#3a3040';
      ctx.fillRect(lx, ceil + 1, 1, 4);           // cord
      ctx.fillStyle = '#8a7a4a';
      ctx.fillRect(lx - 2, ceil + 5, 5, 1);       // shade
      ctx.fillStyle = '#ffe6a8';
      ctx.fillRect(lx - 1, ceil + 6, 3, 1);       // lamp face
      ctx.fillStyle = '#ffd98a';
      for (let k = 0; k < 3; k++) {               // short taper, not a box
        ctx.globalAlpha = 0.09 * (1 - k / 3);
        ctx.fillRect(lx - 1 - k, ceil + 7 + k, 3 + k * 2, 1);
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#7a6a48';                    // menu board over the counter
    ctx.fillRect(gx0 + 1, ceil + 1, 11, 7);
    ctx.fillStyle = 'rgba(232,216,168,0.55)';
    for (let r = 0; r < 3; r++) ctx.fillRect(gx0 + 2, ceil + 2 + r * 2, 6 + r, 1);
    ctx.fillStyle = '#4a3a30';                    // wall shelf + plants
    ctx.fillRect(gx0 + 13, ceil + 9, 10, 1);
    ctx.fillStyle = '#4a7a5a';
    ctx.fillRect(gx0 + 15, ceil + 6, 2, 3);
    ctx.fillRect(gx0 + 19, ceil + 7, 2, 2);
    ctx.fillStyle = '#8e8a7c';                    // clock, clear of the chat bubbles
    ctx.fillRect(gx0 + 35, ceil + 3, 5, 5);
    ctx.fillStyle = '#2b2436';
    ctx.fillRect(gx0 + 37, ceil + 4, 1, 2);
    ctx.fillRect(gx0 + 37, ceil + 5, 2, 1);
    for (const [px, pc] of [[gx0 + 56, '#7a5a8a'], [gx0 + 62, '#5a7a8a']]) {
      ctx.fillStyle = '#3a3040';                  // framed prints
      ctx.fillRect(px, ceil + 2, 5, 7);
      ctx.fillStyle = pc;
      ctx.fillRect(px + 1, ceil + 3, 3, 5);
    }

    ctx.fillStyle = '#3c3c4c';                    // coffee machine on the back counter
    ctx.fillRect(gx0 + 3, fy - 16, 6, 6);
    ctx.fillStyle = '#585868';
    ctx.fillRect(gx0 + 3, fy - 16, 6, 1);
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(gx0 + 4, fy - 13, 4, 2);         // brew head
    ctx.fillStyle = Math.sin(t * 2.5) > 0 ? '#ff4455' : '#571d22';
    ctx.fillRect(gx0 + 7, fy - 15, 1, 1);
    ctx.fillStyle = '#6a5442';                    // serving counter, tray rail lit
    ctx.fillRect(gx0 + 1, fy - 10, 12, 2);
    ctx.fillStyle = '#8a7358';
    ctx.fillRect(gx0 + 1, fy - 10, 12, 1);
    ctx.fillStyle = '#3a3040';
    ctx.fillRect(gx0 + 1, fy - 8, 11, 8);
    ctx.fillStyle = '#4c4258';
    ctx.fillRect(gx0 + 1, fy - 8, 11, 1);
    ctx.fillStyle = '#c8b884';                    // trays stacked on the counter
    ctx.fillRect(gx0 + 9, fy - 12, 4, 2);
    this._drawTinyPerson(ctx, gx0 + 16, fy, -1, 'stand', '#c9c5b4', '#b0784f', '#6e6e78', t,
      { mug: true, sip: true, phase: 1.4 });      // serving side of the counter

    const table = (tx, tw, aC, aS, aH, aP, bC, bS, bH, bP, chat) => {
      this._drawTinyPerson(ctx, tx - 3, fy, 1, 'sit', aC, aS, aH, t,
        { mug: true, sip: true, phase: aP });
      this._drawTinyPerson(ctx, tx + tw + 2, fy, -1, 'sit', bC, bS, bH, t,
        { mug: true, phase: bP });
      ctx.fillStyle = '#4a3a30';
      ctx.fillRect(tx, fy - 8, tw, 2);            // table top, drawn in front
      ctx.fillStyle = '#33281f';
      ctx.fillRect(tx + 2, fy - 6, 1, 6);
      ctx.fillRect(tx + tw - 3, fy - 6, 1, 6);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillRect(tx + ((tw / 2) | 0), fy - 10, 2, 2);   // mug on the table
      const sp = Math.floor(t * 2.6) % 3;
      ctx.fillStyle = 'rgba(220,224,235,0.45)';
      ctx.fillRect(tx + ((tw / 2) | 0) + (sp % 2), fy - 12 - sp, 1, 1);
      const talk = Math.sin(t * 0.35 + chat);
      if (talk > 0.86) this._drawBubble(ctx, tx + ((tw / 2) | 0), fy - 16, talk > 0.95 ? '?' : '!');
    };
    table(gx0 + 24, 11, '#c6c8d4', '#d8a878', '#3a2e28', 0.7,
      '#b7bcca', '#e8c9a2', '#8a5a2e', 2.9, 0.9);
    table(gx0 + 44, 11, '#c9c5b4', '#b0784f', '#1e1e28', 3.6,
      '#c6c8d4', '#e8c9a2', '#6e6e78', 5.1, 3.4);

    this._drawTinyPerson(ctx, gx0 + 63, fy, 1, 'stand', '#c6c8d4', '#d8a878', '#6e6e78', t,
      { mug: true, sip: true, phase: 4.4 });      // standing bar table at the east end
    ctx.fillStyle = '#4a3a30';
    ctx.fillRect(gx0 + 61, fy - 7, 6, 2);
    ctx.fillStyle = '#33281f';
    ctx.fillRect(gx0 + 63, fy - 5, 2, 5);

    this._labGlazingFrame(ctx, gx0, ceil, w, 25, 12, pal, [ceil + 9]);
  }

  // Services / stair end block: near-solid, the counterweight to all that
  // glass. Plant-room louvres, one tall stair slot, a service door.
  _labServices(ctx, v, pal) {
    const L = pal.light;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';           // precast panel reveals
    for (let x = v.x0 + 8; x < v.x1 - 4; x += 8) ctx.fillRect(x, v.top + 6, 1, v.base - v.top - 9);
    ctx.fillStyle = '#1c1a24';                    // plant-room louvres
    ctx.fillRect(v.x0 + 3, v.base - 22, 10, 13);
    ctx.fillStyle = this._lerpHex('#332e28', '#8d8474', L);
    for (let k = 0; k < 13; k += 2) ctx.fillRect(v.x0 + 3, v.base - 22 + k, 10, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(v.x0 + 2, v.base - 23, 12, 1);
    ctx.fillStyle = '#100e14';                    // stair slot, landing by landing
    ctx.fillRect(v.x0 + 17, v.base - 24, 5, 21);
    ctx.fillStyle = pal.stars > 0.35 ? 'rgba(232,194,90,0.70)' : 'rgba(206,218,236,0.46)';
    for (let k = 0; k < 3; k++) ctx.fillRect(v.x0 + 18, v.base - 23 + k * 7, 3, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    for (let k = 0; k < 3; k++) {
      ctx.fillRect(v.x0 + 17, v.base - 18 + k * 7, 5, 1);           // landing slabs
      ctx.fillRect(v.x0 + 18 + (k % 2 ? 0 : 2), v.base - 22 + k * 7, 1, 4);  // flight
    }
    ctx.fillStyle = pal.concT;
    ctx.fillRect(v.x0 + 16, v.base - 3, 7, 1);    // slot sill
    ctx.fillStyle = this._lerpHex('#171320', '#39332c', pal.light);
    ctx.fillRect(v.x0 + 25, v.base - 13, 6, 10);  // service door
    ctx.fillStyle = '#14141e';
    ctx.fillRect(v.x0 + 26, v.base - 12, 4, 9);
    ctx.fillStyle = '#e8c25a';
    ctx.fillRect(v.x0 + 29, v.base - 8, 1, 1);    // handle
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(v.x0 + 25, v.base - 15, 8, 2);   // door hood
  }

  // One live screen face. The same display vocabulary everywhere in the
  // building, so the video wall and the console row read as one system.
  _labScreen(ctx, x, y, w, h, kind, t, seed) {
    const rnd = (a, b) => ((Math.imul(a + 13, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0);
    if (kind === 'grid') {                        // status mosaic, mostly green
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(x, y, w, h);
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          const cell = gy * w + gx + seed * 31;
          const r = rnd(cell, Math.floor(t * 0.8 + cell * 0.41)) % 100;
          ctx.fillStyle = r < 66 ? '#2f9e54' : r < 83 ? '#d89a30' : r < 89 ? '#c8393f' : '#173a22';
          ctx.fillRect(x + gx, y + gy, 1, 1);
        }
      }
    } else if (kind === 'bars') {                 // bar meters
      ctx.fillStyle = '#0e1630';
      ctx.fillRect(x, y, w, h);
      for (let b = 0; b * 2 < w; b++) {
        const bh = Math.max(1, Math.min(h, Math.round(
          h * 0.55 + h * 0.42 * Math.sin(t * (0.45 + b * 0.21) + b * 2.3 + seed))));
        ctx.fillStyle = b % 2 ? '#e0a838' : '#54d8f0';
        ctx.fillRect(x + b * 2, y + h - bh, 1, bh);
      }
    } else if (kind === 'trace') {                // scrolling cyan trace
      ctx.fillStyle = '#101c38';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(84,216,240,0.8)';
      for (let k = 0; k < w; k++) {
        const py = Math.round((h - 1) / 2 + (h / 2 - 0.6) * Math.sin(t * 1.1 + k * 0.7 + seed));
        ctx.fillRect(x + k, y + Math.max(0, Math.min(h - 1, py)), 1, 1);
      }
    } else if (kind === 'sched') {                // beamline schematic + sweep
      ctx.fillStyle = '#221440';
      ctx.fillRect(x, y, w, h);
      const ly = y + ((h / 2) | 0);
      ctx.fillStyle = '#7a88c0';
      ctx.fillRect(x, ly, w, 1);
      for (let k = 1; k < w; k += 2) {
        ctx.fillStyle = ['#f04a50', '#54d8f0', '#f0b040'][(k + seed) % 3];
        ctx.fillRect(x + k, ly - 1, 1, 1);
      }
      const hp = Math.floor(t * 2.2 + seed) % (w + 2);
      if (hp < w) {
        ctx.fillStyle = '#eef6ff';
        ctx.fillRect(x + hp, ly, 1, 1);
        ctx.fillStyle = 'rgba(180,220,255,0.35)';
        if (ly + 1 < y + h) ctx.fillRect(x + hp, ly + 1, 1, 1);
      }
    } else {                                      // alarm log: dim rows + flags
      ctx.fillStyle = '#161020';
      ctx.fillRect(x, y, w, h);
      for (let r = 0; r * 2 < h; r++) {
        const q = rnd(r + seed * 5 + 11, Math.floor(t * 0.5 + r) + 2);
        ctx.fillStyle = (q % 10) < 6 ? '#2f9e54' : (q % 10) < 9 ? '#d89a30' : '#c8393f';
        ctx.fillRect(x, y + r * 2, 1, 1);
        ctx.fillStyle = 'rgba(150,150,180,0.45)';
        ctx.fillRect(x + 2, y + r * 2, Math.min(w - 2, 4 + (q % 4)), 1);
      }
    }
  }

  // Ground-level entrance: recessed glass doors under a projecting canopy.
  _labEntrance(ctx, cx, baseY, hw, dh, cw, pal, main) {
    const night = pal.stars > 0.35;
    ctx.fillStyle = this._lerpHex('#171320', '#39332c', pal.light);
    ctx.fillRect(cx - hw, baseY - dh, hw * 2, dh);      // reveal
    ctx.fillStyle = '#14141e';
    ctx.fillRect(cx - hw + 2, baseY - dh + 2, hw * 2 - 4, dh - 2);  // glass doors
    ctx.fillStyle = night ? 'rgba(232,194,90,0.62)' : 'rgba(196,208,226,0.38)';
    ctx.fillRect(cx - hw + 3, baseY - dh + 3, hw * 2 - 6, dh - 4);  // lobby beyond
    ctx.fillStyle = '#2b2b36';
    ctx.fillRect(cx, baseY - dh + 2, 1, dh - 2);        // meeting stiles
    if (main) {
      ctx.fillRect(cx - 5, baseY - dh + 2, 1, dh - 2);
      ctx.fillRect(cx + 4, baseY - dh + 2, 1, dh - 2);
    }
    ctx.fillStyle = '#e8c25a';
    ctx.fillRect(cx - 2, baseY - Math.round(dh * 0.5), 1, 1);       // pull handles
    ctx.fillRect(cx + 2, baseY - Math.round(dh * 0.5), 1, 1);

    // the canopy is the one place the frontage projects past its own volume
    ctx.fillStyle = pal.conc;
    ctx.fillRect(cx - cw, baseY - dh - 4, cw * 2, 3);
    ctx.fillStyle = pal.concT;
    ctx.fillRect(cx - cw, baseY - dh - 4, cw * 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(cx - cw, baseY - dh - 1, cw * 2, 1);   // canopy underside
    if (night) {                                        // canopy downlight
      ctx.fillStyle = '#ffd98a';
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.10 * (1 - i / 5);
        ctx.fillRect(cx - cw + i, baseY - dh + i * 4, (cw - i) * 2, 4);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Facility plate on the control room's parapet: red lettering on a cream
  // ground, SLAC's sign palette. 4x5 glyphs — 3x3 can't tell M from N.
  _labSign(ctx, sx, sy, pal) {
    const F = {
      A: ['0110', '1001', '1111', '1001', '1001'], B: ['1110', '1001', '1110', '1001', '1110'],
      C: ['0111', '1000', '1000', '1000', '0111'], E: ['1111', '1000', '1110', '1000', '1111'],
      L: ['1000', '1000', '1000', '1000', '1111'], N: ['1001', '1101', '1011', '1001', '1001'],
      R: ['1110', '1001', '1110', '1010', '1001'], T: ['1111', '0110', '0110', '0110', '0110'],
    };
    const text = 'CENTRAL LAB';
    const w = text.length * 5 - 2 + 6;
    ctx.fillStyle = pal.conc;                           // two sign posts to the parapet
    ctx.fillRect(sx + 6, sy + 10, 2, 8);
    ctx.fillRect(sx + w - 8, sy + 10, 2, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(sx + 1, sy + 1, w, 11);                // drop shadow
    ctx.fillStyle = pal.concT;
    ctx.fillRect(sx, sy, w, 11);                        // cream plate
    ctx.fillStyle = pal.conc;
    ctx.fillRect(sx, sy + 10, w, 1);                    // plate underside
    ctx.fillStyle = '#b2382f';
    for (let i = 0; i < text.length; i++) {
      const g = F[text[i]];
      if (!g) continue;
      const px = sx + 3 + i * 5;
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 4; c++)
          if (g[r][c] === '1') ctx.fillRect(px + c, sy + 3 + r, 1, 1);
    }
  }

  // Small amber CAFE sign over the cafeteria pavilion.
  _labCafeSign(ctx, sx, sy) {
    ctx.fillStyle = '#2a2620';
    ctx.fillRect(sx + 4, sy + 8, 2, 4);                 // posts to the parapet
    ctx.fillRect(sx + 17, sy + 8, 2, 4);
    ctx.fillStyle = '#141020';
    ctx.fillRect(sx, sy, 23, 9);
    ctx.fillStyle = '#e8a25a';
    const rows = [
      ['0111', '1000', '1000', '1000', '0111'],         // C
      ['0110', '1001', '1111', '1001', '1001'],         // A
      ['1111', '1000', '1110', '1000', '1000'],         // F
      ['1111', '1000', '1110', '1000', '1111'],         // E
    ];
    rows.forEach((g, k) => {
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 4; c++)
          if (g[r][c] === '1') ctx.fillRect(sx + 2 + k * 5 + c, sy + 2 + r, 1, 1);
    });
  }

  _drawBeamline(ctx, t, W) {
    const pipeY = 254;           // beam axis: waist height above the pad
    const groundY = 272;         // component base line

    // ── Mid-ground support equipment: stands ON the hall floor with its
    //    backs against the wall, so every footprint is below the wall base ──
    const eq = this._equipPositions(W);
    this._drawSupportEquip(ctx, eq.rackX, eq.dewarX, eq.pumpX, t);

    const { srcX, srcW, tgtX, tgtW, pipeStart, pipeEnd } = this._beamGeom(W);
    const span = pipeEnd - pipeStart;
    const px = (f) => Math.floor(pipeStart + span * f);

    // ── FEL lattice, left to right: photoinjector → F quad → SRF cryomodule
    //    → D quad → SRF cryomodule → F quad → BPM → undulator → extraction
    //    dipole + spent-beam dump → scanner. Packed left so the ~50px after
    //    the undulator exit is free for the dump line ──
    const q0 = px(0.05), s0 = px(0.16), q1 = px(0.28), s1 = px(0.40);
    const q2 = px(0.52), bpmX = px(0.565);
    const undX0 = px(0.60), undX1 = px(0.87);
    const s0L = s0 - 26, s1L = s1 - 26;        // cryomodule left edges (52 wide)
    const dmp = this._dumpGeom(undX1, pipeY);

    // ── Pulse timing, resolved up front: the undulator has to know where the
    //    bunch is to light its gap, and the scanner steps on the pulse index ──
    const period = 1.5;
    const pulseIdx = Math.floor(t / period);
    const phase = (t % period) / period;
    // electron leg → then the beam SPLITS: photons carry straight on to the
    // scanner (2× faster), the spent bunch is kicked down into the dump
    const eEnd = 0.68, pEnd = 0.735, dEnd = 0.755;
    let beamLeg = 'arrive';
    this._beamX = -999;
    if (phase < eEnd) {
      beamLeg = 'e';                           // cyan bunch: gun → undulator exit
      this._beamX = Math.floor(pipeStart + 2 + (undX1 - pipeStart - 2) * (phase / eEnd));
    } else if (phase < pEnd) {
      beamLeg = 'p';                           // photon pulse: undulator → scanner
      this._beamX = Math.floor(undX1 + (tgtX - undX1) * ((phase - eEnd) / (pEnd - eEnd)));
    }
    // spent-bunch leg down the extraction branch, concurrent with the photons
    const dumpF = phase < eEnd || phase > dEnd ? -1 : (phase - eEnd) / (dEnd - eEnd);
    // dump afterglow: hot for a moment after the bunch lands
    const dumpHot = phase > dEnd ? Math.max(0, 1 - (phase - dEnd) / 0.22) : 0;

    // ── Cryo & RF services: floor-level runs from the support plant into each
    //    cryomodule. Drawn before the pipe, so the beamline crosses in front ──
    this._drawWaveguide(ctx, s0L - 8, s1L - 5, 237,
      [{ x: s0L - 8, ex: s0L + 6 }, { x: s1L - 8, ex: s1L + 6 }], 267);
    this._drawCryoLine(ctx, eq.dewarX, s0L + 12, 234, [s0L + 12, s1L + 12], 239);
    // vacuum pump-out tee, skid → photon pipe just past the extraction dipole
    const vacX = undX1 + 22;
    ctx.fillStyle = '#4c4c62';
    ctx.fillRect(vacX, 240, 2, 11);
    ctx.fillStyle = '#6a6a85';
    ctx.fillRect(vacX, 240, 1, 11);
    ctx.fillStyle = '#5e5e78';
    ctx.fillRect(vacX - 2, 249, 6, 2);         // tee flange on the pipe

    // ── Source cabinet (left) ──
    const srcH = 40;
    ctx.fillStyle = '#3d3d50';
    ctx.fillRect(srcX, groundY - srcH, srcW, srcH);
    ctx.fillStyle = '#4d4d64';
    ctx.fillRect(srcX, groundY - srcH, srcW, 3);
    ctx.fillStyle = '#2c2c3c';
    ctx.fillRect(srcX + srcW - 3, groundY - srcH, 3, srcH);
    // panel + vents
    ctx.fillStyle = '#31313f';
    ctx.fillRect(srcX + 5, groundY - srcH + 8, 20, 12);
    ctx.fillStyle = '#262633';
    for (let i = 0; i < 4; i++) ctx.fillRect(srcX + 6, groundY - 14 + i * 3, 18, 1);
    // HV hazard placard (yellow, tiny bolt)
    ctx.fillStyle = '#d9b53a';
    ctx.fillRect(srcX + 7, groundY - srcH + 10, 5, 5);
    ctx.fillStyle = '#4a3a10';
    ctx.fillRect(srcX + 9, groundY - srcH + 11, 1, 2);
    ctx.fillRect(srcX + 8, groundY - srcH + 13, 1, 1);
    // gas bottle feeding the ion source
    ctx.fillStyle = '#3e5560';
    ctx.fillRect(srcX - 8, groundY - 15, 5, 15);
    ctx.fillStyle = '#557584';
    ctx.fillRect(srcX - 8, groundY - 15, 2, 15);
    ctx.fillStyle = '#6a6a85';
    ctx.fillRect(srcX - 7, groundY - 17, 3, 2);
    ctx.fillRect(srcX - 5, groundY - 16, 3, 1);       // feed line

    // ── Photocathode drive laser: hutch riding on the gun cabinet, violet
    //    beam dropping onto the cathode inside the gun ──
    const lx = srcX + srcW - 18, ly = groundY - srcH - 10;
    ctx.fillStyle = '#2b2340';
    ctx.fillRect(lx, ly, 14, 10);
    ctx.fillStyle = '#3d3160';
    ctx.fillRect(lx, ly, 14, 2);                      // lid
    ctx.fillStyle = '#141021';
    ctx.fillRect(lx + 2, ly + 4, 6, 4);               // optics window
    const lOn = Math.sin(t * 6.1) > -0.4;
    ctx.fillStyle = lOn ? '#c07bff' : '#5a3a80';
    ctx.fillRect(lx + 3, ly + 5, 4, 2);
    ctx.fillStyle = '#8a5ad0';
    ctx.fillRect(lx + 11, ly + 3, 2, 2);              // interlock lamp
    ctx.fillStyle = lOn ? 'rgba(200,130,255,0.9)' : 'rgba(200,130,255,0.35)';
    ctx.fillRect(lx + 5, ly + 10, 1, pipeY - 7 - ly - 10);   // 1px drive beam
    ctx.fillStyle = lOn ? '#e0bcff' : '#7a5aa0';
    ctx.fillRect(lx + 4, pipeY - 7, 3, 3);            // cathode spot

    // ── Semiconductor wafer scanner (right end) ──
    this._drawScanner(ctx, tgtX, tgtW, pipeY, groundY, t, pulseIdx);

    // ── Beam pipe ──
    ctx.fillStyle = '#4c4c62';
    ctx.fillRect(pipeStart, pipeY - 3, pipeEnd - pipeStart, 6);
    ctx.fillStyle = '#6a6a85';
    ctx.fillRect(pipeStart, pipeY - 3, pipeEnd - pipeStart, 1);
    ctx.fillStyle = '#33334a';
    ctx.fillRect(pipeStart, pipeY + 2, pipeEnd - pipeStart, 1);
    // flanges every so often
    ctx.fillStyle = '#5e5e78';
    for (let x = pipeStart + 20; x < pipeEnd - 8; x += 40) ctx.fillRect(x, pipeY - 4, 2, 8);

    // ── Components along the pipe ──
    this._drawQuad(ctx, q0, pipeY, groundY, t, 0, 1);
    this._drawCryomodule(ctx, s0, pipeY, groundY, t, 0);
    this._drawQuad(ctx, q1, pipeY, groundY, t, 1, -1);
    this._drawCryomodule(ctx, s1, pipeY, groundY, t, 1);
    this._drawQuad(ctx, q2, pipeY, groundY, t, 2, 1);
    this._drawBPM(ctx, bpmX, pipeY, groundY, t);
    this._drawUndulator(ctx, undX0, undX1, pipeY, groundY, t, this._beamX);
    this._drawBeamDump(ctx, dmp, pipeY, t, dumpF, dumpHot);

    // Component registry for the FX layer (mishaps, scientists' work spots)
    const comps = [
      { id: 'quad0', x: q0, y: pipeY },
      { id: 'srf0', x: s0, y: pipeY },
      { id: 'quad1', x: q1, y: pipeY },
      { id: 'srf1', x: s1, y: pipeY },
      { id: 'quad2', x: q2, y: pipeY },
      { id: 'bpm', x: bpmX, y: pipeY },
      { id: 'undulator', x: Math.floor((undX0 + undX1) / 2), y: pipeY },
      { id: 'scanner', x: tgtX + 14, y: pipeY },
    ];

    // Compact stands under the small components: short legs + foot plate.
    // Cryomodules, undulator and scanner carry their own supports.
    for (const x of [q0, q1, q2, bpmX]) {
      ctx.fillStyle = '#2a2a38';
      ctx.fillRect(x - 4, groundY - 8, 2, 8);
      ctx.fillRect(x + 2, groundY - 8, 2, 8);
      ctx.fillStyle = '#333342';
      ctx.fillRect(x - 5, groundY - 1, 10, 2); // foot plate
    }

    // ── Beam pulse: cyan electron bunch — wiggling once it is between the
    //    undulator girders — then a photon pulse after the undulator hands off,
    //    plus the spent bunch peeling down the extraction branch ──
    if (beamLeg === 'e') {
      const bx = this._beamX;
      const wig = (x) => this._undWiggle(x, undX0 + 8, undX1 - 8);
      const dy = wig(bx);
      const trailCols = ['rgba(102,224,255,0.85)', 'rgba(102,224,255,0.55)', 'rgba(102,224,255,0.3)', 'rgba(102,224,255,0.14)'];
      for (let i = 0; i < trailCols.length; i++) {
        ctx.fillStyle = trailCols[i];
        const tx = bx - 4 - i * 4;
        ctx.fillRect(tx, pipeY - 1 + wig(tx), 4, 2);   // trail follows the wiggle
      }
      // core
      ctx.fillStyle = '#aef4ff';
      ctx.fillRect(bx - 1, pipeY - 2 + dy, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx, pipeY - 1 + dy, 2, 2);
      // soft glow halo
      ctx.fillStyle = 'rgba(102,224,255,0.16)';
      ctx.fillRect(bx - 5, pipeY - 5 + dy, 12, 10);
      ctx.fillStyle = 'rgba(102,224,255,0.07)';
      ctx.fillRect(bx - 9, pipeY - 8, 20, 16);
    } else if (beamLeg === 'p') {
      // white/violet X-ray pulse: a tight bar on the axis, brighter than what
      // went in — the accumulated product of the undulator's rays
      const bx = this._beamX;
      ctx.fillStyle = 'rgba(226,208,255,0.55)';
      ctx.fillRect(undX1 - 8, pipeY - 1, bx - undX1 + 8, 2);   // wake back to the exit
      const trailCols = ['rgba(255,255,255,0.9)', 'rgba(238,226,255,0.6)', 'rgba(226,208,255,0.3)'];
      for (let i = 0; i < trailCols.length; i++) {
        ctx.fillStyle = trailCols[i];
        ctx.fillRect(bx - 5 - i * 5, pipeY - 1, 5, 2);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx - 2, pipeY - 2, 6, 4);
      ctx.fillStyle = 'rgba(200,160,255,0.20)';
      ctx.fillRect(bx - 8, pipeY - 5, 18, 10);
    } else {
      // arrival flash on the wafer — and cash in the pulse
      if (this._cashPops && this._lastPopPulse !== pulseIdx) {
        this._lastPopPulse = pulseIdx;
        this._cashPops.push({
          x: tgtX + 5 + ((pulseIdx * 7) % 5) - 2,   // small per-pop drift
          y: pipeY - 12,
          t0: t,
        });
      }
      const f = (phase - pEnd) / (1 - pEnd);
      if (f < 0.6) {
        const a = 0.9 * (1 - f / 0.6);
        ctx.fillStyle = `rgba(226,208,255,${a.toFixed(2)})`;
        ctx.fillRect(tgtX + 4, pipeY - 8, 22, 16);
        ctx.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(2)})`;
        ctx.fillRect(tgtX + 9, pipeY - 4, 12, 8);
      }
    }

    // ── Product line: finished chips riding out of the scanner along the
    //    front of the hall floor into a shipping crate ──
    this._drawChipConveyor(ctx, tgtX, t, phase, pEnd);

    return comps;
  }

  // Extraction line geometry — where the dipole kicks the spent bunch and the
  // branch pipe that carries it down into the dump. Shared by the drawing and
  // the pulse that runs along it, so they can never drift apart.
  _dumpGeom(undX1, pipeY) {
    const dipX = undX1 + 10;                   // dipole centre, clear of the gap column
    const bx0 = dipX + 7, by0 = pipeY + 2;     // branch leaves the yoke already kicked down
    const bx1 = bx0 + 9, by1 = by0 + 8;        // short 42° run into the dump's entry boss
    return { dipX, bx0, by0, bx1, by1, mx0: bx1 - 8, mx1: bx1 + 22, my0: by1 - 2 };
  }

  // Beamline endpoints. Gun cabinet and wafer scanner are inset from the
  // screen edges so the machine reads as sitting inside the site instead of
  // running off the picture (and clears the CRT barrel warp at the edges).
  // Single source of truth — _drawBeamline and _equipPositions both use it.
  _beamGeom(W) {
    const INSET = 36, srcW = 30, tgtW = 40;
    const srcX = INSET;
    const tgtX = W - INSET - tgtW;
    return { srcX, srcW, tgtX, tgtW, pipeStart: srcX + srcW, pipeEnd: tgtX - 2 };
  }

  // Shared positions for support equipment + their concrete slabs.
  // The plant is sited by what it feeds: klystron rack beside the first
  // cryomodule, helium dewars just past the second, pump skid at the
  // undulator exit.
  _equipPositions(W) {
    const { pipeStart, pipeEnd } = this._beamGeom(W);
    const span0 = pipeEnd - pipeStart;
    const mgx = (f) => Math.floor(pipeStart + span0 * f);
    return { rackX: mgx(0.08), dewarX: mgx(0.505), pumpX: mgx(0.96), mgx };
  }

  // RF rack, cryo dewars, vacuum pump skid — quiet mid-ground depth.
  // Feet sit on the hall FLOOR, 10px clear of the wall base at y=230; the
  // bodies still rise past it, so the plant reads as standing against the wall.
  _drawSupportEquip(ctx, rackX, dewarX, pumpX, t) {
    const base = 240;
    const shadow = 'rgba(0,0,0,0.35)';
    // RF equipment rack (feeds the cavity)
    ctx.fillStyle = shadow;
    ctx.fillRect(rackX - 7, base, 15, 1);           // floor contact
    ctx.fillStyle = '#2c2c3e';
    ctx.fillRect(rackX - 6, base - 24, 13, 24);
    ctx.fillStyle = '#35354a';
    ctx.fillRect(rackX - 5, base - 23, 11, 1);
    ctx.fillStyle = '#242434';
    for (let i = 0; i < 5; i++) ctx.fillRect(rackX - 5, base - 20 + i * 4, 11, 1);
    const on = Math.sin(t * 1.8 + 0.4) > 0;
    ctx.fillStyle = on ? '#3e6a46' : '#2a3a2e';    // dim rack LEDs
    ctx.fillRect(rackX + 3, base - 22, 1, 1);
    ctx.fillStyle = '#5a3a40';
    ctx.fillRect(rackX + 1, base - 22, 1, 1);
    // cryogenic dewars (pair, frost band at the bottom)
    for (let k = 0; k < 2; k++) {
      const dx = dewarX + k * 11;
      ctx.fillStyle = shadow;
      ctx.fillRect(dx - 4, base, 10, 1);            // floor contact
      ctx.fillStyle = '#525a68';
      ctx.fillRect(dx - 3, base - 26, 8, 26);
      ctx.fillStyle = '#646c7a';
      ctx.fillRect(dx - 3, base - 26, 2, 26);       // sheen
      ctx.fillStyle = '#454c58';
      ctx.fillRect(dx - 4, base - 27, 10, 2);       // top cap
      ctx.fillStyle = '#3a3a4c';
      ctx.fillRect(dx, base - 30, 2, 3);            // valve stack
      ctx.fillRect(dx - 2, base - 30, 6, 1);        // valve wheel
      ctx.fillStyle = '#9aa6b2';                    // frost band
      ctx.fillRect(dx - 3, base - 6, 8, 3);
      ctx.fillStyle = '#b8c4d0';
      for (let fx = dx - 3; fx < dx + 5; fx += 2) ctx.fillRect(fx, base - 7, 1, 1);
    }
    // vacuum pump skid
    ctx.fillStyle = shadow;
    ctx.fillRect(pumpX - 9, base, 22, 1);           // floor contact
    ctx.fillStyle = '#33333f';
    ctx.fillRect(pumpX - 8, base - 3, 20, 3);       // skid base
    ctx.fillStyle = '#4a4a5c';
    ctx.fillRect(pumpX - 6, base - 10, 11, 7);      // pump body (cylinder)
    ctx.fillStyle = '#5c5c70';
    ctx.fillRect(pumpX - 6, base - 10, 11, 2);
    ctx.fillStyle = '#3c3c50';
    ctx.fillRect(pumpX + 5, base - 9, 6, 6);        // motor block
    ctx.fillStyle = '#2a2a38';
    ctx.fillRect(pumpX - 4, base - 12, 2, 2);       // inlet stub
  }

  // Jacketed cryogenic transfer line: floor-level run out of the dewars with
  // periodic bellows ticks, jumping down into each cryomodule's top cryo port.
  _drawCryoLine(ctx, x1, x2, y, portXs, portY) {
    const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
    ctx.fillStyle = '#4e5a68';                     // vacuum jacket
    ctx.fillRect(xa, y, xb - xa, 2);
    ctx.fillStyle = '#7d8b9b';                     // top sheen
    ctx.fillRect(xa, y, xb - xa, 1);
    ctx.fillStyle = '#9aa8b8';                     // bellows ticks
    for (let x = xa + 3; x < xb - 1; x += 6) ctx.fillRect(x, y - 1, 1, 4);
    for (const x of portXs) {
      ctx.fillStyle = '#3f4a57';                   // takeoff valve box on the run
      ctx.fillRect(x - 3, y - 2, 6, 5);
      ctx.fillStyle = '#7d8b9b';
      ctx.fillRect(x - 3, y - 2, 6, 1);
      ctx.fillStyle = '#9aa8b8';
      ctx.fillRect(x - 1, y - 1, 2, 1);            // handwheel
      ctx.fillStyle = '#4e5a68';
      ctx.fillRect(x - 1, y + 2, 3, portY - y - 2);   // jumper down to the port
      ctx.fillStyle = '#7d8b9b';
      ctx.fillRect(x - 1, y + 2, 1, portY - y - 2);
      ctx.fillStyle = '#9fc4d8';                   // frost where it turns cold
      ctx.fillRect(x - 1, portY - 2, 3, 2);
    }
  }

  // Brass rectangular waveguide: klystron rack → each cryomodule's RF coupler,
  // running at floor level then down the module's left flank into the elbow.
  _drawWaveguide(ctx, x1, x2, y, ports, portY) {
    const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
    ctx.fillStyle = '#5e4a1e';
    ctx.fillRect(xa, y, xb - xa, 3);
    ctx.fillStyle = '#8a6f30';
    ctx.fillRect(xa, y, xb - xa, 1);
    ctx.fillStyle = '#42330f';
    ctx.fillRect(xa, y + 2, xb - xa, 1);
    ctx.fillStyle = '#a68a44';                     // flange ribs
    for (let x = xa + 10; x < xb; x += 18) ctx.fillRect(x, y, 1, 3);
    for (const p of ports) {
      ctx.fillStyle = '#5e4a1e';
      ctx.fillRect(p.x, y + 3, 3, portY - y - 3);  // down the module flank
      ctx.fillStyle = '#8a6f30';
      ctx.fillRect(p.x, y + 3, 1, portY - y - 3);
      ctx.fillStyle = '#5e4a1e';
      ctx.fillRect(p.x, portY, p.ex - p.x, 3);     // elbow into the coupler
      ctx.fillStyle = '#8a6f30';
      ctx.fillRect(p.x, portY, p.ex - p.x, 1);
    }
  }

  // Superconducting RF cryomodule — the cold heart of the linac. Silver-blue
  // vacuum vessel with domed end caps; the warm copper cavity cells only show
  // through the cutaway stripe. Cryo port on top, RF coupler slung underneath.
  _drawCryomodule(ctx, x, pipeY, groundY, t, i) {
    const w = 52, h = 26;
    const x0 = x - 26, y0 = pipeY - 13;            // vessel 241 .. 267
    // support posts down to the floor
    ctx.fillStyle = '#2a2a38';
    ctx.fillRect(x0 + 18, y0 + h, 4, groundY - y0 - h);
    ctx.fillRect(x0 + w - 22, y0 + h, 4, groundY - y0 - h);
    ctx.fillStyle = '#333342';
    ctx.fillRect(x0 + 15, groundY - 2, 10, 2);
    ctx.fillRect(x0 + w - 25, groundY - 2, 10, 2);
    // domed end caps, stepped
    ctx.fillStyle = '#46536a';
    ctx.fillRect(x0 - 2, y0 + 3, 2, h - 6);
    ctx.fillRect(x0 - 4, y0 + 8, 2, h - 16);
    ctx.fillRect(x0 + w, y0 + 3, 2, h - 6);
    ctx.fillRect(x0 + w + 2, y0 + 8, 2, h - 16);
    ctx.fillStyle = '#7a8ca4';
    ctx.fillRect(x0 - 2, y0 + 3, 2, 2);
    ctx.fillRect(x0 + w, y0 + 3, 2, 2);
    // vessel shell
    ctx.fillStyle = '#3b465a';
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#5e6e85';
    ctx.fillRect(x0, y0 + 1, w, h - 3);
    ctx.fillStyle = '#8ea2ba';                     // cold top sheen
    ctx.fillRect(x0, y0 + 1, w, 2);
    ctx.fillStyle = '#b6c9dd';
    ctx.fillRect(x0 + 2, y0 + 1, w - 4, 1);
    ctx.fillStyle = '#47536a';                     // lower shade
    ctx.fillRect(x0, y0 + h - 4, w, 3);
    ctx.fillStyle = '#6c7d95';                     // stiffener rings
    for (let bx = x0 + 6; bx < x0 + w - 4; bx += 11) ctx.fillRect(bx, y0 + 1, 1, h - 4);
    // cutaway stripe: copper cavity cells inside the cold mass
    const sx = x0 + 5, sw = w - 10;
    ctx.fillStyle = '#9fb4cb';                     // cut edge
    ctx.fillRect(sx - 1, pipeY - 7, sw + 2, 1);
    ctx.fillRect(sx - 1, pipeY + 6, sw + 2, 1);
    ctx.fillStyle = '#151b28';                     // interior shadow
    ctx.fillRect(sx, pipeY - 6, sw, 12);
    for (let k = 0; k < 3; k++) {
      const cx = sx + 3 + k * 12;
      ctx.fillStyle = '#8a4f28';
      ctx.fillRect(cx, pipeY - 5, 10, 10);
      ctx.fillStyle = '#c47a3e';
      ctx.fillRect(cx + 1, pipeY - 4, 8, 8);
      ctx.fillStyle = '#e09a58';
      ctx.fillRect(cx + 1, pipeY - 4, 8, 1);
      ctx.fillStyle = '#5a3418';                   // iris throat
      ctx.fillRect(cx + 3, pipeY - 1, 4, 3);
    }
    // top cryo port turret (the transfer line lands on this)
    const portX = x0 + 12;
    ctx.fillStyle = '#46536a';
    ctx.fillRect(portX - 4, y0 - 2, 8, 4);
    ctx.fillStyle = '#8ea2ba';
    ctx.fillRect(portX - 4, y0 - 2, 8, 1);
    ctx.fillStyle = '#9fc4d8';                     // frost collar
    ctx.fillRect(portX - 3, y0, 6, 1);
    // RF fundamental power coupler underneath the upstream end
    ctx.fillStyle = '#3b465a';
    ctx.fillRect(x0 + 5, y0 + h - 3, 4, 4);        // feed-through neck
    ctx.fillStyle = '#5e4a1e';
    ctx.fillRect(x0 + 2, y0 + h, 10, 5);
    ctx.fillStyle = '#8a6f30';
    ctx.fillRect(x0 + 2, y0 + h, 10, 1);
    // slow-blink cryo status LED
    const on = Math.sin(t * 1.4 + i * 2.1) > -0.2;
    ctx.fillStyle = on ? '#54d8f0' : '#1c4450';
    ctx.fillRect(x0 + w - 6, y0 + 4, 2, 2);
  }

  // Undulator — the signature FEL element. Two magnet girders of alternating
  // pole blocks with the beam gap between them, gap-drive screw columns at
  // each end, and a photon field that builds along the gap as the bunch flies.
  _drawUndulator(ctx, x0, x1, pipeY, groundY, t, beamX) {
    const gx0 = x0 + 8, gx1 = x1 - 8;              // girder span
    const gapT = pipeY - 5, gapB = pipeY + 5;      // 249 .. 259
    // continuous granite base rail
    ctx.fillStyle = '#333342';
    ctx.fillRect(x0, groundY - 3, x1 - x0, 3);
    ctx.fillStyle = '#43435a';
    ctx.fillRect(x0, groundY - 3, x1 - x0, 1);
    // support legs under the lower girder
    ctx.fillStyle = '#2a2a38';
    for (let x = gx0 + 6; x < gx1 - 4; x += 24) ctx.fillRect(x, gapB + 10, 4, groundY - gapB - 10);
    // girders (the top one clears the poles hanging below it)
    for (const gy of [gapT - 10, gapB + 4]) {
      ctx.fillStyle = '#31364a';
      ctx.fillRect(gx0, gy, gx1 - gx0, 6);
      ctx.fillStyle = '#4a5168';
      ctx.fillRect(gx0, gy, gx1 - gx0, 1);
      ctx.fillStyle = '#242838';                   // bolt row
      for (let x = gx0 + 5; x < gx1 - 2; x += 10) ctx.fillRect(x, gy + 3, 2, 1);
    }
    // alternating pole blocks, 3px pitch, opposite polarity across the gap
    for (let x = gx0, k = 0; x < gx1; x += 3, k++) {
      const bw = Math.min(3, gx1 - x);
      ctx.fillStyle = k % 2 ? '#3f63c0' : '#c04040';
      ctx.fillRect(x, gapT - 4, bw, 4);
      ctx.fillStyle = k % 2 ? '#c04040' : '#3f63c0';
      ctx.fillRect(x, gapB, bw, 4);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)';             // pole tips facing the gap
    ctx.fillRect(gx0, gapT - 1, gx1 - gx0, 1);
    ctx.fillRect(gx0, gapB + 3, gx1 - gx0, 1);
    // the gap itself, with a slim vacuum chamber threaded through it
    ctx.fillStyle = '#12161f';
    ctx.fillRect(gx0, gapT, gx1 - gx0, gapB - gapT);
    ctx.fillStyle = '#3f4759';
    ctx.fillRect(gx0, pipeY - 2, gx1 - gx0, 4);
    ctx.fillStyle = '#5c6880';
    ctx.fillRect(gx0, pipeY - 2, gx1 - gx0, 1);
    // ── Lasing. The bunch snakes down the gap on the pole pitch and throws a
    //    ray forward off every wiggle crest; both the ray spacing and the
    //    brightness ramp with distance travelled, so the FEL gain reads as a
    //    visible build-up from a dim trickle at the entrance to a hard white
    //    beam at the exit ──
    if (beamX > gx0) {
      const gl = gx1 - gx0, bEnd = Math.min(beamX, gx1);
      // accumulated photon field in the gap, stepped so it brightens downstream
      for (let i = 0; i < 8; i++) {
        const a = gx0 + Math.floor((gl * i) / 8);
        if (a >= bEnd) break;
        const w = Math.min(gx0 + Math.floor((gl * (i + 1)) / 8), bEnd) - a, g = (i + 1) / 8;
        ctx.fillStyle = `rgba(212,186,255,${(0.04 + g * 0.30).toFixed(2)})`;
        ctx.fillRect(a, pipeY - 1, w, 2);
        ctx.fillStyle = `rgba(190,150,255,${(0.02 + g * 0.12).toFixed(2)})`;
        ctx.fillRect(a, gapT + 1, w, gapB - gapT - 2);
      }
      // one ray per wiggle crest — crests alternate every half period (3px),
      // so the emission points zigzag; the stride drops to every crest past
      // the first third, which is what makes the gain visible
      for (let x = gx0 + 2; x < bEnd; x += (x - gx0) / gl < 0.32 ? 9 : 3) {
        const g = (x - gx0) / gl, dy = this._undWiggle(x, gx0, gx1);
        ctx.fillStyle = `rgba(255,255,255,${(0.14 + g * 0.66).toFixed(2)})`;
        ctx.fillRect(x, pipeY - 1 + dy, 2, 1);              // emission point
        ctx.fillStyle = `rgba(226,208,255,${(0.06 + g * 0.40).toFixed(2)})`;
        ctx.fillRect(x + 2, pipeY - 1 + dy, 1 + Math.round(g * 5), 1);  // thrown forward
      }
      // exit: everything the gap made, collapsed onto the axis
      const ex = (bEnd - gx0) / gl;
      ctx.fillStyle = `rgba(226,208,255,${(ex * 0.30).toFixed(2)})`;
      ctx.fillRect(gx1 - 16, pipeY - 2, 16, 4);
      ctx.fillStyle = `rgba(255,255,255,${(ex * 0.80).toFixed(2)})`;
      ctx.fillRect(gx1 - 10, pipeY - 1, 10, 2);
    }
    // gap-drive screw columns at each end
    for (const cx of [x0, x1 - 6]) {
      ctx.fillStyle = '#2d3140';
      ctx.fillRect(cx, gapT - 10, 6, (gapB + 10) - (gapT - 10));
      ctx.fillStyle = '#454b5e';
      ctx.fillRect(cx, gapT - 10, 2, (gapB + 10) - (gapT - 10));
      ctx.fillStyle = '#6a7286';                   // exposed screw thread
      for (let y = gapT - 2; y < gapB + 2; y += 2) ctx.fillRect(cx + 2, y, 3, 1);
      ctx.fillStyle = '#565d70';                   // drive motor on top
      ctx.fillRect(cx - 1, gapT - 15, 8, 5);
      ctx.fillStyle = '#767e94';
      ctx.fillRect(cx - 1, gapT - 15, 8, 1);
    }
  }

  // Vertical excursion of the bunch inside the undulator: one full sine period
  // per magnet pair (the 3px pole pitch), which is exactly what makes it
  // radiate. Zero everywhere outside the girders.
  _undWiggle(x, gx0, gx1) {
    if (x <= gx0 || x >= gx1) return 0;
    return Math.round(3 * Math.sin((x - gx0) * Math.PI / 3));
  }

  // Spent-beam dump. A dipole just past the undulator kicks the used electrons
  // off the axis and down a short branch into a shielded block on the floor;
  // the photons carry straight on to the scanner. Radioactive as hell: trefoil
  // placard, a hazard-striped corner guard, and a sickly green glow that flares
  // when a bunch lands.  dumpF: -1 = no bunch on the branch, 0..1 = along it.
  _drawBeamDump(ctx, d, pipeY, t, dumpF, hot) {
    const { dipX, bx0, by0, bx1, by1, mx0, mx1, my0 } = d;
    const mw = mx1 - mx0, my1 = my0 + 19;                 // mass span; my1 sits on the floor

    // ── Extraction dipole: a bending magnet in the lattice's own vocabulary —
    //    grey-blue yoke, copper pancake coils above and below the gap — sitting
    //    ON the axis, with its throat flaring down into the branch ──
    const dx0 = dipX - 7, dw = 14;
    ctx.fillStyle = '#274b73';                            // dark yoke
    ctx.fillRect(dx0, pipeY - 8, dw, 16);
    ctx.fillStyle = '#3b6ea5';                            // lit face
    ctx.fillRect(dx0 + 1, pipeY - 7, dw - 3, 14);
    ctx.fillStyle = '#5a92c9';
    ctx.fillRect(dx0 + 1, pipeY - 7, dw - 3, 2);          // top highlight
    const coil = (cy) => {                                // copper pancake, as the quads
      ctx.fillStyle = '#8c5522';
      ctx.fillRect(dx0 + 2, cy, dw - 5, 3);
      ctx.fillStyle = '#c07a35';
      ctx.fillRect(dx0 + 2, cy, dw - 6, 2);
      ctx.fillStyle = '#e0a055';
      ctx.fillRect(dx0 + 2, cy, dw - 6, 1);
    };
    coil(pipeY - 6);                                      // above the gap
    coil(pipeY + 3);                                      // and below it
    ctx.fillStyle = '#1c3450';                            // beam gap through the yoke
    ctx.fillRect(dx0, pipeY - 3, dw, 6);
    ctx.fillStyle = '#16283e';
    ctx.fillRect(dx0 + dw - 5, pipeY - 3, 5, 8);          // throat, opening downward
    ctx.fillStyle = '#4e6f92';
    ctx.fillRect(dx0 + dw - 1, pipeY + 1, 2, 5);          // exit flange, aimed low

    // ── Branch pipe: 3px through, dark body, one lit line along the crown ──
    const bl = bx1 - bx0;
    for (let i = 0; i <= bl; i++) {
      const x = bx0 + i, y = by0 + Math.round((i * (by1 - by0)) / bl);
      ctx.fillStyle = '#15151d';                          // pipe body
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillStyle = '#6c6c8a';
      ctx.fillRect(x, y - 1, 1, 1);                       // crown highlight
      if (i === 2 || i === 6) { ctx.fillStyle = '#4a4a62'; ctx.fillRect(x, y - 2, 1, 5); }  // flange tick
    }

    // ── Shielded block: concrete and lead, deliberately DARKER than the hall
    //    wall behind it so it reads as mass. Stepped courses, exactly one hard
    //    highlight (the top edge), deep shadow pooling underneath ──
    ctx.fillStyle = '#30303c';                            // set-back top course
    ctx.fillRect(mx0 + 2, my0, mw - 4, 3);
    ctx.fillStyle = '#5e5e70';
    ctx.fillRect(mx0 + 2, my0, mw - 4, 1);                // the one hard highlight
    ctx.fillStyle = '#16161d';
    ctx.fillRect(mx1 - 4, my0 + 1, 2, 2);                 // its shaded return
    ctx.fillStyle = '#2a2a36';                            // main mass
    ctx.fillRect(mx0, my0 + 3, mw, my1 - my0 - 3);
    ctx.fillStyle = '#3f3f50';
    ctx.fillRect(mx0, my0 + 3, mw, 1);                    // ledge either side of the setback
    for (let k = 1; k <= 3; k++) {                        // stepped coursing
      const cy = my0 + 3 + k * 4;
      ctx.fillStyle = '#131318';
      ctx.fillRect(mx0, cy, mw, 1);
      ctx.fillStyle = '#3a3a49';
      ctx.fillRect(mx0, cy + 1, mw, 1);
    }
    ctx.fillStyle = '#141419';                            // staggered vertical joints
    ctx.fillRect(mx0 + 24, my0 + 4, 1, 3);
    ctx.fillRect(mx0 + 4, my0 + 12, 1, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(mx1 - 5, my0 + 4, 5, my1 - my0 - 4);     // shaded right cheek
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(mx0, my1 - 1, mw, 1);                    // grounded bottom edge
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(mx0 - 2, my1, mw + 4, 2);                // shadow pool
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(mx0 - 4, my1 + 2, mw + 8, 1);
    // Hazard striping lives on the VERTICAL left corner, diagonal and muted, so
    // it can never be mistaken for the chip conveyor running along below.
    for (let r = 0; r < 12; r++)
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = (r + c) % 4 < 2 ? '#7e6820' : '#141418';
        ctx.fillRect(mx0 + c, my0 + 6 + r, 1, 1);
      }

    // ── Entry boss, over the top course so the branch visibly plugs in ──
    ctx.fillStyle = '#23232f';
    ctx.fillRect(bx1 - 3, by1 - 2, 6, 5);
    ctx.fillStyle = '#59597a';
    ctx.fillRect(bx1 - 4, by1 - 2, 8, 1);                 // bolted flange
    ctx.fillStyle = '#08080c';
    ctx.fillRect(bx1 - 1, by1, 3, 3);                     // the hole the beam goes in

    // ── Radiation trefoil placard: black on yellow. The glyph is 11x10 inside a
    //    1px darker-gold bevel, so the disc, the three 60° blades and the gaps
    //    between them all survive and the black never runs into the concrete ──
    const tx = mx0 + 6, ty = my0 + 5;
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(tx + 1, ty + 1, 13, 12);                 // cast shadow, down-right
    ctx.fillStyle = '#806716';
    ctx.fillRect(tx, ty, 13, 12);                         // weathered bevel round the plate
    ctx.fillStyle = '#bd9720';
    ctx.fillRect(tx + 1, ty + 1, 11, 10);
    ctx.fillStyle = '#12100a';
    const TREFOIL = [                                     // up blade, then the two lower ones
      '...11111...', '...11111...', '....111....',
      '...........',                                      // ISO gap ring, clear of the disc
      '....111....', '....111....', '111.111.111',
      '1111...1111', '.111...111.', '..1.....1..',
    ];
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 11; c++)
        if (TREFOIL[r][c] === '1') ctx.fillRect(tx + 1 + c, ty + 1 + r, 1, 1);

    // ── Activation glow: an edge-lit breath, flaring when a bunch lands. Kept
    //    low so the dump sits behind the scanner in the hierarchy ──
    const gl = 0.12 + 0.06 * Math.sin(t * 1.7) + hot * 0.4;
    ctx.fillStyle = `rgba(130,220,150,${(gl * 0.40).toFixed(2)})`;
    ctx.fillRect(mx0 + 2, my0, mw - 4, 1);                // rim along the lit top
    ctx.fillStyle = `rgba(110,220,140,${(gl * 0.09).toFixed(2)})`;
    ctx.fillRect(bx1 - 4, by1 - 3, 8, 7);                 // haze around the entry
    ctx.fillStyle = `rgba(160,245,180,${Math.min(0.75, gl * 1.2).toFixed(2)})`;
    ctx.fillRect(bx1 - 1, by1, 3, 3);                     // the hole itself, lit
    // dump-status beacon, dim, on the top course
    ctx.fillStyle = hot > 0.05 || Math.sin(t * 2.6) > 0.4 ? '#c4432a' : '#431a16';
    ctx.fillRect(mx1 - 9, my0 + 1, 2, 2);

    // ── The spent bunch travelling down the branch, and its landing flash ──
    if (dumpF >= 0 && dumpF <= 1) {
      const px = Math.round(bx0 + (bx1 - bx0) * dumpF);
      const py = Math.round(by0 + (by1 - by0) * dumpF);
      ctx.fillStyle = 'rgba(102,224,255,0.45)';
      ctx.fillRect(px - 5, py - 2, 5, 2);
      ctx.fillStyle = '#aef4ff';
      ctx.fillRect(px - 1, py - 1, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, py, 1, 1);
    }
    if (hot > 0.45) {
      const a = (hot - 0.45) / 0.55;
      ctx.fillStyle = `rgba(190,255,200,${(a * 0.45).toFixed(2)})`;
      ctx.fillRect(bx1 - 9, by1 - 7, 18, 12);
      ctx.fillStyle = `rgba(220,255,230,${(a * 0.8).toFixed(2)})`;
      ctx.fillRect(bx1 - 4, by1 - 3, 8, 7);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fillRect(bx1 - 1, by1, 3, 3);
    }
  }

  // Chip conveyor: the scanner's output, running left along the front of the
  // hall floor into a shipping crate. One chip is released per pulse arrival,
  // so the belt is literally the +$1,000 pop made physical.
  _drawChipConveyor(ctx, tgtX, t, phase, pEnd) {
    const bR = tgtX + 16, bL = bR - 104;        // belt run, right end under the scanner
    const cy = 291;                             // belt top surface
    // ── Output chute hanging off the scanner's underside ──
    ctx.fillStyle = '#2c2c40';
    ctx.fillRect(bR - 6, 272, 14, cy - 274);
    ctx.fillStyle = '#43435c';
    ctx.fillRect(bR - 6, 272, 14, 1);
    ctx.fillRect(bR - 6, 272, 1, cy - 274);
    ctx.fillStyle = '#14141d';
    ctx.fillRect(bR - 4, cy - 9, 9, 7);         // mouth the chips drop from
    ctx.fillStyle = '#5a5a76';
    ctx.fillRect(bR - 7, cy - 2, 16, 2);        // lip

    // ── Frame, rollers and legs ──
    ctx.fillStyle = '#3a3a4c';
    ctx.fillRect(bL - 3, cy, bR - bL + 6, 2);   // top rail
    ctx.fillStyle = '#4e4e66';
    ctx.fillRect(bL - 3, cy, bR - bL + 6, 1);
    ctx.fillStyle = '#22222e';                  // belt band
    ctx.fillRect(bL - 3, cy + 2, bR - bL + 6, 3);
    const step = 16;                            // px a chip advances per pulse period
    const tread = Math.floor((t * step) / 1.5) % 6;   // tread keeps pace with the chips
    ctx.fillStyle = '#3c3c50';
    for (let x = bL - 3 + ((6 - tread) % 6); x < bR + 3; x += 6) ctx.fillRect(x, cy + 2, 1, 3);
    ctx.fillStyle = '#2e2e3e';                  // lower rail
    ctx.fillRect(bL - 3, cy + 5, bR - bL + 6, 1);
    for (const rx of [bL - 4, bR + 2]) {        // end rollers
      ctx.fillStyle = '#6a6a85';
      ctx.fillRect(rx, cy, 3, 6);
      ctx.fillStyle = '#8a8aa6';
      ctx.fillRect(rx, cy, 1, 6);
    }
    for (let x = bL + 6; x < bR - 8; x += 26) { // support legs
      ctx.fillStyle = '#2a2a38';
      ctx.fillRect(x, cy + 6, 2, 3);
      ctx.fillRect(x + 10, cy + 6, 2, 3);
      ctx.fillStyle = '#333342';
      ctx.fillRect(x - 1, cy + 9, 14, 1);       // foot plate
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x - 2, cy + 10, 16, 1);
    }

    // ── Chips: one released per pulse arrival, marching left at a fixed rate ──
    const chip = (x) => {
      ctx.fillStyle = '#1c1c26';
      ctx.fillRect(x, cy - 4, 6, 4);
      ctx.fillStyle = '#30303e';
      ctx.fillRect(x, cy - 4, 6, 1);            // lid highlight
      ctx.fillStyle = '#0f0f16';
      ctx.fillRect(x, cy - 4, 1, 1);            // pin-1 corner notch
      ctx.fillStyle = '#d8a83c';
      for (let i = 0; i < 3; i++) {             // gold leads, both sides
        ctx.fillRect(x + 1 + i * 2, cy - 5, 1, 1);
        ctx.fillRect(x + 1 + i * 2, cy, 1, 1);
      }
    };
    for (let k = 0; k < 9; k++) {
      const age = k + (phase - pEnd);           // periods since this one dropped
      if (age < 0) continue;
      const x = bR - 4 - Math.round(age * step);
      if (x < bL - 2) continue;                 // it has tipped into the crate
      chip(x);
    }

    // ── Shipping crate of finished chips at the end of the run ──
    const kx = bL - 18;
    ctx.fillStyle = '#6a4e30';
    ctx.fillRect(kx, cy - 8, 18, 17);
    ctx.fillStyle = '#83603b';
    ctx.fillRect(kx, cy - 8, 18, 2);
    ctx.fillStyle = '#4e3922';
    ctx.fillRect(kx, cy - 1, 18, 1);            // slat lines
    ctx.fillRect(kx + 15, cy - 8, 3, 17);
    ctx.fillStyle = '#2a2a38';                  // stencilled crate mark
    ctx.fillRect(kx + 3, cy + 3, 8, 1);
    ctx.fillRect(kx + 3, cy + 5, 5, 1);
    ctx.fillStyle = '#1c1c26';                  // chips heaped above the rim
    ctx.fillRect(kx + 2, cy - 11, 5, 3);
    ctx.fillRect(kx + 8, cy - 10, 5, 2);
    ctx.fillStyle = '#d8a83c';
    ctx.fillRect(kx + 3, cy - 12, 1, 1);
    ctx.fillRect(kx + 5, cy - 12, 1, 1);
    ctx.fillRect(kx + 9, cy - 11, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(kx - 1, cy + 9, 20, 1);
  }

  // Semiconductor wafer scanner: the FEL's customer. Entrance snout, a wafer
  // on an XY stage that steps between pulses, detector head above it, and a
  // readout screen filling in its scan raster.
  _drawScanner(ctx, x, w, pipeY, groundY, t, pulseIdx) {
    const h = 34, y0 = groundY - h;                // cabinet 238 .. 272
    ctx.fillStyle = '#33334a';
    ctx.fillRect(x, y0, w, h);
    ctx.fillStyle = '#454560';
    ctx.fillRect(x, y0, w, 3);
    ctx.fillStyle = '#222236';
    ctx.fillRect(x + w - 3, y0, 3, h);
    // entrance snout on the beam side
    ctx.fillStyle = '#5e5e78';
    ctx.fillRect(x - 4, pipeY - 5, 5, 10);
    ctx.fillStyle = '#7a7a96';
    ctx.fillRect(x - 4, pipeY - 5, 5, 1);
    ctx.fillStyle = '#3c3c50';
    ctx.fillRect(x - 3, pipeY - 3, 1, 6);          // bellows
    ctx.fillRect(x - 1, pipeY - 3, 1, 6);
    // vacuum chamber window
    const cx0 = x + 4, cw = 22;
    ctx.fillStyle = '#161a24';
    ctx.fillRect(cx0, y0 + 4, cw, h - 10);
    ctx.fillStyle = '#5a5a74';
    ctx.fillRect(cx0, y0 + 4, cw, 1);
    // detector head, fixed above the wafer
    const hx = cx0 + 11;
    ctx.fillStyle = '#6a6a85';
    ctx.fillRect(hx - 5, y0 + 5, 10, 6);
    ctx.fillStyle = '#8a8aa6';
    ctx.fillRect(hx - 5, y0 + 5, 10, 1);
    ctx.fillStyle = Math.sin(t * 4.4) > 0 ? '#54d8f0' : '#1c4450';
    ctx.fillRect(hx - 1, y0 + 11, 3, 1);           // lens
    // XY stage steps to a new field between pulses
    const off = ((pulseIdx % 3) - 1) * 3;
    const wcx = hx + off;
    ctx.fillStyle = '#26263a';
    ctx.fillRect(cx0 + 1, pipeY + 10, cw - 2, 2);  // stage rails
    ctx.fillStyle = '#2e2e42';
    ctx.fillRect(wcx - 9, pipeY + 6, 18, 4);       // stage carriage
    ctx.fillStyle = '#4c4c64';
    ctx.fillRect(wcx - 9, pipeY + 6, 18, 1);
    ctx.fillStyle = '#6e6e8c';
    ctx.fillRect(wcx - 6, pipeY + 5, 12, 1);       // chuck
    // silicon wafer: a bright 13×7 disc with a straight flat on the left,
    // floating one dark row clear of the chuck so it reads as a separate part
    const rowW = [7, 11, 13, 13, 13, 11, 7];
    ctx.fillStyle = '#9aa0ba';
    for (let r = 0; r < rowW.length; r++) {
      if (r >= 2 && r <= 4) ctx.fillRect(wcx - 4, pipeY - 3 + r, 11, 1);  // flat
      else ctx.fillRect(wcx - (rowW[r] >> 1), pipeY - 3 + r, rowW[r], 1);
    }
    ctx.fillStyle = '#d4dcf0';                     // sheen, away from the flat
    ctx.fillRect(wcx + 1, pipeY - 2, 4, 1);
    ctx.fillRect(wcx + 2, pipeY - 1, 3, 1);
    ctx.fillStyle = '#a08fc8';                     // iridescence
    ctx.fillRect(wcx - 3, pipeY + 1, 5, 1);
    // readout screen filling in a scan raster
    const sx = x + 28, sy = y0 + 6, sw = 9, sh = 14;
    ctx.fillStyle = '#0d1a12';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = '#1f4f30';
    ctx.fillRect(sx, sy, sw, 1);
    ctx.fillStyle = '#44ff77';
    for (let r = 0; r <= pulseIdx % 6; r++) ctx.fillRect(sx + 1, sy + 2 + r * 2, sw - 2, 1);
    ctx.fillStyle = '#26263a';                     // screen bezel foot
    ctx.fillRect(sx, sy + sh, sw, 2);
  }

  _drawQuad(ctx, x, pipeY, groundY, t, i, fd) {
    const w = 14, h = 24;
    const qx = x - Math.floor(w / 2), qy = pipeY - Math.floor(h / 2);
    ctx.fillStyle = '#274b73';                  // dark yoke
    ctx.fillRect(qx, qy, w, h);
    ctx.fillStyle = '#3b6ea5';                  // lit face
    ctx.fillRect(qx + 1, qy + 1, w - 3, h - 3);
    ctx.fillStyle = '#5a92c9';                  // top highlight
    ctx.fillRect(qx + 1, qy + 1, w - 3, 2);
    // copper coil packs, rotated 90° between F and D so the alternation reads
    const coil = (cx, cy, cw, ch) => {
      ctx.fillStyle = '#8c5522';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = '#c07a35';
      ctx.fillRect(cx, cy, cw - 1, ch - 1);
      ctx.fillStyle = '#e0a055';
      ctx.fillRect(cx, cy, cw > ch ? cw - 1 : 1, cw > ch ? 1 : ch - 1);
    };
    if (fd > 0) {
      coil(qx + 2, qy + 4, 3, h - 8);           // left/right poles (focusing)
      coil(qx + w - 5, qy + 4, 3, h - 8);
    } else {
      coil(qx + 3, qy + 3, w - 7, 3);           // top/bottom poles (defocusing)
      coil(qx + 3, qy + h - 6, w - 7, 3);
    }
    // pipe gap through the middle
    ctx.fillStyle = '#1c3450';
    ctx.fillRect(qx, pipeY - 3, w, 6);
    // status LED, staggered phases
    const on = Math.sin(t * 3 + i * 1.9) > 0;
    ctx.fillStyle = on ? '#44ff77' : '#1d5230';
    ctx.fillRect(qx + w - 4, qy + 2, 2, 2);
  }

  _drawBPM(ctx, x, pipeY, groundY, t) {
    // slim diagnostic ring straddling the pipe
    ctx.fillStyle = '#5e5e78';                 // flanges
    ctx.fillRect(x - 5, pipeY - 4, 1, 8);
    ctx.fillRect(x + 4, pipeY - 4, 1, 8);
    ctx.fillStyle = '#2e6470';                 // ring body
    ctx.fillRect(x - 4, pipeY - 8, 8, 16);
    ctx.fillStyle = '#4a92a0';
    ctx.fillRect(x - 3, pipeY - 7, 6, 2);      // lit face
    ctx.fillRect(x - 3, pipeY - 7, 2, 14);
    // pickup button dots top and bottom
    ctx.fillStyle = '#12303e';
    ctx.fillRect(x - 1, pipeY - 7, 2, 2);
    ctx.fillRect(x - 1, pipeY + 5, 2, 2);
    // readout blip
    const on = Math.sin(t * 5.2 + 0.4) > 0.55;
    ctx.fillStyle = on ? '#54d8f0' : '#1c4450';
    ctx.fillRect(x - 1, pipeY - 11, 2, 2);
    // signal cable down the support
    ctx.fillStyle = '#26263a';
    ctx.fillRect(x + 2, pipeY + 8, 1, groundY - pipeY - 10);
  }

  // ── Ambient pixel scientists & slapstick FX ────────────────────────
  // Tiny lab-coat people wander the foreground (walk / idle / work with
  // wrench+sparks / clipboard / coffee), occasionally chat with speech
  // bubbles. Every ~12–20s a component blows up: red warning flicker →
  // chunky blast → debris + smoke + scorch marks; anyone nearby is
  // knocked flat (X-eyes, stars) and floats away as a wobbly ghost, and
  // a replacement strolls in from the screen edge. A scientist wrenching
  // on a component when the beam pulse passes can get a comic
  // skeleton-flash zap followed by dizzy circling stars.

  _initFx() {
    this._people = [];
    this._ghosts = [];
    this._ghostStaff = [];   // re-hired ghost employees
    this._ghostQueue = [];   // pending ghost-employee arrivals
    this._debris = [];
    this._smoke = [];
    this._scorchMarks = [];
    this._spawnQueue = [];
    this._cashPops = [];
    this._lastPopPulse = -1;
    this._mishap = null;
    this._tNow = 0;
    this._fxLastNow = 0;
    this._lastComps = null;
    this._beamX = -999;
    this._nextMishapAt = 13 + Math.random() * 7;   // s until first explosion
    this._zapCooldownUntil = 10;                   // s until zap gag may fire
    this._chatCooldownUntil = 7;                   // s until chat gag may fire
    this._meeting = null;
    this._nextMeetingAt = 20 + Math.random() * 12; // s until first group meeting
    this._doors = null;

    // Campus foot traffic between the visitor lot and the admin office. Tiny
    // background sprites on the lawn walkway; the list is capped and every
    // entry removes itself on arrival, so it never accumulates.
    this._commuters = [];
    this._nextCommuterOutAt = 22 + Math.random() * 14;

    // The unified ranch gag (car hits cow → herd panics → breakout → guard
    // chase → bowled over → sidearm → cow ghosts → restock). Purely time-driven
    // off the main draw loop, so dismiss()'s rAF cancel cleans it up — no extra
    // timers. Cow ghosts outlive the event, so they get their own list.
    this._ranchEvent = null;
    this._nextRanchAt = randIn(EVENT_TIMING.ranchFirst);
    this._cowGhosts = [];

    // Rare surprise events, same time-driven pattern (see EVENT_TIMING).
    this._ufo = null;
    this._nextUfoAt = randIn(EVENT_TIMING.ufoFirst);

    const W = this.W || 480;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const s = this._makeScientist(30 + ((W - 60) * (i + 0.5)) / n + (Math.random() * 20 - 10));
      this._people.push(s);
    }
    this._people[0].hardHat = true;

    const hook = {
      explode: (id) => this._startMishap(id || null, true),
      zap: () => this._forceZap(),
      chat: () => this._forceChat(),
      meet: () => this._startMeeting(true),
      ghostEmployee: () => this._spawnGhostStaff(true),
      moo: () => {
        const c = this._cowsFG && this._cowsFG.find((k) => k.state !== 'moo');
        if (c) { c.state = 'moo'; c.stateT = 0; }
        return !!c;
      },
      ufo: () => this._startUfoEvent(this._tNow, this.W),
      ranch: () => this._startRanchEvent(this._tNow, this.W),
      crash: () => this._startRanchEvent(this._tNow, this.W),     // legacy alias
      cowEvent: () => this._startRanchEvent(this._tNow, this.W),  // legacy alias
      setTime: (f) => { this._cycleOffset = (((f % 1) + 1) % 1) * this._cycleLen - this._tNow; },
      spawnCar: (leave) => {
        if (leave) {
          const p = this._cars.find((c) => c.state === 'parked');
          if (p) { p.leaveAt = 0; return true; }
          return false;
        }
        this._cars.push(this._makeCar());
        return true;
      },
      commuter: () => { this._nextCommuterOutAt = this._tNow; return true; },
      debug: () => ({
        people: this._people.map((p) => p.state),
        ghostStaff: this._ghostStaff.map((g) => `${g.variant}:${g.state}`),
        meeting: this._meeting ? this._meeting.phase : null,
        ufo: this._ufo ? this._ufo.phase : null,
        ranch: this._ranchEvent ? this._ranchEvent.phase : null,
        cowGhosts: this._cowGhosts.length,
        // '*' = drawn by its event, '^' = driven by an event, drawn with the herd
        cows: this._cowsFG.map((c) => c.state + (c.escaped ? '*' : '') + (c.held ? '^' : '')),
        cars: this._cars.map((c) => c.state),
        commuters: this._commuters.map(
          (p) => `${Math.round(p.x)}→${Math.round(p.target)}${p.car ? ':car' : ''}`),
      }),
    };
    this._fxHook = hook;
    window.__titleFx = hook;
  }

  _makeScientist(x) {
    const pick = (a) => a[(Math.random() * a.length) | 0];
    return {
      x,
      foot: 276 + ((Math.random() * 6) | 0),   // walk line (in front of beamline)
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: 9 + Math.random() * 5,
      skin: pick(['#d8a878', '#b0784f', '#e8c9a2']),
      hair: pick(['#3a2e28', '#6e6e78', '#8a5a2e', '#1e1e28']),
      coat: pick(['#c6c8d4', '#b7bcca', '#c9c5b4']),
      coatDark: '#8f93a4',
      trouser: Math.random() < 0.5 ? '#2e3040' : '#383348',
      hardHat: Math.random() < 0.18,
      state: 'idle',
      stateT: Math.random(),
      stateDur: 0.6 + Math.random() * 2,
      target: x,
      // hall-doorway transit (see the 'door' case in _updatePerson)
      doorOut: false,
      doorHome: 276,
      doorFade: 1,
      pendingWork: null,
      workKind: null,
      workComp: null,
      knockVx: 0,
      chatRole: 0,
      chatGlyph: '!',
      phase: Math.random() * Math.PI * 2,
      zapPulse: -1,
      // group-meeting fields
      grpGoal: 0,
      grpMoving: false,
      grpPose: 'stand',
      grpBubble: null,
      grpClip: false,
      grpTool: false,
      grpFace: undefined,
    };
  }

  // ── Campus commuters ───────────────────────────────────────────────
  // Office workers (jackets, not lab coats) walking the lawn walkway between
  // the visitor lot and the admin block. `car` set = inbound to that car.

  _makeCommuter(x, target, dir, car) {
    const pick = (a) => a[(Math.random() * a.length) | 0];
    return {
      x, foot: 190, dir, target, car: car || null,
      onward: !car && Math.random() < 0.3,     // ~30% carry on to the control room
      speed: 10 + Math.random() * 4,
      fadeT: -1,                               // >=0 once they reach their door
      coat: pick(['#5a6478', '#6a5a48', '#4a5a52', '#6e647c', '#57604a']),
      skin: pick(['#d8a878', '#b0784f', '#e8c9a2']),
      hair: pick(['#3a2e28', '#6e6e78', '#8a5a2e', '#1e1e28']),
      phase: Math.random() * 6.28,
    };
  }

  _updateCommuters(dt, t) {
    const list = this._commuters;
    // occasionally someone knocks off, walks out to a parked car and drives away
    if (t >= this._nextCommuterOutAt) {
      this._nextCommuterOutAt = t + 20 + Math.random() * 15;
      const car = this._cars.find((c) => c.state === 'parked' && !c.claimed);
      if (car && this._officeDoorX && list.length < 6) {
        car.claimed = true;
        car.leaveAt = t + 60;                  // hold the stall until they arrive
        list.push(this._makeCommuter(this._officeDoorX, car.x + 8, -1, car));
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.fadeT >= 0) {                      // stepping inside / into the car
        p.fadeT -= dt;
        if (p.fadeT <= 0) list.splice(i, 1);
        continue;
      }
      p.foot += (193 - p.foot) * Math.min(1, dt * 4);   // ease onto the walkway
      const d = p.target - p.x;
      if (Math.abs(d) <= 1) {
        if (p.car) {                           // reached the car — it pulls out
          if (this._cars.includes(p.car)) p.car.leaveAt = 0;
          p.fadeT = 0.45;
        } else if (p.onward && this._ctrlDoorX) {
          p.onward = false;                    // carry on to the control room
          p.target = this._ctrlDoorX;
        } else {
          p.fadeT = 0.45;
        }
        continue;
      }
      p.dir = d > 0 ? 1 : -1;
      p.x += p.dir * p.speed * dt;
    }
    if (list.length > 8) list.splice(0, list.length - 8);  // hard cap, oldest out
  }

  _drawCommuters(ctx, t) {
    for (const p of this._commuters) {
      if (p.fadeT >= 0) ctx.globalAlpha = Math.max(0, p.fadeT / 0.45);
      this._drawTinyPerson(ctx, Math.round(p.x), Math.round(p.foot), p.dir, 'stand',
        p.coat, p.skin, p.hair, t, { walk: p.fadeT < 0, phase: p.phase });
      if (p.fadeT >= 0) ctx.globalAlpha = 1;
    }
  }

  _fxFrame(ctx, now, t, comps, W) {
    this._tNow = t;
    this._lastComps = comps;
    const dt = Math.min(0.05, Math.max(0, (now - this._fxLastNow) / 1000));
    this._fxLastNow = now;

    // natural mishap trigger
    if (!this._mishap && t >= this._nextMishapAt) this._startMishap(null, false);

    // mishap phases: warn → boom → cleanup
    const m = this._mishap;
    if (m) {
      const age = t - m.t0;
      if (m.phase === 'warn' && age >= m.warnDur) {
        m.phase = 'boom';
        m.boomT = t;
        this._boom(m.comp, t);
      } else if (m.phase === 'boom' && t - m.boomT > 3.4) {
        this._mishap = null;
        this._nextMishapAt = t + 12 + Math.random() * 8;
      }
    }

    // queued spawns (stroll in from a screen edge, or step out of a door)
    for (let i = this._spawnQueue.length - 1; i >= 0; i--) {
      const q = this._spawnQueue[i];
      if (t >= q.at) {
        this._spawnQueue.splice(i, 1);
        const fromDoor = q.door && this._doors && this._doors.length;
        const sx = fromDoor ? this._doors[(Math.random() * this._doors.length) | 0]
                            : (Math.random() < 0.5 ? -6 : W + 6);
        const s = this._makeScientist(sx);
        s.state = 'walk';
        s.target = 30 + Math.random() * (W - 60);
        if (fromDoor) {                                   // step OUT of the opening
          s.state = 'door'; s.stateT = 0;
          s.doorOut = true; s.doorHome = s.foot; s.doorFade = 0;
          s.foot = DOOR_SILL;
          s.dir = s.target > sx ? 1 : -1;                  // face where they're headed
        }
        this._people.push(s);
      }
    }
    if (this._people.length + this._spawnQueue.length < 3) {
      this._spawnQueue.push({ at: t + 1 + Math.random() * 2 });
    }

    // update people; 'ghost' = knocked out, 'gone' = walked into a building
    for (let i = this._people.length - 1; i >= 0; i--) {
      const s = this._people[i];
      const r = this._updatePerson(s, dt, t, comps, W);
      if (r === 'ghost') {
        this._people.splice(i, 1);
        this._ghosts.push({ x0: s.x, y0: s.foot - 8, t0: t, wob: Math.random() * Math.PI * 2 });
        this._spawnQueue.push({ at: t + 2.5 + Math.random() * 2.5 });
      } else if (r === 'gone') {
        this._people.splice(i, 1);
        this._spawnQueue.push({ at: t + 3 + Math.random() * 4, door: true });
      }
    }

    // Foreground cow herd. 'escaped' cows are both driven AND drawn by their
    // event; 'held' cows are driven by an event but still drawn in the normal
    // herd pass, so they keep their place in the scene's layering.
    if (this._cowsFG) {
      for (const c of this._cowsFG) if (!c.escaped && !c.held) this._updateCow(c, dt, t, W);
    }

    // the ranch chain: trigger periodically, then advance its phases
    if (!this._ranchEvent && t >= this._nextRanchAt && !this._startRanchEvent(t, W)) {
      this._nextRanchAt = t + 12;
    }
    if (this._ranchEvent) this._updateRanchEvent(t, dt, W);

    // rare surprise events (only one cow-borrowing event at a time — if
    // another is running, back off and try again shortly)
    if (!this._ufo && t >= this._nextUfoAt && !this._startUfoEvent(t, W)) {
      this._nextUfoAt = t + 12;
    }
    if (this._ufo) this._updateUfoEvent(t, dt, W);

    // campus commuters (lot ↔ admin office)
    this._updateCommuters(dt, t);

    // chat gag
    if (t >= this._chatCooldownUntil) this._tryChat(t);

    // meetings & work parties
    if (!this._meeting && t >= this._nextMeetingAt) {
      if (!this._startMeeting(false)) this._nextMeetingAt = t + 6;
    }
    this._updateMeeting(t, comps, W);

    // beam-zap gag: wrenching on a component as the pulse passes
    const pulseIdx = Math.floor(t / 1.5);
    if (t >= this._zapCooldownUntil) {
      for (const s of this._people) {
        if (s.state === 'work' && s.workKind === 'wrench' && s.workComp &&
            Math.abs(this._beamX - s.workComp.x) < 3 && s.zapPulse !== pulseIdx) {
          s.zapPulse = pulseIdx;
          if (Math.random() < 0.35) { this._zapPerson(s, t); break; }
        }
      }
    }

    // particles
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const d = this._debris[i];
      if (t >= d.die) { this._debris.splice(i, 1); continue; }
      if (!d.rest) {
        d.vy += 150 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y >= d.floor) { d.y = d.floor; d.rest = true; }
      }
    }
    for (let i = this._smoke.length - 1; i >= 0; i--) {
      if (t - this._smoke[i].t0 > this._smoke[i].dur) this._smoke.splice(i, 1);
    }
    for (let i = this._scorchMarks.length - 1; i >= 0; i--) {
      if (t - this._scorchMarks[i].t0 > this._scorchMarks[i].dur) this._scorchMarks.splice(i, 1);
    }
    for (let i = this._cowGhosts.length - 1; i >= 0; i--) {
      if (t - this._cowGhosts[i].t0 > 3.4) this._cowGhosts.splice(i, 1);
    }
    for (let i = this._ghosts.length - 1; i >= 0; i--) {
      if (t - this._ghosts[i].t0 > 3.6) {
        this._ghosts.splice(i, 1);
        // ...a few seconds later they drift back in, re-hired as ghost staff
        if (Math.random() < 0.8) this._ghostQueue.push(t + 3 + Math.random() * 4);
      }
    }

    // ghost employees
    for (let i = this._ghostQueue.length - 1; i >= 0; i--) {
      if (t >= this._ghostQueue[i]) {
        this._ghostQueue.splice(i, 1);
        this._spawnGhostStaff(false);
      }
    }
    for (let i = this._ghostStaff.length - 1; i >= 0; i--) {
      if (!this._updateGhostStaff(this._ghostStaff[i], dt, t, comps, W)) {
        this._ghostStaff.splice(i, 1);
      }
    }

    // ── draw ──
    // commuters first: they're on the lawn, behind everything on the pad
    this._drawCommuters(ctx, t);
    this._drawScorch(ctx, t);
    if (m && m.phase === 'warn') this._drawWarning(ctx, m.comp, t);

    const people = this._people.slice().sort((a, b) => a.foot - b.foot);
    for (const s of people) this._drawPerson(ctx, s, t);

    for (const d of this._debris) {
      if (d.die - t < 0.7 && Math.floor(t * 10) % 2) continue; // fade-out flicker
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.size, d.size);
    }
    if (m && m.phase === 'boom') this._drawBlast(ctx, m, t, W);
    for (const p of this._smoke) {
      const age = t - p.t0;
      if (age < 0) continue;
      const a = Math.max(0, 1 - age / p.dur);
      const size = 2 + Math.floor(age * 3);
      const x = Math.round(p.x + p.drift * age);
      const y = Math.round(p.y - age * 9);
      this._blob(ctx, x, y, size, `rgba(150,155,175,${(0.32 * a).toFixed(2)})`);
    }
    for (const g of this._ghostStaff) this._drawGhostStaffOne(ctx, g, t);
    for (const g of this._ghosts) this._drawGhost(ctx, g, t);

    // "+$1,000" pops on every pulse arrival at the wafer scanner
    for (let i = this._cashPops.length - 1; i >= 0; i--) {
      const p = this._cashPops[i];
      const age = t - p.t0;
      if (age > 1.2) { this._cashPops.splice(i, 1); continue; }
      const u = age / 1.2;
      const ease = 1 - (1 - u) * (1 - u);                    // ease-out rise
      const yy = Math.round(p.y - ease * 15);
      ctx.globalAlpha = u > 0.6 ? Math.max(0, (1 - u) / 0.4) : 1;
      this._drawCashPop(ctx, Math.round(p.x), yy);
      ctx.globalAlpha = 1;
    }
  }

  // tiny "+$1,000" in pixel glyphs: dark outline + bright 'good' green.
  // 7-row grid so the $ stem can poke past the S top and bottom — that
  // overhang is what keeps it from reading as a "5" at this size.
  _drawCashPop(ctx, x, y) {
    const glyphs = [
      ['000', '000', '010', '111', '010', '000', '000'],   // +
      ['010', '111', '100', '111', '001', '111', '010'],   // $ (stem overhangs)
      ['000', '010', '110', '010', '010', '111', '000'],   // 1
      ['000', '000', '000', '000', '000', '010', '100'],   // , (drops below)
      ['000', '111', '101', '101', '101', '111', '000'],   // 0
      ['000', '111', '101', '101', '101', '111', '000'],   // 0
      ['000', '111', '101', '101', '101', '111', '000'],   // 0
    ];
    const draw = (ox, oy, color) => {
      ctx.fillStyle = color;
      let gx = x + ox;
      for (const g of glyphs) {
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 3; c++) {
            if (g[r][c] === '1') ctx.fillRect(gx + c, y + oy + r, 1, 1);
          }
        }
        gx += 4;
      }
    };
    draw(1, 0, '#0e2e18'); draw(-1, 0, '#0e2e18');           // outline
    draw(0, 1, '#0e2e18'); draw(0, -1, '#0e2e18');
    draw(0, 0, '#44ff77');
  }

  // ── Ghost employees (re-hired after their unfortunate accident) ────

  _spawnGhostStaff(forced) {
    const W = this.W;
    const active = this._ghostStaff.filter((g) => g.state !== 'fadeout');
    if (active.length >= 3) {
      // over the cap: the oldest does a contented fade-out
      let oldest = active[0];
      for (const g of active) if (g.born < oldest.born) oldest = g;
      oldest.state = 'fadeout';
      oldest.stateT = 0;
    }
    const have = new Set(active.map((g) => g.variant));
    const variant = ['coffee', 'hardhat', 'plain'].find((v) => !have.has(v)) ||
      ['coffee', 'hardhat', 'plain'][(Math.random() * 3) | 0];
    const fromLeft = Math.random() < 0.5;
    const g = {
      x: fromLeft ? -8 : W + 8,
      vy: 274,
      baseY: 274,
      dir: fromLeft ? 1 : -1,
      state: 'drift',
      stateT: 0,
      dur: 0,
      target: 40 + Math.random() * (W - 80),
      pending: null,
      variant,
      phase: Math.random() * Math.PI * 2,
      born: this._tNow,
      nextScareAt: this._tNow + (forced ? 2 + Math.random() * 2 : 12 + Math.random() * 10),
      victim: null,
    };
    this._ghostStaff.push(g);
    return variant;
  }

  _decideGhost(g, t, comps, W) {
    g.state = 'drift';
    g.stateT = 0;
    const r = Math.random();
    if (r < 0.32 && comps && comps.length) {
      const c = comps[(Math.random() * comps.length) | 0];
      g.target = Math.max(16, Math.min(W - 16, c.x + (Math.random() < 0.5 ? -8 : 8)));
      g.pending = 'inspect';
    } else if (r < 0.47 && this._doors && this._doors.length) {
      // phase straight through the wall — they're ghosts, that's the joke
      g.target = this._doors[(Math.random() * this._doors.length) | 0] - 12;
      g.pending = 'visit';
    } else {
      g.target = 30 + Math.random() * (W - 60);
      g.pending = null;
    }
  }

  _updateGhostStaff(g, dt, t, comps, W) {
    g.stateT += dt;
    const drift = (goal, speed) => {
      const dx = goal - g.x;
      if (Math.abs(dx) > 1.5) { g.dir = dx > 0 ? 1 : -1; g.x += g.dir * speed * dt; return false; }
      return true;
    };
    const toY = (goal) => {
      const dy = goal - g.vy;
      if (Math.abs(dy) > 1) { g.vy += Math.sign(dy) * 26 * dt; return false; }
      return true;
    };
    switch (g.state) {
      case 'drift': {
        const atX = drift(g.target, 13);
        const atY = toY(g.baseY);
        if (atX && atY) {
          if (g.pending === 'inspect') { g.state = 'inspect'; g.stateT = 0; g.dur = 2.5 + Math.random() * 2; }
          else if (g.pending === 'visit') { g.state = 'visitIn'; g.stateT = 0; g.dur = 2.5 + Math.random() * 1.5; }
          else this._decideGhost(g, t, comps, W);
          g.pending = null;
        }
        if (t >= g.nextScareAt) {
          const victims = this._people.filter((p) =>
            p.state === 'walk' || p.state === 'idle' || p.state === 'work');
          if (victims.length) {
            g.victim = victims[(Math.random() * victims.length) | 0];
            g.state = 'scareMove';
            g.stateT = 0;
          } else {
            g.nextScareAt = t + 6;
          }
        }
        break;
      }
      case 'inspect':
        toY(g.baseY - 2);
        if (g.stateT >= g.dur) this._decideGhost(g, t, comps, W);
        break;
      case 'visitIn': {
        const atX = drift(g.target, 13);
        const atY = toY(187);          // hover up into the cutaway interior
        if (atX && atY && g.stateT >= g.dur) { g.state = 'visitOut'; g.stateT = 0; }
        break;
      }
      case 'visitOut':
        if (toY(g.baseY)) this._decideGhost(g, t, comps, W);
        break;
      case 'scareMove': {
        const v = g.victim;
        const valid = v && this._people.includes(v) &&
          (v.state === 'walk' || v.state === 'idle' || v.state === 'work');
        if (!valid || g.stateT > 9) { g.victim = null; this._decideGhost(g, t, comps, W); break; }
        const atY = toY(g.baseY);
        if (drift(v.x - v.dir * 7, 24) && atY) {      // sidle up behind them
          g.state = 'boo';
          g.stateT = 0;
          g.dir = v.x > g.x ? 1 : -1;
          v.scareFrom = g.x;
          v.state = 'startled';
          v.stateT = 0;
          v.pendingWork = null;
          v.workKind = null;
          v.workComp = null;
        }
        break;
      }
      case 'boo':
        if (g.stateT >= 1.2) {
          g.state = 'pleased';
          g.stateT = 0;
          g.victim = null;
          g.nextScareAt = t + 16 + Math.random() * 9;
        }
        break;
      case 'pleased':
        if (g.stateT >= 1.3) this._decideGhost(g, t, comps, W);
        break;
      case 'fadeout':
        g.vy -= 6 * dt;
        if (g.stateT >= 2.2) return false;
        break;
    }
    g.x = Math.max(-10, Math.min(W + 10, g.x));
    return true;
  }

  _drawGhostStaffOne(ctx, g, t) {
    let a = 0.55;
    if (g.state === 'fadeout') a = Math.max(0, 0.55 * (1 - g.stateT / 2.2));
    const bobAmp = g.state === 'pleased' ? 3 : 2;
    const bobSpd = g.state === 'pleased' ? 7 : 2.2;
    const x = Math.round(g.x);
    const y = Math.round(g.vy) + Math.round(Math.sin(t * bobSpd + g.phase) * bobAmp);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#cfeef2';
    ctx.fillRect(x - 2, y - 10, 5, 1);   // rounded crown
    ctx.fillRect(x - 3, y - 9, 7, 7);    // head + body
    ctx.fillRect(x - 4, y - 6, 1, 2);    // stubby arms
    ctx.fillRect(x + 4, y - 6, 1, 2);
    for (let i = 0; i < 4; i++) {        // wavy tail
      const off = Math.sin(t * 8 + i * 2.1) > 0 ? 0 : 1;
      ctx.fillRect(x - 3 + i * 2, y - 2 + off, 1, 1);
    }
    ctx.fillStyle = '#27455a';
    ctx.fillRect(x - 2 + (g.dir > 0 ? 1 : 0), y - 7, 1, 2);   // eyes
    ctx.fillRect(x + 1 + (g.dir > 0 ? 1 : 0), y - 7, 1, 2);
    if (g.state === 'boo') ctx.fillRect(x - 1, y - 4, 3, 2);  // open mouth
    // accessories read best a touch more opaque than the ghost
    ctx.globalAlpha = Math.min(1, a + 0.35);
    if (g.variant === 'hardhat') {
      ctx.fillStyle = '#d9b53a';
      ctx.fillRect(x - 2, y - 11, 5, 2);
      ctx.fillRect(x - 3, y - 10, 7, 1);
    } else if (g.variant === 'coffee') {
      const mx = x + (g.dir > 0 ? 5 : -6);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillRect(mx, y - 6, 2, 2);
      const sp = Math.floor(t * 3 + g.phase) % 3;
      ctx.fillStyle = 'rgba(220,224,235,0.7)';
      ctx.fillRect(mx + (sp % 2), y - 8 - sp, 1, 1);
    }
    ctx.globalAlpha = 1;
    if (g.state === 'boo') this._drawBubble(ctx, x, y - 12, 'boo');
  }

  _updatePerson(s, dt, t, comps, W) {
    s.stateT += dt;
    switch (s.state) {
      case 'idle':
        if (s.stateT >= s.stateDur) this._decide(s, comps, W);
        break;
      case 'door': {
        // walking INTO (or OUT OF) the hall opening: the foot line climbs the
        // 44px from the walk line up to the doorway sill while the figure fades
        const u = Math.min(1, s.stateT / DOOR_DUR);
        const p = s.doorOut ? 1 - u : u;                 // 0 = walk line, 1 = sill
        s.foot = s.doorHome + (DOOR_SILL - s.doorHome) * p;
        const hx = this._hallDoorX ?? s.x;
        s.x += (hx - s.x) * Math.min(1, dt * 3.5);       // centre up in the gap
        s.doorFade = 1 - p;
        if (u >= 1) {
          if (!s.doorOut) return 'gone';                 // through, into the hall
          s.state = 'walk'; s.stateT = 0; s.doorFade = 1;
          s.foot = s.doorHome;
          s.pendingWork = null;
        }
        break;
      }
      case 'walk': {
        const d = s.target - s.x;
        if (Math.abs(d) <= 1) {
          if (s.pendingWork && s.pendingWork.kind === 'enter') {
            s.state = 'door'; s.stateT = 0; s.speedMul = 1;   // step into the doorway
            s.doorOut = false; s.doorHome = s.foot;
            s.pendingWork = null;
            break;
          } else if (s.pendingWork) {
            s.state = 'work';
            s.workKind = s.pendingWork.kind;
            s.workComp = s.pendingWork.comp;
            s.dir = s.pendingWork.faceDir;
            s.pendingWork = null;
            s.stateDur = 3 + Math.random() * 4;
          } else {
            s.state = 'idle';
            s.stateDur = 1 + Math.random() * 2.5;
          }
          s.stateT = 0;
          s.speedMul = 1;
        } else {
          s.dir = d > 0 ? 1 : -1;
          s.x += s.dir * s.speed * (s.speedMul || 1) * dt;
        }
        break;
      }
      case 'startled':
        if (s.stateT >= 0.55) {
          // scurry away from the ghost, fast
          s.state = 'walk';
          s.stateT = 0;
          s.speedMul = 3;
          s.pendingWork = null;
          const away = s.x + ((s.scareFrom ?? s.x) > s.x ? -1 : 1) * (40 + Math.random() * 25);
          s.target = Math.max(16, Math.min(W - 16, away));
        }
        break;
      case 'work':
        if (s.stateT >= s.stateDur) {
          s.state = 'idle'; s.stateT = 0; s.stateDur = 0.5 + Math.random();
          s.workKind = null; s.workComp = null;
        }
        break;
      case 'chat':
        if (s.stateT >= s.stateDur) { s.state = 'idle'; s.stateT = 0; s.stateDur = 0.6 + Math.random(); }
        break;
      case 'down':
        if (s.stateT < 0.3) s.x += s.knockVx * dt * (1 - s.stateT / 0.3);
        if (s.stateT >= 1.15) return 'ghost'; // rise, sweet ghost
        break;
      case 'grp': {
        const dg = s.grpGoal - s.x;
        if (Math.abs(dg) > 1) {
          s.dir = dg > 0 ? 1 : -1;
          s.x += s.dir * s.speed * dt;
          s.grpMoving = true;
        } else {
          s.grpMoving = false;
          if (s.grpFace !== undefined) s.dir = s.grpFace;
        }
        break;
      }
      case 'zap':
        if (s.stateT >= 0.55) { s.state = 'dizzy'; s.stateT = 0; s.stateDur = 2.4; }
        break;
      case 'dizzy':
        s.x += Math.sin(t * 6 + s.phase) * 8 * dt;
        if (s.stateT >= s.stateDur) { s.state = 'idle'; s.stateT = 0; s.stateDur = 0.8; }
        break;
    }
    s.x = Math.max(-8, Math.min(W + 8, s.x));
    return true;
  }

  _decide(s, comps, W) {
    const r = Math.random();
    if (r < 0.16 && this._doors && this._doors.length) {
      // head off down the hall corridor for a bit
      s.pendingWork = { kind: 'enter' };
      s.target = this._doors[(Math.random() * this._doors.length) | 0];
    } else if (r < 0.55 && comps && comps.length) {
      const comp = comps[(Math.random() * comps.length) | 0];
      const kind = ['wrench', 'wrench', 'clipboard', 'coffee'][(Math.random() * 4) | 0];
      const side = Math.random() < 0.5 ? -1 : 1;
      s.pendingWork = { kind, comp, faceDir: -side };
      s.target = Math.max(20, Math.min(W - 20, comp.x + side * 10));
    } else {
      s.pendingWork = null;
      s.target = 24 + Math.random() * (W - 48);
    }
    s.state = 'walk';
    s.stateT = 0;
  }

  // ── Meetings & work parties ────────────────────────────────────────

  _startMeeting(forced) {
    if (this._meeting) return false;
    const free = this._people.filter((p) => p.state === 'walk' || p.state === 'idle');
    if (free.length < 2) return false;
    const members = free.slice(0, 2 + ((Math.random() * 3) | 0)); // 2-4 people
    const W = this.W;
    const spot = Math.max(50, Math.min(W - 50,
      members.reduce((a, p) => a + p.x, 0) / members.length));
    members.forEach((p, k) => {
      p.state = 'grp';
      p.stateT = 0;
      p.pendingWork = null;
      p.workKind = null;
      p.grpGoal = Math.round(spot + (k - (members.length - 1) / 2) * 8);
      p.grpFace = undefined;
      p.grpBubble = null;
      p.grpPose = 'stand';
      p.grpTool = false;
      p.grpClip = k === 0;   // the organizer carries a clipboard
    });
    this._meeting = { members, spot, phase: 'gather', t0: this._tNow, dur: 0, comp: null };
    if (forced) this._nextMeetingAt = this._tNow + 40; // don't stack a natural one
    return true;
  }

  _updateMeeting(t, comps, W) {
    const m = this._meeting;
    if (!m) return;
    // drop members who got exploded/zapped/removed
    m.members = m.members.filter((p) => p.state === 'grp' && this._people.includes(p));
    if (m.members.length < 2) { this._endMeeting(t); return; }
    const allThere = m.members.every((p) => Math.abs(p.grpGoal - p.x) <= 1.5);
    switch (m.phase) {
      case 'gather':
        if (allThere || t - m.t0 > 12) {
          m.phase = 'talk';
          m.t0 = t;
          m.dur = 4 + Math.random() * 3;
          for (const p of m.members) { p.grpFace = p.x < m.spot ? 1 : -1; p.dir = p.grpFace; }
        }
        break;
      case 'talk': {
        const n = m.members.length;
        const slot = Math.floor((t - m.t0) / 1.2);
        m.members.forEach((p, k) => {
          p.grpBubble = (k === slot % n && ((t - m.t0) % 1.2) < 0.9)
            ? ['!', '?', 'emc'][(k + slot) % 3] : null;
        });
        if (t - m.t0 > m.dur) {
          for (const p of m.members) p.grpBubble = null;
          if (comps && comps.length && Math.random() < 0.45) {
            // meeting resolved: grab wrenches, march to a component together
            m.comp = comps[(Math.random() * comps.length) | 0];
            m.phase = 'move';
            m.t0 = t;
            m.members.forEach((p, k) => {
              p.grpGoal = Math.max(20, Math.min(W - 20,
                m.comp.x + (k - (m.members.length - 1) / 2) * 9));
              p.grpFace = undefined;
              p.grpTool = true;
            });
          } else {
            this._endMeeting(t);
          }
        }
        break;
      }
      case 'move':
        if (allThere || t - m.t0 > 12) {
          m.phase = 'work';
          m.t0 = t;
          m.dur = 4 + Math.random() * 2.5;
          for (const p of m.members) {
            p.grpPose = 'kneel';
            p.grpFace = p.x < m.comp.x ? 1 : -1;
            p.dir = p.grpFace;
          }
        }
        break;
      case 'work':
        if (t - m.t0 > m.dur) this._endMeeting(t);
        break;
    }
  }

  _endMeeting(t) {
    const m = this._meeting;
    if (m) {
      for (const p of m.members) {
        if (p.state !== 'grp') continue;
        p.state = 'idle';
        p.stateT = 0;
        p.stateDur = 0.4 + Math.random();
        p.grpBubble = null;
        p.grpPose = 'stand';
        p.grpTool = false;
        p.grpClip = false;
      }
    }
    this._meeting = null;
    this._nextMeetingAt = t + 22 + Math.random() * 18;
  }

  _tryChat(t) {
    const ok = (p) => p.state === 'walk' || p.state === 'idle';
    for (let i = 0; i < this._people.length; i++) {
      for (let j = i + 1; j < this._people.length; j++) {
        const a = this._people[i], b = this._people[j];
        if (!ok(a) || !ok(b)) continue;
        if (Math.abs(a.x - b.x) > 9) continue;
        this._startChat(a, b, t);
        return;
      }
    }
  }

  _startChat(a, b, t) {
    a.state = b.state = 'chat';
    a.stateT = b.stateT = 0;
    a.stateDur = b.stateDur = 3.1;
    a.chatRole = 0; b.chatRole = 1;
    a.chatGlyph = ['?', 'emc', 'emc'][(Math.random() * 3) | 0];
    b.chatGlyph = Math.random() < 0.5 ? '!' : '?';
    a.dir = b.x >= a.x ? 1 : -1;
    b.dir = -a.dir;
    a.workKind = b.workKind = null;
    this._chatCooldownUntil = t + 16 + Math.random() * 10;
  }

  _zapPerson(s, t) {
    s.state = 'zap';
    s.stateT = 0;
    this._zapCooldownUntil = t + 24 + Math.random() * 10;
  }

  _forceZap() {
    const s = this._people.find((p) => p.state === 'work' && p.workKind === 'wrench') ||
              this._people.find((p) => p.state === 'walk' || p.state === 'idle' || p.state === 'work');
    if (s) this._zapPerson(s, this._tNow);
    return !!s;
  }

  _forceChat() {
    const ok = this._people.filter((p) => p.state === 'walk' || p.state === 'idle' || p.state === 'work');
    if (ok.length < 2) return false;
    const [a, b] = ok;
    b.x = a.x + 7;
    b.foot = a.foot;
    this._startChat(a, b, this._tNow);
    return true;
  }

  _startMishap(id, forced) {
    if (this._mishap) return false;
    const comps = this._lastComps;
    if (!comps || !comps.length) return false;
    let comp = id ? comps.find((c) => c.id === id) : null;
    if (!comp && forced && this._people.length) {
      // deterministic comedy: blow the component nearest to a scientist
      let best = Infinity;
      for (const c of comps) {
        for (const p of this._people) {
          const d = Math.abs(p.x - c.x);
          if (d < best) { best = d; comp = c; }
        }
      }
    }
    if (!comp) {
      const preferred = comps.filter(
        (c) => c.id === 'srf0' || c.id === 'srf1' || c.id === 'undulator');
      const pool = preferred.length && Math.random() < 0.75 ? preferred : comps;
      comp = pool[(Math.random() * pool.length) | 0];
    }
    this._mishap = { comp, t0: this._tNow, warnDur: forced ? 0.15 : 0.9, phase: 'warn', boomT: 0 };
    return true;
  }

  _boom(comp, t) {
    const colors = ['#e09a58', '#8a4f28', '#6a6a85', '#3c3c52', '#d9b53a', '#44464f'];
    for (let i = 0; i < 14; i++) {
      this._debris.push({
        x: comp.x + (Math.random() * 8 - 4),
        y: comp.y + (Math.random() * 8 - 4),
        vx: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 44),
        vy: -(35 + Math.random() * 80),
        size: Math.random() < 0.3 ? 2 : 1,
        color: colors[(Math.random() * colors.length) | 0],
        floor: 270 + Math.random() * 12,
        die: t + 1.8 + Math.random() * 1.2,
        rest: false,
      });
    }
    for (let i = 0; i < 6; i++) {
      this._smoke.push({
        x: comp.x + (Math.random() * 14 - 7),
        y: comp.y + (Math.random() * 8 - 4),
        t0: t + i * 0.13,
        dur: 2.1 + Math.random() * 1.3,
        drift: Math.random() * 8 - 4,
      });
    }
    this._scorchMarks.push({
      x: comp.x, y: comp.y, t0: t, dur: 9,
      spots: Array.from({ length: 6 }, () => ({
        dx: (Math.random() * 20 - 10) | 0,
        dy: (Math.random() * 16 - 6) | 0,
        w: 2 + ((Math.random() * 3) | 0),
        h: 1 + ((Math.random() * 2) | 0),
      })),
    });
    // comic knock-back for anyone close (horizontal distance only)
    for (const s of this._people) {
      if (s.state === 'down') continue;
      if (Math.abs(s.x - comp.x) < 32) {
        s.state = 'down';
        s.stateT = 0;
        s.knockVx = (s.x < comp.x ? -1 : 1) * 38;
        s.workKind = null; s.workComp = null; s.pendingWork = null;
      }
    }
  }

  // chunky octagon-ish blob out of two overlapping rects
  _blob(ctx, cx, cy, r, style) {
    const s = Math.max(1, Math.floor(r * 0.66));
    ctx.fillStyle = style;
    ctx.fillRect(cx - r, cy - s, r * 2, s * 2);
    ctx.fillRect(cx - s, cy - r, s * 2, r * 2);
  }

  _drawWarning(ctx, comp, t) {
    if (Math.floor(t * 14) % 2 === 0) return;
    ctx.fillStyle = 'rgba(255,68,85,0.30)';
    ctx.fillRect(comp.x - 13, comp.y - 17, 26, 32);
    ctx.fillStyle = '#ff4455';
    ctx.fillRect(comp.x - 1, comp.y - 15, 3, 3);
  }

  _drawBlast(ctx, m, t, W) {
    const f = (t - m.boomT) / 0.5;
    if (f >= 1) return;
    const ex = m.comp.x, ey = m.comp.y + 6;
    if (f < 0.12) {
      ctx.fillStyle = 'rgba(255,240,210,0.16)';
      ctx.fillRect(0, 0, W, this.H);
    }
    const r = 4 + Math.floor(f * 22);
    this._blob(ctx, ex, ey, r, `rgba(224,120,40,${(0.75 * (1 - f)).toFixed(2)})`);
    this._blob(ctx, ex, ey, Math.max(2, (r * 0.65) | 0), `rgba(255,200,80,${(0.9 * (1 - f)).toFixed(2)})`);
    if (f < 0.45) this._blob(ctx, ex, ey, Math.max(1, (r * 0.35) | 0), '#fff6e8');
  }

  _drawScorch(ctx, t) {
    for (const sc of this._scorchMarks) {
      const a = Math.max(0, 1 - (t - sc.t0) / sc.dur);
      ctx.fillStyle = `rgba(10,10,14,${(0.65 * a).toFixed(2)})`;
      for (const sp of sc.spots) ctx.fillRect(sc.x + sp.dx, sc.y + sp.dy, sp.w, sp.h);
      ctx.fillStyle = `rgba(8,8,12,${(0.4 * a).toFixed(2)})`;
      ctx.fillRect(sc.x - 10, 265, 20, 3);
    }
  }

  _drawGhost(ctx, g, t) {
    const age = t - g.t0;
    const dur = 3.6;
    const a = age < 0.25 ? age / 0.25 : Math.max(0, 1 - (age - 0.25) / (dur - 0.25));
    const x = Math.round(g.x0 + Math.sin(age * 3 + g.wob) * 3);
    const y = Math.round(g.y0 - age * 15);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = '#cfeef2';
    ctx.fillRect(x - 2, y - 10, 5, 1);  // rounded crown
    ctx.fillRect(x - 3, y - 9, 7, 7);   // head + body
    ctx.fillRect(x - 4, y - 6, 1, 2);   // stubby arms
    ctx.fillRect(x + 4, y - 6, 1, 2);
    for (let i = 0; i < 4; i++) {       // wavy tail
      const off = Math.sin(t * 8 + i * 2.1) > 0 ? 0 : 1;
      ctx.fillRect(x - 3 + i * 2, y - 2 + off, 1, 1);
    }
    ctx.fillStyle = '#27455a';
    ctx.fillRect(x - 2, y - 7, 1, 2);   // eyes
    ctx.fillRect(x + 1, y - 7, 1, 2);
    ctx.fillRect(x - 1, y - 4, 3, 1);   // little "oh no" mouth
    ctx.globalAlpha = 1;
  }

  _drawPerson(ctx, s, t) {
    const y0 = Math.round(s.foot);
    let x = Math.round(s.x);
    const dark = '#1a1a22';

    // mid-doorway transit: one alpha for the whole sprite (restored at the end)
    const fade = s.state === 'door' ? (s.doorFade ?? 1) : 1;
    if (fade < 1) {
      if (fade <= 0.02) return;
      ctx.globalAlpha = fade;
    }

    // ── knocked flat: X-eyes + little stars ──
    if (s.state === 'down') {
      ctx.fillStyle = s.coat;
      ctx.fillRect(x - 4, y0 - 2, 8, 2);
      ctx.fillStyle = s.trouser;
      ctx.fillRect(x - 6, y0 - 2, 2, 2);
      ctx.fillStyle = s.skin;
      ctx.fillRect(x + 4, y0 - 3, 3, 3);
      ctx.fillStyle = dark;
      ctx.fillRect(x + 5, y0 - 2, 1, 1);
      if (s.hardHat) { ctx.fillStyle = '#d9b53a'; ctx.fillRect(x + 8, y0 - 2, 3, 2); }
      ctx.fillStyle = '#ffe066';
      const ph = Math.floor(t * 6) % 2;
      ctx.fillRect(x + 4 + ph, y0 - 7, 1, 1);
      ctx.fillRect(x + 7 - ph, y0 - 6, 1, 1);
      return;
    }

    // ── skeleton-flash zap frames ──
    if (s.state === 'zap') {
      x += Math.floor(t * 30) % 2 === 0 ? 1 : -1; // jitter
      if (Math.floor(t * 12) % 3 !== 2) {          // skeleton shows 2/3 of frames
        ctx.fillStyle = '#e9f3ff';
        ctx.fillRect(x - 2, y0 - 3, 2, 3);
        ctx.fillRect(x + 1, y0 - 3, 2, 3);
        ctx.fillRect(x - 2, y0 - 9, 5, 6);
        ctx.fillRect(x - 1, y0 - 12, 3, 3);
        ctx.fillStyle = dark;
        ctx.fillRect(x - 1, y0 - 8, 3, 1);   // ribs
        ctx.fillRect(x - 1, y0 - 6, 3, 1);
        ctx.fillRect(x - 1, y0 - 11, 1, 1);  // eye sockets
        ctx.fillRect(x + 1, y0 - 11, 1, 1);
        ctx.fillStyle = '#aef4ff';           // arc pixels
        for (let i = 0; i < 3; i++) {
          const ax = x - 4 + Math.floor(((Math.sin(t * 37 + i * 7.3) + 1) / 2) * 9);
          const ay = y0 - 13 + Math.floor(((Math.sin(t * 29 + i * 3.1) + 1) / 2) * 12);
          ctx.fillRect(ax, ay, 1, 1);
        }
        return;
      }
      // non-skeleton frame falls through to the normal standing draw
    }

    // ── startled by a ghost: hop, arms up, wide eyes ──
    if (s.state === 'startled') {
      const yy = y0 - (Math.floor(t * 10) % 2);
      ctx.fillStyle = s.trouser;               // legs spread mid-hop
      ctx.fillRect(x - 3, yy - 3, 2, 3);
      ctx.fillRect(x + 2, yy - 3, 2, 3);
      ctx.fillStyle = s.coat;
      ctx.fillRect(x - 2, yy - 9, 5, 6);
      ctx.fillStyle = s.coatDark;
      ctx.fillRect(x + s.dir, yy - 9, 1, 6);
      ctx.fillStyle = s.skin;                  // arms thrown up
      ctx.fillRect(x - 3, yy - 10, 1, 2);
      ctx.fillRect(x + 3, yy - 10, 1, 2);
      ctx.fillRect(x - 1, yy - 12, 3, 3);      // head
      ctx.fillStyle = dark;
      ctx.fillRect(x - 1, yy - 11, 1, 1);      // both eyes wide
      ctx.fillRect(x + 1, yy - 11, 1, 1);
      if (s.hardHat) {
        ctx.fillStyle = '#d9b53a';
        ctx.fillRect(x - 1, yy - 14, 3, 1);    // hat popping off
      } else {
        ctx.fillStyle = s.hair;
        ctx.fillRect(x - 1, yy - 13, 3, 1);
      }
      this._drawBubble(ctx, x, yy - 15, '!');
      return;
    }

    const kneel = (s.state === 'work' && s.workKind === 'wrench') ||
                  (s.state === 'grp' && s.grpPose === 'kneel');
    const walking = s.state === 'walk' || s.state === 'door' ||
                    (s.state === 'grp' && s.grpMoving);
    const frame = walking ? Math.floor(t * 7 + s.phase) % 2 : 0;
    let headY; // top row of head skin

    if (kneel) {
      ctx.fillStyle = s.trouser;               // folded legs
      ctx.fillRect(x - 2, y0 - 2, 5, 2);
      ctx.fillStyle = s.coat;                  // crouched body
      ctx.fillRect(x - 2, y0 - 7, 5, 5);
      ctx.fillStyle = s.coatDark;
      ctx.fillRect(x + s.dir, y0 - 7, 1, 5);
      headY = y0 - 10;
      ctx.fillStyle = s.coat;                  // reaching arm
      ctx.fillRect(x + (s.dir > 0 ? 3 : -4), y0 - 6, 2, 1);
      ctx.fillStyle = '#9aa2b2';               // wrench
      ctx.fillRect(x + (s.dir > 0 ? 5 : -6), y0 - 7, 2, 2);
      if (Math.random() < 0.45) {              // work sparks
        ctx.fillStyle = '#ffe066';
        const sx = x + (s.dir > 0 ? 6 : -6) + ((Math.random() * 3) | 0) - 1;
        ctx.fillRect(sx, y0 - 8 - ((Math.random() * 3) | 0), 1, 1);
      }
    } else {
      ctx.fillStyle = s.trouser;               // legs (2-frame walk)
      if (frame === 0) {
        ctx.fillRect(x - 2, y0 - 3, 2, 3);
        ctx.fillRect(x + 1, y0 - 3, 2, 3);
      } else {
        ctx.fillRect(x - 1, y0 - 3, 3, 3);
      }
      ctx.fillStyle = s.coat;                  // lab coat
      ctx.fillRect(x - 2, y0 - 9, 5, 6);
      ctx.fillStyle = s.coatDark;              // coat opening hint
      ctx.fillRect(x + s.dir, y0 - 9, 1, 6);
      headY = y0 - 12;
    }

    // head
    ctx.fillStyle = s.skin;
    ctx.fillRect(x - 1, headY, 3, 3);
    ctx.fillStyle = dark;
    ctx.fillRect(x + (s.dir > 0 ? 1 : -1), headY + 1, 1, 1); // eye
    if (s.hardHat) {
      ctx.fillStyle = '#d9b53a';
      ctx.fillRect(x - 1, headY - 1, 3, 1);
      ctx.fillRect(x - 2 + (s.dir > 0 ? 1 : 0), headY, 4, 1); // brim
    } else {
      ctx.fillStyle = s.hair;
      ctx.fillRect(x - 1, headY - 1, 3, 1);
    }

    // group-meeting extras: bubble, carried wrench, organizer's clipboard
    if (s.state === 'grp') {
      if (s.grpBubble) this._drawBubble(ctx, x, headY - 2, s.grpBubble);
      if (s.grpTool && !kneel) {                     // wrench in hand while marching
        ctx.fillStyle = '#9aa2b2';
        ctx.fillRect(x + (s.dir > 0 ? 3 : -4), y0 - 6, 2, 2);
        ctx.fillRect(x + (s.dir > 0 ? 4 : -5), y0 - 7, 1, 1);
      }
    }

    // standing-work props
    if ((s.state === 'work' && s.workKind === 'clipboard') ||
        (s.state === 'grp' && s.grpClip && !kneel && !s.grpMoving)) {
      ctx.fillStyle = s.skin;
      ctx.fillRect(x + 2 * s.dir, y0 - 7, 1, 1); // hand
      const cx = x + (s.dir > 0 ? 3 : -5);
      ctx.fillStyle = '#dfe2ec';
      ctx.fillRect(cx, y0 - 9, 3, 4);
      ctx.fillStyle = '#555a6e';
      ctx.fillRect(cx, y0 - 8, 2, 1);
      ctx.fillRect(cx, y0 - 6, 2, 1);
    } else if (s.state === 'work' && s.workKind === 'coffee') {
      const mx = x + (s.dir > 0 ? 3 : -4);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillRect(mx, y0 - 8, 2, 2);
      const sp = Math.floor(t * 3 + s.phase) % 3;   // steam
      ctx.fillStyle = 'rgba(220,224,235,0.55)';
      ctx.fillRect(mx + (sp % 2), y0 - 10 - sp, 1, 1);
    }

    // chat speech bubbles, alternating speakers
    if (s.state === 'chat') {
      const st = s.stateT;
      const show = s.chatRole === 0 ? (st >= 0.2 && st < 1.4) : (st >= 1.6 && st < 2.8);
      if (show) this._drawBubble(ctx, x, headY - 2, s.chatGlyph);
    }

    // dizzy circling stars
    if (s.state === 'dizzy') {
      ctx.fillStyle = '#ffe066';
      for (let i = 0; i < 3; i++) {
        const ang = t * 5 + i * 2.09;
        ctx.fillRect(x + Math.round(Math.cos(ang) * 4), headY - 2 + Math.round(Math.sin(ang) * 1.5), 1, 1);
      }
    }

    if (fade < 1) ctx.globalAlpha = 1;
  }

  _drawBubble(ctx, x, topY, kind) {
    const glyph = (px, py, rows) => {
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c < rows[r].length; c++)
          if (rows[r][c] === '1') ctx.fillRect(px + c, py + r, 1, 1);
    };
    const w = (kind === 'emc' || kind === 'MOO') ? 19 : (kind === 'boo' || kind === 'moo') ? 15 : 7;
    const h = 9;
    const bx = x - (w >> 1), by = topY - h - 2;
    ctx.fillStyle = '#20222e';
    ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = '#dde1ec';
    ctx.fillRect(bx, by, w, h);
    ctx.fillRect(x, by + h + 1, 1, 1);   // tail
    ctx.fillStyle = '#20222e';
    if (kind === '!') {
      glyph(bx + 3, by + 2, ['1', '1', '1', '0', '1']);
    } else if (kind === '?') {
      glyph(bx + 2, by + 2, ['111', '001', '010', '000', '010']);
    } else if (kind === 'boo') {
      glyph(bx + 1, by + 2, ['110', '101', '110', '101', '110']);   // B
      glyph(bx + 6, by + 2, ['111', '101', '101', '101', '111']);   // O
      glyph(bx + 11, by + 2, ['111', '101', '101', '101', '111']);  // O
    } else if (kind === 'moo') {
      glyph(bx + 1, by + 3, ['111', '111', '101']);                 // m
      glyph(bx + 6, by + 3, ['111', '101', '111']);                 // o
      glyph(bx + 11, by + 3, ['111', '101', '111']);                // o
    } else if (kind === 'MOO') {
      glyph(bx + 1, by + 2, ['10001', '11011', '10101', '10001', '10001']); // M
      glyph(bx + 8, by + 2, ['0110', '1001', '1001', '1001', '0110']);      // O
      glyph(bx + 14, by + 2, ['0110', '1001', '1001', '1001', '0110']);     // O
    } else { // E=mc²
      glyph(bx + 1, by + 2, ['111', '100', '111', '100', '111']);
      glyph(bx + 5, by + 2, ['000', '111', '000', '111', '000']);
      glyph(bx + 9, by + 2, ['000', '000', '111', '101', '101']);
      glyph(bx + 13, by + 2, ['00', '00', '11', '10', '11']);
      glyph(bx + 16, by + 2, ['11', '01', '11']);
    }
  }
}
