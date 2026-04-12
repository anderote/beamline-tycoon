#!/usr/bin/env node
// Procedural pixel-art front-panel decals for RF lab instruments.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-rf-decals.cjs
//
// Each decal maps to the full +Z face of its box mesh (0→1 UVs). PNG
// aspect ratio should match visualSubW : visualSubH of the instrument.
// Rendering uses NearestFilter so every authored pixel stays crisp.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'decals');

// ── Deterministic PRNG (seeded per-instrument so re-runs are stable) ──
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePng(w, h) {
  return new PNG({ width: w, height: h, colorType: 6 });
}

function px(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (y * png.width + x) * 4;
  png.data[idx] = r & 0xff;
  png.data[idx + 1] = g & 0xff;
  png.data[idx + 2] = b & 0xff;
  png.data[idx + 3] = a;
}

function rect(png, x, y, w, h, c) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      px(png, x + dx, y + dy, c[0], c[1], c[2]);
}

function stroke(png, x, y, w, h, c) {
  for (let dx = 0; dx < w; dx++) { px(png, x + dx, y, ...c); px(png, x + dx, y + h - 1, ...c); }
  for (let dy = 0; dy < h; dy++) { px(png, x, y + dy, ...c); px(png, x + w - 1, y + dy, ...c); }
}

function disc(png, cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) px(png, cx + dx, cy + dy, c[0], c[1], c[2]);
}

function ring(png, cx, cy, r, c) {
  for (let a = 0; a < 360; a += 6) {
    const rad = a * Math.PI / 180;
    px(png, Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c[0], c[1], c[2]);
  }
}

// Knob with body, inner recess, and a tick indicator pointing at angle deg.
function knob(png, cx, cy, r, angleDeg, bodyC, innerC, tickC) {
  disc(png, cx, cy, r, bodyC);
  disc(png, cx, cy, r - 2, innerC);
  // Shadow line on one edge for a bit of "depth"
  for (let dy = -r; dy <= r; dy++) {
    const xEdge = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    px(png, cx + xEdge, cy + dy, Math.max(0, bodyC[0] - 40), Math.max(0, bodyC[1] - 40), Math.max(0, bodyC[2] - 40));
  }
  // Tick
  const rad = angleDeg * Math.PI / 180;
  for (let t = 1; t < r; t++) {
    px(png, Math.round(cx + Math.cos(rad) * t), Math.round(cy + Math.sin(rad) * t), tickC[0], tickC[1], tickC[2]);
  }
}

// Thin bezel frame around a screen area.
function screenFrame(png, sx, sy, sw, sh, outerC, innerC) {
  rect(png, sx - 2, sy - 2, sw + 4, sh + 4, outerC);
  rect(png, sx - 1, sy - 1, sw + 2, sh + 2, innerC);
}

// CRT-style grid over a fill.
function grid(png, sx, sy, sw, sh, bg, gridC, step) {
  rect(png, sx, sy, sw, sh, bg);
  for (let x = 0; x < sw; x += step) for (let y = 0; y < sh; y++) px(png, sx + x, sy + y, ...gridC);
  for (let y = 0; y < sh; y += step) for (let x = 0; x < sw; x++) px(png, sx + x, sy + y, ...gridC);
}

// Waveform (sine) drawn inside a screen.
function waveform(png, sx, sy, sw, sh, cycles, c, thick = 2) {
  const cy = sy + sh / 2;
  const amp = sh / 2 - 2;
  for (let x = 0; x < sw; x++) {
    const t = (x / sw) * Math.PI * 2 * cycles;
    const y = Math.round(cy + Math.sin(t) * amp);
    for (let k = 0; k < thick; k++) px(png, sx + x, y - k, ...c);
  }
}

// Spectrum bars.
function spectrum(png, sx, sy, sw, sh, c, rand) {
  const barW = 3;
  for (let x = 0; x < sw; x += barW + 1) {
    const r1 = rand();
    const r2 = rand();
    const h = Math.max(2, Math.floor(sh * (0.15 + 0.8 * (0.5 + 0.5 * Math.sin(x * 0.3) * Math.cos(x * 0.11)) * (0.6 + 0.4 * r1))));
    rect(png, sx + x, sy + sh - h, barW, h, c);
    // Peak hold marker
    if (r2 > 0.5) px(png, sx + x + 1, sy + sh - h - 2, 255, 255, 180);
  }
}

// Smith chart outline (for network analyzer).
function smithChart(png, sx, sy, sw, sh, c) {
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  const R = Math.min(sw, sh) / 2 - 2;
  ring(png, cx, cy, R, c);
  // Constant-resistance circles (right half loops)
  for (const f of [0.33, 0.5, 0.75]) {
    const r2 = Math.round(R * f);
    ring(png, cx + R - r2, cy, r2, c);
  }
  // Horizontal axis
  for (let x = -R; x <= R; x++) px(png, cx + x, cy, ...c);
  // Constant-reactance arcs (small ticks)
  for (const f of [0.5, 1.0]) {
    const rr = Math.round(R / f);
    // upper arc
    for (let a = 180; a < 360; a += 8) {
      const rad = a * Math.PI / 180;
      px(png, Math.round(cx + R + rr * Math.cos(rad)), Math.round(cy - rr + rr * Math.sin(rad)), ...c);
    }
  }
}

// 7-seg-ish digit block (just a chunky numeric display area with random digits).
function lcdStrip(png, x, y, w, h, bg, fg, rand) {
  rect(png, x, y, w, h, bg);
  // Fake segment dashes
  const nDigits = Math.floor(w / 6);
  for (let i = 0; i < nDigits; i++) {
    const dx = x + 1 + i * 6;
    // Top
    if (rand() > 0.2) rect(png, dx + 1, y + 1, 3, 1, fg);
    // Middle
    if (rand() > 0.2) rect(png, dx + 1, y + h / 2 | 0, 3, 1, fg);
    // Bottom
    if (rand() > 0.2) rect(png, dx + 1, y + h - 2, 3, 1, fg);
    // Left verticals
    if (rand() > 0.2) rect(png, dx, y + 2, 1, h / 2 - 2, fg);
    if (rand() > 0.2) rect(png, dx + 4, y + 2, 1, h / 2 - 2, fg);
    if (rand() > 0.2) rect(png, dx, y + h / 2, 1, h / 2 - 2, fg);
    if (rand() > 0.2) rect(png, dx + 4, y + h / 2, 1, h / 2 - 2, fg);
  }
}

function button(png, x, y, w, h, baseC, topC) {
  rect(png, x, y, w, h, baseC);
  rect(png, x, y, w, 1, topC);
  rect(png, x, y, 1, h, topC);
  // Bottom/right shade
  const sc = [Math.max(0, baseC[0] - 30), Math.max(0, baseC[1] - 30), Math.max(0, baseC[2] - 30)];
  rect(png, x, y + h - 1, w, 1, sc);
  rect(png, x + w - 1, y, 1, h, sc);
}

function save(png, name) {
  const buf = PNG.sync.write(png);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..', '..'), out));
}

// ── Palettes ───────────────────────────────────────────────────────────
const BODY_BEIGE = [198, 190, 168];   // classic lab instrument beige
const BODY_CREAM = [210, 196, 160];   // slightly warmer cream (NA)
const BODY_DARK = [58, 62, 70];       // dark chassis
const BODY_GRAY = [136, 140, 148];    // medium gray
const BEZEL = [22, 24, 28];
const SCREEN_BG = [10, 20, 14];
const SCREEN_FG = [100, 240, 120];
const SCREEN_AMBER = [240, 180, 60];
const KNOB_BODY = [50, 52, 58];
const KNOB_INNER = [30, 32, 36];
const KNOB_TICK = [230, 220, 180];
const BTN_BASE = [70, 74, 82];
const BTN_TOP = [110, 116, 126];
const LABEL = [220, 215, 200];
const LED_ON = [80, 230, 90];
const LED_AMBER = [255, 180, 50];
const LED_RED = [240, 70, 70];
const TRACE = [30, 34, 40];

// ── OSCILLOSCOPE ───────────────────────────────────────────────────────
// Wide screen left, 4 knobs + buttons on right. Aspect ≈ 1.56.
function oscilloscope() {
  const w = 96, h = 64;
  const png = makePng(w, h);
  const rand = mulberry32(101);

  rect(png, 0, 0, w, h, BODY_BEIGE);
  // Subtle top highlight / bottom shade for depth
  rect(png, 0, 0, w, 1, [220, 212, 190]);
  rect(png, 0, h - 1, w, 1, [150, 144, 126]);

  // Screen (left 2/3)
  const sx = 5, sy = 6, sw = 56, sh = 44;
  screenFrame(png, sx, sy, sw, sh, BEZEL, [38, 40, 44]);
  grid(png, sx, sy, sw, sh, SCREEN_BG, [26, 56, 30], 8);
  // Center cross
  for (let x = 0; x < sw; x++) px(png, sx + x, sy + sh / 2 | 0, 40, 70, 44);
  for (let y = 0; y < sh; y++) px(png, sx + sw / 2 | 0, sy + y, 40, 70, 44);
  waveform(png, sx, sy, sw, sh, 2.5, SCREEN_FG, 2);

  // Label strip above screen
  rect(png, sx - 2, 2, sw + 4, 3, [110, 104, 88]);

  // Knobs column (right of screen)
  const kxs = [72, 86];
  const kys = [12, 30];
  let angleSeed = 0;
  for (const ky of kys) for (const kx of kxs) {
    const ang = 30 + (angleSeed++ * 55) % 300;
    knob(png, kx, ky, 5, ang, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  }
  // Channel buttons row
  for (let i = 0; i < 4; i++) button(png, 66 + i * 6, 46, 5, 5, BTN_BASE, BTN_TOP);
  // Function buttons row
  for (let i = 0; i < 4; i++) button(png, 66 + i * 6, 54, 5, 5, BTN_BASE, BTN_TOP);
  // Power LED bottom-left
  rect(png, 4, 57, 3, 3, LED_ON);
  // Brand label strip below screen
  rect(png, sx, sy + sh + 2, sw, 3, [175, 168, 148]);

  save(png, 'oscilloscope_front.png');
}

// ── SIGNAL GENERATOR ───────────────────────────────────────────────────
// Narrow rack-style. Small LCD + frequency keypad + knobs. Aspect ≈ 2.55.
function signalGenerator() {
  const w = 128, h = 48;
  const png = makePng(w, h);
  const rand = mulberry32(202);

  rect(png, 0, 0, w, h, BODY_DARK);
  // Top rail
  rect(png, 0, 0, w, 2, [84, 88, 96]);
  rect(png, 0, h - 2, w, 2, [28, 30, 36]);

  // LCD (left)
  const sx = 5, sy = 6, sw = 52, sh = 14;
  screenFrame(png, sx, sy, sw, sh, BEZEL, [50, 55, 40]);
  rect(png, sx, sy, sw, sh, [40, 58, 32]);
  lcdStrip(png, sx + 1, sy + 2, sw - 2, sh - 4, [40, 58, 32], [180, 240, 140], rand);

  // Status LEDs under LCD
  rect(png, sx, sy + sh + 3, 3, 3, LED_ON);
  rect(png, sx + 6, sy + sh + 3, 3, 3, LED_AMBER);
  rect(png, sx + 12, sy + sh + 3, 3, 3, LED_RED);
  // Labels under LCD
  rect(png, sx + 18, sy + sh + 3, sw - 18, 3, [90, 94, 102]);

  // Knobs column (right)
  knob(png, 72, 13, 5, 45, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 86, 13, 5, 120, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 100, 13, 5, 200, KNOB_BODY, KNOB_INNER, KNOB_TICK);

  // Keypad (4 cols x 3 rows) far right
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++)
      button(png, 66 + col * 6, 28 + row * 6, 5, 5, BTN_BASE, BTN_TOP);

  // Extra encoder knob bottom-right
  knob(png, 116, 30, 7, 80, KNOB_BODY, KNOB_INNER, KNOB_TICK);

  // Labels row under knobs
  rect(png, 65, 25, 56, 1, [120, 124, 130]);
  // Brand strip bottom-left
  rect(png, 5, 38, 50, 3, [84, 88, 96]);

  save(png, 'signal_generator_front.png');
}

// ── SPECTRUM ANALYZER ──────────────────────────────────────────────────
// Big screen with bars, knobs on the right, keypad at bottom. Aspect ≈ 1.6.
function spectrumAnalyzer() {
  const w = 96, h = 64;
  const png = makePng(w, h);
  const rand = mulberry32(303);

  rect(png, 0, 0, w, h, BODY_GRAY);
  rect(png, 0, 0, w, 1, [170, 174, 182]);
  rect(png, 0, h - 1, w, 1, [92, 96, 104]);

  // Screen (big, occupies top-left area)
  const sx = 5, sy = 5, sw = 60, sh = 36;
  screenFrame(png, sx, sy, sw, sh, BEZEL, [40, 44, 50]);
  grid(png, sx, sy, sw, sh, SCREEN_BG, [26, 60, 30], 6);
  spectrum(png, sx + 2, sy + 2, sw - 4, sh - 4, SCREEN_FG, rand);
  // Top status bar inside screen
  rect(png, sx + 2, sy + 2, sw - 4, 3, [20, 40, 24]);
  // Frequency marker line
  for (let y = 0; y < sh; y++) px(png, sx + sw * 0.6 | 0, sy + y, 240, 240, 80);

  // Knob column (right of screen)
  knob(png, 74, 11, 5, 30, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 87, 11, 5, 140, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 74, 25, 5, 200, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 87, 25, 5, 80, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  // Big tuning knob
  knob(png, 81, 40, 7, 50, KNOB_BODY, KNOB_INNER, KNOB_TICK);

  // Button/keypad bottom
  for (let col = 0; col < 10; col++) button(png, 5 + col * 6, 45, 5, 5, BTN_BASE, BTN_TOP);
  for (let col = 0; col < 10; col++) button(png, 5 + col * 6, 53, 5, 5, BTN_BASE, BTN_TOP);

  // Power LED
  rect(png, 68, 45, 3, 3, LED_ON);
  rect(png, 73, 45, 3, 3, LED_AMBER);

  save(png, 'spectrum_analyzer_front.png');
}

// ── NETWORK ANALYZER ───────────────────────────────────────────────────
// Biggest: huge Smith-chart screen, extensive control panel. Aspect ≈ 1.38.
function networkAnalyzer() {
  const w = 128, h = 96;
  const png = makePng(w, h);
  const rand = mulberry32(404);

  rect(png, 0, 0, w, h, BODY_CREAM);
  // Top/bottom depth shading
  rect(png, 0, 0, w, 2, [232, 220, 190]);
  rect(png, 0, h - 2, w, 2, [158, 148, 118]);

  // Big screen (top, centered)
  const sx = 6, sy = 6, sw = 84, sh = 56;
  screenFrame(png, sx, sy, sw, sh, BEZEL, [40, 44, 50]);
  grid(png, sx, sy, sw, sh, SCREEN_BG, [26, 54, 30], 8);
  // Left half: Smith chart
  smithChart(png, sx + 2, sy + 2, sw / 2 - 4, sh - 4, SCREEN_FG);
  // Right half: magnitude trace (sine-like, looks like |S21|)
  const rsx = sx + sw / 2 + 2;
  const rsw = sw / 2 - 4;
  for (let x = 0; x < rsw; x++) {
    const t = x / rsw;
    const y = Math.round((sh - 6) * (0.3 + 0.6 * (1 - Math.abs(Math.sin(t * Math.PI * 2.1 - 0.7)))));
    px(png, rsx + x, sy + sh - 3 - y, ...SCREEN_AMBER);
    if (y > 0) px(png, rsx + x, sy + sh - 2 - y, ...SCREEN_AMBER);
  }
  // Marker crosshair
  rect(png, rsx + rsw / 2 | 0, sy + 4, 1, sh - 8, [240, 240, 100]);

  // Status strip at top of screen
  rect(png, sx + 2, sy + 2, sw - 4, 4, [20, 40, 24]);
  // Bottom legend strip
  rect(png, sx + 2, sy + sh - 6, sw - 4, 4, [20, 40, 24]);

  // Knob cluster right of screen
  knob(png, 100, 12, 5, 30, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 114, 12, 5, 140, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 100, 26, 5, 200, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 114, 26, 5, 80, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  // Giant encoder knob
  knob(png, 107, 48, 9, 60, KNOB_BODY, KNOB_INNER, KNOB_TICK);

  // Lower control panel
  // Left keypad (digit entry)
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++)
      button(png, 6 + col * 6, 68 + row * 7, 5, 6, BTN_BASE, BTN_TOP);
  // Middle row of function buttons
  for (let col = 0; col < 6; col++)
    button(png, 34 + col * 8, 68, 7, 6, BTN_BASE, BTN_TOP);
  for (let col = 0; col < 6; col++)
    button(png, 34 + col * 8, 76, 7, 6, BTN_BASE, BTN_TOP);
  // Soft-keys row
  for (let col = 0; col < 6; col++)
    button(png, 34 + col * 8, 84, 7, 6, BTN_BASE, BTN_TOP);

  // Right-side knobs again (smaller, for trace/format)
  knob(png, 100, 70, 4, 180, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 112, 70, 4, 100, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 100, 82, 4, 260, KNOB_BODY, KNOB_INNER, KNOB_TICK);
  knob(png, 112, 82, 4, 20, KNOB_BODY, KNOB_INNER, KNOB_TICK);

  // LED row
  rect(png, 6, 64, 3, 2, LED_ON);
  rect(png, 11, 64, 3, 2, LED_AMBER);
  rect(png, 16, 64, 3, 2, LED_RED);

  // Brand strip
  rect(png, 40, 92, 40, 2, [100, 96, 82]);

  save(png, 'network_analyzer_front.png');
}

// ── SIDE PANELS ────────────────────────────────────────────────────────
// Side decals are applied to -X / +X of each instrument. The face
// dimensions are (visualSubL × visualSubH) — depth × height — so PNG
// aspect should match that. Shared elements: vent slats, a carry
// handle near the top, a screw/rivet in each corner, and a warning/
// label sticker. Per-instrument body color + accent strips.

function venting(png, x, y, w, h, darkC, lightC, slatH = 2) {
  for (let i = 0; i < Math.floor(h / (slatH + 1)); i++) {
    const sy = y + i * (slatH + 1);
    rect(png, x, sy, w, slatH, darkC);
    rect(png, x, sy + slatH, w, 1, lightC);
  }
}

function carryHandle(png, cx, y, len, bracketH, bodyC, highlightC) {
  const x0 = cx - len / 2;
  // Brackets
  rect(png, x0, y, 2, bracketH, bodyC);
  rect(png, x0 + len - 2, y, 2, bracketH, bodyC);
  // Bar
  rect(png, x0, y, len, 2, bodyC);
  rect(png, x0, y, len, 1, highlightC);
}

function screw(png, cx, cy, bodyC, slotC) {
  disc(png, cx, cy, 1, bodyC);
  px(png, cx, cy, slotC[0], slotC[1], slotC[2]);
}

function plug(png, x, y, bodyC, holeC) {
  // IEC-style 3-pin inlet — rounded square with 3 pin slots
  rect(png, x - 4, y - 3, 9, 7, bodyC);
  rect(png, x - 4, y - 3, 9, 1, [Math.min(255, bodyC[0] + 30), Math.min(255, bodyC[1] + 30), Math.min(255, bodyC[2] + 30)]);
  rect(png, x - 4, y + 3, 9, 1, [Math.max(0, bodyC[0] - 30), Math.max(0, bodyC[1] - 30), Math.max(0, bodyC[2] - 30)]);
  rect(png, x - 3, y - 2, 7, 5, [10, 10, 14]);
  // 3 pins
  px(png, x - 2, y - 1, holeC[0], holeC[1], holeC[2]);
  px(png, x + 2, y - 1, holeC[0], holeC[1], holeC[2]);
  px(png, x, y + 1, holeC[0], holeC[1], holeC[2]);
}

function bncConnector(png, cx, cy, ringC, centerC) {
  disc(png, cx, cy, 3, [28, 28, 32]);
  disc(png, cx, cy, 2, ringC);
  disc(png, cx, cy, 1, [18, 18, 22]);
  px(png, cx, cy, centerC[0], centerC[1], centerC[2]);
}

function warningSticker(png, x, y, w, h) {
  rect(png, x, y, w, h, [230, 200, 40]);
  rect(png, x, y, w, 1, [255, 230, 80]);
  rect(png, x, y + h - 1, w, 1, [170, 140, 20]);
  // Black triangle
  for (let i = 0; i < h - 2; i++) {
    const wseg = Math.max(1, Math.floor(i / 2));
    rect(png, x + w / 2 - wseg | 0, y + 1 + i, wseg * 2 + 1, 1, [15, 15, 15]);
  }
}

function brandStrip(png, x, y, w, darkC, bright) {
  rect(png, x, y, w, 3, darkC);
  rect(png, x + 2, y + 1, 3, 1, bright);
  rect(png, x + 6, y + 1, 2, 1, bright);
  rect(png, x + 9, y + 1, 4, 1, bright);
}

// Generic side panel generator. bodyC is the casing color.
// accent selects which extras to draw.
function sidePanel(png, bodyC, topC, botC, opts) {
  const w = png.width, h = png.height;
  rect(png, 0, 0, w, h, bodyC);
  rect(png, 0, 0, w, 1, topC);
  rect(png, 0, h - 1, w, 1, botC);

  // Four corner screws
  screw(png, 2, 2, [60, 60, 66], [20, 20, 24]);
  screw(png, w - 3, 2, [60, 60, 66], [20, 20, 24]);
  screw(png, 2, h - 3, [60, 60, 66], [20, 20, 24]);
  screw(png, w - 3, h - 3, [60, 60, 66], [20, 20, 24]);

  // Carry handle near top center
  if (opts.handle) {
    const hlen = Math.min(w - 12, Math.max(14, w * 0.55) | 0);
    carryHandle(png, w / 2 | 0, 3, hlen, 4, [40, 42, 48], [90, 94, 102]);
  }

  // Vents — central vertical block of horizontal slats
  if (opts.vents) {
    const vw = Math.max(6, Math.floor(w * 0.35));
    const vh = Math.max(6, Math.floor(h * 0.45));
    const vx = (w - vw) / 2 | 0;
    const vy = (h - vh) / 2 | 0 + 1;
    venting(png, vx, vy, vw, vh, [22, 24, 28], [80, 84, 92], 2);
    // Vent frame
    stroke(png, vx - 1, vy - 1, vw + 2, vh + 2, [30, 32, 38]);
  }

  // Connectors column on left — BNC bulkhead inputs
  if (opts.bnc) {
    const bnStartY = opts.handle ? 14 : 6;
    for (let i = 0; i < opts.bnc; i++) {
      bncConnector(png, 6, bnStartY + i * 9, [200, 170, 70], [50, 40, 20]);
      // Label dot next to each
      px(png, 11, bnStartY + i * 9, 240, 230, 200);
    }
  }

  // Power inlet at bottom-right
  if (opts.plug) {
    plug(png, w - 8, h - 8, [50, 52, 58], [210, 210, 80]);
  }

  // Rack ears (cropped rectangles at top/bottom edges near front)
  if (opts.rackEars) {
    rect(png, 0, 0, 3, h, [84, 88, 96]);
    rect(png, 0, 0, 3, 2, [110, 116, 126]);
    rect(png, 0, h - 2, 3, 2, [40, 42, 48]);
    screw(png, 1, h / 4 | 0, [60, 60, 66], [20, 20, 24]);
    screw(png, 1, (h * 3 / 4) | 0, [60, 60, 66], [20, 20, 24]);
  }

  // Warning sticker
  if (opts.warning) {
    warningSticker(png, w - 10, h - 12, 7, 7);
  }

  // Brand strip
  if (opts.brand) {
    brandStrip(png, 3, h - 6, Math.min(16, w - 6), [40, 42, 48], [200, 200, 200]);
  }
}

// Per-instrument casings:
//  - oscilloscope     : beige body with carry handle + vents + BNC inputs
//  - signalGenerator  : dark charcoal with rack ears + big vent grille
//  - spectrumAnalyzer : medium gray with handle + vents + warning sticker
//  - networkAnalyzer  : cream beige with dual handles + big vents + plug
function oscilloscopeSide() {
  // Depth 0.8, height 1.0 → aspect 0.8. PNG 40×56 (scaled up to 48×64).
  const w = 48, h = 64;
  const png = makePng(w, h);
  sidePanel(png, [198, 190, 168], [224, 215, 192], [148, 142, 124], {
    handle: true, vents: true, bnc: 3, plug: true, warning: true, brand: true,
  });
  save(png, 'oscilloscope_side.png');
}

function signalGeneratorSide() {
  // Depth 0.9, height 0.6 → aspect 1.5. PNG 48×32.
  const w = 48, h = 32;
  const png = makePng(w, h);
  sidePanel(png, [58, 62, 70], [88, 92, 100], [28, 30, 36], {
    rackEars: true, vents: true, plug: true, brand: true,
  });
  save(png, 'signal_generator_side.png');
}

function spectrumAnalyzerSide() {
  // Depth 1.0, height 1.2 → aspect ~0.83. PNG 40×48.
  const w = 40, h = 48;
  const png = makePng(w, h);
  sidePanel(png, [136, 140, 148], [172, 176, 184], [92, 96, 104], {
    handle: true, vents: true, bnc: 2, plug: true, warning: true, brand: true,
  });
  save(png, 'spectrum_analyzer_side.png');
}

function networkAnalyzerSide() {
  // Depth 1.2, height 1.5 → aspect 0.8. PNG 48×60.
  const w = 48, h = 60;
  const png = makePng(w, h);
  sidePanel(png, [210, 196, 160], [232, 220, 190], [158, 148, 118], {
    handle: true, vents: true, bnc: 4, plug: true, warning: true, brand: true,
  });
  save(png, 'network_analyzer_side.png');
}

// ── Main ───────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
oscilloscope();
signalGenerator();
spectrumAnalyzer();
networkAnalyzer();
oscilloscopeSide();
signalGeneratorSide();
spectrumAnalyzerSide();
networkAnalyzerSide();
console.log('done');
