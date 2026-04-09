// Room detection via flood-fill bounded by walls (with door passthrough)
import { ZONE_FURNISHINGS } from '../data/infrastructure.js';

export const LAB_NETWORK_MAP = {
  rfLab: 'rfWaveguide',
  coolingLab: 'coolingWater',
  vacuumLab: 'vacuumPipe',
  diagnosticsLab: 'dataFiber',
  controlRoom: 'dataFiber',
};

const EDGE_DELTAS = {
  n: { dc: 0, dr: -1, opposite: 's' },
  e: { dc: 1, dr: 0, opposite: 'w' },
  s: { dc: 0, dr: 1, opposite: 'n' },
  w: { dc: -1, dr: 0, opposite: 'e' },
};

/**
 * Check if movement from (col, row) in direction `edge` is blocked by a wall
 * (and not opened by a door).
 */
function isBlocked(col, row, edge, state) {
  const { dc, dr, opposite } = EDGE_DELTAS[edge];
  const nc = col + dc;
  const nr = row + dr;

  // Check wall on this side
  const wallKey1 = col + ',' + row + ',' + edge;
  const wallKey2 = nc + ',' + nr + ',' + opposite;

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
  let roomId = 0;

  for (const key of allTileKeys) {
    if (visited.has(key)) continue;

    // Flood fill
    const tiles = [];
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const cur = queue.shift();
      const [cc, cr] = cur.split(',').map(Number);
      tiles.push({ col: cc, row: cr });

      for (const edge of ['n', 'e', 's', 'w']) {
        const { dc, dr } = EDGE_DELTAS[edge];
        const nc = cc + dc;
        const nr = cr + dr;
        const nk = nc + ',' + nr;

        if (!allTileKeys.has(nk)) continue;
        if (visited.has(nk)) continue;
        if (isBlocked(cc, cr, edge, ctx)) continue;

        visited.add(nk);
        queue.push(nk);
      }
    }

    // Build room object
    const tileSet = new Set(tiles.map(t => t.col + ',' + t.row));

    // Boundary tiles: tiles that have a wall on any edge
    const boundaryTiles = tiles.filter(t => {
      for (const edge of ['n', 'e', 's', 'w']) {
        const wk1 = t.col + ',' + t.row + ',' + edge;
        const { dc, dr, opposite } = EDGE_DELTAS[edge];
        const wk2 = (t.col + dc) + ',' + (t.row + dr) + ',' + opposite;
        if (wallOccupied[wk1] || wallOccupied[wk2]) return true;
      }
      return false;
    });

    // Flooring breakdown
    const flooringBreakdown = {};
    for (const t of tiles) {
      const type = infraOccupied[t.col + ',' + t.row];
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
      const zt = zoneOccupied[t.col + ',' + t.row];
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
      return nodeTiles.some(t => tileSet.has(t.col + ',' + t.row));
    });
    if (hasBeamline) return 'beamHall';

    // Check machines
    const machines = state.machines || [];
    const hasMachine = machines.some(m => {
      const mTiles = m.tiles || [{ col: m.col, row: m.row }];
      return mTiles.some(t => tileSet.has(t.col + ',' + t.row));
    });
    if (hasMachine) return 'machineHall';

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
  const roomTileSet = new Set(room.tiles.map(t => t.col + ',' + t.row));
  const reach = new Set();

  for (const t of room.boundaryTiles) {
    for (const edge of ['n', 'e', 's', 'w']) {
      const { dc, dr } = EDGE_DELTAS[edge];
      const nc = t.col + dc;
      const nr = t.row + dr;
      const nk = nc + ',' + nr;
      if (!roomTileSet.has(nk)) {
        reach.add(nk);
      }
    }
  }

  return reach;
}

const MAX_LAB_BONUS = 0.5;

/**
 * @param {object} state - Game state
 * @param {object} networkClusters - Output of Networks.discoverAll(), e.g. { rfWaveguide: [{tiles, equipment, beamlineNodes}], ... }
 * @returns {object} { rfWaveguide: [{ roomId, zoneType, bonus, clusterIndex }], coolingWater: [...], ... }
 */
export function findLabNetworkBonuses(state, networkClusters) {
  // Initialize result with all network types that labs can boost
  const networkTypes = new Set(Object.values(LAB_NETWORK_MAP));
  const result = {};
  for (const nt of networkTypes) {
    result[nt] = [];
  }

  const rooms = detectRooms(state);
  const furnishings = state.zoneFurnishings || [];

  for (const room of rooms) {
    // Check each zone type in the room against LAB_NETWORK_MAP
    for (const zt of room.zoneTypes) {
      const networkType = LAB_NETWORK_MAP[zt];
      if (!networkType) continue;

      const clusters = networkClusters[networkType];
      if (!clusters || clusters.length === 0) continue;

      // Compute reach for this room
      const reach = computeRoomReach(room);

      // Build room tile set for furnishing membership check
      const roomTileSet = new Set(room.tiles.map(t => t.col + ',' + t.row));

      // Sum zoneOutput from furnishings of matching zone type within this room
      let bonus = 0;
      for (const f of furnishings) {
        const fDef = ZONE_FURNISHINGS[f.type];
        if (!fDef) continue;
        if (fDef.zoneType !== zt) continue;
        const fk = f.col + ',' + f.row;
        if (!roomTileSet.has(fk)) continue;
        bonus += (fDef.effects && fDef.effects.zoneOutput) || 0;
      }

      if (bonus === 0) continue;

      // Check each cluster for connectivity
      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        const connected = cluster.tiles.some(t => reach.has(t.col + ',' + t.row));
        if (!connected) continue;

        const cappedBonus = Math.min(bonus, MAX_LAB_BONUS);
        result[networkType].push({
          roomId: room.id,
          zoneType: zt,
          bonus: cappedBonus,
          clusterIndex: ci,
        });
      }
    }
  }

  return result;
}
