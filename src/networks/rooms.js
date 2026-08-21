// Room detection via flood-fill bounded by walls (with door passthrough).
// Phase 6: LAB_NETWORK_MAP and findLabNetworkBonuses have been removed with
// the rest of the legacy networks module. detectRooms / computeRoomReach
// remain as generic geometry helpers (used by a few tests and the room
// classification logic below).

import { EDGE_DELTAS, edgeKey, mirrorEdge } from '../game/edge-keys.js';
import { roofedTiles } from '../game/roofing.js';
import { levelOf, parseTileKey, tileKey, withLevel } from '../game/storeys.js';

/**
 * Check if movement from (col, row) in direction `edge` is blocked by a wall
 * (and not opened by a door).
 */
export function isBlocked(col, row, edge, state, level = 0) {
  // Either spelling of the edge can hold the segment — see edge-keys.js.
  const m = mirrorEdge(col, row, edge, level);
  const wallKey1 = edgeKey(col, row, edge, level);
  const wallKey2 = edgeKey(m.col, m.row, m.edge, level);

  const hasWall = !!(state.wallOccupied[wallKey1] || state.wallOccupied[wallKey2]);
  if (!hasWall) return false;

  // Wall exists -- check if a door opens it
  const hasDoor = !!(state.doorOccupied[wallKey1] || state.doorOccupied[wallKey2]);
  return !hasDoor;
}

/**
 * Detect all rooms from flooring tiles bounded by walls.
 * Returns an array of room objects.
 */
export function detectRooms(state) {
  const infraOccupied = state.infraOccupied || {};
  const wallOccupied = state.wallOccupied || {};
  const doorOccupied = state.doorOccupied || {};
  const zoneOccupied = state.zoneOccupied || {};

  // Wrap state with defaults for isBlocked helper
  const ctx = { wallOccupied, doorOccupied };

  // Build set of all flooring tile keys
  const allTileKeys = new Set(Object.keys(infraOccupied));
  if (allTileKeys.size === 0) return [];

  const visited = new Set();
  const rooms = [];
  const roofTiles = roofedTiles(state);
  let roomId = 0;

  for (const key of allTileKeys) {
    if (visited.has(key)) continue;

    // Flood fill
    const tiles = [];
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const cur = queue.shift();
      const { col: cc, row: cr, level } = parseTileKey(cur);
      tiles.push(withLevel({ col: cc, row: cr }, level));

      for (const edge of ['n', 'e', 's', 'w']) {
        const { dc, dr } = EDGE_DELTAS[edge];
        const nc = cc + dc;
        const nr = cr + dr;
        const nk = tileKey(nc, nr, level);

        if (!allTileKeys.has(nk)) continue;
        if (visited.has(nk)) continue;
        if (isBlocked(cc, cr, edge, ctx, level)) continue;

        visited.add(nk);
        queue.push(nk);
      }
    }

    // Build room object
    const tileSet = new Set(tiles.map(t => tileKey(t.col, t.row, t.level)));

    // Boundary tiles: tiles that have a wall on any edge
    const boundaryTiles = tiles.filter(t => {
      for (const edge of ['n', 'e', 's', 'w']) {
        const wk1 = edgeKey(t.col, t.row, edge, t.level);
        const m = mirrorEdge(t.col, t.row, edge, t.level);
        const wk2 = edgeKey(m.col, m.row, m.edge, t.level);
        if (wallOccupied[wk1] || wallOccupied[wk2]) return true;
      }
      return false;
    });

    // Flooring breakdown
    const flooringBreakdown = {};
    for (const t of tiles) {
      const type = infraOccupied[tileKey(t.col, t.row, t.level)];
      flooringBreakdown[type] = (flooringBreakdown[type] || 0) + 1;
    }
    const total = tiles.length;
    for (const type in flooringBreakdown) {
      flooringBreakdown[type] = flooringBreakdown[type] / total;
    }

    // Zone types present
    const zoneTypes = [];
    const seenZones = new Set();
    for (const t of tiles) {
      const zt = zoneOccupied[tileKey(t.col, t.row, t.level)];
      if (zt && !seenZones.has(zt)) {
        seenZones.add(zt);
        zoneTypes.push(zt);
      }
    }

    // Room type classification
    const roomType = classifyRoom(flooringBreakdown, zoneTypes, tileSet, state);

    rooms.push({
      id: roomId++,
      tiles,
      boundaryTiles,
      flooringBreakdown,
      roomType,
      zoneTypes,
      roofed: tiles.every(t => roofTiles.has(tileKey(t.col, t.row, levelOf(t)))),
      roofedTileCount: tiles.filter(
        t => roofTiles.has(tileKey(t.col, t.row, levelOf(t))),
      ).length,
    });
  }

  return rooms;
}

function classifyRoom(flooringBreakdown, zoneTypes, tileSet, state) {
  // 1. Zone-typed takes priority
  if (zoneTypes.length > 0) return zoneTypes[0];

  const concreteRatio = flooringBreakdown['concrete'] || 0;
  const hallwayRatio = flooringBreakdown['hallway'] || 0;

  // 2. >= 80% concrete
  if (concreteRatio >= 0.8) {
    // Check beamline nodes
    const beamline = state.beamline || [];
    const hasBeamline = beamline.some(node => {
      const nodeTiles = node.tiles || [{ col: node.col, row: node.row }];
      return nodeTiles.some(t => tileSet.has(tileKey(t.col, t.row, levelOf(p))));
    });
    if (hasBeamline) return 'beamHall';

    return 'emptyHall';
  }

  // 3. > 50% hallway
  if (hallwayRatio > 0.5) return 'hallway';

  return 'unclassified';
}

/**
 * Returns a Set of "col,row" keys for tiles exactly 1 cardinal step outside
 * the room's boundary tiles, excluding tiles inside the room.
 */
export function computeRoomReach(room) {
  const roomLevel = levelOf(room.tiles[0]);
  const roomTileSet = new Set(room.tiles.map(t => tileKey(t.col, t.row, levelOf(t))));
  const reach = new Set();

  for (const t of room.boundaryTiles) {
    for (const edge of ['n', 'e', 's', 'w']) {
      const { dc, dr } = EDGE_DELTAS[edge];
      const nc = t.col + dc;
      const nr = t.row + dr;
      const nk = tileKey(nc, nr, roomLevel);
      if (!roomTileSet.has(nk)) {
        reach.add(nk);
      }
    }
  }

  return reach;
}
