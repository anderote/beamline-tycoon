// Ground clearance owned by a universal utility bus.
//
// The bus is not a placeable, so it never enters Game's subgrid occupancy map.
// Keep its physical floor strip explicit here so both bus construction and
// ordinary placeable validation agree about the same narrow service spine.

const SUBTILES_PER_TILE = 4;
const CELL_SIZE = 1 / SUBTILES_PER_TILE;
const CELL_HALF = CELL_SIZE / 2;

// The rendered tray is 0.72 m wide. One tile is 2 m, so its half-width is
// 0.18 tile. Cell intersection (rather than centre containment) reserves the
// two half-metre subtiles beneath a bus drawn on a quarter-grid line while
// leaving the next row free for equipment built alongside it.
export const UNIVERSAL_BUS_HALF_WIDTH_TILES = 0.18;

function cellAt(subCol, subRow) {
  const col = Math.floor(subCol / SUBTILES_PER_TILE);
  const row = Math.floor(subRow / SUBTILES_PER_TILE);
  return {
    col,
    row,
    subCol: subCol - col * SUBTILES_PER_TILE,
    subRow: subRow - row * SUBTILES_PER_TILE,
  };
}

function pointCoordinate(point, axis) {
  return Number(point?.[axis]) || 0;
}

/** Stable key matching the level-zero shape used by Game.subgridOccupied. */
export function universalBusCellKey(cell) {
  return `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`;
}

/**
 * Every floor subtile physically intersected by an orthogonal bus path.
 * Paths are authored in fractional tile coordinates.
 */
export function universalBusFootprintCells(path) {
  if (!Array.isArray(path) || path.length < 2) return [];
  const cells = new Map();
  const padding = UNIVERSAL_BUS_HALF_WIDTH_TILES;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const ax = pointCoordinate(a, 'col'), az = pointCoordinate(a, 'row');
    const bx = pointCoordinate(b, 'col'), bz = pointCoordinate(b, 'row');
    const horizontal = Math.abs(bx - ax) >= Math.abs(bz - az);
    const minX = Math.min(ax, bx) - (horizontal ? 0 : padding);
    const maxX = Math.max(ax, bx) + (horizontal ? 0 : padding);
    const minZ = Math.min(az, bz) - (horizontal ? padding : 0);
    const maxZ = Math.max(az, bz) + (horizontal ? padding : 0);
    const firstX = Math.floor((minX - CELL_HALF) * SUBTILES_PER_TILE);
    const lastX = Math.ceil((maxX + CELL_HALF) * SUBTILES_PER_TILE) - 1;
    const firstZ = Math.floor((minZ - CELL_HALF) * SUBTILES_PER_TILE);
    const lastZ = Math.ceil((maxZ + CELL_HALF) * SUBTILES_PER_TILE) - 1;

    for (let sx = firstX; sx <= lastX; sx++) {
      const centerX = (sx + 0.5) * CELL_SIZE;
      if (centerX + CELL_HALF <= minX || centerX - CELL_HALF >= maxX) continue;
      for (let sz = firstZ; sz <= lastZ; sz++) {
        const centerZ = (sz + 0.5) * CELL_SIZE;
        if (centerZ + CELL_HALF <= minZ || centerZ - CELL_HALF >= maxZ) continue;
        const cell = cellAt(sx, sz);
        cells.set(universalBusCellKey(cell), cell);
      }
    }
  }
  return [...cells.values()];
}

/** Whether a proposed bus strip is clear of equipment and other buses. */
export function canBuildUniversalBus(state, path, { ignoreBusId = null } = {}) {
  const cells = universalBusFootprintCells(path);
  if (cells.length === 0) return { ok: false, cells, blockedCells: cells };
  const occupied = state?.subgridOccupied || {};
  const blocked = new Map();
  for (const cell of cells) {
    const key = universalBusCellKey(cell);
    if (occupied[key]) blocked.set(key, cell);
  }
  const proposed = new Set(cells.map(universalBusCellKey));
  for (const bus of state?.utilityBuses || []) {
    if (!bus?.id || bus.id === ignoreBusId) continue;
    for (const cell of universalBusFootprintCells(bus.path)) {
      const key = universalBusCellKey(cell);
      if (proposed.has(key)) blocked.set(key, cell);
    }
  }
  const blockedCells = [...blocked.values()];
  return { ok: blockedCells.length === 0, cells, blockedCells };
}

/** Floor cells in a placeable footprint that collide with a bus spine. */
export function placeableBusBlockedCells(state, cells) {
  if (!Array.isArray(cells) || cells.length === 0) return [];
  const placeableKeys = new Set(cells.map(universalBusCellKey));
  const blocked = new Map();
  for (const bus of state?.utilityBuses || []) {
    for (const cell of universalBusFootprintCells(bus?.path)) {
      const key = universalBusCellKey(cell);
      if (placeableKeys.has(key)) blocked.set(key, cell);
    }
  }
  return [...blocked.values()];
}
