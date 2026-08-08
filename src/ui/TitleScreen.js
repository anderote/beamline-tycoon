// src/ui/TitleScreen.js — RollerCoaster Tycoon-style opening/title screen.
// Full-screen overlay with an animated pixel-art beamline scene rendered on a
// low-res canvas, a chunky 3D-extruded logo, and a beveled pixel-button menu.
// Mounted immediately on construction (covers asset loading); call
// ready({...}) once the game has booted, dismiss() to fade out and remove.

// Registers the <crt-effect> web component (self-contained, shadow-DOM styles).
import 'vault66-crt-effect/element';
import { applyCrtBarrel } from './crtBarrel.js';

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
    this.el = document.createElement('div');
    this.el.id = 'title-screen';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'title-bg';
    this.ctx = this.canvas.getContext('2d');
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
    this._onLoadingClick = () => {
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
    this.el.appendChild(this.loadingEl);

    // Menu container (populated in ready())
    this.menuEl = document.createElement('div');
    this.menuEl.className = 'title-menu hidden';
    this.el.appendChild(this.menuEl);

    // CRT effect (vault66-crt-effect) as a full-screen overlay — real curved
    // glass, vignette, glare, scanlines + flicker. Decorative only
    // (pointer-events: none) and scoped to the title/welcome screen.
    this.crtEl = document.createElement('crt-effect');
    const crtAttrs = {
      fill: '',
      'enable-curvature': '',
      'curvature-intensity': '1',
      // No vignette: the curvature already darkens the edges; stacking both
      // made the screen too dark.
      'enable-glare': '',
      'glare-intensity': '0.18',
      'enable-flicker': '',
      'flicker-intensity': 'medium',
      'scanline-thickness': '3',
      'scanline-gap': '3',
      'scanline-opacity': '0.18',
      theme: 'custom',
      'scanline-color': 'rgba(0,0,0,0.42)',
      'sweep-style': 'soft',
      'sweep-duration': '9',
    };
    for (const [k, v] of Object.entries(crtAttrs)) this.crtEl.setAttribute(k, v);
    this.crtEl.style.cssText = 'position:absolute;inset:0;z-index:40;pointer-events:none;';
    this.el.appendChild(this.crtEl);

    // Music mute toggle (bottom-right). Its own gesture must NOT trip the
    // click-to-continue gate, so it stops pointerdown from bubbling to el.
    this.muteEl = document.createElement('button');
    this.muteEl.className = 'title-mute';
    this.muteEl.type = 'button';
    this.muteEl.textContent = '🔊';
    this.muteEl.title = 'Mute / unmute music';
    this.muteEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.muteEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = window.__blMusic;
      if (m && m.audio) {
        m.audio.muted = !m.audio.muted;
        this.muteEl.textContent = m.audio.muted ? '🔇' : '🔊';
      }
    });
    this.el.appendChild(this.muteEl);

    document.body.appendChild(this.el);

    // Real geometric barrel bulge over the whole welcome screen (scene + logo +
    // menu warp together like a CRT tube face). Scoped to the title screen.
    applyCrtBarrel(this.el);

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
    this._spotBusy = [false, false];
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
    setTimeout(() => this.el.remove(), 450);
  }

  // ── Canvas scene ───────────────────────────────────────────────────

  _resize() {
    // Fixed low internal height; width follows the viewport aspect so the
    // pixels stay square when the canvas is stretched to fill the screen.
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.H = 320;
    this.W = Math.max(360, Math.min(1024, Math.round(this.H * aspect)));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
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
    // (escaped cows are drawn later by _drawCowEvent, in front of the fence)
    for (const c of this._cowsFG) if (!c.escaped) this._drawCowFG(ctx, c, t, pal);

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

    // ── Slapstick "cow escape": broken fence + escaped cows + guard, drawn
    //    in front of the fence line, on the campus lawn (above the machine pad) ──
    this._drawCowEvent(ctx, gateX, t, pal, W);

    // ── Contiguous machine pad: equipment row + beamline on one poured
    //    concrete area, with slab seams (no floating islands) ──
    const padTop = 196, padMid = 230, padBot = 302;
    ctx.fillStyle = pal.g1;
    ctx.fillRect(0, padTop, W, padMid - padTop);   // upper apron (equipment)
    ctx.fillStyle = pal.g2;
    ctx.fillRect(0, padMid, W, padBot - padMid);   // beamline slab
    ctx.fillStyle = pal.seam;
    ctx.fillRect(0, padTop, W, 1);
    ctx.fillRect(0, padMid, W, 1);
    ctx.fillRect(0, padBot - 1, W, 1);
    for (let x = (Math.floor(W / 2) % 48); x < W; x += 48) {
      ctx.fillRect(x, padTop, 1, padBot - padTop);
    }

    // ── Combined building: control room + attached cafe (shared wall) ──
    // Bases sit directly ON the machine pad's top edge — one continuous
    // ground surface shared with the equipment and beamline. No forecourt
    // block, no elevation bands.
    const bldGround = padTop - 4;              // building ground line (base = padTop)
    const bldX = Math.floor(W * 0.62);
    const bldW = 82 + 62;                      // control section + cafe wing

    const doors = [];
    doors.push(this._drawControlRoom(ctx, bldX, bldGround, t, pal));
    doors.push(this._drawCafeteria(ctx, bldX + 82, bldGround, t, pal));
    this._doors = doors;

    // ── Grounds props: flower pots, benches, a lamppost ──
    this._drawFlowerPot(ctx, doors[0] - 9, padTop, 0);
    this._drawFlowerPot(ctx, doors[0] + 10, padTop, 1);
    this._drawFlowerPot(ctx, doors[1] + 10, padTop, 2);
    this._drawBench(ctx, bldX + 24, 214);
    this._drawBench(ctx, bldX + 110, 214);
    this._drawLamppost(ctx, bldX - 18, 228, pal);
    this._drawLamppost(ctx, Math.floor(W * 0.22), 228, pal);

    // ── Beamline ──
    const comps = this._drawBeamline(ctx, t, W);

    // ── Scientists, mishaps, ghosts (foreground) ──
    this._fxFrame(ctx, now, t, comps, W);
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
                  verge, lab1, lab2, hall1, hall2, fence, distB, tuft) =>
        ({ skyHex: sky, hillB, hillF, oakB, oakF, g1, g2, seam, stars, light, win,
           verge, lab1, lab2, hall1, hall2, fence, distB, tuft });
      return {
        dawn:  mk(['#242044', '#6e4a5e', '#c98f5e'], '#877050', '#997e58', '#33402c', '#2c3826',
                  '#302c38', '#3a3542', '#282430', 0.15, 0.5, '#e8c25a',
                  '#3a462f', '#59515b', '#5e565f', '#575055', '#5b5459', '#7a5f48', '#4a4038', '#2c3625'),
        day:   mk(['#3a4a68', '#4d5e7e', '#5d7292'], '#98835c', '#b29a68', '#46523a', '#3c4a30',
                  '#3a3a46', '#44444f', '#333340', 0, 1, '#a8b6c8',
                  '#4e6b3a', '#84848d', '#8b8b94', '#82827e', '#898985', '#6a6055', '#6e6350', '#3c5630'),
        dusk:  mk(['#241a3a', '#623a58', '#b86844'], '#61523f', '#6f5c42', '#2c3626', '#26301f',
                  '#2e2a36', '#383341', '#262230', 0.3, 0.35, '#e8c25a',
                  '#31402a', '#4d4753', '#524c58', '#4c464c', '#504a50', '#6e5240', '#3e3630', '#253020'),
        night: mk(['#0a0a14', '#16162a', '#23243d'], '#12121f', '#0e0e19', '#0e0e18', '#0b0b13',
                  '#23232e', '#2b2b38', '#1e1e29', 1, 0, '#e8c25a',
                  '#0e130f', '#2f2f3a', '#33333e', '#31313d', '#343441', '#232332', '#0d0d17', '#090d0a'),
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
    };
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
    const x = Math.round(c.x), y = c.foot;
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
      x: -28, dir: 1, state: 'in', wait: 0, pt: 0, px: 0, spot: -1,
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
    const lotX = gateX + 12;              // small visitor lot just inside
    const roadEnd = lotX + 46;
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

    // small visitor lot off the road, just inside the gate
    const lotW = 44;
    ctx.fillStyle = asphalt;
    ctx.fillRect(lotX, 171, lotW, 20);
    ctx.fillStyle = shoulder;
    ctx.fillRect(lotX, 190, lotW, 1);
    ctx.fillRect(lotX + lotW - 1, 171, 1, 20);
    ctx.fillStyle = 'rgba(232,206,130,0.35)';          // painted stall lines
    ctx.fillRect(lotX + 1, 174, 1, 8);
    ctx.fillRect(lotX + 21, 174, 1, 8);
    ctx.fillRect(lotX + 41, 174, 1, 8);
    const spots = [{ x: lotX + 4 }, { x: lotX + 25 }];

    // ── car traffic state machine ──
    if (t >= this._nextCarT) {
      this._nextCarT = t + 15 + Math.random() * 15;
      if (this._cars.length < 3 && this._spotBusy.some((b) => !b)) {
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
          if (c.pt >= 1) { c.state = 'parked'; c.leaveAt = t + 25 + Math.random() * 35; }
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
    // guard is out on the lawn chasing escaped cows (see _drawCowEvent).
    const guardOut = this._cowEvent && this._cowEvent.guardOut;
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

  // ── Slapstick cow-escape event ─────────────────────────────────────
  // A couple of the herd cows push through the perimeter fence onto the
  // campus lawn; the security guard bolts out of his booth, gives chase,
  // trips and eats dirt, dusts himself off, throws up his hands, and
  // trudges back into the hut. The cows then amble home. State machine is
  // advanced purely by elapsed time in _updateCowEvent (no timers/rAF of
  // its own), and everything renders in _drawCowEvent.

  _startCowEvent(t, W) {
    const gateX = Math.floor(W * 0.28);
    const breakX = Math.max(26, gateX - 34);           // fence break, left of gate
    // borrow the two herd cows nearest the break point
    const pool = this._cowsFG.slice()
      .sort((a, b) => Math.abs(a.x - breakX) - Math.abs(b.x - breakX));
    const escapees = pool.slice(0, Math.min(2, pool.length));
    const cows = escapees.map((c, i) => {
      c.escaped = true;                                // pulled from the herd loop
      return {
        ref: c, homeX: c.x, homeFoot: c.foot,
        lawnX: breakX - 6 - i * 14,                    // spread out on the lawn
        lawnFoot: 178 + i * 5,                         // in front of the fence
      };
    });
    this._cowEvent = {
      phase: 'breakout', t0: t, gateX, breakX, cows,
      guardOut: false, mooed: false, bubble: null,
      guard: { x: gateX + 6, foot: 158, dir: -1, pose: 'idle', phase: Math.random() * 6 },
    };
    this._nextCowEventAt = t + 999;                    // rescheduled when it ends
  }

  _updateCowEvent(t, dt, W) {
    const ev = this._cowEvent;
    if (!ev) return;
    const g = ev.guard;
    const age = t - ev.t0;
    const DUR = { breakout: 2.4, chase: 2.8, trip: 0.7, down: 1.5, recover: 1.1, giveup: 1.3, return: 3.0 };
    const clamp01 = (p) => Math.max(0, Math.min(1, p));
    const lerp = (a, b, p) => a + (b - a) * clamp01(p);
    // move obj[key] toward target at sp px/s; returns true once arrived
    const approach = (obj, key, target, sp) => {
      const d = target - obj[key];
      if (Math.abs(d) <= sp * dt) { obj[key] = target; return true; }
      obj[key] += Math.sign(d) * sp * dt;
      return false;
    };

    switch (ev.phase) {
      case 'breakout': {
        // cows shuffle to the break, then shove through onto the lawn
        const p = age / DUR.breakout;
        ev.cows.forEach((cw, i) => {
          const c = cw.ref;
          c.state = 'amble';
          const tx = ev.breakX - 2 - i * 4;
          c.dir = tx < c.x ? -1 : 1;
          approach(c, 'x', tx, 16);
          const drop = clamp01((p - 0.5) / 0.5);       // foot drops in 2nd half
          c.foot = Math.round(lerp(cw.homeFoot, cw.lawnFoot, drop * drop));
        });
        if (age >= DUR.breakout) {
          ev.phase = 'chase'; ev.t0 = t; ev.guardOut = true;
          g.pose = 'run'; g.dir = -1;
        }
        break;
      }
      case 'chase': {
        approach(g, 'foot', 174, 40);                  // step down onto the lawn
        const cowMean = ev.cows.reduce((a, c) => a + c.ref.x, 0) / ev.cows.length;
        const targetX = cowMean + 13;                  // close in from the right
        g.dir = targetX < g.x ? -1 : 1;
        approach(g, 'x', targetX, 30);
        g.pose = 'run';
        ev.cows.forEach((cw) => {                       // cows scatter to their spots
          const c = cw.ref;
          c.state = 'amble';
          c.dir = cw.lawnX < c.x ? -1 : 1;
          approach(c, 'x', cw.lawnX, 12);
          c.foot = cw.lawnFoot;
        });
        const near = Math.abs(g.x - targetX) < 3;
        if (age >= DUR.chase || (near && age > 0.9)) {
          ev.phase = 'trip'; ev.t0 = t; g.pose = 'trip';
        }
        break;
      }
      case 'trip': {
        g.x += g.dir * 14 * dt * clamp01(1 - age / DUR.trip);  // momentum slide
        g.foot = 176;
        g.pose = 'trip';
        if (age >= DUR.trip) { ev.phase = 'down'; ev.t0 = t; g.pose = 'down'; }
        break;
      }
      case 'down': {
        g.pose = 'down';
        ev.cows.forEach((cw) => { cw.ref.state = 'graze'; });  // cows graze, smug
        if (age >= DUR.down) { ev.phase = 'recover'; ev.t0 = t; g.pose = 'getup'; }
        break;
      }
      case 'recover': {
        g.pose = 'getup';
        if (age >= DUR.recover) {
          ev.phase = 'giveup'; ev.t0 = t; g.pose = 'stand'; g.dir = 1; ev.bubble = '!';
        }
        break;
      }
      case 'giveup': {
        g.pose = 'stand'; g.dir = 1;
        if (!ev.mooed && age > 0.4) {                  // a triumphant moo
          ev.mooed = true;
          const c = ev.cows[0] && ev.cows[0].ref;
          if (c) { c.state = 'moo'; c.stateT = 0; }
        }
        if (age >= DUR.giveup) {
          ev.phase = 'return'; ev.t0 = t; g.pose = 'walk'; g.dir = 1; ev.bubble = null;
        }
        break;
      }
      case 'return': {
        const p = age / DUR.return;
        g.pose = 'walk';
        const homeX = ev.gateX + 6;
        g.dir = homeX > g.x ? 1 : -1;
        approach(g, 'x', homeX, 22);
        g.foot = Math.round(lerp(174, 158, (p - 0.6) / 0.4));  // step back into booth
        ev.cows.forEach((cw, i) => {                   // cows wander home too
          const c = cw.ref;
          c.state = 'amble';
          const tx = ev.breakX - 2 - i * 4;
          c.dir = tx < c.x ? -1 : 1;
          approach(c, 'x', tx, 12);
          c.foot = Math.round(lerp(cw.lawnFoot, cw.homeFoot, (p - 0.4) / 0.6));
        });
        if (age >= DUR.return) {
          ev.cows.forEach((cw) => {                     // hand cows back to the herd
            const c = cw.ref;
            c.escaped = false; c.foot = cw.homeFoot;
            c.state = 'idle'; c.stateT = 0; c.dur = 1.5; c.flipped = false;
          });
          this._cowEvent = null;
          this._nextCowEventAt = t + 40 + Math.random() * 30;  // ~40-70s cooldown
        }
        break;
      }
    }
  }

  _drawCowEvent(ctx, gateX, t, pal, W) {
    const ev = this._cowEvent;
    if (!ev) return;
    const fenceY = 158;
    // broken fence: repaint the trampled section with ranch grass, then a
    // couple of bent posts. Shown from breakout until the guard heads home.
    const showBreak = ev.phase !== 'return';
    if (showBreak) {
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
    // escaped cows reuse the herd renderer
    for (const cw of ev.cows) this._drawCowFG(ctx, cw.ref, t, pal);
    // the guard, out on the lawn
    if (ev.guardOut) {
      const g = ev.guard;
      const gx = Math.round(g.x), gf = Math.round(g.foot);
      this._drawGuard(ctx, gx, gf, g.dir, g.pose, t, g.phase);
      if (ev.bubble) this._drawBubble(ctx, gx, gf - 13, ev.bubble);
    }
  }

  // Security guard sprite (~12px), styled like the little scene people but in
  // a navy-capped blue uniform with a gold badge. pose: run | trip | down |
  // getup | stand | walk. dir +1 faces right.
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
    } else {                                           // hands-on-hips shrug (giveup)
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
      ctx.fillStyle = '#2e3040';                       // legs
      ctx.fillRect(x - 2, footY - 3, 2, 3);
      ctx.fillRect(x + 1, footY - 3, 2, 3);
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

  _drawControlRoom(ctx, bx, groundY, t, pal) {
    const bw = 82, bh = 48;
    const by = groundY - bh + 4;
    const wall = this._lerpHex('#20202f', '#383850', pal.light * 0.7);
    const roof = this._lerpHex('#2a2a3c', '#4a4a60', pal.light * 0.7);
    // shell
    ctx.fillStyle = wall;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = roof;
    ctx.fillRect(bx - 2, by, bw + 4, 3);
    ctx.fillStyle = '#171722';
    ctx.fillRect(bx + bw - 3, by + 3, 3, bh - 3);

    // ── cutaway interior (left 2/3) ──
    const ix = bx + 3, iy = by + 7, iw = bw - 26, ih = bh - 11;
    const floorY = iy + ih;                            // interior floor line
    ctx.fillStyle = '#141220';
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = '#241f2e';
    ctx.fillRect(ix, floorY - 2, iw, 2);
    ctx.fillStyle = 'rgba(232,194,90,0.05)';           // faint warm room glow
    ctx.fillRect(ix, iy, iw, ih);

    // wall-mounted monitors above the console row (LCLS-style upper screens)
    {
      const wy = iy + 2;
      // left wall screen: deep blue with a dim scrolling cyan trace
      ctx.fillStyle = '#0d0d16';
      ctx.fillRect(ix + 8, wy, 13, 7);
      ctx.fillStyle = '#101c38';
      ctx.fillRect(ix + 9, wy + 1, 11, 5);
      ctx.fillStyle = 'rgba(84,216,240,0.75)';
      for (let k = 0; k < 11; k++) {
        const py = Math.round(1.5 + 1.4 * Math.sin(t * 1.1 + k * 0.7));
        ctx.fillRect(ix + 9 + k, wy + 1 + Math.min(4, py), 1, 1);
      }
      // right wall screen: near-black with a row of status pixels
      ctx.fillStyle = '#0d0d16';
      ctx.fillRect(ix + 28, wy, 13, 7);
      ctx.fillStyle = '#121018';
      ctx.fillRect(ix + 29, wy + 1, 11, 5);
      for (let k = 0; k < 5; k++) {
        const h = (Math.imul(k + 3, 2654435761) ^ Math.imul(Math.floor(t * 0.6 + k * 0.5) + 1, 40503)) >>> 0;
        ctx.fillStyle = (h % 10) < 7 ? '#2f9e54' : (h % 10) < 9 ? '#d89a30' : '#c8393f';
        ctx.fillRect(ix + 30 + k * 2, wy + 3, 1, 1);
      }
      ctx.fillStyle = 'rgba(120,140,200,0.35)';        // dim header lines
      ctx.fillRect(ix + 29, wy + 1, 11, 1);
    }

    // consoles: desk + glowing screen + seated operator
    for (let i = 0; i < 3; i++) {
      const cx = ix + 4 + i * 18;
      ctx.fillStyle = '#2e2a3a';                       // desk
      ctx.fillRect(cx, floorY - 8, 12, 2);
      ctx.fillStyle = '#3a3648';                       // desk legs
      ctx.fillRect(cx + 1, floorY - 6, 1, 6);
      ctx.fillRect(cx + 10, floorY - 6, 1, 6);
      ctx.fillStyle = '#0d0d16';                       // screen bezel
      ctx.fillRect(cx + 1, floorY - 17, 10, 8);
      // each station shows a different EPICS-style display (8x6 px interior)
      const sx = cx + 2, sy = floorY - 16;
      if (i === 0) {
        // status grid: dense mosaic of tiny tiles, mostly green, some amber,
        // an occasional red that appears then clears (per-cell time reroll)
        ctx.fillStyle = '#0b0d12';                     // near-black bg
        ctx.fillRect(sx, sy, 8, 6);
        for (let gy = 0; gy < 6; gy++) {
          for (let gx = 0; gx < 8; gx++) {
            const cell = gy * 8 + gx;
            const step = Math.floor(t * 0.8 + cell * 0.41);
            const h = (Math.imul(cell + 13, 2654435761) ^ Math.imul(step + 7, 40503)) >>> 0;
            const r = h % 100;
            ctx.fillStyle = r < 68 ? '#2f9e54' : r < 84 ? '#d89a30'
              : r < 90 ? '#c8393f' : '#173a22';
            ctx.fillRect(sx + gx, sy + gy, 1, 1);
          }
        }
      } else if (i === 1) {
        // bar meters: vertical cyan/amber bars wiggling slowly
        ctx.fillStyle = '#0e1630';                     // deep blue bg
        ctx.fillRect(sx, sy, 8, 6);
        for (let b = 0; b < 4; b++) {
          const bh2 = Math.max(1, Math.min(6, Math.round(
            3.2 + 2.2 * Math.sin(t * (0.45 + b * 0.21) + b * 2.3))));
          ctx.fillStyle = b % 2 ? '#e0a838' : '#54d8f0';
          ctx.fillRect(sx + b * 2, sy + 6 - bh2, 1, bh2);
        }
      } else {
        // beamline schematic: pipe with element blips + stepping highlight
        ctx.fillStyle = '#221440';                     // dark purple bg
        ctx.fillRect(sx, sy, 8, 6);
        ctx.fillStyle = '#7a88c0';                     // beam pipe
        ctx.fillRect(sx, sy + 3, 8, 1);
        const blips = [[1, '#f04a50'], [3, '#54d8f0'], [5, '#f0b040'], [7, '#f04a50']];
        for (const [bxp, bc] of blips) {
          ctx.fillStyle = bc;
          ctx.fillRect(sx + bxp, sy + 2, 1, 1);
        }
        const hp = Math.floor(t * 2.2) % 10;           // status sweep along pipe
        if (hp < 8) {
          ctx.fillStyle = '#eef6ff';
          ctx.fillRect(sx + hp, sy + 3, 1, 1);
          ctx.fillStyle = 'rgba(180,220,255,0.35)';
          ctx.fillRect(sx + hp, sy + 4, 1, 1);
        }
      }
      // blinking status pixel on the bezel
      const on = Math.sin(t * 3.1 + i * 2.2) > 0.2;
      ctx.fillStyle = on ? '#54e08a' : '#8a3a44';
      ctx.fillRect(cx + 9, floorY - 10, 1, 1);
      // operator (swivels away from the screen once in a while)
      const swivel = Math.sin(t * 0.42 + i * 2.7) > 0.93 ? 1 : -1;
      this._drawTinyPerson(ctx, cx + 15, floorY, swivel, 'sit',
        ['#c6c8d4', '#b7bcca', '#c9c5b4'][i], ['#d8a878', '#b0784f', '#e8c9a2'][i],
        ['#3a2e28', '#6e6e78', '#8a5a2e'][i], t, { typing: swivel < 0, phase: i * 2.1 });
    }
    // standing supervisor with coffee, near the right of the room
    this._drawTinyPerson(ctx, ix + iw - 4, floorY, -1, 'stand',
      '#c6c8d4', '#d8a878', '#1e1e28', t, { mug: true, sip: true, phase: 1.3 });

    // ── solid right section: windows + door ──
    const wx = bx + bw - 21;
    for (let r = 0; r < 2; r++) {
      const wy = by + 8 + r * 12;
      ctx.fillStyle = pal.win;
      ctx.fillRect(wx, wy, 8, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(wx + 1, wy + 1, 3, 2);
    }
    const doorX = bx + bw - 14;
    ctx.fillStyle = '#14141e';
    ctx.fillRect(doorX - 3, by + bh - 15, 8, 15);
    ctx.fillStyle = '#e8c25a';
    ctx.fillRect(doorX + 3, by + bh - 9, 1, 1);        // doorknob

    // seat the building: thin ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx - 2, by + bh, bw + 4, 1);

    // antenna with blinking aviation light (brighter at night)
    ctx.fillStyle = '#3a3a4c';
    ctx.fillRect(bx + 10, by - 12, 2, 12);
    const blink = Math.sin(t * 2.2) > 0.55;
    ctx.fillStyle = blink ? '#ff4455' : '#571d22';
    ctx.fillRect(bx + 9, by - 15, 4, 3);
    if (blink) { ctx.fillStyle = 'rgba(255,68,85,0.25)'; ctx.fillRect(bx + 7, by - 17, 8, 7); }

    return doorX;                                       // ground-level door x
  }

  _drawCafeteria(ctx, bx, groundY, t, pal) {
    // Cafe wing attached to the control room: shares the wall at bx.
    const bw = 62, bh = 42;
    const by = groundY - bh + 4;
    const wall = this._lerpHex('#232030', '#3c3852', pal.light * 0.7);
    const roof = this._lerpHex('#2e2a3e', '#4e4a62', pal.light * 0.7);
    ctx.fillStyle = wall;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = roof;
    ctx.fillRect(bx - 1, by, bw + 3, 3);       // roof steps down from control room
    ctx.fillStyle = '#14141e';
    ctx.fillRect(bx - 1, by, 2, bh);           // shared wall with the control room
    ctx.fillStyle = '#191524';
    ctx.fillRect(bx + bw - 3, by + 3, 3, bh - 3);

    // CAFE sign over the wing
    const sgx = bx + 6, sgy = by - 8;
    ctx.fillStyle = '#141020';
    ctx.fillRect(sgx, sgy, 21, 8);
    ctx.fillStyle = '#e8a25a';
    const glyph = (px, py, rows) => {
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c < rows[r].length; c++)
          if (rows[r][c] === '1') ctx.fillRect(px + c, py + r, 1, 1);
    };
    glyph(sgx + 2, sgy + 2, ['111', '100', '111']);     // C
    glyph(sgx + 7, sgy + 2, ['111', '101', '111']);     // A (squat)
    glyph(sgx + 12, sgy + 2, ['111', '110', '100']);    // F
    glyph(sgx + 17, sgy + 2, ['111', '110', '111']);    // E

    // cutaway interior (left/centre; exterior door on the right wall)
    const ix = bx + 3, iy = by + 6, iw = bw - 18, ih = bh - 10;
    const floorY = iy + ih;
    ctx.fillStyle = '#171225';
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = '#282034';
    ctx.fillRect(ix, floorY - 2, iw, 2);
    ctx.fillStyle = 'rgba(232,178,90,0.07)';            // cozy glow
    ctx.fillRect(ix, iy, iw, ih);

    // coffee counter + machine against the shared wall
    ctx.fillStyle = '#3a3040';
    ctx.fillRect(ix, floorY - 9, 6, 9);
    ctx.fillStyle = '#4a3a30';
    ctx.fillRect(ix, floorY - 10, 7, 2);
    ctx.fillStyle = '#22222e';                          // coffee machine
    ctx.fillRect(ix + 1, floorY - 15, 5, 5);
    ctx.fillStyle = Math.sin(t * 2.5) > 0 ? '#ff4455' : '#571d22';
    ctx.fillRect(ix + 4, floorY - 14, 1, 1);

    // two tables with seated scientists + mugs
    const tables = [ix + 10, ix + 27];
    const seats = [
      { tx: 0, off: -6, dir: 1, coat: '#c6c8d4', skin: '#d8a878', hair: '#3a2e28' },
      { tx: 0, off: 7, dir: -1, coat: '#b7bcca', skin: '#e8c9a2', hair: '#8a5a2e' },
      { tx: 1, off: -6, dir: 1, coat: '#c9c5b4', skin: '#b0784f', hair: '#6e6e78' },
      { tx: 1, off: 7, dir: -1, coat: '#c6c8d4', skin: '#d8a878', hair: '#1e1e28' },
    ];
    for (const tx of tables) {
      ctx.fillStyle = '#4a3a30';                        // table top
      ctx.fillRect(tx, floorY - 8, 13, 2);
      ctx.fillStyle = '#33281f';
      ctx.fillRect(tx + 2, floorY - 6, 1, 6);
      ctx.fillRect(tx + 10, floorY - 6, 1, 6);
      ctx.fillStyle = '#e8e8f0';                        // mugs on the table
      ctx.fillRect(tx + 5, floorY - 10, 2, 2);
      const sp = Math.floor(t * 2.6 + tx) % 3;
      ctx.fillStyle = 'rgba(220,224,235,0.45)';
      ctx.fillRect(tx + 5 + (sp % 2), floorY - 12 - sp, 1, 1);
    }
    for (const s of seats) {
      const px = tables[s.tx] + 6 + s.off;
      this._drawTinyPerson(ctx, px, floorY, s.dir, 'sit', s.coat, s.skin, s.hair, t, { phase: px });
    }
    // occasional chat bubble from a seated scientist
    const talk = Math.sin(t * 0.35 + 0.9);
    if (talk > 0.86) {
      this._drawBubble(ctx, tables[0] + 12, floorY - 14, talk > 0.95 ? '?' : '!');
    }

    // exterior door at the right end + window above it
    const doorX = bx + bw - 9;
    ctx.fillStyle = '#14141e';
    ctx.fillRect(doorX - 4, by + bh - 14, 8, 14);
    ctx.fillStyle = '#e8c25a';
    ctx.fillRect(doorX - 3, by + bh - 8, 1, 1);
    ctx.fillStyle = pal.win;
    ctx.fillRect(bx + bw - 11, by + 8, 7, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(bx + bw - 10, by + 9, 3, 2);
    // seat the building: thin ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx - 2, by + bh, bw + 4, 1);

    return doorX;
  }

  _drawBeamline(ctx, t, W) {
    const pipeY = 254;           // beam axis: waist height above the pad
    const groundY = 272;         // component base line

    // ── Mid-ground support equipment: stands at the BACK of the pad, feet
    //    on the tone boundary between the dark apron and the lighter slab ──
    const eq = this._equipPositions(W);
    this._drawSupportEquip(ctx, eq.rackX, eq.dewarX, eq.pumpX, t);
    // utility lines from equipment to flanged ports on the beam pipe
    this._utilLine(ctx, eq.rackX + 5, 224, eq.mgx(0.30) - 26, pipeY - 4);
    this._utilLine(ctx, eq.dewarX + 3, 224, eq.mgx(0.47) + 9, pipeY - 4);
    this._utilLine(ctx, eq.pumpX + 6, 224, eq.mgx(0.60) - 8, pipeY - 4);

    // ── Source cabinet (left) ──
    const srcX = 14, srcW = 30, srcH = 40;
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

    const pipeStart = srcX + srcW;

    // ── Faraday cup / detector block (right end) ──
    const tgtW = 30, tgtH = 34;
    const tgtX = W - 14 - tgtW;
    ctx.fillStyle = '#33334a';
    ctx.fillRect(tgtX, groundY - tgtH, tgtW, tgtH);
    ctx.fillStyle = '#454560';
    ctx.fillRect(tgtX, groundY - tgtH, tgtW, 3);
    ctx.fillStyle = '#222236';
    ctx.fillRect(tgtX + tgtW - 3, groundY - tgtH, 3, tgtH);
    // entrance flange on the beam side
    ctx.fillStyle = '#5e5e78';
    ctx.fillRect(tgtX - 2, pipeY - 6, 3, 12);
    // copper collector core (side view)
    ctx.fillStyle = '#8a4f28';
    ctx.fillRect(tgtX + 4, pipeY - 5, 16, 10);
    ctx.fillStyle = '#c47a3e';
    ctx.fillRect(tgtX + 6, pipeY - 3, 12, 6);
    ctx.fillStyle = '#e09a58';
    ctx.fillRect(tgtX + 6, pipeY - 3, 12, 1);
    // signal cable out the back, down to a little readout box
    ctx.fillStyle = '#26263a';
    ctx.fillRect(tgtX + 20, pipeY - 1, 6, 2);
    ctx.fillRect(tgtX + 25, pipeY - 1, 2, groundY - pipeY - 6);
    ctx.fillStyle = '#31313f';
    ctx.fillRect(tgtX + 22, groundY - 8, 8, 8);
    const cupOn = Math.sin(t * 2.8 + 1.1) > 0;
    ctx.fillStyle = cupOn ? '#44ff77' : '#1d5230';
    ctx.fillRect(tgtX + 24, groundY - 6, 2, 2);

    const pipeEnd = tgtX - 2;

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

    // ── Components along the pipe (positions as fractions of span) ──
    const span = pipeEnd - pipeStart;
    const px = (f) => Math.floor(pipeStart + span * f);

    // Lattice matching the game's component vocabulary:
    // quad doublet → RF cavity stack → quad doublet → dipole → BPM → quad
    const q0 = px(0.10), q1 = q0 + 16;
    const rfX = px(0.30);
    const q2 = px(0.47), q3 = q2 + 16;
    const dipX = px(0.63);
    const bpmX = px(0.75);
    const q4 = px(0.87);

    this._drawQuad(ctx, q0, pipeY, groundY, t, 0);
    this._drawQuad(ctx, q1, pipeY, groundY, t, 1);
    this._drawRF(ctx, rfX, pipeY, groundY, t);
    this._drawQuad(ctx, q2, pipeY, groundY, t, 2);
    this._drawQuad(ctx, q3, pipeY, groundY, t, 3);
    this._drawDipole(ctx, dipX, pipeY, groundY, t);
    this._drawBPM(ctx, bpmX, pipeY, groundY, t);
    this._drawQuad(ctx, q4, pipeY, groundY, t, 4);

    // Component registry for the FX layer (mishaps, scientists' work spots)
    const comps = [
      { id: 'quad0', x: q0, y: pipeY },
      { id: 'quad1', x: q1, y: pipeY },
      { id: 'rf', x: rfX, y: pipeY },
      { id: 'quad2', x: q2, y: pipeY },
      { id: 'quad3', x: q3, y: pipeY },
      { id: 'dipole', x: dipX, y: pipeY },
      { id: 'bpm', x: bpmX, y: pipeY },
      { id: 'quad4', x: q4, y: pipeY },
    ];

    // Compact stands under components: short legs + foot plate
    for (const x of [q0, q1, rfX, q2, q3, dipX, bpmX, q4]) {
      ctx.fillStyle = '#2a2a38';
      ctx.fillRect(x - 4, groundY - 8, 2, 8);
      ctx.fillRect(x + 2, groundY - 8, 2, 8);
      ctx.fillStyle = '#333342';
      ctx.fillRect(x - 5, groundY - 1, 10, 2); // foot plate
    }

    // ── Beam pulse ──
    const period = 1.5;
    const phase = (t % period) / period;
    const travel = 0.82;                       // fraction of period spent traveling
    this._beamX = -999;
    if (phase < travel) {
      const bx = Math.floor(pipeStart + 2 + (span - 4) * (phase / travel));
      this._beamX = bx;
      // glow trail
      const trailCols = ['rgba(102,224,255,0.85)', 'rgba(102,224,255,0.55)', 'rgba(102,224,255,0.3)', 'rgba(102,224,255,0.14)'];
      for (let i = 0; i < trailCols.length; i++) {
        ctx.fillStyle = trailCols[i];
        ctx.fillRect(bx - 4 - i * 4, pipeY - 1, 4, 2);
      }
      // core
      ctx.fillStyle = '#aef4ff';
      ctx.fillRect(bx - 1, pipeY - 2, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx, pipeY - 1, 2, 2);
      // soft glow halo
      ctx.fillStyle = 'rgba(102,224,255,0.16)';
      ctx.fillRect(bx - 5, pipeY - 5, 12, 10);
      ctx.fillStyle = 'rgba(102,224,255,0.07)';
      ctx.fillRect(bx - 9, pipeY - 8, 20, 16);
    } else {
      // arrival flash on the target — and cash in the pulse
      const pulseIdx = Math.floor(t / period);
      if (this._cashPops && this._lastPopPulse !== pulseIdx) {
        this._lastPopPulse = pulseIdx;
        this._cashPops.push({
          x: tgtX + 10 + ((pulseIdx * 7) % 5) - 2,   // small per-pop drift
          y: pipeY - 10,
          t0: t,
        });
      }
      const f = (phase - travel) / (1 - travel);
      if (f < 0.6) {
        const a = 0.9 * (1 - f / 0.6);
        ctx.fillStyle = `rgba(190,244,255,${a.toFixed(2)})`;
        ctx.fillRect(tgtX + 6, pipeY - 8, 18, 16);
        ctx.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(2)})`;
        ctx.fillRect(tgtX + 10, pipeY - 4, 10, 8);
      }
    }

    return comps;
  }

  // Shared positions for support equipment + their concrete slabs
  _equipPositions(W) {
    const span0 = (W - 46) - 44;
    const mgx = (f) => Math.floor(44 + span0 * f);
    return { rackX: mgx(0.30) - 36, dewarX: mgx(0.44) + 30, pumpX: mgx(0.52) + 16, mgx };
  }

  // RF rack, cryo dewars, vacuum pump skid — quiet mid-ground depth.
  // Feet sit ON the dark-apron/light-slab tone boundary (one ground plane).
  _drawSupportEquip(ctx, rackX, dewarX, pumpX, t) {
    const base = 230;
    // RF equipment rack (feeds the cavity)
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

  // L-shaped 1px utility line with flange dots at both ends
  _utilLine(ctx, x1, y1, x2, y2) {
    ctx.fillStyle = '#4a4a5e';
    const midY = y1 + 6;
    ctx.fillRect(x1, y1, 1, midY - y1);                            // drop
    ctx.fillRect(Math.min(x1, x2), midY, Math.abs(x2 - x1) + 1, 1); // run
    ctx.fillRect(x2, midY, 1, y2 - midY);                          // rise/drop to port
    ctx.fillStyle = '#5e5e78';
    ctx.fillRect(x1 - 1, y1 - 1, 3, 2);            // equipment stub
    ctx.fillRect(x2 - 1, y2, 3, 2);                // beamline port flange
  }

  _drawQuad(ctx, x, pipeY, groundY, t, i) {
    const w = 14, h = 24;
    const qx = x - Math.floor(w / 2), qy = pipeY - Math.floor(h / 2);
    ctx.fillStyle = '#274b73';                  // dark yoke
    ctx.fillRect(qx, qy, w, h);
    ctx.fillStyle = '#3b6ea5';                  // lit face
    ctx.fillRect(qx + 1, qy + 1, w - 3, h - 3);
    ctx.fillStyle = '#5a92c9';                  // top highlight
    ctx.fillRect(qx + 1, qy + 1, w - 3, 2);
    // pipe gap through the middle
    ctx.fillStyle = '#1c3450';
    ctx.fillRect(qx, pipeY - 3, w, 6);
    // status LED, staggered phases
    const on = Math.sin(t * 3 + i * 1.9) > 0;
    ctx.fillStyle = on ? '#44ff77' : '#1d5230';
    ctx.fillRect(qx + w - 4, qy + 2, 2, 2);
  }

  _drawRF(ctx, x, pipeY, groundY, t) {
    // 4 copper cavity cells straddling the pipe
    const cellW = 10, cellH = 18, gap = 2;
    const total = 4 * cellW + 3 * gap;
    let cx = x - Math.floor(total / 2);
    for (let i = 0; i < 4; i++) {
      const cy = pipeY - Math.floor(cellH / 2);
      ctx.fillStyle = '#8a4f28';
      ctx.fillRect(cx, cy, cellW, cellH);
      ctx.fillStyle = '#c47a3e';
      ctx.fillRect(cx + 1, cy + 1, cellW - 2, cellH - 2);
      ctx.fillStyle = '#e09a58';
      ctx.fillRect(cx + 1, cy + 1, cellW - 2, 2);
      ctx.fillStyle = '#6e3d1e';
      ctx.fillRect(cx, pipeY + 1, cellW, 2);
      cx += cellW + gap;
    }
    // waveguide feed from above into the middle cell
    ctx.fillStyle = '#6a6a85';
    ctx.fillRect(x - 2, pipeY - Math.floor(cellH / 2) - 8, 4, 8);
    ctx.fillStyle = '#4c4c62';
    ctx.fillRect(x - 5, pipeY - Math.floor(cellH / 2) - 12, 10, 5);
    ctx.fillStyle = '#6a6a85';
    ctx.fillRect(x - 5, pipeY - Math.floor(cellH / 2) - 12, 10, 1);
    // red RF-on LED, slow blink
    const on = Math.sin(t * 1.6 + 0.8) > -0.2;
    ctx.fillStyle = on ? '#ff4455' : '#571d22';
    ctx.fillRect(x - Math.floor(total / 2) + 1, pipeY - Math.floor(cellH / 2) - 4, 2, 2);
  }

  _drawDipole(ctx, x, pipeY, groundY, t) {
    // C-magnet: back yoke + top/bottom pole bars, open on the beam-exit side
    const w = 26, h = 30;
    const dx = x - Math.floor(w / 2), dy = pipeY - Math.floor(h / 2) - 1;
    const bar = 9;
    ctx.fillStyle = '#3c3c52';
    ctx.fillRect(dx, dy, w, bar);              // top bar
    ctx.fillRect(dx, dy + h - bar, w, bar);    // bottom bar
    ctx.fillRect(dx, dy, 8, h);                // back yoke (C spine)
    ctx.fillStyle = '#50506c';
    ctx.fillRect(dx + 1, dy + 1, w - 2, bar - 2);
    ctx.fillRect(dx + 1, dy + h - bar + 1, w - 2, bar - 2);
    ctx.fillRect(dx + 1, dy + 1, 6, h - 2);
    ctx.fillStyle = '#68688a';
    ctx.fillRect(dx + 1, dy + 1, w - 2, 2);    // top highlight
    // copper coil windings hugging the pole gap
    ctx.fillStyle = '#8a4f28';
    ctx.fillRect(dx + 9, dy + bar - 2, w - 10, 2);
    ctx.fillRect(dx + 9, dy + h - bar, w - 10, 2);
    ctx.fillStyle = '#c47a3e';
    ctx.fillRect(dx + 9, dy + bar - 2, w - 10, 1);
    ctx.fillRect(dx + 9, dy + h - bar, w - 10, 1);
    // yellow hazard stripes on the bottom bar
    ctx.fillStyle = '#d9b53a';
    ctx.fillRect(dx + 1, dy + h - 4, w - 2, 3);
    ctx.fillStyle = '#8a742a';
    for (let sx = dx + 2; sx < dx + w - 2; sx += 4) ctx.fillRect(sx, dy + h - 4, 2, 3);
    // green status LED
    const on = Math.sin(t * 2.4 + 3.4) > 0.3;
    ctx.fillStyle = on ? '#44ff77' : '#1d5230';
    ctx.fillRect(dx + 2, dy + 2, 2, 2);
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

    // Slapstick "cow escape" event (cows break the fence, guard gives chase,
    // trips, gives up, trudges back to the booth). Purely time-driven off the
    // main draw loop, so dismiss()'s rAF cancel cleans it up — no extra timers.
    this._cowEvent = null;
    this._nextCowEventAt = 9 + Math.random() * 6;  // s until the first breakout

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
      debug: () => ({
        people: this._people.map((p) => p.state),
        ghostStaff: this._ghostStaff.map((g) => `${g.variant}:${g.state}`),
        meeting: this._meeting ? this._meeting.phase : null,
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
        let sx;
        if (q.door && this._doors && this._doors.length) {
          sx = this._doors[(Math.random() * this._doors.length) | 0];
        } else {
          sx = Math.random() < 0.5 ? -6 : W + 6;
        }
        const s = this._makeScientist(sx);
        s.state = 'walk';
        s.target = 30 + Math.random() * (W - 60);
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

    // foreground cow herd (escaped cows are driven by the cow-escape event)
    if (this._cowsFG) {
      for (const c of this._cowsFG) if (!c.escaped) this._updateCow(c, dt, t, W);
    }

    // slapstick cow-escape event: trigger periodically, then advance its phases
    if (!this._cowEvent && t >= this._nextCowEventAt) this._startCowEvent(t, W);
    if (this._cowEvent) this._updateCowEvent(t, dt, W);

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

    // "+$100" pops on every pulse arrival at the faraday cup
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

  // tiny "+$100" in pixel glyphs: dark outline + bright 'good' green.
  // 7-row grid so the $ stem can poke past the S top and bottom — that
  // overhang is what keeps it from reading as a "5" at this size.
  _drawCashPop(ctx, x, y) {
    const glyphs = [
      ['000', '000', '010', '111', '010', '000', '000'],   // +
      ['010', '111', '100', '111', '001', '111', '010'],   // $ (stem overhangs)
      ['000', '010', '110', '010', '010', '111', '000'],   // 1
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
      case 'walk': {
        const d = s.target - s.x;
        if (Math.abs(d) <= 1) {
          if (s.pendingWork && s.pendingWork.kind === 'enter') {
            return 'gone'; // stepped through a building door
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
    if (r < 0.12 && this._doors && this._doors.length) {
      // pop into the control room or cafeteria for a bit
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
      const preferred = comps.filter((c) => c.id === 'rf' || c.id === 'dipole');
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
    const y0 = s.foot;
    let x = Math.round(s.x);
    const dark = '#1a1a22';

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
    const walking = s.state === 'walk' || (s.state === 'grp' && s.grpMoving);
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
