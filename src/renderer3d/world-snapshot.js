// src/renderer3d/world-snapshot.js
// Builds a flat, serializable snapshot of game state for consumption by the Three.js renderer.
// The renderer never touches game.* directly — it reads only from this snapshot.

import { FLOORS } from '../data/structure.js';
import { COMPONENTS } from '../data/components.js';
import { DECORATIONS_RAW } from '../data/decorations.raw.js';
import { getTileCornersY, sampleCornersAt } from '../game/terrain.js';
import { inMapRegion } from '../game/map-generator.js';

const GRASS_RANGE = 35;

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
      if (!inMapRegion(col, row)) continue;
      const key = col + ',' + row;
      // Grass-kind placements (grass/wildgrass/tallgrass) do NOT displace the
      // default terrain mesh — they just tag the cell for per-kind tuft
      // density. This keeps the brightness-blob vertex colouring continuous
      // across placed grass patches so they blend with the surrounding map.
      const occupant = infraOccupied[key];
      if (occupant && !GRASS_SURFACE_KINDS.has(occupant)) continue;
      if (zoneOccupied[key]) continue;

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

const GRASS_SURFACE_KINDS = new Set(['grass', 'wildgrass', 'tallgrass']);

/**
 * Placed grass-kind floors with per-tile hash + brightness, so the tuft
 * builder can render tufts on them at a per-kind density. Returned as a
 * separate snapshot field to keep other floor consumers uninvolved.
 */
function buildGrassSurfaces(game) {
  const blobs = game.state.terrainBlobs || [];
  const out = [];
  for (const tile of game.state.floors || []) {
    if (!GRASS_SURFACE_KINDS.has(tile.type)) continue;
    out.push({
      col: tile.col,
      row: tile.row,
      kind: tile.type,
      hash: grassHash(tile.col, tile.row),
      brightness: sampleTerrainBrightness(tile.col, tile.row, blobs),
      cornersY: getTileCornersY(game.state, tile.col, tile.row),
    });
  }
  return out;
}

function buildFloors(game) {
  const out = [];
  for (const tile of game.state.floors || []) {
    // Grass-kind surfaces render via the terrain mesh (which still covers
    // these cells) plus the tuft builder — skip emitting a floor tile so the
    // FloorBuilder doesn't stamp a flat texture on top.
    if (GRASS_SURFACE_KINDS.has(tile.type)) continue;
    const def = FLOORS[tile.type];
    // Concrete is treated as a flat foundation pad at y=0 — it ignores
    // underlying terrain slope (may visually clip; flatten-on-place TBD).
    const isConcrete = tile.type === 'concrete';
    const cornersY = isConcrete
      ? { nw: 0, ne: 0, se: 0, sw: 0 }
      : getTileCornersY(game.state, tile.col, tile.row);
    out.push({
      col: tile.col,
      row: tile.row,
      type: tile.type,
      orientation: tile.orientation ?? null,
      variant: tile.variant ?? null,
      tint: tile.tint ?? null,
      noGrid: def?.noGrid ?? false,
      cornersY,
    });
  }
  return out;
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
      const subW = raw?.subW ?? raw?.gridW ?? 4;
      const subL = raw?.subL ?? raw?.gridH ?? 4;
      // Centered (no sub-cell) decorations sample the tile midpoint.
      const c = getTileCornersY(game.state, d.col, d.row);
      const subRes = 4;
      const u = (d.subCol != null) ? ((d.subCol + subW / 2) / subRes) : 0.5;
      const v = (d.subRow != null) ? ((d.subRow + subL / 2) / subRes) : 0.5;
      const y = sampleCornersAt(c, u, v);
      return {
        col: d.col,
        row: d.row,
        type: d.type,
        category,
        subCol: d.subCol ?? null,
        subRow: d.subRow ?? null,
        subW,
        subL,
        subH: raw?.subH ?? 4,
        variant: d.variant ?? null,
        tall: d.tall ?? false,
        y,
      };
    });
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
    const atts = pipe.placements || [];
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
        // Pass through the placement's own subL so long placements
        // (e.g. rfCavity subL=6) render at their correct length even when
        // the renderer falls back to a placeholder box.
        subL: att.subL,
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
    grassSurfaces: buildGrassSurfaces(game),
    walls: buildWalls(game),
    doors: buildDoors(game),
    zones: buildZones(game),
    components: buildComponents(game),
    equipment: buildEquipment(game),
    decorations: buildDecorations(game),
    beamPaths: buildBeamPaths(game),
    furnishings: buildFurnishings(game),
    pipeAttachments: buildPipeAttachments(game),
    // Phase 6: new-system utility lines (Map → Array). The builder still reads
    // state directly for incremental rebuilds; snapshot consumers and tests
    // can use this.
    utilityLines: buildUtilityLines(game),
  };
}

function buildUtilityLines(game) {
  const lines = game && game.state && game.state.utilityLines;
  if (!lines) return [];
  const iter = typeof lines.values === 'function' ? lines.values() : lines;
  const out = [];
  for (const l of iter) {
    if (!l) continue;
    out.push({
      id: l.id,
      utilityType: l.utilityType,
      start: l.start || null,
      end: l.end || null,
      path: (l.path || []).map(p => ({ col: p.col, row: p.row })),
      subL: l.subL || 0,
    });
  }
  return out;
}
