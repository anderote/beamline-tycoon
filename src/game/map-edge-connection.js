// Pure placement geometry for equipment that represents an off-map service.
//
// Tile indices run from -halfExtent through +halfExtent, inclusive, so the
// physical tile boundaries are -halfExtent and halfExtent + 1. Keeping that
// half-open interval explicit avoids the common east/south off-by-one where
// a lead ends at the centre of the last tile instead of at the map boundary.

const SUBTILES_PER_TILE = 4;
const WORLD_UNITS_PER_TILE = 2;
const EPSILON = 1e-9;

function tileCoord(cell, axis) {
  if (axis === 'col') return cell.col + (cell.subCol || 0) / SUBTILES_PER_TILE;
  return cell.row + (cell.subRow || 0) / SUBTILES_PER_TILE;
}

export function footprintTileBounds(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const cell of cells) {
    if (!cell || !Number.isFinite(cell.col) || !Number.isFinite(cell.row)) return null;
    const col = tileCoord(cell, 'col');
    const row = tileCoord(cell, 'row');
    minCol = Math.min(minCol, col);
    minRow = Math.min(minRow, row);
    maxCol = Math.max(maxCol, col + 1 / SUBTILES_PER_TILE);
    maxRow = Math.max(maxRow, row + 1 / SUBTILES_PER_TILE);
  }
  return { minCol, minRow, maxCol, maxRow };
}

/**
 * Resolve the nearest map boundary for one authored mapEdgeConnection.
 *
 * `valid` is a placement-time rule. Presentation may still use the returned
 * geometry when it is false because later land purchases legitimately move
 * the boundary away from an already-built service point; its incoming leads
 * then extend to the new edge rather than disappearing.
 */
export function resolveMapEdgeConnection(cells, mapHalfExtent, spec) {
  if (!spec || !Number.isFinite(mapHalfExtent)) return null;
  const bounds = footprintTileBounds(cells);
  if (!bounds) return null;

  const mapMin = -mapHalfExtent;
  const mapMax = mapHalfExtent + 1;
  const candidates = [
    { edge: 'north', distanceTiles: bounds.minRow - mapMin },
    { edge: 'east', distanceTiles: mapMax - bounds.maxCol },
    { edge: 'south', distanceTiles: mapMax - bounds.maxRow },
    { edge: 'west', distanceTiles: bounds.minCol - mapMin },
  ];
  let nearest = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.distanceTiles < nearest.distanceTiles - EPSILON) nearest = candidate;
  }

  const insideMap = bounds.minCol >= mapMin - EPSILON
    && bounds.minRow >= mapMin - EPSILON
    && bounds.maxCol <= mapMax + EPSILON
    && bounds.maxRow <= mapMax + EPSILON;
  const maxDistanceTiles = Number(spec.maxDistanceTiles);
  const withinRange = nearest.distanceTiles <= maxDistanceTiles + EPSILON;
  const centerCol = (bounds.minCol + bounds.maxCol) / 2;
  const centerRow = (bounds.minRow + bounds.maxRow) / 2;
  const leadHeightMeters = Number(spec.leadHeightMeters) || 2.05;
  const startWorld = {
    x: centerCol * WORLD_UNITS_PER_TILE,
    y: leadHeightMeters,
    z: centerRow * WORLD_UNITS_PER_TILE,
  };
  const endWorld = { ...startWorld };
  if (nearest.edge === 'north') endWorld.z = mapMin * WORLD_UNITS_PER_TILE;
  else if (nearest.edge === 'east') endWorld.x = mapMax * WORLD_UNITS_PER_TILE;
  else if (nearest.edge === 'south') endWorld.z = mapMax * WORLD_UNITS_PER_TILE;
  else endWorld.x = mapMin * WORLD_UNITS_PER_TILE;

  return {
    edge: nearest.edge,
    valid: insideMap && withinRange,
    insideMap,
    withinRange,
    distanceTiles: Math.max(0, nearest.distanceTiles),
    maxDistanceTiles,
    startWorld,
    endWorld,
    conductorCount: Math.max(1, Math.floor(spec.conductorCount || 3)),
    conductorSpacingMeters: Number(spec.conductorSpacingMeters) || 0.34,
    conductorRadiusMeters: Number(spec.conductorRadiusMeters) || 0.035,
    sagMeters: Number(spec.sagMeters) || 0.22,
  };
}
