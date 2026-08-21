// src/game/edge-keys.js — one definition of tile-edge identity.
//
// A wall or door lives on the edge BETWEEN two tiles, but the occupancy maps
// (state.wallOccupied / state.doorOccupied) key it by one tile plus a
// direction: "col,row,edge". Every physical edge therefore has two equally
// valid keys — "5,5,n" and "5,4,s" name the same wall — and which one a
// segment is actually stored under depends on which tile the player happened
// to be hovering when they drew it. Code that checks only the key it was
// handed sees "no wall here" half the time; that was the long-standing cause
// of doors refusing to place from one side of a wall.
//
// Rule: never test an edge key directly. Resolve it through findWallKey /
// findEdgeKey first, and store at the key that came back so the renderer's
// exact-key lookups (wall-builder matches doors to walls by key) line up.

/** Neighbour tile and the mirrored edge name, per edge. */
export const EDGE_DELTAS = {
  n: { dc: 0, dr: -1, opposite: 's' },
  e: { dc: 1, dr: 0, opposite: 'w' },
  s: { dc: 0, dr: 1, opposite: 'n' },
  w: { dc: -1, dr: 0, opposite: 'e' },
};

export const EDGES = ['n', 'e', 's', 'w'];

/** Canonical occupancy-map key for a tile edge. */
export function edgeKey(col, row, edge) {
  return `${col},${row},${edge}`;
}

/** Inverse of edgeKey. Returns null for anything that isn't an edge key. */
export function parseEdgeKey(key) {
  const parts = String(key).split(',');
  if (parts.length !== 3) return null;
  const col = Number(parts[0]);
  const row = Number(parts[1]);
  const edge = parts[2];
  if (!Number.isFinite(col) || !Number.isFinite(row) || !EDGE_DELTAS[edge]) return null;
  return { col, row, edge };
}

/**
 * The same physical edge expressed from the neighbouring tile.
 * (5,5,'n') -> (5,4,'s'). Returns null for an unknown edge name.
 */
export function mirrorEdge(col, row, edge) {
  const d = EDGE_DELTAS[edge];
  if (!d) return null;
  return { col: col + d.dc, row: row + d.dr, edge: d.opposite };
}

/**
 * Which of the two keys for this edge actually holds an entry in `occupied`
 * (a plain "key -> type" map), preferring the direct one. Returns the key
 * string, or null when neither side is occupied.
 */
export function findEdgeKey(occupied, col, row, edge) {
  if (!occupied) return null;
  const direct = edgeKey(col, row, edge);
  if (occupied[direct]) return direct;
  const m = mirrorEdge(col, row, edge);
  if (!m) return null;
  const mirror = edgeKey(m.col, m.row, m.edge);
  return occupied[mirror] ? mirror : null;
}

/** findEdgeKey under the name the wall/door call sites use. */
export function findWallKey(wallOccupied, col, row, edge) {
  return findEdgeKey(wallOccupied, col, row, edge);
}

/** True when `key` is the mirrored (neighbour-tile) spelling of this edge. */
export function isMirroredKey(key, col, row, edge) {
  return !!key && key !== edgeKey(col, row, edge);
}

// --- Door openings along an edge ---
//
// An edge is divided into SUBTILES_PER_EDGE slots. A door record carries
// `off`: the integer index of the first slot its opening covers, measured
// from the edge's FIRST-listed corner in buildWalls' corner order:
//   'n' = NW -> NE   'e' = NE -> SE   's' = SE -> SW   'w' = SW -> NW
// A single door is 2 slots wide; newly placed singles snap to either half of
// the edge (off 0 or 2). The legacy centred off=1 remains valid so old saves
// retain their authored geometry. A double fills all 4 slots (off 0).

export const SUBTILES_PER_EDGE = 4;

/** Opening width in subtiles for a DOOR_TYPES def. Unknown defs read single. */
export function doorSubWidth(doorDef) {
  return doorDef && doorDef.doorWidth === 'double' ? SUBTILES_PER_EDGE : 2;
}

/**
 * Offset used when a door record carries none. 1 for singles (centered — the
 * geometry every pre-`off` door was drawn with), 0 for doubles.
 */
export function defaultDoorOff(doorDef) {
  return doorSubWidth(doorDef) >= SUBTILES_PER_EDGE ? 0 : 1;
}

/** Round + clamp an offset into the legal range for this door width. */
export function clampDoorOff(doorDef, off) {
  if (!Number.isFinite(off)) return defaultDoorOff(doorDef);
  const max = SUBTILES_PER_EDGE - doorSubWidth(doorDef);
  return Math.max(0, Math.min(max, Math.round(off)));
}

/**
 * Quantize a fractional position along an edge (0 at the first-listed corner,
 * 1 at the second) into the first or second tile half. Missing fractions keep
 * the legacy centered default.
 */
export function doorOffFromFrac(frac, doorDef) {
  const w = doorSubWidth(doorDef);
  if (!Number.isFinite(frac)) return defaultDoorOff(doorDef);
  if (w >= SUBTILES_PER_EDGE) return 0;
  return frac < 0.5 ? 0 : SUBTILES_PER_EDGE - w;
}

/**
 * Re-express an offset in the mirrored edge's corner order. The two spellings
 * of an edge run in opposite directions, so an opening 1 slot from the NW end
 * of "5,5,n" is (4 - width - 1) slots from the far end of "5,4,s".
 */
export function mirrorDoorOff(off, doorDef) {
  const max = SUBTILES_PER_EDGE - doorSubWidth(doorDef);
  return max - clampDoorOff(doorDef, off);
}

// --- Multi-tile doors ----------------------------------------------------

/** Number of whole tile edges occupied by one door record. */
export function doorTileSpan(doorDef) {
  const raw = Number(doorDef?.tileSpan);
  return Number.isInteger(raw) && raw > 1 ? raw : 1;
}

/**
 * Give a physical edge one stable spelling. Horizontal seams use `n` and
 * vertical seams use `e`, so a multi-tile opening always grows toward
 * increasing col/row regardless of which side of its wall was clicked.
 */
export function canonicalEdge(col, row, edge) {
  if (edge === 'n' || edge === 'e') return { col, row, edge };
  if (edge === 's' || edge === 'w') return mirrorEdge(col, row, edge);
  return null;
}

/** A fixed-length colinear edge run, including `start`. */
export function doorSpanPath(start, span, direction = 1) {
  const count = Math.max(1, Math.round(Number(span) || 1));
  const step = direction < 0 ? -1 : 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      col: start.col + ((start.edge === 'n' || start.edge === 's') ? i * step : 0),
      row: start.row + ((start.edge === 'e' || start.edge === 'w') ? i * step : 0),
      edge: start.edge,
    });
  }
  return out;
}

/**
 * Canonicalize, sort, and validate a requested run for one multi-tile door.
 * Returns null when it is not exactly the authored length on one straight
 * physical wall line.
 */
export function normalizeDoorSpanPath(path, doorDef) {
  const span = doorTileSpan(doorDef);
  const sites = (path || []).map(pt => canonicalEdge(pt.col, pt.row, pt.edge));
  if (sites.length !== span || sites.some(site => !site)) return null;
  const edge = sites[0].edge;
  if (sites.some(site => site.edge !== edge)) return null;
  sites.sort(edge === 'n'
    ? (a, b) => a.col - b.col || a.row - b.row
    : (a, b) => a.row - b.row || a.col - b.col);
  for (let i = 0; i < sites.length; i++) {
    const expectedCol = sites[0].col + (edge === 'n' ? i : 0);
    const expectedRow = sites[0].row + (edge === 'e' ? i : 0);
    if (sites[i].col !== expectedCol || sites[i].row !== expectedRow) return null;
  }
  return sites;
}

/** Every physical edge claimed by a saved door record. */
export function doorRecordEdges(record, doorDef) {
  if (doorTileSpan(doorDef) === 1) {
    return record && EDGE_DELTAS[record.edge]
      ? [{ col: record.col, row: record.row, edge: record.edge }]
      : [];
  }
  const authored = Array.isArray(record?.segments) && record.segments.length
    ? record.segments
    : doorSpanPath(record, doorTileSpan(doorDef));
  return authored.map(pt => canonicalEdge(pt.col, pt.row, pt.edge)).filter(Boolean);
}

/** True when a record owns the requested physical edge. */
export function doorRecordCoversEdge(record, doorDef, col, row, edge) {
  const wanted = canonicalEdge(col, row, edge);
  if (!wanted) return false;
  return doorRecordEdges(record, doorDef).some(site => {
    const held = canonicalEdge(site.col, site.row, site.edge);
    return held?.col === wanted.col && held?.row === wanted.row && held?.edge === wanted.edge;
  });
}

// --- Compact windows along an edge ---------------------------------------
// Only defs authored as `windowWidth: 'half'` use edge slots. Existing
// narrow/single/double catalogue windows keep their centred continuous-width
// geometry, while compact windows snap cleanly to the first or second half.

export function windowSubWidth(windowDef) {
  return windowDef?.windowWidth === 'half' ? 2 : SUBTILES_PER_EDGE;
}

export function defaultWindowOff(windowDef) {
  return windowSubWidth(windowDef) >= SUBTILES_PER_EDGE ? 0 : 1;
}

export function clampWindowOff(windowDef, off) {
  if (!Number.isFinite(off)) return defaultWindowOff(windowDef);
  const max = SUBTILES_PER_EDGE - windowSubWidth(windowDef);
  return Math.max(0, Math.min(max, Math.round(off)));
}

export function windowOffFromFrac(frac, windowDef) {
  const w = windowSubWidth(windowDef);
  if (!Number.isFinite(frac)) return defaultWindowOff(windowDef);
  if (w >= SUBTILES_PER_EDGE) return 0;
  return frac < 0.5 ? 0 : SUBTILES_PER_EDGE - w;
}

export function mirrorWindowOff(off, windowDef) {
  const max = SUBTILES_PER_EDGE - windowSubWidth(windowDef);
  return max - clampWindowOff(windowDef, off);
}
