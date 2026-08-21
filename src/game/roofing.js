import { EDGE_DELTAS, edgeKey, mirrorEdge } from './edge-keys.js';
import { FLOORS, WALL_TYPES } from '../data/structure.js';
import { levelOf, normalizeLevel, sameLevel, tileKey, withLevel } from './storeys.js';

const EDGES = ['n', 'e', 's', 'w'];

function wallTypeAt(state, col, row, edge, level = 0) {
  const wallOccupied = state.wallOccupied || {};
  const direct = edgeKey(col, row, edge, level);
  const mirror = mirrorEdge(col, row, edge, level);
  return wallOccupied[direct] || wallOccupied[edgeKey(mirror.col, mirror.row, mirror.edge, level)] || null;
}

/** True when a wall type is a building wall rather than a landscape divider. */
export function isRoofBoundaryWall(wallType) {
  if (!wallType) return false;
  const def = WALL_TYPES[wallType];
  if (!def) return true; // Preserve enclosure for walls authored by an older save.
  return def.isWall === true && def.wallOverlay !== true &&
    def.subsection !== 'fencing' && def.subsection !== 'hedges';
}

function blocked(state, col, row, edge, level = 0) {
  // A doorway remains part of the enclosing wall for roofing. Treating doors
  // as flood-fill openings joined every office, lab and corridor in a large
  // facility into one enormous region, so the roof tool reported that
  // otherwise complete rooms were not enclosed.
  return isRoofBoundaryWall(wallTypeAt(state, col, row, edge, level));
}

/** Return the floored, wall-enclosed region under a roof-tool cursor. */
export function findRoofRegion(state, startCol, startRow, level = 0) {
  level = normalizeLevel(level);
  const floors = state.infraOccupied || {};
  const start = tileKey(startCol, startRow, level);
  if (!floors[start]) return [];

  const region = [];
  const seen = new Set([start]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor];
    const raw = key.includes('|') ? key.slice(key.indexOf('|') + 1) : key;
    const [col, row] = raw.split(',').map(Number);
    region.push(withLevel({ col, row }, level));
    for (const edge of EDGES) {
      const delta = EDGE_DELTAS[edge];
      const next = tileKey(col + delta.dc, row + delta.dr, level);
      if (!floors[next] || seen.has(next) || blocked(state, col, row, edge, level)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  // A region is roofable only when every edge leading off its floor footprint
  // is a solid wall. This rejects outdoor floor patches and rooms with an
  // open doorway to the outside, while allowing doors between enclosed rooms.
  const regionKeys = new Set(region.map(tile => tileKey(tile.col, tile.row, level)));
  for (const tile of region) {
    for (const edge of EDGES) {
      const delta = EDGE_DELTAS[edge];
      const next = tileKey(tile.col + delta.dc, tile.row + delta.dr, level);
      if (!regionKeys.has(next) && !blocked(state, tile.col, tile.row, edge, level)) return [];
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

  const level = levelOf(region[0]);
  const keys = new Set(region.map(tile => tileKey(tile.col, tile.row, level)));
  const boundaryTypes = [];
  for (const tile of region) {
    for (const edge of EDGES) {
      const delta = EDGE_DELTAS[edge];
      if (keys.has(tileKey(tile.col + delta.dc, tile.row + delta.dr, level))) continue;
      const type = wallTypeAt(state, tile.col, tile.row, edge, level);
      if (isRoofBoundaryWall(type)) boundaryTypes.push(type);
    }
  }

  const highBay = boundaryTypes.length > 0 && boundaryTypes.every(
    type => WALL_TYPES[type]?.roofProfile === 'highBay'
  );
  return highBay ? profiles.highBay : profiles.dropCeiling;
}

export function roofKey(col, row, level = 0) { return tileKey(col, row, level); }

export function roofedTiles(state, level = null) {
  return new Set((state.roofs || [])
    .filter(tile => level == null || sameLevel(tile, level))
    .map(tile => roofKey(tile.col, tile.row, levelOf(tile))));
}

export function isRoofedRegion(state, region) {
  if (!region?.length) return false;
  const roofs = roofedTiles(state);
  return region.every(tile => roofs.has(roofKey(tile.col, tile.row, levelOf(tile))));
}
