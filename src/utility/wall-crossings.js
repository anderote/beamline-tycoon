// Pure 2D wall-intersection checks for routed utility centre-lines.
//
// Utility paths are expressed in tile coordinates, where integer columns and
// rows are tile boundaries. A wall occupies one of those boundaries for the
// length of a single tile. Every routed utility uses this module to require an
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

function orderedCandidateCells(value, travel = 0) {
  const cells = candidateCells(value);
  if (cells.length < 2 || travel === 0) return cells;
  const preferred = travel > 0 ? Math.floor(value) : Math.ceil(value) - 1;
  return [...cells].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
}

function clampSlot(value) {
  return Math.max(0, Math.min(3, Math.floor(value)));
}

function verticalWallCrossing(wallOccupied, boundaryCol, rowAtCrossing, travel = 0) {
  for (const row of orderedCandidateCells(rowAtCrossing, travel)) {
    const wallKey = findWallKey(wallOccupied, boundaryCol - 1, row, 'e');
    if (!wallKey) continue;
    const fraction = Math.max(0, Math.min(1, rowAtCrossing - row));
    return {
      wallKey,
      wallMount: {
        col: boundaryCol - 1, row, edge: 'e', off: clampSlot(fraction * 4),
      },
    };
  }
  return null;
}

function horizontalWallCrossing(wallOccupied, boundaryRow, colAtCrossing, travel = 0) {
  for (const col of orderedCandidateCells(colAtCrossing, travel)) {
    const wallKey = findWallKey(wallOccupied, col, boundaryRow - 1, 's');
    if (!wallKey) continue;
    const fraction = Math.max(0, Math.min(1, colAtCrossing - col));
    // South-edge slots run east -> west, opposite increasing world X.
    return {
      wallKey,
      wallMount: {
        col, row: boundaryRow - 1, edge: 's', off: clampSlot((1 - fraction) * 4),
      },
    };
  }
  return null;
}

function hasVerticalWall(wallOccupied, boundaryCol, rowAtCrossing) {
  return !!verticalWallCrossing(wallOccupied, boundaryCol, rowAtCrossing);
}

function hasHorizontalWall(wallOccupied, boundaryRow, colAtCrossing) {
  return !!horizontalWallCrossing(wallOccupied, boundaryRow, colAtCrossing);
}

function segmentWallCrossings(wallOccupied, a, b, segmentIndex, distanceBefore) {
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  const length = Math.hypot(dc, dr);
  const out = [];

  if (Math.abs(dc) > EPS) {
    const lo = Math.min(a.col, b.col);
    const hi = Math.max(a.col, b.col);
    for (let boundary = Math.ceil(lo + EPS); boundary <= Math.floor(hi - EPS); boundary++) {
      const t = (boundary - a.col) / dc;
      const row = a.row + dr * t;
      const hit = verticalWallCrossing(wallOccupied, boundary, row, dr);
      if (hit) out.push({
        ...hit, axis: 'col', boundary, point: { col: boundary, row },
        segmentIndex, t, distance: distanceBefore + length * t,
      });
    }
  }

  if (Math.abs(dr) > EPS) {
    const lo = Math.min(a.row, b.row);
    const hi = Math.max(a.row, b.row);
    for (let boundary = Math.ceil(lo + EPS); boundary <= Math.floor(hi - EPS); boundary++) {
      const t = (boundary - a.row) / dr;
      const col = a.col + dc * t;
      const hit = horizontalWallCrossing(wallOccupied, boundary, col, dc);
      if (hit) out.push({
        ...hit, axis: 'row', boundary, point: { col, row: boundary },
        segmentIndex, t, distance: distanceBefore + length * t,
      });
    }
  }

  return out;
}

function segmentCrossesWall(wallOccupied, a, b) {
  return segmentWallCrossings(wallOccupied, a, b, 0, 0).length > 0;
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

function vertexWallCrossings(wallOccupied, path, index, cumulative) {
  const at = path[index];
  const out = [];
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
    const travel = axis === 'col'
      ? path[after].row - path[before].row
      : path[after].col - path[before].col;
    const hit = axis === 'col'
      ? verticalWallCrossing(wallOccupied, boundary, at.row, travel)
      : horizontalWallCrossing(wallOccupied, boundary, at.col, travel);
    if (!hit) continue;
    out.push({
      ...hit, axis, boundary, point: { col: at.col, row: at.row },
      segmentIndex: Math.max(0, index - 1), t: 1, distance: cumulative[index],
    });
  }
  return out;
}

/**
 * Ordered physical wall crossings for a finite polyline. Each record carries
 * the exact intersection point and the one quarter-wall slot that automatic
 * routing should populate.
 */
export function pathWallCrossings(wallOccupied, rawPath) {
  if (!wallOccupied || !Array.isArray(rawPath)) return [];
  const path = rawPath.filter(finitePoint);
  if (path.length < 2) return [];
  const cumulative = [0];
  const hits = [];
  for (let i = 0; i < path.length - 1; i++) {
    hits.push(...segmentWallCrossings(
      wallOccupied, path[i], path[i + 1], i, cumulative[i],
    ));
    cumulative[i + 1] = cumulative[i] + Math.hypot(
      path[i + 1].col - path[i].col, path[i + 1].row - path[i].row,
    );
  }
  for (let i = 1; i < path.length - 1; i++) {
    hits.push(...vertexWallCrossings(wallOccupied, path, i, cumulative));
  }
  hits.sort((a, b) => a.distance - b.distance);
  // A strict segment hit and its endpoint vertex can describe the same event.
  return hits.filter((hit, index) => !hits.slice(0, index).some(previous =>
    previous.wallKey === hit.wallKey
      && previous.wallMount.off === hit.wallMount.off
      && Math.abs(previous.distance - hit.distance) < EPS));
}

/** True when any non-degenerate leg is drawn inside a wall centre-plane. */
export function pathRunsAlongWall(wallOccupied, rawPath) {
  if (!wallOccupied || !Array.isArray(rawPath)) return false;
  const path = rawPath.filter(finitePoint);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (Math.abs(a.col - b.col) < EPS
        && Math.abs(a.col - Math.round(a.col)) < EPS
        && Math.abs(a.row - b.row) > EPS) {
      const boundary = Math.round(a.col);
      const lo = Math.min(a.row, b.row);
      const hi = Math.max(a.row, b.row);
      for (let row = Math.floor(lo); row <= Math.floor(hi - EPS); row++) {
        if (verticalWallCrossing(wallOccupied, boundary, row + 0.5)) return true;
      }
    }
    if (Math.abs(a.row - b.row) < EPS
        && Math.abs(a.row - Math.round(a.row)) < EPS
        && Math.abs(a.col - b.col) > EPS) {
      const boundary = Math.round(a.row);
      const lo = Math.min(a.col, b.col);
      const hi = Math.max(a.col, b.col);
      for (let col = Math.floor(lo); col <= Math.floor(hi - EPS); col++) {
        if (horizontalWallCrossing(wallOccupied, boundary, col + 0.5)) return true;
      }
    }
  }
  return false;
}

/** True when a finite polyline passes from one side of an occupied wall to the other. */
export function pathCrossesWall(wallOccupied, rawPath) {
  return pathWallCrossings(wallOccupied, rawPath).length > 0
    || pathRunsAlongWall(wallOccupied, rawPath);
}
