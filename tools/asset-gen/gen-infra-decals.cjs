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

  // ── Top section: HV warning + digital display ──
  warningSticker(png, 3, 3, 12, 8);
  // Digital readout panel (kV display)
  rect(png, 18, 3, 26, 8, [20, 22, 28]);
  stroke(png, 18, 3, 26, 8, [60, 64, 72]);
  // Green 7-seg style digits "045.0"
  const digC = [60, 220, 80];
  rect(png, 20, 5, 2, 4, digC);
  rect(png, 24, 5, 2, 4, digC);
  rect(png, 28, 5, 2, 4, digC);
  px(png, 31, 8, digC[0], digC[1], digC[2]);
  rect(png, 33, 5, 2, 4, digC);
  // "kV" label
  rect(png, 38, 6, 1, 3, [140, 140, 150]);
  rect(png, 40, 6, 1, 3, [140, 140, 150]);

  // ── PFN capacitor bank behind mesh (mid section) ──
  const capY = 13, capH = 20;
  rect(png, 3, capY, 42, capH, [50, 52, 58]);
  stroke(png, 3, capY, 42, capH, DARK_TRIM);
  // Capacitor cylinders (4 columns × 2 rows)
  const capC = [100, 90, 60];
  const capHi = [130, 120, 80];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const cx = 8 + col * 10, cy = capY + 5 + row * 10;
      disc(png, cx, cy, 3, capC);
      disc(png, cx, cy, 2, capHi);
      px(png, cx, cy, capC[0], capC[1], capC[2]);
    }
  }
  // Mesh overlay lines (horizontal)
  for (let my = capY + 1; my < capY + capH; my += 2) {
    for (let mx = 4; mx < 44; mx += 2) {
      px(png, mx, my, 35, 37, 42, 120);
    }
  }

  // ── Control panel strip ──
  const ctrlY = 35;
  rect(png, 3, ctrlY, 42, 8, [60, 62, 68]);
  stroke(png, 3, ctrlY, 42, 8, DARK_TRIM);
  // Interlock key switch
  disc(png, 9, ctrlY + 4, 2, [160, 155, 140]);
  px(png, 9, ctrlY + 3, 80, 80, 85);
  px(png, 9, ctrlY + 2, 80, 80, 85);
  // Status LEDs: HV ON (green), FAULT (red), READY (amber), INTERLOCK (red)
  rect(png, 16, ctrlY + 2, 2, 2, [80, 230, 90]);
  rect(png, 21, ctrlY + 2, 2, 2, [230, 60, 50]);
  rect(png, 26, ctrlY + 2, 2, 2, [255, 180, 50]);
  rect(png, 31, ctrlY + 2, 2, 2, [230, 60, 50]);
  // Pushbuttons (ON / OFF)
  disc(png, 38, ctrlY + 3, 2, [60, 180, 70]);
  disc(png, 43, ctrlY + 3, 2, [200, 55, 50]);

  // ── HV output section at bottom ──
  const hvY = 45;
  // HV cable connector (large circular)
  rect(png, 3, hvY, 20, 14, [45, 47, 52]);
  stroke(png, 3, hvY, 20, 14, DARK_TRIM);
  disc(png, 13, hvY + 7, 5, [70, 65, 55]);
  disc(png, 13, hvY + 7, 3, [40, 38, 35]);
  disc(png, 13, hvY + 7, 1, [180, 170, 140]);
  // DANGER HIGH VOLTAGE placard
  rect(png, 25, hvY, 20, 7, [220, 190, 60]);
  stroke(png, 25, hvY, 20, 7, [25, 25, 28]);
  rect(png, 28, hvY + 2, 14, 1, [25, 25, 28]);
  rect(png, 28, hvY + 4, 14, 1, [25, 25, 28]);
  // Vent slats below placard
  venting(png, 25, hvY + 9, 20, 5, DARK_TRIM, [70, 72, 78]);

  // Corner screws
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

// ── DATA / CONTROLS — Distribution ───────────────────────────────

// Patch panel — fiber junction box with rows of colored fiber ports
// and cable management loops. Gray body, passive device.
function patchPanelFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  // Label strip at top
  nameplate(png, 8, 4, 32, 6);
  // Four rows of fiber ports (colored dots)
  const portColors = [
    [80, 180, 255],   // blue SC
    [80, 230, 90],    // green LC
    [255, 180, 50],   // amber OM3
    [240, 70, 70],    // red SM
  ];
  for (let row = 0; row < 4; row++) {
    const ry = 14 + row * 11;
    rect(png, 4, ry, w - 8, 9, [50, 52, 58]);
    stroke(png, 4, ry, w - 8, 9, [80, 84, 92]);
    for (let col = 0; col < 8; col++) {
      const cx = 7 + col * 5;
      disc(png, cx, ry + 4, 1, portColors[row]);
    }
  }
  // Cable management loops at bottom
  for (let i = 0; i < 3; i++) {
    const cx = 12 + i * 12;
    stroke(png, cx - 3, 58, 6, 4, [100, 104, 112]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'patch_panel_front.png');
}

// Network switch — managed Ethernet switch with rows of RJ45 ports
// and link/activity LEDs. Dark gray 1U-style body.
function networkSwitchFront() {
  const w = 48, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [50, 52, 58]);
  // Top row: 12 RJ45 ports
  for (let col = 0; col < 12; col++) {
    const px0 = 3 + col * 3 + (col >= 6 ? 2 : 0);
    rect(png, px0, 4, 2, 4, [30, 32, 38]);
    stroke(png, px0, 4, 2, 4, [70, 72, 80]);
  }
  // Link LEDs under each port
  for (let col = 0; col < 12; col++) {
    const px0 = 3 + col * 3 + (col >= 6 ? 2 : 0);
    const c = (col % 3 === 0) ? [255, 180, 50] : [80, 230, 90];
    rect(png, px0, 10, 2, 1, c);
  }
  // Bottom row: 12 more ports
  for (let col = 0; col < 12; col++) {
    const px0 = 3 + col * 3 + (col >= 6 ? 2 : 0);
    rect(png, px0, 14, 2, 4, [30, 32, 38]);
    stroke(png, px0, 14, 2, 4, [70, 72, 80]);
  }
  // Status LED strip at bottom
  rect(png, 4, 22, 2, 2, [80, 230, 90]);
  rect(png, 8, 22, 2, 2, [80, 230, 90]);
  rect(png, 12, 22, 2, 2, [255, 180, 50]);
  // Nameplate right side
  nameplate(png, 24, 22, 20, 5);
  // Management port (console)
  rect(png, 42, 4, 3, 4, [80, 180, 255]);
  stroke(png, 42, 4, 3, 4, DARK_TRIM);
  screw(png, 1, 1, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 2, 1, SCREW_BODY, SCREW_SLOT);
  screw(png, 1, h - 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 2, h - 2, SCREW_BODY, SCREW_SLOT);
  save(png, 'network_switch_front.png');
}

// ── DATA / CONTROLS — Controls (additional) ──────────────────────

// BLM readout — small electronics crate with signal bar-graph display
// and channel indicator LEDs. Reads beam-loss ionization chambers.
function blmReadoutFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  // Nameplate at top
  nameplate(png, 8, 4, 32, 6);
  // Bar-graph display area (dark inset)
  rect(png, 4, 14, 40, 24, [30, 32, 38]);
  stroke(png, 4, 14, 40, 24, [70, 72, 80]);
  // 8 vertical bar-graph channels at varying heights
  const barH = [16, 8, 20, 4, 12, 6, 18, 10];
  for (let i = 0; i < 8; i++) {
    const bx = 7 + i * 5;
    const bh = barH[i];
    const c = bh > 14 ? [240, 70, 70] : bh > 10 ? [255, 180, 50] : [80, 230, 90];
    rect(png, bx, 34 - bh, 3, bh, c);
  }
  // Channel status LEDs below display
  for (let i = 0; i < 8; i++) {
    rect(png, 7 + i * 5, 42, 3, 2, [80, 230, 90]);
  }
  // Warning sticker
  warningSticker(png, 4, 50, 14, 8);
  // Threshold trim pots at bottom right
  for (let i = 0; i < 3; i++) {
    disc(png, 30 + i * 6, 54, 2, [60, 64, 72]);
    px(png, 30 + i * 6, 54, DARK_TRIM[0], DARK_TRIM[1], DARK_TRIM[2]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'blm_readout_front.png');
}

// BPM electronics — digitizer crate with ADC channel indicators
// and signal strength bars. Reads beam position monitors.
function bpmElectronicsFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [60, 64, 72]);
  // Top and bottom rack rails
  rect(png, 0, 0, w, 3, [90, 94, 102]);
  rect(png, 0, h - 3, w, 3, [90, 94, 102]);
  // 4 ADC channel modules stacked
  for (let i = 0; i < 4; i++) {
    const sy = 5 + i * 14;
    rect(png, 4, sy, w - 8, 12, [35, 38, 44]);
    stroke(png, 4, sy, w - 8, 12, [70, 72, 80]);
    // Channel label
    rect(png, 6, sy + 2, 14, 3, [180, 175, 155]);
    // Signal strength indicator (horizontal bar)
    const barW = 10 + (i * 4);
    rect(png, 6, sy + 7, barW, 2, [80, 200, 255]);
    // Status LED
    rect(png, w - 10, sy + 4, 2, 2, [80, 230, 90]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'bpm_electronics_front.png');
}

// Archiver / data logger — server with disk activity LEDs, HMI screen
// showing a trend plot, and network port.
function archiverFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [50, 52, 58]);
  // Top rack rail
  rect(png, 0, 0, w, 3, [90, 94, 102]);
  // Small HMI screen at top
  rect(png, 6, 5, 36, 20, DARK_TRIM);
  rect(png, 7, 6, 34, 18, [30, 50, 30]);
  // Trend plot lines inside screen
  for (let x = 0; x < 30; x++) {
    const y1 = 10 + Math.floor(Math.sin(x * 0.5) * 4 + 4);
    const y2 = 10 + Math.floor(Math.cos(x * 0.3) * 3 + 6);
    px(png, 9 + x, y1, 80, 230, 90);
    px(png, 9 + x, y2, 80, 180, 255);
  }
  // Four disk drive bays
  for (let i = 0; i < 4; i++) {
    const dy = 28 + i * 8;
    rect(png, 4, dy, w - 8, 6, [35, 38, 44]);
    stroke(png, 4, dy, w - 8, 6, [70, 72, 80]);
    // Drive handle
    rect(png, 6, dy + 1, 28, 4, [60, 64, 72]);
    // Activity LED
    const c = (i === 1) ? [80, 230, 90] : [40, 42, 48];
    rect(png, w - 10, dy + 2, 2, 2, c);
  }
  // Bottom rack rail
  rect(png, 0, h - 3, w, 3, [90, 94, 102]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'archiver_front.png');
}

// ── DATA / CONTROLS — Safety (additional) ────────────────────────

// Search & secure panel — wall-mounted button station with illuminated
// push buttons used during the radiation area sweep procedure.
function searchSecurePanel() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [220, 215, 200]);
  // Title placard at top
  rect(png, 8, 4, 32, 8, [200, 60, 60]);
  stroke(png, 8, 4, 32, 8, DARK_TRIM);
  // "SEARCH" text hint (dark bar)
  rect(png, 12, 7, 24, 2, [240, 230, 220]);
  // Three illuminated push buttons in a column
  // SEARCH button (green)
  disc(png, 24, 22, 7, DARK_TRIM);
  disc(png, 24, 22, 6, [60, 180, 70]);
  disc(png, 24, 22, 4, [80, 230, 90]);
  // SECURE button (amber)
  disc(png, 24, 38, 7, DARK_TRIM);
  disc(png, 24, 38, 6, [200, 140, 30]);
  disc(png, 24, 38, 4, [255, 180, 60]);
  // EMERGENCY STOP button (red, mushroom cap style)
  disc(png, 24, 54, 6, DARK_TRIM);
  disc(png, 24, 54, 5, [180, 30, 30]);
  disc(png, 24, 54, 3, [240, 70, 70]);
  // Status indicator on the right
  rect(png, 38, 20, 4, 4, [80, 230, 90]);
  stroke(png, 38, 20, 4, 4, DARK_TRIM);
  rect(png, 38, 36, 4, 4, [60, 64, 72]);
  stroke(png, 38, 36, 4, 4, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'search_secure_panel.png');
}

// Access control panel — badge reader with card slot, keypad, and
// status display for zone entry permissions.
function accessControlPanel() {
  const w = 32, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [180, 185, 195]);
  // Status display at top
  rect(png, 4, 4, 24, 10, DARK_TRIM);
  rect(png, 5, 5, 22, 8, [40, 58, 32]);
  // "READY" text hint
  rect(png, 7, 8, 18, 2, [80, 230, 90]);
  // Card reader slot
  rect(png, 6, 18, 20, 8, [60, 64, 72]);
  stroke(png, 6, 18, 20, 8, DARK_TRIM);
  // Card insertion arrow hint
  rect(png, 14, 20, 4, 1, [180, 175, 155]);
  rect(png, 15, 21, 2, 3, [180, 175, 155]);
  // 3×4 keypad
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const kx = 6 + col * 7;
      const ky = 30 + row * 7;
      rect(png, kx, ky, 5, 5, [140, 144, 152]);
      stroke(png, kx, ky, 5, 5, [100, 104, 112]);
    }
  }
  // Status LED at bottom
  disc(png, 16, 60, 2, [80, 230, 90]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'access_control_panel.png');
}

// ── Power / Electrical ───────────────────────────────────────────────

// Switchgear cabinet front — outdoor metal-clad enclosure with breaker compartments
function switchgearFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GREEN_BODY);
  rect(png, 0, 1, w, 1, GREEN_HIGHLIGHT);
  // HV warning placard top center
  warningSticker(png, 10, 3, 28, 8);
  // 3 breaker compartment doors stacked vertically
  for (let row = 0; row < 3; row++) {
    const dy = 14 + row * 15;
    rect(png, 4, dy, 40, 12, [55, 100, 55]);
    stroke(png, 4, dy, 40, 12, DARK_TRIM);
    // Nameplate on each door
    nameplate(png, 8, dy + 2, 16, 4);
    // Status LED
    rect(png, 36, dy + 3, 2, 2, (row === 1) ? [230, 60, 50] : [80, 230, 90]);
    // Door handle
    rect(png, 38, dy + 6, 2, 4, [120, 124, 130]);
  }
  // Bottom vent
  venting(png, 6, 58, 36, 4, DARK_TRIM, [70, 72, 78]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'switchgear_front.png');
}

// Motor Control Center front — rows of starter buckets with handle and LEDs
function mccFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  rect(png, 0, 1, w, 1, [160, 162, 168]);
  // 6 starter bucket compartments (2 columns × 3 rows)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const bx = 3 + col * 22;
      const by = 4 + row * 19;
      rect(png, bx, by, 20, 16, [110, 112, 118]);
      stroke(png, bx, by, 20, 16, DARK_TRIM);
      // Bucket handle (rotary disconnect)
      disc(png, bx + 6, by + 8, 3, [50, 52, 58]);
      disc(png, bx + 6, by + 8, 2, [80, 82, 88]);
      rect(png, bx + 5, by + 6, 3, 1, [40, 42, 48]);
      // Nameplate
      nameplate(png, bx + 10, by + 2, 8, 3);
      // Status LEDs — RUN (green) and FAULT (red)
      rect(png, bx + 14, by + 7, 2, 2, [80, 230, 90]);
      rect(png, bx + 14, by + 11, 2, 2, [230, 60, 50]);
      // Current display
      rect(png, bx + 10, by + 10, 8, 4, [20, 22, 28]);
      stroke(png, bx + 10, by + 10, 8, 4, [60, 64, 72]);
      const digC = [60, 220, 80];
      rect(png, bx + 12, by + 11, 2, 2, digC);
      rect(png, bx + 15, by + 11, 2, 2, digC);
    }
  }
  // Bottom label strip
  rect(png, 3, 61, 42, 2, [180, 175, 155]);
  stroke(png, 3, 61, 42, 2, DARK_TRIM);
  save(png, 'mcc_front.png');
}

// UPS / Battery Bank front — status display, battery gauge, breaker section
function upsFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  rect(png, 0, 1, w, 1, [160, 162, 168]);

  // Top: LCD status display
  rect(png, 6, 4, 36, 12, [20, 22, 28]);
  stroke(png, 6, 4, 36, 12, [60, 64, 72]);
  // "ONLINE" text hint
  const digC = [60, 220, 80];
  for (let i = 0; i < 5; i++) {
    rect(png, 10 + i * 5, 7, 3, 5, digC);
  }
  // Load bar graph
  rect(png, 10, 13, 20, 2, [40, 42, 48]);
  rect(png, 10, 13, 12, 2, [60, 180, 70]);

  // Middle: battery level indicators (4 battery icons)
  const batY = 20;
  for (let i = 0; i < 4; i++) {
    const bx = 6 + i * 10;
    rect(png, bx, batY, 8, 12, [50, 52, 58]);
    stroke(png, bx, batY, 8, 12, DARK_TRIM);
    // Battery fill level (descending)
    const fill = 12 - i * 2;
    rect(png, bx + 1, batY + 12 - fill, 6, fill, [80, 200, 90]);
    // Terminal nub
    rect(png, bx + 2, batY - 1, 4, 1, DARK_TRIM);
  }

  // Control panel strip
  const ctrlY = 36;
  rect(png, 4, ctrlY, 40, 8, [70, 72, 78]);
  stroke(png, 4, ctrlY, 40, 8, DARK_TRIM);
  // Power button
  disc(png, 12, ctrlY + 4, 2, [60, 180, 70]);
  // Bypass switch
  disc(png, 24, ctrlY + 4, 2, [200, 175, 60]);
  // Status LEDs
  rect(png, 32, ctrlY + 2, 2, 2, [80, 230, 90]);
  rect(png, 36, ctrlY + 2, 2, 2, [80, 230, 90]);
  rect(png, 32, ctrlY + 5, 2, 2, [255, 180, 50]);
  rect(png, 36, ctrlY + 5, 2, 2, [230, 60, 50]);

  // Bottom: breaker section
  rect(png, 4, 47, 40, 14, [60, 62, 68]);
  stroke(png, 4, 47, 40, 14, DARK_TRIM);
  for (let i = 0; i < 5; i++) {
    const bx = 7 + i * 7;
    rect(png, bx, 49, 4, 8, [40, 42, 48]);
    stroke(png, bx, 49, 4, 8, [80, 84, 92]);
    const up = (i % 2 === 0);
    rect(png, bx + 1, 49 + (up ? 1 : 5), 2, 2, up ? [80, 230, 90] : [240, 70, 70]);
  }

  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'ups_front.png');
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
patchPanelFront();
networkSwitchFront();
blmReadoutFront();
bpmElectronicsFront();
archiverFront();
searchSecurePanel();
accessControlPanel();
switchgearFront();
mccFront();
upsFront();
console.log('done.');
