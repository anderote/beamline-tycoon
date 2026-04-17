// src/beamline/pipe-geometry.js
//
// Helpers for reasoning about beampipe paths as sequences of tiles.
// Pipe paths in game state are stored as waypoints (corners only);
// these helpers expand them into dense per-tile lists for hit-testing
// and direction queries.
//
// IMPORTANT: pipe paths use sub-tile precision (0.25 steps) so all
// coordinates may be fractional. Functions here must handle that.

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
