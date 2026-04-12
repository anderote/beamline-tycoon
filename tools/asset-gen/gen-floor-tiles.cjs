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

// ── tile_cobblestone: small irregular stones on light gray ───────────
function gen_cobblestone() {
  const png = makePng();
  const rand = mulberry32(505);
  // Light gray base in 2×2 chunks to match the chunky RCT2 pixel scale.
  const baseR = 158, baseG = 156, baseB = 152;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 12;
      setBlock(png, x, y, baseR + n, baseG + n, baseB + n, CHUNK);
    }
  }
  // Scatter stones: each stone is an irregular blob of 2×2 chunks
  // (2–4 chunks across = 4–8 texture pixels, ~1 world tile at TEXEL_SCALE=32).
  const stoneCount = 40;
  for (let s = 0; s < stoneCount; s++) {
    // Snap stone center to chunk grid.
    const cx = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const cy = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const radius = 1 + Math.floor(rand() * 2); // 1 or 2 chunks
    const tone = rand();
    let sr, sg, sb;
    if (tone < 0.6) {
      const v = 80 + Math.floor(rand() * 30);
      sr = v; sg = v; sb = v - 4;
    } else if (tone < 0.85) {
      const v = 110 + Math.floor(rand() * 25);
      sr = v + 8; sg = v; sb = v - 8;
    } else {
      const v = 175 + Math.floor(rand() * 20);
      sr = v; sg = v - 2; sb = v - 6;
    }
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius + 0.5) continue;
        if (d2 >= radius * radius - 0.5 && rand() < 0.4) continue;
        const n = (rand() - 0.5) * 14;
        setBlock(png, cx + dx * CHUNK, cy + dy * CHUNK, sr + n, sg + n, sb + n, CHUNK);
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
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const n = (rand() - 0.5) * 18;
      setBlock(png, x, y, baseR + n, baseG + n, baseB + n, CHUNK);
    }
  }
  const chunks = (SIZE / CHUNK) * (SIZE / CHUNK);
  // Dark grit (~4%)
  for (let i = 0; i < chunks * 0.04; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    setBlock(png, x, y, 80, 58, 38, CHUNK);
  }
  // Light grains (~3%)
  for (let i = 0; i < chunks * 0.03; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    setBlock(png, x, y, 195, 158, 110, CHUNK);
  }
  writePng(png, 'tile_dirt');
}

// ── tile_pavement: dark asphalt slabs with dotted faint joint lines ──
function gen_pavement() {
  const png = makePng();
  const rand = mulberry32(707);
  const baseR = 105, baseG = 105, baseB = 108;
  const jointR = 88, jointG = 88, jointB = 92;
  const SLAB = 32;
  const CHUNK = 2;
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const tx = x % SLAB;
      const ty = y % SLAB;
      // 2-px-wide joint at right/bottom edge of each slab.
      const onSeamX = tx === SLAB - CHUNK;
      const onSeamY = ty === SLAB - CHUNK;
      if (onSeamX || onSeamY) {
        // Dotted: every other chunk along the seam is joint color.
        const seamPos = onSeamX ? y : x;
        if ((seamPos / CHUNK) % 2 === 0) {
          const n = (rand() - 0.5) * 6;
          setBlock(png, x, y, jointR + n, jointG + n, jointB + n, CHUNK);
          continue;
        }
      }
      const n = (rand() - 0.5) * 16;
      setBlock(png, x, y, baseR + n, baseG + n, baseB + n, CHUNK);
    }
  }
  // Sparse brighter aggregate flecks (~2%).
  const chunks = (SIZE / CHUNK) * (SIZE / CHUNK);
  for (let i = 0; i < chunks * 0.02; i++) {
    const x = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const y = Math.floor(rand() * (SIZE / CHUNK)) * CHUNK;
    const v = 145 + Math.floor(rand() * 25);
    setBlock(png, x, y, v, v, v + 2, CHUNK);
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

gen_labFloor();
gen_concrete();
gen_officeFloor();
gen_brick();
gen_cobblestone();
gen_dirt();
gen_pavement();
gen_groomedGrass();
gen_grass();
gen_hardwoodBirch();
gen_hardwoodOak();
gen_carpetDiamond();
gen_labCheckBlack();
gen_labCheckRed();
gen_labHoundstoothBW();

console.log('done.');
