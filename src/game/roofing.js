import { EDGE_DELTAS, edgeKey, mirrorEdge } from './edge-keys.js';
import { FLOORS, WALL_TYPES } from '../data/structure.js';

const EDGES = ['n', 'e', 's', 'w'];

function wallTypeAt(state, col, row, edge) {
  const wallOccupied = state.wallOccupied || {};
  const direct = edgeKey(col, row, edge);
  const mirror = mirrorEdge(col, row, edge);
  return wallOccupied[direct] || wallOccupied[edgeKey(mirror.col, mirror.row, mirror.edge)] || null;
}

/** True when a wall type is a building wall rather than a landscape divider. */
export function isRoofBoundaryWall(wallType) {
  if (!wallType) return false;
  const def = WALL_TYPES[wallType];
  if (!def) return true; // Preserve enclosure for walls authored by an older save.
  return def.isWall === true && def.wallOverlay !== true &&
    def.subsection !== 'fencing' && def.subsection !== 'hedges';
}

function blocked(state, col, row, edge) {
  // A doorway remains part of the enclosing wall for roofing. Treating doors
  // as flood-fill openings joined every office, lab and corridor in a large
  // facility into one enormous region, so the roof tool reported that
  // otherwise complete rooms were not enclosed.
  return isRoofBoundaryWall(wallTypeAt(state, col, row, edge));
}

/** Return the floored, wall-enclosed region under a roof-tool cursor. */
export function findRoofRegion(state, startCol, startRow) {
  const floors = state.infraOccupied || {};
  const start = `${startCol},${startRow}`;
  if (!floors[start]) return [];

  const region = [];
  const seen = new Set([start]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor];
    const [col, row] = key.split(',').map(Number);
    region.push({ col, row });
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

/**
 * Choose the visible ceiling/roof treatment for one enclosed region.
 * A region is high-bay only when every boundary segment explicitly opts into
 * that profile. Mixing in an office, hallway, lab, glass, or shielding wall
 * gives the room an ordinary suspended ceiling.
 */
export function roofProfileForRegion(state, region) {
  const profiles = FLOORS.roof.roofProfiles;
  if (!region?.length) return profiles.highBay;

  const keys = new Set(region.map(tile => `${tile.col},${tile.row}`));
  const boundaryTypes = [];
  for (const tile of region) {
    for (const edge of EDGES) {
      const delta = EDGE_DELTAS[edge];
      if (keys.has(`${tile.col + delta.dc},${tile.row + delta.dr}`)) continue;
      const type = wallTypeAt(state, tile.col, tile.row, edge);
      if (isRoofBoundaryWall(type)) boundaryTypes.push(type);
    }
  }

  const highBay = boundaryTypes.length > 0 && boundaryTypes.every(
    type => WALL_TYPES[type]?.roofProfile === 'highBay'
  );
  return highBay ? profiles.highBay : profiles.dropCeiling;
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
