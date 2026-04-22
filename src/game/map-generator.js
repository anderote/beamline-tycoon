// === NATURAL STARTER MAP GENERATOR ===
//
// Produces tree decorations clumped inside the darkest terrain-brightness
// blobs, with species biased by local brightness. Terrain is mostly flat
// at y=0 with a few isolated hills and hollows stamped as smooth radial
// features — gentle enough to guarantee no cliffs between adjacent tiles.
// No buildings, no walls, no floors, no zones — the player begins on
// empty greenfield.

import { PLACEABLES } from '../data/placeables/index.js';
import { setTileCorners } from './terrain.js';

// ── Terrain brightness sampler ──────────────────────────────────────
// (Canonical copy lives in src/renderer3d/world-snapshot.js. Duplicated
// here because both modules need it and the function is ten lines; extract
// to a shared helper if a third caller ever appears.)

function sampleTerrainBrightness(col, row, blobs) {
  let val = 0;
  for (const blob of blobs) {
    const dx = col - blob.cx;
    const dy = row - blob.cy;
    const cos = Math.cos(blob.angle);
    const sin = Math.sin(blob.angle);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const ex = (lx * lx) / (2 * blob.sx * blob.sx);
    const ey = (ly * ly) / (2 * blob.sy * blob.sy);
    val += blob.brightness * Math.exp(-(ex + ey));
  }
  return Math.max(-1, Math.min(1, val));
}

// ── Per-clump species assignment ─────────────────────────────────────
// Species are chosen by the clump's characteristics, not by index:
// conifers (pine/cedar) dominate the darkest, most elevated peaks;
// hardwoods (oak/maple, elm/birch) claim mid-dark slopes; willow and
// small trees gather on flatter, less-dark ground. This keeps the
// visible terrain pattern (dark blobs = forested hills, bright blobs =
// sunlit meadows) legible from the tree-species layer alone.

const CLUMP_CATEGORIES = {
  conifer:    { primary: 'pineTree',   secondary: 'cedarTree' },
  mixedStand: { primary: 'oakTree',    secondary: 'pineTree'  },
  oakStand:   { primary: 'oakTree',    secondary: 'mapleTree' },
  aspenGrove: { primary: 'birchTree',  secondary: 'mapleTree' },
  smallCopse: { primary: 'smallTree',  secondary: 'shrub'     },
  birchMix:   { primary: 'birchTree',  secondary: 'elmTree'   },
  lowland:    { primary: 'willowTree', secondary: 'birchTree' },
};

function pickClumpCategory(brightness, band, rng) {
  // brightness ∈ [-1, 1] (negative = darker); band is a 0..TREE_BAND_MAX bucket
  // derived from brightness (see TREE_BAND_SCALE). Species layer the map:
  //   4-5 → conifer or mixedStand (darkest cores — coin-flip for variety)
  //   3   → oakStand or mixedStand (dark shoulders)
  //   2   → aspenGrove or smallCopse
  //   1   → smallCopse
  //   0   → birchMix (flat dark) or lowland (flat mildly dark)
  if (band >= 4) return rng() < 0.7 ? 'conifer' : 'mixedStand';
  if (band >= 3) return rng() < 0.55 ? 'oakStand' : 'mixedStand';
  if (band >= 2) return rng() < 0.5 ? 'aspenGrove' : 'smallCopse';
  if (band >= 1) return 'smallCopse';
  if (brightness <= -0.25) return 'birchMix';
  return 'lowland';
}

function pickClumpSpecies(entry, rng) {
  const r = rng();
  if (r < 0.75) return entry.primary;
  if (r < 0.95) return entry.secondary;
  return 'shrub';
}

// Lonely-tree scatter uses a mixed pool that reads as "wild individual
// trees" rather than re-asserting any of the named clump species.
const SCATTER_POOL = ['shrub', 'smallTree', 'birchTree'];

// ── Decoration placement ────────────────────────────────────────────

function placeTreeDecoration(placeables, type, col, row, subCol, subRow, nextIdRef) {
  const def = PLACEABLES[type];
  if (!def) return null;
  const id = `dc_${nextIdRef.value++}`;
  placeables.push({
    id,
    type,
    category: def.kind,
    kind: def.kind,
    col,
    row,
    subCol,
    subRow,
    dir: 0,
    rotated: false,
    cells: def.footprintCells(col, row, subCol, subRow, 0),
    params: def.params ? { ...def.params } : null,
    placeY: 0,
    stackParentId: null,
    stackChildren: [],
  });
  return id;
}

// ── Helpers ─────────────────────────────────────────────────────────

// Map shape is an axis-aligned square (|col| <= MAP_EXTENT, |row| <= MAP_EXTENT).
const MAP_EXTENT = 35;        // half-side of the square map region
const LONG_EXTENT = MAP_EXTENT;    // retained names used by clump-center margin checks
const NARROW_EXTENT = MAP_EXTENT;
const WORLD_BOUND = MAP_EXTENT;    // axis-aligned iteration bound; matches GRASS_RANGE in world-snapshot.js
const CLEARING_RADIUS = 6;    // |col| <= 6 && |row| <= 6 is off-limits
const MAX_CLUSTERS = 18;      // distinct, notable forest clumps across the map
const DRAMATIC_CLUMP_COUNT = 3; // this many clumps get a bigger radius + density
const DARK_CLUSTER_THRESHOLD = -0.1;
const CLUMP_RADIUS_MIN = 10;  // even a tiny blob gets a real grove, not 2 trees
const CLUMP_RADIUS_MAX = 16;  // cap clump radius so large blobs don't produce diffuse forests
const DRAMATIC_CLUMP_RADIUS_MAX = 22; // dramatic clumps can sprawl larger
const CLUMP_MIN_BLOB_SIZE = 3;   // filter out blobs too small to anchor a clump
const CLUMP_CENTER_MARGIN = 10;  // blob center allowed up to this far outside the map region
const CLUMP_MIN_SEPARATION = 22; // minimum distance between clump centers, so groves don't bunch up

// Tree-species categorization reads a virtual "elevation band" derived from
// blob brightness. This is independent from the actual terrain hills below;
// it's just a convenient 5-band bucketing of brightness for pickClumpCategory.
const TREE_BAND_SCALE = 5.0;
const TREE_BAND_MAX = 5;

/** True if (col, row) lies inside the axis-aligned long-narrow map region.
 * Exported so the renderer-side snapshot can mask grass to the same shape. */
export function inMapRegion(col, row) {
  return Math.abs(col) <= LONG_EXTENT && Math.abs(row) <= NARROW_EXTENT;
}

function inClearing(col, row) {
  return Math.abs(col) <= CLEARING_RADIUS && Math.abs(row) <= CLEARING_RADIUS;
}

function outOfBounds(col, row) {
  return !inMapRegion(col, row);
}

function footprintCells(def, col, row) {
  const gw = Math.max(1, Math.ceil((def.subW || 4) / 4));
  const gh = Math.max(1, Math.ceil((def.subL || 4) / 4));
  const cells = [];
  for (let dr = 0; dr < gh; dr++) {
    for (let dc = 0; dc < gw; dc++) {
      cells.push((col + dc) + ',' + (row + dr));
    }
  }
  return cells;
}

function tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef, rng) {
  const def = PLACEABLES[type];
  if (!def) return false;
  if (outOfBounds(col, row)) return false;
  if (inClearing(col, row)) return false;
  const cells = footprintCells(def, col, row);
  for (const key of cells) {
    if (treeCells.has(key)) return false;
  }
  // Sub-cell jitter: place the tree somewhere inside its tile instead of
  // snapping to the top-left corner, so a field of trees doesn't render
  // as an obvious grid. Bounds keep the tree within its assigned tile.
  const subW = def.subW || 4;
  const subL = def.subL || 4;
  const subCol = Math.floor(rng() * Math.max(1, 5 - subW));
  const subRow = Math.floor(rng() * Math.max(1, 5 - subL));
  placeTreeDecoration(placeables, type, col, row, subCol, subRow, nextIdRef);
  for (const key of cells) treeCells.add(key);
  return true;
}

// ── Isolated hill / hollow elevation ────────────────────────────────
// The map is mostly flat at y=0 with a handful of discrete radial bumps
// and dimples. Slopes are engineered gentle enough (radius ≥ amp × 4)
// that after rounding to integer steps the cross-tile invariant
// (max-min ≤ 1 per 2×2 corner window) holds — i.e. no cliffs.

const HILL_MAX_STEPS = 4;     // default peak height: up to 2m
const DRAMATIC_HILL_MIN_STEPS = 5;  // dramatic hill floor: 2.5m
const DRAMATIC_HILL_MAX_STEPS = 7;  // dramatic hill cap: 3.5m
const NUM_DRAMATIC_HILLS = 2; // how many of NUM_HILLS get the dramatic treatment
const HOLLOW_MAX_STEPS = 4;   // hollow depth: down to −2m
const NUM_HILLS = 6;
const NUM_HOLLOWS = 4;
const FEATURE_MIN_SEPARATION = 14;
const FEATURE_CLEARING_RADIUS = CLEARING_RADIUS + 4;
const FEATURE_PICK_ATTEMPTS = 100;
// Radius multiplier on amplitude. R = amp × this guarantees linear slope
// averages ≤ 0.25 steps/tile, so the integer-rounded grid stays cliff-free.
const FEATURE_RADIUS_MULTIPLIER = 4;

/** Linear falloff from `feature.amp` at the center to 0 at `feature.radius`.
 *  Returns 0 beyond radius. */
function featureContribution(col, row, feature) {
  const d = Math.hypot(col - feature.cx, row - feature.cy);
  if (d >= feature.radius) return 0;
  return feature.amp * (1 - d / feature.radius);
}

/** Iteratively shave peaks (toward min+1 per 2×2 window) until every 2×2
 *  corner window spans ≤ 1 step. Safety net — our gentle slopes usually
 *  satisfy this already. */
function smoothCornerGrid(grid) {
  const MAX_PASSES = 64;
  const get = (c, r) => grid.get(c + ',' + r) ?? 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let col = -WORLD_BOUND; col <= WORLD_BOUND; col++) {
      for (let row = -WORLD_BOUND; row <= WORLD_BOUND; row++) {
        const nw = get(col,     row);
        const ne = get(col + 1, row);
        const se = get(col + 1, row + 1);
        const sw = get(col,     row + 1);
        const mn = Math.min(nw, ne, se, sw);
        const mx = Math.max(nw, ne, se, sw);
        if (mx - mn <= 1) continue;
        const cap = mn + 1;
        if (nw > cap) { grid.set(col       + ',' + row,       nw - 1); changed = true; }
        if (ne > cap) { grid.set((col + 1) + ',' + row,       ne - 1); changed = true; }
        if (se > cap) { grid.set((col + 1) + ',' + (row + 1), se - 1); changed = true; }
        if (sw > cap) { grid.set(col       + ',' + (row + 1), sw - 1); changed = true; }
      }
    }
    if (!changed) return;
  }
}

function pickFeatureCenter(existing, rng) {
  const range = MAP_EXTENT - 4;
  for (let attempt = 0; attempt < FEATURE_PICK_ATTEMPTS; attempt++) {
    const cx = Math.round((rng() * 2 - 1) * range);
    const cy = Math.round((rng() * 2 - 1) * range);
    if (Math.abs(cx) < FEATURE_CLEARING_RADIUS
        && Math.abs(cy) < FEATURE_CLEARING_RADIUS) continue;
    const tooClose = existing.some(f =>
      Math.hypot(f.cx - cx, f.cy - cy) < FEATURE_MIN_SEPARATION);
    if (tooClose) continue;
    return { cx, cy };
  }
  return null;
}

function addHillsAndHollows(cornerHeights, rng) {
  const features = [];
  for (let i = 0; i < NUM_HILLS; i++) {
    const c = pickFeatureCenter(features, rng);
    if (!c) break;
    let peak;
    if (i < NUM_DRAMATIC_HILLS) {
      // Signature taller hills — broader radius keeps the slope cliff-free.
      const span = DRAMATIC_HILL_MAX_STEPS - DRAMATIC_HILL_MIN_STEPS + 1;
      peak = DRAMATIC_HILL_MIN_STEPS + Math.floor(rng() * span);
    } else {
      peak = 2 + Math.floor(rng() * (HILL_MAX_STEPS - 1));
    }
    features.push({ ...c, amp: peak, radius: peak * FEATURE_RADIUS_MULTIPLIER });
  }
  for (let i = 0; i < NUM_HOLLOWS; i++) {
    const c = pickFeatureCenter(features, rng);
    if (!c) break;
    const depth = 1 + Math.floor(rng() * HOLLOW_MAX_STEPS);
    features.push({ ...c, amp: -depth, radius: depth * FEATURE_RADIUS_MULTIPLIER });
  }
  if (features.length === 0) return;

  const grid = new Map();
  for (let col = -WORLD_BOUND; col <= WORLD_BOUND + 1; col++) {
    for (let row = -WORLD_BOUND; row <= WORLD_BOUND + 1; row++) {
      let v = 0;
      for (const f of features) v += featureContribution(col, row, f);
      grid.set(col + ',' + row, Math.round(v));
    }
  }
  smoothCornerGrid(grid);

  const get = (c, r) => grid.get(c + ',' + r) ?? 0;
  const fakeState = { cornerHeights, cornerHeightsRevision: 0 };
  for (let col = -WORLD_BOUND; col <= WORLD_BOUND; col++) {
    for (let row = -WORLD_BOUND; row <= WORLD_BOUND; row++) {
      const nw = get(col,     row);
      const ne = get(col + 1, row);
      const se = get(col + 1, row + 1);
      const sw = get(col,     row + 1);
      if (nw === 0 && ne === 0 && se === 0 && sw === 0) continue;
      setTileCorners(fakeState, col, row, { nw, ne, se, sw });
    }
  }
}

// ── Meadow grass patches ────────────────────────────────────────────
// Bright terrain blobs become wildgrass meadows, with tallgrass filling
// the brightest core so each meadow reads as "tall stalks at the heart
// ringed by shorter wild grass". Patches are placed as floor tiles so
// the renderer's grass-tuft builder picks them up at per-kind density.

const MEADOW_BRIGHTNESS_THRESHOLD = 0.25;
const MAX_MEADOWS = 8;
const MEADOW_MIN_SEPARATION = 16;
const MEADOW_RADIUS_MIN = 4;
const MEADOW_RADIUS_MAX = 10;
const MEADOW_MIN_BLOB_SIZE = 3;

function placeMeadowGrass(blobs, floors, rng) {
  const candidates = blobs
    .filter(b => b.brightness >= MEADOW_BRIGHTNESS_THRESHOLD
      && Math.min(b.sx, b.sy) >= MEADOW_MIN_BLOB_SIZE
      && Math.abs(b.cx) <= LONG_EXTENT
      && Math.abs(b.cy) <= NARROW_EXTENT)
    .slice()
    .sort((a, b) => b.brightness - a.brightness);

  const meadows = [];
  for (const cand of candidates) {
    if (meadows.length >= MAX_MEADOWS) break;
    const tooClose = meadows.some(m =>
      Math.hypot(m.cx - cand.cx, m.cy - cand.cy) < MEADOW_MIN_SEPARATION);
    if (!tooClose) meadows.push(cand);
  }

  const placed = new Set();
  for (const blob of meadows) {
    const rx = Math.max(MEADOW_RADIUS_MIN, Math.min(blob.sx, MEADOW_RADIUS_MAX));
    const ry = Math.max(MEADOW_RADIUS_MIN, Math.min(blob.sy, MEADOW_RADIUS_MAX));
    const cos = Math.cos(blob.angle);
    const sin = Math.sin(blob.angle);
    const extent = Math.ceil(Math.max(rx, ry));
    const colMin = Math.floor(blob.cx) - extent;
    const colMax = Math.ceil(blob.cx) + extent;
    const rowMin = Math.floor(blob.cy) - extent;
    const rowMax = Math.ceil(blob.cy) + extent;
    for (let col = colMin; col <= colMax; col++) {
      for (let row = rowMin; row <= rowMax; row++) {
        if (outOfBounds(col, row) || inClearing(col, row)) continue;
        const key = col + ',' + row;
        if (placed.has(key)) continue;
        const dx = col - blob.cx;
        const dy = row - blob.cy;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const d2 = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
        if (d2 > 1) continue;
        // Ragged edge: outermost ring has a patchy falloff.
        if (d2 > 0.7 && rng() < 0.4) continue;
        // Inner ~35% of the ellipse is the tallgrass core.
        const kind = d2 < 0.35 ? 'tallgrass' : 'wildgrass';
        floors.push({ type: kind, col, row, variant: 0 });
        placed.add(key);
      }
    }
  }
}

// ── Main entry ──────────────────────────────────────────────────────

/**
 * Produce the natural starter map: tree decorations only, placed on the
 * darkest terrain-brightness blobs. Returns the same shape as the old
 * Fermilab generator so Game.js can drop the result into state directly.
 */
export function generateStartingMap(seed = 42, terrainBlobs = []) {
  // Seeded LCG PRNG
  let _seed = (seed | 0) || 1;
  const rng = () => {
    _seed = (_seed * 1664525 + 1013904223) & 0x7fffffff;
    return _seed / 0x7fffffff;
  };

  const placeables = [];
  const treeCells = new Set();
  const nextIdRef = { value: 1 };

  // 1. Select forest-clump centers from the darker terrain blobs. Filter out
  //    tiny blobs (can't anchor a real grove) and blobs centered too far
  //    outside world bounds. Then greedily pick darkest-first up to
  //    MAX_CLUSTERS, enforcing CLUMP_MIN_SEPARATION between chosen centers
  //    so groves don't visually bunch up.
  const candidates = terrainBlobs
    .filter(b => b.brightness <= DARK_CLUSTER_THRESHOLD
      && Math.min(b.sx, b.sy) >= CLUMP_MIN_BLOB_SIZE
      && Math.abs(b.cx) <= LONG_EXTENT + CLUMP_CENTER_MARGIN
      && Math.abs(b.cy) <= NARROW_EXTENT + CLUMP_CENTER_MARGIN)
    .slice()
    .sort((a, b) => a.brightness - b.brightness);
  const clusters = [];
  for (const cand of candidates) {
    if (clusters.length >= MAX_CLUSTERS) break;
    const tooClose = clusters.some(c =>
      Math.hypot(c.cx - cand.cx, c.cy - cand.cy) < CLUMP_MIN_SEPARATION);
    if (!tooClose) clusters.push(cand);
  }

  // 2. Per clump: dense Gaussian scatter in the blob's rotated frame.
  //    Each clump is assigned a primary species from CLUMP_SPECIES by index,
  //    so neighboring clumps look visibly distinct. Radius is clamped to
  //    [CLUMP_RADIUS_MIN, CLUMP_RADIUS_MAX] so even tiny blobs produce a
  //    substantial grove instead of 2 lonely trees.
  for (let ci = 0; ci < clusters.length; ci++) {
    const blob = clusters[ci];
    // Sample the full blob field at the clump center (picks up overlap
    // from neighboring blobs, not just this blob's solo strength) to bin
    // the clump into a tree-species band.
    const centerBrightness = sampleTerrainBrightness(blob.cx, blob.cy, terrainBlobs);
    const centerBand = Math.max(0,
      Math.min(TREE_BAND_MAX, Math.round(-centerBrightness * TREE_BAND_SCALE)));
    const clumpEntry = CLUMP_CATEGORIES[pickClumpCategory(centerBrightness, centerBand, rng)];
    // The first DRAMATIC_CLUMP_COUNT clusters (darkest-first) sprawl larger
    // and pack denser, reading as the map's signature groves.
    const dramatic = ci < DRAMATIC_CLUMP_COUNT;
    const radiusCap = dramatic ? DRAMATIC_CLUMP_RADIUS_MAX : CLUMP_RADIUS_MAX;
    const radiusMul = dramatic ? 1.6 : 1.3;
    const r = Math.max(CLUMP_RADIUS_MIN,
      Math.min(Math.min(blob.sx, blob.sy) * radiusMul, radiusCap));
    // Area-driven density: ~0.65 trees/sq-unit (0.8 for dramatic clumps).
    const area = Math.PI * r * r;
    const densityPerArea = dramatic ? 0.8 : 0.65;
    const count = Math.min(220, Math.max(50, Math.round(area * densityPerArea)));
    const cos = Math.cos(blob.angle);
    const sin = Math.sin(blob.angle);

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 6) {
      attempts++;
      // Sample in blob's rotated frame with Gaussian-ish falloff
      const localX = ((rng() + rng()) / 2 - 0.5) * 2 * r;
      const localY = ((rng() + rng()) / 2 - 0.5) * 2 * r;
      const worldX = blob.cx + localX * cos - localY * sin;
      const worldY = blob.cy + localX * sin + localY * cos;
      const col = Math.round(worldX);
      const row = Math.round(worldY);

      if (outOfBounds(col, row)) continue;
      if (inClearing(col, row)) continue;

      const type = pickClumpSpecies(clumpEntry, rng);
      if (tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef, rng)) {
        placed++;
      }
    }
  }

  // 3. Lonely-tree scatter: a small handful of individual trees (shrubs,
  //    smallTree, birch) sprinkled across the map so the area between
  //    clumps isn't completely bare. Skipped when terrainBlobs is empty so
  //    generateStartingMap(seed, []) returns an empty map for testing.
  if (terrainBlobs.length > 0) {
    for (let i = 0; i < 35; i++) {
      const col = Math.floor(rng() * (WORLD_BOUND * 2 + 1)) - WORLD_BOUND;
      const row = Math.floor(rng() * (WORLD_BOUND * 2 + 1)) - WORLD_BOUND;
      const type = SCATTER_POOL[Math.floor(rng() * SCATTER_POOL.length)];
      tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef, rng);
    }
  }

  const floors = [];
  if (terrainBlobs.length > 0) {
    placeMeadowGrass(terrainBlobs, floors, rng);
  }
  const walls = [];
  const cornerHeights = new Map();
  addHillsAndHollows(cornerHeights, rng);

  return {
    floors,
    zones: [],
    walls,
    doors: [],
    placeables,
    placeableNextId: nextIdRef.value,
    cornerHeights,
  };
}
