// src/utility/line-geometry.js
//
// Pure geometry helpers for utility lines. Unlike beam pipes, utility lines
// support 90° Manhattan bends. Paths are stored as corner-only waypoints;
// expansion walks them at sub-tile (0.25) resolution for hit-testing and mesh
// generation.
//
// One tile = 4 sub-units. A sub-unit = 0.5 world meters.

const STEP = 0.25;
const SUB_PER_TILE = 4;
const EPS = 1e-6;

export function buildManhattanPath(start, end, opts = {}) {
  if (!start || !end) return null;
  const dc = end.col - start.col;
  const dr = end.row - start.row;
  if (Math.abs(dc) < EPS && Math.abs(dr) < EPS) return null;

  if (Math.abs(dc) < EPS || Math.abs(dr) < EPS) {
    return [{ col: start.col, row: start.row }, { col: end.col, row: end.row }];
  }

  const corner = opts.preferVerticalFirst
    ? { col: start.col, row: end.row }
    : { col: end.col, row: start.row };
  return [
    { col: start.col, row: start.row },
    corner,
    { col: end.col, row: end.row },
  ];
}

// Length of the straight lead-out a path takes off a port before it is allowed
// to bend, in tiles. One sub-unit — the minimum that gives validateDrawLine a
// first/last segment whose direction it can match against the port's side.
const STUB_TILES = 0.25;

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.col - p.col) < EPS && Math.abs(last.row - p.row) < EPS) continue;
    out.push({ col: p.col, row: p.row });
  }
  return out;
}

/**
 * A Manhattan path that also satisfies the approach constraint of whichever of
 * its two ends is anchored on a port: it leaves the start along that port's
 * outward normal and arrives at the end against the end port's outward normal
 * (what line-drawing's portMatchesApproach demands of the first and last
 * segment). Ends with no port — an open-ended draw — take no lead-out.
 *
 * A plain start→end Manhattan L only satisfies those constraints by luck: with
 * one bend the first leg is horizontal and the last vertical (or vice versa),
 * so every drag between two ports whose sides don't happen to match that shape
 * was rejected. The lead-outs make the shape a property of the ports instead.
 *
 * @param {{col,row}} start
 * @param {{dCol,dRow}|null} startVec  outward normal of the start port
 * @param {{col,row}} end
 * @param {{dCol,dRow}|null} endVec    outward normal of the end port
 * @returns {Array<{col,row}>|null}
 */
export function buildPortRoutedPath(start, startVec, end, endVec, opts = {}) {
  if (!start || !end) return null;
  const a1 = startVec
    ? { col: start.col + startVec.dCol * STUB_TILES, row: start.row + startVec.dRow * STUB_TILES }
    : start;
  const b1 = endVec
    ? { col: end.col + endVec.dCol * STUB_TILES, row: end.row + endVec.dRow * STUB_TILES }
    : end;
  const mid = buildManhattanPath(a1, b1, opts);
  const path = dedupePoints(mid ? [start, ...mid, end] : [start, a1, b1, end]);
  return path.length >= 2 ? path : null;
}

export function pathLengthSubUnits(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    total += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
  }
  return Math.round(total * SUB_PER_TILE);
}

export function expandPath(path) {
  if (!Array.isArray(path) || path.length === 0) return [];
  if (path.length === 1) return [{ col: path[0].col, row: path[0].row }];
  const out = [{ col: path[0].col, row: path[0].row }];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dist = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    if (dist < EPS) continue;
    const steps = Math.max(1, Math.round(dist / STEP));
    const dcStep = (b.col - a.col) / steps;
    const drStep = (b.row - a.row) / steps;
    for (let s = 1; s <= steps; s++) {
      out.push({ col: a.col + dcStep * s, row: a.row + drStep * s });
    }
  }
  return out;
}

export const SUBTILE_STEP = STEP;
export const SUB_PER_TILE_CONST = SUB_PER_TILE;
