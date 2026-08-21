// Pure 2D wall-intersection checks for routed utility centre-lines.
//
// Utility paths are expressed in tile coordinates, where integer columns and
// rows are tile boundaries. A wall occupies one of those boundaries for the
// length of a single tile. Electrical cables use this module to require an
// explicit two-port feedthrough instead of passing through the slab.

import { findWallKey } from '../game/edge-keys.js';

const EPS = 1e-7;

function finitePoint(point) {
  return point && Number.isFinite(point.col) && Number.isFinite(point.row);
}

function candidateCells(value) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < EPS) return [rounded - 1, rounded];
  return [Math.floor(value)];
}

function hasVerticalWall(wallOccupied, boundaryCol, rowAtCrossing) {
  for (const row of candidateCells(rowAtCrossing)) {
    if (findWallKey(wallOccupied, boundaryCol - 1, row, 'e')) return true;
  }
  return false;
}

function hasHorizontalWall(wallOccupied, boundaryRow, colAtCrossing) {
  for (const col of candidateCells(colAtCrossing)) {
    if (findWallKey(wallOccupied, col, boundaryRow - 1, 's')) return true;
  }
  return false;
}

function segmentCrossesWall(wallOccupied, a, b) {
  const dc = b.col - a.col;
  const dr = b.row - a.row;

  if (Math.abs(dc) > EPS) {
    const lo = Math.min(a.col, b.col);
    const hi = Math.max(a.col, b.col);
    for (let boundary = Math.ceil(lo + EPS); boundary <= Math.floor(hi - EPS); boundary++) {
      const t = (boundary - a.col) / dc;
      const row = a.row + dr * t;
      if (hasVerticalWall(wallOccupied, boundary, row)) return true;
    }
  }

  if (Math.abs(dr) > EPS) {
    const lo = Math.min(a.row, b.row);
    const hi = Math.max(a.row, b.row);
    for (let boundary = Math.ceil(lo + EPS); boundary <= Math.floor(hi - EPS); boundary++) {
      const t = (boundary - a.row) / dr;
      const col = a.col + dc * t;
      if (hasHorizontalWall(wallOccupied, boundary, col)) return true;
    }
  }

  return false;
}

// A sampled freehand trace can put a vertex exactly on a wall plane. Neither
// adjoining segment then has the boundary in its strict interior, so inspect
// the vertices too and look through any short run that lies along the plane.
function vertexCrossesWall(wallOccupied, path, index) {
  const at = path[index];
  for (const axis of ['col', 'row']) {
    const boundary = Math.round(at[axis]);
    if (Math.abs(at[axis] - boundary) >= EPS) continue;
    let before = index - 1;
    while (before >= 0 && Math.abs(path[before][axis] - boundary) < EPS) before--;
    let after = index + 1;
    while (after < path.length && Math.abs(path[after][axis] - boundary) < EPS) after++;
    if (before < 0 || after >= path.length) continue;
    const aSide = Math.sign(path[before][axis] - boundary);
    const bSide = Math.sign(path[after][axis] - boundary);
    if (aSide === 0 || bSide === 0 || aSide === bSide) continue;
    if (axis === 'col') {
      if (hasVerticalWall(wallOccupied, boundary, at.row)) return true;
    } else if (hasHorizontalWall(wallOccupied, boundary, at.col)) return true;
  }
  return false;
}

/** True when a finite polyline passes from one side of an occupied wall to the other. */
export function pathCrossesWall(wallOccupied, rawPath) {
  if (!wallOccupied || !Array.isArray(rawPath)) return false;
  const path = rawPath.filter(finitePoint);
  if (path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentCrossesWall(wallOccupied, path[i], path[i + 1])) return true;
  }
  for (let i = 1; i < path.length - 1; i++) {
    if (vertexCrossesWall(wallOccupied, path, i)) return true;
  }
  return false;
}
