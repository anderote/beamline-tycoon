#!/usr/bin/env node
// Procedural pixel-art front-panel decals for diagnostics lab equipment.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-diagnostics-decals.cjs
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
const GREEN_BODY      = [50, 100, 60];
const GREEN_HIGHLIGHT = [80, 140, 90];
const DARK_TRIM       = [40, 42, 48];
const SCREW_BODY      = [120, 124, 132];
const SCREW_SLOT      = [40, 42, 48];

// ── SCOPE STATION ───────────────────────────────────────────────────
// Standalone oscilloscope on a rolling cart. Tall unit with large
// waveform display, channel inputs, control knobs.
// 32×64 for visual 0.9W × 1.8H (tall).
function scopeStationFront() {
  const w = 32, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [210, 215, 220]);
  // Large waveform display (top half)
  rect(png, 3, 3, 26, 24, DARK_TRIM);
  rect(png, 4, 4, 24, 22, [10, 30, 20]);
  // Grid lines
  for (let gx = 0; gx < 5; gx++) rect(png, 6 + gx * 5, 5, 1, 20, [20, 45, 30]);
  for (let gy = 0; gy < 5; gy++) rect(png, 5, 6 + gy * 5, 22, 1, [20, 45, 30]);
  // Waveform (sine-ish trace)
  for (let x = 0; x < 22; x++) {
    const y = Math.round(14 + Math.sin(x * 0.6) * 6);
    px(png, 5 + x, y, 80, 230, 90);
    px(png, 5 + x, y + 1, 50, 160, 60);
  }
  // Second channel (dimmer)
  for (let x = 0; x < 22; x++) {
    const y = Math.round(14 + Math.cos(x * 0.4) * 4);
    px(png, 5 + x, y, 80, 180, 255);
  }
  // Control section (below display)
  rect(png, 3, 30, 26, 18, [190, 195, 200]);
  stroke(png, 3, 30, 26, 18, [160, 165, 170]);
  // Time/div knob (large)
  disc(png, 10, 36, 4, [80, 84, 92]);
  disc(png, 10, 36, 3, [120, 124, 132]);
  px(png, 10, 33, 200, 200, 210);
  // Volts/div knob
  disc(png, 22, 36, 3, [80, 84, 92]);
  disc(png, 22, 36, 2, [120, 124, 132]);
  px(png, 22, 34, 200, 200, 210);
  // Channel buttons row
  rect(png, 5, 42, 4, 3, [255, 200, 50]);
  rect(png, 11, 42, 4, 3, [80, 200, 255]);
  rect(png, 17, 42, 4, 3, [200, 80, 200]);
  rect(png, 23, 42, 4, 3, [80, 230, 90]);
  // BNC inputs at bottom
  rect(png, 3, 50, 26, 10, [170, 175, 180]);
  stroke(png, 3, 50, 26, 10, [140, 145, 150]);
  for (let i = 0; i < 4; i++) {
    disc(png, 7 + i * 6, 55, 2, [80, 84, 92]);
    disc(png, 7 + i * 6, 55, 1, DARK_TRIM);
  }
  // Channel labels under BNCs
  px(png, 7, 59, 255, 200, 50);
  px(png, 13, 59, 80, 200, 255);
  px(png, 19, 59, 200, 80, 200);
  px(png, 25, 59, 80, 230, 90);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'scope_station_front.png');
}

// ── WIRE SCANNER READOUT ─────────────────────────────────────────────
// Desktop instrument: beam profile display from wire scan, position
// readout, motor control. 56×32 for visual 1.6W × 0.8H.
function wireScannerBenchFront() {
  const w = 56, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [130, 132, 138]);
  rect(png, 0, 1, w, 1, [160, 165, 170]);
  // Beam profile display (left — main feature)
  rect(png, 3, 3, 26, 18, DARK_TRIM);
  rect(png, 4, 4, 24, 16, [10, 30, 20]);
  // Gaussian beam profile
  const profile = [1, 2, 4, 7, 10, 12, 14, 13, 11, 8, 5, 3, 1];
  for (let i = 0; i < profile.length; i++) {
    const bh = profile[i];
    rect(png, 6 + i, 18 - bh, 1, bh, [80, 230, 90]);
  }
  // X-axis
  rect(png, 5, 18, 22, 1, [40, 60, 45]);
  // Cursor line
  rect(png, 12, 5, 1, 13, [200, 40, 40]);
  // Position/width readout (right of display)
  rect(png, 32, 3, 20, 8, DARK_TRIM);
  rect(png, 33, 4, 18, 6, [30, 40, 35]);
  rect(png, 35, 5, 6, 1, [80, 230, 90]);
  rect(png, 35, 7, 10, 1, [80, 200, 255]);
  // Motor control section
  rect(png, 32, 14, 20, 8, [60, 64, 72]);
  stroke(png, 32, 14, 20, 8, [80, 84, 92]);
  // Scan / Stop buttons
  rect(png, 34, 16, 6, 4, [40, 160, 60]);
  rect(png, 42, 16, 6, 4, [200, 50, 50]);
  // Status LEDs at bottom
  rect(png, 4, 24, 2, 2, [80, 230, 90]);
  rect(png, 8, 24, 2, 2, [80, 230, 90]);
  rect(png, 12, 24, 2, 2, [255, 180, 50]);
  // BNC connectors
  for (let i = 0; i < 3; i++) {
    disc(png, 34 + i * 8, 26, 2, [80, 84, 92]);
    disc(png, 34 + i * 8, 26, 1, DARK_TRIM);
  }
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'wire_scanner_bench_front.png');
}

function wireScannerBenchSide() {
  const w = 32, h = 32;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [130, 132, 138]);
  rect(png, 0, 1, w, 1, [160, 165, 170]);
  // Vent grille
  venting(png, 4, 6, 24, 14, DARK_TRIM, [80, 84, 92]);
  // Cable connector at bottom
  rect(png, 10, 24, 12, 4, [60, 64, 72]);
  stroke(png, 10, 24, 12, 4, [80, 84, 92]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'wire_scanner_bench_side.png');
}

// ── BPM ELECTRONICS ─────────────────────────────────────────────────
// Desktop BPM signal processor: 4-channel position display, signal
// bars, BNC inputs. 64×36 for visual 1.8W × 1.0H.
function bpmTestFixtureFront() {
  const w = 64, h = 36;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GREEN_BODY);
  rect(png, 0, 1, w, 1, GREEN_HIGHLIGHT);
  // Position display (left — XY beam dot)
  rect(png, 3, 3, 22, 22, DARK_TRIM);
  rect(png, 4, 4, 20, 20, [10, 30, 20]);
  // Crosshair grid
  rect(png, 4, 14, 20, 1, [25, 45, 30]);
  rect(png, 14, 4, 1, 20, [25, 45, 30]);
  // Beam position dot (off-center)
  disc(png, 16, 12, 2, [200, 40, 40]);
  disc(png, 16, 12, 1, [255, 80, 80]);
  // Axis labels
  px(png, 23, 14, 80, 230, 90);
  px(png, 14, 3, 80, 200, 255);
  // 4-channel signal bars (right of position display)
  rect(png, 28, 3, 32, 22, [35, 38, 44]);
  stroke(png, 28, 3, 32, 22, [60, 64, 72]);
  // Channel bars with labels
  const chColors = [[80, 230, 90], [80, 200, 255], [255, 180, 50], [200, 80, 200]];
  const barW = [18, 14, 16, 12];
  for (let i = 0; i < 4; i++) {
    const by = 6 + i * 5;
    rect(png, 30, by, barW[i], 3, chColors[i]);
    // Channel label dot
    px(png, 56, by + 1, chColors[i][0], chColors[i][1], chColors[i][2]);
  }
  // Control panel (bottom strip)
  rect(png, 3, 27, 58, 6, [60, 64, 72]);
  stroke(png, 3, 27, 58, 6, [80, 84, 92]);
  // Gain knob
  disc(png, 10, 30, 2, [80, 84, 92]);
  disc(png, 10, 30, 1, [120, 124, 132]);
  // Mode buttons
  rect(png, 18, 28, 5, 3, [80, 84, 92]);
  rect(png, 25, 28, 5, 3, [40, 160, 60]);
  // BNC inputs (4 channels)
  for (let i = 0; i < 4; i++) {
    disc(png, 38 + i * 6, 30, 2, [80, 84, 92]);
    disc(png, 38 + i * 6, 30, 1, DARK_TRIM);
  }
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'bpm_test_fixture_front.png');
}

function bpmTestFixtureSide() {
  const w = 36, h = 36;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GREEN_BODY);
  rect(png, 0, 1, w, 1, GREEN_HIGHLIGHT);
  // Vent grille
  venting(png, 4, 6, 28, 16, DARK_TRIM, [40, 70, 45]);
  // Cable connector
  rect(png, 10, 26, 16, 6, [60, 64, 72]);
  stroke(png, 10, 26, 16, 6, [80, 84, 92]);
  screw(png, 2, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, 2, SCREW_BODY, SCREW_SLOT);
  screw(png, 2, h - 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 3, h - 3, SCREW_BODY, SCREW_SLOT);
  save(png, 'bpm_test_fixture_side.png');
}

// ── SERVER CLUSTER ──────────────────────────────────────────────────
// Multi-rack compute cluster: three side-by-side 19" racks with
// blade servers, networking, and blinking status LEDs.
// 96×96 for 3×2 footprint × subH 5 (tall racks).
function serverClusterFront() {
  const w = 96, h = 96;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Three rack bays
  for (let rack = 0; rack < 3; rack++) {
    const rx = 2 + rack * 32;
    // Rack frame
    rect(png, rx, 2, 28, 92, [50, 52, 58]);
    stroke(png, rx, 2, 28, 92, [70, 72, 80]);
    // Top rail
    rect(png, rx, 2, 28, 3, [80, 84, 92]);
    rect(png, rx, 91, 28, 3, [80, 84, 92]);
    // Blade servers (varying heights per rack)
    if (rack === 0) {
      // Compute nodes — 8 × 1U blades
      for (let i = 0; i < 8; i++) {
        const sy = 7 + i * 10;
        rect(png, rx + 2, sy, 24, 8, [30, 32, 38]);
        stroke(png, rx + 2, sy, 24, 8, [60, 64, 72]);
        // Vent slit
        rect(png, rx + 4, sy + 4, 10, 1, [20, 22, 28]);
        // LEDs
        rect(png, rx + 20, sy + 2, 2, 2, [80, 230, 90]);
        rect(png, rx + 23, sy + 2, 2, 2, i < 6 ? [80, 230, 90] : [255, 180, 50]);
        // Label strip
        rect(png, rx + 4, sy + 2, 8, 2, [180, 175, 155]);
      }
    } else if (rack === 1) {
      // Storage + GPU nodes — mixed sizes
      // 2U storage unit at top
      rect(png, rx + 2, 7, 24, 16, [35, 38, 44]);
      stroke(png, rx + 2, 7, 24, 16, [60, 64, 72]);
      // Disk activity LEDs (row)
      for (let d = 0; d < 8; d++) {
        const c = d < 5 ? [80, 230, 90] : [60, 64, 72];
        rect(png, rx + 4 + d * 3, 10, 2, 2, c);
      }
      rect(png, rx + 4, 17, 12, 2, [180, 175, 155]);
      // 4U GPU chassis
      rect(png, rx + 2, 27, 24, 24, [25, 28, 34]);
      stroke(png, rx + 2, 27, 24, 24, [60, 64, 72]);
      venting(png, rx + 4, 32, 20, 14, [15, 18, 24], [35, 38, 44]);
      rect(png, rx + 4, 29, 12, 2, [180, 175, 155]);
      rect(png, rx + 20, 30, 2, 2, [80, 200, 255]);
      // 4 more 1U blades below
      for (let i = 0; i < 4; i++) {
        const sy = 55 + i * 10;
        rect(png, rx + 2, sy, 24, 8, [30, 32, 38]);
        stroke(png, rx + 2, sy, 24, 8, [60, 64, 72]);
        rect(png, rx + 4, sy + 4, 10, 1, [20, 22, 28]);
        rect(png, rx + 20, sy + 2, 2, 2, [80, 230, 90]);
        rect(png, rx + 23, sy + 2, 2, 2, [80, 230, 90]);
        rect(png, rx + 4, sy + 2, 8, 2, [180, 175, 155]);
      }
    } else {
      // Network + infrastructure rack
      // Network switches (3 × 1U)
      for (let i = 0; i < 3; i++) {
        const sy = 7 + i * 10;
        rect(png, rx + 2, sy, 24, 8, [30, 32, 38]);
        stroke(png, rx + 2, sy, 24, 8, [60, 64, 72]);
        // Port row
        for (let p = 0; p < 8; p++) {
          rect(png, rx + 4 + p * 2 + (p >= 4 ? 1 : 0), sy + 2, 1, 2, [20, 22, 28]);
        }
        // Link LEDs
        for (let p = 0; p < 8; p++) {
          const c = p % 3 === 0 ? [255, 180, 50] : [80, 230, 90];
          px(png, rx + 4 + p * 2 + (p >= 4 ? 1 : 0), sy + 5, c[0], c[1], c[2]);
        }
      }
      // Patch panel
      rect(png, rx + 2, 40, 24, 8, [50, 52, 58]);
      stroke(png, rx + 2, 40, 24, 8, [70, 72, 80]);
      for (let p = 0; p < 10; p++) {
        disc(png, rx + 5 + p * 2, 44, 1, [80, 180, 255]);
      }
      // UPS (large, bottom)
      rect(png, rx + 2, 52, 24, 28, [45, 48, 54]);
      stroke(png, rx + 2, 52, 24, 28, [60, 64, 72]);
      // UPS LCD
      rect(png, rx + 6, 56, 16, 8, DARK_TRIM);
      rect(png, rx + 7, 57, 14, 6, [30, 50, 40]);
      rect(png, rx + 9, 59, 6, 1, [80, 230, 90]);
      rect(png, rx + 9, 61, 10, 1, [80, 200, 255]);
      // UPS status
      rect(png, rx + 8, 68, 2, 2, [80, 230, 90]);
      rect(png, rx + 12, 68, 2, 2, [80, 230, 90]);
      rect(png, rx + 16, 68, 2, 2, [60, 64, 72]);
      // Battery indicator
      rect(png, rx + 6, 74, 16, 4, DARK_TRIM);
      rect(png, rx + 7, 75, 12, 2, [80, 230, 90]);
    }
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'server_cluster_front.png');
}

function serverClusterSide() {
  const w = 64, h = 96;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, DARK_TRIM);
  // Side panel
  rect(png, 4, 4, 56, 88, [50, 52, 58]);
  stroke(png, 4, 4, 56, 88, [70, 72, 80]);
  // Large ventilation grille (exhaust)
  venting(png, 8, 8, 48, 56, [25, 28, 34], [45, 48, 54]);
  stroke(png, 7, 7, 50, 58, [80, 84, 92]);
  // Cable management panel at bottom
  rect(png, 8, 70, 48, 16, [35, 38, 44]);
  stroke(png, 8, 70, 48, 16, [60, 64, 72]);
  // Cable bundles
  for (let i = 0; i < 5; i++) {
    disc(png, 14 + i * 10, 78, 3, [30, 32, 38]);
    disc(png, 14 + i * 10, 78, 2, [20, 22, 28]);
  }
  // Airflow arrow
  for (let i = 0; i < 6; i++) {
    px(png, 30 + i, 36, 100, 180, 255);
  }
  px(png, 35, 34, 100, 180, 255);
  px(png, 35, 38, 100, 180, 255);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'server_cluster_side.png');
}

// ── Main ──────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
scopeStationFront();
wireScannerBenchFront();
wireScannerBenchSide();
bpmTestFixtureFront();
bpmTestFixtureSide();
serverClusterFront();
serverClusterSide();
console.log('done.');
