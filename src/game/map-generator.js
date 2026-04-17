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

// ── Species table — brightness bin → { primaries, secondaries, primaryFrac } ─
// Within a bin, pick primaries with probability `primaryFrac`, secondaries
// otherwise. Within a pool, pick uniformly.

const SPECIES_BINS = [
  {
    maxBrightness: -0.6,
    primaryFrac: 0.80,
    primaries: ['pineTree', 'cedarTree'],
    secondaries: ['oakTree', 'mapleTree'],
  },
  {
    maxBrightness: -0.3,
    primaryFrac: 0.70,
    primaries: ['oakTree', 'mapleTree', 'elmTree', 'willowTree'],
    secondaries: ['pineTree', 'cedarTree'],
  },
  {
    maxBrightness: 0.2,
    primaryFrac: 0.70,
    primaries: ['oakTree', 'mapleTree', 'smallTree'],
    secondaries: ['birchTree'],
  },
  {
    maxBrightness: Infinity,
    primaryFrac: 0.75,
    primaries: ['birchTree', 'smallTree'],
    secondaries: ['birchTree', 'smallTree'],
  },
];

function pickSpeciesForBrightness(brightness, rng) {
  const bin = SPECIES_BINS.find(b => brightness < b.maxBrightness) || SPECIES_BINS[SPECIES_BINS.length - 1];
  const pool = rng() < bin.primaryFrac ? bin.primaries : bin.secondaries;
  return pool[Math.floor(rng() * pool.length)];
}

// ── Decoration placement ────────────────────────────────────────────

function placeTreeDecoration(placeables, type, col, row, nextIdRef) {
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
    subCol: 0,
    subRow: 0,
    dir: 0,
    rotated: false,
    cells: def.footprintCells(col, row, 0, 0, 0),
    params: def.params ? { ...def.params } : null,
    placeY: 0,
    stackParentId: null,
    stackChildren: [],
  });
  return id;
}

// ── Helpers ─────────────────────────────────────────────────────────

const WORLD_BOUND = 60;       // sampling bounds for placement
const CLEARING_RADIUS = 6;    // |col| <= 6 && |row| <= 6 is off-limits
const MAX_CLUSTERS = 8;
const DARK_CLUSTER_THRESHOLD = -0.3;

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

function tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef) {
  const def = PLACEABLES[type];
  if (!def) return false;
  if (outOfBounds(col, row)) return false;
  if (inClearing(col, row)) return false;
  const cells = footprintCells(def, col, row);
  for (const key of cells) {
    if (treeCells.has(key)) return false;
  }
  placeTreeDecoration(placeables, type, col, row, nextIdRef);
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

  // 1. Select dark-soil cluster centers: brightness <= -0.3, darkest first,
  //    up to 8 clusters.
  const clusters = terrainBlobs
    .filter(b => b.brightness <= DARK_CLUSTER_THRESHOLD)
    .slice()
    .sort((a, b) => a.brightness - b.brightness)
    .slice(0, MAX_CLUSTERS);

  // 2. Per cluster: Gaussian-ish scatter inside the blob's rotated frame.
  for (const blob of clusters) {
    const count = Math.min(25, Math.max(8, Math.round(blob.sx * blob.sy * 0.35)));
    const r = Math.min(blob.sx, blob.sy) * 1.1;
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

      const localB = sampleTerrainBrightness(col, row, terrainBlobs);
      const type = pickSpeciesForBrightness(localB, rng);
      if (tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef)) {
        placed++;
      }
    }
  }

  // 3. Bright-patch scatter: shrubs / birches on light soil patches.
  for (let i = 0; i < 25; i++) {
    const col = Math.floor(rng() * (WORLD_BOUND * 2 + 1)) - WORLD_BOUND;
    const row = Math.floor(rng() * (WORLD_BOUND * 2 + 1)) - WORLD_BOUND;
    if (inClearing(col, row)) continue;
    const b = sampleTerrainBrightness(col, row, terrainBlobs);
    if (b > 0.15) {
      const type = rng() < 0.5 ? 'shrub' : 'birchTree';
      tryPlaceTree(type, col, row, placeables, treeCells, nextIdRef);
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
