#!/usr/bin/env node
// Procedural pixel-art seamless texture generator.
// Outputs 64×64 PNGs to assets/textures/materials/.
// Run: node tools/asset-gen/gen-materials.cjs
//
// All textures are seamless (left/right and top/bottom edges wrap).
// Palette is intentionally muted/desaturated to match RCT2 pixel-art feel.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 64;
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');

// ── Deterministic PRNG so re-runs produce identical output ────────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePng() {
  return new PNG({ width: SIZE, height: SIZE, colorType: 6 });
}

function setPx(png, x, y, r, g, b, a = 255) {
  const idx = ((y % SIZE) * SIZE + (x % SIZE)) * 4;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function writePng(png, name) {
  const out = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
}

// ── Generators ────────────────────────────────────────────────────────

function gen_solidNoise(name, baseRGB, noiseAmp, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = (rand() - 0.5) * noiseAmp;
      setPx(png, x, y,
        Math.max(0, Math.min(255, baseRGB[0] + n)),
        Math.max(0, Math.min(255, baseRGB[1] + n)),
        Math.max(0, Math.min(255, baseRGB[2] + n)));
    }
  }
  writePng(png, name);
}

function gen_speckled(name, baseRGB, speckleRGB, density, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (rand() < density) {
        setPx(png, x, y, speckleRGB[0], speckleRGB[1], speckleRGB[2]);
      } else {
        const n = (rand() - 0.5) * 12;
        setPx(png, x, y,
          Math.max(0, Math.min(255, baseRGB[0] + n)),
          Math.max(0, Math.min(255, baseRGB[1] + n)),
          Math.max(0, Math.min(255, baseRGB[2] + n)));
      }
    }
  }
  writePng(png, name);
}

function gen_brushed(name, baseRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  // Horizontal brush lines: each row picks a brightness offset that varies
  // smoothly along X via low-frequency noise.
  const rowOffsets = new Array(SIZE);
  for (let y = 0; y < SIZE; y++) rowOffsets[y] = (rand() - 0.5) * 30;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Horizontal grain: brightness varies slowly in x
      const grain = Math.sin(x * 0.4 + y * 0.05) * 6;
      const n = rowOffsets[y] + grain + (rand() - 0.5) * 6;
      setPx(png, x, y,
        Math.max(0, Math.min(255, baseRGB[0] + n)),
        Math.max(0, Math.min(255, baseRGB[1] + n)),
        Math.max(0, Math.min(255, baseRGB[2] + n)));
    }
  }
  writePng(png, name);
}

function gen_grid(name, bgRGB, lineRGB, cellSize, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const onLine = (x % cellSize === 0) || (y % cellSize === 0);
      if (onLine) {
        setPx(png, x, y, lineRGB[0], lineRGB[1], lineRGB[2]);
      } else {
        const n = (rand() - 0.5) * 8;
        setPx(png, x, y,
          Math.max(0, Math.min(255, bgRGB[0] + n)),
          Math.max(0, Math.min(255, bgRGB[1] + n)),
          Math.max(0, Math.min(255, bgRGB[2] + n)));
      }
    }
  }
  writePng(png, name);
}

function gen_mesh(name, holeRGB, frameRGB, holeSize, seed) {
  // Vent mesh — small dark holes on a metal frame, regular grid.
  const png = makePng();
  const rand = mulberry32(seed);
  const period = holeSize * 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ix = x % period;
      const iy = y % period;
      const inHole = ix < holeSize && iy < holeSize;
      if (inHole) {
        setPx(png, x, y, holeRGB[0], holeRGB[1], holeRGB[2]);
      } else {
        const n = (rand() - 0.5) * 10;
        setPx(png, x, y,
          Math.max(0, Math.min(255, frameRGB[0] + n)),
          Math.max(0, Math.min(255, frameRGB[1] + n)),
          Math.max(0, Math.min(255, frameRGB[2] + n)));
      }
    }
  }
  writePng(png, name);
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Metals
gen_brushed('metal_dark',          [55, 58, 66],   1);
gen_brushed('metal_brushed',       [140, 145, 155], 2);
gen_solidNoise('metal_painted_white', [220, 222, 218], 18, 3);
gen_brushed('copper',              [180, 110, 50], 4);

// Concretes / drywall
gen_speckled('concrete_floor',     [150, 148, 142], [100, 98, 92], 0.04, 5);
gen_speckled('concrete_wall',      [180, 178, 172], [130, 128, 122], 0.03, 6);
gen_solidNoise('drywall_painted',  [232, 230, 224], 10, 7);

// Rubber
gen_solidNoise('rubber_mat',       [40, 42, 44], 14, 8);

// Tile
gen_grid('tile_floor_white',       [225, 225, 222], [180, 180, 178], 16, 9);

// Vent mesh + cable tray
gen_mesh('rack_vent_mesh',         [20, 20, 22], [90, 92, 100], 4, 10);
gen_grid('cable_tray',             [120, 120, 124], [60, 60, 64], 8, 11);

console.log('done.');
