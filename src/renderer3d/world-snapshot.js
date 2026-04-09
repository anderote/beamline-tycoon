// src/renderer3d/world-snapshot.js
// Builds a flat, serializable snapshot of game state for consumption by the Three.js renderer.
// The renderer never touches game.* directly — it reads only from this snapshot.

const GRASS_RANGE = 20;

// --- Terrain hash ---

function grassHash(col, row) {
  let h = ((col * 374761393 + row * 668265263) ^ 0x5bf03635) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h >>> 16) ^ h) & 0x7fffffff;
}

// --- Terrain brightness (2D gaussian blobs) ---

function sampleTerrainBrightness(col, row, blobs) {
  let val = 0;
  for (const blob of blobs) {
    const dx = col - blob.cx;
    const dy = row - blob.cy;
    const cos = Math.cos(blob.angle);
    const sin = Math.sin(blob.angle);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const ex = (lx * lx) / (2 * blob.sx * blob.sx);
    const ey = (ly * ly) / (2 * blob.sy * blob.sy);
    val += blob.brightness * Math.exp(-(ex + ey));
  }
  return Math.max(-1, Math.min(1, val));
}

// --- Section builders ---

function buildTerrain(game) {
  const infraOccupied = game.state.infraOccupied || {};
  const zoneOccupied = game.state.zoneOccupied || {};
  const blobs = game.state.terrainBlobs || [];
  const terrain = [];

  for (let col = -GRASS_RANGE; col <= GRASS_RANGE; col++) {
    for (let row = -GRASS_RANGE; row <= GRASS_RANGE; row++) {
      const key = col + ',' + row;
      if (infraOccupied[key] || zoneOccupied[key]) continue;

      const hash = grassHash(col, row);
      const brightness = sampleTerrainBrightness(col, row, blobs);
      terrain.push({ col, row, hash, brightness });
    }
  }

  return terrain;
}

function buildInfrastructure(game) {
  return (game.state.infrastructure || []).map(tile => ({
    col: tile.col,
    row: tile.row,
    type: tile.type,
    orientation: tile.orientation ?? null,
    variant: tile.variant ?? null,
    tint: tile.tint ?? null,
  }));
}

function buildWalls(game) {
  return (game.state.walls || []).map(w => ({
    col: w.col,
    row: w.row,
    edge: w.edge,
    type: w.type,
  }));
}

function buildDoors(game) {
  return (game.state.doors || []).map(d => ({
    col: d.col,
    row: d.row,
    edge: d.edge,
    type: d.type,
  }));
}

function buildZones(game) {
  return (game.state.zones || []).map(z => ({
    col: z.col,
    row: z.row,
    zoneType: z.type,
  }));
}

function buildComponents(game) {
  const nodes = game.registry.getAllNodes();
  const editingId = game.editingBeamlineId;

  return nodes.map(node => {
    // Determine dimmed: node belongs to a different beamline than the one being edited
    let dimmed = false;
    if (editingId) {
      const entry = game.registry.getBeamlineForNode(node.id);
      if (entry && entry.id !== editingId) {
        dimmed = true;
      }
    }

    // Health — use game.getComponentHealth if available
    const health = typeof game.getComponentHealth === 'function'
      ? game.getComponentHealth(node.id)
      : undefined;

    return {
      id: node.id,
      type: node.type,
      col: node.col,
      row: node.row,
      subCol: node.subCol ?? null,
      subRow: node.subRow ?? null,
      direction: node.direction ?? null,
      tiles: node.tiles ? node.tiles.map(t => ({ col: t.col, row: t.row })) : [{ col: node.col, row: node.row }],
      dimmed,
      health,
    };
  });
}

function buildEquipment(game) {
  // facilityGrid is an object keyed by "col,row" -> equipment id
  // facilityEquipment holds the actual equipment objects
  const facilityGrid = game.state.facilityGrid || {};
  const facilityEquipment = game.state.facilityEquipment || [];

  // Build a lookup from id -> equipment object
  const byId = {};
  for (const eq of facilityEquipment) {
    byId[eq.id] = eq;
  }

  return Object.entries(facilityGrid).map(([key, id]) => {
    const eq = byId[id] || {};
    return {
      key,
      id,
      type: eq.type ?? null,
      col: eq.col ?? null,
      row: eq.row ?? null,
      subCol: eq.subCol ?? null,
      subRow: eq.subRow ?? null,
    };
  });
}

function buildDecorations(game) {
  return (game.state.decorations || []).map(d => ({
    col: d.col,
    row: d.row,
    type: d.type,
    subCol: d.subCol ?? null,
    subRow: d.subRow ?? null,
    variant: d.variant ?? null,
    tall: d.tall ?? false,
  }));
}

function buildConnections(game) {
  // connections is a Map of "col,row" -> Set<connType>
  // Flatten into one entry per (tile, type) pair
  const connections = game.state.connections;
  if (!connections || connections.size === 0) return [];

  const result = [];
  for (const [key, typeSet] of connections) {
    const [colStr, rowStr] = key.split(',');
    const col = parseInt(colStr, 10);
    const row = parseInt(rowStr, 10);
    for (const type of typeSet) {
      result.push({ col, row, type });
    }
  }
  return result;
}

function buildBeamPaths(game) {
  const editingId = game.editingBeamlineId;
  const beamPaths = [];

  for (const entry of game.registry.getAll()) {
    const nodes = entry.beamline.getAllNodes();
    if (nodes.length < 2) continue;
    // Only include beamlines with beam on
    if (entry.status !== 'running') continue;

    const dimmed = !!(editingId && entry.id !== editingId);

    beamPaths.push({
      beamlineId: entry.id,
      nodePositions: nodes.map(n => ({
        col: n.col,
        row: n.row,
        tiles: n.tiles ? n.tiles.map(t => ({ col: t.col, row: t.row })) : [{ col: n.col, row: n.row }],
      })),
      dimmed,
    });
  }

  return beamPaths;
}

function buildFurnishings(game) {
  return (game.state.zoneFurnishings || []).map(f => ({
    col: f.col,
    row: f.row,
    subCol: f.subCol ?? null,
    subRow: f.subRow ?? null,
    type: f.type,
  }));
}

// --- Main export ---

/**
 * Build a flat, serializable world snapshot from game state.
 * The Three.js renderer consumes this and never reads game.* directly.
 *
 * @param {object} game - The Game instance
 * @returns {object} snapshot
 */
export function buildWorldSnapshot(game) {
  return {
    terrain: buildTerrain(game),
    infrastructure: buildInfrastructure(game),
    walls: buildWalls(game),
    doors: buildDoors(game),
    zones: buildZones(game),
    components: buildComponents(game),
    equipment: buildEquipment(game),
    decorations: buildDecorations(game),
    connections: buildConnections(game),
    beamPaths: buildBeamPaths(game),
    furnishings: buildFurnishings(game),
  };
}
