// === NATURAL STARTER MAP GENERATOR ===
//
// Produces tree decorations clumped inside the darkest terrain-brightness
// blobs, with species biased by local brightness. No buildings, no walls,
// no floors, no zones — the player begins on empty greenfield.

import { PLACEABLES } from '../data/placeables/index.js';

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
// Each forest clump is dominated by one species (a pine grove, an oak
// stand, a birch copse, etc.) with a secondary species mixed in and a
// small amount of shrub understory. Clumps cycle through this table by
// index, so seeing clumps side-by-side shows visibly different forests.

const CLUMP_SPECIES = [
  { primary: 'pineTree',    secondary: 'cedarTree' },
  { primary: 'oakTree',     secondary: 'mapleTree' },
  { primary: 'birchTree',   secondary: 'smallTree' },
  { primary: 'mapleTree',   secondary: 'elmTree' },
  { primary: 'cedarTree',   secondary: 'pineTree' },
  { primary: 'willowTree',  secondary: 'birchTree' },
  { primary: 'elmTree',     secondary: 'oakTree' },
  { primary: 'smallTree',   secondary: 'mapleTree' },
];

function pickClumpSpecies(clumpEntry, rng) {
  const r = rng();
  if (r < 0.75) return clumpEntry.primary;
  if (r < 0.95) return clumpEntry.secondary;
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

const WORLD_BOUND = 30;       // sampling bounds for placement (matches GRASS_RANGE in world-snapshot.js)
const CLEARING_RADIUS = 6;    // |col| <= 6 && |row| <= 6 is off-limits
const MAX_CLUSTERS = 10;      // a handful of distinct, notable forest clumps
const DARK_CLUSTER_THRESHOLD = -0.1;
const CLUMP_RADIUS_MIN = 10;  // even a tiny blob gets a real grove, not 2 trees
const CLUMP_RADIUS_MAX = 16;  // cap clump radius so large blobs don't produce diffuse forests
const CLUMP_MIN_BLOB_SIZE = 3;   // filter out blobs too small to anchor a clump
const CLUMP_CENTER_BOUND = 40;   // require blob center within WORLD_BOUND+10 so the clump's on-map portion is substantial

function inClearing(col, row) {
  return Math.abs(col) <= CLEARING_RADIUS && Math.abs(row) <= CLEARING_RADIUS;
}

function outOfBounds(col, row) {
  return Math.abs(col) > WORLD_BOUND || Math.abs(row) > WORLD_BOUND;
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
  //    outside world bounds (their on-map portion would be vestigial).
  //    Darkest-first, up to MAX_CLUSTERS.
  const clusters = terrainBlobs
    .filter(b => b.brightness <= DARK_CLUSTER_THRESHOLD
      && Math.min(b.sx, b.sy) >= CLUMP_MIN_BLOB_SIZE
      && Math.abs(b.cx) <= CLUMP_CENTER_BOUND
      && Math.abs(b.cy) <= CLUMP_CENTER_BOUND)
    .slice()
    .sort((a, b) => a.brightness - b.brightness)
    .slice(0, MAX_CLUSTERS);

  // 2. Per clump: dense Gaussian scatter in the blob's rotated frame.
  //    Each clump is assigned a primary species from CLUMP_SPECIES by index,
  //    so neighboring clumps look visibly distinct. Radius is clamped to
  //    [CLUMP_RADIUS_MIN, CLUMP_RADIUS_MAX] so even tiny blobs produce a
  //    substantial grove instead of 2 lonely trees.
  for (let ci = 0; ci < clusters.length; ci++) {
    const blob = clusters[ci];
    const clumpEntry = CLUMP_SPECIES[ci % CLUMP_SPECIES.length];
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

  return {
    floors: [],
    zones: [],
    walls: [],
    doors: [],
    placeables,
    placeableNextId: nextIdRef.value,
  };
}
