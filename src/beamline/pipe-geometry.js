// src/beamline/pipe-geometry.js
//
// Helpers for reasoning about beampipe paths as sequences of tiles.
// Pipe paths in game state are stored as waypoints (corners only);
// these helpers expand them into dense per-tile lists for hit-testing
// and direction queries.
//
// IMPORTANT: pipe paths use sub-tile precision (0.25 steps) so all
// coordinates may be fractional. Functions here must handle that.

import { isoToGridFloat } from '../renderer/grid.js';

const EPS = 1e-6;

/**
 * Sub-tile step size (0.25 = quarter-tile, matching _buildStraightPath in
 * InputHandler). Pipe paths created in-game are stored dense at this
 * resolution, so the expansion must use the same step to avoid producing
 * incorrectly-spaced tiles. Waypoint-only paths (e.g. from tests) are
 * expanded at this resolution too, which is harmless — it just produces
 * more entries.
 */
const STEP = 0.25;

/**
 * Expand a waypoint path into a dense list of points spaced STEP apart.
 * Handles both sparse waypoint paths (start/end only) and already-dense
 * sub-tile paths (0.25-step). In the latter case the expansion is
 * effectively a no-op — each 0.25-length segment produces exactly one
 * new point.
 */
export function expandPipePath(path) {
  if (!path || path.length === 0) return [];
  if (path.length === 1) return [{ col: path[0].col, row: path[0].row }];
  const tiles = [{ col: path[0].col, row: path[0].row }];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dist = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    if (dist < EPS) continue;
    const steps = Math.max(1, Math.round(dist / STEP));
    const dcStep = (b.col - a.col) / steps;
    const drStep = (b.row - a.row) / steps;
    for (let s = 1; s <= steps; s++) {
      tiles.push({ col: a.col + dcStep * s, row: a.row + drStep * s });
    }
  }
  return tiles;
}

/**
 * Find a pipe whose expanded path passes through the given tile.
 * Finds the closest expanded tile within 0.5 of the query point.
 * With sub-tile (0.25-step) expansion, multiple entries may be within
 * tolerance; picking the closest ensures the cursor snaps to the nearest
 * pipe point.
 */
export function findPipeAtTile(beamPipes, col, row) {
  let best = null;
  let bestDist = Infinity;
  for (const pipe of beamPipes) {
    const tiles = expandPipePath(pipe.path);
    for (let i = 0; i < tiles.length; i++) {
      const dc = Math.abs(tiles[i].col - col);
      const dr = Math.abs(tiles[i].row - row);
      if (dc < 0.5 + EPS && dr < 0.5 + EPS) {
        const dist = dc + dr;
        if (dist < bestDist) {
          bestDist = dist;
          best = { pipe, tileIndex: i, expandedTiles: tiles };
        }
      }
    }
  }
  return best;
}

/**
 * Snap a world/iso-screen position to the nearest sub-tile gridline used by
 * beampipes (quarter-tile / 1 sub-unit resolution).
 *
 * Emits tile-index coordinates so that integer values correspond to tile
 * centres — i.e. `col=0` renders at world x=1 via the pipe renderer's
 * `col*2+1` formula. `isoToGridFloat` gives world-corner fractions
 * (0.5 = tile centre), so we subtract 0.5 to convert.
 */
export function snapPipePoint(worldX, worldY) {
  const fc = isoToGridFloat(worldX, worldY);
  return {
    col: Math.round((fc.col - 0.5) * 4) / 4,
    row: Math.round((fc.row - 0.5) * 4) / 4,
  };
}

/**
 * Build a single-axis straight path from `from` to `to` at STEP resolution.
 * Constrains the path to whichever axis has the larger cursor delta — locking
 * the other to `from` — so a casual diagonal drag never produces an L-bend.
 */
export function buildStraightPath(from, to) {
  const LOCAL_EPS = 0.001;
  const dCol = to.col - from.col;
  const dRow = to.row - from.row;
  const useCol = Math.abs(dCol) >= Math.abs(dRow);
  const targetCol = useCol ? to.col : from.col;
  const targetRow = useCol ? from.row : to.row;

  const path = [{ col: from.col, row: from.row }];
  let c = from.col, r = from.row;
  const dc = targetCol > c + LOCAL_EPS ? STEP : (targetCol < c - LOCAL_EPS ? -STEP : 0);
  const dr = targetRow > r + LOCAL_EPS ? STEP : (targetRow < r - LOCAL_EPS ? -STEP : 0);

  let safety = 2048;
  while (safety-- > 0) {
    const moreCol = dc !== 0 && Math.abs(c - targetCol) > LOCAL_EPS;
    const moreRow = dr !== 0 && Math.abs(r - targetRow) > LOCAL_EPS;
    if (!moreCol && !moreRow) break;
    if (moreCol) c += dc;
    if (moreRow) r += dr;
    path.push({ col: c, row: r });
  }

  return path;
}

export function pipeDirectionAtTile(pipe, tileIndex) {
  const tiles = expandPipePath(pipe.path);
  if (tileIndex <= 0 || tileIndex >= tiles.length - 1) return null;
  const prev = tiles[tileIndex - 1];
  const next = tiles[tileIndex + 1];
  const dCol = next.col - prev.col;
  const dRow = next.row - prev.row;
  // Straight only: one axis must be near-zero and the other non-zero.
  // No hard-coded distance check — works with any uniform step size.
  if (Math.abs(dCol) < EPS && Math.abs(dRow) > EPS)
    return { dCol: 0, dRow: Math.sign(dRow) };
  if (Math.abs(dRow) < EPS && Math.abs(dCol) > EPS)
    return { dCol: Math.sign(dCol), dRow: 0 };
  return null;  // corner or non-axis-aligned
}
