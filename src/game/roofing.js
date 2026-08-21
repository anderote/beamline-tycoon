import { EDGE_DELTAS, edgeKey, mirrorEdge } from './edge-keys.js';

const EDGES = ['n', 'e', 's', 'w'];
const MAX_ROOF_TILES = 500;

function blocked(state, col, row, edge) {
  const wallOccupied = state.wallOccupied || {};
  const doors = state.doorOccupied || {};
  const direct = edgeKey(col, row, edge);
  const mirror = mirrorEdge(col, row, edge);
  const wall = wallOccupied[direct] || wallOccupied[edgeKey(mirror.col, mirror.row, mirror.edge)];
  if (!wall) return false;
  return !(doors[direct] || doors[edgeKey(mirror.col, mirror.row, mirror.edge)]);
}

/** Return the floored, wall-enclosed region under a roof-tool cursor. */
export function findRoofRegion(state, startCol, startRow) {
  const floors = state.infraOccupied || {};
  const start = `${startCol},${startRow}`;
  if (!floors[start]) return [];

  const region = [];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const key = queue.shift();
    const [col, row] = key.split(',').map(Number);
    region.push({ col, row });
    if (region.length > MAX_ROOF_TILES) return [];
    for (const edge of EDGES) {
      const delta = EDGE_DELTAS[edge];
      const next = `${col + delta.dc},${row + delta.dr}`;
      if (!floors[next] || seen.has(next) || blocked(state, col, row, edge)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  // A region is roofable only when every edge leading off its floor footprint
  // is a solid wall. This rejects outdoor floor patches and rooms with an
  // open doorway to the outside, while allowing doors between enclosed rooms.
  const regionKeys = new Set(region.map(tile => `${tile.col},${tile.row}`));
  for (const tile of region) {
    for (const edge of EDGES) {
      const delta = EDGE_DELTAS[edge];
      const next = `${tile.col + delta.dc},${tile.row + delta.dr}`;
      if (!regionKeys.has(next) && !blocked(state, tile.col, tile.row, edge)) return [];
    }
  }
  return region;
}

export function roofKey(col, row) { return `${col},${row}`; }

export function roofedTiles(state) {
  return new Set((state.roofs || []).map(tile => roofKey(tile.col, tile.row)));
}

export function isRoofedRegion(state, region) {
  if (!region?.length) return false;
  const roofs = roofedTiles(state);
  return region.every(tile => roofs.has(roofKey(tile.col, tile.row)));
}
