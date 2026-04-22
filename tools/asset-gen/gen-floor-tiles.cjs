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

// ── tile_labFloor: light near-white epoxy with dotted grout seams ───
// 4×4 grid of 16×16 subtiles (each subtile = 0.5m = 1 subunit at
// TEXEL_SCALE=32). Seams between subtiles are dotted: every other 2×2
// chunk along the seam is darker grout, producing the subtle lab-tile
// gridline look without drowning the chunky base noise. Base is left
// neutral so variantTints in FLOORS recolor cleanly.
function gen_labFloor() {
  const png = makePng();
  const rand = mulberry32(101);
  const baseR = 218, baseG = 220, baseB = 224;
  const groutR = 178, groutG = 182, groutB = 190;
  const CHUNK = 2;
  const SUB = 16;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const tx = x % SUB;
      const ty = y % SUB;
      // Seam lives on the last 2-px chunk of each subtile edge.
      const onSeamX = tx === SUB - CHUNK;
      const onSeamY = ty === SUB - CHUNK;
      if (onSeamX || onSeamY) {
        // Dotted: alternate chunk along the seam is grout, the other
        // half inherits the base fill so the line reads as dashes.
        const seamPos = onSeamX ? y : x;
        if ((seamPos / CHUNK) % 2 === 0) {
          const n = (rand() - 0.5) * 6;
          setBlock(png, x, y, groutR + n, groutG + n, groutB + n, CHUNK);
          continue;
        }
      }
      const n = (rand() - 0.5) * 18;
      setBlock(png, x, y, baseR + n, baseG + n, baseB + n, CHUNK);
    }
  }
  writePng(png, 'tile_labFloor');
}

// Write a CHUNK×CHUNK block of one color. Used to coarsen the effective
// pixel scale so generated tiles read as chunky RCT2-style pixel art
// rather than fine static (matching tile_hallway's 2×2 upscale).
function setBlock(png, x, y, r, g, b, chunk = 2) {
  for (let dy = 0; dy < chunk; dy++) {
    for (let dx = 0; dx < chunk; dx++) {
      setPx(png, x + dx, y + dy, r, g, b);
    }
  }
}

// ── tile_concrete: medium-gray speckled aggregate ────────────────────
// Flat base color plus 2×2-block noise only. Block granularity matches
// tile_hallway's chunky pixel scale.
function gen_concrete() {
  const png = makePng();
  const rand = mulberry32(202);
  const baseR = 152, baseG = 152, baseB = 150;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 18;
      setBlock(png, x, y, baseR + n, baseG + n, baseB + n - 1, CHUNK);
    }
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
  const CHUNK = 2;
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

  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const row = Math.floor(y / BH);
      const offset = (row % 2 === 0) ? 0 : BW / 2; // half-brick offset on odd rows
      const xx = ((x - offset) % SIZE + SIZE) % SIZE; // wrap negative
      const col = Math.floor(xx / BW);
      const tx = xx % BW;
      const ty = y % BH;

      // Mortar lines: 2-pixel-wide band at right/bottom edge of each brick.
      const onMortar = (tx === BW - CHUNK) || (ty === BH - CHUNK);
      if (onMortar) {
        const n = (rand() - 0.5) * 8;
        setBlock(png, x, y, mortarR + n, mortarG + n, mortarB + n, CHUNK);
        continue;
      }
      const brickId = (row * 8 + col) % brickPalette.length;
      const [br, bg, bb] = brickPalette[brickId];
      const highlight = (ty < 2) ? 6 : 0;
      const n = (rand() - 0.5) * 12;
      setBlock(png, x, y,
        br + highlight + n,
        bg + highlight + n,
        bb + highlight + n,
        CHUNK);
    }
  }
  writePng(png, 'tile_brick');
}

// ── tile_cobblestone: chunky stones on warm light gray ───────────────
// Each stone is a 4×4 texture-pixel block (2×2 chunks at CHUNK=2), read
// as a single "pixel" in the 2× art scale. No fine speckle — the base
// is almost flat and the stones are mid-tone grays, no bright highlights.
function gen_cobblestone() {
  const png = makePng();
  const rand = mulberry32(505);
  // Warm light gray grout between stones.
  const baseR = 168, baseG = 160, baseB = 148;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 6;
      setBlock(png, x, y, baseR + n, baseG + n - 1, baseB + n - 2, CHUNK);
    }
  }
  // Grid of stones on a 4-px pitch with a small half-row offset so
  // rows don't perfectly align. Each stone fills a 4×4 block with its
  // own mid-gray or warm-beige tone, mixing both so the path reads as
  // irregular cobbles rather than uniform river rock.
  const STONE = 4;
  const stonePalette = [
    // Cool mid-grays
    [138, 135, 128],
    [150, 146, 138],
    [128, 124, 118],
    [120, 118, 112],
    [132, 128, 120],
    // Warm beige/tan stones
    [168, 152, 128],
    [156, 140, 116],
    [178, 160, 134],
    [148, 132, 108],
    [184, 168, 142],
  ];
  for (let row = 0; row < SIZE / STONE; row++) {
    const rowOffset = (row % 2) * 2; // half-stone stagger
    for (let col = 0; col < SIZE / STONE; col++) {
      // ~85% of cells get a stone; the rest show through as grout.
      if (rand() < 0.15) continue;
      const [sr, sg, sb] = stonePalette[Math.floor(rand() * stonePalette.length)];
      const n = (rand() - 0.5) * 8;
      const bx = col * STONE + rowOffset;
      const by = row * STONE;
      // Fill the 4×4 stone as two 2×2 chunks with a tiny shade variation
      // between the two halves so each stone reads as one pixel with a
      // hint of rounding, not a flat square.
      for (let dy = 0; dy < STONE; dy += CHUNK) {
        for (let dx = 0; dx < STONE; dx += CHUNK) {
          const shade = (dx + dy === 0) ? 4 : (dx + dy >= STONE) ? -4 : 0;
          setBlock(png, bx + dx, by + dy, sr + n + shade, sg + n + shade, sb + n + shade, CHUNK);
        }
      }
    }
  }
  writePng(png, 'tile_cobblestone');
}

// ── tile_dirt: warm packed earth in chunky pixels ────────────────────
// Lighter tan base, no bright grains, no hard-dark grit. Instead we
// paint broad 4×4 "pebble" cells in 3 closely-spaced earth tones so the
// surface reads as deliberate chunky pixels rather than static noise.
function gen_dirt() {
  const png = makePng();
  const rand = mulberry32(606);
  const CHUNK = 2;
  const CELL = 4;
  // RCT2 mid-warm brown — darker and less yellow than a tan path, but
  // still reads as dry packed earth (not mud).
  const palette = [
    [138, 100, 64],
    [130, 92, 58],
    [148, 108, 72],
    [122, 86, 52],
    [156, 116, 78],
    [134, 96, 60],
  ];
  for (let cy = 0; cy < SIZE; cy += CELL) {
    for (let cx = 0; cx < SIZE; cx += CELL) {
      const [br, bg, bb] = palette[Math.floor(rand() * palette.length)];
      for (let dy = 0; dy < CELL; dy += CHUNK) {
        for (let dx = 0; dx < CELL; dx += CHUNK) {
          const n = (rand() - 0.5) * 8;
          setBlock(png, cx + dx, cy + dy, br + n, bg + n, bb + n, CHUNK);
        }
      }
    }
  }
  writePng(png, 'tile_dirt');
}

// ── tile_rocky_dirt: cliff/bank face — packed earth with embedded rocks ─
// Base is the same warm-earth palette as tile_dirt but shifted a touch
// darker so it reads as a shaded vertical face rather than a sunlit path.
// On top we scatter ~30 small rocks (4–8 texture pixels across) in cool
// gray-brown stone tones, each with a 2-px top/left highlight and
// bottom/right shadow so the lumps read as rounded, not square. A handful
// of very dark pixels represent crevices between rocks. Scatter positions
// wrap via setPx so the result is seamless on all four edges.
function gen_rockyDirt() {
  const png = makePng();
  const rand = mulberry32(1515);
  const CHUNK = 2;
  const CELL = 4;
  const earthPalette = [
    [142, 108, 72],
    [156, 120, 82],
    [130, 98, 64],
    [168, 130, 88],
    [120, 90, 58],
    [150, 114, 76],
  ];
  for (let cy = 0; cy < SIZE; cy += CELL) {
    for (let cx = 0; cx < SIZE; cx += CELL) {
      const [br, bg, bb] = earthPalette[Math.floor(rand() * earthPalette.length)];
      for (let dy = 0; dy < CELL; dy += CHUNK) {
        for (let dx = 0; dx < CELL; dx += CHUNK) {
          const n = (rand() - 0.5) * 10;
          setBlock(png, cx + dx, cy + dy, br + n, bg + n, bb + n, CHUNK);
        }
      }
    }
  }
  const rockPalette = [
    [110, 104, 95],
    [128, 118, 104],
    [98, 90, 80],
    [140, 130, 118],
    [115, 100, 82],
    [88, 80, 70],
  ];
  const SIZES = [4, 6, 6, 8];
  const NUM_ROCKS = 30;
  for (let i = 0; i < NUM_ROCKS; i++) {
    const w = SIZES[Math.floor(rand() * SIZES.length)];
    const h = SIZES[Math.floor(rand() * SIZES.length)];
    const bx = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const by = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const [rR, rG, rB] = rockPalette[Math.floor(rand() * rockPalette.length)];
    for (let dy = 0; dy < h; dy += CHUNK) {
      for (let dx = 0; dx < w; dx += CHUNK) {
        const cornerCut =
          (dx === 0        && dy === 0        && rand() < 0.5) ||
          (dx >= w - CHUNK && dy >= h - CHUNK && rand() < 0.5) ||
          (dx === 0        && dy >= h - CHUNK && rand() < 0.3) ||
          (dx >= w - CHUNK && dy === 0        && rand() < 0.3);
        if (cornerCut) continue;
        let shade = 0;
        if (dx === 0        || dy === 0)        shade = 12;
        if (dx >= w - CHUNK || dy >= h - CHUNK) shade = -16;
        const n = (rand() - 0.5) * 6;
        setBlock(png, bx + dx, by + dy,
          rR + shade + n, rG + shade + n, rB + shade + n, CHUNK);
      }
    }
  }
  // Dark crevices — a few very dark chunks scattered between rocks.
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const n = (rand() - 0.5) * 6;
    setBlock(png, x, y, 48 + n, 38 + n, 28 + n, CHUNK);
  }
  writePng(png, 'tile_rocky_dirt');
}

// ── tile_pavement: light concrete slabs, chunky pixels ───────────────
// Mid-light warm gray, no dark asphalt, no bright white speckle. The
// surface is 4×4 cells with small brightness variation — the 2×2 chunks
// inside each cell read as a single deliberate pixel. Slab joints are a
// subtle darker band every 32 px so the large-slab structure still reads.
function gen_pavement() {
  const png = makePng();
  const rand = mulberry32(707);
  const CHUNK = 2;
  const CELL = 4;
  const SLAB = 32;
  const palette = [
    [172, 170, 165],
    [180, 178, 172],
    [164, 162, 158],
    [176, 173, 168],
    [168, 166, 160],
  ];
  const jointR = 148, jointG = 146, jointB = 142;
  for (let cy = 0; cy < SIZE; cy += CELL) {
    for (let cx = 0; cx < SIZE; cx += CELL) {
      const [br, bg, bb] = palette[Math.floor(rand() * palette.length)];
      for (let dy = 0; dy < CELL; dy += CHUNK) {
        for (let dx = 0; dx < CELL; dx += CHUNK) {
          const x = cx + dx, y = cy + dy;
          const tx = x % SLAB;
          const ty = y % SLAB;
          const onSeamX = tx >= SLAB - CHUNK;
          const onSeamY = ty >= SLAB - CHUNK;
          if (onSeamX || onSeamY) {
            const seamPos = onSeamX ? y : x;
            if ((seamPos / CHUNK) % 2 === 0) {
              const n = (rand() - 0.5) * 4;
              setBlock(png, x, y, jointR + n, jointG + n, jointB + n, CHUNK);
              continue;
            }
          }
          const n = (rand() - 0.5) * 6;
          setBlock(png, x, y, br + n, bg + n, bb + n, CHUNK);
        }
      }
    }
  }
  writePng(png, 'tile_pavement');
}

// ── tile_groomedGrass: manicured lawn with mowing-row stripes ────────
// Palette is a slightly brighter shade of the default ground grass
// (80,115,50) — manicured but not fluorescent. Mowing rows alternate
// every 16 px (~0.5m, one mower-deck width) by shifting the base
// brightness ±6 in even/odd row bands. No discrete blade flecks.
function gen_groomedGrass() {
  const png = makePng();
  const rand = mulberry32(808);
  const baseR = 88, baseG = 122, baseB = 55;
  const ROW = 16;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    const stripeBand = Math.floor(y / ROW) % 2;
    const stripeShift = stripeBand === 0 ? 6 : -6;
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 16;
      const nr = n + (rand() - 0.5) * 4;
      const ng = n + (rand() - 0.5) * 5;
      const nb = n + (rand() - 0.5) * 3;
      setBlock(png, x, y,
        baseR + stripeShift + nr,
        baseG + stripeShift + ng,
        baseB + stripeShift + nb,
        CHUNK);
    }
  }
  writePng(png, 'tile_groomedGrass');
}

// ── tile_grass: default ground grass (replaces 24-variant terrain) ──
// Olive-toned mid-green matching grass_tile_0.png. No mowing rows,
// more chaos than the manicured lawn.
function gen_grass() {
  const png = makePng();
  const rand = mulberry32(909);
  const baseR = 80, baseG = 115, baseB = 50;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 26;
      const nr = n + (rand() - 0.5) * 6;
      const ng = n + (rand() - 0.5) * 8;
      const nb = n + (rand() - 0.5) * 5;
      setBlock(png, x, y, baseR + nr, baseG + ng, baseB + nb, CHUNK);
    }
  }
  const chunks = (SIZE / CHUNK) * (SIZE / CHUNK);
  for (let i = 0; i < chunks * 0.05; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    setBlock(png, x, y, 55, 88, 30, CHUNK);
  }
  for (let i = 0; i < chunks * 0.04; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    setBlock(png, x, y, 110, 150, 70, CHUNK);
  }
  writePng(png, 'tile_grass');
}

// ── tile_wildgrass: unmowed meadow ──────────────────────────────────
// Same base as tile_grass but with dense dark-green rough-clump marks
// layered on top — matches the in-world look where wildgrass cells are
// regular grass terrain blanketed with 3× the clump-tuft density. No
// flower specks: wildflowers are a separate decoration type.
function gen_wildgrass() {
  const png = makePng();
  const rand = mulberry32(921);
  // Match tile_grass base tones so wildgrass reads as "same ground, more clumps".
  const baseR = 80, baseG = 115, baseB = 50;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 26;
      const nr = n + (rand() - 0.5) * 6;
      const ng = n + (rand() - 0.5) * 8;
      const nb = n + (rand() - 0.5) * 5;
      setBlock(png, x, y, baseR + nr, baseG + ng, baseB + nb, CHUNK);
    }
  }
  // Dense rough-clump marks — small irregular dark-green blobs scattered
  // across the tile to evoke looking down onto 7-blade clumps from above.
  // Palette picked from GRASS_COLORS darks/brights in grass-tuft-builder.js.
  const clumpDarks = [
    [30, 68, 16],   // 0x1e4410
    [40, 80, 28],   // 0x28501c
    [54, 104, 31],  // 0x36681f
  ];
  const clumpBrights = [
    [74, 140, 46],   // 0x4a8c2e
    [122, 176, 60],  // 0x7ab03c
    [142, 194, 62],  // 0x8ec23e
  ];
  // Place ~70 clumps — ~3× the clump density hint of plain grass.
  for (let i = 0; i < 70; i++) {
    const cx = Math.floor(rand() * SIZE);
    const cy = Math.floor(rand() * SIZE);
    const [dr, dg, db] = clumpDarks[Math.floor(rand() * clumpDarks.length)];
    const [br, bg, bb] = clumpBrights[Math.floor(rand() * clumpBrights.length)];
    // 2×2 dark core.
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        setPx(png, cx + dx, cy + dy,
          dr + (rand() - 0.5) * 10,
          dg + (rand() - 0.5) * 10,
          db + (rand() - 0.5) * 8);
      }
    }
    // 1-px bright highlight just above the core — reads as a lit tip.
    setPx(png, cx + 1, cy - 1, br, bg, bb);
  }
  writePng(png, 'tile_wildgrass');
}

// ── tile_tallgrass: clumps + upright tall blades + straw reeds ──────
// Layered to match the in-world look: wildgrass-style rough clumps
// beneath, then vertical olive stalks for the tall-blade tufts, then a
// sprinkle of straw-tan streaks for the reed standouts.
function gen_tallgrass() {
  const png = makePng();
  const rand = mulberry32(933);
  // Same green base as grass/wildgrass so the three tiles share terrain.
  const baseR = 80, baseG = 115, baseB = 50;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 26;
      const nr = n + (rand() - 0.5) * 6;
      const ng = n + (rand() - 0.5) * 8;
      const nb = n + (rand() - 0.5) * 5;
      setBlock(png, x, y, baseR + nr, baseG + ng, baseB + nb, CHUNK);
    }
  }
  // Rough-clump undergrowth (matches tile_wildgrass, fewer clumps since
  // the tall blades will dominate the visual).
  const clumpDarks = [
    [30, 68, 16], [40, 80, 28], [54, 104, 31],
  ];
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(rand() * SIZE);
    const cy = Math.floor(rand() * SIZE);
    const [dr, dg, db] = clumpDarks[Math.floor(rand() * clumpDarks.length)];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        setPx(png, cx + dx, cy + dy,
          dr + (rand() - 0.5) * 10,
          dg + (rand() - 0.5) * 10,
          db + (rand() - 0.5) * 8);
      }
    }
  }
  // Tall olive-green blade streaks — 1-px wide vertical strokes, 4–8 px
  // tall. Palette sampled from TALL_GRASS_COLORS in grass-tuft-builder.js.
  const tallBladeCols = [
    [74, 106, 40],   // 0x4a6a28
    [90, 122, 48],   // 0x5a7a30
    [106, 138, 56],  // 0x6a8a38
    [122, 149, 64],  // 0x7a9540
    [138, 170, 66],  // 0x8aaa42
    [154, 184, 86],  // 0x9ab856
  ];
  for (let i = 0; i < 75; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    const len = 4 + Math.floor(rand() * 5);
    const [sr, sg, sb] = tallBladeCols[Math.floor(rand() * tallBladeCols.length)];
    for (let dy = 0; dy < len; dy++) {
      setPx(png, x, (y + dy) % SIZE,
        sr + (rand() - 0.5) * 10,
        sg + (rand() - 0.5) * 10,
        sb + (rand() - 0.5) * 8);
    }
  }
  // Reed streaks — taller (6–10 px), straw-tan, sparser than the green
  // blades. Palette sampled from REED_COLORS in grass-tuft-builder.js.
  const reedCols = [
    [188, 160, 90],  // 0xbca05a
    [168, 144, 64],  // 0xa89040
    [200, 176, 96],  // 0xc8b060
    [154, 133, 64],  // 0x9a8540
  ];
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    const len = 6 + Math.floor(rand() * 5);
    const [sr, sg, sb] = reedCols[Math.floor(rand() * reedCols.length)];
    for (let dy = 0; dy < len; dy++) {
      setPx(png, x, (y + dy) % SIZE,
        sr + (rand() - 0.5) * 10,
        sg + (rand() - 0.5) * 10,
        sb + (rand() - 0.5) * 6);
    }
  }
  writePng(png, 'tile_tallgrass');
}

// ── Plank generator core ─────────────────────────────────────────────
// Shared hardwood generator used by the hardwood variants below. Each
// plank is 8 texture pixels wide (~0.25m), with mixed segment lengths
// and a random Y offset per column so cross-cuts never align. Segments
// wrap the tile edge as one continuous plank, and each plank's color
// avoids both its vertical and left-neighbor neighbors so boundaries
// are readable by color alone — no seam lines.
function gen_hardwoodVariant(name, seed, planks) {
  const png = makePng();
  const rand = mulberry32(seed);
  const PLANK_W = 8;
  const NUM_COLS = SIZE / PLANK_W;
  const LENGTHS = [16, 24, 32, 40];

  // Pre-compute per-column segment list.
  const columns = [];
  for (let c = 0; c < NUM_COLS; c++) {
    const lengths = [];
    let total = 0;
    while (total < SIZE) {
      const len = LENGTHS[Math.floor(rand() * LENGTHS.length)];
      lengths.push(len);
      total += len;
    }
    lengths[lengths.length - 1] -= (total - SIZE);
    if (lengths[lengths.length - 1] < 8 && lengths.length > 1) {
      lengths[lengths.length - 2] += lengths.pop();
    }
    const offset = Math.floor(rand() * SIZE);
    const segs = [];
    let y = offset;
    let lastColor = -1;
    // Track the previous column's color choices at each y to avoid
    // matches with the immediate left neighbor as well.
    const prevCol = c > 0 ? columns[c - 1] : null;
    for (let i = 0; i < lengths.length; i++) {
      const y0 = y % SIZE;
      const y1 = (y + lengths[i]) % SIZE;
      // Find the left-neighbor color at this segment's start y, if any.
      let leftColor = -1;
      if (prevCol) {
        const ly = y0;
        for (const s of prevCol) {
          if (s.y0 <= s.y1) {
            if (ly >= s.y0 && ly < s.y1) { leftColor = s.colorIdx; break; }
          } else {
            if (ly >= s.y0 || ly < s.y1) { leftColor = s.colorIdx; break; }
          }
        }
      }
      let colorIdx;
      let attempts = 0;
      do {
        colorIdx = Math.floor(rand() * planks.length);
        attempts++;
      } while ((colorIdx === lastColor || colorIdx === leftColor) && attempts < 8);
      lastColor = colorIdx;
      segs.push({ y0, y1, colorIdx });
      y += lengths[i];
    }
    columns.push(segs);
  }

  // Pixel pass — noise and grain in 2×2 blocks so the wood reads as
  // chunky pixel art matching tile_hallway's scale.
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const c = Math.floor(x / PLANK_W);
      const segs = columns[c];
      let seg = null;
      for (const s of segs) {
        if (s.y0 <= s.y1) {
          if (y >= s.y0 && y < s.y1) { seg = s; break; }
        } else {
          if (y >= s.y0 || y < s.y1) { seg = s; break; }
        }
      }
      if (!seg) seg = segs[0];

      const [pr, pg, pb] = planks[seg.colorIdx];
      // Subtle grain + noise — kept low so adjacent planks' base colors
      // read as the dominant signal, not the per-pixel variation.
      const grain = Math.sin((y >> 1) * 1.1 + c * 1.7) * 4;
      const n = (rand() - 0.5) * 6;
      setBlock(png, x, y,
        pr + grain + n,
        pg + grain * 0.7 + n,
        pb + grain * 0.5 + n,
        CHUNK);
    }
  }
  writePng(png, name);
}

// Birch: pale cream-yellow planks.
function gen_hardwoodBirch() {
  gen_hardwoodVariant('tile_hardwood_birch', 1010, [
    [232, 214, 168],
    [218, 200, 155],
    [242, 222, 178],
    [210, 192, 148],
    [228, 208, 162],
    [220, 202, 158],
    [238, 218, 172],
    [214, 196, 152],
  ]);
}

// Oak: warm golden-brown planks, more saturated than birch.
function gen_hardwoodOak() {
  gen_hardwoodVariant('tile_hardwood_oak', 1020, [
    [178, 128, 72],
    [198, 146, 88],
    [162, 114, 62],
    [208, 156, 96],
    [172, 122, 68],
    [192, 142, 82],
    [215, 162, 102],
    [168, 118, 64],
  ]);
}

// ── tile_carpet_diamond: tintable diamond-lattice carpet ─────────────
// 64×64 with a 4×4 grid of 16×16 diamond cells. Each cell draws a
// diamond outline (white-ish) on a light-gray base, with a small cross
// motif in the center so tints read as a woven pattern, not a plain
// grid. Designed to be tinted — base stays neutral, lattice stays
// bright, and the variantTint in FLOORS shifts the overall hue.
function gen_carpetDiamond() {
  const png = makePng();
  const rand = mulberry32(1111);
  const baseR = 172, baseG = 172, baseB = 178;
  const lineR = 240, lineG = 240, lineB = 245;
  const CHUNK = 2;
  const CELL = 16;
  const R = CELL / 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const lx = x % CELL;
      const ly = y % CELL;
      const dx = Math.abs(lx - R);
      const dy = Math.abs(ly - R);
      // Distance from the diamond edge |x|+|y|=R (in cell-local coords).
      const distEdge = Math.abs(dx + dy - R);
      // Small cross motif in the cell center (≈4×4 plus sign).
      // Use R (not R-1) so CHUNK=2 iteration actually hits the center.
      const cx = lx - R;
      const cy = ly - R;
      const inCross = (Math.abs(cx) < 2 && Math.abs(cy) < 4) ||
                      (Math.abs(cy) < 2 && Math.abs(cx) < 4);
      const n = (rand() - 0.5) * 10;
      if (distEdge < 1.5 || inCross) {
        setBlock(png, x, y, lineR + n, lineG + n, lineB + n, CHUNK);
      } else {
        setBlock(png, x, y, baseR + n, baseG + n, baseB + n, CHUNK);
      }
    }
  }
  writePng(png, 'tile_carpet_diamond');
}

// ── Lab check generators ─────────────────────────────────────────────
// 2-color checkerboard rotated 45° relative to the game tile grid, so
// the cells appear as diamonds rather than axis-aligned squares. The
// pattern is evaluated in (u=x+y, v=x-y) space with SQ=16 (rotated
// cell diagonal), which tiles seamlessly on 64×64 (64 is a multiple
// of 2·SQ so parity is preserved across wraps). Drawn in 2×2 chunks
// for chunky pixel-art stepped edges.
function gen_labCheck(name, seed, lightRGB, darkRGB) {
  const png = makePng();
  const rand = mulberry32(seed);
  const SQ = 16;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const u = x + y;
      const v = x - y + SIZE;
      const cellA = Math.floor(u / SQ);
      const cellB = Math.floor(v / SQ);
      const isLight = (((cellA + cellB) % 2) + 2) % 2 === 0;
      const [r, g, b] = isLight ? lightRGB : darkRGB;
      const n = (rand() - 0.5) * 22;
      setBlock(png, x, y, r + n, g + n, b + n, CHUNK);
    }
  }
  writePng(png, name);
}

function gen_labCheckBlack() {
  gen_labCheck('tile_lab_check_black', 1212, [232, 232, 236], [36, 36, 40]);
}

function gen_labCheckRed() {
  gen_labCheck('tile_lab_check_red', 1313, [240, 236, 232], [178, 42, 42]);
}

// ── tile_lab_houndstooth: 2×2 chunky zigzag check ───────────────────
// Same 8-pixel checkerboard, but drawn entirely in 2×2 chunks with
// every other 2-pixel scanline row shifting the vertical seam by 2 px.
// The resulting edge is a bold stepped zigzag instead of the fine
// 1-pixel staircase used by the plain check variants.
function gen_labHoundstooth(name, seed, lightRGB, darkRGB) {
  const png = makePng();
  const rand = mulberry32(seed);
  const SQ = 8;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    const xShift = (Math.floor(y / CHUNK) % 2) * CHUNK;
    for (let x = 0; x < SIZE; x += CHUNK) {
      const sx = x + xShift;
      const cellX = Math.floor(sx / SQ);
      const cellY = Math.floor(y / SQ);
      const isLight = (((cellX + cellY) % 2) + 2) % 2 === 0;
      const [r, g, b] = isLight ? lightRGB : darkRGB;
      const n = (rand() - 0.5) * 22;
      setBlock(png, x, y, r + n, g + n, b + n, CHUNK);
    }
  }
  writePng(png, name);
}

function gen_labHoundstoothBW() {
  gen_labHoundstooth('tile_lab_houndstooth', 1414, [232, 232, 236], [36, 36, 40]);
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Selective mode: `node gen-floor-tiles.cjs --only <name>` runs one generator.
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const TILES = {
  labFloor: gen_labFloor,
  concrete: gen_concrete,
  officeFloor: gen_officeFloor,
  brick: gen_brick,
  cobblestone: gen_cobblestone,
  dirt: gen_dirt,
  rockyDirt: gen_rockyDirt,
  pavement: gen_pavement,
  groomedGrass: gen_groomedGrass,
  grass: gen_grass,
  wildgrass: gen_wildgrass,
  tallgrass: gen_tallgrass,
  hardwoodBirch: gen_hardwoodBirch,
  hardwoodOak: gen_hardwoodOak,
  carpetDiamond: gen_carpetDiamond,
  labCheckBlack: gen_labCheckBlack,
  labCheckRed: gen_labCheckRed,
  labHoundstoothBW: gen_labHoundstoothBW,
};

if (only) {
  const fn = TILES[only];
  if (!fn) {
    console.error('unknown tile:', only, '\navailable:', Object.keys(TILES).join(', '));
    process.exit(1);
  }
  fn();
} else {
  for (const fn of Object.values(TILES)) fn();
}

console.log('done.');
