// === NATURAL STARTER MAP GENERATOR ===
//
// Produces tree decorations clumped inside the darkest terrain-brightness
// blobs, with species biased by local brightness. No buildings, no walls,
// no floors, no zones — the player begins on empty greenfield.

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
  oakStand:   { primary: 'oakTree',    secondary: 'mapleTree' },
  smallCopse: { primary: 'smallTree',  secondary: 'shrub'     },
  birchMix:   { primary: 'birchTree',  secondary: 'elmTree'   },
  lowland:    { primary: 'willowTree', secondary: 'birchTree' },
};

function pickClumpCategory(brightness, elevation) {
  // brightness ∈ [-1, 1] (negative = darker); elevation = 0..HILL_MAX_STEPS.
  // Bands stack so ranges don't overlap:
  //   4-5 → conifer  (peaks)
  //   3   → oakStand (upper slopes)
  //   1-2 → smallCopse (mid-slope band — small trees are a slope species)
  //   0   → birchMix (flat dark) or lowland (flat mildly dark)
  if (elevation >= 4) return 'conifer';
  if (elevation >= 3) return 'oakStand';
  if (elevation >= 1) return 'smallCopse';
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
const MAX_CLUSTERS = 10;      // a handful of distinct, notable forest clumps
const DARK_CLUSTER_THRESHOLD = -0.1;
const CLUMP_RADIUS_MIN = 10;  // even a tiny blob gets a real grove, not 2 trees
const CLUMP_RADIUS_MAX = 16;  // cap clump radius so large blobs don't produce diffuse forests
const CLUMP_MIN_BLOB_SIZE = 3;   // filter out blobs too small to anchor a clump
const CLUMP_CENTER_MARGIN = 10;  // blob center allowed up to this far outside the map region
const CLUMP_MIN_SEPARATION = 30; // minimum distance between clump centers, so groves don't bunch up

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

// ── Blob-driven elevation ───────────────────────────────────────────
// Dark terrain blobs push terrain UP; bright blobs stay at 0. The same
// blob field drives grass tint (terrain-builder), tree placement (below),
// and now hills — so the patterns line up visually.

const HILL_MAX_STEPS = 5;     // dark-blob peaks: up to 2.5m
const HILL_SCALE = 5.0;       // typical dark-peak height in steps
const HOLLOW_MAX_STEPS = 3;   // bright-blob hollows: down to -1.5m
const HOLLOW_SCALE = 3.0;     // typical bright-peak depth in steps

/** Brightness-derived corner height. Dark blobs push UP (hills); bright
 *  blobs push DOWN (hollows). No central pin — terrain flows through the
 *  whole map. Tree placement keeps a spawn clearing separately. */
function cornerHeightAt(col, row, blobs) {
  const b = sampleTerrainBrightness(col, row, blobs);
  if (b < 0) {
    const h = Math.round(-b * HILL_SCALE);
    return Math.min(HILL_MAX_STEPS, h);
  }
  const h = Math.round(-b * HOLLOW_SCALE); // negative for bright b
  return Math.max(-HOLLOW_MAX_STEPS, h);
}

/** Iterative smoothing: enforce per-tile max-min ≤ 1 over the full corner
 *  grid BEFORE writing tiles. Without this, setTileCorners would clamp the
 *  3 non-anchor corners independently per tile, and adjacent tiles would
 *  disagree at their shared edge — that's the source of visible cliffs.
 *  Here we pull outlier peaks down by 1 step per pass until every 2×2
 *  corner window spans ≤ 1 step. Tall peaks survive; slopes linearize at
 *  the invariant's natural rate of 1 step per tile. */
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

function addBlobElevation(cornerHeights, blobs) {
  if (!blobs || blobs.length === 0) return;

  // 1. Sample raw corner grid from blobs.
  const grid = new Map();
  for (let col = -WORLD_BOUND; col <= WORLD_BOUND + 1; col++) {
    for (let row = -WORLD_BOUND; row <= WORLD_BOUND + 1; row++) {
      grid.set(col + ',' + row, cornerHeightAt(col, row, blobs));
    }
  }

  // 2. Smooth so every 2×2 corner window spans ≤ 1 step.
  smoothCornerGrid(grid);

  // 3. Write per-tile via setTileCorners. With the grid pre-smoothed, no
  //    NW-anchor cascade fires, so adjacent tiles agree at shared edges.
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
    // from neighboring blobs, not just this blob's solo strength), then
    // convert to the same elevation units the hills use.
    const centerBrightness = sampleTerrainBrightness(blob.cx, blob.cy, terrainBlobs);
    const centerElevation = Math.max(0,
      Math.min(HILL_MAX_STEPS, Math.round(-centerBrightness * HILL_SCALE)));
    const clumpEntry = CLUMP_CATEGORIES[pickClumpCategory(centerBrightness, centerElevation)];
    const r = Math.max(CLUMP_RADIUS_MIN,
      Math.min(Math.min(blob.sx, blob.sy) * 1.3, CLUMP_RADIUS_MAX));
    // Area-driven density: aim for ~0.55 trees per square unit of clump area.
    const area = Math.PI * r * r;
    const count = Math.min(160, Math.max(50, Math.round(area * 0.55)));
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
    for (let i = 0; i < 20; i++) {
      const col = Math.floor(rng() * (WORLD_BOUND * 2 + 1)) - WORLD_BOUND;
      const row = Math.floor(rng() * (WORLD_BOUND * 2 + 1)) - WORLD_BOUND;
      const type = SCATTER_POOL[Math.floor(rng() * SCATTER_POOL.length)];
      tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef, rng);
    }
  }

  const floors = [];
  const walls = [];
  const cornerHeights = new Map();
  addBlobElevation(cornerHeights, terrainBlobs);

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
