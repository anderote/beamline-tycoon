#!/usr/bin/env node
// Procedural pixel-art front-panel decals for vacuum lab equipment.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-vacuum-decals.cjs
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

function gauge(png, cx, cy, r, angleDeg) {
  disc(png, cx, cy, r, [40, 42, 48]);
  disc(png, cx, cy, r - 1, [220, 215, 200]);
  const rad = angleDeg * Math.PI / 180;
  for (let t = 1; t <= r - 2; t++) {
    px(png, Math.round(cx + Math.cos(rad) * t), Math.round(cy + Math.sin(rad) * t), 200, 30, 30);
  }
  px(png, cx, cy, 30, 30, 36);
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

function ledColumn(png, x, y, h, count) {
  const step = Math.max(2, Math.floor(h / count));
  for (let i = 0; i < count; i++) {
    const c = (i % 2 === 0) ? [80, 230, 90] : [255, 180, 50];
    rect(png, x, y + i * step, 2, 2, c);
  }
}

function flangePort(png, cx, cy, r) {
  disc(png, cx, cy, r + 2, [100, 104, 112]);
  disc(png, cx, cy, r + 1, [80, 84, 92]);
  disc(png, cx, cy, r, [40, 42, 48]);
  disc(png, cx, cy, r - 1, [25, 26, 30]);
  // Bolt holes around the flange
  const boltR = r + 1;
  for (let a = 0; a < 360; a += 60) {
    const rad = a * Math.PI / 180;
    px(png, Math.round(cx + Math.cos(rad) * boltR), Math.round(cy + Math.sin(rad) * boltR), 60, 64, 72);
  }
}

function save(png, name) {
  const buf = PNG.sync.write(png);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..', '..'), out));
}

// ── Palettes ──────────────────────────────────────────────────────────
const PURPLE_BODY     = [95, 70, 130];
const PURPLE_HIGHLIGHT= [130, 105, 165];
const GRAY_BODY       = [130, 132, 138];
const STEEL_BODY      = [160, 165, 175];
const DARK_TRIM       = [40, 42, 48];
const SCREW_BODY      = [120, 124, 132];
const SCREW_SLOT      = [40, 42, 48];

// ── TEST CHAMBER ────────────────────────────────────────────────────
// Front panel: large viewport window in center, two pressure gauges,
// CF flange ports, vacuum interlock indicator. 96×64 for 3×3 footprint (front face is 3 wide × 2 high).
function testChamberFront() {
  const w = 96, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, STEEL_BODY);
  // Viewport window (large dark circle with glass highlight)
  disc(png, 48, 30, 16, DARK_TRIM);
  disc(png, 48, 30, 14, [30, 32, 40]);
  disc(png, 48, 30, 12, [20, 22, 35]);
  // Glass reflection hint
  for (let t = 0; t < 6; t++) {
    px(png, 42 + t, 22 + t, 80, 85, 120);
  }
  // CF flange ring around viewport
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    const bx = Math.round(48 + Math.cos(rad) * 14);
    const by = Math.round(30 + Math.sin(rad) * 14);
    px(png, bx, by, 140, 144, 152);
  }
  // Two pressure gauges
  gauge(png, 14, 14, 6, 200);
  gauge(png, 82, 14, 6, 320);
  // Gauge labels
  rect(png, 8, 23, 12, 2, DARK_TRIM);
  rect(png, 76, 23, 12, 2, DARK_TRIM);
  // Vacuum interlock indicator (green = sealed)
  rect(png, 10, 50, 14, 8, DARK_TRIM);
  rect(png, 11, 51, 12, 6, [40, 180, 70]);
  // Nameplate
  nameplate(png, 72, 50, 20, 6);
  // Small CF port on the right side
  flangePort(png, 82, 42, 4);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'test_chamber_front.png');
}

function testChamberSide() {
  const w = 96, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, STEEL_BODY);
  // CF flange ports (two stacked)
  flangePort(png, 30, 20, 5);
  flangePort(png, 30, 46, 5);
  // Smaller port top right
  flangePort(png, 66, 16, 3);
  // Vent grille at bottom
  venting(png, 50, 40, 36, 16, DARK_TRIM, [80, 84, 92]);
  // Warning sticker
  warningSticker(png, 8, 50, 14, 10);
  // Weld seam lines
  rect(png, 0, 32, w, 1, [140, 144, 155]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'test_chamber_side.png');
}

// ── LEAK DETECTOR ───────────────────────────────────────────────────
// Portable instrument: LCD readout showing leak rate, sniff probe
// connector, sensitivity knob, status LEDs. 48×32 for 2×1 footprint
// (visual 1.3W × 0.7H).
function leakDetectorFront() {
  const w = 48, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, PURPLE_BODY);
  rect(png, 0, 1, w, 1, PURPLE_HIGHLIGHT);
  // LCD display (leak rate reading)
  rect(png, 4, 4, 26, 14, DARK_TRIM);
  rect(png, 5, 5, 24, 12, [30, 40, 35]);
  // Exponential notation "2.4E-9"
  rect(png, 7, 8, 3, 1, [80, 230, 90]);
  rect(png, 11, 8, 1, 1, [80, 230, 90]);
  rect(png, 13, 8, 4, 1, [80, 230, 90]);
  rect(png, 7, 12, 8, 1, [80, 230, 90]);
  // Bar graph below digits
  rect(png, 7, 14, 18, 2, [20, 30, 25]);
  rect(png, 7, 14, 6, 2, [80, 230, 90]);
  // Sensitivity knob (right side)
  disc(png, 38, 10, 4, [60, 64, 72]);
  disc(png, 38, 10, 3, [100, 104, 112]);
  px(png, 38, 8, 200, 30, 30);
  // Probe connector port
  disc(png, 38, 24, 3, [80, 84, 92]);
  disc(png, 38, 24, 2, DARK_TRIM);
  disc(png, 38, 24, 1, [200, 200, 210]);
  // Status LEDs
  rect(png, 32, 18, 2, 2, [80, 230, 90]);
  rect(png, 32, 22, 2, 2, [255, 180, 50]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'leak_detector_front.png');
}

// ── PUMP CART ────────────────────────────────────────────────────────
// Mobile turbo pump station: turbo pump body with controller panel,
// foreline gauge, vent valve. 64×64 for 2×1 footprint × subH 2.
function pumpCartFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [80, 84, 92]);
  // Turbo pump body (large cylinder suggested by rounded dark rect)
  rect(png, 8, 4, 28, 36, DARK_TRIM);
  stroke(png, 8, 4, 28, 36, [60, 64, 72]);
  // Pump intake flange (top of pump)
  flangePort(png, 22, 10, 5);
  // Pump body highlight lines (cylindrical shading)
  rect(png, 12, 14, 1, 22, [70, 74, 82]);
  rect(png, 32, 14, 1, 22, [70, 74, 82]);
  // Rotor speed indicator
  rect(png, 14, 32, 18, 4, [20, 22, 28]);
  rect(png, 15, 33, 12, 2, [80, 200, 255]);
  // Controller panel (right side)
  rect(png, 40, 4, 20, 32, [50, 52, 58]);
  stroke(png, 40, 4, 20, 32, [70, 72, 80]);
  // Controller LCD
  rect(png, 42, 6, 16, 10, DARK_TRIM);
  rect(png, 43, 7, 14, 8, [30, 40, 35]);
  rect(png, 45, 9, 6, 1, [80, 230, 90]);
  rect(png, 45, 12, 10, 1, [80, 200, 255]);
  // Start/stop buttons
  disc(png, 46, 24, 3, [40, 160, 60]);
  disc(png, 56, 24, 3, [200, 50, 50]);
  // Vent valve
  disc(png, 46, 32, 2, [200, 50, 50]);
  disc(png, 46, 32, 1, [240, 80, 80]);
  // Foreline pressure gauge at bottom
  gauge(png, 22, 50, 6, 240);
  // Cart wheels (bottom edge)
  disc(png, 10, 60, 3, [30, 32, 38]);
  disc(png, 10, 60, 2, [50, 52, 58]);
  disc(png, 54, 60, 3, [30, 32, 38]);
  disc(png, 54, 60, 2, [50, 52, 58]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'pump_cart_front.png');
}

function pumpCartSide() {
  const w = 32, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [80, 84, 92]);
  // Pump body profile (side view of cylinder)
  rect(png, 6, 4, 20, 36, DARK_TRIM);
  rect(png, 8, 6, 16, 32, [50, 52, 58]);
  // Cooling fins
  for (let yy = 10; yy < 34; yy += 3) {
    rect(png, 6, yy, 20, 1, [70, 74, 82]);
  }
  // Foreline connection at bottom of pump
  rect(png, 12, 38, 8, 4, [60, 64, 72]);
  disc(png, 16, 44, 3, [80, 84, 92]);
  disc(png, 16, 44, 2, DARK_TRIM);
  // Cart frame
  rect(png, 4, 48, 24, 2, [60, 64, 72]);
  // Wheels
  disc(png, 8, 58, 3, [30, 32, 38]);
  disc(png, 8, 58, 2, [50, 52, 58]);
  disc(png, 24, 58, 3, [30, 32, 38]);
  disc(png, 24, 58, 2, [50, 52, 58]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'pump_cart_side.png');
}

// ── GAS MANIFOLD ────────────────────────────────────────────────────
// Front panel: row of needle valves with pressure regulators, gas line
// connections, flow labels. 96×32 for 3×1 footprint × subH 1.
function gasManifoldFront() {
  const w = 96, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, STEEL_BODY);
  // Header pipe running across the top
  rect(png, 4, 4, 88, 4, [120, 124, 132]);
  rect(png, 4, 4, 88, 1, [150, 155, 165]);
  // Five valve stations along the manifold
  for (let i = 0; i < 5; i++) {
    const vx = 10 + i * 16;
    // Drop-down pipe from header
    rect(png, vx + 2, 8, 2, 8, [120, 124, 132]);
    // Valve body
    disc(png, vx + 3, 18, 3, [80, 84, 92]);
    disc(png, vx + 3, 18, 2, [60, 64, 72]);
    // Valve handle (alternating colors for gas type)
    const handleC = i === 0 ? [80, 230, 90] : i === 1 ? [80, 180, 255] : i === 2 ? [255, 180, 50] : i === 3 ? [200, 80, 80] : [200, 200, 210];
    rect(png, vx, 14, 6, 2, handleC);
    // Flow indicator dot below valve
    rect(png, vx + 2, 24, 2, 2, i < 3 ? [80, 230, 90] : [60, 64, 72]);
  }
  // Outlet connections at bottom (small stubs)
  for (let i = 0; i < 5; i++) {
    const vx = 10 + i * 16;
    rect(png, vx + 1, 28, 4, 2, [100, 104, 112]);
  }
  // Nameplate
  nameplate(png, 74, 22, 18, 6);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'gas_manifold_front.png');
}

// ── RGA (Residual Gas Analyzer) ─────────────────────────────────────
// Front panel: mass spectrum display, filament status LEDs, scan
// controls. Tall narrow unit. 32×64 for 1×2 footprint × subH 2.
function rgaFront() {
  const w = 32, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, PURPLE_BODY);
  rect(png, 0, 1, w, 1, PURPLE_HIGHLIGHT);
  // Mass spectrum display (large LCD area)
  rect(png, 3, 4, 26, 24, DARK_TRIM);
  rect(png, 4, 5, 24, 22, [20, 25, 35]);
  // Spectrum peaks (mass/charge bars)
  const peaks = [14, 4, 18, 8, 6, 12, 3, 10, 5, 16, 2, 7];
  for (let i = 0; i < 12; i++) {
    const bh = peaks[i];
    const bx = 5 + i * 2;
    const c = bh > 14 ? [255, 100, 80] : bh > 8 ? [80, 200, 255] : [80, 230, 90];
    rect(png, bx, 25 - bh, 1, bh, c);
  }
  // X-axis line
  rect(png, 5, 25, 24, 1, [100, 110, 130]);
  // Filament status section
  rect(png, 3, 32, 26, 8, [50, 52, 58]);
  stroke(png, 3, 32, 26, 8, [70, 72, 80]);
  // Filament LEDs (FIL 1 / FIL 2)
  rect(png, 6, 34, 2, 2, [80, 230, 90]);
  rect(png, 6, 37, 2, 2, [60, 64, 72]);
  // Labels
  rect(png, 10, 34, 8, 2, [180, 175, 155]);
  rect(png, 10, 37, 8, 2, [180, 175, 155]);
  // Scan control buttons
  rect(png, 5, 44, 8, 5, [40, 160, 60]);
  stroke(png, 5, 44, 8, 5, DARK_TRIM);
  rect(png, 15, 44, 8, 5, [200, 50, 50]);
  stroke(png, 15, 44, 8, 5, DARK_TRIM);
  // Emission current knob
  disc(png, 24, 54, 4, [60, 64, 72]);
  disc(png, 24, 54, 3, [100, 104, 112]);
  px(png, 24, 52, 200, 200, 210);
  // Nameplate
  nameplate(png, 4, 56, 14, 5);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'rga_front.png');
}

function rgaSide() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, PURPLE_BODY);
  rect(png, 0, 1, w, 1, PURPLE_HIGHLIGHT);
  // Analyzer tube section (long horizontal cylinder)
  rect(png, 8, 14, 48, 12, DARK_TRIM);
  rect(png, 10, 16, 44, 8, [50, 52, 58]);
  // Quadrupole rods hinted inside
  rect(png, 14, 18, 36, 1, [200, 180, 120]);
  rect(png, 14, 21, 36, 1, [200, 180, 120]);
  // CF flange at inlet end
  flangePort(png, 8, 20, 4);
  // Vent grille at bottom
  venting(png, 10, 34, 44, 18, DARK_TRIM, [70, 55, 90]);
  // Warning sticker
  warningSticker(png, 8, 54, 14, 8);
  // Cable connector
  rect(png, 46, 54, 10, 6, [60, 64, 72]);
  stroke(png, 46, 54, 10, 6, [80, 84, 92]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'rga_side.png');
}

// ── Main ──────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
testChamberFront();
testChamberSide();
leakDetectorFront();
pumpCartFront();
pumpCartSide();
gasManifoldFront();
rgaFront();
rgaSide();
console.log('done.');
