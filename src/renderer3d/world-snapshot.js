// src/renderer3d/world-snapshot.js
// Builds a flat, serializable snapshot of game state for consumption by the Three.js renderer.
// The renderer never touches game.* directly — it reads only from this snapshot.

import { FLOORS, DOOR_TYPES, WALL_TYPES } from '../data/structure.js';
import { defaultDoorOff, findWallKey } from '../game/edge-keys.js';
import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { getTileCornersY, sampleCornersTriangulated } from '../game/terrain.js';
import { inMapRegion, DEFAULT_MAP_HALF_EXTENT } from '../game/map-generator.js';
import { placementPose } from '../beamline/pipe-placements.js';
import { flattenPath } from '../beamline/flattener.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { beamVisualMode, beamVisualProfile } from './beam-visual-mode.js';
import { beamVisualPath } from './beam-visual-path.js';
import { wallFixtureFaceOffset } from './fixture-light-math.js';
import { utilityAttachmentPose } from '../utility/line-attachments.js';
import { utilityLineHeight } from '../utility/registry.js';

/**
 * How far the drawn ground reaches — always exactly the map the player owns,
 * which grows when they buy land (see Game.buyLand). This used to be a
 * constant 35 duplicated from map-generator.js, so the renderer's idea of the
 * map and the generator's were two numbers that had to be kept in step by
 * hand. The fallback covers states built before the field existed (scenario
 * fixtures, hand-rolled test states), never a live game.
 */
function grassRange(game) {
  return game.state.mapHalfExtent ?? DEFAULT_MAP_HALF_EXTENT;
}

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

// Occupancy changes frequently; terrain shape and brightness do not. Cache the
// immutable base per live state so a floor/zone/placeable edit only filters
// tiles instead of re-running every Gaussian and corner-height sample.
const TERRAIN_BASE_CACHE = new WeakMap();

function terrainBase(game) {
  const state = game.state;
  const range = grassRange(game);
  const blobs = state.terrainBlobs || [];
  const revision = state.cornerHeightsRevision | 0;
  const prior = TERRAIN_BASE_CACHE.get(state);
  if (prior && prior.range === range && prior.blobs === blobs && prior.revision === revision) {
    return prior;
  }
  const tiles = [];
  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      if (!inMapRegion(col, row, range)) continue;
      tiles.push({
        col, row,
        hash: grassHash(col, row),
        brightness: sampleTerrainBrightness(col, row, blobs),
        cornersY: getTileCornersY(state, col, row),
      });
    }
  }
  const next = { range, blobs, revision, tiles, cliffs: null };
  TERRAIN_BASE_CACHE.set(state, next);
  return next;
}

// --- Section builders ---

function buildTerrain(game) {
  const infraOccupied = game.state.infraOccupied || {};
  const zoneOccupied = game.state.zoneOccupied || {};
  const terrain = [];
  for (const tile of terrainBase(game).tiles) {
    // Grass-kind placements (grass/wildgrass/tallgrass) do NOT displace the
    // default terrain mesh — they just tag the cell for per-kind tuft density.
    const key = `${tile.col},${tile.row}`;
    const occupant = infraOccupied[key];
    if (occupant && !GRASS_SURFACE_KINDS.has(occupant)) continue;
    if (zoneOccupied[key]) continue;
    terrain.push(tile);
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
  const base = terrainBase(game);
  if (base.cliffs) return base.cliffs;
  const cliffs = [];
  const range = base.range;

  for (let col = -range; col <= range; col++) {
    for (let row = -range; row <= range; row++) {
      const self = getTileCornersY(state, col, row);

      // East edge — neighbor at (col+1, row). Skip if neighbor is outside range.
      if (col + 1 <= range) {
        const east = getTileCornersY(state, col + 1, row);
        const selfY = [self.ne, self.se];
        const neighborY = [east.nw, east.sw];
        if (selfY[0] !== neighborY[0] || selfY[1] !== neighborY[1]) {
          cliffs.push({ col, row, edge: 'e', selfY, neighborY });
        }
      }

      // South edge — neighbor at (col, row+1). Skip if neighbor is outside range.
      if (row + 1 <= range) {
        const south = getTileCornersY(state, col, row + 1);
        const selfY = [self.sw, self.se];
        const neighborY = [south.nw, south.ne];
        if (selfY[0] !== neighborY[0] || selfY[1] !== neighborY[1]) {
          cliffs.push({ col, row, edge: 's', selfY, neighborY });
        }
      }
    }
  }

  base.cliffs = cliffs;
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
  const infraOccupied = game.state.infraOccupied || {};
  const out = [];
  for (const tile of game.state.floors || []) {
    if (!GRASS_SURFACE_KINDS.has(tile.type)) continue;
    // Defensive: a stale grass entry can sit under a floor placed by a path
    // that pushes directly into state.floors (e.g. DesignPlacer, or old
    // saves with duplicate entries). The occupant index is authoritative —
    // skip tufts when a non-grass floor covers the tile, mirroring
    // buildTerrain's exclusion.
    const occupant = infraOccupied[tile.col + ',' + tile.row];
    if (occupant && !GRASS_SURFACE_KINDS.has(occupant)) continue;
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

/**
 * Terrain height at an edge's two endpoints — a = first-listed corner,
 * b = second, in the corner order the renderer's `off` / baseY conventions
 * use throughout:
 *   'n': NW -> NE   'e': NE -> SE   's': SE -> SW   'w': SW -> NW
 */
function edgeBaseY(state, col, row, edge) {
  const c = getTileCornersY(state, col, row);
  switch (edge) {
    case 'n': return { a: c.nw, b: c.ne };
    case 'e': return { a: c.ne, b: c.se };
    case 's': return { a: c.se, b: c.sw };
    case 'w': return { a: c.sw, b: c.nw };
    default:  return { a: 0, b: 0 };
  }
}

function buildWalls(game) {
  const walls = (game.state.walls || []).map(w => ({
    col: w.col,
    row: w.row,
    edge: w.edge,
    type: w.type,
    variant: w.variant ?? 0,
    facePaint: w.facePaint ?? null,
    baseY: edgeBaseY(game.state, w.col, w.row, w.edge),
  }));
  for (const layer of (game.state.wallOverlays || [])) {
    const hostKey = game._wallSiteKey?.(layer.col, layer.row, layer.edge);
    const host = hostKey ? game._wallAt?.(hostKey) : null;
    if (!host) continue;
    walls.push({
      col: layer.col,
      row: layer.row,
      edge: layer.edge,
      type: layer.type,
      variant: layer.variant ?? 0,
      overlay: true,
      host: { col: host.col, row: host.row, edge: host.edge, type: host.type },
      baseY: edgeBaseY(game.state, layer.col, layer.row, layer.edge),
    });
  }
  return walls;
}

/**
 * `off` is the subtile offset of the door opening along its edge, counted in
 * quarter-tile slots from the edge's FIRST-listed corner in buildWalls' corner
 * order ('n' = NW->NE, 'e' = NE->SE, 's' = SE->SW, 'w' = SW->NW). A single
 * door is 2 slots wide (off 0..2), a double fills all 4 (off 0). Records
 * written before `off` existed default to the centered geometry they were
 * drawn with — 1 for singles, 0 for doubles.
 *
 * `baseY` carries the same endpoint heights walls get, so a gate in a fence
 * on a slope sits on the ground instead of at y=0 while the fence around it
 * climbs the hill.
 */
function buildDoors(game) {
  return (game.state.doors || []).map(d => ({
    col: d.col,
    row: d.row,
    edge: d.edge,
    type: d.type,
    variant: d.variant || 0,
    off: d.off ?? defaultDoorOff(DOOR_TYPES[d.type]),
    baseY: edgeBaseY(game.state, d.col, d.row, d.edge),
  }));
}

// Windows share the door pass's edge slot but never its occupancy map — a
// window is a hole in a wall, not a passable opening. See
// docs/superpowers/specs/2026-08-13-windows-design.md.
function buildWindows(game) {
  return (game.state.windows || []).map(w => ({
    col: w.col,
    row: w.row,
    edge: w.edge,
    type: w.type,
    variant: w.variant || 0,
    // Same endpoint heights walls and doors carry, so a window in a wall on
    // sloped ground sits on the terrain instead of at world zero.
    baseY: edgeBaseY(game.state, w.col, w.row, w.edge),
  }));
}

function buildZones(game) {
  return (game.state.zones || []).map(z => ({
    col: z.col,
    row: z.row,
    zoneType: z.type,
  }));
}

/**
 * Edge-occupancy indexes for cutaway room detection. Shallow copies so the
 * renderer's cached snapshot stays detached from live state mutation.
 */
function buildWallOccupancy(game) {
  return {
    wallOccupied: { ...(game.state.wallOccupied || {}) },
    doorOccupied: { ...(game.state.doorOccupied || {}) },
  };
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
      category: p.category ?? null,
      col: p.col,
      row: p.row,
      subCol: p.subCol ?? null,
      subRow: p.subRow ?? null,
      direction: p.dir ?? null,
      portsFlipped: p.portsFlipped === true,
      tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
      dimmed,
      health,
      // Presentation state is data, not a renderer inference. Future machine
      // controllers may publish p.visualState directly; broken hardware has a
      // useful default today.
      effectState: p.visualState || (Number.isFinite(health) && health <= 0 ? 'off' : 'on'),
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
    portsFlipped: eq.portsFlipped === true,
    placeY: eq.placeY || 0,
    effectState: eq.visualState || 'on',
  }));
}

function buildDecorations(game) {
  return (game.state.placeables || [])
    .filter(p => p.kind === 'decoration')
    .map(d => {
      // PLACEABLES is a superset of the legacy DECORATIONS_RAW map and the
      // source of truth for every def, lighting fixtures included — a
      // DECORATIONS_RAW-only lookup would silently resolve lighting fixtures
      // to category 'unknown' and default 4x4x4 dims.
      const raw = PLACEABLES[d.type];
      const category = raw?.category ?? 'unknown';
      const subW = raw?.subW ?? raw?.gridW ?? 4;
      const subL = raw?.subL ?? raw?.gridH ?? 4;
      // Occupancy extents swap on dir 1/3 — same rule as Placeable.footprintCells,
      // so the sampled midpoint is the centre of the cells actually reserved.
      const dir = d.dir || 0;
      const swap = dir === 1 || dir === 3;
      const footW = swap ? subL : subW;
      const footL = swap ? subW : subL;
      // Centered (no sub-cell) decorations sample the tile midpoint. Triangulated,
      // not bilinear, so the base lands on the rendered mesh on unflattened slopes.
      const sampleCol = d.wallMount?.col ?? d.col;
      const sampleRow = d.wallMount?.row ?? d.row;
      const c = getTileCornersY(game.state, sampleCol, sampleRow);
      const subRes = 4;
      let u = (d.subCol != null) ? ((d.subCol + footW / 2) / subRes) : 0.5;
      let v = (d.subRow != null) ? ((d.subRow + footL / 2) / subRes) : 0.5;
      if (d.wallMount) {
        const f = (Math.max(0, Math.min(3, d.wallMount.off ?? 1)) + 0.5) / 4;
        if (d.wallMount.edge === 'n') { u = f; v = 0; }
        else if (d.wallMount.edge === 'e') { u = 1; v = f; }
        else if (d.wallMount.edge === 's') { u = 1 - f; v = 1; }
        else if (d.wallMount.edge === 'w') { u = 0; v = 1 - f; }
      }
      const y = sampleCornersTriangulated(c, u, v);
      let wallMount = null;
      if (d.wallMount) {
        const wallKey = findWallKey(
          game.state.wallOccupied, d.wallMount.col, d.wallMount.row, d.wallMount.edge,
        );
        const wallType = wallKey ? game.state.wallOccupied[wallKey] : null;
        wallMount = {
          ...d.wallMount,
          faceOffset: wallFixtureFaceOffset(WALL_TYPES[wallType]),
        };
      }
      const zoneOccupied = game.state.zoneOccupied || {};
      const roomKeys = [`${d.col},${d.row}`];
      if (d.wallMount) {
        const edgeDelta = {
          n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0],
        }[d.wallMount.edge];
        if (edgeDelta) roomKeys.push(`${d.wallMount.col + edgeDelta[0]},${d.wallMount.row + edgeDelta[1]}`);
      }
      return {
        // Placeable id, so the builder can key its groups and hover/demolish
        // lookups can resolve a decoration's mesh the way components do.
        id: d.id,
        col: d.col,
        row: d.row,
        type: d.type,
        category,
        subCol: d.subCol ?? null,
        subRow: d.subRow ?? null,
        subW,
        subL,
        dir,
        subH: raw?.subH ?? 4,
        variant: d.variant ?? null,
        tall: d.tall ?? false,
        placeY: d.placeY || 0,
        wallMount,
        indoors: roomKeys.some((key) => !!zoneOccupied[key]),
        y,
      };
    });
}

function buildBeamPaths(game) {
  const editingId = game.editingBeamlineId;
  const beamPaths = [];

  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running') continue;
    // flattenPath is the graph's authoritative source-to-endpoint order.
    // Reading the raw placeables array here made the old glow cut diagonally
    // across turns whenever placement order differed from beam order.
    const flat = entry.sourceId ? flattenPath(game.state, entry.sourceId) : [];
    const nodes = flat
      .filter(el => el.kind === 'module' && el.placeable)
      .map(el => el.placeable);
    if (nodes.length < 2) continue;

    const dimmed = !!(editingId && entry.id !== editingId);

    const beamlineType = getBeamlineType(entry.typeId);
    beamPaths.push({
      beamlineId: entry.id,
      nodePositions: nodes.map(n => ({
        col: n.col,
        row: n.row,
        tiles: n.cells ? n.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: n.col, row: n.row }],
      })),
      dimmed,
      visualMode: beamVisualMode(beamlineType, flat),
      visualProfile: beamVisualProfile(
        beamlineType, flat, entry.beamState?.physicsEnvelope,
      ),
      color: entry.accentColor || 0x44ff44,
      worldPoints: beamVisualPath(flat, game.state.beamPipes),
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
      // The mesh is rendered CENTERED on its returned (col, row), so
      // placementPose samples an ordinary claimed interval at its midpoint
      // and an inline attachment directly at its point anchor. The utility
      // system resolves placement ports from the same helper.
      const pose = placementPose(pipe, att);
      if (!pose) continue;
      const { col, row, dir } = pose;

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
        position: att.position ?? 0,
        // Pass through the placement's own subL so long placements
        // (e.g. rfCavity subL=6) render at their correct length even when
        // the renderer falls back to a placeholder box.
        subL: att.subL,
        params: att.params,
        portsFlipped: att.portsFlipped === true,
      });
    }
  }
  const lines = game.state.utilityLines;
  const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
  for (const line of iter) {
    for (const att of (line?.attachments || [])) {
      const pose = utilityAttachmentPose(line, att);
      if (!pose) continue;
      result.push({
        id: att.id,
        type: att.type,
        col: pose.col,
        row: pose.row,
        worldX: pose.worldX,
        worldZ: pose.worldZ,
        subCol: null,
        subRow: null,
        direction: pose.dir,
        tiles: [{ col: Math.floor(pose.col), row: Math.floor(pose.row) }],
        dimmed: false,
        utilityLineId: line.id,
        position: att.position ?? 0,
        params: att.params,
        // Gauge role-builders are authored around the 1 m beam axis. Move
        // that mounting spool down onto the physical vacuum run.
        yOffset: utilityLineHeight(line.utilityType) - 1.0,
      });
    }
  }
  return result;
}

function buildFurnishings(game) {
  return (game.state.zoneFurnishings || []).map(f => ({
    id: f.id ?? null,
    col: f.col,
    row: f.row,
    subCol: f.subCol ?? null,
    subRow: f.subRow ?? null,
    type: f.type,
    dir: f.dir ?? 0,
    placeY: f.placeY || 0,
    variant: f.variant ?? 0,
    effectState: f.visualState || 'on',
  }));
}

/**
 * Beam-pipe polylines for the renderer's pipe meshes. `openStart` / `openEnd`
 * flag ends whose junction ref is null — the renderer draws a warning cap
 * there.
 */
function buildBeamPipes(game) {
  return (game.state.beamPipes || []).map(pipe => ({
    id: pipe.id,
    path: (pipe.path || []).map(p => ({ col: p.col, row: p.row })),
    openStart: pipe.start === null,
    openEnd: pipe.end === null,
  }));
}

/**
 * Subtile keys ("col,row,subCol,subRow") of every cell claimed by a placed
 * beamline module. Beam-pipe rendering carves pipe runs and skips flanges /
 * stands on these cells (modules render their own internal pipe geometry).
 */
function buildModuleSubTiles(game) {
  const keys = [];
  for (const p of (game.state.placeables || [])) {
    if (p.category !== 'beamline') continue;
    const def = COMPONENTS[p.type];
    if (!def || def.placement !== 'module' || def.isDrawnConnection) continue;
    for (const c of (p.cells || [])) {
      keys.push(`${c.col},${c.row},${c.subCol},${c.subRow}`);
    }
  }
  return keys;
}

// --- Main export ---

// Registry of independently buildable snapshot sections. Each builder is a
// pure read of game state; `buildWorldSnapshot` can compute any subset.
const SECTION_BUILDERS = {
  terrain: buildTerrain,           // expensive: full map-region tile walk
  cliffs: buildCliffs,             // expensive: full map-region tile walk
  floors: buildFloors,
  grassSurfaces: buildGrassSurfaces,
  walls: buildWalls,
  doors: buildDoors,
  windows: buildWindows,
  wallOccupancy: buildWallOccupancy,
  zones: buildZones,
  components: buildComponents,
  equipment: buildEquipment,
  decorations: buildDecorations,
  beamPaths: buildBeamPaths,
  furnishings: buildFurnishings,
  pipeAttachments: buildPipeAttachments,
  beamPipes: buildBeamPipes,
  moduleSubTiles: buildModuleSubTiles,
  // Phase 6: new-system utility lines (Map → Array). The builder still reads
  // state directly for incremental rebuilds; snapshot consumers and tests
  // can use this.
  utilityLines: buildUtilityLines,
};

/**
 * Build a flat, serializable world snapshot from game state.
 * The Three.js renderer consumes this and never reads game.* directly.
 *
 * @param {object} game - The Game instance
 * @param {object} [opts]
 * @param {string[]} [opts.only] - Section names to compute (see
 *        SECTION_BUILDERS). Omitted sections are absent from the result, so
 *        partial refreshes skip the expensive terrain walk entirely.
 *        `cornerHeightsRevision` is always included (cheap scalar).
 * @returns {object} snapshot
 */
export function buildWorldSnapshot(game, opts = {}) {
  const only = opts.only ? new Set(opts.only) : null;
  const snapshot = { cornerHeightsRevision: game.state.cornerHeightsRevision | 0 };
  for (const name of Object.keys(SECTION_BUILDERS)) {
    if (only && !only.has(name)) continue;
    snapshot[name] = SECTION_BUILDERS[name](game);
  }
  return snapshot;
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
      cablePath: Array.isArray(l.cablePath)
        ? l.cablePath.map(p => ({ col: p.col, row: p.row }))
        : undefined,
      subL: l.subL || 0,
      attachments: (l.attachments || []).map(a => ({
        id: a.id, type: a.type, position: a.position, params: a.params || null,
      })),
    });
  }
  return out;
}
