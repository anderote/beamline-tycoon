#!/usr/bin/env node
// Procedural face textures for 3D decoration models.
// These get applied to the flat front face of signs, bin fronts, and flag quad.
// Run: node tools/asset-gen/gen-decoration-faces.cjs

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'decorations');

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePng(w, h) { return new PNG({ width: w, height: h, colorType: 6 }); }

function setPx(png, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (y * png.width + x) * 4;
  png.data[idx] = Math.max(0, Math.min(255, r | 0));
  png.data[idx + 1] = Math.max(0, Math.min(255, g | 0));
  png.data[idx + 2] = Math.max(0, Math.min(255, b | 0));
  png.data[idx + 3] = a;
}
function getPx(png, x, y) {
  const idx = (y * png.width + x) * 4;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}
function fill(png, r, g, b, a = 255) {
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) setPx(png, x, y, r, g, b, a);
}
function rect(png, x0, y0, w, h, r, g, b, a = 255) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPx(png, x0 + dx, y0 + dy, r, g, b, a);
}
function rectOutline(png, x0, y0, w, h, r, g, b, thick = 1) {
  for (let t = 0; t < thick; t++) {
    for (let dx = 0; dx < w; dx++) {
      setPx(png, x0 + dx, y0 + t, r, g, b);
      setPx(png, x0 + dx, y0 + h - 1 - t, r, g, b);
    }
    for (let dy = 0; dy < h; dy++) {
      setPx(png, x0 + t, y0 + dy, r, g, b);
      setPx(png, x0 + w - 1 - t, y0 + dy, r, g, b);
    }
  }
}
function disc(png, cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) setPx(png, cx + dx, cy + dy, r, g, b, a);
    }
  }
}
function line(png, x0, y0, x1, y1, r, g, b, a = 255) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    setPx(png, x, y, r, g, b, a);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}
function noiseLayer(png, rng, intensity) {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const [cr, cg, cb, ca] = getPx(png, x, y);
      if (ca === 0) continue;
      const n = (rng() - 0.5) * intensity;
      setPx(png, x, y, cr + n, cg + n, cb + n, ca);
    }
  }
}
function writePng(png, name) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
}

// Simple pixel font for short labels — 5×7 monospace glyphs for A-Z, 0-9, a few symbols.
// Only supports uppercase letters, digits, and space. Returns 2D bit array.
const FONT = {
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01110','10001','10000','10000','10000','10001','01110'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01110','10001','10000','10111','10001','10001','01110'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00001','00001','00001','00001','00001','10001','01110'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10101','10011','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','11011','10001'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','10001','01010','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00110','01000','10000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','00100','00100','00100'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '?': ['01110','10001','00001','00110','00100','00000','00100'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
};

function drawText(png, text, x, y, r, g, b, scale = 1) {
  const chars = text.toUpperCase().split('');
  let cx = x;
  for (const ch of chars) {
    const glyph = FONT[ch] || FONT['?'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPx(png, cx + col * scale + sx, y + row * scale + sy, r, g, b);
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

// ── Info sign face (128×96) ───────────────────────────────────────────
// Blue board with white "INFO" / "i" symbol — readable on a sign quad.
function genInfoSign() {
  const png = makePng(128, 96);
  const rng = mulberry32(6001);
  // Blue board
  fill(png, 0x22, 0x56, 0xa8);
  // Inner panel lighter
  rect(png, 6, 6, 116, 84, 0x2e, 0x66, 0xc0);
  // White border
  rectOutline(png, 6, 6, 116, 84, 0xff, 0xff, 0xff, 2);
  // Circular "i" emblem (left half)
  const cx = 36, cy = 48;
  disc(png, cx, cy, 22, 0xff, 0xff, 0xff);
  disc(png, cx, cy, 19, 0x2e, 0x66, 0xc0);
  // Dot of the i
  disc(png, cx, cy - 10, 3, 0xff, 0xff, 0xff);
  // Body of the i
  rect(png, cx - 2, cy - 4, 5, 14, 0xff, 0xff, 0xff);
  // "INFO" text right half
  drawText(png, 'INFO', 70, 30, 0xff, 0xff, 0xff, 2);
  // Subline
  drawText(png, 'CENTER', 70, 58, 0xee, 0xee, 0xee, 1);
  noiseLayer(png, rng, 6);
  writePng(png, 'info_sign_face');
}

// ── Direction sign face (128×64) ──────────────────────────────────────
// Green board with white arrow + text.
function genDirectionSign() {
  const png = makePng(128, 64);
  const rng = mulberry32(6002);
  fill(png, 0x2a, 0x78, 0x40);
  rect(png, 4, 4, 120, 56, 0x36, 0x88, 0x4c);
  rectOutline(png, 4, 4, 120, 56, 0xff, 0xff, 0xff, 2);
  // Left-pointing arrow (triangle)
  const ax = 14, ay = 32;
  for (let dx = 0; dx < 20; dx++) {
    const half = Math.round((1 - dx / 20) * 14);
    for (let dy = -half; dy <= half; dy++) {
      setPx(png, ax + dx, ay + dy, 0xff, 0xff, 0xff);
    }
  }
  // Arrow shaft
  rect(png, 28, 28, 18, 8, 0xff, 0xff, 0xff);
  // Text right side
  drawText(png, 'EXIT', 56, 22, 0xff, 0xff, 0xff, 2);
  // Distance
  drawText(png, '200M', 56, 42, 0xee, 0xee, 0xdd, 1);
  noiseLayer(png, rng, 6);
  writePng(png, 'direction_sign_face');
}

// ── Trash can label (96×64) ───────────────────────────────────────────
// Dark ring label with "TRASH" text and a simple trash-bag icon.
function genTrashLabel() {
  const png = makePng(96, 64);
  const rng = mulberry32(6003);
  // Dark gray background with subtle gradient
  fill(png, 0x3a, 0x3a, 0x40);
  for (let y = 0; y < 64; y++) {
    const shade = Math.round(Math.sin(y * 0.1) * 4);
    for (let x = 0; x < 96; x++) {
      const [cr, cg, cb] = getPx(png, x, y);
      setPx(png, x, y, cr + shade, cg + shade, cb + shade);
    }
  }
  // Yellow trim bands
  rect(png, 0, 4, 96, 3, 0xee, 0xcc, 0x22);
  rect(png, 0, 56, 96, 3, 0xee, 0xcc, 0x22);
  // Trash icon — simple bin silhouette
  const ix = 14, iy = 18;
  rect(png, ix, iy + 4, 20, 24, 0xdd, 0xdd, 0xdd);
  rect(png, ix - 2, iy + 2, 24, 3, 0xdd, 0xdd, 0xdd);
  rect(png, ix + 6, iy, 8, 3, 0xdd, 0xdd, 0xdd);
  // Vertical slats on bin
  for (let vx = ix + 4; vx < ix + 20; vx += 4) {
    for (let vy = iy + 6; vy < iy + 26; vy++) {
      setPx(png, vx, vy, 0x99, 0x99, 0x99);
    }
  }
  // Text
  drawText(png, 'TRASH', 40, 22, 0xee, 0xee, 0xee, 2);
  noiseLayer(png, rng, 5);
  writePng(png, 'trash_can_label');
}

// ── Recycling bin label (96×64) ───────────────────────────────────────
// Green background with triangular recycling arrows.
function genRecyclingLabel() {
  const png = makePng(96, 64);
  const rng = mulberry32(6004);
  fill(png, 0x20, 0x7a, 0x32);
  for (let y = 0; y < 64; y++) {
    const shade = Math.round(Math.sin(y * 0.1) * 4);
    for (let x = 0; x < 96; x++) {
      const [cr, cg, cb] = getPx(png, x, y);
      setPx(png, x, y, cr + shade, cg + shade, cb + shade);
    }
  }
  rect(png, 0, 4, 96, 3, 0xee, 0xee, 0xee);
  rect(png, 0, 56, 96, 3, 0xee, 0xee, 0xee);
  // Triangular recycling symbol (3 chasing arrows in a triangle)
  const cx = 24, cy = 32, r = 14;
  const w = 0xff, b = 0xff;
  // Three arrow segments forming a triangle — simple white lines
  const pts = [
    [cx, cy - r], [cx + r, cy + r * 0.6], [cx - r, cy + r * 0.6],
  ];
  for (let i = 0; i < 3; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % 3];
    line(png, x0 | 0, y0 | 0, x1 | 0, y1 | 0, w, w, b);
    line(png, (x0 + 1) | 0, y0 | 0, (x1 + 1) | 0, y1 | 0, w, w, b);
    line(png, x0 | 0, (y0 + 1) | 0, x1 | 0, (y1 + 1) | 0, w, w, b);
  }
  // Arrow heads at corners
  for (const [x, y] of pts) {
    disc(png, x | 0, y | 0, 2, 0xff, 0xff, 0xff);
  }
  // Text
  drawText(png, 'RECYCLE', 44, 28, 0xff, 0xff, 0xff, 1);
  noiseLayer(png, rng, 5);
  writePng(png, 'recycling_bin_label');
}

// ── Flag (128×80) ─────────────────────────────────────────────────────
// Stylized flag: red/white stripes with a blue canton with stars.
function genFlag() {
  const png = makePng(128, 80);
  const rng = mulberry32(6005);
  // Stripes
  const stripeH = 10;
  for (let i = 0; i < 8; i++) {
    const y0 = i * stripeH;
    const [r, g, b] = (i & 1) ? [0xee, 0xee, 0xee] : [0xc8, 0x28, 0x38];
    rect(png, 0, y0, 128, stripeH, r, g, b);
  }
  // Canton
  rect(png, 0, 0, 56, 40, 0x1e, 0x3a, 0x88);
  // Star pattern
  for (let sy = 4; sy < 40; sy += 8) {
    for (let sx = 6; sx < 56; sx += 10) {
      const ox = ((sy / 8) | 0) & 1 ? 0 : 5;
      const cx = sx + ox;
      if (cx >= 52) continue;
      setPx(png, cx, sy + 3, 0xff, 0xff, 0xff);
      setPx(png, cx - 1, sy + 3, 0xff, 0xff, 0xff);
      setPx(png, cx + 1, sy + 3, 0xff, 0xff, 0xff);
      setPx(png, cx, sy + 2, 0xff, 0xff, 0xff);
      setPx(png, cx, sy + 4, 0xff, 0xff, 0xff);
    }
  }
  // Subtle drape ripple shading
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 128; x++) {
      const ripple = Math.round(Math.sin((x + y * 0.4) * 0.18) * 5);
      const [cr, cg, cb] = getPx(png, x, y);
      setPx(png, x, y, cr + ripple, cg + ripple, cb + ripple);
    }
  }
  noiseLayer(png, rng, 4);
  writePng(png, 'flag');
}

genInfoSign();
genDirectionSign();
genTrashLabel();
genRecyclingLabel();
genFlag();
console.log('Done – 5 decoration face textures generated.');
