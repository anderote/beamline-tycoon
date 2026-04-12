// src/renderer3d/world-snapshot.js
// Builds a flat, serializable snapshot of game state for consumption by the Three.js renderer.
// The renderer never touches game.* directly — it reads only from this snapshot.

import { FLOORS } from '../data/structure.js';
import { COMPONENTS } from '../data/components.js';
import { getUtilityPorts, UTILITY_PORT_PROFILES, isInfraOutput } from '../data/utility-ports.js';

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

function buildFloors(game) {
  return (game.state.floors || []).map(tile => {
    const def = FLOORS[tile.type];
    return {
      col: tile.col,
      row: tile.row,
      type: tile.type,
      orientation: tile.orientation ?? null,
      variant: tile.variant ?? null,
      tint: tile.tint ?? null,
      noGrid: def?.noGrid ?? false,
    };
  });
}

function buildWalls(game) {
  return (game.state.walls || []).map(w => ({
    col: w.col,
    row: w.row,
    edge: w.edge,
    type: w.type,
    variant: w.variant ?? 0,
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

  const result = nodes.map(node => {
    const entry = game.registry.getBeamlineForNode(node.id);
    const beamlineId = entry ? entry.id : null;
    const accentColor = entry ? entry.accentColor : 0xc62828;

    // Dimmed: node belongs to a different beamline than the one being edited
    let dimmed = false;
    if (editingId && entry && entry.id !== editingId) {
      dimmed = true;
    }

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
      direction: node.dir ?? node.direction ?? null,
      tiles: node.tiles ? node.tiles.map(t => ({ col: t.col, row: t.row })) : [{ col: node.col, row: node.row }],
      dimmed,
      health,
      beamlineId,
      accentColor,
    };
  });

  // Unified-system placeables (drift pipes + infrastructure modules — all
  // share the componentBuilder rendering path since their COMPONENTS entries
  // carry the same geometryType / subL / subW / subH shape).
  const seenIds = new Set(result.map(r => r.id));
  const placeables = (game.state.placeables || []).filter(
    p => p.category === 'beamline' || p.category === 'infrastructure'
  );
  for (const p of placeables) {
    if (seenIds.has(p.id)) continue;
    result.push({
      id: p.id,
      type: p.type,
      col: p.col,
      row: p.row,
      subCol: p.subCol ?? null,
      subRow: p.subRow ?? null,
      direction: p.dir ?? null,
      tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
      dimmed: false,
      health: undefined,
      beamlineId: p.beamlineId ?? null,
      accentColor: (COMPONENTS[p.type] && COMPONENTS[p.type].accentColor) || 0xc62828,
    });
  }

  return result;
}

function buildEquipment(game) {
  const equip = (game.state.placeables || []).filter(p => p.category === 'equipment');

  return equip.map(eq => ({
    key: eq.col + ',' + eq.row,
    id: eq.id,
    type: eq.type ?? null,
    col: eq.col ?? null,
    row: eq.row ?? null,
    subCol: eq.subCol ?? null,
    subRow: eq.subRow ?? null,
    dir: eq.dir ?? 0,
  }));
}

function buildDecorations(game) {
  return (game.state.placeables || [])
    .filter(p => p.kind === 'decoration')
    .map(d => ({
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

function buildUtilityRouting(game) {
  const connections = game.state.connections;
  if (!connections || connections.size === 0) return { floorSegments: [], portRoutes: [] };

  const connSet = (col, row) => connections.get(`${col},${row}`) || new Set();

  // ── Floor segments ──
  // For each connection tile, determine which directions have same-type neighbors.
  const floorSegments = [];
  for (const [key, typeSet] of connections) {
    const [col, row] = key.split(',').map(Number);
    for (const type of typeSet) {
      const neighbors = {
        north: connSet(col, row - 1).has(type),
        south: connSet(col, row + 1).has(type),
        west:  connSet(col - 1, row).has(type),
        east:  connSet(col + 1, row).has(type),
      };
      floorSegments.push({ col, row, type, neighbors });
    }
  }

  // ── Port routes (last-meter connections) ──
  const portRoutes = [];

  // Gather all placed components: beamline nodes + infrastructure placeables
  const placeables = [];

  // Beamline registry nodes
  for (const entry of game.registry.getAll()) {
    for (const node of entry.beamline.getAllNodes()) {
      const def = node.compDef || node;
      if (!def.id && !node.type) continue;
      const compId = def.id || node.type;
      const tiles = node.tiles || [{ col: node.col, row: node.row }];
      placeables.push({
        id: compId,
        col: node.col,
        row: node.row,
        dir: node.dir ?? 0,
        tiles,
        subW: def.subW || def.gridW || 2,
        subL: def.subL || def.gridH || 2,
      });
    }
  }

  // Infrastructure placeables
  const infraPlaceables = game.state.placeables || [];
  for (const p of infraPlaceables) {
    if (p.category === 'equipment' || p.category === 'infrastructure') {
      const compId = p.type || p.id;
      if (!compId) continue;
      const tiles = p.cells
        ? p.cells.map(c => ({ col: c.col, row: c.row }))
        : [{ col: p.col, row: p.row }];
      placeables.push({
        id: compId,
        col: p.col,
        row: p.row,
        dir: p.dir ?? 0,
        tiles,
        subW: p.subW || p.gridW || 2,
        subL: p.subL || p.gridH || 2,
      });
    }
  }

  // Direction lookup tables for lateral sides
  // dir 0: facing front=+row, left=-col, right=+col
  // dir 1: facing front=-col, left=+row, right=-row  (etc.)
  const LEFT_OFFSET =  [[-1,0],[0,1],[1,0],[0,-1]];
  const RIGHT_OFFSET = [[1,0],[0,-1],[-1,0],[0,1]];

  for (const comp of placeables) {
    const ports = getUtilityPorts(comp.id);
    if (!ports || ports.length === 0) continue;

    const tileSet = new Set(comp.tiles.map(t => `${t.col},${t.row}`));

    // Find tiles adjacent to left and right sides
    const leftAdj = new Set();
    const rightAdj = new Set();
    for (const t of comp.tiles) {
      const lo = LEFT_OFFSET[comp.dir];
      const ro = RIGHT_OFFSET[comp.dir];
      const lk = `${t.col + lo[0]},${t.row + lo[1]}`;
      const rk = `${t.col + ro[0]},${t.row + ro[1]}`;
      if (!tileSet.has(lk)) leftAdj.add(lk);
      if (!tileSet.has(rk)) rightAdj.add(rk);
    }

    for (const port of ports) {
      let connectedSide = null;

      for (const k of leftAdj) {
        const [ac, ar] = k.split(',').map(Number);
        if (connSet(ac, ar).has(port.type)) { connectedSide = 'left'; break; }
      }
      if (!connectedSide) {
        for (const k of rightAdj) {
          const [ac, ar] = k.split(',').map(Number);
          if (connSet(ac, ar).has(port.type)) { connectedSide = 'right'; break; }
        }
      }

      portRoutes.push({
        compId: comp.id,
        col: comp.col,
        row: comp.row,
        dir: comp.dir,
        portType: port.type,
        portOffset: port.offset,
        subW: comp.subW,
        subL: comp.subL,
        connectedSide,
      });
    }
  }

  // Pipe attachments (quads, BPMs, etc.)
  const pipeAttachments = buildPipeAttachments(game);
  for (const att of pipeAttachments) {
    const ports = getUtilityPorts(att.type);
    if (!ports || ports.length === 0) continue;

    const attDir = att.direction ?? 0;
    for (const port of ports) {
      const tileCol = Math.round(att.col);
      const tileRow = Math.round(att.row);

      let connectedSide = null;
      const lo = LEFT_OFFSET[attDir];
      const ro = RIGHT_OFFSET[attDir];
      const lc = tileCol + lo[0], lr = tileRow + lo[1];
      const rc = tileCol + ro[0], rr = tileRow + ro[1];

      if (connSet(lc, lr).has(port.type)) connectedSide = 'left';
      else if (connSet(rc, rr).has(port.type)) connectedSide = 'right';

      portRoutes.push({
        compId: att.type,
        col: att.col,
        row: att.row,
        dir: attDir,
        portType: port.type,
        portOffset: port.offset,
        subW: 2,
        subL: 2,
        connectedSide,
      });
    }
  }

  return { floorSegments, portRoutes };
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

function buildPipeAttachments(game) {
  const result = [];
  const pipes = game.state.beamPipes || [];
  for (const pipe of pipes) {
    const atts = pipe.attachments || [];
    if (atts.length === 0) continue;
    const path = pipe.path || [];
    const pathLen = path.length;
    if (pathLen === 0) continue;

    for (const att of atts) {
      const t = Math.max(0, Math.min(1, att.position ?? 0));
      const exactIdx = t * (pathLen - 1);
      const idx0 = Math.floor(exactIdx);
      const idx1 = Math.min(idx0 + 1, pathLen - 1);
      const frac = exactIdx - idx0;

      const p0 = path[idx0];
      const p1 = path[idx1];
      const col = p0.col + (p1.col - p0.col) * frac;
      const row = p0.row + (p1.row - p0.row) * frac;

      // Direction from segment the attachment sits on.
      // dir convention matches node.dir: 0=NE, 1=SE, 2=SW, 3=NW
      let dir = 0;
      const dc = p1.col - p0.col;
      const dr = p1.row - p0.row;
      if (dc > 0) dir = 1;       // SE
      else if (dc < 0) dir = 3;  // NW
      else if (dr > 0) dir = 2;  // SW
      else if (dr < 0) dir = 0;  // NE

      result.push({
        id: att.id,
        type: att.type,
        col,
        row,
        subCol: null,
        subRow: null,
        direction: dir,
        tiles: [{ col: Math.round(col), row: Math.round(row) }],
        dimmed: false,
        health: undefined,
        pipeId: pipe.id,
        position: t,
        params: att.params,
      });
    }
  }
  return result;
}

function buildFurnishings(game) {
  return (game.state.zoneFurnishings || []).map(f => ({
    col: f.col,
    row: f.row,
    subCol: f.subCol ?? null,
    subRow: f.subRow ?? null,
    type: f.type,
    dir: f.dir ?? 0,
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
    floors: buildFloors(game),
    walls: buildWalls(game),
    doors: buildDoors(game),
    zones: buildZones(game),
    components: buildComponents(game),
    equipment: buildEquipment(game),
    decorations: buildDecorations(game),
    connections: buildConnections(game),
    beamPaths: buildBeamPaths(game),
    furnishings: buildFurnishings(game),
    pipeAttachments: buildPipeAttachments(game),
    utilityRouting: buildUtilityRouting(game),
  };
}
