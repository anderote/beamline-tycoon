#!/usr/bin/env node
// Extract seamless 64x64 material textures from the existing isometric
// diamond tile PNGs in assets/tiles/. The diamond's interior pixel art
// is the source; we extract the inscribed axis-aligned square and
// nearest-neighbor upscale to 64x64. Output goes to
// assets/textures/materials/tile_<basename>.png.
//
// Run: node tools/asset-gen/gen-tiles-from-diamonds.cjs

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const TILES_DIR = path.join(__dirname, '..', '..', 'assets', 'tiles');
const OUT_DIR   = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');
const OUT_SIZE  = 64;

const SOURCES = [
  // Zone tiles
  'controlRoom_0.png',
  'machineShop_0.png',
  'maintenance_0.png',
  'officeSpace_0.png',
  'rfLab_0.png',
  'vacuumLab_0.png',
  // Floor surface tiles
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
  const idx = (y * png.width + x) * 4;
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

  // Inscribed axis-aligned square: side = floor(min(W, H) / 2), centered.
  const side = Math.floor(Math.min(W, H) / 2);
  const x0 = Math.floor((W - side) / 2);
  const y0 = Math.floor((H - side) / 2);

  console.log(`  ${filename}: ${W}x${H}, inscribed square ${side}x${side} at (${x0},${y0})`);

  // Compute average opaque color across the inscribed square as a fallback.
  let aggR = 0, aggG = 0, aggB = 0, aggCount = 0;
  for (let y = y0; y < y0 + side; y++) {
    for (let x = x0; x < x0 + side; x++) {
      const [r, g, b, a] = getPx(src, x, y);
      if (a > 8) {
        aggR += r; aggG += g; aggB += b; aggCount++;
      }
    }
  }
  const avgR = aggCount > 0 ? Math.round(aggR / aggCount) : 128;
  const avgG = aggCount > 0 ? Math.round(aggG / aggCount) : 128;
  const avgB = aggCount > 0 ? Math.round(aggB / aggCount) : 128;

  // Build the 64x64 output via nearest-neighbor upscale of the inscribed square.
  const out = new PNG({ width: OUT_SIZE, height: OUT_SIZE, colorType: 6 });
  for (let oy = 0; oy < OUT_SIZE; oy++) {
    for (let ox = 0; ox < OUT_SIZE; ox++) {
      const sx = x0 + Math.floor(ox * side / OUT_SIZE);
      const sy = y0 + Math.floor(oy * side / OUT_SIZE);
      const [r, g, b, a] = getPx(src, sx, sy);
      if (a > 8) {
        setPx(out, ox, oy, r, g, b, 255);
      } else {
        // Transparent pixel inside the inscribed square — fall back to avg color.
        setPx(out, ox, oy, avgR, avgG, avgB, 255);
      }
    }
  }

  // Output filename: strip _0 and extension, add tile_ prefix
  const base = filename.replace(/_0\.png$/, '').replace(/\.png$/, '');
  const outName = 'tile_' + base + '.png';
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, PNG.sync.write(out));
  console.log('wrote', outPath);
  return 'tile_' + base;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const generated = [];
for (const f of SOURCES) {
  const name = processSource(f);
  if (name) generated.push(name);
}

console.log('\nGenerated', generated.length, 'tile materials:');
for (const name of generated) console.log('  ' + name);
console.log('\ndone.');
