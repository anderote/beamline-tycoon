// src/renderer3d/world-snapshot.js
// Builds a flat, serializable snapshot of game state for consumption by the Three.js renderer.
// The renderer never touches game.* directly — it reads only from this snapshot.

import { FLOORS } from '../data/structure.js';
import { COMPONENTS } from '../data/components.js';
import { DECORATIONS_RAW } from '../data/decorations.raw.js';
import { getUtilityPorts, UTILITY_PORT_PROFILES, isInfraOutput } from '../data/utility-ports.js';
import { rackNeighborAnchors, PIPE_SLOTS } from '../data/carrier-rack.js';
import { getTileCornersY } from '../game/terrain.js';

const GRASS_RANGE = 30;

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
      const cornersY = getTileCornersY(game.state, col, row);
      terrain.push({ col, row, hash, brightness, cornersY });
    }
  }

  return terrain;
}

/**
 * Emit vertical cliff-face quads between adjacent tiles whose shared edge
 * corners differ in Y. For each tile in the rendered range, check its east
 * and south neighbors (avoids double-counting edges). A neighbor outside
 * the rendered range is skipped — only edges between two rendered tiles
 * emit cliffs.
 *
 * Edge 'e' (east, between (c,r) and (c+1,r)):
 *   tile's NE/SE corners form selfY = [NE.y, SE.y] (north end, south end)
 *   neighbor's NW/SW corners form neighborY = [NW.y, SW.y]
 *
 * Edge 's' (south, between (c,r) and (c,r+1)):
 *   tile's SW/SE corners form selfY = [SW.y, SE.y] (west end, east end)
 *   neighbor's NW/NE corners form neighborY = [NW.y, NE.y]
 */
function buildCliffs(game) {
  const state = game.state;
  const cliffs = [];

  for (let col = -GRASS_RANGE; col <= GRASS_RANGE; col++) {
    for (let row = -GRASS_RANGE; row <= GRASS_RANGE; row++) {
      const self = getTileCornersY(state, col, row);

      // East edge — neighbor at (col+1, row). Skip if neighbor is outside range.
      if (col + 1 <= GRASS_RANGE) {
        const east = getTileCornersY(state, col + 1, row);
        const selfY = [self.ne, self.se];
        const neighborY = [east.nw, east.sw];
        if (selfY[0] !== neighborY[0] || selfY[1] !== neighborY[1]) {
          cliffs.push({ col, row, edge: 'e', selfY, neighborY });
        }
      }

      // South edge — neighbor at (col, row+1). Skip if neighbor is outside range.
      if (row + 1 <= GRASS_RANGE) {
        const south = getTileCornersY(state, col, row + 1);
        const selfY = [self.sw, self.se];
        const neighborY = [south.nw, south.ne];
        if (selfY[0] !== neighborY[0] || selfY[1] !== neighborY[1]) {
          cliffs.push({ col, row, edge: 's', selfY, neighborY });
        }
      }
    }
  }

  return cliffs;
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
      cornersY: getTileCornersY(game.state, tile.col, tile.row),
    };
  });
}

function buildWalls(game) {
  return (game.state.walls || []).map(w => {
    const c = getTileCornersY(game.state, w.col, w.row);
    // Endpoints per edge — a = first-listed corner, b = second.
    //   'n': NW -> NE
    //   'e': NE -> SE
    //   's': SE -> SW
    //   'w': SW -> NW
    let a, b;
    switch (w.edge) {
      case 'n': a = c.nw; b = c.ne; break;
      case 'e': a = c.ne; b = c.se; break;
      case 's': a = c.se; b = c.sw; break;
      case 'w': a = c.sw; b = c.nw; break;
      default:  a = 0;    b = 0;    break;
    }
    return {
      col: w.col,
      row: w.row,
      edge: w.edge,
      type: w.type,
      variant: w.variant ?? 0,
      baseY: { a, b },
    };
  });
}

function buildDoors(game) {
  return (game.state.doors || []).map(d => ({
    col: d.col,
    row: d.row,
    edge: d.edge,
    type: d.type,
    variant: d.variant || 0,
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
  const editingId = game.editingBeamlineId;

  // All beamline + infrastructure placeables
  const placeables = (game.state.placeables || []).filter(
    p => p.category === 'beamline' || p.category === 'infrastructure'
  );

  const result = placeables.map(p => {
    const entry = p.beamlineId ? game.registry.get(p.beamlineId) : null;
    const accentColor = entry ? entry.accentColor : 0xc62828;

    // Dimmed: node belongs to a different beamline than the one being edited
    let dimmed = false;
    if (editingId && entry && entry.id !== editingId) {
      dimmed = true;
    }

    const health = typeof game.getComponentHealth === 'function'
      ? game.getComponentHealth(p.id)
      : undefined;

    return {
      id: p.id,
      type: p.type,
      col: p.col,
      row: p.row,
      subCol: p.subCol ?? null,
      subRow: p.subRow ?? null,
      direction: p.dir ?? null,
      tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
      dimmed,
      health,
      beamlineId: p.beamlineId ?? null,
      accentColor,
    };
  });

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
    placeY: eq.placeY || 0,
  }));
}

function buildDecorations(game) {
  return (game.state.placeables || [])
    .filter(p => p.kind === 'decoration')
    .map(d => {
      const raw = DECORATIONS_RAW[d.type];
      const category = raw?.category ?? 'unknown';
      return {
        col: d.col,
        row: d.row,
        type: d.type,
        category,
        subCol: d.subCol ?? null,
        subRow: d.subRow ?? null,
        subW: raw?.subW ?? raw?.gridW ?? 4,
        subL: raw?.subL ?? raw?.gridH ?? 4,
        subH: raw?.subH ?? 4,
        variant: d.variant ?? null,
        tall: d.tall ?? false,
      };
    });
}

function buildRackSegments(game) {
  const segs = game.state.rackSegments;
  if (!segs || segs.size === 0) return [];

  const result = [];
  for (const [key, seg] of segs) {
    const [col, row] = key.split(',').map(Number);
    const anchors = rackNeighborAnchors(col, row);
    const neighbors = {
      north: segs.has(`${anchors.north.col},${anchors.north.row}`),
      south: segs.has(`${anchors.south.col},${anchors.south.row}`),
      east:  segs.has(`${anchors.east.col},${anchors.east.row}`),
      west:  segs.has(`${anchors.west.col},${anchors.west.row}`),
    };
    result.push({ col, row, utilities: [...seg.utilities], neighbors });
  }
  return result;
}

function buildUtilityRouting(game) {
  const segs = game.state.rackSegments;
  if (!segs || segs.size === 0) return { rackPipes: [], portRoutes: [] };

  const rackPipes = [];
  for (const [key, seg] of segs) {
    const [col, row] = key.split(',').map(Number);
    const anchors = rackNeighborAnchors(col, row);

    for (const type of seg.utilities) {
      const neighbors = {
        north: false, south: false, east: false, west: false,
      };
      for (const [dir, a] of Object.entries(anchors)) {
        const nseg = segs.get(`${a.col},${a.row}`);
        if (nseg && nseg.utilities.has(type)) neighbors[dir] = true;
      }

      rackPipes.push({ col, row, type, neighbors });
    }
  }

  const portRoutes = [];
  const placeables = [];

  for (const p of (game.state.placeables || [])) {
    if (p.category !== 'beamline') continue;
    const comp = COMPONENTS[p.type];
    placeables.push({
      id: p.id,
      col: p.col,
      row: p.row,
      dir: p.dir ?? 0,
      tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
      subW: comp?.subW || comp?.gridW || 2,
      subL: comp?.subL || comp?.gridH || 2,
    });
  }

  const infraPlaceables = game.state.placeables || [];
  for (const p of infraPlaceables) {
    if (p.category === 'equipment' || p.category === 'infrastructure') {
      const compId = p.type || p.id;
      if (!compId) continue;
      placeables.push({
        id: compId,
        col: p.col,
        row: p.row,
        dir: p.dir ?? 0,
        tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
        subW: p.subW || p.gridW || 2,
        subL: p.subL || p.gridH || 2,
      });
    }
  }

  const pipeAttachments = buildPipeAttachments(game);
  for (const att of pipeAttachments) {
    placeables.push({
      id: att.type,
      col: att.col,
      row: att.row,
      dir: att.direction ?? 0,
      tiles: [{ col: Math.round(att.col), row: Math.round(att.row) }],
      subW: 2,
      subL: 2,
    });
  }

  for (const comp of placeables) {
    const ports = getUtilityPorts(comp.id);
    if (!ports || ports.length === 0) continue;

    let rackSeg = null;
    for (const t of comp.tiles) {
      const seg = segs.get(`${t.col},${t.row}`);
      if (seg) { rackSeg = { col: t.col, row: t.row, seg }; break; }
      // Also check cardinal neighbors (rack adjacent to component)
      for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const ns = segs.get(`${t.col+dc},${t.row+dr}`);
        if (ns) { rackSeg = { col: t.col+dc, row: t.row+dr, seg: ns }; break; }
      }
      if (rackSeg) break;
    }

    for (const port of ports) {
      const connected = rackSeg && rackSeg.seg.utilities.has(port.type);

      portRoutes.push({
        compId: comp.id,
        col: comp.col,
        row: comp.row,
        dir: comp.dir,
        portType: port.type,
        portOffset: port.offset,
        subW: comp.subW,
        subL: comp.subL,
        rackCol: connected ? rackSeg.col : null,
        rackRow: connected ? rackSeg.row : null,
      });
    }
  }

  return { rackPipes, portRoutes };
}

function buildBeamPaths(game) {
  const editingId = game.editingBeamlineId;
  const beamPaths = [];

  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running') continue;
    const nodes = (game.state.placeables || []).filter(p => p.beamlineId === entry.id);
    if (nodes.length < 2) continue;

    const dimmed = !!(editingId && entry.id !== editingId);

    beamPaths.push({
      beamlineId: entry.id,
      nodePositions: nodes.map(n => ({
        col: n.col,
        row: n.row,
        tiles: n.cells ? n.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: n.col, row: n.row }],
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
    placeY: f.placeY || 0,
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
    cliffs: buildCliffs(game),
    cornerHeightsRevision: game.state.cornerHeightsRevision | 0,
    floors: buildFloors(game),
    walls: buildWalls(game),
    doors: buildDoors(game),
    zones: buildZones(game),
    components: buildComponents(game),
    equipment: buildEquipment(game),
    decorations: buildDecorations(game),
    rackSegments: buildRackSegments(game),
    beamPaths: buildBeamPaths(game),
    furnishings: buildFurnishings(game),
    pipeAttachments: buildPipeAttachments(game),
    utilityRouting: buildUtilityRouting(game),
  };
}
