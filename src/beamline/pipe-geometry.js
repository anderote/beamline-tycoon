// src/beamline/pipe-geometry.js
//
// Helpers for reasoning about beampipe paths as sequences of tiles.
// Pipe paths in game state are stored as waypoints (corners only);
// these helpers expand them into dense per-tile lists for hit-testing
// and direction queries.

export function expandPipePath(path) {
  if (!path || path.length === 0) return [];
  if (path.length === 1) return [{ col: path[0].col, row: path[0].row }];
  const tiles = [{ col: path[0].col, row: path[0].row }];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dCol = Math.sign(b.col - a.col);
    const dRow = Math.sign(b.row - a.row);
    let cur = { col: a.col, row: a.row };
    while (cur.col !== b.col || cur.row !== b.row) {
      cur = { col: cur.col + dCol, row: cur.row + dRow };
      tiles.push({ col: cur.col, row: cur.row });
    }
  }
  return tiles;
}

export function findPipeAtTile(beamPipes, col, row) {
  for (const pipe of beamPipes) {
    const tiles = expandPipePath(pipe.path);
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].col === col && tiles[i].row === row) {
        return { pipe, tileIndex: i, expandedTiles: tiles };
      }
    }
  }
  return null;
}

export function pipeDirectionAtTile(pipe, tileIndex) {
  const tiles = expandPipePath(pipe.path);
  if (tileIndex <= 0 || tileIndex >= tiles.length - 1) return null;
  const prev = tiles[tileIndex - 1];
  const next = tiles[tileIndex + 1];
  const dCol = next.col - prev.col;
  const dRow = next.row - prev.row;
  // Straight only: one axis must be zero and the other must be exactly ±2
  // (one tile before and one tile after along the same axis).
  if (dCol === 0 && Math.abs(dRow) === 2) return { dCol: 0, dRow: Math.sign(dRow) };
  if (dRow === 0 && Math.abs(dCol) === 2) return { dCol: Math.sign(dCol), dRow: 0 };
  return null;  // corner or non-axis-aligned
}
