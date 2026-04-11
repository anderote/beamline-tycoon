#!/usr/bin/env node
// Reproject existing 2:1 isometric flat-content diamond tile PNGs into
// seamless 64×64 axis-aligned material textures using parametric
// diamond unprojection. Output goes to assets/textures/materials/
// prefixed with tile_.
//
// Run: node tools/asset-gen/gen-tiles-from-diamonds.cjs

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const TILES_DIR = path.join(__dirname, '..', '..', 'assets', 'tiles');
const OUT_DIR   = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');
const OUT_SIZE  = 64;

// Floor surface tiles only — these are flat-content 2:1 iso diamonds.
// Zone tiles (rfLab_0, etc.) are 3D scenes and excluded intentionally.
const SOURCES = [
  'brick.png',
  'cobblestone.png',
  'concrete.png',
  'dirt.png',
  'hallway.png',
  'labFloor.png',
  'officeFloor.png',
  'pavement.png',
];

function readPng(filePath) {
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function getPx(png, x, y) {
  // Clamp to image bounds.
  const cx = Math.max(0, Math.min(png.width - 1, x | 0));
  const cy = Math.max(0, Math.min(png.height - 1, y | 0));
  const idx = (cy * png.width + cx) * 4;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

function setPx(png, x, y, r, g, b, a = 255) {
  const idx = (y * png.width + x) * 4;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function processSource(filename) {
  const inPath = path.join(TILES_DIR, filename);
  if (!fs.existsSync(inPath)) {
    console.warn('skip (missing):', filename);
    return null;
  }

  const src = readPng(inPath);
  const W = src.width, H = src.height;

  // Sanity: warn if not roughly 2:1 (the iso ratio).
  const ratio = W / H;
  if (ratio < 1.7 || ratio > 2.3) {
    console.warn(`  ${filename}: unexpected aspect ratio ${W}x${H} (=${ratio.toFixed(2)}), expected ~2:1`);
  }

  // Pass 1: collect all opaque source pixels for fallback average.
  let aggR = 0, aggG = 0, aggB = 0, aggCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = getPx(src, x, y);
      if (a > 8) {
        aggR += r; aggG += g; aggB += b; aggCount++;
      }
    }
  }
  const avgR = aggCount > 0 ? Math.round(aggR / aggCount) : 128;
  const avgG = aggCount > 0 ? Math.round(aggG / aggCount) : 128;
  const avgB = aggCount > 0 ? Math.round(aggB / aggCount) : 128;

  // Pass 2: parametric diamond unprojection.
  // Diamond corners: TOP=(W/2, 0), RIGHT=(W, H/2), BOTTOM=(W/2, H), LEFT=(0, H/2)
  // For (u,v) in [0,1]²: dx = (W/2)*(1 + u - v), dy = (H/2)*(u + v)
  const out = new PNG({ width: OUT_SIZE, height: OUT_SIZE, colorType: 6 });
  for (let sy = 0; sy < OUT_SIZE; sy++) {
    for (let sx = 0; sx < OUT_SIZE; sx++) {
      const u = sx / OUT_SIZE;
      const v = sy / OUT_SIZE;
      let dx = (W / 2) * (1 + u - v);
      let dy = (H / 2) * (u + v);
      if (dx >= W) dx = W - 1;
      if (dy >= H) dy = H - 1;
      if (dx < 0) dx = 0;
      if (dy < 0) dy = 0;
      const [r, g, b, a] = getPx(src, dx, dy);
      if (a > 8) {
        setPx(out, sx, sy, r, g, b, 255);
      } else {
        setPx(out, sx, sy, avgR, avgG, avgB, 255);
      }
    }
  }

  const base = filename.replace(/\.png$/, '');
  const outName = 'tile_' + base + '.png';
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, PNG.sync.write(out));
  console.log('wrote', outPath);
  return base;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const generated = [];
for (const f of SOURCES) {
  const base = processSource(f);
  if (base) generated.push('tile_' + base);
}

console.log('\nGenerated', generated.length, 'tile materials:');
for (const name of generated) console.log('  ' + name);
console.log('\ndone.');
