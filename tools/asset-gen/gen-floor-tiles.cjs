#!/usr/bin/env node
// Hand-authored procedural generators for all floor-surface materials.
// Each function below produces a 64×64 seamless RGBA PNG to
// assets/textures/materials/.
//
// Run: node tools/asset-gen/gen-floor-tiles.cjs
//
// At TEXEL_SCALE=32, 64 texture pixels = 2 world meters, so any 32-pixel
// feature is ~1m in world space. Sized accordingly:
//   tile_labFloor:    2×2 grid of 32×32 epoxy tiles (1m tiles)
//   tile_concrete:    speckled aggregate, no grid
//   tile_officeFloor: fine carpet fiber noise, no grid
//   tile_brick:       red running-bond brick courses (16×8 per brick)
//   tile_cobblestone: irregular small stones on light gray
//   tile_dirt:        warm packed earth, speckled
//   tile_pavement:    dark asphalt slabs with joint lines

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 64;
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');

// ── Deterministic PRNG (so reruns are stable) ────────────────────────
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
  // Wrap coordinates so callers can be sloppy and the texture stays seamless.
  const xx = ((x % SIZE) + SIZE) % SIZE;
  const yy = ((y % SIZE) + SIZE) % SIZE;
  const idx = (yy * SIZE + xx) * 4;
  png.data[idx] = Math.max(0, Math.min(255, r | 0));
  png.data[idx + 1] = Math.max(0, Math.min(255, g | 0));
  png.data[idx + 2] = Math.max(0, Math.min(255, b | 0));
  png.data[idx + 3] = a;
}

function writePng(png, name) {
  const out = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
}

// ── tile_labFloor: light blue-gray linoleum subtiles ────────────────
// 4×4 grid of 16×16 subtiles (each subtile = 0.5m at TEXEL_SCALE=32).
// Dotted grout lines between subtiles (every other pixel along the seam).
function gen_labFloor() {
  const png = makePng();
  const rand = mulberry32(101);
  const baseR = 175, baseG = 188, baseB = 208;
  const groutR = 130, groutG = 142, groutB = 162;
  const SUBTILE = 16;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tx = x % SUBTILE;
      const ty = y % SUBTILE;
      // Subtile seam: right edge or bottom edge of each subtile.
      const onSeam = (tx === SUBTILE - 1) || (ty === SUBTILE - 1);
      if (onSeam) {
        // Dotted: every other pixel along the seam is grout, the rest base.
        const seamPos = (tx === SUBTILE - 1) ? y : x;
        if (seamPos % 2 === 0) {
          const n = (rand() - 0.5) * 6;
          setPx(png, x, y, groutR + n, groutG + n, groutB + n);
          continue;
        }
        // fall through to base for the off-pixel
      }
      // Subtle per-pixel noise on the linoleum surface.
      const n = (rand() - 0.5) * 10;
      setPx(png, x, y, baseR + n, baseG + n, baseB + n);
    }
  }
  writePng(png, 'tile_labFloor');
}

// ── tile_concrete: medium-gray speckled aggregate ────────────────────
// Flat base color (no low-frequency variation) plus per-pixel noise and
// scattered aggregate flecks. The previous sin-blob version read as wavy.
function gen_concrete() {
  const png = makePng();
  const rand = mulberry32(202);
  const baseR = 152, baseG = 152, baseB = 150;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = (rand() - 0.5) * 14;
      setPx(png, x, y, baseR + n, baseG + n, baseB + n - 1);
    }
  }
  const total = SIZE * SIZE;
  // Dark aggregate flecks (~5%)
  for (let i = 0; i < total * 0.05; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    const v = 80 + Math.floor(rand() * 25);
    setPx(png, x, y, v, v, v - 4);
    if (rand() < 0.3) setPx(png, x + 1, y, v + 5, v + 5, v + 1);
  }
  // Bright highlights (~1.5%)
  for (let i = 0; i < total * 0.015; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    const v = 195 + Math.floor(rand() * 20);
    setPx(png, x, y, v, v, v - 6);
  }
  writePng(png, 'tile_concrete');
}

// ── tile_officeFloor: tan carpet, fine fiber noise ───────────────────
function gen_officeFloor() {
  const png = makePng();
  const rand = mulberry32(303);
  const baseR = 187, baseG = 165, baseB = 130;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Fine high-frequency noise — looks like carpet pile when small
      // and varied per channel (slight color shift = warmth variation).
      const n = (rand() - 0.5) * 22;
      // Slight per-channel offset so the noise reads warm/cool not gray.
      const nr = n + (rand() - 0.5) * 6;
      const ng = n + (rand() - 0.5) * 4;
      const nb = n + (rand() - 0.5) * 4;
      setPx(png, x, y, baseR + nr, baseG + ng, baseB + nb);
    }
  }
  // Sparse darker fibers (~3%) and lighter fibers (~3%) for texture variety.
  const total = SIZE * SIZE;
  for (let i = 0; i < total * 0.03; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    setPx(png, x, y, 150, 130, 100);
  }
  for (let i = 0; i < total * 0.03; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    setPx(png, x, y, 215, 190, 155);
  }
  writePng(png, 'tile_officeFloor');
}

// ── tile_brick: red running-bond brick courses ───────────────────────
function gen_brick() {
  const png = makePng();
  const rand = mulberry32(404);
  // Brick parameters: 16×8 per brick, 4×8 grid in 64×64.
  // Even rows align to grid; odd rows offset by half a brick (8px).
  const BW = 16, BH = 8;
  // Mortar (between bricks)
  const mortarR = 142, mortarG = 132, mortarB = 118;
  // Brick base (with per-brick variation)
  const brickPalette = [
    [165, 75, 55],
    [150, 68, 50],
    [175, 82, 60],
    [155, 70, 48],
    [145, 60, 42],
    [170, 78, 58],
  ];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const row = Math.floor(y / BH);
      const offset = (row % 2 === 0) ? 0 : BW / 2; // half-brick offset on odd rows
      const xx = ((x - offset) % SIZE + SIZE) % SIZE; // wrap negative
      const col = Math.floor(xx / BW);
      const tx = xx % BW;
      const ty = y % BH;

      // Mortar lines: 1 pixel between bricks (right edge and bottom edge of each brick).
      const onMortar = (tx === BW - 1) || (ty === BH - 1);
      if (onMortar) {
        const n = (rand() - 0.5) * 8;
        setPx(png, x, y, mortarR + n, mortarG + n, mortarB + n);
        continue;
      }
      // Pick a per-brick color (deterministic by brick id, but with per-pixel noise).
      const brickId = (row * 8 + col) % brickPalette.length;
      const [br, bg, bb] = brickPalette[brickId];
      // Subtle highlight: bricks slightly brighter at top (top 2 rows of pixels).
      const highlight = (ty < 2) ? 6 : 0;
      const n = (rand() - 0.5) * 12;
      setPx(png, x, y,
        br + highlight + n,
        bg + highlight + n,
        bb + highlight + n);
    }
  }
  writePng(png, 'tile_brick');
}

// ── tile_cobblestone: small irregular stones on light gray ───────────
function gen_cobblestone() {
  const png = makePng();
  const rand = mulberry32(505);
  // Light gray base.
  const baseR = 158, baseG = 156, baseB = 152;
  // Fill background.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = (rand() - 0.5) * 12;
      setPx(png, x, y, baseR + n, baseG + n, baseB + n);
    }
  }
  // Scatter stones: each stone is a 3-5 px irregular blob in a slightly
  // darker or different shade. Total ~80 stones across 64×64.
  const stoneCount = 80;
  for (let s = 0; s < stoneCount; s++) {
    const cx = Math.floor(rand() * SIZE);
    const cy = Math.floor(rand() * SIZE);
    const radius = 1 + Math.floor(rand() * 2); // 1 or 2
    // Stone color: variations on darker gray with occasional warm or cool tints.
    const tone = rand();
    let sr, sg, sb;
    if (tone < 0.6) {
      // Standard dark gray stone
      const v = 80 + Math.floor(rand() * 30);
      sr = v; sg = v; sb = v - 4;
    } else if (tone < 0.85) {
      // Warm tinted stone (sandstone-ish)
      const v = 110 + Math.floor(rand() * 25);
      sr = v + 8; sg = v; sb = v - 8;
    } else {
      // Lighter pebble
      const v = 175 + Math.floor(rand() * 20);
      sr = v; sg = v - 2; sb = v - 6;
    }
    // Draw a small irregular blob: fill pixels within radius with some noise.
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius + 0.5) continue;
        // Skip ~25% of edge pixels to make the blob irregular.
        if (d2 >= radius * radius - 0.5 && rand() < 0.4) continue;
        const n = (rand() - 0.5) * 14;
        setPx(png, cx + dx, cy + dy, sr + n, sg + n, sb + n);
      }
    }
  }
  writePng(png, 'tile_cobblestone');
}

// ── tile_dirt: warm packed earth, speckled ───────────────────────────
// Flat base, per-pixel noise, sparse dark grit and light grains. The
// previous sin-blob version read as wavy patches.
function gen_dirt() {
  const png = makePng();
  const rand = mulberry32(606);
  const baseR = 150, baseG = 115, baseB = 75;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = (rand() - 0.5) * 18;
      setPx(png, x, y, baseR + n, baseG + n, baseB + n);
    }
  }
  const total = SIZE * SIZE;
  // Dark grit (~4%)
  for (let i = 0; i < total * 0.04; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    setPx(png, x, y, 80, 58, 38);
  }
  // Light grains (~3%)
  for (let i = 0; i < total * 0.03; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    setPx(png, x, y, 195, 158, 110);
  }
  writePng(png, 'tile_dirt');
}

// ── tile_pavement: dark asphalt slabs with joint lines ───────────────
function gen_pavement() {
  const png = makePng();
  const rand = mulberry32(707);
  const baseR = 105, baseG = 105, baseB = 108;
  // Dark joint color.
  const jointR = 50, jointG = 50, jointB = 55;
  // Slab grid: 32×32 slabs (so a 2×2 grid in 64×64). Joint = 1 px wide on
  // the right and bottom edges of each slab.
  const SLAB = 32;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tx = x % SLAB;
      const ty = y % SLAB;
      const onJoint = (tx === SLAB - 1) || (ty === SLAB - 1);
      if (onJoint) {
        const n = (rand() - 0.5) * 6;
        setPx(png, x, y, jointR + n, jointG + n, jointB + n);
        continue;
      }
      // Asphalt aggregate: dense fine speckle.
      const n = (rand() - 0.5) * 16;
      setPx(png, x, y, baseR + n, baseG + n, baseB + n);
    }
  }
  // Sparse brighter aggregate flecks (~2%) for variety.
  const total = SIZE * SIZE;
  for (let i = 0; i < total * 0.02; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    // Skip if on a joint line.
    if (x % SLAB === SLAB - 1 || y % SLAB === SLAB - 1) continue;
    const v = 145 + Math.floor(rand() * 25);
    setPx(png, x, y, v, v, v + 2);
  }
  writePng(png, 'tile_pavement');
}

// ── tile_groomedGrass: dense lawn pixel-blade noise ──────────────────
function gen_groomedGrass() {
  const png = makePng();
  const rand = mulberry32(808);
  const baseR = 80, baseG = 130, baseB = 50;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Strong per-pixel noise to read as individual grass blades.
      const n = (rand() - 0.5) * 24;
      // Per-channel jitter shifts hue slightly so noise looks organic.
      const nr = n + (rand() - 0.5) * 6;
      const ng = n + (rand() - 0.5) * 8;
      const nb = n + (rand() - 0.5) * 4;
      setPx(png, x, y, baseR + nr, baseG + ng, baseB + nb);
    }
  }
  // Sparse darker blades (~5%) and lighter blades (~5%) for variety.
  const total = SIZE * SIZE;
  for (let i = 0; i < total * 0.05; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    setPx(png, x, y, 55, 95, 30);
    // Occasional 2-pixel vertical "blade" for shape variety.
    if (rand() < 0.3) setPx(png, x, y + 1, 60, 100, 32);
  }
  for (let i = 0; i < total * 0.05; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    setPx(png, x, y, 120, 170, 75);
  }
  writePng(png, 'tile_groomedGrass');
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

gen_labFloor();
gen_concrete();
gen_officeFloor();
gen_brick();
gen_cobblestone();
gen_dirt();
gen_pavement();
gen_groomedGrass();

console.log('done.');
