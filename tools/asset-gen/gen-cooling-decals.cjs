#!/usr/bin/env node
// Procedural pixel-art front-panel decals for cooling lab equipment.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-cooling-decals.cjs
//
// Each decal maps to a full face of its box mesh (clamp-to-edge UVs).
// Shared style with gen-rf-decals.cjs / gen-infra-decals.cjs.

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

function pipeStub(png, cx, cy, r, pipeC) {
  disc(png, cx, cy, r + 1, [80, 84, 92]);
  disc(png, cx, cy, r, pipeC);
  disc(png, cx, cy, r - 1, [40, 42, 48]);
}

function ledColumn(png, x, y, h, count) {
  const step = Math.max(2, Math.floor(h / count));
  for (let i = 0; i < count; i++) {
    const c = (i % 2 === 0) ? [80, 230, 90] : [255, 180, 50];
    rect(png, x, y + i * step, 2, 2, c);
  }
}

function save(png, name) {
  const buf = PNG.sync.write(png);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..', '..'), out));
}

// ── Palettes ──────────────────────────────────────────────────────────
const BLUE_BODY     = [55, 95, 145];
const BLUE_HIGHLIGHT= [95, 135, 185];
const TEAL_BODY     = [40, 110, 120];
const TEAL_HIGHLIGHT= [70, 150, 160];
const DARK_TRIM     = [40, 42, 48];
const SCREW_BODY    = [120, 124, 132];
const SCREW_SLOT    = [40, 42, 48];
const PIPE_COPPER   = [180, 120, 70];
const PIPE_STEEL    = [160, 165, 175];

// ── COOLANT PUMP ─────────────────────────────────────────────────────
// Front panel: motor housing with pressure gauge, flow indicator,
// pipe connections, and a control switch. 64×64 for 2×2 footprint.
function coolantPumpFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, TEAL_BODY);
  rect(png, 0, 1, w, 1, TEAL_HIGHLIGHT);
  // Motor housing (large dark circle, center-left)
  disc(png, 22, 28, 14, DARK_TRIM);
  disc(png, 22, 28, 12, [70, 74, 82]);
  disc(png, 22, 28, 10, [50, 52, 58]);
  // Motor shaft dot
  disc(png, 22, 28, 2, [200, 200, 210]);
  // Cooling fins radiating from motor
  for (let a = 0; a < 360; a += 45) {
    const rad = a * Math.PI / 180;
    for (let t = 6; t < 10; t++) {
      px(png, Math.round(22 + Math.cos(rad) * t), Math.round(28 + Math.sin(rad) * t), 90, 94, 102);
    }
  }
  // Pressure gauge top right
  gauge(png, 48, 14, 6, 230);
  // Control switch below gauge
  rect(png, 44, 26, 10, 6, DARK_TRIM);
  rect(png, 44, 26, 5, 6, [80, 230, 90]);
  stroke(png, 44, 26, 10, 6, [80, 84, 92]);
  // Pipe stubs at bottom (inlet/outlet)
  pipeStub(png, 16, 52, 4, PIPE_COPPER);
  pipeStub(png, 40, 52, 4, PIPE_COPPER);
  // Flow arrow between pipes
  rect(png, 22, 52, 12, 1, [80, 180, 255]);
  px(png, 32, 51, 80, 180, 255);
  px(png, 32, 53, 80, 180, 255);
  // Nameplate
  nameplate(png, 40, 38, 20, 6);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'coolant_pump_front.png');
}

function coolantPumpSide() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, TEAL_BODY);
  rect(png, 0, 1, w, 1, TEAL_HIGHLIGHT);
  // Vent grille
  venting(png, 8, 10, 48, 30, DARK_TRIM, [60, 80, 90]);
  // Pipe stub at bottom
  pipeStub(png, 32, 52, 4, PIPE_COPPER);
  // Warning sticker
  warningSticker(png, 6, 48, 14, 10);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'coolant_pump_side.png');
}

// ── HEAT EXCHANGER ───────────────────────────────────────────────────
// Front panel: two temperature gauges (hot/cold side), piping schematic,
// four pipe stubs. 96×64 for 3×2 footprint.
function heatExchangerFront() {
  const w = 96, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, BLUE_BODY);
  rect(png, 0, 1, w, 1, BLUE_HIGHLIGHT);
  // Two temperature gauges
  gauge(png, 20, 14, 7, 200);
  gauge(png, 76, 14, 7, 320);
  // Gauge labels (hot / cold)
  rect(png, 12, 24, 16, 3, [200, 80, 60]);  // HOT
  rect(png, 68, 24, 16, 3, [60, 140, 220]); // COLD
  // Piping schematic in lower half — crossed flow paths
  // Primary (hot) path: left to right
  rect(png, 10, 36, 76, 2, [200, 100, 60]);
  // Secondary (cold) path: right to left
  rect(png, 10, 44, 76, 2, [60, 140, 220]);
  // Cross connections (heat transfer zones)
  for (let i = 0; i < 5; i++) {
    const xx = 20 + i * 14;
    rect(png, xx, 37, 1, 8, [160, 140, 120]);
  }
  // Four pipe stubs at bottom
  pipeStub(png, 14, 56, 3, [200, 100, 60]);
  pipeStub(png, 34, 56, 3, [200, 100, 60]);
  pipeStub(png, 62, 56, 3, [60, 140, 220]);
  pipeStub(png, 82, 56, 3, [60, 140, 220]);
  // Nameplate
  nameplate(png, 36, 4, 24, 6);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'heat_exchanger_front.png');
}

function heatExchangerSide() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, BLUE_BODY);
  rect(png, 0, 1, w, 1, BLUE_HIGHLIGHT);
  // Corrugated plate pattern (the heat exchange plates visible from side)
  for (let yy = 8; yy < 48; yy += 3) {
    rect(png, 8, yy, 48, 1, [40, 70, 110]);
    rect(png, 8, yy + 1, 48, 1, [70, 110, 160]);
  }
  stroke(png, 7, 7, 50, 42, DARK_TRIM);
  // Pipe stubs
  pipeStub(png, 16, 56, 3, PIPE_COPPER);
  pipeStub(png, 48, 56, 3, PIPE_COPPER);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'heat_exchanger_side.png');
}

// ── PIPE RACK ────────────────────────────────────────────────────────
// Front view: vertical rack with horizontal pipe runs, valves, and
// labels. Tall and narrow. 32×96 for 1×3 footprint, subH 5.
function pipeRackFront() {
  const w = 32, h = 96;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [100, 104, 112]);
  // Vertical frame rails
  rect(png, 2, 0, 3, h, [70, 74, 82]);
  rect(png, w - 5, 0, 3, h, [70, 74, 82]);
  // Horizontal pipe runs at different heights
  const pipeY = [12, 28, 44, 60, 76];
  const pipeColors = [PIPE_COPPER, PIPE_STEEL, [60, 140, 220], PIPE_COPPER, PIPE_STEEL];
  for (let i = 0; i < 5; i++) {
    const py = pipeY[i];
    const pc = pipeColors[i];
    // Pipe body
    rect(png, 5, py, w - 10, 4, pc);
    // Pipe highlight on top
    rect(png, 5, py, w - 10, 1, [Math.min(255, pc[0] + 40), Math.min(255, pc[1] + 40), Math.min(255, pc[2] + 40)]);
    // Bracket clamps at ends
    rect(png, 4, py - 1, 2, 6, [60, 64, 72]);
    rect(png, w - 6, py - 1, 2, 6, [60, 64, 72]);
    // Valve handle on every other pipe
    if (i % 2 === 0) {
      disc(png, 16, py + 2, 3, [200, 50, 50]);
      disc(png, 16, py + 2, 1, [240, 80, 80]);
    }
  }
  // Flow direction labels (small arrows)
  for (let i = 0; i < 5; i++) {
    const py = pipeY[i] + 2;
    const dir = i % 2 === 0 ? 1 : -1;
    const ax = dir > 0 ? w - 8 : 7;
    px(png, ax, py, 255, 255, 255);
    px(png, ax + dir, py - 1, 255, 255, 255);
    px(png, ax + dir, py + 1, 255, 255, 255);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'pipe_rack_front.png');
}

// ── CHILLER UNIT ─────────────────────────────────────────────────────
// Large unit: HMI display with temperature/flow data, control buttons,
// status LEDs, ventilation. 128×96 for 4×3 footprint, subH 4.
function chillerUnitFront() {
  const w = 128, h = 96;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [220, 225, 235]);
  // Top accent band (teal)
  rect(png, 0, 2, w, 3, TEAL_BODY);
  rect(png, 0, 2, w, 1, TEAL_HIGHLIGHT);
  // HMI touchscreen (large, top-left area)
  rect(png, 8, 10, 64, 40, DARK_TRIM);
  rect(png, 9, 11, 62, 38, [30, 50, 40]);
  // Temperature display (large digits)
  rect(png, 12, 14, 24, 12, [20, 40, 30]);
  // Fake 7-seg "18.5"
  rect(png, 14, 16, 4, 1, [80, 200, 255]); // top
  rect(png, 14, 20, 4, 1, [80, 200, 255]); // mid
  rect(png, 14, 24, 4, 1, [80, 200, 255]); // bot
  rect(png, 22, 16, 4, 1, [80, 200, 255]);
  rect(png, 22, 20, 4, 1, [80, 200, 255]);
  rect(png, 28, 16, 4, 1, [80, 200, 255]);
  rect(png, 28, 24, 4, 1, [80, 200, 255]);
  // "°C" label
  rect(png, 34, 16, 2, 2, [80, 200, 255]);
  // Flow bar graph
  rect(png, 12, 32, 54, 3, [20, 40, 30]);
  rect(png, 13, 33, 38, 1, [80, 230, 90]);
  // Status text lines
  rect(png, 42, 15, 24, 1, [80, 200, 255]);
  rect(png, 42, 19, 20, 1, [80, 230, 90]);
  rect(png, 42, 23, 28, 1, [255, 180, 50]);
  rect(png, 42, 27, 18, 1, [80, 200, 255]);
  // Trend plot in lower half of screen
  rect(png, 12, 38, 54, 8, [20, 40, 30]);
  for (let x = 0; x < 50; x++) {
    const y = Math.round(42 + Math.sin(x * 0.3) * 2);
    px(png, 14 + x, y, 80, 200, 255);
    const y2 = Math.round(42 + Math.cos(x * 0.2) * 1.5);
    px(png, 14 + x, y2, 80, 230, 90);
  }
  // Control panel (right of screen)
  // Power button
  disc(png, 84, 18, 5, DARK_TRIM);
  disc(png, 84, 18, 4, [80, 230, 90]);
  // Mode buttons
  for (let i = 0; i < 3; i++) {
    rect(png, 78, 28 + i * 8, 12, 6, [180, 185, 195]);
    stroke(png, 78, 28 + i * 8, 12, 6, [120, 124, 132]);
  }
  // Status LEDs right column
  rect(png, 96, 14, 4, 4, [80, 230, 90]);
  stroke(png, 96, 14, 4, 4, DARK_TRIM);
  rect(png, 96, 22, 4, 4, [80, 230, 90]);
  stroke(png, 96, 22, 4, 4, DARK_TRIM);
  rect(png, 96, 30, 4, 4, [255, 180, 50]);
  stroke(png, 96, 30, 4, 4, DARK_TRIM);
  rect(png, 96, 38, 4, 4, [60, 64, 72]);
  stroke(png, 96, 38, 4, 4, DARK_TRIM);
  // Alarm LED (red, off)
  rect(png, 96, 46, 4, 4, [100, 40, 40]);
  stroke(png, 96, 46, 4, 4, DARK_TRIM);
  // Warning sticker right
  warningSticker(png, 106, 10, 16, 12);
  // Nameplate
  nameplate(png, 106, 28, 16, 6);
  // Lower section: ventilation grille
  venting(png, 8, 58, 112, 28, DARK_TRIM, [80, 84, 92]);
  // Pipe connections at bottom corners
  pipeStub(png, 16, 90, 4, PIPE_COPPER);
  pipeStub(png, 112, 90, 4, PIPE_COPPER);
  // Flow direction labels
  rect(png, 22, 89, 8, 1, [60, 140, 220]);
  rect(png, 100, 89, 8, 1, [200, 100, 60]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'chiller_unit_front.png');
}

function chillerUnitSide() {
  const w = 96, h = 96;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [220, 225, 235]);
  rect(png, 0, 2, w, 3, TEAL_BODY);
  rect(png, 0, 2, w, 1, TEAL_HIGHLIGHT);
  // Large vent grille
  venting(png, 8, 12, 80, 60, DARK_TRIM, [80, 84, 92]);
  stroke(png, 7, 11, 82, 62, [160, 165, 175]);
  // Pipe stubs at bottom
  pipeStub(png, 24, 84, 4, PIPE_COPPER);
  pipeStub(png, 72, 84, 4, PIPE_COPPER);
  // Warning sticker
  warningSticker(png, 8, 78, 14, 10);
  // Nameplate
  nameplate(png, 60, 78, 28, 6);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'chiller_unit_side.png');
}

// ── FLOW METER ───────────────────────────────────────────────────────
// Small instrument: LCD readout, pipe connections top/bottom.
// Compact 32×32 for 1×1 footprint (visual is 0.35 scale).
function flowMeterFront() {
  const w = 32, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, TEAL_BODY);
  // LCD display area
  rect(png, 4, 4, 24, 12, DARK_TRIM);
  rect(png, 5, 5, 22, 10, [30, 50, 40]);
  // Flow rate digits
  rect(png, 7, 7, 4, 1, [80, 200, 255]);
  rect(png, 7, 10, 4, 1, [80, 200, 255]);
  rect(png, 7, 13, 4, 1, [80, 200, 255]);
  rect(png, 13, 7, 4, 1, [80, 200, 255]);
  rect(png, 13, 10, 4, 1, [80, 200, 255]);
  // Units label
  rect(png, 20, 10, 5, 1, [80, 200, 255]);
  // Status LED
  rect(png, 24, 6, 2, 2, [80, 230, 90]);
  // Pipe connections (in-line)
  pipeStub(png, 16, 22, 3, PIPE_STEEL);
  // Flow arrow
  px(png, 8, 22, 80, 180, 255);
  px(png, 9, 21, 80, 180, 255);
  px(png, 9, 23, 80, 180, 255);
  rect(png, 5, 22, 3, 1, [80, 180, 255]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'flow_meter_front.png');
}

// ── Main ──────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
coolantPumpFront();
coolantPumpSide();
heatExchangerFront();
heatExchangerSide();
pipeRackFront();
chillerUnitFront();
chillerUnitSide();
flowMeterFront();
console.log('done.');
