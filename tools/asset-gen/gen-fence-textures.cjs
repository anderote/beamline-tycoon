#!/usr/bin/env node
// Procedural 64×64 fence/hedge preview textures for the Grounds > Fencing tab.
// Run: node tools/asset-gen/gen-fence-textures.cjs

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 64;
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePng() { return new PNG({ width: SIZE, height: SIZE, colorType: 6 }); }

function setPx(png, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  png.data[idx] = Math.max(0, Math.min(255, r | 0));
  png.data[idx + 1] = Math.max(0, Math.min(255, g | 0));
  png.data[idx + 2] = Math.max(0, Math.min(255, b | 0));
  png.data[idx + 3] = a;
}
function getPx(png, x, y) {
  const idx = (y * SIZE + x) * 4;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}
function fill(png, r, g, b, a = 255) {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) setPx(png, x, y, r, g, b, a);
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
function noiseLayer(png, rng, intensity) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
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

// ── Low Hedge ─────────────────────────────────────────────────────────
// Dense foliage texture: layered green dots on a mid-green base. Renders
// two variants from different seeds so adjacent hedges don't look identical.
function genHedgeVariant(seed, outName) {
  const png = makePng();
  const rng = mulberry32(seed);
  fill(png, 0x3a, 0x6a, 0x38);
  const leafCols = [
    [0x4e, 0x90, 0x48], [0x3c, 0x78, 0x3a],
    [0x56, 0xa0, 0x50], [0x2e, 0x64, 0x2e],
  ];
  for (let i = 0; i < 260; i++) {
    const cx = (rng() * SIZE) | 0;
    const cy = (rng() * SIZE) | 0;
    const [r, g, b] = leafCols[(rng() * leafCols.length) | 0];
    const rad = 1 + ((rng() * 2) | 0);
    disc(png, cx, cy, rad, r, g, b);
  }
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [cr, cg, cb] = getPx(png, x, y);
      const lift = 10 - y;
      setPx(png, x, y, cr + lift, cg + lift + 4, cb + lift);
    }
  }
  noiseLayer(png, rng, 10);
  writePng(png, outName);
}
function genHedge() {
  genHedgeVariant(5001, 'fence_hedge');
  genHedgeVariant(5011, 'fence_hedge_alt');
}

// ── Tall Hedge ────────────────────────────────────────────────────────
// Darker denser privacy hedge — shadows at base, tight cluster.
function genTallHedgeVariant(seed, outName) {
  const png = makePng();
  const rng = mulberry32(seed);
  fill(png, 0x28, 0x56, 0x2a);
  const leafCols = [
    [0x30, 0x68, 0x30], [0x1e, 0x4e, 0x22],
    [0x3a, 0x78, 0x3a], [0x44, 0x84, 0x42],
  ];
  for (let i = 0; i < 320; i++) {
    const cx = (rng() * SIZE) | 0;
    const cy = (rng() * SIZE) | 0;
    const [r, g, b] = leafCols[(rng() * leafCols.length) | 0];
    const rad = 1 + ((rng() * 3) | 0);
    disc(png, cx, cy, rad, r, g, b);
  }
  for (let y = 0; y < SIZE; y++) {
    const shade = Math.round((y / SIZE) * -14);
    for (let x = 0; x < SIZE; x++) {
      const [cr, cg, cb] = getPx(png, x, y);
      setPx(png, x, y, cr + shade, cg + shade, cb + shade);
    }
  }
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [cr, cg, cb] = getPx(png, x, y);
      setPx(png, x, y, cr + 8, cg + 14, cb + 8);
    }
  }
  noiseLayer(png, rng, 10);
  writePng(png, outName);
}
function genTallHedge() {
  genTallHedgeVariant(5002, 'fence_tall_hedge');
  genTallHedgeVariant(5012, 'fence_tall_hedge_alt');
}

// ── Iron Fence ────────────────────────────────────────────────────────
// Ornamental wrought iron: vertical bars with pointed finials on fully
// transparent backdrop — wall-builder uses alphaTest to cut gaps between bars.
function genIronFence() {
  const png = makePng();
  const rng = mulberry32(5003);
  // Fully transparent background
  fill(png, 0, 0, 0, 0);
  const barCol = [0x22, 0x22, 0x2c];
  const barHL = [0x48, 0x48, 0x58];
  // Horizontal top and bottom rails (opaque)
  rect(png, 0, 12, SIZE, 3, ...barCol);
  rect(png, 0, 56, SIZE, 3, ...barCol);
  rect(png, 0, 11, SIZE, 1, ...barHL);
  rect(png, 0, 55, SIZE, 1, ...barHL);
  // Vertical bars every 8px
  for (let bx = 4; bx < SIZE; bx += 8) {
    rect(png, bx, 8, 2, 52, ...barCol);
    setPx(png, bx, 8, ...barHL);
    // Pointed finial
    setPx(png, bx, 6, ...barCol);
    setPx(png, bx + 1, 6, ...barCol);
    setPx(png, bx, 4, ...barCol);
    setPx(png, bx + 1, 4, ...barCol);
    setPx(png, bx, 2, ...barCol);
    setPx(png, bx + 1, 2, ...barCol);
  }
  // Decorative mid-scroll (opaque discs)
  for (let bx = 4; bx < SIZE; bx += 8) {
    disc(png, bx + 1, 32, 2, ...barCol);
  }
  // Noise only affects opaque pixels (noiseLayer respects alpha)
  noiseLayer(png, rng, 4);
  writePng(png, 'fence_iron');
}

// ── Stone Wall ────────────────────────────────────────────────────────
// RCT2-style cream masonry: rectangular blocks in running-bond courses
// with thin dark mortar. Each course is 8 px tall, blocks are 16 px wide
// with every other row offset by half a block for the running bond.
// Mortar: 1-px dark lines on right/bottom of each block.
function genStoneWall() {
  const png = makePng();
  const rng = mulberry32(5004);
  const BW = 16, BH = 8;
  // Mortar: faded brown-gray — muted so stones stay the dominant signal.
  const mortarR = 0x86, mortarG = 0x7a, mortarB = 0x6c;
  fill(png, mortarR, mortarG, mortarB);
  // Cream masonry palette — warm beige with slight per-block variation.
  const stoneCols = [
    [0xd8, 0xc4, 0xa4], [0xcc, 0xb6, 0x94], [0xe0, 0xcc, 0xac],
    [0xc4, 0xac, 0x88], [0xd0, 0xba, 0x98], [0xda, 0xc0, 0x9c],
    [0xc8, 0xb0, 0x8c], [0xe4, 0xd0, 0xb0],
  ];
  const rows = SIZE / BH;
  for (let row = 0; row < rows; row++) {
    const offset = (row % 2 === 0) ? 0 : BW / 2;
    const y0 = row * BH;
    for (let bx = -BW; bx < SIZE + BW; bx += BW) {
      const x0 = bx + offset;
      const [r, g, b] = stoneCols[(rng() * stoneCols.length) | 0];
      // Block body — 15×7 so a 1-px mortar line shows on right + bottom.
      for (let dy = 0; dy < BH - 1; dy++) {
        for (let dx = 0; dx < BW - 1; dx++) {
          const x = x0 + dx;
          if (x < 0 || x >= SIZE) continue;
          setPx(png, x, y0 + dy, r, g, b);
        }
      }
      // Top highlight (cream shine) — 1 px brighter row.
      for (let dx = 0; dx < BW - 1; dx++) {
        const x = x0 + dx;
        if (x < 0 || x >= SIZE) continue;
        setPx(png, x, y0, r + 12, g + 10, b + 8);
      }
      // Bottom-inside shadow — 1 px darker row just above the mortar line.
      for (let dx = 0; dx < BW - 1; dx++) {
        const x = x0 + dx;
        if (x < 0 || x >= SIZE) continue;
        setPx(png, x, y0 + BH - 2, r - 18, g - 16, b - 14);
      }
    }
  }
  noiseLayer(png, rng, 6);
  writePng(png, 'fence_stone_wall');
}

// ── Wood Fence ────────────────────────────────────────────────────────
// Horizontal plank fence with visible nails and grain.
function genWoodFence() {
  const png = makePng();
  const rng = mulberry32(5005);
  fill(png, 0x8a, 0x6a, 0x42);
  const plankCols = [
    [0x92, 0x70, 0x46], [0x82, 0x62, 0x3c], [0x8c, 0x6a, 0x42],
  ];
  // 4 horizontal planks
  const plankH = 14;
  for (let pi = 0; pi < 4; pi++) {
    const y0 = 2 + pi * (plankH + 2);
    const [r, g, b] = plankCols[pi % plankCols.length];
    rect(png, 0, y0, SIZE, plankH, r, g, b);
    // Top highlight
    for (let x = 0; x < SIZE; x++) setPx(png, x, y0, r + 14, g + 10, b + 6);
    // Bottom shadow
    for (let x = 0; x < SIZE; x++) setPx(png, x, y0 + plankH - 1, r - 18, g - 14, b - 10);
    // Grain
    for (let x = 0; x < SIZE; x++) {
      const grain = Math.sin(x * 0.22 + pi * 1.1 + rng() * 0.3) * 6;
      for (let dy = 2; dy < plankH - 2; dy++) {
        const [cr, cg, cb] = getPx(png, x, y0 + dy);
        setPx(png, x, y0 + dy, cr + grain, cg + grain - 2, cb + grain - 3);
      }
    }
    // Nails at vertical post positions
    for (const nx of [6, 30, 54]) {
      disc(png, nx, y0 + plankH / 2 | 0, 1, 0x55, 0x55, 0x55);
    }
  }
  // Vertical support posts on left/right
  rect(png, 2, 0, 3, SIZE, 0x6c, 0x50, 0x32);
  rect(png, SIZE - 5, 0, 3, SIZE, 0x6c, 0x50, 0x32);
  noiseLayer(png, rng, 6);
  writePng(png, 'fence_wood');
}

// ── Picket Fence ──────────────────────────────────────────────────────
// Classic white pickets with pointed tops on a fully transparent backdrop —
// wall-builder uses alphaTest to cut gaps between pickets.
function genPicketFence() {
  const png = makePng();
  const rng = mulberry32(5006);
  fill(png, 0, 0, 0, 0);
  const picketCol = [0xee, 0xee, 0xe0];
  const picketShd = [0xc8, 0xc8, 0xb8];
  // Horizontal crossbar
  rect(png, 0, 38, SIZE, 3, ...picketCol);
  rect(png, 0, 37, SIZE, 1, ...picketShd);
  // Vertical pickets
  for (let px = 2; px < SIZE; px += 8) {
    rect(png, px, 8, 4, 44, ...picketCol);
    // Pointed top — taper 3 rows
    rect(png, px + 1, 6, 2, 2, ...picketCol);
    setPx(png, px + 1, 5, ...picketCol);
    setPx(png, px + 2, 5, ...picketCol);
    setPx(png, px + 1, 4, ...picketCol);
    setPx(png, px + 2, 4, ...picketCol);
    // Left shadow
    for (let dy = 4; dy < 52; dy++) setPx(png, px, dy, ...picketShd);
    // Right edge highlight
    setPx(png, px + 3, 8, 0xff, 0xff, 0xf4);
  }
  noiseLayer(png, rng, 4);
  writePng(png, 'fence_picket');
}

// ── Run all ───────────────────────────────────────────────────────────
genHedge();
genTallHedge();
genIronFence();
genStoneWall();
genWoodFence();
genPicketFence();
console.log('Done – 6 fence/hedge textures generated.');
