// === COORDINATE UTILITIES ===
// Isometric grid coordinate conversion functions.

import { TILE_W, TILE_H } from '../data/directions.js';

/**
 * Convert grid coordinates (col, row) to isometric screen position.
 */
export function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/**
 * Convert isometric screen position back to grid coordinates (col, row).
 */
export function isoToGrid(screenX, screenY) {
  return {
    col: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    row: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  };
}

/**
 * Convert isometric screen position to fractional grid coordinates (no rounding).
 * Used for edge detection — determines which edge of a tile the cursor is nearest to.
 */
export function isoToGridFloat(screenX, screenY) {
  return {
    col: (screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2,
    row: (screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2,
  };
}

/**
 * Return the isometric screen position of the CENTER of grid cell (col, row).
 * gridToIso gives the top vertex; this offsets by half a tile in each axis.
 */
export function tileCenterIso(col, row) {
  return gridToIso(col + 0.5, row + 0.5);
}

/**
 * Convert sub-grid coordinates within a tile to isometric screen offset.
 * A tile's 4x4 sub-grid has cells of size TILE_W/4 x TILE_H/4.
 * Returns pixel offset from the tile's top vertex (gridToIso position).
 */
export function subGridToIso(subCol, subRow) {
  const subW = TILE_W / 4;
  const subH = TILE_H / 4;
  return {
    x: (subCol - subRow) * (subW / 2),
    y: (subCol + subRow) * (subH / 2),
  };
}

/**
 * Convert a screen offset (relative to tile top vertex) to sub-grid coordinates.
 * Returns fractional values — caller should Math.floor for cell index.
 */
export function isoToSubGrid(offsetX, offsetY) {
  const subW = TILE_W / 4;
  const subH = TILE_H / 4;
  return {
    subCol: (offsetX / (subW / 2) + offsetY / (subH / 2)) / 2,
    subRow: (offsetY / (subH / 2) - offsetX / (subW / 2)) / 2,
  };
}
