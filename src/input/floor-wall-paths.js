// Pure geometry helpers for floor-driven wall placement and face painting.
// Keeping the flood fills out of InputHandler makes the selection semantics
// easy to test without a renderer or DOM.

import { findWallKey } from '../game/edge-keys.js';

const SIDES = [
  { edge: 'n', dc: 0, dr: -1 },
  { edge: 'e', dc: 1, dr: 0 },
  { edge: 's', dc: 0, dr: 1 },
  { edge: 'w', dc: -1, dr: 0 },
];

const SIDE_BY_EDGE = Object.fromEntries(SIDES.map(side => [side.edge, side]));
const EDGE_ORDER = Object.fromEntries(SIDES.map((side, index) => [side.edge, index]));

export const FLOOR_INTERFACE_HOVER_THRESHOLD = 0.28;

function tileKey(col, row) {
  return `${col},${row}`;
}

function floorAt(infraOccupied, col, row) {
  return infraOccupied[tileKey(col, row)] || null;
}

function across(edge) {
  const side = SIDE_BY_EDGE[edge.edge];
  return {
    col: edge.col + side.dc,
    row: edge.row + side.dr,
  };
}

/**
 * Return the four wall faces bordering one selected floor tile. Keeping each
 * edge expressed from that tile is important: Game.paintWallFace uses the
 * requested edge spelling to choose the physical wall's tile-facing side.
 */
export function buildFloorTileWallPath(origin) {
  if (!Number.isFinite(origin?.col) || !Number.isFinite(origin?.row)) return [];
  return SIDES.map(side => ({
    col: origin.col,
    row: origin.row,
    edge: side.edge,
  }));
}

/**
 * Find every wall surface bounding the floored interior that contains the
 * selected tile. Unlike the material-based wall-placement fill below, this
 * flood may cross flooring changes but never crosses a wall. A wall remains
 * a paint boundary even when it carries a door, so adjoining rooms can keep
 * independent finishes around their openings.
 */
export function buildInteriorWallBoundary(infraOccupied, wallOccupied, origin) {
  const startKey = tileKey(origin?.col, origin?.row);
  if (!infraOccupied[startKey]) {
    return { mode: 'free', tileCount: 0, path: [] };
  }

  const visited = new Set([startKey]);
  const tiles = [{ col: origin.col, row: origin.row }];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    for (const side of SIDES) {
      if (findWallKey(wallOccupied, tile.col, tile.row, side.edge)) continue;
      const col = tile.col + side.dc;
      const row = tile.row + side.dr;
      const key = tileKey(col, row);
      if (!infraOccupied[key] || visited.has(key)) continue;
      visited.add(key);
      tiles.push({ col, row });
    }
  }

  // Derive the boundary only after the flood is complete. A partial
  // partition can reconnect around one end, which puts both of its adjacent
  // tiles in this same interior. It is not a room boundary in that case, and
  // choosing whichever face BFS happened to visit first can paper the far
  // side of the wall. A real room boundary has its neighbouring tile outside
  // this flood (or no floor there at all).
  const path = [];
  const seenWalls = new Set();
  for (const tile of tiles) {
    for (const side of SIDES) {
      const wallKey = findWallKey(wallOccupied, tile.col, tile.row, side.edge);
      if (!wallKey || seenWalls.has(wallKey)) continue;
      const otherKey = tileKey(tile.col + side.dc, tile.row + side.dr);
      if (visited.has(otherKey)) continue;
      seenWalls.add(wallKey);
      path.push({ col: tile.col, row: tile.row, edge: side.edge });
    }
  }

  path.sort((a, b) => (
    a.row - b.row
    || a.col - b.col
    || EDGE_ORDER[a.edge] - EDGE_ORDER[b.edge]
  ));
  return { mode: 'interior', tileCount: tiles.length, path };
}

/**
 * Trace every exposed side of the contiguous same-type floor region beneath
 * the supplied edge. Different floor materials count as a boundary, as do
 * empty tiles and holes inside the region.
 */
export function buildFloorRegionPerimeter(infraOccupied, origin) {
  let start = { col: origin.col, row: origin.row };
  let floorType = floorAt(infraOccupied, start.col, start.row);

  if (!floorType) {
    start = across(origin);
    floorType = floorAt(infraOccupied, start.col, start.row);
  }

  if (!floorType) {
    return { mode: 'free', floorType: null, tileCount: 0, path: [] };
  }

  const region = new Set([tileKey(start.col, start.row)]);
  const queue = [start];

  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i];
    for (const side of SIDES) {
      const col = tile.col + side.dc;
      const row = tile.row + side.dr;
      const key = tileKey(col, row);
      if (region.has(key) || floorAt(infraOccupied, col, row) !== floorType) continue;
      region.add(key);
      queue.push({ col, row });
    }
  }

  const path = [];
  for (const tile of queue) {
    for (const side of SIDES) {
      if (floorAt(infraOccupied, tile.col + side.dc, tile.row + side.dr) === floorType) continue;
      path.push({ col: tile.col, row: tile.row, edge: side.edge });
    }
  }

  path.sort((a, b) => (
    a.row - b.row
    || a.col - b.col
    || EDGE_ORDER[a.edge] - EDGE_ORDER[b.edge]
  ));

  return {
    mode: 'perimeter',
    floorType,
    tileCount: region.size,
    path,
  };
}

/**
 * Trace a straight, contiguous interface where the same two floor materials
 * remain on opposite sides. This is the useful room-subdivision gesture.
 */
export function buildFloorInterfaceRun(infraOccupied, origin) {
  const side = SIDE_BY_EDGE[origin.edge];
  const other = across(origin);
  const floorType = floorAt(infraOccupied, origin.col, origin.row);
  const otherFloorType = floorAt(infraOccupied, other.col, other.row);

  if (!floorType || !otherFloorType || floorType === otherFloorType) {
    return { mode: 'free', floorTypes: [], path: [] };
  }

  const horizontal = origin.edge === 'n' || origin.edge === 's';
  const matches = (col, row) => (
    floorAt(infraOccupied, col, row) === floorType
    && floorAt(infraOccupied, col + side.dc, row + side.dr) === otherFloorType
  );
  const path = [{ col: origin.col, row: origin.row, edge: origin.edge }];

  for (const direction of [-1, 1]) {
    let col = origin.col;
    let row = origin.row;
    for (;;) {
      if (horizontal) col += direction;
      else row += direction;
      if (!matches(col, row)) break;
      const point = { col, row, edge: origin.edge };
      if (direction < 0) path.unshift(point);
      else path.push(point);
    }
  }

  return {
    mode: 'interface',
    floorTypes: [floorType, otherFloorType],
    path,
  };
}

/**
 * Near a mixed-floor edge, prefer its straight interface. Elsewhere on a
 * floor, outline the entire contiguous same-material region.
 */
export function buildSmartFloorWallPath(
  infraOccupied,
  origin,
  { interfaceThreshold = FLOOR_INTERFACE_HOVER_THRESHOLD } = {},
) {
  if ((origin.dist ?? Infinity) <= interfaceThreshold) {
    const run = buildFloorInterfaceRun(infraOccupied, origin);
    if (run.path.length > 0) return run;
  }
  return buildFloorRegionPerimeter(infraOccupied, origin);
}
