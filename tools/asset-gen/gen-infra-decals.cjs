#!/usr/bin/env node
// Procedural pixel-art front-panel decals for infrastructure items.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-infra-decals.cjs
//
// Each decal maps to one full face of its box mesh (clamp-to-edge UVs).
// Shared style with gen-rf-decals.cjs — chunky 2px pixels, muted palette,
// deterministic seeded PRNG so re-runs reproduce identical output.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'decals');

// ── PRNG ──────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Drawing primitives (same shape as gen-rf-decals.cjs) ──────────────
function makePng(w, h) { return new PNG({ width: w, height: h, colorType: 6 }); }

function px(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (y * png.width + x) * 4;
  png.data[idx] = r & 0xff;
  png.data[idx + 1] = g & 0xff;
  png.data[idx + 2] = b & 0xff;
  png.data[idx + 3] = a;
}

function rect(png, x, y, w, h, c) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) px(png, x + dx, y + dy, c[0], c[1], c[2]);
}

function stroke(png, x, y, w, h, c) {
  for (let dx = 0; dx < w; dx++) { px(png, x + dx, y, c[0], c[1], c[2]); px(png, x + dx, y + h - 1, c[0], c[1], c[2]); }
  for (let dy = 0; dy < h; dy++) { px(png, x, y + dy, c[0], c[1], c[2]); px(png, x + w - 1, y + dy, c[0], c[1], c[2]); }
}

function disc(png, cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) px(png, cx + dx, cy + dy, c[0], c[1], c[2]);
}

function screw(png, cx, cy, bodyC, slotC) {
  disc(png, cx, cy, 2, bodyC);
  px(png, cx - 1, cy, slotC[0], slotC[1], slotC[2]);
  px(png, cx, cy, slotC[0], slotC[1], slotC[2]);
  px(png, cx + 1, cy, slotC[0], slotC[1], slotC[2]);
}

// Louvered vent panel
function venting(png, x, y, w, h, darkC, lightC, slatH = 2) {
  for (let yy = 0; yy < h; yy += slatH) {
    const c = (yy / slatH) % 2 === 0 ? darkC : lightC;
    rect(png, x, y + yy, w, Math.min(slatH, h - yy), c);
  }
}

// Filled rect with light top edge + dark bottom edge for shaded depth
function shadedRect(png, x, y, w, h, baseC) {
  rect(png, x, y, w, h, baseC);
  const top = [Math.min(255, baseC[0] + 30), Math.min(255, baseC[1] + 30), Math.min(255, baseC[2] + 30)];
  const bot = [Math.max(0, baseC[0] - 35), Math.max(0, baseC[1] - 35), Math.max(0, baseC[2] - 35)];
  for (let dx = 0; dx < w; dx++) px(png, x + dx, y, top[0], top[1], top[2]);
  for (let dx = 0; dx < w; dx++) px(png, x + dx, y + h - 1, bot[0], bot[1], bot[2]);
}

// Yellow-and-black hazard placard with a small symbol slot in the middle
function warningSticker(png, x, y, w, h) {
  rect(png, x, y, w, h, [220, 190, 60]);
  stroke(png, x, y, w, h, [25, 25, 28]);
  // Inner triangle hint (just a few black pixels at the center)
  const cx = x + (w >> 1);
  const cy = y + (h >> 1);
  px(png, cx, cy - 1, 25, 25, 28);
  px(png, cx - 1, cy, 25, 25, 28); px(png, cx, cy, 25, 25, 28); px(png, cx + 1, cy, 25, 25, 28);
}

// Nameplate: small dark rectangle with a faint cream label strip
function nameplate(png, x, y, w, h) {
  rect(png, x, y, w, h, [40, 42, 48]);
  stroke(png, x, y, w, h, [80, 84, 92]);
  rect(png, x + 1, y + 1, w - 2, h - 2, [180, 175, 155]);
}

// LED column: alternating green/amber lights down a strip
function ledColumn(png, x, y, h, count) {
  const step = Math.max(2, Math.floor(h / count));
  for (let i = 0; i < count; i++) {
    const c = (i % 2 === 0) ? [80, 230, 90] : [255, 180, 50];
    rect(png, x, y + i * step, 2, 2, c);
  }
}

// Round analog gauge: dark bezel, off-white face, single tick at angle deg
function gauge(png, cx, cy, r, angleDeg) {
  disc(png, cx, cy, r, [40, 42, 48]);
  disc(png, cx, cy, r - 1, [220, 215, 200]);
  const rad = angleDeg * Math.PI / 180;
  for (let t = 1; t <= r - 2; t++) {
    px(png, Math.round(cx + Math.cos(rad) * t), Math.round(cy + Math.sin(rad) * t), 200, 30, 30);
  }
  px(png, cx, cy, 30, 30, 36);
}

function save(png, name) {
  const buf = PNG.sync.write(png);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..', '..'), out));
}

// ── Palettes ──────────────────────────────────────────────────────────
const RED_BODY      = [180, 50, 50];
const RED_HIGHLIGHT = [220, 90, 90];
const BLUE_BODY     = [55, 95, 145];
const BLUE_HIGHLIGHT= [95, 135, 185];
const GREEN_BODY    = [70, 120, 70];
const GREEN_HIGHLIGHT = [110, 160, 110];
const YELLOW_BODY   = [200, 175, 60];
const GRAY_BODY     = [130, 132, 138];
const FROST_BODY    = [200, 215, 230];
const DARK_TRIM     = [40, 42, 48];
const SCREW_BODY    = [120, 124, 132];
const SCREW_SLOT    = [40, 42, 48];

// ── RF POWER ──────────────────────────────────────────────────────────
// All RF source decals are 48×64 (taller than wide) to match the 2×4
// visual aspect of klystrons and similar tube sources.

// Pulsed klystron front: tall red body with HV warning at top, nameplate
// in middle, vent at bottom, four corner screws.
function klystronPulsedFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  // Top highlight band
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // HV warning sticker top center
  warningSticker(png, 16, 4, 16, 10);
  // Nameplate middle
  nameplate(png, 8, 22, 32, 8);
  // Output coupler hint (small dark circle on the right side)
  disc(png, w - 6, 36, 3, DARK_TRIM);
  disc(png, w - 6, 36, 2, [80, 50, 30]);
  // Vent at bottom
  venting(png, 6, 48, 36, 10, DARK_TRIM, [70, 72, 78]);
  // Corner screws
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'klystron_pulsed_front.png');
}

// CW klystron — same body but with a cyan accent strip indicating CW
// operation, and no big vent (CW runs cooler than pulsed).
function klystronCwFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // Cyan CW indicator strip across the top under the highlight
  rect(png, 4, 4, w - 8, 3, [80, 200, 220]);
  warningSticker(png, 16, 10, 16, 9);
  nameplate(png, 8, 24, 32, 8);
  // Two stacked output couplers
  disc(png, w - 6, 36, 3, DARK_TRIM); disc(png, w - 6, 36, 2, [80, 50, 30]);
  disc(png, w - 6, 46, 3, DARK_TRIM); disc(png, w - 6, 46, 2, [80, 50, 30]);
  // Cooling fins along left edge instead of vent at bottom
  for (let yy = 22; yy < 58; yy += 4) rect(png, 4, yy, 4, 2, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'klystron_cw_front.png');
}

// Multi-beam klystron — premium variant with gold trim and three output ports.
function klystronMultibeamFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [150, 30, 30]); // deeper red
  rect(png, 0, 1, w, 1, [200, 70, 70]);
  // Gold trim band
  rect(png, 0, 12, w, 2, [220, 180, 60]);
  rect(png, 0, h - 14, w, 2, [220, 180, 60]);
  warningSticker(png, 16, 4, 16, 7);
  nameplate(png, 6, 18, 36, 8);
  // Three output ports across the middle
  disc(png, 12, 36, 3, DARK_TRIM); disc(png, 12, 36, 2, [80, 50, 30]);
  disc(png, 24, 36, 3, DARK_TRIM); disc(png, 24, 36, 2, [80, 50, 30]);
  disc(png, 36, 36, 3, DARK_TRIM); disc(png, 36, 36, 2, [80, 50, 30]);
  venting(png, 6, 46, 36, 8, DARK_TRIM, [70, 72, 78]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'klystron_multibeam_front.png');
}

// Modulator — HV cabinet with two analog meters at top and a big DANGER
// placard, vent at the bottom.
function modulatorFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // Two analog meters at the top
  gauge(png, 14, 12, 5, 220);
  gauge(png, 34, 12, 5, 290);
  // DANGER placard middle
  rect(png, 6, 24, 36, 10, RED_HIGHLIGHT);
  stroke(png, 6, 24, 36, 10, DARK_TRIM);
  // Three black bars suggesting "DANGER HIGH VOLTAGE" text
  rect(png, 10, 27, 28, 1, DARK_TRIM);
  rect(png, 10, 30, 28, 1, DARK_TRIM);
  // Vent at bottom
  venting(png, 6, 40, 36, 18, DARK_TRIM, [70, 72, 78]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'modulator_front.png');
}

// Solid-state amplifier rack — vertical stack of amp modules with LED columns.
function ssaRackFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // 6 stacked amp modules, each a dark slot with an LED column on the right
  for (let i = 0; i < 6; i++) {
    const my = 5 + i * 9;
    rect(png, 6, my, 36, 7, DARK_TRIM);
    stroke(png, 6, my, 36, 7, [70, 72, 80]);
    // Module label strip
    rect(png, 8, my + 2, 22, 3, [180, 175, 155]);
    // LED column on the right edge of the module
    ledColumn(png, 34, my + 1, 5, 2);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'ssa_rack_front.png');
}

// IOT / TWT / magnetron tube source — generic tube cabinet with a prominent
// circular tube window in the center and a small control strip.
function iotFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  warningSticker(png, 4, 4, 12, 8);
  nameplate(png, 18, 4, 26, 8);
  // Big tube window center
  disc(png, 24, 32, 12, DARK_TRIM);
  disc(png, 24, 32, 11, [60, 30, 20]);
  disc(png, 24, 32, 9, [180, 90, 40]);
  disc(png, 24, 32, 5, [240, 180, 80]);
  // Small control LEDs at bottom
  for (let i = 0; i < 4; i++) {
    const c = (i % 2 === 0) ? [80, 230, 90] : [255, 180, 50];
    rect(png, 8 + i * 8, 54, 3, 3, c);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'iot_front.png');
}

// ── COOLING ───────────────────────────────────────────────────────────

// Cold box — frost-blue panel with two temperature gauges and a piping
// schematic suggested by horizontal/vertical pipe segments.
function coldBoxFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, FROST_BODY);
  // Frost rim on top edge
  for (let xx = 0; xx < w; xx += 2) px(png, xx, 0, 240, 248, 255);
  // Two gauges top
  gauge(png, 16, 14, 6, 240);
  gauge(png, 48, 14, 6, 300);
  // Gauge labels
  rect(png, 8, 23, 16, 2, DARK_TRIM);
  rect(png, 40, 23, 16, 2, DARK_TRIM);
  // Piping schematic in lower half: U-shape with valve circles
  rect(png, 10, 36, 44, 2, [60, 80, 110]);
  rect(png, 10, 36, 2, 18, [60, 80, 110]);
  rect(png, 52, 36, 2, 18, [60, 80, 110]);
  rect(png, 10, 52, 44, 2, [60, 80, 110]);
  disc(png, 22, 37, 2, [180, 50, 50]);
  disc(png, 42, 37, 2, [180, 50, 50]);
  // Corner screws
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'cold_box_front.png');
}

// Helium compressor — large blue body with a control HMI screen, ventilation
// grille, warning placard.
function heCompressorFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, BLUE_BODY);
  rect(png, 0, 1, w, 1, BLUE_HIGHLIGHT);
  // HMI screen top
  rect(png, 8, 6, 32, 16, DARK_TRIM);
  rect(png, 9, 7, 30, 14, [40, 58, 32]);
  // Two horizontal "data lines" inside the screen
  rect(png, 11, 11, 20, 1, [180, 240, 140]);
  rect(png, 11, 15, 26, 1, [180, 240, 140]);
  rect(png, 11, 18, 16, 1, [255, 180, 50]);
  // Warning placard top right
  warningSticker(png, 44, 6, 14, 10);
  // Ventilation grille bottom
  venting(png, 6, 28, 52, 28, DARK_TRIM, [60, 80, 110]);
  // Corner screws
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'he_compressor_front.png');
}

// Chiller / LCW skid — blue control panel with LCD readout, two pressure
// gauges, two pipe stubs at the bottom.
function chillerFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, BLUE_BODY);
  rect(png, 0, 1, w, 1, BLUE_HIGHLIGHT);
  // LCD temp readout top center
  rect(png, 14, 6, 36, 12, DARK_TRIM);
  rect(png, 15, 7, 34, 10, [40, 58, 32]);
  // Three "digit" segments inside LCD
  rect(png, 19, 9, 7, 6, [180, 240, 140]);
  rect(png, 28, 9, 7, 6, [180, 240, 140]);
  rect(png, 37, 9, 7, 6, [180, 240, 140]);
  // Two pressure gauges below LCD
  gauge(png, 18, 32, 6, 200);
  gauge(png, 46, 32, 6, 250);
  // Pipe stubs at bottom (cooling water in/out)
  disc(png, 18, 56, 4, [120, 124, 130]);
  disc(png, 18, 56, 3, DARK_TRIM);
  disc(png, 46, 56, 4, [120, 124, 130]);
  disc(png, 46, 56, 3, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'chiller_front.png');
}

// ── VACUUM ────────────────────────────────────────────────────────────

// Bakeout controller — gray panel with three temperature dials and a
// power switch, plus heater cable connection ports.
function bakeoutFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  // Three temperature dials in a row
  gauge(png, 14, 14, 6, 200);
  gauge(png, 32, 14, 6, 260);
  gauge(png, 50, 14, 6, 320);
  // Dial labels
  rect(png, 8, 23, 12, 2, DARK_TRIM);
  rect(png, 26, 23, 12, 2, DARK_TRIM);
  rect(png, 44, 23, 12, 2, DARK_TRIM);
  // Power switch (red) middle
  rect(png, 28, 32, 8, 6, [180, 50, 50]);
  stroke(png, 28, 32, 8, 6, DARK_TRIM);
  // Heater cable connectors (4 sockets at bottom)
  for (let i = 0; i < 4; i++) {
    disc(png, 10 + i * 14, 52, 4, [120, 124, 130]);
    disc(png, 10 + i * 14, 52, 3, DARK_TRIM);
    disc(png, 10 + i * 14, 52, 1, [220, 215, 200]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'bakeout_front.png');
}

// ── CONTROLS ──────────────────────────────────────────────────────────

// 19" rack of blade servers — six dark 1U slots stacked, each with green
// and amber LEDs and a vent slit.
function rackIocFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [60, 64, 72]);
  // Top and bottom rack rails
  rect(png, 0, 0, w, 3, [90, 94, 102]);
  rect(png, 0, h - 3, w, 3, [90, 94, 102]);
  // 6 blade slots
  for (let i = 0; i < 6; i++) {
    const sy = 5 + i * 9;
    rect(png, 4, sy, w - 8, 7, [30, 32, 38]);
    stroke(png, 4, sy, w - 8, 7, [70, 72, 80]);
    // Vent slit
    rect(png, 6, sy + 3, 16, 1, [10, 12, 16]);
    // LED pair right side
    rect(png, w - 10, sy + 2, 2, 2, [80, 230, 90]);
    rect(png, w - 6, sy + 2, 2, 2, [255, 180, 50]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'rack_ioc_front.png');
}

// PPS — cream face with two red key switches and a big orange search button.
function ppsPanel() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [220, 215, 200]);
  // Two key switches near the top
  for (let i = 0; i < 2; i++) {
    const cx = 14 + i * 20;
    disc(png, cx, 14, 5, DARK_TRIM);
    disc(png, cx, 14, 4, [180, 50, 50]);
    rect(png, cx - 1, 11, 2, 4, [40, 42, 48]);
  }
  // Orange search button center
  disc(png, 24, 34, 8, DARK_TRIM);
  disc(png, 24, 34, 7, [240, 140, 30]);
  disc(png, 24, 34, 5, [255, 180, 60]);
  // Status indicator strip at the bottom (red/amber/green)
  rect(png, 6, 50, 12, 4, [240, 70, 70]);
  rect(png, 18, 50, 12, 4, [255, 180, 50]);
  rect(png, 30, 50, 12, 4, [80, 230, 90]);
  stroke(png, 6, 50, 36, 4, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'pps_panel.png');
}

// MPS — gray panel with a big red abort button and a column of green LEDs
// along the right edge.
function mpsPanel() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  // Big red abort button center-left
  disc(png, 18, 24, 10, DARK_TRIM);
  disc(png, 18, 24, 9, [180, 30, 30]);
  disc(png, 18, 24, 7, [240, 70, 70]);
  // Label strip below button
  rect(png, 6, 38, 24, 3, DARK_TRIM);
  // Column of green LEDs along the right edge
  for (let i = 0; i < 8; i++) {
    rect(png, 38, 8 + i * 6, 4, 4, [80, 230, 90]);
    stroke(png, 38, 8 + i * 6, 4, 4, DARK_TRIM);
  }
  // Bottom controls strip
  rect(png, 4, 50, 40, 8, [60, 64, 72]);
  for (let i = 0; i < 4; i++) rect(png, 6 + i * 10, 52, 6, 4, [110, 116, 126]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'mps_panel.png');
}

// ── POWER ─────────────────────────────────────────────────────────────

// Power distribution / substation — green door with a column of breakers
// and a yellow electrical hazard placard.
function powerPanelFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GREEN_BODY);
  rect(png, 0, 1, w, 1, GREEN_HIGHLIGHT);
  // Hazard placard top
  warningSticker(png, 8, 4, 32, 10);
  // Three rows × four columns of breakers
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const bx = 6 + col * 9;
      const by = 18 + row * 10;
      rect(png, bx, by, 7, 7, [40, 42, 48]);
      stroke(png, bx, by, 7, 7, [80, 84, 92]);
      // Toggle (alternating up/down)
      const up = ((row + col) % 2 === 0);
      rect(png, bx + 2, by + (up ? 1 : 4), 3, 2, up ? [80, 230, 90] : [240, 70, 70]);
    }
  }
  // Door handle right edge
  rect(png, w - 6, 30, 2, 8, [120, 124, 130]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'power_panel_front.png');
}

// ── Main ──────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
klystronPulsedFront();
klystronCwFront();
klystronMultibeamFront();
modulatorFront();
ssaRackFront();
iotFront();
coldBoxFront();
heCompressorFront();
chillerFront();
bakeoutFront();
rackIocFront();
ppsPanel();
mpsPanel();
powerPanelFront();
console.log('done.');
