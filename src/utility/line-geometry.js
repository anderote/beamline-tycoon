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
