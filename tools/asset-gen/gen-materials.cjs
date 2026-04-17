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
  const xx = ((x % SIZE) + SIZE) % SIZE;
  const yy = ((y % SIZE) + SIZE) % SIZE;
  const idx = (yy * SIZE + xx) * 4;
  png.data[idx] = Math.max(0, Math.min(255, r | 0));
  png.data[idx + 1] = Math.max(0, Math.min(255, g | 0));
  png.data[idx + 2] = Math.max(0, Math.min(255, b | 0));
  png.data[idx + 3] = a;
}

// 2×2 chunky pixel writer — all wall textures step in 2px increments so
// the visual scale matches the chunked floor textures.
function setBlock(png, x, y, r, g, b, chunk = 2) {
  for (let dy = 0; dy < chunk; dy++) {
    for (let dx = 0; dx < chunk; dx++) {
      setPx(png, x + dx, y + dy, r, g, b);
    }
  }
}

function writePng(png, name) {
  const out = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
}

// ── Generators ────────────────────────────────────────────────────────
// All wall generators iterate in 2×2 chunks (CHUNK=2) so their visual
// scale matches the chunky-pixel floor textures in gen-floor-tiles.cjs.

const CHUNK = 2;

function gen_solidNoise(name, baseRGB, noiseAmp, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * noiseAmp;
      setBlock(png, x, y, baseRGB[0] + n, baseRGB[1] + n, baseRGB[2] + n, CHUNK);
    }
  }
  writePng(png, name);
}

function gen_speckled(name, baseRGB, speckleRGB, density, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      if (rand() < density) {
        setBlock(png, x, y, speckleRGB[0], speckleRGB[1], speckleRGB[2], CHUNK);
      } else {
        const n = (rand() - 0.5) * 14;
        setBlock(png, x, y, baseRGB[0] + n, baseRGB[1] + n, baseRGB[2] + n, CHUNK);
      }
    }
  }
  writePng(png, name);
}

function gen_brushed(name, baseRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  // Horizontal brush bands: each 2px row-pair picks a brightness offset.
  const rowOffsets = new Array(SIZE / CHUNK);
  for (let i = 0; i < rowOffsets.length; i++) rowOffsets[i] = (rand() - 0.5) * 30;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const grain = Math.sin(x * 0.4 + y * 0.05) * 6;
      const n = rowOffsets[y / CHUNK] + grain + (rand() - 0.5) * 6;
      setBlock(png, x, y, baseRGB[0] + n, baseRGB[1] + n, baseRGB[2] + n, CHUNK);
    }
  }
  writePng(png, name);
}

function gen_grid(name, bgRGB, lineRGB, cellSize, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const onLine = (x % cellSize === 0) || (y % cellSize === 0);
      if (onLine) {
        setBlock(png, x, y, lineRGB[0], lineRGB[1], lineRGB[2], CHUNK);
      } else {
        const n = (rand() - 0.5) * 10;
        setBlock(png, x, y, bgRGB[0] + n, bgRGB[1] + n, bgRGB[2] + n, CHUNK);
      }
    }
  }
  writePng(png, name);
}

function gen_mesh(name, darkRGB, lightRGB, slotW, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const period = slotW + CHUNK;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const ix = x % period;
      const isSlot = ix < CHUNK;
      const n = (rand() - 0.5) * 10;
      if (isSlot) {
        setBlock(png, x, y, darkRGB[0] + n * 0.3, darkRGB[1] + n * 0.3, darkRGB[2] + n * 0.3, CHUNK);
      } else {
        const shade = ((ix - CHUNK) / (period - CHUNK)) * 12 - 6;
        setBlock(png, x, y, lightRGB[0] + n + shade, lightRGB[1] + n + shade, lightRGB[2] + n + shade, CHUNK);
      }
    }
  }
  writePng(png, name);
}

// Vertical corrugated paneling: regular dark/light bands every 4px column,
// brushed metal feel with tiny per-pixel jitter so it doesn't look flat.
function gen_corrugated(name, baseRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      // 4px-wide vertical ribs: each rib has a bright crest then dark trough.
      const phase = (x % 8);
      let band;
      if (phase === 0) band = 18;       // crest
      else if (phase === 2) band = 6;
      else if (phase === 4) band = -10;
      else band = -22;                  // trough
      const n = (rand() - 0.5) * 6;
      setBlock(png, x, y, baseRGB[0] + band + n, baseRGB[1] + band + n, baseRGB[2] + band + n, CHUNK);
    }
  }
  writePng(png, name);
}

// Cryogenic insulation: pale blue-white base with sparse white frost
// crystals and a faint diagonal quilting pattern.
function gen_frost(name, baseRGB, crystalRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      // Diagonal quilting: faint ridges every 16px along (x+y)
      const quilt = ((x + y) % 16 === 0) ? 8 : 0;
      const n = (rand() - 0.5) * 10;
      setBlock(png, x, y, baseRGB[0] + quilt + n, baseRGB[1] + quilt + n, baseRGB[2] + quilt + n, CHUNK);
    }
  }
  // Frost crystals: ~25 small bright clusters
  for (let i = 0; i < 25; i++) {
    const cx = Math.floor(rand() * SIZE / CHUNK) * CHUNK;
    const cy = Math.floor(rand() * SIZE / CHUNK) * CHUNK;
    setBlock(png, cx, cy, crystalRGB[0], crystalRGB[1], crystalRGB[2], CHUNK);
    if (rand() > 0.4) setBlock(png, (cx + CHUNK) % SIZE, cy, crystalRGB[0], crystalRGB[1], crystalRGB[2], CHUNK);
    if (rand() > 0.4) setBlock(png, cx, (cy + CHUNK) % SIZE, crystalRGB[0], crystalRGB[1], crystalRGB[2], CHUNK);
  }
  writePng(png, name);
}

// Diagonal hazard stripes: yellow/black every 8px on a 45° diagonal,
// seamless because the period divides SIZE.
function gen_hazardStripe(name, yellowRGB, blackRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const period = 16; // two 8-px stripes per period — divides 64 evenly
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const d = (x + y) % period;
      const isBlack = d < period / 2;
      const c = isBlack ? blackRGB : yellowRGB;
      const n = (rand() - 0.5) * 8;
      setBlock(png, x, y, c[0] + n, c[1] + n, c[2] + n, CHUNK);
    }
  }
  writePng(png, name);
}

// ── Exterior wall variants ───────────────────────────────────────────
// Each variant produces a seamless 64×64 texture at the 2×2-chunk scale.

// Cement: rougher than drywall, cool gray, light speckle aggregate.
function gen_wallCement(name, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const baseR = 168, baseG = 168, baseB = 172;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 22;
      setBlock(png, x, y, baseR + n, baseG + n, baseB + n - 2, CHUNK);
    }
  }
  // Sparse, lighter aggregate flecks — reduced density and brighter
  // color so the cement reads as a subtle texture, not dirty speckle.
  const chunks = (SIZE / CHUNK) * (SIZE / CHUNK);
  for (let i = 0; i < chunks * 0.012; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    setBlock(png, x, y, 138, 138, 142, CHUNK);
  }
  writePng(png, name);
}

// Wood shingle siding: staggered scalloped rows, warm brown-gray palette.
// Each "shingle" is 8 px wide × 12 px tall with a soft dark shadow at
// the bottom edge to suggest the overlap between rows.
function gen_wallShingle(name, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const SW = 8;   // shingle width
  const SH = 12;  // row height (must divide 64 for seamless; 64/12 doesn't — use wrap)
  // Use a row height that divides 64 to stay seamless: 16.
  const ROW = 16;
  const palette = [
    [150, 122, 92],
    [168, 138, 102],
    [132, 108, 78],
    [158, 128, 96],
    [142, 115, 84],
    [160, 130, 98],
  ];
  for (let y = 0; y < SIZE; y += CHUNK) {
    const rowIdx = Math.floor(y / ROW);
    const rowOffset = (rowIdx % 2) * (SW / 2);  // half-shingle stagger
    const ty = y % ROW;
    for (let x = 0; x < SIZE; x += CHUNK) {
      const xx = ((x - rowOffset) % SIZE + SIZE) % SIZE;
      const col = Math.floor(xx / SW);
      const tx = xx % SW;
      // Deterministic color per (row, col) with small noise.
      const pi = (rowIdx * 7 + col * 3 + 11) % palette.length;
      const [pr, pg, pb] = palette[pi];
      // Bottom 2px of the row fades to a darker shadow band (shingle overlap).
      const shadow = ty >= ROW - 4 ? -18 : 0;
      // Vertical seam between shingles — 2px darker column.
      const seam = tx < 1 ? -10 : 0;
      const n = (rand() - 0.5) * 10;
      setBlock(png, x, y, pr + shadow + seam + n, pg + shadow + seam + n, pb + shadow + seam + n, CHUNK);
    }
  }
  writePng(png, name);
}

// Horizontal siding / clapboard: continuous horizontal bands 8px tall
// with a thin darker seam at the bottom of each band.
function gen_wallSiding(name, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const BAND = 8;
  const palette = [
    [224, 220, 208],
    [216, 212, 198],
    [230, 226, 212],
    [218, 214, 200],
  ];
  for (let y = 0; y < SIZE; y += CHUNK) {
    const bandIdx = Math.floor(y / BAND);
    const ty = y % BAND;
    const [pr, pg, pb] = palette[bandIdx % palette.length];
    // Bottom 2px of each band is a darker seam.
    const seam = ty === BAND - CHUNK ? -30 : 0;
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 8;
      setBlock(png, x, y, pr + seam + n, pg + seam + n, pb + seam + n, CHUNK);
    }
  }
  writePng(png, name);
}

// Chain-link mesh: diamond lattice of steel wire on a fully transparent
// background. The PNG's alpha channel starts at 0 (default pngjs buffer
// state), and we only write opaque pixels where a wire strand lives, so
// the holes render as true transparency once the wall material has
// alphaTest enabled.
//
// Pattern: diagonal wires forming diamonds with 8-pixel spacing, 2-px
// stroke (one chunk). Each wire pixel gets per-chunk noise so the metal
// reads as a chunky RCT2-style sprite, not a CAD line.
function gen_wallChainLink(name, seed, withBarbs = false) {
  const png = makePng();
  const rand = mulberry32(seed);
  const wireR = 178, wireG = 184, wireB = 196;
  const SPACING = 8;
  // PNG buffer is zero-initialized → fully transparent. Only stamp
  // wire chunks where the diagonal lattice lines pass.
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      // Two diagonal families: x+y and x-y, both mod SPACING.
      const d1 = ((x + y) % SPACING + SPACING) % SPACING;
      const d2 = ((x - y) % SPACING + SPACING) % SPACING;
      const onWire = d1 < CHUNK || d2 < CHUNK;
      if (!onWire) continue;
      const n = (rand() - 0.5) * 18;
      // Slight warm/cool shading based on which diagonal is drawn.
      const shade = d1 < CHUNK ? 6 : -4;
      setBlock(png, x, y,
        wireR + shade + n,
        wireG + shade + n,
        wireB + shade + n,
        CHUNK);
    }
  }
  // Barbed wire variant: add 3 horizontal barbed strands clustered
  // near the top of the PNG. THREE flipY makes low-Y PNG rows map to
  // the top of the wall, so strands at y≈4,10,16 appear stacked along
  // the top edge while the rest of the wall remains plain chain-link.
  if (withBarbs) {
    const strandYs = [4, 10, 16];
    for (const sy of strandYs) {
      // Horizontal strand (2 px thick)
      for (let x = 0; x < SIZE; x += CHUNK) {
        const n = (rand() - 0.5) * 12;
        setBlock(png, x, sy, wireR + n, wireG + n, wireB + n, CHUNK);
      }
      // Barbs every 8 px — short diagonals above and below the strand.
      for (let bx = 0; bx < SIZE; bx += 8) {
        setBlock(png, bx + 2, sy - 2, wireR, wireG, wireB, CHUNK);
        setBlock(png, bx + 4, sy - 4, wireR, wireG, wireB, CHUNK);
        setBlock(png, bx + 2, sy + 2, wireR, wireG, wireB, CHUNK);
        setBlock(png, bx + 4, sy + 4, wireR, wireG, wireB, CHUNK);
      }
    }
  }
  writePng(png, name);
}

// Red brick wall: similar to the existing floor brick but with exterior
// wall proportions (smaller bricks) and a warmer palette. Running-bond
// courses. This is distinct from tile_brick so walls and paving read
// differently.
function gen_wallBrick(name, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const BW = 16, BH = 8;
  const mortarR = 180, mortarG = 170, mortarB = 150;
  const brickPalette = [
    [170, 80, 58],
    [155, 70, 52],
    [180, 88, 62],
    [160, 74, 54],
    [148, 62, 46],
    [175, 84, 60],
  ];
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const row = Math.floor(y / BH);
      const offset = (row % 2 === 0) ? 0 : BW / 2;
      const xx = ((x - offset) % SIZE + SIZE) % SIZE;
      const col = Math.floor(xx / BW);
      const tx = xx % BW;
      const ty = y % BH;
      const onMortar = (tx === BW - CHUNK) || (ty === BH - CHUNK);
      if (onMortar) {
        const n = (rand() - 0.5) * 8;
        setBlock(png, x, y, mortarR + n, mortarG + n, mortarB + n, CHUNK);
        continue;
      }
      const brickId = (row * 8 + col) % brickPalette.length;
      const [br, bg, bb] = brickPalette[brickId];
      const highlight = ty < 2 ? 6 : 0;
      const n = (rand() - 0.5) * 12;
      setBlock(png, x, y,
        br + highlight + n,
        bg + highlight + n,
        bb + highlight + n,
        CHUNK);
    }
  }
  writePng(png, name);
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Metals
gen_solidNoise('metal_dark',       [55, 58, 66],   6, 1);
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
gen_mesh('rack_vent_mesh',         [25, 25, 30], [100, 102, 110], 6, 10);
gen_grid('cable_tray',             [120, 120, 124], [60, 60, 64], 8, 11);

// Infra category paints (Pass D — infra textures and decals)
gen_solidNoise('metal_painted_red',    [180, 50, 50],   18, 40);
gen_solidNoise('metal_painted_blue',   [55, 95, 145],   18, 41);
gen_solidNoise('metal_painted_green',  [70, 120, 70],   18, 42);
gen_solidNoise('metal_painted_yellow', [200, 175, 60],  18, 43);
gen_solidNoise('metal_painted_gray',   [130, 132, 138], 16, 44);

// Infra trims and patterns
gen_corrugated('metal_corrugated', [128, 132, 138], 45);
gen_frost('cryo_frost', [200, 215, 230], [240, 248, 255], 46);
gen_hazardStripe('hazard_stripe', [220, 190, 60], [25, 25, 28], 47);

// Exterior wall variants (concrete pad + cement/shingle/siding/brick)
gen_wallCement('wall_cement',   20);
gen_wallShingle('wall_shingle', 21);
gen_wallSiding('wall_siding',   22);
gen_wallBrick('wall_brick',     23);

// Fences — RGBA with true transparent holes.
gen_wallChainLink('wall_chain_link', 30, false);
gen_wallChainLink('wall_barbed_wire', 31, true);

console.log('done.');
