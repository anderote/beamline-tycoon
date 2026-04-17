#!/usr/bin/env node
// Procedural pixel-art front-panel decals for optics lab equipment.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-optics-decals.cjs
//
// Each decal maps to a full face of its box mesh (clamp-to-edge UVs).
// Shared style with gen-rf-decals.cjs / gen-infra-decals.cjs.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'decals');

// ── Drawing primitives ───────────────────────────────────────────────
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

function shadedRect(png, x, y, w, h, baseC) {
  rect(png, x, y, w, h, baseC);
  const top = [Math.min(255, baseC[0] + 30), Math.min(255, baseC[1] + 30), Math.min(255, baseC[2] + 30)];
  const bot = [Math.max(0, baseC[0] - 35), Math.max(0, baseC[1] - 35), Math.max(0, baseC[2] - 35)];
  for (let dx = 0; dx < w; dx++) px(png, x + dx, y, top[0], top[1], top[2]);
  for (let dx = 0; dx < w; dx++) px(png, x + dx, y + h - 1, bot[0], bot[1], bot[2]);
}

function venting(png, x, y, w, h, darkC, lightC, slatH = 2) {
  for (let yy = 0; yy < h; yy += slatH) {
    const c = (yy / slatH) % 2 === 0 ? darkC : lightC;
    rect(png, x, y + yy, w, Math.min(slatH, h - yy), c);
  }
}

function nameplate(png, x, y, w, h) {
  rect(png, x, y, w, h, [40, 42, 48]);
  stroke(png, x, y, w, h, [80, 84, 92]);
  rect(png, x + 1, y + 1, w - 2, h - 2, [180, 175, 155]);
}

function warningSticker(png, x, y, w, h) {
  rect(png, x, y, w, h, [220, 190, 60]);
  stroke(png, x, y, w, h, [25, 25, 28]);
  const cx = x + (w >> 1);
  const cy = y + (h >> 1);
  px(png, cx, cy - 1, 25, 25, 28);
  px(png, cx - 1, cy, 25, 25, 28); px(png, cx, cy, 25, 25, 28); px(png, cx + 1, cy, 25, 25, 28);
}

function save(png, name) {
  const buf = PNG.sync.write(png);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..', '..'), out));
}

// ── Palettes ──────────────────────────────────────────────────────────
const CYAN_BODY       = [50, 100, 130];
const CYAN_HIGHLIGHT  = [80, 140, 170];
const DARK_TRIM       = [40, 42, 48];
const SCREW_BODY      = [120, 124, 132];
const SCREW_SLOT      = [40, 42, 48];

// ── LASER ALIGNMENT SYSTEM ──────────────────────────────────────────
// Front panel: laser head housing with aperture, beam path indicator,
// alignment target crosshairs, power/interlock controls.
// 128×64 for 4×1 footprint × subH 2.
function laserAlignmentFront() {
  const w = 128, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Laser head section (left third)
  rect(png, 4, 4, 36, 40, [50, 52, 58]);
  stroke(png, 4, 4, 36, 40, [70, 72, 80]);
  // Laser aperture
  disc(png, 22, 20, 8, [30, 32, 38]);
  disc(png, 22, 20, 6, [20, 22, 28]);
  disc(png, 22, 20, 2, [200, 40, 40]);
  // Beam emission indicator ring
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    px(png, Math.round(22 + Math.cos(rad) * 7), Math.round(20 + Math.sin(rad) * 7), 200, 50, 50);
  }
  // Laser class warning
  warningSticker(png, 8, 32, 14, 8);
  // Power indicator
  rect(png, 26, 34, 2, 2, [200, 40, 40]);
  rect(png, 30, 34, 2, 2, [80, 230, 90]);
  // Beam path section (middle — long rail with optics mounts)
  rect(png, 44, 18, 40, 6, [60, 64, 72]);
  rect(png, 44, 18, 40, 1, [80, 84, 92]);
  // Beam line (red laser trace)
  rect(png, 30, 20, 60, 1, [200, 40, 40]);
  // Optics mounts on the rail (3 small uprights)
  for (let i = 0; i < 3; i++) {
    const mx = 50 + i * 14;
    rect(png, mx, 10, 4, 14, [100, 104, 112]);
    rect(png, mx, 10, 4, 2, [140, 144, 152]);
    // Lens/mirror element
    disc(png, mx + 2, 16, 2, [180, 190, 220]);
  }
  // Alignment target / detector (right section)
  rect(png, 88, 4, 36, 40, [50, 52, 58]);
  stroke(png, 88, 4, 36, 40, [70, 72, 80]);
  // Crosshair target
  disc(png, 106, 20, 10, [30, 32, 38]);
  disc(png, 106, 20, 9, [220, 215, 200]);
  // Concentric rings
  disc(png, 106, 20, 7, [200, 205, 190]);
  disc(png, 106, 20, 5, [220, 215, 200]);
  disc(png, 106, 20, 3, [200, 205, 190]);
  disc(png, 106, 20, 1, [200, 40, 40]);
  // Crosshair lines
  rect(png, 96, 20, 20, 1, DARK_TRIM);
  rect(png, 106, 10, 1, 20, DARK_TRIM);
  // Detector readout
  rect(png, 92, 32, 28, 8, DARK_TRIM);
  rect(png, 93, 33, 26, 6, [30, 40, 35]);
  rect(png, 95, 35, 10, 1, [80, 230, 90]);
  rect(png, 107, 35, 8, 1, [80, 200, 255]);
  // Control panel at bottom
  rect(png, 4, 48, 120, 12, [60, 64, 72]);
  stroke(png, 4, 48, 120, 12, [80, 84, 92]);
  // Key switch (interlock)
  disc(png, 16, 54, 3, DARK_TRIM);
  disc(png, 16, 54, 2, [200, 50, 50]);
  rect(png, 15, 52, 2, 2, DARK_TRIM);
  // Mode selector buttons
  for (let i = 0; i < 4; i++) {
    rect(png, 28 + i * 12, 50, 8, 6, [80, 84, 92]);
    stroke(png, 28 + i * 12, 50, 8, 6, DARK_TRIM);
  }
  // Active mode indicator
  rect(png, 29, 51, 6, 4, [80, 230, 90]);
  // Status LEDs
  rect(png, 82, 52, 2, 2, [80, 230, 90]);
  rect(png, 88, 52, 2, 2, [80, 230, 90]);
  rect(png, 94, 52, 2, 2, [255, 180, 50]);
  // Nameplate
  nameplate(png, 100, 50, 20, 6);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'laser_alignment_front.png');
}

function laserAlignmentSide() {
  const w = 32, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Laser housing profile
  rect(png, 4, 6, 24, 32, [50, 52, 58]);
  stroke(png, 4, 6, 24, 32, [70, 72, 80]);
  // Heat sink fins
  for (let yy = 10; yy < 34; yy += 3) {
    rect(png, 4, yy, 24, 1, [70, 74, 82]);
  }
  // Aperture opening
  disc(png, 16, 22, 4, [30, 32, 38]);
  disc(png, 16, 22, 2, [200, 40, 40]);
  // Warning label
  warningSticker(png, 6, 40, 12, 8);
  // Cable connector at bottom
  rect(png, 10, 52, 12, 6, [60, 64, 72]);
  stroke(png, 10, 52, 12, 6, [80, 84, 92]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'laser_alignment_side.png');
}

// ── MIRROR MOUNT STATION ────────────────────────────────────────────
// Tiny precision device: kinematic mount with mirror face, adjustment
// screws visible. 16×32 for visual 0.3W × 0.6H × 0.3L.
function mirrorMountFront() {
  const w = 16, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [140, 144, 152]);
  // Mirror face (reflective disc at top)
  disc(png, 8, 10, 6, [60, 64, 72]);
  disc(png, 8, 10, 5, [180, 190, 220]);
  // Reflection highlight
  px(png, 6, 8, 230, 235, 250);
  px(png, 7, 7, 220, 225, 240);
  // Mount ring
  for (let a = 0; a < 360; a += 40) {
    const rad = a * Math.PI / 180;
    px(png, Math.round(8 + Math.cos(rad) * 6), Math.round(10 + Math.sin(rad) * 6), 100, 104, 112);
  }
  // Adjustment screws (3 at 120° around the mount)
  disc(png, 3, 20, 2, [100, 104, 112]);
  px(png, 3, 20, 60, 64, 72);
  disc(png, 13, 20, 2, [100, 104, 112]);
  px(png, 13, 20, 60, 64, 72);
  disc(png, 8, 26, 2, [100, 104, 112]);
  px(png, 8, 26, 60, 64, 72);
  // Post base
  rect(png, 4, 28, 8, 3, [80, 84, 92]);
  rect(png, 4, 28, 8, 1, [100, 104, 112]);
  save(png, 'mirror_mount_front.png');
}

// ── BEAM PROFILER ───────────────────────────────────────────────────
// Compact CCD camera instrument: sensor window, readout display,
// mode indicator. 48×24 for visual 1.3W × 0.5H × 0.7L.
function beamProfilerFront() {
  const w = 48, h = 24;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Sensor window (left side)
  rect(png, 3, 3, 16, 18, [30, 32, 38]);
  stroke(png, 3, 3, 16, 18, [70, 72, 80]);
  // CCD sensor chip (small bright square)
  rect(png, 7, 7, 8, 10, [20, 24, 32]);
  rect(png, 9, 9, 4, 6, [100, 120, 180]);
  // Beam spot on sensor (gaussian-ish)
  px(png, 11, 12, 80, 230, 90);
  px(png, 10, 12, 50, 160, 60);
  px(png, 12, 12, 50, 160, 60);
  px(png, 11, 11, 50, 160, 60);
  px(png, 11, 13, 50, 160, 60);
  // Mini display (right side — beam profile readout)
  rect(png, 22, 3, 22, 12, [30, 32, 38]);
  rect(png, 23, 4, 20, 10, [20, 30, 25]);
  // Gaussian profile curve
  const profile = [1, 2, 4, 6, 8, 9, 10, 9, 8, 6, 4, 2, 1];
  for (let i = 0; i < profile.length; i++) {
    const ph = profile[i];
    px(png, 25 + i, 12 - ph, 80, 230, 90);
    if (ph > 1) px(png, 25 + i, 13 - ph, 50, 160, 60);
  }
  // X-axis
  rect(png, 24, 13, 18, 1, [60, 70, 60]);
  // Mode indicator LEDs
  rect(png, 24, 17, 2, 2, [80, 230, 90]);
  rect(png, 28, 17, 2, 2, [60, 64, 72]);
  rect(png, 32, 17, 2, 2, [60, 64, 72]);
  // Connector
  rect(png, 40, 17, 4, 4, [60, 64, 72]);
  stroke(png, 40, 17, 4, 4, [80, 84, 92]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'beam_profiler_front.png');
}

// ── INTERFEROMETER ──────────────────────────────────────────────────
// Desktop instrument: beam splitter housing, fringe display, controls.
// 48×24 for visual 1.4W × 0.6H (desktop-sized).
function interferometerFront() {
  const w = 48, h = 24;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, CYAN_BODY);
  rect(png, 0, 1, w, 1, CYAN_HIGHLIGHT);
  // Beam splitter housing (left)
  rect(png, 3, 3, 14, 14, [35, 38, 44]);
  stroke(png, 3, 3, 14, 14, [70, 72, 80]);
  // Splitter cube with diagonal
  rect(png, 6, 5, 8, 8, [60, 64, 72]);
  for (let i = 0; i < 7; i++) px(png, 7 + i, 6 + i, 180, 190, 220);
  // Input port
  disc(png, 4, 10, 2, [80, 84, 92]);
  disc(png, 4, 10, 1, [30, 32, 38]);
  // Beam trace
  rect(png, 2, 10, 3, 1, [200, 40, 40]);
  rect(png, 16, 10, 3, 1, [200, 40, 40]);
  // Fringe display (right)
  rect(png, 20, 3, 16, 12, DARK_TRIM);
  rect(png, 21, 4, 14, 10, [20, 25, 35]);
  for (let yy = 0; yy < 9; yy++) {
    const c = Math.sin(yy * 1.0) > 0 ? [80, 200, 255] : [20, 40, 60];
    rect(png, 22, 5 + yy, 12, 1, c);
  }
  // Controls at bottom right
  disc(png, 40, 10, 3, [80, 84, 92]);
  disc(png, 40, 10, 2, [100, 104, 112]);
  px(png, 40, 8, 200, 200, 210);
  // Status LEDs
  rect(png, 38, 17, 2, 2, [80, 230, 90]);
  rect(png, 42, 17, 2, 2, [80, 200, 255]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'interferometer_front.png');
}

// ── PHOTODETECTOR ───────────────────────────────────────────────────
// Small sensor head with active area window and BNC connector.
// 16×20 for visual 0.25W × 0.35H.
function photodetectorFront() {
  const w = 16, h = 20;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Active area window
  disc(png, 8, 7, 4, [30, 32, 38]);
  disc(png, 8, 7, 3, [60, 70, 100]);
  disc(png, 8, 7, 1, [120, 140, 200]);
  // Sensor ring
  for (let a = 0; a < 360; a += 45) {
    const rad = a * Math.PI / 180;
    px(png, Math.round(8 + Math.cos(rad) * 4), Math.round(7 + Math.sin(rad) * 4), 80, 84, 92);
  }
  // BNC connector at bottom
  disc(png, 8, 16, 2, [100, 104, 112]);
  disc(png, 8, 16, 1, [60, 64, 72]);
  // Status LED
  px(png, 13, 4, 80, 230, 90);
  save(png, 'photodetector_front.png');
}

// ── POLARIZER MOUNT ─────────────────────────────────────────────────
// Cylindrical housing with rotation scale, optic visible through aperture.
// 16×28 for visual 0.3W × 0.5H.
function polarizerFront() {
  const w = 16, h = 28;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [140, 144, 152]);
  // Cylindrical housing (dark ring)
  disc(png, 8, 10, 6, [60, 64, 72]);
  disc(png, 8, 10, 5, [80, 84, 92]);
  // Optic element (polarizer crystal)
  disc(png, 8, 10, 3, [160, 170, 200]);
  // Polarization axis indicator
  rect(png, 5, 10, 6, 1, [220, 220, 240]);
  // Rotation scale ring marks
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    const bx = Math.round(8 + Math.cos(rad) * 5);
    const by = Math.round(10 + Math.sin(rad) * 5);
    px(png, bx, by, 200, 200, 210);
  }
  // Index mark at top
  px(png, 8, 4, 200, 40, 40);
  // Lock screw
  disc(png, 4, 20, 2, [100, 104, 112]);
  px(png, 4, 20, 60, 64, 72);
  // Post
  rect(png, 6, 22, 4, 5, [100, 104, 112]);
  rect(png, 6, 22, 4, 1, [130, 134, 142]);
  save(png, 'polarizer_front.png');
}

// ── FIBER COUPLER ───────────────────────────────────────────────────
// Small box with FC connector ports and alignment stage.
// 24×14 for visual 0.35W × 0.2H.
function fiberCouplerFront() {
  const w = 24, h = 14;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Input aperture (free-space side)
  disc(png, 5, 7, 3, [60, 64, 72]);
  disc(png, 5, 7, 2, [30, 32, 38]);
  disc(png, 5, 7, 1, [100, 120, 180]);
  // FC connector port (fiber side)
  rect(png, 17, 4, 4, 6, [80, 84, 92]);
  stroke(png, 17, 4, 4, 6, [60, 64, 72]);
  disc(png, 19, 7, 1, [30, 32, 38]);
  // Alignment indicator
  rect(png, 10, 4, 4, 2, [30, 40, 35]);
  rect(png, 10, 4, 2, 2, [80, 230, 90]);
  // Fiber (yellow line out)
  rect(png, 21, 7, 3, 1, [255, 200, 50]);
  // Status LED
  px(png, 12, 10, 80, 230, 90);
  save(png, 'fiber_coupler_front.png');
}

// ── OPTICAL CHOPPER ─────────────────────────────────────────────────
// Motor housing with slotted disc visible, frequency display.
// 24×24 for visual 0.4W × 0.4H.
function opticalChopperFront() {
  const w = 24, h = 24;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [60, 64, 72]);
  // Chopper disc (visible through window)
  disc(png, 10, 10, 7, [30, 32, 38]);
  disc(png, 10, 10, 6, [50, 52, 58]);
  // Disc slots (alternating open/closed sectors)
  for (let a = 0; a < 360; a += 60) {
    const rad = a * Math.PI / 180;
    for (let t = 2; t < 6; t++) {
      px(png, Math.round(10 + Math.cos(rad) * t), Math.round(10 + Math.sin(rad) * t), 20, 22, 28);
    }
  }
  // Motor hub center
  disc(png, 10, 10, 1, [120, 124, 132]);
  // Frequency display (small LCD)
  rect(png, 14, 16, 8, 5, DARK_TRIM);
  rect(png, 15, 17, 6, 3, [30, 40, 35]);
  rect(png, 16, 18, 3, 1, [80, 230, 90]);
  // Beam slot indicator
  rect(png, 2, 10, 2, 1, [200, 40, 40]);
  rect(png, 17, 10, 2, 1, [200, 40, 40]);
  // Status LED
  px(png, 20, 4, 80, 230, 90);
  save(png, 'optical_chopper_front.png');
}

// ── POWER METER ─────────────────────────────────────────────────────
// Sensor head with LCD readout showing mW, range selector.
// 16×24 for visual 0.3W × 0.4H.
function powerMeterFront() {
  const w = 16, h = 24;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Sensor aperture (top)
  disc(png, 8, 5, 3, [50, 52, 58]);
  disc(png, 8, 5, 2, [80, 90, 120]);
  disc(png, 8, 5, 1, [120, 140, 200]);
  // LCD display
  rect(png, 2, 10, 12, 6, [30, 32, 38]);
  rect(png, 3, 11, 10, 4, [30, 40, 35]);
  // Power reading "3.2"
  rect(png, 4, 12, 2, 1, [80, 230, 90]);
  rect(png, 7, 12, 3, 1, [80, 230, 90]);
  // "mW" unit
  rect(png, 11, 12, 1, 1, [80, 200, 255]);
  // Range selector knob
  disc(png, 8, 20, 2, [80, 84, 92]);
  disc(png, 8, 20, 1, [100, 104, 112]);
  px(png, 8, 19, 200, 200, 210);
  // Status LED
  px(png, 13, 10, 80, 230, 90);
  save(png, 'power_meter_front.png');
}

// ── SPATIAL FILTER ──────────────────────────────────────────────────
// Pinhole + lens assembly on translation stage. Tall narrow post.
// 16×24 for visual 0.25W × 0.5H.
function spatialFilterFront() {
  const w = 16, h = 24;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [140, 144, 152]);
  // Objective lens housing (top)
  rect(png, 4, 2, 8, 6, [80, 84, 92]);
  stroke(png, 4, 2, 8, 6, [60, 64, 72]);
  disc(png, 8, 5, 2, [160, 170, 200]);
  // Pinhole stage (middle)
  rect(png, 2, 10, 12, 4, [60, 64, 72]);
  stroke(png, 2, 10, 12, 4, [80, 84, 92]);
  // Pinhole (tiny bright dot)
  px(png, 8, 12, 255, 220, 100);
  // XY adjustment screws
  disc(png, 2, 12, 1, [100, 104, 112]);
  disc(png, 14, 12, 1, [100, 104, 112]);
  // Post
  rect(png, 6, 16, 4, 4, [100, 104, 112]);
  rect(png, 6, 16, 4, 1, [130, 134, 142]);
  // Base
  rect(png, 3, 20, 10, 3, [80, 84, 92]);
  rect(png, 3, 20, 10, 1, [100, 104, 112]);
  save(png, 'spatial_filter_front.png');
}

// ── Main ──────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
laserAlignmentFront();
laserAlignmentSide();
mirrorMountFront();
beamProfilerFront();
interferometerFront();
photodetectorFront();
polarizerFront();
fiberCouplerFront();
opticalChopperFront();
powerMeterFront();
spatialFilterFront();
console.log('done.');
